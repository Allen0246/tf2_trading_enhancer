/*
@description: Runs in the real page's own JS realm (see manifest.json's own
"world": "MAIN" entry for this file, matching the same pattern already
established by steamcommunity.com/tradeOffer/*), on steamcommunity.com
inventory pages only (self-gated below, same convention that broad-matched
MAIN-world entry already uses for routing itself to the right page type).

Bridges steamcommunity.com/inventoryMarketActions/content.js's own
isolated-world code to Steam's OWN in-page listing-price calculation - not
reachable from an isolated content script at all, since an isolated script
gets its own separate JS realm that shares the DOM with the real page but
NOT page-defined globals/functions. A CustomEvent round-trip on `document`
is the bridge - events cross that realm boundary even though plain
JS objects/functions don't.

Deliberately relies on Steam's OWN fee-calculation function rather than
reimplementing Valve's fee percentage/rounding rules independently - this
computes a real money amount for an actual market listing, and calling the
exact function Steam's own native "Sell" dialog already uses guarantees
byte-for-byte the same result a manual sale through Steam's own UI would
produce, and stays correct automatically if Valve ever changes the fee
formula (unlike a hand-ported copy of it, which wouldn't).

Both events' own "detail" carries a JSON STRING, not a live object -
confirmed live (Firefox): reading a property directly off an object built by
steamcommunity.com/inventoryMarketActions/content.js's own (isolated-world)
script threw "Permission denied to access property ..." here, since that
object is an Xray-wrapped foreign object to this (page-realm) script's own
security principal, unlike in Chrome where a live object crosses that
boundary without issue. A JSON string is a primitive, copied by value with no
such restriction - see that file's own matching JSON.stringify/parse on its
side of this same bridge.
*/
function initInventoryMarketActionsMainWorld() {
  if (!window.location.pathname.includes("/inventory")) return;

  document.addEventListener("tf2te-resolve-seller-price-request", (event) => {
    const detail = typeof event.detail === "string" ? JSON.parse(event.detail) : event.detail;
    const { requestId, buyerTotalCents } = detail || {};
    if (requestId == null) return;

    let sellerPriceCents = null;
    try {
      if (typeof window.GetItemPriceFromTotal === "function" && window.g_rgWalletInfo) {
        sellerPriceCents = window.GetItemPriceFromTotal(buyerTotalCents, window.g_rgWalletInfo);
      }
    } catch {
      sellerPriceCents = null;
    }

    document.dispatchEvent(
      new CustomEvent("tf2te-resolve-seller-price-response", {
        detail: JSON.stringify({ requestId, sellerPriceCents }),
      })
    );
  });

  // The wallet's numeric currency, for a priceoverview lookup in the same
  // currency the page shows (see ../shared/walletCurrency.js).
  document.addEventListener("tf2te-wallet-currency-request", (event) => {
    const { requestId } = (typeof event.detail === "string" ? JSON.parse(event.detail) : event.detail) || {};
    if (requestId == null) return;
    const currency = window.g_rgWalletInfo?.wallet_currency ?? null;
    document.dispatchEvent(
      new CustomEvent("tf2te-wallet-currency-response", { detail: JSON.stringify({ requestId, currency }) })
    );
  });

  // An asset's class/instance ids, for fetching its English description on a
  // non-English page (see ../shared/englishItemDescription.js, whose
  // readAssetClassIds this mirrors - a classic script can't import it).
  document.addEventListener("tf2te-asset-class-request", (event) => {
    const { requestId, appid, contextid, assetid } = (typeof event.detail === "string" ? JSON.parse(event.detail) : event.detail) || {};
    if (requestId == null) return;
    const description = window.g_rgAppContextData?.[appid]?.rgContexts?.[contextid]?.inventory?.m_rgAssets?.[assetid]?.description;
    const ids = description?.classid ? { classid: String(description.classid), instanceid: String(description.instanceid ?? "0") } : {};
    document.dispatchEvent(
      new CustomEvent("tf2te-asset-class-response", { detail: JSON.stringify({ requestId, ...ids }) })
    );
  });
}
initInventoryMarketActionsMainWorld();

/*
@description: Test-only hook for
tests/inventoryMarketActionsMainWorld.test.js. A globalThis assignment
rather than `export`, because this file is loaded as a classic MAIN-world
content script, where `export` is a SyntaxError. Lets the tests re-run its
setup against fresh fakes without re-importing (see utils/tf2Schema.js's
__resetSchemaCacheForTests for why).
*/
globalThis.__inventoryMarketActionsMainWorldTestHooks = { run: initInventoryMarketActionsMainWorld };
