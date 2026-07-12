import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_SHORTCUTS,
  assignShortcut,
  loopBoundaryTarget,
  normalizeTransport,
  resetLoop,
  setLoopEnd,
  setLoopStart,
  stepPlaybackRate,
  toggleLoop,
  transportShortcut,
} from "./transport.js";

test("normalizes, sets and resets a valid A/B loop", () => {
  let transport = normalizeTransport({ playbackRate: 1.4 });
  assert.equal(transport.playbackRate, 1.5);
  transport = setLoopStart(transport, 12, 100);
  ({ transport } = setLoopEnd(transport, 18, 100));
  ({ transport } = toggleLoop(transport));
  assert.deepEqual(transport, {
    loopStart: 12,
    loopEnd: 18,
    loopEnabled: true,
    playbackRate: 1.5,
  });
  assert.equal(loopBoundaryTarget(18, 1, transport), 12);
  assert.equal(loopBoundaryTarget(12, -1, transport), 18);
  assert.deepEqual(resetLoop(transport), {
    loopStart: null,
    loopEnd: null,
    loopEnabled: false,
    playbackRate: 1.5,
  });
});

test("rejects B before A and clears B when A overtakes it", () => {
  const withA = setLoopStart({}, 20, 100);
  const invalid = setLoopEnd(withA, 10, 100);
  assert.match(invalid.error, /après/);
  const valid = setLoopEnd(withA, 30, 100).transport;
  assert.deepEqual(setLoopStart({ ...valid, loopEnabled: true }, 35, 100), {
    loopStart: 35,
    loopEnd: null,
    loopEnabled: false,
    playbackRate: 1,
  });
});

test("steps playback speeds within the supported range", () => {
  assert.equal(stepPlaybackRate(1, 1), 1.5);
  assert.equal(stepPlaybackRate(1, -1), 0.5);
  assert.equal(stepPlaybackRate(0.25, -1), 0.25);
  assert.equal(stepPlaybackRate(2, 1), 2);
});

test("maps professional and alternative shortcuts outside editors", () => {
  const target = { tagName: "DIV" };
  assert.equal(transportShortcut({ key: "j", target }), "reverse");
  assert.equal(transportShortcut({ key: " ", target }), "togglePlayback");
  assert.equal(transportShortcut({ key: "I", target }), "loopStart");
  assert.equal(transportShortcut({ key: "m", target }), "mute");
  assert.equal(transportShortcut({ key: "r", target: { tagName: "TEXTAREA" } }), null);
  assert.equal(transportShortcut({ key: "l", metaKey: true, target }), null);
});

test("assigns custom shortcuts by swapping conflicts", () => {
  const shortcuts = assignShortcut(DEFAULT_SHORTCUTS, "reverse", "l");
  assert.equal(shortcuts.reverse, "l");
  assert.equal(shortcuts.forward, "j");
  assert.equal(transportShortcut({ key: "l", target: { tagName: "DIV" } }, shortcuts), "reverse");
});
