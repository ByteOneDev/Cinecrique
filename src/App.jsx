import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ArrowCounterClockwise,
  ArrowDown,
  ArrowUUpLeft,
  ArrowUp,
  ArrowUpRight,
  ArrowsDownUp,
  BookmarkSimple,
  CaretLeft,
  CaretRight,
  CaretDown,
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
  PencilSimple,
  Play,
  Plus,
  Package,
  Rectangle,
  Repeat,
  Rewind,
  SidebarSimple,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  SpeakerHigh,
  SpeakerSlash,
  Subtitles,
  Trash,
  UploadSimple,
  X,
} from "@phosphor-icons/react";
import {
  VIDEO_EXTENSIONS,
  filterSubtitles,
  isSupportedVideoFile,
  mediaPlaybackIssue,
  metadataDuration,
  metadataFields,
  metadataFrameRate,
  parseSubtitles,
  projectDetail,
  subtitleAt,
  subtitleIndexAt,
  subtitleNoteDraft,
} from "./media.js";
import { isNativeApp, nativeBridge } from "./native.js";
import {
  migratePersistedState,
  moveProject,
  removeProject,
  renameProject,
  setProjectArchived,
} from "./project.js";
import { safeExternalURL } from "./security.js";
import { normalizeProjectCover, projectCoverImage, projectCoverText } from "./covers.js";
import {
  annotationLabel,
  annotationsAtTime,
  moveAnnotation,
  shiftAnnotationTimes,
  simplifyStroke,
  updatePointLabel,
} from "./annotations.js";
import {
  clampComparisonZoom,
  comparisonAnnotations,
  comparisonMarker,
  emptyComparison,
  normalizeComparison,
  pinComparison,
} from "./comparison.js";
import { buildTextExportFiles, defaultExportSelection, exportSelectionCount, safeExportBaseName } from "./export.js";
import {
  buildReportModel,
  defaultReportSelection,
  reportAnnotatedFrames,
  reportSelectionHasContent,
} from "./report.js";
import {
  fountainCompletion,
  fountainContext,
  fountainSceneIndexAtOffset,
  fountainScenes,
} from "./fountain.js";
import {
  duplicateMarker,
  filterMarkers,
  markerIsRange,
  removeMarker,
  timelineKeyboardTarget,
  timelinePointerTarget,
} from "./markers.js";
import {
  DEFAULT_SHORTCUTS,
  PLAYBACK_RATES,
  assignShortcut,
  loopBoundaryTarget,
  normalizeShortcuts,
  normalizeShortcutKey,
  normalizeTransport,
  resetLoop,
  setLoopEnd,
  setLoopStart,
  shortcutLabel,
  stepPlaybackRate,
  toggleLoop,
  transportShortcut,
} from "./transport.js";
import {
  DEFAULT_TIMECODE,
  TIMECODE_RATES,
  changeDropFrame,
  changeTimecodeRate,
  formatTimecode,
  formatTimecodeDuration,
  formatTimecodeOffset,
  normalizeTimecodeSettings,
  parseTimecode,
  parseTimecodeOffset,
  timecodeRate,
} from "./timecode.js";
import {
  SHOT_MOVEMENTS,
  SHOT_TYPES,
  filterAndSortShots,
  normalizeShot,
  shotRows,
  updateShotMarker,
} from "./shots.js";

const FPS = 24;
const DURATION = 6180;
const INITIAL_TIME = 4354.75;

const SHORTCUT_ROWS = [
  ["togglePlayback", "Lecture / pause", "Transport"],
  ["reverse", "Lecture arrière", "Navette"],
  ["pause", "Pause", "Navette"],
  ["forward", "Lecture avant", "Navette"],
  ["slower", "Ralentir", "Vitesse"],
  ["silent", "Lecture silencieuse", "Audio"],
  ["loopStart", "Définir A", "Boucle"],
  ["loopEnd", "Définir B", "Boucle"],
  ["mute", "Couper le son", "Audio"],
];

const initialProjects = [
  { id: "demo-le-mepris", title: "Le Mépris", detail: "1963 · 1h43", poster: "./assets/poster-coast.png" },
  { id: "demo-a-bout-de-souffle", title: "À bout de souffle", detail: "1960 · 1h30", poster: "./assets/poster-paris.png" },
  { id: "demo-hiroshima", title: "Hiroshima mon amour", detail: "1959 · 1h32", poster: "./assets/poster-rain.png" },
  { id: "demo-cleo", title: "Cléo de 5 à 7", detail: "1962 · 1h30", poster: "./assets/poster-paris.png" },
].map((project) => ({
  ...project,
  cover: { mode: "image", source: "bundled", value: project.poster },
  timecode: { ...DEFAULT_TIMECODE },
}));

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
    { id: "arrow-1", type: "arrow", time: INITIAL_TIME, x1: 0.31, y1: 0.34, x2: 0.095, y2: 0.21 },
    { id: "point-1", type: "point", time: INITIAL_TIME, x: 0.57, y: 0.39, label: 1 },
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
  transport: normalizeTransport(),
  comparison: emptyComparison(),
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
  transport: normalizeTransport(),
  comparison: emptyComparison(),
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

function markerIcon(type, size = 16) {
  if (type === "link") return <LinkSimple size={size} weight="bold" />;
  if (type === "frame") return <ImageIcon size={size} weight="bold" />;
  return <BookmarkSimple size={size} weight="fill" />;
}

function ProjectCover({ project, className = "", decorative = true }) {
  const cover = normalizeProjectCover(project?.cover, project?.poster);
  const image = projectCoverImage(project);
  const text = projectCoverText(project);
  return (
    <div className={`project-cover mode-${cover.mode} ${className}`} aria-label={decorative ? undefined : `Couverture de ${project?.title || "Projet"}`} aria-hidden={decorative || undefined}>
      {image && <img className="project-cover-image" src={image} alt="" />}
      {cover.mode === "text" && <span className={text.length > 28 ? "long" : ""}>{text}</span>}
      {cover.mode === "logo" && <img className="project-cover-logo" src="./assets/cinecrique-mark.svg" alt="" />}
    </div>
  );
}

function browserCoverDataURL(file) {
  return new Promise((resolve, reject) => {
    if (!file?.type?.startsWith("image/") || file.size > 20 * 1_024 * 1_024) {
      reject(new Error("Sélectionnez une image de moins de 20 Mo."));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Cette image ne peut pas être lue."));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("Cette image ne peut pas être décodée."));
      image.onload = () => {
        const scale = Math.min(1, 900 / image.naturalWidth, 1_350 / image.naturalHeight);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.8));
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function AnnotationCanvas({
  annotations,
  activeTool,
  pencilWidth,
  selectedAnnotationId,
  onAdd,
  onOpenNote,
  onSelect,
  onUpdate,
  onDelete,
}) {
  const canvasRef = useRef(null);
  const [draftAnnotation, setDraftAnnotation] = useState(null);
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

      const drawAnnotation = (annotation, isDraft = false) => {
        const selected = annotation.id === selectedAnnotationId;
        const gold = selected ? "#70cbd1" : "#e8ad3c";
        context.save();
        context.globalAlpha = isDraft ? 0.72 : 1;
        context.lineWidth = annotation.type === "pencil"
          ? Math.max(1, Number(annotation.width) || 4)
          : selected ? 3 : 2;
        context.strokeStyle = gold;
        context.fillStyle = gold;
        context.lineCap = "round";
        context.lineJoin = "round";
        context.setLineDash(isDraft ? [7, 5] : []);

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
          context.setLineDash(isDraft ? [7, 5] : [6, 4]);
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

        if (annotation.type === "pencil") {
          const points = Array.isArray(annotation.points) ? annotation.points : [];
          if (points.length) {
            context.beginPath();
            context.moveTo(points[0].x * rect.width, points[0].y * rect.height);
            points.slice(1).forEach((point) => context.lineTo(point.x * rect.width, point.y * rect.height));
            context.stroke();
          }
          if (selected && points.length) {
            const xs = points.map((point) => point.x * rect.width);
            const ys = points.map((point) => point.y * rect.height);
            const padding = 7;
            context.lineWidth = 1;
            context.setLineDash([4, 3]);
            context.strokeRect(
              Math.min(...xs) - padding,
              Math.min(...ys) - padding,
              Math.max(...xs) - Math.min(...xs) + padding * 2,
              Math.max(...ys) - Math.min(...ys) + padding * 2,
            );
          }
        }
        context.restore();
      };

      annotations.forEach((annotation) => drawAnnotation(annotation));
      if (draftAnnotation) drawAnnotation(draftAnnotation, true);
    };

    const observer = new ResizeObserver(draw);
    observer.observe(host);
    draw();
    return () => observer.disconnect();
  }, [annotations, draftAnnotation, selectedAnnotationId]);

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
      if (annotation.type === "pencil") {
        const points = Array.isArray(annotation.points) ? annotation.points : [];
        return points.some((point, index) => index > 0 && distanceToSegment(
          points[index - 1].x * rect.width,
          points[index - 1].y * rect.height,
          point.x * rect.width,
          point.y * rect.height,
        ) <= Math.max(10, (Number(annotation.width) || 4) / 2 + 5));
      }
      return false;
    }) || null;
  };

  const handlePointerDown = (event) => {
    if (event.button !== 0) return;
    const point = normalizedPoint(event);
    const hit = hitTest(event);
    if (hit) {
      event.currentTarget.setPointerCapture(event.pointerId);
      onSelect(hit.id);
      setMoving({ start: point, original: hit });
      setDraftAnnotation(null);
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
    event.currentTarget.setPointerCapture(event.pointerId);
    if (activeTool === "pencil") {
      setDraftAnnotation({ type: "pencil", points: [point], width: pencilWidth });
    } else if (activeTool === "arrow") {
      setDraftAnnotation({ type: "arrow", x1: point.x, y1: point.y, x2: point.x, y2: point.y });
    } else if (activeTool === "rect") {
      setDraftAnnotation({ type: "rect", x: point.x, y: point.y, width: 0, height: 0, origin: point });
    }
  };

  const handlePointerMove = (event) => {
    const point = normalizedPoint(event);
    if (moving) {
      onUpdate(moving.original.id, moveAnnotation(
        moving.original,
        point.x - moving.start.x,
        point.y - moving.start.y,
      ));
      return;
    }
    if (!draftAnnotation) return;
    setDraftAnnotation((current) => {
      if (!current) return current;
      if (current.type === "arrow") return { ...current, x2: point.x, y2: point.y };
      if (current.type === "rect") {
        return {
          ...current,
          x: Math.min(current.origin.x, point.x),
          y: Math.min(current.origin.y, point.y),
          width: Math.abs(point.x - current.origin.x),
          height: Math.abs(point.y - current.origin.y),
        };
      }
      if (current.type === "pencil") {
        const previous = current.points.at(-1);
        if (Math.hypot(point.x - previous.x, point.y - previous.y) < 0.0015) return current;
        return { ...current, points: [...current.points, point] };
      }
      return current;
    });
  };

  const handlePointerUp = (event) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (moving) {
      setMoving(null);
      return;
    }
    if (!draftAnnotation) return;
    const end = normalizedPoint(event);
    let committed = draftAnnotation.type === "arrow"
      ? { ...draftAnnotation, x2: end.x, y2: end.y }
      : draftAnnotation.type === "rect"
        ? {
          ...draftAnnotation,
          x: Math.min(draftAnnotation.origin.x, end.x),
          y: Math.min(draftAnnotation.origin.y, end.y),
          width: Math.abs(end.x - draftAnnotation.origin.x),
          height: Math.abs(end.y - draftAnnotation.origin.y),
        }
        : draftAnnotation.type === "pencil"
          ? { ...draftAnnotation, points: [...draftAnnotation.points, end] }
          : draftAnnotation;
    if (committed.type === "rect") {
      const { origin: _origin, ...rectangle } = committed;
      committed = rectangle;
      if (committed.width < 0.005 || committed.height < 0.005) committed = null;
    } else if (committed.type === "arrow") {
      if (Math.hypot(committed.x2 - committed.x1, committed.y2 - committed.y1) < 0.005) committed = null;
    } else if (committed.type === "pencil") {
      const points = simplifyStroke(committed.points);
      committed = points.length > 1 ? { ...committed, points } : null;
    }
    if (committed) onAdd({ ...committed, id: crypto.randomUUID() });
    setDraftAnnotation(null);
  };

  const handleKeyDown = (event) => {
    if (event.key === "Escape" && draftAnnotation) {
      event.preventDefault();
      setDraftAnnotation(null);
      return;
    }
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
      onPointerCancel={() => { setDraftAnnotation(null); setMoving(null); }}
      onKeyDown={handleKeyDown}
    />
  );
}

function ReadonlyAnnotationOverlay({ annotations, slot }) {
  return (
    <svg className="comparison-annotations" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
      {(annotations || []).map((annotation, index) => {
        const key = annotation.id || `${slot}-${index}`;
        if (annotation.type === "arrow") {
          const x1 = Number(annotation.x1) * 1000;
          const y1 = Number(annotation.y1) * 1000;
          const x2 = Number(annotation.x2) * 1000;
          const y2 = Number(annotation.y2) * 1000;
          const angle = Math.atan2(y2 - y1, x2 - x1);
          const head = 34;
          const left = `${x2 - head * Math.cos(angle - Math.PI / 6)},${y2 - head * Math.sin(angle - Math.PI / 6)}`;
          const right = `${x2 - head * Math.cos(angle + Math.PI / 6)},${y2 - head * Math.sin(angle + Math.PI / 6)}`;
          return <g key={key}><line x1={x1} y1={y1} x2={x2} y2={y2} /><polyline points={`${left} ${x2},${y2} ${right}`} /></g>;
        }
        if (annotation.type === "rect") {
          return <rect key={key} x={Number(annotation.x) * 1000} y={Number(annotation.y) * 1000} width={Number(annotation.width) * 1000} height={Number(annotation.height) * 1000} />;
        }
        if (annotation.type === "point") {
          const x = Number(annotation.x) * 1000;
          const y = Number(annotation.y) * 1000;
          return <g key={key}><circle cx={x} cy={y} r="30" /><text x={x} y={y}>{annotation.label || index + 1}</text></g>;
        }
        if (annotation.type === "pencil") {
          const points = (annotation.points || []).map((point) => `${Number(point.x) * 1000},${Number(point.y) * 1000}`).join(" ");
          return <polyline key={key} className="pencil" style={{ strokeWidth: Math.max(3, Number(annotation.width) * 2.5 || 10) }} points={points} />;
        }
        return null;
      })}
    </svg>
  );
}

function ComparisonFrameView({
  slot,
  reference,
  title,
  timecode,
  annotations,
  loadFrame,
  zoom,
  pan,
  onZoom,
  onPan,
}) {
  const [source, setSource] = useState("./assets/mediterranean-frame.png");
  const dragRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setSource("./assets/mediterranean-frame.png");
    void loadFrame(reference).then((next) => {
      if (!cancelled && next) setSource(next);
    });
    return () => { cancelled = true; };
  }, [loadFrame, reference]);

  const nudge = (x, y) => onPan({ x: pan.x + x, y: pan.y + y });
  return (
    <figure className="comparison-frame">
      <figcaption><span>Image {slot.toUpperCase()}</span><strong>{timecode}</strong><small>{title}</small></figcaption>
      <div
        className="comparison-viewport"
        role="group"
        aria-label={`Image ${slot.toUpperCase()}, utiliser les flèches pour déplacer et Origine pour recentrer`}
        tabIndex={0}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 40 : 16;
          if (event.key === "ArrowLeft") nudge(-step, 0);
          else if (event.key === "ArrowRight") nudge(step, 0);
          else if (event.key === "ArrowUp") nudge(0, -step);
          else if (event.key === "ArrowDown") nudge(0, step);
          else if (event.key === "Home") onPan({ x: 0, y: 0 });
          else return;
          event.preventDefault();
        }}
        onPointerDown={(event) => {
          dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, pan };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (!drag || drag.pointerId !== event.pointerId) return;
          onPan({ x: drag.pan.x + event.clientX - drag.x, y: drag.pan.y + event.clientY - drag.y });
        }}
        onPointerUp={(event) => {
          if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
          event.currentTarget.releasePointerCapture?.(event.pointerId);
        }}
      >
        <div className="comparison-layer" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
          <div className="comparison-media">
            <img src={source} alt={`${title}, ${timecode}`} draggable="false" />
            <ReadonlyAnnotationOverlay annotations={annotations} slot={slot} />
          </div>
        </div>
      </div>
      <div className="comparison-zoom">
        <span>Zoom</span>
        <input type="range" min="1" max="4" step="0.25" value={zoom} aria-label={`Zoom de l’image ${slot.toUpperCase()}`} onChange={(event) => onZoom(event.target.value)} />
        <output>{String(zoom).replace(".", ",")}×</output>
        <AppIconButton label={`Recentrer l’image ${slot.toUpperCase()}`} onClick={() => onPan({ x: 0, y: 0 })}><ArrowCounterClockwise size={15} /></AppIconButton>
      </div>
    </figure>
  );
}

function ScriptEditor({ value, onChange, onComplete, completionContext, selectionRequest, onSelectionChange }) {
  const textareaRef = useRef(null);
  const handledSelectionTokenRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const suggestion = fountainCompletion(value, completionContext);
  const lineCount = value.split("\n").length;

  useEffect(() => {
    if (!selectionRequest) return undefined;
    if (handledSelectionTokenRef.current === selectionRequest.token) return undefined;
    handledSelectionTokenRef.current = selectionRequest.token;
    const frame = requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      const start = clamp(selectionRequest.start, 0, value.length);
      const end = clamp(selectionRequest.end, start, value.length);
      textarea.focus();
      textarea.setSelectionRange(start, end);
      const line = value.slice(0, start).split("\n").length - 1;
      const lineHeight = Number.parseFloat(getComputedStyle(textarea).lineHeight) || 24;
      textarea.scrollTop = Math.max(0, line * lineHeight - textarea.clientHeight * 0.22);
      setScrollTop(textarea.scrollTop);
      onSelectionChange?.(start);
    });
    return () => cancelAnimationFrame(frame);
  }, [onSelectionChange, selectionRequest, value]);

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
        onSelect={(event) => onSelectionChange?.(event.currentTarget.selectionStart)}
        onFocus={(event) => {
          if (event.currentTarget.selectionStart === 0) {
            event.currentTarget.setSelectionRange(value.length, value.length);
          }
        }}
        spellCheck="false"
        maxLength={2_000_000}
        aria-label="Éditeur de scénario Fountain avec autocomplétion"
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

function TranscriptView({
  cues,
  filteredCues,
  activeIndex,
  query,
  onQueryChange,
  onSeek,
  onCreateNote,
  onImport,
  listRef,
  formatTimecode: formatCueTimecode,
}) {
  return (
    <section className="transcript-surface" aria-label="Transcription des dialogues">
      <div className="transcript-toolbar">
        <label>
          <MagnifyingGlass size={15} />
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            aria-label="Rechercher dans les dialogues"
            placeholder="Rechercher un dialogue"
            maxLength={200}
          />
        </label>
        <span>{cues.length} réplique{cues.length > 1 ? "s" : ""}</span>
      </div>
      {cues.length ? (
        <div ref={listRef} className="transcript-list">
          {filteredCues.map(({ cue, index }) => (
            <div key={`${cue.start}-${index}`} data-cue-index={index} className={`transcript-row ${index === activeIndex ? "active" : ""}`}>
              <button type="button" className="transcript-cue" onClick={() => onSeek(cue)}>
                <time>{formatCueTimecode(cue.start)}<small>→ {formatCueTimecode(cue.end)}</small></time>
                <span>{cue.text}</span>
              </button>
              <AppIconButton label={`Créer une note depuis la réplique ${index + 1}`} onClick={() => onCreateNote(cue)}><Note size={16} /></AppIconButton>
            </div>
          ))}
          {!filteredCues.length && (
            <div className="transcript-empty"><strong>Aucun dialogue trouvé.</strong><button type="button" onClick={() => onQueryChange("")}>Effacer la recherche</button></div>
          )}
        </div>
      ) : (
        <div className="transcript-empty">
          <Subtitles size={24} />
          <strong>Aucune transcription chargée.</strong>
          <span>Importez un fichier SRT, VTT, ASS ou SSA.</span>
          <button type="button" onClick={onImport}><UploadSimple size={15} /> Importer des sous-titres</button>
        </div>
      )}
    </section>
  );
}

function ShotThumbnail({ cacheKey, marker, load, fallback, alt }) {
  const rootRef = useRef(null);
  const [source, setSource] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const request = () => load(marker).then((value) => {
      if (!cancelled) setSource(value || fallback);
    }).catch(() => {
      if (!cancelled) setSource(fallback);
    });
    const element = rootRef.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      request();
      return () => { cancelled = true; };
    }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      request();
    }, { rootMargin: "120px" });
    observer.observe(element);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [cacheKey, fallback, load, marker]);

  return <div ref={rootRef} className="shot-thumbnail">{source ? <img src={source} alt={alt} /> : <span />}</div>;
}

function ShotTimeInput({ value, label, onCommit }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      className="shot-time-input"
      aria-label={label}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onBlur={() => onCommit(draft)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          setDraft(value);
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function PlansView({
  rows,
  allRows,
  query,
  onQueryChange,
  typeFilter,
  onTypeFilterChange,
  tagFilter,
  onTagFilterChange,
  sort,
  onSort,
  onSeek,
  onUpdateField,
  onUpdateTime,
  onCreateRange,
  onResetFilters,
  loadThumbnail,
  fallbackThumbnail,
  formatTimecode: formatPlanTimecode,
  formatDuration,
}) {
  const types = [...new Set(allRows.map((marker) => normalizeShot(marker.shot).shotType).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr"));
  const tags = [...new Set(allRows.map((marker) => marker.tag).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr"));
  const heading = (key, label) => (
    <button type="button" onClick={() => onSort(key)}>
      {label}{sort.key === key ? (sort.direction === "asc" ? " ↑" : " ↓") : ""}
    </button>
  );
  return (
    <section className="plans-surface" aria-label="Tableau des plans">
      <div className="plans-toolbar">
        <label><MagnifyingGlass size={15} /><input aria-label="Rechercher dans les plans" value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Rechercher un plan" /></label>
        <select aria-label="Filtrer par type de plan" value={typeFilter} onChange={(event) => onTypeFilterChange(event.target.value)}><option value="">Tous les types</option>{types.map((type) => <option key={type}>{type}</option>)}</select>
        <select aria-label="Filtrer par tag" value={tagFilter} onChange={(event) => onTagFilterChange(event.target.value)}><option value="">Tous les tags</option>{tags.map((tag) => <option key={tag}>{tag}</option>)}</select>
      </div>
      {allRows.length ? (
        rows.length ? (
          <div className="plans-table-wrap">
            <table className="plans-table">
              <thead><tr>
                <th>Miniature</th><th>{heading("start", "Début")}</th><th>{heading("end", "Fin")}</th><th>{heading("duration", "Durée")}</th><th>{heading("title", "Titre")}</th><th>{heading("shotType", "Type de plan")}</th><th>{heading("movement", "Mouvement")}</th><th>{heading("characters", "Personnages")}</th><th>{heading("sound", "Son")}</th><th>{heading("tag", "Tag")}</th><th>Commentaire</th>
              </tr></thead>
              <tbody>
                {rows.map((marker) => {
                  const shot = normalizeShot(marker.shot);
                  return (
                    <tr key={marker.id} onClick={() => onSeek(marker)} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") onSeek(marker); }}>
                      <td><ShotThumbnail cacheKey={`${marker.id}-${marker.time}`} marker={marker} load={loadThumbnail} fallback={fallbackThumbnail} alt={`Miniature de ${marker.title}`} /></td>
                      <td><ShotTimeInput value={formatPlanTimecode(marker.time)} label={`Début de ${marker.title}`} onCommit={(value) => onUpdateTime(marker, "time", value)} /></td>
                      <td><ShotTimeInput value={formatPlanTimecode(marker.endTime)} label={`Fin de ${marker.title}`} onCommit={(value) => onUpdateTime(marker, "endTime", value)} /></td>
                      <td><time>{formatDuration(marker.endTime - marker.time)}</time></td>
                      <td><input value={marker.title || ""} aria-label="Titre du plan" onClick={(event) => event.stopPropagation()} onChange={(event) => onUpdateField(marker.id, "title", event.target.value)} /></td>
                      <td><input list="shot-types" value={shot.shotType} aria-label="Type de plan" onClick={(event) => event.stopPropagation()} onChange={(event) => onUpdateField(marker.id, "shotType", event.target.value)} /></td>
                      <td><input list="shot-movements" value={shot.movement} aria-label="Mouvement de caméra" onClick={(event) => event.stopPropagation()} onChange={(event) => onUpdateField(marker.id, "movement", event.target.value)} /></td>
                      <td><input value={shot.characters} aria-label="Personnages du plan" onClick={(event) => event.stopPropagation()} onChange={(event) => onUpdateField(marker.id, "characters", event.target.value)} /></td>
                      <td><input value={shot.sound} aria-label="Son du plan" onClick={(event) => event.stopPropagation()} onChange={(event) => onUpdateField(marker.id, "sound", event.target.value)} /></td>
                      <td><input value={marker.tag || ""} aria-label="Tag du plan" onClick={(event) => event.stopPropagation()} onChange={(event) => onUpdateField(marker.id, "tag", event.target.value)} /></td>
                      <td><input value={marker.detail || ""} aria-label="Commentaire du plan" onClick={(event) => event.stopPropagation()} onChange={(event) => onUpdateField(marker.id, "comment", event.target.value)} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <datalist id="shot-types">{SHOT_TYPES.map((value) => <option key={value} value={value} />)}</datalist>
            <datalist id="shot-movements">{SHOT_MOVEMENTS.map((value) => <option key={value} value={value} />)}</datalist>
          </div>
        ) : (
          <div className="plans-empty"><strong>Aucun plan ne correspond.</strong><button type="button" onClick={onResetFilters}>Réinitialiser les filtres</button></div>
        )
      ) : (
        <div className="plans-empty"><FilmStrip size={24} /><strong>Aucun repère de plage.</strong><span>Créez une plage pour décrire un plan.</span><button type="button" onClick={onCreateRange}><Plus size={15} /> Créer un plan</button></div>
      )}
    </section>
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
  const [pencilWidth, setPencilWidth] = useState(4);
  const [timelineScrubbing, setTimelineScrubbing] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(INITIAL_TIME);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackDirection, setPlaybackDirection] = useState(0);
  const [silentPlayback, setSilentPlayback] = useState(false);
  const [transport, setTransport] = useState(() => normalizeTransport());
  const [loopMenuOpen, setLoopMenuOpen] = useState(false);
  const [comparisonMenuOpen, setComparisonMenuOpen] = useState(false);
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const [comparisonExporting, setComparisonExporting] = useState(false);
  const [comparison, setComparison] = useState(emptyComparison);
  const [comparisonZoom, setComparisonZoom] = useState({ a: 1, b: 1 });
  const [comparisonPan, setComparisonPan] = useState({ a: { x: 0, y: 0 }, b: { x: 0, y: 0 } });
  const [activeEditorTab, setActiveEditorTab] = useState("script");
  const [script, setScript] = useState(initialScript);
  const [analysis, setAnalysis] = useState("La distance entre Camille et Paul est déjà inscrite dans le cadre : l’architecture sépare les corps avant même que le dialogue ne confirme la rupture.\n\nLe bleu de la porte ouvre une issue visuelle que les personnages ne prennent jamais.");
  const [scene, setScene] = useState(1);
  const [sceneSelectionRequest, setSceneSelectionRequest] = useState(null);
  const [leftPanel, setLeftPanel] = useState(57);
  const [projectRailCollapsed, setProjectRailCollapsed] = useState(false);
  const [archivesOpen, setArchivesOpen] = useState(false);
  const [projectMenu, setProjectMenu] = useState(null);
  const [renamingProjectId, setRenamingProjectId] = useState(null);
  const [projectNameDraft, setProjectNameDraft] = useState("");
  const [coverEditorProjectId, setCoverEditorProjectId] = useState(null);
  const [coverDraft, setCoverDraft] = useState({ mode: "logo" });
  const [coverLoading, setCoverLoading] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [layoutMenuOpen, setLayoutMenuOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [shortcuts, setShortcuts] = useState(() => ({ ...DEFAULT_SHORTCUTS }));
  const [capturingShortcut, setCapturingShortcut] = useState(null);
  const [metadataOpen, setMetadataOpen] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [noteAnchor, setNoteAnchor] = useState(null);
  const [editingMarkerId, setEditingMarkerId] = useState(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [search, setSearch] = useState("");
  const [markerFilters, setMarkerFilters] = useState(emptyFilters);
  const [filterOpen, setFilterOpen] = useState(false);
  const [markerMenuOpen, setMarkerMenuOpen] = useState(false);
  const [historyActionsMarkerId, setHistoryActionsMarkerId] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportOptions, setExportOptions] = useState(defaultExportSelection);
  const [reportSelection, setReportSelection] = useState(defaultReportSelection);
  const [exporting, setExporting] = useState(false);
  const [toast, setToast] = useState("");
  const [mediaSource, setMediaSource] = useState("");
  const [mediaPath, setMediaPath] = useState("");
  const [mediaPlaybackError, setMediaPlaybackError] = useState("");
  const [duration, setDuration] = useState(DURATION);
  const [fileMetadata, setFileMetadata] = useState(null);
  const [timecodeOffsetDraft, setTimecodeOffsetDraft] = useState("00:00:00:00");
  const [subtitleCues, setSubtitleCues] = useState([]);
  const [subtitleName, setSubtitleName] = useState("");
  const [transcriptSearch, setTranscriptSearch] = useState("");
  const [shotQuery, setShotQuery] = useState("");
  const [shotTypeFilter, setShotTypeFilter] = useState("");
  const [shotTagFilter, setShotTagFilter] = useState("");
  const [shotSort, setShotSort] = useState({ key: "start", direction: "asc" });
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
  const playbackDirectionRef = useRef(0);
  const reverseFrameRef = useRef(null);
  const videoFrameCallbackRef = useRef(null);
  const loopMenuRef = useRef(null);
  const loopMenuButtonRef = useRef(null);
  const comparisonMenuRef = useRef(null);
  const comparisonMenuButtonRef = useRef(null);
  const comparisonInitialFocusRef = useRef(null);
  const timelineTrackRef = useRef(null);
  const transcriptListRef = useRef(null);
  const thumbnailCacheRef = useRef(new Map());
  const timelineScrubRef = useRef({ pointerId: null, frame: null, pending: null });
  const persistenceTimerRef = useRef(null);
  const hydrationStartedRef = useRef(false);
  const composerTitleRef = useRef(null);
  const confirmationCancelRef = useRef(null);
  const tmdbInitialFocusRef = useRef(null);
  const exportInitialFocusRef = useRef(null);
  const shortcutsInitialFocusRef = useRef(null);
  const markerMenuButtonRef = useRef(null);
  const projectMenuRef = useRef(null);
  const projectMenuButtonRef = useRef(null);
  const projectRenameInputRef = useRef(null);
  const coverInitialFocusRef = useRef(null);
  const coverFileInputRef = useRef(null);

  const activeProject = selectedProject >= 0 ? projectList[selectedProject] || null : null;
  const detectedFrameRate = metadataFrameRate(fileMetadata || activeProject?.metadata, FPS);
  const timecodeSettings = useMemo(
    () => normalizeTimecodeSettings(activeProject?.timecode, detectedFrameRate),
    [activeProject?.timecode, detectedFrameRate],
  );
  const frameRate = timecodeRate(timecodeSettings.rate).actual;
  const displayTimecode = useCallback(
    (value) => formatTimecode(value, timecodeSettings),
    [timecodeSettings],
  );
  const displayDuration = useCallback(
    (value) => formatTimecodeDuration(value, timecodeSettings),
    [timecodeSettings],
  );
  const activeProjectEntries = useMemo(() => projectList
    .map((project, index) => ({ project, index }))
    .filter(({ project }) => !project.archived), [projectList]);
  const archivedProjectEntries = useMemo(() => projectList
    .map((project, index) => ({ project, index }))
    .filter(({ project }) => project.archived), [projectList]);
  const projectMenuTarget = projectList.find((project) => project.id === projectMenu?.projectId) || null;
  const renamingProject = projectList.find((project) => project.id === renamingProjectId) || null;
  const coverEditorProject = projectList.find((project) => project.id === coverEditorProjectId) || null;
  const selectedMarker = markers.find((marker) => marker.id === selectedMarkerId) || markers[0] || {
    id: null,
    time: currentTime,
    title: "Aucun repère",
    detail: "Ajoutez une note à ce timecode.",
    tag: "",
    type: "note",
    color: "#6f7a80",
  };
  const storedAnnotations = selectedMarkerId == null ? [] : annotationsByMarker[selectedMarkerId] || [];
  const annotations = annotationsAtTime(storedAnnotations, currentTime, selectedMarker.time, frameRate);
  const selectedAnnotation = annotations.find((annotation) => annotation.id === selectedAnnotationId) || null;
  const currentSubtitle = subtitleAt(subtitleCues, currentTime) || (!mediaSource ? "Ce n’est pas le mépris. C’est l’indifférence." : "");
  const activeSubtitleIndex = subtitleIndexAt(subtitleCues, currentTime);
  const filteredSubtitleCues = useMemo(
    () => filterSubtitles(subtitleCues, transcriptSearch),
    [subtitleCues, transcriptSearch],
  );
  const planMarkers = useMemo(() => shotRows(markers), [markers]);
  const visiblePlanMarkers = useMemo(() => filterAndSortShots(markers, {
    query: shotQuery,
    type: shotTypeFilter,
    tag: shotTagFilter,
    sortKey: shotSort.key,
    direction: shotSort.direction,
  }), [markers, shotQuery, shotSort.direction, shotSort.key, shotTagFilter, shotTypeFilter]);
  const metadataRows = metadataFields(fileMetadata, activeProject, subtitleName);
  const timelineDuration = Math.max(duration || DURATION, 1);
  const normalizedFilters = useMemo(() => ({
    ...markerFilters,
    from: markerFilters.from ? parseTimecode(markerFilters.from, timecodeSettings) : null,
    to: markerFilters.to ? parseTimecode(markerFilters.to, timecodeSettings) : null,
  }), [markerFilters, timecodeSettings]);
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
  const scriptScenes = useMemo(() => fountainScenes(script), [script]);
  const annotatedFrames = useMemo(() => markers.flatMap((marker) => {
    const markerAnnotations = annotationsByMarker[marker.id] || [];
    return markerAnnotations.length ? [{ marker, annotations: markerAnnotations }] : [];
  }), [annotationsByMarker, markers]);
  const selectedReportFrames = useMemo(
    () => reportSelection.images
      ? reportAnnotatedFrames(annotatedFrames, reportSelection.imageMarkerIds)
      : [],
    [annotatedFrames, reportSelection.imageMarkerIds, reportSelection.images],
  );
  const comparisonMarkers = useMemo(() => ({
    a: comparisonMarker(markers, comparison.a),
    b: comparisonMarker(markers, comparison.b),
  }), [comparison.a, comparison.b, markers]);
  const comparisonFrameAnnotations = useMemo(() => ({
    a: annotationsAtTime(comparisonAnnotations(annotationsByMarker, comparison.a), comparison.a?.time, comparisonMarkers.a?.time, frameRate),
    b: annotationsAtTime(comparisonAnnotations(annotationsByMarker, comparison.b), comparison.b?.time, comparisonMarkers.b?.time, frameRate),
  }), [annotationsByMarker, comparison.a, comparison.b, comparisonMarkers.a?.time, comparisonMarkers.b?.time, frameRate]);
  const selectedExportCount = exportSelectionCount(exportOptions, annotatedFrames.length);
  const effectiveMuted = isMuted || silentPlayback || playbackDirection < 0;

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
    transport,
    comparison,
  }), [markers, selectedMarkerId, annotationsByMarker, script, analysis, scene, currentTime, subtitleCues, subtitleName, transport, comparison]);

  const applyDocument = useCallback((document) => {
    const next = document || emptyDocument();
    setMarkers([...(next.markers || [])].sort((a, b) => a.time - b.time));
    setSelectedMarkerId(next.selectedMarkerId ?? next.markers?.[0]?.id ?? null);
    setAnnotationsByMarker(next.annotationsByMarker || {});
    setSelectedAnnotationId(null);
    const nextScript = typeof next.script === "string" ? next.script : "INT. ";
    const nextScenes = fountainScenes(nextScript);
    setScript(nextScript);
    setAnalysis(next.analysis || "");
    setScene(clamp(Number(next.scene) || 1, 1, Math.max(1, nextScenes.length)));
    setSceneSelectionRequest(null);
    setCurrentTime(next.currentTime || 0);
    setSubtitleCues(next.subtitleCues || []);
    setSubtitleName(next.subtitleName || "");
    setTranscriptSearch("");
    setShotQuery("");
    setShotTypeFilter("");
    setShotTagFilter("");
    setShotSort({ key: "start", direction: "asc" });
    setHistoryActionsMarkerId(null);
    thumbnailCacheRef.current.clear();
    setTransport(normalizeTransport(next.transport));
    setComparison(normalizeComparison(next.comparison));
    setComparisonOpen(false);
    setComparisonMenuOpen(false);
    playbackDirectionRef.current = 0;
    setPlaybackDirection(0);
    setSilentPlayback(false);
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
    const nextIndex = migrated.activeProjectId == null
      ? -1
      : nextProjects.findIndex((project) => project.id === migrated.activeProjectId && !project.archived);
    const nextProject = nextIndex >= 0 ? nextProjects[nextIndex] : null;
    setProjectList(nextProjects);
    setDocuments(migrated.documents);
    setSelectedProject(nextIndex);
    applyDocument(nextProject ? migrated.documents[nextProject.id] || emptyDocument() : emptyDocument());
    setMediaSource(nextProject?.mediaURL || "");
    setMediaPath(nextProject?.path || "");
    setMediaPlaybackError("");
    setFileMetadata(nextProject?.metadata || null);
    setDuration(metadataDuration(nextProject?.metadata, nextProject?.path ? 1 : DURATION));
    setLeftPanel(migrated.preferences.leftPanel);
    setProjectRailCollapsed(migrated.preferences.projectRailCollapsed);
    setIsMuted(migrated.preferences.muted);
    setShortcuts(normalizeShortcuts(migrated.preferences.shortcuts));
    setSearch("");
    setMarkerFilters(emptyFilters());
    if (rawState?._recoveredFromSnapshot) {
      setToast("La sauvegarde principale était corrompue. Le dernier snapshot valide a été restauré.");
    } else if (nextProject?.mediaMissing) {
      setToast("Le média de ce projet a été déplacé. Vous pouvez le relier sans perdre l’analyse.");
    }
    return migrated;
  }, [applyDocument]);

  const seekTo = useCallback((nextTime) => {
    const value = clamp(nextTime, 0, duration || DURATION);
    if (videoRef.current) videoRef.current.currentTime = value;
    setCurrentTime(value);
  }, [duration]);

  const toggleMute = useCallback(() => {
    setIsMuted((muted) => {
      setToast(muted ? "Son rétabli" : "Son coupé");
      return !muted;
    });
  }, []);

  const pauseTransport = useCallback(() => {
    playbackDirectionRef.current = 0;
    setPlaybackDirection(0);
    setIsPlaying(false);
    videoRef.current?.pause();
  }, []);

  const applyPlaybackRate = useCallback((rate) => {
    const nextRate = PLAYBACK_RATES.includes(Number(rate)) ? Number(rate) : 1;
    setTransport((current) => ({ ...normalizeTransport(current), playbackRate: nextRate }));
    if (videoRef.current) videoRef.current.playbackRate = nextRate;
    return nextRate;
  }, []);

  const playForward = useCallback(async (accelerate = false) => {
    const nextRate = accelerate && playbackDirectionRef.current === 1 && isPlaying
      ? stepPlaybackRate(transport.playbackRate, 1)
      : transport.playbackRate;
    applyPlaybackRate(nextRate);
    playbackDirectionRef.current = 1;
    setPlaybackDirection(1);
    setIsPlaying(true);
    const video = videoRef.current;
    if (!video) return;
    try {
      video.playbackRate = nextRate;
      await video.play();
    } catch (error) {
      pauseTransport();
      setToast(`Lecture impossible : ${error.message}`);
    }
  }, [applyPlaybackRate, isPlaying, pauseTransport, transport.playbackRate]);

  const playReverse = useCallback(() => {
    const nextRate = playbackDirectionRef.current === -1 && isPlaying
      ? stepPlaybackRate(transport.playbackRate, 1)
      : transport.playbackRate;
    applyPlaybackRate(nextRate);
    playbackDirectionRef.current = -1;
    setPlaybackDirection(-1);
    videoRef.current?.pause();
    setIsPlaying(true);
  }, [applyPlaybackRate, isPlaying, transport.playbackRate]);

  const togglePlayback = useCallback(() => {
    if (isPlaying) pauseTransport();
    else void playForward(false);
  }, [isPlaying, pauseTransport, playForward]);

  const slowPlayback = useCallback(() => {
    const nextRate = stepPlaybackRate(transport.playbackRate, -1);
    applyPlaybackRate(nextRate);
    setToast(`Vitesse ${String(nextRate).replace(".", ",")}×`);
  }, [applyPlaybackRate, transport.playbackRate]);

  const toggleSilentPlayback = useCallback(() => {
    const enabling = !silentPlayback;
    setSilentPlayback(enabling);
    if (enabling && !isPlaying) void playForward(false);
    setToast(enabling ? "Lecture silencieuse activée" : "Lecture silencieuse désactivée");
  }, [isPlaying, playForward, silentPlayback]);

  const defineLoopStart = useCallback(() => {
    setTransport((current) => setLoopStart(current, currentTime, timelineDuration));
    setToast("Point A défini");
  }, [currentTime, timelineDuration]);

  const defineLoopEnd = useCallback(() => {
    const result = setLoopEnd(transport, currentTime, timelineDuration);
    if (result.error) {
      setToast(result.error);
      return;
    }
    setTransport(result.transport);
    setToast("Point B défini");
  }, [currentTime, timelineDuration, transport]);

  const changeLoopEnabled = useCallback(() => {
    const result = toggleLoop(transport);
    if (result.error) {
      setToast(result.error);
      return;
    }
    setTransport(result.transport);
    setToast(result.transport.loopEnabled ? "Boucle A/B activée" : "Boucle A/B désactivée");
  }, [transport]);

  const clearLoop = useCallback(() => {
    setTransport((current) => resetLoop(current));
    setToast("Boucle A/B réinitialisée");
  }, []);

  const loadPlanThumbnail = useCallback(async (marker) => {
    const fallback = projectCoverImage(activeProject) || "./assets/mediterranean-frame.png";
    const key = `${mediaPath || "demo"}:${Number(marker.time).toFixed(3)}`;
    if (thumbnailCacheRef.current.has(key)) return thumbnailCacheRef.current.get(key);
    const request = (async () => {
      if (!nativeMode || !mediaPath || activeProject?.mediaMissing) return fallback;
      const result = await nativeBridge.call("renderThumbnail", {
        path: mediaPath,
        time: marker.time,
        width: 240,
      });
      return result?.dataURL || fallback;
    })().catch(() => fallback);
    thumbnailCacheRef.current.set(key, request);
    return request;
  }, [activeProject, mediaPath, nativeMode]);

  const loadComparisonFrame = useCallback(async (reference) => {
    const fallback = "./assets/mediterranean-frame.png";
    if (!reference) return fallback;
    const key = `comparison:${mediaPath || "demo"}:${Number(reference.time).toFixed(3)}`;
    if (thumbnailCacheRef.current.has(key)) return thumbnailCacheRef.current.get(key);
    const request = (async () => {
      if (!nativeMode || !mediaPath || activeProject?.mediaMissing) return fallback;
      const result = await nativeBridge.call("renderThumbnail", {
        path: mediaPath,
        time: reference.time,
        width: 1_600,
      });
      return result?.dataURL || fallback;
    })().catch(() => fallback);
    thumbnailCacheRef.current.set(key, request);
    return request;
  }, [activeProject?.mediaMissing, mediaPath, nativeMode]);

  const pinCurrentComparison = (slot) => {
    const frameTolerance = 0.5 / Math.max(frameRate, 1);
    const markerId = selectedMarker?.id != null && Math.abs(Number(selectedMarker.time) - currentTime) <= frameTolerance
      ? selectedMarker.id
      : null;
    setComparison((current) => pinComparison(current, slot, currentTime, markerId));
    setComparisonMenuOpen(false);
    setToast(`Image ${slot.toUpperCase()} épinglée`);
  };

  const openComparison = () => {
    if (!comparison.a || !comparison.b) {
      setToast("Épinglez d’abord les images A et B.");
      return;
    }
    setComparisonZoom({ a: 1, b: 1 });
    setComparisonPan({ a: { x: 0, y: 0 }, b: { x: 0, y: 0 } });
    setComparisonMenuOpen(false);
    setComparisonOpen(true);
  };

  const resetComparison = () => {
    setComparison(emptyComparison());
    setComparisonZoom({ a: 1, b: 1 });
    setComparisonPan({ a: { x: 0, y: 0 }, b: { x: 0, y: 0 } });
    setComparisonOpen(false);
    setComparisonMenuOpen(false);
    setToast("Comparaison réinitialisée");
  };

  const changeComparisonZoom = (slot, value) => {
    const zoom = clampComparisonZoom(value);
    setComparisonZoom((current) => comparison.syncZoom ? { a: zoom, b: zoom } : { ...current, [slot]: zoom });
  };

  const exportComparison = async () => {
    if (!comparison.a || !comparison.b || !mediaPath || activeProject?.mediaMissing || !nativeMode) return;
    const framePayload = (slot) => ({
      time: comparison[slot].time,
      timecode: displayTimecode(comparison[slot].time),
      title: comparisonMarkers[slot]?.title || `Image ${slot.toUpperCase()}`,
      annotations: comparisonFrameAnnotations[slot],
    });
    setComparisonExporting(true);
    try {
      const result = await nativeBridge.call("exportComparison", {
        suggestedName: `${safeExportBaseName(activeProject?.title)}-comparaison.png`,
        mediaPath,
        note: comparison.note,
        a: framePayload("a"),
        b: framePayload("b"),
      });
      if (!result?.cancelled) setToast("Comparaison PNG exportée");
    } catch (error) {
      setToast(`Export impossible : ${error.message}`);
    } finally {
      setComparisonExporting(false);
    }
  };

  const seekTimelineAtClientX = useCallback((clientX, immediate = false) => {
    const rect = timelineTrackRef.current?.getBoundingClientRect();
    if (!rect) return;
    const target = timelinePointerTarget(clientX, rect.left, rect.width, timelineDuration);
    const scrub = timelineScrubRef.current;
    scrub.pending = target;
    if (immediate) {
      if (scrub.frame != null) window.cancelAnimationFrame(scrub.frame);
      scrub.frame = null;
      scrub.pending = null;
      seekTo(target);
      return;
    }
    if (scrub.frame != null) return;
    scrub.frame = window.requestAnimationFrame(() => {
      scrub.frame = null;
      const pending = scrub.pending;
      scrub.pending = null;
      if (pending != null) seekTo(pending);
    });
  }, [seekTo, timelineDuration]);

  const startTimelineScrub = useCallback((event) => {
    if (event.button !== 0 || event.target.closest?.("button")) return;
    pauseTransport();
    timelineScrubRef.current.pointerId = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    setTimelineScrubbing(true);
    seekTimelineAtClientX(event.clientX, true);
  }, [pauseTransport, seekTimelineAtClientX]);

  const moveTimelineScrub = useCallback((event) => {
    if (timelineScrubRef.current.pointerId !== event.pointerId) return;
    seekTimelineAtClientX(event.clientX);
  }, [seekTimelineAtClientX]);

  const finishTimelineScrub = useCallback((event) => {
    if (timelineScrubRef.current.pointerId !== event.pointerId) return;
    seekTimelineAtClientX(event.clientX, true);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    timelineScrubRef.current.pointerId = null;
    setTimelineScrubbing(false);
  }, [seekTimelineAtClientX]);

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
      cover: { mode: "logo" },
      path: result.path,
      mediaURL: result.mediaURL,
      mediaMissing: false,
      archived: false,
      metadata: result.metadata || null,
      metadataError: result.metadataError || "",
      timecode: normalizeTimecodeSettings({ source: "auto" }, metadataFrameRate(result.metadata, FPS)),
    };

    if (activeProject?.id) {
      setDocuments((current) => ({ ...current, [activeProject.id]: currentDocument }));
    }

    const existingIndex = projectList.findIndex((project) => project.id === id);
    const nextProjects = existingIndex >= 0
      ? projectList.map((project, index) => index === existingIndex ? {
        ...project,
        ...newProject,
        timecode: project.timecode?.source === "manual"
          ? normalizeTimecodeSettings(project.timecode, metadataFrameRate(result.metadata, FPS))
          : newProject.timecode,
      } : project)
      : [newProject, ...projectList];
    const nextIndex = existingIndex >= 0 ? existingIndex : 0;
    const nextDocument = documents[id] || emptyDocument();

    setProjectList(nextProjects);
    setSelectedProject(nextIndex);
    applyDocument(nextDocument);
    setMediaSource(result.mediaURL || "");
    setMediaPath(result.path);
    setMediaPlaybackError("");
    setFileMetadata(result.metadata || null);
    setDuration(metadataDuration(result.metadata, 1));
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
        timecode: activeProject.timecode?.source === "manual"
          ? activeProject.timecode
          : normalizeTimecodeSettings({ source: "auto" }, metadataFrameRate(result.metadata || activeProject.metadata, FPS)),
      };
      setProjectList((current) => current.map((project) => project.id === activeProject.id ? replacement : project));
      setMediaSource(result.mediaURL || "");
      setMediaPath(result.path || "");
      setMediaPlaybackError("");
      setFileMetadata(replacement.metadata);
      setDuration(metadataDuration(replacement.metadata, 1));
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

  const applyProjectResult = useCallback((result) => {
    if (!result || result.cancelled) return;
    if (result.error) {
      setToast(`Import impossible : ${result.error}`);
      return;
    }
    try {
      applyPersistedEnvelope(result.state);
      setToast(result.recovered
        ? "Projet importé et migré depuis un ancien format"
        : result.portable
          ? "Projet portable importé avec sa vidéo"
          : "Projet Cinécrique importé");
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
      applyProjectResult(result);
    } catch (error) {
      setToast(`Import impossible : ${error.message}`);
    }
  }, [applyProjectResult, nativeMode]);

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

  const applyProjectCollection = useCallback((nextProjects, nextDocuments, nextActiveId) => {
    const nextIndex = nextActiveId == null
      ? -1
      : nextProjects.findIndex((project) => project.id === nextActiveId && !project.archived);
    const nextProject = nextIndex >= 0 ? nextProjects[nextIndex] : null;
    setProjectList(nextProjects);
    setDocuments(nextDocuments);
    setSelectedProject(nextIndex);
    applyDocument(nextProject
      ? nextDocuments[nextProject.id] || (nextProject.id === "demo-le-mepris" ? initialDocument() : emptyDocument())
      : emptyDocument());
    setMediaSource(nextProject?.mediaURL || "");
    setMediaPath(nextProject?.path || "");
    setMediaPlaybackError("");
    setFileMetadata(nextProject?.metadata || null);
    setDuration(metadataDuration(nextProject?.metadata, nextProject?.path ? 1 : DURATION));
  }, [applyDocument]);

  const documentsIncludingActive = useCallback(() => (activeProject?.id
    ? { ...documents, [activeProject.id]: currentDocument }
    : documents), [activeProject?.id, currentDocument, documents]);

  const selectProjectAt = useCallback((index) => {
    const nextProject = projectList[index];
    if (!nextProject || nextProject.archived || nextProject.id === activeProject?.id) return;
    applyProjectCollection(projectList, documentsIncludingActive(), nextProject.id);
    setProjectMenu(null);
    setToast(nextProject.mediaMissing ? "Média introuvable : reliez le fichier pour reprendre la lecture." : `${nextProject.title} ouvert`);
  }, [activeProject?.id, applyProjectCollection, documentsIncludingActive, projectList]);

  const openProjectMenu = useCallback((projectId, event, trigger = null) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = trigger?.getBoundingClientRect();
    const rawX = rect ? rect.right + 6 : event.clientX;
    const rawY = rect ? rect.top : event.clientY;
    projectMenuButtonRef.current = trigger;
    setProjectMenu((current) => current?.projectId === projectId
      ? null
      : {
        projectId,
        x: clamp(rawX, 8, window.innerWidth - 210),
        y: clamp(rawY, 62, window.innerHeight - 330),
        moveOpen: false,
      });
  }, []);

  const beginProjectRename = () => {
    if (!projectMenuTarget) return;
    setRenamingProjectId(projectMenuTarget.id);
    setProjectNameDraft(projectMenuTarget.title || "");
    setProjectMenu(null);
  };

  const beginCoverEdit = (project = projectMenuTarget || activeProject) => {
    if (!project) return;
    setCoverEditorProjectId(project.id);
    setCoverDraft(normalizeProjectCover(project.cover, project.poster));
    setProjectMenu(null);
  };

  const saveProjectCover = () => {
    if (!coverEditorProjectId) return;
    const cover = normalizeProjectCover(coverDraft);
    setProjectList((current) => current.map((project) => (
      project.id === coverEditorProjectId ? { ...project, cover } : project
    )));
    setCoverEditorProjectId(null);
    setToast("Couverture du projet mise à jour");
  };

  const chooseProjectCoverImage = async () => {
    if (!nativeMode) {
      coverFileInputRef.current?.click();
      return;
    }
    setCoverLoading(true);
    try {
      const result = await nativeBridge.call("chooseCoverImage");
      if (!result?.cancelled && result?.dataURL) {
        setCoverDraft({ mode: "image", source: "local", value: result.dataURL });
      }
    } catch (error) {
      setToast(error.message);
    } finally {
      setCoverLoading(false);
    }
  };

  const captureProjectCoverFrame = async () => {
    if (!coverEditorProject || coverEditorProject.id !== activeProject?.id || !mediaPath || activeProject?.mediaMissing) return;
    setCoverLoading(true);
    try {
      if (nativeMode) {
        const result = await nativeBridge.call("captureCoverFrame", { path: mediaPath, time: currentTime });
        if (result?.dataURL) setCoverDraft({ mode: "image", source: "frame", value: result.dataURL });
      } else if (videoRef.current) {
        const video = videoRef.current;
        const canvas = document.createElement("canvas");
        const scale = Math.min(1, 900 / video.videoWidth, 1_350 / video.videoHeight);
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
        canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
        setCoverDraft({ mode: "image", source: "frame", value: canvas.toDataURL("image/jpeg", 0.8) });
      }
    } catch (error) {
      setToast(`Capture impossible : ${error.message}`);
    } finally {
      setCoverLoading(false);
    }
  };

  const downloadProjectTMDBCover = async () => {
    const posterPath = coverEditorProject?.tmdb?.posterPath;
    if (!nativeMode || !posterPath) return;
    setCoverLoading(true);
    try {
      const result = await nativeBridge.call("downloadTMDBCover", { posterPath });
      if (result?.dataURL) setCoverDraft({ mode: "image", source: "tmdb", value: result.dataURL });
    } catch (error) {
      setToast(`Affiche TMDB indisponible : ${error.message}`);
    } finally {
      setCoverLoading(false);
    }
  };

  const importBrowserCover = async (file) => {
    if (!file) return;
    setCoverLoading(true);
    try {
      setCoverDraft({ mode: "image", source: "local", value: await browserCoverDataURL(file) });
    } catch (error) {
      setToast(error.message);
    } finally {
      setCoverLoading(false);
    }
  };

  const saveProjectRename = (event) => {
    event.preventDefault();
    const title = projectNameDraft.trim();
    if (!title) return;
    setProjectList((current) => renameProject(current, renamingProjectId, title));
    setRenamingProjectId(null);
    setToast("Projet renommé");
  };

  const moveProjectInList = (direction) => {
    if (!projectMenuTarget) return;
    const activeIdentifier = activeProject?.id || null;
    const nextProjects = moveProject(projectList, projectMenuTarget.id, direction);
    setProjectList(nextProjects);
    setSelectedProject(activeIdentifier == null ? -1 : nextProjects.findIndex((project) => project.id === activeIdentifier));
    setProjectMenu(null);
    setToast(direction < 0 ? "Projet déplacé vers le haut" : "Projet déplacé vers le bas");
  };

  const toggleProjectArchive = () => {
    if (!projectMenuTarget) return;
    const willArchive = !projectMenuTarget.archived;
    const nextProjects = setProjectArchived(projectList, projectMenuTarget.id, willArchive);
    const nextDocuments = documentsIncludingActive();
    const nextActiveId = willArchive && activeProject?.id === projectMenuTarget.id
      ? nextProjects.find((project) => !project.archived)?.id ?? null
      : activeProject?.id ?? (willArchive ? null : projectMenuTarget.id);
    applyProjectCollection(nextProjects, nextDocuments, nextActiveId);
    setProjectMenu(null);
    if (willArchive) setArchivesOpen(true);
    setToast(willArchive ? "Projet archivé" : "Projet restauré");
  };

  const requestProjectDeletion = () => {
    if (!projectMenuTarget) return;
    const project = projectMenuTarget;
    setProjectMenu(null);
    setConfirmation({
      title: "Supprimer le projet ?",
      message: `« ${project.title} » et toute son analyse locale seront supprimés. Le fichier vidéo original restera intact.`,
      confirmLabel: "Supprimer le projet",
      returnFocusRef: projectMenuButtonRef,
      action: () => {
        const result = removeProject(
          projectList,
          documentsIncludingActive(),
          project.id,
          activeProject?.id || null,
        );
        applyProjectCollection(result.projects, result.documents, result.activeProjectId);
        setToast("Projet supprimé, vidéo originale conservée");
      },
    });
  };

  const persistedState = useMemo(() => ({
    version: 6,
    projects: projectList,
    activeProjectId: activeProject?.id || null,
    documents: activeProject?.id ? { ...documents, [activeProject.id]: currentDocument } : documents,
    preferences: { leftPanel, projectRailCollapsed, muted: isMuted, shortcuts },
  }), [activeProject?.id, currentDocument, documents, isMuted, leftPanel, projectList, projectRailCollapsed, shortcuts]);

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
        if (cancelled || !Array.isArray(state?.projects)) return;
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
      nativeBridge.on("analyse:project-dropped", applyProjectResult),
      nativeBridge.on("analyse:file-rejected", (detail) => setToast(detail?.message || "Fichier non pris en charge")),
      nativeBridge.on("analyse:open-video-requested", importVideo),
      nativeBridge.on("analyse:open-subtitle-requested", importSubtitle),
      nativeBridge.on("analyse:save-requested", () => {
        saveNow();
        setToast("Projet enregistré localement");
      }),
      nativeBridge.on("analyse:export-requested", () => setExportOpen(true)),
    ];
    nativeBridge.readyForEvents().catch((error) => setToast(error.message));
    return () => disposers.forEach((dispose) => dispose());
  }, [applyProjectResult, applySubtitleResult, applyVideoResult, importSubtitle, importVideo, nativeMode, saveNow]);

  useEffect(() => () => {
    if (mediaSource.startsWith("blob:")) URL.revokeObjectURL(mediaSource);
  }, [mediaSource]);

  useEffect(() => () => {
    const frame = timelineScrubRef.current.frame;
    if (frame != null) window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    setTimecodeOffsetDraft(formatTimecodeOffset(timecodeSettings));
  }, [activeProject?.id, timecodeSettings]);

  useEffect(() => {
    thumbnailCacheRef.current.clear();
  }, [mediaPath]);

  useEffect(() => {
    if (activeEditorTab !== "transcript" || activeSubtitleIndex < 0) return;
    transcriptListRef.current
      ?.querySelector(`[data-cue-index="${activeSubtitleIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeEditorTab, activeSubtitleIndex]);

  useEffect(() => {
    const handleTransportShortcut = (event) => {
      if (event.repeat || document.querySelector("[role='dialog'][aria-modal='true']")) return;
      const action = transportShortcut(event, shortcuts);
      if (!action) return;
      event.preventDefault();
      if (action === "togglePlayback") togglePlayback();
      else if (action === "reverse") playReverse();
      else if (action === "pause") pauseTransport();
      else if (action === "forward") void playForward(true);
      else if (action === "slower") slowPlayback();
      else if (action === "silent") toggleSilentPlayback();
      else if (action === "loopStart") defineLoopStart();
      else if (action === "loopEnd") defineLoopEnd();
      else if (action === "mute") toggleMute();
    };
    window.addEventListener("keydown", handleTransportShortcut);
    return () => window.removeEventListener("keydown", handleTransportShortcut);
  }, [defineLoopEnd, defineLoopStart, pauseTransport, playForward, playReverse, shortcuts, slowPlayback, toggleMute, togglePlayback, toggleSilentPlayback]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = transport.playbackRate;
  }, [mediaSource, transport.playbackRate]);

  useEffect(() => {
    const video = videoRef.current;
    if (!isPlaying || !video || typeof video.requestVideoFrameCallback !== "function") return undefined;
    let cancelled = false;
    const updateFrame = (_now, metadata) => {
      if (cancelled) return;
      const mediaTime = Number(metadata?.mediaTime);
      if (Number.isFinite(mediaTime)) setCurrentTime(mediaTime);
      videoFrameCallbackRef.current = video.requestVideoFrameCallback(updateFrame);
    };
    videoFrameCallbackRef.current = video.requestVideoFrameCallback(updateFrame);
    return () => {
      cancelled = true;
      if (videoFrameCallbackRef.current != null && typeof video.cancelVideoFrameCallback === "function") {
        video.cancelVideoFrameCallback(videoFrameCallbackRef.current);
      }
      videoFrameCallbackRef.current = null;
    };
  }, [isPlaying, mediaSource]);

  useEffect(() => {
    if (!isPlaying || playbackDirection !== -1) return undefined;
    let previous = performance.now();
    const tick = (now) => {
      const elapsed = Math.min((now - previous) / 1000, 0.1);
      previous = now;
      setCurrentTime((time) => {
        let next = time - elapsed * transport.playbackRate;
        const loopTarget = loopBoundaryTarget(next, -1, transport);
        if (loopTarget != null) next = loopTarget;
        if (next <= 0 && loopTarget == null) {
          next = 0;
          playbackDirectionRef.current = 0;
          setPlaybackDirection(0);
          setIsPlaying(false);
        }
        if (videoRef.current) videoRef.current.currentTime = next;
        return next;
      });
      if (playbackDirectionRef.current === -1) reverseFrameRef.current = requestAnimationFrame(tick);
    };
    reverseFrameRef.current = requestAnimationFrame(tick);
    return () => {
      if (reverseFrameRef.current != null) cancelAnimationFrame(reverseFrameRef.current);
      reverseFrameRef.current = null;
    };
  }, [isPlaying, playbackDirection, transport]);

  useEffect(() => {
    if (!loopMenuOpen) return undefined;
    const frame = requestAnimationFrame(() => loopMenuRef.current?.querySelector("button:not(:disabled)")?.focus());
    const close = (event) => {
      if (loopMenuRef.current?.contains(event.target) || loopMenuButtonRef.current?.contains(event.target)) return;
      setLoopMenuOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setLoopMenuOpen(false);
      loopMenuButtonRef.current?.focus();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [loopMenuOpen]);

  useEffect(() => {
    if (!comparisonMenuOpen) return undefined;
    const frame = requestAnimationFrame(() => comparisonMenuRef.current?.querySelector("button:not(:disabled)")?.focus());
    const close = (event) => {
      if (comparisonMenuRef.current?.contains(event.target) || comparisonMenuButtonRef.current?.contains(event.target)) return;
      setComparisonMenuOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setComparisonMenuOpen(false);
      comparisonMenuButtonRef.current?.focus();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [comparisonMenuOpen]);

  useEffect(() => {
    if (!projectMenu) return undefined;
    window.requestAnimationFrame(() => projectMenuRef.current?.querySelector("button")?.focus());
    const closeMenu = (event) => {
      if (projectMenuRef.current?.contains(event.target) || projectMenuButtonRef.current?.contains(event.target)) return;
      setProjectMenu(null);
    };
    const handleKeyDown = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setProjectMenu(null);
      projectMenuButtonRef.current?.focus();
    };
    window.addEventListener("pointerdown", closeMenu);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", closeMenu);
    return () => {
      window.removeEventListener("pointerdown", closeMenu);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", closeMenu);
    };
  }, [projectMenu?.projectId]);

  useEffect(() => {
    if (!isPlaying || mediaSource || playbackDirection !== 1) return undefined;
    const timer = window.setInterval(() => {
      setCurrentTime((time) => {
        let next = time + 0.1 * transport.playbackRate;
        const loopTarget = loopBoundaryTarget(next, 1, transport);
        if (loopTarget != null) next = loopTarget;
        if (next >= duration && loopTarget == null) {
          playbackDirectionRef.current = 0;
          setPlaybackDirection(0);
          setIsPlaying(false);
          return duration;
        }
        return next;
      });
    }, 100);
    return () => window.clearInterval(timer);
  }, [duration, isPlaying, mediaSource, playbackDirection, transport]);

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

  const selectMarker = (marker, showHistoryActions = false) => {
    setSelectedMarkerId(marker.id);
    setSelectedAnnotationId(null);
    setHistoryActionsMarkerId(showHistoryActions ? marker.id : null);
    seekTo(marker.time);
    pauseTransport();
  };

  const stepBy = (delta) => {
    const next = currentTime + delta;
    pauseTransport();
    seekTo(next);
  };

  useEffect(() => {
    setScene((current) => clamp(current, 1, Math.max(1, scriptScenes.length)));
  }, [scriptScenes.length]);

  const trackSceneAtOffset = useCallback((offset) => {
    const index = fountainSceneIndexAtOffset(scriptScenes, offset);
    if (index >= 0) setScene(index + 1);
  }, [scriptScenes]);

  const selectSceneByIndex = useCallback((index) => {
    if (!scriptScenes.length) return;
    const targetIndex = clamp(index, 0, scriptScenes.length - 1);
    const target = scriptScenes[targetIndex];
    setActiveEditorTab("script");
    setScene(targetIndex + 1);
    setSceneSelectionRequest({
      start: target.start,
      end: target.end,
      token: `${target.start}-${target.end}-${Date.now()}`,
    });
  }, [scriptScenes]);

  const navigateScene = useCallback((direction) => {
    selectSceneByIndex(scene - 1 + direction);
  }, [scene, selectSceneByIndex]);

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
      [markerId]: [...(current[markerId] || []), { ...annotation, time: currentTime }],
    }));
    setSelectedAnnotationId(annotation.id);
    setToast("Annotation ajoutée à l’image");
  };

  const undoAnnotation = () => {
    setAnnotationsByMarker((current) => {
      const lastVisibleId = annotations.at(-1)?.id;
      const remaining = (current[selectedMarkerId] || []).filter((annotation) => annotation.id !== lastVisibleId);
      if (!remaining.some((annotation) => annotation.id === selectedAnnotationId)) {
        setSelectedAnnotationId(null);
      }
      return { ...current, [selectedMarkerId]: remaining };
    });
  };

  const clearAnnotations = () => {
    const visibleIds = new Set(annotations.map((annotation) => annotation.id));
    setAnnotationsByMarker((current) => ({
      ...current,
      [selectedMarkerId]: (current[selectedMarkerId] || []).filter((annotation) => !visibleIds.has(annotation.id)),
    }));
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
      startTimecode: displayTimecode(start),
      endTimecode: displayTimecode(end),
      bookmarked: Boolean(marker.bookmarked),
    } : {
      ...emptyDraft(),
      type,
      startTimecode: displayTimecode(start),
      endTimecode: displayTimecode(end),
    });
    setNoteAnchor(anchor);
    setComposerOpen(true);
  };

  const seekToSubtitle = (cue) => {
    pauseTransport();
    seekTo(cue.start);
  };

  const openSubtitleNote = (cue) => {
    seekToSubtitle(cue);
    setEditingMarkerId(null);
    setDraft(subtitleNoteDraft(cue, displayTimecode));
    setNoteAnchor(null);
    setComposerOpen(true);
  };

  const seekToPlan = (marker) => {
    pauseTransport();
    setSelectedMarkerId(marker.id);
    setSelectedAnnotationId(null);
    seekTo(marker.time);
  };

  const updatePlanField = (markerId, field, value) => {
    setMarkers((current) => current.map((marker) => (
      marker.id === markerId ? updateShotMarker(marker, field, value) : marker
    )));
  };

  const updatePlanTime = (marker, field, value) => {
    const parsed = parseTimecode(value, timecodeSettings);
    if (parsed == null || parsed > timelineDuration) {
      setToast("Ce timecode de plan est invalide.");
      return;
    }
    const start = field === "time" ? parsed : marker.time;
    const end = field === "endTime" ? parsed : marker.endTime;
    if (!(end > start)) {
      setToast("La fin du plan doit être après son début.");
      return;
    }
    setMarkers((current) => current.map((candidate) => (
      candidate.id === marker.id ? { ...candidate, [field]: parsed } : candidate
    )).sort((left, right) => left.time - right.time));
    if (field === "time" && parsed !== marker.time) {
      setAnnotationsByMarker((current) => ({
        ...current,
        ...(Object.hasOwn(current, marker.id) ? { [marker.id]: shiftAnnotationTimes(current[marker.id], parsed - marker.time, marker.time) } : {}),
      }));
    }
    setToast("Timecode du plan mis à jour");
  };

  const changeShotSort = (key) => {
    setShotSort((current) => current.key === key
      ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
      : { key, direction: "asc" });
  };

  const resetShotFilters = () => {
    setShotQuery("");
    setShotTypeFilter("");
    setShotTagFilter("");
  };

  const openPlanComposer = () => {
    openComposer("note");
    setDraft((current) => ({ ...current, title: "Nouveau plan", tag: "Plan", kind: "range" }));
  };

  const saveNote = (event) => {
    event.preventDefault();
    if (!draft.title.trim()) return;
    const linkURL = draft.type === "link" ? safeExternalURL(draft.url) : "";
    if (draft.type === "link" && !linkURL) {
      setToast("Ajoutez un lien HTTP ou HTTPS valide.");
      return;
    }
    const startTime = parseTimecode(draft.startTimecode, timecodeSettings);
    const endTime = draft.kind === "range" ? parseTimecode(draft.endTimecode, timecodeSettings) : null;
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
      ...(draft.kind === "range" ? { endTime, shot: normalizeShot(editedMarker?.shot) } : {}),
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
    const sourceMarker = editedMarker || (selectedIsAutomaticAnnotation ? selected : null);
    if (sourceMarker && startTime !== sourceMarker.time) {
      setAnnotationsByMarker((current) => ({
        ...current,
        ...(Object.hasOwn(current, id) ? { [id]: shiftAnnotationTimes(current[id], startTime - sourceMarker.time, sourceMarker.time) } : {}),
      }));
    }
    setSelectedMarkerId(id);
    seekTo(startTime);
    if (noteAnchor) {
      setAnnotationsByMarker((current) => ({
        ...current,
        [id]: [
          ...(current[id] || []),
          { id: crypto.randomUUID(), type: "point", time: startTime, ...noteAnchor, label: (current[id] || []).length + 1 },
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

  const duplicateSelectedMarker = (sourceMarker = selectedMarker) => {
    if (sourceMarker.id == null) return;
    const id = crypto.randomUUID();
    const duplicate = duplicateMarker(sourceMarker, id, Math.max(1 / frameRate, 1));
    const duplicatedAnnotations = (annotationsByMarker[sourceMarker.id] || []).map((annotation) => ({
      ...annotation,
      id: crypto.randomUUID(),
      time: Number(annotation.time ?? sourceMarker.time) + duplicate.time - sourceMarker.time,
    }));
    setMarkers((current) => [...current, duplicate].sort((a, b) => a.time - b.time));
    if (duplicatedAnnotations.length) {
      setAnnotationsByMarker((current) => ({ ...current, [id]: duplicatedAnnotations }));
    }
    setSelectedMarkerId(id);
    setSelectedAnnotationId(null);
    setMarkerMenuOpen(false);
    setHistoryActionsMarkerId(id);
    seekTo(duplicate.time);
    setToast("Repère dupliqué");
  };

  const requestMarkerDeletion = (sourceMarker = selectedMarker) => {
    if (sourceMarker.id == null) return;
    setMarkerMenuOpen(false);
    setConfirmation({
      title: "Supprimer le repère ?",
      message: `« ${sourceMarker.title} » et ses annotations seront supprimés.`,
      confirmLabel: "Supprimer",
      action: () => {
        const result = removeMarker(markers, annotationsByMarker, sourceMarker.id);
        const nextMarker = result.markers.find((marker) => marker.time >= sourceMarker.time) || result.markers.at(-1) || null;
        setMarkers(result.markers);
        setAnnotationsByMarker(result.annotationsByMarker);
        setSelectedMarkerId(nextMarker?.id ?? null);
        setSelectedAnnotationId(null);
        setHistoryActionsMarkerId(null);
        if (nextMarker) seekTo(nextMarker.time);
        setToast("Repère supprimé");
      },
    });
  };

  const resetMarkerFilters = () => {
    setSearch("");
    setMarkerFilters(emptyFilters());
  };

  const setReportFormat = (key, checked) => {
    const enablingFirstReport = checked && !exportOptions.reportHtml && !exportOptions.reportPdf;
    setExportOptions((current) => ({ ...current, [key]: checked }));
    if (!enablingFirstReport) return;
    setReportSelection((current) => ({
      ...current,
      sceneIndexes: current.sceneIndexes.length
        ? current.sceneIndexes
        : scriptScenes[scene - 1] ? [scriptScenes[scene - 1].index] : [],
      imageMarkerIds: current.imageMarkerIds.length
        ? current.imageMarkerIds
        : annotatedFrames.slice(0, 100).map(({ marker }) => String(marker.id)),
    }));
  };

  const toggleReportListValue = (key, value) => {
    setReportSelection((current) => {
      const items = current[key] || [];
      return {
        ...current,
        [key]: items.includes(value) ? items.filter((item) => item !== value) : [...items, value],
      };
    });
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
    const projectPreviewAvailable = exportOptions.project && Boolean(mediaPath) && !activeProject?.mediaMissing;
    const needsMedia = exportOptions.video
      || exportOptions.currentFrame
      || exportOptions.allFrames
      || (exportOptions.project && exportOptions.portableProject)
      || (projectPreviewAvailable && annotatedFrames.length > 0);
    if (needsMedia && (!mediaPath || activeProject?.mediaMissing)) {
      setToast("Reliez d’abord le média original pour exporter la vidéo ou des images.");
      return;
    }
    if (exportOptions.allFrames && !annotatedFrames.length) {
      setToast("Ce projet ne contient aucune image annotée.");
      return;
    }
    const wantsReport = exportOptions.reportHtml || exportOptions.reportPdf;
    if (wantsReport && !reportSelectionHasContent(reportSelection)) {
      setToast("Sélectionnez au moins une section pour le rapport.");
      return;
    }

    const reportNeedsMedia = wantsReport && selectedReportFrames.length > 0;
    if (reportNeedsMedia && (!mediaPath || activeProject?.mediaMissing)) {
      setToast("Reliez d’abord le média original pour inclure les images du rapport.");
      return;
    }

    const files = buildTextExportFiles(exportOptions, {
      title: activeProject?.title,
      script,
      analysis,
      markers,
      subtitlesVTT: subtitlesAsVTT(subtitleCues),
      metadata: { file: fileMetadata, tmdb: activeProject?.tmdb || null },
      projectState: persistedState,
      formatTimecode: displayTimecode,
    });
    const frameEntries = exportOptions.allFrames
      ? annotatedFrames
      : exportOptions.currentFrame
        ? [{ marker: selectedMarker.id == null ? { id: "current", time: currentTime } : selectedMarker, annotations }]
        : [];
    const makeFramePayload = (entries, prefix = "image") => entries.map(({ marker, annotations: frameAnnotations }, index) => ({
      name: `${safeExportBaseName(activeProject?.title)}-${prefix}-${String(index + 1).padStart(2, "0")}-${displayTimecode(marker.time).replaceAll(":", "-").replaceAll(";", "-")}.png`,
      time: marker.time,
      annotations: frameAnnotations,
    }));
    const frames = makeFramePayload(frameEntries);
    const projectFrames = projectPreviewAvailable ? makeFramePayload(annotatedFrames, "apercu") : [];
    const reportModel = wantsReport ? buildReportModel({
      project: activeProject,
      metadataRows,
      markers,
      analysis,
      scenes: scriptScenes,
      script,
      selection: reportSelection,
      formatTimecode: displayTimecode,
      formatDuration: displayDuration,
      generatedAt: new Date().toISOString(),
    }) : null;
    const reportFrames = selectedReportFrames.map(({ marker, annotations: frameAnnotations }) => ({
      title: marker.title || "Image annotée",
      timecode: displayTimecode(marker.time),
      time: marker.time,
      annotations: frameAnnotations,
    }));
    const reportBaseName = `${safeExportBaseName(activeProject?.title)}-rapport`;
    const reports = [
      exportOptions.reportHtml ? { name: `${reportBaseName}.html`, format: "html", model: reportModel, frames: reportFrames } : null,
      exportOptions.reportPdf ? { name: `${reportBaseName}.pdf`, format: "pdf", model: reportModel, frames: reportFrames } : null,
    ].filter(Boolean);

    setExporting(true);
    try {
      if (nativeMode) {
        const result = await nativeBridge.call("exportSelection", {
          suggestedName: safeExportBaseName(activeProject?.title),
          files,
          includeVideo: exportOptions.video,
          mediaPath,
          frames,
          reports,
          projectPackage: exportOptions.project ? {
            state: persistedState,
            includeVideo: Boolean(exportOptions.portableProject),
            frames: projectFrames,
          } : null,
        });
        if (result?.cancelled) return;
      } else {
        if (needsMedia || exportOptions.project || reports.length) throw new Error("Cet export nécessite l’application macOS.");
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
    if (!isSupportedVideoFile(file)) {
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

  const captureShortcutKey = (event) => {
    if (!capturingShortcut) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      setCapturingShortcut(null);
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) {
      setToast("Choisissez une touche simple, sans Commande, Contrôle ou Option.");
      return;
    }
    const key = normalizeShortcutKey(event.key);
    if (!key) {
      setToast("Cette touche ne peut pas être utilisée comme raccourci.");
      return;
    }
    setShortcuts((current) => assignShortcut(current, capturingShortcut, key));
    setCapturingShortcut(null);
    setToast(`Raccourci attribué : ${shortcutLabel(key)}`);
  };

  const updateActiveTimecode = (settings) => {
    if (!activeProject?.id) return;
    const normalized = normalizeTimecodeSettings(settings, detectedFrameRate);
    setProjectList((current) => current.map((project) => (
      project.id === activeProject.id ? { ...project, timecode: normalized } : project
    )));
  };

  const chooseTimecodeRate = (value) => {
    const next = value === "auto"
      ? changeTimecodeRate(timecodeSettings, "auto", timecodeSettings.rate, detectedFrameRate)
      : changeTimecodeRate(timecodeSettings, "manual", value, detectedFrameRate);
    updateActiveTimecode(next);
  };

  const commitTimecodeOffset = () => {
    const offsetFrames = parseTimecodeOffset(timecodeOffsetDraft, timecodeSettings);
    if (offsetFrames == null) {
      setTimecodeOffsetDraft(formatTimecodeOffset(timecodeSettings));
      setToast("L’offset de timecode est invalide.");
      return;
    }
    updateActiveTimecode({ ...timecodeSettings, offsetFrames });
    setToast("Offset de timecode enregistré");
  };

  const applyLayout = (value, label) => {
    setLeftPanel(value);
    setLayoutMenuOpen(false);
    setToast(`Disposition « ${label} » appliquée`);
  };

  const projectMenuCohort = projectMenuTarget
    ? projectList.filter((project) => Boolean(project.archived) === Boolean(projectMenuTarget.archived))
    : [];
  const projectMenuPosition = projectMenuTarget
    ? projectMenuCohort.findIndex((project) => project.id === projectMenuTarget.id)
    : -1;

  const renderProjectEntry = ({ project, index }, archived = false) => (
    <div
      key={project.id}
      className={`project-item-shell ${archived ? "archived" : ""}`}
      onContextMenu={(event) => openProjectMenu(project.id, event, event.currentTarget.querySelector(".project-item"))}
    >
      <button
        className={`project-item ${selectedProject === index ? "selected" : ""}`}
        onClick={archived
          ? (event) => openProjectMenu(project.id, event, event.currentTarget)
          : () => selectProjectAt(index)}
        title={archived ? `${project.title} · archivé` : project.title}
      >
        <ProjectCover project={project} />
        <span>{project.title}</span>
      </button>
      <button
        type="button"
        className="project-more-button"
        aria-label={`Actions pour ${project.title}`}
        aria-haspopup="menu"
        aria-expanded={projectMenu?.projectId === project.id}
        onClick={(event) => openProjectMenu(project.id, event, event.currentTarget)}
      ><DotsThree size={16} weight="bold" /></button>
      {archived && <Archive className="project-archive-badge" size={15} aria-hidden="true" />}
    </div>
  );

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
                <button onClick={() => { setLayoutMenuOpen(false); setShortcutsOpen(true); }}>
                  Raccourcis <Keyboard size={16} />
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {projectMenu && projectMenuTarget && (
        <div
          ref={projectMenuRef}
          className="project-context-menu"
          role="menu"
          aria-label={`Actions pour ${projectMenuTarget.title}`}
          style={{ left: projectMenu.x, top: projectMenu.y }}
        >
          <div className="project-menu-title">{projectMenuTarget.title}</div>
          <button type="button" role="menuitem" onClick={beginProjectRename}><PencilSimple size={16} /> Renommer</button>
          <button type="button" role="menuitem" onClick={() => beginCoverEdit(projectMenuTarget)}><ImageIcon size={16} /> Couverture</button>
          <button
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={projectMenu.moveOpen}
            onClick={() => setProjectMenu((current) => ({ ...current, moveOpen: !current.moveOpen }))}
          ><ArrowsDownUp size={16} /> Déplacer <CaretRight size={14} /></button>
          {projectMenu.moveOpen && (
            <div className="project-move-options" role="group" aria-label="Déplacer le projet">
              <button type="button" role="menuitem" disabled={projectMenuPosition <= 0} onClick={() => moveProjectInList(-1)}><ArrowUp size={15} /> Vers le haut</button>
              <button type="button" role="menuitem" disabled={projectMenuPosition < 0 || projectMenuPosition >= projectMenuCohort.length - 1} onClick={() => moveProjectInList(1)}><ArrowDown size={15} /> Vers le bas</button>
            </div>
          )}
          <button type="button" role="menuitem" onClick={toggleProjectArchive}>
            {projectMenuTarget.archived ? <ArrowCounterClockwise size={16} /> : <Archive size={16} />}
            {projectMenuTarget.archived ? "Restaurer" : "Archiver"}
          </button>
          <span className="project-menu-separator" />
          <button type="button" role="menuitem" className="danger" onClick={requestProjectDeletion}><Trash size={16} /> Supprimer</button>
        </div>
      )}

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
          <div className="project-scroll">
            <nav className="project-list" aria-label="Analyses récentes">
              {activeProjectEntries.map((entry) => renderProjectEntry(entry))}
              {!activeProjectEntries.length && !projectRailCollapsed && <p className="project-empty">Aucun projet actif</p>}
            </nav>
            {archivedProjectEntries.length > 0 && (
              <section className="archive-section" aria-label="Projets archivés">
                <button type="button" className="archive-heading" aria-expanded={archivesOpen} onClick={() => setArchivesOpen((open) => !open)}>
                  <Archive size={14} /> Archives <span>{archivedProjectEntries.length}</span><CaretDown size={13} className={archivesOpen ? "open" : ""} />
                </button>
                {archivesOpen && (
                  <nav className="project-list archived-list" aria-label="Archives">
                    {archivedProjectEntries.map((entry) => renderProjectEntry(entry, true))}
                  </nav>
                )}
              </section>
            )}
          </div>
          <button className="import-button" onClick={importVideo} title="Importer un film">
            <Plus size={30} weight="light" />
            <span>Importer</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept={`video/*,${VIDEO_EXTENSIONS.map((extension) => `.${extension}`).join(",")}`}
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
                  muted={effectiveMuted}
                  preload="metadata"
                  playsInline
                  onLoadedMetadata={(event) => {
                    const video = event.currentTarget;
                    if (Number.isFinite(video.duration) && video.duration > 0) setDuration(video.duration);
                    video.currentTime = clamp(currentTime, 0, Number.isFinite(video.duration) ? video.duration : duration);
                  }}
                  onCanPlay={() => setMediaPlaybackError("")}
                  onTimeUpdate={(event) => {
                    const video = event.currentTarget;
                    const loopTarget = loopBoundaryTarget(video.currentTime, 1, transport);
                    if (playbackDirectionRef.current >= 0 && loopTarget != null) {
                      video.currentTime = loopTarget;
                      setCurrentTime(loopTarget);
                    } else {
                      setCurrentTime(video.currentTime);
                    }
                  }}
                  onPlay={() => {
                    if (playbackDirectionRef.current !== -1) {
                      playbackDirectionRef.current = 1;
                      setPlaybackDirection(1);
                    }
                    setIsPlaying(true);
                  }}
                  onPause={() => {
                    if (playbackDirectionRef.current !== -1) setIsPlaying(false);
                  }}
                  onEnded={pauseTransport}
                  onError={() => {
                    const issue = mediaPlaybackIssue(fileMetadata || activeProject?.metadata, activeProject?.path || activeProject?.title);
                    setMediaPlaybackError(issue);
                    setToast(issue);
                  }}
                />
              ) : (
                <img className="film-frame" src="./assets/mediterranean-frame.png" alt="Plan méditerranéen du film analysé" />
              )}
              <AnnotationCanvas
                annotations={annotations}
                activeTool={activeTool}
                pencilWidth={pencilWidth}
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
              {mediaPlaybackError && !activeProject?.mediaMissing && (
                <div className="media-codec-banner" role="alert">
                  <FilmStrip size={19} />
                  <span><strong>Lecture impossible</strong>{mediaPlaybackError}</span>
                </div>
              )}
              <div className="frame-badge">{Math.round(frameRate * 100) / 100} i/s</div>
            </div>

            <div className="transport-area">
              <div className="transport-row">
                <time>{displayTimecode(currentTime)}</time>
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
                  <label className="playback-rate-control" title="Vitesse de lecture">
                    <select
                      aria-label="Vitesse de lecture"
                      value={transport.playbackRate}
                      onChange={(event) => applyPlaybackRate(event.target.value)}
                    >
                      {PLAYBACK_RATES.map((rate) => <option key={rate} value={rate}>{String(rate).replace(".", ",")}×</option>)}
                    </select>
                  </label>
                  <div className="loop-control">
                    <AppIconButton
                      label={`Boucle A/B (${shortcutLabel(shortcuts.loopStart)}/${shortcutLabel(shortcuts.loopEnd)})`}
                      active={transport.loopEnabled}
                      aria-expanded={loopMenuOpen}
                      aria-haspopup="menu"
                      buttonRef={loopMenuButtonRef}
                      onClick={() => setLoopMenuOpen((open) => !open)}
                    ><Repeat size={19} /></AppIconButton>
                    {loopMenuOpen && (
                      <div ref={loopMenuRef} className="transport-popover" role="menu" aria-label="Boucle A/B">
                        <div className="loop-summary">
                          <span>A <time>{transport.loopStart == null ? "—" : displayTimecode(transport.loopStart)}</time></span>
                          <span>B <time>{transport.loopEnd == null ? "—" : displayTimecode(transport.loopEnd)}</time></span>
                        </div>
                        <button type="button" role="menuitem" onClick={defineLoopStart}>Définir A <kbd>{shortcutLabel(shortcuts.loopStart)}</kbd></button>
                        <button type="button" role="menuitem" onClick={defineLoopEnd}>Définir B <kbd>{shortcutLabel(shortcuts.loopEnd)}</kbd></button>
                        <button type="button" role="menuitem" disabled={transport.loopStart == null || transport.loopEnd == null} onClick={changeLoopEnabled}>
                          {transport.loopEnabled ? "Désactiver la boucle" : "Activer la boucle"}
                        </button>
                        <button type="button" role="menuitem" disabled={transport.loopStart == null && transport.loopEnd == null} onClick={clearLoop}>Réinitialiser</button>
                      </div>
                    )}
                  </div>
                  <div className="comparison-control">
                    <AppIconButton
                      label="Comparer deux images"
                      active={Boolean(comparison.a && comparison.b)}
                      aria-expanded={comparisonMenuOpen}
                      aria-haspopup="menu"
                      buttonRef={comparisonMenuButtonRef}
                      onClick={() => setComparisonMenuOpen((open) => !open)}
                    ><Columns size={19} /></AppIconButton>
                    {comparisonMenuOpen && (
                      <div ref={comparisonMenuRef} className="transport-popover comparison-popover" role="menu" aria-label="Comparaison d’images">
                        <div className="loop-summary">
                          <span>A <time>{comparison.a ? displayTimecode(comparison.a.time) : "—"}</time></span>
                          <span>B <time>{comparison.b ? displayTimecode(comparison.b.time) : "—"}</time></span>
                        </div>
                        <button type="button" role="menuitem" onClick={() => pinCurrentComparison("a")}>Épingler l’image actuelle en A</button>
                        <button type="button" role="menuitem" onClick={() => pinCurrentComparison("b")}>Épingler l’image actuelle en B</button>
                        <button type="button" role="menuitem" disabled={!comparison.a || !comparison.b} onClick={openComparison}>Ouvrir la comparaison</button>
                        <button type="button" role="menuitem" disabled={!comparison.a && !comparison.b} onClick={resetComparison}>Réinitialiser</button>
                      </div>
                    )}
                  </div>
                  <AppIconButton label={`${silentPlayback ? "Désactiver" : "Activer"} la lecture silencieuse (${shortcutLabel(shortcuts.silent)})`} active={silentPlayback} aria-pressed={silentPlayback} onClick={toggleSilentPlayback}>
                    <Play size={18} />
                  </AppIconButton>
                  <AppIconButton label={isMuted ? `Rétablir le son (${shortcutLabel(shortcuts.mute)})` : `Couper le son (${shortcutLabel(shortcuts.mute)})`} active={isMuted} aria-pressed={isMuted} onClick={toggleMute}>
                    {isMuted ? <SpeakerSlash size={19} /> : <SpeakerHigh size={19} />}
                  </AppIconButton>
                  <AppIconButton label="Importer des sous-titres" onClick={importSubtitle}><Subtitles size={19} /></AppIconButton>
                  <AppIconButton label="Plein écran" onClick={() => viewerRef.current?.requestFullscreen?.()}><CornersOut size={19} /></AppIconButton>
                </div>
              </div>

              <div className="annotation-toolbar" aria-label="Outils d’annotation">
                <button className={activeTool === "note" ? "active" : ""} onClick={() => setActiveTool("note")} title="Ajouter une note à cet endroit"><Note size={17} /> <span>Note</span></button>
                <button className={activeTool === "arrow" ? "active" : ""} onClick={() => setActiveTool("arrow")} title="Tracer une flèche"><ArrowUpRight size={17} /> <span>Flèche</span></button>
                <button className={activeTool === "rect" ? "active" : ""} onClick={() => setActiveTool("rect")} title="Encadrer une zone"><Rectangle size={17} /> <span>Rectangle</span></button>
                <button className={activeTool === "point" ? "active" : ""} onClick={() => setActiveTool("point")} title="Placer un point"><Circle size={15} /> <span>Point</span></button>
                <button className={activeTool === "pencil" ? "active" : ""} onClick={() => setActiveTool("pencil")} title="Dessiner à main levée"><PencilSimple size={17} /> <span>Crayon</span></button>
                {activeTool === "pencil" && (
                  <div className="pencil-width-control" role="group" aria-label="Épaisseur du crayon">
                    {[2, 4, 7].map((width) => (
                      <button
                        key={width}
                        type="button"
                        className={pencilWidth === width ? "active" : ""}
                        aria-label={`Crayon ${width === 2 ? "fin" : width === 4 ? "moyen" : "épais"}`}
                        aria-pressed={pencilWidth === width}
                        onClick={() => setPencilWidth(width)}
                      ><span style={{ width, height: width }} /></button>
                    ))}
                  </div>
                )}
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
                ref={timelineTrackRef}
                className={`timeline-track ${timelineScrubbing ? "scrubbing" : ""}`}
                role="slider"
                aria-label="Position dans le film"
                aria-valuemin="0"
                aria-valuemax={timelineDuration}
                aria-valuenow={Math.round(currentTime * 1000) / 1000}
                aria-valuetext={displayTimecode(currentTime)}
                tabIndex={0}
                onKeyDown={(event) => {
                  const target = timelineKeyboardTarget(event.key, currentTime, timelineDuration, frameRate);
                  if (target == null) return;
                  event.preventDefault();
                  seekTo(target);
                }}
                onPointerDown={startTimelineScrub}
                onPointerMove={moveTimelineScrub}
                onPointerUp={finishTimelineScrub}
                onPointerCancel={(event) => {
                  if (timelineScrubRef.current.pointerId !== event.pointerId) return;
                  if (timelineScrubRef.current.frame != null) {
                    window.cancelAnimationFrame(timelineScrubRef.current.frame);
                  }
                  timelineScrubRef.current.frame = null;
                  timelineScrubRef.current.pending = null;
                  timelineScrubRef.current.pointerId = null;
                  setTimelineScrubbing(false);
                }}
              >
                <div className="timeline-ruler" />
                {[0, 0.25, 0.5, 0.75, 1].map((position) => {
                  const time = position * timelineDuration;
                  return <span key={position} className="timeline-label" style={{ left: `${position * 100}%` }}>{displayTimecode(time).slice(0, 8)}</span>;
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
                    aria-label={`${marker.title}, ${markerIsRange(marker) ? `plage de ${displayTimecode(marker.time)} à ${displayTimecode(marker.endTime)}` : displayTimecode(marker.time)}${marker.bookmarked ? ", signet" : ""}`}
                    title={marker.title}
                  />
                ))}
                {transport.loopStart != null && transport.loopEnd != null && (
                  <span
                    className={`timeline-loop-range ${transport.loopEnabled ? "active" : ""}`}
                    style={{
                      left: `${clamp((transport.loopStart / timelineDuration) * 100, 0, 100)}%`,
                      width: `${Math.max(((transport.loopEnd - transport.loopStart) / timelineDuration) * 100, 0.35)}%`,
                    }}
                    aria-hidden="true"
                  />
                )}
                {transport.loopStart != null && (
                  <span className="timeline-loop-point start" style={{ left: `${clamp((transport.loopStart / timelineDuration) * 100, 0, 100)}%` }} aria-hidden="true">A</span>
                )}
                {transport.loopEnd != null && (
                  <span className="timeline-loop-point end" style={{ left: `${clamp((transport.loopEnd / timelineDuration) * 100, 0, 100)}%` }} aria-hidden="true">B</span>
                )}
                <span className="timeline-playhead" style={{ left: `${clamp((currentTime / timelineDuration) * 100, 0, 100)}%` }} />
              </div>

              <div className="marker-context">
                <span className="context-icon" style={{ color: selectedMarker.color }}>{markerIcon(selectedMarker.type, 17)}</span>
                <time>{displayTimecode(selectedMarker.time)}{markerIsRange(selectedMarker) ? ` – ${displayTimecode(selectedMarker.endTime)}` : ""}</time>
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
                {visibleMarkers.map((marker) => {
                  const actionsOpen = historyActionsMarkerId === marker.id;
                  return (
                    <div key={marker.id} className={`note-history-item ${actionsOpen ? "actions-open" : ""}`}>
                      <button className={`note-row ${marker.id === selectedMarkerId ? "selected" : ""}`} aria-expanded={actionsOpen} onClick={() => selectMarker(marker, true)}>
                        <span className="note-type" style={{ color: marker.color }}>{markerIcon(marker.type)}{marker.bookmarked && <i title="Signet"><BookmarkSimple size={10} weight="fill" /></i>}</span>
                        <time>{displayTimecode(marker.time)}{markerIsRange(marker) && <small>→ {displayTimecode(marker.endTime)}</small>}</time>
                        <span className="note-copy">{marker.detail || marker.title}</span>
                        <span className="note-tag">{marker.tag}</span>
                      </button>
                      {actionsOpen && (
                        <div className="note-row-actions" aria-label={`Actions pour ${marker.title}`}>
                          <button type="button" onClick={() => openComposer(marker.type, null, marker)}><Note size={15} /> Modifier</button>
                          <button type="button" onClick={() => duplicateSelectedMarker(marker)}><Plus size={15} /> Dupliquer</button>
                          <button type="button" aria-pressed={Boolean(marker.bookmarked)} onClick={() => toggleMarkerBookmark(marker.id)}><BookmarkSimple size={15} weight={marker.bookmarked ? "fill" : "regular"} /> {marker.bookmarked ? "Retirer le signet" : "Signet"}</button>
                          <button type="button" className="danger" onClick={() => requestMarkerDeletion(marker)}><Trash size={15} /> Supprimer</button>
                          <AppIconButton label="Refermer les actions" onClick={() => setHistoryActionsMarkerId(null)}><X size={14} /></AppIconButton>
                        </div>
                      )}
                    </div>
                  );
                })}
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
                <button className={activeEditorTab === "script" ? "active" : ""} onClick={() => setActiveEditorTab("script")}>Scénario</button>
                <button className={activeEditorTab === "transcript" ? "active" : ""} onClick={() => setActiveEditorTab("transcript")}>Transcription</button>
                <button className={activeEditorTab === "plans" ? "active" : ""} onClick={() => setActiveEditorTab("plans")}>Plans</button>
              </div>
              <span className="editor-format-badge">{activeEditorTab === "script" ? "Fountain" : activeEditorTab === "notes" ? "Markdown" : activeEditorTab === "transcript" ? "Sous-titres" : "Découpage"}</span>
              {activeEditorTab === "script" && (
                <div className="scene-nav">
                  <AppIconButton label="Scène précédente" disabled={!scriptScenes.length || scene <= 1} onClick={() => navigateScene(-1)}><CaretLeft size={17} /></AppIconButton>
                  <span title={scriptScenes[scene - 1]?.heading || "Aucune scène détectée"}>
                    {scriptScenes.length ? `Scène ${scene}` : "Aucune scène"}
                    {scriptScenes.length > 0 && <i className="scene-link-dot" title="Scène Fountain détectée" />}
                  </span>
                  <AppIconButton label="Scène suivante" disabled={!scriptScenes.length || scene >= scriptScenes.length} onClick={() => navigateScene(1)}><CaretRight size={17} /></AppIconButton>
                </div>
              )}
            </div>

            {activeEditorTab === "script" ? (
              <ScriptEditor
                value={script}
                onChange={setScript}
                onComplete={() => setToast("Complétion acceptée avec Tab")}
                completionContext={completionContext}
                selectionRequest={sceneSelectionRequest}
                onSelectionChange={trackSceneAtOffset}
              />
            ) : activeEditorTab === "notes" ? (
              <div className="analysis-surface">
                <div className="analysis-title"><Note size={18} /> Analyse de la scène</div>
                <textarea value={analysis} onChange={(event) => setAnalysis(event.target.value)} aria-label="Notes d’analyse en Markdown" maxLength={2_000_000} />
              </div>
            ) : activeEditorTab === "transcript" ? (
              <TranscriptView
                cues={subtitleCues}
                filteredCues={filteredSubtitleCues}
                activeIndex={activeSubtitleIndex}
                query={transcriptSearch}
                onQueryChange={setTranscriptSearch}
                onSeek={seekToSubtitle}
                onCreateNote={openSubtitleNote}
                onImport={importSubtitle}
                listRef={transcriptListRef}
                formatTimecode={displayTimecode}
              />
            ) : (
              <PlansView
                rows={visiblePlanMarkers}
                allRows={planMarkers}
                query={shotQuery}
                onQueryChange={setShotQuery}
                typeFilter={shotTypeFilter}
                onTypeFilterChange={setShotTypeFilter}
                tagFilter={shotTagFilter}
                onTagFilterChange={setShotTagFilter}
                sort={shotSort}
                onSort={changeShotSort}
                onSeek={seekToPlan}
                onUpdateField={updatePlanField}
                onUpdateTime={updatePlanTime}
                onCreateRange={openPlanComposer}
                onResetFilters={resetShotFilters}
                loadThumbnail={loadPlanThumbnail}
                fallbackThumbnail={projectCoverImage(activeProject) || "./assets/mediterranean-frame.png"}
                formatTimecode={displayTimecode}
                formatDuration={displayDuration}
              />
            )}

            <footer className="editor-status">
              <span><BookmarkSimple size={15} weight="fill" /> Note liée : {selectedMarker.title}</span>
              <div>
                <span>{activeEditorTab === "script" ? "Fountain" : activeEditorTab === "notes" ? "Markdown" : activeEditorTab === "transcript" ? (subtitleName || "Transcription") : "Plans"}</span>
                <span>{activeEditorTab === "transcript" ? `${subtitleCues.length} répliques` : activeEditorTab === "plans" ? `${planMarkers.length} plans` : `${(activeEditorTab === "script" ? script.length : analysis.length).toLocaleString("fr-FR")} caractères`}</span>
                <Check size={16} className="saved-check" />
              </div>
            </footer>
          </section>
        </section>
      </div>

      {metadataOpen && (
        <aside className="metadata-drawer">
          <div className="drawer-heading"><strong>Métadonnées</strong><AppIconButton label="Fermer" onClick={() => setMetadataOpen(false)}><X size={18} /></AppIconButton></div>
          <ProjectCover project={activeProject} className="metadata-cover" decorative={false} />
          <h2>{activeProject?.title || "Projet local"}</h2>
          <p>{activeProject?.detail || "Analyse locale"}{mediaPath ? " · Fichier local" : " · France · 1963"}</p>
          {activeProject?.tmdb?.overview && <p className="tmdb-overview">{activeProject.tmdb.overview}</p>}
          <dl>
            {metadataRows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
          </dl>
          <section className="timecode-settings" aria-label="Réglages de timecode">
            <div className="timecode-settings-heading">
              <strong>Timecode</strong>
              <span>{timecodeSettings.dropFrame ? "DF" : "NDF"}</span>
            </div>
            <label>
              <span>Cadence</span>
              <select value={timecodeSettings.source === "auto" ? "auto" : timecodeSettings.rate} onChange={(event) => chooseTimecodeRate(event.target.value)}>
                <option value="auto">Auto ({timecodeRate(detectedFrameRate).label} i/s)</option>
                {TIMECODE_RATES.map((rate) => <option key={rate.value} value={rate.value}>{rate.label} i/s</option>)}
              </select>
            </label>
            <label>
              <span>Offset</span>
              <input
                value={timecodeOffsetDraft}
                onChange={(event) => setTimecodeOffsetDraft(event.target.value)}
                onBlur={commitTimecodeOffset}
                onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
                aria-label="Offset de timecode"
                placeholder={timecodeSettings.dropFrame ? "01:00:00;00" : "01:00:00:00"}
              />
            </label>
            <label className={`timecode-drop-toggle ${timecodeSettings.rate !== "30000/1001" ? "disabled" : ""}`}>
              <span><strong>Drop-frame</strong><small>Disponible à 29,97 i/s</small></span>
              <input
                type="checkbox"
                disabled={timecodeSettings.rate !== "30000/1001"}
                checked={timecodeSettings.dropFrame}
                onChange={(event) => updateActiveTimecode(changeDropFrame(timecodeSettings, event.target.checked))}
              />
            </label>
          </section>
          {mediaPath && nativeMode && <button className="drawer-action secondary" onClick={async () => {
            try {
              await nativeBridge.call("revealInFinder", { path: mediaPath });
            } catch (error) {
              setToast(error.message);
            }
          }}><FolderOpen size={16} /> Révéler dans le Finder</button>}
          {activeProject?.tmdb?.sourceURL && <button className="drawer-action secondary" onClick={() => openExternal(activeProject.tmdb.sourceURL)}><LinkSimple size={16} /> Voir la fiche TMDB</button>}
          <button className="drawer-action secondary" onClick={() => beginCoverEdit(activeProject)}><ImageIcon size={16} /> Modifier la couverture</button>
          <button className="drawer-action" onClick={openTMDB}>{activeProject?.tmdb ? "Actualiser via TMDB" : "Enrichir via TMDB"} <ArrowUpRight size={16} /></button>
          <span className="local-only"><Check size={15} /> Fichier et analyse stockés localement</span>
        </aside>
      )}

      <ModalDialog
        open={shortcutsOpen}
        onClose={() => { setShortcutsOpen(false); setCapturingShortcut(null); }}
        labelledBy="shortcuts-dialog-title"
        className="shortcuts-dialog"
        initialFocusRef={shortcutsInitialFocusRef}
        onKeyDownCapture={captureShortcutKey}
      >
        <div className="composer-heading">
          <div><span>Préférences locales</span><h2 id="shortcuts-dialog-title">Raccourcis clavier</h2></div>
          <AppIconButton label="Fermer" type="button" onClick={() => { setShortcutsOpen(false); setCapturingShortcut(null); }}><X size={19} /></AppIconButton>
        </div>
        <div className="shortcut-list">
          {SHORTCUT_ROWS.map(([action, label, group], index) => (
            <div key={action} className="shortcut-row">
              <span><strong>{label}</strong><small>{group}</small></span>
              <button
                ref={index === 0 ? shortcutsInitialFocusRef : null}
                type="button"
                className={capturingShortcut === action ? "capturing" : ""}
                aria-pressed={capturingShortcut === action}
                onClick={() => setCapturingShortcut(action)}
              >
                {capturingShortcut === action ? "Appuyez sur une touche…" : <kbd>{shortcutLabel(shortcuts[action])}</kbd>}
              </button>
            </div>
          ))}
        </div>
        <div className="shortcut-footer">
          <span>{capturingShortcut ? "Échap annule la saisie." : "Une touche déjà utilisée sera échangée automatiquement."}</span>
          <div className="composer-actions">
            <button type="button" onClick={() => { setShortcuts({ ...DEFAULT_SHORTCUTS }); setCapturingShortcut(null); setToast("Raccourcis par défaut restaurés"); }}>Réinitialiser</button>
            <button className="primary" type="button" onClick={() => { setShortcutsOpen(false); setCapturingShortcut(null); }}>Terminé</button>
          </div>
        </div>
      </ModalDialog>

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
            <label><FileText size={18} /><span><strong>Scénario</strong><small>Fichier .fountain</small></span><input ref={exportInitialFocusRef} type="checkbox" checked={exportOptions.script} onChange={(event) => setExportOptions((current) => ({ ...current, script: event.target.checked }))} /></label>
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
            <label><Package size={18} /><span><strong>Projet Cinécrique</strong><small>Format .cinecrique réimportable</small></span><input type="checkbox" checked={exportOptions.project} onChange={(event) => setExportOptions((current) => ({ ...current, project: event.target.checked, portableProject: event.target.checked ? current.portableProject : false }))} /></label>
            {exportOptions.project && (
              <label className={`export-suboption ${!mediaPath || activeProject?.mediaMissing ? "disabled" : ""}`}>
                <FilmStrip size={17} />
                <span><strong>Inclure la vidéo</strong><small>Projet portable, fichier plus volumineux</small></span>
                <input type="checkbox" disabled={!mediaPath || activeProject?.mediaMissing} checked={exportOptions.portableProject} onChange={(event) => setExportOptions((current) => ({ ...current, portableProject: event.target.checked }))} />
              </label>
            )}
          </fieldset>
          {nativeMode && (
            <fieldset className="report-export-fieldset">
              <legend>Rapport professionnel</legend>
              <div className="report-format-options">
                <label><FileText size={18} /><span><strong>Rapport HTML</strong><small>Document autonome et imprimable</small></span><input type="checkbox" checked={exportOptions.reportHtml} onChange={(event) => setReportFormat("reportHtml", event.target.checked)} /></label>
                <label><FileText size={18} /><span><strong>Rapport PDF</strong><small>PDF A4 paginé, généré localement</small></span><input type="checkbox" checked={exportOptions.reportPdf} onChange={(event) => setReportFormat("reportPdf", event.target.checked)} /></label>
              </div>
              {(exportOptions.reportHtml || exportOptions.reportPdf) && (
                <div className="report-section-options">
                  <div className="report-section-grid" aria-label="Sections du rapport">
                    {[
                      ["projectInfo", "Informations projet"],
                      ["markers", "Repères timecodés"],
                      ["shots", "Tableau des plans"],
                      ["analysis", "Analyse Markdown"],
                      ["images", "Images annotées"],
                    ].map(([key, label]) => (
                      <label className="report-section-toggle" key={key}>
                        <input type="checkbox" checked={reportSelection[key]} onChange={(event) => setReportSelection((current) => ({ ...current, [key]: event.target.checked }))} />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                  {scriptScenes.length > 0 && (
                    <details>
                      <summary>Scènes Fountain · {reportSelection.sceneIndexes.length} sélectionnée{reportSelection.sceneIndexes.length > 1 ? "s" : ""}</summary>
                      <div className="report-checklist">
                        {scriptScenes.map((scriptScene) => (
                          <label key={scriptScene.index}>
                            <input type="checkbox" checked={reportSelection.sceneIndexes.includes(scriptScene.index)} onChange={() => toggleReportListValue("sceneIndexes", scriptScene.index)} />
                            <span><strong>Scène {scriptScene.number}</strong><small>{scriptScene.heading}</small></span>
                          </label>
                        ))}
                      </div>
                    </details>
                  )}
                  {reportSelection.images && annotatedFrames.length > 0 && (
                    <details>
                      <summary>Images annotées · {selectedReportFrames.length}/{Math.min(annotatedFrames.length, 100)}</summary>
                      <div className="report-checklist">
                        {annotatedFrames.slice(0, 100).map(({ marker }) => {
                          const id = String(marker.id);
                          return (
                            <label key={id}>
                              <input type="checkbox" checked={reportSelection.imageMarkerIds.includes(id)} onChange={() => toggleReportListValue("imageMarkerIds", id)} />
                              <span><strong>{displayTimecode(marker.time)}</strong><small>{marker.title}</small></span>
                            </label>
                          );
                        })}
                      </div>
                    </details>
                  )}
                  {reportSelection.images && !annotatedFrames.length && <p className="report-empty">Aucune image annotée dans ce projet.</p>}
                  {!reportSelectionHasContent(reportSelection) && <p className="report-warning">Sélectionnez au moins une section.</p>}
                </div>
              )}
            </fieldset>
          )}
        </div>
        <div className="export-footer">
          <span>{selectedExportCount} élément{selectedExportCount > 1 ? "s" : ""}{selectedExportCount > 1 ? " · archive ZIP" : ""}</span>
          <div className="composer-actions"><button type="button" disabled={exporting} onClick={() => setExportOpen(false)}>Annuler</button><button className="primary" type="submit" disabled={exporting || !selectedExportCount}><DownloadSimple size={17} /> {exporting ? "Export…" : "Exporter"}</button></div>
        </div>
      </ModalDialog>

      <ModalDialog
        open={comparisonOpen}
        onClose={() => !comparisonExporting && setComparisonOpen(false)}
        labelledBy="comparison-dialog-title"
        className="comparison-dialog"
        initialFocusRef={comparisonInitialFocusRef}
        returnFocusRef={comparisonMenuButtonRef}
      >
        <div className="composer-heading comparison-heading">
          <div><span>Comparaison d’images</span><h2 id="comparison-dialog-title">Cadres A et B</h2></div>
          <div className="comparison-heading-actions">
            <label><input type="checkbox" checked={comparison.syncZoom} onChange={(event) => {
              const syncZoom = event.target.checked;
              setComparison((current) => ({ ...current, syncZoom }));
              if (syncZoom) setComparisonZoom((current) => ({ a: current.a, b: current.a }));
            }} /> Synchroniser le zoom</label>
            <AppIconButton buttonRef={comparisonInitialFocusRef} label="Fermer" type="button" disabled={comparisonExporting} onClick={() => setComparisonOpen(false)}><X size={19} /></AppIconButton>
          </div>
        </div>
        {comparison.a && comparison.b && (
          <div className="comparison-grid">
            {(["a", "b"]).map((slot) => (
              <ComparisonFrameView
                key={slot}
                slot={slot}
                reference={comparison[slot]}
                title={comparisonMarkers[slot]?.title || `Image ${slot.toUpperCase()}`}
                timecode={displayTimecode(comparison[slot].time)}
                annotations={comparisonFrameAnnotations[slot]}
                loadFrame={loadComparisonFrame}
                zoom={comparisonZoom[slot]}
                pan={comparisonPan[slot]}
                onZoom={(value) => changeComparisonZoom(slot, value)}
                onPan={(value) => setComparisonPan((current) => ({ ...current, [slot]: value }))}
              />
            ))}
          </div>
        )}
        <label className="comparison-note">
          <span>Note comparative</span>
          <textarea value={comparison.note} maxLength={20_000} onChange={(event) => setComparison((current) => ({ ...current, note: event.target.value }))} placeholder="Rapprochez le cadre, la lumière, le mouvement ou le jeu…" />
        </label>
        <div className="comparison-footer">
          <button type="button" onClick={resetComparison}>Réinitialiser</button>
          <div className="composer-actions">
            <button type="button" disabled={comparisonExporting} onClick={() => setComparisonOpen(false)}>Fermer</button>
            {nativeMode && <button className="primary" type="button" disabled={comparisonExporting || !mediaPath || activeProject?.mediaMissing} onClick={exportComparison}><DownloadSimple size={17} /> {comparisonExporting ? "Export…" : "Exporter en PNG"}</button>}
          </div>
        </div>
      </ModalDialog>

      <ModalDialog
        open={Boolean(coverEditorProject)}
        onClose={() => !coverLoading && setCoverEditorProjectId(null)}
        labelledBy="cover-dialog-title"
        className="cover-dialog"
        initialFocusRef={coverInitialFocusRef}
        returnFocusRef={projectMenuButtonRef}
      >
        <div className="composer-heading">
          <div><span>Projet local</span><h2 id="cover-dialog-title">Couverture du projet</h2></div>
          <AppIconButton label="Fermer" type="button" disabled={coverLoading} onClick={() => setCoverEditorProjectId(null)}><X size={19} /></AppIconButton>
        </div>
        <div className="cover-editor-body">
          <ProjectCover project={{ ...coverEditorProject, cover: coverDraft }} className="cover-editor-preview" decorative={false} />
          <div className="cover-source-options">
            <button ref={coverInitialFocusRef} type="button" disabled={coverLoading} onClick={chooseProjectCoverImage}><ImageIcon size={17} /><span><strong>Image locale</strong><small>JPEG, PNG, WebP ou HEIC</small></span></button>
            {nativeMode && coverEditorProject?.tmdb?.posterPath && <button type="button" disabled={coverLoading} onClick={downloadProjectTMDBCover}><MapPin size={17} /><span><strong>Affiche TMDB</strong><small>Téléchargée puis intégrée au projet</small></span></button>}
            <button type="button" disabled={coverLoading || coverEditorProject?.id !== activeProject?.id || !mediaPath || activeProject?.mediaMissing} onClick={captureProjectCoverFrame}><FrameCorners size={17} /><span><strong>Image actuelle</strong><small>Photogramme au timecode affiché</small></span></button>
            <button type="button" className={coverDraft.mode === "text" ? "active" : ""} disabled={coverLoading} onClick={() => setCoverDraft({ mode: "text", text: coverDraft.text || coverEditorProject?.title || "" })}><FileText size={17} /><span><strong>Texte</strong><small>Fond noir et titre personnalisé</small></span></button>
            <button type="button" className={coverDraft.mode === "logo" ? "active" : ""} disabled={coverLoading} onClick={() => setCoverDraft({ mode: "logo" })}><FrameCorners size={17} /><span><strong>Logo Cinécrique</strong><small>Fond noir, sans affiche</small></span></button>
          </div>
        </div>
        {coverDraft.mode === "text" && (
          <label className="cover-text-field">Texte de la couverture
            <input value={coverDraft.text || ""} maxLength={120} onChange={(event) => setCoverDraft({ mode: "text", text: event.target.value })} placeholder={coverEditorProject?.title || "Titre du projet"} />
          </label>
        )}
        <input ref={coverFileInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/tiff" hidden onChange={(event) => { void importBrowserCover(event.target.files?.[0]); event.target.value = ""; }} />
        <div className="cover-dialog-footer">
          <span>{coverLoading ? "Préparation de l’image…" : coverDraft.mode === "image" ? "Image intégrée au projet" : coverDraft.mode === "text" ? "Couverture typographique" : "Couverture Cinécrique"}</span>
          <div className="composer-actions"><button type="button" disabled={coverLoading} onClick={() => setCoverEditorProjectId(null)}>Annuler</button><button className="primary" type="button" disabled={coverLoading} onClick={saveProjectCover}><Check size={16} /> Enregistrer</button></div>
        </div>
      </ModalDialog>

      <ModalDialog
        open={Boolean(renamingProject)}
        onClose={() => setRenamingProjectId(null)}
        labelledBy="project-rename-title"
        className="note-composer project-rename-dialog"
        as="form"
        initialFocusRef={projectRenameInputRef}
        returnFocusRef={projectMenuButtonRef}
        onSubmit={saveProjectRename}
      >
        <div className="composer-heading">
          <div><span>Projet local</span><h2 id="project-rename-title">Renommer le projet</h2></div>
          <AppIconButton label="Fermer" type="button" onClick={() => setRenamingProjectId(null)}><X size={19} /></AppIconButton>
        </div>
        <label>
          <span>Nom du projet</span>
          <input
            ref={projectRenameInputRef}
            value={projectNameDraft}
            maxLength={500}
            onChange={(event) => setProjectNameDraft(event.target.value)}
            autoComplete="off"
          />
        </label>
        <div className="composer-actions">
          <button type="button" onClick={() => setRenamingProjectId(null)}>Annuler</button>
          <button className="primary" type="submit" disabled={!projectNameDraft.trim()}>Renommer</button>
        </div>
      </ModalDialog>

      <ModalDialog
        open={Boolean(confirmation)}
        onClose={() => setConfirmation(null)}
        labelledBy="confirmation-title"
        className="confirmation-dialog"
        initialFocusRef={confirmationCancelRef}
        returnFocusRef={confirmation?.returnFocusRef || markerMenuButtonRef}
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
