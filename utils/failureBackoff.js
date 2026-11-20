/*
@description: Shared persisted failure-cooldown tracker for an integration
that fires automatically (not on explicit user action) against an
undocumented third-party endpoint, so its own failure handling has to
distinguish a transient blip from a sustained problem (used by
utils/marketplaceTfPricing.js and utils/repTfInfo.js). Without this, a call
that starts consistently failing (the endpoint changed shape, or the site
started blocking this extension's traffic) would keep retrying at the same
frequency forever.

Persisted (chrome.storage.local), not in-memory, for the same reason
utils/rateLimiter.js's own header note gives: these content scripts reload
on every page navigation, an in-memory counter would reset to zero on every
navigation and never actually detect a sustained problem across a session.

Deliberately NOT applied to every third-party integration in this codebase -
utils/scmPricing.js already has its own client-side rate limiter (self-
throttled under Steam's own observed threshold) plus a 24h cache and
429-retry handling, real protection already exists there, and this would
add complexity for little marginal benefit. Only wired into callers that
actually lack any such protection today.
*/

/*
@description: Thrown by attempt() below when a call is skipped because the
tracked failure count is currently in cooldown - fn() is never invoked. A
caller's existing try/catch around a normal failure already handles this
the same way (log + fall back to cache/null), so this is deliberately just
a plain Error subclass with no special fields to branch on - the point is
to fall through the SAME catch block a real failure already hits, not to
need a new one. A caller that runs very often (utils/marketplaceTfPricing.js,
once per page update) checks `instanceof` only to skip its warning.
*/
export class BackoffCooldownError extends Error {
  constructor() {
    super("Skipped: in cooldown after repeated failures");
    this.name = "BackoffCooldownError";
  }
}

/*
@description: maxConsecutiveFailures/cooldownMs are per-caller, not a shared
constant - two integrations wired into this can have very different call
frequencies (see utils/repTfInfo.js's own note on why its cooldown is much
shorter than utils/marketplaceTfPricing.js's), so a one-size-fits-all
cooldown would be wrong for at least one of them.
*/
export function createFailureBackoff({ storageKey, maxConsecutiveFailures, cooldownMs }) {
  async function getState() {
    const stored = await chrome.storage.local.get([storageKey]);
    return stored[storageKey] || { consecutiveFailures: 0, cooldownUntil: 0 };
  }

  async function saveState(state) {
    await chrome.storage.local.set({ [storageKey]: state });
  }

  return {
    /*
    @description: Runs fn() and returns its result, unless the persisted
    failure count is currently in cooldown, in which case fn() is never
    called at all and this throws BackoffCooldownError instead. Records the
    outcome against the persisted state either way a real attempt is made:
    a success resets the failure count to zero; a failure (fn() throwing
    anything, cooldown or not) increments it and, once it reaches
    maxConsecutiveFailures, starts (or extends) the cooldown window from
    now. The original error from fn() is rethrown after being recorded, so
    a caller's existing catch block sees the exact same error shape it
    already handles today.
    */
    async attempt(fn) {
      const state = await getState();

      if (Date.now() < state.cooldownUntil) {
        throw new BackoffCooldownError();
      }

      try {
        const result = await fn();
        if (state.consecutiveFailures !== 0) await saveState({ consecutiveFailures: 0, cooldownUntil: 0 });
        return result;
      } catch (e) {
        const consecutiveFailures = state.consecutiveFailures + 1;
        const cooldownUntil = consecutiveFailures >= maxConsecutiveFailures ? Date.now() + cooldownMs : state.cooldownUntil;
        await saveState({ consecutiveFailures, cooldownUntil });
        throw e;
      }
    },
  };
}
