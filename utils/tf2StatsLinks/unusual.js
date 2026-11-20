/*
@description: Unusual-quality item type handling (see index.js for this
folder's overview).
*/

import { getEffectNameToIdMap } from "../tf2Schema.js";
import { getUnusualEffectNameById } from "../unusualEffectIds.js";
import { stripCraftabilityPrefix, stripArticlePrefix, escapeRegExp, baseBpUrl, baseNextBpUrl } from "./common.js";

/*
@description: A case-insensitive pattern matching effectName only as whole
words, so an effect name that happens to be a fragment of an item's own name
never matches: "Hot" must not match inside "Hottie's Hoodie" (which stripped
the item down to "tie's Hoodie"), nor "Cool" inside "Coolmaker". Letters and
digits on either side count as "inside a word"; punctuation and spaces don't,
so names like "'72" or "Nuts n' Bolts" still match.
*/
function wholeWordEffectPattern(effectName) {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(effectName)}(?![\\p{L}\\p{N}])`, "iu");
}

/**
 * Finds the Unusual effect embedded in a raw item name (e.g. "Unusual Team
 * Captain" wearing "Burning Flames") and returns its resolved id (if any)
 * plus the name with "Unusual " and the effect name (if found) stripped out.
 * Shared by createBpStatsLinkUnusual and index.js's resolveClassifiedsFilters,
 * so effect resolution only has one implementation.
 *
 * A handful of real items are Unusual-quality with no particle effect at all
 * (e.g. "Unusual Horseless Headless Horsemann's Headtaker") - confirmed live:
 * that one's correct links are plain Unusual-quality ones with no effect id/
 * particle param anywhere, not an unresolvable item. So no matching effect
 * name is a valid result; it only counts as a failure when the effect map
 * itself is empty (it includes the bundled utils/unusualEffectIds.js table,
 * so that should not happen in practice).
 *
 * Strips a leading "Non-Craftable " the same way every other name-parsing
 * function in this folder does (see stripCraftabilityPrefix), before
 * stripping "Unusual " itself.
 *
 * @param {string} itemNameRaw
 * @param {?string} knownEffectName - skips the substring search for a page
 * that labels the effect separately (e.g. Steam's "★ Unusual Effect: Mega
 * Strike"); matched case-insensitively.
 * @param {?number} knownEffectId - skips the effect-map lookup entirely for a
 * page that already carries the numeric id (e.g. classic backpack.tf's hover
 * popover, whose classifieds anchor has "particle=94"). Without a
 * knownEffectName, the name is read from the bundled utils/unusualEffectIds.js
 * table (null for an id newer than that table).
 *
 * @returns {Promise<{effectId: ?number, effectName: ?string, baseName: string, isNonCraftable: boolean} | null>}
 * null only when neither known value is given and the effect map is empty;
 * a known name with no resolvable id still returns a result with
 * effectId: null.
 * See #3.
 * See #4.
 */
export async function resolveUnusualEffect(itemNameRaw, knownEffectName = null, knownEffectId = null) {
  const { name, isNonCraftable } = stripCraftabilityPrefix(String(itemNameRaw || "").trim());
  // Strip "Unusual " then, same as stripCraftabilityQualityAndArticle's own
  // ordering, "The " - the raw name puts the quality word (here "Unusual")
  // before the article (e.g. "Unusual The Team Captain"), so article has to
  // come off last or it's left stuck onto baseName ("The Team Captain"
  // instead of "Team Captain"). A leading "Strange " in front of "Unusual"
  // (Steam's "Strange Unusual Team Captain" market_hash_name) is only a
  // Strange-tracking descriptor, same rule as common.js's stripQualityPrefix,
  // so it is stripped with it rather than left in the base name.
  let baseName = stripArticlePrefix(name.replace(/^(?:Strange\s+)?Unusual\s+/i, "").trim());

  // Some raw names include the effect text too (stntrading.eu's title, e.g.
  // "Unusual Otherworldly Weather Mean Captain"), so strip it; a no-op for
  // names without it.
  if (knownEffectName) {
    baseName = stripArticlePrefix(baseName.replace(wholeWordEffectPattern(knownEffectName), "").trim());
  }

  // No schema fetch needed: resolved (and returned) before the
  // schema-availability check below, so a caller with a known id never pays
  // that cost or hits that failure mode at all. A caller with only the id
  // (e.g. a page link's "particle=13" param) still gets the effect NAME, from
  // the bundled table: name-based links (stntrading.eu's "Unusual {Effect}
  // {Item}", pricedb.io's "{Effect} {Item}" search, Steam Market's q=)
  // otherwise silently dropped the effect. The looked-up name is NOT
  // stripped from baseName: id-only callers build the raw name from page
  // params that never contain the effect text, and stripping would mangle an
  // item whose own name contains an effect word ("Smoking Skid Lid" with the
  // "Smoking" effect).
  if (knownEffectId != null) {
    return { effectId: knownEffectId, effectName: knownEffectName ?? getUnusualEffectNameById(knownEffectId), baseName, isNonCraftable };
  }

  const effectNameToId = await getEffectNameToIdMap(); // { "Burning Flames": 13, ... }

  if (Object.keys(effectNameToId).length === 0) {
    // A known name still yields a result: name-based buttons (pricedb.io,
    // mannco.store) need no id, and the id-based ones tolerate null. See #138.
    if (knownEffectName) {
      return { effectId: null, effectName: knownEffectName, baseName, isNonCraftable };
    }
    console.log("[TF2 Trading Enhancer] Effect schema unavailable (configure a Steam Web API key in the popup settings)");
    return null;
  }

  if (knownEffectName) {
    const matchedName = Object.keys(effectNameToId).find((n) => n.toLowerCase() === knownEffectName.toLowerCase());
    // Falls back to the caller's own (unmatched-against-schema) name rather
    // than null - still useful as a label/search term even if this
    // particular effect isn't in the cached schema for some reason, unlike
    // effectId, which has no such fallback (there's no id to guess).
    return {
      effectId: matchedName ? effectNameToId[matchedName] : null,
      effectName: matchedName ?? knownEffectName,
      baseName,
      isNonCraftable,
    };
  }

  // Prefer the longest matching name: some effect names are substrings of
  // other, more specific ones (e.g. a shorter generic name contained within
  // a longer one), so picking whichever Object.keys() happens to enumerate
  // first could match the wrong (shorter) effect instead of the one
  // actually present in the raw text. Whole words only (see
  // wholeWordEffectPattern). An effect name that is also a whole word of the
  // item's own name (effect "Smoking" vs "Smoking Skid Lid") still matches
  // when the raw name carries no effect at all; nothing in the name alone can
  // tell those apart.
  const matchingEffectNames = Object.keys(effectNameToId).filter((effectCandidate) =>
    wholeWordEffectPattern(effectCandidate).test(name)
  );
  const effectName = matchingEffectNames.sort((a, b) => b.length - a.length)[0];

  let cleanedBaseName = baseName;
  if (effectName) {
    cleanedBaseName = cleanedBaseName.replace(wholeWordEffectPattern(effectName), "").trim(); // Remove the effect name (case-insensitive, once)
    cleanedBaseName = cleanedBaseName.replace(/^[-,\s]+/, "").trim(); // Clean commas/extra spaces from the start
  }

  return {
    effectId: effectName ? effectNameToId[effectName] : null,
    effectName: effectName ?? null,
    baseName: cleanedBaseName,
    isNonCraftable,
  };
}

/**
 * Build a backpack.tf stats URL for an Unusual item. No trailing effect-id
 * path segment when the item has no effect at all (see resolveUnusualEffect)
 * - confirmed live: .../Unusual/Horseless Headless Horsemann's Headtaker/
 * Tradable/Craftable, no extra segment, for one of those.
 *
 * @param {string} itemNameRaw - e.g., "Unusual Team Captain"
 * @param {boolean} useNext - true → use next.backpack.tf, false → use backpack.tf
 * @param {?string} knownEffectName - see resolveUnusualEffect's own note
 * @param {?number} knownEffectId - see resolveUnusualEffect's own note
 * @returns {Promise<string|null>} URL, or null if resolveUnusualEffect returned null
 */
export async function createBpStatsLinkUnusual(itemNameRaw, useNext = false, knownEffectName = null, knownEffectId = null) {
  const resolved = await resolveUnusualEffect(itemNameRaw, knownEffectName, knownEffectId);
  if (!resolved) return null;

  const base = useNext ? baseNextBpUrl : baseBpUrl;
  const effectSuffix = resolved.effectId ? `/${resolved.effectId}` : "";
  const craftability = resolved.isNonCraftable ? "Non-Craftable" : "Craftable";
  return `${base}/Unusual/${encodeURIComponent(resolved.baseName)}/Tradable/${craftability}${effectSuffix}`;
}
