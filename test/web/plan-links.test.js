import assert from "node:assert/strict";
import test from "node:test";

import {
  fountainContext,
  fountainPlanLinks,
  fountainScenes,
  fountainTitle,
  insertPlanLinkAt,
  markerSceneIndexes,
  mergeImportedFountain,
  normalizeFountainImport,
  planLinkIdentifier,
  planLinkNote,
  removePlanLinks,
  scenePlanLinks,
  setPlanScene,
} from "../../source/web/fountain.js";

const script = "INT. CUISINE — JOUR\n\nCamille entre.\n\nEXT. JARDIN — NUIT\n\nPaul attend.";
const format = (value) => `TC${value}`;

test("builds a Fountain note that only references the marker", () => {
  assert.equal(planLinkNote({ id: "abc-1", time: 12, title: "Regard [mer]\nfinal" }, format), "[[plan:abc-1 TC12 — Regard mer final]]");
  assert.equal(planLinkNote({ id: 3, time: 1, title: "" }, format), "[[plan:3 TC1]]");
  assert.equal(planLinkNote({ id: "a b", time: 1 }, format), "");
  assert.equal(planLinkIdentifier("x/y"), null);
});

test("links plans to scenes and resolves them from the script text", () => {
  const linked = setPlanScene(script, "p1", 1, "[[plan:p1 TC4]]");
  assert.match(linked, /EXT\. JARDIN — NUIT\n\[\[plan:p1 TC4\]\]\n/);
  const withSecond = setPlanScene(linked, "p2", 1, "[[plan:p2 TC9]]");
  assert.ok(withSecond.indexOf("plan:p1") < withSecond.indexOf("plan:p2"), "new links follow existing ones");
  const scenes = fountainScenes(withSecond);
  assert.equal(scenes.length, 2);
  assert.deepEqual(scenePlanLinks(withSecond, scenes).get(1).map((link) => link.markerId), ["p1", "p2"]);
  assert.deepEqual(markerSceneIndexes(withSecond, scenes).get("p2"), [1]);
  const moved = setPlanScene(withSecond, "p1", 0, "[[plan:p1 TC4]]");
  assert.deepEqual(markerSceneIndexes(moved).get("p1"), [0]);
  assert.equal(fountainPlanLinks(moved).filter((link) => link.markerId === "p1").length, 1);
});

test("removes links without leaving empty lines and keeps other notes", () => {
  const value = "INT. A\n[[plan:p1 TC]]\nTexte [[plan:p2]] fin\n[[note libre]]";
  assert.equal(removePlanLinks(value, "p1"), "INT. A\nTexte [[plan:p2]] fin\n[[note libre]]");
  assert.equal(removePlanLinks(value, "p2"), "INT. A\n[[plan:p1 TC]]\nTexte  fin\n[[note libre]]");
  assert.equal(setPlanScene(value, "p1", null, ""), "INT. A\nTexte [[plan:p2]] fin\n[[note libre]]");
});

test("inserts a link on its own line at the caret", () => {
  const result = insertPlanLinkAt("AB", 1, "[[plan:x]]");
  assert.equal(result.script, "A\n[[plan:x]]\nB");
  assert.equal(result.caret, 12);
  assert.equal(insertPlanLinkAt("A\n", 2, "[[plan:x]]").script, "A\n[[plan:x]]");
});

test("plan notes never pollute the completion context", () => {
  const context = fountainContext("INT. A\n[[PLAN:ABC]]\nCAMILLE\nSalut");
  assert.deepEqual(context.characters, ["CAMILLE"]);
});

test("normalizes imported Fountain files and reads their title page", () => {
  assert.equal(normalizeFountainImport("﻿Title: Test\r\nAuthor: Moi\r\n\r\nINT. A"), "Title: Test\nAuthor: Moi\n\nINT. A");
  assert.throws(() => normalizeFountainImport("x".repeat(2_000_001)), RangeError);
  assert.equal(fountainTitle("Title: _Le Mépris_\nAuthor: JLG\n\nINT. A"), "Le Mépris");
  assert.equal(fountainTitle("Title:\n    LA NUIT\n    AMÉRICAINE\nCredit: écrit par\n\nINT. A"), "LA NUIT AMÉRICAINE");
  assert.equal(fountainTitle("INT. CUISINE\n\nTitle: pas une page de titre"), "");
  assert.equal(mergeImportedFountain("INT. ", "EXT. B", "append"), "EXT. B");
  assert.equal(mergeImportedFountain("INT. A\n\n", "\nEXT. B", "append"), "INT. A\n\nEXT. B");
  assert.equal(mergeImportedFountain("INT. A", "EXT. B", "replace"), "EXT. B");
});
