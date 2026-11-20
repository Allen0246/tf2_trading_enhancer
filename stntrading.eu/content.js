/*
@description: Routes stntrading.eu pages to the right feature script based on
the pathname, and reports which ones are active back to the popup.
*/
async function routeStntrading() {
  const { createScriptRegistry } = await import(chrome.runtime.getURL("utils/scriptRouter.js"));
  const registry = createScriptRegistry();
  registry.listen();

  const url = new URL(window.location.href);

  if (url.pathname.includes("item") && url.pathname.includes("tf2")) {
    const { link2Backpack } = await import(
      chrome.runtime.getURL("stntrading.eu/link2Backpack/content.js")
    );
    link2Backpack();
    registry.label("Links to backpack.tf");
  }

  if (url.pathname.startsWith("/sell")) {
    const { sellSelectButtons } = await import(
      chrome.runtime.getURL("stntrading.eu/sellSelectButtons/content.js")
    );
    sellSelectButtons();
    registry.label("Sell Page Select Buttons");
  }

  registry.settle();
}
routeStntrading();

/*
@description: Test-only hook for tests/stntradingContent.test.js. A
globalThis assignment rather than `export`, because this file is loaded as a
classic content script, where `export` is a SyntaxError. Lets the tests re-
run the router against fresh fakes without re-importing (see
utils/tf2Schema.js's __resetSchemaCacheForTests for why).
*/
globalThis.__stntradingTestHooks = { run: routeStntrading };
