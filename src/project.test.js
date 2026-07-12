import assert from "node:assert/strict";
import test from "node:test";

import {
  migrateDocument,
  migratePersistedState,
  moveProject,
  removeProject,
  renameProject,
  setProjectArchived,
} from "./project.js";

test("merges an automatic image marker into a note on the same frame", () => {
  const migrated = migrateDocument({
    markers: [
      { id: 1, time: 4.5, title: "Annotation d’image" },
      { id: 2, time: 4.5, title: "Distance dans le cadre" },
    ],
    annotationsByMarker: {
      1: [{ id: "point-1", type: "point" }],
      2: [{ id: "arrow-1", type: "arrow" }],
    },
    selectedMarkerId: 1,
  }, 24);

  assert.deepEqual(migrated.markers, [{
    id: 2,
    time: 4.5,
    title: "Distance dans le cadre",
    type: "note",
    detail: "",
    tag: "",
    bookmarked: false,
  }]);
  assert.deepEqual(migrated.annotationsByMarker[2].map((item) => item.id), ["arrow-1", "point-1"]);
  assert.deepEqual(migrated.annotationsByMarker[2].map((item) => item.time), [4.5, 4.5]);
  assert.equal(migrated.selectedMarkerId, 2);
});

test("keeps an automatic marker when no note shares its frame", () => {
  const document = {
    markers: [
      { id: 1, time: 4.5, title: "Annotation d’image" },
      { id: 2, time: 5, title: "Autre note" },
    ],
    annotationsByMarker: { 1: [{ id: "point-1", type: "point" }] },
    selectedMarkerId: 1,
  };

  const migrated = migrateDocument(document, 24);
  assert.deepEqual(migrated.markers.map(({ id, time, title }) => ({ id, time, title })), document.markers);
  assert.deepEqual(migrated.annotationsByMarker, {
    1: [{ id: "point-1", type: "point", time: 4.5 }],
  });
  assert.equal(migrated.selectedMarkerId, document.selectedMarkerId);
});

test("migrates legacy range markers without losing their content", () => {
  const migrated = migrateDocument({
    markers: [{ id: 1, time: 12, title: "Séquence", detail: "Contenu", tag: "Séquence", scope: "range" }],
    annotationsByMarker: {},
    selectedMarkerId: 1,
  }, 24);

  assert.equal(migrated.markers[0].endTime, 17);
  assert.equal(migrated.markers[0].detail, "Contenu");
  assert.equal(migrated.markers[0].scope, undefined);
});

test("migrates an old persisted project and clamps its preferences", () => {
  const migrated = migratePersistedState({
    version: 1,
    projects: [{ id: "film", title: "Film" }],
    activeProjectId: "missing",
    documents: {
      film: { markers: [{ id: 1, time: 3, title: "Séquence", scope: "range" }] },
    },
    preferences: { leftPanel: 99, format: "Unknown", projectRailCollapsed: 1 },
  });

  assert.equal(migrated.version, 6);
  assert.equal(migrated.activeProjectId, "film");
  assert.equal(migrated.projects[0].archived, false);
  assert.deepEqual(migrated.projects[0].cover, { mode: "logo" });
  assert.deepEqual(migrated.projects[0].timecode, {
    source: "auto",
    rate: "24/1",
    offsetFrames: 0,
    dropFrame: false,
  });
  assert.equal(migrated.documents.film.markers[0].endTime, 8);
  assert.deepEqual(migrated.documents.film.transport, {
    loopStart: null,
    loopEnd: null,
    loopEnabled: false,
    playbackRate: 1,
  });
  assert.deepEqual(migrated.documents.film.comparison, {
    a: null,
    b: null,
    syncZoom: true,
    note: "",
  });
  assert.deepEqual(migrated.preferences, {
    leftPanel: 67,
    projectRailCollapsed: true,
    muted: false,
    shortcuts: {
      togglePlayback: " ", reverse: "j", pause: "k", forward: "l", slower: "r",
      silent: "a", loopStart: "i", loopEnd: "o", mute: "m",
    },
  });
  assert.equal(migrated.documents.film.script, undefined);
});

test("rejects corrupt project envelopes", () => {
  assert.throws(() => migratePersistedState(null), /objet valide/);
  assert.throws(() => migratePersistedState({ projects: [] }), /aucun projet valide/);
  assert.throws(() => migratePersistedState({ projects: [null] }), /projet importé est invalide/);
});

test("keeps an intentional empty workspace from version five", () => {
  const migrated = migratePersistedState({ version: 5, projects: [], documents: {} });
  assert.deepEqual(migrated.projects, []);
  assert.equal(migrated.activeProjectId, null);
  assert.equal(migrated.version, 6);
});

test("keeps legacy script text while removing the global writing format", () => {
  const migrated = migratePersistedState({
    version: 5,
    projects: [{ id: "film", title: "Film" }],
    documents: { film: { script: "# Ancien texte Markdown" } },
    preferences: { format: "Markdown" },
  });

  assert.equal(migrated.documents.film.script, "# Ancien texte Markdown");
  assert.equal("format" in migrated.preferences, false);
});

test("preserves v5 transport, comparison and custom shortcuts after migration", () => {
  const migrated = migratePersistedState({
    version: 5,
    projects: [{ id: "film", title: "Film" }],
    activeProjectId: "film",
    documents: {
      film: {
        markers: [{ id: 7, time: 12, title: "Cadre" }],
        transport: { loopStart: 10, loopEnd: 20, loopEnabled: true, playbackRate: 2 },
        comparison: { a: { time: 12, markerId: 7 }, b: { time: 18 }, syncZoom: false, note: "Écho visuel" },
      },
    },
    preferences: { shortcuts: { reverse: "x", pause: "k" } },
  });

  assert.deepEqual(migrated.documents.film.transport, {
    loopStart: 10,
    loopEnd: 20,
    loopEnabled: true,
    playbackRate: 2,
  });
  assert.deepEqual(migrated.documents.film.comparison, {
    a: { time: 12, markerId: "7" },
    b: { time: 18, markerId: null },
    syncZoom: false,
    note: "Écho visuel",
  });
  assert.equal(migrated.preferences.shortcuts.reverse, "x");
});

test("migrates archived projects without selecting one as active", () => {
  const migrated = migratePersistedState({
    version: 4,
    projects: [{ id: "archive", title: "Archive", archived: true }],
    activeProjectId: "archive",
  });
  assert.equal(migrated.activeProjectId, null);
  assert.equal(migrated.projects[0].archived, true);
});

test("renames, archives and reorders projects inside their own section", () => {
  const projects = [
    { id: "a", title: "A" },
    { id: "b", title: "B" },
    { id: "c", title: "C", archived: true },
  ];
  assert.equal(renameProject(projects, "a", "  Nouveau titre  ")[0].title, "Nouveau titre");
  assert.equal(setProjectArchived(projects, "b", true)[1].archived, true);
  assert.deepEqual(moveProject(projects, "b", -1).map((project) => project.id), ["b", "a", "c"]);
  assert.equal(moveProject(projects, "c", -1), projects);
});

test("deletes only project data and chooses the next active project", () => {
  const result = removeProject(
    [{ id: "a" }, { id: "b" }, { id: "archive", archived: true }],
    { a: { script: "A" }, b: { script: "B" }, archive: { script: "C" } },
    "a",
    "a",
  );
  assert.deepEqual(result.projects.map((project) => project.id), ["b", "archive"]);
  assert.equal(result.documents.a, undefined);
  assert.equal(result.documents.b.script, "B");
  assert.equal(result.activeProjectId, "b");
});
