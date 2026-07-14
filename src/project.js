import { migrateMarkers } from "./markers.js";
import { normalizeShortcuts, normalizeTransport } from "./transport.js";
import { normalizeTimecodeSettings } from "./timecode.js";
import { normalizeComparison } from "./comparison.js";
import { migrateAnnotationTimes } from "./annotations.js";
import { normalizeProjectCover } from "./covers.js";

export const PROJECT_DATA_LIMITS = Object.freeze({
  projects: 500,
  documents: 500,
  markersPerDocument: 25_000,
  annotationGroupsPerDocument: 25_000,
  annotationsPerMarker: 1_000,
  annotationsPerDocument: 100_000,
  pencilPoints: 1_000,
  subtitleCuesPerDocument: 100_000,
  documentTextBytes: 8 * 1_024 * 1_024,
  stringBytes: 8 * 1_024 * 1_024,
  totalValues: 1_000_000,
  depth: 32,
});

const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const textEncoder = new TextEncoder();

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nullRecord() {
  return Object.create(null);
}

function stringBytes(value) {
  return textEncoder.encode(String(value)).byteLength;
}

function validateSafeTree(value, context = { budget: PROJECT_DATA_LIMITS.totalValues, seen: new WeakSet() }, depth = 0, key = "") {
  if (depth > PROJECT_DATA_LIMITS.depth) throw new TypeError("La structure du projet est trop profonde.");
  context.budget -= 1;
  if (context.budget < 0) throw new TypeError("Le projet contient trop de données.");
  if (typeof value === "string") {
    const limit = ["script", "analysis"].includes(key)
      ? PROJECT_DATA_LIMITS.documentTextBytes
      : PROJECT_DATA_LIMITS.stringBytes;
    if (stringBytes(value) > limit) throw new TypeError("Une donnée textuelle dépasse la limite autorisée.");
    return;
  }
  if (!value || typeof value !== "object") return;
  if (context.seen.has(value)) throw new TypeError("Le projet contient une référence cyclique.");
  context.seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) validateSafeTree(item, context, depth + 1, key);
  } else {
    for (const childKey of Object.keys(value)) {
      if (FORBIDDEN_KEYS.has(childKey) || stringBytes(childKey) > 4_096) {
        throw new TypeError("Le projet contient une clé de données non sûre.");
      }
      validateSafeTree(value[childKey], context, depth + 1, childKey);
    }
  }
  context.seen.delete(value);
}

function cloneSafeValue(value, depth = 0) {
  if (depth > PROJECT_DATA_LIMITS.depth) return null;
  if (Array.isArray(value)) return value.map((item) => cloneSafeValue(item, depth + 1));
  if (!isRecord(value)) return value;
  const result = nullRecord();
  for (const key of Object.keys(value)) {
    if (!FORBIDDEN_KEYS.has(key)) result[key] = cloneSafeValue(value[key], depth + 1);
  }
  return result;
}

function safeIdentifier(value, fallback, maximum = 1_024) {
  const candidate = String(value ?? "").trim().slice(0, maximum);
  return candidate && !FORBIDDEN_KEYS.has(candidate) ? candidate : fallback;
}

function safeMarkerIdentifier(value, fallback) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : safeIdentifier(value, fallback);
}

function uniqueIdentifier(candidate, used, suffix) {
  let value = candidate;
  let counter = 2;
  while (used.has(value)) {
    value = `${candidate}-${suffix}-${counter}`.slice(0, 1_024);
    counter += 1;
  }
  used.add(value);
  return value;
}

function finiteNonNegative(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function sanitizeAnnotation(annotation, markerTime, index) {
  const source = isRecord(annotation) ? cloneSafeValue(annotation) : nullRecord();
  const type = ["arrow", "rect", "point", "pencil"].includes(source.type) ? source.type : "point";
  const result = {
    ...source,
    id: safeIdentifier(source.id, `annotation-${index + 1}`, 256),
    type,
    time: finiteNonNegative(source.time, markerTime),
  };
  if (type === "pencil") {
    result.points = (Array.isArray(source.points) ? source.points : [])
      .slice(0, PROJECT_DATA_LIMITS.pencilPoints)
      .filter((point) => Number.isFinite(Number(point?.x)) && Number.isFinite(Number(point?.y)))
      .map((point) => ({ x: Number(point.x), y: Number(point.y) }));
  } else {
    delete result.points;
  }
  return result;
}

function lowerBoundByTime(markers, time) {
  let low = 0;
  let high = markers.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (markers[middle].marker.time < time) low = middle + 1;
    else high = middle;
  }
  return low;
}

function nearbyTarget(candidates, time, tolerance) {
  const insertion = lowerBoundByTime(candidates, time);
  const options = [candidates[insertion - 1], candidates[insertion]].filter(Boolean);
  return options
    .filter((entry) => Math.abs(entry.marker.time - time) <= tolerance)
    .sort((a, b) => Math.abs(a.marker.time - time) - Math.abs(b.marker.time - time) || a.index - b.index)[0]
    ?.marker ?? null;
}

export function migrateDocument(document, frameRate = 24) {
  if (!document) return document;
  if (!isRecord(document)) throw new TypeError("Un document importé est invalide.");
  validateSafeTree(document);
  const sourceMarkers = Array.isArray(document.markers) ? document.markers : [];
  if (sourceMarkers.length > PROJECT_DATA_LIMITS.markersPerDocument) {
    throw new TypeError("Un document contient trop de repères.");
  }
  const sourceGroups = isRecord(document.annotationsByMarker) ? document.annotationsByMarker : nullRecord();
  if (Object.keys(sourceGroups).length > PROJECT_DATA_LIMITS.annotationGroupsPerDocument) {
    throw new TypeError("Un document contient trop de groupes d’annotations.");
  }

  const usedMarkerIds = new Set();
  const originalToMigratedId = new Map();
  const preparedMarkers = sourceMarkers
    .filter(isRecord)
    .map((rawMarker, index) => {
      const source = cloneSafeValue(rawMarker);
      const originalKey = String(rawMarker.id ?? `marker-${index + 1}`);
      const id = uniqueIdentifier(safeMarkerIdentifier(rawMarker.id, `marker-${index + 1}`), usedMarkerIds, "importe");
      if (!originalToMigratedId.has(originalKey)) originalToMigratedId.set(originalKey, id);
      return {
        ...source,
        id,
        title: String(source.title || "Repère sans titre").slice(0, 500),
        detail: String(source.detail || "").slice(0, 65_536),
        tag: String(source.tag || "").slice(0, 500),
        ...(source.url == null ? {} : { url: String(source.url).slice(0, 4_096) }),
      };
    });
  const markers = migrateMarkers(preparedMarkers);
  const markerById = new Map(markers.map((marker) => [marker.id, marker]));
  const annotationsByMarker = nullRecord();
  let annotationCount = 0;
  for (let index = 0; index < sourceMarkers.length; index += 1) {
    const rawMarker = sourceMarkers[index];
    if (!isRecord(rawMarker)) continue;
    const originalKey = String(rawMarker.id ?? `marker-${index + 1}`);
    const markerId = originalToMigratedId.get(originalKey);
    const marker = markerById.get(markerId);
    const rawAnnotations = Object.hasOwn(sourceGroups, originalKey) ? sourceGroups[originalKey] : [];
    if (!Array.isArray(rawAnnotations)) continue;
    if (rawAnnotations.length > PROJECT_DATA_LIMITS.annotationsPerMarker) {
      throw new TypeError("Un repère contient trop d’annotations.");
    }
    annotationCount += rawAnnotations.length;
    if (annotationCount > PROJECT_DATA_LIMITS.annotationsPerDocument) {
      throw new TypeError("Un document contient trop d’annotations.");
    }
    if (rawAnnotations.length) {
      annotationsByMarker[markerId] = rawAnnotations.map((annotation, annotationIndex) => (
        sanitizeAnnotation(annotation, marker?.time || 0, annotationIndex)
      ));
    }
  }

  const removedIds = new Set();
  let selectedMarkerId = originalToMigratedId.get(String(document.selectedMarkerId))
    ?? (markers.some((marker) => marker.id === document.selectedMarkerId) ? document.selectedMarkerId : null);
  const tolerance = 0.5 / Math.max(Number(frameRate) || 24, 1);
  const candidates = markers
    .map((marker, index) => ({ marker, index }))
    .filter(({ marker }) => marker.title !== "Annotation d’image")
    .sort((a, b) => a.marker.time - b.marker.time || a.index - b.index);

  for (const marker of markers) {
    if (Object.hasOwn(annotationsByMarker, marker.id)) {
      annotationsByMarker[marker.id] = migrateAnnotationTimes(annotationsByMarker[marker.id], marker.time);
    }
    if (marker.title !== "Annotation d’image") continue;
    const annotations = annotationsByMarker[marker.id] || [];
    if (!annotations.length) continue;

    const target = nearbyTarget(candidates, marker.time, tolerance);
    if (!target) continue;

    const targetAnnotations = annotationsByMarker[target.id] || [];
    if (targetAnnotations.length + annotations.length > PROJECT_DATA_LIMITS.annotationsPerMarker) continue;
    targetAnnotations.push(...annotations);
    annotationsByMarker[target.id] = targetAnnotations;
    delete annotationsByMarker[marker.id];
    removedIds.add(marker.id);
    if (selectedMarkerId === marker.id) selectedMarkerId = target.id;
  }

  const subtitleCues = Array.isArray(document.subtitleCues) ? document.subtitleCues : [];
  if (subtitleCues.length > PROJECT_DATA_LIMITS.subtitleCuesPerDocument) {
    throw new TypeError("Un document contient trop de sous-titres.");
  }

  const safeDocument = cloneSafeValue(document);

  return {
    ...safeDocument,
    markers: markers.filter((marker) => !removedIds.has(marker.id)),
    annotationsByMarker,
    selectedMarkerId,
    ...(typeof document.script === "string" ? { script: document.script } : {}),
    ...(typeof document.analysis === "string" ? { analysis: document.analysis } : {}),
    subtitleCues: subtitleCues
      .filter(isRecord)
      .map((cue) => ({
        start: finiteNonNegative(cue.start),
        end: Math.max(finiteNonNegative(cue.end), finiteNonNegative(cue.start)),
        text: String(cue.text || "").slice(0, 65_536),
      })),
    subtitleName: String(document.subtitleName || "").slice(0, 1_024),
    transport: normalizeTransport(document.transport),
    comparison: normalizeComparison(document.comparison),
  };
}

export function migratePersistedState(state, frameRateForProject = () => 24) {
  if (!isRecord(state)) {
    throw new TypeError("Le fichier de projet n’est pas un objet valide.");
  }
  validateSafeTree(state);
  if (
    !Array.isArray(state.projects)
    || state.projects.length > PROJECT_DATA_LIMITS.projects
    || (state.projects.length === 0 && (Number(state.version) || 0) < 5)
  ) {
    throw new TypeError("Le fichier de projet ne contient aucun projet valide.");
  }

  const sourceDocuments = isRecord(state.documents) ? state.documents : nullRecord();
  if (Object.keys(sourceDocuments).length > PROJECT_DATA_LIMITS.documents) {
    throw new TypeError("Le fichier de projet contient trop de documents.");
  }

  const seenIds = new Set();
  const originalProjectIds = new Map();
  const migratedToOriginalProjectIds = new Map();
  const projects = state.projects.map((project, index) => {
    if (!isRecord(project)) {
      throw new TypeError("Un projet importé est invalide.");
    }
    const fallbackId = `importe-${index + 1}`;
    const originalId = String(project.id || fallbackId);
    const id = uniqueIdentifier(safeIdentifier(project.id, fallbackId), seenIds, "importe");
    if (!originalProjectIds.has(originalId)) originalProjectIds.set(originalId, id);
    migratedToOriginalProjectIds.set(id, originalId);
    const safeProject = cloneSafeValue(project);
    return {
      ...safeProject,
      id,
      title: String(project.title || "Projet sans titre").slice(0, 500),
      detail: String(project.detail || "Analyse locale").slice(0, 500),
      poster: String(project.poster || "./assets/poster-coast.png"),
      cover: normalizeProjectCover(project.cover, project.poster),
      archived: Boolean(project.archived),
      timecode: normalizeTimecodeSettings(project.timecode, frameRateForProject(project)),
    };
  });

  const documents = nullRecord();
  for (const project of projects) {
    const sourceId = migratedToOriginalProjectIds.get(project.id) ?? project.id;
    const sourceDocument = Object.hasOwn(sourceDocuments, sourceId) ? sourceDocuments[sourceId] : {};
    documents[project.id] = migrateDocument(sourceDocument, frameRateForProject(project));
  }
  const migratedActiveId = originalProjectIds.get(String(state.activeProjectId)) ?? state.activeProjectId;
  const activeProjectId = projects.some((project) => project.id === migratedActiveId && !project.archived)
    ? migratedActiveId
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

export function mergePersistedStates(currentState, importedState, frameRateForProject = () => 24) {
  const current = migratePersistedState(currentState, frameRateForProject);
  const imported = migratePersistedState(importedState, frameRateForProject);
  const usedIds = new Set(current.projects.map((project) => project.id));
  const projects = [...current.projects];
  const documents = nullRecord();
  for (const project of current.projects) documents[project.id] = current.documents[project.id];

  for (const project of imported.projects) {
    const id = uniqueIdentifier(project.id, usedIds, "importe");
    projects.push({ ...project, id });
    documents[id] = imported.documents[project.id];
  }

  return {
    version: 6,
    projects,
    activeProjectId: current.activeProjectId,
    documents,
    preferences: { ...current.preferences },
  };
}

export function resolveImportedProjectState(mode, currentState, importedState, frameRateForProject = () => 24) {
  if (mode === "cancel") {
    return {
      mode,
      state: migratePersistedState(currentState, frameRateForProject),
      changed: false,
    };
  }
  if (mode === "merge") {
    return {
      mode,
      state: mergePersistedStates(currentState, importedState, frameRateForProject),
      changed: true,
    };
  }
  if (mode === "replace") {
    return {
      mode,
      state: migratePersistedState(importedState, frameRateForProject),
      changed: true,
    };
  }
  throw new TypeError("Mode d’import invalide.");
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
