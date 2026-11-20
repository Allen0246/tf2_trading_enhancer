/*
@description: Site-agnostic backpack.tf stats/classifieds, marketplace.tf,
Steam Market, mannco.store and posts.tf link building from a plain item
display name (quality prefix intact, e.g. "Strange Voodoo Juju"); callers
read that name off their own page. Each special item type has its own
match/createBpStatsLink/build*ClassifiedsLink module in this folder
(unusual.js, targetTool.js, killstreakKit.js, fabricatorKit.js,
warPaintTool.js, decoratedWeapon.js), common.js holds shared name-parsing
helpers, and this file is the orchestration layer: plain items, Steam Market
names, attribute id lookups, classifieds/marketplace.tf dispatch, and
resolveStatsAndClassifieds, the public entry point.
*/

import { QUALITY_ID_BY_NAME } from "../tf2Quality.js";
import { getTextureId, WEAR_TIER_IDS } from "../warpaints.js";
import { getItemDefindex } from "../tf2Schema.js";
import { isSheenKillstreakerFilterEnabled } from "../sheenKillstreakerFilterSetting.js";
import { SHEEN_IDS, KILLSTREAKER_IDS, SPELL_IDS, MARKETPLACE_SPELL_SLUGS, PAINT_IDS, findPaintEntry } from "../tf2AttributeIds.js";
import {
  ITEMS_CRAFTABILITY,
  KILLSTREAK_TIER_BY_WORD,
  baseBpUrl,
  baseNextBpUrl,
  baseSteamMarketUrl,
  stripCraftabilityPrefix,
  stripQualityPrefix,
  stripCraftabilityQualityAndArticle,
  hasLiteralAustraliumPrefix,
  base64EncodeUtf8,
} from "./common.js";
import { resolveUnusualEffect, createBpStatsLinkUnusual } from "./unusual.js";
import { matchTargetItemTool, createBpStatsLinkTargetTool, buildTargetToolFullName } from "./targetTool.js";
import { matchKillstreakKit, createBpStatsLinkKillstreakKit, buildKillstreakKitClassifiedsLink } from "./killstreakKit.js";
import { matchFabricatorKit, createBpStatsLinkFabricatorKit, buildFabricatorClassifiedsLink } from "./fabricatorKit.js";
import { matchWarPaintTool, createBpStatsLinkWarPaintTool, buildWarPaintToolClassifiedsLink } from "./warPaintTool.js";
import { matchDecoratedWeapon, createBpStatsLinkDecoratedWeapon, buildDecoratedWeaponClassifiedsLink } from "./decoratedWeapon.js";

// Re-exported for callers that import everything from this module
// (stntrading.eu/link2Backpack, and the next.backpack.tf tooltip buttons,
// which classify bare attribute names by table membership).
export { ITEMS_CRAFTABILITY, stripQualityPrefix };
export { SHEEN_IDS, KILLSTREAKER_IDS, SPELL_IDS, PAINT_IDS, buildTargetToolFullName };

/*
@description: Resolves a caller-supplied paint name to the decimal-RGB id
marketplace.tf's own spaint[] filter AND classic backpack.tf's own classifieds
"paint" param expect (confirmed live for both - see PAINT_IDS' own note and
buildClassifiedsLink's own classic branch), case-insensitively matched
against PAINT_IDS the same way resolveIdByName matches
SHEEN_IDS/KILLSTREAKER_IDS/SPELL_IDS.
*/
function resolvePaintIdForMarketplace(knownPaintName) {
  const entry = findPaintEntry(knownPaintName);
  return entry ? parseInt(entry.color.slice(1), 16) : null;
}

/*
@description: Resolves a caller-supplied paint name to next.backpack.tf's OWN
numeric paint id (PAINT_IDS' own "id" field) - confirmed live via
scrap.tf/itemLinks/links.js's own buildNextClassifiedsHref, a DIFFERENT id
than classic backpack.tf's/marketplace.tf's own decimal-RGB encoding (see
resolvePaintIdForMarketplace's own note) - same "two independent encodings of
the same fact" pattern spellId/spellName already need for the same reason.
*/
function resolveNextPaintId(knownPaintName) {
  return findPaintEntry(knownPaintName)?.id ?? null;
}

// --- Plain items --------------------------------------------------------

/**
 * Build a backpack.tf stats URL for an item.
 *
 * @param {string} itemNameRaw - e.g., "Vintage The Max's Severed Head"
 * @param {boolean} useNext - true → use next.backpack.tf, false → use backpack.tf
 * @returns {string} URL
 */
function createBpStatsLink(itemNameRaw, useNext = false) {
  // Craftability has to be stripped before quality - "Non-Craftable " always
  // comes before the quality word in the raw name (e.g. "Non-Craftable
  // Strange Voodoo Juju"), so stripQualityPrefix has to run against the
  // already-craftability-stripped name or it never finds "Strange " as a
  // prefix. Article has to be stripped LAST (see
  // stripCraftabilityQualityAndArticle's own note) - not before quality. See #73.
  const { name, quality: matchedQuality, isNonCraftable } = stripCraftabilityQualityAndArticle(itemNameRaw);

  // next.backpack.tf's /stats/{quality}/{name}/... path redirects (Vue SPA)
  // to an ?item=...&quality=... route that treats the whole name segment as
  // one literal item name, so an Australium needs the bare weapon name plus
  // australium=true instead, like resolveClassifiedsFilters does. Classic
  // backpack.tf's /stats/ path resolves "Australium {Weapon}" fine. See #74.
  if (useNext && hasLiteralAustraliumPrefix(name)) {
    const bareWeaponName = name.replace(/^Australium\s+/i, "").trim();
    const params = new URLSearchParams({ item: bareWeaponName, quality: matchedQuality, australium: "true" });
    return `${baseNextBpUrl}?${params.toString()}`;
  }

  // Quality is encoded too: Collector's apostrophe must come through as %27
  // (.../Collector%27s/Machina/...).
  const encodedName = encodeURIComponent(name);
  const encodedQuality = encodeURIComponent(matchedQuality);

  // choose base
  const base = useNext ? baseNextBpUrl : baseBpUrl;

  return `${base}/${encodedQuality}/${encodedName}/Tradable/${
    isNonCraftable ? "Non-Craftable" : "Craftable"
  }`;
}

// --- Steam Community Market -------------------------------------------

/*
@description: Removes the "★" marker some sites print in an Unusual's name,
which is never part of a real TF2 item name, and collapses repeated spaces.
Seen live on mannco.store: the card title is "{Effect} ★ Unusual {Item}"
(e.g. "Bonzo The All-Gnawing ★ Unusual Connoisseur's Cap"), and with the
"Unusual " quality prefix callers add in front, "Unusual" ends up in the
name twice with the star between. Both went straight into the backpack.tf
stats URL (/stats/Unusual/★  Unusual Connoisseur's Cap/...). So when a star
is present, every "Unusual" after the first is dropped as well.
*/
export function stripStarMarker(name) {
  let cleaned = String(name ?? "");
  if (cleaned.includes("★")) {
    cleaned = cleaned.replace(/★/g, " ");
    let keptUnusual = false;
    cleaned = cleaned.replace(/\bUnusual\b/g, (word) => {
      if (keptUnusual) return "";
      keptUnusual = true;
      return word;
    });
  }
  return cleaned.replace(/\s+/g, " ").trim();
}

/**
 * Build the Steam Community Market name for an item. Unlike backpack.tf,
 * Steam's market doesn't distinguish craftable from non-craftable at all -
 * both trade under the same listing (confirmed live: searching "Strange
 * Voodoo Juju (Not Craftable)" 404s, "Strange Voodoo Juju" is the actual
 * listing) - so the "Non-Craftable " prefix shown on the page is just
 * dropped entirely rather than reformatted into a Steam-specific suffix.
 * Also used for stntrading.eu item-page URLs, which follow Steam's
 * market_hash_name convention.
 *
 * @param {string} itemNameRaw
 * @returns {string}
 */
export function buildSteamMarketName(itemNameRaw) {
  return stripCraftabilityPrefix(stripStarMarker(itemNameRaw)).name;
}

/**
 * Build an stntrading.eu item page URL (confirmed live shape: words joined
 * by a literal "+"). The general case reuses Steam's market_hash_name
 * (buildSteamMarketName); an Unusual keeps the literal "Unusual" word and
 * inserts the effect name right after it ("Unusual Burning Flames Team
 * Captain"). Never null, so the button shows even when classifiedsFilters
 * couldn't be resolved. scrap.tf/itemLinks/links.js keeps its own
 * shape-based variant of the same rule.
 *
 * @param {string} itemNameRaw
 * @param {?Awaited<ReturnType<typeof resolveClassifiedsFilters>>} filters
 * @returns {string} URL
 */
export function buildStnTradingHref(itemNameRaw, filters) {
  const isUnusual = !!filters?.effectName || filters?.quality === "Unusual";
  let name = isUnusual ? `Unusual ${filters.effectName ? `${filters.effectName} ` : ""}${filters.itemName}` : buildSteamMarketName(itemNameRaw);
  // matchDecoratedWeapon also accepts "{skin}{weapon}" with no separator
  // (next.backpack.tf's tooltip buttons build that shape), but a market
  // name always has a space between the two.
  const decorated = filters?.decoratedWeapon;
  if (decorated) name = name.replace(`${decorated.skinName}${decorated.weaponName}`, `${decorated.skinName} ${decorated.weaponName}`);
  const encodedWords = name.split(" ").map(encodeURIComponent);
  return `https://stntrading.eu/item/tf2/${encodedWords.join("+")}`;
}

/**
 * Build a gladiator.tf sales search URL. Its search takes a single plain
 * `item` param holding a full display name (confirmed live:
 * "https://gladiator.tf/sales?item=Smoking+Splitting+Headache", spaces as
 * "+", URLSearchParams' own encoding). Each caller passes the name that suits
 * its item, usually buildPricedbSearchName's "{Effect} {Item}" for an Unusual.
 *
 * @param {string} searchName
 * @returns {string} URL
 */
export function buildGladiatorHref(searchName) {
  const params = new URLSearchParams();
  params.set("item", searchName);
  return `https://gladiator.tf/sales?${params.toString()}`;
}

/**
 * The name to search pricedb.io (and gladiator.tf) by. Both name an Unusual
 * "{Effect} {Item}" with no "Unusual" word (see utils/pricedb.js), and
 * pricedb.io's exact-name match never finds "Unusual {Item}", so a resolved
 * effect name replaces the quality word; every other item searches by its
 * own name.
 *
 * A Strange Unusual keeps its "Strange " ("Strange {Effect} {Item}", the
 * same shape next.backpack.tf's tooltip title uses). filters.itemName has it
 * stripped, and without it the search exact-matches the plain Unusual, a
 * different item at a different price (confirmed live: "Strange Unusual Hat
 * Outta Hell" with Frightened Poltergeist linked the plain Unusual,
 * 31216;5;u203, since pricedb.io has no Strange version listed).
 *
 * @param {string} itemNameRaw
 * @param {?Awaited<ReturnType<typeof resolveClassifiedsFilters>>} filters
 * @returns {string}
 */
export function buildPricedbSearchName(itemNameRaw, filters) {
  if (!filters?.effectName) return itemNameRaw;
  const isStrange = /^Strange\s/i.test(stripCraftabilityPrefix(stripStarMarker(itemNameRaw)).name);
  return `${isStrange ? "Strange " : ""}${filters.effectName} ${filters.itemName}`;
}

/**
 * Build a direct Steam Community Market listing URL for an item - filtered
 * to "Not Usable in Crafting" for a non-craftable item and/or the Unusual
 * effect name, same as scrap.tf/itemLinks/links.js's buildSteamMarketHref
 * (e.g. .../listings/440/Unusual%20Strikeout?appid=440&q=Phantom+Plague). A Kit/Kit Fabricator's
 * own fixed Killstreaker/Sheen are sent as q= terms too when known (see the
 * kitLikeFilters block below); for every other item type, Unusual effect +
 * craftability remain the only filter terms this sends.
 *
 * For an Unusual, the listing name itself must be "Unusual {baseName}" with
 * NO effect name in it - the effect is a q= filter only, same distinction
 * Steam's own market_hash_name always makes. filters.itemName is already the
 * correctly effect-and-quality-stripped bare name (resolveClassifiedsFilters'
 * own Unusual branch, via resolveUnusualEffect), so an Unusual's name is
 * rebuilt from that rather than trusting the raw text the way
 * buildSteamMarketName does for every other quality.
 *
 * @param {string} itemNameRaw
 * @param {Awaited<ReturnType<typeof resolveClassifiedsFilters>>} filters
 * @returns {string} URL
 * See #21.
 */
export function createSteamMarketLink(itemNameRaw, filters) {
  const isNonCraftable = stripCraftabilityPrefix(stripStarMarker(itemNameRaw)).isNonCraftable;
  const isUnusual = !!filters?.effectName || filters?.quality === "Unusual";
  const marketName = buildSteamMarketName(itemNameRaw);
  // Steam's market_hash_name keeps a Strange-tracking Unusual's "Strange "
  // descriptor ("Strange Unusual Team Captain"); filters.itemName has it
  // stripped (resolveUnusualEffect), so it is put back here.
  const strangeDescriptor = isUnusual && /^Strange\s+Unusual\s/i.test(marketName) ? "Strange " : "";

  const name = isUnusual ? `${strangeDescriptor}Unusual ${filters.itemName}` : marketName;

  // A Kit/Kit Fabricator's own finished Kit has a FIXED Killstreaker/Sheen,
  // shown right on its own item panel - confirmed live for both a Fabricator
  // ("...?appid=440&q=Fire+Horns,Mean+Green") and a standalone Kit
  // ("...?appid=440&q=Incinerator,Hot+Rod") - killstreaker first, then
  // sheen, same q= mechanism already used below for an Unusual's own effect
  // name.
  const kitLikeFilters = filters?.fabricatorKit || filters?.killstreakKit;

  const marketFilterTerms = [];
  if (isUnusual && filters.effectName) marketFilterTerms.push(filters.effectName);
  // Every Kit/Kit Fabricator is inherently, permanently non-craftable -
  // that's the norm for the whole item type, not a distinguishing trait the
  // way it is for an ordinary cosmetic - so this term is skipped for
  // kitLikeFilters specifically. See #75.
  if (isNonCraftable && !kitLikeFilters) marketFilterTerms.push("Not Usable in Crafting");
  if (kitLikeFilters) {
    if (kitLikeFilters.killstreakerName) marketFilterTerms.push(kitLikeFilters.killstreakerName);
    if (kitLikeFilters.sheenName) marketFilterTerms.push(kitLikeFilters.sheenName);
  } else {
    // An ordinary Killstreak item with a known Killstreaker/Sheen gets the
    // same q= narrowing, same order (its listings carry the same
    // "Killstreaker: X" / "Sheen: Y" description lines a Kit's do). The ids
    // are already null when the user switched Sheen/Killstreaker filtering
    // off. Confirmed live for Kits only; for weapons it follows the same
    // mechanism, not separately confirmed.
    const killstreakerName = attributeNameForId(KILLSTREAKER_IDS, filters?.killstreakerId);
    const sheenName = attributeNameForId(SHEEN_IDS, filters?.sheenId);
    if (killstreakerName) marketFilterTerms.push(killstreakerName);
    if (sheenName) marketFilterTerms.push(sheenName);
  }

  let href = `${baseSteamMarketUrl}/${encodeURIComponent(name)}`;
  if (marketFilterTerms.length) {
    const params = new URLSearchParams({ appid: "440", q: marketFilterTerms.join(",") });
    href += `?${params.toString()}`;
  }
  return href;
}

/*
@description: The Sheen/Killstreaker name for one of SHEEN_IDS'/
KILLSTREAKER_IDS' ids (e.g. 7 -> "Hot Rod"), or null. For a caller that
only has the id - a resolved filter, or a page link carrying next.backpack.tf's
own "sheen=7&killstreaker=2004" params (marketplace.tf).
*/
export function attributeNameForId(table, id) {
  if (id == null || id === "") return null;
  const numeric = Number(id);
  return Object.keys(table).find((name) => table[name] === numeric) ?? null;
}

// --- Sheen / Killstreaker id lookups ---------------------------------------
// Matches SHEEN_IDS/KILLSTREAKER_IDS' own key names against a caller-supplied
// name case-insensitively, same matching convention resolveUnusualEffect's
// own knownEffectName branch uses - both are static, so no schema/async
// lookup is needed the way effect names (fetched from the TF2 schema) do.

/**
 * Looks up a known name (case-insensitively) in a static Sheen/Killstreaker
 * id table - shared by both, since the lookup itself (unlike effect names,
 * which are fetched from the TF2 schema) is identical either way.
 *
 * @param {Record<string, number>} map - SHEEN_IDS or KILLSTREAKER_IDS
 * @param {?string} knownName
 * @returns {?number} the id, or null if no name was supplied or it didn't match.
 */
export function resolveIdByName(map, knownName) {
  if (!knownName) return null;
  const matchedName = Object.keys(map).find((n) => n.toLowerCase() === knownName.toLowerCase());
  return matchedName ? map[matchedName] : null;
}

// --- Classifieds filter resolution ------------------------------------

/**
 * Strips an actual Killstreak WEAPON's tier prefix (not a Kit - see
 * killstreakKit.js's matchKillstreakKit for that) off the front of a name
 * already past its quality-word prefix, e.g. "Professional Killstreak Rocket
 * Launcher" -> { name: "Rocket Launcher", tier: 3 }. Same tier-word
 * convention matchKillstreakKit already uses (Professional=3, Specialized=2,
 * plain "Killstreak" alone with no adjective=1/Basic), just without that
 * function's own " Kit" suffix requirement, since this is a plain weapon, not
 * a crafting-tool item type of its own.
 *
 * Must run before the Australium-prefix check in resolveClassifiedsFilters'
 * generic branch: in "Professional Killstreak Australium Rocket Launcher"
 * the tier words sit in front of "Australium ".
 * @returns {{name: string, tier: number}} tier is 0 (no Killstreak prefix found).
 */
function stripKillstreakWeaponPrefix(name) {
  const match = /^(Professional |Specialized )?Killstreak /i.exec(name);
  if (!match) return { name, tier: 0 };

  const tier = KILLSTREAK_TIER_BY_WORD[match[1]?.trim()] ?? 1;
  return { name: name.slice(match[0].length), tier };
}

/**
 * Resolves the classifieds search filters (item name, quality name,
 * craftability, Australium, and - for Unusual items - the effect id) shared
 * by both backpack.tf's and next.backpack.tf's classifieds search links,
 * using the same name-parsing rules as createBpStatsLink (quality/
 * craftability/"The " prefix stripping) plus Australium, which classifieds
 * splits into its own filter param instead of keeping it in the item name
 * the way the stats page does. Target-item tools (Strangifiers) search for
 * the tool itself (itemName=Strangifier) same as their stats link, but -
 * unlike the stats link, which has no equivalent slot for it - next.
 * backpack.tf's classifieds search also takes the target weapon as its own
 * targetItem param (confirmed live: itemName=Strangifier&quality=6&
 * tradable=1&craftable=1&australium=0&targetItem=Righteous%20Bison), so the
 * target weapon's name is carried through as targetItemName for
 * buildClassifiedsLink to add. Classic backpack.tf has no confirmed
 * equivalent param for this, so its link stays a plain "Strangifier" search
 * with no target filtering. Killstreak Kits return a killstreakKit field
 * instead of the generic fields - see buildKillstreakKitClassifiedsLink,
 * which needs a differently-shaped search entirely (filtering by the target
 * weapon, not the Kit itself). Fabricators return a fabricatorKit field for
 * the same reason - see buildFabricatorClassifiedsLink. War Paint tools
 * return a warPaintTool field, with textureId already resolved here (the
 * only async lookup a War Paint tool needs, since - unlike Kits/Strangifiers/
 * Fabricators - it needs no schema/defindex lookup at all) so
 * buildClassifiedsLink itself can stay synchronous.
 *
 * @param {string} itemNameRaw
 * @param {{knownEffectName: ?string, knownEffectId: ?number, knownSheenName: ?string, knownKillstreakerName: ?string, knownSpellName: ?string, knownKillstreakTier: ?number, knownPaintName: ?string, allowSkinWithoutWearTier: boolean}} [options] -
 * see resolveStatsAndClassifieds' own note for each option.
 * knownEffectName: see resolveUnusualEffect's own note. knownSheenName/
 * knownKillstreakerName/knownSpellName: same idea, for a caller (steamcommunity.com's
 * Market listing detail modal, itemQuickLinks) that labels a specific listing/item's
 * own "Sheen: X"/"Killstreaker: Y"/"Halloween Spell: Z" separately from the item
 * name text, which never bakes any of them in - there's nothing to derive these
 * from the name itself the way Killstreak TIER (see stripKillstreakWeaponPrefix) can be.
 * @returns {Promise<{itemName: string, quality: string, isNonCraftable: boolean, isAustralium: boolean, effectId: ?number, targetItemName: ?string, killstreakTier: ?number, sheenId: ?number, killstreakerId: ?number, spellId: ?string, spellName: ?string, crateSeries: ?number} | {killstreakKit: {targetName: string, tier: number, sheenId: ?number, killstreakerId: ?number}} | {fabricatorKit: {targetName: string, tier: number, isNonCraftable: boolean, sheenId: ?number, killstreakerId: ?number}} | {warPaintTool: {skinName: string, wearTier: string, isStrange: boolean, textureId: ?number}} | null>}
 * null if this is an Unusual and the effect schema itself couldn't be
 * resolved (mirrors createBpStatsLinkUnusual's own null case) - effectId
 * coming back null within a successful result just means this particular
 * Unusual has no effect, not a failure.
 */
async function resolveClassifiedsFilters(
  itemNameRaw,
  {
    knownEffectName = null,
    knownEffectId = null,
    knownSheenName = null,
    knownKillstreakerName = null,
    knownSpellName = null,
    knownKillstreakTier = null,
    knownPaintName = null,
    allowSkinWithoutWearTier = false,
  } = {}
) {
  let name = String(itemNameRaw || "").trim();
  // Sheen/Killstreaker filtering is user-toggleable. When off, every branch
  // below resolves null sheenId/killstreakerId/sheenName/killstreakerName,
  // same as if the caller had never supplied a known name to begin with - so
  // every consumer (classic/next.backpack.tf classifieds, marketplace.tf's
  // sks[]/ske[], Steam Market's q=) degrades to its existing "unknown"
  // fallback rather than needing its own separate off-switch. Deliberately
  // does NOT touch knownKillstreakTier or any caller's own Killstreak TIER
  // detection (already computed, from the same raw known* names, before this
  // function is ever called) - tier stays a coarse, always-on categorization
  // independent of this toggle.
  const sheenKillstreakerFilterEnabled = await isSheenKillstreakerFilterEnabled();
  const effectiveKnownSheenName = sheenKillstreakerFilterEnabled ? knownSheenName : null;
  const effectiveKnownKillstreakerName = sheenKillstreakerFilterEnabled ? knownKillstreakerName : null;
  const sheenId = resolveIdByName(SHEEN_IDS, effectiveKnownSheenName);
  const killstreakerId = resolveIdByName(KILLSTREAKER_IDS, effectiveKnownKillstreakerName);
  // spellName is the caller-supplied name itself (classic backpack.tf's own
  // param value, confirmed live to be the literal name - see SPELL_IDS' own
  // note), spellId is next.backpack.tf's composite id resolved from it.
  const spellName = knownSpellName || null;
  const spellId = resolveIdByName(SPELL_IDS, knownSpellName);
  // Deliberately NOT resolved/attached for the Unusual branch below (or any
  // other branch besides the generic one at the very end) - confirmed live
  // via scrap.tf/itemLinks/links.js's own buildMarketplaceHref (see its
  // spaint[] note): filtering by a specific paint color on top of an already-
  // narrow Unusual/Kit/Fabricator/skin search would eliminate results a user
  // actually wants, since what makes those worth finding is the effect/
  // target weapon/skin, not whichever paint (if any) happens to be applied.
  // Only a plain cosmetic (hat/misc item) - the generic branch - gets it.
  // Same exclusion applies to nextPaintId below (next.backpack.tf's own
  // classifieds "paint" param) - not just marketplace.tf's spaint[].
  const classicPaintId = resolvePaintIdForMarketplace(knownPaintName);
  const nextPaintId = resolveNextPaintId(knownPaintName);

  // resolveUnusualEffect's own knownEffectName/knownEffectId paths don't need
  // "Unusual" in the string either way - so it's safe to call for a War Paint
  // tool/Decorated Weapon too, using only the returned effectId
  // (baseName/isNonCraftable aren't needed there - already have both from
  // matchWarPaintTool/matchDecoratedWeapon's own skin+weapon+wear parsing).
  // Only attempted when a known value was actually given, same "skip the
  // (possibly expensive/schema-dependent) call entirely when there's nothing
  // to resolve" pattern every other known* option here uses.
  const resolveEffectId = async () =>
    knownEffectName || knownEffectId != null
      ? (await resolveUnusualEffect(name, knownEffectName, knownEffectId))?.effectId ?? null
      : null;

  // Skins are tried before the plain-Unusual branch: Steam's
  // market_hash_name for an Unusual Decorated Weapon (e.g. "Strange Unusual
  // Professional Killstreak Star Crossed Iron Bomber (Factory New)") contains
  // "Unusual" too, and matchDecoratedWeapon handles that word itself
  // (matchWarPaintTool does not strip it; a War Paint tool's effect comes
  // only from knownEffectName/knownEffectId). See #76.
  const warPaintTool = matchWarPaintTool(name);
  if (warPaintTool) {
    const textureId = await getTextureId(warPaintTool.skinName);
    return { warPaintTool: { ...warPaintTool, textureId, effectId: await resolveEffectId() } };
  }

  const decoratedWeapon = await matchDecoratedWeapon(name, { requireWearTier: !allowSkinWithoutWearTier });
  if (decoratedWeapon) {
    const textureId = await getTextureId(decoratedWeapon.skinName);
    // sheenId/killstreakerId were already resolved above (every branch gets
    // them). killstreakTier prefers the caller's own knownKillstreakTier (an
    // on-page title may leave the tier out of the name) and otherwise falls
    // back to whatever tier matchDecoratedWeapon parsed off a
    // market_hash_name-style name (the Steam Market listing pages and
    // stntrading.eu pass no knownKillstreakTier at all).
    return {
      decoratedWeapon: {
        ...decoratedWeapon,
        textureId,
        sheenId,
        killstreakerId,
        effectId: await resolveEffectId(),
        killstreakTier: knownKillstreakTier ?? decoratedWeapon.killstreakTier ?? 0,
      },
    };
  }

  if (name.includes("Unusual")) {
    const resolved = await resolveUnusualEffect(name, knownEffectName, knownEffectId);
    if (!resolved) return null;
    return {
      itemName: resolved.baseName,
      quality: "Unusual",
      isNonCraftable: resolved.isNonCraftable,
      isAustralium: false,
      effectId: resolved.effectId,
      effectName: resolved.effectName,
      targetItemName: null,
      sheenId,
      killstreakerId,
      spellId,
      spellName,
    };
  }

  const fabricatorKit = matchFabricatorKit(name);
  if (fabricatorKit) {
    // A Fabricator's output Kit has a fixed Sheen/Killstreaker (its tooltip
    // labels them), used by marketplace.tf's sks[]/ske[]. The raw names are
    // attached too because createSteamMarketLink's q= filter needs text
    // ("?q={killstreaker},{sheen}"), not ids.
    return { fabricatorKit: { ...fabricatorKit, sheenId, killstreakerId, sheenName: effectiveKnownSheenName, killstreakerName: effectiveKnownKillstreakerName } };
  }

  const killstreakKit = matchKillstreakKit(name);
  if (killstreakKit) {
    // A Kit carries its own fixed Sheen/Killstreaker too; same attachments as
    // the Fabricator branch above.
    return {
      killstreakKit: { ...killstreakKit, sheenId, killstreakerId, sheenName: effectiveKnownSheenName, killstreakerName: effectiveKnownKillstreakerName },
    };
  }

  const targetTool = matchTargetItemTool(name);
  if (targetTool) {
    return {
      itemName: targetTool.baseItemName,
      quality: "Unique",
      isNonCraftable: targetTool.isNonCraftable,
      isAustralium: false,
      effectId: null,
      targetItemName: targetTool.targetName,
    };
  }

  // Article is stripped last, after quality (see
  // stripCraftabilityQualityAndArticle).
  const stripped = stripCraftabilityQualityAndArticle(name);
  const isNonCraftable = stripped.isNonCraftable;
  name = stripped.name;
  const quality = stripped.quality;

  // A numbered Crate/Strongbox/etc. (e.g. "Mann Co. Supply Crate Series #26",
  // "Mann Co. Strongbox Series #81") carries its own series number as a
  // literal "Series #{n}" suffix, and next.backpack.tf's classifieds
  // "crateSeries" filter takes that printed number directly (confirmed for
  // both Mann Co. Supply Crate and Mann Co. Strongbox).
  //
  // Deliberately does NOT strip this suffix off `name` itself the way the
  // Festivized/Killstreak/Australium prefixes below do - `name` here becomes
  // the shared `itemName` this whole function returns, consumed by
  // marketplace.tf's sterm AND posts.tf's own schema defindex lookup (each
  // numbered crate is its own DISTINCT Valve schema item - "Mann Co. Supply
  // Crate" alone, with the suffix stripped, isn't even a resolvable item
  // name there, unlike an actual crate weapon) - neither has a confirmed
  // crateSeries-equivalent filter, so both keep searching the FULL name.
  // Classic backpack.tf's OWN classifieds DOES have a confirmed equivalent
  // (see buildClassifiedsLink's own numeric=crate&value={n}&low={n} note) -
  // it uses crateBaseItemName below just like next.backpack.tf does, just
  // with a different param shape.
  // crateBaseItemName is the stripped name, kept as its own separate field
  // used ONLY by buildClassifiedsLink's own next.backpack.tf branch, which is
  // the one place this split is actually confirmed live.
  const crateSeriesMatch = /^(.+) Series #(\d+)$/i.exec(name);
  const crateSeries = crateSeriesMatch ? Number(crateSeriesMatch[2]) : null;
  const crateBaseItemName = crateSeriesMatch ? crateSeriesMatch[1].trim() : null;

  // Must run BEFORE the killstreak/Australium checks below - confirmed live
  // ("Strange Festivized Professional Killstreak Australium Force-a-Nature"),
  // "Festivized " sits right after the quality word and before everything
  // else, same relative position scrap.tf/itemLinks/itemShape.js's own
  // festivePrefix already established for its own (differently-sourced,
  // data-content-based rather than text-parsed) Festivized detection.
  const isFestivized = /^Festivized /i.test(name);
  if (isFestivized) name = name.replace(/^Festivized /i, "");

  // Must run BEFORE the Australium check below - see
  // stripKillstreakWeaponPrefix's own note on why this order matters
  // (Killstreak sits between the quality word and "Australium" in a real
  // item name, e.g. "Strange Professional Killstreak Australium Rocket
  // Launcher").
  const killstreakStrip = stripKillstreakWeaponPrefix(name);
  name = killstreakStrip.name;
  const killstreakTier = killstreakStrip.tier;

  const isAustralium = hasLiteralAustraliumPrefix(name);
  if (isAustralium) name = name.replace(/^Australium /i, "");

  // A Botkiller weapon ("{Grade} Botkiller {Weapon} Mk.{Tier}"), same regex
  // as scrap.tf/itemLinks/itemShape.js: marketplace.tf's sbotkiller filter
  // takes the grade and roman-numeral tier from the name ("Strange Carbonado
  // Botkiller Wrench Mk.I" -> sbotkiller=Carbonado_I) and sterm takes the bare
  // weapon name.
  const botkillerMatch = /^(\w+) Botkiller (.+) Mk\.(I{1,3}|IV)$/i.exec(name);
  const isBotkiller = !!botkillerMatch;
  const botkillerWeaponName = botkillerMatch ? botkillerMatch[2].trim() : null;
  const botkillerSlug = botkillerMatch ? `${botkillerMatch[1]}_${botkillerMatch[3].toUpperCase()}` : null;

  // A Paint Can's own row (e.g. "Aged Moustache Grey", "Australium Gold" -
  // the same real Paint Can hasLiteralAustraliumPrefix above already knows
  // not to mistake for an Australium weapon, so `name` still reads
  // "Australium Gold" verbatim here) self-matches the item's own name
  // against the same PAINT_IDS table - classicPaintId/nextPaintId above only
  // ever come from a caller-supplied knownPaintName (a DIFFERENT,
  // already-painted item's own separate "Painted X" tooltip line), which a
  // Paint Can itself never has. Only tried when no real knownPaintName was
  // already given, so this can never override an actually-painted item's own
  // paint. See #77.
  const selfPaintEntry = !knownPaintName ? findPaintEntry(name) : null;

  return {
    itemName: name,
    quality,
    isNonCraftable,
    isAustralium,
    effectId: null,
    targetItemName: null,
    killstreakTier,
    isFestivized,
    sheenId,
    killstreakerId,
    spellId,
    spellName,
    classicPaintId: selfPaintEntry ? parseInt(selfPaintEntry.color.slice(1), 16) : classicPaintId,
    nextPaintId: selfPaintEntry ? selfPaintEntry.id : nextPaintId,
    // The caller-supplied plain paint NAME itself, not just classicPaintId's/
    // nextPaintId's own derived ids - posts.tf's own search wants the name
    // directly (see buildPostsTfLink's own note), same "keep both the raw
    // name and a derived id" pattern spellName/spellId already use here for
    // the same reason (different sites want different encodings of the same
    // fact).
    paintName: knownPaintName,
    isBotkiller,
    botkillerWeaponName,
    botkillerSlug,
    crateSeries,
    crateBaseItemName,
  };
}

// --- Classifieds link builders (backpack.tf / next.backpack.tf) ------------

/**
 * Builds a classifieds search URL from resolveClassifiedsFilters' output.
 * Classic backpack.tf and next.backpack.tf use different param names/casing
 * and different boolean conventions for craftable/Australium here (-1/1 vs
 * 0/1), the same shapes scrap.tf/itemLinks/links.js uses.
 *
 * @param {{itemName: string, quality: string, isNonCraftable: boolean, isAustralium: boolean, effectId: ?number, targetItemName: ?string} | {killstreakKit: {targetName: string, tier: number, sheenId: ?number, killstreakerId: ?number}} | {fabricatorKit: {targetName: string, tier: number, isNonCraftable: boolean, sheenId: ?number, killstreakerId: ?number}} | {warPaintTool: {skinName: string, wearTier: string, isStrange: boolean, textureId: ?number}}} filters
 * @param {boolean} useNext - true → next.backpack.tf, false → backpack.tf
 * @returns {string} URL
 */
export function buildClassifiedsLink(filters, useNext = false) {
  if (filters.warPaintTool) {
    return buildWarPaintToolClassifiedsLink(filters.warPaintTool, useNext);
  }

  if (filters.decoratedWeapon) {
    return buildDecoratedWeaponClassifiedsLink(filters.decoratedWeapon, useNext);
  }

  if (filters.fabricatorKit) {
    return buildFabricatorClassifiedsLink(filters.fabricatorKit, useNext);
  }

  if (filters.killstreakKit) {
    return buildKillstreakKitClassifiedsLink(filters.killstreakKit, useNext);
  }

  const quality = String(QUALITY_ID_BY_NAME[filters.quality] ?? QUALITY_ID_BY_NAME.Unique);

  if (useNext) {
    // crateBaseItemName (the "Series #{n}" suffix stripped off) only when
    // this IS a numbered crate - see resolveClassifiedsFilters' own note on
    // why that stripped name is kept separate from the shared filters.itemName
    // every OTHER consumer (classic backpack.tf/marketplace.tf/posts.tf)
    // still needs the FULL name for.
    const params = new URLSearchParams({
      itemName: filters.crateSeries ? filters.crateBaseItemName : filters.itemName,
      quality,
      tradable: "1",
      craftable: filters.isNonCraftable ? "0" : "1",
      australium: filters.isAustralium ? "1" : "0",
      // A Killstreak weapon's own tier (stripKillstreakWeaponPrefix), same
      // as classic's killstreak_tier below.
      killstreakTier: String(filters.killstreakTier ?? 0),
      // Only next.backpack.tf's classifieds search supports a Festivized
      // filter at all - classic backpack.tf has no equivalent param, same
      // asymmetry scrap.tf/itemLinks/links.js's own buildNextClassifiedsHref
      // already confirmed live, so this is only added here, not below.
      festivized: filters.isFestivized ? "1" : "0",
    });
    // Sent explicitly as the id or "none" (not just omitted when absent) -
    // same reasoning festivized above already has, confirmed live via
    // scrap.tf/itemLinks/links.js's own buildNextClassifiedsHref: a plain
    // Strange weapon search with no particle param at all still pulls in
    // Unusual-effect listings of the same weapon mixed into the results.
    // texture=none is likewise always sent here (never omitted) - this
    // branch never handles a Decorated Weapon (see buildDecoratedWeaponClassifiedsLink
    // above, returned before reaching here), so there's no id to prefer.
    params.set("particle", filters.effectId ? String(filters.effectId) : "none");
    params.set("texture", "none");
    // Target-item tools (Strangifiers) only - next.backpack.tf's classifieds
    // search has a dedicated targetItem param the stats link has no
    // equivalent slot for (see resolveClassifiedsFilters).
    if (filters.targetItemName) params.set("targetItem", filters.targetItemName);
    // Same "sheen"/"killstreaker" param names scrap.tf/itemLinks/links.js
    // already confirmed live for both classic and next.backpack.tf - reused
    // here from the caller-supplied knownSheenName/knownKillstreakerName
    // (resolveClassifiedsFilters), since a plain item-name string has no
    // Sheen/Killstreaker text of its own to parse out.
    if (filters.sheenId) params.set("sheen", String(filters.sheenId));
    if (filters.killstreakerId) params.set("killstreaker", String(filters.killstreakerId));
    // Sent explicitly as the id or "none", same as particle/texture above -
    // same confirmed-live reasoning and same fix scrap.tf/itemLinks/links.js's
    // own buildNextClassifiedsHref already has: a spell-less item's search
    // still surfaced Halloween Spell'd listings of the same item mixed into
    // the results without this.
    params.set("spell", filters.spellId || "none");
    // Sent explicitly as the id or "none" (not just omitted), same reasoning
    // as particle/texture/spell above and same confirmed-live shape
    // scrap.tf/itemLinks/links.js's own buildNextClassifiedsHref already
    // uses.
    //
    // Only set at all when NOT Unusual, though - an explicit paint=none
    // actively excludes any Unusual that ALSO happens to carry a paint,
    // which is exactly the wrong behavior: an Unusual search should show
    // results with any paint (or none), same as it already doesn't filter
    // by Sheen/Killstreaker unless specifically known. See #78. See #79.
    if (filters.quality !== "Unusual") {
      params.set("paint", filters.nextPaintId ? String(filters.nextPaintId) : "none");
    }
    // Confirmed live for a numbered Crate/Strongbox/etc. (see
    // resolveClassifiedsFilters' own crateSeries note) - only sent when
    // present (no "none"/0 sentinel confirmed), same conditional convention
    // targetItem/sheen/killstreaker already use just above. Classic
    // backpack.tf's own equivalent is below - a completely different param
    // shape (numeric=crate&value={n}&low={n}, not crateSeries).
    if (filters.crateSeries) params.set("crateSeries", String(filters.crateSeries));
    return `https://next.backpack.tf/classifieds?${params.toString()}`;
  }

  const params = new URLSearchParams({
    // crateBaseItemName (the "Series #{n}" suffix stripped off) only for a
    // numbered Crate/Strongbox/etc. - see resolveClassifiedsFilters' own
    // note on why that's kept separate from filters.itemName.
    item: filters.crateSeries ? filters.crateBaseItemName : filters.itemName,
    quality,
    tradable: "1",
    craftable: filters.isNonCraftable ? "-1" : "1",
    australium: filters.isAustralium ? "1" : "-1",
    // Confirmed live: classic backpack.tf's classifieds always includes
    // killstreak_tier, defaulting to 0 for non-killstreak items - not
    // conditionally added like particle below. Killstreak Kits go through
    // buildKillstreakKitClassifiedsLink instead, so this branch never
    // handles a Kit's own tier, only an actual Killstreak weapon's.
    killstreak_tier: String(filters.killstreakTier ?? 0),
  });
  // Confirmed live for a numbered Crate/Strongbox/etc.: classic backpack.tf's
  // classifieds filters on it via a generic "numeric" attribute-range system
  // (numeric=crate&value={n}&low={n}) rather than a dedicated crateSeries-
  // style param - both value AND low take the SAME printed series number
  // (no confirmed example of a genuine open-ended range, i.e. searching
  // "at least Series #26" - this always pins to one exact series, matching
  // next.backpack.tf's own single-value crateSeries filter).
  if (filters.crateSeries) {
    params.set("numeric", "crate");
    params.set("value", String(filters.crateSeries));
    params.set("low", String(filters.crateSeries));
  }
  if (filters.effectId) params.set("particle", String(filters.effectId));
  if (filters.sheenId) params.set("sheen", String(filters.sheenId));
  if (filters.killstreakerId) params.set("killstreaker", String(filters.killstreakerId));
  // Classic backpack.tf takes the literal spell NAME here, not next's
  // composite id (confirmed live via scrap.tf/itemLinks/links.js).
  //
  // Confirmed classic DOES want "spell" sent explicitly too, just
  // capitalized "None" instead of next's lowercase "none" (two
  // independently-cased conventions on the two sites, not a typo either
  // way). See #80.
  params.set("spell", filters.spellName || "None");
  // Classic's own "paint" param takes the decimal-RGB id (confirmed live via
  // scrap.tf/itemLinks/links.js's own buildClassifiedsHref: #141414 ->
  // 1315860), NOT next's own PAINT_IDS numeric id - and is only ever
  // conditionally added (no "none" fallback), matching every other
  // conditionally-added param on this classic side.
  if (filters.classicPaintId) params.set("paint", String(filters.classicPaintId));
  return `https://backpack.tf/classifieds?${params.toString()}`;
}

// --- marketplace.tf link builder -------------------------------------------

/**
 * Builds a marketplace.tf browse/search URL from resolveClassifiedsFilters'
 * output - the exact same param scheme confirmed live for scrap.tf's own
 * equivalent button (see scrap.tf/itemLinks/links.js's buildMarketplaceHref, which
 * established every shape used below through many live-confirmed examples).
 * Reuses filters as-is rather than re-parsing the raw name, same as
 * buildClassifiedsLink above.
 *
 * Killstreak tier for an actual weapon (not a Kit/Fabricator) is parsed
 * straight out of the name (resolveClassifiedsFilters' own
 * stripKillstreakWeaponPrefix). Sheen/Killstreaker (sks[]/ske[]) are NOT
 * recoverable from the name itself (unlike scrap.tf's hovered item element,
 * there's no data-content-equivalent tooltip to read them from) - they're
 * only ever present when a caller explicitly passed knownSheenName/
 * knownKillstreakerName in (see resolveStatsAndClassifieds), which happens on
 * pages that label them separately (e.g. the Steam Market listing modal's
 * "Sheen: X"/"Killstreaker: Y" lines). The same applies to Halloween Spells
 * (sspell, via knownSpellName).
 *
 * @param {Awaited<ReturnType<typeof resolveClassifiedsFilters>>} filters
 * @returns {string}
 */
function buildMarketplaceLink(filters) {
  if (filters.warPaintTool) {
    const { skinName, wearTier, isStrange, textureId, effectId } = filters.warPaintTool;
    const params = new URLSearchParams();
    // Same "only sent when non-default" rule as the Decorated Weapon branch
    // below - default here is "Decorated Weapon", not "Unique", so only the
    // Strange-tracking variant sends squality[] at all.
    if (isStrange) params.append("squality[]", String(QUALITY_ID_BY_NAME.Strange));
    params.set("sstrange", isStrange ? "1" : "0");
    params.set("skillstreak", "0");
    params.set("swear", String(WEAR_TIER_IDS[wearTier] ?? ""));
    if (textureId) params.set("spaintkit", String(textureId));
    // A War Paint tool can carry a particle effect too (e.g. "Ocean Mapped
    // War Paint (Field-Tested)" with Effect "Isotope"); "-2" means none.
    params.append("seffect[]", effectId ? String(effectId) : "-2");
    params.set("sfestivized", "0");
    params.set("saustralium", "0");
    // Generic "War Paint" once spaintkit is resolved (more reliable than a
    // skin-name text match alone), falling back to the specific skin name
    // only when textureId couldn't be resolved - same reasoning as
    // buildMarketplaceHref's own War Paint tool branch.
    params.set("sterm", textureId ? "War Paint" : `${skinName} War Paint`);
    return `https://marketplace.tf/browse/tf2?${params.toString()}`;
  }

  if (filters.decoratedWeapon) {
    const { weaponName, wearTier, isStrange, isUnusual, textureId, sheenId, killstreakerId, effectId, killstreakTier } =
      filters.decoratedWeapon;
    const params = new URLSearchParams();
    // isUnusual takes priority for squality[] here too, same as the
    // classifieds/stats builders already do - sstrange stays tied to
    // isStrange independently of that, since it conveys "has
    // Strange-tracking attached" (a real, separate attribute), not "is this
    // the item's primary quality". See #81.
    if (isUnusual) params.append("squality[]", String(QUALITY_ID_BY_NAME.Unusual));
    else if (isStrange) params.append("squality[]", String(QUALITY_ID_BY_NAME.Strange));
    params.set("sstrange", isStrange ? "1" : "0");
    // A Decorated Weapon's Killstreak tier/Sheen/Killstreaker apply here like
    // a plain weapon's (same as scrap.tf/itemLinks/links.js's
    // buildMarketplaceHref).
    params.set("skillstreak", String(killstreakTier ?? 0));
    if (sheenId) params.append("sks[]", String(sheenId));
    if (killstreakerId) params.append("ske[]", String(killstreakerId));
    params.set("swear", String(WEAR_TIER_IDS[wearTier] ?? ""));
    params.set("spaintkit", String(textureId ?? "-2"));
    params.append("seffect[]", effectId ? String(effectId) : "-2");
    params.set("sbotkiller", "none");
    params.set("sfestivized", "0");
    params.set("saustralium", "0");
    params.set("sterm", weaponName);
    return `https://marketplace.tf/browse/tf2?${params.toString()}`;
  }

  if (filters.fabricatorKit || filters.killstreakKit) {
    const { targetName, tier, sheenId, killstreakerId } = filters.fabricatorKit || filters.killstreakKit;
    const params = new URLSearchParams();
    params.append("squality[]", String(QUALITY_ID_BY_NAME.Unique));
    params.set("stype", filters.fabricatorKit ? "Fabricator" : "Killstreak Kit");
    params.set("sstrange", "0");
    params.set("skillstreak", String(tier));
    // Present on both a Kit and a Fabricator (whose output Kit's
    // Sheen/Killstreaker is fixed).
    if (sheenId) params.append("sks[]", String(sheenId));
    if (killstreakerId) params.append("ske[]", String(killstreakerId));
    params.set("spaintkit", "-2");
    params.append("seffect[]", "-2");
    params.set("sbotkiller", "none");
    params.set("sfestivized", "0");
    params.set("saustralium", "0");
    params.set("sterm", targetName);
    return `https://marketplace.tf/browse/tf2?${params.toString()}`;
  }

  // Collector's uses a much more minimal param set than every other quality
  // - confirmed live for a plain Collector's item: no sstrange/spaintkit/
  // seffect[]/sbotkiller/sfestivized/saustralium at all, not even their
  // usual "off" sentinel - just squality[], skillstreak, and sterm.
  if (filters.quality === "Collector's") {
    const params = new URLSearchParams();
    params.append("squality[]", String(QUALITY_ID_BY_NAME["Collector's"]));
    params.set("skillstreak", "0");
    params.set("sterm", filters.itemName);
    return `https://marketplace.tf/browse/tf2?${params.toString()}`;
  }

  // Generic branch - covers Unusual, target-item tools (Strangifier/
  // Strangifier Chemistry Set), and every plain item. A Taunt's raw name
  // keeps its "Taunt: " prefix, which
  // marketplace.tf wants split into its own stype filter instead of kept as
  // literal sterm text (see buildMarketplaceHref's own isTaunt handling).
  const isTaunt = /^Taunt:\s*/i.test(filters.itemName);
  const params = new URLSearchParams();
  params.append("squality[]", String(QUALITY_ID_BY_NAME[filters.quality] ?? QUALITY_ID_BY_NAME.Unique));
  if (isTaunt) params.set("stype", "Special Taunt");
  params.set("sstrange", filters.quality === "Strange" ? "1" : "0");
  params.set("scraftable", filters.isNonCraftable ? "0" : "1");
  // A Killstreak weapon's tier (stripKillstreakWeaponPrefix), 1/2/3.
  params.set("skillstreak", String(filters.killstreakTier ?? 0));
  // Same "sks[]"/"ske[]" param names scrap.tf/itemLinks/links.js already
  // confirmed live for this exact Sheen/Killstreaker filter pair.
  if (filters.sheenId) params.append("sks[]", String(filters.sheenId));
  if (filters.killstreakerId) params.append("ske[]", String(filters.killstreakerId));
  params.set("spaintkit", "-2");
  params.append("seffect[]", filters.effectId ? String(filters.effectId) : "-2");
  // Confirmed live (scrap.tf/itemLinks/links.js's own buildMarketplaceHref):
  // sbotkiller is just "{grade}_{roman numeral tier}" taken straight from a
  // Botkiller weapon's own name (resolveClassifiedsFilters' own botkillerSlug),
  // "none" otherwise.
  params.set("sbotkiller", filters.botkillerSlug ?? "none");
  // marketplace.tf's own spell slug (MARKETPLACE_SPELL_SLUGS - a third,
  // independent id scheme from SPELL_IDS/classic's literal name), same
  // "only sent when present, no 'off' sentinel" convention scrap.tf/itemLinks/
  // links.js's own buildMarketplaceHref already confirmed live.
  //
  // Deliberately withheld for an Unusual here specifically (not earlier, in
  // resolveClassifiedsFilters' own Unusual branch, unlike classicPaintId -
  // spellId/spellName ARE still needed there for next.backpack.tf's own
  // classifieds "spell" param, which scrap.tf's own confirmed-live
  // buildNextClassifiedsHref does NOT exclude for Unusual, only marketplace.tf
  // does per this extension's own choice): filtering by a specific Halloween
  // Spell on top of an Unusual's own effect search would cut wanted results,
  // same reasoning as spaint[]'s own exclusion below.
  const isUnusual = filters.quality === "Unusual";
  const spellSlug = !isUnusual && filters.spellName ? MARKETPLACE_SPELL_SLUGS[filters.spellName] : null;
  if (spellSlug) params.set("sspell", spellSlug);
  params.set("sfestivized", filters.isFestivized ? "1" : "0");
  // Confirmed live (scrap.tf/itemLinks/links.js's own buildMarketplaceHref):
  // classicPaintId is the color's decimal RGB value, array-bracketed like
  // squality[]/seffect[]; omitted entirely (not even a "none"/off sentinel)
  // when there's no paint. Never set for the Unusual branch above - see
  // classicPaintId's own note at the top of resolveClassifiedsFilters.
  if (filters.classicPaintId) params.append("spaint[]", String(filters.classicPaintId));
  params.set("saustralium", filters.isAustralium ? "1" : "0");
  // A Botkiller weapon searches by its bare weapon name (e.g. "Sniper
  // Rifle"), not the full "{Grade} Botkiller {Weapon} Mk.{Tier}"
  // filters.itemName would otherwise use - the sbotkiller filter above
  // already conveys the grade/tier, matching how every other tool variant
  // here (Kit/Fabricator/Taunt) searches by its bare target name instead of
  // its own full name. Confirmed live via scrap.tf/itemLinks/links.js's own
  // buildMarketplaceHref.
  //
  // marketplace.tf's own sterm wants the FULL combined name back, unlike a
  // Botkiller/Taunt (which search their own bare target name specifically) -
  // same shape mannco.store's own confirmed-live search already established
  // (see buildTargetToolFullName's own note). Unlike backpack.tf's own
  // classifieds, which needs the SPLIT fields
  // (itemName=Strangifier&targetItem=...) since that's its own dedicated
  // filter param, marketplace.tf has no such param at all and just wants a
  // normal search term, which for a target-item tool IS its own real,
  // literal Valve item name. See #82.
  params.set(
    "sterm",
    filters.targetItemName
      ? buildTargetToolFullName(filters.itemName, filters.targetItemName)
      : filters.isBotkiller
        ? filters.botkillerWeaponName
        : isTaunt
          ? filters.itemName.replace(/^Taunt:\s*/i, "")
          : filters.itemName
  );
  return `https://marketplace.tf/browse/tf2?${params.toString()}`;
}

// --- posts.tf link builder ----------------------------------------------

/*
@description: Whether buildPostsTfLink handles this item type at all: not a
War Paint tool, Decorated Weapon, Kit Fabricator, Killstreak Kit, or
Strangifier Chemistry Set (a target tool whose base name is not
"Strangifier").
*/
function postsTfSupportsItemType(filters) {
  const isChemistrySet = filters.targetItemName && filters.itemName !== "Strangifier";
  return !(filters.warPaintTool || filters.decoratedWeapon || filters.fabricatorKit || filters.killstreakKit || isChemistrySet);
}

/**
 * Builds a posts.tf item-search URL from resolveClassifiedsFilters' output.
 *
 * posts.tf's search page reads its filters off a "q" query param:
 * base64(JSON.stringify({u, p, d, m})) with the trailing "=" padding
 * stripped - confirmed live by decoding several real posts.tf search URLs
 * and comparing them against that same search's own POST
 * /api/posts/search request body. Only the four TOP-LEVEL keys are
 * abbreviated (u=userItems, p=partnerItems, d=description,
 * m=matchAllItems) - every key INSIDE each userItems entry keeps its full,
 * unabbreviated name.
 *
 * Confirmed-live per-item keys: defindex (number), quality (number, the
 * standard Valve quality id), craftable (boolean), australium (boolean,
 * optional), paint (string - the plain paint NAME, unlike every other site
 * here which wants an id/color), effect (number - the same Valve particle id
 * every other site here already uses), killstreak (number, 1/2/3 tier -
 * applies to the SAME defindex as the base weapon, confirmed live: a
 * Professional Killstreak Rocket Launcher's own defindex here is 205, the
 * plain Rocket Launcher's, not a separate "Killstreak" catalog entry),
 * spells (an ARRAY of plain spell name strings - a real item can carry more
 * than one Halloween Spell at once). posts.tf's own search FORM (confirmed
 * live via a screenshot) has no Sheen/Killstreaker/Festivized filter fields
 * at all.
 *
 * The schema lookup always uses the bare weapon name (filters.itemName,
 * already stripped of "Australium "): an Australium weapon shares its stock
 * version's defindex.
 *
 * Returns null for Kits/Fabricators/War Paint tools/Decorated Weapons
 * (skins) - not built yet, same "not built yet" scope gap
 * buildMannStoreHref documents for a similar set of item types (see
 * scrap.tf/itemLinks/links.js); extend later if needed.
 *
 * A plain Strangifier resolves like any plain item, as a generic (not
 * target-filtered) "any Strangifier" search. A Strangifier Chemistry Set is
 * excluded: each may be its own schema item per target, so it returns null
 * rather than guessing.
 *
 * Also returns null when the item's defindex can't be resolved at all (no
 * Steam Web API key configured, or a genuine schema miss) - same failure
 * mode/cause as every other schema-backed lookup in this codebase.
 *
 * @param {Awaited<ReturnType<typeof resolveClassifiedsFilters>>} filters
 * @returns {Promise<?string>}
 * See #1.
 * See #2.
 */
async function buildPostsTfLink(filters) {
  if (!postsTfSupportsItemType(filters)) return null;

  const defindex = await getItemDefindex(filters.itemName);
  if (defindex == null) return null;

  const item = {
    defindex,
    quality: QUALITY_ID_BY_NAME[filters.quality] ?? QUALITY_ID_BY_NAME.Unique,
    craftable: !filters.isNonCraftable,
  };
  if (filters.isAustralium) item.australium = true;
  if (filters.effectId) item.effect = filters.effectId;
  if (filters.killstreakTier) item.killstreak = filters.killstreakTier;
  if (filters.paintName) item.paint = filters.paintName;
  if (filters.spellName) item.spells = [filters.spellName];

  const payload = { u: [item], p: [], d: "", m: false };
  const base64 = base64EncodeUtf8(JSON.stringify(payload)).replace(/=+$/, "");
  return `https://posts.tf/posts/search/results?q=${encodeURIComponent(base64)}`;
}

// --- Public API --------------------------------------------------------

/**
 * Resolves everything a "link out to backpack.tf/marketplace.tf" UI needs for
 * a given item display name, in one call: dispatches on item type (War Paint
 * tool / Decorated Weapon / Unusual / Fabricator / Killstreak Kit / target
 * tool / plain item), since each type has its own stats-link URL shape.
 *
 * classifiedsFilters is included in the return (not just consumed
 * internally) because createSteamMarketLink needs it too, and building the
 * Steam Market link is a separate, optional step callers may or may not want
 * (e.g. steamcommunity.com's own feature has no use for a link back to the
 * page it's already on).
 *
 * @param {string} itemName - full display name, quality prefix intact
 * @param {{knownEffectName: ?string, knownEffectId: ?number, knownSheenName: ?string, knownKillstreakerName: ?string, knownSpellName: ?string, knownKillstreakTier: ?number, knownPaintName: ?string, allowSkinWithoutWearTier: boolean}} [options] -
 * knownEffectName: see resolveUnusualEffect's own note - pass this when the
 * caller's page already labels the exact Unusual effect somewhere separate
 * from the item name itself. steamcommunity.com's Market listing page does
 * ("★ Unusual Effect: X" next to the listing); so does stntrading.eu's own
 * item page (confirmed live, same label text - see
 * stntrading.eu/link2Backpack/content.js's own findKnownUnusualEffectName,
 * added specifically so an Unusual doesn't need a Steam Web API key at all
 * just to know a name that's already printed right there on the page - only
 * the numeric effect id, needed for an exact effect-filtered URL, still
 * needs the schema). knownEffectId: see
 * resolveUnusualEffect's own note - pass this instead (knownEffectName can
 * still be passed alongside it, just for display/fallback purposes) when the
 * caller's page already has the exact numeric particle id, bypassing the
 * schema-backed name->id lookup (and its "no Steam Web API key configured"
 * failure mode) entirely - e.g. classic backpack.tf's item hover popover
 * and /stats page do. knownSheenName/
 * knownKillstreakerName/knownSpellName: same idea, for a caller that
 * separately labels a specific listing/item's own Sheen/Killstreaker/
 * Halloween Spell (see resolveClassifiedsFilters' own note) - currently
 * steamcommunity.com's Market listing detail modal (Sheen/Killstreaker) and
 * itemQuickLinks (all three) do. knownKillstreakTier: a Decorated Weapon's
 * Killstreak tier (1/2/3) has no name-text signal to parse the way a plain
 * weapon's does (see decoratedWeapon's own killstreakTier note) - only
 * matters for the decoratedWeapon branch, silently ignored by every other
 * item type. knownPaintName: a plain cosmetic's Paint name - never applied
 * for an Unusual/Kit/Fabricator/skinned weapon (see classicPaintId's own note
 * in resolveClassifiedsFilters), only the generic (plain item) branch.
 * allowSkinWithoutWearTier: opt-in (default false) - lets matchDecoratedWeapon
 * recognize a Decorated Weapon with no "(Wear Tier)" suffix in itemName at
 * all (see that function's own header note on why this is opt-in, not the
 * default). Only steamcommunity.com/itemQuickLinks/content.js passes true,
 * and only for a non-marketable item (see its own isMarketable note) - a
 * Decorated Weapon's on-page title never carries a wear tier, unlike its
 * Community Market market_hash_name.
 * @returns {Promise<{
 *   bpStatsHref: ?string,
 *   nextBpStatsHref: ?string,
 *   classifiedsHref: ?string,
 *   nextClassifiedsHref: ?string,
 *   statsUnresolved: boolean,
 *   classifiedsFilters: Awaited<ReturnType<typeof resolveClassifiedsFilters>>,
 *   marketplaceHref: ?string,
 *   postsTfHref: ?string,
 * }>}
 */
export async function resolveStatsAndClassifieds(
  itemName,
  {
    knownEffectName = null,
    knownEffectId = null,
    knownSheenName = null,
    knownKillstreakerName = null,
    knownSpellName = null,
    knownKillstreakTier = null,
    knownPaintName = null,
    allowSkinWithoutWearTier = false,
  } = {}
) {
  itemName = stripStarMarker(itemName);
  const targetTool = matchTargetItemTool(itemName);
  const killstreakKit = matchKillstreakKit(itemName);
  const fabricatorKit = matchFabricatorKit(itemName);
  const warPaintTool = matchWarPaintTool(itemName);
  // Only attempted when it's not already a War Paint tool (matchDecoratedWeapon
  // would just bail on those anyway - see its own "War Paint$" guard) - skips
  // the async skin-name-prefix lookup entirely for the common case.
  // allowSkinWithoutWearTier is opt-in because it makes every plain item hit
  // the async warpaints.json lookup (see matchDecoratedWeapon).
  const decoratedWeapon = warPaintTool ? null : await matchDecoratedWeapon(itemName, { requireWearTier: !allowSkinWithoutWearTier });
  const isUnusual = itemName.includes("Unusual");

  let bpStatsHref = "";
  let nextBpStatsHref = "";
  // True only when a schema-backed lookup (Unusual effect id, or a Kit's/
  // Strangifier's target weapon defindex) was actually attempted and came
  // back empty - never set for the plain createBpStatsLink path below, which
  // needs no schema lookup and can't fail this way. Almost always means no
  // Steam Web API key is configured (see resolveUnusualEffect/
  // createBpStatsLinkKillstreakKit/createBpStatsLinkTargetTool's own console
  // warnings) - a stale/rare schema gap is possible but not worth a separate
  // message for.
  let statsUnresolved = false;

  // warPaintTool/decoratedWeapon are checked before isUnusual: an Unusual
  // Decorated Weapon's market_hash_name also contains "Unusual" (same
  // ordering as resolveClassifiedsFilters). See #83.
  if (warPaintTool) {
    bpStatsHref = await createBpStatsLinkWarPaintTool(warPaintTool, false);
    nextBpStatsHref = await createBpStatsLinkWarPaintTool(warPaintTool, true);
  } else if (decoratedWeapon) {
    bpStatsHref = await createBpStatsLinkDecoratedWeapon(decoratedWeapon, false);
    nextBpStatsHref = await createBpStatsLinkDecoratedWeapon(decoratedWeapon, true);
  } else if (isUnusual) {
    bpStatsHref = await createBpStatsLinkUnusual(itemName, false, knownEffectName, knownEffectId);
    nextBpStatsHref = await createBpStatsLinkUnusual(itemName, true, knownEffectName, knownEffectId);
    statsUnresolved = !bpStatsHref && !nextBpStatsHref;
  } else if (fabricatorKit) {
    bpStatsHref = await createBpStatsLinkFabricatorKit(fabricatorKit, false);
    nextBpStatsHref = await createBpStatsLinkFabricatorKit(fabricatorKit, true);
    statsUnresolved = !bpStatsHref && !nextBpStatsHref;
  } else if (killstreakKit) {
    bpStatsHref = await createBpStatsLinkKillstreakKit(killstreakKit, false);
    nextBpStatsHref = await createBpStatsLinkKillstreakKit(killstreakKit, true);
    statsUnresolved = !bpStatsHref && !nextBpStatsHref;
  } else if (targetTool) {
    bpStatsHref = await createBpStatsLinkTargetTool(targetTool, false);
    nextBpStatsHref = await createBpStatsLinkTargetTool(targetTool, true);
    statsUnresolved = !bpStatsHref && !nextBpStatsHref;
  } else {
    bpStatsHref = createBpStatsLink(itemName, false);
    nextBpStatsHref = createBpStatsLink(itemName, true);
  }

  // Classifieds icons paired with each stats button - shares the same
  // quality/craftability/Australium parsing the stats links above already
  // did (Unusual's effect id in particular is expensive to resolve, needing
  // its own schema fetch), so it's only computed once here rather than once
  // per site.
  const classifiedsFilters = await resolveClassifiedsFilters(itemName, {
    knownEffectName,
    knownEffectId,
    knownSheenName,
    knownKillstreakerName,
    knownSpellName,
    knownKillstreakTier,
    knownPaintName,
    allowSkinWithoutWearTier,
  });
  const classifiedsHref = classifiedsFilters ? buildClassifiedsLink(classifiedsFilters, false) : null;
  const nextClassifiedsHref = classifiedsFilters ? buildClassifiedsLink(classifiedsFilters, true) : null;
  const marketplaceHref = classifiedsFilters ? buildMarketplaceLink(classifiedsFilters) : null;
  const postsTfHref = classifiedsFilters ? await buildPostsTfLink(classifiedsFilters) : null;

  return {
    bpStatsHref,
    nextBpStatsHref,
    classifiedsHref,
    nextClassifiedsHref,
    statsUnresolved,
    classifiedsFilters,
    marketplaceHref,
    postsTfHref,
  };
}

/**
 * Whether an Unusual's effect NAME is known (see resolveUnusualEffect's own
 * no-schema fallback) but its numeric effect ID isn't - meaning bp.tf/
 * next.bp.tf's own stats/classifieds links, which both need the exact id to
 * point at the SPECIFIC effect this item has, would otherwise show a
 * generic/wrong result instead (classic backpack.tf's classifieds search
 * mixes every effect together, next.backpack.tf's own shows none at all -
 * see buildClassifiedsLink's own "particle=none" note - and the stats page
 * URL just skips the effect path segment). Callers that want to hide those
 * two links until a real Steam Web API key resolves the id - rather than
 * showing a link to the wrong page - check this; pricedb.io/mannco.store/
 * marketplace.tf stay genuinely useful off just the name (a plain search
 * term, not a hard filter), so they're never gated by this.
 *
 * @param {?Awaited<ReturnType<typeof resolveClassifiedsFilters>>} classifiedsFilters
 * @returns {boolean}
 */
export function isUnusualEffectIdUnresolved(classifiedsFilters) {
  // effectName is checked too: an Unusual that genuinely has no effect (e.g.
  // "Unusual Horseless Headless Horsemann's Headtaker", see
  // resolveUnusualEffect) resolves with both null, and its plain Unusual
  // stats/classifieds links are the correct ones, not a placeholder.
  return classifiedsFilters?.quality === "Unusual" && classifiedsFilters.effectId == null && classifiedsFilters.effectName != null;
}

/**
 * Whether posts.tf's link should have resolved for this item but did not:
 * the item type is supported (postsTfSupportsItemType) and the rest of the
 * resolution succeeded, so the only remaining cause is buildPostsTfLink's
 * getItemDefindex lookup failing, almost always for lack of a Steam Web API
 * key (unlike the name-based backpack.tf links, which need no schema for a
 * plain item). Used by utils/linkButtonStates.js's postsTfNeedsApiKey and
 * stntrading.eu/link2Backpack to decide whether to show the API-key hint.
 *
 * @param {?Awaited<ReturnType<typeof resolveClassifiedsFilters>>} classifiedsFilters
 * @param {?string} postsTfHref
 * @returns {boolean}
 */
export function isPostsTfUnresolved(classifiedsFilters, postsTfHref) {
  return !!classifiedsFilters && !postsTfHref && postsTfSupportsItemType(classifiedsFilters);
}
