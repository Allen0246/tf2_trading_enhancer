/*
@description: marketplace.tf key-price helper - fetches the live Mann Co.
Supply Crate Key price via marketplace.tf's own internal (undocumented)
GetDayStats ajax endpoint, the same one their own item-page price-history
table uses. Lives in utils/ alongside utils/scmPricing.js for the same
reason that one does (web_accessible_resources' utils/** entry is already
open to every site this extension touches) - currently only called from
marketplace.tf/keyPriceDisplay/content.js.

Fetched with a plain fetch() - NOT routed through background.js's relay -
same reasoning utils/scmPricing.js's own header note documents: this
module's only caller runs on marketplace.tf itself, fetching marketplace.tf -
same-origin, so neither Firefox's cross-origin read-blocking nor a page's own
CSP applies, and the relay would just be a pointless extra hop.

Confirmed live (reverse-engineered, then verified directly against the real
endpoint):
  - POST https://marketplace.tf/ajax/items/GetDayStats
  - Body: sku=<urlencoded sku>&timestamp=<"Month Day, Year", en-US
    toLocaleDateString - confirmed live NOT a raw epoch number, an empty
    result came back with one>&csrf=<token>
  - Response: {"success":true,"timestamp":..., "html":"<table>...</table>"}
    - html is a price/volume table for that day's completed sales, one row
      per distinct price point. The "key price" used here is the row with
      the HIGHEST volume (confirmed live: $1.84/383, $1.86/4, $1.88/1723 ->
      $1.88 picked) - "whatever price most keys actually sold at today", not
      the current lowest listed price.

CSRF token: confirmed live it's set via an inline <script> tag already
present in the page's own raw HTML (MPTF.csrfCode = "..."), not injected
later by other JS - so a content script's isolated world can read it
straight off that script tag's own textContent via a plain regex, with NO
MAIN-world bridge needed (an isolated-world script can't see the resulting
window.MPTF object, but CAN read any script tag's raw source text - it just
never executes it). Returns null (caller skips the whole feature) if not
found - e.g. logged out, where marketplace.tf likely never sets a real
csrfCode at all.

Prices are internally USD-denominated regardless of the account's own
display currency (confirmed live: GetDayStats returned "$" prices even
independent of account currency setting - matches marketplace.tf's own
account page wording, "All items are priced internally in USD"), so this
module never needs to know or convert currencies - see
marketplace.tf/keyPriceDisplay/content.js's own header note on how an
item's displayed (possibly non-USD) price gets resolved back to USD before
ever being compared against this key price.
*/

import { BackoffCooldownError, createFailureBackoff } from "./failureBackoff.js";

const KEY_SKU = "5021;6"; // Mann Co. Supply Crate Key, Unique quality
const GET_DAY_STATS_URL = "https://marketplace.tf/ajax/items/GetDayStats";
const CSRF_CODE_PATTERN = /MPTF\.csrfCode\s*=\s*"([^"]+)"/;
const TABLE_ROW_PATTERN = /<td>\$([\d,]+\.\d{2})<\/td>\s*<td>(\d+)<\/td>/g;

// See utils/failureBackoff.js's own header note - this checks hourly
// forever with no protection otherwise, so 3 consecutive failures backs it
// off to checking only once a day instead.
const marketplaceFailureBackoff = createFailureBackoff({
  storageKey: "mptfFailureBackoff",
  maxConsecutiveFailures: 3,
  cooldownMs: 24 * 60 * 60 * 1000,
});

/*
@description: Finds the CSRF token from whichever inline <script> tag sets
MPTF.csrfCode - see this file's own header note on why a plain regex over
the script's own raw text works here without a MAIN-world bridge.
*/
function findCsrfCode(doc) {
  const scripts = Array.from(doc.querySelectorAll("script"));
  for (const script of scripts) {
    const match = script.textContent?.match(CSRF_CODE_PATTERN);
    if (match) return match[1];
  }
  return null;
}

// "Month Day, Year" (e.g. "September 3, 2026") - confirmed live exact format
// GetDayStats expects for its own `timestamp` param (see this file's own
// header note - a raw epoch number returns an empty table instead).
function buildDateInText() {
  return new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

/*
@description: Picks the highest-volume price row out of GetDayStats' own
returned price/volume table - see this file's own header note on why
that's the chosen definition of "the key price" here. A plain regex over
the raw HTML string (not DOMParser) - deliberately, so this stays testable
in a plain Node test environment (no DOMParser there) without a polyfill,
and the response shape is simple/stable enough not to need real HTML
parsing anyway.
@returns: the price (a number, in USD), or null if no rows matched at all.
*/
export function parseHighestVolumePriceUsd(html) {
  let best = null;
  let match;
  TABLE_ROW_PATTERN.lastIndex = 0; // reused module-level /g regex - reset before use
  while ((match = TABLE_ROW_PATTERN.exec(html))) {
    const price = Number(match[1].replace(/,/g, ""));
    const volume = Number(match[2]);
    if (!Number.isFinite(price) || !Number.isFinite(volume)) continue;
    if (!best || volume > best.volume) best = { price, volume };
  }
  return best?.price ?? null;
}

/*
@description: POSTs marketplace.tf's own GetDayStats endpoint for the key SKU,
using the CSRF token from the logged-in page, and picks the day's
highest-volume price row. Throws on a failed request or no parseable rows, so
the caller's failure backoff counts it.
@returns {Promise<number>} the key price in USD.
*/
async function fetchLiveKeyPriceUsd(csrf) {
  const body = `sku=${encodeURIComponent(KEY_SKU)}&timestamp=${encodeURIComponent(buildDateInText())}&csrf=${encodeURIComponent(csrf)}`;

  const response = await fetch(GET_DAY_STATS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) throw new Error(`GetDayStats request failed (${response.status})`);

  const data = await response.json();
  if (!data?.success) throw new Error("GetDayStats reported failure");

  const price = parseHighestVolumePriceUsd(data.html || "");
  if (price === null) throw new Error("GetDayStats returned no parseable price rows");

  return price;
}

// Re-checked hourly - a key's price can move faster intraday than
// utils/scmPricing.js's own 24h SCM cache assumes is safe for that (much
// lower-volume) market.
export const MARKETPLACE_KEY_PRICE_CACHE_TTL_MS = 60 * 60 * 1000;
const MARKETPLACE_KEY_PRICE_STORAGE_KEY = "mptfLiveKeyPriceUsd";

// The refresh currently in flight, shared by concurrent callers.
// marketplace.tf/keyPriceDisplay/content.js calls this on every DOM mutation,
// so without sharing, a stale cache fired one GetDayStats POST per mutation
// until the first response landed.
let inFlightRefresh = null;

/*
@description: Gets the current live marketplace.tf key price in USD, from
the 1h persisted cache when fresh, or by fetching when stale/missing/
forceRefresh is set. On any failure (not logged in, network error, no
parseable rows) falls back to whatever's cached, even if stale, rather than
nothing at all.
@parameter doc -> the document to read the CSRF token from (defaults to the
real page document; a test-only seam - see this module's own test file).
@returns: USD price of 1 key, or null (no cache and the fetch failed).
*/
export async function getMarketplaceLiveKeyPriceUsd({ forceRefresh = false, doc = document } = {}) {
  const stored = await chrome.storage.local.get([MARKETPLACE_KEY_PRICE_STORAGE_KEY]);
  const cached = stored[MARKETPLACE_KEY_PRICE_STORAGE_KEY];

  if (!forceRefresh && cached && Date.now() - cached.fetchedAt < MARKETPLACE_KEY_PRICE_CACHE_TTL_MS) {
    return cached.value;
  }

  // Looked up before (not inside) the failure backoff: with no token no
  // request is made, so there is nothing to back off from. Counting it would
  // put the next 24 hours in cooldown after a few page updates while logged
  // out, even once the user logs in.
  const csrf = findCsrfCode(doc);
  if (!csrf) return cached?.value ?? null;

  // Concurrent callers share one in-flight refresh - see inFlightRefresh.
  if (!inFlightRefresh) {
    inFlightRefresh = (async () => {
      try {
        const value = await marketplaceFailureBackoff.attempt(() => fetchLiveKeyPriceUsd(csrf));
        await chrome.storage.local.set({ [MARKETPLACE_KEY_PRICE_STORAGE_KEY]: { value, fetchedAt: Date.now() } });
        return value;
      } finally {
        inFlightRefresh = null;
      }
    })();
  }

  try {
    return await inFlightRefresh;
  } catch (e) {
    // A call skipped by the cooldown is expected, and this runs on every
    // page update: only a real failed request is worth a warning.
    if (!(e instanceof BackoffCooldownError)) {
      console.warn("[TF2 Trading Enhancer] Failed to fetch live marketplace.tf key price:", e);
    }
    return cached?.value ?? null;
  }
}
