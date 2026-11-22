import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUUpLeft,
  ArrowUp,
  ArrowUpRight,
  Check,
  Circle,
  FilmStrip,
  Note,
  PencilSimple,
  Play,
  Rectangle,
  Trash,
  X,
} from "@phosphor-icons/react";
import { AppIconButton } from "./ui.jsx";
import { splitNotes, removeNotesSegment, replaceNotesSegment, moveNotesSegment, updatePlanEmbedTitle } from "./notes.js";

function NotesText({ value, index, placeholder, onChange, onCaret }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.max(element.scrollHeight, 30)}px`;
  }, [value]);
  const report = (event) => onCaret(index, event.currentTarget.selectionStart);
  return (
    <textarea
      ref={ref}
      className="notes-text"
      value={value}
      rows={1}
      placeholder={placeholder}
      spellCheck="true"
      onChange={(event) => {
        onChange(index, event.target.value);
        onCaret(index, event.target.selectionStart);
      }}
      onSelect={report}
      onFocus={report}
      aria-label="Notes d’analyse en Markdown"
    />
  );
}

const TOOLS = [
  ["arrow", "Flèche", ArrowUpRight],
  ["rect", "Rectangle", Rectangle],
  ["point", "Point", Circle],
  ["pencil", "Crayon", PencilSimple],
];

function NotesPlanCard({
  segment,
  index,
  marker,
  annotations,
  frameAnnotations,
  loadFrame,
  formatTimecode,
  formatDuration,
  AnnotationCanvas,
  ReadonlyOverlay,
  canMoveUp,
  canMoveDown,
  onMove,
  onRemove,
  onRename,
  onSeek,
  onAddAnnotation,
  onUpdateAnnotation,
  onDeleteAnnotation,
}) {
  const time = marker ? Number(marker.time) : Number(segment.time) || 0;
  const [source, setSource] = useState("");
  const [editing, setEditing] = useState(false);
  const [tool, setTool] = useState("arrow");
  const [selectedId, setSelectedId] = useState(null);
  const [title, setTitle] = useState(marker?.title || segment.title);

  useEffect(() => setTitle(marker?.title || segment.title), [marker?.title, segment.title]);

  useEffect(() => {
    let cancelled = false;
    setSource("");
    void loadFrame(time).then((value) => {
      if (!cancelled) setSource(value || "");
    });
    return () => { cancelled = true; };
  }, [loadFrame, time]);

  const range = marker && Number(marker.endTime) > Number(marker.time);
  const selected = frameAnnotations.find((annotation) => annotation.id === selectedId) || null;

  return (
    <figure className={`notes-plan ${editing ? "editing" : ""} ${marker ? "" : "orphan"}`}>
      <header className="notes-plan-heading">
        <button type="button" className="notes-plan-time" onClick={() => onSeek(marker, time)} title="Voir ce plan dans le film">
          <Play size={12} weight="fill" /> {formatTimecode(time)}{range ? ` → ${formatTimecode(marker.endTime)}` : ""}
        </button>
        <input
          className="notes-plan-title"
          value={title}
          disabled={!marker}
          aria-label="Titre du plan"
          maxLength={200}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={() => {
            const next = title.trim();
            if (marker && next && next !== marker.title) onRename(index, marker, next);
            else setTitle(marker?.title || segment.title);
          }}
          onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
        />
        <div className="notes-plan-actions">
          <button
            type="button"
            className={editing ? "active" : ""}
            aria-pressed={editing}
            disabled={!marker}
            onClick={() => { setEditing((value) => !value); setSelectedId(null); }}
          >
            {editing ? <Check size={14} /> : <PencilSimple size={14} />} {editing ? "Terminé" : "Annoter"}
          </button>
          <AppIconButton label="Monter le plan" type="button" disabled={!canMoveUp} onClick={() => onMove(index, -1)}><ArrowUp size={14} /></AppIconButton>
          <AppIconButton label="Descendre le plan" type="button" disabled={!canMoveDown} onClick={() => onMove(index, 1)}><ArrowDown size={14} /></AppIconButton>
          <AppIconButton label="Retirer le plan des notes" type="button" onClick={() => onRemove(index)}><X size={14} /></AppIconButton>
        </div>
      </header>

      <div className="notes-plan-frame">
        {source ? <img src={source} alt={`${title}, ${formatTimecode(time)}`} draggable="false" /> : <div className="notes-plan-loading">Chargement de l’image…</div>}
        {source && (editing && marker ? (
          <AnnotationCanvas
            annotations={frameAnnotations}
            activeTool={tool}
            pencilWidth={4}
            selectedAnnotationId={selectedId}
            onAdd={(annotation) => { onAddAnnotation(marker, annotation); setSelectedId(annotation.id); }}
            onOpenNote={() => undefined}
            onSelect={setSelectedId}
            onUpdate={(annotationId, next) => onUpdateAnnotation(marker, annotationId, next)}
            onDelete={() => { if (selectedId) { onDeleteAnnotation(marker, selectedId); setSelectedId(null); } }}
          />
        ) : (
          <ReadonlyOverlay annotations={frameAnnotations} slot={`notes-${index}`} />
        ))}
      </div>

      {editing && marker && (
        <div className="notes-plan-tools" role="toolbar" aria-label="Annoter le plan">
          {TOOLS.map(([value, label, Icon]) => (
            <button key={value} type="button" className={tool === value ? "active" : ""} aria-pressed={tool === value} onClick={() => setTool(value)}>
              <Icon size={15} /> <span>{label}</span>
            </button>
          ))}
          <span className="toolbar-separator" />
          <AppIconButton
            label="Annuler la dernière annotation"
            type="button"
            disabled={!frameAnnotations.length}
            onClick={() => {
              const last = frameAnnotations.at(-1);
              if (last) onDeleteAnnotation(marker, last.id);
              setSelectedId(null);
            }}
          ><ArrowUUpLeft size={15} /></AppIconButton>
          <AppIconButton
            label="Supprimer l’annotation sélectionnée"
            type="button"
            disabled={!selected}
            onClick={() => { onDeleteAnnotation(marker, selectedId); setSelectedId(null); }}
          ><Trash size={15} /></AppIconButton>
        </div>
      )}

      <figcaption>
        {marker ? (
          <>
            {range && <span><FilmStrip size={13} /> {formatDuration(marker.endTime - marker.time)}</span>}
            {marker.tag && <span className="notes-plan-tag">{marker.tag}</span>}
            <span><Note size={13} /> {annotations.length} annotation{annotations.length > 1 ? "s" : ""}</span>
            {marker.detail && <q>{marker.detail}</q>}
          </>
        ) : (
          <span>Ce repère a été supprimé : l’image reste affichée depuis son timecode.</span>
        )}
      </figcaption>
    </figure>
  );
}

export function NotesEditor({
  value,
  onChange,
  markers,
  annotationsByMarker,
  annotationsForMarker,
  loadFrame,
  formatTimecode,
  formatDuration,
  AnnotationCanvas,
  ReadonlyOverlay,
  onCaretChange,
  onSeekPlan,
  onRenameMarker,
  onAddAnnotation,
  onUpdateAnnotation,
  onDeleteAnnotation,
  header,
}) {
  const segments = useMemo(() => splitNotes(value, { withSlots: true }), [value]);
  const markerById = useMemo(() => new Map((markers || []).map((marker) => [String(marker.id), marker])), [markers]);
  const planPositions = segments.map((segment, index) => (segment.type === "plan" ? index : -1)).filter((index) => index >= 0);

  const reportCaret = (index, caret) => {
    const segment = segments[index];
    if (!segment) return;
    onCaretChange?.(Math.min(segment.start + (Number(caret) || 0), value.length));
  };

  return (
    <div className="analysis-surface notes-editor">
      {header}
      <div className="notes-document">
        {segments.map((segment, index) => {
          if (segment.type === "text") {
            const isOnlySegment = segments.length === 1;
            return (
              <NotesText
                key={`text-${index}`}
                index={index}
                value={segment.text}
                placeholder={isOnlySegment ? "Écrivez votre analyse en Markdown… Insérez un plan pour l’annoter ici." : segment.virtual ? "…" : ""}
                onChange={(position, text) => onChange(replaceNotesSegment(segments, position, text))}
                onCaret={reportCaret}
              />
            );
          }
          const marker = markerById.get(segment.markerId) || null;
          const stored = marker ? annotationsByMarker?.[marker.id] || [] : [];
          const planIndex = planPositions.indexOf(index);
          return (
            <NotesPlanCard
              key={`plan-${index}-${segment.markerId}`}
              segment={segment}
              index={index}
              marker={marker}
              annotations={stored}
              frameAnnotations={marker ? annotationsForMarker(marker) : []}
              loadFrame={loadFrame}
              formatTimecode={formatTimecode}
              formatDuration={formatDuration}
              AnnotationCanvas={AnnotationCanvas}
              ReadonlyOverlay={ReadonlyOverlay}
              canMoveUp={planIndex > 0}
              canMoveDown={planIndex >= 0 && planIndex < planPositions.length - 1}
              onMove={(position, direction) => onChange(moveNotesSegment(segments, position, direction))}
              onRemove={(position) => onChange(removeNotesSegment(segments, position))}
              onRename={(position, target, title) => {
                onRenameMarker(target.id, title);
                onChange(updatePlanEmbedTitle(segments, position, title));
              }}
              onSeek={onSeekPlan}
              onAddAnnotation={onAddAnnotation}
              onUpdateAnnotation={onUpdateAnnotation}
              onDeleteAnnotation={onDeleteAnnotation}
            />
          );
        })}
      </div>
    </div>
  );
}
