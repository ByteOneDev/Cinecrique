// Présentation des mises à jour automatiques. La vérification, le
// téléchargement, la vérification de signature et l’installation sont faits
// par la coque macOS (UpdateService) ; l’interface n’affiche que leur état.

export function compareVersions(left, right) {
  const parse = (value) => String(value || "0")
    .trim()
    .replace(/^v/i, "")
    .split("-")[0]
    .split(".")
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) && part >= 0 ? part : 0));
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < Math.max(a.length, b.length, 3); index += 1) {
    const difference = (a[index] || 0) - (b[index] || 0);
    if (difference) return difference > 0 ? 1 : -1;
  }
  return 0;
}

export const UPDATE_STAGES = Object.freeze({
  idle: "À jour",
  checking: "Recherche de mises à jour…",
  available: "Mise à jour disponible",
  downloading: "Téléchargement de la mise à jour…",
  verifying: "Vérification de la signature…",
  installing: "Installation…",
  ready: "Prête à redémarrer",
  failed: "Échec de la mise à jour",
  "up-to-date": "Cinécrique est à jour",
});

export function updateStageLabel(stage) {
  return UPDATE_STAGES[stage] || UPDATE_STAGES.idle;
}

export function normalizeUpdateState(detail = {}) {
  const stage = Object.hasOwn(UPDATE_STAGES, detail?.stage) ? detail.stage : "idle";
  const progress = Number(detail?.progress);
  return {
    stage,
    currentVersion: String(detail?.currentVersion || ""),
    version: String(detail?.version || ""),
    notes: String(detail?.notes || "").slice(0, 20_000),
    progress: Number.isFinite(progress) ? Math.min(Math.max(progress, 0), 1) : 0,
    message: String(detail?.message || "").slice(0, 1_000),
    canInstall: Boolean(detail?.canInstall),
    releaseURL: String(detail?.releaseURL || ""),
  };
}

export function updateNotesLines(notes, maximum = 8) {
  return String(notes || "")
    .split("\n")
    .map((line) => line.replace(/^\s*[-*•]\s*/, "").replace(/^#+\s*/, "").trim())
    .filter(Boolean)
    .slice(0, maximum);
}
