import assert from "node:assert/strict";
import test from "node:test";

import { buildTextExportFiles, exportSelectionCount, markerMarkdown, safeExportBaseName } from "./export.js";

test("builds only the selected text exports with safe names", () => {
  const files = buildTextExportFiles({ script: true, analysis: true, markers: false }, {
    title: "Cléo / 5 à 7",
    script: "INT. CAFÉ — JOUR",
    analysis: "# Notes",
  });
  assert.deepEqual(files.map((file) => file.name), ["Cleo-5-a-7-script.fountain", "Cleo-5-a-7-analyse.md"]);
  assert.equal(safeExportBaseName("../../"), "cinecrique");
});

test("always exports the scenario as Fountain", () => {
  const files = buildTextExportFiles({ script: true }, {
    title: "Film",
    format: "Markdown",
    script: "INT. SALON — JOUR",
  });
  assert.equal(files[0].name, "Film-script.fountain");
});

test("formats range markers in Markdown", () => {
  const markdown = markerMarkdown([
    { time: 2, endTime: 7, title: "Plan long", type: "frame", tag: "Cadre", bookmarked: true, detail: "Durée lisible" },
  ], (time) => `TC-${time}`);
  assert.match(markdown, /TC-2 → TC-7/);
  assert.match(markdown, /signet/);
});

test("counts current or all annotated frames without double counting", () => {
  assert.equal(exportSelectionCount({ script: true, video: true, currentFrame: true, allFrames: false }), 3);
  assert.equal(exportSelectionCount({ currentFrame: true, allFrames: true }, 4), 4);
});

test("counts a project package without exposing it as a plain text export", () => {
  const options = { project: true, portableProject: true };
  assert.equal(exportSelectionCount(options), 1);
  assert.deepEqual(buildTextExportFiles(options, { title: "Film" }), []);
});

test("counts HTML and PDF reports as distinct export items", () => {
  assert.equal(exportSelectionCount({ reportHtml: true, reportPdf: true }), 2);
});
