import assert from "node:assert/strict";
import test from "node:test";

import { fountainCompletion, fountainContext } from "./fountain.js";

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
