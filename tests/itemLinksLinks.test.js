import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildStatsLinks,
  buildClassifiedsHref,
  buildNextClassifiedsHref,
  buildSteamMarketName,
  buildSteamMarketHref,
  buildMarketplaceHref,
  buildStnTradingHref,
  buildMannStoreHref,
  buildPostsTfLink,
} from "../scrap.tf/itemLinks/links.js";
import { buildGladiatorHref } from "../utils/tf2StatsLinks/index.js";

// buildPostsTfLink routes through utils/tf2Schema.js's getItemDefindex, which
// reads a schema cache off chrome.storage.local (see that file's own
// fetchJson note on why - Firefox blocks a content script from reading a
// cross-origin fetch() response directly). Pre-seeded here, before any test
// calls buildPostsTfLink, with a fresh (fetchedAt: now) cache so the lookup
// never falls through to a real network fetch - same pattern
// tests/addPostsTfButton.test.js's own header comment documents.
globalThis.chrome = {
  storage: {
    local: {
      async get() {
        return {
          tf2SchemaCache: {
            itemNameToDefindex: {
              "Rocket Launcher": 205,
              // Confirmed live: the real TF2 schema keys this under the full
              // "Taunt: " prefix, NOT the bare "Conga" - see
              // backpack.tf/nextUI/addPostsTfButton/content.js's own header
              // note.
              "Taunt: Conga": 1118,
              "Carbonado Botkiller Wrench Mk.I": 60181,
              // The Paint can itself, as an item - NOT a false-split
              // "Australium " + "Gold" - see hasLiteralAustraliumPrefix's
              // own tests below.
              "Australium Gold": 143,
            },
            defindexToItemName: {},
            effectNameToId: {},
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

function decodePostsTfQuery(href) {
  const b64 = new URL(href).searchParams.get("q");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
}

// Minimal "off" shape matching a plain Unique craftable Rocket Launcher -
// every test overrides just the fields its own branch cares about, the same
// way itemShape.js's own detectItemShape always returns every field (never
// omits one), just with most of them null/false/0 for a plain item.
function baseShape(overrides = {}) {
  return {
    qualityName: "Unique",
    isUncraft: false,
    craftPathSegment: "Craftable",
    baseName: "Rocket Launcher",
    encodedStatsName: encodeURIComponent("Rocket Launcher"),
    ksPrefix: "",
    ksTier: 0,
    killstreakTierName: null,
    isFestivized: false,
    festivePrefix: "",
    unusualEffectName: null,
    effectId: null,
    sheenName: null,
    sheenId: null,
    killstreakerName: null,
    killstreakerId: null,
    level: null,
    paintName: null,
    paintEntry: null,
    spellName: null,
    spellId: null,
    isDecoratedWeapon: false,
    skinName: null,
    wearName: null,
    weaponName: null,
    skinQualityName: null,
    skinHasUnusualEffect: false,
    textureId: null,
    wearTierId: null,
    isWarPaintTool: false,
    warPaintToolSkinName: null,
    warPaintToolWearName: null,
    warPaintToolQuality: null,
    warPaintToolQualityId: null,
    warPaintToolTextureId: null,
    hasStrangeTracking: false,
    isKillstreakKit: false,
    killstreakKitTargetName: null,
    killstreakKitTier: null,
    killstreakKitTierWord: null,
    kitTargetDefindex: null,
    isFabricatorKit: false,
    fabricatorKitTargetName: null,
    fabricatorKitTier: null,
    fabricatorKitTierWord: null,
    fabricatorPriceindex: null,
    isTargetTool: false,
    targetToolTargetName: null,
    targetToolDefindex: null,
    statsUnresolved: false,
    isBotkiller: false,
    botkillerWeaponName: null,
    botkillerSlug: null,
    ...overrides,
  };
}

// --- buildStatsLinks ---

test("buildStatsLinks returns a single Steam API key prompt when statsUnresolved, declaring both stats and classifieds need it", () => {
  const links = buildStatsLinks(baseShape({ statsUnresolved: true }));
  assert.equal(links.length, 1);
  assert.equal(links[0].label, "Set Steam API key for stats/classifieds");
  // Rendered as the key hint (opens the extension's own key settings), not a
  // link to Steam's key page.
  assert.equal(links[0].href, null);
  assert.equal(links[0].needsKey, true);
  assert.match(links[0].title, /Steam Web API key/);
  assert.match(links[0].title, /posts\.tf/);
});

test("buildStatsLinks builds the plain quality/name/Tradable/Craftable path for both sites", () => {
  const links = buildStatsLinks(baseShape());
  assert.equal(links[0].href, "https://next.backpack.tf/stats/Unique/Rocket%20Launcher/Tradable/Craftable");
  assert.equal(links[1].href, "https://backpack.tf/stats/Unique/Rocket%20Launcher/Tradable/Craftable");
});

test("buildStatsLinks appends the effect id path segment for an Unusual", () => {
  const shape = baseShape({
    qualityName: "Unusual",
    baseName: "Team Captain",
    encodedStatsName: encodeURIComponent("Team Captain"),
    unusualEffectName: "Fountain of Delight",
    effectId: 22,
  });
  const links = buildStatsLinks(shape);
  assert.equal(links[0].href, "https://next.backpack.tf/stats/Unusual/Team%20Captain/Tradable/Craftable/22");
  assert.equal(links[1].href, "https://backpack.tf/stats/Unusual/Team%20Captain/Tradable/Craftable/22");
});

test("buildStatsLinks uses the tier-prefixed generic Kit name (classic) vs generic Kit + params (next)", () => {
  const shape = baseShape({
    isKillstreakKit: true,
    killstreakKitTargetName: "Rocket Launcher",
    killstreakKitTier: 3,
    killstreakKitTierWord: "Professional ",
    kitTargetDefindex: 205,
    craftPathSegment: "Non-Craftable",
  });
  const links = buildStatsLinks(shape);
  assert.equal(links[1].href, "https://backpack.tf/stats/Unique/Professional%20Killstreak%20Kit/Tradable/Non-Craftable/3-205");
  const nextUrl = new URL(links[0].href);
  assert.equal(nextUrl.origin + nextUrl.pathname, "https://next.backpack.tf/stats");
  assert.equal(nextUrl.searchParams.get("item"), "Kit");
  assert.equal(nextUrl.searchParams.get("quality"), "Unique");
  assert.equal(nextUrl.searchParams.get("killstreakTier"), "3");
  assert.equal(nextUrl.searchParams.get("craftable"), "false");
  assert.equal(nextUrl.searchParams.get("priceindex"), "3-205");
});

test("buildStatsLinks uses the generic Fabricator name and fabricatorPriceindex for both sites", () => {
  const shape = baseShape({
    isFabricatorKit: true,
    fabricatorKitTargetName: "Shotgun",
    fabricatorPriceindex: "6526-6-199",
    craftPathSegment: "Craftable",
  });
  const links = buildStatsLinks(shape);
  const expected = "Unique/Fabricator/Tradable/Craftable/6526-6-199";
  assert.equal(links[0].href, `https://next.backpack.tf/stats/${expected}`);
  assert.equal(links[1].href, `https://backpack.tf/stats/${expected}`);
});

test("buildStatsLinks uses the plain Strangifier name and targetToolDefindex path suffix for both sites", () => {
  const shape = baseShape({
    isTargetTool: true,
    targetToolTargetName: "Righteous Bison",
    targetToolBaseItemName: "Strangifier",
    targetToolDefindex: 1103,
    craftPathSegment: "Craftable",
  });
  const links = buildStatsLinks(shape);
  const expected = "Unique/Strangifier/Tradable/Craftable/1103";
  assert.equal(links[0].href, `https://next.backpack.tf/stats/${expected}`);
  assert.equal(links[1].href, `https://backpack.tf/stats/${expected}`);
});

// REGRESSION for a live bug report: a Strangifier Chemistry Set's own
// canonical backpack.tf item name is "Chemistry Set", not the literal word
// "Strangifier" - see toolVariants.js's own targetToolBaseItemName note.
test("buildStatsLinks uses 'Chemistry Set' (not 'Strangifier') for a Strangifier Chemistry Set", () => {
  const shape = baseShape({
    isTargetTool: true,
    targetToolTargetName: "Professor Speks",
    targetToolBaseItemName: "Chemistry Set",
    targetToolDefindex: 20003,
    craftPathSegment: "Craftable",
  });
  const links = buildStatsLinks(shape);
  const expected = "Unique/Chemistry%20Set/Tradable/Craftable/20003";
  assert.equal(links[0].href, `https://next.backpack.tf/stats/${expected}`);
  assert.equal(links[1].href, `https://backpack.tf/stats/${expected}`);
});

test("buildStatsLinks builds the '{skin} | War Paint ({wear})' classic name and item=War Paint next params for a standalone War Paint tool", () => {
  const shape = baseShape({
    isWarPaintTool: true,
    warPaintToolSkinName: "Dragon Slayer",
    warPaintToolWearName: "Factory New",
    warPaintToolQuality: "Decorated Weapon",
    craftPathSegment: "Craftable",
  });
  const links = buildStatsLinks(shape);
  assert.equal(
    links[1].href,
    "https://backpack.tf/stats/Decorated%20Weapon/Dragon%20Slayer%20%7C%20War%20Paint%20(Factory%20New)/Tradable/Craftable"
  );
  const nextUrl = new URL(links[0].href);
  assert.equal(nextUrl.searchParams.get("item"), "War Paint");
  assert.equal(nextUrl.searchParams.get("quality"), "Decorated Weapon");
  assert.equal(nextUrl.searchParams.get("wearTier"), "Factory New");
  assert.equal(nextUrl.searchParams.get("texture"), "Dragon Slayer");
});

test("buildStatsLinks builds the '{skin} | {weapon} ({wear})' classic name and item={weapon} next params for a Decorated Weapon", () => {
  const shape = baseShape({
    isDecoratedWeapon: true,
    qualityName: "Strange",
    skinName: "Necromanced",
    weaponName: "Black Box",
    wearName: "Battle Scarred",
    craftPathSegment: "Craftable",
  });
  const links = buildStatsLinks(shape);
  assert.equal(links[1].href, "https://backpack.tf/stats/Strange/Necromanced%20%7C%20Black%20Box%20(Battle%20Scarred)/Tradable/Craftable");
  const nextUrl = new URL(links[0].href);
  assert.equal(nextUrl.searchParams.get("item"), "Black Box");
  // Strange keeps the literal "Strange" quality text (not the numeric 15 id).
  assert.equal(nextUrl.searchParams.get("quality"), "Strange");
  assert.equal(nextUrl.searchParams.get("wearTier"), "Battle Scarred");
  assert.equal(nextUrl.searchParams.get("texture"), "Necromanced");
  assert.equal(nextUrl.searchParams.get("killstreakTier"), null);
});

// REGRESSION for a live bug report ("Strange ★Unusual Candy Coated Tomislav
// (Factory New)" - skinDetection.js's own detectSkin already resolves
// qualityName to "Unusual" for this, not "Strange" - see its own
// note): this used to only special-case "Strange" here, so an Unusual-
// quality Decorated Weapon's next.backpack.tf stats link fell into the
// numeric "Decorated Weapon" (15) default instead of using the literal
// "Unusual" quality text.
test("buildStatsLinks uses the literal 'Unusual' quality text (not the numeric 15 id) for an Unusual-quality Decorated Weapon", () => {
  const shape = baseShape({
    isDecoratedWeapon: true,
    qualityName: "Unusual",
    skinName: "Candy Coated",
    weaponName: "Tomislav",
    wearName: "Factory New",
    craftPathSegment: "Craftable",
  });
  const links = buildStatsLinks(shape);
  assert.equal(links[1].href, "https://backpack.tf/stats/Unusual/Candy%20Coated%20%7C%20Tomislav%20(Factory%20New)/Tradable/Craftable");
  const nextUrl = new URL(links[0].href);
  assert.equal(nextUrl.searchParams.get("item"), "Tomislav");
  assert.equal(nextUrl.searchParams.get("quality"), "Unusual");
  assert.equal(nextUrl.searchParams.get("texture"), "Candy Coated");
});

test("buildStatsLinks uses the numeric Decorated Weapon quality id (not 'Strange') for a non-Strange skin, and includes killstreakTier when present", () => {
  const shape = baseShape({
    isDecoratedWeapon: true,
    qualityName: "Decorated Weapon",
    skinName: "Macaw Masked",
    weaponName: "Grenade Launcher",
    wearName: "Factory New",
    ksTier: 2,
    craftPathSegment: "Craftable",
  });
  const links = buildStatsLinks(shape);
  const nextUrl = new URL(links[0].href);
  assert.equal(nextUrl.searchParams.get("quality"), "15");
  assert.equal(nextUrl.searchParams.get("killstreakTier"), "2");
});

// --- buildClassifiedsHref (classic backpack.tf) ---

test("buildClassifiedsHref builds the literal texture_name/wear params for a standalone War Paint tool", () => {
  const shape = baseShape({
    isWarPaintTool: true,
    warPaintToolQualityId: 15,
    warPaintToolSkinName: "Dragon Slayer",
    warPaintToolWearName: "Factory New",
  });
  const url = new URL(buildClassifiedsHref(shape));
  assert.equal(url.origin + url.pathname, "https://backpack.tf/classifieds");
  assert.equal(url.searchParams.get("item"), "War Paint");
  assert.equal(url.searchParams.get("quality"), "15");
  assert.equal(url.searchParams.get("craftable"), "1");
  assert.equal(url.searchParams.get("texture_name"), "Dragon Slayer");
  assert.equal(url.searchParams.get("wear"), "Factory New");
  assert.equal(url.searchParams.get("australium"), "-1");
  assert.equal(url.searchParams.get("killstreak_tier"), "0");
});

// A Strange-tracking War Paint tool with its own Unusual effect never
// filtered by that effect at all here - this branch's own early return
// skipped past the generic branch's particle handling entirely.
test("buildClassifiedsHref filters by particle for a War Paint tool with an Unusual effect", () => {
  const shape = baseShape({
    isWarPaintTool: true,
    warPaintToolQualityId: 5,
    warPaintToolSkinName: "Beachy Boy",
    warPaintToolWearName: "Minimal Wear",
    effectId: 703,
  });
  const url = new URL(buildClassifiedsHref(shape));
  assert.equal(url.searchParams.get("particle"), "703");
});

test("buildClassifiedsHref omits particle entirely for a War Paint tool with no Unusual effect", () => {
  const shape = baseShape({
    isWarPaintTool: true,
    warPaintToolQualityId: 15,
    warPaintToolSkinName: "Dragon Slayer",
    warPaintToolWearName: "Factory New",
  });
  const url = new URL(buildClassifiedsHref(shape));
  assert.equal(url.searchParams.has("particle"), false);
});

test("buildClassifiedsHref builds a plain item's search filters", () => {
  const url = new URL(buildClassifiedsHref(baseShape()));
  assert.equal(url.searchParams.get("item"), "Rocket Launcher");
  assert.equal(url.searchParams.get("quality"), "6");
  assert.equal(url.searchParams.get("tradable"), "1");
  assert.equal(url.searchParams.get("craftable"), "1");
  assert.equal(url.searchParams.get("australium"), "-1");
  assert.equal(url.searchParams.get("killstreak_tier"), "0");
});

// "Australium Gold" is a real Paint can name, not an Australium weapon -
// deriveClassifiedsFilters' own isAustralium check used to strip
// "Australium " unconditionally, searching for a nonexistent "Gold" item
// with australium=1 set instead of the Paint can's own real full name.
test("buildClassifiedsHref never treats the Paint can 'Australium Gold' as an Australium weapon", () => {
  const shape = baseShape({ baseName: "Australium Gold" });
  const url = new URL(buildClassifiedsHref(shape));
  assert.equal(url.searchParams.get("item"), "Australium Gold");
  assert.equal(url.searchParams.get("australium"), "-1");
});

// Hovering a Paint Can ITSELF never got a paint filter - shape.paintEntry
// only ever resolves from a "Painted X" tooltip line, which a Paint Can
// never has. Searching next.backpack.tf with no paint filter for a Paint
// Can returns an EMPTY result - confirmed live. deriveClassifiedsFilters
// now self-matches the item's own name against PAINT_IDS when
// shape.paintEntry wasn't already resolved.
test("classic/next/marketplace links self-match a Paint Can's own name against PAINT_IDS for its paint filter", () => {
  const shape = baseShape({ baseName: "Aged Moustache Grey" });

  const classic = new URL(buildClassifiedsHref(shape));
  assert.equal(classic.searchParams.get("paint"), String(parseInt("7e7e7e", 16)));

  const next = new URL(buildNextClassifiedsHref(shape));
  assert.equal(next.searchParams.get("paint"), "5038");

  const market = new URL(buildMarketplaceHref(shape));
  assert.equal(market.searchParams.get("spaint[]"), String(parseInt("7e7e7e", 16)));
});

// The literal word "Australium" in the Paint can's own name must not block
// the self-match - same false-positive class as hasLiteralAustraliumPrefix's
// own fix, checked here for the paint filter specifically.
test("self-matches even the Paint Can 'Australium Gold' for its paint filter", () => {
  const shape = baseShape({ baseName: "Australium Gold" });
  const next = new URL(buildNextClassifiedsHref(shape));
  assert.equal(next.searchParams.get("paint"), "5037");
});

// A real painted item (shape.paintEntry actually resolved from a "Painted X"
// tooltip line) must keep using that, never be overridden by a self-match
// against its own (unrelated) item name.
test("does not override an actually-painted item's own paintEntry with a self-match", () => {
  const shape = baseShape({ baseName: "Team Captain", paintName: "Team Spirit", paintEntry: { id: 5046, color: "#b8383b" } });
  const next = new URL(buildNextClassifiedsHref(shape));
  assert.equal(next.searchParams.get("paint"), "5046");
});

test("buildClassifiedsHref searches by target weapon name with item_type=target, and forces a Kit non-craftable regardless of the item's own craftable class", () => {
  const shape = baseShape({
    isKillstreakKit: true,
    killstreakKitTargetName: "Rocket Launcher",
    killstreakKitTier: 3,
    isUncraft: false,
  });
  const url = new URL(buildClassifiedsHref(shape));
  assert.equal(url.searchParams.get("item"), "Rocket Launcher");
  assert.equal(url.searchParams.get("item_type"), "target");
  assert.equal(url.searchParams.get("craftable"), "-1");
  assert.equal(url.searchParams.get("killstreak_tier"), "3");
});

test("buildClassifiedsHref searches by target weapon name with item_type=target, and forces a Fabricator's Kit non-craftable even when the hovered Fabricator itself is craftable", () => {
  const shape = baseShape({
    isFabricatorKit: true,
    fabricatorKitTargetName: "Shotgun",
    fabricatorKitTier: 3,
    isUncraft: false,
  });
  const url = new URL(buildClassifiedsHref(shape));
  assert.equal(url.searchParams.get("item"), "Shotgun");
  assert.equal(url.searchParams.get("item_type"), "target");
  assert.equal(url.searchParams.get("craftable"), "-1");
  assert.equal(url.searchParams.get("killstreak_tier"), "3");
});

test("buildClassifiedsHref adds texture/wear/texture_name/wear_tier params for a Decorated Weapon", () => {
  const shape = baseShape({
    isDecoratedWeapon: true,
    weaponName: "Black Box",
    skinName: "Necromanced",
    textureId: 123,
    wearTierId: 5,
    qualityName: "Strange",
    ksTier: 2,
  });
  const url = new URL(buildClassifiedsHref(shape));
  assert.equal(url.searchParams.get("item"), "Black Box");
  assert.equal(url.searchParams.get("texture"), "123");
  assert.equal(url.searchParams.get("wear"), "5");
  assert.equal(url.searchParams.get("texture_name"), "Necromanced");
  assert.equal(url.searchParams.get("wear_tier"), "5");
  assert.equal(url.searchParams.get("killstreak_tier"), "2");
});

test("buildClassifiedsHref adds sheen/killstreaker/spell params by name/id when present", () => {
  const shape = baseShape({ sheenId: 6, killstreakerId: 2007, spellName: "Exorcism" });
  const url = new URL(buildClassifiedsHref(shape));
  assert.equal(url.searchParams.get("sheen"), "6");
  assert.equal(url.searchParams.get("killstreaker"), "2007");
  // Classic backpack.tf takes the literal spell NAME, not next's composite id.
  assert.equal(url.searchParams.get("spell"), "Exorcism");
});

test("buildClassifiedsHref sends the decimal-RGB paint id, but skips it entirely for an Unusual", () => {
  const paintedShape = baseShape({ paintEntry: { id: 5040, color: "#141414" } });
  assert.equal(new URL(buildClassifiedsHref(paintedShape)).searchParams.get("paint"), "1315860");

  const unusualPaintedShape = baseShape({ paintEntry: { id: 5040, color: "#141414" }, unusualEffectName: "Fountain of Delight" });
  assert.equal(new URL(buildClassifiedsHref(unusualPaintedShape)).searchParams.get("paint"), null);
});

test("buildClassifiedsHref adds a particle param for an Unusual effect", () => {
  const shape = baseShape({ unusualEffectName: "Fountain of Delight", effectId: 22 });
  assert.equal(new URL(buildClassifiedsHref(shape)).searchParams.get("particle"), "22");
});

// --- buildNextClassifiedsHref (next.backpack.tf) ---

test("buildNextClassifiedsHref uses the generic itemName=Kit + targetItem scheme, with no tradable/craftable/australium params", () => {
  const shape = baseShape({ isKillstreakKit: true, killstreakKitTargetName: "Rocket Launcher", killstreakKitTier: 3 });
  const url = new URL(buildNextClassifiedsHref(shape));
  assert.equal(url.origin + url.pathname, "https://next.backpack.tf/classifieds");
  assert.equal(url.searchParams.get("itemName"), "Kit");
  assert.equal(url.searchParams.get("quality"), "6");
  assert.equal(url.searchParams.get("targetItem"), "Rocket Launcher");
  assert.equal(url.searchParams.get("killstreakTier"), "3");
  assert.equal(url.searchParams.get("tradable"), null);
  assert.equal(url.searchParams.get("craftable"), null);
});

test("buildNextClassifiedsHref uses itemName=Fabricator + targetItem for a Fabricator", () => {
  const shape = baseShape({ isFabricatorKit: true, fabricatorKitTargetName: "Shotgun", fabricatorKitTier: 3 });
  const url = new URL(buildNextClassifiedsHref(shape));
  assert.equal(url.searchParams.get("itemName"), "Fabricator");
  assert.equal(url.searchParams.get("targetItem"), "Shotgun");
});

test("buildNextClassifiedsHref uses numeric texture/wearTier ids for a standalone War Paint tool", () => {
  const shape = baseShape({
    isWarPaintTool: true,
    warPaintToolQualityId: 15,
    warPaintToolTextureId: 265,
    warPaintToolWearName: "Factory New",
  });
  const url = new URL(buildNextClassifiedsHref(shape));
  assert.equal(url.searchParams.get("itemName"), "War Paint");
  assert.equal(url.searchParams.get("quality"), "15");
  assert.equal(url.searchParams.get("texture"), "265");
  assert.equal(url.searchParams.get("wearTier"), "1");
  // Sent explicitly as "none" (not omitted), matching this site's own
  // established convention elsewhere in this file.
  assert.equal(url.searchParams.get("particle"), "none");
});

test("buildNextClassifiedsHref filters by particle for a War Paint tool with an Unusual effect", () => {
  const shape = baseShape({
    isWarPaintTool: true,
    warPaintToolQualityId: 5,
    warPaintToolTextureId: 265,
    warPaintToolWearName: "Minimal Wear",
    effectId: 703,
  });
  const url = new URL(buildNextClassifiedsHref(shape));
  assert.equal(url.searchParams.get("particle"), "703");
});

test("buildNextClassifiedsHref uses the resolved weapon name and sends festivized explicitly for a Decorated Weapon", () => {
  const shape = baseShape({
    isDecoratedWeapon: true,
    weaponName: "Soda Popper",
    isFestivized: true,
    textureId: 99,
    wearTierId: 2,
  });
  const url = new URL(buildNextClassifiedsHref(shape));
  assert.equal(url.searchParams.get("itemName"), "Soda Popper");
  assert.equal(url.searchParams.get("festivized"), "1");
  assert.equal(url.searchParams.get("texture"), "99");
  assert.equal(url.searchParams.get("wearTier"), "2");
});

test("buildNextClassifiedsHref sends festivized=0 explicitly for a non-festivized item", () => {
  const url = new URL(buildNextClassifiedsHref(baseShape()));
  assert.equal(url.searchParams.get("festivized"), "0");
});

test("buildNextClassifiedsHref sends particle=none/texture=none explicitly for a plain item with no effect/skin", () => {
  const url = new URL(buildNextClassifiedsHref(baseShape()));
  assert.equal(url.searchParams.get("particle"), "none");
  assert.equal(url.searchParams.get("texture"), "none");
});

test("buildNextClassifiedsHref adds targetItem for a target-item tool", () => {
  const shape = baseShape({ isTargetTool: true, targetToolTargetName: "Righteous Bison", targetToolBaseItemName: "Strangifier" });
  const url = new URL(buildNextClassifiedsHref(shape));
  assert.equal(url.searchParams.get("itemName"), "Strangifier");
  assert.equal(url.searchParams.get("targetItem"), "Righteous Bison");
});

// REGRESSION for a live bug report ("Professor Speks Strangifier Chemistry
// Set Series #2"): confirmed live -
// https://next.backpack.tf/classifieds?itemName=Chemistry%20Set&quality=6&
// targetItem=Professor%20Speks
test("buildNextClassifiedsHref searches 'Chemistry Set' (not 'Strangifier') for a Strangifier Chemistry Set, still filtered by targetItem", () => {
  const shape = baseShape({ isTargetTool: true, targetToolTargetName: "Professor Speks", targetToolBaseItemName: "Chemistry Set" });
  const url = new URL(buildNextClassifiedsHref(shape));
  assert.equal(url.searchParams.get("itemName"), "Chemistry Set");
  assert.equal(url.searchParams.get("targetItem"), "Professor Speks");
});

// REGRESSION for a live bug report: a numbered Crate/Strongbox's own "Series
// #{n}" suffix used to just stay baked into the plain itemName text - confirmed
// live the correct next.backpack.tf search splits it into its own bare
// itemName plus a "crateSeries" param taking the printed number DIRECTLY (an
// earlier live report claiming some other, non-matching internal numbering
// was retracted as a mistake).
test("buildNextClassifiedsHref splits a numbered Crate's 'Series #n' suffix into its own crateSeries param", () => {
  const shape = baseShape({ baseName: "Mann Co. Supply Crate Series #26" });
  const url = new URL(buildNextClassifiedsHref(shape));
  assert.equal(url.searchParams.get("itemName"), "Mann Co. Supply Crate");
  assert.equal(url.searchParams.get("crateSeries"), "26");
});

test("buildNextClassifiedsHref splits a Strongbox's 'Series #n' suffix into crateSeries too, not just Supply Crate specifically", () => {
  const shape = baseShape({ baseName: "Mann Co. Strongbox Series #81" });
  const url = new URL(buildNextClassifiedsHref(shape));
  assert.equal(url.searchParams.get("itemName"), "Mann Co. Strongbox");
  assert.equal(url.searchParams.get("crateSeries"), "81");
});

// An earlier version of this fix stripped the "Series #n" suffix off the
// SHARED filters.itemName, which marketplace.tf's own sterm also consumes
// - it has no confirmed crateSeries-equivalent param, so losing the
// specific series number from its own search text would have made it
// WORSE, not fixed anything.
test("buildMarketplaceHref keeps the FULL 'Series #n' name intact for a numbered Crate (no confirmed crateSeries-equivalent there)", () => {
  const shape = baseShape({ baseName: "Mann Co. Supply Crate Series #26" });
  const marketUrl = new URL(buildMarketplaceHref(shape));
  assert.equal(marketUrl.searchParams.get("sterm"), "Mann Co. Supply Crate Series #26");
});

// REGRESSION for a live bug report: classic backpack.tf's classifieds DOES
// have a confirmed crate filter too - a generic "numeric" attribute-range
// filter (numeric=crate&value={n}&low={n}), with item= split down to the
// bare crate name the same way next.backpack.tf's own itemName is. Confirmed
// live for both Mann Co. Supply Crate Series #26 and Naughty Winter Crate
// 2014 Series #88.
test("buildClassifiedsHref filters a numbered Crate via numeric=crate&value={n}&low={n}, with item split the same way as next.backpack.tf's itemName", () => {
  const shape = baseShape({ baseName: "Mann Co. Supply Crate Series #26" });
  const classicUrl = new URL(buildClassifiedsHref(shape));
  assert.equal(classicUrl.searchParams.get("item"), "Mann Co. Supply Crate");
  assert.equal(classicUrl.searchParams.get("numeric"), "crate");
  assert.equal(classicUrl.searchParams.get("value"), "26");
  assert.equal(classicUrl.searchParams.get("low"), "26");
});

test("buildClassifiedsHref omits numeric/value/low entirely for a plain item with no 'Series #n' suffix", () => {
  const shape = baseShape({ baseName: "Rocket Launcher" });
  const classicUrl = new URL(buildClassifiedsHref(shape));
  assert.equal(classicUrl.searchParams.has("numeric"), false);
  assert.equal(classicUrl.searchParams.has("value"), false);
  assert.equal(classicUrl.searchParams.has("low"), false);
});

test("buildNextClassifiedsHref omits crateSeries entirely for a plain item with no 'Series #n' suffix", () => {
  const shape = baseShape({ baseName: "Rocket Launcher" });
  const url = new URL(buildNextClassifiedsHref(shape));
  assert.equal(url.searchParams.has("crateSeries"), false);
});

test("buildNextClassifiedsHref includes particle/sheen/killstreaker/spell params (non-Kit branch) when the shape has them", () => {
  const shape = baseShape({
    effectId: 13,
    sheenId: 7,
    killstreakerId: 2005,
    spellId: "paint-0",
  });
  const url = new URL(buildNextClassifiedsHref(shape));
  assert.equal(url.searchParams.get("particle"), "13");
  assert.equal(url.searchParams.get("sheen"), "7");
  assert.equal(url.searchParams.get("killstreaker"), "2005");
  assert.equal(url.searchParams.get("spell"), "paint-0");
});

test("buildNextClassifiedsHref skips the paint param for an Unusual but includes it otherwise", () => {
  const paintedShape = baseShape({ paintEntry: { id: 5040, color: "#141414" } });
  assert.equal(new URL(buildNextClassifiedsHref(paintedShape)).searchParams.get("paint"), "5040");

  const unusualPaintedShape = baseShape({ paintEntry: { id: 5040, color: "#141414" }, unusualEffectName: "Fountain of Delight" });
  assert.equal(new URL(buildNextClassifiedsHref(unusualPaintedShape)).searchParams.get("paint"), null);
});

test("buildNextClassifiedsHref sends paint=none explicitly for an unpainted, non-Unusual item, not just omitting it", () => {
  const url = new URL(buildNextClassifiedsHref(baseShape()));
  assert.equal(url.searchParams.get("paint"), "none");
});

test("buildNextClassifiedsHref sends spell=none explicitly for an item with no Halloween Spell, not just omitting it", () => {
  const url = new URL(buildNextClassifiedsHref(baseShape()));
  assert.equal(url.searchParams.get("spell"), "none");
});

// --- buildSteamMarketName ---

test("buildSteamMarketName reinserts 'Killstreak' and keeps the tier word verbatim for a Professional Kit", () => {
  const shape = baseShape({ isKillstreakKit: true, killstreakKitTierWord: "Professional ", killstreakKitTargetName: "Rocket Launcher" });
  assert.equal(buildSteamMarketName(shape), "Professional Killstreak Rocket Launcher Kit");
});

test("buildSteamMarketName omits the tier word entirely for a Basic Kit", () => {
  const shape = baseShape({ isKillstreakKit: true, killstreakKitTierWord: "", killstreakKitTargetName: "Big Kill" });
  assert.equal(buildSteamMarketName(shape), "Killstreak Big Kill Kit");
});

// Regression test for a live bug report: buildSteamMarketName had NO
// isFabricatorKit branch at all until this fix, so it fell through to the
// generic baseName-based case, which - just like the Kit case above - is
// missing the word "Killstreak" scrap.tf's own raw name never includes.
test("buildSteamMarketName reinserts 'Killstreak' and keeps the tier word verbatim for a Specialized Fabricator", () => {
  const shape = baseShape({
    isFabricatorKit: true,
    fabricatorKitTierWord: "Specialized ",
    fabricatorKitTargetName: "Conniver's Kunai",
  });
  assert.equal(buildSteamMarketName(shape), "Specialized Killstreak Conniver's Kunai Kit Fabricator");
});

test("buildSteamMarketName omits the tier word entirely for a Basic Fabricator", () => {
  const shape = baseShape({ isFabricatorKit: true, fabricatorKitTierWord: "", fabricatorKitTargetName: "Big Kill" });
  assert.equal(buildSteamMarketName(shape), "Killstreak Big Kill Kit Fabricator");
});

test("buildSteamMarketName omits the quality word for a plain Unique item", () => {
  assert.equal(buildSteamMarketName(baseShape()), "Rocket Launcher");
});

test("buildSteamMarketName includes quality/festive/killstreak prefixes together for a Strange Festivized Specialized Killstreak item", () => {
  const shape = baseShape({
    qualityName: "Strange",
    festivePrefix: "Festivized ",
    ksPrefix: "Specialized Killstreak ",
    baseName: "Australium Knife",
  });
  assert.equal(buildSteamMarketName(shape), "Strange Festivized Specialized Killstreak Australium Knife");
});

test("buildSteamMarketName omits the quality word for 'Decorated Weapon' too, since Steam never displays that internal label", () => {
  const shape = baseShape({ qualityName: "Decorated Weapon", baseName: "Necromanced Black Box (Battle Scarred)" });
  assert.equal(buildSteamMarketName(shape), "Necromanced Black Box (Battle Scarred)");
});

// Regression test for a live bug report: baseShape's own "isDecoratedWeapon:
// false" default means every OTHER buildSteamMarketName test above never
// actually exercises the real fields itemShape.js populates for a Decorated
// Weapon (isDecoratedWeapon/skinName/weaponName/wearName) - they either leave
// it false entirely or (the test right above) fake the outcome by hand-
// setting baseName to the already-correct string. This is the one test using
// the shape a real skinned weapon actually produces.
test("buildSteamMarketName builds '{skin} {weapon} ({wear})' (skin first, no pipe) with quality/killstreak prefixes for a real Decorated Weapon shape - not the bare baseName", () => {
  const shape = baseShape({
    isDecoratedWeapon: true,
    qualityName: "Strange",
    ksPrefix: "Professional Killstreak ",
    ksTier: 3,
    skinName: "Secretly Serviced",
    weaponName: "Sniper Rifle",
    wearName: "Factory New",
    baseName: "Sniper Rifle", // what a Decorated Weapon's baseName actually resolves to - NOT the skin/wear combo
  });
  assert.equal(buildSteamMarketName(shape), "Strange Professional Killstreak Secretly Serviced Sniper Rifle (Factory New)");
});

test("buildSteamMarketName falls back to the generic baseName shape if a Decorated Weapon is somehow missing skin/weapon/wear data", () => {
  const shape = baseShape({ isDecoratedWeapon: true, qualityName: "Strange", baseName: "Sniper Rifle" });
  assert.equal(buildSteamMarketName(shape), "Strange Sniper Rifle");
});

// --- buildSteamMarketHref ---

test("buildSteamMarketHref filters by the Unusual effect name alone, not killstreaker/sheen/paint", () => {
  const shape = baseShape({ unusualEffectName: "Fountain of Delight", killstreakerName: "Incinerator", sheenName: "Villainous Violet" });
  const url = new URL(buildSteamMarketHref(shape, "Unusual Team Captain"));
  assert.equal(url.origin + url.pathname, "https://steamcommunity.com/market/listings/440/Unusual%20Team%20Captain");
  assert.equal(url.searchParams.get("q"), "Fountain of Delight");
});

test("buildSteamMarketHref combines killstreaker+sheen as one comma-separated q param", () => {
  const shape = baseShape({ killstreakerName: "Fire Horns", sheenName: "Hot Rod" });
  const url = new URL(buildSteamMarketHref(shape, "Professional Killstreak Rocket Launcher"));
  assert.equal(url.searchParams.get("q"), "Fire Horns,Hot Rod");
});

test("buildSteamMarketHref filters by paint name alone for a plain painted hat", () => {
  const shape = baseShape({ paintName: "Australium Gold" });
  const url = new URL(buildSteamMarketHref(shape, "Strange Lazer Gazers"));
  assert.equal(url.searchParams.get("q"), "Australium Gold");
});

test("buildSteamMarketHref appends the literal 'Not Usable in Crafting' term for an uncraftable item", () => {
  const shape = baseShape({ isUncraft: true });
  const url = new URL(buildSteamMarketHref(shape, "Strange Voodoo Juju"));
  assert.equal(url.searchParams.get("q"), "Not Usable in Crafting");
});

test("buildSteamMarketHref omits the query string entirely when there are no filter terms", () => {
  const href = buildSteamMarketHref(baseShape(), "Rocket Launcher");
  assert.equal(href, "https://steamcommunity.com/market/listings/440/Rocket%20Launcher");
  assert.ok(!href.includes("?"));
});

// --- buildMarketplaceHref ---

test("buildMarketplaceHref falls back to the '{skin} War Paint' sterm and omits squality[] for the default Decorated Weapon quality on a War Paint tool", () => {
  const shape = baseShape({
    isWarPaintTool: true,
    qualityName: "Decorated Weapon",
    warPaintToolWearName: "Factory New",
    warPaintToolSkinName: "Forest Fire Mk.II",
  });
  const url = new URL(buildMarketplaceHref(shape));
  assert.equal(url.origin + url.pathname, "https://marketplace.tf/browse/tf2");
  assert.equal(url.searchParams.get("squality[]"), null);
  assert.equal(url.searchParams.get("sstrange"), "0");
  assert.equal(url.searchParams.get("swear"), "1");
  assert.equal(url.searchParams.get("spaintkit"), null);
  assert.equal(url.searchParams.get("seffect[]"), "-2");
  assert.equal(url.searchParams.get("sterm"), "Forest Fire Mk.II War Paint");
});

test("buildMarketplaceHref sends squality[]/seffect[] for a non-default-quality (Unusual) War Paint tool", () => {
  const shape = baseShape({
    isWarPaintTool: true,
    qualityName: "Unusual",
    warPaintToolWearName: "Factory New",
    warPaintToolSkinName: "Die'n Dasher",
    effectId: 703,
  });
  const url = new URL(buildMarketplaceHref(shape));
  assert.equal(url.searchParams.get("squality[]"), "5");
  assert.equal(url.searchParams.get("seffect[]"), "703");
  assert.equal(url.searchParams.get("sterm"), "Die'n Dasher War Paint");
});

// Sstrange used to be derived straight from qualityName === "Strange", which
// goes false the moment qualityName is promoted to "Unusual" for an item that's
// ALSO genuinely Strange-tracking - hasStrangeTracking (captured before that
// promotion, see detectSkin's own note) keeps this signal correct even though
// squality[] now correctly shows Unusual, not Strange.
test("buildMarketplaceHref keeps sstrange=1 for a War Paint tool whose quality was promoted to Unusual but is ALSO Strange-tracking", () => {
  const shape = baseShape({
    isWarPaintTool: true,
    qualityName: "Unusual",
    hasStrangeTracking: true,
    warPaintToolWearName: "Minimal Wear",
    warPaintToolSkinName: "Beachy Boy",
    effectId: 703,
  });
  const url = new URL(buildMarketplaceHref(shape));
  assert.equal(url.searchParams.get("squality[]"), "5");
  assert.equal(url.searchParams.get("sstrange"), "1");
  assert.equal(url.searchParams.get("seffect[]"), "703");
});

test("buildMarketplaceHref uses the generic 'War Paint' sterm once spaintkit resolves, for a Strange War Paint tool", () => {
  const shape = baseShape({
    isWarPaintTool: true,
    qualityName: "Strange",
    hasStrangeTracking: true,
    warPaintToolWearName: "Factory New",
    warPaintToolSkinName: "Sideshow",
    warPaintToolTextureId: 440,
  });
  const url = new URL(buildMarketplaceHref(shape));
  assert.equal(url.searchParams.get("squality[]"), "11");
  assert.equal(url.searchParams.get("sstrange"), "1");
  assert.equal(url.searchParams.get("spaintkit"), "440");
  assert.equal(url.searchParams.get("sterm"), "War Paint");
});

test("buildMarketplaceHref omits squality[]/sstrange/spaintkit/etc for the default Decorated Weapon quality, and includes sks[]/swear/spaintkit for a Decorated Weapon", () => {
  const shape = baseShape({
    isDecoratedWeapon: true,
    qualityName: "Decorated Weapon",
    ksTier: 2,
    sheenId: 1,
    wearTierId: 1,
    textureId: 303,
    weaponName: "Grenade Launcher",
  });
  const url = new URL(buildMarketplaceHref(shape));
  assert.equal(url.searchParams.get("squality[]"), null);
  assert.equal(url.searchParams.get("sstrange"), "0");
  assert.equal(url.searchParams.get("skillstreak"), "2");
  assert.equal(url.searchParams.get("sks[]"), "1");
  assert.equal(url.searchParams.get("ske[]"), null);
  assert.equal(url.searchParams.get("swear"), "1");
  assert.equal(url.searchParams.get("spaintkit"), "303");
  assert.equal(url.searchParams.get("sbotkiller"), "none");
  assert.equal(url.searchParams.get("sterm"), "Grenade Launcher");
});

test("buildMarketplaceHref includes squality[] for a Decorated Weapon whose own quality isn't the generic 'Decorated Weapon' (e.g. Strange-tracking)", () => {
  const shape = baseShape({
    isDecoratedWeapon: true,
    qualityName: "Strange",
    hasStrangeTracking: true,
    weaponName: "Grenade Launcher",
  });
  const url = new URL(buildMarketplaceHref(shape));
  assert.equal(url.searchParams.get("squality[]"), "11");
  assert.equal(url.searchParams.get("sstrange"), "1");
});

test("buildMarketplaceHref uses the minimal Collector's param set with no sstrange/spaintkit/sfestivized", () => {
  const shape = baseShape({ qualityName: "Collector's", baseName: "Detonator" });
  const url = new URL(buildMarketplaceHref(shape));
  assert.equal(url.searchParams.get("squality[]"), "14");
  assert.equal(url.searchParams.get("skillstreak"), "0");
  assert.equal(url.searchParams.get("sterm"), "Detonator");
  assert.equal(url.searchParams.get("sstrange"), null);
  assert.equal(url.searchParams.get("spaintkit"), null);
  assert.equal(url.searchParams.get("sfestivized"), null);
});

test("buildMarketplaceHref splits a Taunt's 'Taunt: ' prefix into stype=Special Taunt, searching the bare taunt name", () => {
  const shape = baseShape({ baseName: "Taunt: Unleashed Rage", qualityName: "Unusual", effectId: 3224 });
  const url = new URL(buildMarketplaceHref(shape));
  assert.equal(url.searchParams.get("stype"), "Special Taunt");
  assert.equal(url.searchParams.get("sterm"), "Unleashed Rage");
});

test("buildMarketplaceHref searches by the bare weapon name and grade_tier sbotkiller slug for a Botkiller weapon", () => {
  const shape = baseShape({
    isBotkiller: true,
    botkillerWeaponName: "Wrench",
    botkillerSlug: "Carbonado_I",
    baseName: "Carbonado Botkiller Wrench Mk.I",
    qualityName: "Strange",
  });
  const url = new URL(buildMarketplaceHref(shape));
  assert.equal(url.searchParams.get("sterm"), "Wrench");
  assert.equal(url.searchParams.get("sbotkiller"), "Carbonado_I");
});

// A target-item tool's own sterm used to search the bare
// "Strangifier"/"Chemistry Set" text (deriveClassifiedsFilters' own
// filters.itemName, kept bare on purpose for backpack.tf's own classifieds
// targetItem param) - the OPPOSITE of a Botkiller/Taunt just above, which
// correctly search their own bare target name. marketplace.tf has no dedicated
// target-item filter param, so it wants the FULL combined name.
test("buildMarketplaceHref searches the FULL combined name (not the bare tool name) for a target-item tool", () => {
  const strangifier = baseShape({ isTargetTool: true, targetToolBaseItemName: "Strangifier", targetToolTargetName: "Ghastlierest Gibus" });
  assert.equal(new URL(buildMarketplaceHref(strangifier)).searchParams.get("sterm"), "Ghastlierest Gibus Strangifier");

  const chemSet = baseShape({ isTargetTool: true, targetToolBaseItemName: "Chemistry Set", targetToolTargetName: "Professor Speks" });
  assert.equal(new URL(buildMarketplaceHref(chemSet)).searchParams.get("sterm"), "Professor Speks Strangifier Chemistry Set");
});

test("buildMarketplaceHref sets stype=Killstreak Kit and searches by target weapon for a Kit", () => {
  const shape = baseShape({ isKillstreakKit: true, killstreakKitTargetName: "Frontier Justice", killstreakKitTier: 2 });
  const url = new URL(buildMarketplaceHref(shape));
  assert.equal(url.searchParams.get("stype"), "Killstreak Kit");
  assert.equal(url.searchParams.get("skillstreak"), "2");
  assert.equal(url.searchParams.get("sterm"), "Frontier Justice");
});

test("buildMarketplaceHref sets stype=Fabricator for a Fabricator", () => {
  const shape = baseShape({ isFabricatorKit: true, fabricatorKitTargetName: "Shotgun", fabricatorKitTier: 3 });
  const url = new URL(buildMarketplaceHref(shape));
  assert.equal(url.searchParams.get("stype"), "Fabricator");
});

test("buildMarketplaceHref maps a Halloween Spell name to its marketplace.tf slug via sspell", () => {
  const shape = baseShape({ spellName: "Exorcism", ksTier: 2 });
  const url = new URL(buildMarketplaceHref(shape));
  assert.equal(url.searchParams.get("sspell"), "effect_exorcism");
});

test("buildMarketplaceHref skips the spaint[] param entirely for an Unusual but includes it otherwise", () => {
  const paintedShape = baseShape({ paintEntry: { id: 5040, color: "#141414" } });
  assert.equal(new URL(buildMarketplaceHref(paintedShape)).searchParams.get("spaint[]"), "1315860");

  const unusualPaintedShape = baseShape({ paintEntry: { id: 5040, color: "#141414" }, unusualEffectName: "Fountain of Delight" });
  assert.equal(new URL(buildMarketplaceHref(unusualPaintedShape)).searchParams.get("spaint[]"), null);
});

// --- buildGladiatorHref -----------------------------------------------------

test("buildGladiatorHref sends the given search name verbatim as the plain 'item' param", () => {
  const href = buildGladiatorHref("Strange Professional Killstreak Australium Rocket Launcher");
  const url = new URL(href);
  assert.equal(url.origin + url.pathname, "https://gladiator.tf/sales");
  assert.equal(url.searchParams.get("item"), "Strange Professional Killstreak Australium Rocket Launcher");
});

// --- buildStnTradingHref -----------------------------------------------------

// Confirmed live: https://stntrading.eu/item/tf2/Strange+War+Pig for a plain
// Strange War Pig - spaces joined with a literal "+", not percent-encoded.
test("buildStnTradingHref joins words with a literal '+', matching the confirmed-live URL shape", () => {
  const shape = baseShape({ qualityName: "Strange" });
  assert.equal(buildStnTradingHref(shape, "Strange War Pig"), "https://stntrading.eu/item/tf2/Strange+War+Pig");
});

// encodeURIComponent leaves an apostrophe unescaped (it's in its own
// "unreserved" set, per spec) - confirming that's carried through rather
// than double-encoded or stripped.
test("buildStnTradingHref leaves an apostrophe within a word intact", () => {
  const shape = baseShape();
  assert.equal(buildStnTradingHref(shape, "Collector's Detonator"), "https://stntrading.eu/item/tf2/Collector's+Detonator");
});

// An Unusual keeps the literal "Unusual" word AND inserts the effect name
// right after it - neither steamMarketName's own "Unusual {BaseName}" (no
// effect, Steam's real market_hash_name) nor searchDisplayName's own
// gladiator.tf-style "{Effect} {BaseName}" (no "Unusual" word) alone.
// Confirmed live:
// https://stntrading.eu/item/tf2/Unusual+Cuban+Smoke+Throttlehead
test("buildStnTradingHref inserts the Unusual effect name right after the literal 'Unusual' word", () => {
  const shape = baseShape({ qualityName: "Unusual", unusualEffectName: "Cuban Smoke" });
  assert.equal(
    buildStnTradingHref(shape, "Unusual Throttlehead"),
    "https://stntrading.eu/item/tf2/Unusual+Cuban+Smoke+Throttlehead"
  );
});

test("buildStnTradingHref falls back to the plain steamMarketName when the Unusual effect couldn't be resolved (no Steam Web API key configured)", () => {
  const shape = baseShape({ qualityName: "Unusual", unusualEffectName: null });
  assert.equal(buildStnTradingHref(shape, "Unusual Throttlehead"), "https://stntrading.eu/item/tf2/Unusual+Throttlehead");
});

// --- buildMannStoreHref ------------------------------------------------------

test("buildMannStoreHref sends the generic-item defaults (quality/festivized/killstreak/warpaints all set to their 'none' value) for a plain item", () => {
  const params = new URL(buildMannStoreHref(baseShape())).searchParams;
  assert.equal(params.get("search"), "Rocket Launcher");
  assert.equal(params.get("quality"), "Unique");
  assert.equal(params.get("festivized"), "No festivized");
  assert.equal(params.get("killstreak"), "No");
  assert.equal(params.get("warpaints"), "No WarPaints");
});

test("buildMannStoreHref reuses shape.killstreakTierName verbatim as the killstreak param - no separate tier-number table needed", () => {
  const shape = baseShape({ qualityName: "Strange", ksTier: 3, killstreakTierName: "Professional Killstreak" });
  assert.equal(new URL(buildMannStoreHref(shape)).searchParams.get("killstreak"), "Professional Killstreak");
});

test("buildMannStoreHref threads Sheen/Killstreaker/Festivized through", () => {
  const shape = baseShape({
    qualityName: "Strange",
    isFestivized: true,
    killstreakTierName: "Professional Killstreak",
    sheenName: "Team Shine",
    killstreakerName: "Hypno-Beam",
  });
  const params = new URL(buildMannStoreHref(shape)).searchParams;
  assert.equal(params.get("festivized"), "Festivized");
  assert.equal(params.get("sheen"), "Team Shine");
  assert.equal(params.get("killstreaker"), "Hypno-Beam");
});

test("buildMannStoreHref threads a Paint name through for a plain painted cosmetic", () => {
  const shape = baseShape({ paintName: "Australium Gold" });
  assert.equal(new URL(buildMannStoreHref(shape)).searchParams.get("paint"), "Australium Gold");
});

test("REGRESSION: buildMannStoreHref never applies the Paint filter to an Unusual item", () => {
  const shape = baseShape({ qualityName: "Unusual", unusualEffectName: "Purple Energy", paintName: "Australium Gold" });
  const params = new URL(buildMannStoreHref(shape)).searchParams;
  assert.equal(params.get("quality"), "Unusual");
  assert.equal(params.get("effect"), "Purple Energy");
  assert.equal(params.get("paint"), null);
});

test("buildMannStoreHref searches by the resolved weapon name and sets warpaints to the skin name for a Decorated Weapon, treating its own qualityName as Unique/Strange only (never backpack.tf's internal 'Decorated Weapon' label)", () => {
  const shape = baseShape({
    qualityName: "Decorated Weapon",
    isDecoratedWeapon: true,
    skinName: "Macaw Masked",
    weaponName: "Grenade Launcher",
    wearName: "Factory New",
    ksTier: 2,
    killstreakTierName: "Specialized Killstreak",
  });
  const params = new URL(buildMannStoreHref(shape)).searchParams;
  assert.equal(params.get("search"), "Grenade Launcher");
  assert.equal(params.get("quality"), "Unique");
  assert.equal(params.get("warpaints"), "Macaw Masked");
  assert.equal(params.get("killstreak"), "Specialized Killstreak");
  assert.equal(params.get("festivized"), "No festivized");
});

test("buildMannStoreHref returns Strange (not Unique) for a Strange-tracking Decorated Weapon", () => {
  const shape = baseShape({
    qualityName: "Strange",
    isDecoratedWeapon: true,
    skinName: "Dragon Slayer",
    weaponName: "Rocket Launcher",
    wearName: "Field-Tested",
  });
  assert.equal(new URL(buildMannStoreHref(shape)).searchParams.get("quality"), "Strange");
});

test("buildMannStoreHref returns null for item types it hasn't been built for yet (standalone War Paint tool)", () => {
  assert.equal(buildMannStoreHref(baseShape({ isWarPaintTool: true })), null);
});

// A target-item tool is NOT in the "not built yet" null group above (same
// as stntrading.eu's own link2Backpack.js). Bare-searches the full
// reconstructed "{target} Strangifier" name (or "{target} Strangifier
// {itemName}" for a Chemistry Set), same shape every other port of this fix
// already uses.
test("buildMannStoreHref bare-searches a target-item tool's own full reconstructed name", () => {
  const strangifier = baseShape({ isTargetTool: true, targetToolBaseItemName: "Strangifier", targetToolTargetName: "Ghastlierest Gibus" });
  const params = new URL(buildMannStoreHref(strangifier)).searchParams;
  assert.equal(params.get("search"), "Ghastlierest Gibus Strangifier");
  assert.equal(params.has("quality"), false);

  const chemSet = baseShape({ isTargetTool: true, targetToolBaseItemName: "Chemistry Set", targetToolTargetName: "Professor Speks" });
  assert.equal(new URL(buildMannStoreHref(chemSet)).searchParams.get("search"), "Professor Speks Strangifier Chemistry Set");
});

// A Killstreak Kit/Fabricator used to be in the same "not built yet" null
// group above - same scope gap steamcommunity.com's own port already had and
// fixed (see tests/quickLinkButtons.test.js's own equivalent coverage).
// Bare-searches the item's own full reconstructed name (same string
// buildSteamMarketName already produces for the Steam Market button) plus
// its own Sheen/Killstreaker as real filters when known.
test("buildMannStoreHref bare-searches a Killstreak Kit's own full reconstructed name, including its fixed Sheen/Killstreaker when known", () => {
  const shape = baseShape({
    isKillstreakKit: true,
    killstreakKitTargetName: "Rocket Launcher",
    killstreakKitTierWord: "Professional ",
    sheenName: "Team Shine",
    killstreakerName: "Cerebral Discharge",
  });
  const params = new URL(buildMannStoreHref(shape)).searchParams;
  assert.equal(params.get("search"), "Professional Killstreak Rocket Launcher Kit");
  assert.equal(params.get("sheen"), "Team Shine");
  assert.equal(params.get("killstreaker"), "Cerebral Discharge");
});

test("buildMannStoreHref bare-searches a Kit Fabricator's own full reconstructed name, omitting sheen/killstreaker when neither is known", () => {
  const shape = baseShape({
    isFabricatorKit: true,
    fabricatorKitTargetName: "Minigun",
    fabricatorKitTierWord: "Professional ",
  });
  const params = new URL(buildMannStoreHref(shape)).searchParams;
  assert.equal(params.get("search"), "Professional Killstreak Minigun Kit Fabricator");
  assert.equal(params.has("sheen"), false);
  assert.equal(params.has("killstreaker"), false);
});

// --- buildPostsTfLink ---------------------------------------------------

test("buildPostsTfLink searches by defindex/quality/craftable for a plain item", async () => {
  const href = await buildPostsTfLink(baseShape());
  assert.deepEqual(decodePostsTfQuery(href), {
    u: [{ defindex: 205, quality: 6, craftable: true }],
    p: [],
    d: "",
    m: false,
  });
});

test("buildPostsTfLink sends craftable: false for an uncraftable item", async () => {
  const href = await buildPostsTfLink(baseShape({ isUncraft: true }));
  assert.equal(decodePostsTfQuery(href).u[0].craftable, false);
});

test("buildPostsTfLink includes effect/killstreak/paint/spell when the shape has them", async () => {
  const shape = baseShape({
    qualityName: "Strange",
    ksTier: 2,
    effectId: 13,
    paintName: "Australium Gold",
    spellName: "Exorcism",
  });
  const href = await buildPostsTfLink(shape);
  const item = decodePostsTfQuery(href).u[0];
  assert.equal(item.quality, 11);
  assert.equal(item.killstreak, 2);
  assert.equal(item.effect, 13);
  assert.equal(item.paint, "Australium Gold");
  assert.deepEqual(item.spells, ["Exorcism"]);
});

test("buildPostsTfLink skips the paint field entirely for an Unusual, even when a paint name is also present", async () => {
  const shape = baseShape({
    qualityName: "Unusual",
    baseName: "Rocket Launcher",
    unusualEffectName: "Green Black Hole",
    effectId: 71,
    paintName: "Australium Gold",
  });
  const item = decodePostsTfQuery(await buildPostsTfLink(shape)).u[0];
  assert.equal(item.effect, 71);
  assert.equal(item.paint, undefined);
});

test("buildPostsTfLink resolves an Unusual Taunt's schema defindex via the full 'Taunt: ' name, matching scrap.tf's own baseName (which already keeps that prefix)", async () => {
  const shape = baseShape({
    qualityName: "Unusual",
    baseName: "Taunt: Conga",
    unusualEffectName: "Green Black Hole",
    effectId: 71,
  });
  const item = decodePostsTfQuery(await buildPostsTfLink(shape)).u[0];
  assert.equal(item.defindex, 1118);
});

// REGRESSION for a live bug report: the posts.tf button never appeared for
// ANY Australium item - posts.tf's own item picker doesn't give Australium
// weapons a distinct schema defindex the way this used to assume (confirmed
// live by decoding a real "Strange Australium Force-a-Nature" pick from
// posts.tf's own search: {defindex: 45 (the PLAIN weapon's own defindex),
// quality: 11, craftable: true, australium: true}) - "Australium " has to be
// stripped back out of baseName before the schema lookup, with its own
// separate boolean field instead, or the lookup 404s against a schema entry
// that was never there to begin with.
test("buildPostsTfLink resolves the BARE weapon's schema defindex for an Australium item, with australium as its own boolean field", async () => {
  const shape = baseShape({ qualityName: "Strange", baseName: "Australium Rocket Launcher" });
  const item = decodePostsTfQuery(await buildPostsTfLink(shape)).u[0];
  assert.equal(item.defindex, 205);
  assert.equal(item.australium, true);
});

// "Australium Gold" is a real Paint can name, not an Australium weapon -
// this used to strip "Australium " unconditionally, looking up a
// nonexistent "Gold" schema entry (and setting australium: true) instead
// of resolving the Paint can's own real defindex.
test("buildPostsTfLink resolves the Paint can 'Australium Gold' by its own full name, not split into 'Australium' + 'Gold'", async () => {
  const shape = baseShape({ qualityName: "Unique", baseName: "Australium Gold" });
  const item = decodePostsTfQuery(await buildPostsTfLink(shape)).u[0];
  assert.equal(item.defindex, 143);
  assert.equal(item.australium, undefined);
});

test("buildPostsTfLink resolves a Botkiller weapon's own distinct schema defindex from its full name", async () => {
  const shape = baseShape({
    isBotkiller: true,
    botkillerWeaponName: "Wrench",
    botkillerSlug: "Carbonado_I",
    baseName: "Carbonado Botkiller Wrench Mk.I",
    qualityName: "Strange",
  });
  const item = decodePostsTfQuery(await buildPostsTfLink(shape)).u[0];
  assert.equal(item.defindex, 60181);
});

test("buildPostsTfLink returns null for item types not built yet (Kit/Fabricator/target tool/standalone War Paint tool/Decorated Weapon)", async () => {
  assert.equal(await buildPostsTfLink(baseShape({ isKillstreakKit: true })), null);
  assert.equal(await buildPostsTfLink(baseShape({ isFabricatorKit: true })), null);
  assert.equal(await buildPostsTfLink(baseShape({ isTargetTool: true })), null);
  assert.equal(await buildPostsTfLink(baseShape({ isWarPaintTool: true })), null);
  assert.equal(await buildPostsTfLink(baseShape({ isDecoratedWeapon: true })), null);
});

test("buildPostsTfLink returns null when the item's defindex can't be resolved at all", async () => {
  assert.equal(await buildPostsTfLink(baseShape({ baseName: "Some Unknown Item" })), null);
});

// A Taunt Unusualifier (scrap.tf title "Unusualifier", target read off the
// tile's icon). Every expected URL below was confirmed live by hand.
const UNUSUALIFIER_SHAPE = baseShape({
  qualityName: "Unusual",
  isUncraft: true,
  craftPathSegment: "Non-Craftable",
  baseName: "Unusualifier",
  encodedStatsName: "Unusualifier",
  isUnusualifier: true,
  unusualifierTargetName: "Taunt: The Bunnyhopper",
  unusualifierTargetDefindex: 30920,
});

test("a Taunt Unusualifier's next.backpack.tf stats link carries the target's defindex as priceindex; classic stays the plain path", () => {
  const [next, classic] = buildStatsLinks(UNUSUALIFIER_SHAPE);
  assert.equal(next.href, "https://next.backpack.tf/stats?item=Unusualifier&quality=Unusual&craftable=false&priceindex=30920");
  assert.equal(classic.href, "https://backpack.tf/stats/Unusual/Unusualifier/Tradable/Non-Craftable");
});

test("a Taunt Unusualifier's next.backpack.tf classifieds search is filtered by its target taunt", () => {
  assert.equal(
    buildNextClassifiedsHref(UNUSUALIFIER_SHAPE),
    "https://next.backpack.tf/classifieds?itemName=Unusualifier&quality=5&tradable=1&craftable=0&australium=0&killstreakTier=0&festivized=0&particle=none&texture=none&spell=none&paint=none&targetItem=Taunt%3A+The+Bunnyhopper"
  );
});

test("a Taunt Unusualifier's Steam Market, stntrading.eu, mannco.store and marketplace.tf links use its full name", () => {
  const steamMarketName = buildSteamMarketName(UNUSUALIFIER_SHAPE);
  assert.equal(steamMarketName, "Unusual Taunt: The Bunnyhopper Unusualifier");
  assert.equal(
    buildSteamMarketHref(UNUSUALIFIER_SHAPE, steamMarketName),
    "https://steamcommunity.com/market/listings/440/Unusual%20Taunt%3A%20The%20Bunnyhopper%20Unusualifier"
  );
  assert.equal(buildStnTradingHref(UNUSUALIFIER_SHAPE, steamMarketName), "https://stntrading.eu/item/tf2/Unusual+Taunt%3A+The+Bunnyhopper+Unusualifier");
  const mannco = new URL(buildMannStoreHref(UNUSUALIFIER_SHAPE));
  assert.equal(mannco.searchParams.get("search"), "Unusual Taunt: The Bunnyhopper Unusualifier");
  assert.equal(mannco.searchParams.get("quality"), "Unusual");
  assert.equal(mannco.searchParams.get("festivized"), "No festivized");
  assert.equal(mannco.searchParams.get("killstreak"), "No");
  assert.equal(mannco.searchParams.get("warpaints"), "No WarPaints");
  assert.equal(buildMarketplaceHref(UNUSUALIFIER_SHAPE), "https://marketplace.tf/browse/tf2?sterm=Taunt%3A+The+Bunnyhopper+Unusualifier");
});
