/*
@description: Routes steamcommunity.com pages to the right feature script(s)
based on the pathname, and reports which ones are active back to the popup.
*/
async function routeSteamcommunity() {
  const { createScriptRegistry } = await import(chrome.runtime.getURL("utils/scriptRouter.js"));
  const registry = createScriptRegistry();
  registry.listen();

  const url = new URL(window.location.href);

  // Exact path-segment match, not a bare .includes("inventory") substring
  // check - a Steam vanity URL like /id/myinventory123/ contains "inventory"
  // as text without actually being an inventory page, same class of
  // fragility this file's own startsWith check below (for /profiles//id/)
  // already avoids.
  if (url.pathname.split("/").filter(Boolean).includes("inventory")) {
    const { showItemQuickLinks } = await import(
      chrome.runtime.getURL("steamcommunity.com/itemQuickLinks/content.js")
    );
    showItemQuickLinks();
    registry.label("Item Links");

    // Steam re-renders the inventory's item-detail panel via AJAX (no full
    // page load) as the user clicks through items, so re-run on every DOM
    // change instead of just once at load. Observes document.body, NOT a
    // captured #iteminfo0/#iteminfo1 reference - confirmed live, Steam
    // alternates which of the two it renders into as the user clicks through
    // items (see itemQuickLinks/content.js's own pickContainer), so watching
    // only one of them misses every render into the other.
    new MutationObserver(() => showItemQuickLinks()).observe(document.body, { childList: true, subtree: true });

    const { showInventoryMarketActions } = await import(
      chrome.runtime.getURL("steamcommunity.com/inventoryMarketActions/content.js")
    );
    showInventoryMarketActions();
    registry.label("Inventory Market Actions");

    // Same reasoning as showItemQuickLinks' own observer just above -
    // Steam alternates which of #iteminfo0/#iteminfo1 it renders into, and
    // its own later re-renders can wipe an already-inserted block.
    new MutationObserver(() => showInventoryMarketActions()).observe(document.body, { childList: true, subtree: true });

    const { showFabricatorMultiBuy } = await import(
      chrome.runtime.getURL("steamcommunity.com/fabricatorMultiBuy/content.js")
    );
    showFabricatorMultiBuy();
    registry.label("Fabricator Multi-Buy");

    // Same reasoning as showItemQuickLinks' own observer above.
    new MutationObserver(() => showFabricatorMultiBuy()).observe(document.body, { childList: true, subtree: true });
  }

  // Free, for every user - relays the popup's auto-add toggle and the
  // craft-weapon list to tradeoffer.js (see that module's own header).
  // Infrastructure rather than a feature of its own, so it isn't labeled.
  if (url.pathname.includes("/tradeoffer/new")) {
    const { tradeOfferSettingsBridge } = await import(
      chrome.runtime.getURL("steamcommunity.com/tradeOfferSettingsBridge/content.js")
    );
    tradeOfferSettingsBridge();
  }

  // Steam's Market opens items in-app, without a page load; this reloads
  // into a TF2 listing reached that way so the features below start on it
  // (see marketNavigation/content.js). Infrastructure, so it isn't labeled.
  if (url.pathname.startsWith("/market/")) {
    const { watchMarketNavigation } = await import(
      chrome.runtime.getURL("steamcommunity.com/marketNavigation/content.js")
    );
    watchMarketNavigation();
  }

  // TF2's own listing pages only (/market/listings/440/...): every feature
  // here is TF2-specific (backpack.tf stats/classifieds, TF2 site links), so
  // another game's listing page gets none of them.
  if (url.pathname.includes("/market/listings/440/")) {
    const { marketListingLinks } = await import(
      chrome.runtime.getURL("steamcommunity.com/marketListingLinks/content.js")
    );
    marketListingLinks();
    registry.label("Market Listing Links");

    const { marketListingDetailModal } = await import(
      chrome.runtime.getURL("steamcommunity.com/marketListingModal/content.js")
    );
    marketListingDetailModal();
    registry.label("Market Listing Detail Modal");
  }

  if (url.pathname.includes("/market/multibuy")) {
    const { showMultiBuyVerifyReminder } = await import(
      chrome.runtime.getURL("steamcommunity.com/fabricatorMultiBuy/content.js")
    );
    showMultiBuyVerifyReminder();
    registry.label("Fabricator Multi-Buy Verify Reminder");
  }

  if (url.pathname.includes("/tradehistory")) {
    const { tradeHistoryDuplicates } = await import(
      chrome.runtime.getURL("steamcommunity.com/tradeHistoryDuplicates/content.js")
    );
    tradeHistoryDuplicates();
    registry.label("Trade History Duplicates");
  }

  // startsWith, not a bare .includes("profile")/.includes("id") substring
  // check - a plain substring match would also fire (harmlessly today, but
  // fragile) on any future match pattern whose pathname happens to contain
  // "id" anywhere at all, not just the actual /profiles/ or /id/ segment
  // these two link features are meant for.
  if (url.pathname.startsWith("/profiles/") || url.pathname.startsWith("/id/")) {
    const { steamLinks, isExcludedProfileSubpath } = await import(
      chrome.runtime.getURL("steamcommunity.com/steamLinks/content.js")
    );

    if (!isExcludedProfileSubpath(url.pathname)) {
      steamLinks();
      registry.label("Steam Links");
    }
  }

  registry.settle();
}
routeSteamcommunity();

/*
@description: Test-only hook for tests/steamcommunityContent.test.js. A
globalThis assignment rather than `export`, because this file is loaded as a
classic content script, where `export` is a SyntaxError. Lets the tests re-
run the router against fresh fakes without re-importing (see
utils/tf2Schema.js's __resetSchemaCacheForTests for why).
*/
globalThis.__steamcommunityTestHooks = { run: routeSteamcommunity };
