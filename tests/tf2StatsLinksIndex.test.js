import { test } from "node:test";
import assert from "node:assert/strict";

// See tests/tf2StatsLinksTargetTool.test.js's own header comment on why a
// single fixture, installed before import, is the right shape here -
// utils/tf2Schema.js and utils/warpaints.js each memoize their result at
// module scope for the loaded module's lifetime, and this file gets its own
// process/module registry from Node's test runner.
globalThis.chrome = {
  storage: {
    local: {
      async get() {
        return {
          tf2SchemaCache: {
            itemNameToDefindex: {
              "Righteous Bison": 40,
              Machina: 200,
              "Voodoo Juju": 300,
              "Rocket Launcher": 205,
              "Team Captain": 378,
            },
            defindexToItemName: {},
            effectNameToId: { "Burning Flames": 13 },
            fetchedAt: Date.now(),
            schemaShapeVersion: 4,
          },
        };
      },
      async set() {},
    },
  },
  runtime: {
    getURL: (path) => path,
    async sendMessage() {
      throw new Error("should not need a real fetch - schema cache is pre-seeded and fresh");
    },
  },
};
globalThis.fetch = async () => ({
  json: async () => [{ name: "Necromanced", defindex: 100 }],
});

const {
  resolveStatsAndClassifieds,
  createSteamMarketLink,
  stripStarMarker,
  buildSteamMarketName,
  buildStnTradingHref,
  buildPricedbSearchName,
  buildGladiatorHref,
  isUnusualEffectIdUnresolved,
  ITEMS_CRAFTABILITY,
  stripQualityPrefix,
} =
  await import("../utils/tf2StatsLinks/index.js");
const { __resetSchemaCacheForTests } = await import("../utils/tf2Schema.js");

test("index.js re-exports common.js's craftability constant and stripQualityPrefix for stntrading.eu's own direct use", () => {
  assert.deepEqual(ITEMS_CRAFTABILITY, ["Craftable", "Non-Craftable"]);
  assert.deepEqual(stripQualityPrefix("Strange Genuine Wrangler"), { name: "Wrangler", quality: "Genuine" });
});

test("resolveStatsAndClassifieds builds a plain-item stats link with no schema lookup involved", async () => {
  const result = await resolveStatsAndClassifieds("Strange Voodoo Juju");
  assert.equal(result.bpStatsHref, "https://backpack.tf/stats/Strange/Voodoo%20Juju/Tradable/Craftable");
  assert.equal(result.statsUnresolved, false);
  assert.equal(result.classifiedsFilters.itemName, "Voodoo Juju");
  assert.equal(result.classifiedsFilters.quality, "Strange");
});

test("resolveStatsAndClassifieds dispatches to the Unusual branch and resolves the effect id", async () => {
  const result = await resolveStatsAndClassifieds("Unusual Team Captain Burning Flames");
  assert.match(result.bpStatsHref, /\/Unusual\/Team%20Captain\/Tradable\/Craftable\/13$/);
  assert.equal(result.classifiedsFilters.effectId, 13);
  assert.equal(result.statsUnresolved, false);
});

test("REGRESSION: resolveStatsAndClassifieds resolves an Unusual's marketplaceHref/classifiedsFilters even when the effect schema is unavailable - previously the WHOLE item (not just the effect filter) got no links at all without a Steam Web API key", async () => {
  const originalGet = globalThis.chrome.storage.local.get;
  const originalLog = console.log;
  console.log = () => {};
  globalThis.chrome.storage.local.get = async () => ({
    tf2SchemaCache: { itemNameToDefindex: {}, defindexToItemName: {}, effectNameToId: {}, fetchedAt: Date.now(), schemaShapeVersion: 4 },
  });
  __resetSchemaCacheForTests();

  try {
    // knownEffectName alone (no knownEffectId, and this test's own storage
    // mock leaves the LIVE schema empty) used to fail the WHOLE item - seen
    // for stntrading.eu, which only ever has the effect NAME available (its
    // own "★ Unusual Effect: X" label), never a numeric id. Now degrades
    // gracefully instead: a real classifiedsFilters comes back with
    // effectId: null, and marketplaceHref still builds (using its own
    // "-2"/no-filter sentinel for the unresolved effect id) rather than
    // being null outright - see resolveUnusualEffect's own note on this
    // exact fallback.
    //
    // This used to use "Burning Flames" here, a REAL effect that's since
    // become resolvable with no live schema at all now that
    // utils/tf2Schema.js's own getEffectNameToIdMap merges in
    // utils/unusualEffectIds.js's own static table - which meant effectId
    // was no longer actually null here, defeating the whole point of this
    // scenario. A genuinely made-up name (not a real TF2 effect, so it's in
    // neither table) keeps this test actually exercising the "truly
    // unresolvable" fallback it's meant to.
    const nameOnly = await resolveStatsAndClassifieds("Unusual Team Captain", { knownEffectName: "Not A Real Effect" });
    assert.notEqual(nameOnly.classifiedsFilters, null);
    assert.equal(nameOnly.classifiedsFilters.effectName, "Not A Real Effect");
    assert.equal(nameOnly.classifiedsFilters.effectId, null);
    assert.equal(nameOnly.classifiedsFilters.itemName, "Team Captain");
    assert.notEqual(nameOnly.marketplaceHref, null);
    assert.equal(new URL(nameOnly.marketplaceHref).searchParams.get("seffect[]"), "-2");

    const withId = await resolveStatsAndClassifieds("Unusual Team Captain", {
      knownEffectName: "Burning Flames",
      knownEffectId: 13,
    });
    assert.equal(withId.classifiedsFilters.effectId, 13);
    assert.equal(new URL(withId.marketplaceHref).searchParams.get("seffect[]"), "13");
  } finally {
    globalThis.chrome.storage.local.get = originalGet;
    console.log = originalLog;
    __resetSchemaCacheForTests(); // restore the shared non-empty fixture for every later test in this file
  }
});

test("resolveUnusualEffect strips a known effect name baked into the raw text itself (e.g. stntrading.eu's own title), unlike a caller whose name never had it there to begin with", async () => {
  const originalGet = globalThis.chrome.storage.local.get;
  const originalLog = console.log;
  console.log = () => {};
  globalThis.chrome.storage.local.get = async () => ({
    tf2SchemaCache: { itemNameToDefindex: {}, defindexToItemName: {}, effectNameToId: {}, fetchedAt: Date.now(), schemaShapeVersion: 4 },
  });
  __resetSchemaCacheForTests();

  try {
    const bakedIn = await resolveStatsAndClassifieds("Unusual Otherworldly Weather Mean Captain", {
      knownEffectName: "Otherworldly Weather",
    });
    assert.equal(bakedIn.classifiedsFilters.itemName, "Mean Captain");

    const notBakedIn = await resolveStatsAndClassifieds("Unusual Mean Captain", { knownEffectName: "Otherworldly Weather" });
    assert.equal(notBakedIn.classifiedsFilters.itemName, "Mean Captain");
  } finally {
    globalThis.chrome.storage.local.get = originalGet;
    console.log = originalLog;
    __resetSchemaCacheForTests();
  }
});

test("resolveStatsAndClassifieds sets statsUnresolved when a schema-backed lookup (target tool defindex) fails, but not for a plain item", async () => {
  const unresolved = await resolveStatsAndClassifieds("Some Unknown Weapon Strangifier");
  assert.equal(unresolved.bpStatsHref, null);
  assert.equal(unresolved.statsUnresolved, true);

  const resolved = await resolveStatsAndClassifieds("Righteous Bison Strangifier");
  assert.equal(resolved.statsUnresolved, false);
  assert.match(resolved.bpStatsHref, /\/40$/);
});

test("resolveStatsAndClassifieds dispatches Killstreak Kit and Fabricator to their own stats-link builders, not the generic path", async () => {
  const kit = await resolveStatsAndClassifieds("Professional Killstreak Machina Kit");
  assert.match(kit.bpStatsHref, /Professional%20Killstreak%20Kit.*3-200$/);
  assert.equal(kit.classifiedsFilters.killstreakKit.targetName, "Machina");

  const fabricator = await resolveStatsAndClassifieds("Professional Killstreak Machina Kit Fabricator");
  assert.match(fabricator.bpStatsHref, /Fabricator.*6526-6-200$/);
  assert.equal(fabricator.classifiedsFilters.fabricatorKit.targetName, "Machina");
});

// A Kit Fabricator's own finished Kit has a fixed Sheen/Killstreaker shown
// right on its own item panel - an earlier assumption that a Fabricator
// (unlike a Kit) has no fixed Sheen/Killstreaker of its own was confirmed
// live wrong. Both the resolved id (used by marketplace.tf/backpack.tf's own
// numeric params) and the raw name (used by mannco.store/Steam Market's own
// literal-text params) must be attached for both fabricatorKit and
// killstreakKit. marketplace.tf's own buildMarketplaceLink already read
// fabricatorKit's sheenId/killstreakerId correctly (its own shared
// fabricatorKit/killstreakKit branch) - it just never RECEIVED them for a
// Fabricator, since nothing supplied a real
// knownSheenName/knownKillstreakerName for one until the Fabricator-output
// DOM fallback (itemQuickLinks/content.js's own
// findFabricatorOutputSheenAndKillstreaker) was added. Confirms the full
// pipeline now produces the confirmed-live URL shape end to end.
test("resolveStatsAndClassifieds's marketplaceHref includes sks[]/ske[] for a Fabricator once its Sheen/Killstreaker are known", async () => {
  const result = await resolveStatsAndClassifieds("Professional Killstreak Minigun Kit Fabricator", {
    knownSheenName: "Mean Green",
    knownKillstreakerName: "Fire Horns",
  });
  const url = new URL(result.marketplaceHref);
  assert.equal(url.searchParams.get("sks[]"), "4");
  assert.equal(url.searchParams.get("ske[]"), "2002");
  assert.equal(url.searchParams.get("stype"), "Fabricator");
  assert.equal(url.searchParams.get("sterm"), "Minigun");
});

test("resolveStatsAndClassifieds attaches sheen/killstreaker ids AND names to both fabricatorKit and killstreakKit when known", async () => {
  const knownSignals = { knownSheenName: "Mean Green", knownKillstreakerName: "Fire Horns" };

  const fabricator = await resolveStatsAndClassifieds("Professional Killstreak Minigun Kit Fabricator", knownSignals);
  assert.equal(fabricator.classifiedsFilters.fabricatorKit.sheenId, 4);
  assert.equal(fabricator.classifiedsFilters.fabricatorKit.killstreakerId, 2002);
  assert.equal(fabricator.classifiedsFilters.fabricatorKit.sheenName, "Mean Green");
  assert.equal(fabricator.classifiedsFilters.fabricatorKit.killstreakerName, "Fire Horns");

  const kit = await resolveStatsAndClassifieds("Professional Killstreak Minigun Kit", knownSignals);
  assert.equal(kit.classifiedsFilters.killstreakKit.sheenId, 4);
  assert.equal(kit.classifiedsFilters.killstreakKit.killstreakerId, 2002);
  assert.equal(kit.classifiedsFilters.killstreakKit.sheenName, "Mean Green");
  assert.equal(kit.classifiedsFilters.killstreakKit.killstreakerName, "Fire Horns");
});

// New feature: Sheen/Killstreaker filtering is user-toggleable, default on -
// utils/sheenKillstreakerFilterSetting.js's own
// isSheenKillstreakerFilterEnabled, checked once at the top of
// resolveClassifiedsFilters. When off, every branch (generic Killstreak
// weapon, killstreakKit, fabricatorKit) resolves null
// sheenId/killstreakerId/sheenName/killstreakerName, same as if the caller
// never supplied a known name - but Killstreak TIER itself (a separate,
// always-on categorization) must stay correct regardless, since it's derived
// by the CALLER from the same raw known* names before this function is ever
// called, not by this function itself.
test("resolveStatsAndClassifieds resolves null sheenId/killstreakerId/sheenName/killstreakerName across every branch when the Sheen/Killstreaker filter setting is off, without touching Killstreak tier", async () => {
  const originalGet = globalThis.chrome.storage.local.get;
  globalThis.chrome.storage.local.get = async () => ({ sheenKillstreakerFilterEnabled: false });

  try {
    const knownSignals = { knownSheenName: "Mean Green", knownKillstreakerName: "Fire Horns" };

    const genericWeapon = await resolveStatsAndClassifieds("Professional Killstreak Rocket Launcher", knownSignals);
    assert.equal(genericWeapon.classifiedsFilters.sheenId, null);
    assert.equal(genericWeapon.classifiedsFilters.killstreakerId, null);
    // Tier is parsed straight off the name (stripKillstreakWeaponPrefix), not
    // derived from knownSheenName/knownKillstreakerName - unaffected by this
    // toggle.
    assert.equal(genericWeapon.classifiedsFilters.killstreakTier, 3);
    assert.equal(new URL(genericWeapon.classifiedsHref).searchParams.get("sheen"), null);
    assert.equal(new URL(genericWeapon.classifiedsHref).searchParams.get("killstreaker"), null);
    assert.equal(new URL(genericWeapon.marketplaceHref).searchParams.get("sks[]"), null);
    assert.equal(new URL(genericWeapon.marketplaceHref).searchParams.get("ske[]"), null);

    const fabricator = await resolveStatsAndClassifieds("Professional Killstreak Minigun Kit Fabricator", knownSignals);
    assert.equal(fabricator.classifiedsFilters.fabricatorKit.sheenId, null);
    assert.equal(fabricator.classifiedsFilters.fabricatorKit.killstreakerId, null);
    assert.equal(fabricator.classifiedsFilters.fabricatorKit.sheenName, null);
    assert.equal(fabricator.classifiedsFilters.fabricatorKit.killstreakerName, null);
    // The Fabricator's own target tier (Professional) is a fabricatorKit
    // field parsed off the name (matchFabricatorKit), not derived from
    // knownSheenName/knownKillstreakerName either.
    assert.equal(fabricator.classifiedsFilters.fabricatorKit.tier, 3);

    const kit = await resolveStatsAndClassifieds("Professional Killstreak Minigun Kit", knownSignals);
    assert.equal(kit.classifiedsFilters.killstreakKit.sheenId, null);
    assert.equal(kit.classifiedsFilters.killstreakKit.killstreakerId, null);
    assert.equal(kit.classifiedsFilters.killstreakKit.sheenName, null);
    assert.equal(kit.classifiedsFilters.killstreakKit.killstreakerName, null);

    assert.equal(new URL(createSteamMarketLink("Non-Craftable Professional Killstreak Minigun Kit Fabricator", fabricator.classifiedsFilters)).search, "");
  } finally {
    globalThis.chrome.storage.local.get = originalGet;
  }
});

test("resolveStatsAndClassifieds dispatches a Decorated Weapon over the generic path, resolving its weapon+skin", async () => {
  const result = await resolveStatsAndClassifieds("Necromanced Machina (Factory New)");
  assert.equal(result.classifiedsFilters.decoratedWeapon.weaponName, "Machina");
  assert.equal(result.classifiedsFilters.decoratedWeapon.skinName, "Necromanced");
});

// REGRESSION for a live bug report: steamcommunity.com/itemQuickLinks/
// content.js's own market-link resolution now hands this function a full
// Steam market_hash_name, which can carry a Killstreak-tier adjective
// BETWEEN quality and the skin name (e.g. "Strange Professional Killstreak
// Dead Reckoner Revolver (Factory New)") - before decoratedWeapon.js's own
// fix, matchDecoratedWeapon never matched that shape at all, so this fell
// through to the GENERIC branch instead, building a next.backpack.tf
// classifieds link with the raw "Dead Reckoner Revolver (Factory New)" text
// as itemName and texture=none, instead of itemName=Revolver + a resolved
// texture id.
test("resolveStatsAndClassifieds dispatches a Killstreak-attached Decorated Weapon's FULL market_hash_name (quality + Killstreak tier + skin + weapon + wear all together) to the Decorated Weapon builder, not the generic one", async () => {
  const result = await resolveStatsAndClassifieds("Strange Professional Killstreak Necromanced Machina (Factory New)", {
    knownSheenName: "Team Shine",
    knownKillstreakerName: "Fire Horns",
    knownKillstreakTier: 3,
  });

  assert.equal(result.classifiedsFilters.decoratedWeapon.weaponName, "Machina");
  assert.equal(result.classifiedsFilters.decoratedWeapon.skinName, "Necromanced");
  assert.equal(result.classifiedsFilters.decoratedWeapon.isStrange, true);
  assert.equal(result.classifiedsFilters.decoratedWeapon.killstreakTier, 3);

  const classifiedsUrl = new URL(result.nextClassifiedsHref);
  assert.equal(classifiedsUrl.searchParams.get("itemName"), "Machina");
  assert.notEqual(classifiedsUrl.searchParams.get("texture"), "none");
});

// REGRESSION for a live bug report: Steam's own market_hash_name for an
// Unusual Decorated Weapon with a Killstreak Kit attached (e.g. "Strange
// Unusual Professional Killstreak Star Crossed Iron Bomber (Factory New)")
// contains the literal word "Unusual" - resolveClassifiedsFilters' own
// `name.includes("Unusual")` branch used to run BEFORE matchDecoratedWeapon
// was ever attempted, so this always took that branch instead (which has no
// killstreakTier/texture handling at all), producing a classifieds link
// with the raw unstripped skin+weapon+wear text as itemName, texture=none,
// and killstreakTier=0 despite a real Killstreak Kit being attached.
test("resolveStatsAndClassifieds dispatches a Killstreak-attached UNUSUAL Decorated Weapon's FULL market_hash_name to the Decorated Weapon builder, not the plain-Unusual branch", async () => {
  const result = await resolveStatsAndClassifieds("Strange Unusual Professional Killstreak Necromanced Machina (Factory New)", {
    knownEffectName: "Burning Flames",
    knownSheenName: "Team Shine",
    knownKillstreakerName: "Fire Horns",
    knownKillstreakTier: 3,
  });

  assert.equal(result.classifiedsFilters.decoratedWeapon.weaponName, "Machina");
  assert.equal(result.classifiedsFilters.decoratedWeapon.skinName, "Necromanced");
  assert.equal(result.classifiedsFilters.decoratedWeapon.isStrange, true);
  assert.equal(result.classifiedsFilters.decoratedWeapon.isUnusual, true);
  assert.equal(result.classifiedsFilters.decoratedWeapon.killstreakTier, 3);
  assert.equal(result.classifiedsFilters.decoratedWeapon.effectId, 13); // Burning Flames

  const classifiedsUrl = new URL(result.nextClassifiedsHref);
  assert.equal(classifiedsUrl.searchParams.get("itemName"), "Machina");
  assert.equal(classifiedsUrl.searchParams.get("quality"), "5"); // Unusual, not Strange (11) or Decorated Weapon (15)
  assert.equal(classifiedsUrl.searchParams.get("killstreakTier"), "3");
  assert.notEqual(classifiedsUrl.searchParams.get("texture"), "none");

  const statsUrl = new URL(result.nextBpStatsHref);
  assert.equal(statsUrl.searchParams.get("quality"), "Unusual");
});

// The Steam Market listing pages and stntrading.eu pass the market_hash_name
// with no knownKillstreakTier at all. The tier printed in that name must
// still reach every classifieds/marketplace.tf link, or killstreak_tier=0
// filters out the very item being looked at.
test("resolveStatsAndClassifieds takes a Decorated Weapon's Killstreak tier from its market_hash_name when no knownKillstreakTier is given", async () => {
  const result = await resolveStatsAndClassifieds("Strange Professional Killstreak Necromanced Machina (Factory New)");

  assert.equal(result.classifiedsFilters.decoratedWeapon.killstreakTier, 3);
  assert.equal(new URL(result.nextClassifiedsHref).searchParams.get("killstreakTier"), "3");
  assert.equal(new URL(result.classifiedsHref).searchParams.get("killstreak_tier"), "3");
  assert.equal(new URL(result.marketplaceHref).searchParams.get("skillstreak"), "3");
});

test("resolveStatsAndClassifieds prefers a caller's knownKillstreakTier over the tier parsed from a Decorated Weapon's name", async () => {
  const result = await resolveStatsAndClassifieds("Necromanced Machina (Factory New)", { knownKillstreakTier: 2 });
  assert.equal(result.classifiedsFilters.decoratedWeapon.killstreakTier, 2);
});

test("resolveStatsAndClassifieds dispatches a standalone War Paint tool without attempting Decorated Weapon detection", async () => {
  const result = await resolveStatsAndClassifieds("Dragon Slayer War Paint (Factory New)");
  assert.equal(result.classifiedsFilters.warPaintTool.skinName, "Dragon Slayer");
  assert.equal(result.classifiedsFilters.decoratedWeapon, undefined);
});

test("resolveStatsAndClassifieds's generic branch resolves Festivized + Killstreak tier + Australium together, in the confirmed-live order", async () => {
  // Confirmed-live case from resolveClassifiedsFilters' own note: Killstreak
  // must be stripped before the Australium check, or "Professional
  // Killstreak Australium ..." never matches /^Australium /i.
  const result = await resolveStatsAndClassifieds("Strange Festivized Professional Killstreak Australium Rocket Launcher");
  const filters = result.classifiedsFilters;
  assert.equal(filters.itemName, "Rocket Launcher");
  assert.equal(filters.isFestivized, true);
  assert.equal(filters.killstreakTier, 3);
  assert.equal(filters.isAustralium, true);
});

// "Australium Gold" is a real Paint can name (PAINT_IDS), not an
// Australium weapon variant - the isAustralium check used to strip
// "Australium " unconditionally, treating it as Australium + a nonexistent
// "Gold" weapon and silently breaking every schema-backed lookup built
// from the wrongly-stripped remainder.
test("never treats the Paint can 'Australium Gold' as an Australium weapon variant", async () => {
  const result = await resolveStatsAndClassifieds("Australium Gold");
  const filters = result.classifiedsFilters;
  assert.equal(filters.isAustralium, false);
  assert.equal(filters.itemName, "Australium Gold");
});

// A Paint Can's own row/hover never got a paint filter of its own -
// classicPaintId/nextPaintId only ever came from a caller-supplied
// knownPaintName (a DIFFERENT, already-painted item's own "Painted X"
// tooltip), which a Paint Can itself never has. Searching next.backpack.tf
// with no paint filter (paint=none) for a Paint Can returns an EMPTY result
// - confirmed live. Self-matching the item's own name against PAINT_IDS
// fixes it, including for "Australium Gold" specifically (the literal word
// "Australium" must not prevent the self-match).
test("self-matches a Paint Can's own name against PAINT_IDS so its classifieds/marketplace searches carry a paint filter", async () => {
  const result = await resolveStatsAndClassifieds("Aged Moustache Grey");
  const filters = result.classifiedsFilters;

  const next = new URL(result.nextClassifiedsHref);
  assert.equal(next.searchParams.get("paint"), "5038");

  const classic = new URL(result.classifiedsHref);
  assert.equal(classic.searchParams.get("paint"), String(parseInt("7e7e7e", 16)));

  const market = new URL(result.marketplaceHref);
  assert.equal(market.searchParams.get("spaint[]"), String(parseInt("7e7e7e", 16)));
});

test("self-matches even the Paint Can 'Australium Gold' (the literal 'Australium' prefix must not block the paint self-match)", async () => {
  const result = await resolveStatsAndClassifieds("Australium Gold");
  const next = new URL(result.nextClassifiedsHref);
  assert.equal(next.searchParams.get("paint"), "5037");
});

// A genuine Australium weapon still resolves normally - confirms the fix is
// scoped to the one known false positive, not a blanket "never Australium".
test("still treats a real Australium weapon as Australium", async () => {
  const result = await resolveStatsAndClassifieds("Australium Rocket Launcher");
  const filters = result.classifiedsFilters;
  assert.equal(filters.isAustralium, true);
  assert.equal(filters.itemName, "Rocket Launcher");
});

// REGRESSION for a live bug report: "Strange Vintage Camera Beard" is
// genuinely Vintage-quality (3), with "Strange" just an add-on Strange-
// tracking descriptor - same confirmed-live pattern already fixed for the
// Decorated Weapon case (see decoratedWeapon.js's own isUnusual note),
// generalized in stripQualityPrefix for the generic (non-decorated) branch.
// Before this fix, "Strange" was stripped as the quality (11) and "Vintage"
// was left stuck onto itemName instead ("Vintage Camera Beard"), so the
// classifieds link searched for a literally nonexistent item name under the
// wrong quality entirely.
test("resolveStatsAndClassifieds's generic branch prioritizes a SECOND quality word over a leading 'Strange' add-on descriptor", async () => {
  const result = await resolveStatsAndClassifieds("Strange Vintage Camera Beard");
  const filters = result.classifiedsFilters;
  assert.equal(filters.itemName, "Camera Beard");
  assert.equal(filters.quality, "Vintage");

  const url = new URL(result.nextClassifiedsHref);
  assert.equal(url.searchParams.get("itemName"), "Camera Beard");
  assert.equal(url.searchParams.get("quality"), "3"); // Vintage, not Strange (11)

  // marketplace.tf's own generic branch reads filters.quality/itemName
  // directly (buildMarketplaceLink) - no separate fix needed there, this
  // just pins that it inherits the same correction automatically.
  const marketUrl = new URL(result.marketplaceHref);
  assert.equal(marketUrl.searchParams.get("squality[]"), "3"); // Vintage
  assert.equal(marketUrl.searchParams.get("sstrange"), "0");
  assert.equal(marketUrl.searchParams.get("sterm"), "Camera Beard");
});

// Next.backpack.tf's own /stats/{quality}/{name}/... path - the same shared
// path shape createBpStatsLink uses for every other plain item - redirects
// client-side into a query-string ?item=...&quality=... route that treats the
// WHOLE name segment as one literal item name. For an Australium weapon
// that's "Australium {Weapon}", which 404s - the correct query splits
// Australium into its own boolean param with the bare weapon name in item=.
// Classic backpack.tf needs no such change (confirmed live its own /stats/
// path resolves an embedded "Australium {Weapon}" name segment fine), so
// bpStatsHref keeps the old embedded-name shape.
test("resolveStatsAndClassifieds's generic branch splits Australium into next.backpack.tf's own boolean param for the stats link, but keeps it embedded for classic backpack.tf's", async () => {
  const result = await resolveStatsAndClassifieds("Strange Australium Rocket Launcher");

  const next = new URL(result.nextBpStatsHref);
  assert.equal(next.origin + next.pathname, "https://next.backpack.tf/stats");
  assert.equal(next.searchParams.get("item"), "Rocket Launcher");
  assert.equal(next.searchParams.get("quality"), "Strange");
  assert.equal(next.searchParams.get("australium"), "true");

  assert.equal(result.bpStatsHref, "https://backpack.tf/stats/Strange/Australium%20Rocket%20Launcher/Tradable/Craftable");
});

// Same "Australium Gold" false positive as resolveClassifiedsFilters'
// own fix above, but in buildStatsLink's own separate
// next.backpack.tf-specific branch - the Paint can's stats link used to
// redirect into the boolean-param query shape (item=Gold&
// australium=true), searching for a nonexistent "Gold" item instead of
// resolving its own real /stats/Unique/Australium%20Gold/... path.
test("never redirects the Paint can 'Australium Gold' into next.backpack.tf's own Australium boolean-param shape", async () => {
  const result = await resolveStatsAndClassifieds("Australium Gold");

  const next = new URL(result.nextBpStatsHref);
  assert.equal(next.searchParams.get("australium"), null);
  assert.match(result.nextBpStatsHref, /\/stats\/Unique\/Australium%20Gold\//);
});

test("resolveStatsAndClassifieds's classifieds/next-classifieds hrefs use each site's own boolean convention", async () => {
  const result = await resolveStatsAndClassifieds("Non-Craftable Strange Rocket Launcher");
  const classic = new URL(result.classifiedsHref);
  assert.equal(classic.searchParams.get("craftable"), "-1");
  const next = new URL(result.nextClassifiedsHref);
  assert.equal(next.searchParams.get("craftable"), "0");
});

test("resolveStatsAndClassifieds's nextClassifiedsHref sends particle=none/texture=none explicitly for a plain (non-Unusual, non-Decorated) item", async () => {
  const result = await resolveStatsAndClassifieds("Strange Rocket Launcher");
  const next = new URL(result.nextClassifiedsHref);
  assert.equal(next.searchParams.get("particle"), "none");
  assert.equal(next.searchParams.get("texture"), "none");
});

// Classic's own "spell" param used to be omitted entirely when absent - now
// confirmed it wants the same explicit sentinel treatment next.backpack.tf's
// own "none" already gets, just its own capitalized "None" instead.
test("resolveStatsAndClassifieds's nextClassifiedsHref sends spell=none by default, or the resolved id when knownSpellName is given; classic sends the literal name or 'None'", async () => {
  const noSpell = await resolveStatsAndClassifieds("Strange Rocket Launcher");
  assert.equal(new URL(noSpell.nextClassifiedsHref).searchParams.get("spell"), "none");
  assert.equal(new URL(noSpell.classifiedsHref).searchParams.get("spell"), "None");

  const withSpell = await resolveStatsAndClassifieds("Strange Rocket Launcher", { knownSpellName: "exorcism" });
  assert.equal(new URL(withSpell.nextClassifiedsHref).searchParams.get("spell"), "weapon-SPELL: Halloween death ghosts");
  assert.equal(new URL(withSpell.classifiedsHref).searchParams.get("spell"), "exorcism");
});

test("resolveStatsAndClassifieds's marketplaceHref sends sspell as marketplace.tf's own slug (not SPELL_IDS' composite id, not the literal name) only when a spell is present", async () => {
  const noSpell = await resolveStatsAndClassifieds("Strange Rocket Launcher");
  assert.equal(new URL(noSpell.marketplaceHref).searchParams.has("sspell"), false);

  const withSpell = await resolveStatsAndClassifieds("Strange Rocket Launcher", { knownSpellName: "Exorcism" });
  assert.equal(new URL(withSpell.marketplaceHref).searchParams.get("sspell"), "effect_exorcism");
});

test("resolveStatsAndClassifieds's marketplaceHref sends spaint[] as the decimal-RGB id (not next.backpack.tf's own numeric paint id) only when a Paint is present, and never for an Unusual", async () => {
  const noPaint = await resolveStatsAndClassifieds("Team Captain");
  assert.equal(new URL(noPaint.marketplaceHref).searchParams.has("spaint[]"), false);

  const withPaint = await resolveStatsAndClassifieds("Team Captain", { knownPaintName: "A Deep Commitment to Purple" });
  assert.equal(new URL(withPaint.marketplaceHref).searchParams.get("spaint[]"), "8208497"); // 0x7d4071

  // Confirmed live: filtering by paint color on top of an Unusual's own
  // effect search would cut wanted results - see resolveClassifiedsFilters'
  // own classicPaintId note.
  const unusualWithPaint = await resolveStatsAndClassifieds("Unusual Team Captain", {
    knownPaintName: "A Deep Commitment to Purple",
  });
  assert.equal(new URL(unusualWithPaint.marketplaceHref).searchParams.has("spaint[]"), false);
});

// REGRESSION for a live bug report: classicPaintId/nextPaintId (now
// nextPaintId) were already resolved by resolveClassifiedsFilters and
// already flowed correctly into marketplaceHref's own spaint[] param (see
// the test above) and postsTfHref's own paint field, but were never actually
// read by buildClassifiedsLink itself - a painted plain item's (e.g. a
// painted Strange hat) classifieds link on BOTH sites never filtered by
// paint at all.
test("resolveStatsAndClassifieds's classifiedsHref/nextClassifiedsHref both send a paint filter for a painted plain item, using each site's own distinct id encoding, and never for an Unusual", async () => {
  const noPaint = await resolveStatsAndClassifieds("Team Captain");
  assert.equal(new URL(noPaint.classifiedsHref).searchParams.has("paint"), false);
  assert.equal(new URL(noPaint.nextClassifiedsHref).searchParams.get("paint"), "none");

  const withPaint = await resolveStatsAndClassifieds("Strange Team Captain", { knownPaintName: "A Deep Commitment to Purple" });
  assert.equal(new URL(withPaint.classifiedsHref).searchParams.get("paint"), "8208497"); // classic: decimal-RGB (0x7d4071)
  assert.equal(new URL(withPaint.nextClassifiedsHref).searchParams.get("paint"), "5031"); // next: PAINT_IDS' own numeric id

  // This used to still send an explicit "paint=none" on next.backpack.tf's
  // own side for an Unusual (the "none" fallback firing since nextPaintId is
  // never populated for one to begin with) - actively wrong, since filtering
  // by paint color on top of an Unusual's own effect search would cut wanted
  // results (same exclusion marketplaceHref's own spaint[] already has - see
  // resolveClassifiedsFilters' own classicPaintId/nextPaintId note) - the
  // param must be OMITTED entirely for an Unusual, not sent as "none".
  const unusualWithPaint = await resolveStatsAndClassifieds("Unusual Team Captain", {
    knownEffectName: "Burning Flames",
    knownPaintName: "A Deep Commitment to Purple",
  });
  assert.equal(new URL(unusualWithPaint.classifiedsHref).searchParams.has("paint"), false);
  assert.equal(new URL(unusualWithPaint.nextClassifiedsHref).searchParams.has("paint"), false);
});

test("resolveStatsAndClassifieds's marketplaceHref never sends sspell for an Unusual (same reasoning as spaint[]), but nextClassifiedsHref's own 'spell' param still applies (scrap.tf's own confirmed-live buildNextClassifiedsHref does not exclude Unusual there - this is a marketplace.tf-only choice)", async () => {
  const unusualWithSpell = await resolveStatsAndClassifieds("Unusual Team Captain", { knownSpellName: "Exorcism" });
  assert.equal(new URL(unusualWithSpell.marketplaceHref).searchParams.has("sspell"), false);
  assert.equal(
    new URL(unusualWithSpell.nextClassifiedsHref).searchParams.get("spell"),
    "weapon-SPELL: Halloween death ghosts"
  );

  const plainWithSpell = await resolveStatsAndClassifieds("Strange Rocket Launcher", { knownSpellName: "Exorcism" });
  assert.equal(new URL(plainWithSpell.marketplaceHref).searchParams.get("sspell"), "effect_exorcism");
});

test("resolveStatsAndClassifieds's marketplaceHref sends sbotkiller as '{grade}_{roman tier}' and searches sterm by the bare weapon name for a Botkiller weapon - previously always hardcoded sbotkiller=none and searched the full Botkiller name (confirmed live via scrap.tf/itemLinks/links.js's own buildMarketplaceHref: sbotkiller=Carbonado_I&sterm=Wrench)", async () => {
  const result = await resolveStatsAndClassifieds("Strange Diamond Botkiller Sniper Rifle Mk.I");
  const url = new URL(result.marketplaceHref);
  assert.equal(url.searchParams.get("sbotkiller"), "Diamond_I");
  assert.equal(url.searchParams.get("sterm"), "Sniper Rifle");
});

test("resolveStatsAndClassifieds's marketplaceHref sends sbotkiller=none (not a Botkiller grade) for a plain, non-Botkiller weapon", async () => {
  const result = await resolveStatsAndClassifieds("Strange Sniper Rifle");
  const url = new URL(result.marketplaceHref);
  assert.equal(url.searchParams.get("sbotkiller"), "none");
  assert.equal(url.searchParams.get("sterm"), "Sniper Rifle");
});

test("resolveStatsAndClassifieds threads knownSheenName/knownKillstreakerName into a Killstreak Kit's classifieds search", async () => {
  const result = await resolveStatsAndClassifieds("Professional Killstreak Machina Kit", {
    knownSheenName: "hot rod",
    knownKillstreakerName: "incinerator",
  });
  const classic = new URL(result.classifiedsHref);
  assert.equal(classic.searchParams.get("sheen"), "7");
  assert.equal(classic.searchParams.get("killstreaker"), "2007");
});

test("resolveStatsAndClassifieds's marketplaceHref reflects the Collector's quality's own minimal param set", async () => {
  const result = await resolveStatsAndClassifieds("Collector's Voodoo Juju");
  const url = new URL(result.marketplaceHref);
  assert.equal(url.searchParams.get("squality[]"), "14");
  assert.equal(url.searchParams.get("sterm"), "Voodoo Juju");
  assert.equal(url.searchParams.has("spaintkit"), false);
});

test("resolveStatsAndClassifieds's marketplaceHref/classifiedsHref dispatch to the War Paint tool builder", async () => {
  const result = await resolveStatsAndClassifieds("Strange Dragon Slayer War Paint (Factory New)");

  const marketUrl = new URL(result.marketplaceHref);
  assert.equal(marketUrl.searchParams.get("squality[]"), "11");
  assert.equal(marketUrl.searchParams.get("sterm"), "Dragon Slayer War Paint");

  const classifiedsUrl = new URL(result.classifiedsHref);
  assert.equal(classifiedsUrl.origin + classifiedsUrl.pathname, "https://backpack.tf/classifieds");
  assert.equal(classifiedsUrl.searchParams.get("texture_name"), "Dragon Slayer");
});

test("REGRESSION: a standalone War Paint tool's marketplaceHref sends a real seffect[] when the caller supplies knownEffectId - confirmed live via an Unusual 'Ocean Mapped War Paint (Field-Tested)' with Effect 'Isotope'/particle=702, which needs no Steam Web API key either (bypasses the schema, same as the plain Unusual case)", async () => {
  const withoutEffect = await resolveStatsAndClassifieds("Ocean Mapped War Paint (Field-Tested)");
  assert.equal(new URL(withoutEffect.marketplaceHref).searchParams.get("seffect[]"), "-2");

  const withEffect = await resolveStatsAndClassifieds("Ocean Mapped War Paint (Field-Tested)", {
    knownEffectName: "Isotope",
    knownEffectId: 702,
  });
  assert.equal(new URL(withEffect.marketplaceHref).searchParams.get("seffect[]"), "702");
});

test("resolveStatsAndClassifieds's marketplaceHref/classifiedsHref dispatch to the Decorated Weapon builder", async () => {
  const result = await resolveStatsAndClassifieds("Necromanced Machina (Factory New)");

  const marketUrl = new URL(result.marketplaceHref);
  assert.equal(marketUrl.searchParams.get("sterm"), "Machina");
  assert.equal(marketUrl.searchParams.get("sbotkiller"), "none");

  const classifiedsUrl = new URL(result.classifiedsHref);
  assert.equal(classifiedsUrl.searchParams.get("item"), "Machina");
  assert.equal(classifiedsUrl.searchParams.get("texture_name"), "Necromanced");
});

test("resolveStatsAndClassifieds's marketplaceHref threads a Decorated Weapon's own Sheen/Killstreaker/effect/Killstreak tier (previously hardcoded to skillstreak=0/seffect[]=-2/no sks[]/ske[] at all)", async () => {
  const result = await resolveStatsAndClassifieds("Strange Necromanced Machina (Factory New)", {
    knownSheenName: "Team Shine",
    knownKillstreakerName: "Fire Horns",
    knownEffectName: "Burning Flames",
    knownKillstreakTier: 3,
  });

  const url = new URL(result.marketplaceHref);
  assert.equal(url.searchParams.get("skillstreak"), "3");
  assert.equal(url.searchParams.get("sks[]"), "1"); // Team Shine
  assert.equal(url.searchParams.get("ske[]"), "2002"); // Fire Horns
  assert.equal(url.searchParams.get("seffect[]"), "13"); // Burning Flames
  assert.equal(url.searchParams.get("sterm"), "Machina");
});

test("resolveStatsAndClassifieds's marketplaceHref for a Decorated Weapon with none of the known* options given keeps the old defaults (skillstreak=0, seffect[]=-2, no sks[]/ske[])", async () => {
  const result = await resolveStatsAndClassifieds("Necromanced Machina (Factory New)");

  const url = new URL(result.marketplaceHref);
  assert.equal(url.searchParams.get("skillstreak"), "0");
  assert.equal(url.searchParams.get("seffect[]"), "-2");
  assert.equal(url.searchParams.has("sks[]"), false);
  assert.equal(url.searchParams.has("ske[]"), false);
});

// REGRESSION for a live bug report: buildMarketplaceLink's own Decorated
// Weapon branch only ever checked isStrange for squality[]/sstrange,
// ignoring isUnusual entirely (added later for the "Strange Unusual
// Professional Killstreak ..." case - see matchDecoratedWeapon's own note) -
// an Unusual Decorated Weapon's marketplace.tf search never filtered by
// quality at all. isUnusual now takes priority for squality[], same as the
// classifieds/stats builders already do; sstrange stays tied to isStrange
// independently (it conveys "has Strange-tracking attached", a separate
// attribute, not the primary quality).
test("resolveStatsAndClassifieds's marketplaceHref uses Unusual's squality[] id for an Unusual Decorated Weapon, even when isStrange is also true", async () => {
  const result = await resolveStatsAndClassifieds("Strange Unusual Professional Killstreak Necromanced Machina (Factory New)", {
    knownEffectName: "Burning Flames",
    knownKillstreakTier: 3,
  });

  const url = new URL(result.marketplaceHref);
  assert.equal(url.searchParams.get("squality[]"), "5"); // Unusual, not Strange (11)
  assert.equal(url.searchParams.get("sstrange"), "1"); // still conveys the add-on Strange-tracking attribute
  assert.equal(url.searchParams.get("sterm"), "Machina");
});

test("resolveStatsAndClassifieds's marketplaceHref uses stype=Fabricator vs stype=Killstreak Kit, and threads sheen/killstreaker into BOTH when given (confirmed live for a Fabricator too - previously only a Kit's own branch attached them, a Fabricator's own knownSheenName/knownKillstreakerName were silently dropped)", async () => {
  const kit = await resolveStatsAndClassifieds("Professional Killstreak Machina Kit", {
    knownSheenName: "hot rod",
    knownKillstreakerName: "incinerator",
  });
  const kitUrl = new URL(kit.marketplaceHref);
  assert.equal(kitUrl.searchParams.get("stype"), "Killstreak Kit");
  assert.equal(kitUrl.searchParams.get("sks[]"), "7");
  assert.equal(kitUrl.searchParams.get("ske[]"), "2007");

  const fabricatorWithNone = await resolveStatsAndClassifieds("Professional Killstreak Machina Kit Fabricator");
  const fabricatorNoneUrl = new URL(fabricatorWithNone.marketplaceHref);
  assert.equal(fabricatorNoneUrl.searchParams.get("stype"), "Fabricator");
  assert.equal(fabricatorNoneUrl.searchParams.has("sks[]"), false);

  const fabricatorWithKnown = await resolveStatsAndClassifieds("Professional Killstreak Machina Kit Fabricator", {
    knownSheenName: "Mean Green",
    knownKillstreakerName: "Flames",
  });
  const fabricatorKnownUrl = new URL(fabricatorWithKnown.marketplaceHref);
  assert.equal(fabricatorKnownUrl.searchParams.get("stype"), "Fabricator");
  assert.equal(fabricatorKnownUrl.searchParams.get("sks[]"), "4"); // Mean Green
  assert.equal(fabricatorKnownUrl.searchParams.get("ske[]"), "2005"); // Flames
});

test("resolveStatsAndClassifieds's marketplaceHref splits a Taunt's 'Taunt: ' prefix into stype=Special Taunt", async () => {
  const result = await resolveStatsAndClassifieds("Taunt: Unleashed Rage");
  const url = new URL(result.marketplaceHref);
  assert.equal(url.searchParams.get("stype"), "Special Taunt");
  assert.equal(url.searchParams.get("sterm"), "Unleashed Rage");
});

// MarketplaceHref's own sterm used to search the bare "Strangifier" text
// alone, silently dropping the target weapon - marketplace.tf has no
// dedicated target-item filter param the way next.backpack.tf's classifieds
// does (targetItem), it just wants the full combined name as a normal
// search term. See utils/tf2StatsLinks/targetTool.js's own
// buildTargetToolFullName note.
test("resolveStatsAndClassifieds's marketplaceHref searches the FULL combined name for a Strangifier, while next.backpack.tf's classifieds gets a dedicated targetItem param instead", async () => {
  const result = await resolveStatsAndClassifieds("Righteous Bison Strangifier");
  const marketUrl = new URL(result.marketplaceHref);
  assert.equal(marketUrl.searchParams.get("sterm"), "Righteous Bison Strangifier");

  const nextUrl = new URL(result.nextClassifiedsHref);
  assert.equal(nextUrl.searchParams.get("itemName"), "Strangifier");
  assert.equal(nextUrl.searchParams.get("targetItem"), "Righteous Bison");
});

// REGRESSION for a live bug report: "Professor Speks Strangifier Chemistry
// Set Series #2" doesn't end in the plain " Strangifier" suffix a normal
// Strangifier's own name does - "Strangifier" sits in the middle, followed by
// "Chemistry Set Series #2" - so matchTargetItemTool used to return null for
// it, falling through to a bogus plain-item classifieds search for the whole
// raw string with no targetItem filter at all. Confirmed live:
// https://next.backpack.tf/classifieds?itemName=Chemistry%20Set&quality=6&
// targetItem=Professor%20Speks
test("resolveStatsAndClassifieds's nextClassifiedsHref searches 'Chemistry Set' filtered by targetItem for a Strangifier Chemistry Set", async () => {
  const result = await resolveStatsAndClassifieds("Professor Speks Strangifier Chemistry Set Series #2");
  const nextUrl = new URL(result.nextClassifiedsHref);
  assert.equal(nextUrl.searchParams.get("itemName"), "Chemistry Set");
  assert.equal(nextUrl.searchParams.get("quality"), "6");
  assert.equal(nextUrl.searchParams.get("targetItem"), "Professor Speks");
});

// Same marketplaceHref fix as the plain-Strangifier test above, extended to
// a Chemistry Set's own "{target} Strangifier {itemName}" shape - NOT
// independently confirmed live for marketplace.tf specifically (only the
// plain-Strangifier case was), but built the same consistent way
// buildTargetToolFullName already established for mannco.store's own
// confirmed-live Chemistry Set example ("...search=Professor+Speks+
// Strangifier+Chemistry+Set").
test("resolveStatsAndClassifieds's marketplaceHref searches the full combined name for a Strangifier Chemistry Set too", async () => {
  const result = await resolveStatsAndClassifieds("Professor Speks Strangifier Chemistry Set Series #2");
  const marketUrl = new URL(result.marketplaceHref);
  assert.equal(marketUrl.searchParams.get("sterm"), "Professor Speks Strangifier Chemistry Set");
});

// REGRESSION for a live bug report: a numbered Crate/Strongbox's own "Series
// #{n}" suffix used to just stay baked into the plain itemName text (e.g.
// "Mann Co. Supply Crate Series #26"), with no crateSeries filter applied at
// all - confirmed live the correct search splits it into its own bare
// itemName ("Mann Co. Supply Crate") plus a "crateSeries" param taking the
// printed number DIRECTLY (an earlier live report claiming some other,
// non-matching internal numbering - e.g. crateSeries=57 for "Series #26" -
// was retracted as a mistake; confirmed correct as the plain printed number
// against BOTH Mann Co. Supply Crate and Mann Co. Strongbox).
test("resolveStatsAndClassifieds's nextClassifiedsHref splits a numbered Crate's 'Series #n' suffix into its own crateSeries param", async () => {
  const result = await resolveStatsAndClassifieds("Mann Co. Supply Crate Series #26");
  const nextUrl = new URL(result.nextClassifiedsHref);
  assert.equal(nextUrl.searchParams.get("itemName"), "Mann Co. Supply Crate");
  assert.equal(nextUrl.searchParams.get("quality"), "6");
  assert.equal(nextUrl.searchParams.get("crateSeries"), "26");
});

test("resolveStatsAndClassifieds's nextClassifiedsHref splits a Strongbox's 'Series #n' suffix into crateSeries too, not just Supply Crate specifically", async () => {
  const result = await resolveStatsAndClassifieds("Mann Co. Strongbox Series #81");
  const nextUrl = new URL(result.nextClassifiedsHref);
  assert.equal(nextUrl.searchParams.get("itemName"), "Mann Co. Strongbox");
  assert.equal(nextUrl.searchParams.get("crateSeries"), "81");
});

// An earlier version of this fix stripped the "Series #n" suffix off the
// SHARED filters.itemName - which marketplace.tf's sterm and posts.tf's own
// schema defindex lookup also consume. Since each numbered crate is its own
// DISTINCT Valve schema item, "Mann Co. Supply Crate" alone (suffix
// stripped) isn't even a resolvable item name for posts.tf's lookup - so
// stripping it there would have silently broken it instead of fixing
// anything. marketplace.tf has no confirmed crateSeries-equivalent either,
// so it keeps the full name too.
test("resolveStatsAndClassifieds's marketplaceHref keeps the FULL 'Series #n' name intact (no confirmed crateSeries-equivalent there)", async () => {
  const result = await resolveStatsAndClassifieds("Mann Co. Supply Crate Series #26");
  const marketUrl = new URL(result.marketplaceHref);
  assert.equal(marketUrl.searchParams.get("sterm"), "Mann Co. Supply Crate Series #26");
});

// REGRESSION for a live bug report: classic backpack.tf's classifieds DOES
// have a confirmed crate filter too - just a completely different param
// shape than next.backpack.tf's simple crateSeries=n: a generic "numeric"
// attribute-range filter (numeric=crate&value={n}&low={n}), with item=
// split down to the bare crate name the same way next.backpack.tf's own
// itemName is. Confirmed live for both Mann Co. Supply Crate Series #26 and
// Naughty Winter Crate 2014 Series #88.
test("resolveStatsAndClassifieds's classicClassifiedsHref filters a numbered Crate via numeric=crate&value={n}&low={n}, with itemName split the same way as next.backpack.tf", async () => {
  const result = await resolveStatsAndClassifieds("Mann Co. Supply Crate Series #26");
  const classicUrl = new URL(result.classifiedsHref);
  assert.equal(classicUrl.searchParams.get("item"), "Mann Co. Supply Crate");
  assert.equal(classicUrl.searchParams.get("numeric"), "crate");
  assert.equal(classicUrl.searchParams.get("value"), "26");
  assert.equal(classicUrl.searchParams.get("low"), "26");
});

test("resolveStatsAndClassifieds's classicClassifiedsHref omits numeric/value/low entirely for a plain item with no 'Series #n' suffix", async () => {
  const result = await resolveStatsAndClassifieds("Rocket Launcher");
  const classicUrl = new URL(result.classifiedsHref);
  assert.equal(classicUrl.searchParams.has("numeric"), false);
  assert.equal(classicUrl.searchParams.has("value"), false);
  assert.equal(classicUrl.searchParams.has("low"), false);
});

test("resolveStatsAndClassifieds's nextClassifiedsHref omits crateSeries entirely for a plain item with no 'Series #n' suffix", async () => {
  const result = await resolveStatsAndClassifieds("Rocket Launcher");
  const nextUrl = new URL(result.nextClassifiedsHref);
  assert.equal(nextUrl.searchParams.has("crateSeries"), false);
});

test("createSteamMarketLink drops the Non-Craftable prefix and adds the craft filter term", async () => {
  const result = await resolveStatsAndClassifieds("Non-Craftable Strange Rocket Launcher");
  const href = createSteamMarketLink("Non-Craftable Strange Rocket Launcher", result.classifiedsFilters);
  const url = new URL(href);
  assert.equal(url.pathname, "/market/listings/440/Strange%20Rocket%20Launcher");
  assert.equal(url.searchParams.get("q"), "Not Usable in Crafting");
});

test("createSteamMarketLink rebuilds an Unusual's listing name as 'Unusual {baseName}' with the effect only as a filter term", async () => {
  const result = await resolveStatsAndClassifieds("Unusual Team Captain Burning Flames");
  const href = createSteamMarketLink("Unusual Team Captain Burning Flames", result.classifiedsFilters);
  const url = new URL(href);
  assert.equal(url.pathname, "/market/listings/440/Unusual%20Team%20Captain");
  assert.equal(url.searchParams.get("q"), "Burning Flames");
});

// Steam's market_hash_name for a Strange-tracking Unusual reads "Strange
// Unusual {Item}"; the "Strange" there is a tracking descriptor, never part
// of the item's base name.
test("REGRESSION: a 'Strange Unusual' name resolves its base name without 'Strange Unusual', and the Steam Market link keeps Steam's own 'Strange Unusual' prefix", async () => {
  const result = await resolveStatsAndClassifieds("Strange Unusual Team Captain", { knownEffectName: "Burning Flames" });
  assert.equal(result.classifiedsFilters.itemName, "Team Captain");
  assert.equal(result.classifiedsFilters.quality, "Unusual");
  assert.equal(result.bpStatsHref, "https://backpack.tf/stats/Unusual/Team%20Captain/Tradable/Craftable/13");
  assert.equal(new URL(result.classifiedsHref).searchParams.get("item"), "Team Captain");

  const url = new URL(createSteamMarketLink("Strange Unusual Team Captain", result.classifiedsFilters));
  assert.equal(url.pathname, "/market/listings/440/Strange%20Unusual%20Team%20Captain");
  assert.equal(url.searchParams.get("q"), "Burning Flames");
});

// A Kit Fabricator's own Steam Market link never got a q= filter at all -
// confirmed live working URL:
// "...Kit%20Fabricator?appid=440&q=Fire+Horns,Mean+Green" (killstreaker
// FIRST, then sheen). Same fix applies to a standalone Kit.
test("createSteamMarketLink adds killstreaker,sheen as a q= filter (killstreaker first) for a Fabricator/Kit with a known Sheen/Killstreaker", async () => {
  const knownSignals = { knownSheenName: "Mean Green", knownKillstreakerName: "Fire Horns" };

  const fabricator = await resolveStatsAndClassifieds("Professional Killstreak Minigun Kit Fabricator", knownSignals);
  const fabricatorHref = createSteamMarketLink("Professional Killstreak Minigun Kit Fabricator", fabricator.classifiedsFilters);
  assert.equal(new URL(fabricatorHref).searchParams.get("q"), "Fire Horns,Mean Green");

  const kit = await resolveStatsAndClassifieds("Professional Killstreak Minigun Kit", knownSignals);
  const kitHref = createSteamMarketLink("Professional Killstreak Minigun Kit", kit.classifiedsFilters);
  assert.equal(new URL(kitHref).searchParams.get("q"), "Fire Horns,Mean Green");
});

test("createSteamMarketLink adds no q= filter for a Fabricator/Kit with no known Sheen/Killstreaker", async () => {
  const result = await resolveStatsAndClassifieds("Professional Killstreak Minigun Kit Fabricator");
  const href = createSteamMarketLink("Professional Killstreak Minigun Kit Fabricator", result.classifiedsFilters);
  assert.equal(new URL(href).searchParams.has("q"), false);
});

// A Kit's own raw itemName reaches this function ALREADY prefixed
// "Non-Craftable " by itemQuickLinks/content.js's own
// withPermanentNonCraftablePrefix (every Kit/Fabricator is permanently
// non-craftable, confirmed via its own page's "( Not Usable in Crafting )"
// notice) - but that's the norm for the WHOLE item type, not a
// distinguishing trait the way it is for an ordinary cosmetic, so including
// it as a search filter is redundant clutter, not a useful narrowing.
// Confirmed live it should be dropped for a Kit/Fabricator while the real
// Killstreaker/Sheen filters still apply.
test("createSteamMarketLink omits 'Not Usable in Crafting' for a Kit/Fabricator even though it's always permanently non-craftable", async () => {
  const knownSignals = { knownSheenName: "Hot Rod", knownKillstreakerName: "Incinerator" };
  const result = await resolveStatsAndClassifieds("Non-Craftable Professional Killstreak Conniver's Kunai Kit", knownSignals);

  const href = createSteamMarketLink("Non-Craftable Professional Killstreak Conniver's Kunai Kit", result.classifiedsFilters);
  assert.equal(new URL(href).searchParams.get("q"), "Incinerator,Hot Rod");
});

// posts.tf: confirmed live by decoding several real posts.tf search URLs
// and comparing them against that search's own POST /api/posts/search
// request body - see buildPostsTfLink's own header note for the full
// writeup. Its "q" param is base64(JSON.stringify({u, p, d, m})) with the
// trailing "=" padding stripped; this helper reverses that so tests can
// assert on the decoded payload directly instead of raw base64 strings.
function decodePostsTfQuery(href) {
  const b64 = new URL(href).searchParams.get("q");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
}

test("resolveStatsAndClassifieds's postsTfHref searches by defindex/quality/craftable for a plain item", async () => {
  const result = await resolveStatsAndClassifieds("Strange Voodoo Juju");
  const query = decodePostsTfQuery(result.postsTfHref);
  assert.deepEqual(query, {
    u: [{ defindex: 300, quality: 11, craftable: true }],
    p: [],
    d: "",
    m: false,
  });
});

test("resolveStatsAndClassifieds's postsTfHref sends craftable: false for a Non-Craftable item", async () => {
  const result = await resolveStatsAndClassifieds("Non-Craftable Strange Rocket Launcher");
  const query = decodePostsTfQuery(result.postsTfHref);
  assert.equal(query.u[0].craftable, false);
});

test("resolveStatsAndClassifieds's postsTfHref includes the plain paint NAME (not classicPaintId's derived RGB id, unlike marketplace.tf's own spaint[])", async () => {
  const result = await resolveStatsAndClassifieds("Strange Voodoo Juju", { knownPaintName: "Team Spirit" });
  const query = decodePostsTfQuery(result.postsTfHref);
  assert.equal(query.u[0].paint, "Team Spirit");
});

test("resolveStatsAndClassifieds's postsTfHref includes the Unusual effect as a numeric id, same scheme every other site here already uses", async () => {
  const result = await resolveStatsAndClassifieds("Unusual Team Captain Burning Flames");
  const query = decodePostsTfQuery(result.postsTfHref);
  assert.deepEqual(query.u[0], { defindex: 378, quality: 5, craftable: true, effect: 13 });
});

test("resolveStatsAndClassifieds's postsTfHref sends killstreak as the plain 1/2/3 tier against the BASE weapon's own defindex, not a separate Killstreak catalog entry - confirmed live", async () => {
  const result = await resolveStatsAndClassifieds("Strange Professional Killstreak Rocket Launcher");
  const query = decodePostsTfQuery(result.postsTfHref);
  assert.deepEqual(query.u[0], { defindex: 205, quality: 11, craftable: true, killstreak: 3 });
});

test("resolveStatsAndClassifieds's postsTfHref sends spells as an array of plain spell names", async () => {
  const result = await resolveStatsAndClassifieds("Strange Voodoo Juju", { knownSpellName: "Exorcism" });
  const query = decodePostsTfQuery(result.postsTfHref);
  assert.deepEqual(query.u[0].spells, ["Exorcism"]);
});

// REGRESSION for a live bug report: the posts.tf button never appeared for
// ANY Australium item, on every site this codebase adds it to. This used to
// assume posts.tf gives Australium weapons their own distinct schema
// defindex (reconstructing the "Australium " prefix resolveClassifiedsFilters
// strips off itemName before looking it up) - but posts.tf's OWN item picker
// doesn't do that at all. Confirmed live by decoding a real "Strange
// Australium Force-a-Nature" pick from posts.tf's own search page:
// {"defindex":45,"quality":11,"craftable":true,"australium":true} - defindex
// 45 is Force-a-Nature's PLAIN, non-Australium schema defindex (the live TF2
// schema has no separate "Australium Force-a-Nature" entry at all), and
// "australium" is its own boolean field instead - same shape classifieds/
// marketplace.tf already use, not a distinct catalog item.
test("resolveStatsAndClassifieds's postsTfHref uses the BARE weapon's own defindex for an Australium item, with australium as its own boolean field - not a reconstructed 'Australium {name}' schema lookup", async () => {
  const australium = await resolveStatsAndClassifieds("Strange Australium Rocket Launcher");
  const item = decodePostsTfQuery(australium.postsTfHref).u[0];
  assert.equal(item.defindex, 205); // "Rocket Launcher"'s own plain defindex, not a distinct Australium one
  assert.equal(item.australium, true);
});

test("resolveStatsAndClassifieds's postsTfHref is null for item types not built yet (Kit/Fabricator/War Paint tool/Decorated Weapon/Strangifier Chemistry Set), and for an item whose defindex can't be resolved", async () => {
  const kit = await resolveStatsAndClassifieds("Professional Killstreak Machina Kit");
  assert.equal(kit.postsTfHref, null);

  // Null here because this fixture's own itemNameToDefindex (see this file's
  // top-level schema mock) never seeded a "Strangifier" entry, not because a
  // plain Strangifier is categorically excluded any more - see the dedicated
  // "generic (non-target-filtered) search" test below for that, once resolved.
  const strangifier = await resolveStatsAndClassifieds("Righteous Bison Strangifier");
  assert.equal(strangifier.postsTfHref, null);

  const unresolvable = await resolveStatsAndClassifieds("Strange Some Unknown Made-Up Hat");
  assert.equal(unresolvable.postsTfHref, null);
});

// This used to be excluded unconditionally on the (too strong) claim that
// posts.tf has no search for a target-item tool at all - see buildPostsTfLink's
// own CORRECTION note. The decoded payload was
// {"defindex":5661,"quality":6,"craftable":true}, no target field at all - a
// real, working, but genuinely non-target-filtered search for "any
// Strangifier". "Strangifier" is a real schema item name in its own right (that
// same defindex, 5661), so it resolves the exact same way any other plain
// item's postsTfHref does once the schema has it.
test("resolveStatsAndClassifieds's postsTfHref builds a generic (non-target-filtered) search for a plain Strangifier, once its own schema entry resolves", async () => {
  const originalGet = globalThis.chrome.storage.local.get;
  globalThis.chrome.storage.local.get = async () => ({
    tf2SchemaCache: {
      itemNameToDefindex: { "Righteous Bison": 40, Strangifier: 5661 },
      defindexToItemName: {},
      effectNameToId: {},
      fetchedAt: Date.now(),
      schemaShapeVersion: 4,
    },
  });
  __resetSchemaCacheForTests();

  const strangifier = await resolveStatsAndClassifieds("Righteous Bison Strangifier");
  const query = decodePostsTfQuery(strangifier.postsTfHref);
  assert.deepEqual(query, { u: [{ defindex: 5661, quality: 6, craftable: true }], p: [], d: "", m: false });

  globalThis.chrome.storage.local.get = originalGet;
  __resetSchemaCacheForTests();
});

// A Strangifier Chemistry Set is NOT covered by the correction above - unlike
// a plain Strangifier, there's no confirmed-live evidence it resolves the
// same way (each real one may be its own distinct schema item per target
// promo rather than one shared generic defindex) - stays excluded on purpose.
test("resolveStatsAndClassifieds's postsTfHref stays null for a Strangifier Chemistry Set even once 'Strangifier' itself is a known schema entry", async () => {
  const originalGet = globalThis.chrome.storage.local.get;
  globalThis.chrome.storage.local.get = async () => ({
    tf2SchemaCache: {
      itemNameToDefindex: { Strangifier: 5661, "Chemistry Set": 6522 },
      defindexToItemName: {},
      effectNameToId: {},
      fetchedAt: Date.now(),
      schemaShapeVersion: 4,
    },
  });
  __resetSchemaCacheForTests();

  const chemSet = await resolveStatsAndClassifieds("Professor Speks Strangifier Chemistry Set Series #2");
  assert.equal(chemSet.postsTfHref, null);

  globalThis.chrome.storage.local.get = originalGet;
  __resetSchemaCacheForTests();
});

// Seen live: a site printed an Unusual's name as "★  Unusual Connoisseur's
// Cap" (star, two spaces), and the star went straight into the stats URL.
test("REGRESSION: a leading '★' marker (and extra spaces) is stripped before any link is built", async () => {
  const starred = await resolveStatsAndClassifieds("★  Unusual Connoisseur's Cap", { knownEffectId: 81 });
  const plain = await resolveStatsAndClassifieds("Unusual Connoisseur's Cap", { knownEffectId: 81 });

  assert.equal(starred.bpStatsHref, "https://backpack.tf/stats/Unusual/Connoisseur's%20Cap/Tradable/Craftable/81");
  assert.equal(starred.nextBpStatsHref, "https://next.backpack.tf/stats/Unusual/Connoisseur's%20Cap/Tradable/Craftable/81");
  assert.equal(starred.classifiedsHref, plain.classifiedsHref);
  assert.equal(starred.nextClassifiedsHref, plain.nextClassifiedsHref);
  assert.equal(starred.classifiedsFilters.itemName, "Connoisseur's Cap");
});

test("stripStarMarker removes only a leading star and collapses repeated spaces", () => {
  assert.equal(stripStarMarker("★  Unusual Connoisseur's Cap"), "Unusual Connoisseur's Cap");
  assert.equal(stripStarMarker("  ★Unusual   Team Captain "), "Unusual Team Captain");
  assert.equal(stripStarMarker("Team Captain"), "Team Captain");
  assert.equal(buildSteamMarketName("★ Unusual Connoisseur's Cap"), "Unusual Connoisseur's Cap");
});

// Seen live on mannco.store: the card title is "{Effect} ★ Unusual {Item}",
// and the caller adds an "Unusual " quality prefix in front of it.
test("REGRESSION: mannco.store's '{Effect} ★ Unusual {Item}' title (with the quality prefix in front) builds the correct Unusual links", async () => {
  const r = await resolveStatsAndClassifieds("Unusual Bonzo The All-Gnawing ★ Unusual Connoisseur's Cap");

  assert.equal(stripStarMarker("Unusual Bonzo The All-Gnawing ★  Unusual Connoisseur's Cap"), "Unusual Bonzo The All-Gnawing Connoisseur's Cap");
  assert.equal(r.bpStatsHref, "https://backpack.tf/stats/Unusual/Connoisseur's%20Cap/Tradable/Craftable/81");
  assert.equal(r.nextBpStatsHref, "https://next.backpack.tf/stats/Unusual/Connoisseur's%20Cap/Tradable/Craftable/81");
  assert.equal(r.classifiedsFilters.itemName, "Connoisseur's Cap");
  assert.equal(r.classifiedsFilters.effectId, 81);
});

test("stripStarMarker leaves a name without a star alone, even with 'Unusual' in it", () => {
  assert.equal(stripStarMarker("Unusual Team Captain"), "Unusual Team Captain");
});

test("buildGladiatorHref URL-encodes the item name into gladiator.tf's own search param", () => {
  assert.equal(buildGladiatorHref("Rocket Launcher"), "https://gladiator.tf/sales?item=Rocket+Launcher");
});

test("buildStnTradingHref joins Steam's market_hash_name words with a literal '+', dropping Non-Craftable", () => {
  assert.equal(buildStnTradingHref("Non-Craftable Strange War Pig", null), "https://stntrading.eu/item/tf2/Strange+War+Pig");
});

test("buildStnTradingHref puts a space between a Decorated Weapon's skin and weapon even when the raw name concatenates them", () => {
  const filters = { decoratedWeapon: { skinName: "Necromanced", weaponName: "Machina", wearTier: "Factory New" } };
  assert.equal(
    buildStnTradingHref("Strange Necromanced Machina (Factory New)", filters),
    "https://stntrading.eu/item/tf2/Strange+Necromanced+Machina+(Factory+New)"
  );
  assert.equal(
    buildStnTradingHref("Strange NecromancedMachina (Factory New)", filters),
    "https://stntrading.eu/item/tf2/Strange+Necromanced+Machina+(Factory+New)"
  );
});

test("buildStnTradingHref keeps 'Unusual' and inserts the effect name right after it", () => {
  const filters = { quality: "Unusual", effectName: "Cuban Smoke", itemName: "Throttlehead" };
  assert.equal(buildStnTradingHref("Unusual Throttlehead", filters), "https://stntrading.eu/item/tf2/Unusual+Cuban+Smoke+Throttlehead");
});

test("buildStnTradingHref falls back to plain 'Unusual {item}' when the effect is unknown", () => {
  const filters = { quality: "Unusual", effectName: null, itemName: "Throttlehead" };
  assert.equal(buildStnTradingHref("Unusual Throttlehead", filters), "https://stntrading.eu/item/tf2/Unusual+Throttlehead");
});

// btoa throws on any non-Latin-1 character; a page-supplied paint name with
// a curly apostrophe used to reject resolveStatsAndClassifieds as a whole.
test("resolveStatsAndClassifieds's postsTfHref survives a non-Latin-1 paint name instead of throwing", async () => {
  const result = await resolveStatsAndClassifieds("Strange Voodoo Juju", { knownPaintName: "Zepheniah’s Greed" });
  assert.ok(result.marketplaceHref);
  assert.equal(decodePostsTfQuery(result.postsTfHref).u[0].paint, "Zepheniah’s Greed");
});

// A caller holding only the particle id (classic backpack.tf's /stats item
// element, next.backpack.tf's Unusual Taunt tooltip) used to get
// effectName: null back, so every name-based link dropped the effect:
// stntrading.eu linked "Unusual Team Captain" and pricedb.io searched a name
// it can never exact-match.
test("REGRESSION: a known effect id alone still resolves the effect NAME (bundled table), so name-based links carry it", async () => {
  const result = await resolveStatsAndClassifieds("Unusual Team Captain", { knownEffectId: 13 });

  assert.equal(result.classifiedsFilters.effectId, 13);
  assert.equal(result.classifiedsFilters.effectName, "Burning Flames");
  assert.equal(result.classifiedsFilters.itemName, "Team Captain");
  assert.equal(buildStnTradingHref("Unusual Team Captain", result.classifiedsFilters), "https://stntrading.eu/item/tf2/Unusual+Burning+Flames+Team+Captain");
  assert.equal(buildPricedbSearchName("Unusual Team Captain", result.classifiedsFilters), "Burning Flames Team Captain");
});

// The id-derived name must not be cut out of the item's own name: an id-only
// caller's raw name never contains the effect text, and "Smoking" (35) is
// also a word of the real hat "Smoking Skid Lid".
test("a known effect id alone never strips the looked-up effect name out of the item's own name", async () => {
  const result = await resolveStatsAndClassifieds("Unusual Smoking Skid Lid", { knownEffectId: 35 });

  assert.equal(result.classifiedsFilters.effectName, "Smoking");
  assert.equal(result.classifiedsFilters.itemName, "Smoking Skid Lid");
});

// A real no-effect Unusual (resolveUnusualEffect's own note) resolves with
// effectId AND effectName null. Its plain Unusual stats/classifieds links are
// the correct ones, but every caller hid them (and asked for a Steam Web API
// key that would never help).
test("REGRESSION: isUnusualEffectIdUnresolved is false for an Unusual that genuinely has no effect, true only when a known name has no id", async () => {
  const noEffect = await resolveStatsAndClassifieds("Unusual Horseless Headless Horsemann's Headtaker");
  assert.equal(noEffect.classifiedsFilters.effectId, null);
  assert.equal(noEffect.classifiedsFilters.effectName, null);
  assert.equal(isUnusualEffectIdUnresolved(noEffect.classifiedsFilters), false);

  assert.equal(isUnusualEffectIdUnresolved({ quality: "Unusual", effectId: null, effectName: "Not A Real Effect" }), true);
  assert.equal(isUnusualEffectIdUnresolved({ quality: "Unusual", effectId: 13, effectName: "Burning Flames" }), false);
  assert.equal(isUnusualEffectIdUnresolved(null), false);
});
