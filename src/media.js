function parseClock(value) {
  const match = value.trim().match(/(?:(\d+):)?(\d{2}):(\d{2})[,.](\d{2,3})/);
  if (!match) return null;
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const fraction = Number(match[4].padEnd(3, "0"));
  return hours * 3600 + minutes * 60 + seconds + fraction / 1000;
}

export const VIDEO_EXTENSIONS = Object.freeze([
  "mov", "qt", "mp4", "m4v", "f4v", "mkv", "webm", "avi", "divx",
  "mpg", "mpeg", "m1v", "m2v", "vob", "ts", "mts", "m2ts", "mxf",
  "3gp", "3g2", "ogv", "ogg", "wmv", "asf", "flv",
]);

export function isSupportedVideoFile(file) {
  const extension = String(file?.name || "").split(".").pop()?.toLocaleLowerCase("fr") || "";
  return Boolean(file?.type?.startsWith("video/") || VIDEO_EXTENSIONS.includes(extension));
}

export function mediaPlaybackIssue(metadata, fileName = "") {
  const video = metadata?.streams?.find((stream) => stream.codec_type === "video");
  const codec = video?.codec_long_name || video?.codec_name?.toUpperCase() || "de la piste vidéo";
  const extension = String(fileName || "").split(".").pop()?.toLocaleUpperCase("fr") || "vidéo";
  return `Le conteneur ${extension} est reconnu, mais le codec ${codec} n’est pas décodable par WebKit sur ce Mac.`;
}

function stripAssFormatting(text) {
  return text
    .replace(/\{[^}]*\}/g, "")
    .replace(/\\N/gi, "\n")
    .replace(/\\n/gi, "\n")
    .trim();
}

function parseAss(content) {
  const cues = [];
  for (const line of content.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    if (!line.startsWith("Dialogue:")) continue;
    const pieces = line.slice("Dialogue:".length).split(",");
    if (pieces.length < 10) continue;
    const start = parseClock(pieces[1]);
    const end = parseClock(pieces[2]);
    if (start == null || end == null) continue;
    cues.push({ start, end, text: stripAssFormatting(pieces.slice(9).join(",")) });
  }
  return cues.sort((a, b) => a.start - b.start);
}

export function parseSubtitles(content, fileName = "") {
  if (/\.(ass|ssa)$/i.test(fileName)) return parseAss(content);

  const normalized = content
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/^WEBVTT[^\n]*\n+/, "");

  const cues = [];
  for (const block of normalized.split(/\n{2,}/)) {
    const lines = block.split("\n").filter(Boolean);
    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex < 0) continue;
    const [rawStart, rawEnd] = lines[timingIndex].split("-->");
    const start = parseClock(rawStart);
    const end = parseClock(rawEnd.trim().split(/\s+/)[0]);
    if (start == null || end == null) continue;
    const text = lines
      .slice(timingIndex + 1)
      .join("\n")
      .replace(/<[^>]+>/g, "")
      .trim();
    if (text) cues.push({ start, end, text });
  }
  return cues.sort((a, b) => a.start - b.start);
}

export function subtitleAt(cues, time) {
  const index = subtitleIndexAt(cues, time);
  return index >= 0 ? cues[index].text : "";
}

export function subtitleIndexAt(cues, time) {
  const items = Array.isArray(cues) ? cues : [];
  const position = Number(time);
  let low = 0;
  let high = items.length - 1;
  let candidate = -1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (Number(items[middle].start) <= position) {
      candidate = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  if (candidate >= 0 && position <= Number(items[candidate].end)) return candidate;
  return -1;
}

export function filterSubtitles(cues, query = "") {
  const normalized = String(query || "").trim().toLocaleLowerCase("fr");
  return (Array.isArray(cues) ? cues : []).map((cue, index) => ({ cue, index }))
    .filter(({ cue }) => !normalized || String(cue.text || "").toLocaleLowerCase("fr").includes(normalized));
}

export function subtitleNoteDraft(cue, formatTimecode) {
  const text = String(cue?.text || "").trim();
  const title = text.split(/\n/)[0].slice(0, 120) || "Dialogue";
  return {
    type: "note",
    title,
    body: text,
    url: "",
    tag: "Dialogue",
    kind: "point",
    startTimecode: formatTimecode(Number(cue?.start) || 0),
    endTimecode: formatTimecode(Number(cue?.end) || Number(cue?.start) || 0),
    bookmarked: false,
  };
}

function streamOfType(metadata, type) {
  return metadata?.streams?.find((stream) => stream.codec_type === type);
}

export function metadataDuration(metadata, fallback = 0) {
  const value = Number(metadata?.format?.duration || streamOfType(metadata, "video")?.duration);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function metadataFrameRate(metadata, fallback = 24) {
  const video = streamOfType(metadata, "video");
  const raw = video?.avg_frame_rate || video?.r_frame_rate;
  if (!raw || raw === "0/0") return fallback;
  const [numerator, denominator] = raw.split("/").map(Number);
  const value = denominator ? numerator / denominator : numerator;
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function metadataFields(metadata, project, subtitleName = "") {
  const video = streamOfType(metadata, "video");
  const audio = streamOfType(metadata, "audio");
  const online = project?.tmdb;
  const subtitles = metadata?.streams?.filter((stream) => stream.codec_type === "subtitle") || [];
  const frameRate = metadataFrameRate(metadata);
  const subtitleLanguages = subtitles
    .map((stream) => stream.tags?.language || stream.tags?.title)
    .filter(Boolean)
    .join(", ");

  const onlineRows = online ? [
    ["Source", `${online.source} · ${online.language}`],
    ["Titre original", online.originalTitle || online.title],
    ["Sortie", online.releaseDate || "—"],
    ["Genres", online.genres?.join(", ") || "—"],
    ["Pays", online.countries?.join(", ") || "—"],
    ["Distribution", online.cast?.join(", ") || "—"],
  ] : [];

  return [...onlineRows,
    ["Fichier", project?.path?.split("/").pop() || "le-mepris-master.mov"],
    ["Vidéo", video?.codec_long_name || video?.codec_name?.toUpperCase() || "ProRes 422 HQ"],
    ["Définition", video?.width && video?.height ? `${video.width} × ${video.height}` : "1920 × 1080"],
    ["Cadence", `${frameRate.toFixed(frameRate % 1 ? 2 : 0)} i/s`],
    ["Audio", audio ? `${audio.codec_name?.toUpperCase() || "Audio"} · ${audio.sample_rate ? `${Number(audio.sample_rate) / 1000} kHz` : ""}`.replace(/ · $/, "") : "PCM · 48 kHz · Stéréo"],
    ["Sous-titres", subtitleName || subtitleLanguages || (subtitles.length ? `${subtitles.length} piste${subtitles.length > 1 ? "s" : ""}` : "Aucune piste chargée")],
  ];
}

export function projectDetail(metadata) {
  const duration = metadataDuration(metadata);
  if (!duration) return "Fichier local";
  const hours = Math.floor(duration / 3600);
  const minutes = Math.round((duration % 3600) / 60);
  return hours ? `${hours}h${String(minutes).padStart(2, "0")}` : `${minutes} min`;
}

export function isMuteShortcut(event) {
  const tagName = String(event?.target?.tagName || "").toLowerCase();
  const isEditable = event?.target?.isContentEditable || ["input", "textarea", "select"].includes(tagName);
  return String(event?.key || "").toLocaleLowerCase("fr") === "m"
    && !event?.metaKey
    && !event?.ctrlKey
    && !event?.altKey
    && !isEditable;
}
