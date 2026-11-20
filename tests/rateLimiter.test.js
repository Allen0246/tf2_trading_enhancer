import { test } from "node:test";
import assert from "node:assert/strict";
import { retryWithRateLimit, createRateLimiter, RateLimitCancelledError } from "../utils/rateLimiter.js";

// Fakes the subset of chrome.storage.local this module reads/writes -
// get(keys) by array of keys, set(obj) merging into the store.
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

class FakeRateLimitError extends Error {
  constructor(retryAfterMs = 0) {
    super("rate limited");
    this.retryAfterMs = retryAfterMs;
  }
}

test("retryWithRateLimit returns fn's result on the first try with no error", async () => {
  let calls = 0;
  const rateLimiter = { waitForSlot: async () => {}, reset: async () => {} };

  const result = await retryWithRateLimit(rateLimiter, async () => {
    calls++;
    return "ok";
  }, { isRateLimitError: () => false, describeRetry: () => "" });

  assert.equal(result, "ok");
  assert.equal(calls, 1);
});

test("retryWithRateLimit rethrows immediately when the error doesn't match isRateLimitError", async () => {
  const rateLimiter = { waitForSlot: async () => {}, reset: async () => { throw new Error("should not be called"); } };
  let calls = 0;

  await assert.rejects(
    retryWithRateLimit(rateLimiter, async () => {
      calls++;
      throw new Error("some other failure");
    }, { isRateLimitError: () => false, describeRetry: () => "" }),
    /some other failure/
  );
  assert.equal(calls, 1);
});

test("retryWithRateLimit retries the same call on a matching rate-limit error, resetting and waiting e.retryAfterMs first", async () => {
  let calls = 0;
  let resetCalls = 0;
  let waitForSlotCalls = 0;
  const rateLimiter = {
    waitForSlot: async () => { waitForSlotCalls++; },
    reset: async () => { resetCalls++; },
  };

  const result = await retryWithRateLimit(rateLimiter, async () => {
    calls++;
    // retryAfterMs: 0 so waitOutMs's while loop never actually waits on a
    // real timer - keeps this test fast while still exercising the real
    // reset()+wait code path.
    if (calls < 3) throw new FakeRateLimitError(0);
    return "recovered";
  }, {
    maxRetries: 5,
    isRateLimitError: (e) => e instanceof FakeRateLimitError,
    describeRetry: () => "retrying",
  });

  assert.equal(result, "recovered");
  assert.equal(calls, 3);
  assert.equal(resetCalls, 2);
  assert.equal(waitForSlotCalls, 3);
});

test("retryWithRateLimit gives up after maxRetries and rethrows the last error", async () => {
  let calls = 0;
  let resetCalls = 0;
  const rateLimiter = {
    waitForSlot: async () => {},
    reset: async () => { resetCalls++; },
  };

  await assert.rejects(
    retryWithRateLimit(rateLimiter, async () => {
      calls++;
      throw new FakeRateLimitError(0);
    }, {
      maxRetries: 2,
      isRateLimitError: (e) => e instanceof FakeRateLimitError,
      describeRetry: () => "retrying",
    }),
    FakeRateLimitError
  );

  // attempts 0,1,2 all call fn (3 calls) - the loop only rethrows without
  // another attempt once attempt >= maxRetries, so reset() only runs for the
  // two attempts that actually looped back around (0 and 1), not the final one.
  assert.equal(calls, 3);
  assert.equal(resetCalls, 2);
});

test("createRateLimiter.getSlotAvailability reports available with room under maxRequests", async () => {
  globalThis.chrome = { storage: { local: fakeStorageLocal() } };
  const limiter = createRateLimiter({ storageKey: "testTimestamps", windowMs: 60_000 });

  const availability = await limiter.getSlotAvailability(5);
  assert.deepEqual(availability, { availableNow: true, nextAvailableAt: null });
});

// The clock is frozen: getSlotAvailability reads Date.now() more than once,
// so on a busy machine a real clock can move a millisecond in between and
// make the exact answer 1ms later.
test("createRateLimiter.getSlotAvailability reports the next available time once maxRequests is reached", async () => {
  const realDateNow = Date.now;
  const now = 1_000_000;
  Date.now = () => now;
  try {
    globalThis.chrome = { storage: { local: fakeStorageLocal({ testTimestamps: [now, now, now] }) } };
    const limiter = createRateLimiter({ storageKey: "testTimestamps", windowMs: 60_000 });

    const availability = await limiter.getSlotAvailability(3);
    assert.equal(availability.availableNow, false);
    assert.equal(availability.nextAvailableAt, now + 60_000 + 250);
  } finally {
    Date.now = realDateNow;
  }
});

test("createRateLimiter.waitForSlot reserves a slot immediately when under maxRequests, without waiting", async () => {
  const storage = fakeStorageLocal({});
  globalThis.chrome = { storage: { local: storage } };
  // maxRequests kept generous relative to existing timestamps so waitForSlot
  // never has to actually wait on a real timer - the task's own instructions
  // warn against letting this block on setTimeout for real time.
  const limiter = createRateLimiter({ storageKey: "testTimestamps", windowMs: 60_000 });

  await limiter.waitForSlot(5, () => {});
  const stored = await storage.get(["testTimestamps"]);
  assert.equal(stored.testTimestamps.length, 1);
});

test("createRateLimiter.waitForSlot filters out timestamps older than windowMs before counting", async () => {
  const now = Date.now();
  const storage = fakeStorageLocal({ testTimestamps: [now - 120_000] }); // well outside a 60s window
  globalThis.chrome = { storage: { local: storage } };
  const limiter = createRateLimiter({ storageKey: "testTimestamps", windowMs: 60_000 });

  await limiter.waitForSlot(1, () => {});
  const stored = await storage.get(["testTimestamps"]);
  // the stale timestamp should have been dropped, leaving just the new slot
  assert.equal(stored.testTimestamps.length, 1);
  assert.ok(stored.testTimestamps[0] >= now);
});

// Added after a run of backpack.tf requests (nothing else running, no
// client-side counting bug) got a real 429 from backpack.tf's own server well under the
// documented 60/60s average, consistent with an undocumented
// burst/smoothing sub-limit. Spreading requests evenly
// (windowMs/maxRequests apart) sidesteps that regardless of its exact
// shape, since evenly-paced requests never look like a burst.
test("createRateLimiter.waitForSlot enforces a minimum pacing gap between consecutive slots, even with plenty of room under maxRequests", async () => {
  const originalDateNow = Date.now;
  const originalSetTimeout = globalThis.setTimeout;
  let now = 1_000_000;
  Date.now = () => now;

  try {
    const storage = fakeStorageLocal({});
    globalThis.chrome = { storage: { local: storage } };
    // 60/60s => 1000ms minimum gap between slots, backpack.tf's documented average.
    const limiter = createRateLimiter({ storageKey: "testTimestamps", windowMs: 60_000 });

    await limiter.waitForSlot(60, () => {}); // first slot - nothing to wait for

    const waitingCalls = [];
    globalThis.setTimeout = (fn, delay) => {
      waitingCalls.push(delay);
      now += delay;
      fn();
    };
    await limiter.waitForSlot(60, (remainingMs) => {}); // second slot, immediately after

    // Only ~59 of the 60-slot budget is used (nowhere near the count cap) -
    // the wait must come entirely from the pacing gap, landing on 1000ms.
    assert.deepEqual(waitingCalls, [1000]);
    const stored = await storage.get(["testTimestamps"]);
    assert.equal(stored.testTimestamps.length, 2);
    assert.equal(stored.testTimestamps[1] - stored.testTimestamps[0], 1000);
  } finally {
    Date.now = originalDateNow;
    globalThis.setTimeout = originalSetTimeout;
  }
});

test("createRateLimiter.waitForSlot doesn't wait at all when called again after the pacing gap has already naturally elapsed", async () => {
  const originalDateNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;

  try {
    const storage = fakeStorageLocal({});
    globalThis.chrome = { storage: { local: storage } };
    const limiter = createRateLimiter({ storageKey: "testTimestamps", windowMs: 60_000 }); // 1000ms gap at maxRequests=60

    await limiter.waitForSlot(60, () => {});
    now += 1000; // real time already advanced past the pacing gap on its own
    await limiter.waitForSlot(60, () => {
      throw new Error("should not have needed to wait");
    });

    const stored = await storage.get(["testTimestamps"]);
    assert.equal(stored.testTimestamps.length, 2);
  } finally {
    Date.now = originalDateNow;
  }
});

test("createRateLimiter.getSlotAvailability reflects the pacing gap too, not just the count cap", async () => {
  const now = Date.now();
  // One very recent slot, nowhere near the count cap (2 of 60) - the OLD
  // count-only check would have reported availableNow: true here.
  const storage = fakeStorageLocal({ testTimestamps: [now] });
  globalThis.chrome = { storage: { local: storage } };
  const limiter = createRateLimiter({ storageKey: "testTimestamps", windowMs: 60_000 });

  const availability = await limiter.getSlotAvailability(60);
  assert.equal(availability.availableNow, false);
  assert.ok(
    availability.nextAvailableAt >= now + 1000 - 50 && availability.nextAvailableAt <= now + 1000 + 50,
    `expected ~${now + 1000}, got ${availability.nextAvailableAt}`
  );
});

test("createRateLimiter.waitForSlot uses a much longer pacing gap for the free tier's smaller maxRequests (10s at 6/60s vs 1s at 60/60s)", async () => {
  const originalDateNow = Date.now;
  const originalSetTimeout = globalThis.setTimeout;
  let now = 1_000_000;
  Date.now = () => now;

  try {
    const storage = fakeStorageLocal({});
    globalThis.chrome = { storage: { local: storage } };
    const limiter = createRateLimiter({ storageKey: "testTimestamps", windowMs: 60_000 });

    await limiter.waitForSlot(6, () => {});

    const waitingCalls = [];
    globalThis.setTimeout = (fn, delay) => {
      waitingCalls.push(delay);
      now += delay;
      fn();
    };
    await limiter.waitForSlot(6, () => {});

    assert.equal(waitingCalls.reduce((a, b) => a + b, 0), 10_000);
  } finally {
    Date.now = originalDateNow;
    globalThis.setTimeout = originalSetTimeout;
  }
});

// The pacing rate is now an independent constructor option
// (a caller's own pacing constant), not forced to derive
// from windowMs/maxRequests, so it can be tuned without touching the real
// per-minute average limit at all.
test("createRateLimiter honors an explicit minIntervalMs constructor option instead of deriving the pacing gap from windowMs/maxRequests", async () => {
  const originalDateNow = Date.now;
  const originalSetTimeout = globalThis.setTimeout;
  let now = 1_000_000;
  Date.now = () => now;

  try {
    const storage = fakeStorageLocal({});
    globalThis.chrome = { storage: { local: storage } };
    // windowMs/maxRequests would naturally derive 1000ms (60000/60) - the
    // explicit override below should win instead.
    const limiter = createRateLimiter({ storageKey: "testTimestamps", windowMs: 60_000, minIntervalMs: 500 });

    await limiter.waitForSlot(60, () => {});

    const waitingCalls = [];
    globalThis.setTimeout = (fn, delay) => {
      waitingCalls.push(delay);
      now += delay;
      fn();
    };
    await limiter.waitForSlot(60, () => {});

    assert.deepEqual(waitingCalls, [500]);
  } finally {
    Date.now = originalDateNow;
    globalThis.setTimeout = originalSetTimeout;
  }
});

test("createRateLimiter.waitForSlot blocks (calling onWaiting with the remaining ms) until a slot frees up, then reserves it", async () => {
  // A fake clock + setTimeout that advances it instead of waiting on a real
  // timer - deterministic (no flakiness from real elapsed test-execution
  // time) and instant, while still exercising waitOutMs's own while loop for
  // real (including its multi-tick path, since this remainingMs exceeds the
  // 1000ms single-tick cap).
  const originalSetTimeout = globalThis.setTimeout;
  const originalDateNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;
  globalThis.setTimeout = (fn, delay) => {
    now += delay;
    fn();
  };

  const storage = fakeStorageLocal({ testTimestamps: [now] }); // exactly 1 slot used, windowMs below also 1000
  globalThis.chrome = { storage: { local: storage } };
  const limiter = createRateLimiter({ storageKey: "testTimestamps", windowMs: 1000 });

  const waitingCalls = [];
  try {
    await limiter.waitForSlot(1, (remainingMs) => waitingCalls.push(remainingMs));
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    Date.now = originalDateNow;
  }

  // +250ms boundary buffer means the first check finds no room and has to
  // wait across two ticks (1000ms then 250ms) before the old timestamp ages
  // out of the window and a slot frees up.
  assert.deepEqual(waitingCalls, [1250, 250]);
  const stored = await storage.get(["testTimestamps"]);
  assert.equal(stored.testTimestamps.length, 1);
  assert.ok(stored.testTimestamps[0] >= now);
});

test("createRateLimiter.waitForSlot bails out early (without reserving a slot) once cancelFlag.cancelled flips mid-wait, instead of waiting out the full remaining window", async () => {
  // Regression test for a live bug (a long rate-limited run): hitting Stop
  // while a "waiting Ns for backpack.tf's rate
  // limit" status was showing used to leave the Stop button stuck until the
  // ENTIRE remaining rate-limit window elapsed, because waitForSlot's wait
  // never looked at cancelFlag at all. Fake clock/setTimeout as in the test
  // above - deterministic, no reliance on real elapsed time.
  const originalSetTimeout = globalThis.setTimeout;
  const originalDateNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;
  const cancelFlag = { cancelled: false };
  globalThis.setTimeout = (fn, delay) => {
    now += delay;
    cancelFlag.cancelled = true; // flip mid-wait, simulating a Stop click
    fn();
  };

  const storage = fakeStorageLocal({ testTimestamps: [now] });
  globalThis.chrome = { storage: { local: storage } };
  const limiter = createRateLimiter({ storageKey: "testTimestamps", windowMs: 10_000 }); // long enough to need multiple ticks

  const waitingCalls = [];
  let gotSlot;
  try {
    gotSlot = await limiter.waitForSlot(1, (remainingMs) => waitingCalls.push(remainingMs), cancelFlag);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    Date.now = originalDateNow;
  }

  assert.equal(gotSlot, false);
  // Only the first tick's onWaiting call happened - cancellation is noticed
  // right after that tick's setTimeout resolves, well before the ~10s window
  // would otherwise have elapsed.
  assert.equal(waitingCalls.length, 1);
  const stored = await storage.get(["testTimestamps"]);
  // No new slot reserved - the original (stale, single) timestamp is untouched.
  assert.equal(stored.testTimestamps.length, 1);
});

test("retryWithRateLimit throws RateLimitCancelledError (without calling fn) when waitForSlot reports a cancellation", async () => {
  let calls = 0;
  const rateLimiter = { waitForSlot: async () => false, reset: async () => {} };

  await assert.rejects(
    retryWithRateLimit(rateLimiter, async () => {
      calls++;
      return "should not get here";
    }, { isRateLimitError: () => false, describeRetry: () => "" }),
    RateLimitCancelledError
  );
  assert.equal(calls, 0);
});

// RetryWithRateLimit used to wait out e.retryAfterMs directly (via a bare
// waitOutMs call) right after reset() - now that wait is folded into
// waitForSlot's own math instead (see createRateLimiter.reset's own note on
// why reset() no longer wipes the history to empty), so a mid-wait
// cancellation is now surfaced by waitForSlot returning false on the RETRY
// attempt, not by onWaiting flipping cancelFlag during a wait that no longer
// lives in this function at all.
test("retryWithRateLimit throws RateLimitCancelledError (without retrying fn again) when waitForSlot reports a cancellation on the retry attempt after a 429", async () => {
  let calls = 0;
  let waitForSlotCalls = 0;
  const rateLimiter = {
    waitForSlot: async () => {
      waitForSlotCalls++;
      // First call (before fn's first attempt) succeeds normally; the
      // SECOND call (retryWithRateLimit re-entering waitForSlot after the
      // 429 + reset) simulates the user hitting Stop mid-wait - matches
      // createRateLimiter.waitForSlot's own real cancellation contract
      // (returns false rather than throwing).
      return waitForSlotCalls === 1;
    },
    reset: async () => {},
  };

  await assert.rejects(
    retryWithRateLimit(rateLimiter, async () => {
      calls++;
      throw new FakeRateLimitError(500);
    }, {
      maxRetries: 5,
      isRateLimitError: (e) => e instanceof FakeRateLimitError,
      describeRetry: () => "retrying",
    }),
    RateLimitCancelledError
  );

  assert.equal(calls, 1); // fn was never retried after the cancellation
  assert.equal(waitForSlotCalls, 2);
});

// Reset() used to wipe the history to `[]`, telling waitForSlot a FULL
// fresh budget was available immediately - true for the item being retried
// (which waits retryAfterMs first), but WRONG for any other item's call
// made shortly after, since the server's real window hadn't actually rolled
// over. Reseeding every slot from the server's own reported retryAfterMs
// instead means ANY caller - not just the retried one - correctly waits the
// same remaining time.
test("createRateLimiter.reset seeds every slot from the server's own retryAfterMs, not wiped to empty", async () => {
  const originalDateNow = Date.now;
  const now = 1_000_000;
  Date.now = () => now;

  try {
    const storage = fakeStorageLocal({ testTimestamps: [now, now] });
    globalThis.chrome = { storage: { local: storage } };
    const windowMs = 60_000;
    const limiter = createRateLimiter({ storageKey: "testTimestamps", windowMs });

    await limiter.reset(5_000, 3); // server says "retry after 5s", budget is 3/window
    const stored = await storage.get(["testTimestamps"]);

    assert.equal(stored.testTimestamps.length, 3); // every `maxRequests` slot seeded, not just replacing the old 2
    assert.deepEqual(stored.testTimestamps, [now - windowMs + 5_000, now - windowMs + 5_000, now - windowMs + 5_000]);
  } finally {
    Date.now = originalDateNow;
  }
});

test("createRateLimiter.reset clamps an invalid/oversized retryAfterMs to the full window (NaN, negative, or larger than windowMs)", async () => {
  const originalDateNow = Date.now;
  const now = 1_000_000;
  Date.now = () => now;

  try {
    const storage = fakeStorageLocal({});
    globalThis.chrome = { storage: { local: storage } };
    const windowMs = 60_000;
    const limiter = createRateLimiter({ storageKey: "testTimestamps", windowMs });

    // NaN - e.g. a Retry-After header background.js's own parseRetryAfterMs
    // couldn't parse at all - must not poison the seeded timestamps with NaN.
    await limiter.reset(NaN, 2);
    let stored = await storage.get(["testTimestamps"]);
    assert.deepEqual(stored.testTimestamps, [now, now]); // falls back to the full window (anchored at "now")

    await limiter.reset(windowMs * 10, 1); // absurdly large - clamped to windowMs, not left oversized
    stored = await storage.get(["testTimestamps"]);
    assert.deepEqual(stored.testTimestamps, [now]);
  } finally {
    Date.now = originalDateNow;
  }
});

test("a slot reseeded by reset() makes waitForSlot wait out exactly the server's own retryAfterMs (plus the usual +250ms buffer), for ANY caller - not just the one that got the 429", async () => {
  const originalDateNow = Date.now;
  const originalSetTimeout = globalThis.setTimeout;
  let now = 1_000_000;
  Date.now = () => now;

  try {
    const storage = fakeStorageLocal({});
    globalThis.chrome = { storage: { local: storage } };
    const limiter = createRateLimiter({ storageKey: "testTimestamps", windowMs: 60_000 });

    await limiter.reset(5_000, 2); // server says "retry after 5s"

    const waitingCalls = [];
    globalThis.setTimeout = (fn, delay) => {
      waitingCalls.push(delay);
      now += delay;
      fn();
    };
    await limiter.waitForSlot(2, () => {});

    // waitOutMs ticks in <=1000ms chunks (see its own cap) - 5 full ticks
    // plus a final 250ms one, totaling retryAfterMs + 250 (5250ms), not a
    // fresh assumed-empty budget, which would have reserved a slot
    // immediately with no wait at all.
    assert.deepEqual(waitingCalls, [1000, 1000, 1000, 1000, 1000, 250]);
    assert.equal(waitingCalls.reduce((a, b) => a + b, 0), 5_250);
  } finally {
    Date.now = originalDateNow;
    globalThis.setTimeout = originalSetTimeout;
  }
});
