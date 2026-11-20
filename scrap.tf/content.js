/*
@description: Routes scrap.tf pages to the right feature script(s) based on
the hostname/pathname, and reports which ones are active back to the popup.
*/
async function routeScrapTf() {
  const { createScriptRegistry } = await import(chrome.runtime.getURL("utils/scriptRouter.js"));
  const registry = createScriptRegistry();
  registry.listen();

  const url = new URL(window.location.href);

  // Don't load scripts for the merch subdomain.
  if (url.hostname.includes("merch")) {
    registry.settle();
    return;
  }

  // Exact-path match: a substring check would also catch /buy/items, an
  // ordinary category page with hoverable tiles. scrap.tf links to both
  // /items and /items/.
  const isItemBankingTablePage = url.pathname === "/items" || url.pathname === "/items/";

  if (isItemBankingTablePage) {
    const { scrapItemsTableLinks } = await import(
      chrome.runtime.getURL("scrap.tf/scrapItemsTableLinks/content.js")
    );
    scrapItemsTableLinks();
    registry.label("Items Table Links");
  }

  if (url.pathname.includes("/auctions/")) {
    const { auctionBidHelper } = await import(
      chrome.runtime.getURL("scrap.tf/auctionBidHelper/content.js")
    );
    auctionBidHelper();
    registry.label("Auction Bid Helper");
  }

  if (url.pathname.includes("/sell/")) {
    const { sellDuplicates } = await import(
      chrome.runtime.getURL("scrap.tf/sellDuplicates/content.js")
    );
    sellDuplicates();
    registry.label("Sell Duplicates Selector");
  }

  // Every page except the item banking table, whose rows are plain <td>
  // text with no hoverable item element (scrapItemsTableLinks adds links
  // there instead).
  if (!isItemBankingTablePage) {
    const { itemLinks } = await import(chrome.runtime.getURL("scrap.tf/itemLinks/content.js"));
    itemLinks();
    registry.label("Hover Item Links");
  }

  registry.settle();
}
routeScrapTf();

/*
@description: Test-only hook for tests/scrapTfContent.test.js. A globalThis
assignment rather than `export`, because this file is loaded as a classic
content script, where `export` is a SyntaxError. Lets the tests re-run the
router against fresh fakes without re-importing (see utils/tf2Schema.js's
__resetSchemaCacheForTests for why).
*/
globalThis.__scrapTfTestHooks = { run: routeScrapTf };
