/*
@description: Steam Community Market pricing helper - an item's cheapest
listing via Steam's own (unofficial, unauthenticated) priceoverview endpoint
(see getScmLowestPriceText). Lives in utils/ because web_accessible_resources'
utils/** entry is already open to every site this extension touches, even
though its only caller is on steamcommunity.com (fabricatorMultiBuy).

Fetched directly with a plain fetch() - NOT routed through background.js's
relay the way every other cross-origin pricing call in this extension is.
Those all exist to reach a DIFFERENT origin than the page the content
script runs on (api.backpack.tf/api.steampowered.com from scrap.tf/
stntrading.eu/steamcommunity.com), which is genuinely cross-origin and hits
either Firefox's read-blocking or a page's own CSP blocking the fetch
outright (see background.js's own file-level note). This module's callers
run on steamcommunity.com itself, fetching steamcommunity.com -
same-origin, so neither problem applies and the relay would just be a
pointless extra hop.
*/

import { createRateLimiter, retryWithRateLimit } from "./rateLimiter.js";
import { parseRetryAfterMs } from "./retryAfter.js";

const PRICEOVERVIEW_URL = "https://steamcommunity.com/market/priceoverview/";
const APPID = 440;

// Community-observed (not an officially documented figure - priceoverview is
// unauthenticated and undocumented): steamcommunity.com throttles Market
// endpoints per-IP at roughly 20 requests/minute. 15 is used as a
// conservative client-side cap to stay clear of that rather than race it.
const SCM_WINDOW_MS = 60_000;
const SCM_MAX_REQUESTS = 15;

// Persisted (not in-memory): a content script reload (page navigation)
// shouldn't forget requests already made against this window. See
// utils/rateLimiter.js for the shared implementation.
const scmRateLimiter = createRateLimiter({
  storageKey: "scmPriceRequestTimestamps",
  windowMs: SCM_WINDOW_MS,
});

// Thrown for an actual 429 from Steam - lets callers tell "Steam says we're
// over the rate limit right now" apart from every other failure.
class ScmRateLimitError extends Error {
  constructor(retryAfterMs) {
    super(`Rate limited by Steam Community Market (retry after ${retryAfterMs}ms)`);
    this.retryAfterMs = retryAfterMs;
  }
}

/*
@description: One unthrottled priceoverview request for a TF2 item, prices
in Steam's numeric currency `currency` (callers go through
retryWithRateLimit). Throws ScmRateLimitError on a 429 so the retry wrapper
can tell it apart from any other failure.
@returns {Promise<object>} the response JSON ({success, lowest_price, median_price, volume}).
*/
async function fetchPriceOverview(marketHashName, currency) {
  const url = new URL(PRICEOVERVIEW_URL);
  url.searchParams.set("appid", String(APPID));
  url.searchParams.set("currency", String(currency));
  url.searchParams.set("market_hash_name", marketHashName);

  let response;
  try {
    response = await fetch(url.toString());
  } catch (e) {
    throw new Error(e.message || "priceoverview request failed");
  }

  if (response.status === 429) {
    throw new ScmRateLimitError(parseRetryAfterMs(response.headers.get("Retry-After")) ?? SCM_WINDOW_MS);
  }

  if (!response.ok) throw new Error(`priceoverview request failed (${response.status})`);

  const data = await response.json();
  if (!data?.success) throw new Error("priceoverview reported failure");
  return data;
}

function scmRetryOptions({ maxRetries }) {
  return {
    maxRequests: SCM_MAX_REQUESTS,
    maxRetries,
    isRateLimitError: (e) => e instanceof ScmRateLimitError,
    describeRetry: (e) =>
      `[TF2 Trading Enhancer] Rate limited by Steam Community Market - waiting ${Math.ceil(e.retryAfterMs / 1000)}s before retrying.`,
  };
}

/*
@description: A TF2 item's cheapest Market listing as Steam's own
priceoverview reports it, the same number behind the inventory panel's
"Starting at". Unlike a listing page, it doesn't depend on the account's
Market sort, but Steam caches it, so it can lag a few minutes behind.
Rate-limited to SCM_MAX_REQUESTS a minute, with one retry after a 429.
@param {number} currency - Steam's numeric wallet currency (g_rgWalletInfo.wallet_currency).
@returns {Promise<?string>} Steam's own formatted price ("0,30€"), or null
when there is none or the lookup failed.
*/
export async function getScmLowestPriceText(marketHashName, currency) {
  try {
    const data = await retryWithRateLimit(
      scmRateLimiter,
      () => fetchPriceOverview(marketHashName, currency),
      scmRetryOptions({ maxRetries: 1 })
    );
    return data.lowest_price || null;
  } catch (e) {
    console.warn("[TF2 Trading Enhancer] Failed to fetch the SCM lowest price:", e);
    return null;
  }
}
