const MARKER_TYPES = new Set(["note", "link", "frame"]);

export function markerIsRange(marker) {
  return Number.isFinite(Number(marker?.endTime)) && Number(marker.endTime) > Number(marker.time);
}

export function migrateMarker(marker, legacyRangeSeconds = 5) {
  const time = Math.max(0, Number(marker?.time) || 0);
  const type = MARKER_TYPES.has(marker?.type) ? marker.type : "note";
  const migrated = {
    ...marker,
    time,
    type,
    title: String(marker?.title || "Repère sans titre"),
    detail: String(marker?.detail || ""),
    tag: String(marker?.tag || ""),
    bookmarked: Boolean(marker?.bookmarked),
  };

  const rawEnd = Number(marker?.endTime);
  if (Number.isFinite(rawEnd) && rawEnd > time) {
    migrated.endTime = rawEnd;
  } else if (marker?.scope === "range" || marker?.tag === "Séquence") {
    migrated.endTime = time + legacyRangeSeconds;
  } else {
    delete migrated.endTime;
  }
  delete migrated.scope;
  return migrated;
}

export function migrateMarkers(markers, legacyRangeSeconds = 5) {
  return (Array.isArray(markers) ? markers : [])
    .filter((marker) => marker && typeof marker === "object" && !Array.isArray(marker))
    .map((marker) => migrateMarker(marker, legacyRangeSeconds));
}

export function filterMarkers(markers, search = "", filters = {}) {
  const query = search.trim().toLocaleLowerCase("fr");
  const types = new Set(filters.types || []);
  const tags = new Set(filters.tags || []);
  const from = filters.from != null && filters.from !== "" && Number.isFinite(Number(filters.from)) ? Number(filters.from) : null;
  const to = filters.to != null && filters.to !== "" && Number.isFinite(Number(filters.to)) ? Number(filters.to) : null;

  return (markers || []).filter((marker) => {
    const markerEnd = markerIsRange(marker) ? Number(marker.endTime) : Number(marker.time);
    const searchable = `${marker.title || ""} ${marker.detail || ""} ${marker.tag || ""}`.toLocaleLowerCase("fr");
    if (query && !searchable.includes(query)) return false;
    if (types.size && !types.has(marker.type)) return false;
    if (tags.size && !tags.has(marker.tag)) return false;
    if (filters.bookmarkedOnly && !marker.bookmarked) return false;
    if (from != null && markerEnd < from) return false;
    if (to != null && Number(marker.time) > to) return false;
    return true;
  });
}

export function duplicateMarker(marker, id, offset = 1) {
  const start = Math.max(0, Number(marker.time) + offset);
  const duration = markerIsRange(marker) ? Number(marker.endTime) - Number(marker.time) : null;
  return {
    ...marker,
    id,
    time: start,
    ...(duration == null ? { endTime: undefined } : { endTime: start + duration }),
    title: `${marker.title} — copie`,
    bookmarked: false,
  };
}

export function removeMarker(markers, annotationsByMarker, markerId) {
  const annotations = { ...(annotationsByMarker || {}) };
  delete annotations[markerId];
  return {
    markers: (markers || []).filter((marker) => marker.id !== markerId),
    annotationsByMarker: annotations,
  };
}

export function parseTimecode(value, frameRate = 24) {
  const input = String(value || "").trim();
  const frameMatch = input.match(/^(\d{1,2}):(\d{2}):(\d{2}):(\d{2})$/);
  if (frameMatch) {
    const [, hh, mm, ss, ff] = frameMatch.map(Number);
    const nominalRate = Math.max(1, Math.round(Number(frameRate) || 24));
    if (mm >= 60 || ss >= 60 || ff >= nominalRate) return null;
    return hh * 3600 + mm * 60 + ss + ff / nominalRate;
  }

  const decimalMatch = input.match(/^(\d{1,2}):(\d{2}):(\d{2})(?:[.,](\d{1,3}))?$/);
  if (!decimalMatch) return null;
  const hh = Number(decimalMatch[1]);
  const mm = Number(decimalMatch[2]);
  const ss = Number(decimalMatch[3]);
  if (mm >= 60 || ss >= 60) return null;
  const fraction = decimalMatch[4] ? Number(`0.${decimalMatch[4].padEnd(3, "0")}`) : 0;
  return hh * 3600 + mm * 60 + ss + fraction;
}

export function timelineKeyboardTarget(key, currentTime, duration, frameRate = 24) {
  const frame = 1 / Math.max(Number(frameRate) || 24, 1);
  const deltas = {
    ArrowLeft: -frame,
    ArrowRight: frame,
    ArrowDown: -1,
    ArrowUp: 1,
    PageDown: -10,
    PageUp: 10,
  };
  if (key === "Home") return 0;
  if (key === "End") return Math.max(0, duration);
  if (!(key in deltas)) return null;
  return Math.min(Math.max(currentTime + deltas[key], 0), Math.max(0, duration));
}

export function timelinePointerTarget(clientX, left, width, duration) {
  const safeDuration = Math.max(0, Number(duration) || 0);
  const safeWidth = Number(width);
  if (!Number.isFinite(safeWidth) || safeWidth <= 0) return 0;
  const ratio = (Number(clientX) - Number(left || 0)) / safeWidth;
  return Math.min(Math.max(ratio, 0), 1) * safeDuration;
}
