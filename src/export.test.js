import assert from "node:assert/strict";
import test from "node:test";

import { buildTextExportFiles, exportSelectionCount, markerMarkdown, safeExportBaseName } from "./export.js";

test("builds only the selected text exports with safe names", () => {
  const files = buildTextExportFiles({ script: true, analysis: true, markers: false }, {
    title: "Cléo / 5 à 7",
    format: "Fountain",
    script: "INT. CAFÉ — JOUR",
    analysis: "# Notes",
  });
  assert.deepEqual(files.map((file) => file.name), ["Cleo-5-a-7-script.fountain", "Cleo-5-a-7-analyse.md"]);
  assert.equal(safeExportBaseName("../../"), "cinecrique");
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
