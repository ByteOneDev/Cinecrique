import { normalizeShot, shotRows } from "./shots.js";

export const MAX_REPORT_IMAGES = 100;

export const defaultReportSelection = () => ({
  projectInfo: true,
  markers: true,
  images: true,
  shots: true,
  analysis: true,
  sceneIndexes: [],
  imageMarkerIds: [],
});

function text(value, maximum = 20_000) {
  return String(value ?? "").slice(0, maximum);
}

function markerId(value) {
  return text(value, 1_024);
}

export function reportSelectionHasContent(selection = {}) {
  return Boolean(
    selection.projectInfo
      || selection.markers
      || selection.shots
      || selection.analysis
      || (selection.sceneIndexes || []).length
      || (selection.images && (selection.imageMarkerIds || []).length),
  );
}

export function reportAnnotatedFrames(annotatedFrames, selectedIds) {
  const allowed = new Set((selectedIds || []).map(markerId));
  return (Array.isArray(annotatedFrames) ? annotatedFrames : [])
    .filter(({ marker }) => allowed.has(markerId(marker?.id)))
    .slice(0, MAX_REPORT_IMAGES);
}

export function buildReportModel({
  project,
  metadataRows,
  markers,
  analysis,
  scenes,
  script,
  selection,
  formatTimecode,
  formatDuration,
  generatedAt,
}) {
  const options = { ...defaultReportSelection(), ...(selection || {}) };
  const sceneIndexes = new Set((options.sceneIndexes || []).map(Number));
  const timecode = typeof formatTimecode === "function" ? formatTimecode : (value) => text(value);
  const duration = typeof formatDuration === "function" ? formatDuration : (value) => text(value);
  const sourceMarkers = Array.isArray(markers) ? markers : [];

  return {
    title: text(project?.title || "Projet Cinécrique", 500),
    subtitle: text(project?.detail || "Analyse filmique", 500),
    generatedAt: text(generatedAt || new Date().toISOString(), 100),
    projectInfo: options.projectInfo ? (metadataRows || []).slice(0, 100).map(([label, value]) => ({
      label: text(label, 200),
      value: text(value, 2_000),
    })) : [],
    markers: options.markers ? sourceMarkers.slice(0, 5_000).map((marker) => ({
      start: timecode(marker.time),
      end: Number(marker.endTime) > Number(marker.time) ? timecode(marker.endTime) : "",
      title: text(marker.title, 500),
      type: text(marker.type, 100),
      tag: text(marker.tag, 200),
      detail: text(marker.detail, 20_000),
      url: text(marker.url, 4_096),
      bookmarked: Boolean(marker.bookmarked),
    })) : [],
    shots: options.shots ? shotRows(sourceMarkers).slice(0, 5_000).map((marker) => {
      const shot = normalizeShot(marker.shot);
      return {
        start: timecode(marker.time),
        end: timecode(marker.endTime),
        duration: duration(Number(marker.endTime) - Number(marker.time)),
        title: text(marker.title, 500),
        shotType: shot.shotType,
        movement: shot.movement,
        characters: shot.characters,
        sound: shot.sound,
        tag: text(marker.tag, 200),
        comment: text(marker.detail, 20_000),
      };
    }) : [],
    analysis: options.analysis ? text(analysis, 2_000_000) : "",
    scenes: (Array.isArray(scenes) ? scenes : []).filter((scene) => sceneIndexes.has(scene.index)).slice(0, 500).map((scene) => ({
      heading: text(scene.heading, 500),
      content: text(String(script || "").slice(scene.start, scene.end), 2_000_000),
    })),
  };
}

