/*
@description: Small extractors that pull attributes (Unusual effect,
Halloween Spell, level, Paint, Sheen, Killstreaker, Festivized,
Uncraftable) out of a hovered item's data-content tooltip attribute. None of
these are exposed as CSS classes the way quality/killstreak tier are.
*/

import { stripHtmlTags } from "../../utils/domText.js";

/*
@description: Plain-text version of the item element's own data-content
attribute (e.g. "Level 17<br/>Effect: Fountain of Delight<br/>...") - the
source for Unusual effect / Sheen / Festivized detection below, since none
of those are CSS classes or literal tooltip-title text. Reading it straight
off the item element (rather than the separate .hover-over tooltip) means
it's always in sync with whichever item is currently being looked up, not
whatever the tooltip happened to show last.
*/
function getDataContentText(itemEl) {
  const dataContent = itemEl?.getAttribute("data-content") || "";
  return stripHtmlTags(dataContent).trim();
}

/*
@description: Extracts the Unusual effect name (e.g. "Fountain of Delight").
*/
export function getUnusualEffectName(itemEl) {
  const match = getDataContentText(itemEl).match(/^Effect:\s*(.+)$/im);
  return match ? match[1].trim() : null;
}

/*
@description: Extracts the Halloween Spell name (e.g. "Exorcism" from
"Halloween Spell: Exorcism").
*/
export function getSpellName(itemEl) {
  const match = getDataContentText(itemEl).match(/^Halloween Spell:\s*(.+)$/im);
  return match ? match[1].trim() : null;
}

/*
@description: Extracts the item's level (e.g. "22" from "Level 22") - always
the first line of data-content.
*/
export function getLevel(itemEl) {
  const match = getDataContentText(itemEl).match(/^Level\s+(\d+)/im);
  return match ? match[1] : null;
}

/*
@description: Extracts the paint name (e.g. "A Distinctive Lack of Hue" from
"Painted A Distinctive Lack of Hue").
*/
export function getPaintName(itemEl) {
  const match = getDataContentText(itemEl).match(/^Painted\s+(.+)$/im);
  return match ? match[1].trim() : null;
}

/*
@description: Extracts the Killstreak Sheen name (e.g. "Villainous Violet").
*/
export function getSheenName(itemEl) {
  const match = getDataContentText(itemEl).match(/^Sheen:\s*(.+)$/im);
  return match ? match[1].trim() : null;
}

/*
@description: Extracts the Killstreaker name (e.g. "Incinerator").
*/
export function getKillstreakerName(itemEl) {
  const match = getDataContentText(itemEl).match(/^Killstreaker:\s*(.+)$/im);
  return match ? match[1].trim() : null;
}

/*
@description: Detects the Festivized attribute.
*/
export function isFestivized(itemEl) {
  return /^Festivized$/im.test(getDataContentText(itemEl));
}

/*
@description: Detects a standalone "Uncraftable"/"Non-Craftable" tooltip
line. scrap.tf's "uncraft" CSS class is not always present (e.g. a
Waterlogged Lab Coat whose tooltip reads "Uncraftable"), so itemShape.js
ORs this with the class.
*/
export function isMarkedUncraftableInTooltip(itemEl) {
  return /^(?:Non-Craftable|Uncraftable)$/im.test(getDataContentText(itemEl));
}
