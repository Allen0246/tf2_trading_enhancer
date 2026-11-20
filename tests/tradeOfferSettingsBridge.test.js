import { test } from "node:test";
import assert from "node:assert/strict";
import { __resetSchemaCacheForTests } from "../utils/tf2Schema.js";
import { tradeOfferSettingsBridge } from "../steamcommunity.com/tradeOfferSettingsBridge/content.js";
import { TRADE_LINK_CLICKS_STORAGE_KEY, tradeLinkFingerprint } from "../utils/tradeLinkTrust.js";

// tradeOfferSettingsBridge bridges free state (the craft-weapon name list,
// the "Auto-add listing price" toggle and listing-link trust) from this ISOLATED-world
// content script to tradeoffer.js (world: MAIN, no chrome.storage of its
// own) via plain CustomEvent broadcasts on document - see that file's own
// header note for the full "why". utils/tf2Schema.js's own getSchemaMaps
// memoizes its resolved schema at module scope for the lifetime of this test
// file's one module instance - reset before every test so each test's own
// storage fixture is actually used, not whatever an earlier test resolved.
test.beforeEach(() => {
  __resetSchemaCacheForTests();
});

const SCHEMA_FIXTURE = {
  itemNameToDefindex: {},
  defindexToItemName: {},
  effectNameToId: {},
  itemNameToCraftClass: { "Rocket Launcher": "weapon", Scattergun: "weapon", "Mann Co. Supply Crate Key": null },
  fetchedAt: Date.now(),
  schemaShapeVersion: 3,
};

class FakeMutationObserver {
  constructor(cb) {
    this.cb = cb;
    FakeMutationObserver.instances.push(this);
  }
  observe(target, opts) {
    this.target = target;
    this.opts = opts;
  }
  disconnect() {
    this.disconnected = true;
  }
}
FakeMutationObserver.instances = [];

function installGlobals({
  storage = {},
  controlsExist = true,
  locationHref = "https://steamcommunity.com/tradeoffer/new/?partner=1&token=abc",
} = {}) {
  FakeMutationObserver.instances = [];
  global.window = { location: { href: locationHref } };
  const store = { ...storage };
  const onChangedListeners = [];
  const dispatched = [];

  global.document = {
    getElementById: (id) => (id === "controls" && controlsExist ? {} : null),
    body: {},
    addEventListener: () => {},
    dispatchEvent: (evt) => {
      dispatched.push(evt);
    },
  };
  global.MutationObserver = FakeMutationObserver;
  global.CustomEvent = class {
    constructor(type, init) {
      this.type = type;
      this.detail = init?.detail;
    }
  };
  global.chrome = {
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
      onChanged: {
        addListener: (fn) => onChangedListeners.push(fn),
      },
    },
  };

  return { store, onChangedListeners, dispatched };
}

function craftWeaponBroadcasts(dispatched) {
  return dispatched.filter((e) => e.type === "tf2te-craft-weapon-names-broadcast").map((e) => JSON.parse(e.detail));
}

function autoAddBroadcasts(dispatched) {
  return dispatched.filter((e) => e.type === "tf2te-auto-add-listing-currency-setting-broadcast").map((e) => JSON.parse(e.detail));
}

const realSetTimeout = globalThis.setTimeout;
async function flush(ticks = 4) {
  for (let i = 0; i < ticks; i++) await new Promise((resolve) => realSetTimeout(resolve, 0));
}

test("broadcasts the schema's craft-weapon names eagerly on call", async () => {
  const { store, dispatched } = installGlobals();
  store.tf2SchemaCache = SCHEMA_FIXTURE;

  tradeOfferSettingsBridge();
  await flush();

  const broadcasts = craftWeaponBroadcasts(dispatched);
  assert.ok(broadcasts.length >= 1);
  assert.deepEqual(broadcasts[0].names.sort(), ["Rocket Launcher", "Scattergun"]);
});

test("broadcasts an empty craft-weapon list when no schema is cached at all, without throwing", async () => {
  const { dispatched } = installGlobals();

  assert.doesNotThrow(() => tradeOfferSettingsBridge());
  await flush();

  const broadcasts = craftWeaponBroadcasts(dispatched);
  assert.ok(broadcasts.length >= 1);
  assert.deepEqual(broadcasts[0].names, []);
});

test("broadcasts the auto-add-listing-currency setting as enabled by default (never saved before)", async () => {
  const { dispatched } = installGlobals();

  tradeOfferSettingsBridge();
  await flush();

  const broadcasts = autoAddBroadcasts(dispatched);
  assert.ok(broadcasts.length >= 1);
  assert.equal(broadcasts[0].enabled, true);
});

test("broadcasts the auto-add-listing-currency setting as disabled once saved off", async () => {
  const { dispatched } = installGlobals({ storage: { autoAddListingCurrencyEnabled: false } });

  tradeOfferSettingsBridge();
  await flush();

  const broadcasts = autoAddBroadcasts(dispatched);
  assert.ok(broadcasts.length >= 1);
  assert.equal(broadcasts[0].enabled, false);
});

test("re-broadcasts both settings once #controls exists, as a safety net against ordering races", async () => {
  const { store, dispatched } = installGlobals({ controlsExist: false });
  store.tf2SchemaCache = SCHEMA_FIXTURE;

  tradeOfferSettingsBridge();
  await flush();

  const craftBefore = craftWeaponBroadcasts(dispatched).length;
  const autoAddBefore = autoAddBroadcasts(dispatched).length;

  assert.equal(FakeMutationObserver.instances.length, 1);
  assert.equal(FakeMutationObserver.instances[0].target, document.body);

  // #controls now exists - simulate tradeoffer.js's own MAIN-world script
  // having finished its setup.
  global.document.getElementById = (id) => (id === "controls" ? {} : null);
  FakeMutationObserver.instances[0].cb();
  await flush();

  assert.equal(FakeMutationObserver.instances[0].disconnected, true);
  assert.ok(craftWeaponBroadcasts(dispatched).length > craftBefore);
  assert.ok(autoAddBroadcasts(dispatched).length > autoAddBefore);
});

test("re-broadcasts craft-weapon names when steamApiKey changes, via chrome.storage.onChanged", async () => {
  const { store, onChangedListeners, dispatched } = installGlobals();
  store.tf2SchemaCache = SCHEMA_FIXTURE;

  tradeOfferSettingsBridge();
  await flush();
  const before = craftWeaponBroadcasts(dispatched).length;

  await Promise.all(onChangedListeners.map((fn) => fn({ steamApiKey: { newValue: "NEWKEY" } }, "local")));
  await flush();

  assert.ok(craftWeaponBroadcasts(dispatched).length > before);
});

test("re-broadcasts the auto-add-listing-currency setting when that storage key changes", async () => {
  const { onChangedListeners, dispatched } = installGlobals();

  tradeOfferSettingsBridge();
  await flush();
  const before = autoAddBroadcasts(dispatched).length;

  await Promise.all(
    onChangedListeners.map((fn) => fn({ autoAddListingCurrencyEnabled: { newValue: false } }, "local"))
  );
  await flush();

  assert.ok(autoAddBroadcasts(dispatched).length > before);
});

test("an unrelated storage key change triggers neither broadcast again", async () => {
  const { onChangedListeners, dispatched } = installGlobals();

  tradeOfferSettingsBridge();
  await flush();
  const craftBefore = craftWeaponBroadcasts(dispatched).length;
  const autoAddBefore = autoAddBroadcasts(dispatched).length;

  await Promise.all(onChangedListeners.map((fn) => fn({ someUnrelatedSetting: { newValue: true } }, "local")));
  await flush();

  assert.equal(craftWeaponBroadcasts(dispatched).length, craftBefore);
  assert.equal(autoAddBroadcasts(dispatched).length, autoAddBefore);
});

test("a storage change in a different areaName (e.g. sync) is ignored", async () => {
  const { onChangedListeners, dispatched } = installGlobals();

  tradeOfferSettingsBridge();
  await flush();
  const craftBefore = craftWeaponBroadcasts(dispatched).length;

  await Promise.all(onChangedListeners.map((fn) => fn({ steamApiKey: { newValue: "X" } }, "sync")));
  await flush();

  assert.equal(craftWeaponBroadcasts(dispatched).length, craftBefore);
});

// --- listing link trust broadcast (gates tradeoffer.js's automatic
// pre-fill from listing_* / for_item_name, see utils/tradeLinkTrust.js) ---

const LISTING_LINK = "https://steamcommunity.com/tradeoffer/new/?partner=1&token=abc&listing_intent=0&for_item_name=Rocket+Launcher";

function trustBroadcasts(dispatched) {
  return dispatched.filter((e) => e.type === "tf2te-listing-link-trust-broadcast");
}

function clickRecord(link) {
  return [{ fingerprint: tradeLinkFingerprint(link), at: Date.now() }];
}

test("broadcasts trusted:true when the page URL matches a listing link the user just opened on backpack.tf", async () => {
  const { dispatched } = installGlobals({
    locationHref: LISTING_LINK,
    storage: { [TRADE_LINK_CLICKS_STORAGE_KEY]: clickRecord(LISTING_LINK) },
  });

  tradeOfferSettingsBridge();
  await flush();

  assert.ok(trustBroadcasts(dispatched).length >= 1);
  assert.deepEqual(JSON.parse(trustBroadcasts(dispatched)[0].detail), { trusted: true });
});

test("never broadcasts trust for a link that wasn't opened from backpack.tf, or that differs from the one that was", async () => {
  const otherTrader = LISTING_LINK.replace("partner=1", "partner=2");
  const { dispatched } = installGlobals({
    locationHref: otherTrader,
    storage: { [TRADE_LINK_CLICKS_STORAGE_KEY]: clickRecord(LISTING_LINK) },
  });

  tradeOfferSettingsBridge();
  await flush();

  assert.equal(trustBroadcasts(dispatched).length, 0);
});

test("broadcasts trust once a click record lands after the page's first check", async () => {
  const { store, onChangedListeners, dispatched } = installGlobals({ locationHref: LISTING_LINK });

  tradeOfferSettingsBridge();
  await flush();
  assert.equal(trustBroadcasts(dispatched).length, 0);

  store[TRADE_LINK_CLICKS_STORAGE_KEY] = clickRecord(LISTING_LINK);
  onChangedListeners.forEach((fn) => fn({ [TRADE_LINK_CLICKS_STORAGE_KEY]: { newValue: store[TRADE_LINK_CLICKS_STORAGE_KEY] } }, "local"));
  await flush();

  assert.equal(trustBroadcasts(dispatched).length, 1);
});
