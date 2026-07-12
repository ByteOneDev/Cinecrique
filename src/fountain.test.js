import assert from "node:assert/strict";
import test from "node:test";

import {
  fountainCompletion,
  fountainContext,
  fountainSceneIndexAtOffset,
  fountainScenes,
} from "./fountain.js";

test("extracts recent scenes and characters from Fountain and project cast", () => {
  const context = fountainContext("INT. CUISINE — JOUR\n\nCAMILLE\nBonjour", { tmdb: { cast: ["Paul Javal"] } });
  assert.deepEqual(context.scenes, ["INT. CUISINE — JOUR"]);
  assert.deepEqual(context.characters, ["CAMILLE", "PAUL JAVAL"]);
});

test("completes context without replacing the typed prefix", () => {
  const context = { scenes: ["INT. CUISINE — JOUR"], characters: ["CAMILLE"] };
  assert.equal(fountainCompletion("CAM", context), "ILLE");
  assert.equal(fountainCompletion("INT. CUI", context), "SINE — JOUR");
  assert.equal(fountainCompletion("Action libre", context), "");
});

test("detects standard and forced Fountain scenes with full selection ranges", () => {
  const document = "INT. CUISINE — JOUR\n\nAction.\n\n.QUAI — NUIT\n\nSuite.\n\nI/E. VOITURE — JOUR\nFin.";
  const scenes = fountainScenes(document);

  assert.deepEqual(scenes.map((scene) => scene.heading), [
    "INT. CUISINE — JOUR",
    "QUAI — NUIT",
    "I/E. VOITURE — JOUR",
  ]);
  assert.equal(document.slice(scenes[0].start, scenes[0].end), "INT. CUISINE — JOUR\n\nAction.");
  assert.equal(document.slice(scenes[1].start, scenes[1].end), ".QUAI — NUIT\n\nSuite.");
  assert.equal(fountainSceneIndexAtOffset(scenes, document.indexOf("Suite")), 1);
  assert.equal(fountainSceneIndexAtOffset([], 0), -1);
});
