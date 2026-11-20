import { test } from "node:test";
import assert from "node:assert/strict";

// backpack.tf/nextUI/fixTradeOfferLinks/mainWorld.js is a classic MAIN-world
// script (no exports) that runs once at import time - imported ONCE below
// against a placeholder page, then re-run per test through its own
// globalThis.__nextUiExactListingCurrenciesTestHooks.run, same convention as
// tests/inventoryMarketActionsMainWorld.test.js.

class FakeMutationObserver {
  constructor(cb) {
    this.cb = cb;
    FakeMutationObserver.instances.push(this);
  }
  observe(target, opts) {
    this.target = target;
    this.opts = opts;
  }
}
FakeMutationObserver.instances = [];

function fakeRow(vue) {
  const attrs = {};
  return {
    __vue__: vue,
    setAttributeCalls: 0,
    getAttribute: (name) => (name in attrs ? attrs[name] : null),
    setAttribute(name, value) {
      this.setAttributeCalls++;
      attrs[name] = value;
    },
  };
}

function installPage({ hostname = "next.backpack.tf", rows = [] } = {}) {
  global.window = { location: { hostname } };
  global.MutationObserver = FakeMutationObserver;
  FakeMutationObserver.instances = [];
  global.document = {
    body: {},
    querySelectorAll: (selector) => (selector === ".listing" ? rows : []),
  };
}

installPage();
await import("../backpack.tf/nextUI/fixTradeOfferLinks/mainWorld.js");
const run = () => globalThis.__nextUiExactListingCurrenciesTestHooks.run();

// Real shape, confirmed live via the row's own __vue__.$props.listing.
const LIVE_LISTING = {
  id: "440_76561198000000000_0123456789abcdef0123456789abcdef",
  currencies: { metal: 28.77, keys: 250 },
  value: { short: "250.45 keys", long: "250 keys, 28.77 ref" },
  intent: "buy",
};

test("copies each row's listing id and exact currencies onto the row", () => {
  const row = fakeRow({ $props: { listing: LIVE_LISTING } });
  installPage({ rows: [row] });

  run();

  assert.deepEqual(JSON.parse(row.getAttribute("data-tf2te-currencies")), {
    id: LIVE_LISTING.id,
    keys: 250,
    metal: 28.77,
  });
});

test("a missing currency is written as 0", () => {
  const row = fakeRow({ $props: { listing: { id: "440_1", currencies: { metal: 12.11 } } } });
  installPage({ rows: [row] });

  run();

  assert.deepEqual(JSON.parse(row.getAttribute("data-tf2te-currencies")), { id: "440_1", keys: 0, metal: 12.11 });
});

test("skips rows with no Vue instance, no listing id, or no currencies", () => {
  const noVue = fakeRow(undefined);
  const noId = fakeRow({ $props: { listing: { currencies: { keys: 1 } } } });
  const noCurrencies = fakeRow({ $props: { listing: { id: "440_1" } } });
  installPage({ rows: [noVue, noId, noCurrencies] });

  run();

  for (const row of [noVue, noId, noCurrencies]) {
    assert.equal(row.getAttribute("data-tf2te-currencies"), null);
  }
});

test("does nothing outside next.backpack.tf", () => {
  const row = fakeRow({ $props: { listing: LIVE_LISTING } });
  installPage({ hostname: "backpack.tf", rows: [row] });

  run();

  assert.equal(row.getAttribute("data-tf2te-currencies"), null);
  assert.equal(FakeMutationObserver.instances.length, 0);
});

test("re-syncs on DOM changes, rewriting the attribute only when the listing actually changed", () => {
  const vue = { $props: { listing: LIVE_LISTING } };
  const row = fakeRow(vue);
  installPage({ rows: [row] });

  run();
  const observer = FakeMutationObserver.instances[0];
  assert.equal(observer.target, document.body);
  assert.deepEqual(observer.opts, { childList: true, subtree: true });
  assert.equal(row.setAttributeCalls, 1);

  observer.cb([]);
  assert.equal(row.setAttributeCalls, 1, "an unchanged listing must not be rewritten");

  // Vue recycled the row for a different listing.
  vue.$props = { listing: { id: "440_2", currencies: { keys: 1, metal: 50 } } };
  observer.cb([]);
  assert.equal(row.setAttributeCalls, 2);
  assert.deepEqual(JSON.parse(row.getAttribute("data-tf2te-currencies")), { id: "440_2", keys: 1, metal: 50 });
});
