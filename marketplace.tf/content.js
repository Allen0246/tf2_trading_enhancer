/*
@description: Routes marketplace.tf pages to the right feature script, and
reports which ones are active back to the popup.
*/
async function routeMarketplaceTf() {
  const { createScriptRegistry } = await import(chrome.runtime.getURL("utils/scriptRouter.js"));
  const registry = createScriptRegistry();
  registry.listen();

  // Site-wide (not page-restricted) - self-scopes off finding its own
  // .item-box-price/.current-bid-amount price elements, so a no-op on any
  // page without either.
  const { keyPriceDisplay } = await import(chrome.runtime.getURL("marketplace.tf/keyPriceDisplay/content.js"));
  keyPriceDisplay();
  registry.label("Key Price Display");

  const url = new URL(window.location.href);
  if (url.pathname.startsWith("/items/tf2/")) {
    const { itemQuickLinks } = await import(chrome.runtime.getURL("marketplace.tf/itemQuickLinks/content.js"));
    itemQuickLinks();
    registry.label("Item Quick Links");
  }

  registry.settle();
}
routeMarketplaceTf();

/*
@description: Test-only hook for tests/marketplaceTfContent.test.js. A
globalThis assignment rather than `export`, because this file is loaded as a
classic content script, where `export` is a SyntaxError. Lets the tests re-
run the router against fresh fakes without re-importing (see
utils/tf2Schema.js's __resetSchemaCacheForTests for why).
*/
globalThis.__marketplaceTfTestHooks = { run: routeMarketplaceTf };
