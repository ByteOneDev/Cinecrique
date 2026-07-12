import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_REPORT_IMAGES,
  buildReportModel,
  defaultReportSelection,
  reportAnnotatedFrames,
  reportSelectionHasContent,
} from "./report.js";

test("builds only selected report sections", () => {
  const script = "INT. SALON - JOUR\n\nAction.\n\nEXT. RUE - NUIT\n\nSuite.";
  const scenes = [
    { index: 0, heading: "INT. SALON - JOUR", start: 0, end: 27 },
    { index: 1, heading: "EXT. RUE - NUIT", start: 29, end: script.length },
  ];
  const model = buildReportModel({
    project: { title: "Film", detail: "Analyse" },
    metadataRows: [["Cadence", "24 i/s"]],
    markers: [{ id: 1, time: 2, title: "Repère", detail: "Texte" }],
    analysis: "# Axe",
    scenes,
    script,
    selection: { ...defaultReportSelection(), markers: false, shots: false, sceneIndexes: [1] },
    formatTimecode: (value) => `TC-${value}`,
  });

  assert.equal(model.title, "Film");
  assert.deepEqual(model.markers, []);
  assert.equal(model.projectInfo[0].value, "24 i/s");
  assert.equal(model.scenes.length, 1);
  assert.equal(model.scenes[0].heading, "EXT. RUE - NUIT");
});

test("derives shot rows from range markers without duplicating data", () => {
  const model = buildReportModel({
    markers: [
      { id: 1, time: 1, title: "Point" },
      { id: 2, time: 2, endTime: 8, title: "Plan", shot: { shotType: "Gros plan", movement: "Fixe" } },
    ],
    selection: { ...defaultReportSelection(), projectInfo: false, markers: false, analysis: false },
    formatTimecode: (value) => `TC-${value}`,
    formatDuration: (value) => `${value}s`,
  });
  assert.equal(model.shots.length, 1);
  assert.equal(model.shots[0].title, "Plan");
  assert.equal(model.shots[0].duration, "6s");
});

test("limits annotated report images and keeps explicit selection", () => {
  const frames = Array.from({ length: MAX_REPORT_IMAGES + 5 }, (_, index) => ({
    marker: { id: index + 1 },
    annotations: [{ id: `a-${index}` }],
  }));
  const selected = frames.map(({ marker }) => marker.id);
  assert.equal(reportAnnotatedFrames(frames, selected).length, MAX_REPORT_IMAGES);
  assert.deepEqual(reportAnnotatedFrames(frames, [3]).map(({ marker }) => marker.id), [3]);
});

test("requires at least one selected report section", () => {
  assert.equal(reportSelectionHasContent({}), false);
  assert.equal(reportSelectionHasContent({ analysis: true }), true);
  assert.equal(reportSelectionHasContent({ images: true, imageMarkerIds: [] }), false);
  assert.equal(reportSelectionHasContent({ sceneIndexes: [0] }), true);
});

