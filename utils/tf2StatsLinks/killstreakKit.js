/*
@description: Killstreak Kit item type handling (see index.js for this
folder's overview).
*/

import { getItemDefindex } from "../tf2Schema.js";
import {
  stripCraftabilityAndArticle,
  KILLSTREAK_TIER_BY_WORD,
  baseBpUrl,
  buildClassicTargetClassifiedsLink,
  buildNextTargetClassifiedsLink,
} from "./common.js";

/**
 * Detect whether an item is a Killstreak Kit (e.g. "Specialized Killstreak
 * Machina Kit") and split it into its target weapon's name and tier.
 * Expects the real name with the literal word "Killstreak" (scrap.tf's raw
 * names drop it, see scrap.tf/itemLinks/toolVariants.js): an optional tier
 * word, "Killstreak ", the target weapon name, then " Kit".
 *
 * @param {string} itemNameRaw
 * @returns {{targetName: string, tier: number, isNonCraftable: boolean} | null}
 */
export function matchKillstreakKit(itemNameRaw) {
  const { name, isNonCraftable } = stripCraftabilityAndArticle(itemNameRaw);

  const match = /^(Professional |Specialized )?Killstreak (.+) Kit$/i.exec(name);
  if (!match) return null;

  const tier = KILLSTREAK_TIER_BY_WORD[match[1]?.trim()] ?? 1;
  const targetName = match[2].trim();

  return { targetName, tier, isNonCraftable };
}

/**
 * Build a backpack.tf stats URL for a Killstreak Kit, looking up the target
 * weapon's defindex from the TF2 schema. Kits use a completely different URL
 * shape than normal items, and the two sites differ from EACH OTHER too
 * (confirmed live; scrap.tf/itemLinks/links.js builds the same shapes):
 * - backpack.tf (path-based): /stats/Unique/Professional Killstreak Kit/
 *   Tradable/Non-Craftable/3-205 - tier-prefixed "Killstreak Kit" name, plus
 *   a "{tier}-{targetDefindex}" path suffix.
 * - next.backpack.tf (query-string based): /stats?item=Kit&quality=Unique&
 *   killstreakTier=3&craftable=false&priceindex=3-205 - generic "Kit" name,
 *   tier as its own param, "craftable=false" as literal text, and
 *   "priceindex" instead of a path suffix.
 * Both always non-craftable - the Kit item itself is always non-craftable,
 * regardless of the page's own craftable/non-craftable state.
 *
 * @param {{targetName: string, tier: number, isNonCraftable: boolean}} match
 * @param {boolean} useNext - true → use next.backpack.tf, false → use backpack.tf
 * @returns {Promise<string|null>} URL, or null if the target weapon's defindex couldn't be resolved
 */
export async function createBpStatsLinkKillstreakKit(match, useNext = false) {
  const defindex = await getItemDefindex(match.targetName);

  if (defindex == null) {
    console.log(
      `[TF2 Trading Enhancer] Could not resolve defindex for "${match.targetName}" (configure a Steam Web API key in the popup settings)`
    );
    return null;
  }

  const priceindex = `${match.tier}-${defindex}`;

  if (useNext) {
    const params = new URLSearchParams({
      item: "Kit",
      quality: "Unique",
      killstreakTier: String(match.tier),
      craftable: "false",
      priceindex,
    });
    return `https://next.backpack.tf/stats?${params.toString()}`;
  }

  const tierPrefix = { 3: "Professional ", 2: "Specialized " }[match.tier] ?? "";
  return `${baseBpUrl}/Unique/${encodeURIComponent(`${tierPrefix}Killstreak Kit`)}/Tradable/Non-Craftable/${priceindex}`;
}

/**
 * Build a classifieds search URL for a Killstreak Kit's TARGET weapon - a
 * completely different param shape than the generic case (confirmed live,
 * same as scrap.tf/itemLinks/links.js): classic
 * backpack.tf filters a normal item search down to "target" listings via
 * item_type=target (see common.js's buildClassicTargetClassifiedsLink), while
 * next.backpack.tf has a dedicated targetItem param instead. Neither one
 * searches for "Kit" itself as the item on classic backpack.tf, unlike the
 * stats link.
 *
 * A Kit has a fixed Sheen/Killstreaker (its modal labels them like a
 * Killstreak weapon's), so sheenId/killstreakerId (resolved by
 * resolveClassifiedsFilters from the caller's known names) filter the search
 * too.
 *
 * @param {{targetName: string, tier: number, sheenId: ?number, killstreakerId: ?number}} killstreakKit
 * @param {boolean} useNext - true → next.backpack.tf, false → backpack.tf
 * @returns {string} URL
 */
export function buildKillstreakKitClassifiedsLink(killstreakKit, useNext) {
  const { targetName, tier, sheenId, killstreakerId } = killstreakKit;

  if (useNext) {
    return buildNextTargetClassifiedsLink("Kit", targetName, tier, sheenId, killstreakerId);
  }

  // A Kit itself is always non-craftable, regardless of the page's own
  // craftable/non-craftable state - same reasoning as its stats link.
  return buildClassicTargetClassifiedsLink(targetName, tier, "-1", sheenId, killstreakerId);
}
