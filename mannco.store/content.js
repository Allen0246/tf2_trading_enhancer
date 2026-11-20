/*
@description: Routes mannco.store pages to the right feature script based on
the pathname, and reports which ones are active back to the popup.
*/
async function routeManncoStore() {
  const { createScriptRegistry } = await import(chrome.runtime.getURL("utils/scriptRouter.js"));
  const registry = createScriptRegistry();
  registry.listen();

  // Loaded on every mannco.store page, not only item pages: the site opens
  // items in-app without a real page load, so this router (which runs once
  // per real load) would miss them until a refresh. The feature checks the
  // current URL itself on every page change (isTf2ItemPage). The popup label
  // still only shows on an item page.
  const { itemQuickLinks, isTf2ItemPage } = await import(chrome.runtime.getURL("mannco.store/itemQuickLinks/content.js"));
  itemQuickLinks();
  if (isTf2ItemPage(window.location.href)) registry.label("Item Quick Links");

  registry.settle();
}
routeManncoStore();

/*
@description: Test-only hook for tests/manncoStoreContent.test.js. A
globalThis assignment rather than `export`, because this file is loaded as a
classic content script, where `export` is a SyntaxError. Lets the tests re-
run the router against fresh fakes without re-importing (see
utils/tf2Schema.js's __resetSchemaCacheForTests for why).
*/
globalThis.__manncoStoreTestHooks = { run: routeManncoStore };
