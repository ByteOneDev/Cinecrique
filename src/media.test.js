import assert from "node:assert/strict";
import test from "node:test";

import {
  filterSubtitles,
  isMuteShortcut,
  parseSubtitles,
  subtitleAt,
  subtitleIndexAt,
  subtitleNoteDraft,
  isSupportedVideoFile,
  mediaPlaybackIssue,
  mediaRenderPath,
  withoutMediaRuntime,
} from "./media.js";

test("recognizes common and professional video containers", () => {
  assert.equal(isSupportedVideoFile({ name: "film.MKV", type: "" }), true);
  assert.equal(isSupportedVideoFile({ name: "rushes.mxf", type: "application/octet-stream" }), true);
  assert.equal(isSupportedVideoFile({ name: "archive.vob", type: "" }), true);
  assert.equal(isSupportedVideoFile({ name: "notes.pdf", type: "application/pdf" }), false);
  assert.match(mediaPlaybackIssue({ streams: [{ codec_type: "video", codec_name: "vp9" }] }, "film.mkv"), /conteneur MKV doit être préparé/);
});

test("distinguishes an unsupported container from an unsupported codec", () => {
  assert.match(mediaPlaybackIssue({ streams: [{ codec_type: "video", codec_name: "prores" }] }, "film.mov"), /codec PRORES/);
});

test("keeps proxy paths at runtime but strips them from persisted projects", () => {
  const project = {
    id: "film",
    path: "/Films/source.mkv",
    playbackPath: "/Cache/playback.mp4",
    mediaURL: "analyse-media://local",
    proxyUsed: true,
    proxyMode: "remux",
  };
  assert.equal(mediaRenderPath(project), "/Cache/playback.mp4");
  assert.deepEqual(withoutMediaRuntime(project), { id: "film", path: "/Films/source.mkv" });
});

test("parses SRT cues with millisecond commas", () => {
  const cues = parseSubtitles(
    "1\n00:00:00,500 --> 00:00:02,000\nPremier plan\n\n2\n00:00:02,250 --> 00:00:04,000\nDeuxieme plan\n",
    "sample.srt",
  );

  assert.deepEqual(cues, [
    { start: 0.5, end: 2, text: "Premier plan" },
    { start: 2.25, end: 4, text: "Deuxieme plan" },
  ]);
  assert.equal(subtitleAt(cues, 1), "Premier plan");
  assert.equal(subtitleAt(cues, 2.1), "");
});

test("parses WebVTT timing settings and strips inline tags", () => {
  const cues = parseSubtitles(
    "WEBVTT\n\n00:00:01.000 --> 00:00:03.500 align:middle\n<i>Bonjour</i> le monde\n",
    "sample.vtt",
  );

  assert.deepEqual(cues, [{ start: 1, end: 3.5, text: "Bonjour le monde" }]);
});

test("parses ASS dialogue text and line breaks", () => {
  const cues = parseSubtitles(
    "[Events]\nDialogue: 0,0:00:01.00,0:00:03.25,Default,,0,0,0,,{\\i1}Bonjour{\\i0}\\Nla mer\n",
    "sample.ass",
  );

  assert.deepEqual(cues, [{ start: 1, end: 3.25, text: "Bonjour\nla mer" }]);
});

test("uses M for mute except while editing text or using modifiers", () => {
  assert.equal(isMuteShortcut({ key: "m", target: { tagName: "DIV" } }), true);
  assert.equal(isMuteShortcut({ key: "M", target: { tagName: "TEXTAREA" } }), false);
  assert.equal(isMuteShortcut({ key: "m", metaKey: true, target: { tagName: "DIV" } }), false);
  assert.equal(isMuteShortcut({ key: "x", target: { tagName: "DIV" } }), false);
});

test("finds and filters synchronized dialogue cues", () => {
  const cues = [
    { start: 1, end: 2, text: "Bonjour Camille" },
    { start: 3, end: 4, text: "La mer est calme" },
  ];
  assert.equal(subtitleIndexAt(cues, 1.5), 0);
  assert.equal(subtitleIndexAt(cues, 2.5), -1);
  assert.deepEqual(filterSubtitles(cues, "mer").map(({ index }) => index), [1]);
});

test("prepares a timecoded note from a subtitle cue", () => {
  const draft = subtitleNoteDraft({ start: 2, end: 4, text: "Une phrase\nsur deux lignes" }, (time) => `TC-${time}`);
  assert.equal(draft.title, "Une phrase");
  assert.equal(draft.body, "Une phrase\nsur deux lignes");
  assert.equal(draft.tag, "Dialogue");
  assert.equal(draft.startTimecode, "TC-2");
});
