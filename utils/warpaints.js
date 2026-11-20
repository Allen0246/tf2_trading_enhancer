/*
@description: War Paint (skin) and wear-tier lookups, backed by the bundled
utils/data/warpaints.json.
*/
const WARPAINTS_URL = "utils/data/warpaints.json";

// In-memory cache for the page's lifetime - the bundled file never changes at
// runtime, so there's no need for chrome.storage/TTL handling like the Steam
// schema cache.
let warpaintsPromise = null;

/*
@description: Test-only: clears the in-memory warpaintsPromise cache (see
utils/tf2Schema.js's __resetSchemaCacheForTests for why tests reset rather
than re-import).
*/
export function __resetWarpaintsCacheForTests() {
  warpaintsPromise = null;
}

/*
@description: Loads the bundled War Paint (skin) name -> backpack.tf
"texture" filter id list. Sourced from https://itempedia.tf/warpaints.json,
downloaded once and bundled with the extension rather than fetched live,
since the list only changes when Valve ships new War Paints - infrequent
enough that a manual refresh of utils/data/warpaints.json is simpler than
adding TTL/cache-invalidation logic like utils/tf2Schema.js has for the
(much more frequently changing) item schema.
*/
async function getWarpaints() {
  if (!warpaintsPromise) {
    warpaintsPromise = fetch(chrome.runtime.getURL(WARPAINTS_URL))
      .then((res) => res.json())
      .then((data) => {
        // A resolved fetch can still hand back the wrong shape, which the
        // .catch below would not see. See #135.
        if (!Array.isArray(data)) {
          console.warn("[TF2 Trading Enhancer] warpaints.json did not resolve to an array - treating as unavailable:", data);
          warpaintsPromise = null;
          return [];
        }
        return data;
      })
      .catch((e) => {
        console.warn("[TF2 Trading Enhancer] Failed to load warpaints.json:", e);
        warpaintsPromise = null;
        return [];
      });
  }
  return warpaintsPromise;
}

/*
@description: Looks up a War Paint's backpack.tf "texture" filter id by its
display name (e.g. "Eyestalker" -> 265). Confirmed live against
next.backpack.tf's own classifieds filter for several skins.
*/
export async function getTextureId(skinName) {
  const warpaints = await getWarpaints();
  const match = warpaints.find((entry) => entry.name === skinName);
  return match ? match.defindex : null;
}

/*
@description: Looks up a War Paint's display name by its backpack.tf
"texture" filter id (e.g. 278 -> "Smissmas Spycrabs") - the reverse of
getTextureId above. Used to recover a Decorated Weapon's skin name from
scrap.tf's own skin-preview image URL (see skinDetection.js's
SKIN_PREVIEW_IMAGE_PATTERN) when the tooltip title text itself doesn't carry
it, e.g. a Name-Tagged item, whose custom name replaces the "{Skin}
{Weapon} ({Wear})" title text that the rest of this feature's skin detection
otherwise depends on.
*/
export async function getSkinNameByTextureId(textureId) {
  const warpaints = await getWarpaints();
  const match = warpaints.find((entry) => entry.defindex === textureId);
  return match ? match.name : null;
}

/*
@description: Finds the longest known skin name that's a prefix of the given
text (e.g. "Necromanced Black Box" -> "Necromanced"). Used by
stntrading.eu/link2Backpack/content.js to split a Decorated Weapon's raw
name, which concatenates skin and weapon with no separator ("{skin}{weapon}")
and no DOM signal (like scrap.tf's data-defindex) to resolve it another way.
Prefers the longest match for the same reason resolveUnusualEffect does -
some skin names are substrings of other, longer, more specific ones.
*/
export async function findSkinNamePrefix(text) {
  const warpaints = await getWarpaints();
  const matches = warpaints.filter((entry) => text.startsWith(entry.name));
  if (matches.length === 0) return null;
  return matches.reduce((longest, entry) => (entry.name.length > longest.name.length ? entry : longest)).name;
}

/*
@description: The reverse direction of findSkinNamePrefix above - finds
every known skin name that the given (partial, as-you-type) text is itself a
prefix of, e.g. "coff" -> ["Coffin Nail"]. Used by
../backpack.tf/oldUI/premiumSearchSkinAutocomplete/content.js for the
Premium "Build a Search" modal's own Texture Name field, which requires an
exact skin name and gives no suggestions of its own. Returns [] for an empty
prefix (matching, not suggesting, everything isn't useful) - not
case-sensitive, since a typed prefix may not match the stored name's own
capitalization.
*/
export async function findSkinNamesByPrefix(prefix) {
  if (!prefix) return [];
  const warpaints = await getWarpaints();
  const lowerPrefix = prefix.toLowerCase();
  return warpaints.filter((entry) => entry.name.toLowerCase().startsWith(lowerPrefix)).map((entry) => entry.name);
}

/*
@description: next.backpack.tf's classifieds Wear Tier filter ids - confirmed
live via its own search request payload ({id, name, short} objects): Battle
Scarred=5, Field-Tested=3, matching the standard 1-5 wear ordering. Shared by
scrap.tf/itemLinks/itemShape.js and stntrading.eu/link2Backpack/content.js -
both need it for the same Decorated Weapon / War Paint tool classifieds
filters.
*/
export const WEAR_TIER_IDS = {
  "Factory New": 1,
  "Minimal Wear": 2,
  "Field-Tested": 3,
  "Well-Worn": 4,
  "Battle Scarred": 5,
};

// Reverse of WEAR_TIER_IDS - recovers the wear tier NAME from scrap.tf's
// skin-preview image URL, which only carries the numeric id (see
// skinDetection.js's SKIN_PREVIEW_IMAGE_PATTERN).
export const WEAR_TIER_NAMES_BY_ID = Object.fromEntries(
  Object.entries(WEAR_TIER_IDS).map(([name, id]) => [id, name])
);
