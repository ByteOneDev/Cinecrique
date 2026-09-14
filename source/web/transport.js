export const PLAYBACK_RATES = [0.25, 0.5, 1, 1.5, 2];
export const DEFAULT_SHORTCUTS = Object.freeze({
  togglePlayback: " ",
  reverse: "j",
  pause: "k",
  forward: "l",
  slower: "r",
  silent: "a",
  loopStart: "i",
  loopEnd: "o",
  mute: "m",
});

const SHORTCUT_ACTIONS = Object.keys(DEFAULT_SHORTCUTS);

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function nearestPlaybackRate(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return PLAYBACK_RATES.reduce((best, rate) => (
    Math.abs(rate - numeric) < Math.abs(best - numeric) ? rate : best
  ), 1);
}

export function normalizeTransport(value = {}, duration = Number.POSITIVE_INFINITY) {
  const safeDuration = Number.isFinite(Number(duration)) ? Math.max(0, Number(duration)) : Number.POSITIVE_INFINITY;
  const rawStart = Number(value?.loopStart);
  const rawEnd = Number(value?.loopEnd);
  const loopStart = Number.isFinite(rawStart) ? clamp(rawStart, 0, safeDuration) : null;
  const loopEnd = Number.isFinite(rawEnd) ? clamp(rawEnd, 0, safeDuration) : null;
  const validRange = loopStart != null && loopEnd != null && loopEnd > loopStart;
  return {
    loopStart,
    loopEnd: validRange ? loopEnd : null,
    loopEnabled: Boolean(value?.loopEnabled && validRange),
    playbackRate: nearestPlaybackRate(value?.playbackRate),
  };
}

export function setLoopStart(transport, time, duration = Number.POSITIVE_INFINITY) {
  const next = normalizeTransport(transport, duration);
  const safeDuration = Number.isFinite(Number(duration)) ? Math.max(0, Number(duration)) : Number.POSITIVE_INFINITY;
  const loopStart = clamp(Number(time) || 0, 0, safeDuration);
  if (next.loopEnd == null || next.loopEnd <= loopStart) {
    return { ...next, loopStart, loopEnd: null, loopEnabled: false };
  }
  return { ...next, loopStart };
}

export function setLoopEnd(transport, time, duration = Number.POSITIVE_INFINITY) {
  const next = normalizeTransport(transport, duration);
  const safeDuration = Number.isFinite(Number(duration)) ? Math.max(0, Number(duration)) : Number.POSITIVE_INFINITY;
  const loopEnd = clamp(Number(time) || 0, 0, safeDuration);
  if (next.loopStart == null || loopEnd <= next.loopStart) {
    return { transport: next, error: "Le point B doit être placé après le point A." };
  }
  return { transport: { ...next, loopEnd }, error: "" };
}

export function toggleLoop(transport) {
  const next = normalizeTransport(transport);
  if (next.loopStart == null || next.loopEnd == null) {
    return { transport: next, error: "Définissez les points A et B avant d’activer la boucle." };
  }
  return { transport: { ...next, loopEnabled: !next.loopEnabled }, error: "" };
}

export function resetLoop(transport) {
  return { ...normalizeTransport(transport), loopStart: null, loopEnd: null, loopEnabled: false };
}

export function stepPlaybackRate(value, direction) {
  const current = nearestPlaybackRate(value);
  const index = PLAYBACK_RATES.indexOf(current);
  return PLAYBACK_RATES[clamp(index + Math.sign(direction || 0), 0, PLAYBACK_RATES.length - 1)];
}

export function loopBoundaryTarget(time, direction, transport) {
  const next = normalizeTransport(transport);
  if (!next.loopEnabled) return null;
  if (direction < 0 && Number(time) <= next.loopStart) return next.loopEnd;
  if (direction >= 0 && Number(time) >= next.loopEnd) return next.loopStart;
  return null;
}

export function normalizeShortcutKey(value) {
  const raw = String(value || "").toLocaleLowerCase("fr");
  if (raw === "space" || raw === "spacebar" || raw === " ") return " ";
  return [...raw].length === 1 && !/[\r\n\t]/.test(raw) ? raw : null;
}

export function normalizeShortcuts(value = {}) {
  const result = { ...DEFAULT_SHORTCUTS };
  const used = new Set();
  for (const action of SHORTCUT_ACTIONS) {
    const candidate = normalizeShortcutKey(value?.[action]);
    if (candidate && !used.has(candidate)) result[action] = candidate;
    if (used.has(result[action])) {
      result[action] = Object.values(DEFAULT_SHORTCUTS).find((key) => !used.has(key)) || DEFAULT_SHORTCUTS[action];
    }
    used.add(result[action]);
  }
  return result;
}

export function assignShortcut(shortcuts, action, key) {
  if (!SHORTCUT_ACTIONS.includes(action)) return normalizeShortcuts(shortcuts);
  const normalizedKey = normalizeShortcutKey(key);
  if (!normalizedKey) return normalizeShortcuts(shortcuts);
  const current = normalizeShortcuts(shortcuts);
  const previousKey = current[action];
  const conflictingAction = SHORTCUT_ACTIONS.find((candidate) => current[candidate] === normalizedKey);
  const next = { ...current, [action]: normalizedKey };
  if (conflictingAction && conflictingAction !== action) next[conflictingAction] = previousKey;
  return next;
}

export function shortcutLabel(key) {
  return normalizeShortcutKey(key) === " " ? "Espace" : String(key || "").toLocaleUpperCase("fr");
}

export function transportShortcut(event, shortcuts = DEFAULT_SHORTCUTS) {
  if (event?.metaKey || event?.ctrlKey || event?.altKey) return null;
  const target = event?.target;
  const tagName = String(target?.tagName || "").toLowerCase();
  if (target?.isContentEditable || ["input", "textarea", "select", "button", "a"].includes(tagName)) return null;
  const key = String(event?.key || "").toLocaleLowerCase("fr");
  const normalizedKey = normalizeShortcutKey(key);
  const action = Object.entries(normalizeShortcuts(shortcuts)).find(([, assigned]) => assigned === normalizedKey)?.[0];
  return action || null;
}
