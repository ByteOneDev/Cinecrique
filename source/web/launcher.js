// Logique de la page d’accueil (gestionnaire de projets) affichée avant
// l’espace de travail, à la manière des logiciels de montage.

export const LAUNCHER_SORTS = Object.freeze([
  { value: "recent", label: "Récents" },
  { value: "title", label: "Titre" },
  { value: "created", label: "Ordre de la bibliothèque" },
]);

function text(value) {
  return String(value || "").toLocaleLowerCase("fr");
}

export function launcherProjects(projects, { query = "", sort = "recent", archived = false } = {}) {
  const needle = text(query).trim();
  const entries = (Array.isArray(projects) ? projects : [])
    .map((project, index) => ({ project, index }))
    .filter(({ project }) => Boolean(project?.archived) === Boolean(archived))
    .filter(({ project }) => {
      if (!needle) return true;
      return [project.title, project.detail, project.tmdb?.title, project.tmdb?.originalTitle, project.source?.extractor]
        .some((value) => text(value).includes(needle));
    });
  if (sort === "title") {
    entries.sort((a, b) => String(a.project.title || "").localeCompare(String(b.project.title || ""), "fr", { sensitivity: "base" }) || a.index - b.index);
  } else if (sort === "recent") {
    entries.sort((a, b) => (Number(b.project.lastOpenedAt) || 0) - (Number(a.project.lastOpenedAt) || 0) || a.index - b.index);
  }
  return entries;
}

export function openedLabel(timestamp, now = Date.now()) {
  const value = Number(timestamp);
  if (!Number.isFinite(value) || value <= 0) return "Jamais ouvert";
  const startOfDay = (time) => {
    const date = new Date(time);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  };
  const days = Math.round((startOfDay(now) - startOfDay(value)) / 86_400_000);
  if (days <= 0) {
    const time = new Date(value).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    return `Aujourd’hui, ${time}`;
  }
  if (days === 1) return "Hier";
  if (days < 7) return `Il y a ${days} jours`;
  return new Date(value).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
}

export function projectStats(document) {
  const markers = Array.isArray(document?.markers) ? document.markers : [];
  const groups = document?.annotationsByMarker && typeof document.annotationsByMarker === "object" ? document.annotationsByMarker : {};
  const annotated = Object.values(groups).filter((value) => Array.isArray(value) && value.length > 0).length;
  const plans = markers.filter((marker) => Number(marker?.endTime) > Number(marker?.time)).length;
  return {
    markers: markers.length,
    plans,
    annotated,
    hasScript: typeof document?.script === "string" && document.script.trim().length > 5,
  };
}

export function statsLabel(stats) {
  if (!stats) return "";
  const parts = [];
  if (stats.markers) parts.push(`${stats.markers} repère${stats.markers > 1 ? "s" : ""}`);
  if (stats.plans) parts.push(`${stats.plans} plan${stats.plans > 1 ? "s" : ""}`);
  if (stats.annotated) parts.push(`${stats.annotated} image${stats.annotated > 1 ? "s" : ""} annotée${stats.annotated > 1 ? "s" : ""}`);
  return parts.join(" · ") || "Aucune analyse";
}

export function touchProject(projects, projectId, now = Date.now()) {
  return (projects || []).map((project) => (project.id === projectId ? { ...project, lastOpenedAt: now } : project));
}
