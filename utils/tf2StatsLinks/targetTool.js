/*
@description: Target-item tool (e.g. Strangifier) type handling (see
index.js for this folder's overview).
*/

import { getItemDefindex } from "../tf2Schema.js";
import { stripCraftabilityAndArticle, baseBpUrl, baseNextBpUrl } from "./common.js";

// Target-item tools: backpack.tf's canonical item name is the tool itself
// (e.g. "Strangifier"), with the specific item it targets (e.g. "Ghastlier
// Gibus") encoded as a defindex suffix in the URL, the same way Unusual
// effects append a particle id.
const TARGET_ITEM_TOOLS = [{ suffix: " Strangifier", baseItemName: "Strangifier" }];

// A Strangifier Chemistry Set (a crafting tool that strangifies one specific
// promotional/exclusive item that could never otherwise become Strange, e.g.
// "Professor Speks Strangifier Chemistry Set Series #2") targets a specific
// item too, same idea as a plain Strangifier tool - but its own raw name
// isn't a fixed suffix, since it always ends in a variable "Series #{n}"
// tag. Confirmed live: https://next.backpack.tf/classifieds?itemName=
// Chemistry%20Set&quality=6&targetItem=Professor%20Speks - backpack.tf's own
// canonical item name for it is just "Chemistry Set" (neither "Strangifier"
// nor "Series #n" appear in it at all), filtered by targetItem the same way
// a plain Strangifier's own next.backpack.tf search already is.
const CHEMISTRY_SET_PATTERN = /^(.+) Strangifier Chemistry Set Series #\d+$/i;

/**
 * Detect whether an item is a target-item tool (e.g. "Ghastlier Gibus Strangifier",
 * or "Professor Speks Strangifier Chemistry Set Series #2") and split it into
 * the target item's name and the tool's own backpack.tf item name.
 *
 * @param {string} itemNameRaw
 * @returns {{targetName: string, baseItemName: string, isNonCraftable: boolean} | null}
 */
export function matchTargetItemTool(itemNameRaw) {
  const { name, isNonCraftable } = stripCraftabilityAndArticle(itemNameRaw);

  const chemistrySetMatch = CHEMISTRY_SET_PATTERN.exec(name);
  if (chemistrySetMatch) {
    const targetName = chemistrySetMatch[1].trim();
    if (targetName) return { targetName, baseItemName: "Chemistry Set", isNonCraftable };
  }

  for (const tool of TARGET_ITEM_TOOLS) {
    if (name.endsWith(tool.suffix)) {
      const targetName = name.slice(0, -tool.suffix.length).trim();
      if (targetName) return { targetName, baseItemName: tool.baseItemName, isNonCraftable };
    }
  }

  return null;
}

// The base names a page's own link or URL gives for a target-item tool when
// it leaves the target out (confirmed live: marketplace.tf's BackpackTF button
// "?item=Strangifier&quality=6", next.backpack.tf's suggestion item link
// "/stats?item=Strangifier&quality=Unique&priceindex=773").
export const TARGET_TOOL_BASE_NAMES = new Set(["Strangifier", "Chemistry Set"]);

/**
 * The full target-tool name ("Apparition's Aspect Strangifier") off a page
 * title, for a page whose link only gave the bare base name. Strips the
 * title's display prefixes first ("Uncraftable "/"Non-Craftable ", a
 * non-Unique quality name). Only trusted when matchTargetItemTool splits it
 * back into the same tool, so an unexpected title is never used.
 *
 * @param {string} baseItemName - the name the link gave ("Strangifier")
 * @param {?string} titleText - the page's own title text for the item
 * @param {?string} qualityName - the item's quality name ("Unique", ...)
 * @returns {?string} the full name, or null (not a target tool / no match)
 */
export function resolveTargetToolNameFromTitle(baseItemName, titleText, qualityName) {
  if (!TARGET_TOOL_BASE_NAMES.has(baseItemName)) return null;

  let title = (titleText ?? "").replace(/\s+/g, " ").trim();
  title = title.replace(/^(?:Uncraftable|Non-Craftable) /i, "");
  if (qualityName && qualityName !== "Unique" && title.startsWith(`${qualityName} `)) title = title.slice(qualityName.length + 1);

  const match = matchTargetItemTool(title);
  return match && match.baseItemName === baseItemName ? title : null;
}

/**
 * Reconstructs a target-item tool's own full display name (e.g. "Ghastlierest
 * Gibus Strangifier") from resolveClassifiedsFilters' own already-split
 * {itemName, targetItemName} fields - the inverse of matchTargetItemTool's
 * own split above.
 *
 * mannco.store's search and marketplace.tf's sterm both want this full name
 * (the item's real Valve name), not backpack.tf's split
 * itemName=Strangifier&targetItem=... fields.
 *
 * @param {string} itemName - "Strangifier" or "Chemistry Set"
 * @param {string} targetItemName - the target weapon/promo item's own name
 * @returns {string}
 */
export function buildTargetToolFullName(itemName, targetItemName) {
  return itemName === "Strangifier" ? `${targetItemName} Strangifier` : `${targetItemName} Strangifier ${itemName}`;
}

/**
 * Build a backpack.tf stats URL for a target-item tool (e.g. a Strangifier),
 * looking up the target item's defindex from the TF2 schema.
 *
 * Always links the tool's plain Unique stats page: a Strangifier targets a
 * base item, never a specific Unusual effect. A Strangifier Chemistry Set's
 * stats URL is built the same way but has not been confirmed live.
 *
 * @param {{targetName: string, baseItemName: string, isNonCraftable: boolean}} match
 * @param {boolean} useNext - true → use next.backpack.tf, false → use backpack.tf
 * @returns {Promise<string|null>} URL, or null if the target item's defindex couldn't be resolved
 */
export async function createBpStatsLinkTargetTool(match, useNext = false) {
  const defindex = await getItemDefindex(match.targetName);

  if (defindex == null) {
    console.log(
      `[TF2 Trading Enhancer] Could not resolve defindex for "${match.targetName}" (configure a Steam Web API key in the popup settings)`
    );
    return null;
  }

  const base = useNext ? baseNextBpUrl : baseBpUrl;
  const craftability = match.isNonCraftable ? "Non-Craftable" : "Craftable";

  return `${base}/Unique/${encodeURIComponent(match.baseItemName)}/Tradable/${craftability}/${defindex}`;
}
