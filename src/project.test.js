import assert from "node:assert/strict";
import test from "node:test";

import { migrateDocument, migratePersistedState } from "./project.js";

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
  assert.deepEqual(migrated.annotationsByMarker, document.annotationsByMarker);
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

  assert.equal(migrated.version, 4);
  assert.equal(migrated.activeProjectId, "film");
  assert.equal(migrated.documents.film.markers[0].endTime, 8);
  assert.deepEqual(migrated.preferences, { leftPanel: 67, format: "Fountain", projectRailCollapsed: true });
});

test("rejects corrupt project envelopes", () => {
  assert.throws(() => migratePersistedState(null), /objet valide/);
  assert.throws(() => migratePersistedState({ projects: [] }), /aucun projet valide/);
  assert.throws(() => migratePersistedState({ projects: [null] }), /projet importé est invalide/);
});
