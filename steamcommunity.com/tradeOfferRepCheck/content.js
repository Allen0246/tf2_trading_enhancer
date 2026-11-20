/*
@description: Bridges steamcommunity.com/tradeOffer/pages/tradeoffer.js's own
MAIN-world trade offer page to rep.tf's ban-aggregator lookup
(utils/repTfInfo.js) - not reachable directly from there, since a MAIN-world
content script has no chrome.runtime (needed to relay the cross-origin fetch
through background.js - see background.js's own header for why that relay
exists at all).
*/
(async () => {
  if (!window.location.pathname.includes("/tradeoffer")) return;

  const { getRepTfBans, getBannedSiteLabels } = await import(
    chrome.runtime.getURL("utils/repTfInfo.js")
  );

  const REQUEST_EVENT = "tf2te-resolve-rep-check-request";
  const RESPONSE_EVENT = "tf2te-resolve-rep-check-response";

  // tradeoffer.js's own resolveRepCheck re-dispatches the same requestId
  // every 500ms until answered (its own timing needs this - see that
  // function's own note), so this side needs to ignore a requestId it's
  // already started handling, or a slow lookup would fire the rep.tf request
  // below multiple times over for the exact same check.
  const handledRequestIds = new Set();

  document.addEventListener(REQUEST_EVENT, async (event) => {
    const detail = typeof event.detail === "string" ? JSON.parse(event.detail) : event.detail;
    const { requestId, steamid64 } = detail || {};
    if (requestId == null || handledRequestIds.has(requestId)) return;
    handledRequestIds.add(requestId);

    const respond = (payload) => {
      document.dispatchEvent(new CustomEvent(RESPONSE_EVENT, { detail: JSON.stringify({ requestId, ...payload }) }));
    };

    try {
      const bans = await getRepTfBans(steamid64);
      // getRepTfBans returns null (never throws) when the lookup failed; that
      // goes back as an error so tradeoffer.js shows no banner rather than a
      // green "No bans found" for a check that didn't happen.
      if (!bans) {
        respond({ error: "rep.tf lookup failed" });
        return;
      }
      respond({ bannedSites: getBannedSiteLabels(bans) });
    } catch (e) {
      console.warn("[TF2 Trading Enhancer] Trade offer rep check failed:", e);
      respond({ error: e.message });
    }
  });
})();
