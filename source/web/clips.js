const MAX_CITATION_LENGTH = 240;
const MAX_ATTRIBUTION_LENGTH = 120;
const MAX_NAME_LENGTH = 120;

export const MAX_CLIP_SECONDS = 600;
export const MAX_GIF_SECONDS = 30;
export const MIN_CLIP_SECONDS = 0.04;
export const MAX_BASKET_ITEMS = 60;

export const CLIP_FORMATS = Object.freeze([
  { value: "mp4", label: "MP4", extension: "mp4", detail: "H.264 · montage et publication", audio: true },
  { value: "gif", label: "GIF", extension: "gif", detail: "Boucle courte, sans son", audio: false },
]);

export const STILL_FORMATS = Object.freeze([
  { value: "png", label: "PNG", extension: "png", detail: "Sans perte, pour l’analyse" },
  { value: "jpeg", label: "JPEG", extension: "jpg", detail: "Léger, pour le partage" },
]);

export const CLIP_RESOLUTIONS = Object.freeze([
  { value: 0, label: "Source" },
  { value: 2160, label: "2160p" },
  { value: 1080, label: "1080p" },
  { value: 720, label: "720p" },
  { value: 480, label: "480p" },
]);

export const CLIP_QUALITIES = Object.freeze([
  { value: "high", label: "Haute" },
  { value: "standard", label: "Standard" },
  { value: "light", label: "Légère" },
]);

export const CLIP_MODES = Object.freeze([
  { value: "accurate", label: "Précision image", detail: "Ré-encodage, coupe au timecode exact" },
  { value: "copy", label: "Copie directe", detail: "Sans ré-encodage, coupe au plan-clé le plus proche" },
]);

export const GIF_FRAME_RATES = Object.freeze([8, 12, 15, 20]);

export const WATERMARK_POSITIONS = Object.freeze([
  { value: "top-left", label: "Haut gauche" },
  { value: "top-right", label: "Haut droite" },
  { value: "bottom-left", label: "Bas gauche" },
  { value: "bottom-right", label: "Bas droite" },
  { value: "bottom-center", label: "Bas centré" },
]);

export const WATERMARK_SIZES = Object.freeze([
  { value: "small", label: "Discret" },
  { value: "medium", label: "Moyen" },
  { value: "large", label: "Affirmé" },
]);

const FORMAT_VALUES = new Set(CLIP_FORMATS.map((format) => format.value));
const STILL_FORMAT_VALUES = new Set(STILL_FORMATS.map((format) => format.value));
const RESOLUTION_VALUES = new Set(CLIP_RESOLUTIONS.map((resolution) => resolution.value));
const QUALITY_VALUES = new Set(CLIP_QUALITIES.map((quality) => quality.value));
const MODE_VALUES = new Set(CLIP_MODES.map((mode) => mode.value));
const POSITION_VALUES = new Set(WATERMARK_POSITIONS.map((position) => position.value));
const SIZE_VALUES = new Set(WATERMARK_SIZES.map((size) => size.value));

function text(value, maximum) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .slice(0, maximum)
    .trim();
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function defaultWatermark() {
  return {
    enabled: true,
    source: "subtitle",
    citation: "",
    attribution: "",
    position: "bottom-left",
    size: "medium",
    opacity: 0.9,
    showTimecode: true,
  };
}

export function normalizeWatermark(value) {
  const base = defaultWatermark();
  if (!value || typeof value !== "object") return base;
  return {
    enabled: value.enabled !== false,
    source: ["subtitle", "marker", "custom"].includes(value.source) ? value.source : base.source,
    citation: text(value.citation, MAX_CITATION_LENGTH),
    attribution: text(value.attribution, MAX_ATTRIBUTION_LENGTH),
    position: POSITION_VALUES.has(value.position) ? value.position : base.position,
    size: SIZE_VALUES.has(value.size) ? value.size : base.size,
    opacity: Number(clamp(finite(value.opacity, base.opacity), 0.2, 1).toFixed(2)),
    showTimecode: value.showTimecode !== false,
  };
}

export function defaultClipSettings() {
  return {
    format: "mp4",
    stillFormat: "png",
    maxHeight: 1080,
    quality: "standard",
    mode: "accurate",
    includeAudio: true,
    gifFrameRate: 12,
    watermark: defaultWatermark(),
  };
}

export function normalizeClipSettings(value) {
  const base = defaultClipSettings();
  if (!value || typeof value !== "object") return base;
  const gifFrameRate = GIF_FRAME_RATES.includes(Number(value.gifFrameRate))
    ? Number(value.gifFrameRate)
    : base.gifFrameRate;
  return {
    format: FORMAT_VALUES.has(value.format) ? value.format : base.format,
    stillFormat: STILL_FORMAT_VALUES.has(value.stillFormat) ? value.stillFormat : base.stillFormat,
    maxHeight: RESOLUTION_VALUES.has(Number(value.maxHeight)) ? Number(value.maxHeight) : base.maxHeight,
    quality: QUALITY_VALUES.has(value.quality) ? value.quality : base.quality,
    mode: MODE_VALUES.has(value.mode) ? value.mode : base.mode,
    includeAudio: value.includeAudio !== false,
    gifFrameRate,
    watermark: normalizeWatermark(value.watermark),
  };
}

/**
 * A clip export can never re-encode nothing: a burned-in watermark, a GIF or a
 * downscale always forces the accurate pipeline, whatever the requested mode.
 */
export function effectiveClipMode(settings) {
  const normalized = normalizeClipSettings(settings);
  if (normalized.format === "gif") return "accurate";
  if (normalized.watermark.enabled) return "accurate";
  if (normalized.maxHeight > 0) return "accurate";
  return normalized.mode;
}

export function clipRangeIssue(start, end, { duration = Number.POSITIVE_INFINITY, format = "mp4" } = {}) {
  const from = finite(start, Number.NaN);
  const to = finite(end, Number.NaN);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to < 0) {
    return "Placez un point A et un point B valides.";
  }
  if (to - from < MIN_CLIP_SECONDS) return "Le point B doit être placé après le point A.";
  if (Number.isFinite(duration) && duration > 0 && from >= duration) {
    return "Le point A dépasse la durée du média.";
  }
  const limit = format === "gif" ? MAX_GIF_SECONDS : MAX_CLIP_SECONDS;
  if (to - from > limit) {
    return format === "gif"
      ? `Un GIF ne peut pas dépasser ${MAX_GIF_SECONDS} secondes.`
      : `Un extrait ne peut pas dépasser ${Math.round(MAX_CLIP_SECONDS / 60)} minutes.`;
  }
  return "";
}

export function clampClipRange(start, end, duration = Number.POSITIVE_INFINITY) {
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : Number.POSITIVE_INFINITY;
  const from = clamp(finite(start, 0), 0, safeDuration);
  const to = clamp(finite(end, 0), 0, safeDuration);
  return { start: Math.min(from, to), end: Math.max(from, to) };
}

/**
 * Builds the short quotation shown by the watermark from the subtitle cues that
 * overlap the selected range. Only local cues are used: nothing is fetched.
 */
export function citationFromSubtitles(cues, start, end, maximum = MAX_CITATION_LENGTH) {
  const from = finite(start, 0);
  const to = finite(end, from);
  const lines = (Array.isArray(cues) ? cues : [])
    .filter((cue) => finite(cue?.end, 0) >= from && finite(cue?.start, 0) <= to)
    .map((cue) => String(cue?.text || "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (!lines.length) return "";
  const joined = lines.join(" ");
  return joined.length <= maximum ? joined : `${joined.slice(0, Math.max(0, maximum - 1)).trimEnd()}…`;
}

export function projectAttribution(project) {
  const title = text(project?.title, 80);
  const online = project?.tmdb;
  const year = text(online?.year || String(online?.releaseDate || "").slice(0, 4), 4);
  const pieces = [title ? `« ${title} »` : "", year].filter(Boolean);
  return text(pieces.join(" · "), MAX_ATTRIBUTION_LENGTH);
}

/**
 * Resolves the three lines drawn over the picture. The caller stays responsible
 * for the rendering: this only decides what is legitimately displayable.
 */
export function watermarkLines(watermark, { citation = "", attribution = "", timecode = "" } = {}) {
  const normalized = normalizeWatermark(watermark);
  if (!normalized.enabled) return [];
  const resolvedCitation = normalized.source === "custom"
    ? normalized.citation
    : normalized.citation || text(citation, MAX_CITATION_LENGTH);
  const resolvedAttribution = normalized.attribution || text(attribution, MAX_ATTRIBUTION_LENGTH);
  return [
    resolvedCitation ? `« ${resolvedCitation} »` : "",
    resolvedAttribution,
    normalized.showTimecode ? text(timecode, 24) : "",
  ].filter(Boolean);
}

export function safeClipFileName(value, fallback = "extrait") {
  const cleaned = String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, MAX_NAME_LENGTH);
  return cleaned || fallback;
}

export function clipFileName({ title, label, timecode, extension, index = 0 }) {
  const base = safeClipFileName(title, "cinecrique");
  const suffix = safeClipFileName(label || timecode || String(index + 1), String(index + 1));
  return `${base}-${suffix}.${safeClipFileName(extension, "mp4")}`;
}

export function emptyClip(kind = "clip") {
  return {
    id: "",
    kind: kind === "still" ? "still" : "clip",
    start: 0,
    end: 0,
    label: "",
    settings: defaultClipSettings(),
  };
}

export function normalizeClip(value, index = 0) {
  const kind = value?.kind === "still" ? "still" : "clip";
  const start = Math.max(0, finite(value?.start, 0));
  const end = kind === "still" ? start : Math.max(start, finite(value?.end, start));
  return {
    id: text(value?.id, 128) || `extrait-${index + 1}`,
    kind,
    start,
    end,
    label: text(value?.label, 200),
    citation: text(value?.citation, MAX_CITATION_LENGTH),
    settings: normalizeClipSettings(value?.settings),
  };
}

export function normalizeClipBasket(value) {
  return (Array.isArray(value) ? value : [])
    .slice(0, MAX_BASKET_ITEMS)
    .map((item, index) => normalizeClip(item, index));
}

export function addClipToBasket(basket, clip) {
  const items = normalizeClipBasket(basket);
  if (items.length >= MAX_BASKET_ITEMS) {
    return { basket: items, error: `Le panier est limité à ${MAX_BASKET_ITEMS} éléments.` };
  }
  const candidate = normalizeClip(clip, items.length);
  const duplicate = items.some((item) => item.kind === candidate.kind
    && Math.abs(item.start - candidate.start) < 0.001
    && Math.abs(item.end - candidate.end) < 0.001);
  if (duplicate) return { basket: items, error: "Cet extrait est déjà dans le panier." };
  return { basket: [...items, candidate], error: "" };
}

export function removeClipFromBasket(basket, id) {
  return normalizeClipBasket(basket).filter((item) => item.id !== id);
}

export function updateClipInBasket(basket, id, changes) {
  return normalizeClipBasket(basket).map((item, index) => (
    item.id === id ? normalizeClip({ ...item, ...changes, id: item.id }, index) : item
  ));
}

export function basketDuration(basket) {
  return normalizeClipBasket(basket)
    .filter((item) => item.kind === "clip")
    .reduce((total, item) => total + Math.max(0, item.end - item.start), 0);
}

/**
 * Shapes one basket entry for the native bridge. Everything sent is derived
 * from local project data; the payload never carries a file system path.
 */
export function clipExportPayload(clip, context = {}) {
  const item = normalizeClip(clip);
  const settings = item.settings;
  const isStill = item.kind === "still";
  const format = isStill ? settings.stillFormat : settings.format;
  const definition = (isStill ? STILL_FORMATS : CLIP_FORMATS).find((entry) => entry.value === format);
  const timecode = typeof context.formatTimecode === "function" ? context.formatTimecode(item.start) : "";
  const lines = watermarkLines(settings.watermark, {
    citation: item.citation || context.citation || "",
    attribution: context.attribution || "",
    timecode,
  });
  return {
    kind: item.kind,
    start: item.start,
    end: isStill ? item.start : item.end,
    format,
    maxHeight: isStill ? 0 : settings.maxHeight,
    quality: settings.quality,
    mode: isStill ? "accurate" : effectiveClipMode(settings),
    includeAudio: !isStill && format !== "gif" && settings.includeAudio,
    frameRate: format === "gif" ? settings.gifFrameRate : 0,
    name: clipFileName({
      title: context.title,
      label: item.label || (timecode ? timecode.replaceAll(":", "-").replaceAll(";", "-") : ""),
      extension: definition?.extension || format,
      index: Number(context.index) || 0,
    }),
    watermark: {
      enabled: lines.length > 0,
      lines,
      position: settings.watermark.position,
      size: settings.watermark.size,
      opacity: settings.watermark.opacity,
    },
  };
}

export function estimatedClipBytes(clip) {
  const item = normalizeClip(clip);
  if (item.kind === "still") return item.settings.stillFormat === "png" ? 3_500_000 : 700_000;
  const seconds = Math.max(0, item.end - item.start);
  if (item.settings.format === "gif") {
    return seconds * item.settings.gifFrameRate * 90_000;
  }
  const height = item.settings.maxHeight || 1080;
  const perSecond = { high: 1.8, standard: 1, light: 0.55 }[item.settings.quality] || 1;
  return seconds * height * 1_100 * perSecond;
}

export function formatBytes(value) {
  const bytes = Math.max(0, finite(value, 0));
  if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1_000))} Ko`;
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(bytes < 10_000_000 ? 1 : 0)} Mo`;
  return `${(bytes / 1_000_000_000).toFixed(1)} Go`;
}
