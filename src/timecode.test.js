import assert from "node:assert/strict";
import test from "node:test";

import {
  changeDropFrame,
  changeTimecodeRate,
  formatTimecode,
  formatTimecodeDuration,
  formatTimecodeOffset,
  normalizeTimecodeSettings,
  parseTimecode,
  parseTimecodeOffset,
  timecodeRate,
} from "./timecode.js";

test("formats and parses non-drop SMPTE at common rates", () => {
  const settings = { source: "manual", rate: "24/1", offsetFrames: 0, dropFrame: false };
  assert.equal(formatTimecode(3723.5, settings), "01:02:03:12");
  assert.equal(parseTimecode("01:02:03:12", settings), 3723.5);
  assert.equal(parseTimecode("00:00:03:24", settings), null);
  assert.equal(timecodeRate(23.98).value, "24000/1001");
});

test("formats drop-frame minute and ten-minute boundaries", () => {
  const settings = { source: "manual", rate: "30000/1001", offsetFrames: 0, dropFrame: true };
  const actual = timecodeRate(settings.rate).actual;
  assert.equal(formatTimecode(1800 / actual, settings), "00:01:00;02");
  assert.equal(formatTimecode(17982 / actual, settings), "00:10:00;00");
  assert.equal(parseTimecode("00:01:00;00", settings), null);
  assert.equal(parseTimecode("00:01:00;01", settings), null);
  assert.equal(parseTimecode("00:01:00;02", settings), 1800 / actual);
});

test("applies an offset without changing media seconds", () => {
  const settings = { source: "manual", rate: "24/1", offsetFrames: 86_400, dropFrame: false };
  assert.equal(formatTimecode(0, settings), "01:00:00:00");
  assert.equal(parseTimecode("01:00:00:00", settings), 0);
  assert.equal(formatTimecodeOffset(settings), "01:00:00:00");
  assert.equal(parseTimecodeOffset("01:00:00:00", settings), 86_400);
  assert.equal(formatTimecodeDuration(5, settings), "00:00:05:00");
});

test("normalizes automatic settings and preserves the offset label across rates", () => {
  const automatic = normalizeTimecodeSettings({ source: "auto" }, 29.97);
  assert.equal(automatic.rate, "30000/1001");
  const changed = changeTimecodeRate({
    source: "manual", rate: "24/1", offsetFrames: 86_400, dropFrame: false,
  }, "manual", "25/1", 24);
  assert.equal(formatTimecodeOffset(changed), "01:00:00:00");
});

test("enables drop-frame only at 29.97 while preserving the offset", () => {
  const source = { source: "manual", rate: "30000/1001", offsetFrames: 107_892, dropFrame: false };
  const changed = changeDropFrame(source, true);
  assert.equal(changed.dropFrame, true);
  assert.equal(formatTimecodeOffset(changed), "00:59:56;12");
  assert.equal(changeDropFrame({ source: "manual", rate: "25/1" }, true).dropFrame, false);
});
