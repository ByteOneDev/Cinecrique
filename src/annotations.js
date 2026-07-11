const clamp = (value, min = 0, max = 1) => Math.min(Math.max(value, min), max);

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
  return annotation;
}

export function updatePointLabel(annotation, label) {
  if (annotation?.type !== "point") return annotation;
  return { ...annotation, label: Math.min(Math.max(Math.round(Number(label) || 1), 1), 999) };
}

export function annotationLabel(annotation, index = 0) {
  if (annotation?.type === "arrow") return `Flèche ${index + 1}`;
  if (annotation?.type === "rect") return `Rectangle ${index + 1}`;
  if (annotation?.type === "point") return `Point ${annotation.label || index + 1}`;
  return `Annotation ${index + 1}`;
}
