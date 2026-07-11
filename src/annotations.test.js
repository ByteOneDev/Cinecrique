import assert from "node:assert/strict";
import test from "node:test";

import { moveAnnotation, updatePointLabel } from "./annotations.js";

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
