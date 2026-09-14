const SCENE_PATTERN = /^(?:\.(?=\S)|(?:INT\.?\/EXT\.?|INT\.?|EXT\.?|EST\.?|I\/E\.?)(?=\s|$))/i;

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function fountainContext(document, project) {
  const lines = String(document || "").split("\n").map((line) => line.trim()).filter(Boolean);
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
