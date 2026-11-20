import { test } from "node:test";
import assert from "node:assert/strict";

// stntrading.eu/content.js is the same router shape as backpack.tf/content.js
// (see tests/backpackTfContent.test.js's own header comment for the shared
// pattern/rationale) - an async function (routeStntrading) exposed via
// globalThis.__stntradingTestHooks.run for tests to call repeatedly, since
// it can't gain an `export` (loaded as a classic content script, not a
// module - see manifest.json). This module is therefore imported ONCE
// below, not via a fresh cache-busting dynamic import per test - the
// fresh-import approach was used here previously, but it defeats Node's
// --experimental-test-coverage reporting for this file (node's coverage
// reporter keeps only the last-loaded script instance's coverage per file
// path, not a merge across instances - see utils/tf2Schema.js's own
// __resetSchemaCacheForTests for the full writeup of that bug).
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

// link2Backpack() (dynamically imported and called for real when the route
// matches) needs a chrome.storage.local-backed schema/warpaints/pricing
// environment - same fixture shape tests/link2Backpack.test.js's own
// installFakeChrome uses, reused here so the router's own real dispatch into
// it doesn't throw. Kept deliberately minimal/empty (no API key, no cached
// data) since this file only cares about the ROUTING decision, not
// link2Backpack's own full behavior (covered separately, in depth).
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
}

// Installs a placeholder document/chrome/window so content.js's own
// top-level routeStntrading() call (see that file's own note) has something
// to read on this ONE-TIME import, and waits for it to fully settle (via its
// own throwaway onMessage listener array) before any test installs its own
// fixtures - createScriptRegistry's own listen() call happens AFTER an
// awaited dynamic import, i.e. after this priming call could otherwise be
// interleaved with a test's own global.chrome swap, which would attach its
// listener to the TEST's messageListeners array instead of this one and
// corrupt that test's own `messageListeners[0]` lookup.
installSafeGlobals();
const primingListeners = [];
global.chrome = {
  runtime: { getURL: fakeGetURL, onMessage: { addListener: (cb) => primingListeners.push(cb) }, sendMessage: async () => ({ ok: false }) },
  storage: {
    local: { get: async () => ({}), set: async () => {} },
    onChanged: { addListener: () => {} },
  },
};
global.window = { location: { href: "https://stntrading.eu/" } };
global.fetch = async () => ({ json: async () => [] });
await import("../stntrading.eu/content.js");
await waitUntil(() => primingListeners.length > 0);

async function runRouterFor(href) {
  installSafeGlobals();
  const messageListeners = [];
  global.chrome = {
    runtime: {
      getURL: fakeGetURL,
      onMessage: { addListener: (cb) => messageListeners.push(cb) },
      sendMessage: async () => ({ ok: false, error: "no live fetch expected for this router-only test" }),
    },
    storage: {
      local: { get: async () => ({}), set: async () => {} },
      onChanged: { addListener: () => {} },
    },
  };
  global.window = { location: { href } };
  global.fetch = async () => ({ json: async () => [] });

  await globalThis.__stntradingTestHooks.run();
  await waitUntil(() => messageListeners.length > 0);

  let info;
  messageListeners[0]({ type: "GET_LOADED_SCRIPTS" }, {}, (response) => (info = response));
  await waitUntil(() => info && info.settled);
  return info;
}

test("a stntrading.eu item page for tf2 loads the 'Links to backpack.tf' feature", async () => {
  const info = await runRouterFor("https://stntrading.eu/item/tf2/123456789");
  assert.deepEqual(info.scripts, ["Links to backpack.tf"]);
  assert.equal(info.settled, true);
});

test("a stntrading.eu item page for a different game does not load the feature", async () => {
  const info = await runRouterFor("https://stntrading.eu/item/csgo/123456789");
  assert.deepEqual(info.scripts, []);
  assert.equal(info.settled, true);
});

test("a stntrading.eu page that isn't an item page at all does not load the feature", async () => {
  const info = await runRouterFor("https://stntrading.eu/tf2/trade");
  assert.deepEqual(info.scripts, []);
  assert.equal(info.settled, true);
});

test("a stntrading.eu /sell page loads the 'Sell Page Select Buttons' feature", async () => {
  const info = await runRouterFor("https://stntrading.eu/sell");
  assert.deepEqual(info.scripts, ["Sell Page Select Buttons"]);
  assert.equal(info.settled, true);
});

test("a stntrading.eu /sell/weapons subpage also loads the 'Sell Page Select Buttons' feature", async () => {
  const info = await runRouterFor("https://stntrading.eu/sell/weapons");
  assert.deepEqual(info.scripts, ["Sell Page Select Buttons"]);
  assert.equal(info.settled, true);
});
