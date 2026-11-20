/*
@description: Standalone War Paint tool item type handling (see index.js for
this folder's overview).
*/

import { QUALITY_ID_BY_NAME } from "../tf2Quality.js";
import { WEAR_TIER_IDS } from "../warpaints.js";
import { stripCraftabilityAndArticle, baseBpUrl } from "./common.js";

/**
 * Detect whether an item is a standalone War Paint tool (e.g. "Strange
 * Swashbuckled War Paint (Factory New)" or "Misfortunate War Paint (Factory
 * New)") - a skin not yet applied to a weapon, unlike a Decorated Weapon
 * (a weapon already wearing one, see decoratedWeapon.js). It comes in two
 * Valve qualities: a default one (id 15, backpack.tf calls it "Decorated
 * Weapon") and a Strange-tracking variant (id 11, same id Strange weapons
 * use) - the "Strange " prefix here is a genuine quality word, not a
 * literal-name false positive like LITERAL_NAME_QUALITY_EXCEPTIONS guards
 * against elsewhere.
 *
 * @param {string} itemNameRaw
 * @returns {{skinName: string, wearTier: string, isStrange: boolean, isNonCraftable: boolean} | null}
 */
export function matchWarPaintTool(itemNameRaw) {
  const { name, isNonCraftable } = stripCraftabilityAndArticle(itemNameRaw);

  const match = /^(Strange )?(.+) War Paint \((.+)\)$/i.exec(name);
  if (!match) return null;

  return {
    skinName: match[2].trim(),
    wearTier: match[3].trim(),
    isStrange: !!match[1],
    isNonCraftable,
  };
}

/**
 * Build a backpack.tf stats URL for a standalone War Paint tool (same shapes
 * as scrap.tf/itemLinks/links.js, confirmed for both sites and both
 * qualities). No schema
 * lookup needed (unlike Kits/Strangifiers/Fabricators) - async only for a
 * consistent call signature with the other createBpStatsLinkX functions.
 *
 * - backpack.tf (path-based): /stats/{Decorated Weapon|Strange}/{skin} |
 *   War Paint ({wear})/Tradable/{Craftable|Non-Craftable} - a literal " | "
 *   inserted before "War Paint" in the name.
 * - next.backpack.tf (query-string based): /stats?item=War Paint&
 *   quality={Decorated Weapon|Strange}&wearTier={wear}&texture={skin} -
 *   literal skin/wear NAMES, not the numeric ids the classifieds search uses.
 *
 * @param {{skinName: string, wearTier: string, isStrange: boolean, isNonCraftable: boolean}} match
 * @param {boolean} useNext - true → use next.backpack.tf, false → use backpack.tf
 * @returns {Promise<string>} URL
 */
export async function createBpStatsLinkWarPaintTool(match, useNext = false) {
  const quality = match.isStrange ? "Strange" : "Decorated Weapon";
  const craftability = match.isNonCraftable ? "Non-Craftable" : "Craftable";

  if (useNext) {
    const params = new URLSearchParams({
      item: "War Paint",
      quality,
      wearTier: match.wearTier,
      texture: match.skinName,
    });
    return `https://next.backpack.tf/stats?${params.toString()}`;
  }

  const statsName = `${match.skinName} | War Paint (${match.wearTier})`;
  // Confirmed live (via the same Decorated Weapon shape in decoratedWeapon.js):
  // the quality path segment is percent-encoded too, not left as a literal
  // space - "Decorated%20Weapon", not "Decorated Weapon".
  return `${baseBpUrl}/${encodeURIComponent(quality)}/${encodeURIComponent(statsName)}/Tradable/${craftability}`;
}

/**
 * Build a classifieds search URL for a standalone War Paint tool (same
 * confirmed shapes as scrap.tf/itemLinks/links.js). textureId is resolved ahead
 * of time by index.js's resolveClassifiedsFilters (getTextureId is async;
 * this function, like buildClassifiedsLink itself, stays synchronous) and
 * may be null if this skin isn't in the bundled warpaints.json -
 * next.backpack.tf's numeric texture is simply omitted in that case rather
 * than sent empty (classic's texture_name is the plain skin name, so it is
 * always sent).
 *
 * - backpack.tf: item=War Paint&quality={15|11}&tradable=1&craftable=1&
 *   texture_name={skin}&wear={wear}&australium=-1&killstreak_tier=0 -
 *   literal texture/wear NAMES. craftable is hardcoded "1" - only ever
 *   confirmed live for a craftable example, so not made conditional on
 *   isNonCraftable without a confirmed non-craftable one.
 * - next.backpack.tf: itemName=War Paint&quality={15|11}&texture={id}&
 *   wearTier={id} - numeric ids, no tradable/craftable/australium at all.
 *
 * @param {{skinName: string, wearTier: string, isStrange: boolean, textureId: ?number}} warPaintTool
 * @param {boolean} useNext - true → next.backpack.tf, false → backpack.tf
 * @returns {string} URL
 */
export function buildWarPaintToolClassifiedsLink(warPaintTool, useNext) {
  const { skinName, wearTier, isStrange, textureId } = warPaintTool;
  const qualityId = String(QUALITY_ID_BY_NAME[isStrange ? "Strange" : "Decorated Weapon"]);

  if (useNext) {
    const params = new URLSearchParams({ itemName: "War Paint", quality: qualityId });
    if (textureId) params.set("texture", String(textureId));
    const wearTierId = WEAR_TIER_IDS[wearTier];
    if (wearTierId) params.set("wearTier", String(wearTierId));
    return `https://next.backpack.tf/classifieds?${params.toString()}`;
  }

  const params = new URLSearchParams({
    item: "War Paint",
    quality: qualityId,
    tradable: "1",
    craftable: "1",
    texture_name: skinName,
    wear: wearTier,
    australium: "-1",
    killstreak_tier: "0",
  });
  return `https://backpack.tf/classifieds?${params.toString()}`;
}
