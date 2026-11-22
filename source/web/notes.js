// Plans intégrés dans les notes Markdown.
//
// Un plan inséré dans les notes est une ligne Markdown d’image dont la cible
// est une référence locale : `![Titre](cinecrique:plan/<id>?t=<secondes>)`.
// La ligne ne stocke qu’une référence vers le repère timecodé ; l’image et ses
// annotations sont régénérées à la demande depuis le média et le repère, comme
// pour la comparaison d’images. Le temps `t` sert seulement de secours si le
// repère a été supprimé.

const PLAN_EMBED_LINE = /^!\[([^\]\n]*)\]\(cinecrique:plan\/([A-Za-z0-9._~-]{1,128})(?:\?t=(\d{1,7}(?:\.\d{1,6})?))?\)[ \t]*$/;
const PLAN_EMBED_ID = /^[A-Za-z0-9._~-]{1,128}$/;

export function planEmbedIdentifier(markerId) {
  const value = String(markerId ?? "");
  return PLAN_EMBED_ID.test(value) ? value : null;
}

function embedTitle(value) {
  return String(value || "Plan")
    .replace(/[\][\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 160) || "Plan";
}

export function planEmbedToken(marker) {
  const id = planEmbedIdentifier(marker?.id);
  if (!id) return "";
  const time = Math.max(0, Number(marker.time) || 0);
  return `![${embedTitle(marker.title)}](cinecrique:plan/${id}?t=${Number(time.toFixed(3))})`;
}

export function parsePlanEmbed(line) {
  const match = String(line ?? "").match(PLAN_EMBED_LINE);
  if (!match) return null;
  return {
    title: match[1].trim(),
    markerId: match[2],
    time: match[3] == null ? null : Number(match[3]),
  };
}

/**
 * Découpe les notes en segments de texte et en plans intégrés.
 * Avec `withSlots`, un segment de texte vide « virtuel » est ajouté avant,
 * entre et après les plans pour qu’on puisse toujours écrire autour d’eux ;
 * ces segments ne modifient pas le Markdown tant qu’ils restent vides.
 */
export function splitNotes(markdown, { withSlots = false } = {}) {
  const value = String(markdown ?? "");
  const lines = value.split("\n");
  const segments = [];
  let offset = 0;
  let buffer = null;

  const flush = () => {
    if (!buffer) return;
    segments.push({ type: "text", text: buffer.lines.join("\n"), start: buffer.start, virtual: false });
    buffer = null;
  };

  lines.forEach((line) => {
    const embed = parsePlanEmbed(line);
    if (embed) {
      flush();
      segments.push({ type: "plan", ...embed, raw: line, start: offset });
    } else if (buffer) {
      buffer.lines.push(line);
    } else {
      buffer = { lines: [line], start: offset };
    }
    offset += line.length + 1;
  });
  flush();

  if (!withSlots) return segments;
  const slotted = [];
  segments.forEach((segment, index) => {
    const previous = slotted.at(-1);
    if (segment.type === "plan" && (!previous || previous.type === "plan")) {
      slotted.push({ type: "text", text: "", start: segment.start, virtual: true });
    }
    slotted.push(segment);
    if (segment.type === "plan" && index === segments.length - 1) {
      slotted.push({ type: "text", text: "", start: value.length + 1, virtual: true });
    }
  });
  if (!slotted.length) slotted.push({ type: "text", text: "", start: 0, virtual: false });
  return slotted;
}

export function composeNotes(segments) {
  return (segments || [])
    .filter((segment) => !(segment.type === "text" && segment.virtual && !segment.text))
    .map((segment) => (segment.type === "plan" ? segment.raw : segment.text))
    .join("\n");
}

export function replaceNotesSegment(segments, index, text) {
  return composeNotes((segments || []).map((segment, position) => (
    position === index && segment.type === "text" ? { ...segment, text: String(text ?? ""), virtual: false } : segment
  )));
}

export function removeNotesSegment(segments, index) {
  return composeNotes((segments || []).filter((_, position) => position !== index));
}

export function moveNotesSegment(segments, index, direction) {
  const plans = (segments || []).map((segment, position) => ({ segment, position })).filter(({ segment }) => segment.type === "plan");
  const current = plans.findIndex(({ position }) => position === index);
  const target = plans[current + direction];
  if (current < 0 || !target) return composeNotes(segments);
  const next = [...segments];
  [next[index], next[target.position]] = [next[target.position], next[index]];
  return composeNotes(next);
}

/** Insère un plan sur sa propre ligne à une position absolue du Markdown. */
export function insertPlanEmbed(markdown, offset, token) {
  const value = String(markdown ?? "");
  if (!token) return { markdown: value, caret: value.length };
  const position = Math.min(Math.max(Number(offset) || 0, 0), value.length);
  const before = value.slice(0, position);
  const after = value.slice(position);
  const prefix = before && !before.endsWith("\n") ? "\n" : "";
  const suffix = after.startsWith("\n") ? "" : "\n";
  return {
    markdown: `${before}${prefix}${token}${suffix}${after}`,
    caret: before.length + prefix.length + token.length + 1,
  };
}

export function updatePlanEmbedTitle(segments, index, title) {
  const segment = segments?.[index];
  if (!segment || segment.type !== "plan") return composeNotes(segments);
  const raw = planEmbedToken({ id: segment.markerId, title, time: segment.time ?? 0 });
  return composeNotes(segments.map((item, position) => (position === index ? { ...item, raw, title: embedTitle(title) } : item)));
}

export function notesPlanReferences(markdown) {
  return splitNotes(markdown).filter((segment) => segment.type === "plan");
}

/** Version lisible hors de Cinécrique : chaque plan devient une citation timecodée. */
export function notesForExport(markdown, markers = [], formatTimecode = (value) => String(value)) {
  const byId = new Map((markers || []).map((marker) => [String(marker.id), marker]));
  return String(markdown ?? "")
    .split("\n")
    .map((line) => {
      const embed = parsePlanEmbed(line);
      if (!embed) return line;
      const marker = byId.get(embed.markerId);
      const time = marker ? Number(marker.time) : embed.time ?? 0;
      const range = marker && Number(marker.endTime) > Number(marker.time) ? ` → ${formatTimecode(marker.endTime)}` : "";
      const title = marker?.title || embed.title || "Plan";
      return `> **Plan ${formatTimecode(time)}${range}** · ${title}`;
    })
    .join("\n");
}
