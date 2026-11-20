import { test } from "node:test";
import assert from "node:assert/strict";

// inventoryMarketActions/mainWorld.js is a MAIN-world bridge script (see its
// own header) - gated once at import time on window.location.pathname
// including "/inventory", then listens on `document` for a CustomEvent
// request asking it to resolve Steam's own GetItemPriceFromTotal fee
// calculation, answering via a CustomEvent response. No chrome.* APIs
// involved at all (that's the whole point of this bridge) - only
// window.GetItemPriceFromTotal/window.g_rgWalletInfo and document/CustomEvent
// need faking.
class FakeCustomEvent {
  constructor(type, { detail } = {}) {
    this.type = type;
    this.detail = detail;
  }
}
globalThis.CustomEvent = FakeCustomEvent;

const dispatchedEvents = [];
const listeners = {};
function installDocument() {
  dispatchedEvents.length = 0;
  for (const key of Object.keys(listeners)) delete listeners[key];
  globalThis.document = {
    addEventListener: (type, cb) => {
      (listeners[type] ||= []).push(cb);
    },
    dispatchEvent: (evt) => {
      dispatchedEvents.push(evt);
    },
  };
}

const REQUEST_EVENT = "tf2te-resolve-seller-price-request";
const RESPONSE_EVENT = "tf2te-resolve-seller-price-response";

function fireRequest(detail) {
  listeners[REQUEST_EVENT][0]({ detail: JSON.stringify(detail) });
}

// mainWorld.js gates itself (or not) once per call based on
// window.location.pathname, and can't gain an `export` (it's loaded as a
// classic MAIN-world content script, not a module - see manifest.json), so
// it exposes globalThis.__inventoryMarketActionsMainWorldTestHooks.run for
// tests to call repeatedly. This module is therefore imported ONCE below,
// not via a fresh cache-busting dynamic import per test - the fresh-import
// approach was used here previously, but it defeats Node's
// --experimental-test-coverage reporting for this file (node's coverage
// reporter keeps only the last-loaded script instance's coverage per file
// path, not a merge across instances - see utils/tf2Schema.js's own
// __resetSchemaCacheForTests for the full writeup of that bug).
async function importFresh(caseId, { pathname = "/id/someone/inventory", walletInfo, priceFn } = {}) {
  installDocument();
  globalThis.window = {
    location: { pathname },
    g_rgWalletInfo: walletInfo,
    GetItemPriceFromTotal: priceFn,
  };
  await globalThis.__inventoryMarketActionsMainWorldTestHooks.run();
}

// Installs a placeholder window/document so mainWorld.js's own top-level
// initInventoryMarketActionsMainWorld() call (see that file's own note) has
// something to read on this ONE-TIME import.
installDocument();
globalThis.window = { location: { pathname: "/id/someone/tradeoffers" } };
await import("../steamcommunity.com/inventoryMarketActions/mainWorld.js");

test("does nothing when the current page isn't an inventory page - no listener registered", async () => {
  await importFresh(1, { pathname: "/id/someone/tradeoffers" });
  assert.equal(listeners[REQUEST_EVENT], undefined);
});

test("registers a listener and resolves via window.GetItemPriceFromTotal when both it and g_rgWalletInfo are present", async () => {
  await importFresh(2, {
    walletInfo: { wallet_currency: 3 },
    priceFn: (buyerTotalCents, walletInfo) => buyerTotalCents - 5 + walletInfo.wallet_currency * 0,
  });

  fireRequest({ requestId: "req-1", buyerTotalCents: 100 });

  assert.equal(dispatchedEvents.length, 1);
  assert.equal(dispatchedEvents[0].type, RESPONSE_EVENT);
  const payload = JSON.parse(dispatchedEvents[0].detail);
  assert.equal(payload.requestId, "req-1");
  assert.equal(payload.sellerPriceCents, 95);
});

test("responds with sellerPriceCents: null when g_rgWalletInfo is missing, even though GetItemPriceFromTotal exists", async () => {
  await importFresh(3, { walletInfo: undefined, priceFn: () => 42 });

  fireRequest({ requestId: "req-2", buyerTotalCents: 100 });

  const payload = JSON.parse(dispatchedEvents[0].detail);
  assert.equal(payload.sellerPriceCents, null);
});

test("responds with sellerPriceCents: null when GetItemPriceFromTotal isn't a function at all", async () => {
  await importFresh(4, { walletInfo: { wallet_currency: 3 }, priceFn: undefined });

  fireRequest({ requestId: "req-3", buyerTotalCents: 100 });

  const payload = JSON.parse(dispatchedEvents[0].detail);
  assert.equal(payload.sellerPriceCents, null);
});

test("swallows a thrown GetItemPriceFromTotal and still responds with sellerPriceCents: null", async () => {
  await importFresh(5, {
    walletInfo: { wallet_currency: 3 },
    priceFn: () => {
      throw new Error("Steam's own fee calc blew up");
    },
  });

  fireRequest({ requestId: "req-4", buyerTotalCents: 100 });

  const payload = JSON.parse(dispatchedEvents[0].detail);
  assert.equal(payload.sellerPriceCents, null);
});

test("a request with requestId == null is ignored - no response dispatched", async () => {
  await importFresh(6, { walletInfo: { wallet_currency: 3 }, priceFn: () => 10 });

  fireRequest({ requestId: null, buyerTotalCents: 100 });

  assert.equal(dispatchedEvents.length, 0);
});

test("accepts a plain object detail (not just a JSON string)", async () => {
  await importFresh(7, { walletInfo: { wallet_currency: 3 }, priceFn: (cents) => cents + 1 });

  listeners[REQUEST_EVENT][0]({ detail: { requestId: "req-object", buyerTotalCents: 50 } });

  const payload = JSON.parse(dispatchedEvents[0].detail);
  assert.equal(payload.requestId, "req-object");
  assert.equal(payload.sellerPriceCents, 51);
});

// The wallet currency, for a priceoverview lookup in the page's own currency
// (steamcommunity.com/shared/walletCurrency.js asks for it on Chrome).
test("answers a wallet currency request with g_rgWalletInfo.wallet_currency, or null without wallet info", async () => {
  await importFresh(20, { walletInfo: { wallet_currency: 3 } });
  listeners["tf2te-wallet-currency-request"][0]({ detail: JSON.stringify({ requestId: "w1" }) });
  assert.equal(dispatchedEvents.at(-1).type, "tf2te-wallet-currency-response");
  assert.deepEqual(JSON.parse(dispatchedEvents.at(-1).detail), { requestId: "w1", currency: 3 });

  await importFresh(21, {});
  listeners["tf2te-wallet-currency-request"][0]({ detail: JSON.stringify({ requestId: "w2" }) });
  assert.deepEqual(JSON.parse(dispatchedEvents.at(-1).detail), { requestId: "w2", currency: null });
});

// --- tf2te-asset-class-request (../shared/englishItemDescription.js) ---

test("answers an asset-class request with the asset's class/instance ids from g_rgAppContextData, and with none for an unknown asset", async () => {
  await importFresh(20);
  globalThis.window.g_rgAppContextData = {
    440: { rgContexts: { 2: { inventory: { m_rgAssets: { 555: { description: { classid: 101785959, instanceid: 11040578 } } } } } } },
  };

  listeners["tf2te-asset-class-request"][0]({ detail: JSON.stringify({ requestId: "a", appid: "440", contextid: "2", assetid: "555" }) });
  listeners["tf2te-asset-class-request"][0]({ detail: JSON.stringify({ requestId: "b", appid: "440", contextid: "2", assetid: "999" }) });

  const responses = dispatchedEvents.filter((e) => e.type === "tf2te-asset-class-response").map((e) => JSON.parse(e.detail));
  assert.deepEqual(responses, [
    { requestId: "a", classid: "101785959", instanceid: "11040578" },
    { requestId: "b" },
  ]);
});
