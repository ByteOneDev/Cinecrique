import assert from "node:assert/strict";
import test from "node:test";

import {
  clampComparisonZoom,
  comparisonAnnotations,
  comparisonMarker,
  emptyComparison,
  normalizeComparison,
  pinComparison,
} from "./comparison.js";

test("pins lightweight A/B references and normalizes old documents", () => {
  const a = pinComparison(emptyComparison(), "a", 12.5, 7);
  const both = pinComparison(a, "b", 19, null);
  assert.deepEqual(both.a, { time: 12.5, markerId: "7" });
  assert.deepEqual(both.b, { time: 19, markerId: null });
  assert.deepEqual(normalizeComparison({ a: { time: -1 }, note: "x" }), { a: null, b: null, syncZoom: true, note: "x" });
});

test("resolves live markers and annotations for pinned images", () => {
  const reference = { time: 2, markerId: "7" };
  assert.equal(comparisonMarker([{ id: 7, title: "Plan" }], reference).title, "Plan");
  assert.deepEqual(comparisonAnnotations({ 7: [{ id: "arrow" }] }, reference), [{ id: "arrow" }]);
});

test("clamps comparison zoom between one and four", () => {
  assert.equal(clampComparisonZoom(0.2), 1);
  assert.equal(clampComparisonZoom(2.5), 2.5);
  assert.equal(clampComparisonZoom(7), 4);
});

