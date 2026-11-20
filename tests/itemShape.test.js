import { test } from "node:test";
import assert from "node:assert/strict";

// detectItemShape pulls in utils/tf2Schema.js and (transitively, via
// skinDetection.js) utils/warpaints.js - same global-mock approach as
// tests/skinDetection.test.js: neither module touches these globals at
// import time, only inside their exported async functions, so installing the
// fakes here (once) before any test calls detectItemShape is enough.
globalThis.chrome = {
  storage: {
    local: {
      get: async () => ({
        tf2SchemaCache: {
          itemNameToDefindex: { "Rocket Launcher": 205, "The Quäckenbirdt": 5715, "Taunt: The Bunnyhopper": 30920 },
          defindexToItemName: { 172: "Wandering Wraith", 810: "Red-Tape Recorder" },
          effectNameToId: {},
          tauntIconToItemName: { taunt_the_bunnyhopper: "Taunt: The Bunnyhopper" },
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
// None of this file's fixtures are a Decorated Weapon/War Paint tool, so
// getWarpaints() is never actually invoked - installed anyway so an
// accidental future branch touching it fails loudly instead of throwing
// "fetch is not defined".
globalThis.fetch = async () => ({ json: async () => [] });

const { detectItemShape } = await import("../scrap.tf/itemLinks/itemShape.js");

// Fakes the subset of the hovered .item.hoverable element detectItemShape
// reads: classList.contains (quality/killstreak/craftability CSS classes)
// and getAttribute (data-defindex/data-content).
function fakeItemEl({ classes = [], defindex = null, dataContent = null, style = null } = {}) {
  return {
    classList: { contains: (name) => classes.includes(name) },
    getAttribute: (name) => {
      if (name === "data-defindex") return defindex;
      if (name === "data-content") return dataContent;
      if (name === "style") return style;
      return null;
    },
  };
}

test("detectItemShape resolves a plain Unique craftable item with no killstreak/skin/tool attributes", async () => {
  const shape = await detectItemShape("Rocket Launcher", fakeItemEl());
  assert.equal(shape.qualityName, "Unique");
  assert.equal(shape.baseName, "Rocket Launcher");
  assert.equal(shape.isUncraft, false);
  assert.equal(shape.craftPathSegment, "Craftable");
  assert.equal(shape.ksTier, 0);
  assert.equal(shape.isFestivized, false);
  assert.equal(shape.isKillstreakKit, false);
  assert.equal(shape.isDecoratedWeapon, false);
  assert.equal(shape.statsUnresolved, false);
});

test("detectItemShape's isUncraft is true when scrap.tf's own 'uncraft' CSS class is present", async () => {
  const shape = await detectItemShape("Rocket Launcher", fakeItemEl({ classes: ["uncraft"] }));
  assert.equal(shape.isUncraft, true);
  assert.equal(shape.craftPathSegment, "Non-Craftable");
});

// The "uncraft" CSS class was NOT present on the item element even though
// its own tooltip clearly read "Uncraftable" as a standalone line -
// isUncraft now ORs the class with the tooltip's own text
// (isMarkedUncraftableInTooltip), so this case is caught even without the
// class.
test("detectItemShape's isUncraft is ALSO true from a standalone 'Uncraftable' tooltip line, even with no 'uncraft' CSS class at all", async () => {
  const itemEl = fakeItemEl({ dataContent: "Level 5<br>Uncraftable<br>Costs 1 key, 48 refined" });
  const shape = await detectItemShape("Waterlogged Lab Coat", itemEl);
  assert.equal(shape.isUncraft, true);
  assert.equal(shape.craftPathSegment, "Non-Craftable");
});

test("detectItemShape resolves a Name Tag'd item's tooltip title back to its real item name via data-defindex", async () => {
  const itemEl = fakeItemEl({ classes: ["quality11"], defindex: "172" });
  const shape = await detectItemShape('Strange "FALL."', itemEl);
  // Real item name recovered ("Wandering Wraith") with the custom-name quotes
  // gone, and the quality prefix stripped off it same as any other item -
  // the confirmed-live regression this guards against left "FALL." (or the
  // still-quoted raw text) as the effective item name instead.
  assert.equal(shape.baseName, "Wandering Wraith");
  assert.equal(shape.qualityName, "Strange");
});

// Seen live on a scrap.tf raffle: the tile's data-title wraps the custom name
// in two apostrophes, not a double quote (`Strange &apos;&apos;Thriller -
// Michael Jackson&apos;&apos;`, data-defindex="810"), so the rename went
// unnoticed and every link searched the custom name.
test("detectItemShape also resolves a custom name wrapped in two apostrophes ('' '') instead of a double quote", async () => {
  const itemEl = fakeItemEl({ classes: ["quality11"], defindex: "810" });
  const shape = await detectItemShape("Strange ''Thriller - Michael Jackson''", itemEl);
  assert.equal(shape.baseName, "Red-Tape Recorder");
  assert.equal(shape.qualityName, "Strange");
});

test("detectItemShape falls back to the raw (still-quoted) name when a Name Tag'd item's defindex can't be resolved", () => {
  const itemEl = fakeItemEl({ classes: ["quality11"] });
  return detectItemShape('Strange "Foo"', itemEl).then((shape) => {
    // Degrade-gracefully path: no data-defindex to resolve against, so the
    // raw tooltip title (quotes and all) passes straight through unchanged.
    assert.equal(shape.baseName, '"Foo"');
  });
});

// Seen live on scrap.tf: a Taunt Unusualifier's title is just "Unusualifier"
// (defindex 9258, shared by every target), and the tile is drawn with the
// target taunt's own icon.
const UNUSUALIFIER_TILE = {
  classes: ["quality5", "uncraft"],
  defindex: "9258",
  style: "opacity:1;background-image:url(https://steamcdn-a.akamaihd.net/apps/440/icons/taunt_the_bunnyhopper.dfb3285b0a35881593055cb69cd009a9d9c44af4.png);",
};

test("detectItemShape reads a Taunt Unusualifier's target taunt off the tile's icon", async () => {
  const shape = await detectItemShape("Unusualifier", fakeItemEl(UNUSUALIFIER_TILE));
  assert.equal(shape.isUnusualifier, true);
  assert.equal(shape.unusualifierTargetName, "Taunt: The Bunnyhopper");
  assert.equal(shape.unusualifierTargetDefindex, 30920);
  assert.equal(shape.qualityName, "Unusual");
  assert.equal(shape.baseName, "Unusualifier");
});

test("detectItemShape leaves an Unusualifier plain when its icon isn't a known taunt", async () => {
  const style = UNUSUALIFIER_TILE.style.replace("taunt_the_bunnyhopper", "taunt_never_heard_of");
  const shape = await detectItemShape("Unusualifier", fakeItemEl({ ...UNUSUALIFIER_TILE, style }));
  assert.equal(shape.isUnusualifier, false);
  assert.equal(shape.unusualifierTargetName, null);
});

// Scrap.tf's own data-title text for "The Quäckenbirdt" read plain
// "Quackenbirdt" - missing both the "ä" diacritic and the leading "The "
// article - so the item card's title used to render as just "Quackenbirdt".
// getCanonicalItemName now recovers the schema's own correctly-spelled name
// before anything else reads it.
test("detectItemShape recovers a raw name missing a diacritic and the 'The ' article via the schema", async () => {
  const shape = await detectItemShape("Quackenbirdt", fakeItemEl());
  assert.equal(shape.baseName, "The Quäckenbirdt");
});

// DetectItemShape now passes the hovered item's own classQualityName
// through to stripNamePrefix, so a "Strange X" literal item name gets
// caught dynamically even when it ISN'T one of utils/tf2ItemName.js's own
// two hardcoded entries. No quality class at all here means
// classQualityName is "Unique" (scrap.tf's own default), proving this
// doesn't depend on that hardcoded list.
test("detectItemShape's real (CSS-class) quality catches a 'Strange X' literal item name even when it isn't hardcoded", async () => {
  const shape = await detectItemShape("Strange Bacon Grease", fakeItemEl());
  assert.equal(shape.qualityName, "Unique");
  assert.equal(shape.baseName, "Strange Bacon Grease");
});

// End-to-end through detectItemShape (not just detectSkin/stripNamePrefix in
// isolation) - baseName must read the clean "Beachy Boy War Paint (Minimal
// Wear)" (both "Strange " and the "★Unusual " marker stripped), and
// qualityName must be promoted to "Unusual" (Unusual outranks Strange), not
// left at the CSS-class-derived "Strange".
test("detectItemShape strips both 'Strange ' and a '★Unusual ' marker off a War Paint tool's title, promoting qualityName to Unusual", async () => {
  const itemEl = fakeItemEl({ classes: ["quality11"], dataContent: "Level 1<br>Effect: Hot" });
  const shape = await detectItemShape("Strange ★Unusual Beachy Boy War Paint (Minimal Wear)", itemEl);
  assert.equal(shape.qualityName, "Unusual");
  assert.equal(shape.baseName, "Beachy Boy War Paint (Minimal Wear)");
  assert.equal(shape.unusualEffectName, "Hot");
});

test("detectItemShape reads the item's own killstreak tier off its killstreakN CSS class, not off the raw name", async () => {
  const itemEl = fakeItemEl({ classes: ["killstreak3"] });
  const shape = await detectItemShape("Rocket Launcher", itemEl);
  assert.equal(shape.ksTier, 3);
  assert.equal(shape.ksPrefix, "Professional Killstreak ");
  assert.equal(shape.killstreakTierName, "Professional Killstreak");
});

test("detectItemShape resolves a Killstreak Kit's target weapon defindex via the schema", async () => {
  const shape = await detectItemShape("Professional Rocket Launcher Kit", fakeItemEl());
  assert.equal(shape.isKillstreakKit, true);
  assert.equal(shape.killstreakKitTargetName, "Rocket Launcher");
  assert.equal(shape.kitTargetDefindex, 205);
  assert.equal(shape.statsUnresolved, false);
});

test("detectItemShape marks statsUnresolved when a Killstreak Kit's target weapon isn't in the schema", async () => {
  const shape = await detectItemShape("Professional Wrap Assassin Kit", fakeItemEl());
  assert.equal(shape.isKillstreakKit, true);
  assert.equal(shape.kitTargetDefindex, null);
  assert.equal(shape.statsUnresolved, true);
});

// Utils/tf2Schema.js's own getEffectId now checks that table first, before
// ever touching the live (key-gated) schema - "Fountain of Delight" is
// also a real entry there (id 3005), so this now resolves with no Steam
// Web API key needed at all, even though this file's own fixture schema
// has an empty effectNameToId map (see the sibling Strangifier tests
// below, which still correctly show statsUnresolved: true for a
// genuinely-not-in-either-table name - static-table coverage doesn't
// change target-item/defindex resolution at all, only effect name->id).
test("detectItemShape resolves an Unusual's effect id via the static table even when the live schema's own effectNameToId map is empty", async () => {
  const itemEl = fakeItemEl({ classes: ["quality5"], dataContent: "Effect: Fountain of Delight" });
  const shape = await detectItemShape("Rocket Launcher", itemEl);
  assert.equal(shape.qualityName, "Unusual");
  assert.equal(shape.unusualEffectName, "Fountain of Delight");
  assert.equal(shape.effectId, 3005);
  assert.equal(shape.statsUnresolved, false);
});

test("detectItemShape resolves a target-item tool's (Strangifier) target weapon defindex via the schema", async () => {
  const shape = await detectItemShape("Rocket Launcher Strangifier", fakeItemEl());
  assert.equal(shape.isTargetTool, true);
  assert.equal(shape.targetToolTargetName, "Rocket Launcher");
  assert.equal(shape.targetToolDefindex, 205);
  assert.equal(shape.statsUnresolved, false);
});

test("detectItemShape marks statsUnresolved when a Strangifier's target weapon isn't in the schema", async () => {
  const shape = await detectItemShape("Righteous Bison Strangifier", fakeItemEl());
  assert.equal(shape.isTargetTool, true);
  assert.equal(shape.targetToolDefindex, null);
  assert.equal(shape.statsUnresolved, true);
});

test("detectItemShape resolves a Killstreak Kit Fabricator's target defindex and priceindex via the schema", async () => {
  const shape = await detectItemShape("Professional Rocket Launcher Kit Fabricator", fakeItemEl());
  assert.equal(shape.isFabricatorKit, true);
  assert.equal(shape.fabricatorKitTargetName, "Rocket Launcher");
  // FABRICATOR_PRICEINDEX_PREFIX_BY_TIER[3] ("Professional") is "6526-6",
  // joined with the resolved target defindex (205).
  assert.equal(shape.fabricatorPriceindex, "6526-6-205");
  assert.equal(shape.statsUnresolved, false);
});

// Regression test for a live bug report: fabricatorKitTier was computed by
// toolVariants.js and used internally (e.g. to pick the right
// FABRICATOR_PRICEINDEX_PREFIX_BY_TIER entry above), but detectItemShape's
// own return statement never actually included it in the shape object it
// hands back - every OTHER caller needing it (links.js's own
// deriveClassifiedsFilters, for the classifieds shortcut icons' killstreakTier
// param) silently read `undefined` and fell through to the hovered tool's own
// (nonexistent, since a Fabricator isn't itself a killstreak weapon) ksTier
// of 0 instead - so a Specialized AND a Professional Fabricator's classifieds
// link both searched with no killstreak tier filter at all, indistinguishable
// from each other.
test("detectItemShape exposes fabricatorKitTier (2 for Specialized, 3 for Professional) on the returned shape - not just used internally", async () => {
  const specializedShape = await detectItemShape("Specialized Rocket Launcher Kit Fabricator", fakeItemEl());
  assert.equal(specializedShape.fabricatorKitTier, 2);

  const professionalShape = await detectItemShape("Professional Rocket Launcher Kit Fabricator", fakeItemEl());
  assert.equal(professionalShape.fabricatorKitTier, 3);
});

// Regression test for a second, related live bug report: buildSteamMarketName
// needs fabricatorKitTierWord (not just fabricatorKitTier) on the shape to
// reinsert the word "Killstreak" that scrap.tf's own raw name omits.
test("detectItemShape exposes fabricatorKitTierWord on the returned shape", async () => {
  const shape = await detectItemShape("Specialized Rocket Launcher Kit Fabricator", fakeItemEl());
  assert.equal(shape.fabricatorKitTierWord, "Specialized ");
});

test("detectItemShape marks statsUnresolved for a Fabricator whose target weapon isn't in the schema", async () => {
  const shape = await detectItemShape("Professional Wrap Assassin Kit Fabricator", fakeItemEl());
  assert.equal(shape.isFabricatorKit, true);
  assert.equal(shape.fabricatorPriceindex, null);
  assert.equal(shape.statsUnresolved, true);
});

test("detectItemShape marks statsUnresolved for a Basic-tier Fabricator - no confirmed priceindex prefix for that tier", async () => {
  const shape = await detectItemShape("Basic Rocket Launcher Kit Fabricator", fakeItemEl());
  assert.equal(shape.isFabricatorKit, true);
  // Even though the target defindex itself resolves fine, Basic has no entry
  // in FABRICATOR_PRICEINDEX_PREFIX_BY_TIER - see that constant's own comment.
  assert.equal(shape.fabricatorPriceindex, null);
  assert.equal(shape.statsUnresolved, true);
});
