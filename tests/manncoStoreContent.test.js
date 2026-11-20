import { test } from "node:test";
import assert from "node:assert/strict";

// mannco.store/content.js is the same router shape as
// stntrading.eu/content.js (see tests/stntradingContent.test.js's own header
// comment for the shared pattern/rationale) - an async function
// (routeManncoStore) exposed via globalThis.__manncoStoreTestHooks.run for
// tests to call repeatedly, since it can't gain an `export` (loaded as a
// classic content script, not a module - see manifest.json). Imported ONCE
// below, not via a fresh cache-busting dynamic import per test, for the same
// --experimental-test-coverage reason tests/stntradingContent.test.js's own
// header note documents.
function fakeGetURL(path) {
  return new URL(`../${path}`, import.meta.url).href;
}

async function waitUntil(conditionFn, { timeoutMs = 2000, intervalMs = 5 } = {}) {
  const start = Date.now();
  while (!conditionFn()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitUntil: condition never became true");
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

// itemQuickLinks() (dynamically imported and called for real when the route
// matches) bails out immediately once its own document.querySelector(".item-details")
// finds nothing - kept deliberately empty since this file only cares about
// the ROUTER's dispatch decision, not itemQuickLinks' own full behavior
// (covered separately, in depth).
function installSafeGlobals() {
  global.document = {
    body: { nodeType: 1 },
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    createElement: () => ({ style: {}, classList: { add() {}, contains: () => false }, appendChild() {}, append() {} }),
  };
  observedTargets = [];
  global.MutationObserver = class {
    observe(target) {
      observedTargets.push(target);
    }
  };
}

// What itemQuickLinks' MutationObserver was attached to on the last router
// run - proves the feature was started.
let observedTargets = [];

installSafeGlobals();
const primingListeners = [];
global.chrome = {
  runtime: { getURL: fakeGetURL, onMessage: { addListener: (cb) => primingListeners.push(cb) } },
};
global.window = { location: { href: "https://mannco.store/" } };
await import("../mannco.store/content.js");
await waitUntil(() => primingListeners.length > 0);

async function runRouterFor(href) {
  installSafeGlobals();
  const messageListeners = [];
  global.chrome = {
    runtime: { getURL: fakeGetURL, onMessage: { addListener: (cb) => messageListeners.push(cb) } },
  };
  global.window = { location: { href } };

  await globalThis.__manncoStoreTestHooks.run();
  await waitUntil(() => messageListeners.length > 0);

  let info;
  messageListeners[0]({ type: "GET_LOADED_SCRIPTS" }, {}, (response) => (info = response));
  await waitUntil(() => info && info.settled);
  return info;
}

test("a mannco.store TF2 item detail page loads the 'Item Quick Links' feature", async () => {
  const info = await runRouterFor("https://mannco.store/item/440-maxs-severed-head");
  assert.deepEqual(info.scripts, ["Item Quick Links"]);
  assert.equal(info.settled, true);
});

test("an item detail page for a different game (not appid 440) does not load the feature", async () => {
  const info = await runRouterFor("https://mannco.store/item/730-some-csgo-skin");
  assert.deepEqual(info.scripts, []);
  assert.equal(info.settled, true);
});

test("a mannco.store page that isn't an item detail page has no 'Item Quick Links' label", async () => {
  const info = await runRouterFor("https://mannco.store/tf2?search=Rocket+Launcher");
  assert.deepEqual(info.scripts, []);
  assert.equal(info.settled, true);
});

// Seen live: opening an item in-app from a search page showed no row until a
// refresh, because the router (once per real page load) only started the
// feature when the FIRST page was already an item page.
test("REGRESSION: a non-item mannco.store page still starts the feature, so a later in-app navigation to an item gets its row", async () => {
  await runRouterFor("https://mannco.store/tf2?search=Rocket+Launcher");
  assert.equal(observedTargets.length, 1);
  assert.equal(observedTargets[0], document.body);
});
