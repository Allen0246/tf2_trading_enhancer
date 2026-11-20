/*
@description: Quality/killstreak-tier prefix words that scrap.tf includes in
an item's raw display name (e.g. "Strange Professional Killstreak Rocket
Launcher"). Used to recover the "bare" item name - both to rebuild a
canonical display name (scrap.tf/itemLinks re-inserts only the specific
prefixes it needs, from data it already knows is reliable, rather than
trusting whichever ones happen to appear in the raw text) and to build a
clean backpack.tf classifieds search term, which needs no prefix at all since
quality/killstreak tier are passed as separate search params.

Every quality word must be listed, or a quality-aware caller that re-adds
its canonical prefix produces a duplicate (e.g. "Haunted Haunted Gibus").
Spelling must match utils/tf2Quality.js's QUALITIES table ("Self Made", no
hyphen). steamcommunity.com/tradeOffer/pages/tradeoffer.js keeps a copy of
this logic (it cannot import ES modules), so keep the two in sync.
*/
const NAME_PREFIX_PATTERN =
  /^(Killstreak |Specialized Killstreak |Professional Killstreak |Strange |Vintage |Collector's |Haunted |Unusual |Genuine |Self Made )/i;

// A Decorated Weapon/War Paint tool's skin can carry its own "★Unusual "
// marker, distinct from a plain "Unusual " quality word (the star never
// appears on a plain item), e.g. "Strange ★Unusual Beachy Boy War Paint
// (Minimal Wear)". Separate pattern because the star allows optional
// whitespace, matching scrap.tf/itemLinks/skinDetection.js.
const STAR_UNUSUAL_PATTERN = /^★\s*Unusual\s+/i;

// The quality words NAME_PREFIX_PATTERN matches, minus the Killstreak tiers
// (no TF2 item's real name starts with "Killstreak"). Used by the
// knownQualityName check to tell "this word is the item's quality" apart
// from "this word starts the item's literal name".
const QUALITY_WORDS = ["Strange", "Vintage", "Collector's", "Haunted", "Unusual", "Genuine", "Self Made"];

// Unique-quality items whose real name starts with "Strange" (the three tool
// families "Strange Part: Kills While Übercharged", "Strange Cosmetic Part:
// Kills" and "Strange Filter: Coldfront (Community)", plus "Strange Count
// Transfer Tool" and "Strange Bacon Grease"), so that word is never a quality
// prefix for them. Same set as utils/tf2StatsLinks/common.js's
// LITERAL_NAME_QUALITY_EXCEPTIONS plus its STRANGE_TOOL_NAME_PATTERN.
const LITERAL_STRANGE_NAME_PATTERN =
  /^(?:Strange Part:|Strange Cosmetic Part:|Strange Filter:|Strange Count Transfer Tool$|Strange Bacon Grease$)/i;

/*
@description: Strips quality/killstreak prefix words off a raw scrap.tf item
display name, e.g. "Strange Australium Rocket Launcher" -> "Australium Rocket
Launcher". Leaves LITERAL_STRANGE_NAME_PATTERN's names ("Strange Part: ..." etc.)
untouched, since the "Strange" there is part of the item's own real (Unique-
quality) name, not a quality prefix.

Loops rather than stripping a single match, because quality and
killstreak-tier words can stack (e.g. "Strange Professional Killstreak ...").

@param {string} name
@param {?string} knownQualityName - optional real quality from a structural
signal (e.g. scrap.tf's "qualityN" class). When the name starts with
"Strange " but the real quality is something else, and no second quality word
follows (unlike "Strange Vintage Camera Beard", where "Strange" is a stacked
descriptor), "Strange" must be part of the item's literal name and is kept.
This generalizes the hardcoded checks below to items not listed there.
See #124.
*/
export function stripNamePrefix(name, knownQualityName = null) {
  // Checked unconditionally so these work even without knownQualityName. See #116.
  if (LITERAL_STRANGE_NAME_PATTERN.test(name)) return name;

  if (knownQualityName && knownQualityName !== "Strange" && /^Strange\s+/i.test(name)) {
    const afterStrange = name.replace(/^Strange\s+/i, "");
    // A "★Unusual " marker after "Strange " counts as a second quality
    // word too: the item's real quality is Unusual (see
    // scrap.tf/itemLinks/skinDetection.js), not a literal "Strange" name.
    const hasGenuineQualityWordNext =
      QUALITY_WORDS.some((q) => q !== "Strange" && afterStrange.startsWith(q + " ")) || STAR_UNUSUAL_PATTERN.test(afterStrange);
    if (!hasGenuineQualityWordNext) return name;
  }

  let stripped = name;
  let match;
  while ((match = NAME_PREFIX_PATTERN.exec(stripped) || STAR_UNUSUAL_PATTERN.exec(stripped))) {
    stripped = stripped.slice(match[0].length);
  }
  return stripped;
}
