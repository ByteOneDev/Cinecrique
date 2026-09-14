import assert from "node:assert/strict";
import test from "node:test";

import {
  annotationLabel,
  annotationsAtTime,
  migrateAnnotationTimes,
  moveAnnotation,
  shiftAnnotationTimes,
  simplifyStroke,
  updatePointLabel,
} from "../../source/web/annotations.js";

test("shows annotations only on their captured video frame", () => {
  const annotations = [{ id: "legacy" }, { id: "timed", time: 10 }];
  assert.deepEqual(annotationsAtTime(annotations, 10, 10, 25).map(({ id }) => id), ["legacy", "timed"]);
  assert.deepEqual(annotationsAtTime(annotations, 10 + 1 / 25, 10, 25), []);
  assert.equal(migrateAnnotationTimes([{ id: "legacy" }], 12.5)[0].time, 12.5);
  assert.equal(shiftAnnotationTimes([{ id: "legacy" }], 2, 12.5)[0].time, 14.5);
});

test("moves point and rectangle annotations within the frame", () => {
  assert.deepEqual(moveAnnotation({ type: "point", x: 0.95, y: 0.1 }, 0.2, -0.2), { type: "point", x: 1, y: 0 });
  assert.deepEqual(moveAnnotation({ type: "rect", x: 0.7, y: 0.7, width: 0.2, height: 0.2 }, 0.3, 0.3), {
    type: "rect", x: 0.8, y: 0.8, width: 0.2, height: 0.2,
  });
});

test("moves an arrow without changing its shape", () => {
  const moved = moveAnnotation({ type: "arrow", x1: 0.1, y1: 0.2, x2: 0.4, y2: 0.5 }, -0.3, 0.2);
  assert.equal(moved.type, "arrow");
  assert.equal(moved.x1, 0);
  assert.ok(Math.abs(moved.x2 - 0.3) < 1e-9);
  assert.equal(moved.y1, 0.4);
  assert.equal(moved.y2, 0.7);
});

test("clamps editable point labels", () => {
  assert.equal(updatePointLabel({ type: "point", label: 1 }, 1200).label, 999);
});

test("moves a pencil stroke as one annotation and keeps it in frame", () => {
  const moved = moveAnnotation({
    type: "pencil",
    points: [{ x: 0.1, y: 0.2 }, { x: 0.8, y: 0.9 }],
  }, 0.4, 0.4);
  assert.ok(Math.abs(moved.points[0].x - 0.3) < 1e-9);
  assert.equal(moved.points[0].y, 0.3);
  assert.deepEqual(moved.points[1], { x: 1, y: 1 });
  assert.equal(annotationLabel(moved, 2), "Crayon 3");
});

test("simplifies pencil strokes while preserving their endpoints", () => {
  const points = Array.from({ length: 1_500 }, (_, index) => ({ x: index / 1_499, y: 0.5 }));
  const simplified = simplifyStroke(points, 0, 100);
  assert.equal(simplified.length, 100);
  assert.deepEqual(simplified[0], points[0]);
  assert.deepEqual(simplified.at(-1), points.at(-1));
});
