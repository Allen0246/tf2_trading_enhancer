/*
@description: Shared constants and name-parsing helpers used by more than one
item-type module in this folder (see index.js for the folder's overview and
public API).
*/

import { QUALITY_ID_BY_NAME, QUALITY_NAME_BY_ID } from "../tf2Quality.js";
import { PAINT_IDS } from "../tf2AttributeIds.js";

// Every Valve quality that can appear as a display-name prefix, derived from
// utils/tf2Quality.js so none can be missing (a missing "Collector's" once
// produced /stats/Unique/Collector's Machina). "Normal" and "Decorated
// Weapon" never appear as text prefixes.
export const ITEMS_QUALITY = Object.values(QUALITY_NAME_BY_ID).filter(
  (name) => name !== "Normal" && name !== "Decorated Weapon"
);
export const ITEMS_CRAFTABILITY = ["Craftable", "Non-Craftable"];

// Unique-quality items whose real name starts with a quality word, e.g.
// "Strange Bacon Grease" is the full name, not a Strange "Bacon Grease".
// Text-based quality detection cannot tell these apart from "<Quality>
// <item>", so they are listed explicitly (alongside STRANGE_TOOL_NAME_PATTERN
// below). utils/tf2ItemName.js's stripNamePrefix has its own equivalent
// checks. See #116.
export const LITERAL_NAME_QUALITY_EXCEPTIONS = ["Strange Bacon Grease", "Strange Count Transfer Tool"];

// The tool families whose Unique-quality name starts with "Strange": Strange
// Parts ("Strange Part: Kills While Übercharged"), Strange Cosmetic Parts
// ("Strange Cosmetic Part: Kills") and Strange Filters ("Strange Filter:
// Coldfront (Community)"). A family has too many members to list by name.
const STRANGE_TOOL_NAME_PATTERN = /^Strange (?:Part|Cosmetic Part|Filter):/i;

export const baseBpUrl = "https://backpack.tf/stats";
export const baseNextBpUrl = "https://next.backpack.tf/stats";
export const baseSteamMarketUrl = "https://steamcommunity.com/market/listings/440";

// --- Shared name-parsing helpers -------------------------------------------
// Every match*/createBpStatsLink* function in this folder needs some
// combination of these strips. Two combinations are used, and the order
// within each is significant:
//  - stripCraftabilityAndArticle (craftability, then article): used by the
//    item-type matchers (Strangifiers, Kits, Fabricators, War Paint tools,
//    Decorated Weapons) that have no separate quality word of their own to
//    strip - their "The " (if any) sits directly after craftability.
//  - stripCraftabilityQualityAndArticle (craftability, then quality, then
//    article): used wherever a Valve quality word can also be present. The
//    quality word always sits BETWEEN craftability and article in the raw
//    name (e.g. "Vintage The Max's Severed Head" - quality "Vintage" before
//    "The"), so article has to be stripped last, not before quality - see
//    that function's own note for the bug this ordering fixes.
// Centralized here so the anchoring rules only have to be gotten right once.

/**
 * Strips the "Non-Craftable " prefix Valve puts at the very front of a
 * non-craftable item's display name (before the quality word). Anchored to
 * the start of the string on purpose - an unanchored `.includes`/`.replace`
 * risks matching "Non-Craftable" if it ever showed up later in a name
 * instead of as this prefix, setting isNonCraftable right while silently
 * failing to actually strip anything (or vice versa).
 *
 * @param {string} name
 * @returns {{name: string, isNonCraftable: boolean}}
 */
export function stripCraftabilityPrefix(name) {
  const prefix = `${ITEMS_CRAFTABILITY[1]} `;
  return name.startsWith(prefix)
    ? { name: name.slice(prefix.length).trim(), isNonCraftable: true }
    : { name, isNonCraftable: false };
}

/**
 * Strips a leading "The " article some raw item names carry. backpack.tf's
 * canonical item names drop it (e.g. "The Team Captain" -> "Team Captain"),
 * but Steam's own market_hash_name keeps it - so this is only ever applied
 * on the backpack.tf/marketplace.tf side, never in buildSteamMarketName.
 *
 * @param {string} name
 * @returns {string}
 */
export function stripArticlePrefix(name) {
  return name.startsWith("The ") ? name.slice(4) : name;
}

/*
@description: Whether `name` starts with "Australium" as an Australium weapon
variant, not merely an item whose real name starts with that word. The only
known false positive is the Paint Can "Australium Gold", so names that are
exact PAINT_IDS keys are excluded. See #72.
*/
export function hasLiteralAustraliumPrefix(name) {
  return !(name in PAINT_IDS) && /^Australium\s+/i.test(name);
}

/**
 * Escapes regex metacharacters so a plain string (e.g. a schema-provided
 * effect name) can be dropped into `new RegExp(...)` and matched literally.
 * None of today's Unusual effect names happen to contain one, but effect
 * names come from the fetched TF2 schema, not a hardcoded list here, so this
 * guards against a future schema addition (e.g. a name containing a
 * parenthesis) breaking or silently mis-matching in resolveUnusualEffect.
 *
 * @param {string} value
 * @returns {string}
 */
export function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/*
@description: base64 of a string's UTF-8 bytes, for the posts.tf search
links (index.js's and scrap.tf/itemLinks/links.js's buildPostsTfLink). btoa
itself only accepts Latin-1 and throws on anything else (e.g. a curly
apostrophe in a page's paint name), which rejected the whole link
resolution along with posts.tf's. ASCII text encodes exactly as plain btoa
does.
*/
export function base64EncodeUtf8(text) {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Combines stripCraftabilityPrefix + stripArticlePrefix, in that order, on a
 * raw (untrimmed, possibly non-string) item name - the pairing almost every
 * match/createBpStatsLink helper in this folder needs before it can look for
 * its own item-type-specific pattern.
 *
 * @param {string} itemNameRaw
 * @returns {{name: string, isNonCraftable: boolean}}
 */
export function stripCraftabilityAndArticle(itemNameRaw) {
  const { name, isNonCraftable } = stripCraftabilityPrefix(String(itemNameRaw || "").trim());
  return { name: stripArticlePrefix(name), isNonCraftable };
}

/**
 * Strips a leading Valve QUALITY word (e.g. "Strange ") off a name already
 * past craftability/article stripping, defaulting to "Unique" when none is
 * found. This function is about the item's QUALITY only - it never searches
 * for, filters by, or otherwise cares about attached Strange Parts (a
 * completely unrelated concept - see nameIsStrangeTool's own note below).
 *
 * Skips the strip for a Strange Part/Cosmetic Part/Filter TOOL's own name
 * (e.g. "Strange Part: Kills While Übercharged" - see
 * STRANGE_TOOL_NAME_PATTERN) and LITERAL_NAME_QUALITY_EXCEPTIONS (see that
 * const's own note) - both start with a quality word as part of their actual
 * item name, not as a genuine quality prefix, so stripping it would silently
 * invent a Strange-quality item that doesn't exist.
 *
 * @param {string} name
 * @returns {{name: string, quality: string}}
 */
export function stripQualityPrefix(name) {
  // A Unique-quality tool item. (Not to be confused with an item that has
  // Strange Parts attached.)
  const nameIsStrangeTool = STRANGE_TOOL_NAME_PATTERN.test(name);
  const isLiteralNameException = LITERAL_NAME_QUALITY_EXCEPTIONS.includes(name);
  if (!nameIsStrangeTool && !isLiteralNameException) {
    for (const q of ITEMS_QUALITY) {
      if (name.startsWith(q + " ")) {
        const rest = name.slice((q + " ").length);
        // "Strange" is also used as a Strange-tracking descriptor in front of
        // an item's real quality (e.g. "Strange Unusual ..."). If another
        // quality word follows, that one is the real quality and "Strange"
        // is dropped. See #117.
        if (q === "Strange") {
          for (const innerQuality of ITEMS_QUALITY) {
            if (innerQuality !== "Strange" && rest.startsWith(innerQuality + " ")) {
              return { name: rest.slice((innerQuality + " ").length), quality: innerQuality };
            }
          }
        }
        return { name: rest, quality: q };
      }
    }
  }
  return { name, quality: "Unique" };
}

/**
 * Combines stripCraftabilityPrefix + stripQualityPrefix + stripArticlePrefix,
 * in that order, for callers that need all three (createBpStatsLink and
 * resolveClassifiedsFilters' generic branch).
 *
 * Order matters: the article must be stripped last, because the raw name
 * puts the quality word before "The " (e.g. "Vintage The Max's Severed
 * Head").
 *
 * @param {string} itemNameRaw
 * @returns {{name: string, quality: string, isNonCraftable: boolean}}
 */
export function stripCraftabilityQualityAndArticle(itemNameRaw) {
  const { name: craftStripped, isNonCraftable } = stripCraftabilityPrefix(String(itemNameRaw || "").trim());
  const { name: qualityStripped, quality } = stripQualityPrefix(craftStripped);
  return { name: stripArticlePrefix(qualityStripped), quality, isNonCraftable };
}

// Killstreak tier adjective -> numeric tier, shared by matchKillstreakKit,
// matchFabricatorKit and stripKillstreakWeaponPrefix. Plain "Killstreak"
// (Basic, tier 1) has no adjective, so callers default with `?? 1`.
// scrap.tf/itemLinks/constants.js has a same-named table with an explicit
// Basic: 1 entry because scrap.tf spells "Basic" out.
export const KILLSTREAK_TIER_BY_WORD = { Professional: 3, Specialized: 2 };

// --- Shared "target weapon" classifieds search builders --------------------
// A Killstreak Kit and a Killstreak Kit Fabricator both search classifieds by
// their TARGET weapon (not their own tool name) on classic backpack.tf, and
// by their own tool name (+ a dedicated targetItem param) on
// next.backpack.tf - identical shapes for both item types, just with
// different craftable state/tool name, so both killstreakKit.js and
// fabricatorKit.js share these two builders rather than each keeping a copy.

/**
 * Build the classic backpack.tf classifieds search shared by a Killstreak
 * Kit and a Killstreak Kit Fabricator - confirmed live, both search by the
 * TARGET weapon's name with item_type=target and killstreak_tier, not by
 * their own tool name the way their respective next.backpack.tf links do
 * (see buildNextTargetClassifiedsLink below). Only craftable differs between
 * the two callers - a Kit is always non-craftable, a Fabricator keeps its own
 * real craftable/non-craftable state - so that's the one param passed in
 * rather than hardcoded here.
 *
 * @param {string} targetName - the target weapon's name
 * @param {number} tier - Killstreak tier (1 Basic, 2 Specialized, 3 Professional)
 * @param {string} craftable - "1" or "-1", classic backpack.tf's own convention
 * @param {?number} [sheenId]
 * @param {?number} [killstreakerId]
 * @returns {string} URL
 */
export function buildClassicTargetClassifiedsLink(targetName, tier, craftable, sheenId = null, killstreakerId = null) {
  const params = new URLSearchParams({
    item: targetName,
    quality: String(QUALITY_ID_BY_NAME.Unique),
    tradable: "1",
    craftable,
    australium: "-1",
    killstreak_tier: String(tier),
    item_type: "target",
  });
  // A Kit (or a Kit Fabricator, whose output's Sheen/Killstreaker is fixed
  // and shown as "You will receive... (X)") can carry these; same param
  // names as the generic branch. See #25.
  if (sheenId) params.set("sheen", String(sheenId));
  if (killstreakerId) params.set("killstreaker", String(killstreakerId));
  return `https://backpack.tf/classifieds?${params.toString()}`;
}

/**
 * Build the next.backpack.tf classifieds search shared by a Killstreak Kit
 * and a Killstreak Kit Fabricator - confirmed live, both search by their own
 * tool name (toolItemName: "Kit" or "Fabricator") plus a dedicated
 * targetItem param and killstreakTier, with NO tradable/craftable/australium
 * at all - unlike classic backpack.tf's shape for the same two tools, which
 * instead searches by the TARGET weapon's name (see
 * buildClassicTargetClassifiedsLink above).
 *
 * @param {string} toolItemName - "Kit" or "Fabricator"
 * @param {string} targetName - the target weapon's name
 * @param {number} tier - Killstreak tier (1 Basic, 2 Specialized, 3 Professional)
 * @param {?number} [sheenId]
 * @param {?number} [killstreakerId]
 * @returns {string} URL
 */
export function buildNextTargetClassifiedsLink(toolItemName, targetName, tier, sheenId = null, killstreakerId = null) {
  const params = new URLSearchParams({
    itemName: toolItemName,
    quality: String(QUALITY_ID_BY_NAME.Unique),
    targetItem: targetName,
    killstreakTier: String(tier),
  });
  if (sheenId) params.set("sheen", String(sheenId));
  if (killstreakerId) params.set("killstreaker", String(killstreakerId));
  return `https://next.backpack.tf/classifieds?${params.toString()}`;
}
