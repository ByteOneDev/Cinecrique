import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUUpLeft,
  ArrowUpRight,
  BookmarkSimple,
  CaretLeft,
  CaretRight,
  Check,
  Circle,
  Columns,
  CornersOut,
  DotsThree,
  DownloadSimple,
  FastForward,
  FileText,
  FilmStrip,
  FolderOpen,
  FrameCorners,
  Funnel,
  Image as ImageIcon,
  Images,
  Info,
  Keyboard,
  Key,
  LinkSimple,
  MagnifyingGlass,
  MapPin,
  Note,
  Pause,
  Play,
  Plus,
  Package,
  Rectangle,
  Rewind,
  SidebarSimple,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Subtitles,
  Trash,
  UploadSimple,
  X,
} from "@phosphor-icons/react";
import { metadataDuration, metadataFields, metadataFrameRate, parseSubtitles, projectDetail, subtitleAt } from "./media.js";
import { isNativeApp, nativeBridge } from "./native.js";
import { migratePersistedState } from "./project.js";
import { safeExternalURL } from "./security.js";
import { annotationLabel, moveAnnotation, updatePointLabel } from "./annotations.js";
import { buildTextExportFiles, defaultExportSelection, exportSelectionCount, safeExportBaseName } from "./export.js";
import { fountainCompletion, fountainContext } from "./fountain.js";
import {
  duplicateMarker,
  filterMarkers,
  markerIsRange,
  parseTimecode,
  removeMarker,
  timelineKeyboardTarget,
} from "./markers.js";

const FPS = 24;
const DURATION = 6180;
const INITIAL_TIME = 4354.75;

const initialProjects = [
  { id: "demo-le-mepris", title: "Le Mépris", detail: "1963 · 1h43", poster: "./assets/poster-coast.png" },
  { id: "demo-a-bout-de-souffle", title: "À bout de souffle", detail: "1960 · 1h30", poster: "./assets/poster-paris.png" },
  { id: "demo-hiroshima", title: "Hiroshima mon amour", detail: "1959 · 1h32", poster: "./assets/poster-rain.png" },
  { id: "demo-cleo", title: "Cléo de 5 à 7", detail: "1962 · 1h30", poster: "./assets/poster-paris.png" },
];

const initialMarkers = [
  { id: 1, time: 2712.29, title: "Camille regarde la mer. Scène d’ouverture.", detail: "Le regard ouvre l’espace avant le dialogue.", tag: "Ouverture", type: "note", color: "#d8a432", bookmarked: true },
  { id: 2, time: 3423.58, title: "Discussion sur le tournage d’Ulysse.", detail: "Le film dans le film déplace le conflit.", tag: "Contexte", type: "link", color: "#9f7ad2", url: "https://www.themoviedb.org/" },
  { id: 3, time: INITIAL_TIME, title: "L’indifférence du regard", detail: "Paul répond à Camille — indifférence.", tag: "Thème", type: "frame", color: "#e14f48", bookmarked: true },
  { id: 4, time: 3947.08, endTime: 3962.08, title: "Plans du film dans le film", detail: "La mise en abyme s’étend sur toute la discussion au studio.", tag: "Mise en abyme", type: "frame", color: "#4fbd7f" },
  { id: 5, time: 4702.42, title: "Camille quitte la villa.", detail: "La rupture devient mouvement.", tag: "Rupture", type: "note", color: "#d8a432" },
  { id: 6, time: 5108.67, title: "Silence entre Paul et Camille.", detail: "Le silence remplace le dialogue.", tag: "Sous-texte", type: "note", color: "#d8a432" },
  { id: 7, time: 5564.04, endTime: 5576.04, title: "Soirée mondaine — décalage.", detail: "Le conflit circule dans la durée de la scène.", tag: "Conflit", type: "link", color: "#9f7ad2", url: "https://www.themoviedb.org/" },
];

const initialScript = `INT. APPARTEMENT — JOUR

Camille, en maillot, est assise par terre près de la
fenêtre ouverte. La lumière de la Méditerranée inonde
la pièce.

Paul, debout, fume. Il la regarde sans la voir.

                         PAUL
             Ce n’est pas le mépris.
             C’est l’indifférence.

Camille lève les yeux. Un silence.

                       CAMILLE
                    Tu crois ?

                         PAUL
                       Je sais.

Il écrase sa cigarette dans un cendrier. Il s’approche
d’elle, mais s’arrête.

                     PAUL (CONT’D)
             On ne se parle plus. C’est tout.
             Le reste, ce sont des histoires
             qu’on se raconte.

Camille se détourne. Elle regarde la mer.

INT. APP`;

const initialAnnotations = {
  3: [
    { id: "arrow-1", type: "arrow", x1: 0.31, y1: 0.34, x2: 0.095, y2: 0.21 },
    { id: "point-1", type: "point", x: 0.57, y: 0.39, label: 1 },
  ],
};

const emptyDocument = () => ({
  markers: [],
  selectedMarkerId: null,
  annotationsByMarker: {},
  script: "INT. ",
  analysis: "",
  scene: 1,
  currentTime: 0,
  subtitleCues: [],
  subtitleName: "",
});

const initialDocument = () => ({
  markers: [...initialMarkers].sort((a, b) => a.time - b.time),
  selectedMarkerId: 3,
  annotationsByMarker: initialAnnotations,
  script: initialScript,
  analysis: "La distance entre Camille et Paul est déjà inscrite dans le cadre : l’architecture sépare les corps avant même que le dialogue ne confirme la rupture.\n\nLe bleu de la porte ouvre une issue visuelle que les personnages ne prennent jamais.",
  scene: 12,
  currentTime: INITIAL_TIME,
  subtitleCues: [],
  subtitleName: "",
});

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function vttTimestamp(value) {
  const milliseconds = Math.max(0, Math.round(Number(value || 0) * 1000));
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1000);
  const millis = milliseconds % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

function subtitlesAsVTT(cues) {
  if (!cues.length) return "";
  return `WEBVTT\n\n${cues.map((cue, index) => `${index + 1}\n${vttTimestamp(cue.start)} --> ${vttTimestamp(cue.end)}\n${cue.text}`).join("\n\n")}\n`;
}

const emptyFilters = () => ({ types: [], tags: [], bookmarkedOnly: false, from: "", to: "" });

const emptyDraft = () => ({
  type: "note",
  title: "",
  body: "",
  url: "",
  tag: "",
  kind: "point",
  startTimecode: "00:00:00:00",
  endTimecode: "00:00:05:00",
  bookmarked: false,
});

function secondsToTimecode(value, frameRate = FPS) {
  const seconds = Math.max(0, value);
  const nominalFrameRate = Math.max(1, Math.round(frameRate));
  const totalFrames = Math.round(seconds * nominalFrameRate);
  const whole = Math.floor(totalFrames / nominalFrameRate);
  const frames = totalFrames % nominalFrameRate;
  const hh = Math.floor(whole / 3600);
  const mm = Math.floor((whole % 3600) / 60);
  const ss = whole % 60;
  return [hh, mm, ss, frames].map((part) => String(part).padStart(2, "0")).join(":");
}

function markerIcon(type, size = 16) {
  if (type === "link") return <LinkSimple size={size} weight="bold" />;
  if (type === "frame") return <ImageIcon size={size} weight="bold" />;
  return <BookmarkSimple size={size} weight="fill" />;
}

function AnnotationCanvas({
  annotations,
  activeTool,
  selectedAnnotationId,
  onAdd,
  onOpenNote,
  onSelect,
  onUpdate,
  onDelete,
}) {
  const canvasRef = useRef(null);
  const [dragStart, setDragStart] = useState(null);
  const [moving, setMoving] = useState(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const host = canvas.parentElement;

    const draw = () => {
      const rect = host.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(rect.width * ratio);
      canvas.height = Math.round(rect.height * ratio);
      const context = canvas.getContext("2d");
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, rect.width, rect.height);

      annotations.forEach((annotation) => {
        const selected = annotation.id === selectedAnnotationId;
        const gold = selected ? "#70cbd1" : "#e8ad3c";
        context.lineWidth = selected ? 3 : 2;
        context.strokeStyle = gold;
        context.fillStyle = gold;
        context.lineCap = "round";
        context.lineJoin = "round";
        context.setLineDash([]);

        if (annotation.type === "arrow") {
          const x1 = annotation.x1 * rect.width;
          const y1 = annotation.y1 * rect.height;
          const x2 = annotation.x2 * rect.width;
          const y2 = annotation.y2 * rect.height;
          const angle = Math.atan2(y2 - y1, x2 - x1);
          const head = 12;
          context.beginPath();
          context.moveTo(x1, y1);
          context.lineTo(x2, y2);
          context.moveTo(x2, y2);
          context.lineTo(x2 - head * Math.cos(angle - Math.PI / 6), y2 - head * Math.sin(angle - Math.PI / 6));
          context.moveTo(x2, y2);
          context.lineTo(x2 - head * Math.cos(angle + Math.PI / 6), y2 - head * Math.sin(angle + Math.PI / 6));
          context.stroke();
          if (selected) {
            context.beginPath();
            context.arc(x1, y1, 4, 0, Math.PI * 2);
            context.arc(x2, y2, 4, 0, Math.PI * 2);
            context.fill();
          }
        }

        if (annotation.type === "rect") {
          context.setLineDash([6, 4]);
          context.strokeRect(
            annotation.x * rect.width,
            annotation.y * rect.height,
            annotation.width * rect.width,
            annotation.height * rect.height,
          );
          if (selected) {
            context.setLineDash([]);
            const x = annotation.x * rect.width;
            const y = annotation.y * rect.height;
            const width = annotation.width * rect.width;
            const height = annotation.height * rect.height;
            [[x, y], [x + width, y], [x, y + height], [x + width, y + height]].forEach(([handleX, handleY]) => {
              context.fillRect(handleX - 3, handleY - 3, 6, 6);
            });
          }
        }

        if (annotation.type === "point") {
          const x = annotation.x * rect.width;
          const y = annotation.y * rect.height;
          context.setLineDash([4, 3]);
          context.strokeStyle = gold;
          context.strokeRect(x - 20, y - 20, 40, 40);
          context.setLineDash([]);
          context.beginPath();
          context.arc(x, y, 15, 0, Math.PI * 2);
          context.fillStyle = "rgba(12, 15, 17, 0.88)";
          context.fill();
          context.strokeStyle = gold;
          context.stroke();
          context.fillStyle = gold;
          context.font = "600 13px ui-monospace, SFMono-Regular, Menlo, monospace";
          context.textAlign = "center";
          context.textBaseline = "middle";
          context.fillText(String(annotation.label || 1), x, y + 0.5);
        }
      });
    };

    const observer = new ResizeObserver(draw);
    observer.observe(host);
    draw();
    return () => observer.disconnect();
  }, [annotations, selectedAnnotationId]);

  const normalizedPoint = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
      y: clamp((event.clientY - rect.top) / rect.height, 0, 1),
    };
  };

  const hitTest = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    const distanceToSegment = (x1, y1, x2, y2) => {
      const lengthSquared = (x2 - x1) ** 2 + (y2 - y1) ** 2;
      if (!lengthSquared) return Math.hypot(px - x1, py - y1);
      const t = clamp(((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / lengthSquared, 0, 1);
      return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
    };

    return [...annotations].reverse().find((annotation) => {
      if (annotation.type === "point") {
        return Math.hypot(px - annotation.x * rect.width, py - annotation.y * rect.height) <= 24;
      }
      if (annotation.type === "rect") {
        const x = annotation.x * rect.width;
        const y = annotation.y * rect.height;
        return px >= x - 8 && px <= x + annotation.width * rect.width + 8
          && py >= y - 8 && py <= y + annotation.height * rect.height + 8;
      }
      if (annotation.type === "arrow") {
        return distanceToSegment(
          annotation.x1 * rect.width,
          annotation.y1 * rect.height,
          annotation.x2 * rect.width,
          annotation.y2 * rect.height,
        ) <= 12;
      }
      return false;
    }) || null;
  };

  const handlePointerDown = (event) => {
    const point = normalizedPoint(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    const hit = hitTest(event);
    if (hit) {
      onSelect(hit.id);
      setMoving({ start: point, original: hit });
      setDragStart(null);
      return;
    }
    onSelect(null);
    if (activeTool === "note") {
      onOpenNote(point);
      return;
    }
    if (activeTool === "point") {
      onAdd({ id: crypto.randomUUID(), type: "point", ...point, label: annotations.length + 1 });
      return;
    }
    setDragStart(point);
  };

  const handlePointerMove = (event) => {
    if (!moving) return;
    const point = normalizedPoint(event);
    onUpdate(moving.original.id, moveAnnotation(
      moving.original,
      point.x - moving.start.x,
      point.y - moving.start.y,
    ));
  };

  const handlePointerUp = (event) => {
    if (moving) {
      setMoving(null);
      return;
    }
    if (!dragStart || !["arrow", "rect"].includes(activeTool)) return;
    const end = normalizedPoint(event);
    if (activeTool === "arrow") {
      onAdd({ id: crypto.randomUUID(), type: "arrow", x1: dragStart.x, y1: dragStart.y, x2: end.x, y2: end.y });
    } else {
      onAdd({
        id: crypto.randomUUID(),
        type: "rect",
        x: Math.min(dragStart.x, end.x),
        y: Math.min(dragStart.y, end.y),
        width: Math.abs(end.x - dragStart.x),
        height: Math.abs(end.y - dragStart.y),
      });
    }
    setDragStart(null);
  };

  const handleKeyDown = (event) => {
    const selected = annotations.find((annotation) => annotation.id === selectedAnnotationId);
    if (!selected) return;
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      onDelete();
      return;
    }
    const movement = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    }[event.key];
    if (!movement) return;
    event.preventDefault();
    const step = event.shiftKey ? 0.05 : 0.01;
    onUpdate(selected.id, moveAnnotation(selected, movement[0] * step, movement[1] * step));
  };

  return (
    <canvas
      ref={canvasRef}
      className={`annotation-canvas tool-${activeTool}`}
      aria-label={`Zone d’annotation de l’image, ${annotations.length} annotation${annotations.length > 1 ? "s" : ""}`}
      aria-description="Sélectionnez une annotation puis utilisez les flèches pour la déplacer et Suppr pour l’effacer."
      data-annotation-count={annotations.length}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => { setDragStart(null); setMoving(null); }}
      onKeyDown={handleKeyDown}
    />
  );
}

function ScriptEditor({ value, onChange, onComplete, format, completionContext }) {
  const textareaRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const suggestion = format === "Fountain" ? fountainCompletion(value, completionContext) : "";
  const lineCount = value.split("\n").length;

  const handleKeyDown = (event) => {
    if (event.key !== "Tab") return;
    event.preventDefault();
    const textarea = textareaRef.current;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;

    if (suggestion && start === value.length && end === value.length) {
      const next = value + suggestion;
      onChange(next);
      onComplete();
      requestAnimationFrame(() => textarea.setSelectionRange(next.length, next.length));
      return;
    }

    const next = `${value.slice(0, start)}  ${value.slice(end)}`;
    onChange(next);
    requestAnimationFrame(() => textarea.setSelectionRange(start + 2, start + 2));
  };

  return (
    <div className="script-surface">
      <div className="line-numbers" style={{ transform: `translateY(${-scrollTop}px)` }} aria-hidden="true">
        {Array.from({ length: lineCount }, (_, index) => (
          <span key={index}>{index + 1}</span>
        ))}
      </div>
      <pre className="completion-layer" style={{ transform: `translateY(${-scrollTop}px)` }} aria-hidden="true">
        <span>{value}</span><b>{suggestion}</b>
      </pre>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        onFocus={(event) => {
          if (event.currentTarget.selectionStart === 0) {
            event.currentTarget.setSelectionRange(value.length, value.length);
          }
        }}
        spellCheck="false"
        maxLength={2_000_000}
        aria-label={format === "Fountain" ? "Éditeur de scénario Fountain avec autocomplétion" : "Éditeur Markdown"}
      />
      {suggestion && (
        <div className="completion-hint">
          <Keyboard size={15} />
          <span>Tab pour compléter</span>
        </div>
      )}
    </div>
  );
}

function ModalDialog({
  open,
  onClose,
  labelledBy,
  className,
  as: Element = "div",
  initialFocusRef,
  returnFocusRef: explicitReturnFocusRef,
  children,
  ...props
}) {
  const dialogRef = useRef(null);
  const capturedReturnFocusRef = useRef(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return undefined;
    capturedReturnFocusRef.current = explicitReturnFocusRef?.current || document.activeElement;
    const dialog = dialogRef.current;
    const focusableSelector = "button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex='-1'])";
    const focusInitial = () => {
      const target = initialFocusRef?.current || dialog?.querySelector(focusableSelector) || dialog;
      target?.focus();
    };
    const frame = requestAnimationFrame(focusInitial);
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = [...dialog.querySelectorAll(focusableSelector)];
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      capturedReturnFocusRef.current?.focus?.();
    };
  }, [explicitReturnFocusRef, initialFocusRef, open]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <Element
        ref={dialogRef}
        className={className}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        {...props}
      >
        {children}
      </Element>
    </div>
  );
}

function AppIconButton({ label, active = false, children, className = "", buttonRef, ...props }) {
  return (
    <button ref={buttonRef} className={`icon-button ${active ? "active" : ""} ${className}`} aria-label={label} title={label} {...props}>
      {children}
    </button>
  );
}

export function App() {
  const nativeMode = isNativeApp();
  const [projectList, setProjectList] = useState(initialProjects);
  const [selectedProject, setSelectedProject] = useState(0);
  const [documents, setDocuments] = useState({ "demo-le-mepris": initialDocument() });
  const [markers, setMarkers] = useState(() => [...initialMarkers].sort((a, b) => a.time - b.time));
  const [selectedMarkerId, setSelectedMarkerId] = useState(3);
  const [annotationsByMarker, setAnnotationsByMarker] = useState(initialAnnotations);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState(null);
  const [activeTool, setActiveTool] = useState("arrow");
  const [currentTime, setCurrentTime] = useState(INITIAL_TIME);
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeEditorTab, setActiveEditorTab] = useState("script");
  const [format, setFormat] = useState("Fountain");
  const [script, setScript] = useState(initialScript);
  const [analysis, setAnalysis] = useState("La distance entre Camille et Paul est déjà inscrite dans le cadre : l’architecture sépare les corps avant même que le dialogue ne confirme la rupture.\n\nLe bleu de la porte ouvre une issue visuelle que les personnages ne prennent jamais.");
  const [scene, setScene] = useState(12);
  const [leftPanel, setLeftPanel] = useState(57);
  const [projectRailCollapsed, setProjectRailCollapsed] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [layoutMenuOpen, setLayoutMenuOpen] = useState(false);
  const [metadataOpen, setMetadataOpen] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [noteAnchor, setNoteAnchor] = useState(null);
  const [editingMarkerId, setEditingMarkerId] = useState(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [search, setSearch] = useState("");
  const [markerFilters, setMarkerFilters] = useState(emptyFilters);
  const [filterOpen, setFilterOpen] = useState(false);
  const [markerMenuOpen, setMarkerMenuOpen] = useState(false);
  const [confirmation, setConfirmation] = useState(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportOptions, setExportOptions] = useState(defaultExportSelection);
  const [exporting, setExporting] = useState(false);
  const [toast, setToast] = useState("");
  const [mediaSource, setMediaSource] = useState("");
  const [mediaPath, setMediaPath] = useState("");
  const [duration, setDuration] = useState(DURATION);
  const [frameRate, setFrameRate] = useState(FPS);
  const [fileMetadata, setFileMetadata] = useState(null);
  const [subtitleCues, setSubtitleCues] = useState([]);
  const [subtitleName, setSubtitleName] = useState("");
  const [tmdbOpen, setTmdbOpen] = useState(false);
  const [tmdbConfigured, setTmdbConfigured] = useState(false);
  const [tmdbConfigMode, setTmdbConfigMode] = useState(false);
  const [tmdbToken, setTmdbToken] = useState("");
  const [tmdbLanguage, setTmdbLanguage] = useState("fr-FR");
  const [tmdbQuery, setTmdbQuery] = useState("");
  const [tmdbResults, setTmdbResults] = useState([]);
  const [tmdbLoading, setTmdbLoading] = useState(false);
  const [tmdbSearched, setTmdbSearched] = useState(false);
  const [tmdbError, setTmdbError] = useState("");
  const [hydrated, setHydrated] = useState(!nativeMode);
  const workspaceRef = useRef(null);
  const viewerRef = useRef(null);
  const fileInputRef = useRef(null);
  const projectInputRef = useRef(null);
  const videoRef = useRef(null);
  const persistenceTimerRef = useRef(null);
  const hydrationStartedRef = useRef(false);
  const composerTitleRef = useRef(null);
  const confirmationCancelRef = useRef(null);
  const tmdbInitialFocusRef = useRef(null);
  const exportInitialFocusRef = useRef(null);
  const markerMenuButtonRef = useRef(null);

  const activeProject = projectList[selectedProject] || projectList[0];
  const selectedMarker = markers.find((marker) => marker.id === selectedMarkerId) || markers[0] || {
    id: null,
    time: currentTime,
    title: "Aucun repère",
    detail: "Ajoutez une note à ce timecode.",
    tag: "",
    type: "note",
    color: "#6f7a80",
  };
  const annotations = selectedMarkerId == null ? [] : annotationsByMarker[selectedMarkerId] || [];
  const selectedAnnotation = annotations.find((annotation) => annotation.id === selectedAnnotationId) || null;
  const currentSubtitle = subtitleAt(subtitleCues, currentTime) || (!mediaSource ? "Ce n’est pas le mépris. C’est l’indifférence." : "");
  const metadataRows = metadataFields(fileMetadata, activeProject, subtitleName);
  const timelineDuration = Math.max(duration || DURATION, 1);
  const normalizedFilters = useMemo(() => ({
    ...markerFilters,
    from: markerFilters.from ? parseTimecode(markerFilters.from, frameRate) : null,
    to: markerFilters.to ? parseTimecode(markerFilters.to, frameRate) : null,
  }), [frameRate, markerFilters]);
  const visibleMarkers = useMemo(
    () => filterMarkers(markers, search, normalizedFilters),
    [markers, normalizedFilters, search],
  );
  const markerTags = useMemo(() => [...new Set(markers.map((marker) => marker.tag).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr")), [markers]);
  const hasActiveFilters = Boolean(
    search.trim()
      || markerFilters.types.length
      || markerFilters.tags.length
      || markerFilters.bookmarkedOnly
      || markerFilters.from
      || markerFilters.to,
  );
  const completionContext = useMemo(() => fountainContext(script, activeProject), [activeProject, script]);
  const annotatedFrames = useMemo(() => markers.flatMap((marker) => {
    const markerAnnotations = annotationsByMarker[marker.id] || [];
    return markerAnnotations.length ? [{ marker, annotations: markerAnnotations }] : [];
  }), [annotationsByMarker, markers]);
  const selectedExportCount = exportSelectionCount(exportOptions, annotatedFrames.length);

  const currentDocument = useMemo(() => ({
    markers,
    selectedMarkerId,
    annotationsByMarker,
    script,
    analysis,
    scene,
    currentTime,
    subtitleCues,
    subtitleName,
  }), [markers, selectedMarkerId, annotationsByMarker, script, analysis, scene, currentTime, subtitleCues, subtitleName]);

  const applyDocument = useCallback((document) => {
    const next = document || emptyDocument();
    setMarkers([...(next.markers || [])].sort((a, b) => a.time - b.time));
    setSelectedMarkerId(next.selectedMarkerId ?? next.markers?.[0]?.id ?? null);
    setAnnotationsByMarker(next.annotationsByMarker || {});
    setSelectedAnnotationId(null);
    setScript(typeof next.script === "string" ? next.script : "INT. ");
    setAnalysis(next.analysis || "");
    setScene(next.scene || 1);
    setCurrentTime(next.currentTime || 0);
    setSubtitleCues(next.subtitleCues || []);
    setSubtitleName(next.subtitleName || "");
    setIsPlaying(false);
  }, []);

  const applyPersistedEnvelope = useCallback((rawState) => {
    const importableState = {
      ...rawState,
      projects: Array.isArray(rawState?.projects)
        ? rawState.projects.filter((project) => !project?.path?.startsWith("browser:"))
        : rawState?.projects,
    };
    const migrated = migratePersistedState(importableState, (project) => metadataFrameRate(project.metadata, FPS));
    const nextProjects = migrated.projects.map((project) => ({
      ...project,
      mediaMissing: Boolean(project.path && !project.mediaURL),
    }));
    const nextIndex = Math.max(0, nextProjects.findIndex((project) => project.id === migrated.activeProjectId));
    const nextProject = nextProjects[nextIndex];
    setProjectList(nextProjects);
    setDocuments(migrated.documents);
    setSelectedProject(nextIndex);
    applyDocument(migrated.documents[nextProject.id] || emptyDocument());
    setMediaSource(nextProject.mediaURL || "");
    setMediaPath(nextProject.path || "");
    setFileMetadata(nextProject.metadata || null);
    setDuration(metadataDuration(nextProject.metadata, nextProject.path ? 1 : DURATION));
    setFrameRate(metadataFrameRate(nextProject.metadata, FPS));
    setLeftPanel(migrated.preferences.leftPanel);
    setFormat(migrated.preferences.format);
    setProjectRailCollapsed(migrated.preferences.projectRailCollapsed);
    setSearch("");
    setMarkerFilters(emptyFilters());
    if (rawState?._recoveredFromSnapshot) {
      setToast("La sauvegarde principale était corrompue. Le dernier snapshot valide a été restauré.");
    } else if (nextProject.mediaMissing) {
      setToast("Le média de ce projet a été déplacé. Vous pouvez le relier sans perdre l’analyse.");
    }
    return migrated;
  }, [applyDocument]);

  const seekTo = useCallback((nextTime) => {
    const value = clamp(nextTime, 0, duration || DURATION);
    if (videoRef.current) videoRef.current.currentTime = value;
    setCurrentTime(value);
  }, [duration]);

  const applyVideoResult = useCallback((result) => {
    if (!result || result.cancelled) return;
    if (result.error) {
      setToast(result.error);
      return;
    }
    if (!result.path) return;
    const id = `local:${result.path}`;
    const title = result.name.replace(/\.[^.]+$/, "");
    const newProject = {
      id,
      title,
      detail: projectDetail(result.metadata),
      poster: "./assets/poster-coast.png",
      path: result.path,
      mediaURL: result.mediaURL,
      mediaMissing: false,
      metadata: result.metadata || null,
      metadataError: result.metadataError || "",
    };

    if (activeProject?.id) {
      setDocuments((current) => ({ ...current, [activeProject.id]: currentDocument }));
    }

    const existingIndex = projectList.findIndex((project) => project.id === id);
    const nextProjects = existingIndex >= 0
      ? projectList.map((project, index) => index === existingIndex ? { ...project, ...newProject } : project)
      : [newProject, ...projectList];
    const nextIndex = existingIndex >= 0 ? existingIndex : 0;
    const nextDocument = documents[id] || emptyDocument();

    setProjectList(nextProjects);
    setSelectedProject(nextIndex);
    applyDocument(nextDocument);
    setMediaSource(result.mediaURL || "");
    setMediaPath(result.path);
    setFileMetadata(result.metadata || null);
    setDuration(metadataDuration(result.metadata, 1));
    setFrameRate(metadataFrameRate(result.metadata, FPS));
    setToast(`${result.name} ouvert localement`);
  }, [activeProject?.id, applyDocument, currentDocument, documents, projectList]);

  const applySubtitleResult = useCallback((result) => {
    if (!result || result.cancelled) return;
    if (result.error) {
      setToast(result.error);
      return;
    }
    const cues = parseSubtitles(result.content || "", result.name || "");
    setSubtitleCues(cues);
    setSubtitleName(result.name || "Sous-titres");
    setToast(`${cues.length} sous-titre${cues.length > 1 ? "s" : ""} chargé${cues.length > 1 ? "s" : ""}`);
  }, []);

  const importVideo = useCallback(async () => {
    if (!nativeMode) {
      fileInputRef.current?.click();
      return;
    }
    try {
      applyVideoResult(await nativeBridge.call("openVideo"));
    } catch (error) {
      setToast(error.message);
    }
  }, [applyVideoResult, nativeMode]);

  const importSubtitle = useCallback(async () => {
    if (!nativeMode) {
      setToast("L’import SRT/VTT est disponible dans l’application macOS.");
      return;
    }
    try {
      applySubtitleResult(await nativeBridge.call("openSubtitle"));
    } catch (error) {
      setToast(error.message);
    }
  }, [applySubtitleResult, nativeMode]);

  const relinkMedia = useCallback(async () => {
    if (!nativeMode || !activeProject?.id) return;
    try {
      const result = await nativeBridge.call("openVideo");
      if (!result || result.cancelled) return;
      if (result.error) throw new Error(result.error);
      const replacement = {
        ...activeProject,
        path: result.path,
        mediaURL: result.mediaURL,
        mediaMissing: false,
        metadata: result.metadata || activeProject.metadata || null,
        metadataError: result.metadataError || "",
      };
      setProjectList((current) => current.map((project) => project.id === activeProject.id ? replacement : project));
      setMediaSource(result.mediaURL || "");
      setMediaPath(result.path || "");
      setFileMetadata(replacement.metadata);
      setDuration(metadataDuration(replacement.metadata, 1));
      setFrameRate(metadataFrameRate(replacement.metadata, FPS));
      setToast("Média relié au projet");
    } catch (error) {
      setToast(error.message);
    }
  }, [activeProject, nativeMode]);

  const importProjectFile = useCallback(async (file) => {
    if (!file) return;
    if (file.size > 32 * 1_024 * 1_024) {
      setToast("Le projet dépasse la limite de 32 Mo.");
      return;
    }
    try {
      const state = JSON.parse(await file.text());
      applyPersistedEnvelope(state);
      setToast("Projet Cinécrique importé");
    } catch (error) {
      setToast(`Import impossible : ${error.message}`);
    }
  }, [applyPersistedEnvelope]);

  const importProject = useCallback(async () => {
    if (!nativeMode) {
      projectInputRef.current?.click();
      return;
    }
    try {
      const result = await nativeBridge.call("importProject");
      if (!result || result.cancelled) return;
      applyPersistedEnvelope(result.state);
      setToast(result.recovered ? "Projet importé et migré depuis un ancien format" : "Projet Cinécrique importé");
    } catch (error) {
      setToast(`Import impossible : ${error.message}`);
    }
  }, [applyPersistedEnvelope, nativeMode]);

  const openExternal = async (url) => {
    const safeURL = safeExternalURL(url);
    if (!safeURL) {
      setToast("Ce lien externe n’est pas autorisé.");
      return;
    }
    try {
      if (nativeMode) await nativeBridge.call("openExternal", { url: safeURL });
      else window.open(safeURL, "_blank", "noopener,noreferrer");
    } catch (error) {
      setToast(error.message);
    }
  };

  const openTMDB = async () => {
    if (!nativeMode) {
      setToast("L’enrichissement TMDB est disponible dans l’application macOS.");
      return;
    }
    setTmdbOpen(true);
    setTmdbQuery(activeProject?.tmdb?.title || activeProject?.title || "");
    setTmdbResults([]);
    setTmdbSearched(false);
    setTmdbError("");
    setTmdbLoading(true);
    try {
      const status = await nativeBridge.call("tmdbStatus");
      const configured = Boolean(status?.configured);
      setTmdbConfigured(configured);
      setTmdbConfigMode(!configured);
    } catch (error) {
      setTmdbError(error.message);
      setTmdbConfigMode(true);
    } finally {
      setTmdbLoading(false);
    }
  };

  const saveTMDBToken = async (event) => {
    event.preventDefault();
    if (!tmdbToken.trim()) return;
    setTmdbLoading(true);
    setTmdbError("");
    try {
      await nativeBridge.call("saveTMDBToken", { token: tmdbToken });
      setTmdbConfigured(true);
      setTmdbConfigMode(false);
      setTmdbToken("");
    } catch (error) {
      setTmdbError(error.message);
    } finally {
      setTmdbLoading(false);
    }
  };

  const searchTMDB = async (event) => {
    event.preventDefault();
    if (!tmdbQuery.trim()) return;
    setTmdbLoading(true);
    setTmdbError("");
    setTmdbSearched(true);
    try {
      const results = await nativeBridge.call("searchTMDB", {
        query: tmdbQuery.trim(),
        language: tmdbLanguage,
      });
      setTmdbResults(results || []);
    } catch (error) {
      setTmdbResults([]);
      setTmdbError(error.message);
    } finally {
      setTmdbLoading(false);
    }
  };

  const applyTMDBResult = async (result) => {
    setTmdbLoading(true);
    setTmdbError("");
    try {
      const details = await nativeBridge.call("tmdbDetails", {
        id: result.id,
        mediaType: result.mediaType,
        language: tmdbLanguage,
      });
      const runtime = Number(details.runtime) || 0;
      const runtimeLabel = runtime >= 60
        ? `${Math.floor(runtime / 60)}h${String(runtime % 60).padStart(2, "0")}`
        : runtime ? `${runtime} min` : "";
      const detail = [details.year, runtimeLabel].filter(Boolean).join(" · ");
      setProjectList((current) => current.map((project) => project.id === activeProject?.id ? {
        ...project,
        title: details.title || project.title,
        detail: detail || project.detail,
        tmdb: details,
      } : project));
      setTmdbOpen(false);
      setMetadataOpen(true);
      setToast(`Métadonnées TMDB enregistrées en ${tmdbLanguage}`);
    } catch (error) {
      setTmdbError(error.message);
    } finally {
      setTmdbLoading(false);
    }
  };

  const selectProjectAt = useCallback((index) => {
    const nextProject = projectList[index];
    if (!nextProject || nextProject.id === activeProject?.id) return;
    if (activeProject?.id) {
      setDocuments((current) => ({ ...current, [activeProject.id]: currentDocument }));
    }
    applyDocument(documents[nextProject.id] || (nextProject.id === "demo-le-mepris" ? initialDocument() : emptyDocument()));
    setSelectedProject(index);
    setMediaSource(nextProject.mediaURL || "");
    setMediaPath(nextProject.path || "");
    setFileMetadata(nextProject.metadata || null);
    setDuration(metadataDuration(nextProject.metadata, nextProject.path ? 1 : DURATION));
    setFrameRate(metadataFrameRate(nextProject.metadata, FPS));
    setToast(nextProject.mediaMissing ? "Média introuvable : reliez le fichier pour reprendre la lecture." : `${nextProject.title} ouvert`);
  }, [activeProject?.id, applyDocument, currentDocument, documents, projectList]);

  const persistedState = useMemo(() => ({
    version: 4,
    projects: projectList,
    activeProjectId: activeProject?.id || null,
    documents: activeProject?.id ? { ...documents, [activeProject.id]: currentDocument } : documents,
    preferences: { leftPanel, format, projectRailCollapsed },
  }), [activeProject?.id, currentDocument, documents, format, leftPanel, projectList, projectRailCollapsed]);

  const saveNow = useCallback(async () => {
    if (!hydrated) return;
    try {
      if (nativeMode) await nativeBridge.call("saveState", { state: persistedState });
      else localStorage.setItem("analyse-state", JSON.stringify(persistedState));
    } catch (error) {
      setToast(error.message);
    }
  }, [hydrated, nativeMode, persistedState]);

  useEffect(() => {
    if (!nativeMode || hydrationStartedRef.current) return undefined;
    hydrationStartedRef.current = true;
    let cancelled = false;

    nativeBridge.call("loadState")
      .then((state) => {
        if (cancelled || !state?.projects?.length) return;
        applyPersistedEnvelope(state);
      })
      .catch((error) => !cancelled && setToast(error.message))
      .finally(() => !cancelled && setHydrated(true));

    return () => { cancelled = true; };
  }, [applyPersistedEnvelope, nativeMode]);

  useEffect(() => {
    if (!hydrated) return undefined;
    window.clearTimeout(persistenceTimerRef.current);
    persistenceTimerRef.current = window.setTimeout(saveNow, 700);
    return () => window.clearTimeout(persistenceTimerRef.current);
  }, [hydrated, persistedState, saveNow]);

  useEffect(() => {
    if (!nativeMode) return undefined;
    const disposers = [
      nativeBridge.on("analyse:file-dropped", applyVideoResult),
      nativeBridge.on("analyse:subtitle-dropped", applySubtitleResult),
      nativeBridge.on("analyse:file-rejected", (detail) => setToast(detail?.message || "Fichier non pris en charge")),
      nativeBridge.on("analyse:open-video-requested", importVideo),
      nativeBridge.on("analyse:open-subtitle-requested", importSubtitle),
      nativeBridge.on("analyse:save-requested", () => {
        saveNow();
        setToast("Projet enregistré localement");
      }),
      nativeBridge.on("analyse:export-requested", () => setExportOpen(true)),
    ];
    return () => disposers.forEach((dispose) => dispose());
  }, [applySubtitleResult, applyVideoResult, importSubtitle, importVideo, nativeMode, saveNow]);

  useEffect(() => () => {
    if (mediaSource.startsWith("blob:")) URL.revokeObjectURL(mediaSource);
  }, [mediaSource]);

  useEffect(() => {
    if (!isPlaying || mediaSource) return undefined;
    const timer = window.setInterval(() => {
      setCurrentTime((time) => {
        if (time >= duration) {
          setIsPlaying(false);
          return duration;
        }
        return time + 0.1;
      });
    }, 100);
    return () => window.clearInterval(timer);
  }, [duration, isPlaying, mediaSource]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!resizing) return undefined;
    const move = (event) => {
      const rect = workspaceRef.current?.getBoundingClientRect();
      if (!rect) return;
      setLeftPanel(clamp(((event.clientX - rect.left) / rect.width) * 100, 43, 67));
    };
    const stop = () => setResizing(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
  }, [resizing]);

  const selectMarker = (marker) => {
    setSelectedMarkerId(marker.id);
    setSelectedAnnotationId(null);
    seekTo(marker.time);
    setIsPlaying(false);
  };

  const togglePlayback = async () => {
    const video = videoRef.current;
    if (!video) {
      setIsPlaying((playing) => !playing);
      return;
    }
    try {
      if (video.paused) await video.play();
      else video.pause();
    } catch (error) {
      setToast(`Lecture impossible : ${error.message}`);
    }
  };

  const stepBy = (delta) => {
    const next = currentTime + delta;
    videoRef.current?.pause();
    setIsPlaying(false);
    seekTo(next);
  };

  const addAnnotation = (annotation) => {
    const selected = markers.find((marker) => marker.id === selectedMarkerId);
    const frameTolerance = 0.5 / Math.max(frameRate, 1);
    const usesSelectedMarker = selected && Math.abs(selected.time - currentTime) <= frameTolerance;
    const markerId = usesSelectedMarker ? selected.id : crypto.randomUUID();

    if (!usesSelectedMarker) {
      const marker = {
        id: markerId,
        time: currentTime,
        title: "Annotation d’image",
        detail: "Annotation visuelle liée à cette image.",
        tag: "Image",
        type: "frame",
        color: "#4fbd7f",
      };
      setMarkers((current) => [...current, marker].sort((a, b) => a.time - b.time));
      setSelectedMarkerId(markerId);
    }

    setAnnotationsByMarker((current) => ({
      ...current,
      [markerId]: [...(current[markerId] || []), annotation],
    }));
    setSelectedAnnotationId(annotation.id);
    setToast("Annotation ajoutée à l’image");
  };

  const undoAnnotation = () => {
    setAnnotationsByMarker((current) => {
      const remaining = (current[selectedMarkerId] || []).slice(0, -1);
      if (!remaining.some((annotation) => annotation.id === selectedAnnotationId)) {
        setSelectedAnnotationId(null);
      }
      return { ...current, [selectedMarkerId]: remaining };
    });
  };

  const clearAnnotations = () => {
    setAnnotationsByMarker((current) => ({ ...current, [selectedMarkerId]: [] }));
    setSelectedAnnotationId(null);
    setToast("Annotations effacées");
  };

  const updateAnnotation = useCallback((annotationId, nextAnnotation) => {
    if (selectedMarkerId == null) return;
    setAnnotationsByMarker((current) => ({
      ...current,
      [selectedMarkerId]: (current[selectedMarkerId] || []).map((annotation) => (
        annotation.id === annotationId ? nextAnnotation : annotation
      )),
    }));
  }, [selectedMarkerId]);

  const deleteSelectedAnnotation = () => {
    if (selectedMarkerId == null || !selectedAnnotationId) return;
    setAnnotationsByMarker((current) => ({
      ...current,
      [selectedMarkerId]: (current[selectedMarkerId] || []).filter((annotation) => annotation.id !== selectedAnnotationId),
    }));
    setSelectedAnnotationId(null);
    setToast("Annotation supprimée");
  };

  const openComposer = (type = "note", anchor = null, marker = null) => {
    setEditingMarkerId(marker?.id ?? null);
    const start = Number(marker?.time ?? currentTime);
    const end = markerIsRange(marker) ? Number(marker.endTime) : Math.min(start + 5, timelineDuration);
    setDraft(marker ? {
      type: marker.type || type,
      title: marker.title || "",
      body: marker.detail || "",
      url: marker.url || "",
      tag: marker.tag || "",
      kind: markerIsRange(marker) ? "range" : "point",
      startTimecode: secondsToTimecode(start, frameRate),
      endTimecode: secondsToTimecode(end, frameRate),
      bookmarked: Boolean(marker.bookmarked),
    } : {
      ...emptyDraft(),
      type,
      startTimecode: secondsToTimecode(start, frameRate),
      endTimecode: secondsToTimecode(end, frameRate),
    });
    setNoteAnchor(anchor);
    setComposerOpen(true);
  };

  const saveNote = (event) => {
    event.preventDefault();
    if (!draft.title.trim()) return;
    const linkURL = draft.type === "link" ? safeExternalURL(draft.url) : "";
    if (draft.type === "link" && !linkURL) {
      setToast("Ajoutez un lien HTTP ou HTTPS valide.");
      return;
    }
    const startTime = parseTimecode(draft.startTimecode, frameRate);
    const endTime = draft.kind === "range" ? parseTimecode(draft.endTimecode, frameRate) : null;
    if (startTime == null || startTime > timelineDuration) {
      setToast("Le timecode de début est invalide.");
      return;
    }
    if (draft.kind === "range" && (endTime == null || endTime <= startTime || endTime > timelineDuration)) {
      setToast("La fin de plage doit être après le début et rester dans le média.");
      return;
    }
    const color = draft.type === "link" ? "#9f7ad2" : draft.type === "frame" ? "#4fbd7f" : "#d8a432";
    const selected = markers.find((marker) => marker.id === selectedMarkerId);
    const editedMarker = markers.find((marker) => marker.id === editingMarkerId);
    const frameTolerance = 0.5 / Math.max(frameRate, 1);
    const selectedIsAutomaticAnnotation = selected
      && selected.title === "Annotation d’image"
      && Math.abs(selected.time - currentTime) <= frameTolerance
      && (annotationsByMarker[selected.id] || []).length > 0;
    const id = editedMarker?.id ?? (selectedIsAutomaticAnnotation ? selected.id : crypto.randomUUID());
    const marker = {
      id,
      time: startTime,
      ...(draft.kind === "range" ? { endTime } : {}),
      title: draft.title.trim(),
      detail: draft.body.trim(),
      url: linkURL,
      tag: draft.tag.trim(),
      type: draft.type,
      color,
      bookmarked: Boolean(draft.bookmarked),
    };
    setMarkers((current) => (editedMarker || selectedIsAutomaticAnnotation
      ? current.map((item) => item.id === id ? marker : item)
      : [...current, marker]
    ).sort((a, b) => a.time - b.time));
    setSelectedMarkerId(id);
    seekTo(startTime);
    if (noteAnchor) {
      setAnnotationsByMarker((current) => ({
        ...current,
        [id]: [
          ...(current[id] || []),
          { id: crypto.randomUUID(), type: "point", ...noteAnchor, label: (current[id] || []).length + 1 },
        ],
      }));
    }
    setEditingMarkerId(null);
    setComposerOpen(false);
    setToast(editedMarker ? "Note mise à jour" : "Note liée au timecode");
  };

  const toggleMarkerBookmark = (markerId) => {
    if (markerId == null) return;
    setMarkers((current) => current.map((marker) => marker.id === markerId
      ? { ...marker, bookmarked: !marker.bookmarked }
      : marker));
  };

  const duplicateSelectedMarker = () => {
    if (selectedMarker.id == null) return;
    const id = crypto.randomUUID();
    const duplicate = duplicateMarker(selectedMarker, id, Math.max(1 / frameRate, 1));
    const duplicatedAnnotations = (annotationsByMarker[selectedMarker.id] || []).map((annotation) => ({
      ...annotation,
      id: crypto.randomUUID(),
    }));
    setMarkers((current) => [...current, duplicate].sort((a, b) => a.time - b.time));
    if (duplicatedAnnotations.length) {
      setAnnotationsByMarker((current) => ({ ...current, [id]: duplicatedAnnotations }));
    }
    setSelectedMarkerId(id);
    setSelectedAnnotationId(null);
    setMarkerMenuOpen(false);
    seekTo(duplicate.time);
    setToast("Repère dupliqué");
  };

  const requestMarkerDeletion = () => {
    if (selectedMarker.id == null) return;
    setMarkerMenuOpen(false);
    setConfirmation({
      title: "Supprimer le repère ?",
      message: `« ${selectedMarker.title} » et ses annotations seront supprimés.`,
      confirmLabel: "Supprimer",
      action: () => {
        const result = removeMarker(markers, annotationsByMarker, selectedMarker.id);
        const nextMarker = result.markers.find((marker) => marker.time >= selectedMarker.time) || result.markers.at(-1) || null;
        setMarkers(result.markers);
        setAnnotationsByMarker(result.annotationsByMarker);
        setSelectedMarkerId(nextMarker?.id ?? null);
        setSelectedAnnotationId(null);
        if (nextMarker) seekTo(nextMarker.time);
        setToast("Repère supprimé");
      },
    });
  };

  const resetMarkerFilters = () => {
    setSearch("");
    setMarkerFilters(emptyFilters());
  };

  const toggleFilterValue = (key, value) => {
    setMarkerFilters((current) => ({
      ...current,
      [key]: current[key].includes(value)
        ? current[key].filter((item) => item !== value)
        : [...current[key], value],
    }));
  };

  const performExport = async (event) => {
    event.preventDefault();
    if (!selectedExportCount) {
      setToast("Sélectionnez au moins un élément à exporter.");
      return;
    }
    const needsMedia = exportOptions.video || exportOptions.currentFrame || exportOptions.allFrames;
    if (needsMedia && (!mediaPath || activeProject?.mediaMissing)) {
      setToast("Reliez d’abord le média original pour exporter la vidéo ou des images.");
      return;
    }
    if (exportOptions.allFrames && !annotatedFrames.length) {
      setToast("Ce projet ne contient aucune image annotée.");
      return;
    }

    const files = buildTextExportFiles(exportOptions, {
      title: activeProject?.title,
      format,
      script,
      analysis,
      markers,
      subtitlesVTT: subtitlesAsVTT(subtitleCues),
      metadata: { file: fileMetadata, tmdb: activeProject?.tmdb || null },
      projectState: persistedState,
      formatTimecode: (time) => secondsToTimecode(time, frameRate),
    });
    const frameEntries = exportOptions.allFrames
      ? annotatedFrames
      : exportOptions.currentFrame
        ? [{ marker: selectedMarker.id == null ? { id: "current", time: currentTime } : selectedMarker, annotations }]
        : [];
    const frames = frameEntries.map(({ marker, annotations: frameAnnotations }, index) => ({
      name: `${safeExportBaseName(activeProject?.title)}-image-${String(index + 1).padStart(2, "0")}-${secondsToTimecode(marker.time, frameRate).replaceAll(":", "-")}.png`,
      time: marker.time,
      annotations: frameAnnotations,
    }));

    setExporting(true);
    try {
      if (nativeMode) {
        const result = await nativeBridge.call("exportSelection", {
          suggestedName: safeExportBaseName(activeProject?.title),
          files,
          includeVideo: exportOptions.video,
          mediaPath,
          frames,
        });
        if (result?.cancelled) return;
      } else {
        if (needsMedia) throw new Error("L’export vidéo et image nécessite l’application macOS.");
        files.forEach((file) => {
          const url = URL.createObjectURL(new Blob([file.content], { type: "text/plain;charset=utf-8" }));
          const anchor = document.createElement("a");
          anchor.href = url;
          anchor.download = file.name;
          anchor.click();
          URL.revokeObjectURL(url);
        });
      }
      setExportOpen(false);
      setToast(selectedExportCount > 1 ? "Archive d’export créée" : "Export terminé");
    } catch (error) {
      setToast(`Export impossible : ${error.message}`);
    } finally {
      setExporting(false);
    }
  };

  const importFile = (file) => {
    if (!file) return;
    const extension = file.name.split(".").pop()?.toLocaleLowerCase("fr") || "";
    const supported = ["mov", "mp4", "m4v", "mkv", "avi", "webm", "mpg", "mpeg", "ts", "m2ts"];
    if (!file.type.startsWith("video/") && !supported.includes(extension)) {
      setToast("Sélectionnez un fichier vidéo pris en charge.");
      return;
    }
    const objectURL = URL.createObjectURL(file);
    applyVideoResult({
      cancelled: false,
      name: file.name,
      path: `browser:${file.name}:${file.size}`,
      mediaURL: objectURL,
      metadata: null,
    });
  };

  const applyLayout = (value, label) => {
    setLeftPanel(value);
    setLayoutMenuOpen(false);
    setToast(`Disposition « ${label} » appliquée`);
  };

  return (
    <main
      className={`app-shell ${resizing ? "is-resizing" : ""}`}
      onDragOver={(event) => {
        if (!nativeMode) event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        if (nativeMode) return;
        importFile(event.dataTransfer.files?.[0]);
      }}
    >
      <header className="topbar">
        <div className="window-controls" aria-label="Contrôles de fenêtre">
          <span className="window-dot close" />
          <span className="window-dot minimize" />
          <span className="window-dot maximize" />
        </div>
        <div className="brand-lockup">
          <img className="brand-mark" src="./assets/cinecrique-mark.svg" alt="" />
          <div className="brand-copy">
            <strong>Cinécrique</strong>
            <span>{activeProject?.title || "Analyse locale"}</span>
          </div>
          <span className="offline-status"><i /> {nativeMode ? "Local macOS" : "Hors ligne"}</span>
        </div>
        <div className="topbar-actions">
          <label className="search-field">
            <MagnifyingGlass size={17} />
            <input aria-label="Rechercher dans les repères" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Rechercher" maxLength={200} />
          </label>
          <AppIconButton label="Importer un projet Cinécrique" onClick={importProject}><UploadSimple size={18} /></AppIconButton>
          <AppIconButton label="Exporter une sélection" onClick={() => setExportOpen(true)}><DownloadSimple size={18} /></AppIconButton>
          <AppIconButton label="Métadonnées" onClick={() => setMetadataOpen((open) => !open)} active={metadataOpen}>
            <Info size={19} />
          </AppIconButton>
          <div className="layout-control">
            <AppIconButton label="Modifier la disposition" onClick={() => setLayoutMenuOpen((open) => !open)} active={layoutMenuOpen}>
              <SlidersHorizontal size={20} />
            </AppIconButton>
            {layoutMenuOpen && (
              <div className="layout-menu">
                <button onClick={() => applyLayout(57, "Montage")}>Montage <Columns size={16} /></button>
                <button onClick={() => applyLayout(46, "Écriture")}>Écriture <SidebarSimple size={16} /></button>
                <button onClick={() => applyLayout(67, "Image")}>Image <FrameCorners size={16} /></button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className={`app-body ${projectRailCollapsed ? "rail-collapsed" : ""}`}>
        <aside className={`project-rail ${projectRailCollapsed ? "collapsed" : ""}`}>
          <div className="rail-heading">
            <span>Projets</span>
            <AppIconButton
              className="rail-toggle"
              label={projectRailCollapsed ? "Déployer les projets" : "Replier les projets"}
              aria-expanded={!projectRailCollapsed}
              onClick={() => setProjectRailCollapsed((collapsed) => !collapsed)}
            >
              {projectRailCollapsed ? <CaretRight size={15} /> : <CaretLeft size={15} />}
            </AppIconButton>
          </div>
          <nav aria-label="Analyses récentes">
            {projectList.map((project, index) => (
              <button
                key={project.id}
                className={`project-item ${selectedProject === index ? "selected" : ""}`}
                onClick={() => selectProjectAt(index)}
                title={project.title}
              >
                <img src={project.poster} alt="" />
                <span>{project.title}</span>
              </button>
            ))}
          </nav>
          <button className="import-button" onClick={importVideo} title="Importer un film">
            <Plus size={30} weight="light" />
            <span>Importer</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*,.mkv,.mov,.mp4"
            hidden
            onChange={(event) => importFile(event.target.files?.[0])}
          />
          <input
            ref={projectInputRef}
            type="file"
            accept="application/json,.json,.cinecrique.json"
            hidden
            onChange={(event) => { importProjectFile(event.target.files?.[0]); event.target.value = ""; }}
          />
        </aside>

        <section ref={workspaceRef} className="workspace" style={{ "--left-panel": `${leftPanel}%` }}>
          <section className="video-panel" aria-label="Lecteur et annotations">
            <div className="viewer-shell" ref={viewerRef}>
              {mediaSource ? (
                <video
                  ref={videoRef}
                  className="film-frame"
                  src={mediaSource}
                  preload="metadata"
                  playsInline
                  onLoadedMetadata={(event) => {
                    const video = event.currentTarget;
                    if (Number.isFinite(video.duration) && video.duration > 0) setDuration(video.duration);
                    video.currentTime = clamp(currentTime, 0, Number.isFinite(video.duration) ? video.duration : duration);
                  }}
                  onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  onEnded={() => setIsPlaying(false)}
                  onError={() => setToast("Le codec vidéo n’est pas lisible par WebKit sur ce Mac.")}
                />
              ) : (
                <img className="film-frame" src="./assets/mediterranean-frame.png" alt="Plan méditerranéen du film analysé" />
              )}
              <AnnotationCanvas
                annotations={annotations}
                activeTool={activeTool}
                selectedAnnotationId={selectedAnnotationId}
                onAdd={addAnnotation}
                onOpenNote={(point) => openComposer("frame", point)}
                onSelect={setSelectedAnnotationId}
                onUpdate={updateAnnotation}
                onDelete={deleteSelectedAnnotation}
              />
              {currentSubtitle && <div className="subtitle-banner">{currentSubtitle}</div>}
              {activeProject?.mediaMissing && (
                <div className="media-missing-banner" role="alert">
                  <FilmStrip size={19} />
                  <span><strong>Média introuvable</strong>Le fichier a été déplacé ou renommé.</span>
                  <button type="button" onClick={relinkMedia}><FolderOpen size={15} /> Relier</button>
                </div>
              )}
              <div className="frame-badge">{Math.round(frameRate * 100) / 100} i/s</div>
            </div>

            <div className="transport-area">
              <div className="transport-row">
                <time>{secondsToTimecode(currentTime, frameRate)}</time>
                <span className="play-state" aria-hidden="true" />
                <div className="transport-buttons">
                  <AppIconButton label="Plan précédent" onClick={() => stepBy(-10)}><SkipBack size={17} weight="fill" /></AppIconButton>
                  <AppIconButton label="Image précédente" onClick={() => stepBy(-1 / frameRate)}><Rewind size={17} weight="fill" /></AppIconButton>
                  <AppIconButton label={isPlaying ? "Pause" : "Lecture"} className="play-button" onClick={togglePlayback}>
                    {isPlaying ? <Pause size={18} weight="fill" /> : <Play size={18} weight="fill" />}
                  </AppIconButton>
                  <AppIconButton label="Image suivante" onClick={() => stepBy(1 / frameRate)}><FastForward size={17} weight="fill" /></AppIconButton>
                  <AppIconButton label="Plan suivant" onClick={() => stepBy(10)}><SkipForward size={17} weight="fill" /></AppIconButton>
                </div>
                <div className="transport-meta">
                  <AppIconButton label="Importer des sous-titres" onClick={importSubtitle}><Subtitles size={19} /></AppIconButton>
                  <AppIconButton label="Plein écran" onClick={() => viewerRef.current?.requestFullscreen?.()}><CornersOut size={19} /></AppIconButton>
                </div>
              </div>

              <div className="annotation-toolbar" aria-label="Outils d’annotation">
                <button className={activeTool === "note" ? "active" : ""} onClick={() => setActiveTool("note")} title="Ajouter une note à cet endroit"><Note size={17} /> <span>Note</span></button>
                <button className={activeTool === "arrow" ? "active" : ""} onClick={() => setActiveTool("arrow")} title="Tracer une flèche"><ArrowUpRight size={17} /> <span>Flèche</span></button>
                <button className={activeTool === "rect" ? "active" : ""} onClick={() => setActiveTool("rect")} title="Encadrer une zone"><Rectangle size={17} /> <span>Rectangle</span></button>
                <button className={activeTool === "point" ? "active" : ""} onClick={() => setActiveTool("point")} title="Placer un point"><Circle size={15} /> <span>Point</span></button>
                <span className="toolbar-separator" />
                <AppIconButton label="Annuler la dernière annotation" onClick={undoAnnotation} disabled={!annotations.length}><ArrowUUpLeft size={17} /></AppIconButton>
                <AppIconButton label="Supprimer l’annotation sélectionnée" onClick={deleteSelectedAnnotation} disabled={!selectedAnnotation}><X size={17} /></AppIconButton>
                <AppIconButton label="Effacer les annotations" onClick={clearAnnotations} disabled={!annotations.length}><Trash size={17} /></AppIconButton>
                {selectedAnnotation?.type === "point" && (
                  <label className="point-label-field">
                    <span>Libellé</span>
                    <input
                      type="number"
                      min="1"
                      max="999"
                      value={selectedAnnotation.label || 1}
                      onChange={(event) => updateAnnotation(selectedAnnotation.id, updatePointLabel(selectedAnnotation, event.target.value))}
                    />
                  </label>
                )}
              </div>
              {annotations.length > 0 && (
                <div className="annotation-list" aria-label="Annotations de l’image">
                  {annotations.map((annotation, index) => (
                    <button
                      key={annotation.id}
                      type="button"
                      className={annotation.id === selectedAnnotationId ? "selected" : ""}
                      aria-pressed={annotation.id === selectedAnnotationId}
                      onClick={() => setSelectedAnnotationId(annotation.id)}
                      onKeyDown={(event) => {
                        const movement = {
                          ArrowLeft: [-1, 0],
                          ArrowRight: [1, 0],
                          ArrowUp: [0, -1],
                          ArrowDown: [0, 1],
                        }[event.key];
                        if (!movement) return;
                        event.preventDefault();
                        const step = event.shiftKey ? 0.05 : 0.01;
                        updateAnnotation(annotation.id, moveAnnotation(annotation, movement[0] * step, movement[1] * step));
                      }}
                    >
                      <span>{index + 1}</span>{annotationLabel(annotation)}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="timeline-section">
              <div
                className="timeline-track"
                role="slider"
                aria-label="Position dans le film"
                aria-valuemin="0"
                aria-valuemax={timelineDuration}
                aria-valuenow={Math.round(currentTime * 1000) / 1000}
                aria-valuetext={secondsToTimecode(currentTime, frameRate)}
                tabIndex={0}
                onKeyDown={(event) => {
                  const target = timelineKeyboardTarget(event.key, currentTime, timelineDuration, frameRate);
                  if (target == null) return;
                  event.preventDefault();
                  seekTo(target);
                }}
                onClick={(event) => {
                  if (event.target.closest("button")) return;
                  const rect = event.currentTarget.getBoundingClientRect();
                  seekTo(clamp(((event.clientX - rect.left) / rect.width) * timelineDuration, 0, timelineDuration));
                }}
              >
                <div className="timeline-ruler" />
                {[0, 0.25, 0.5, 0.75, 1].map((position) => {
                  const time = position * timelineDuration;
                  return <span key={position} className="timeline-label" style={{ left: `${position * 100}%` }}>{secondsToTimecode(time, frameRate).slice(0, 8)}</span>;
                })}
                {visibleMarkers.map((marker) => (
                  <button
                    key={marker.id}
                    className={`timeline-marker ${markerIsRange(marker) ? "range" : ""} ${marker.bookmarked ? "bookmarked" : ""} ${marker.id === selectedMarkerId ? "selected" : ""}`}
                    style={{
                      left: `${clamp((marker.time / timelineDuration) * 100, 0, 100)}%`,
                      ...(markerIsRange(marker) ? { width: `${Math.max(((marker.endTime - marker.time) / timelineDuration) * 100, 0.5)}%` } : {}),
                      "--marker": marker.color,
                    }}
                    onClick={(event) => { event.stopPropagation(); selectMarker(marker); }}
                    aria-label={`${marker.title}, ${markerIsRange(marker) ? `plage de ${secondsToTimecode(marker.time, frameRate)} à ${secondsToTimecode(marker.endTime, frameRate)}` : secondsToTimecode(marker.time, frameRate)}${marker.bookmarked ? ", signet" : ""}`}
                    title={marker.title}
                  />
                ))}
                <span className="timeline-playhead" style={{ left: `${clamp((currentTime / timelineDuration) * 100, 0, 100)}%` }} />
              </div>

              <div className="marker-context">
                <span className="context-icon" style={{ color: selectedMarker.color }}>{markerIcon(selectedMarker.type, 17)}</span>
                <time>{secondsToTimecode(selectedMarker.time, frameRate)}{markerIsRange(selectedMarker) ? ` – ${secondsToTimecode(selectedMarker.endTime, frameRate)}` : ""}</time>
                <span className="context-dot" />
                <strong>{selectedMarker.title}</strong>
                <button onClick={() => toggleMarkerBookmark(selectedMarker.id)} aria-pressed={Boolean(selectedMarker.bookmarked)}><BookmarkSimple size={16} weight={selectedMarker.bookmarked ? "fill" : "regular"} /> {selectedMarker.bookmarked ? "Retirer le signet" : "Ajouter un signet"}</button>
                <button onClick={() => openComposer(selectedMarker.type, null, selectedMarker.id == null ? null : selectedMarker)}><Note size={16} /> Modifier</button>
                <button onClick={() => seekTo(selectedMarker.time)}><ImageIcon size={16} /> Voir l’image</button>
                {selectedMarker.url && <button onClick={() => openExternal(selectedMarker.url)}><LinkSimple size={16} /> Ouvrir le lien</button>}
              </div>
            </div>

            <section className="notes-panel">
              <div className="notes-heading">
                <button onClick={() => openComposer("note")}><Plus size={18} /> Ajouter une note</button>
                <div className="notes-actions">
                  <AppIconButton
                    label={markerFilters.bookmarkedOnly ? "Afficher tous les repères" : "Afficher seulement les signets"}
                    active={markerFilters.bookmarkedOnly}
                    aria-pressed={markerFilters.bookmarkedOnly}
                    onClick={() => setMarkerFilters((current) => ({ ...current, bookmarkedOnly: !current.bookmarkedOnly }))}
                  ><BookmarkSimple size={18} weight={markerFilters.bookmarkedOnly ? "fill" : "regular"} /></AppIconButton>
                  <AppIconButton
                    label="Filtrer les repères"
                    active={filterOpen || hasActiveFilters}
                    aria-expanded={filterOpen}
                    onClick={() => { setFilterOpen((open) => !open); setMarkerMenuOpen(false); }}
                  ><Funnel size={18} /></AppIconButton>
                  <AppIconButton
                    buttonRef={markerMenuButtonRef}
                    label="Plus d’options pour le repère sélectionné"
                    active={markerMenuOpen}
                    aria-expanded={markerMenuOpen}
                    disabled={selectedMarker.id == null}
                    onClick={() => { setMarkerMenuOpen((open) => !open); setFilterOpen(false); }}
                  ><DotsThree size={19} /></AppIconButton>
                  {filterOpen && (
                    <div className="marker-popover filter-popover" role="group" aria-label="Filtres des repères">
                      <div className="popover-heading"><strong>Filtres</strong><AppIconButton label="Fermer les filtres" onClick={() => setFilterOpen(false)}><X size={15} /></AppIconButton></div>
                      <fieldset>
                        <legend>Type</legend>
                        {[['note', 'Note'], ['link', 'Lien'], ['frame', 'Image']].map(([value, label]) => (
                          <label key={value}><input type="checkbox" checked={markerFilters.types.includes(value)} onChange={() => toggleFilterValue("types", value)} /> {label}</label>
                        ))}
                      </fieldset>
                      {markerTags.length > 0 && (
                        <fieldset className="tag-filters">
                          <legend>Tags</legend>
                          {markerTags.map((tag) => <label key={tag}><input type="checkbox" checked={markerFilters.tags.includes(tag)} onChange={() => toggleFilterValue("tags", tag)} /> {tag}</label>)}
                        </fieldset>
                      )}
                      <label className="favorite-filter"><input type="checkbox" checked={markerFilters.bookmarkedOnly} onChange={(event) => setMarkerFilters((current) => ({ ...current, bookmarkedOnly: event.target.checked }))} /> Signets uniquement</label>
                      <div className="time-filters">
                        <label>De<input aria-label="Filtrer à partir du timecode" value={markerFilters.from} onChange={(event) => setMarkerFilters((current) => ({ ...current, from: event.target.value }))} placeholder="00:00:00:00" /></label>
                        <label>À<input aria-label="Filtrer jusqu’au timecode" value={markerFilters.to} onChange={(event) => setMarkerFilters((current) => ({ ...current, to: event.target.value }))} placeholder="00:10:00:00" /></label>
                      </div>
                      <button className="reset-filters" type="button" onClick={resetMarkerFilters} disabled={!hasActiveFilters}>Réinitialiser les filtres</button>
                    </div>
                  )}
                  {markerMenuOpen && (
                    <div className="marker-popover marker-menu" role="menu">
                      <button role="menuitem" onClick={() => { setMarkerMenuOpen(false); openComposer(selectedMarker.type, null, selectedMarker); }}><Note size={16} /> Modifier</button>
                      <button role="menuitem" onClick={duplicateSelectedMarker}><Plus size={16} /> Dupliquer</button>
                      <button role="menuitem" className="danger" onClick={requestMarkerDeletion}><Trash size={16} /> Supprimer</button>
                    </div>
                  )}
                </div>
              </div>
              <div className="note-list">
                {visibleMarkers.map((marker) => (
                  <button key={marker.id} className={`note-row ${marker.id === selectedMarkerId ? "selected" : ""}`} onClick={() => selectMarker(marker)}>
                    <span className="note-type" style={{ color: marker.color }}>{markerIcon(marker.type)}{marker.bookmarked && <i title="Signet"><BookmarkSimple size={10} weight="fill" /></i>}</span>
                    <time>{secondsToTimecode(marker.time, frameRate)}{markerIsRange(marker) && <small>→ {secondsToTimecode(marker.endTime, frameRate)}</small>}</time>
                    <span className="note-copy">{marker.detail || marker.title}</span>
                    <span className="note-tag">{marker.tag}</span>
                  </button>
                ))}
                {!visibleMarkers.length && (
                  <div className="empty-notes">
                    <strong>Aucun repère ne correspond.</strong>
                    <span>La recherche et les filtres sont combinés.</span>
                    {hasActiveFilters && <button type="button" onClick={resetMarkerFilters}>Tout réinitialiser</button>}
                  </div>
                )}
              </div>
            </section>
          </section>

          <div className="panel-divider" onPointerDown={() => setResizing(true)} role="separator" aria-label="Redimensionner les panneaux">
            <span /><span /><span />
          </div>

          <section className="editor-panel" aria-label="Éditeur d’analyse et de scénario">
            <div className="editor-toolbar">
              <div className="segmented-control">
                <button className={activeEditorTab === "notes" ? "active" : ""} onClick={() => setActiveEditorTab("notes")}>Notes</button>
                <button className={activeEditorTab === "script" ? "active" : ""} onClick={() => setActiveEditorTab("script")}>Script</button>
              </div>
              <select value={format} onChange={(event) => setFormat(event.target.value)} aria-label="Format d’écriture">
                <option>Fountain</option>
                <option>Markdown</option>
              </select>
              <div className="scene-nav">
                <AppIconButton label="Scène précédente" onClick={() => setScene((value) => Math.max(1, value - 1))}><CaretLeft size={17} /></AppIconButton>
                <span>Scène {scene}<i className="scene-link-dot" title="Note liée à cette scène" /></span>
                <AppIconButton label="Scène suivante" onClick={() => setScene((value) => value + 1)}><CaretRight size={17} /></AppIconButton>
              </div>
            </div>

            {activeEditorTab === "script" ? (
              <ScriptEditor value={script} onChange={setScript} onComplete={() => setToast("Complétion acceptée avec Tab")} format={format} completionContext={completionContext} />
            ) : (
              <div className="analysis-surface">
                <div className="analysis-title"><Note size={18} /> Analyse de la scène</div>
                <textarea value={analysis} onChange={(event) => setAnalysis(event.target.value)} aria-label="Notes d’analyse en Markdown" maxLength={2_000_000} />
              </div>
            )}

            <footer className="editor-status">
              <span><BookmarkSimple size={15} weight="fill" /> Note liée : {selectedMarker.title}</span>
              <div>
                <span>{format}</span>
                <span>{script.length.toLocaleString("fr-FR")} caractères</span>
                <Check size={16} className="saved-check" />
              </div>
            </footer>
          </section>
        </section>
      </div>

      {metadataOpen && (
        <aside className="metadata-drawer">
          <div className="drawer-heading"><strong>Métadonnées</strong><AppIconButton label="Fermer" onClick={() => setMetadataOpen(false)}><X size={18} /></AppIconButton></div>
          <img src={activeProject?.poster || "./assets/poster-coast.png"} alt="Affiche du projet" />
          <h2>{activeProject?.title || "Projet local"}</h2>
          <p>{activeProject?.detail || "Analyse locale"}{mediaPath ? " · Fichier local" : " · France · 1963"}</p>
          {activeProject?.tmdb?.overview && <p className="tmdb-overview">{activeProject.tmdb.overview}</p>}
          <dl>
            {metadataRows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
          </dl>
          {mediaPath && nativeMode && <button className="drawer-action secondary" onClick={async () => {
            try {
              await nativeBridge.call("revealInFinder", { path: mediaPath });
            } catch (error) {
              setToast(error.message);
            }
          }}><FolderOpen size={16} /> Révéler dans le Finder</button>}
          {activeProject?.tmdb?.sourceURL && <button className="drawer-action secondary" onClick={() => openExternal(activeProject.tmdb.sourceURL)}><LinkSimple size={16} /> Voir la fiche TMDB</button>}
          <button className="drawer-action" onClick={openTMDB}>{activeProject?.tmdb ? "Actualiser via TMDB" : "Enrichir via TMDB"} <ArrowUpRight size={16} /></button>
          <span className="local-only"><Check size={15} /> Fichier et analyse stockés localement</span>
        </aside>
      )}

      <ModalDialog
        open={composerOpen}
        onClose={() => { setComposerOpen(false); setEditingMarkerId(null); }}
        labelledBy="marker-dialog-title"
        className="note-composer"
        as="form"
        initialFocusRef={composerTitleRef}
        onSubmit={saveNote}
      >
        <div className="composer-heading">
          <div><span>{draft.startTimecode}</span><h2 id="marker-dialog-title">{editingMarkerId ? "Modifier le repère" : "Ajouter un repère"}</h2></div>
          <AppIconButton label="Fermer" type="button" onClick={() => { setComposerOpen(false); setEditingMarkerId(null); }}><X size={19} /></AppIconButton>
        </div>
        <div className="type-picker" aria-label="Type de repère">
          <button type="button" className={draft.type === "note" ? "active" : ""} aria-pressed={draft.type === "note"} onClick={() => setDraft((value) => ({ ...value, type: "note" }))}><Note size={17} /> Note</button>
          <button type="button" className={draft.type === "link" ? "active" : ""} aria-pressed={draft.type === "link"} onClick={() => setDraft((value) => ({ ...value, type: "link" }))}><LinkSimple size={17} /> Lien</button>
          <button type="button" className={draft.type === "frame" ? "active" : ""} aria-pressed={draft.type === "frame"} onClick={() => setDraft((value) => ({ ...value, type: "frame" }))}><ImageIcon size={17} /> Image</button>
        </div>
        <label>Titre<input ref={composerTitleRef} required maxLength={200} value={draft.title} onChange={(event) => setDraft((value) => ({ ...value, title: event.target.value }))} placeholder="Ce que révèle ce plan…" /></label>
        <label>Contenu<textarea maxLength={20_000} value={draft.body} onChange={(event) => setDraft((value) => ({ ...value, body: event.target.value }))} placeholder="Décrivez l’intention, le cadre ou le jeu…" /></label>
        {draft.type === "link" && <label>URL<input type="url" required maxLength={4_096} value={draft.url} onChange={(event) => setDraft((value) => ({ ...value, url: event.target.value }))} placeholder="https://" /></label>}
        <label>Tag<input maxLength={80} value={draft.tag} onChange={(event) => setDraft((value) => ({ ...value, tag: event.target.value }))} placeholder="Thème, cadrage, montage…" /></label>
        <div className="scope-row"><span>Portée</span><div className="segmented-control"><button type="button" className={draft.kind === "point" ? "active" : ""} aria-pressed={draft.kind === "point"} onClick={() => setDraft((value) => ({ ...value, kind: "point" }))}>Point</button><button type="button" className={draft.kind === "range" ? "active" : ""} aria-pressed={draft.kind === "range"} onClick={() => setDraft((value) => ({ ...value, kind: "range" }))}>Plage</button></div></div>
        <div className="timecode-fields">
          <label>Début<input required value={draft.startTimecode} onChange={(event) => setDraft((value) => ({ ...value, startTimecode: event.target.value }))} placeholder="00:00:00:00" /></label>
          {draft.kind === "range" && <label>Fin<input required value={draft.endTimecode} onChange={(event) => setDraft((value) => ({ ...value, endTimecode: event.target.value }))} placeholder="00:00:05:00" /></label>}
        </div>
        <label className="bookmark-option"><input type="checkbox" checked={draft.bookmarked} onChange={(event) => setDraft((value) => ({ ...value, bookmarked: event.target.checked }))} /> Marquer comme signet</label>
        <div className="composer-actions"><button type="button" onClick={() => { setComposerOpen(false); setEditingMarkerId(null); }}>Annuler</button><button className="primary" type="submit">{editingMarkerId ? <Check size={17} /> : <Plus size={17} />} {editingMarkerId ? "Enregistrer" : "Ajouter à la timeline"}</button></div>
      </ModalDialog>

      <ModalDialog
        open={exportOpen}
        onClose={() => !exporting && setExportOpen(false)}
        labelledBy="export-dialog-title"
        className="export-dialog"
        as="form"
        initialFocusRef={exportInitialFocusRef}
        onSubmit={performExport}
      >
        <div className="composer-heading">
          <div><span>Export local</span><h2 id="export-dialog-title">Choisir les éléments</h2></div>
          <AppIconButton label="Fermer" type="button" disabled={exporting} onClick={() => setExportOpen(false)}><X size={19} /></AppIconButton>
        </div>
        <div className="export-groups">
          <fieldset>
            <legend>Écriture et analyse</legend>
            <label><FileText size={18} /><span><strong>Scénario</strong><small>{format === "Fountain" ? "Fichier .fountain" : "Fichier Markdown"}</small></span><input ref={exportInitialFocusRef} type="checkbox" checked={exportOptions.script} onChange={(event) => setExportOptions((current) => ({ ...current, script: event.target.checked }))} /></label>
            <label><Note size={18} /><span><strong>Analyse Markdown</strong><small>Notes libres de l’onglet Notes</small></span><input type="checkbox" checked={exportOptions.analysis} onChange={(event) => setExportOptions((current) => ({ ...current, analysis: event.target.checked }))} /></label>
            <label><BookmarkSimple size={18} /><span><strong>Repères timecodés</strong><small>Notes, plages, tags et liens</small></span><input type="checkbox" checked={exportOptions.markers} onChange={(event) => setExportOptions((current) => ({ ...current, markers: event.target.checked }))} /></label>
          </fieldset>
          <fieldset>
            <legend>Média</legend>
            <label className={!mediaPath || activeProject?.mediaMissing ? "disabled" : ""}><FilmStrip size={18} /><span><strong>Vidéo originale</strong><small>Copie intacte du fichier local</small></span><input type="checkbox" disabled={!mediaPath || activeProject?.mediaMissing} checked={exportOptions.video} onChange={(event) => setExportOptions((current) => ({ ...current, video: event.target.checked }))} /></label>
            <label className={!mediaPath || activeProject?.mediaMissing ? "disabled" : ""}><ImageIcon size={18} /><span><strong>Image actuelle annotée</strong><small>Image au timecode sélectionné</small></span><input type="checkbox" disabled={!mediaPath || activeProject?.mediaMissing} checked={exportOptions.currentFrame} onChange={(event) => setExportOptions((current) => ({ ...current, currentFrame: event.target.checked, allFrames: event.target.checked ? false : current.allFrames }))} /></label>
            <label className={!mediaPath || activeProject?.mediaMissing || !annotatedFrames.length ? "disabled" : ""}><Images size={18} /><span><strong>Toutes les images annotées</strong><small>{annotatedFrames.length} image{annotatedFrames.length > 1 ? "s" : ""}</small></span><input type="checkbox" disabled={!mediaPath || activeProject?.mediaMissing || !annotatedFrames.length} checked={exportOptions.allFrames} onChange={(event) => setExportOptions((current) => ({ ...current, allFrames: event.target.checked, currentFrame: event.target.checked ? false : current.currentFrame }))} /></label>
            <label><Subtitles size={18} /><span><strong>Sous-titres</strong><small>WebVTT avec timecodes</small></span><input type="checkbox" checked={exportOptions.subtitles} onChange={(event) => setExportOptions((current) => ({ ...current, subtitles: event.target.checked }))} /></label>
          </fieldset>
          <fieldset>
            <legend>Données</legend>
            <label><Info size={18} /><span><strong>Métadonnées</strong><small>Fichier média et fiche TMDB</small></span><input type="checkbox" checked={exportOptions.metadata} onChange={(event) => setExportOptions((current) => ({ ...current, metadata: event.target.checked }))} /></label>
            <label><Package size={18} /><span><strong>Projet complet</strong><small>Réimportable dans Cinécrique</small></span><input type="checkbox" checked={exportOptions.project} onChange={(event) => setExportOptions((current) => ({ ...current, project: event.target.checked }))} /></label>
          </fieldset>
        </div>
        <div className="export-footer">
          <span>{selectedExportCount} élément{selectedExportCount > 1 ? "s" : ""}{selectedExportCount > 1 ? " · archive ZIP" : ""}</span>
          <div className="composer-actions"><button type="button" disabled={exporting} onClick={() => setExportOpen(false)}>Annuler</button><button className="primary" type="submit" disabled={exporting || !selectedExportCount}><DownloadSimple size={17} /> {exporting ? "Export…" : "Exporter"}</button></div>
        </div>
      </ModalDialog>

      <ModalDialog
        open={Boolean(confirmation)}
        onClose={() => setConfirmation(null)}
        labelledBy="confirmation-title"
        className="confirmation-dialog"
        initialFocusRef={confirmationCancelRef}
        returnFocusRef={markerMenuButtonRef}
      >
        <div className="composer-heading">
          <div><span>Confirmation</span><h2 id="confirmation-title">{confirmation?.title}</h2></div>
          <AppIconButton label="Fermer" type="button" onClick={() => setConfirmation(null)}><X size={19} /></AppIconButton>
        </div>
        <p>{confirmation?.message}</p>
        <div className="composer-actions">
          <button ref={confirmationCancelRef} type="button" onClick={() => setConfirmation(null)}>Annuler</button>
          <button className="danger" type="button" onClick={() => { const action = confirmation?.action; setConfirmation(null); action?.(); }}><Trash size={16} /> {confirmation?.confirmLabel || "Confirmer"}</button>
        </div>
      </ModalDialog>

      <ModalDialog
        open={tmdbOpen}
        onClose={() => setTmdbOpen(false)}
        labelledBy="tmdb-dialog-title"
        className="tmdb-dialog"
        as="section"
        initialFocusRef={tmdbInitialFocusRef}
      >
            <div className="composer-heading">
              <div><span>TMDB</span><h2 id="tmdb-dialog-title">Métadonnées en ligne</h2></div>
              <AppIconButton label="Fermer" type="button" onClick={() => setTmdbOpen(false)}><X size={19} /></AppIconButton>
            </div>

            <div className="tmdb-language-row">
              <label>Langue
                <select value={tmdbLanguage} onChange={(event) => setTmdbLanguage(event.target.value)}>
                  <option value="fr-FR">Français</option>
                  <option value="en-US">English</option>
                  <option value="es-ES">Español</option>
                  <option value="de-DE">Deutsch</option>
                  <option value="it-IT">Italiano</option>
                </select>
              </label>
              {tmdbConfigured && !tmdbConfigMode && <button type="button" onClick={() => setTmdbConfigMode(true)}><Key size={15} /> Jeton</button>}
            </div>

            {tmdbConfigMode ? (
              <form className="tmdb-config" onSubmit={saveTMDBToken}>
                <label>Jeton API Read Access
                  <input
                    ref={tmdbInitialFocusRef}
                    type="password"
                    value={tmdbToken}
                    onChange={(event) => setTmdbToken(event.target.value)}
                    maxLength={4_096}
                    autoComplete="off"
                    placeholder="eyJhbGciOiJIUzI1NiJ9…"
                  />
                </label>
                <div className="composer-actions">
                  <button type="button" onClick={() => openExternal("https://www.themoviedb.org/settings/api")}>Compte TMDB <ArrowUpRight size={15} /></button>
                  <button className="primary" type="submit" disabled={tmdbLoading || !tmdbToken.trim()}><Key size={16} /> Enregistrer</button>
                </div>
              </form>
            ) : (
              <>
                <form className="tmdb-search" onSubmit={searchTMDB}>
                  <label>
                    <MagnifyingGlass size={17} />
                    <input ref={tmdbInitialFocusRef} aria-label="Titre à rechercher sur TMDB" value={tmdbQuery} onChange={(event) => setTmdbQuery(event.target.value)} placeholder="Titre du film ou de la série" maxLength={200} />
                  </label>
                  <button type="submit" disabled={tmdbLoading || !tmdbQuery.trim()}>{tmdbLoading ? "Recherche…" : "Rechercher"}</button>
                </form>
                <div className="tmdb-results">
                  {tmdbResults.map((result) => (
                    <button key={`${result.mediaType}-${result.id}`} type="button" onClick={() => applyTMDBResult(result)} disabled={tmdbLoading}>
                      <div><strong>{result.title}</strong><span>{result.mediaType === "tv" ? "Série" : "Film"}{result.year ? ` · ${result.year}` : ""}</span></div>
                      <p>{result.overview || result.originalTitle}</p>
                      <CaretRight size={17} />
                    </button>
                  ))}
                  {tmdbSearched && !tmdbLoading && !tmdbResults.length && !tmdbError && <div className="tmdb-empty">Aucun résultat.</div>}
                </div>
              </>
            )}
            {tmdbError && <div className="tmdb-error" role="alert">{tmdbError}</div>}
      </ModalDialog>

      {toast && <div className="toast" role="status"><Check size={16} weight="bold" /> {toast}</div>}
    </main>
  );
}
