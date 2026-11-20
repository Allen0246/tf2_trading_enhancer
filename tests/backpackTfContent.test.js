import { test } from "node:test";
import assert from "node:assert/strict";

// backpack.tf/content.js is a router: an async function (routeBackpackTf)
// that decides (from window.location) which feature module(s) to
// dynamically import and call, then reports the decision via
// utils/scriptRouter.js's own createScriptRegistry - same "fake
// chrome.runtime.getURL to resolve to the real on-disk module" pattern
// tests/background.test.js uses, so the router's own real dynamic-import
// branching runs for real against the real utils/scriptRouter.js,
// backpack.tf/oldUI/addKSButtons/content.js, and both
// backpack.tf/oldUI/fixTradeOfferLinks/content.js and
// backpack.tf/nextUI/fixTradeOfferLinks/content.js modules (each already has
// its own dedicated, deeper test file - this file only cares about the
// router's OWN dispatch decisions, not those modules' full behavior).
//
// content.js can't gain an `export` (it's loaded as a classic content
// script, not a module - see manifest.json), so it exposes
// globalThis.__backpackTfTestHooks.run (== routeBackpackTf) purely for tests
// to call repeatedly. This module is therefore imported ONCE below, not via
// a fresh cache-busting dynamic import per test - the fresh-import approach
// was used here previously, but it defeats Node's
// --experimental-test-coverage reporting for this file (node's coverage
// reporter keeps only the last-loaded script instance's coverage per file
// path, not a merge across instances - see utils/tf2Schema.js's own
// __resetSchemaCacheForTests for the full writeup of that bug).
function fakeGetURL(path) {
  return new URL(`../${path}`, import.meta.url).href;
}

// Just enough of `document` that addKSButtons/fixTradeOfferLinks (dynamically
// imported and called for real by the router) can run their own early-return
// guards without throwing - neither call finds a real page to attach to here,
// which is fine, since this file only asserts on the router's OWN dispatch
// decisions (which feature got registry.label()'d), not those features' full
// DOM behavior.
function installSafeDomGlobals() {
  global.document = {
    body: { nodeType: 1 },
    getElementsByClassName: () => [],
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    createElement: () => ({ style: {}, classList: { add() {} }, appendChild() {}, append() {} }),
    head: { appendChild() {} },
    // backpack.tf/nextUI/premiumSearchLastSeenHighlight/content.js's own
    // premiumSearchLastSeenHighlight() registers a CustomEvent listener on
    // every call (it self-scopes DOM-wise, but always registers the
    // listener regardless) - needed so the router's own dynamic-import call
    // into it doesn't throw here.
    addEventListener: () => {},
  };
  global.MutationObserver = class {
    observe() {}
  };
  global.Node = { ELEMENT_NODE: 1 };
}

// content.js's whole body is an un-awaited top-level `(async () => {...})()`
// IIFE - importing the module only waits for its SYNCHRONOUS portion (none
// here), not for the async work inside (every dynamic import, then
// registry.listen()/settle()). Polls for the router to finish settling rather
// than guessing a fixed number of microtask ticks, since each real dynamic
// import below is real disk I/O, not a mocked instant resolve.
async function waitUntil(conditionFn, { timeoutMs = 2000, intervalMs = 5 } = {}) {
  const start = Date.now();
  while (!conditionFn()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitUntil: condition never became true");
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

// Installs a placeholder window/chrome so content.js's own top-level
// routeBackpackTf() call (see that file's own note) has something to read on
// this ONE-TIME import. Every test below installs its own window/chrome via
// runRouterFor and re-invokes the router itself through
// globalThis.__backpackTfTestHooks.run, so the values used here don't matter
// beyond not throwing before the router's own early guards can bail out.
installSafeDomGlobals();
global.chrome = {
  runtime: { getURL: fakeGetURL, onMessage: { addListener: () => {} } },
  storage: { local: { get: async () => ({}) }, onChanged: { addListener: () => {} } },
};
global.window = { location: { href: "https://backpack.tf/", hostname: "backpack.tf", pathname: "/" } };
await import("../backpack.tf/content.js");

// Runs the router for a given URL and returns the info object
// utils/scriptRouter.js's own GET_LOADED_SCRIPTS responder reports (site,
// scripts[], settled) - the one observable side effect of the router.
async function runRouterFor(href, hostname) {
  installSafeDomGlobals();
  const messageListeners = [];
  global.chrome = {
    runtime: {
      getURL: fakeGetURL,
      onMessage: { addListener: (cb) => messageListeners.push(cb) },
    },
    storage: {
      local: { get: async () => ({}) },
      onChanged: { addListener: () => {} },
    },
  };
  global.window = { location: { href, hostname, pathname: new URL(href).pathname } };

  await globalThis.__backpackTfTestHooks.run();
  await waitUntil(() => messageListeners.length > 0);

  let info;
  messageListeners[0]({ type: "GET_LOADED_SCRIPTS" }, {}, (response) => (info = response));
  await waitUntil(() => info && info.settled);
  return info;
}

test("forums subdomain loads no feature scripts but still settles", async () => {
  const info = await runRouterFor("https://forums.backpack.tf/topic/1", "forums.backpack.tf");
  assert.deepEqual(info.scripts, []);
  assert.equal(info.settled, true);
});

test("classic backpack.tf /stats page loads Killstreak Buttons, the Trade Offer Link Fix, the Marketplace.tf Button, Copy Item Name, Spell Highlight, Profile Trade Link, Effect Class Filter, Unusual Category Filter, Inventory Group By, and Effect Category Filter", async () => {
  const info = await runRouterFor("https://backpack.tf/stats/Unique/Rocket%20Launcher/Tradable/Craftable", "backpack.tf");
  assert.deepEqual(info.scripts, [
    "Killstreak Buttons",
    "Trade Offer Link Fix",
    "STNTrading.eu Button",
    "Marketplace.tf Button",
    "Mannco.store Button",
    "Gladiator.tf Button",
    "PriceDB.io Button",
    "posts.tf Button",
    "Stats Page Quick Links",
    "Suggestions Quick Links",
    "Copy Item Name",
    "Spell Highlight",
    "Profile Trade Link",
    "Effect Class Filter",
    "Unusual Category Filter",
    "Inventory Group By",
    "Listing Queue",
    "Premium Search Skin Autocomplete",
    "Premium Search Last Seen Highlight",
    "Effect Category Filter",
  ]);
  assert.equal(info.settled, true);
});

test("classic backpack.tf /classifieds page loads Killstreak Buttons, the Trade Offer Link Fix, the Marketplace.tf Button, Copy Item Name, Spell Highlight, Profile Trade Link, Effect Class Filter, Unusual Category Filter, Inventory Group By, Effect Category Filter, the old-UI Spell Filter Toggle, the old-UI Strange Filter Toggle, and the Classifieds Search Filter", async () => {
  const info = await runRouterFor("https://backpack.tf/classifieds?item=Rocket%20Launcher", "backpack.tf");
  assert.deepEqual(info.scripts, [
    "Killstreak Buttons",
    "Trade Offer Link Fix",
    "STNTrading.eu Button",
    "Marketplace.tf Button",
    "Mannco.store Button",
    "Gladiator.tf Button",
    "PriceDB.io Button",
    "posts.tf Button",
    "Stats Page Quick Links",
    "Suggestions Quick Links",
    "Copy Item Name",
    "Spell Highlight",
    "Profile Trade Link",
    "Effect Class Filter",
    "Unusual Category Filter",
    "Inventory Group By",
    "Listing Queue",
    "Premium Search Skin Autocomplete",
    "Premium Search Last Seen Highlight",
    "Effect Category Filter",
    "Spell Filter Toggle (old UI)",
    "Strange Filter Toggle (old UI)",
    "Classifieds Search Filter",
  ]);
});

test("classic backpack.tf page that's neither /stats nor /classifieds still loads the (site-wide) Trade Offer Link Fix, Marketplace.tf Button, Copy Item Name, Spell Highlight, Profile Trade Link, Effect Class Filter, Unusual Category Filter, Inventory Group By, and Effect Category Filter", async () => {
  const info = await runRouterFor("https://backpack.tf/", "backpack.tf");
  assert.deepEqual(info.scripts, [
    "Trade Offer Link Fix",
    "STNTrading.eu Button",
    "Marketplace.tf Button",
    "Mannco.store Button",
    "Gladiator.tf Button",
    "PriceDB.io Button",
    "posts.tf Button",
    "Stats Page Quick Links",
    "Suggestions Quick Links",
    "Copy Item Name",
    "Spell Highlight",
    "Profile Trade Link",
    "Effect Class Filter",
    "Unusual Category Filter",
    "Inventory Group By",
    "Listing Queue",
    "Premium Search Skin Autocomplete",
    "Premium Search Last Seen Highlight",
    "Effect Category Filter",
  ]);
  assert.equal(info.settled, true);
});

test("next.backpack.tf loads the Trade Offer Link Fix, the Marketplace.tf Button, Mannco.store Button, Gladiator.tf Button, PriceDB.io Button, Copy Item Name, Spell Highlight, Effect Class Filter, and Effect Category Filter only, never Killstreak Buttons (no old-UI nav there)", async () => {
  const info = await runRouterFor("https://next.backpack.tf/stats?item=Rocket+Launcher", "next.backpack.tf");
  assert.deepEqual(info.scripts, [
    "Trade Offer Link Fix",
    "STNTrading.eu Button",
    "Marketplace.tf Button",
    "Mannco.store Button",
    "Gladiator.tf Button",
    "PriceDB.io Button",
    "posts.tf Button",
    "Stats Page Quick Links",
    "Suggestions Quick Links",
    "Suggestion Detail Quick Links",
    "Copy Item Name",
    "Spell Highlight",
    "Effect Class Filter",
    "Effect Category Filter",
    "Items Table Filters",
    "Spell Filter Toggle",
    "Strange Filter Toggle",
    "War Paint Filter Toggle",
    "Killstreak Tier Filter",
    "Premium Search Last Seen Highlight",
  ]);
});

test("next.backpack.tf loads the Trade Offer Link Fix, the Marketplace.tf Button, Mannco.store Button, Gladiator.tf Button, PriceDB.io Button, Copy Item Name, Spell Highlight, Effect Class Filter, and Effect Category Filter even on a page with neither stats nor classifieds in the path", async () => {
  // Confirmed by content.js's own branching: both next.backpack.tf branches
  // only check url.hostname, not url.pathname - Spell Filter Toggle is now
  // registered site-wide too (its own ensureButton self-checks pathname on
  // every scan instead - see its own header note on why: this router only
  // ever runs once, and next.backpack.tf is a Vue SPA that can navigate to
  // /classifieds without a page reload).
  const info = await runRouterFor("https://next.backpack.tf/", "next.backpack.tf");
  assert.deepEqual(info.scripts, [
    "Trade Offer Link Fix",
    "STNTrading.eu Button",
    "Marketplace.tf Button",
    "Mannco.store Button",
    "Gladiator.tf Button",
    "PriceDB.io Button",
    "posts.tf Button",
    "Stats Page Quick Links",
    "Suggestions Quick Links",
    "Suggestion Detail Quick Links",
    "Copy Item Name",
    "Spell Highlight",
    "Effect Class Filter",
    "Effect Category Filter",
    "Items Table Filters",
    "Spell Filter Toggle",
    "Strange Filter Toggle",
    "War Paint Filter Toggle",
    "Killstreak Tier Filter",
    "Premium Search Last Seen Highlight",
  ]);
});

test("next.backpack.tf /classifieds page also loads the Spell Filter Toggle, Strange Filter Toggle, and War Paint Filter Toggle", async () => {
  const info = await runRouterFor("https://next.backpack.tf/classifieds?itemName=Max%27s%20Severed%20Head&quality=6", "next.backpack.tf");
  assert.deepEqual(info.scripts, [
    "Trade Offer Link Fix",
    "STNTrading.eu Button",
    "Marketplace.tf Button",
    "Mannco.store Button",
    "Gladiator.tf Button",
    "PriceDB.io Button",
    "posts.tf Button",
    "Stats Page Quick Links",
    "Suggestions Quick Links",
    "Suggestion Detail Quick Links",
    "Copy Item Name",
    "Spell Highlight",
    "Effect Class Filter",
    "Effect Category Filter",
    "Items Table Filters",
    "Spell Filter Toggle",
    "Strange Filter Toggle",
    "War Paint Filter Toggle",
    "Killstreak Tier Filter",
    "Premium Search Last Seen Highlight",
  ]);
});
