import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_BASKET_ITEMS,
  MAX_GIF_SECONDS,
  addClipToBasket,
  basketDuration,
  citationFromSubtitles,
  clampClipRange,
  clipExportPayload,
  clipFileName,
  clipRangeIssue,
  effectiveClipMode,
  formatBytes,
  normalizeClip,
  normalizeClipSettings,
  normalizeWatermark,
  projectAttribution,
  removeClipFromBasket,
  safeClipFileName,
  updateClipInBasket,
  watermarkLines,
} from "../../source/web/clips.js";

test("normalizes clip settings and rejects unknown values", () => {
  const settings = normalizeClipSettings({
    format: "avi",
    stillFormat: "tiff",
    maxHeight: 999,
    quality: "extreme",
    mode: "magic",
    gifFrameRate: 60,
  });
  assert.equal(settings.format, "mp4");
  assert.equal(settings.stillFormat, "png");
  assert.equal(settings.maxHeight, 1080);
  assert.equal(settings.quality, "standard");
  assert.equal(settings.mode, "accurate");
  assert.equal(settings.gifFrameRate, 12);
});

test("keeps the watermark enabled by default and clamps its opacity", () => {
  assert.equal(normalizeWatermark(undefined).enabled, true);
  assert.equal(normalizeWatermark({ opacity: 12 }).opacity, 1);
  assert.equal(normalizeWatermark({ opacity: 0 }).opacity, 0.2);
  assert.equal(normalizeWatermark({ enabled: false }).enabled, false);
  assert.equal(normalizeWatermark({ position: "middle" }).position, "bottom-left");
});

test("forces the accurate pipeline whenever the picture is altered", () => {
  const base = { mode: "copy", maxHeight: 0, watermark: { enabled: false } };
  assert.equal(effectiveClipMode(base), "copy");
  assert.equal(effectiveClipMode({ ...base, watermark: { enabled: true } }), "accurate");
  assert.equal(effectiveClipMode({ ...base, maxHeight: 720 }), "accurate");
  assert.equal(effectiveClipMode({ ...base, format: "gif" }), "accurate");
});

test("reports unusable clip ranges", () => {
  assert.equal(clipRangeIssue(10, 20, { duration: 300 }), "");
  assert.match(clipRangeIssue(20, 10, { duration: 300 }), /point B/);
  assert.match(clipRangeIssue(Number.NaN, 10), /point A/);
  assert.match(clipRangeIssue(400, 410, { duration: 300 }), /dépasse la durée/);
  assert.match(clipRangeIssue(0, 700, { duration: 3_000 }), /10 minutes/);
  assert.match(clipRangeIssue(0, MAX_GIF_SECONDS + 1, { format: "gif" }), /GIF/);
});

test("clamps a range to the media duration and reorders reversed points", () => {
  assert.deepEqual(clampClipRange(90, 20, 300), { start: 20, end: 90 });
  assert.deepEqual(clampClipRange(-5, 900, 300), { start: 0, end: 300 });
});

test("builds a short citation from the overlapping subtitle cues only", () => {
  const cues = [
    { start: 0, end: 4, text: "Avant" },
    { start: 10, end: 12, text: "Ce n’est pas\nle mépris." },
    { start: 12.5, end: 14, text: "C’est l’indifférence." },
    { start: 40, end: 42, text: "Après" },
  ];
  assert.equal(citationFromSubtitles(cues, 10, 14), "Ce n’est pas le mépris. C’est l’indifférence.");
  assert.equal(citationFromSubtitles(cues, 20, 30), "");
  assert.equal(citationFromSubtitles(cues, 10, 14, 12).endsWith("…"), true);
});

test("composes watermark lines and honours the disabled switch", () => {
  const lines = watermarkLines({ enabled: true, showTimecode: true }, {
    citation: "Ce n’est pas le mépris.",
    attribution: "« Le Mépris » · 1963",
    timecode: "01:12:34:18",
  });
  assert.deepEqual(lines, ["« Ce n’est pas le mépris. »", "« Le Mépris » · 1963", "01:12:34:18"]);
  assert.deepEqual(watermarkLines({ enabled: false }, { citation: "Texte" }), []);
  assert.deepEqual(
    watermarkLines({ enabled: true, showTimecode: false }, { citation: "Texte", timecode: "01:00:00:00" }),
    ["« Texte »"],
  );
});

test("prefers a custom citation over the detected subtitle", () => {
  const lines = watermarkLines(
    { enabled: true, source: "custom", citation: "Ma citation", showTimecode: false },
    { citation: "Sous-titre détecté" },
  );
  assert.deepEqual(lines, ["« Ma citation »"]);
});

test("derives an attribution from the project and its TMDB metadata", () => {
  assert.equal(projectAttribution({ title: "Le Mépris", tmdb: { year: "1963" } }), "« Le Mépris » · 1963");
  assert.equal(projectAttribution({ title: "Sans ligne" }), "« Sans ligne »");
  assert.equal(projectAttribution(null), "");
});

test("produces safe export file names", () => {
  assert.equal(safeClipFileName("../../etc/passwd"), "etc-passwd");
  assert.equal(safeClipFileName("..."), "extrait");
  assert.equal(safeClipFileName("Cléo / 5 à 7"), "Cleo-5-a-7");
  assert.equal(
    clipFileName({ title: "Le Mépris", label: "01-12-34-18", extension: "mp4" }),
    "Le-Mepris-01-12-34-18.mp4",
  );
});

test("adds, updates and removes basket entries without duplicates", () => {
  const first = addClipToBasket([], { kind: "clip", start: 10, end: 20 });
  assert.equal(first.basket.length, 1);
  assert.equal(first.error, "");
  const duplicate = addClipToBasket(first.basket, { kind: "clip", start: 10, end: 20 });
  assert.equal(duplicate.basket.length, 1);
  assert.match(duplicate.error, /déjà dans le panier/);
  const renamed = updateClipInBasket(first.basket, first.basket[0].id, { label: "Ouverture" });
  assert.equal(renamed[0].label, "Ouverture");
  assert.equal(removeClipFromBasket(renamed, renamed[0].id).length, 0);
});

test("caps the basket size", () => {
  let basket = [];
  for (let index = 0; index < MAX_BASKET_ITEMS; index += 1) {
    basket = addClipToBasket(basket, { kind: "clip", start: index, end: index + 0.5 }).basket;
  }
  const overflow = addClipToBasket(basket, { kind: "clip", start: 999, end: 1_000 });
  assert.equal(overflow.basket.length, MAX_BASKET_ITEMS);
  assert.match(overflow.error, /limité/);
});

test("sums only the moving clips in the basket duration", () => {
  const basket = [
    { kind: "clip", start: 0, end: 12 },
    { kind: "still", start: 40, end: 40 },
    { kind: "clip", start: 100, end: 108 },
  ];
  assert.equal(basketDuration(basket), 20);
});

test("collapses a still to a single instant", () => {
  const still = normalizeClip({ kind: "still", start: 30, end: 90 });
  assert.equal(still.start, 30);
  assert.equal(still.end, 30);
});

test("shapes a native payload without any file system path", () => {
  const payload = clipExportPayload(
    {
      kind: "clip",
      start: 10,
      end: 18,
      label: "ouverture",
      citation: "Ce n’est pas le mépris.",
      settings: { format: "mp4", maxHeight: 720, quality: "high", includeAudio: true },
    },
    {
      title: "Le Mépris",
      attribution: "« Le Mépris » · 1963",
      formatTimecode: () => "01:12:34:18",
      index: 0,
    },
  );
  assert.equal(payload.kind, "clip");
  assert.equal(payload.mode, "accurate");
  assert.equal(payload.maxHeight, 720);
  assert.equal(payload.includeAudio, true);
  assert.equal(payload.name, "Le-Mepris-ouverture.mp4");
  assert.equal(payload.watermark.enabled, true);
  assert.equal(payload.watermark.lines.length, 3);
  assert.equal(Object.hasOwn(payload, "path"), false);
});

test("mutes a GIF payload and keeps its frame rate", () => {
  const payload = clipExportPayload(
    { kind: "clip", start: 0, end: 4, settings: { format: "gif", gifFrameRate: 15, includeAudio: true } },
    { title: "Film", formatTimecode: () => "00:00:00:00" },
  );
  assert.equal(payload.includeAudio, false);
  assert.equal(payload.frameRate, 15);
  assert.equal(payload.name.endsWith(".gif"), true);
});

test("formats an estimated size for humans", () => {
  assert.equal(formatBytes(400), "1 Ko");
  assert.equal(formatBytes(2_400_000), "2.4 Mo");
  assert.equal(formatBytes(3_200_000_000), "3.2 Go");
});
