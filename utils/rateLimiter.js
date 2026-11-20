/*
@description: Persisted sliding-window rate limiter, used by
utils/scmPricing.js.

Persisted in chrome.storage.local (not in-memory) because content scripts
reload on every navigation: stntrading.eu reloads its whole content script
per item page, and an in-memory tracker forgot every prior request on each
click-through, drifting out of sync with the server's own counter.

Known limitation: the read-modify-write has no lock, so two tabs calling
waitForSlot at nearly the same moment can both reserve a slot and jointly
exceed the server limit slightly. chrome.storage.local offers no
transactions; the +250ms boundary buffer keeps normal single-tab use safely
under the limit.
*/

/*
@description: Waits out a known remaining duration, calling
onWaiting(remainingMs) roughly once per second so callers can show a live
countdown. cancelFlag (optional { cancelled }) is checked every tick, so a
Stop button cuts the wait short instead of leaving the UI looking stuck for
a whole rate-limit window.
*/
async function waitOutMs(remainingMs, onWaiting, cancelFlag) {
  while (remainingMs > 0) {
    if (cancelFlag?.cancelled) return;
    if (onWaiting) onWaiting(remainingMs);
    const tick = Math.min(1000, remainingMs);
    await new Promise((resolve) => setTimeout(resolve, tick));
    remainingMs -= tick;
  }
}

/*
@description: Thrown by retryWithRateLimit when cancelFlag.cancelled goes
true while waiting for a slot or a post-429 retry-after, so a caller with a
Stop button can tell "user hit Stop" apart from a real fetch failure.
*/
export class RateLimitCancelledError extends Error {
  constructor() {
    super("Rate-limit wait cancelled");
    this.name = "RateLimitCancelledError";
  }
}

/*
@description: Reserves a rate-limit slot and calls fn(), retrying the same
call if it throws an error matching isRateLimitError. The client-side slot
tracker is a prediction, not a read of the server's counter, so a request can
still be rejected; on a matching error the persisted history is reseeded from
the error's retryAfterMs (see reset) before retrying. Gives up after
maxRetries and rethrows, so a persistently failing call cannot hang forever.
describeRetry lets each caller keep its own log wording (e.g. the item name).

cancelFlag (optional { cancelled }) is threaded into every wait; once it is
noticed this throws RateLimitCancelledError and fn() is not called.
*/
export async function retryWithRateLimit(rateLimiter, fn, { onWaiting, maxRequests, maxRetries = 3, isRateLimitError, describeRetry, cancelFlag } = {}) {
  for (let attempt = 0; ; attempt++) {
    // === false (not falsy) so a rate limiter double whose waitForSlot
    // returns undefined is not mistaken for a cancellation.
    const gotSlot = await rateLimiter.waitForSlot(maxRequests, onWaiting, cancelFlag);
    if (gotSlot === false) throw new RateLimitCancelledError();

    try {
      return await fn();
    } catch (e) {
      if (!isRateLimitError(e) || attempt >= maxRetries) throw e;

      console.warn(describeRetry(e));
      await rateLimiter.reset(e.retryAfterMs, maxRequests);
      // Loop: waitForSlot (now seeded from the server's retryAfterMs) waits
      // out the right time before retrying this same call.
    }
  }
}

/*
@description: Creates a sliding-window limiter whose request timestamps are
persisted under storageKey. maxRequests is passed per call rather than fixed
here, because one endpoint's budget can change at runtime (backpack.tf
Premium raises it). minIntervalMs: see computeWait.
@returns {{getSlotAvailability: Function, waitForSlot: Function, reset: Function}}
*/
export function createRateLimiter({ storageKey, windowMs, minIntervalMs } = {}) {
  async function getTimestamps() {
    const stored = await chrome.storage.local.get([storageKey]);
    const timestamps = stored[storageKey] || [];
    const now = Date.now();
    return timestamps.filter((t) => now - t <= windowMs);
  }

  async function saveTimestamps(timestamps) {
    await chrome.storage.local.set({ [storageKey]: timestamps });
  }

  /*
  @description: Decides whether a slot is usable now, applying both the
  sliding-window count cap and a minimum gap between requests. The gap
  exists because a run of backpack.tf requests got a real 429 around 30-40
  requests in, well under the documented 60/60s average, consistent with an
  undocumented burst sub-limit; pacing requests so they never look like a
  burst avoids it regardless of its exact shape, at the cost of a long run
  taking longer.

  `minIntervalMs` (constructor option) sets that gap independently of
  maxRequests/windowMs; when omitted it falls back to windowMs/maxRequests
  (requests spread evenly across the window), which is what
  utils/scmPricing.js uses.

  Shared by getSlotAvailability (non-blocking) and waitForSlot (blocking) so
  the "is a slot usable now" rule lives in one place.
  */
  function computeWait(timestamps, maxRequests) {
    if (timestamps.length >= maxRequests) {
      // Sliding-window cap reached - wait for the oldest slot to age out.
      // +250ms safety buffer past the window boundary.
      return { ready: false, remainingMs: windowMs - (Date.now() - timestamps[0]) + 250 };
    }

    const effectiveMinIntervalMs = minIntervalMs ?? windowMs / maxRequests;
    // timestamps is ascending (entries are only appended or aged out), so
    // the last entry is the most recently reserved slot.
    const lastTimestamp = timestamps[timestamps.length - 1];
    const sinceLast = lastTimestamp === undefined ? Infinity : Date.now() - lastTimestamp;

    if (sinceLast < effectiveMinIntervalMs) {
      return { ready: false, remainingMs: effectiveMinIntervalMs - sinceLast };
    }

    return { ready: true, remainingMs: 0 };
  }

  return {
    /*
    @description: Non-blocking check of the current rate-limit state (same
    persisted history and computeWait rule waitForSlot uses), so a caller can
    show "next request available at ..." without attempting a request.
    */
    async getSlotAvailability(maxRequests) {
      const timestamps = await getTimestamps();
      const { ready, remainingMs } = computeWait(timestamps, maxRequests);

      if (ready) return { availableNow: true, nextAvailableAt: null };
      return { availableNow: false, nextAvailableAt: Date.now() + remainingMs };
    },

    /*
    @description: Blocks until computeWait allows a request, then reserves a
    slot. Calls onWaiting(remainingMs) roughly once per second while waiting.
    cancelFlag (optional { cancelled }) is checked before and after each wait;
    if set, this returns without reserving a slot.
    @returns {boolean} true if a slot was reserved, false if cancelled.
    */
    async waitForSlot(maxRequests, onWaiting, cancelFlag) {
      for (;;) {
        if (cancelFlag?.cancelled) return false;

        const timestamps = await getTimestamps();
        const { ready, remainingMs } = computeWait(timestamps, maxRequests);

        if (ready) {
          timestamps.push(Date.now());
          await saveTimestamps(timestamps);
          return true;
        }

        await waitOutMs(remainingMs, onWaiting, cancelFlag);
        if (cancelFlag?.cancelled) return false;
      }
    },

    /*
    @description: Called after a real 429, which means the client-side
    prediction has drifted from the server's counter. Reseeds the history
    from the server's retryAfterMs instead of wiping it: an empty history
    would tell waitForSlot a full fresh budget is available immediately,
    which is wrong for every other item's call until the server's window
    actually rolls over.

    Every slot is seeded at `now - windowMs + retryAfterMs`, so computeWait's
    `windowMs - (now - timestamps[0]) + 250` comes out to exactly
    `retryAfterMs + 250` for every caller: one 429 produces one shared wait,
    not a per-item cascade. A missing/NaN/out-of-range retryAfterMs is
    clamped, falling back to the full window.
    See #140.
    */
    async reset(retryAfterMs, maxRequests) {
      const safeRetryAfterMs = Number.isFinite(retryAfterMs) ? Math.max(0, Math.min(retryAfterMs, windowMs)) : windowMs;
      const anchor = Date.now() - windowMs + safeRetryAfterMs;
      await saveTimestamps(new Array(maxRequests).fill(anchor));
    },
  };
}
