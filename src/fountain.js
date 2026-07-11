const SCENE_PATTERN = /^(?:INT\.|EXT\.|EST\.|INT\.\/EXT\.|I\/E\.)/i;

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
