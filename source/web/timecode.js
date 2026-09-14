export const TIMECODE_RATES = Object.freeze([
  { value: "24000/1001", label: "23,976", actual: 24000 / 1001, nominal: 24 },
  { value: "24/1", label: "24", actual: 24, nominal: 24 },
  { value: "25/1", label: "25", actual: 25, nominal: 25 },
  { value: "30000/1001", label: "29,97", actual: 30000 / 1001, nominal: 30 },
  { value: "30/1", label: "30", actual: 30, nominal: 30 },
]);

export const DEFAULT_TIMECODE = Object.freeze({
  source: "auto",
  rate: "24/1",
  offsetFrames: 0,
  dropFrame: false,
});

function modulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

export function timecodeRate(value) {
  if (typeof value === "string") {
    const direct = TIMECODE_RATES.find((rate) => rate.value === value);
    if (direct) return direct;
    const [numerator, denominator = 1] = value.split("/").map(Number);
    value = denominator ? numerator / denominator : numerator;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return TIMECODE_RATES[1];
  return TIMECODE_RATES.reduce((best, rate) => (
    Math.abs(rate.actual - numeric) < Math.abs(best.actual - numeric) ? rate : best
  ), TIMECODE_RATES[1]);
}

export function normalizeTimecodeSettings(value = {}, detectedRate = 24) {
  const source = value?.source === "manual" ? "manual" : "auto";
  const detected = timecodeRate(detectedRate);
  const rate = source === "auto" ? detected : timecodeRate(value?.rate);
  const maxOffset = framesPer24Hours(rate, Boolean(value?.dropFrame));
  const rawOffset = Number(value?.offsetFrames);
  const offsetFrames = Number.isFinite(rawOffset)
    ? Math.min(Math.max(Math.round(rawOffset), 0), maxOffset - 1)
    : 0;
  return {
    source,
    rate: rate.value,
    offsetFrames,
    dropFrame: Boolean(value?.dropFrame && rate.value === "30000/1001"),
  };
}

export function framesPer24Hours(rateValue, dropFrame = false) {
  const rate = timecodeRate(rateValue);
  if (dropFrame && rate.value === "30000/1001") return (rate.nominal * 3600 - 2 * 54) * 24;
  return rate.nominal * 3600 * 24;
}

function dropFrameToDisplayFrame(frameNumber, nominal = 30) {
  const dropFrames = Math.round(nominal * 0.066666);
  const framesPer10Minutes = nominal * 60 * 10 - dropFrames * 9;
  const framesPerMinute = nominal * 60 - dropFrames;
  const tenMinuteBlocks = Math.floor(frameNumber / framesPer10Minutes);
  const remainder = frameNumber % framesPer10Minutes;
  const extraMinutes = remainder >= dropFrames
    ? Math.floor((remainder - dropFrames) / framesPerMinute)
    : 0;
  return frameNumber + dropFrames * 9 * tenMinuteBlocks + dropFrames * extraMinutes;
}

function displayFrameToDropFrame(hours, minutes, seconds, frames, nominal = 30) {
  const dropFrames = Math.round(nominal * 0.066666);
  if (seconds === 0 && minutes % 10 !== 0 && frames < dropFrames) return null;
  const totalMinutes = hours * 60 + minutes;
  const displayFrames = ((hours * 3600 + minutes * 60 + seconds) * nominal) + frames;
  return displayFrames - dropFrames * (totalMinutes - Math.floor(totalMinutes / 10));
}

function formatFrameNumber(frameNumber, settings) {
  const rate = timecodeRate(settings.rate);
  const dropFrame = Boolean(settings.dropFrame && rate.value === "30000/1001");
  const frames24 = framesPer24Hours(rate, dropFrame);
  let displayFrames = modulo(Math.round(frameNumber), frames24);
  if (dropFrame) displayFrames = dropFrameToDisplayFrame(displayFrames, rate.nominal);
  const frames = displayFrames % rate.nominal;
  const wholeSeconds = Math.floor(displayFrames / rate.nominal);
  const seconds = wholeSeconds % 60;
  const minutes = Math.floor(wholeSeconds / 60) % 60;
  const hours = Math.floor(wholeSeconds / 3600) % 24;
  const separator = dropFrame ? ";" : ":";
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}${separator}${String(frames).padStart(2, "0")}`;
}

export function formatTimecode(seconds, settings = DEFAULT_TIMECODE) {
  const normalized = normalizeTimecodeSettings(settings, timecodeRate(settings?.rate).actual);
  const rate = timecodeRate(normalized.rate);
  const mediaFrames = Math.round(Math.max(0, Number(seconds) || 0) * rate.actual);
  return formatFrameNumber(normalized.offsetFrames + mediaFrames, normalized);
}

export function formatTimecodeDuration(seconds, settings = DEFAULT_TIMECODE) {
  return formatTimecode(seconds, { ...settings, source: "manual", offsetFrames: 0 });
}

function parseFrameNumber(value, settings) {
  const normalized = normalizeTimecodeSettings(settings, timecodeRate(settings?.rate).actual);
  const rate = timecodeRate(normalized.rate);
  const match = String(value || "").trim().match(/^(\d{1,2}):(\d{2}):(\d{2})([:;])(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const separator = match[4];
  const frames = Number(match[5]);
  if (hours >= 24 || minutes >= 60 || seconds >= 60 || frames >= rate.nominal) return null;
  if (normalized.dropFrame) {
    if (separator !== ";") return null;
    return displayFrameToDropFrame(hours, minutes, seconds, frames, rate.nominal);
  }
  if (separator !== ":") return null;
  return ((hours * 3600 + minutes * 60 + seconds) * rate.nominal) + frames;
}

export function parseTimecode(value, settings = DEFAULT_TIMECODE) {
  const normalized = normalizeTimecodeSettings(settings, timecodeRate(settings?.rate).actual);
  const rate = timecodeRate(normalized.rate);
  const frameNumber = parseFrameNumber(value, normalized);
  if (frameNumber != null) {
    const mediaFrames = frameNumber - normalized.offsetFrames;
    return mediaFrames < 0 ? null : mediaFrames / rate.actual;
  }

  const decimal = String(value || "").trim().match(/^(\d{1,2}):(\d{2}):(\d{2})(?:[.,](\d{1,3}))?$/);
  if (!decimal) return null;
  const hours = Number(decimal[1]);
  const minutes = Number(decimal[2]);
  const seconds = Number(decimal[3]);
  if (hours >= 24 || minutes >= 60 || seconds >= 60) return null;
  const fraction = decimal[4] ? Number(`0.${decimal[4].padEnd(3, "0")}`) : 0;
  const mediaSeconds = hours * 3600 + minutes * 60 + seconds + fraction - normalized.offsetFrames / rate.actual;
  return mediaSeconds < 0 ? null : mediaSeconds;
}

export function parseTimecodeOffset(value, settings = DEFAULT_TIMECODE) {
  const normalized = normalizeTimecodeSettings({ ...settings, offsetFrames: 0 }, timecodeRate(settings?.rate).actual);
  return parseFrameNumber(value, normalized);
}

export function formatTimecodeOffset(settings = DEFAULT_TIMECODE) {
  const normalized = normalizeTimecodeSettings(settings, timecodeRate(settings?.rate).actual);
  return formatFrameNumber(normalized.offsetFrames, normalized);
}

export function changeTimecodeRate(settings, nextSource, nextRate, detectedRate = 24) {
  const current = normalizeTimecodeSettings(settings, detectedRate);
  const offsetLabel = formatTimecodeOffset(current);
  const changed = normalizeTimecodeSettings({
    ...current,
    source: nextSource,
    rate: nextRate,
    dropFrame: current.dropFrame && timecodeRate(nextRate).value === "30000/1001",
    offsetFrames: 0,
  }, detectedRate);
  const offsetFrames = parseTimecodeOffset(
    offsetLabel.replace(/[;:](\d{2})$/, `${changed.dropFrame ? ";" : ":"}$1`),
    changed,
  );
  return { ...changed, offsetFrames: offsetFrames ?? 0 };
}

export function changeDropFrame(settings, enabled) {
  const current = normalizeTimecodeSettings(settings, timecodeRate(settings?.rate).actual);
  if (current.rate !== "30000/1001") return { ...current, dropFrame: false };
  const offsetLabel = formatTimecodeOffset(current);
  const changed = { ...current, dropFrame: Boolean(enabled), offsetFrames: 0 };
  const adjustedLabel = offsetLabel.replace(/[;:](\d{2})$/, `${changed.dropFrame ? ";" : ":"}$1`);
  return { ...changed, offsetFrames: parseTimecodeOffset(adjustedLabel, changed) ?? 0 };
}
