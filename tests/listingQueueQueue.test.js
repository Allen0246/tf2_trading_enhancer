import { test } from "node:test";
import assert from "node:assert/strict";
import { createQueue } from "../backpack.tf/oldUI/listingQueue/queue.js";

test("add() inserts an entry and emits 'add' with it", () => {
  const queue = createQueue();
  const added = [];
  queue.on("add", (entry) => added.push(entry));

  const ok = queue.add({ assetId: "1", baseName: "Rocket Launcher" });

  assert.equal(ok, true);
  assert.equal(queue.size, 1);
  assert.deepEqual(added, [{ assetId: "1", baseName: "Rocket Launcher" }]);
});

test("add() is a no-op (returns false, emits nothing) for an already-queued assetId", () => {
  const queue = createQueue();
  queue.add({ assetId: "1", baseName: "Rocket Launcher" });
  const added = [];
  queue.on("add", (entry) => added.push(entry));

  const ok = queue.add({ assetId: "1", baseName: "A different item somehow" });

  assert.equal(ok, false);
  assert.equal(queue.size, 1);
  assert.deepEqual(added, []);
  assert.equal(queue.get("1").baseName, "Rocket Launcher"); // untouched
});

test("add() rejects an entry with no assetId, without throwing", () => {
  const queue = createQueue();
  assert.equal(queue.add({ baseName: "No id" }), false);
  assert.equal(queue.add(null), false);
  assert.equal(queue.size, 0);
});

test("remove() deletes the entry and emits 'remove' with it, returns false for an unknown assetId", () => {
  const queue = createQueue();
  queue.add({ assetId: "1", baseName: "Rocket Launcher" });
  const removed = [];
  queue.on("remove", (entry) => removed.push(entry));

  const ok = queue.remove("1");

  assert.equal(ok, true);
  assert.equal(queue.size, 0);
  assert.deepEqual(removed, [{ assetId: "1", baseName: "Rocket Launcher" }]);
  assert.equal(queue.remove("1"), false); // already gone
  assert.deepEqual(removed, [{ assetId: "1", baseName: "Rocket Launcher" }]); // no second emit
});

test("update() shallow-merges a patch into the SAME object reference (no copy) and emits 'update'", () => {
  const queue = createQueue();
  queue.add({ assetId: "1", keys: 0, metal: 0 });
  const entryRef = queue.get("1");
  const updated = [];
  queue.on("update", (entry) => updated.push(entry));

  const ok = queue.update("1", { keys: 2 });

  assert.equal(ok, true);
  assert.equal(entryRef.keys, 2); // same object mutated in place
  assert.equal(queue.get("1"), entryRef); // still the identical reference
  assert.deepEqual(updated, [{ assetId: "1", keys: 2, metal: 0 }]);
});

test("update() returns false and emits nothing for an assetId that isn't queued", () => {
  const queue = createQueue();
  const updated = [];
  queue.on("update", (entry) => updated.push(entry));

  assert.equal(queue.update("missing", { keys: 5 }), false);
  assert.deepEqual(updated, []);
});

test("clear() empties the queue and emits 'clear' with every entry that was in it", () => {
  const queue = createQueue();
  queue.add({ assetId: "1" });
  queue.add({ assetId: "2" });
  const cleared = [];
  queue.on("clear", (entries) => cleared.push(entries));

  queue.clear();

  assert.equal(queue.size, 0);
  assert.equal(cleared.length, 1);
  assert.deepEqual(
    cleared[0].map((e) => e.assetId),
    ["1", "2"]
  );
});

test("clear() on an already-empty queue is a no-op - no 'clear' emitted", () => {
  const queue = createQueue();
  const cleared = [];
  queue.on("clear", (entries) => cleared.push(entries));

  queue.clear();

  assert.deepEqual(cleared, []);
});

test("has()/get()/list() reflect current contents", () => {
  const queue = createQueue();
  assert.equal(queue.has("1"), false);
  assert.equal(queue.get("1"), null);
  assert.deepEqual(queue.list(), []);

  queue.add({ assetId: "1" });
  queue.add({ assetId: "2" });

  assert.equal(queue.has("1"), true);
  assert.equal(queue.get("2").assetId, "2");
  assert.deepEqual(
    queue.list().map((e) => e.assetId),
    ["1", "2"]
  );
});

test("on() returns an unsubscribe function that actually stops further calls", () => {
  const queue = createQueue();
  const calls = [];
  const unsubscribe = queue.on("add", (entry) => calls.push(entry));

  queue.add({ assetId: "1" });
  unsubscribe();
  queue.add({ assetId: "2" });

  assert.deepEqual(
    calls.map((e) => e.assetId),
    ["1"]
  );
});

// REGRESSION guard for the exact bug this event-driven design exists to
// avoid (see content.js's own header note): a listener reacting to one
// entry's update must never see or touch an UNRELATED entry.
test("update() on one entry never emits for, or mutates, any other entry", () => {
  const queue = createQueue();
  queue.add({ assetId: "1", keys: 1 });
  queue.add({ assetId: "2", keys: 2 });
  const updated = [];
  queue.on("update", (entry) => updated.push(entry.assetId));

  queue.update("1", { keys: 99 });

  assert.deepEqual(updated, ["1"]);
  assert.equal(queue.get("2").keys, 2); // untouched
});
