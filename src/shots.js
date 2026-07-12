export const SHOT_TYPES = [
  "Très gros plan",
  "Gros plan",
  "Plan rapproché",
  "Plan moyen",
  "Plan américain",
  "Plan d’ensemble",
  "Plan général",
  "Insert",
  "Autre",
];

export const SHOT_MOVEMENTS = [
  "Fixe",
  "Panoramique",
  "Travelling",
  "Zoom",
  "Épaule",
  "Steadicam",
  "Grue",
  "Drone",
  "Autre",
];

function text(value, maximum = 500) {
  return String(value || "").slice(0, maximum);
}

export function normalizeShot(value = {}) {
  return {
    shotType: text(value?.shotType, 100),
    movement: text(value?.movement, 100),
    characters: text(value?.characters, 500),
    sound: text(value?.sound, 500),
  };
}

export function shotIsRange(marker) {
  return Number.isFinite(Number(marker?.endTime)) && Number(marker.endTime) > Number(marker.time);
}

export function shotRows(markers) {
  return (Array.isArray(markers) ? markers : []).filter(shotIsRange);
}

export function updateShotMarker(marker, field, value) {
  if (!shotIsRange(marker)) return marker;
  if (field === "title") return { ...marker, title: text(value, 200) };
  if (field === "comment") return { ...marker, detail: text(value, 20_000) };
  if (field === "tag") return { ...marker, tag: text(value, 80) };
  if (!["shotType", "movement", "characters", "sound"].includes(field)) return marker;
  return { ...marker, shot: { ...normalizeShot(marker.shot), [field]: text(value, field === "characters" || field === "sound" ? 500 : 100) } };
}

function sortValue(marker, key) {
  if (key === "start") return Number(marker.time) || 0;
  if (key === "end") return Number(marker.endTime) || 0;
  if (key === "duration") return (Number(marker.endTime) || 0) - (Number(marker.time) || 0);
  if (key === "title") return marker.title || "";
  if (key === "tag") return marker.tag || "";
  return normalizeShot(marker.shot)[key] || "";
}

export function filterAndSortShots(markers, options = {}) {
  const query = text(options.query, 200).trim().toLocaleLowerCase("fr");
  const type = text(options.type, 100);
  const tag = text(options.tag, 80);
  const direction = options.direction === "desc" ? -1 : 1;
  const key = ["start", "end", "duration", "title", "shotType", "movement", "characters", "sound", "tag"].includes(options.sortKey)
    ? options.sortKey
    : "start";

  return shotRows(markers).filter((marker) => {
    const shot = normalizeShot(marker.shot);
    const searchable = `${marker.title || ""} ${marker.detail || ""} ${marker.tag || ""} ${shot.shotType} ${shot.movement} ${shot.characters} ${shot.sound}`.toLocaleLowerCase("fr");
    return (!query || searchable.includes(query))
      && (!type || shot.shotType === type)
      && (!tag || marker.tag === tag);
  }).sort((left, right) => {
    const a = sortValue(left, key);
    const b = sortValue(right, key);
    if (typeof a === "number" && typeof b === "number") return (a - b) * direction;
    return String(a).localeCompare(String(b), "fr", { sensitivity: "base" }) * direction;
  });
}
