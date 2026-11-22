// Import de vidéos en ligne (YouTube, Internet Archive, Vimeo, plateformes
// de streaming moins connues…). Le téléchargement est délégué au moteur
// natif (yt-dlp) ; ce module ne contient que la validation et la mise en forme
// côté interface, testables sans le pont macOS.

export const ONLINE_URL_MAX_LENGTH = 2_048;

export const ONLINE_QUALITIES = Object.freeze([
  { value: "best", label: "Meilleure disponible" },
  { value: "2160", label: "2160p (4K)" },
  { value: "1080", label: "1080p" },
  { value: "720", label: "720p" },
  { value: "480", label: "480p" },
]);

export const ONLINE_COOKIE_BROWSERS = Object.freeze([
  { value: "", label: "Aucun" },
  { value: "safari", label: "Safari" },
  { value: "chrome", label: "Chrome" },
  { value: "firefox", label: "Firefox" },
  { value: "brave", label: "Brave" },
  { value: "edge", label: "Edge" },
  { value: "chromium", label: "Chromium" },
  { value: "vivaldi", label: "Vivaldi" },
  { value: "opera", label: "Opera" },
]);

// Services dont les flux sont chiffrés par DRM (Widevine/FairPlay). Le moteur
// refuse ces flux : on prévient avant de lancer un téléchargement voué à échouer.
const DRM_HOSTS = [
  "netflix.com",
  "disneyplus.com",
  "primevideo.com",
  "max.com",
  "hbomax.com",
  "tv.apple.com",
  "canalplus.com",
  "mycanal.fr",
  "paramountplus.com",
  "hulu.com",
  "peacocktv.com",
  "crunchyroll.com",
  "adn.fr",
  "animationdigitalnetwork.com",
  "molotov.tv",
  "salto.fr",
];

const SOURCE_LABELS = [
  [["youtube.com", "youtu.be", "youtube-nocookie.com"], "YouTube"],
  [["archive.org"], "Internet Archive"],
  [["vimeo.com"], "Vimeo"],
  [["dailymotion.com", "dai.ly"], "Dailymotion"],
  [["arte.tv"], "Arte"],
  [["france.tv"], "france.tv"],
  [["twitch.tv"], "Twitch"],
  [["bilibili.com", "bilibili.tv"], "Bilibili"],
  [["nicovideo.jp"], "Niconico"],
  [["peertube"], "PeerTube"],
  [["odysee.com"], "Odysee"],
  [["rumble.com"], "Rumble"],
  [["tiktok.com"], "TikTok"],
  [["instagram.com"], "Instagram"],
  [["x.com", "twitter.com"], "X"],
  [["facebook.com", "fb.watch"], "Facebook"],
];

function hostMatches(host, domain) {
  return host === domain || host.endsWith(`.${domain}`) || (domain === "peertube" && host.includes("peertube"));
}

/**
 * Accepte une adresse collée telle quelle (avec ou sans https://) et la
 * normalise. Renvoie une chaîne vide pour tout ce qui n’est pas une page web
 * publique en HTTP(S).
 */
export function normalizeOnlineURL(input) {
  let candidate = String(input ?? "").trim();
  if (!candidate || candidate.length > ONLINE_URL_MAX_LENGTH || /[\s\u0000-\u001f\u007f]/.test(candidate)) return "";
  if (!/^[a-z][a-z0-9+.-]*:/i.test(candidate)) {
    if (!/^[\p{L}\p{N}-]+(\.[\p{L}\p{N}-]+)+([/:?#]|$)/u.test(candidate)) return "";
    candidate = `https://${candidate}`;
  }
  let url;
  try {
    url = new URL(candidate);
  } catch {
    return "";
  }
  if (!["http:", "https:"].includes(url.protocol)) return "";
  if (url.username || url.password) return "";
  const host = url.hostname.toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return "";
  if (/^\[?[0-9a-f:.]+\]?$/i.test(host) && isPrivateAddress(host)) return "";
  const normalized = url.toString();
  return normalized.length <= ONLINE_URL_MAX_LENGTH ? normalized : "";
}

function isPrivateAddress(host) {
  const bare = host.replace(/^\[|\]$/g, "");
  if (bare.includes(":")) return bare === "::1" || /^f[cd]/i.test(bare) || /^fe80/i.test(bare);
  const parts = bare.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

export function onlineSourceLabel(value) {
  try {
    const host = new URL(value).hostname.toLowerCase().replace(/^www\./, "");
    for (const [domains, label] of SOURCE_LABELS) {
      if (domains.some((domain) => hostMatches(host, domain))) return label;
    }
    return host;
  } catch {
    return "";
  }
}

export function onlineDRMWarning(value) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return DRM_HOSTS.some((domain) => hostMatches(host, domain))
      ? "Ce service chiffre ses vidéos (DRM). Le moteur de téléchargement ne peut pas les lire : le téléchargement échouera."
      : "";
  } catch {
    return "";
  }
}

export function normalizeOnlineOptions(options = {}) {
  const quality = ONLINE_QUALITIES.some((item) => item.value === options?.quality) ? options.quality : "1080";
  const cookiesBrowser = ONLINE_COOKIE_BROWSERS.some((item) => item.value === options?.cookiesBrowser)
    ? options.cookiesBrowser
    : "";
  return {
    quality,
    cookiesBrowser,
    subtitles: options?.subtitles !== false,
  };
}

function formatDuration(seconds) {
  const value = Math.round(Number(seconds) || 0);
  if (value <= 0) return "";
  const hours = Math.floor(value / 3_600);
  const minutes = Math.floor((value % 3_600) / 60);
  if (hours) return `${hours}h${String(minutes).padStart(2, "0")}`;
  if (minutes) return `${minutes} min`;
  return `${value} s`;
}

/** Titre, sous-titre et provenance d’un projet créé depuis une vidéo en ligne. */
export function onlineProjectFields(online = {}, fallbackName = "Vidéo en ligne") {
  const title = String(online?.title || fallbackName || "Vidéo en ligne").trim().slice(0, 500) || "Vidéo en ligne";
  const source = String(online?.extractor || onlineSourceLabel(online?.webpageURL || online?.url || "") || "En ligne").slice(0, 120);
  const year = /^\d{8}$/.test(String(online?.uploadDate || "")) ? String(online.uploadDate).slice(0, 4) : "";
  const detail = [source, year, formatDuration(online?.duration)].filter(Boolean).join(" · ").slice(0, 500);
  return {
    title,
    detail: detail || "Vidéo en ligne",
    source: {
      kind: "online",
      url: normalizeOnlineURL(online?.webpageURL || online?.url) || "",
      extractor: source,
      uploader: String(online?.uploader || "").slice(0, 300),
      uploadDate: year ? String(online.uploadDate) : "",
      downloadedAt: new Date().toISOString(),
    },
  };
}

export function onlineToolStatusLabel(status) {
  if (!status) return "Vérification du moteur…";
  if (!status.available) return "Moteur yt-dlp non installé";
  const origin = status.managed ? "géré par Cinécrique" : status.origin === "homebrew" ? "Homebrew" : "système";
  return `yt-dlp ${status.version || ""} · ${origin}`.replace(/\s+·/, " ·");
}
