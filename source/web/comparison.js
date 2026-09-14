export const emptyComparison = () => ({
  a: null,
  b: null,
  syncZoom: true,
  note: "",
});

function normalizeReference(value) {
  if (!value || typeof value !== "object") return null;
  const time = Number(value.time);
  if (!Number.isFinite(time) || time < 0) return null;
  return {
    time,
    markerId: value.markerId == null ? null : String(value.markerId).slice(0, 1_024),
  };
}

export function normalizeComparison(value = {}) {
  return {
    a: normalizeReference(value?.a),
    b: normalizeReference(value?.b),
    syncZoom: value?.syncZoom !== false,
    note: String(value?.note || "").slice(0, 20_000),
  };
}

export function pinComparison(value, slot, time, markerId = null) {
  if (slot !== "a" && slot !== "b") return normalizeComparison(value);
  const position = Number(time);
  if (!Number.isFinite(position) || position < 0) return normalizeComparison(value);
  return {
    ...normalizeComparison(value),
    [slot]: { time: position, markerId: markerId == null ? null : String(markerId).slice(0, 1_024) },
  };
}

export function comparisonMarker(markers, reference) {
  if (reference?.markerId == null) return null;
  return (Array.isArray(markers) ? markers : []).find((marker) => String(marker.id) === String(reference.markerId)) || null;
}

export function comparisonAnnotations(annotationsByMarker, reference) {
  if (reference?.markerId == null) return [];
  return annotationsByMarker?.[reference.markerId] || [];
}

export function clampComparisonZoom(value) {
  const numeric = Number(value);
  return Math.min(Math.max(Number.isFinite(numeric) ? numeric : 1, 1), 4);
}

