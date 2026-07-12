import { migrateMarkers } from "./markers.js";
import { normalizeShortcuts, normalizeTransport } from "./transport.js";
import { normalizeTimecodeSettings } from "./timecode.js";
import { normalizeComparison } from "./comparison.js";
import { migrateAnnotationTimes } from "./annotations.js";
import { normalizeProjectCover } from "./covers.js";

export function migrateDocument(document, frameRate = 24) {
  if (!document) return document;

  const markers = migrateMarkers(document.markers || []);
  const annotationsByMarker = { ...(document.annotationsByMarker || {}) };
  const removedIds = new Set();
  let selectedMarkerId = document.selectedMarkerId ?? null;
  const tolerance = 0.5 / Math.max(Number(frameRate) || 24, 1);

  for (const marker of markers) {
    if (Object.hasOwn(annotationsByMarker, marker.id)) {
      annotationsByMarker[marker.id] = migrateAnnotationTimes(annotationsByMarker[marker.id], marker.time);
    }
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
    transport: normalizeTransport(document.transport),
    comparison: normalizeComparison(document.comparison),
  };
}

export function migratePersistedState(state, frameRateForProject = () => 24) {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    throw new TypeError("Le fichier de projet n’est pas un objet valide.");
  }
  if (
    !Array.isArray(state.projects)
    || state.projects.length > 500
    || (state.projects.length === 0 && (Number(state.version) || 0) < 5)
  ) {
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
      cover: normalizeProjectCover(project.cover, project.poster),
      archived: Boolean(project.archived),
      timecode: normalizeTimecodeSettings(project.timecode, frameRateForProject(project)),
    };
  });

  const sourceDocuments = state.documents && typeof state.documents === "object" && !Array.isArray(state.documents)
    ? state.documents
    : {};
  const documents = Object.fromEntries(projects.map((project) => [
    project.id,
    migrateDocument(sourceDocuments[project.id] || {}, frameRateForProject(project)),
  ]));
  const activeProjectId = projects.some((project) => project.id === state.activeProjectId && !project.archived)
    ? state.activeProjectId
    : projects.find((project) => !project.archived)?.id ?? null;
  const rawPanel = Number(state.preferences?.leftPanel);

  return {
    version: 6,
    projects,
    activeProjectId,
    documents,
    preferences: {
      leftPanel: Number.isFinite(rawPanel) ? Math.min(Math.max(rawPanel, 43), 67) : 57,
      projectRailCollapsed: Boolean(state.preferences?.projectRailCollapsed),
      muted: Boolean(state.preferences?.muted),
      shortcuts: normalizeShortcuts(state.preferences?.shortcuts),
    },
  };
}

export function renameProject(projects, projectId, title) {
  const nextTitle = String(title || "").trim().slice(0, 500);
  if (!nextTitle) return projects;
  return (projects || []).map((project) => project.id === projectId ? { ...project, title: nextTitle } : project);
}

export function setProjectArchived(projects, projectId, archived) {
  return (projects || []).map((project) => project.id === projectId
    ? { ...project, archived: Boolean(archived) }
    : project);
}

export function moveProject(projects, projectId, direction) {
  const source = (projects || []).findIndex((project) => project.id === projectId);
  if (source < 0 || ![-1, 1].includes(direction)) return projects;
  const archived = Boolean(projects[source].archived);
  const cohort = projects
    .map((project, index) => ({ project, index }))
    .filter((entry) => Boolean(entry.project.archived) === archived);
  const cohortIndex = cohort.findIndex((entry) => entry.index === source);
  const target = cohort[cohortIndex + direction]?.index;
  if (target == null) return projects;
  const next = [...projects];
  [next[source], next[target]] = [next[target], next[source]];
  return next;
}

export function removeProject(projects, documents, projectId, activeProjectId) {
  const nextProjects = (projects || []).filter((project) => project.id !== projectId);
  const nextDocuments = { ...(documents || {}) };
  delete nextDocuments[projectId];
  const activeStillAvailable = nextProjects.some((project) => (
    project.id === activeProjectId && !project.archived
  ));
  return {
    projects: nextProjects,
    documents: nextDocuments,
    activeProjectId: activeStillAvailable
      ? activeProjectId
      : nextProjects.find((project) => !project.archived)?.id ?? null,
  };
}
