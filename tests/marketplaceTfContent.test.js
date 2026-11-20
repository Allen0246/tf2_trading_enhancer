import { test } from "node:test";
import assert from "node:assert/strict";

// marketplace.tf/content.js is the same router shape as
// stntrading.eu/content.js (see tests/stntradingContent.test.js's own header
// comment for the shared pattern/rationale) - an async function
// (routeMarketplaceTf) exposed via globalThis.__marketplaceTfTestHooks.run
// for tests to call repeatedly, since it can't gain an `export` (loaded as a
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

// keyPriceDisplay() (dynamically imported and called for real when the
// router runs) calls getMarketplaceLiveKeyPriceUsd(), which needs a working
// chrome.storage.local and a document.querySelectorAll("script") that
// doesn't throw - kept deliberately empty (no cached price, no CSRF script
// found) so it resolves to null and keyPriceDisplay's own scan just no-ops,
// since this file only cares about the ROUTER's dispatch decision, not
// keyPriceDisplay's own full behavior (covered separately).
function installSafeGlobals() {
  global.document = {
    body: { nodeType: 1 },
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    createElement: () => ({ style: {}, classList: { add() {}, contains: () => false }, appendChild() {}, append() {} }),
  };
  global.MutationObserver = class {
    observe() {}
  };
  global.chrome = {
    ...global.chrome,
    storage: { local: { get: async () => ({}), set: async () => {} } },
  };
}

installSafeGlobals();
const primingListeners = [];
global.chrome = {
  runtime: { getURL: fakeGetURL, onMessage: { addListener: (cb) => primingListeners.push(cb) } },
  storage: { local: { get: async () => ({}), set: async () => {} } },
};
global.window = { location: { href: "https://marketplace.tf/" } };
await import("../marketplace.tf/content.js");
await waitUntil(() => primingListeners.length > 0);

async function runRouterFor(href) {
  installSafeGlobals();
  const messageListeners = [];
  global.chrome = {
    runtime: { getURL: fakeGetURL, onMessage: { addListener: (cb) => messageListeners.push(cb) } },
    storage: { local: { get: async () => ({}), set: async () => {} } },
  };
  global.window = { location: { href } };

  await globalThis.__marketplaceTfTestHooks.run();
  await waitUntil(() => messageListeners.length > 0);

  let info;
  messageListeners[0]({ type: "GET_LOADED_SCRIPTS" }, {}, (response) => (info = response));
  await waitUntil(() => info && info.settled);
  return info;
}

test("marketplace.tf loads the Key Price Display AND Item Quick Links features on an item detail page", async () => {
  const info = await runRouterFor("https://marketplace.tf/items/tf2/5021;6");
  assert.deepEqual(info.scripts, ["Key Price Display", "Item Quick Links"]);
  assert.equal(info.settled, true);
});

test("marketplace.tf loads only the Key Price Display feature on an unrelated (non-item-detail) page", async () => {
  const info = await runRouterFor("https://marketplace.tf/");
  assert.deepEqual(info.scripts, ["Key Price Display"]);
  assert.equal(info.settled, true);
});
