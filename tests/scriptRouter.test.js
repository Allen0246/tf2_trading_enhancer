import { test } from "node:test";
import assert from "node:assert/strict";
import { createScriptRegistry } from "../utils/scriptRouter.js";

// Fakes window.location.hostname (read once, synchronously, when the
// registry is created) and chrome.runtime.onMessage.addListener - captures
// the registered listener so the test can invoke it directly, the same way
// the real chrome.runtime message dispatcher would.
function setupFakes(hostname) {
  globalThis.window = { location: { hostname } };
  let listener = null;
  globalThis.chrome = {
    runtime: {
      onMessage: {
        addListener: (fn) => {
          listener = fn;
        },
      },
    },
  };
  return () => listener;
}

test("createScriptRegistry seeds info.site from window.location.hostname", () => {
  const getListener = setupFakes("scrap.tf");
  const registry = createScriptRegistry();
  registry.listen();

  let responded;
  getListener()({ type: "GET_LOADED_SCRIPTS" }, {}, (info) => { responded = info; });

  assert.equal(responded.site, "scrap.tf");
  assert.deepEqual(responded.scripts, []);
  assert.equal(responded.settled, false);
});

test("label() accumulates script names into info.scripts, reported via GET_LOADED_SCRIPTS", () => {
  const getListener = setupFakes("backpack.tf");
  const registry = createScriptRegistry();
  registry.listen();

  registry.label("itemQuickLinks");
  registry.label("marketListingLinks");

  let responded;
  const sendResponse = (info) => { responded = info; };
  const keepChannelOpen = getListener()({ type: "GET_LOADED_SCRIPTS" }, {}, sendResponse);

  assert.equal(keepChannelOpen, true);
  assert.deepEqual(responded.scripts, ["itemQuickLinks", "marketListingLinks"]);
  assert.equal(responded.site, "backpack.tf");
});

test("settle() flips settled from false to true", () => {
  const getListener = setupFakes("stntrading.eu");
  const registry = createScriptRegistry();
  registry.listen();

  let responded;
  getListener()({ type: "GET_LOADED_SCRIPTS" }, {}, (info) => { responded = info; });
  assert.equal(responded.settled, false);

  registry.settle();

  getListener()({ type: "GET_LOADED_SCRIPTS" }, {}, (info) => { responded = info; });
  assert.equal(responded.settled, true);
});

test("the listener ignores message types other than GET_LOADED_SCRIPTS", () => {
  const getListener = setupFakes("steamcommunity.com");
  const registry = createScriptRegistry();
  registry.listen();

  let called = false;
  const result = getListener()({ type: "SOMETHING_ELSE" }, {}, () => { called = true; });

  assert.equal(called, false);
  assert.equal(result, undefined);
});

// Two routers on one page (steamcommunity.com/content.js and
// tradeHistoryFetch/content.js both match /id/{name}/tradehistory): the popup
// only receives the first listener's response, so that response has to
// cover both routers.
test("registries created for the same window report each other's labels, settled only once all settled", () => {
  const listeners = [];
  globalThis.window = { location: { hostname: "steamcommunity.com" } };
  globalThis.chrome = { runtime: { onMessage: { addListener: (fn) => listeners.push(fn) } } };

  const first = createScriptRegistry();
  first.listen();
  const second = createScriptRegistry();
  second.listen();

  first.label("Steam Profile Links");
  second.label("Trade History Duplicates");
  first.settle();

  let responded;
  listeners[0]({ type: "GET_LOADED_SCRIPTS" }, {}, (info) => { responded = info; });
  assert.deepEqual(responded.scripts, ["Steam Profile Links", "Trade History Duplicates"]);
  assert.equal(responded.settled, false);

  second.settle();
  listeners[1]({ type: "GET_LOADED_SCRIPTS" }, {}, (info) => { responded = info; });
  assert.deepEqual(responded.scripts, ["Steam Profile Links", "Trade History Duplicates"]);
  assert.equal(responded.settled, true);
});

test("registries created for different windows (separate pages) stay independent", () => {
  const getFirstListener = setupFakes("scrap.tf");
  const first = createScriptRegistry();
  first.listen();
  first.label("Hover Item Links");

  setupFakes("scrap.tf");
  createScriptRegistry().label("Auction Bid Helper");

  let responded;
  getFirstListener()({ type: "GET_LOADED_SCRIPTS" }, {}, (info) => { responded = info; });
  assert.deepEqual(responded.scripts, ["Hover Item Links"]);
});
