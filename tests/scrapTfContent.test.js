import { test } from "node:test";
import assert from "node:assert/strict";

// scrap.tf/content.js is a router: an async function (routeScrapTf) that
// decides (from window.location) which feature module(s) to dynamically
// import and call, then reports the decision via utils/scriptRouter.js's own
// createScriptRegistry - same "fake chrome.runtime.getURL" pattern
// tests/backpackTfContent.test.js/tests/background.test.js use, so the
// router's own real dynamic-import branching runs for real against the real
// utils/scriptRouter.js. Unlike backpackTfContent.test.js (whose two real
// feature modules happen to have safe, synchronous "nothing found yet"
// early-return guards for a bare mock DOM), every scrap.tf feature module
// this router can dispatch to either builds real DOM unconditionally or
// schedules a real timer (auctionBidHelper's 15s MutationObserver give-up,
// sellDuplicates' own MutationObserver) - each already has its own
// dedicated, much deeper test file (see tests/fixtures/scrapTfRouterStubs.js's
// own header for the full list), so this file routes every feature import to
// a tiny recording stub instead of the real module, keeping its own scope to
// exactly what it's meant to cover: the router's OWN dispatch decisions.
//
// content.js can't gain an `export` (it's loaded as a classic content
// script, not a module - see manifest.json), so it exposes
// globalThis.__scrapTfTestHooks.run (== routeScrapTf) purely for tests to
// call repeatedly. This module is therefore imported ONCE below, not via a
// fresh cache-busting dynamic import per test - the fresh-import approach
// was used here previously, but it defeats Node's
// --experimental-test-coverage reporting for this file (node's coverage
// reporter keeps only the last-loaded script instance's coverage per file
// path, not a merge across instances - see utils/tf2Schema.js's own
// __resetSchemaCacheForTests for the full writeup of that bug).
function fakeGetURL(path) {
  if (path.startsWith("scrap.tf/") && path !== "scrap.tf/content.js") {
    return new URL("./fixtures/scrapTfRouterStubs.js", import.meta.url).href;
  }
  return new URL(`../${path}`, import.meta.url).href;
}

function installSafeDomGlobals() {
  global.document = {
    body: { nodeType: 1 },
    getElementsByClassName: () => [],
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    createElement: () => ({ style: {}, classList: { add() {} }, appendChild() {}, append() {} }),
  };
  global.MutationObserver = class {
    observe() {}
  };
  global.Node = { ELEMENT_NODE: 1 };
}

// Installs a placeholder document/chrome/window so content.js's own
// top-level routeScrapTf() call (see that file's own note) has something to
// read on this ONE-TIME import, and flushes it to completion (same reasoning
// as tests/apiKeyStatus.test.js's own flush) so its un-awaited internal
// dynamic-import chain can't resume later and push into a test's own
// stubCalls recording after globals have been swapped.
installSafeDomGlobals();
global.chrome = { runtime: { getURL: fakeGetURL, onMessage: { addListener: () => {} } } };
global.window = { location: { href: "https://scrap.tf/", hostname: "scrap.tf", pathname: "/" } };
await import("../scrap.tf/content.js");
await new Promise((resolve) => setTimeout(resolve, 50));
(await import("./fixtures/scrapTfRouterStubs.js")).calls.length = 0;

async function runRouterFor(href, hostname, pathname) {
  installSafeDomGlobals();
  const messageListeners = [];
  global.chrome = {
    runtime: {
      getURL: fakeGetURL,
      onMessage: { addListener: (cb) => messageListeners.push(cb) },
    },
  };
  global.window = { location: { href, hostname, pathname } };

  await globalThis.__scrapTfTestHooks.run();
  // routeScrapTf's own internal chain of dynamic imports (utils/scriptRouter.js,
  // then whichever feature modules) isn't awaited by its caller here either -
  // a short real wait lets that chain complete before checking what it
  // registered/reported - confirmed necessary (not just defensive): without
  // it, registry.listen() reliably hasn't run yet by this point.
  await new Promise((resolve) => setTimeout(resolve, 50));

  let info;
  messageListeners[0]({ type: "GET_LOADED_SCRIPTS" }, {}, (response) => (info = response));

  const { calls } = await import("./fixtures/scrapTfRouterStubs.js");
  const stubCalls = [...calls];
  calls.length = 0;
  return { info, stubCalls };
}

test("the merch subdomain loads no feature scripts, calls no stub, but still settles", async () => {
  const { info, stubCalls } = await runRouterFor("https://merch.scrap.tf/", "merch.scrap.tf", "/");
  assert.deepEqual(info.scripts, []);
  assert.deepEqual(stubCalls, []);
  assert.equal(info.settled, true);
});

test("the item banking table page (/items) loads only the Items Table Links, NOT Hover Item Links - that table's rows have no genuine hoverable item element, so hover+middle-click never worked there", async () => {
  const { info, stubCalls } = await runRouterFor("https://scrap.tf/items", "scrap.tf", "/items");
  assert.deepEqual(info.scripts, ["Items Table Links"]);
  assert.deepEqual(stubCalls, ["scrapItemsTableLinks"]);
  assert.equal(info.settled, true);
});

test("a /buy/ page loads only Hover Item Links (no dedicated banking-page feature left)", async () => {
  const { info, stubCalls } = await runRouterFor("https://scrap.tf/buy/hats", "scrap.tf", "/buy/hats");
  assert.deepEqual(info.scripts, ["Hover Item Links"]);
  assert.deepEqual(stubCalls, ["itemLinks"]);
});

// Regression: /buy/items is the "Items" category filter under the Buy
// section - an ordinary /buy/<category> page like /buy/hats, with real
// hoverable item tiles - not the standalone item banking table (bare
// /items). A previous bare `.includes("items")` check misidentified it as
// the banking table and silently dropped its hover panel; the exact-path
// match (isItemBankingTablePage in content.js) fixes this.
test("a /buy/items page (the Items category filter, NOT the standalone banking table) still loads Hover Item Links", async () => {
  const { info, stubCalls } = await runRouterFor("https://scrap.tf/buy/items", "scrap.tf", "/buy/items");
  assert.deepEqual(info.scripts, ["Hover Item Links"]);
  assert.deepEqual(stubCalls, ["itemLinks"]);
});

test("a /sell/items page (same category-filter shape) also still loads Hover Item Links", async () => {
  const { info, stubCalls } = await runRouterFor("https://scrap.tf/sell/items", "scrap.tf", "/sell/items");
  assert.deepEqual(info.scripts, ["Sell Duplicates Selector", "Hover Item Links"]);
  assert.deepEqual(stubCalls, ["sellDuplicates", "itemLinks"]);
});

test("the standalone item banking table still works with a trailing slash (/items/)", async () => {
  const { info, stubCalls } = await runRouterFor("https://scrap.tf/items/", "scrap.tf", "/items/");
  assert.deepEqual(info.scripts, ["Items Table Links"]);
  assert.deepEqual(stubCalls, ["scrapItemsTableLinks"]);
});

test("an /unusuals/ page loads only Hover Item Links (no dedicated banking-page feature left)", async () => {
  const { info, stubCalls } = await runRouterFor("https://scrap.tf/unusuals/all", "scrap.tf", "/unusuals/all");
  assert.deepEqual(info.scripts, ["Hover Item Links"]);
  assert.deepEqual(stubCalls, ["itemLinks"]);
});

test("an /auctions/ page loads the Auction Bid Helper and Hover Item Links", async () => {
  const { info, stubCalls } = await runRouterFor("https://scrap.tf/auctions/123", "scrap.tf", "/auctions/123");
  assert.deepEqual(info.scripts, ["Auction Bid Helper", "Hover Item Links"]);
  assert.deepEqual(stubCalls, ["auctionBidHelper", "itemLinks"]);
});

test("a /sell/ page loads the Sell Duplicates Selector and Hover Item Links", async () => {
  const { info, stubCalls } = await runRouterFor("https://scrap.tf/sell/all", "scrap.tf", "/sell/all");
  assert.deepEqual(info.scripts, ["Sell Duplicates Selector", "Hover Item Links"]);
  assert.deepEqual(stubCalls, ["sellDuplicates", "itemLinks"]);
});

test("a page matching none of the special paths loads only Hover Item Links", async () => {
  const { info, stubCalls } = await runRouterFor("https://scrap.tf/", "scrap.tf", "/");
  assert.deepEqual(info.scripts, ["Hover Item Links"]);
  assert.deepEqual(stubCalls, ["itemLinks"]);
  assert.equal(info.settled, true);
});

test("a page matching multiple path fragments (e.g. both /auctions/ and /sell/ substrings) loads every matching feature - branches are independent ifs, not exclusive", async () => {
  // /auctions/ and /sell/ are both substrings of this single pathname -
  // confirms content.js's own branches are independent `if`s (not
  // if/else-if), so a (hypothetical) URL matching more than one condition
  // loads every match, not just the first.
  const { stubCalls } = await runRouterFor("https://scrap.tf/sell/auctions/weird", "scrap.tf", "/sell/auctions/weird");
  assert.deepEqual(stubCalls, ["auctionBidHelper", "sellDuplicates", "itemLinks"]);
});
