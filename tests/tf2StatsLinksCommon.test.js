import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ITEMS_QUALITY,
  LITERAL_NAME_QUALITY_EXCEPTIONS,
  KILLSTREAK_TIER_BY_WORD,
  stripCraftabilityPrefix,
  stripArticlePrefix,
  escapeRegExp,
  stripCraftabilityAndArticle,
  stripQualityPrefix,
  stripCraftabilityQualityAndArticle,
  buildClassicTargetClassifiedsLink,
  buildNextTargetClassifiedsLink,
  base64EncodeUtf8,
} from "../utils/tf2StatsLinks/common.js";

test("ITEMS_QUALITY excludes Normal and Decorated Weapon (never shown as a text prefix)", () => {
  assert.ok(!ITEMS_QUALITY.includes("Normal"));
  assert.ok(!ITEMS_QUALITY.includes("Decorated Weapon"));
  assert.ok(ITEMS_QUALITY.includes("Strange"));
  assert.ok(ITEMS_QUALITY.includes("Collector's"));
});

test("stripCraftabilityPrefix strips a leading Non-Craftable prefix", () => {
  assert.deepEqual(stripCraftabilityPrefix("Non-Craftable Rocket Launcher"), {
    name: "Rocket Launcher",
    isNonCraftable: true,
  });
});

test("stripCraftabilityPrefix is anchored to the start (a mid-string occurrence isn't stripped)", () => {
  assert.deepEqual(stripCraftabilityPrefix("Not Non-Craftable Rocket Launcher"), {
    name: "Not Non-Craftable Rocket Launcher",
    isNonCraftable: false,
  });
});

test("stripArticlePrefix strips a leading The ", () => {
  assert.equal(stripArticlePrefix("The Team Captain"), "Team Captain");
  assert.equal(stripArticlePrefix("Team Captain"), "Team Captain");
});

test("escapeRegExp escapes every regex metacharacter so a literal match still works", () => {
  const value = "Cost. Of? Living (2024)";
  const re = new RegExp(escapeRegExp(value));
  assert.ok(re.test(`prefix ${value} suffix`));
});

test("stripCraftabilityAndArticle combines both strips in order (craftability, then article)", () => {
  assert.deepEqual(stripCraftabilityAndArticle("Non-Craftable The Team Captain"), {
    name: "Team Captain",
    isNonCraftable: true,
  });
});

test("stripCraftabilityAndArticle trims and coerces a non-string/falsy input", () => {
  assert.deepEqual(stripCraftabilityAndArticle("  Rocket Launcher  "), {
    name: "Rocket Launcher",
    isNonCraftable: false,
  });
  assert.deepEqual(stripCraftabilityAndArticle(null), { name: "", isNonCraftable: false });
});

test("stripQualityPrefix strips a known Valve quality word and defaults to Unique otherwise", () => {
  assert.deepEqual(stripQualityPrefix("Strange Rocket Launcher"), { name: "Rocket Launcher", quality: "Strange" });
  assert.deepEqual(stripQualityPrefix("Rocket Launcher"), { name: "Rocket Launcher", quality: "Unique" });
});

// REGRESSION for a live bug report: "Strange" is a genuine, standalone
// quality on its own (id 11), but Valve ALSO uses it as an add-on Strange-
// tracking descriptor prepended ahead of an item's REAL quality (confirmed
// live: "Strange Vintage Camera Beard" is genuinely Vintage-quality, with
// "Strange" just an add-on) - same pattern already fixed for the Decorated
// Weapon case (utils/tf2StatsLinks/decoratedWeapon.js's own isUnusual) and
// the Steam inventory tile's own border-color case
// (steamcommunity.com/itemQuickLinks/content.js's own resolveQualityFromActiveTile),
// generalized here for the plain quality-word-stripping path every other
// item type shares.
test("stripQualityPrefix treats 'Strange' ahead of a SECOND quality word as an add-on, not the real quality", () => {
  assert.deepEqual(stripQualityPrefix("Strange Vintage Camera Beard"), { name: "Camera Beard", quality: "Vintage" });
});

test("stripQualityPrefix still treats a bare 'Strange' (no second quality word after it) as the real quality", () => {
  assert.deepEqual(stripQualityPrefix("Strange Rocket Launcher"), { name: "Rocket Launcher", quality: "Strange" });
});

test("stripQualityPrefix does not strip a Strange Part tool's own name", () => {
  // "Strange Part: ..." is a real Unique-quality catalog item name, not a
  // Strange-quality "Part: ..." - see the function's own note.
  assert.deepEqual(stripQualityPrefix("Strange Part: Kills While Übercharged"), {
    name: "Strange Part: Kills While Übercharged",
    quality: "Unique",
  });
});

// Strange Cosmetic Parts and Strange Filters are Unique-quality tools named
// like Strange Parts. Read as Strange-quality "Cosmetic Part: ..."/"Filter:
// ...", their stats link pointed at /stats/Strange/Cosmetic Part: Kills.
test("stripQualityPrefix does not strip a Strange Cosmetic Part's or a Strange Filter's own name", () => {
  for (const name of ["Strange Cosmetic Part: Kills", "Strange Filter: Coldfront (Community)"]) {
    assert.deepEqual(stripQualityPrefix(name), { name, quality: "Unique" });
  }
  assert.deepEqual(stripCraftabilityQualityAndArticle("Non-Craftable Strange Cosmetic Part: Kills"), {
    name: "Strange Cosmetic Part: Kills",
    quality: "Unique",
    isNonCraftable: true,
  });
});

test("stripQualityPrefix does not strip a LITERAL_NAME_QUALITY_EXCEPTIONS entry", () => {
  assert.ok(LITERAL_NAME_QUALITY_EXCEPTIONS.includes("Strange Bacon Grease"));
  assert.deepEqual(stripQualityPrefix("Strange Bacon Grease"), {
    name: "Strange Bacon Grease",
    quality: "Unique",
  });
});

// "Strange Count Transfer Tool" is another real Unique-quality catalog item
// whose own name starts with "Strange".
test("stripQualityPrefix does not strip 'Strange Count Transfer Tool'", () => {
  assert.ok(LITERAL_NAME_QUALITY_EXCEPTIONS.includes("Strange Count Transfer Tool"));
  assert.deepEqual(stripQualityPrefix("Strange Count Transfer Tool"), {
    name: "Strange Count Transfer Tool",
    quality: "Unique",
  });
});

test("stripCraftabilityQualityAndArticle strips article LAST, after quality - not before", () => {
  // Confirmed-live ordering bug this function fixes: the quality word sits
  // BEFORE "The " in the raw name ("Vintage The Max's Severed Head"), so
  // article must be stripped after quality, not between craftability and
  // quality.
  assert.deepEqual(stripCraftabilityQualityAndArticle("Vintage The Max's Severed Head"), {
    name: "Max's Severed Head",
    quality: "Vintage",
    isNonCraftable: false,
  });
});

test("stripCraftabilityQualityAndArticle combines all three strips for a non-craftable item", () => {
  assert.deepEqual(stripCraftabilityQualityAndArticle("Non-Craftable Strange Voodoo Juju"), {
    name: "Voodoo Juju",
    quality: "Strange",
    isNonCraftable: true,
  });
});

test("KILLSTREAK_TIER_BY_WORD has no Basic entry - callers rely on their own `?? 1` default", () => {
  assert.equal(KILLSTREAK_TIER_BY_WORD.Professional, 3);
  assert.equal(KILLSTREAK_TIER_BY_WORD.Specialized, 2);
  assert.equal(KILLSTREAK_TIER_BY_WORD.Basic, undefined);
});

test("buildClassicTargetClassifiedsLink builds a classic backpack.tf target search with sheen/killstreaker omitted by default", () => {
  const url = new URL(buildClassicTargetClassifiedsLink("Righteous Bison", 3, "-1"));
  assert.equal(url.origin + url.pathname, "https://backpack.tf/classifieds");
  assert.equal(url.searchParams.get("item"), "Righteous Bison");
  assert.equal(url.searchParams.get("killstreak_tier"), "3");
  assert.equal(url.searchParams.get("craftable"), "-1");
  assert.equal(url.searchParams.get("item_type"), "target");
  assert.equal(url.searchParams.has("sheen"), false);
  assert.equal(url.searchParams.has("killstreaker"), false);
});

test("buildClassicTargetClassifiedsLink includes sheen/killstreaker only when given", () => {
  const url = new URL(buildClassicTargetClassifiedsLink("Righteous Bison", 3, "-1", 6, 2007));
  assert.equal(url.searchParams.get("sheen"), "6");
  assert.equal(url.searchParams.get("killstreaker"), "2007");
});

test("buildNextTargetClassifiedsLink builds a next.backpack.tf target search by tool name + targetItem", () => {
  const url = new URL(buildNextTargetClassifiedsLink("Kit", "Righteous Bison", 2));
  assert.equal(url.origin + url.pathname, "https://next.backpack.tf/classifieds");
  assert.equal(url.searchParams.get("itemName"), "Kit");
  assert.equal(url.searchParams.get("targetItem"), "Righteous Bison");
  assert.equal(url.searchParams.get("killstreakTier"), "2");
  assert.equal(url.searchParams.get("sheen"), null);
  assert.equal(url.searchParams.get("killstreaker"), null);
});

test("buildNextTargetClassifiedsLink includes sheen/killstreaker only when given", () => {
  const url = new URL(buildNextTargetClassifiedsLink("Kit", "Righteous Bison", 3, 6, 2007));
  assert.equal(url.searchParams.get("sheen"), "6");
  assert.equal(url.searchParams.get("killstreaker"), "2007");
});

test("base64EncodeUtf8 matches plain btoa for ASCII text", () => {
  const json = JSON.stringify({ u: [{ defindex: 300, paint: "Team Spirit" }] });
  assert.equal(base64EncodeUtf8(json), btoa(json));
});

test("base64EncodeUtf8 encodes non-Latin-1 text as UTF-8 instead of throwing like btoa", () => {
  const text = "Zepheniah’s Greed";
  assert.throws(() => btoa(text));
  assert.equal(Buffer.from(base64EncodeUtf8(text), "base64").toString("utf8"), text);
});
