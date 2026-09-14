import assert from "node:assert/strict";
import test from "node:test";
import { OrderedSaveQueue } from "../../source/web/persistence.js";

test("serializes saves and guarantees the latest state", async () => {
  const writes = [];
  const releases = [];
  const queue = new OrderedSaveQueue((state, revision) => new Promise((resolve) => {
    writes.push({ state, revision });
    releases.push(resolve);
  }));

  queue.markDirty({ title: "premier" });
  const firstFlush = queue.flush();
  await Promise.resolve();
  queue.markDirty({ title: "dernier" });
  const closeFlush = queue.flush();

  assert.deepEqual(writes, [{ state: { title: "premier" }, revision: 1 }]);
  releases.shift()({ saved: true });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(writes.at(-1), { state: { title: "dernier" }, revision: 2 });
  releases.shift()({ saved: true });

  await Promise.all([firstFlush, closeFlush]);
  assert.equal(queue.savedRevision, 2);
});

test("flush after an immediate edit persists without waiting for autosave", async () => {
  const writes = [];
  const queue = new OrderedSaveQueue(async (state, revision) => {
    writes.push({ state, revision });
    return { saved: true };
  });

  queue.markDirty({ analysis: "modification avant fermeture" });
  await queue.flush();
  assert.deepEqual(writes, [{ state: { analysis: "modification avant fermeture" }, revision: 1 }]);
});

test("does not acknowledge a failed native save and can retry", async () => {
  let attempt = 0;
  const queue = new OrderedSaveQueue(async () => {
    attempt += 1;
    if (attempt === 1) throw new Error("disque indisponible");
    return { saved: true };
  });

  queue.markDirty({ version: 6 });
  await assert.rejects(queue.flush(), /disque indisponible/);
  assert.equal(queue.savedRevision, 0);
  await queue.flush();
  assert.equal(queue.savedRevision, 1);
});
