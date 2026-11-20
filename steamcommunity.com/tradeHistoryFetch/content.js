/*
@description: Routes Steam's Inventory History page (/my/inventoryhistory/) to
the duplicate-badge feature (see ./duplicateBadges.js) - collapses repeated
identical items within one row into a single icon with an "×N" badge, purely
cosmetic, no network requests of its own. The Trade History page gets its own
duplicate collapsing from steamcommunity.com/content.js
(tradeHistoryDuplicates) instead.
*/
async function routeTradeHistoryFetch() {
  const { createScriptRegistry } = await import(chrome.runtime.getURL("utils/scriptRouter.js"));
  const registry = createScriptRegistry();
  registry.listen();

  // Own try/catch - a purely visual nicety (see duplicateBadges.js's own
  // header note), so a failure here should never take the rest of the page
  // down with it.
  if (!(window.location.pathname || "").includes("/tradehistory")) {
    try {
      const { showDuplicateBadges } = await import(chrome.runtime.getURL("steamcommunity.com/tradeHistoryFetch/duplicateBadges.js"));
      showDuplicateBadges();
      registry.label("Trade History Duplicate Badges");
    } catch (e) {
      console.error("[TF2 Trading Enhancer] Trade history duplicate badges failed to load:", e);
    }
  }

  registry.settle();
}

// content.js can't gain an `export` (it's loaded as a classic content
// script, not a module - see manifest.json), so it exposes this purely for
// tests to call directly, same pattern popup/popup.js's own
// __popupTestHooks and background.js's own __backgroundTestHooks already
// establish.
const routerPromise = routeTradeHistoryFetch();
globalThis.__tradeHistoryFetchTestHooks = { routerPromise };
