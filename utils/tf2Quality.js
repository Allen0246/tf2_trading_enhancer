/*
@description: Single source of truth for Valve's TF2 quality ids (the
schema's `item_quality` field), keyed every way callers need: by display
name (backpack.tf classifieds, Steam market_hash_name), by scrap.tf's
"qualityN" CSS class, and by numeric id (GetPlayerItems).

`color` is Steam's own inventory-page quality color (the item tile's inline
"border-color"), used so cards match the Steam-sourced quality color of the
hovered item. Omitted for qualities that render in the default color.
See #139.
*/
const QUALITIES = [
  { id: 0, name: "Normal" },
  { id: 1, name: "Genuine", color: "#4d7455" },
  { id: 3, name: "Vintage", color: "#476291" },
  { id: 5, name: "Unusual", color: "#8650ac" },
  { id: 6, name: "Unique" },
  { id: 9, name: "Self Made" },
  { id: 11, name: "Strange", color: "#cf6a32" },
  { id: 13, name: "Haunted", color: "#38f3ab" },
  { id: 14, name: "Collector's", color: "#aa0000" },
  // The default (non-Strange) quality of a Decorated Weapon or standalone
  // War Paint tool - only present in the DOM for the plain variant, per
  // scrap.tf/itemLinks/itemShape.js's own confirmed note: the Strange-tracking
  // variant of either shows quality11 (Strange) instead, never quality15.
  { id: 15, name: "Decorated Weapon" },
];

export const QUALITY_ID_BY_NAME = Object.fromEntries(QUALITIES.map((q) => [q.name, q.id]));
// Reverse of QUALITY_ID_BY_NAME - for a caller that already has the numeric
// Valve quality id from a structured source (e.g. GetPlayerItems' own
// "quality" field, see utils/tf2PlayerItems.js) rather than a CSS class or
// display text to parse it back out of.
export const QUALITY_NAME_BY_ID = Object.fromEntries(QUALITIES.map((q) => [q.id, q.name]));
export const QUALITY_NAME_BY_CLASS = Object.fromEntries(QUALITIES.map((q) => [`quality${q.id}`, q.name]));
export const QUALITY_COLOR_BY_NAME = Object.fromEntries(QUALITIES.filter((q) => q.color).map((q) => [q.name, q.color]));

/*
@description: Reads an item element's quality name off its scrap.tf
"qualityN" CSS class (e.g. classList containing "quality11" -> "Strange").
Falls back to "Unique" when no quality class is present, matching scrap.tf's
own default rendering for Unique items.
*/
export function getQualityNameFromClassList(classList) {
  for (const [className, name] of Object.entries(QUALITY_NAME_BY_CLASS)) {
    if (classList.contains(className)) return name;
  }
  return "Unique";
}

/*
@description: Reads an item element's Valve quality id off its scrap.tf
"qualityN" CSS class. Falls back to 6 (Unique) when no quality class is
present.
*/
export function getQualityIdFromClassList(classList) {
  return QUALITY_ID_BY_NAME[getQualityNameFromClassList(classList)] ?? 6;
}
