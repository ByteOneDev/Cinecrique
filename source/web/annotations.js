const clamp = (value, min = 0, max = 1) => Math.min(Math.max(value, min), max);

export function annotationFrameTime(annotation, markerTime = 0) {
  const value = Number(annotation?.time);
  return Number.isFinite(value) && value >= 0 ? value : Math.max(0, Number(markerTime) || 0);
}

export function annotationsAtTime(annotations, currentTime, markerTime = 0, frameRate = 24) {
  const rate = Math.max(Number(frameRate) || 24, 1);
  const currentFrame = Math.round(Math.max(0, Number(currentTime) || 0) * rate);
  return (Array.isArray(annotations) ? annotations : []).filter((annotation) => (
    Math.round(annotationFrameTime(annotation, markerTime) * rate) === currentFrame
  ));
}

export function migrateAnnotationTimes(annotations, markerTime = 0) {
  return (Array.isArray(annotations) ? annotations : []).map((annotation) => ({
    ...annotation,
    time: annotationFrameTime(annotation, markerTime),
  }));
}

export function shiftAnnotationTimes(annotations, delta, markerTime = 0) {
  const offset = Number(delta);
  if (!Number.isFinite(offset)) return migrateAnnotationTimes(annotations, markerTime);
  return migrateAnnotationTimes(annotations, markerTime).map((annotation) => ({
    ...annotation,
    time: Math.max(0, annotation.time + offset),
  }));
}

export function moveAnnotation(annotation, deltaX, deltaY) {
  if (!annotation) return annotation;
  if (annotation.type === "point") {
    return { ...annotation, x: clamp(annotation.x + deltaX), y: clamp(annotation.y + deltaY) };
  }
  if (annotation.type === "rect") {
    return {
      ...annotation,
      x: clamp(annotation.x + deltaX, 0, 1 - annotation.width),
      y: clamp(annotation.y + deltaY, 0, 1 - annotation.height),
    };
  }
  if (annotation.type === "arrow") {
    const minX = Math.min(annotation.x1, annotation.x2);
    const maxX = Math.max(annotation.x1, annotation.x2);
    const minY = Math.min(annotation.y1, annotation.y2);
    const maxY = Math.max(annotation.y1, annotation.y2);
    const safeX = clamp(deltaX, -minX, 1 - maxX);
    const safeY = clamp(deltaY, -minY, 1 - maxY);
    return {
      ...annotation,
      x1: annotation.x1 + safeX,
      y1: annotation.y1 + safeY,
      x2: annotation.x2 + safeX,
      y2: annotation.y2 + safeY,
    };
  }
  if (annotation.type === "pencil") {
    const points = Array.isArray(annotation.points) ? annotation.points : [];
    if (!points.length) return annotation;
    const xs = points.map((point) => Number(point.x) || 0);
    const ys = points.map((point) => Number(point.y) || 0);
    const safeX = clamp(deltaX, -Math.min(...xs), 1 - Math.max(...xs));
    const safeY = clamp(deltaY, -Math.min(...ys), 1 - Math.max(...ys));
    return {
      ...annotation,
      points: points.map((point) => ({ x: point.x + safeX, y: point.y + safeY })),
    };
  }
  return annotation;
}

export function simplifyStroke(points, minDistance = 0.003, maxPoints = 1_000) {
  const source = (Array.isArray(points) ? points : [])
    .filter((point) => Number.isFinite(Number(point?.x)) && Number.isFinite(Number(point?.y)))
    .map((point) => ({ x: clamp(Number(point.x)), y: clamp(Number(point.y)) }));
  if (source.length <= 2) return source;

  const simplified = [source[0]];
  for (let index = 1; index < source.length - 1; index += 1) {
    const previous = simplified.at(-1);
    const point = source[index];
    if (Math.hypot(point.x - previous.x, point.y - previous.y) >= minDistance) simplified.push(point);
  }
  const last = source.at(-1);
  if (simplified.at(-1) !== last) simplified.push(last);
  if (simplified.length <= maxPoints) return simplified;

  const result = [];
  const lastIndex = simplified.length - 1;
  for (let index = 0; index < maxPoints; index += 1) {
    result.push(simplified[Math.round((index / (maxPoints - 1)) * lastIndex)]);
  }
  return result;
}

export function updatePointLabel(annotation, label) {
  if (annotation?.type !== "point") return annotation;
  return { ...annotation, label: Math.min(Math.max(Math.round(Number(label) || 1), 1), 999) };
}

export function annotationLabel(annotation, index = 0) {
  if (annotation?.type === "arrow") return `Flèche ${index + 1}`;
  if (annotation?.type === "rect") return `Rectangle ${index + 1}`;
  if (annotation?.type === "point") return `Point ${annotation.label || index + 1}`;
  if (annotation?.type === "pencil") return `Crayon ${index + 1}`;
  return `Annotation ${index + 1}`;
}
