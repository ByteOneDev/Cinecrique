import assert from "node:assert/strict";
import test from "node:test";

import { filterAndSortShots, normalizeShot, shotRows, updateShotMarker } from "./shots.js";

test("derives plan rows only from range markers", () => {
  const markers = [
    { id: 1, time: 2, endTime: 8, title: "Plan large" },
    { id: 2, time: 9, title: "Note ponctuelle" },
  ];
  assert.deepEqual(shotRows(markers).map((marker) => marker.id), [1]);
});

test("edits shot metadata without duplicating marker fields", () => {
  const marker = { id: 1, time: 2, endTime: 8, title: "Plan", detail: "", tag: "" };
  const typed = updateShotMarker(marker, "shotType", "Plan moyen");
  const commented = updateShotMarker(typed, "comment", "Le cadre se ferme");
  assert.deepEqual(normalizeShot(commented.shot), {
    shotType: "Plan moyen", movement: "", characters: "", sound: "",
  });
  assert.equal(commented.detail, "Le cadre se ferme");
});

test("filters and sorts plan rows from marker data", () => {
  const markers = [
    { id: 1, time: 20, endTime: 25, title: "Mer", tag: "Cadre", shot: { shotType: "Plan général" } },
    { id: 2, time: 4, endTime: 12, title: "Visage", tag: "Jeu", shot: { shotType: "Gros plan" } },
  ];
  assert.deepEqual(filterAndSortShots(markers, { type: "Gros plan" }).map((marker) => marker.id), [2]);
  assert.deepEqual(filterAndSortShots(markers, { sortKey: "duration", direction: "desc" }).map((marker) => marker.id), [2, 1]);
});
