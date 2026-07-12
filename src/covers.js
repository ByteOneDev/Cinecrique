const BUNDLED_COVERS = new Set([
  "./assets/poster-coast.png",
  "./assets/poster-paris.png",
  "./assets/poster-rain.png",
]);

export const COVER_MODES = Object.freeze(["image", "text", "logo"]);
export const MAX_COVER_DATA_URL_LENGTH = 1_500_000;

function safeDataURL(value) {
  const dataURL = String(value || "");
  return dataURL.length <= MAX_COVER_DATA_URL_LENGTH
    && /^data:image\/(?:jpeg|png|webp);base64,[a-zA-Z0-9+/=]+$/.test(dataURL)
    ? dataURL
    : "";
}

export function normalizeProjectCover(value, legacyPoster = "") {
  if (value?.mode === "text") {
    return { mode: "text", text: String(value.text || "").trim().slice(0, 120) };
  }
  if (value?.mode === "logo") return { mode: "logo" };
  if (value?.mode === "image") {
    const bundled = BUNDLED_COVERS.has(value.value) ? value.value : "";
    const dataURL = safeDataURL(value.value);
    if (bundled || dataURL) {
      return {
        mode: "image",
        source: ["local", "frame", "tmdb", "bundled"].includes(value.source) ? value.source : bundled ? "bundled" : "local",
        value: bundled || dataURL,
      };
    }
  }
  if (BUNDLED_COVERS.has(legacyPoster)) {
    return { mode: "image", source: "bundled", value: legacyPoster };
  }
  return { mode: "logo" };
}

export function projectCoverImage(project) {
  const cover = normalizeProjectCover(project?.cover, project?.poster);
  return cover.mode === "image" ? cover.value : "";
}

export function projectCoverText(project) {
  const cover = normalizeProjectCover(project?.cover, project?.poster);
  return cover.mode === "text" ? cover.text || String(project?.title || "Projet") : "";
}

