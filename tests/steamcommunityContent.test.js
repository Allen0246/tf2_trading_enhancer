import { test } from "node:test";
import assert from "node:assert/strict";

// steamcommunity.com/content.js is the top-level router - an async function
// (routeSteamcommunity) that, per pathname, dynamically imports the real
// feature modules (via chrome.runtime.getURL, faked below to resolve to the
// actual on-disk files - same pattern tests/background.test.js established)
// and calls their entry points. Each entry point's own deep behavior already
// has its own dedicated test file (tests/itemQuickLinks.test.js,
// tests/marketListingLinks.test.js, etc.) - this file's job is only to verify the
// ROUTING itself: which pathname triggers which feature(s), confirmed via
// registry.label()/settle() (queried the same way a real popup would, via the
// GET_LOADED_SCRIPTS message captured off chrome.runtime.onMessage), not by
// re-verifying what each feature does once loaded.
//
// The DOM fakes below are deliberately minimal/"nothing found" across the
// board (querySelector/getElementById/getElementsByClassName all return
// null/[]) - every real feature's own entry point (pickContainer,
// waitForControls, waitForImagePanel, steamLinks' own locationButtons check)
// already bails out gracefully and safely on missing DOM, so this never needs
// to simulate real Steam page markup, only prove the router wired the right
// feature to the right pathname without throwing.
//
// content.js can't gain an `export` (it's loaded as a classic content
// script, not a module - see manifest.json), so it exposes
// globalThis.__steamcommunityTestHooks.run (== routeSteamcommunity) purely
// for tests to call repeatedly. This module is therefore imported ONCE
// below, not via a fresh cache-busting dynamic import per test - the
// fresh-import approach was used here previously, but it defeats Node's
// --experimental-test-coverage reporting for this file (node's coverage
// reporter keeps only the last-loaded script instance's coverage per file
// path, not a merge across instances - see utils/tf2Schema.js's own
// __resetSchemaCacheForTests for the full writeup of that bug). The final
// test deliberately uses one pathname engineered to satisfy as many routing
// branches at once as the real logic allows, to keep coverage as thorough as
// possible even beyond just fixing the reporting artifact.
function fakeGetURL(path) {
  return new URL(`../${path}`, import.meta.url).href;
}

class FakeMutationObserver {
  constructor(cb) {
    this.cb = cb;
    FakeMutationObserver.instances.push(this);
  }
  observe(target, opts) {
    this.target = target;
    this.opts = opts;
  }
  disconnect() {}
}
FakeMutationObserver.instances = [];

function createFakeElement(tag) {
  return {
    tagName: tag,
    style: {},
    dataset: {},
    children: [],
    classList: { add() {}, contains: () => false },
    appendChild(el) {
      this.children.push(el);
      return el;
    },
    setAttribute() {},
    addEventListener() {},
    remove() {},
  };
}

const realSetTimeout = globalThis.setTimeout;
async function flush(ticks = 8) {
  for (let i = 0; i < ticks; i++) {
    await new Promise((resolve) => realSetTimeout(resolve, 0));
  }
}

let onMessageListeners;
let dispatchedEvents;
function installGlobals(pathname) {
  FakeMutationObserver.instances = [];
  onMessageListeners = [];
  dispatchedEvents = [];

  globalThis.document = {
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    getElementsByClassName: () => [],
    createElement: (tag) => createFakeElement(tag),
    body: {},
    head: { appendChild() {} },
    documentElement: createFakeElement("html"),
    cookie: "",
    // Recorded (not acted on) - lets a test confirm tradeOfferSettingsBridge
    // actually ran via the broadcasts it dispatches. The cross-world event
    // flow itself is covered in tests/tradeOfferPage.test.js.
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: (evt) => dispatchedEvents.push(evt),
  };
  globalThis.window = {
    location: { href: `https://steamcommunity.com${pathname}`, pathname: pathname.split("?")[0] },
    addEventListener() {},
  };
  globalThis.MutationObserver = FakeMutationObserver;
  globalThis.CustomEvent = class {
    constructor(type, init) {
      this.type = type;
      this.detail = init?.detail;
    }
  };
  // Fake, non-scheduling setTimeout/clearTimeout - several imported features
  // (debounce, waitForImagePanel's own timeout) call these at load/call time;
  // none of their delayed callbacks need to actually fire for this router
  // test (which only checks registry labels + "did it crash"), and letting
  // a REAL 15s timer (waitForImagePanel's own default) get scheduled would
  // otherwise keep the process alive well past the test's own lifetime.
  globalThis.setTimeout = (fn, delay) => {
    (globalThis.__fakeTimeouts ||= []).push({ fn, delay });
    return globalThis.__fakeTimeouts.length;
  };
  globalThis.clearTimeout = () => {};

  globalThis.chrome = {
    runtime: {
      getURL: fakeGetURL,
      onMessage: { addListener: (fn) => onMessageListeners.push(fn) },
      sendMessage: async () => ({ ok: false, error: "not needed for router test" }),
    },
    storage: {
      local: { get: async () => ({}), set: async () => {} },
      onChanged: { addListener: () => {} },
    },
  };
}

function queryRegistry() {
  let info;
  onMessageListeners[0]({ type: "GET_LOADED_SCRIPTS" }, {}, (i) => {
    info = i;
  });
  return info;
}

// Installs a placeholder document/chrome/window so content.js's own
// top-level routeSteamcommunity() call (see that file's own note) has
// something to read on this ONE-TIME import, and flushes it to completion
// before any test installs its own fixtures.
installGlobals("/");
await import("../steamcommunity.com/content.js");
await flush();

test("an inventory page loads Item Links + Inventory Market Actions + Fabricator Multi-Buy and sets up 3 re-run observers on document.body", async () => {
  installGlobals("/id/someuser/inventory");
  await globalThis.__steamcommunityTestHooks.run();
  await flush();

  const info = queryRegistry();
  assert.equal(info.settled, true);
  assert.deepEqual(info.scripts.sort(), ["Fabricator Multi-Buy", "Inventory Market Actions", "Item Links"]);
  assert.equal(FakeMutationObserver.instances.length, 3);
  assert.equal(FakeMutationObserver.instances[0].target, document.body);
  assert.equal(FakeMutationObserver.instances[1].target, document.body);
  assert.equal(FakeMutationObserver.instances[2].target, document.body);

  // All three observers' own callbacks re-invoke showItemQuickLinks/
  // showInventoryMarketActions/showFabricatorMultiBuy on every DOM mutation
  // (see content.js's own note on why - Steam alternates which of
  // #iteminfo0/#iteminfo1 it re-renders into) - confirm they're wired to
  // real, callable functions and don't throw against the same "nothing
  // found" DOM the initial call saw.
  assert.doesNotThrow(() => FakeMutationObserver.instances[0].cb());
  assert.doesNotThrow(() => FakeMutationObserver.instances[1].cb());
  assert.doesNotThrow(() => FakeMutationObserver.instances[2].cb());
});

test("a new-trade-offer page runs the settings bridge, which isn't a labeled feature", async () => {
  installGlobals("/tradeoffer/new/76561198000000000_0_0000000000");
  await globalThis.__steamcommunityTestHooks.run();
  await flush();

  const info = queryRegistry();
  assert.deepEqual(info.scripts, []);
  assert.equal(info.settled, true);
  assert.ok(dispatchedEvents.some((e) => e.type === "tf2te-auto-add-listing-currency-setting-broadcast"));
});

test("a market listing page loads Market Listing Links and Market Listing Detail Modal", async () => {
  installGlobals("/market/listings/440/Mann%20Co.%20Supply%20Crate%20Key");
  await globalThis.__steamcommunityTestHooks.run();
  await flush();

  const info = queryRegistry();
  assert.deepEqual(info.scripts.sort(), ["Market Listing Detail Modal", "Market Listing Links"]);
  assert.equal(info.settled, true);
});

// The Market features are TF2-only - another game's listing page
// (CS2 is appid 730) must not get the TF2 buttons/links at all.
test("another game's market listing page loads none of the TF2 market features", async () => {
  installGlobals("/market/listings/730/AK-47%20%7C%20Redline%20%28Field-Tested%29");
  await globalThis.__steamcommunityTestHooks.run();
  await flush();

  const info = queryRegistry();
  assert.deepEqual(info.scripts, []);
  assert.equal(info.settled, true);
});

// Steam's Market opens items in-app (no page load), so every /market/ page
// watches for that; it's infrastructure, not a labeled feature.
test("a Market search page starts the in-app navigation watcher and loads no listing features", async () => {
  installGlobals("/market/search?q=unusual");
  await globalThis.__steamcommunityTestHooks.run();
  await flush();

  const info = queryRegistry();
  assert.deepEqual(info.scripts, []);
  assert.equal(info.settled, true);
  assert.equal(FakeMutationObserver.instances.length, 1);
  assert.equal(FakeMutationObserver.instances[0].target, document.body);
});

test("a plain profile page (not an excluded subpath) loads Steam Links", async () => {
  installGlobals("/profiles/76561198000000000");
  await globalThis.__steamcommunityTestHooks.run();
  await flush();

  const info = queryRegistry();
  assert.deepEqual(info.scripts, ["Steam Links"]);
  assert.equal(info.settled, true);
});

test("a /tradehistory/ page loads Trade History Duplicates (and not Steam Links, an excluded subpath) with 1 re-run observer on document.body", async () => {
  installGlobals("/id/someuser/tradehistory/");
  await globalThis.__steamcommunityTestHooks.run();
  await flush();

  const info = queryRegistry();
  // No banner here any more: the export panel itself now lives on this page.
  assert.deepEqual(info.scripts, ["Trade History Duplicates"]);
  assert.equal(info.settled, true);
  assert.equal(FakeMutationObserver.instances.length, 1);
  assert.equal(FakeMutationObserver.instances[0].target, document.body);
});

test("a /market/multibuy page loads the Fabricator Multi-Buy Verify Reminder", async () => {
  installGlobals("/market/multibuy");
  await globalThis.__steamcommunityTestHooks.run();
  await flush();

  const info = queryRegistry();
  assert.deepEqual(info.scripts, ["Fabricator Multi-Buy Verify Reminder"]);
  assert.equal(info.settled, true);
});

test("an excluded profile subpath (e.g. /friends) loads nothing, but still settles", async () => {
  installGlobals("/id/someuser/friends");
  await globalThis.__steamcommunityTestHooks.run();
  await flush();

  const info = queryRegistry();
  assert.deepEqual(info.scripts, []);
  assert.equal(info.settled, true);
});

test("a pathname matching none of the routes loads nothing, but still settles", async () => {
  installGlobals("/discussions/forum/1");
  await globalThis.__steamcommunityTestHooks.run();
  await flush();

  const info = queryRegistry();
  assert.deepEqual(info.scripts, []);
  assert.equal(info.settled, true);
});

test("a pathname engineered to satisfy the inventory, tradeoffer/new, and market/listings routes together loads all 5 of their features in one pass, without throwing", async () => {
  // "/profiles/123/inventory/tradeoffer/new/market/listings/440/x" - has "inventory"
  // as its own path segment (triggers the inventory branch), literally
  // contains "/tradeoffer/new" (triggers that branch) and "/market/listings/440/"
  // (triggers that branch) as substrings, and starts with "/profiles/" too -
  // though that last one doesn't actually add Steam Links here, since
  // isExcludedProfileSubpath treats "inventory" (present as a segment) as an
  // excluded profile subpath, same as a real .../inventory profile URL would.
  installGlobals("/profiles/123/inventory/tradeoffer/new/market/listings/440/x");
  await globalThis.__steamcommunityTestHooks.run();
  await flush();

  const info = queryRegistry();
  assert.deepEqual(
    info.scripts.sort(),
    [
      "Fabricator Multi-Buy",
      "Inventory Market Actions",
      "Item Links",
      "Market Listing Detail Modal",
      "Market Listing Links",
    ].sort()
  );
  assert.equal(info.settled, true);
  assert.equal(FakeMutationObserver.instances.length >= 2, true);
});
