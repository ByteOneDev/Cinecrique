import assert from "node:assert/strict";
import test from "node:test";

import {
  composeNotes,
  insertPlanEmbed,
  moveNotesSegment,
  notesForExport,
  notesPlanReferences,
  parsePlanEmbed,
  planEmbedToken,
  removeNotesSegment,
  replaceNotesSegment,
  splitNotes,
  updatePlanEmbedTitle,
} from "../../source/web/notes.js";

const token = planEmbedToken({ id: "m-1", title: "Le [regard]", time: 12.3456789 });

test("writes and parses a plan reference line", () => {
  assert.equal(token, "![Le regard](cinecrique:plan/m-1?t=12.346)");
  assert.deepEqual(parsePlanEmbed(token), { title: "Le regard", markerId: "m-1", time: 12.346 });
  assert.equal(parsePlanEmbed("texte ![a](cinecrique:plan/m-1)"), null);
  assert.equal(parsePlanEmbed("![a](cinecrique:plan/../x)"), null);
  assert.equal(planEmbedToken({ id: "a b", time: 1 }), "");
});

test("splits notes around plans and recomposes them exactly", () => {
  const markdown = `Intro\nsuite\n${token}\nConclusion`;
  const segments = splitNotes(markdown);
  assert.deepEqual(segments.map((segment) => segment.type), ["text", "plan", "text"]);
  assert.equal(composeNotes(segments), markdown);
  assert.equal(notesPlanReferences(markdown).length, 1);
});

test("adds editable virtual slots without changing the Markdown", () => {
  const markdown = `${token}\n${token}`;
  const segments = splitNotes(markdown, { withSlots: true });
  assert.deepEqual(segments.map((segment) => `${segment.type}${segment.virtual ? "*" : ""}`), ["text*", "plan", "text*", "plan", "text*"]);
  assert.equal(composeNotes(segments), markdown);
  assert.equal(replaceNotesSegment(segments, 2, "entre"), `${token}\nentre\n${token}`);
  assert.equal(replaceNotesSegment(segments, 4, "fin"), `${token}\n${token}\nfin`);
  assert.equal(removeNotesSegment(segments, 1), token);
});

test("inserts plans on their own line and moves or renames them", () => {
  const inserted = insertPlanEmbed("AB", 1, token);
  assert.equal(inserted.markdown, `A\n${token}\nB`);
  const other = planEmbedToken({ id: "m-2", title: "Autre", time: 2 });
  const markdown = `${token}\ntexte\n${other}`;
  const segments = splitNotes(markdown);
  assert.equal(moveNotesSegment(segments, 0, 1), `${other}\ntexte\n${token}`);
  assert.equal(moveNotesSegment(segments, 0, -1), markdown);
  assert.match(updatePlanEmbedTitle(segments, 0, "Nouveau"), /^!\[Nouveau\]\(cinecrique:plan\/m-1\?t=12\.346\)/);
});

test("exports plans as readable timecoded quotes", () => {
  const markdown = `Avant\n${token}`;
  const markers = [{ id: "m-1", time: 20, endTime: 25, title: "Plan déplacé" }];
  assert.equal(notesForExport(markdown, markers, (value) => `TC${value}`), "Avant\n> **Plan TC20 → TC25** · Plan déplacé");
  assert.equal(notesForExport(markdown, [], (value) => `TC${value}`), "Avant\n> **Plan TC12.346** · Le regard");
});
