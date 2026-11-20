import { test } from "node:test";
import assert from "node:assert/strict";
import { createFailureBackoff, BackoffCooldownError } from "../utils/failureBackoff.js";

// Fakes the subset of chrome.storage.local this module reads/writes - same
// shape tests/rateLimiter.test.js's own fakeStorageLocal uses.
function fakeStorageLocal(initial = {}) {
  const store = { ...initial };
  return {
    async get(keys) {
      const result = {};
      for (const k of keys) if (k in store) result[k] = store[k];
      return result;
    },
    async set(obj) {
      Object.assign(store, obj);
    },
  };
}

function installFakeChrome(initial = {}) {
  globalThis.chrome = { storage: { local: fakeStorageLocal(initial) } };
}

test("attempt() runs fn and returns its result on success", async () => {
  installFakeChrome();
  const backoff = createFailureBackoff({ storageKey: "k", maxConsecutiveFailures: 3, cooldownMs: 1000 });

  const result = await backoff.attempt(async () => "ok");

  assert.equal(result, "ok");
});

test("attempt() rethrows fn's own error on failure", async () => {
  installFakeChrome();
  const backoff = createFailureBackoff({ storageKey: "k", maxConsecutiveFailures: 3, cooldownMs: 1000 });

  await assert.rejects(() => backoff.attempt(async () => { throw new Error("boom"); }), /boom/);
});

test("after maxConsecutiveFailures failures, a further attempt() throws BackoffCooldownError without calling fn", async () => {
  installFakeChrome();
  const backoff = createFailureBackoff({ storageKey: "k", maxConsecutiveFailures: 3, cooldownMs: 60_000 });
  const failing = async () => { throw new Error("fail"); };

  await assert.rejects(() => backoff.attempt(failing), /fail/);
  await assert.rejects(() => backoff.attempt(failing), /fail/);
  await assert.rejects(() => backoff.attempt(failing), /fail/);

  let calls = 0;
  await assert.rejects(
    () => backoff.attempt(async () => { calls++; return "should not run"; }),
    BackoffCooldownError
  );
  assert.equal(calls, 0);
});

test("cooldown expires after cooldownMs and a fresh attempt runs fn again", async () => {
  installFakeChrome();
  const backoff = createFailureBackoff({ storageKey: "k", maxConsecutiveFailures: 1, cooldownMs: 50 });

  await assert.rejects(() => backoff.attempt(async () => { throw new Error("fail"); }));
  await assert.rejects(() => backoff.attempt(async () => "should not run"), BackoffCooldownError);

  await new Promise((resolve) => setTimeout(resolve, 60));

  const result = await backoff.attempt(async () => "recovered");
  assert.equal(result, "recovered");
});

test("a success resets the failure count, so a later isolated failure doesn't trigger cooldown early", async () => {
  installFakeChrome();
  const backoff = createFailureBackoff({ storageKey: "k", maxConsecutiveFailures: 2, cooldownMs: 60_000 });

  await assert.rejects(() => backoff.attempt(async () => { throw new Error("fail"); }));
  await backoff.attempt(async () => "ok"); // resets the count back to 0
  await assert.rejects(() => backoff.attempt(async () => { throw new Error("fail"); })); // only 1 consecutive failure now

  // Still under maxConsecutiveFailures (2), so this should actually run, not be skipped.
  let ran = false;
  const result = await backoff.attempt(async () => { ran = true; return "ok"; });
  assert.equal(ran, true);
  assert.equal(result, "ok");
});

test("separate storageKeys track independent state", async () => {
  installFakeChrome();
  const a = createFailureBackoff({ storageKey: "a", maxConsecutiveFailures: 1, cooldownMs: 60_000 });
  const b = createFailureBackoff({ storageKey: "b", maxConsecutiveFailures: 1, cooldownMs: 60_000 });

  await assert.rejects(() => a.attempt(async () => { throw new Error("fail"); }));
  await assert.rejects(() => a.attempt(async () => "should not run"), BackoffCooldownError);

  // b's own state is untouched by a's failure.
  const result = await b.attempt(async () => "ok");
  assert.equal(result, "ok");
});
