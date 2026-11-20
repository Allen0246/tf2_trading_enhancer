/*
@description: Killstreak Kit Fabricator item type handling (see index.js for
this folder's overview).
*/

import { getItemDefindex } from "../tf2Schema.js";
import {
  stripCraftabilityAndArticle,
  KILLSTREAK_TIER_BY_WORD,
  baseBpUrl,
  baseNextBpUrl,
  buildClassicTargetClassifiedsLink,
  buildNextTargetClassifiedsLink,
} from "./common.js";

/**
 * Detect whether an item is a Killstreak Kit Fabricator (e.g. "Professional
 * Killstreak Rocket Launcher Kit Fabricator") - the crafting tool that
 * PRODUCES a Kit, not the Kit itself - and split it into its target weapon's
 * name and tier. Same shape/parsing as matchKillstreakKit (killstreakKit.js),
 * just matching the "Kit Fabricator" suffix instead of "Kit" alone (no
 * overlap between the two: this regex requires " Fabricator" at the end,
 * which matchKillstreakKit's own `$`-anchored " Kit" ending never matches).
 *
 * A Fabricator's own stats priceindex encodes its tier as a fixed per-tier
 * prefix, NOT the tier number itself the way a Kit's priceindex does -
 * confirmed live: every Professional Fabricator uses a "6526-6" prefix and
 * every Specialized one uses "6523-6", regardless of target weapon (see
 * FABRICATOR_PRICEINDEX_PREFIX_BY_TIER below). Basic tier is unconfirmed -
 * TF2 may not even have a standalone "Killstreak Kit Fabricator" (no tier
 * word) as its own catalog item the way Kits do.
 *
 * @param {string} itemNameRaw
 * @returns {{targetName: string, tier: number, isNonCraftable: boolean} | null}
 */
export function matchFabricatorKit(itemNameRaw) {
  const { name, isNonCraftable } = stripCraftabilityAndArticle(itemNameRaw);

  const match = /^(Professional |Specialized )?Killstreak (.+) Kit Fabricator$/i.exec(name);
  if (!match) return null;

  const tier = KILLSTREAK_TIER_BY_WORD[match[1]?.trim()] ?? 1;
  const targetName = match[2].trim();

  return { targetName, tier, isNonCraftable };
}

// Fixed stats priceindex prefix per Fabricator tier, confirmed for
// Professional (3) and Specialized (2) regardless of target weapon. No Basic
// (1) entry: it is unconfirmed whether a tier-less Fabricator exists, so
// callers return no stats link rather than guess. Also used by
// scrap.tf/itemLinks/itemShape.js.
export const FABRICATOR_PRICEINDEX_PREFIX_BY_TIER = { 3: "6526-6", 2: "6523-6" };

/**
 * Build a backpack.tf stats URL for a Killstreak Kit Fabricator, looking up
 * the target weapon's defindex from the TF2 schema - same approach as
 * targetTool.js's createBpStatsLinkTargetTool (one path-style URL reused for
 * both sites, relying on next.backpack.tf's own routing to canonicalize it
 * into its query-string form). Unlike a Kit, a Fabricator keeps its own real
 * craftable/non-craftable state rather than being forced non-craftable -
 * confirmed live: a craftable Fabricator's link uses .../Tradable/Craftable/....
 *
 * @param {{targetName: string, tier: number, isNonCraftable: boolean}} match
 * @param {boolean} useNext - true → use next.backpack.tf, false → use backpack.tf
 * @returns {Promise<string|null>} URL, or null if the target weapon's defindex
 * couldn't be resolved, or this tier has no confirmed priceindex prefix
 */
export async function createBpStatsLinkFabricatorKit(match, useNext = false) {
  const priceindexPrefix = FABRICATOR_PRICEINDEX_PREFIX_BY_TIER[match.tier];
  if (!priceindexPrefix) {
    console.log(`[TF2 Trading Enhancer] No confirmed stats priceindex prefix for tier ${match.tier} Fabricators`);
    return null;
  }

  const defindex = await getItemDefindex(match.targetName);

  if (defindex == null) {
    console.log(
      `[TF2 Trading Enhancer] Could not resolve defindex for "${match.targetName}" (configure a Steam Web API key in the popup settings)`
    );
    return null;
  }

  const base = useNext ? baseNextBpUrl : baseBpUrl;
  const craftability = match.isNonCraftable ? "Non-Craftable" : "Craftable";
  const priceindex = `${priceindexPrefix}-${defindex}`;

  return `${base}/Unique/Fabricator/Tradable/${craftability}/${priceindex}`;
}

/**
 * Build a classifieds search URL for a Killstreak Kit Fabricator. Confirmed
 * live: classic backpack.tf's link is IDENTICAL in shape to a Kit's own
 * (item=<target weapon>, item_type=target, killstreak_tier, tradable/
 * craftable/australium all included - see common.js's
 * buildClassicTargetClassifiedsLink), except craftable reflects the
 * Fabricator's own real state instead of being forced non-craftable.
 * next.backpack.tf instead searches by itemName="Fabricator" + a dedicated
 * targetItem param + killstreakTier, with NO tradable/craftable/australium at
 * all - the same shape a Kit's own next.backpack.tf link uses
 * (itemName="Kit" + targetItem + killstreakTier), just with "Fabricator" as
 * the itemName instead of "Kit".
 *
 * sheenId/killstreakerId are real filters: a Fabricator's item panel shows
 * which Sheen/Killstreaker its finished Kit will have.
 *
 * @param {{targetName: string, tier: number, isNonCraftable: boolean, sheenId: ?number, killstreakerId: ?number}} fabricatorKit
 * @param {boolean} useNext - true → next.backpack.tf, false → backpack.tf
 * @returns {string} URL
 * See #25.
 */
export function buildFabricatorClassifiedsLink(fabricatorKit, useNext) {
  const { targetName, tier, isNonCraftable, sheenId, killstreakerId } = fabricatorKit;

  if (useNext) {
    return buildNextTargetClassifiedsLink("Fabricator", targetName, tier, sheenId, killstreakerId);
  }

  return buildClassicTargetClassifiedsLink(targetName, tier, isNonCraftable ? "-1" : "1", sheenId, killstreakerId);
}
