/*
@description: Routes posts.tf pages to the right feature script, and reports
which ones are active back to the popup. Not pathname-scoped at all - the
item-detail modal itemQuickLinks hooks into can be opened from any post, on
any page of the site (the main board, an individual post, etc.), so this
just always runs it.
*/
async function routePostsTf() {
  const { createScriptRegistry } = await import(chrome.runtime.getURL("utils/scriptRouter.js"));
  const registry = createScriptRegistry();
  registry.listen();

  const { itemQuickLinks } = await import(chrome.runtime.getURL("posts.tf/itemQuickLinks/content.js"));
  itemQuickLinks();
  registry.label("Item Quick Links");

  registry.settle();
}
routePostsTf();

/*
@description: Test-only hook for tests/postsTfContent.test.js. A globalThis
assignment rather than `export`, because this file is loaded as a classic
content script, where `export` is a SyntaxError. Lets the tests re-run the
router against fresh fakes without re-importing (see utils/tf2Schema.js's
__resetSchemaCacheForTests for why).
*/
globalThis.__postsTfTestHooks = { run: routePostsTf };
