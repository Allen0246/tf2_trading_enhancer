import { test } from "node:test";
import assert from "node:assert/strict";

// skinDetection.js pulls in utils/tf2Schema.js (reads chrome.storage.local /
// chrome.runtime.sendMessage) and utils/warpaints.js (fetches a bundled JSON
// file via chrome.runtime.getURL) - this repo has no module-mocking library,
// so both are faked at the global level instead, matching the cache shape
// each module itself expects. Neither module touches these globals at
// import time (only inside their exported async functions), so it's safe to
// install the fakes here, once, before any test calls detectSkin.
const SCHEMA_DEFINDEX_TO_NAME = {
  1001: "Black Box",
  1002: "Tomislav",
  1003: "Rocket Launcher",
  1004: "Claidheamh Mòr",
};
globalThis.chrome = {
  storage: {
    local: {
      get: async () => ({
        tf2SchemaCache: {
          defindexToItemName: SCHEMA_DEFINDEX_TO_NAME,
          itemNameToDefindex: {},
          effectNameToId: {},
          fetchedAt: Date.now(),
          schemaShapeVersion: 4,
        },
      }),
      set: async () => {},
    },
  },
  runtime: {
    sendMessage: async () => ({ ok: false, error: "no live fetch expected - schema is cache-only for this test file" }),
    getURL: (path) => path,
  },
};
// warpaints.js has its own in-memory-only cache with no TTL check, so this
// fetch only needs to succeed once per test file - each test file is its own
// Node process under node --test, same "one fixture per file" reasoning
// tf2Schema.js's own module-level schemaPromise memoization relies on.
// Deliberately does NOT include "Calavera Canvas Claidheamh Mor" as its own
// exact entry - only the shorter "Calavera Canvas" - so the textureId
// fallback-to-findSkinNamePrefix test below exercises a real exact-match miss.
globalThis.fetch = async () => ({
  json: async () => [
    { name: "Necromanced", defindex: 9001 },
    { name: "Dragon Slayer", defindex: 9002 },
    { name: "Sideshow", defindex: 9003 },
    { name: "Candy Coated", defindex: 9004 },
    { name: "Pink as Hell", defindex: 9005 },
    { name: "Calavera Canvas", defindex: 9006 },
    { name: "Beachy Boy", defindex: 9007 },
  ],
});

const { detectSkin } = await import("../scrap.tf/itemLinks/skinDetection.js");

function fakeItemEl({ defindex = null, dataContent = null } = {}) {
  return {
    getAttribute: (name) => {
      if (name === "data-defindex") return defindex;
      if (name === "data-content") return dataContent;
      return null;
    },
  };
}

test("detectSkin resolves a Decorated Weapon's skin/weapon split via the schema-resolved weapon name suffix", async () => {
  const result = await detectSkin("Necromanced Black Box (Battle Scarred)", fakeItemEl({ defindex: "1001" }), "Unique", null);
  assert.equal(result.isDecoratedWeapon, true);
  assert.equal(result.isWarPaintTool, false);
  assert.equal(result.weaponName, "Black Box");
  assert.equal(result.skinName, "Necromanced");
  assert.equal(result.wearName, "Battle Scarred");
  assert.equal(result.textureId, 9001);
  assert.equal(result.wearTierId, 5);
});

test("detectSkin identifies a standalone War Paint tool (ends in literal 'War Paint') and does not treat it as a Decorated Weapon", () => {
  return detectSkin("Dragon Slayer War Paint (Factory New)", fakeItemEl(), "Decorated Weapon", null).then((result) => {
    assert.equal(result.isWarPaintTool, true);
    assert.equal(result.isDecoratedWeapon, false);
    assert.equal(result.warPaintToolSkinName, "Dragon Slayer");
    assert.equal(result.warPaintToolWearName, "Factory New");
    assert.equal(result.warPaintToolQuality, "Decorated Weapon");
    assert.equal(result.warPaintToolQualityId, "15");
    assert.equal(result.warPaintToolTextureId, 9002);
  });
});

test("detectSkin strips a War Paint tool's own leading quality word before resolving its skin name/quality", async () => {
  const result = await detectSkin("Strange Sideshow War Paint (Factory New)", fakeItemEl(), "Strange", null);
  assert.equal(result.isWarPaintTool, true);
  assert.equal(result.warPaintToolSkinName, "Sideshow");
  assert.equal(result.warPaintToolQuality, "Strange");
  assert.equal(result.warPaintToolQualityId, "11");
  assert.equal(result.warPaintToolTextureId, 9003);
});

// A standalone War Paint TOOL can carry the exact same "★Unusual " marker a
// Decorated Weapon's skin can (see the sibling test just below), but this
// branch never accounted for it at all before - the marker stayed stuck in
// warPaintToolSkinName (breaking the getTextureId lookup against "Beachy
// Boy"), and qualityName never got promoted from "Strange" to "Unusual",
// same "Unusual outranks Strange" rule as the Decorated Weapon case.
test("detectSkin strips the '★Unusual ' marker off a standalone War Paint tool's skin name too, and promotes qualityName to Unusual", async () => {
  const itemEl = fakeItemEl({ dataContent: "Level 1<br>Effect: Hot" });
  const result = await detectSkin("Strange ★Unusual Beachy Boy War Paint (Minimal Wear)", itemEl, "Strange", null);
  assert.equal(result.isWarPaintTool, true);
  assert.equal(result.warPaintToolSkinName, "Beachy Boy");
  assert.equal(result.warPaintToolWearName, "Minimal Wear");
  assert.equal(result.warPaintToolTextureId, 9007);
  assert.equal(result.qualityName, "Unusual");
  assert.equal(result.warPaintToolQuality, "Unusual");
  assert.equal(result.warPaintToolQualityId, "5");
  assert.equal(result.unusualEffectName, "Hot");
  // hasStrangeTracking is captured from the ORIGINAL (pre-promotion)
  // qualityName param, so it stays true even though qualityName itself now
  // reads "Unusual" - see links.js's own sstrange fix, which depends on this.
  assert.equal(result.hasStrangeTracking, true);
});

test("detectSkin strips the '★Unusual ' marker off a Decorated Weapon's skin name and resolves the effect independently of the base item's own quality", async () => {
  const itemEl = fakeItemEl({ defindex: "1002", dataContent: "Level 10<br>Effect: Haunted Ghosts" });
  const result = await detectSkin("Strange ★Unusual Candy Coated Tomislav (Factory New)", itemEl, "Decorated Weapon", null);
  assert.equal(result.isDecoratedWeapon, true);
  assert.equal(result.weaponName, "Tomislav");
  assert.equal(result.skinHasUnusualEffect, true);
  assert.equal(result.skinName, "Candy Coated");
  assert.equal(result.unusualEffectName, "Haunted Ghosts");
  // QualityName resolves to "Unusual", not the "Strange" quality word read
  // off the raw name - the ★Unusual marker means this skin's real, persisted
  // quality is Unusual, with "Strange" just an add-on tracking descriptor
  // (same "Unusual outranks Strange" rule
  // utils/tf2StatsLinks/decoratedWeapon.js's own isUnusual note already
  // establishes) - this used to let skinQualityName ("Strange") override
  // qualityName unconditionally, searching the wrong quality on every
  // classifieds/marketplace.tf/stats link for an Unusual-skinned Decorated
  // Weapon that also carries Strange-tracking.
  assert.equal(result.qualityName, "Unusual");
});

test("detectSkin strips a plain (no Unusual marker) skin quality prefix and overrides qualityName with it", async () => {
  const result = await detectSkin("Vintage Pink as Hell Rocket Launcher (Well-Worn)", fakeItemEl({ defindex: "1003" }), "Decorated Weapon", null);
  assert.equal(result.skinQualityName, "Vintage");
  assert.equal(result.qualityName, "Vintage");
  assert.equal(result.skinName, "Pink as Hell");
  assert.equal(result.weaponName, "Rocket Launcher");
  assert.equal(result.wearTierId, 4);
});

test("detectSkin falls back to findSkinNamePrefix when the exact skin name (with a duplicated weapon-name fragment baked in) doesn't match warpaints.json", async () => {
  const result = await detectSkin(
    "Calavera Canvas Claidheamh Mor Claidheamh Mòr (Field-Tested)",
    fakeItemEl({ defindex: "1004" }),
    "Decorated Weapon",
    null
  );
  assert.equal(result.weaponName, "Claidheamh Mòr");
  // skinName still keeps the duplicated "Claidheamh Mor" fragment - only the
  // textureId lookup itself retries against the shorter canonical name.
  assert.equal(result.skinName, "Calavera Canvas Claidheamh Mor");
  assert.equal(result.textureId, 9006);
});

test("detectSkin leaves every skin field null/false for a plain item with no wear-tier suffix", async () => {
  const result = await detectSkin("Rocket Launcher", fakeItemEl(), "Unique", null);
  assert.equal(result.isDecoratedWeapon, false);
  assert.equal(result.isWarPaintTool, false);
  assert.equal(result.skinName, null);
  assert.equal(result.wearName, null);
  assert.equal(result.weaponName, null);
  assert.equal(result.textureId, null);
  assert.equal(result.warPaintToolTextureId, null);
  assert.equal(result.qualityName, "Unique");
  assert.equal(result.unusualEffectName, null);
});

test("detectSkin recovers a Name-Tagged Decorated Weapon's skin via the scrap.tf skin-preview image when the title has no wear-tier suffix left to parse", async () => {
  // Simulates a Name-Tagged item: resolveCustomNamedItem (itemShape.js) has
  // already resolved the raw "Strange \"<custom name>\"" title down to just
  // "Strange Black Box" before detectSkin ever sees it, losing the
  // "{Skin} {Weapon} ({Wear})" text entirely - the skin-preview image in
  // data-content (untouched by the Name Tag) is the only remaining signal.
  const itemEl = fakeItemEl({
    defindex: "1001",
    dataContent: "<img class='skin-preview' src='/img/items/warpaint/1001_9001_3_1.png'/>",
  });
  const result = await detectSkin("Strange Black Box", itemEl, "Strange", null);
  assert.equal(result.isDecoratedWeapon, true);
  assert.equal(result.weaponName, "Black Box");
  assert.equal(result.skinName, "Necromanced");
  assert.equal(result.wearName, "Field-Tested");
  assert.equal(result.textureId, 9001);
  assert.equal(result.wearTierId, 3);
  assert.equal(result.skinQualityName, "Strange");
  assert.equal(result.qualityName, "Strange");
});

test("detectSkin ignores a skin-preview image whose own weapon defindex doesn't match the item's data-defindex", async () => {
  const itemEl = fakeItemEl({
    defindex: "1001",
    dataContent: "<img class='skin-preview' src='/img/items/warpaint/9999_9001_3_1.png'/>",
  });
  const result = await detectSkin("Strange Black Box", itemEl, "Strange", null);
  assert.equal(result.isDecoratedWeapon, false);
  assert.equal(result.skinName, null);
});

test("detectSkin marks skinWeaponUnresolved and falls back to the full pre-wear text when the schema has no matching defindex", async () => {
  const result = await detectSkin("Mystery Skin Weapon (Factory New)", fakeItemEl({ defindex: "99999" }), "Decorated Weapon", null);
  assert.equal(result.isDecoratedWeapon, true);
  assert.equal(result.weaponName, null);
  assert.equal(result.skinWeaponUnresolved, true);
  assert.equal(result.skinName, "Mystery Skin Weapon");
});
