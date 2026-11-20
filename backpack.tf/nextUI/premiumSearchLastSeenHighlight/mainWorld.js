/*
@description: Runs in next.backpack.tf's own real page JS realm (see
manifest.json's own "world": "MAIN" entry for this file, same pattern
steamcommunity.com/inventoryMarketActions/mainWorld.js already established).

Bridges ./content.js's own isolated-world code to data that ONLY exists in
the page's own Almanac search API response, never in the rendered table at
all: confirmed live (real page HTML) that table's own "Last Seen" column
only ever shows the CURRENT owner's own last-seen date - there is no
previous-owner date rendered anywhere on the page to scrape the way classic
UI's own ../../oldUI/premiumSearchLastSeenHighlight/content.js can. So this
intercepts the page's own fetch/XHR calls to its search endpoint and reads
the ownership-history array straight out of the JSON response instead.

Patches BOTH window.fetch and XMLHttpRequest, not just one - not confirmed
live which one next.backpack.tf's own app bundle actually uses for this
particular call. Purely READ-ONLY either way: response.clone().json() (the
fetch path) and a "load" listener reading this.responseText (the XHR path)
never touch the real response object/promise handed back to the page's own
code, which is always the unmodified original - a parse failure here (a
future API shape change, a malformed response) can only ever cost this
feature its own extra data, never break the page itself.

Registered at document_start (see manifest.json) specifically so this runs
BEFORE next.backpack.tf's own app bundle takes its own reference to
window.fetch (a reference taken earlier would bypass the patch). A narrow, accepted gap this creates: if the
page's VERY FIRST search response arrives before ./content.js's own
isolated-world listener has registered (document_idle, so normally already
in place well before a user could type and submit a search), that one
response's data is missed - not worth engineering around for how unlikely it
is in practice, and a second search recovers it anyway.
*/
function initPremiumSearchLastSeenHighlightMainWorld() {
  if (!window.location.hostname.includes("next.backpack.tf")) return;

  const SEARCH_URL_FRAGMENT = "/cors/_item/search";
  const BROADCAST_EVENT = "tf2te-premium-search-sale-timestamps";

  /*
  @description: Reduces the search response's own results into a plain
  {currentId: previousOwnerTimestamp} map and broadcasts it - accumulated
  entries are never cleared between broadcasts (a stale mapping for an id no
  longer on screen is simply never looked up again by ./content.js), so a
  later, smaller search result set can't wipe out data an
  earlier, larger one already supplied.
  @param {Array} results - result.history.entries[], each {id, steamid,
  timestamp}, assumed sorted NEWEST-FIRST (not independently confirmed
  live).
  */
  function broadcastSaleTimestamps(results) {
    if (!Array.isArray(results) || results.length === 0) return;

    const timestampsByCurrentId = {};
    for (const result of results) {
      const entries = result?.history?.entries;
      if (!entries || entries.length === 0) continue;

      const current = entries[0];
      const currentId = String(current.id);
      const currentSteamId = current.steamid;

      // Consecutive entries with the SAME steamid are just repeat
      // inventory scans of the current owner, not separate sales - the
      // actual "last sale" boundary is the first entry (walking backwards
      // from the current one) whose steamid differs.
      const previousEntry = entries.slice(1).find((entry) => entry.steamid !== currentSteamId);
      if (!previousEntry) continue; // no known previous owner for this item

      timestampsByCurrentId[currentId] = previousEntry.timestamp;
    }

    if (Object.keys(timestampsByCurrentId).length === 0) return;

    document.dispatchEvent(new CustomEvent(BROADCAST_EVENT, { detail: JSON.stringify(timestampsByCurrentId) }));
  }

  const originalFetch = window.fetch;
  window.fetch = function (...args) {
    return originalFetch.apply(this, args).then((response) => {
      const request = args[0];
      // String(...) also covers a URL object, not just a plain string.
      const url = request instanceof Request ? request.url : String(request);

      if (url.includes(SEARCH_URL_FRAGMENT)) {
        response
          .clone()
          .json()
          .then((data) => broadcastSaleTimestamps(data?.results))
          .catch(() => {});
      }

      return response;
    });
  };

  const OriginalXHR = window.XMLHttpRequest;
  const originalOpen = OriginalXHR.prototype.open;
  const originalSend = OriginalXHR.prototype.send;

  OriginalXHR.prototype.open = function (method, url, ...rest) {
    this._tf2teRequestUrl = String(url);
    return originalOpen.call(this, method, url, ...rest);
  };

  OriginalXHR.prototype.send = function (...args) {
    if (typeof this._tf2teRequestUrl === "string" && this._tf2teRequestUrl.includes(SEARCH_URL_FRAGMENT)) {
      this.addEventListener("load", function () {
        try {
          const data = JSON.parse(this.responseText);
          broadcastSaleTimestamps(data?.results);
        } catch {
          // Malformed/unexpected response shape - ignored, same as the
          // fetch path's own .catch(() => {}) above.
        }
      });
    }

    return originalSend.apply(this, args);
  };
}
initPremiumSearchLastSeenHighlightMainWorld();

/*
@description: Test-only hook, same convention
steamcommunity.com/inventoryMarketActions/mainWorld.js's own header note
already documents in full (classic MAIN-world script, no `export` allowed -
see manifest.json's own entry for this file).
*/
globalThis.__premiumSearchLastSeenHighlightMainWorldTestHooks = { run: initPremiumSearchLastSeenHighlightMainWorld };
