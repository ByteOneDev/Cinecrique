import assert from "node:assert/strict";
import test from "node:test";

import { parseSubtitles, subtitleAt } from "./media.js";

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
