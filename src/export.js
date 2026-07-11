export const defaultExportSelection = () => ({
  script: true,
  analysis: false,
  markers: false,
  subtitles: false,
  metadata: false,
  video: false,
  currentFrame: false,
  allFrames: false,
  project: false,
});

export function safeExportBaseName(value) {
  const cleaned = String(value || "cinecrique")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 100);
  return cleaned || "cinecrique";
}

export function markerMarkdown(markers, formatTimecode) {
  const rows = (markers || []).map((marker) => {
    const range = marker.endTime > marker.time
      ? `${formatTimecode(marker.time)} → ${formatTimecode(marker.endTime)}`
      : formatTimecode(marker.time);
    const metadata = [marker.type, marker.tag, marker.bookmarked ? "signet" : ""].filter(Boolean).join(" · ");
    const lines = [`## ${range} — ${marker.title}`, metadata ? `_${metadata}_` : "", marker.detail || ""];
    if (marker.url) lines.push(`[Ouvrir le lien](${marker.url})`);
    return lines.filter(Boolean).join("\n\n");
  });
  return `# Repères timecodés\n\n${rows.join("\n\n---\n\n")}\n`;
}

export function buildTextExportFiles(options, data) {
  const base = safeExportBaseName(data.title);
  const files = [];
  if (options.script) {
    files.push({ name: `${base}-script.${data.format === "Markdown" ? "md" : "fountain"}`, content: data.script || "" });
  }
  if (options.analysis) files.push({ name: `${base}-analyse.md`, content: data.analysis || "" });
  if (options.markers) files.push({ name: `${base}-reperes.md`, content: markerMarkdown(data.markers, data.formatTimecode) });
  if (options.subtitles) files.push({ name: `${base}-sous-titres.vtt`, content: data.subtitlesVTT || "WEBVTT\n" });
  if (options.metadata) files.push({ name: `${base}-metadonnees.json`, content: JSON.stringify(data.metadata || {}, null, 2) });
  if (options.project) files.push({ name: `${base}.cinecrique.json`, content: JSON.stringify(data.projectState, null, 2) });
  return files;
}

export function exportSelectionCount(options, annotatedFrameCount = 0) {
  const textCount = ["script", "analysis", "markers", "subtitles", "metadata", "project"]
    .filter((key) => options[key]).length;
  const frameCount = options.allFrames ? annotatedFrameCount : options.currentFrame ? 1 : 0;
  return textCount + (options.video ? 1 : 0) + frameCount;
}
