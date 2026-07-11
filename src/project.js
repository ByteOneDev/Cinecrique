import { migrateMarkers } from "./markers.js";

export function migrateDocument(document, frameRate = 24) {
  if (!document) return document;

  const markers = migrateMarkers(document.markers || []);
  const annotationsByMarker = { ...(document.annotationsByMarker || {}) };
  const removedIds = new Set();
  let selectedMarkerId = document.selectedMarkerId ?? null;
  const tolerance = 0.5 / Math.max(Number(frameRate) || 24, 1);

  for (const marker of markers) {
    if (marker.title !== "Annotation d’image") continue;
    const annotations = annotationsByMarker[marker.id] || [];
    if (!annotations.length) continue;

    const target = markers.find((candidate) => (
      candidate.id !== marker.id
      && candidate.title !== "Annotation d’image"
      && Math.abs(candidate.time - marker.time) <= tolerance
    ));
    if (!target) continue;

    annotationsByMarker[target.id] = [...(annotationsByMarker[target.id] || []), ...annotations];
    delete annotationsByMarker[marker.id];
    removedIds.add(marker.id);
    if (selectedMarkerId === marker.id) selectedMarkerId = target.id;
  }

  return {
    ...document,
    markers: markers.filter((marker) => !removedIds.has(marker.id)),
    annotationsByMarker,
    selectedMarkerId,
  };
}

export function migratePersistedState(state, frameRateForProject = () => 24) {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    throw new TypeError("Le fichier de projet n’est pas un objet valide.");
  }
  if (!Array.isArray(state.projects) || state.projects.length === 0 || state.projects.length > 500) {
    throw new TypeError("Le fichier de projet ne contient aucun projet valide.");
  }

  const seenIds = new Set();
  const projects = state.projects.map((project, index) => {
    if (!project || typeof project !== "object" || Array.isArray(project)) {
      throw new TypeError("Un projet importé est invalide.");
    }
    const fallbackId = `importe-${index + 1}`;
    let id = String(project.id || fallbackId).slice(0, 1_024);
    if (seenIds.has(id)) id = `${id}-${index + 1}`;
    seenIds.add(id);
    return {
      ...project,
      id,
      title: String(project.title || "Projet sans titre").slice(0, 500),
      detail: String(project.detail || "Analyse locale").slice(0, 500),
      poster: String(project.poster || "./assets/poster-coast.png"),
    };
  });

  const sourceDocuments = state.documents && typeof state.documents === "object" && !Array.isArray(state.documents)
    ? state.documents
    : {};
  const documents = Object.fromEntries(projects.map((project) => [
    project.id,
    migrateDocument(sourceDocuments[project.id] || {}, frameRateForProject(project)),
  ]));
  const activeProjectId = projects.some((project) => project.id === state.activeProjectId)
    ? state.activeProjectId
    : projects[0].id;
  const rawPanel = Number(state.preferences?.leftPanel);

  return {
    version: 4,
    projects,
    activeProjectId,
    documents,
    preferences: {
      leftPanel: Number.isFinite(rawPanel) ? Math.min(Math.max(rawPanel, 43), 67) : 57,
      format: state.preferences?.format === "Markdown" ? "Markdown" : "Fountain",
      projectRailCollapsed: Boolean(state.preferences?.projectRailCollapsed),
    },
  };
}
