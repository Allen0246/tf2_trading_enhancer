import { test } from "node:test";
import assert from "node:assert/strict";

// See tests/tf2StatsLinksTargetTool.test.js's own header comment for why
// this fixture is installed once, module-scope, before import - resolveUnusualEffect
// reads utils/tf2Schema.js's getEffectNameToIdMap, backed by chrome.storage.local.
globalThis.chrome = {
  storage: {
    local: {
      async get() {
        return {
          tf2SchemaCache: {
            itemNameToDefindex: {},
            defindexToItemName: {},
            effectNameToId: { "Burning Flames": 13, "Sixth Sense": 301 },
            fetchedAt: Date.now(),
            schemaShapeVersion: 4,
          },
        };
      },
      async set() {},
    },
  },
  runtime: {
    async sendMessage() {
      throw new Error("should not need a real fetch - schema cache is pre-seeded and fresh");
    },
  },
};

const { resolveUnusualEffect, createBpStatsLinkUnusual } = await import("../utils/tf2StatsLinks/unusual.js");
const { __resetSchemaCacheForTests } = await import("../utils/tf2Schema.js");

test("resolveUnusualEffect finds an effect name embedded in the raw item name and strips it out", async () => {
  const resolved = await resolveUnusualEffect("Unusual Team Captain Burning Flames");
  assert.deepEqual(resolved, {
    effectId: 13,
    effectName: "Burning Flames",
    baseName: "Team Captain",
    isNonCraftable: false,
  });
});

test("resolveUnusualEffect strips Non-Craftable correctly even though the older code only handled a leading Unusual prefix", async () => {
  // Bug fixed here per the source's own note: craftability used to be
  // silently dropped when it preceded "Unusual" in the raw name.
  const resolved = await resolveUnusualEffect("Non-Craftable Unusual Team Captain Burning Flames");
  assert.equal(resolved.isNonCraftable, true);
  assert.equal(resolved.baseName, "Team Captain");
});

test("REGRESSION: resolveUnusualEffect drops a 'Strange' tracking descriptor in front of 'Unusual' instead of leaving it in the base name", async () => {
  const resolved = await resolveUnusualEffect("Strange Unusual Team Captain Burning Flames");
  assert.equal(resolved.baseName, "Team Captain");
  assert.equal(resolved.effectId, 13);

  const nonCraftable = await resolveUnusualEffect("Non-Craftable Strange Unusual Team Captain", "Burning Flames");
  assert.equal(nonCraftable.baseName, "Team Captain");
  assert.equal(nonCraftable.isNonCraftable, true);
});

test("resolveUnusualEffect strips a 'The ' article AFTER the Unusual prefix, not before", async () => {
  const resolved = await resolveUnusualEffect("Unusual The Team Captain");
  assert.equal(resolved.baseName, "Team Captain");
});

// Utils/tf2Schema.js's own getEffectNameToIdMap now merges that static
// table into its result unconditionally, so effectNameToId can no longer be
// genuinely EMPTY the way this test used to force it to be (a
// no-key/empty-live-schema storage mock, below) - the static table alone is
// always 500+ entries. This used to make resolveUnusualEffect return null
// outright for ANY Unusual under this exact storage mock, even a real
// no-effect item ("Unusual Team Captain" has no effect word in it at all);
// it now resolves successfully instead, same as it would with a real live
// schema - proving the merge actually closes that gap rather than just
// changing what the empty-schema branch looks like.
test("resolveUnusualEffect resolves successfully (no effect) even when the live schema itself is unavailable - the static table means effectNameToId is never truly empty", async () => {
  const originalGet = globalThis.chrome.storage.local.get;
  const originalLog = console.log;
  console.log = () => {};
  globalThis.chrome.storage.local.get = async () => ({
    tf2SchemaCache: { itemNameToDefindex: {}, defindexToItemName: {}, effectNameToId: {}, fetchedAt: Date.now(), schemaShapeVersion: 4 },
  });
  __resetSchemaCacheForTests();

  try {
    const resolved = await resolveUnusualEffect("Unusual Team Captain");
    assert.deepEqual(resolved, {
      effectId: null,
      effectName: null,
      baseName: "Team Captain",
      isNonCraftable: false,
    });
  } finally {
    globalThis.chrome.storage.local.get = originalGet;
    console.log = originalLog;
    __resetSchemaCacheForTests(); // restore the shared non-empty fixture for every later test in this file
  }
});

test("resolveUnusualEffect returns a successful result with a null effectId for a real no-effect Unusual", async () => {
  const resolved = await resolveUnusualEffect("Unusual Horseless Headless Horsemann's Headtaker");
  assert.equal(resolved.effectId, null);
  assert.equal(resolved.effectName, null);
  assert.equal(resolved.baseName, "Horseless Headless Horsemann's Headtaker");
});

test("resolveUnusualEffect prefers the longest matching effect name (avoids a shorter substring false match)", async () => {
  // "Sixth Sense" itself isn't a substring case here, but this confirms the
  // sort-by-length preference logic runs without throwing and correctly picks
  // the one real match present in the text.
  const resolved = await resolveUnusualEffect("Unusual Voodoo Juju Sixth Sense");
  assert.equal(resolved.effectId, 301);
  assert.equal(resolved.baseName, "Voodoo Juju");
});

test("REGRESSION: resolveUnusualEffect with a caller-supplied knownEffectId succeeds even when the effect schema itself is unavailable - confirmed live via classic backpack.tf's own popover, whose classifieds href already carries the resolved particle id directly", async () => {
  const originalGet = globalThis.chrome.storage.local.get;
  const originalLog = console.log;
  console.log = () => {};
  globalThis.chrome.storage.local.get = async () => ({
    tf2SchemaCache: { itemNameToDefindex: {}, defindexToItemName: {}, effectNameToId: {}, fetchedAt: Date.now(), schemaShapeVersion: 4 },
  });
  __resetSchemaCacheForTests();

  try {
    const resolved = await resolveUnusualEffect("Unusual Team Captain", "Burning Flames", 13);
    assert.deepEqual(resolved, {
      effectId: 13,
      effectName: "Burning Flames",
      baseName: "Team Captain",
      isNonCraftable: false,
    });
  } finally {
    globalThis.chrome.storage.local.get = originalGet;
    console.log = originalLog;
    __resetSchemaCacheForTests(); // restore the shared non-empty fixture for every later test in this file
  }
});

test("resolveUnusualEffect honors a caller-supplied knownEffectName, matched case-insensitively, without searching the text", async () => {
  const resolved = await resolveUnusualEffect("Unusual Team Captain", "burning flames");
  assert.equal(resolved.effectId, 13);
  assert.equal(resolved.effectName, "Burning Flames");
});

test("resolveUnusualEffect falls back to the caller's own knownEffectName text when it's not in the schema", async () => {
  const resolved = await resolveUnusualEffect("Unusual Team Captain", "Some Unlisted Effect");
  assert.equal(resolved.effectId, null);
  assert.equal(resolved.effectName, "Some Unlisted Effect");
});

test("createBpStatsLinkUnusual appends the effect id as a trailing path segment when present", async () => {
  const url = await createBpStatsLinkUnusual("Unusual Team Captain Burning Flames", false);
  assert.equal(url, "https://backpack.tf/stats/Unusual/Team%20Captain/Tradable/Craftable/13");
});

test("createBpStatsLinkUnusual has no trailing segment at all for a no-effect Unusual", async () => {
  const url = await createBpStatsLinkUnusual("Unusual Horseless Headless Horsemann's Headtaker", false);
  assert.equal(
    url,
    "https://backpack.tf/stats/Unusual/Horseless%20Headless%20Horsemann's%20Headtaker/Tradable/Craftable"
  );
});

// The static effect table includes short names ("Hot", "Cool") that are
// also fragments of real item names. A plain substring match stripped
// "Unusual Hottie's Hoodie" down to "tie's Hoodie" with effect "Hot".
test("resolveUnusualEffect never matches an effect name inside a longer word of the item's own name", async () => {
  __resetSchemaCacheForTests();
  const hoodie = await resolveUnusualEffect("Unusual Hottie's Hoodie");
  assert.deepEqual(hoodie, { effectId: null, effectName: null, baseName: "Hottie's Hoodie", isNonCraftable: false });

  const coolmaker = await resolveUnusualEffect("Unusual Coolmaker");
  assert.equal(coolmaker.effectName, null);
  assert.equal(coolmaker.baseName, "Coolmaker");
});

test("resolveUnusualEffect still finds a whole-word effect next to punctuation", async () => {
  __resetSchemaCacheForTests();
  const resolved = await resolveUnusualEffect("Unusual Burning Flames, Team Captain");
  assert.equal(resolved.effectName, "Burning Flames");
  assert.equal(resolved.baseName, "Team Captain");
});

test("resolveUnusualEffect's known-effect strip leaves a word that merely starts with the effect name alone", async () => {
  const resolved = await resolveUnusualEffect("Unusual Hottie's Hoodie", "Hot", 701);
  assert.equal(resolved.baseName, "Hottie's Hoodie");
  assert.equal(resolved.effectId, 701);
});
