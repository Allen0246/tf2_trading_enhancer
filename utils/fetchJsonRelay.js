/*
@description: Relays a GET request through the background script's own
FETCH_JSON handler (see background.js's own header note on why - Firefox
blocks a content script from reading a cross-origin fetch() response even
with host_permissions covering the target), with a few automatic retries for
a TRANSIENT server-side failure (5xx).

Valve's own Web API can fail this way briefly under load, and giving up
after a single attempt silently produced WRONG results elsewhere rather than
an obvious failure. Retrying here means the caller's own "Loading…" notice
naturally stays up for the extra round trip(s) instead of the caller needing
its own retry loop.

NOT retried for a 429 (rate limit - callers already get a structured
{status: 429, retryAfterMs} result for that, a different, caller-visible
failure mode that shouldn't just be hammered again) or any other non-5xx
failure (a genuine, non-transient error - a bad request, an expired key, a
malformed URL - retrying that wastes time for no chance of a different
result).
See #43.
*/

const DEFAULT_RETRIES = 2;
const RETRY_DELAY_MS = 700;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientFailure(response) {
  return typeof response?.status === "number" && response.status >= 500 && response.status < 600;
}

function relayOnce(url) {
  return chrome.runtime.sendMessage({ type: "FETCH_JSON", url });
}

/*
@description: See this file's own header note.
@param {string} url
@param {{retries?: number, retryDelayMs?: number}} [options] -
retries defaults to DEFAULT_RETRIES (2, i.e. up to 3 attempts total); pass 0
for a caller that wants a single attempt.
retryDelayMs defaults to RETRY_DELAY_MS - exposed mainly so tests don't have
to wait out the real delay.
@returns {Promise<any>} the relayed response's own parsed JSON body.
@throws if every attempt fails, or the final attempt's failure wasn't a 5xx
(no retry is even attempted in that case).
*/
export async function fetchJsonRelay(url, { retries = DEFAULT_RETRIES, retryDelayMs = RETRY_DELAY_MS } = {}) {
  let lastResponse = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const response = await relayOnce(url);
    if (response?.ok) return response.data;

    lastResponse = response;
    if (!isTransientFailure(response) || attempt === retries) break;

    await sleep(retryDelayMs);
  }

  throw new Error(lastResponse?.error || "Background fetch failed");
}
