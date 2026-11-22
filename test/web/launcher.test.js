import assert from "node:assert/strict";
import test from "node:test";

import { launcherProjects, openedLabel, projectStats, statsLabel, touchProject } from "../../source/web/launcher.js";
import { compareVersions, normalizeUpdateState, updateNotesLines } from "../../source/web/update.js";

const projects = [
  { id: "a", title: "Zéro de conduite", lastOpenedAt: 10 },
  { id: "b", title: "À bout de souffle", lastOpenedAt: 30 },
  { id: "c", title: "Cléo", archived: true },
  { id: "d", title: "Mépris", detail: "YouTube · 1963" },
];

test("lists active projects by recency, title or library order", () => {
  assert.deepEqual(launcherProjects(projects).map(({ project }) => project.id), ["b", "a", "d"]);
  assert.deepEqual(launcherProjects(projects, { sort: "title" }).map(({ project }) => project.id), ["b", "d", "a"]);
  assert.deepEqual(launcherProjects(projects, { sort: "created" }).map(({ index }) => index), [0, 1, 3]);
  assert.deepEqual(launcherProjects(projects, { archived: true }).map(({ project }) => project.id), ["c"]);
  assert.deepEqual(launcherProjects(projects, { query: "youtube" }).map(({ project }) => project.id), ["d"]);
});

test("describes recency and project contents", () => {
  const now = new Date(2026, 10, 22, 15, 0).getTime();
  assert.equal(openedLabel(0, now), "Jamais ouvert");
  assert.equal(openedLabel(now - 86_400_000, now), "Hier");
  assert.equal(openedLabel(now - 3 * 86_400_000, now), "Il y a 3 jours");
  assert.match(openedLabel(now - 60_000, now), /^Aujourd’hui/);
  const stats = projectStats({ markers: [{ time: 1 }, { time: 2, endTime: 4 }], annotationsByMarker: { 1: [{}], 2: [] }, script: "INT. CUISINE" });
  assert.deepEqual(stats, { markers: 2, plans: 1, annotated: 1, hasScript: true });
  assert.equal(statsLabel(stats), "2 repères · 1 plan · 1 image annotée");
  assert.equal(touchProject(projects, "a", 99)[0].lastOpenedAt, 99);
});

test("compares versions and normalizes update events", () => {
  assert.equal(compareVersions("1.2.0", "1.1.9"), 1);
  assert.equal(compareVersions("v1.2", "1.2.0"), 0);
  assert.equal(compareVersions("1.10.0", "1.9.0"), 1);
  assert.equal(compareVersions("1.0.0", "1.0.1"), -1);
  const state = normalizeUpdateState({ stage: "downloading", progress: 4, version: "1.2.0" });
  assert.equal(state.stage, "downloading");
  assert.equal(state.progress, 1);
  assert.equal(normalizeUpdateState({ stage: "hack" }).stage, "idle");
  assert.deepEqual(updateNotesLines("## Nouveautés\n- Accueil\n* Plans\n\n"), ["Nouveautés", "Accueil", "Plans"]);
});
