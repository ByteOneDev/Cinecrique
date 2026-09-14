import assert from "node:assert/strict";
import test from "node:test";

import {
  duplicateMarker,
  filterMarkers,
  markerIsRange,
  migrateMarker,
  parseTimecode,
  removeMarker,
  timelineKeyboardTarget,
  timelinePointerTarget,
} from "../../source/web/markers.js";

test("migrates the legacy Séquence scope to a real five-second range", () => {
  const marker = migrateMarker({ id: 1, time: 12, title: "Ancien", tag: "Séquence", scope: "range" });
  assert.equal(marker.endTime, 17);
  assert.equal(marker.scope, undefined);
  assert.equal(markerIsRange(marker), true);
  assert.deepEqual(marker.shot, { shotType: "", movement: "", characters: "", sound: "" });
});

test("combines search, type, tag, favorite and time filters", () => {
  const markers = [
    { id: 1, time: 5, endTime: 9, type: "note", title: "Mer", detail: "Bleu", tag: "Cadre", bookmarked: true },
    { id: 2, time: 20, type: "link", title: "Studio", detail: "", tag: "Contexte", bookmarked: false },
  ];
  assert.deepEqual(filterMarkers(markers, "bleu", {
    types: ["note"], tags: ["Cadre"], bookmarkedOnly: true, from: 7, to: 8,
  }).map((marker) => marker.id), [1]);
});

test("keeps every marker when optional time filters are empty", () => {
  const markers = [
    { id: 1, time: 12, title: "Début", type: "note" },
    { id: 2, time: 90, title: "Suite", type: "frame" },
  ];
  assert.deepEqual(filterMarkers(markers, "", { from: null, to: null }).map((marker) => marker.id), [1, 2]);
});

test("duplicates a range while preserving its duration", () => {
  const duplicate = duplicateMarker({ id: 1, time: 4, endTime: 9, title: "Plan", bookmarked: true }, 2, 1);
  assert.equal(duplicate.time, 5);
  assert.equal(duplicate.endTime, 10);
  assert.equal(duplicate.bookmarked, false);
});

test("removes a marker and its annotations", () => {
  const result = removeMarker([{ id: 1 }, { id: 2 }], { 1: [{ id: "a" }], 2: [] }, 1);
  assert.deepEqual(result.markers, [{ id: 2 }]);
  assert.equal(result.annotationsByMarker[1], undefined);
});

test("parses frame and decimal timecodes", () => {
  assert.equal(parseTimecode("01:02:03:12", 24), 3723.5);
  assert.equal(parseTimecode("00:00:03.250", 24), 3.25);
  assert.equal(parseTimecode("00:00:03:24", 24), null);
});

test("maps timeline keyboard shortcuts and clamps them", () => {
  assert.equal(timelineKeyboardTarget("ArrowRight", 1, 10, 25), 1.04);
  assert.equal(timelineKeyboardTarget("PageDown", 2, 10, 25), 0);
  assert.equal(timelineKeyboardTarget("End", 2, 10, 25), 10);
  assert.equal(timelineKeyboardTarget("x", 2, 10, 25), null);
});

test("maps and clamps pointer positions on the timeline", () => {
  assert.equal(timelinePointerTarget(150, 100, 200, 120), 30);
  assert.equal(timelinePointerTarget(20, 100, 200, 120), 0);
  assert.equal(timelinePointerTarget(400, 100, 200, 120), 120);
  assert.equal(timelinePointerTarget(150, 100, 0, 120), 0);
});
