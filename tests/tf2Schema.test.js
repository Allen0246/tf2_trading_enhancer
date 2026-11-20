import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getItemDefindex,
  getItemNameByDefindex,
  getCanonicalItemName,
  getItemClasses,
  getTauntNameByIcon,
  iconNameFromUrl,
  hasSchemaAccess,
  getEffectId,
  categorizeEffectSystem,
  getEffectNameToIdMap,
  getEffectNameToCategoryMap,
  SCHEMA_CACHE_TTL_MS,
  SCHEMA_SHAPE_VERSION,
  __resetSchemaCacheForTests,
} from "../utils/tf2Schema.js";

// tf2Schema.js memoizes an in-flight/resolved schema promise at module scope
// (schemaPromise) for the lifetime of the loaded module - once any exported
// function successfully resolves a schema, every later call in that same
// module instance reuses it and never re-reads chrome.storage.local or calls
// chrome.runtime.sendMessage again. __resetSchemaCacheForTests() clears that
// memoization between tests so each test gets its own fixture (a different
// pagination order, a different cache state, etc.) without needing a fresh
// dynamic module import per test - a fresh-import-per-test approach was tried
// first, but it defeats V8's per-script coverage tracking (node's coverage
// reporter keeps only the last-loaded script instance's coverage per file
// path, not a merge across instances), so it silently under-reported real
// coverage on this file's already-thorough test suite.
test.beforeEach(() => {
  __resetSchemaCacheForTests();
});

// Fakes the subset of chrome.storage.local this module reads/writes.
function fakeStorageLocal(initial = {}) {
  const store = { ...initial };
  return {
    async get(keys) {
      const result = {};
      for (const k of keys) if (k in store) result[k] = store[k];
      return result;
    },
    async set(obj) {
      Object.assign(store, obj);
    },
    _store: store,
  };
}

// Fakes chrome.runtime.sendMessage's FETCH_JSON relay for both
// GetSchemaItems (paginated via a "next" cursor/"start" param) and
// GetSchemaOverview (single response). itemPages is keyed by the "start"
// query param value each page expects to be called with (null for the first
// page, matching fetchSchemaItemsPage's own `if (start != null)` guard).
function makeSendMessage({ itemPages = [], overview = {} } = {}) {
  const calls = [];
  const sendMessage = async (msg) => {
    calls.push(msg);
    const url = new URL(msg.url);

    if (url.pathname.includes("GetSchemaItems")) {
      const start = url.searchParams.get("start");
      const page = itemPages.find((p) => (p.startKey ?? null) === start);
      return { ok: true, data: { result: page ? { items: page.items, next: page.next ?? null } : { items: [], next: null } } };
    }

    if (url.pathname.includes("GetSchemaOverview")) {
      return { ok: true, data: { result: overview } };
    }

    return { ok: false, error: `unexpected FETCH_JSON url: ${msg.url}` };
  };
  return { sendMessage, calls };
}

test("getItemDefindex paginates GetSchemaItems via the next cursor and merges both pages", async () => {
  const { sendMessage, calls } = makeSendMessage({
    itemPages: [
      { startKey: null, items: [{ item_name: "Rocket Launcher", defindex: 18, name: "TF_WEAPON_ROCKETLAUNCHER" }], next: 100 },
      { startKey: "100", items: [{ item_name: "Scattergun", defindex: 13, name: "TF_WEAPON_SCATTERGUN" }], next: null },
    ],
  });

  globalThis.chrome = {
    storage: { local: fakeStorageLocal({ steamApiKey: "KEY123" }) },
    runtime: { sendMessage },
  };

  assert.equal(await getItemDefindex("Rocket Launcher"), 18);
  assert.equal(await getItemDefindex("Scattergun"), 13);
  // 2 GetSchemaItems pages + 1 GetSchemaOverview call
  assert.equal(calls.length, 3);
});

// REGRESSION for a live bug report: Valve's Web API can fail transiently
// (confirmed live via a real GetPlayerItems 503 - GetSchemaItems/
// GetSchemaOverview are the exact same underlying infrastructure) - this
// used to fail the whole schema fetch outright on the very first bad
// response. Now retried automatically via utils/fetchJsonRelay.js, so a
// transient blip during the (already slow, multi-page) cold schema fetch
// doesn't need a whole separate caller-level retry to recover from.
test("recovers from a transient (503) GetSchemaItems failure via fetchJsonRelay's own automatic retry", async () => {
  let callCount = 0;
  const sendMessage = async (msg) => {
    callCount++;
    const url = new URL(msg.url);
    if (url.pathname.includes("GetSchemaItems") && callCount < 3) {
      return { ok: false, status: 503, error: "Request failed (503)" };
    }
    if (url.pathname.includes("GetSchemaItems")) {
      return { ok: true, data: { result: { items: [{ item_name: "Rocket Launcher", defindex: 18 }], next: null } } };
    }
    return { ok: true, data: { result: {} } }; // GetSchemaOverview
  };

  globalThis.chrome = {
    storage: { local: fakeStorageLocal({ steamApiKey: "KEY123" }) },
    runtime: { sendMessage },
  };

  assert.equal(await getItemDefindex("Rocket Launcher"), 18);
});

test("getItemClasses returns the class array as given, when used_by_classes is already an array (Valve's documented shape)", async () => {
  const { sendMessage } = makeSendMessage({
    itemPages: [{ startKey: null, items: [{ item_name: "Noh Mercy", defindex: 361, used_by_classes: ["Spy"] }] }],
  });
  globalThis.chrome = { storage: { local: fakeStorageLocal({ steamApiKey: "KEY123" }) }, runtime: { sendMessage } };

  assert.deepEqual(await getItemClasses("Noh Mercy"), ["Spy"]);
});

test("getItemClasses also handles used_by_classes as an object map ({\"Scout\":\"1\"}-style) - unconfirmed live, defensive against either shape", async () => {
  const { sendMessage } = makeSendMessage({
    itemPages: [{ startKey: null, items: [{ item_name: "Croc-o-Style Kit", defindex: 940, used_by_classes: { Scout: "1", Soldier: "1" } }] }],
  });
  globalThis.chrome = { storage: { local: fakeStorageLocal({ steamApiKey: "KEY123" }) }, runtime: { sendMessage } };

  assert.deepEqual((await getItemClasses("Croc-o-Style Kit")).sort(), ["Scout", "Soldier"]);
});

test("getItemClasses returns [] for an item with no used_by_classes field at all (not class-restricted)", async () => {
  const { sendMessage } = makeSendMessage({
    itemPages: [{ startKey: null, items: [{ item_name: "Bill's Hat", defindex: 378 }] }],
  });
  globalThis.chrome = { storage: { local: fakeStorageLocal({ steamApiKey: "KEY123" }) }, runtime: { sendMessage } };

  assert.deepEqual(await getItemClasses("Bill's Hat"), []);
});

test("getItemClasses returns [] for an item name the schema has no entry for at all", async () => {
  const { sendMessage } = makeSendMessage({
    itemPages: [{ startKey: null, items: [{ item_name: "Bill's Hat", defindex: 378 }] }],
  });
  globalThis.chrome = { storage: { local: fakeStorageLocal({ steamApiKey: "KEY123" }) }, runtime: { sendMessage } };

  assert.deepEqual(await getItemClasses("Never Heard Of It"), []);
});

test("iconNameFromUrl takes the icon's file name without its hash, on both Valve's and Steam's CDN hosts", () => {
  assert.equal(iconNameFromUrl("http://media.steampowered.com/apps/440/icons/taunt_the_bunnyhopper.dfb3285b0a35881593055cb69cd009a9d9c44af4.png"), "taunt_the_bunnyhopper");
  assert.equal(iconNameFromUrl("opacity:1;background-image:url(https://steamcdn-a.akamaihd.net/apps/440/icons/taunt_the_bunnyhopper.dfb3285b.png);"), "taunt_the_bunnyhopper");
  assert.equal(iconNameFromUrl("https://community.akamai.steamstatic.com/economy/image/abc/96fx96f"), null);
  assert.equal(iconNameFromUrl(null), null);
});

test("getTauntNameByIcon maps a taunt's icon file name to its name, and keeps non-taunts out of the map", async () => {
  const { sendMessage } = makeSendMessage({
    itemPages: [
      {
        startKey: null,
        items: [
          { item_name: "Taunt: The Bunnyhopper", defindex: 30920, image_url: "http://media.steampowered.com/apps/440/icons/taunt_the_bunnyhopper.dfb3285b.png" },
          { item_name: "Rocket Launcher", defindex: 18, image_url: "http://media.steampowered.com/apps/440/icons/w_rocketlauncher.0d6b0a0d.png" },
        ],
      },
    ],
  });
  globalThis.chrome = { storage: { local: fakeStorageLocal({ steamApiKey: "KEY123" }) }, runtime: { sendMessage } };

  assert.equal(await getTauntNameByIcon("taunt_the_bunnyhopper"), "Taunt: The Bunnyhopper");
  assert.equal(await getTauntNameByIcon("w_rocketlauncher"), null);
});

test("hasSchemaAccess is true once a schema resolves (a key is configured)", async () => {
  const { sendMessage } = makeSendMessage({
    itemPages: [{ startKey: null, items: [{ item_name: "Bill's Hat", defindex: 378 }] }],
  });
  globalThis.chrome = { storage: { local: fakeStorageLocal({ steamApiKey: "KEY123" }) }, runtime: { sendMessage } };

  assert.equal(await hasSchemaAccess(), true);
});

test("hasSchemaAccess is false with no API key configured and no cache to fall back on", async () => {
  globalThis.chrome = { storage: { local: fakeStorageLocal({}) }, runtime: { sendMessage: async () => ({ ok: false }) } };

  assert.equal(await hasSchemaAccess(), false);
});

test("itemNameToDefindex prefers the Upgradeable-prefixed defindex over the plain stock one - Upgradeable listed first", async () => {
  const { sendMessage } = makeSendMessage({
    itemPages: [
      {
        startKey: null,
        items: [
          { item_name: "Rocket Launcher", defindex: 205, name: "Upgradeable TF_WEAPON_ROCKETLAUNCHER" },
          { item_name: "Rocket Launcher", defindex: 18, name: "TF_WEAPON_ROCKETLAUNCHER" },
        ],
      },
    ],
  });
  globalThis.chrome = { storage: { local: fakeStorageLocal({ steamApiKey: "KEY123" }) }, runtime: { sendMessage } };

  assert.equal(await getItemDefindex("Rocket Launcher"), 205);
});

test("itemNameToDefindex prefers the Upgradeable-prefixed defindex over the plain stock one - plain listed first", async () => {
  // Same pair, reversed pagination order - the doc comment on fetchFullSchema
  // says the Upgradeable variant must win "regardless of pagination order".
  const { sendMessage } = makeSendMessage({
    itemPages: [
      {
        startKey: null,
        items: [
          { item_name: "Rocket Launcher", defindex: 18, name: "TF_WEAPON_ROCKETLAUNCHER" },
          { item_name: "Rocket Launcher", defindex: 205, name: "Upgradeable TF_WEAPON_ROCKETLAUNCHER" },
        ],
      },
    ],
  });
  globalThis.chrome = { storage: { local: fakeStorageLocal({ steamApiKey: "KEY123" }) }, runtime: { sendMessage } };

  assert.equal(await getItemDefindex("Rocket Launcher"), 205);
});

test("a name with no Upgradeable variant at all keeps its one plain entry (isUpgradeable stays false)", async () => {
  const { sendMessage } = makeSendMessage({
    itemPages: [{ startKey: null, items: [{ item_name: "Bonk! Atomic Punch", defindex: 46, name: "TF_WEAPON_ENERGY_DRINK" }] }],
  });
  globalThis.chrome = { storage: { local: fakeStorageLocal({ steamApiKey: "KEY123" }) }, runtime: { sendMessage } };

  assert.equal(await getItemDefindex("Bonk! Atomic Punch"), 46);
});

test("an item with a falsy item_name or a null defindex is skipped entirely", async () => {
  const { sendMessage } = makeSendMessage({
    itemPages: [
      {
        startKey: null,
        items: [
          { item_name: "", defindex: 999, name: "TF_NO_NAME" },
          { item_name: "No Defindex", defindex: null, name: "TF_NO_DEFINDEX" },
          { item_name: "Valid Item", defindex: 5, name: "TF_VALID" },
        ],
      },
    ],
  });
  globalThis.chrome = { storage: { local: fakeStorageLocal({ steamApiKey: "KEY123" }) }, runtime: { sendMessage } };

  assert.equal(await getItemDefindex("Valid Item"), 5);
  assert.equal(await getItemDefindex("No Defindex"), null);
  assert.equal(await getItemNameByDefindex(999), null);
});

test("defindexToItemName keeps every defindex unfiltered, including a third variant the by-name dedup drops", async () => {
  // Mirrors the confirmed-live "Purple Range Sniper Rifle" (defindex 15007)
  // case from fetchFullSchema's own comment: a third schema entry sharing a
  // name with the regular stock/Upgradeable pair, dropped from
  // itemNameToDefindex but not from defindexToItemName.
  const { sendMessage } = makeSendMessage({
    itemPages: [
      {
        startKey: null,
        items: [
          { item_name: "Sniper Rifle", defindex: 30, name: "TF_WEAPON_SNIPERRIFLE" },
          { item_name: "Sniper Rifle", defindex: 206, name: "Upgradeable TF_WEAPON_SNIPERRIFLE" },
          { item_name: "Sniper Rifle", defindex: 15007, name: "TF_WEAPON_SNIPERRIFLE_DECORATED" },
        ],
      },
    ],
  });
  globalThis.chrome = { storage: { local: fakeStorageLocal({ steamApiKey: "KEY123" }) }, runtime: { sendMessage } };

  assert.equal(await getItemDefindex("Sniper Rifle"), 206);
  assert.equal(await getItemNameByDefindex(15007), "Sniper Rifle");
  assert.equal(await getItemNameByDefindex(30), "Sniper Rifle");
  assert.equal(await getItemNameByDefindex(206), "Sniper Rifle");
});

test("effectNameToId keeps the RED (first-seen) id over a BLU-teamcolor variant sharing its name - RED listed first", async () => {
  const { sendMessage } = makeSendMessage({
    itemPages: [{ startKey: null, items: [] }],
    overview: {
      attribute_controlled_attached_particles: [
        { id: 301, name: "Sixth Sense", system: "unusual_sixthsense_teamcolor_red" },
        { id: 302, name: "Sixth Sense", system: "unusual_sixthsense_teamcolor_blue" },
      ],
    },
  });
  globalThis.chrome = { storage: { local: fakeStorageLocal({ steamApiKey: "KEY123" }) }, runtime: { sendMessage } };

  assert.equal(await getEffectId("Sixth Sense"), 301);
});

test("effectNameToId still resolves to the RED id when the BLU-teamcolor variant is listed first", async () => {
  // The dedup guard only special-cases the BLU entry ("skip if already
  // claimed") - a RED/non-BLU entry always overwrites unconditionally, so the
  // final id ends up RED (301) either way this pair is ordered.
  const { sendMessage } = makeSendMessage({
    itemPages: [{ startKey: null, items: [] }],
    overview: {
      attribute_controlled_attached_particles: [
        { id: 302, name: "Sixth Sense", system: "unusual_sixthsense_teamcolor_blue" },
        { id: 301, name: "Sixth Sense", system: "unusual_sixthsense_teamcolor_red" },
      ],
    },
  });
  globalThis.chrome = { storage: { local: fakeStorageLocal({ steamApiKey: "KEY123" }) }, runtime: { sendMessage } };

  assert.equal(await getEffectId("Sixth Sense"), 301);
});

test("an effect with a falsy name or a null id is skipped, and a non-BLU system string doesn't trigger the dedup guard", async () => {
  const { sendMessage } = makeSendMessage({
    itemPages: [{ startKey: null, items: [] }],
    overview: {
      attribute_controlled_attached_particles: [
        { id: 1, name: "", system: "no_name" },
        { id: null, name: "No Id", system: "no_id" },
        { id: 5, name: "Regular Effect", system: "not_teamcolor_at_all" },
      ],
    },
  });
  globalThis.chrome = { storage: { local: fakeStorageLocal({ steamApiKey: "KEY123" }) }, runtime: { sendMessage } };

  assert.equal(await getEffectId("Regular Effect"), 5);
  assert.equal(await getEffectId("No Id"), null);
});

test("getEffectId matches case-insensitively against the schema's own effect name casing", async () => {
  const { sendMessage } = makeSendMessage({
    itemPages: [{ startKey: null, items: [] }],
    overview: { attribute_controlled_attached_particles: [{ id: 13, name: "Burning Flames", system: "burningflames" }] },
  });
  globalThis.chrome = { storage: { local: fakeStorageLocal({ steamApiKey: "KEY123" }) }, runtime: { sendMessage } };

  assert.equal(await getEffectId("burning flames"), 13);
  assert.equal(await getEffectId("BURNING FLAMES"), 13);
});

test("getEffectId returns null when no schema is available (no key, no cache)", async () => {
  globalThis.chrome = { storage: { local: fakeStorageLocal() }, runtime: { sendMessage: async () => ({ ok: false, error: "unused" }) } };

  assert.equal(await getEffectId("Anything"), null);
});

// Prefixes confirmed live against real GetSchemaOverview entries: id 301
// "unusual_sixthsense_teamcolor_red" (hat), id 3011
// "utaunt_souls_green_parent" (taunt), id 701 "weapon_unusual_hot" (weapon) -
// see categorizeEffectSystem's own note on why "hat" is the default
// fallthrough rather than requiring its own positive prefix match.
test("categorizeEffectSystem classifies by system prefix, defaulting to hat", () => {
  assert.equal(categorizeEffectSystem("unusual_sixthsense_teamcolor_red"), "hat");
  assert.equal(categorizeEffectSystem("utaunt_souls_green_parent"), "taunt");
  assert.equal(categorizeEffectSystem("weapon_unusual_hot"), "weapon");
  assert.equal(categorizeEffectSystem("burningplayer_red"), "hat"); // pre-convention legacy system, no prefix match
  assert.equal(categorizeEffectSystem(undefined), "hat");
  assert.equal(categorizeEffectSystem(null), "hat");
});

test("getEffectNameToIdMap layers the live schema's own entries on top of utils/unusualEffectIds.js's own static table", async () => {
  const { sendMessage } = makeSendMessage({
    itemPages: [{ startKey: null, items: [] }],
    overview: {
      attribute_controlled_attached_particles: [
        { id: 13, name: "Burning Flames", system: "burningflames" },
        // Deliberately a DIFFERENT id than the static table's own "Green
        // Confetti": 6 - proves the live schema wins on overlap (a real
        // key configured can still correct/update an entry).
        { id: 703, name: "Green Confetti", system: "greenconfetti" },
      ],
    },
  });
  globalThis.chrome = { storage: { local: fakeStorageLocal({ steamApiKey: "KEY123" }) }, runtime: { sendMessage } };

  const map = await getEffectNameToIdMap();
  assert.equal(map["Burning Flames"], 13);
  assert.equal(map["Green Confetti"], 703); // live schema overrides the static table's own 6
  // An effect this fixture's own live schema never mentions at all - still
  // present, straight from the static table.
  assert.equal(map["Haunted Cremation"], 3129);
});

// This used to return {} whenever no live schema was available (no key, or
// nothing cached yet) - resolveUnusualEffect
// (utils/tf2StatsLinks/unusual.js) then showed "Set Steam API key for
// stats/classifieds" for the vast majority of Unusual items, even ones the
// static table already resolves with no key needed at all.
test("getEffectNameToIdMap returns the static table's own entries even when no live schema is available at all", async () => {
  globalThis.chrome = { storage: { local: fakeStorageLocal() }, runtime: { sendMessage: async () => ({ ok: false, error: "unused" }) } };

  const map = await getEffectNameToIdMap();
  assert.equal(map["Burning Flames"], 13);
  assert.equal(map["Haunted Cremation"], 3129);
  assert.ok(Object.keys(map).length > 100); // comfortably more than the {} this used to return
});

test("getEffectNameToCategoryMap returns the full effect name -> category map", async () => {
  const { sendMessage } = makeSendMessage({
    itemPages: [{ startKey: null, items: [] }],
    overview: {
      attribute_controlled_attached_particles: [
        { id: 13, name: "Burning Flames", system: "burningflames" },
        { id: 3011, name: "Haunted Phantasm", system: "utaunt_souls_green_parent" },
        { id: 701, name: "Hot", system: "weapon_unusual_hot" },
      ],
    },
  });
  globalThis.chrome = { storage: { local: fakeStorageLocal({ steamApiKey: "KEY123" }) }, runtime: { sendMessage } };

  assert.deepEqual(await getEffectNameToCategoryMap(), { "Burning Flames": "hat", "Haunted Phantasm": "taunt", Hot: "weapon" });
});

test("getEffectNameToCategoryMap returns an empty object when no schema is available", async () => {
  globalThis.chrome = { storage: { local: fakeStorageLocal() }, runtime: { sendMessage: async () => ({ ok: false, error: "unused" }) } };

  assert.deepEqual(await getEffectNameToCategoryMap(), {});
});

// --- getCanonicalItemName ---------------------------------------------

test("getCanonicalItemName returns the name unchanged when it's already exactly cased", async () => {
  const cached = {
    itemNameToDefindex: { "Force-a-Nature": 425 },
    defindexToItemName: {},
    effectNameToId: {},
    fetchedAt: Date.now(),
    schemaShapeVersion: SCHEMA_SHAPE_VERSION,
  };
  const { sendMessage, calls } = makeSendMessage();
  globalThis.chrome = { storage: { local: fakeStorageLocal({ tf2SchemaCache: cached }) }, runtime: { sendMessage } };

  assert.equal(await getCanonicalItemName("Force-a-Nature"), "Force-a-Nature");
  assert.equal(calls.length, 0);
});

// Regression for a live bug report: stntrading.eu's own raw item-name text
// capitalized "Australium Force-A-Nature" wrong (capital A) - the real
// schema entry is "Australium Force-a-Nature" (lowercase a) - which silently
// 404'd every exact-case link built from it until this case-insensitive
// recovery was added.
test("getCanonicalItemName recovers the schema's own correctly-cased name for a case-insensitive match", async () => {
  const cached = {
    itemNameToDefindex: { "Australium Force-a-Nature": 425 },
    defindexToItemName: {},
    effectNameToId: {},
    fetchedAt: Date.now(),
    schemaShapeVersion: SCHEMA_SHAPE_VERSION,
  };
  globalThis.chrome = { storage: { local: fakeStorageLocal({ tf2SchemaCache: cached }) }, runtime: { sendMessage: async () => ({ ok: false }) } };

  assert.equal(await getCanonicalItemName("Australium Force-A-Nature"), "Australium Force-a-Nature");
});

// Regression for a live bug report: scrap.tf's own item banking table
// (/items) renders an apostrophe'd item's name with the apostrophe silently
// dropped entirely - "Bills Hat" for the real "Bill's Hat" - which silently
// 404'd every exact-match lookup built from it (pricedb.io's own search,
// posts.tf's own getItemDefindex) until this apostrophe-insensitive recovery
// was added, same shape as the case-insensitive one above.
test("getCanonicalItemName recovers the schema's own apostrophe'd name when the raw text is missing it entirely", async () => {
  const cached = {
    itemNameToDefindex: { "Bill's Hat": 378 },
    defindexToItemName: {},
    effectNameToId: {},
    fetchedAt: Date.now(),
    schemaShapeVersion: SCHEMA_SHAPE_VERSION,
  };
  globalThis.chrome = { storage: { local: fakeStorageLocal({ tf2SchemaCache: cached }) }, runtime: { sendMessage: async () => ({ ok: false }) } };

  assert.equal(await getCanonicalItemName("Bills Hat"), "Bill's Hat");
});

// Second confirmed-live case, in the same report - "Taunt: " is part of the
// canonical name itself for a Taunt (not a quality prefix), so the whole
// string still matches directly once apostrophe differences are ignored.
test("getCanonicalItemName recovers a Taunt's own apostrophe'd name too", async () => {
  const cached = {
    itemNameToDefindex: { "Taunt: Soldier's Requiem": 1234 },
    defindexToItemName: {},
    effectNameToId: {},
    fetchedAt: Date.now(),
    schemaShapeVersion: SCHEMA_SHAPE_VERSION,
  };
  globalThis.chrome = { storage: { local: fakeStorageLocal({ tf2SchemaCache: cached }) }, runtime: { sendMessage: async () => ({ ok: false }) } };

  assert.equal(await getCanonicalItemName("Taunt: Soldiers Requiem"), "Taunt: Soldier's Requiem");
});

// A curly apostrophe (’) in either the input or the schema key normalizes
// the same as a straight one (') or none at all - the fix isn't just a
// literal string swap for one specific character.
test("getCanonicalItemName normalizes curly and straight apostrophes the same way", async () => {
  const cached = {
    itemNameToDefindex: { "Bill’s Hat": 378 }, // curly apostrophe in the schema itself
    defindexToItemName: {},
    effectNameToId: {},
    fetchedAt: Date.now(),
    schemaShapeVersion: SCHEMA_SHAPE_VERSION,
  };
  globalThis.chrome = { storage: { local: fakeStorageLocal({ tf2SchemaCache: cached }) }, runtime: { sendMessage: async () => ({ ok: false }) } };

  assert.equal(await getCanonicalItemName("Bill's Hat"), "Bill’s Hat"); // straight apostrophe in the input
});

// The raw data-title text for "The Quäckenbirdt" read plain "Quackenbirdt" -
// missing BOTH the "ä" diacritic AND the leading "The " article - a bigger
// gap than the apostrophe case above, so normalizeForFuzzySchemaMatch also
// strips diacritics (NFD decomposition) and a leading "The " (from either
// side).
test("getCanonicalItemName recovers a missing diacritic and a missing 'The ' article together", async () => {
  const cached = {
    itemNameToDefindex: { "The Quäckenbirdt": 5715 },
    defindexToItemName: {},
    effectNameToId: {},
    fetchedAt: Date.now(),
    schemaShapeVersion: SCHEMA_SHAPE_VERSION,
  };
  globalThis.chrome = { storage: { local: fakeStorageLocal({ tf2SchemaCache: cached }) }, runtime: { sendMessage: async () => ({ ok: false }) } };

  assert.equal(await getCanonicalItemName("Quackenbirdt"), "The Quäckenbirdt");
});

test("getCanonicalItemName returns the input unchanged when no schema is available at all (no key, no cache)", async () => {
  globalThis.chrome = { storage: { local: fakeStorageLocal({}) }, runtime: { sendMessage: async () => ({ ok: false }) } };

  assert.equal(await getCanonicalItemName("Australium Force-A-Nature"), "Australium Force-A-Nature");
});

test("getCanonicalItemName returns the input unchanged when nothing in the schema matches, even case-insensitively", async () => {
  const cached = {
    itemNameToDefindex: { "Rocket Launcher": 205 },
    defindexToItemName: {},
    effectNameToId: {},
    fetchedAt: Date.now(),
    schemaShapeVersion: SCHEMA_SHAPE_VERSION,
  };
  globalThis.chrome = { storage: { local: fakeStorageLocal({ tf2SchemaCache: cached }) }, runtime: { sendMessage: async () => ({ ok: false }) } };

  assert.equal(await getCanonicalItemName("Some Unknown Item"), "Some Unknown Item");
});

test("a fresh (within-TTL) cache is used without calling chrome.runtime.sendMessage", async () => {
  const cached = {
    itemNameToDefindex: { "Rocket Launcher": 205 },
    defindexToItemName: { 205: "Rocket Launcher" },
    effectNameToId: { "Burning Flames": 13 },
    fetchedAt: Date.now(),
    schemaShapeVersion: SCHEMA_SHAPE_VERSION,
  };
  const { sendMessage, calls } = makeSendMessage();
  globalThis.chrome = {
    storage: { local: fakeStorageLocal({ tf2SchemaCache: cached }) },
    runtime: { sendMessage },
  };

  assert.equal(await getItemDefindex("Rocket Launcher"), 205);
  assert.equal(calls.length, 0);
});

// Confirmed live: adding effectNameToCategory to the schema's own returned
// shape did exactly this to existing users' already-cached (and still
// within-TTL) schema - every getEffectNameToCategoryMap() lookup silently
// returned {} until the cache aged out on its own a week later, which read
// as "every specific category filters out every item" (an empty category
// map for every effect name) even though a Steam API key was configured
// correctly the whole time.
test("a within-TTL cache from an older schemaShapeVersion is treated as stale and triggers a refetch anyway", async () => {
  const outdatedShapeCache = {
    itemNameToDefindex: { "Old Item": 1 },
    defindexToItemName: { 1: "Old Item" },
    effectNameToId: {},
    // no effectNameToCategory at all - the exact shape a cache written before
    // that field existed would have.
    fetchedAt: Date.now(),
    schemaShapeVersion: SCHEMA_SHAPE_VERSION - 1,
  };
  const { sendMessage, calls } = makeSendMessage({
    itemPages: [{ startKey: null, items: [{ item_name: "New Item", defindex: 2, name: "TF_NEW_ITEM" }] }],
    overview: { attribute_controlled_attached_particles: [{ id: 99, name: "Nebula", system: "unusual_nebula" }] },
  });
  const storage = fakeStorageLocal({ steamApiKey: "KEY123", tf2SchemaCache: outdatedShapeCache });
  globalThis.chrome = { storage: { local: storage }, runtime: { sendMessage } };

  assert.deepEqual(await getEffectNameToCategoryMap(), { Nebula: "hat" });
  assert.ok(calls.length > 0);
  assert.equal(storage._store.tf2SchemaCache.schemaShapeVersion, SCHEMA_SHAPE_VERSION);
});

test("a stale cache (older than SCHEMA_CACHE_TTL_MS) triggers a refetch and overwrites the stored cache", async () => {
  const stale = {
    itemNameToDefindex: { "Old Item": 1 },
    defindexToItemName: { 1: "Old Item" },
    effectNameToId: {},
    fetchedAt: Date.now() - SCHEMA_CACHE_TTL_MS - 1,
  };
  const { sendMessage, calls } = makeSendMessage({
    itemPages: [{ startKey: null, items: [{ item_name: "New Item", defindex: 2, name: "TF_NEW_ITEM" }] }],
  });
  const storage = fakeStorageLocal({ steamApiKey: "KEY123", tf2SchemaCache: stale });
  globalThis.chrome = { storage: { local: storage }, runtime: { sendMessage } };

  assert.equal(await getItemDefindex("New Item"), 2);
  assert.ok(calls.length > 0);
  assert.equal(storage._store.tf2SchemaCache.itemNameToDefindex["New Item"], 2);
});

test("returns null with no API key configured and no cache to fall back on, without calling sendMessage - except getEffectId, which resolves a static-table effect with no network call at all", async () => {
  const { sendMessage, calls } = makeSendMessage();
  globalThis.chrome = { storage: { local: fakeStorageLocal() }, runtime: { sendMessage } };

  assert.equal(await getItemDefindex("Rocket Launcher"), null);
  assert.equal(await getItemNameByDefindex(205), null);
  // "Burning Flames" is in utils/unusualEffectIds.js's own static table
  // (checked FIRST - see getEffectId's own note), so this resolves without
  // ever touching the schema/network at all, unlike the two calls above.
  assert.equal(await getEffectId("Burning Flames"), 13);
  assert.equal(calls.length, 0);
});

test("falls back to the existing stale cache if a fresh fetch fails", async () => {
  const stale = {
    itemNameToDefindex: { "Old Item": 1 },
    defindexToItemName: { 1: "Old Item" },
    effectNameToId: {},
    fetchedAt: 0,
  };
  const storage = fakeStorageLocal({ steamApiKey: "KEY123", tf2SchemaCache: stale });
  globalThis.chrome = {
    storage: { local: storage },
    runtime: { sendMessage: async () => ({ ok: false, error: "boom" }) },
  };

  assert.equal(await getItemDefindex("Old Item"), 1);
});

test("second concurrent caller within the same in-flight fetch reuses the same schemaPromise instead of triggering a second fetch", async () => {
  const { sendMessage, calls } = makeSendMessage({
    itemPages: [{ startKey: null, items: [{ item_name: "Shared Item", defindex: 7, name: "TF_SHARED" }] }],
  });
  globalThis.chrome = { storage: { local: fakeStorageLocal({ steamApiKey: "KEY123" }) }, runtime: { sendMessage } };

  const [a, b] = await Promise.all([getItemDefindex("Shared Item"), getItemNameByDefindex(7)]);
  assert.equal(a, 7);
  assert.equal(b, "Shared Item");
  // 1 GetSchemaItems page + 1 GetSchemaOverview call, not doubled by the concurrent second caller
  assert.equal(calls.length, 2);
});
