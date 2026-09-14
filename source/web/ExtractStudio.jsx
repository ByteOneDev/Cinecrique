import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  CaretLeft,
  CaretRight,
  Check,
  CircleNotch,
  DownloadSimple,
  Eye,
  EyeSlash,
  FilmStrip,
  Image as ImageIcon,
  MapPin,
  Package,
  Pause,
  Play,
  Plus,
  Quotes,
  Scissors,
  SpeakerHigh,
  SpeakerSlash,
  Trash,
  WarningCircle,
  X,
} from "@phosphor-icons/react";

import {
  CLIP_FORMATS,
  CLIP_MODES,
  CLIP_QUALITIES,
  CLIP_RESOLUTIONS,
  GIF_FRAME_RATES,
  MAX_BASKET_ITEMS,
  STILL_FORMATS,
  WATERMARK_POSITIONS,
  WATERMARK_SIZES,
  addClipToBasket,
  basketDuration,
  citationFromSubtitles,
  clampClipRange,
  clipExportPayload,
  clipRangeIssue,
  effectiveClipMode,
  estimatedClipBytes,
  formatBytes,
  normalizeClipSettings,
  projectAttribution,
  removeClipFromBasket,
  updateClipInBasket,
  watermarkLines,
} from "./clips.js";
import { nativeBridge } from "./native.js";

const WATERMARK_PREVIEW_RATIO = { small: 0.026, medium: 0.034, large: 0.045 };

function StudioButton({ label, active = false, className = "", children, ...props }) {
  return (
    <button
      type="button"
      className={`icon-button ${active ? "active" : ""} ${className}`.trim()}
      title={label}
      aria-label={label}
      aria-pressed={active || undefined}
      {...props}
    >
      {children}
    </button>
  );
}

function SegmentedField({ legend, value, options, onChange, disabled = false }) {
  return (
    <fieldset className="studio-field" disabled={disabled}>
      <legend>{legend}</legend>
      <div className="segmented-control" role="group" aria-label={legend}>
        {options.map((option) => (
          <button
            key={String(option.value)}
            type="button"
            className={option.value === value ? "active" : ""}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
      {options.find((option) => option.value === value)?.detail && (
        <small>{options.find((option) => option.value === value).detail}</small>
      )}
    </fieldset>
  );
}

export function ExtractStudio({
  project,
  mediaSource,
  renderMediaPath,
  originalMediaPath,
  duration,
  frameRate,
  subtitleCues,
  markers,
  nativeMode,
  clipExportAvailable,
  initialTime,
  settings,
  onSettingsChange,
  basket,
  onBasketChange,
  formatTimecode,
  formatDuration,
  onToast,
  onClose,
}) {
  const videoRef = useRef(null);
  const frameRef = useRef(null);
  const closeButtonRef = useRef(null);
  const exportOperationRef = useRef(null);
  const [currentTime, setCurrentTime] = useState(() => Math.max(0, Number(initialTime) || 0));
  const [isPlaying, setIsPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [kind, setKind] = useState("clip");
  const [range, setRange] = useState(() => {
    const start = Math.max(0, Number(initialTime) || 0);
    return { start, end: Math.min(start + 8, Math.max(start + 8, duration || start + 8)) };
  });
  const [label, setLabel] = useState("");
  const [previewVisible, setPreviewVisible] = useState(true);
  const [frameBox, setFrameBox] = useState({ width: 0, height: 0 });
  const [pictureRatio, setPictureRatio] = useState(16 / 9);
  const [exportState, setExportState] = useState(null);

  const safeSettings = useMemo(() => normalizeClipSettings(settings), [settings]);
  const watermark = safeSettings.watermark;
  const step = 1 / Math.max(frameRate || 24, 1);
  const attribution = useMemo(() => projectAttribution(project), [project]);
  const rangeMarkers = useMemo(
    () => (Array.isArray(markers) ? markers : []).filter((marker) => Number(marker.endTime) > Number(marker.time)),
    [markers],
  );
  const detectedCitation = useMemo(
    () => citationFromSubtitles(subtitleCues, range.start, kind === "still" ? range.start : range.end),
    [kind, range.end, range.start, subtitleCues],
  );
  const previewLines = useMemo(() => watermarkLines(watermark, {
    citation: detectedCitation,
    attribution,
    timecode: formatTimecode(range.start),
  }), [attribution, detectedCitation, formatTimecode, range.start, watermark]);

  const rangeIssue = kind === "still"
    ? ""
    : clipRangeIssue(range.start, range.end, { duration, format: safeSettings.format });
  const draftClip = useMemo(() => ({
    kind,
    start: range.start,
    end: kind === "still" ? range.start : range.end,
    label,
    citation: watermark.source === "custom" ? watermark.citation : detectedCitation,
    settings: safeSettings,
  }), [detectedCitation, kind, label, range.end, range.start, safeSettings, watermark.citation, watermark.source]);
  const basketBytes = useMemo(
    () => basket.reduce((total, item) => total + estimatedClipBytes(item), 0),
    [basket],
  );
  const exportReady = nativeMode && clipExportAvailable;

  const updateSettings = useCallback((changes) => {
    onSettingsChange(normalizeClipSettings({ ...safeSettings, ...changes }));
  }, [onSettingsChange, safeSettings]);

  const updateWatermark = useCallback((changes) => {
    updateSettings({ watermark: { ...watermark, ...changes } });
  }, [updateSettings, watermark]);

  const seekTo = useCallback((value) => {
    const next = Math.min(Math.max(Number(value) || 0, 0), duration || Number.MAX_SAFE_INTEGER);
    if (videoRef.current) videoRef.current.currentTime = next;
    setCurrentTime(next);
  }, [duration]);

  const togglePlayback = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play().catch(() => setIsPlaying(false));
    else video.pause();
  }, []);

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  // Le filigrane d’aperçu doit suivre la taille réelle de l’image projetée, pas
  // celle du lecteur, pour rester fidèle à l’incrustation du moteur natif.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || typeof ResizeObserver !== "function") return undefined;
    const observer = new ResizeObserver(([entry]) => {
      const rect = entry?.contentRect;
      if (rect?.width > 0 && rect?.height > 0) setFrameBox({ width: rect.width, height: rect.height });
    });
    observer.observe(frame);
    return () => observer.disconnect();
  }, [mediaSource]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (document.querySelector("[role='dialog'][aria-modal='true']")) return;
      const target = event.target;
      const tagName = String(target?.tagName || "").toLowerCase();
      if (target?.isContentEditable || ["input", "textarea", "select"].includes(tagName)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === " ") {
        event.preventDefault();
        togglePlayback();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        seekTo(currentTime - (event.shiftKey ? 1 : step));
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        seekTo(currentTime + (event.shiftKey ? 1 : step));
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentTime, seekTo, step, togglePlayback]);

  useEffect(() => {
    if (!nativeMode) return undefined;
    return nativeBridge.on("analyse:clip-export", (detail) => {
      if (!detail || detail.operationId !== exportOperationRef.current) return;
      if (["complete", "cancelled", "failed"].includes(detail.stage)) {
        setExportState(null);
        return;
      }
      setExportState({
        progress: Math.min(Math.max(Number(detail.progress) || 0, 0), 1),
        message: detail.message || "Export en cours",
        cancellable: Boolean(detail.cancellable),
        index: Number(detail.index) || 0,
        total: Number(detail.total) || 1,
      });
    });
  }, [nativeMode]);

  const markPoint = (point) => {
    const next = point === "a"
      ? clampClipRange(currentTime, Math.max(range.end, currentTime + step), duration)
      : clampClipRange(Math.min(range.start, currentTime - step), currentTime, duration);
    setRange(next);
  };

  const applyMarkerRange = (markerId) => {
    const marker = rangeMarkers.find((item) => String(item.id) === String(markerId));
    if (!marker) return;
    const next = clampClipRange(marker.time, marker.endTime, duration);
    setRange(next);
    setLabel(String(marker.title || "").slice(0, 80));
    seekTo(next.start);
  };

  const addToBasket = () => {
    if (rangeIssue) {
      onToast(rangeIssue);
      return;
    }
    const result = addClipToBasket(basket, {
      ...draftClip,
      id: `extrait-${Date.now()}-${Math.round(Math.random() * 1_000)}`,
    });
    onBasketChange(result.basket);
    onToast(result.error || (kind === "still" ? "Image ajoutée au panier" : "Extrait ajouté au panier"));
  };

  const runExport = async (items) => {
    if (!items.length) {
      onToast("Ajoutez d’abord un extrait au panier.");
      return;
    }
    if (!exportReady) {
      onToast("L’export d’extraits nécessite l’application macOS de Cinécrique.");
      return;
    }
    const needsOriginal = items.some((item) => item.kind === "clip");
    const needsRender = items.some((item) => item.kind === "still");
    if (needsOriginal && !originalMediaPath) {
      onToast("Reliez d’abord le média original pour découper un extrait.");
      return;
    }
    if (needsRender && !renderMediaPath) {
      onToast("Préparez d’abord le proxy de lecture pour extraire une image.");
      return;
    }

    const operationId = `clips-${Date.now()}-${Math.round(Math.random() * 10_000)}`;
    exportOperationRef.current = operationId;
    setExportState({ progress: 0, message: "Préparation de l’export", cancellable: true, index: 0, total: items.length });
    try {
      const result = await nativeBridge.call("exportClips", {
        operationId,
        originalMediaPath: originalMediaPath || "",
        renderMediaPath: renderMediaPath || "",
        items: items.map((item, index) => clipExportPayload(item, {
          title: project?.title,
          attribution,
          citation: item.citation || detectedCitation,
          formatTimecode,
          index,
        })),
      });
      if (result?.cancelled) {
        onToast("Export d’extraits annulé");
        return;
      }
      const count = Array.isArray(result?.files) ? result.files.length : 1;
      onToast(count > 1 ? `${count} extraits exportés` : "Extrait exporté");
    } catch (error) {
      onToast(`Export impossible : ${error.message}`);
    } finally {
      exportOperationRef.current = null;
      setExportState(null);
    }
  };

  const cancelExport = async () => {
    const operationId = exportOperationRef.current;
    if (!operationId) return;
    try {
      await nativeBridge.call("cancelClipExport", { operationId });
    } catch (error) {
      onToast(error.message);
    }
  };

  const progressPercent = Math.round((exportState?.progress || 0) * 100);
  // Rectangle réellement occupé par l’image dans le lecteur (`object-fit: contain`).
  const pictureScale = Math.min(
    frameBox.width / Math.max(pictureRatio, 0.01),
    frameBox.height,
  ) || 0;
  const pictureStyle = {
    width: `${Math.round(pictureScale * pictureRatio)}px`,
    height: `${Math.round(pictureScale)}px`,
    "--watermark-scale": WATERMARK_PREVIEW_RATIO[watermark.size] || WATERMARK_PREVIEW_RATIO.medium,
    "--watermark-opacity": watermark.opacity,
    "--picture-height": `${Math.max(Math.round(pictureScale), 120)}px`,
  };

  return (
    <div className="studio" aria-label="Studio d’extraits">
      <div className="studio-bar">
        <div className="studio-title">
          <Scissors size={19} weight="bold" />
          <div>
            <strong>Studio d’extraits</strong>
            <span>{project?.title || "Aucun projet"} · découpe locale, aucun envoi</span>
          </div>
        </div>
        <button ref={closeButtonRef} type="button" className="studio-return" onClick={onClose}>
          <ArrowLeft size={16} /> Retour à l’analyse
        </button>
      </div>

      <div className="studio-body">
        <section className="studio-stage" aria-label="Aperçu de l’extrait">
          <div className="studio-viewer">
            {mediaSource ? (
              <div ref={frameRef} className="studio-frame">
                <video
                  ref={videoRef}
                  className="studio-video"
                  src={mediaSource}
                  muted={muted}
                  preload="metadata"
                  playsInline
                  onLoadedMetadata={(event) => {
                    const video = event.currentTarget;
                    if (video.videoWidth > 0 && video.videoHeight > 0) {
                      setPictureRatio(video.videoWidth / video.videoHeight);
                    }
                    video.currentTime = Math.min(currentTime, video.duration || currentTime);
                  }}
                  onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                />
                <div className="studio-picture" style={pictureStyle}>
                  {previewVisible && previewLines.length > 0 && (
                    <div className={`studio-watermark at-${watermark.position}`} aria-hidden="true">
                      {previewLines.map((line, index) => (
                        <span key={line + index} className={`watermark-line line-${index}`}>{line}</span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="studio-empty">
                <FilmStrip size={30} />
                <p>Ouvrez un film ou un épisode dans l’atelier d’analyse pour préparer des extraits.</p>
              </div>
            )}
          </div>

          <div className="studio-transport">
            <div className="studio-scrub">
              <span className="studio-clock">{formatTimecode(currentTime)}</span>
              <div className="studio-track">
                <input
                  type="range"
                  min={0}
                  max={Math.max(duration || 0, 0.1)}
                  step={step}
                  value={Math.min(currentTime, duration || currentTime)}
                  aria-label="Position de lecture"
                  onChange={(event) => seekTo(Number(event.target.value))}
                />
                {duration > 0 && (
                  <div
                    className="studio-selection"
                    style={{
                      left: `${Math.min(100, (range.start / duration) * 100)}%`,
                      width: `${Math.max(0.6, ((Math.max(range.end, range.start) - range.start) / duration) * 100)}%`,
                    }}
                  />
                )}
              </div>
              <span className="studio-clock muted">{formatTimecode(duration || 0)}</span>
            </div>

            <div className="studio-controls">
              <StudioButton label="Reculer d’une image" onClick={() => seekTo(currentTime - step)} disabled={!mediaSource}>
                <CaretLeft size={17} weight="bold" />
              </StudioButton>
              <StudioButton
                label={isPlaying ? "Pause" : "Lecture"}
                onClick={togglePlayback}
                disabled={!mediaSource}
                className="studio-play"
              >
                {isPlaying ? <Pause size={19} weight="fill" /> : <Play size={19} weight="fill" />}
              </StudioButton>
              <StudioButton label="Avancer d’une image" onClick={() => seekTo(currentTime + step)} disabled={!mediaSource}>
                <CaretRight size={17} weight="bold" />
              </StudioButton>
              <StudioButton label={muted ? "Rétablir le son" : "Couper le son"} onClick={() => setMuted((value) => !value)} active={muted}>
                {muted ? <SpeakerSlash size={18} /> : <SpeakerHigh size={18} />}
              </StudioButton>
              <span className="studio-separator" />
              <button type="button" className="studio-point" onClick={() => markPoint("a")} disabled={!mediaSource}>
                <MapPin size={15} weight="fill" /> Point A
              </button>
              <button type="button" className="studio-point" onClick={() => markPoint("b")} disabled={!mediaSource || kind === "still"}>
                <MapPin size={15} weight="fill" /> Point B
              </button>
              <StudioButton
                label={previewVisible ? "Masquer l’aperçu du filigrane" : "Afficher l’aperçu du filigrane"}
                onClick={() => setPreviewVisible((value) => !value)}
                active={previewVisible}
              >
                {previewVisible ? <Eye size={18} /> : <EyeSlash size={18} />}
              </StudioButton>
            </div>

            <div className="studio-range">
              <span><strong>A</strong> {formatTimecode(range.start)}</span>
              <span><strong>B</strong> {kind === "still" ? "—" : formatTimecode(range.end)}</span>
              <span className="studio-range-duration">
                {kind === "still" ? "Image fixe" : `Durée ${formatDuration(Math.max(0, range.end - range.start))}`}
              </span>
              {rangeMarkers.length > 0 && (
                <label className="studio-marker-pick">
                  Depuis un repère
                  <select value="" onChange={(event) => applyMarkerRange(event.target.value)}>
                    <option value="">Choisir…</option>
                    {rangeMarkers.slice(0, 200).map((marker) => (
                      <option key={marker.id} value={marker.id}>
                        {formatTimecode(marker.time)} — {String(marker.title || "Repère").slice(0, 60)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>

            {rangeIssue && <p className="studio-warning"><WarningCircle size={15} /> {rangeIssue}</p>}
          </div>

          <section className="studio-basket" aria-label="Panier d’extraits">
            <header>
              <strong><Package size={16} /> Panier</strong>
              <span>
                {basket.length}/{MAX_BASKET_ITEMS}
                {basket.length > 0 && ` · ${formatDuration(basketDuration(basket))} · ~${formatBytes(basketBytes)}`}
              </span>
            </header>
            {basket.length === 0 ? (
              <p className="studio-basket-empty">Placez un point A et un point B, puis ajoutez l’extrait au panier.</p>
            ) : (
              <ul>
                {basket.map((item) => (
                  <li key={item.id}>
                    <span className="basket-kind">
                      {item.kind === "still" ? <ImageIcon size={15} /> : <FilmStrip size={15} />}
                    </span>
                    <input
                      value={item.label}
                      maxLength={80}
                      placeholder={item.kind === "still" ? "Image sans titre" : "Extrait sans titre"}
                      aria-label="Nom de l’extrait"
                      onChange={(event) => onBasketChange(updateClipInBasket(basket, item.id, { label: event.target.value }))}
                    />
                    <span className="basket-time">
                      {formatTimecode(item.start)}
                      {item.kind === "clip" && ` → ${formatTimecode(item.end)}`}
                    </span>
                    <span className="basket-format">
                      {item.kind === "still" ? item.settings.stillFormat.toUpperCase() : item.settings.format.toUpperCase()}
                    </span>
                    <StudioButton label="Exporter cet élément" onClick={() => void runExport([item])} disabled={Boolean(exportState)}>
                      <DownloadSimple size={16} />
                    </StudioButton>
                    <StudioButton
                      label="Retirer du panier"
                      className="danger"
                      onClick={() => onBasketChange(removeClipFromBasket(basket, item.id))}
                      disabled={Boolean(exportState)}
                    >
                      <Trash size={16} />
                    </StudioButton>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </section>

        <aside className="studio-panel" aria-label="Réglages d’extraction">
          <div className="studio-panel-scroll">
            <SegmentedField
              legend="Type d’extrait"
              value={kind}
              options={[
                { value: "clip", label: "Extrait vidéo", detail: "Séquence continue entre A et B" },
                { value: "still", label: "Image fixe", detail: "Une seule image, au timecode exact" },
              ]}
              onChange={setKind}
            />

            {kind === "clip" ? (
              <>
                <SegmentedField
                  legend="Format"
                  value={safeSettings.format}
                  options={CLIP_FORMATS.map(({ value, label: name, detail }) => ({ value, label: name, detail }))}
                  onChange={(value) => updateSettings({ format: value })}
                />
                <SegmentedField
                  legend="Définition"
                  value={safeSettings.maxHeight}
                  options={CLIP_RESOLUTIONS}
                  onChange={(value) => updateSettings({ maxHeight: value })}
                />
                {safeSettings.format === "mp4" ? (
                  <>
                    <SegmentedField
                      legend="Qualité"
                      value={safeSettings.quality}
                      options={CLIP_QUALITIES}
                      onChange={(value) => updateSettings({ quality: value })}
                    />
                    <SegmentedField
                      legend="Découpe"
                      value={effectiveClipMode(safeSettings)}
                      options={CLIP_MODES}
                      onChange={(value) => updateSettings({ mode: value })}
                    />
                    <label className="studio-switch">
                      <input
                        type="checkbox"
                        checked={safeSettings.includeAudio}
                        onChange={(event) => updateSettings({ includeAudio: event.target.checked })}
                      />
                      <span><strong>Conserver le son</strong><small>Piste audio d’origine, ré-encodée en AAC</small></span>
                    </label>
                  </>
                ) : (
                  <SegmentedField
                    legend="Images par seconde"
                    value={safeSettings.gifFrameRate}
                    options={GIF_FRAME_RATES.map((value) => ({ value, label: `${value} i/s` }))}
                    onChange={(value) => updateSettings({ gifFrameRate: value })}
                  />
                )}
              </>
            ) : (
              <SegmentedField
                legend="Format d’image"
                value={safeSettings.stillFormat}
                options={STILL_FORMATS.map(({ value, label: name, detail }) => ({ value, label: name, detail }))}
                onChange={(value) => updateSettings({ stillFormat: value })}
              />
            )}

            <fieldset className="studio-field studio-watermark-field">
              <legend><Quotes size={13} weight="fill" /> Filigrane de citation</legend>
              <label className="studio-switch">
                <input
                  type="checkbox"
                  checked={watermark.enabled}
                  onChange={(event) => updateWatermark({ enabled: event.target.checked })}
                />
                <span>
                  <strong>Incruster la citation</strong>
                  <small>Désactivable à tout moment : l’extrait sort alors sans aucune surimpression.</small>
                </span>
              </label>

              {watermark.enabled && (
                <div className="studio-watermark-options">
                  <SegmentedField
                    legend="Texte"
                    value={watermark.source}
                    options={[
                      { value: "subtitle", label: "Sous-titre", detail: "Réplique lue dans la sélection" },
                      { value: "custom", label: "Personnalisé", detail: "Votre propre citation" },
                    ]}
                    onChange={(value) => updateWatermark({ source: value })}
                  />
                  {watermark.source === "custom" ? (
                    <label className="studio-text">
                      Citation
                      <textarea
                        rows={2}
                        maxLength={240}
                        value={watermark.citation}
                        placeholder="Ce n’est pas le mépris. C’est l’indifférence."
                        onChange={(event) => updateWatermark({ citation: event.target.value })}
                      />
                    </label>
                  ) : (
                    <p className="studio-detected">
                      {detectedCitation
                        ? `« ${detectedCitation} »`
                        : "Aucun sous-titre dans cette sélection. Chargez une piste ou passez en texte personnalisé."}
                    </p>
                  )}
                  <label className="studio-text">
                    Attribution
                    <input
                      value={watermark.attribution}
                      maxLength={120}
                      placeholder={attribution || "« Titre » · année"}
                      onChange={(event) => updateWatermark({ attribution: event.target.value })}
                    />
                  </label>
                  <SegmentedField
                    legend="Position"
                    value={watermark.position}
                    options={WATERMARK_POSITIONS}
                    onChange={(value) => updateWatermark({ position: value })}
                  />
                  <SegmentedField
                    legend="Taille"
                    value={watermark.size}
                    options={WATERMARK_SIZES}
                    onChange={(value) => updateWatermark({ size: value })}
                  />
                  <label className="studio-slider">
                    <span>Opacité <strong>{Math.round(watermark.opacity * 100)} %</strong></span>
                    <input
                      type="range"
                      min={0.2}
                      max={1}
                      step={0.05}
                      value={watermark.opacity}
                      onChange={(event) => updateWatermark({ opacity: Number(event.target.value) })}
                    />
                  </label>
                  <label className="studio-switch">
                    <input
                      type="checkbox"
                      checked={watermark.showTimecode}
                      onChange={(event) => updateWatermark({ showTimecode: event.target.checked })}
                    />
                    <span><strong>Afficher le timecode</strong><small>Utile pour citer précisément un plan</small></span>
                  </label>
                </div>
              )}
            </fieldset>

            <label className="studio-text">
              Nom de l’extrait
              <input
                value={label}
                maxLength={80}
                placeholder="ouverture, plan-sequence…"
                onChange={(event) => setLabel(event.target.value)}
              />
            </label>

            {!exportReady && (
              <p className="studio-warning">
                <WarningCircle size={15} />
                {nativeMode
                  ? "Le moteur média local est indisponible : relancez le build macOS pour réactiver l’export."
                  : "L’export d’extraits nécessite l’application macOS de Cinécrique."}
              </p>
            )}
          </div>

          <div className="studio-actions">
            <button
              type="button"
              className="studio-secondary"
              onClick={addToBasket}
              disabled={!mediaSource || Boolean(rangeIssue) || Boolean(exportState)}
            >
              <Plus size={16} /> Ajouter au panier
            </button>
            <button
              type="button"
              className="studio-primary"
              onClick={() => void runExport([draftClip])}
              disabled={!mediaSource || Boolean(rangeIssue) || Boolean(exportState)}
            >
              <DownloadSimple size={16} /> Exporter
            </button>
            <button
              type="button"
              className="studio-secondary"
              onClick={() => void runExport(basket)}
              disabled={!basket.length || Boolean(exportState)}
            >
              <Package size={16} /> Exporter le panier ({basket.length})
            </button>
            <p className="studio-note">
              <Check size={14} /> Découpe locale à partir du fichier d’origine. Aucun média ne quitte ce Mac.
            </p>
          </div>
        </aside>
      </div>

      {exportState && (
        <div className="studio-progress" role="status" aria-live="polite">
          <CircleNotch size={16} className="spin" />
          <div>
            <strong>{exportState.message}</strong>
            <div className="studio-progress-track"><i style={{ width: `${progressPercent}%` }} /></div>
          </div>
          <span>{progressPercent} %</span>
          {exportState.cancellable && (
            <button type="button" onClick={() => void cancelExport()}><X size={14} /> Annuler</button>
          )}
        </div>
      )}
    </div>
  );
}
