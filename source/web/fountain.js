const SCENE_PATTERN = /^(?:\.(?=\S)|(?:INT\.?\/EXT\.?|INT\.?|EXT\.?|EST\.?|I\/E\.?)(?=\s|$))/i;

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function fountainContext(document, project) {
  const lines = String(document || "").split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("[["));
  const scenes = unique(lines.filter((line) => SCENE_PATTERN.test(line))).slice(-20).reverse();
  const documentCharacters = lines.filter((line) => {
    if (SCENE_PATTERN.test(line) || line.endsWith("TO:")) return false;
    const cue = line.replace(/\s*\([^)]*\)\s*$/, "");
    return cue.length >= 2 && cue.length <= 40 && cue === cue.toLocaleUpperCase("fr") && /\p{L}/u.test(cue);
  }).map((line) => line.replace(/\s*\([^)]*\)\s*$/, ""));
  const cast = (project?.tmdb?.cast || []).map((name) => String(name).toLocaleUpperCase("fr"));
  return { scenes, characters: unique([...documentCharacters, ...cast]) };
}

export function fountainCompletion(value, context = {}) {
  const currentLine = String(value || "").slice(String(value || "").lastIndexOf("\n") + 1);
  const typed = currentLine.trimStart();
  if (!typed) return "";
  const sceneDefaults = ["INT. ", "EXT. ", "INT./EXT. "];
  const candidates = SCENE_PATTERN.test(typed) || /^(?:I|IN|INT|E|EX|EXT)[./]?$/i.test(typed)
    ? [...(context.scenes || []), ...sceneDefaults]
    : [...(context.characters || []), ...(context.scenes || [])];
  const candidate = candidates.find((item) => (
    item.length > typed.length && item.toLocaleLowerCase("fr").startsWith(typed.toLocaleLowerCase("fr"))
  ));
  return candidate ? candidate.slice(typed.length) : "";
}

export function fountainScenes(document) {
  const value = String(document || "");
  const scenes = [];
  let offset = 0;

  for (const line of value.split("\n")) {
    const trimmed = line.trim();
    if (SCENE_PATTERN.test(trimmed)) {
      const heading = trimmed.startsWith(".") ? trimmed.slice(1).trim() : trimmed;
      scenes.push({
        index: scenes.length,
        number: scenes.length + 1,
        heading,
        start: offset,
        end: value.length,
      });
    }
    offset += line.length + 1;
  }

  for (let index = 0; index < scenes.length - 1; index += 1) {
    let end = scenes[index + 1].start;
    while (end > scenes[index].start && /\s/.test(value[end - 1])) end -= 1;
    scenes[index].end = end;
  }
  return scenes;
}

export function fountainSceneIndexAtOffset(scenes, offset) {
  if (!Array.isArray(scenes) || !scenes.length) return -1;
  const position = Math.max(0, Number(offset) || 0);
  const exact = scenes.findIndex((scene) => position >= scene.start && position <= scene.end);
  if (exact >= 0) return exact;
  for (let index = scenes.length - 1; index >= 0; index -= 1) {
    if (position >= scenes[index].start) return index;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Plans liés au scénario.
//
// Le lien vit dans le texte Fountain lui-même, sous la forme d’une note
// Fountain standard : `[[plan:<id> 00:12:03:04 — Titre]]`. Les notes `[[…]]`
// sont ignorées par tous les logiciels Fountain, le scénario reste donc
// portable, et le lien suit la scène quand on réécrit ou déplace le texte.
// Le repère timecodé reste la seule source du plan : rien n’est dupliqué.
// ---------------------------------------------------------------------------

export const PLAN_LINK_ID_PATTERN = /^[A-Za-z0-9._~-]{1,128}$/;
const PLAN_LINK_PATTERN = /\[\[plan:([A-Za-z0-9._~-]{1,128})(?:[ \t]+([^\]\n]*))?\]\]/g;
export const FOUNTAIN_IMPORT_MAX_CHARACTERS = 2_000_000;

export function planLinkIdentifier(markerId) {
  const value = String(markerId ?? "");
  return PLAN_LINK_ID_PATTERN.test(value) ? value : null;
}

function linkLabel(value, maximum = 120) {
  return String(value || "")
    .replace(/[\][\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, maximum);
}

export function planLinkNote(marker, formatTimecode = (value) => String(value)) {
  const id = planLinkIdentifier(marker?.id);
  if (!id) return "";
  const label = [formatTimecode(Number(marker.time) || 0), linkLabel(marker.title)].filter(Boolean).join(" — ");
  return `[[plan:${id}${label ? ` ${label}` : ""}]]`;
}

export function fountainPlanLinks(document) {
  const value = String(document || "");
  const links = [];
  for (const match of value.matchAll(PLAN_LINK_PATTERN)) {
    links.push({
      markerId: match[1],
      label: (match[2] || "").trim(),
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return links;
}

function sceneIndexForOffset(scenes, offset) {
  let found = -1;
  for (let index = 0; index < scenes.length; index += 1) {
    if (offset >= scenes[index].start) found = index;
    else break;
  }
  return found;
}

export function scenePlanLinks(document, scenes = fountainScenes(document)) {
  const byScene = new Map();
  for (const link of fountainPlanLinks(document)) {
    const sceneIndex = sceneIndexForOffset(scenes, link.start);
    const list = byScene.get(sceneIndex) || [];
    if (!list.some((item) => item.markerId === link.markerId)) list.push(link);
    byScene.set(sceneIndex, list);
  }
  return byScene;
}

export function markerSceneIndexes(document, scenes = fountainScenes(document)) {
  const result = new Map();
  for (const link of fountainPlanLinks(document)) {
    const sceneIndex = sceneIndexForOffset(scenes, link.start);
    if (sceneIndex < 0) continue;
    const list = result.get(link.markerId) || [];
    if (!list.includes(sceneIndex)) list.push(sceneIndex);
    result.set(link.markerId, list);
  }
  return result;
}

export function removePlanLinks(document, markerId) {
  const id = planLinkIdentifier(markerId);
  const value = String(document || "");
  if (!id) return value;
  const lines = value.split("\n");
  const kept = [];
  for (const line of lines) {
    if (!line.includes(`[[plan:${id}`)) {
      kept.push(line);
      continue;
    }
    const stripped = line.replace(PLAN_LINK_PATTERN, (whole, linkedId) => (linkedId === id ? "" : whole));
    if (stripped.trim() || !line.trim()) kept.push(stripped.replace(/[ \t]+$/, ""));
  }
  return kept.join("\n");
}

export function insertPlanLinkAt(document, offset, note) {
  const value = String(document || "");
  if (!note) return { script: value, caret: Math.min(Math.max(Number(offset) || 0, 0), value.length) };
  const position = Math.min(Math.max(Number(offset) || 0, 0), value.length);
  const before = value.slice(0, position);
  const after = value.slice(position);
  const prefix = before && !before.endsWith("\n") ? "\n" : "";
  const suffix = after.startsWith("\n") || !after ? "" : "\n";
  const script = `${before}${prefix}${note}${suffix}${after}`;
  return { script, caret: before.length + prefix.length + note.length };
}

export function setPlanScene(document, markerId, sceneIndex, note) {
  const cleaned = removePlanLinks(document, markerId);
  if (sceneIndex == null || sceneIndex < 0 || !note) return cleaned;
  const scenes = fountainScenes(cleaned);
  const scene = scenes[sceneIndex];
  if (!scene) return cleaned;
  // Insère la note juste sous l’en-tête de scène, après les liens déjà présents.
  const headingEnd = cleaned.indexOf("\n", scene.start);
  let position = headingEnd < 0 ? cleaned.length : headingEnd + 1;
  while (position < cleaned.length) {
    const lineEnd = cleaned.indexOf("\n", position);
    const line = cleaned.slice(position, lineEnd < 0 ? cleaned.length : lineEnd);
    if (!/^\s*\[\[plan:[^\]\n]*\]\]\s*$/.test(line)) break;
    position = lineEnd < 0 ? cleaned.length : lineEnd + 1;
  }
  if (headingEnd < 0) return `${cleaned}\n${note}`;
  return `${cleaned.slice(0, position)}${note}\n${cleaned.slice(position)}`;
}

export function normalizeFountainImport(text) {
  const value = String(text ?? "")
    .replace(/^﻿/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u0000/g, "");
  if (value.length > FOUNTAIN_IMPORT_MAX_CHARACTERS) {
    throw new RangeError("Ce scénario dépasse la limite de 2 millions de caractères.");
  }
  return value;
}

export function fountainTitle(text) {
  const value = String(text || "");
  const titlePage = value.split(/\n\s*\n/)[0] || "";
  if (!/^\s*[A-Za-z][A-Za-z ]*:/m.test(titlePage)) return "";
  const match = titlePage.match(/^\s*Title:[ \t]*(.*)$/im);
  if (!match) return "";
  const lines = [match[1]];
  const rest = titlePage.slice(titlePage.indexOf(match[0]) + match[0].length).split("\n").slice(1);
  for (const line of rest) {
    if (/^(?:\t| {3,})\S/.test(line)) lines.push(line);
    else break;
  }
  return linkLabel(lines.join(" ").replace(/[_*]/g, ""), 200);
}

export function mergeImportedFountain(current, imported, mode) {
  const existing = String(current || "");
  if (mode === "replace" || !existing.trim() || existing.trim() === "INT.") return imported;
  return `${existing.replace(/\s+$/, "")}\n\n${imported.replace(/^\s+/, "")}`;
}
