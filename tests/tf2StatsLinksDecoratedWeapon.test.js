import { test } from "node:test";
import assert from "node:assert/strict";

// utils/warpaints.js's findSkinNamePrefix is what matchDecoratedWeapon calls
// to split "{skin}{weapon}" with no separator - fake just enough of
// chrome.runtime.getURL + fetch for it to resolve once from a small fixture
// list. warpaints.js caches its result in-memory for the module's lifetime
// with no TTL check at all, so (same reasoning as the tf2Schema.js-backed
// fixtures elsewhere in this folder) one fixture per test file, installed
// before import, is the right shape - not something to vary per test.
globalThis.chrome = { runtime: { getURL: (path) => path } };
globalThis.fetch = async () => ({
  json: async () => [
    { name: "Necromanced", defindex: 100 },
    { name: "Calavera Canvas", defindex: 101 },
  ],
});

const { matchDecoratedWeapon, createBpStatsLinkDecoratedWeapon, buildDecoratedWeaponClassifiedsLink } = await import(
  "../utils/tf2StatsLinks/decoratedWeapon.js"
);

test("matchDecoratedWeapon splits a concatenated skin+weapon name using the longest known skin prefix", async () => {
  assert.deepEqual(await matchDecoratedWeapon("Necromanced Black Box (Battle Scarred)"), {
    skinName: "Necromanced",
    weaponName: "Black Box",
    wearTier: "Battle Scarred",
    isStrange: false,
    isUnusual: false,
    isFestivized: false,
    isNonCraftable: false,
    killstreakTier: 0,
  });
});

test("matchDecoratedWeapon strips a leading Strange word before matching the skin", async () => {
  assert.deepEqual(await matchDecoratedWeapon("Strange Necromanced Black Box (Battle Scarred)"), {
    skinName: "Necromanced",
    weaponName: "Black Box",
    wearTier: "Battle Scarred",
    isStrange: true,
    isUnusual: false,
    isFestivized: false,
    isNonCraftable: false,
    killstreakTier: 0,
  });
});

// REGRESSION for a live bug report: Steam's own market_hash_name for a
// Decorated Weapon with a Killstreak Kit attached (e.g. "Strange
// Professional Killstreak Dead Reckoner Revolver (Factory New)" - exactly
// what steamcommunity.com/itemQuickLinks/content.js's own market-link
// resolution now hands this function) carries a Killstreak-tier adjective
// BETWEEN quality and the skin name. Before this fix, findSkinNamePrefix
// never matched (the skin name wasn't at the front of what was left), so
// this returned null for EVERY Killstreak-attached Decorated Weapon,
// silently falling through to the generic (non-decorated) classifieds
// branch - which built a link with the raw "{skin} {weapon} ({wear})" text
// as a bogus item name and no texture param at all.
test("matchDecoratedWeapon strips a Killstreak-tier adjective sitting between quality and the skin name", async () => {
  assert.deepEqual(await matchDecoratedWeapon("Strange Professional Killstreak Necromanced Black Box (Battle Scarred)"), {
    skinName: "Necromanced",
    weaponName: "Black Box",
    wearTier: "Battle Scarred",
    isStrange: true,
    isUnusual: false,
    isFestivized: false,
    isNonCraftable: false,
    killstreakTier: 3,
  });
});

test("matchDecoratedWeapon strips a bare 'Killstreak ' adjective (Basic tier) the same way", async () => {
  assert.deepEqual(await matchDecoratedWeapon("Killstreak Necromanced Black Box (Battle Scarred)"), {
    skinName: "Necromanced",
    weaponName: "Black Box",
    wearTier: "Battle Scarred",
    isStrange: false,
    isUnusual: false,
    isFestivized: false,
    isNonCraftable: false,
    killstreakTier: 1,
  });
});

test("matchDecoratedWeapon strips a Festivized adjective sitting right after quality, before the skin name", async () => {
  assert.deepEqual(await matchDecoratedWeapon("Festivized Necromanced Black Box (Battle Scarred)"), {
    skinName: "Necromanced",
    weaponName: "Black Box",
    wearTier: "Battle Scarred",
    isStrange: false,
    isUnusual: false,
    isFestivized: true,
    isNonCraftable: false,
    killstreakTier: 0,
  });
});

// REGRESSION for a live bug report: Steam's own market_hash_name for a
// Killstreak-Kit-fabricated Unusual Decorated Weapon (e.g. "Strange Unusual
// Professional Killstreak Star Crossed Iron Bomber (Factory New)") uses the
// literal word "Unusual" for its real, persisted quality - "Strange" ahead
// of it is just an add-on Strange-tracking descriptor, not the item's real
// quality (see this function's own isUnusual note).
test("matchDecoratedWeapon strips a literal 'Unusual ' quality word too, distinct from isStrange", async () => {
  assert.deepEqual(await matchDecoratedWeapon("Strange Unusual Professional Killstreak Necromanced Black Box (Factory New)"), {
    skinName: "Necromanced",
    weaponName: "Black Box",
    wearTier: "Factory New",
    isStrange: true,
    isUnusual: true,
    isFestivized: false,
    isNonCraftable: false,
    killstreakTier: 3,
  });
});

test("matchDecoratedWeapon strips a bare 'Unusual ' quality word with no Strange-tracking present", async () => {
  assert.deepEqual(await matchDecoratedWeapon("Unusual Necromanced Black Box (Factory New)"), {
    skinName: "Necromanced",
    weaponName: "Black Box",
    wearTier: "Factory New",
    isStrange: false,
    isUnusual: true,
    isFestivized: false,
    isNonCraftable: false,
    killstreakTier: 0,
  });
});

test("matchDecoratedWeapon returns null for a standalone War Paint tool - that's matchWarPaintTool's own case", async () => {
  assert.equal(await matchDecoratedWeapon("Necromanced War Paint (Battle Scarred)"), null);
});

test("matchDecoratedWeapon returns null when no known skin name is a prefix", async () => {
  assert.equal(await matchDecoratedWeapon("Some Unknown Skin Rocket Launcher (Factory New)"), null);
});

test("matchDecoratedWeapon returns null when the skin match would leave an empty weapon name", async () => {
  assert.equal(await matchDecoratedWeapon("Necromanced (Battle Scarred)"), null);
});

test("matchDecoratedWeapon returns null when the name has no trailing '(Wear Tier)' suffix at all, by default (requireWearTier defaults true)", async () => {
  assert.equal(await matchDecoratedWeapon("Necromanced Black Box"), null);
});

// A non-marketable (untradeable) item's on-page title never carries a wear
// tier at all (only the Community Market's own market_hash_name does - see
// steamcommunity.com/itemQuickLinks/content.js's own resolveRealItemName
// note) - this used to return null outright without a "(Wear Tier)" suffix
// to anchor on regardless of caller, silently falling through to the generic
// (non-decorated) branch and losing the skin/weapon split + texture filter
// entirely. requireWearTier: false (opt-in only - see this function's own
// header note on why it isn't the default) still splits skin from weapon via
// findSkinNamePrefix, just with wearTier left null.
test("matchDecoratedWeapon still splits skin from weapon when there's no trailing '(Wear Tier)' suffix at all, when requireWearTier: false is passed explicitly", async () => {
  assert.deepEqual(await matchDecoratedWeapon("Necromanced Black Box", { requireWearTier: false }), {
    skinName: "Necromanced",
    weaponName: "Black Box",
    wearTier: null,
    isStrange: false,
    isUnusual: false,
    isFestivized: false,
    isNonCraftable: false,
    killstreakTier: 0,
  });
});

test("createBpStatsLinkDecoratedWeapon omits wearTier (both sites) rather than sending the literal string 'null' when it's missing", async () => {
  const match = await matchDecoratedWeapon("Necromanced Black Box", { requireWearTier: false });

  const classicUrl = await createBpStatsLinkDecoratedWeapon(match, false);
  assert.equal(classicUrl, "https://backpack.tf/stats/Decorated%20Weapon/Necromanced%20%7C%20Black%20Box/Tradable/Craftable");

  const nextUrl = new URL(await createBpStatsLinkDecoratedWeapon(match, true));
  assert.equal(nextUrl.searchParams.get("item"), "Black Box");
  assert.equal(nextUrl.searchParams.has("wearTier"), false);
});

test("buildDecoratedWeaponClassifiedsLink omits wear/wear_tier/wearTier params on both sites when wearTier is missing", () => {
  const match = { skinName: "Necromanced", weaponName: "Black Box", wearTier: null, isStrange: false, textureId: 42 };

  const classicUrl = new URL(buildDecoratedWeaponClassifiedsLink(match, false));
  assert.equal(classicUrl.searchParams.get("texture"), "42");
  assert.equal(classicUrl.searchParams.has("wear"), false);
  assert.equal(classicUrl.searchParams.has("wear_tier"), false);

  const nextUrl = new URL(buildDecoratedWeaponClassifiedsLink(match, true));
  assert.equal(nextUrl.searchParams.get("texture"), "42");
  assert.equal(nextUrl.searchParams.has("wearTier"), false);
});

test("createBpStatsLinkDecoratedWeapon uses the resolved weapon name + ' | ' skin separator on classic backpack.tf", async () => {
  const match = await matchDecoratedWeapon("Necromanced Black Box (Battle Scarred)");
  const url = await createBpStatsLinkDecoratedWeapon(match, false);
  assert.equal(
    url,
    "https://backpack.tf/stats/Decorated%20Weapon/Necromanced%20%7C%20Black%20Box%20(Battle%20Scarred)/Tradable/Craftable"
  );
});

test("createBpStatsLinkDecoratedWeapon uses the NUMERIC quality id on next.backpack.tf for the default variant, literal 'Strange' for the Strange one", async () => {
  const plain = await matchDecoratedWeapon("Necromanced Black Box (Battle Scarred)");
  const plainUrl = new URL(await createBpStatsLinkDecoratedWeapon(plain, true));
  assert.equal(plainUrl.searchParams.get("item"), "Black Box");
  assert.equal(plainUrl.searchParams.get("quality"), "15");

  const strange = await matchDecoratedWeapon("Strange Necromanced Black Box (Battle Scarred)");
  const strangeUrl = new URL(await createBpStatsLinkDecoratedWeapon(strange, true));
  assert.equal(strangeUrl.searchParams.get("quality"), "Strange");
});

test("buildDecoratedWeaponClassifiedsLink uses NUMERIC quality ids on both sites (unlike the stats link)", () => {
  const match = { skinName: "Necromanced", weaponName: "Black Box", wearTier: "Battle Scarred", isStrange: false, textureId: 42 };

  const classicUrl = new URL(buildDecoratedWeaponClassifiedsLink(match, false));
  assert.equal(classicUrl.searchParams.get("item"), "Black Box");
  assert.equal(classicUrl.searchParams.get("quality"), "15");
  assert.equal(classicUrl.searchParams.get("texture"), "42");
  assert.equal(classicUrl.searchParams.get("texture_name"), "Necromanced");
  assert.equal(classicUrl.searchParams.get("wear_tier"), classicUrl.searchParams.get("wear"));
  assert.equal(classicUrl.searchParams.get("killstreak_tier"), "0");

  const nextUrl = new URL(buildDecoratedWeaponClassifiedsLink(match, true));
  assert.equal(nextUrl.searchParams.get("itemName"), "Black Box");
  assert.equal(nextUrl.searchParams.get("killstreakTier"), "0");
  assert.equal(nextUrl.searchParams.get("festivized"), "0");
  assert.equal(nextUrl.searchParams.get("australium"), "0");
  assert.equal(nextUrl.searchParams.get("particle"), "none");
});

// REGRESSION for a live bug report: this used to be hardcoded "0" regardless
// of match.isFestivized (matchDecoratedWeapon didn't detect it at all yet -
// see its own isFestivized note).
test("buildDecoratedWeaponClassifiedsLink sends festivized=1 on next.backpack.tf when isFestivized is set", () => {
  const match = { skinName: "Macaw Masked", weaponName: "Sniper Rifle", wearTier: "Well-Worn", isFestivized: true, textureId: 7 };
  const nextUrl = new URL(buildDecoratedWeaponClassifiedsLink(match, true));
  assert.equal(nextUrl.searchParams.get("festivized"), "1");
});

test("buildDecoratedWeaponClassifiedsLink carries a real killstreakTier/sheenId/killstreakerId/effectId through onto both sites, instead of discarding them", () => {
  const match = {
    skinName: "Necromanced",
    weaponName: "Black Box",
    wearTier: "Battle Scarred",
    isStrange: false,
    textureId: 42,
    killstreakTier: 3,
    sheenId: 5,
    killstreakerId: 2004,
    effectId: 13,
  };

  const classicUrl = new URL(buildDecoratedWeaponClassifiedsLink(match, false));
  assert.equal(classicUrl.searchParams.get("killstreak_tier"), "3");
  assert.equal(classicUrl.searchParams.get("sheen"), "5");
  assert.equal(classicUrl.searchParams.get("killstreaker"), "2004");
  assert.equal(classicUrl.searchParams.get("particle"), "13");

  const nextUrl = new URL(buildDecoratedWeaponClassifiedsLink(match, true));
  assert.equal(nextUrl.searchParams.get("killstreakTier"), "3");
  assert.equal(nextUrl.searchParams.get("sheen"), "5");
  assert.equal(nextUrl.searchParams.get("killstreaker"), "2004");
  assert.equal(nextUrl.searchParams.get("particle"), "13");
});

// REGRESSION for a live bug report: an Unusual Decorated Weapon's real
// persisted quality (5) takes priority over isStrange (11)/the "Decorated
// Weapon" pseudo-quality (15) default - see matchDecoratedWeapon's own
// isUnusual note.
test("buildDecoratedWeaponClassifiedsLink uses Unusual's quality id (5) when isUnusual is set, even if isStrange is also true", () => {
  const match = { skinName: "Star Crossed", weaponName: "Iron Bomber", wearTier: "Factory New", isStrange: true, isUnusual: true, textureId: 51, killstreakTier: 3, sheenId: 3, killstreakerId: 2002, effectId: 701 };

  const classicUrl = new URL(buildDecoratedWeaponClassifiedsLink(match, false));
  assert.equal(classicUrl.searchParams.get("quality"), "5");
  assert.equal(classicUrl.searchParams.get("item"), "Iron Bomber");
  assert.equal(classicUrl.searchParams.get("texture"), "51");
  assert.equal(classicUrl.searchParams.get("killstreak_tier"), "3");

  const nextUrl = new URL(buildDecoratedWeaponClassifiedsLink(match, true));
  assert.equal(nextUrl.searchParams.get("quality"), "5");
  assert.equal(nextUrl.searchParams.get("itemName"), "Iron Bomber");
  assert.equal(nextUrl.searchParams.get("texture"), "51");
  assert.equal(nextUrl.searchParams.get("killstreakTier"), "3");
});

test("createBpStatsLinkDecoratedWeapon uses literal 'Unusual' text on next.backpack.tf when isUnusual is set", async () => {
  const match = await matchDecoratedWeapon("Strange Unusual Necromanced Black Box (Factory New)");
  const url = new URL(await createBpStatsLinkDecoratedWeapon(match, true));
  assert.equal(url.searchParams.get("quality"), "Unusual");
});

test("buildDecoratedWeaponClassifiedsLink omits texture/wear params on both sites when textureId is unresolved", () => {
  const match = { skinName: "Necromanced", weaponName: "Black Box", wearTier: "Battle Scarred", isStrange: true, textureId: null };

  const classicUrl = new URL(buildDecoratedWeaponClassifiedsLink(match, false));
  assert.equal(classicUrl.searchParams.get("quality"), "11");
  assert.equal(classicUrl.searchParams.get("texture"), null);
  // wear_tier is still set (wearTier itself resolves fine independent of textureId).
  assert.equal(classicUrl.searchParams.get("wear"), classicUrl.searchParams.get("wear_tier"));

  const nextUrl = new URL(buildDecoratedWeaponClassifiedsLink(match, true));
  assert.equal(nextUrl.searchParams.get("texture"), null);
});
