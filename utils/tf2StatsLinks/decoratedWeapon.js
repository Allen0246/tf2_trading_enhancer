/*
@description: Decorated Weapon (War Paint applied to a weapon) item type
handling (see index.js for this folder's overview).
*/

import { QUALITY_ID_BY_NAME } from "../tf2Quality.js";
import { WEAR_TIER_IDS, findSkinNamePrefix } from "../warpaints.js";
import { stripCraftabilityAndArticle, baseBpUrl, KILLSTREAK_TIER_BY_WORD } from "./common.js";

/**
 * Detect whether an item is a Decorated Weapon (a War Paint skin already
 * applied to a weapon, e.g. "Necromanced Black Box (Battle Scarred)") and
 * split it into skin name, weapon name, wear tier, and Strange-tracking
 * state.
 *
 * Works from name text alone (unlike scrap.tf/itemLinks/skinDetection.js,
 * which has the item's data-defindex), where skin and weapon are joined with
 * no separator ("{skin}{weapon}"): the longest known skin name
 * (findSkinNamePrefix, bundled warpaints.json) that prefixes the remaining
 * name is the skin. No schema/API lookup needed.
 *
 * @param {string} itemNameRaw
 * @param {{requireWearTier?: boolean}} [options] - requireWearTier (default
 * true) makes a name without a "(Wear Tier)" suffix (nearly every name) return
 * null immediately, without the async findSkinNamePrefix lookup. Only
 * steamcommunity.com/itemQuickLinks/content.js passes false, for a
 * non-marketable item (see the inline note below).
 * @returns {Promise<{skinName: string, weaponName: string, wearTier: ?string, isStrange: boolean, isUnusual: boolean, isFestivized: boolean, isNonCraftable: boolean, killstreakTier: number} | null>}
 */
export async function matchDecoratedWeapon(itemNameRaw, { requireWearTier = true } = {}) {
  const { name, isNonCraftable } = stripCraftabilityAndArticle(itemNameRaw);

  const wearSuffixMatch = new RegExp(`^(.+?)\\s*\\((${Object.keys(WEAR_TIER_IDS).join("|")})\\)\\s*$`).exec(name);
  // A non-marketable (untradeable) item has no Community Market link to
  // resolve a full market_hash_name from (see
  // steamcommunity.com/itemQuickLinks/content.js's own resolveRealItemName),
  // and Steam's own on-page item title never carries a Decorated Weapon's
  // wear tier at all either way (only the market_hash_name does), so a wear
  // suffix simply isn't always there to anchor on.
  //
  // So itemQuickLinks opts out of requireWearTier for a non-marketable item
  // whose recovered name (via the Collection checkmark marker, see
  // resolveRealItemName) is known to be "{skin}{weapon}" with no wear tier. See #18.
  if (!wearSuffixMatch && requireWearTier) return null;

  let preWearName = wearSuffixMatch ? wearSuffixMatch[1].trim() : name;
  const wearTier = wearSuffixMatch ? wearSuffixMatch[2].trim() : null;

  // A standalone War Paint tool also matches this "(Wear Tier)" suffix -
  // warPaintTool.js's matchWarPaintTool already owns that case (ends in the
  // literal word "War Paint"), so bail here rather than double-handle it.
  if (/\bWar Paint$/i.test(preWearName)) return null;

  const isStrange = /^Strange\s+/i.test(preWearName);
  if (isStrange) preWearName = preWearName.replace(/^Strange\s+/i, "").trim();

  // Steam's own text always uses the literal quality word "Unusual", same
  // as it does for every other quality. "Strange" directly ahead of it (if
  // present, stripped above) is just an add-on Strange-tracking descriptor
  // here, not this item's real persisted quality - Unusual is, which is why
  // isUnusual takes priority over isStrange in both builders below. See #100.
  const isUnusual = /^Unusual\s+/i.test(preWearName);
  if (isUnusual) preWearName = preWearName.replace(/^Unusual\s+/i, "").trim();

  // "Festivized " sits right after the quality word(s) and before
  // everything else in Valve's own naming order (same confirmed-live
  // position resolveClassifiedsFilters' own generic branch already
  // documents: "Strange Festivized Professional Killstreak Australium
  // Force-a-Nature"), stripped here the same as the Killstreak-tier/Unusual
  // words above. See #101.
  const isFestivized = /^Festivized\s+/i.test(preWearName);
  if (isFestivized) preWearName = preWearName.replace(/^Festivized\s+/i, "").trim();

  // A market_hash_name (e.g. "Strange Professional Killstreak Dead Reckoner
  // Revolver (Factory New)") can carry a Killstreak tier between quality and
  // skin, and findSkinNamePrefix needs the skin at the front. The tier is
  // returned too (0 when the name has none); resolveClassifiedsFilters still
  // prefers a caller's own knownKillstreakTier over it, since an on-page
  // title (unlike a market_hash_name) may leave the tier out. See #102.
  const killstreakMatch = /^(Professional |Specialized )?Killstreak\s+/i.exec(preWearName);
  const killstreakTier = killstreakMatch ? KILLSTREAK_TIER_BY_WORD[killstreakMatch[1]?.trim()] ?? 1 : 0;
  if (killstreakMatch) preWearName = preWearName.slice(killstreakMatch[0].length).trim();

  const skinName = await findSkinNamePrefix(preWearName);
  if (!skinName) return null;

  const weaponName = preWearName.slice(skinName.length).trim();
  if (!weaponName) return null;

  return { skinName, weaponName, wearTier, isStrange, isUnusual, isFestivized, isNonCraftable, killstreakTier };
}

/**
 * Build a backpack.tf stats URL for a Decorated Weapon. Confirmed live -
 * quality follows a DIFFERENT convention per site than a standalone War
 * Paint tool does (warPaintTool.js's createBpStatsLinkWarPaintTool): classic
 * still uses the literal quality NAME ("Decorated Weapon"/"Strange"), same as
 * the tool, but next.backpack.tf uses the NUMERIC quality id (15) for the
 * default variant instead of the literal text "Decorated Weapon" - only the
 * Strange variant still uses literal "Strange" text there.
 *
 * - backpack.tf: /stats/{Decorated Weapon|Strange}/{skin} | {weapon}
 *   ({wear})/Tradable/{Craftable|Non-Craftable} - same " | " insertion as
 *   the War Paint tool's own classic link, just with the resolved weapon
 *   name instead of the literal word "War Paint".
 * - next.backpack.tf: /stats?item={weapon}&quality={15|Strange}&
 *   wearTier={wear}&texture={skin}.
 *
 * @param {{skinName: string, weaponName: string, wearTier: string, isStrange: boolean, isUnusual: boolean, isNonCraftable: boolean}} match
 * @param {boolean} useNext - true → use next.backpack.tf, false → use backpack.tf
 * @returns {Promise<string>} URL
 */
export async function createBpStatsLinkDecoratedWeapon(match, useNext = false) {
  const craftability = match.isNonCraftable ? "Non-Craftable" : "Craftable";
  // isUnusual takes priority over isStrange - see matchDecoratedWeapon's own
  // note on why a "Strange Unusual ..." Decorated Weapon's real persisted
  // quality is Unusual, with Strange as just an add-on tracking descriptor.
  // NOT independently confirmed live for the stats page specifically (only
  // the classifieds page was) - treated the same way "Strange" already is
  // here since it's the same underlying pattern (a real, non-default quality
  // taking the literal-text branch instead of the numeric "Decorated
  // Weapon" default).
  const qualityName = match.isUnusual ? "Unusual" : match.isStrange ? "Strange" : "Decorated Weapon";

  if (useNext) {
    const quality = match.isUnusual || match.isStrange ? qualityName : String(QUALITY_ID_BY_NAME["Decorated Weapon"]);
    const params = new URLSearchParams({
      item: match.weaponName,
      quality,
      texture: match.skinName,
    });
    // Omitted rather than sent as the literal string "null" - see
    // matchDecoratedWeapon's own note on why wearTier can be missing (a
    // non-marketable item's on-page title has no wear text to recover it
    // from at all).
    if (match.wearTier) params.set("wearTier", match.wearTier);
    return `https://next.backpack.tf/stats?${params.toString()}`;
  }

  const statsName = match.wearTier ? `${match.skinName} | ${match.weaponName} (${match.wearTier})` : `${match.skinName} | ${match.weaponName}`;
  return `${baseBpUrl}/${encodeURIComponent(qualityName)}/${encodeURIComponent(statsName)}/Tradable/${craftability}`;
}

/**
 * Build a classifieds search URL for a Decorated Weapon. Confirmed live:
 * unlike the stats link, both sites use the NUMERIC quality id here (15 or
 * 11 for Strange) - same numeric-everywhere convention the War Paint tool's
 * own classifieds links already use. textureId is resolved ahead of time by
 * index.js's resolveClassifiedsFilters, same reasoning as the War Paint tool
 * case.
 *
 * - backpack.tf: item={weapon}&quality={15|11}&tradable=1&craftable=1&
 *   australium=-1&texture={id}&wear={id}&texture_name={skin}&
 *   wear_tier={id} - texture/wear given BOTH as numeric ids AND (texture_name)
 *   a literal skin name; wear_tier duplicates wear's numeric value under a
 *   second key. Unusual, but that's what was confirmed live, so replicated
 *   as-is rather than "cleaned up".
 * - next.backpack.tf: itemName={weapon}&quality={15|11}&tradable=1&
 *   craftable=1&texture={id}&wearTier={id}, plus festivized and an explicit
 *   australium=0 (Decorated Weapons have no Australium variant).
 * craftable is hardcoded "1" on both, same caveat as the War Paint tool
 * case: only ever confirmed live for a craftable example.
 *
 * killstreak_tier/killstreakTier, sheen/killstreaker, and particle are also
 * included (using the same param names/conventions confirmed live in
 * index.js's buildClassifiedsLink for a plain Killstreak/Unusual weapon's
 * own classifieds search) whenever match carries a real value for them - NOT independently
 * confirmed live for a Decorated Weapon specifically, unlike everything
 * above; see this function's own body comment.
 *
 * @param {{skinName: string, weaponName: string, wearTier: string, isStrange: boolean, isUnusual: boolean, isFestivized: boolean, textureId: ?number, killstreakTier: ?number, sheenId: ?number, killstreakerId: ?number, effectId: ?number}} match
 * @param {boolean} useNext - true → next.backpack.tf, false → backpack.tf
 * @returns {string} URL
 */
export function buildDecoratedWeaponClassifiedsLink(match, useNext) {
  const { skinName, weaponName, wearTier, isStrange, isUnusual, isFestivized, textureId, killstreakTier, sheenId, killstreakerId, effectId } = match;
  // isUnusual takes priority over isStrange - see matchDecoratedWeapon's own
  // note (confirmed live: "Strange Unusual Professional Killstreak Star
  // Crossed Iron Bomber" is genuinely Unusual-quality, with "Strange" just
  // an add-on tracking descriptor, not this item's real quality).
  const qualityId = String(QUALITY_ID_BY_NAME[isUnusual ? "Unusual" : isStrange ? "Strange" : "Decorated Weapon"]);
  const wearTierId = WEAR_TIER_IDS[wearTier];

  // killstreak tier, sheen, killstreaker and particle use the param names
  // confirmed for a plain Killstreak weapon's classifieds search; they are
  // not confirmed for Decorated Weapons specifically, but an unsupported
  // param is ignored rather than breaking the search.
  if (useNext) {
    const params = new URLSearchParams({ itemName: weaponName, quality: qualityId, tradable: "1", craftable: "1" });
    if (textureId) params.set("texture", String(textureId));
    if (wearTierId) params.set("wearTier", String(wearTierId));
    params.set("killstreakTier", String(killstreakTier ?? 0));
    if (sheenId) params.set("sheen", String(sheenId));
    if (killstreakerId) params.set("killstreaker", String(killstreakerId));
    params.set("particle", effectId ? String(effectId) : "none");
    // Decorated Weapons can be Festivized but have no Australium variant.
    params.set("festivized", isFestivized ? "1" : "0");
    params.set("australium", "0");
    return `https://next.backpack.tf/classifieds?${params.toString()}`;
  }

  const params = new URLSearchParams({
    item: weaponName,
    quality: qualityId,
    tradable: "1",
    craftable: "1",
    australium: "-1",
    killstreak_tier: String(killstreakTier ?? 0),
  });
  if (textureId) params.set("texture", String(textureId));
  if (wearTierId) params.set("wear", String(wearTierId));
  params.set("texture_name", skinName);
  if (wearTierId) params.set("wear_tier", String(wearTierId));
  if (sheenId) params.set("sheen", String(sheenId));
  if (killstreakerId) params.set("killstreaker", String(killstreakerId));
  if (effectId) params.set("particle", String(effectId));
  return `https://backpack.tf/classifieds?${params.toString()}`;
}
