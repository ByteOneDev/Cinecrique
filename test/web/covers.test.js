import assert from "node:assert/strict";
import test from "node:test";

import { normalizeProjectCover, projectCoverImage, projectCoverText } from "../../source/web/covers.js";

test("migrates bundled legacy posters without inventing a random cover", () => {
  const project = { poster: "./assets/poster-paris.png" };
  assert.deepEqual(normalizeProjectCover(null, project.poster), {
    mode: "image", source: "bundled", value: "./assets/poster-paris.png",
  });
  assert.equal(projectCoverImage(project), project.poster);
  assert.deepEqual(normalizeProjectCover(null, "./assets/unknown.png"), { mode: "logo" });
});

test("supports text and bounded generated image covers", () => {
  assert.equal(projectCoverText({ title: "Film", cover: { mode: "text", text: "  Chapitre I  " } }), "Chapitre I");
  const dataURL = "data:image/jpeg;base64,YWJj";
  assert.equal(normalizeProjectCover({ mode: "image", source: "frame", value: dataURL }).value, dataURL);
  assert.deepEqual(normalizeProjectCover({ mode: "image", value: "javascript:alert(1)" }), { mode: "logo" });
});

