/*
@description: Looks up a TF2 item's pricedb.io SKU by its full display name
via pricedb.io's /api/search (no authentication; GET
/api/search?q=<name>&limit=50[&cursor=...]). The real response wraps the
documented shape in an extra envelope:
{ success: true, data: { results: [{ name, sku, ... }], hasMore, nextCursor } }.

The search is a substring match sorted ALPHABETICALLY, not by relevance
(confirmed live: "Brotherhood of Arms" returns "Aces High Brotherhood of
Arms", 30066;5;u59, first and the plain Unique 30066;6 fourth). So the result
has to be picked by exact name, paging through a few result pages when the
item has many Unusual variants sorting before it (e.g. "Team Captain" is on
page 2).
Searching by name avoids building a SKU ourselves
(defindex;quality;u{effect};w{wear};pk{paintkit};kt-{tier};australium;festive),
which is not derivable from next.backpack.tf's DOM for Decorated Weapons.
*/

const SEARCH_URL = "https://pricedb.io/api/search";
// pricedb.io's own maximum page size (a larger limit is a 400).
const SEARCH_PAGE_SIZE = 50;
// Bounds the extra requests per lookup (pricedb.io rate-limits per IP). Every
// item checked live was on page 1 or 2.
const MAX_SEARCH_PAGES = 3;

function normalizeName(name) {
  return String(name ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

/*
@description: Fetches one search results page through the background
FETCH_JSON relay, returning pricedb's inner `data` object. Throws on a failed
request, carrying status/retryAfterMs so the caller can spot a rate limit.
*/
async function fetchSearchPage(itemName, cursor) {
  const url = new URL(SEARCH_URL);
  url.searchParams.set("q", itemName);
  url.searchParams.set("limit", String(SEARCH_PAGE_SIZE));
  if (cursor) url.searchParams.set("cursor", cursor);

  const response = await chrome.runtime.sendMessage({ type: "FETCH_JSON", url: url.toString() });
  if (!response?.ok) {
    const error = new Error(response?.error || "pricedb.io search failed");
    error.status = response?.status ?? null;
    error.retryAfterMs = response?.retryAfterMs ?? null;
    throw error;
  }

  // response.data is pricedb's whole { success, data } envelope.
  return response.data?.data ?? {};
}

/*
@description: The sku of the result whose name is exactly itemName (case and
whitespace aside), paging up to MAX_SEARCH_PAGES. Without an exact match,
only a lone, unambiguous result is trusted; otherwise null, since any other
pick (e.g. simply the first result) can be a different item entirely.
*/
async function findExactSku(itemName) {
  const wanted = normalizeName(itemName);
  let cursor = null;
  let loneResult = null;

  for (let page = 0; page < MAX_SEARCH_PAGES; page++) {
    const data = await fetchSearchPage(itemName, cursor);
    const results = data.results || [];

    const exact = results.find((result) => normalizeName(result.name) === wanted);
    if (exact?.sku) return exact.sku;

    if (page === 0 && results.length === 1 && !data.hasMore) loneResult = results[0];
    if (!data.hasMore || !data.nextCursor) break;
    cursor = data.nextCursor;
  }

  return loneResult?.sku ?? null;
}

// In-memory cache keyed by item name, for the page's lifetime. The
// steamcommunity.com inventory page re-runs this search on every item
// selection, and a name's pricedb.io SKU does not change moment to moment.
const skuPromiseByItemName = {};

/*
@description: Test-only: clears the in-memory cache between test cases.
*/
export function __resetPricedbCacheForTests() {
  for (const key of Object.keys(skuPromiseByItemName)) delete skuPromiseByItemName[key];
}

/*
@description: Looks up the sku of the result matching the given item display
name (see findExactSku), telling a genuine "no listing" (sku null) apart from
pricedb.io's per-IP rate limit (a real 429), so callers can show a "rate
limited" placeholder instead of a silently missing button. Never throws.
Goes through the background FETCH_JSON relay (see background.js for why);
concurrent and repeat lookups of one name share a cached promise.
@returns {Promise<{sku: ?string, rateLimited: boolean, retryAfterMs: ?number}>}
*/
export async function searchPricedbSkuStatus(itemName) {
  if (!itemName) return { sku: null, rateLimited: false, retryAfterMs: null };

  // Concurrent callers share one in-flight promise, each awaiting it inside
  // its own try/catch below. See #141.
  if (!skuPromiseByItemName[itemName]) {
    skuPromiseByItemName[itemName] = (async () => ({
      sku: await findExactSku(itemName),
      rateLimited: false,
      retryAfterMs: null,
    }))();
  }

  try {
    return await skuPromiseByItemName[itemName];
  } catch (error) {
    // Do not memoize a transient failure as "no sku".
    delete skuPromiseByItemName[itemName];
    return { sku: null, rateLimited: error?.status === 429, retryAfterMs: error?.retryAfterMs ?? null };
  }
}
