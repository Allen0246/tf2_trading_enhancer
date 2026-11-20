import { test } from "node:test";
import assert from "node:assert/strict";

import {
  TRADE_LINK_CLICKS_STORAGE_KEY,
  tradeLinkFingerprint,
  recordTradeLinkClick,
  isRecentlyClickedTradeLink,
  watchTradeLinkClicks,
} from "../utils/tradeLinkTrust.js";

function installStorage(initial = {}) {
  const store = { ...initial };
  globalThis.chrome = {
    storage: {
      local: {
        async get(keys) {
          const result = {};
          for (const k of keys) if (k in store) result[k] = store[k];
          return result;
        },
        async set(obj) {
          Object.assign(store, obj);
        },
      },
    },
  };
  return store;
}

const LINK = "https://steamcommunity.com/tradeoffer/new/?partner=123&token=abc&listing_intent=0&for_item_name=Rocket+Launcher";

// --- tradeLinkFingerprint ---

test("tradeLinkFingerprint treats '+' and '%20' spellings and param order as the same link", () => {
  const reordered = "https://steamcommunity.com/tradeoffer/new/?for_item_name=Rocket%20Launcher&listing_intent=0&token=abc&partner=123";
  assert.equal(tradeLinkFingerprint(LINK), tradeLinkFingerprint(reordered));
});

test("tradeLinkFingerprint tells apart links that differ in trader, intent, price or item", () => {
  const base = tradeLinkFingerprint(LINK);
  assert.notEqual(base, tradeLinkFingerprint(LINK.replace("partner=123", "partner=999")));
  assert.notEqual(base, tradeLinkFingerprint(LINK.replace("token=abc", "token=xyz")));
  assert.notEqual(base, tradeLinkFingerprint(LINK.replace("listing_intent=0", "listing_intent=1")));
  assert.notEqual(base, tradeLinkFingerprint(`${LINK}&listing_currencies_keys=50`));
  assert.notEqual(base, tradeLinkFingerprint(LINK.replace("Rocket+Launcher", "Team+Captain")));
});

test("tradeLinkFingerprint ignores params that don't affect the pre-fill", () => {
  assert.equal(tradeLinkFingerprint(LINK), tradeLinkFingerprint(`${LINK}&utm_source=x#hash`));
});

test("tradeLinkFingerprint returns null for an unparseable URL", () => {
  assert.equal(tradeLinkFingerprint("not a url"), null);
});

// --- record / check ---

test("a recorded link is trusted, a different one is not", async () => {
  installStorage();
  await recordTradeLinkClick(LINK, 1000);

  assert.equal(await isRecentlyClickedTradeLink(LINK, 2000), true);
  assert.equal(await isRecentlyClickedTradeLink(LINK.replace("partner=123", "partner=999"), 2000), false);
});

test("a record stops counting after 10 minutes", async () => {
  installStorage();
  await recordTradeLinkClick(LINK, 0);

  assert.equal(await isRecentlyClickedTradeLink(LINK, 10 * 60 * 1000 - 1), true);
  assert.equal(await isRecentlyClickedTradeLink(LINK, 10 * 60 * 1000), false);
});

test("nothing is trusted when no click was ever recorded", async () => {
  installStorage();
  assert.equal(await isRecentlyClickedTradeLink(LINK), false);
});

test("re-recording the same link keeps one record, expired ones are dropped, and at most 20 are kept", async () => {
  const store = installStorage({
    [TRADE_LINK_CLICKS_STORAGE_KEY]: [{ fingerprint: "old", at: 0 }],
  });
  const now = 60 * 60 * 1000;

  await recordTradeLinkClick(LINK, now);
  await recordTradeLinkClick(LINK, now + 1);
  assert.deepEqual(store[TRADE_LINK_CLICKS_STORAGE_KEY], [{ fingerprint: tradeLinkFingerprint(LINK), at: now + 1 }]);

  for (let i = 0; i < 25; i++) {
    await recordTradeLinkClick(`${LINK}&for_item=440_2_${i}`, now + 2 + i);
  }
  const records = store[TRADE_LINK_CLICKS_STORAGE_KEY];
  assert.equal(records.length, 20);
  assert.equal(records.at(-1).fingerprint, tradeLinkFingerprint(`${LINK}&for_item=440_2_24`));
});

test("ignores a malformed stored value instead of throwing", async () => {
  installStorage({ [TRADE_LINK_CLICKS_STORAGE_KEY]: "garbage" });
  assert.equal(await isRecentlyClickedTradeLink(LINK), false);
});

// --- watchTradeLinkClicks ---

function installDocument() {
  const listeners = {};
  globalThis.document = {
    addEventListener: (type, cb, capture) => {
      (listeners[type] ||= []).push({ cb, capture });
    },
  };
  return listeners;
}

function fakeAnchor(href, vetted) {
  const anchor = { href, vetted };
  anchor.closest = (selector) => (selector === "a[href]" ? anchor : null);
  return anchor;
}

const realSetTimeout = globalThis.setTimeout;
const flush = () => new Promise((resolve) => realSetTimeout(resolve, 0));

test("watchTradeLinkClicks records a vetted anchor on mousedown, click and auxclick, in the capture phase", async () => {
  installStorage();
  const listeners = installDocument();
  watchTradeLinkClicks((anchor) => anchor.vetted);

  for (const type of ["mousedown", "click", "auxclick"]) {
    assert.equal(listeners[type]?.[0]?.capture, true, `${type} listener in capture phase`);
  }

  listeners.mousedown[0].cb({ target: fakeAnchor(LINK, true) });
  await flush();

  assert.equal(await isRecentlyClickedTradeLink(LINK), true);
});

test("watchTradeLinkClicks ignores an anchor the page's own fixTradeOfferLinks didn't vouch for", async () => {
  installStorage();
  const listeners = installDocument();
  watchTradeLinkClicks((anchor) => anchor.vetted);

  listeners.click[0].cb({ target: fakeAnchor(LINK, false) });
  listeners.click[0].cb({ target: { closest: () => null } }); // click outside any link
  await flush();

  assert.equal(await isRecentlyClickedTradeLink(LINK), false);
});
