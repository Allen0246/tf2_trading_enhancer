/*
@description: Steam Web API TF2 item schema (GetSchemaItems +
GetSchemaOverview), trimmed to the lookup maps this extension needs and
cached in chrome.storage.local for a week. Requests go through
fetchJsonRelay (background relay + retry on transient 5xx). Unusual effect
lookups prefer the bundled utils/unusualEffectIds.js table and only fall back
to the live schema, so they work without an API key.
*/
import { fetchJsonRelay } from "./fetchJsonRelay.js";
import { UNUSUAL_EFFECT_IDS } from "./unusualEffectIds.js";

const SCHEMA_ITEMS_URL = "https://api.steampowered.com/IEconItems_440/GetSchemaItems/v1/";
const SCHEMA_OVERVIEW_URL = "https://api.steampowered.com/IEconItems_440/GetSchemaOverview/v0001/";
// Exported so callers that only need to inspect the cache (popup/popup.js,
// steamcommunity.com/apiKeyStatus/content.js) can read the same values
// instead of hand-copying them and relying on a "keep in sync" comment.
export const SCHEMA_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 1 week
export const SCHEMA_STORAGE_KEY = "tf2SchemaCache";
// Bump whenever fetchFullSchema's returned shape gains or changes a field:
// otherwise an existing week-fresh cache passes the TTL check and the new
// field reads as missing until the cache expires.
export const SCHEMA_SHAPE_VERSION = 4;

let schemaPromise = null; // in-memory dedupe for this page load

/*
@description: Test-only: clears the in-memory schemaPromise dedupe. Tests
reset this instead of re-importing the module per test because node's
coverage reporter keeps only the last-loaded instance of a script, so
per-test dynamic imports under-report coverage.
*/
export function __resetSchemaCacheForTests() {
  schemaPromise = null;
}

/*
@description: Reads the saved Steam Web API key from storage (also used by
utils/tf2PlayerItems.js).
*/
export async function getSteamApiKey() {
  const stored = await chrome.storage.local.get(["steamApiKey"]);
  return stored.steamApiKey || null;
}

/*
@description: Whether a Steam Web API key is saved at all - for a caller that
tells the user a link needs one (see utils/linkButtonStates.js).
*/
export async function hasSteamApiKey() {
  return Boolean(await getSteamApiKey());
}

/*
@description: Fetches a single page of GetSchemaItems. Valve paginates past
~1000 items via a "next" cursor in the response.
*/
async function fetchSchemaItemsPage(apiKey, start) {
  const url = new URL(SCHEMA_ITEMS_URL);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("language", "en");
  if (start != null) url.searchParams.set("start", start);

  const json = await fetchJsonRelay(url.toString());
  return json?.result;
}

/*
@description: Fetches GetSchemaOverview, which includes the Unusual effect
list (attribute_controlled_attached_particles) - a single response, not
paginated.
*/
async function fetchSchemaOverview(apiKey) {
  const url = new URL(SCHEMA_OVERVIEW_URL);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("language", "en");

  const json = await fetchJsonRelay(url.toString());
  return json?.result;
}

/*
@description: Normalizes GetSchemaItems' used_by_classes field to an array
of class names. The documented shape is an array (["Scout","Soldier"]); an
{"Scout":"1"}-style object is handled too since the live shape has not been
verified. Absent means "not class-restricted" and returns [].
*/
function normalizeUsedByClasses(rawField) {
  if (!rawField) return [];
  if (Array.isArray(rawField)) return rawField;
  if (typeof rawField === "object") return Object.keys(rawField);
  return [];
}

/*
@description: Classifies an Unusual effect's category (hat/taunt/weapon) from
its particle system's internal name, confirmed live against real
GetSchemaOverview entries: id 301 "unusual_sixthsense_teamcolor_red" (hat),
id 3011 "utaunt_souls_green_parent" (taunt), id 701 "weapon_unusual_hot"
(weapon). Only "utaunt_"/"weapon_unusual_" are checked positively - "hat" is
the default fallthrough rather than requiring its own "unusual_" prefix
match, since a handful of pre-convention legacy hat effects (e.g.
"burningplayer_red") don't carry that prefix at all; falling through to hat
instead of a dedicated hardcoded override list for those handles them for
free, since hat/taunt/weapon are the only three categories that exist.
*/
export function categorizeEffectSystem(system) {
  if (typeof system === "string") {
    if (system.startsWith("weapon_unusual_")) return "weapon";
    if (system.startsWith("utaunt_")) return "taunt";
  }
  return "hat";
}

/*
@description: Walks every page of GetSchemaItems plus one GetSchemaOverview
call, and trims them down to just the maps we need, instead of caching
Valve's full (much larger) responses.
*/
async function fetchFullSchema(apiKey) {
  const itemNameToDefindex = {};
  // Tracks whether the currently stored defindex for a name came from an
  // "Upgradeable " entry, so a later plain-stock duplicate can't override it
  // back once the preferred variant has been found (pagination order between
  // the two isn't guaranteed).
  const itemNameIsUpgradeable = {};
  // Every defindex -> item_name seen, unfiltered (unlike itemNameToDefindex,
  // which keeps only one preferred defindex per name). Needed for reverse
  // lookups (getItemNameByDefindex) against defindexes that itemNameToDefindex
  // would otherwise have discarded as a "duplicate" - confirmed live: some
  // decorated/promotional weapon variants use a third schema entry (e.g.
  // "Purple Range Sniper Rifle", defindex 15007) sharing a name with the
  // regular stock/Upgradeable pair, which the by-name dedup above always
  // drops in favor of the Upgradeable one.
  const defindexToItemName = {};
  const effectNameToId = {};
  // Keyed the same as effectNameToId, same first-seen-wins semantics (set
  // alongside it below, from the same picked entry) - "hat"/"taunt"/"weapon".
  const effectNameToCategory = {};
  // Keyed by item_name (same key space as itemNameToDefindex), value is the
  // class name array - [] means "not class-restricted" (usable by every
  // class), matching Valve's own schema convention of simply omitting
  // used_by_classes entirely for such items.
  const itemNameToClasses = {};
  // Keyed by item_name, value is Valve's craft_class verbatim (e.g.
  // "weapon", "hat", "tool"), null if absent (see getCraftWeaponNames).
  const itemNameToCraftClass = {};
  // Taunts only, keyed by the icon's file name without its hash and extension
  // ("taunt_the_bunnyhopper" from .../icons/taunt_the_bunnyhopper.dfb3....png).
  // A Taunt Unusualifier's target isn't in the schema (it's a per-item
  // attribute), but scrap.tf draws the tile with the target taunt's own icon.
  const tauntIconToItemName = {};

  let start = null;
  do {
    const page = await fetchSchemaItemsPage(apiKey, start);
    if (!page) break;

    (page.items || []).forEach((item) => {
      if (!item.item_name || item.defindex == null) return;

      defindexToItemName[item.defindex] = item.item_name;

      // Confirmed live: stock TF2 weapons have TWO schema entries sharing the
      // same item_name (e.g. both named "Rocket Launcher") - a plain stock one
      // (internal name "TF_WEAPON_ROCKETLAUNCHER", defindex 18, item_quality 0)
      // and a separate "Upgradeable " one (internal name
      // "Upgradeable TF_WEAPON_ROCKETLAUNCHER", defindex 205, item_quality 6).
      // Kits/Strangifiers/etc. target the Upgradeable defindex, not the stock
      // one - that's the source of backpack.tf's Killstreak Kit stats id not
      // matching the weapon's "obvious" defindex. Non-weapon items with no
      // such duplicate are unaffected and just keep their one entry.
      const isUpgradeable = typeof item.name === "string" && item.name.startsWith("Upgradeable ");

      if (itemNameIsUpgradeable[item.item_name]) return; // already have the preferred variant

      if (!(item.item_name in itemNameToDefindex) || isUpgradeable) {
        itemNameToDefindex[item.item_name] = item.defindex;
        itemNameIsUpgradeable[item.item_name] = isUpgradeable;
      }

      // Only ever set once per name (first entry wins) - same "don't let a
      // later duplicate schema entry silently override an already-resolved
      // value" caution as itemNameToDefindex above, though class
      // restrictions are far less likely to actually differ between a
      // stock/Upgradeable pair than defindex is.
      if (!(item.item_name in itemNameToClasses)) {
        itemNameToClasses[item.item_name] = normalizeUsedByClasses(item.used_by_classes);
      }

      if (!(item.item_name in itemNameToCraftClass)) {
        itemNameToCraftClass[item.item_name] = item.craft_class || null;
      }

      const iconName = item.item_name.startsWith("Taunt: ") ? iconNameFromUrl(item.image_url) : null;
      if (iconName && !(iconName in tauntIconToItemName)) {
        tauntIconToItemName[iconName] = item.item_name;
      }
    });

    start = page.next;
  } while (start != null);

  const overview = await fetchSchemaOverview(apiKey);
  (overview?.attribute_controlled_attached_particles || []).forEach((effect) => {
    if (!effect.name || effect.id == null) return;

    // Some effects have separate RED/BLU particle systems sharing one display
    // name (e.g. 301 "unusual_sixthsense_teamcolor_red" and 302
    // "..._teamcolor_blue" are both "Sixth Sense"; 45+ such pairs exist).
    // backpack.tf only recognizes the RED id, so a later BLU entry must not
    // overwrite an already-stored name.
    const isBlueVariant = typeof effect.system === "string" && /_teamcolor_blue$/i.test(effect.system);
    if (isBlueVariant && effect.name in effectNameToId) return;

    effectNameToId[effect.name] = effect.id;
    effectNameToCategory[effect.name] = categorizeEffectSystem(effect.system);
  });

  return {
    itemNameToDefindex,
    defindexToItemName,
    effectNameToId,
    effectNameToCategory,
    itemNameToClasses,
    itemNameToCraftClass,
    tauntIconToItemName,
    fetchedAt: Date.now(),
    schemaShapeVersion: SCHEMA_SHAPE_VERSION,
  };
}

/*
@description: Gets the cached schema maps, fetching a fresh copy if missing
or older than SCHEMA_CACHE_TTL_MS. Returns null if no Steam Web API key is
configured and there's no cache to fall back on.

schemaPromise is assigned synchronously (before any internal await) so that
concurrent callers within the same page (e.g. stntrading.eu resolving both
its bp.tf and next.bp.tf links) always see the same in-flight promise instead
of each triggering their own redundant fetch. A "no key configured" result
then clears schemaPromise back to null once it resolves, rather than
permanently memoizing that failure - so saving a key in the popup takes
effect on the next lookup instead of needing a page reload.
*/
async function getSchemaMaps() {
  if (schemaPromise) return schemaPromise;

  const promise = (async () => {
    const stored = await chrome.storage.local.get([SCHEMA_STORAGE_KEY]);
    const cached = stored[SCHEMA_STORAGE_KEY];

    if (cached && cached.schemaShapeVersion === SCHEMA_SHAPE_VERSION && Date.now() - cached.fetchedAt < SCHEMA_CACHE_TTL_MS) {
      return cached;
    }

    const apiKey = await getSteamApiKey();
    if (!apiKey) return cached || null;

    try {
      const fresh = await fetchFullSchema(apiKey);
      await chrome.storage.local.set({ [SCHEMA_STORAGE_KEY]: fresh });
      return fresh;
    } catch (e) {
      console.warn("[TF2 Trading Enhancer] Failed to fetch TF2 schema:", e);
      return cached || null;
    }
  })();

  schemaPromise = promise; // synchronous - guards against concurrent callers

  const result = await promise;
  if (!result) schemaPromise = null; // don't memoize a failure - retry next call

  return result;
}

/*
@description: Whether schema data can be resolved at all right now (a cache
exists, or a fresh fetch succeeds) - for a caller that needs to tell
"genuinely not class-restricted" apart from "couldn't look this up because
no API key is configured", which getItemClasses' own [] return value alone
can't distinguish (see its own note).
*/
export async function hasSchemaAccess() {
  const schema = await getSchemaMaps();
  return Boolean(schema);
}

/*
@description: Looks up an item's defindex by its display name (e.g. "Ghastlier Gibus").
*/
export async function getItemDefindex(itemName) {
  const schema = await getSchemaMaps();
  return schema?.itemNameToDefindex?.[itemName] ?? null;
}

/*
@description: The normalization getCanonicalItemName below compares by -
strips case, apostrophes (straight "'" or curly "’"/"‘", entirely: the
confirmed live case is a MISSING apostrophe, not a differently-styled one),
diacritics (Unicode NFD decomposition + stripping combining marks, e.g.
"ä" -> "a"), and a leading "The " article (present on either side, missing
on the other). Applied to BOTH sides of every comparison, so it only ever
has to be lossy in the same way for both.
*/
function normalizeForFuzzySchemaMatch(name) {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’‘]/g, "")
    .replace(/^the\s+/, "");
}

/*
@description: Resolves an item's exact-cased canonical schema name from a
name that might have the wrong case, a stripped/wrong apostrophe, a missing
diacritic, or a missing "The " article - confirmed live for several
independent cases: stntrading.eu's own raw item-name text can capitalize a
weapon's name wrong (e.g. "Force-A-Nature" instead of the real
"Force-a-Nature"); scrap.tf's own item banking table (/items) renders an
apostrophe'd item's name with the apostrophe silently dropped entirely (e.g.
"Bills Hat" instead of "Bill's Hat"); and scrap.tf's own itemLinks hover
tooltip (data-title) can ALSO drop a diacritic AND the leading "The " article
together for a given item (e.g. "Quackenbirdt" instead of the real
"The Quäckenbirdt"). All of these
silently 404 every EXACT-match lookup built from them (getItemDefindex's own
exact-match itemNameToDefindex[..] included), even though Valve's schema has
the item correctly named under a different key.

Only worth calling where a raw name's exact text genuinely can't be trusted,
and an exact match is always cheaper (one property lookup vs normalizing and
scanning every key), so this is deliberately a separate function rather than
a fallback baked into getItemDefindex itself.

@returns {Promise<string>} the schema's own correctly-cased/spelled name, or
the input unchanged if it's already correct, or if no schema data / no match
is available at all (no Steam Web API key configured, or a genuine miss) -
never throws, same "just don't guess" degrade as every other schema-backed
lookup here.
*/
export async function getCanonicalItemName(itemName) {
  const schema = await getSchemaMaps();
  if (!schema?.itemNameToDefindex) return itemName;
  if (itemName in schema.itemNameToDefindex) return itemName;

  const normalizedInput = normalizeForFuzzySchemaMatch(itemName);
  const matchedName = Object.keys(schema.itemNameToDefindex).find((n) => normalizeForFuzzySchemaMatch(n) === normalizedInput);
  return matchedName ?? itemName;
}

/*
@description: Looks up an item's display name by its defindex (e.g. 206 ->
"Grenade Launcher") - the reverse of getItemDefindex, used for Decorated
Weapons (War Paint skins), whose display name is "{Skin Name} {Weapon Name}
({Wear})" with no separator, so splitting it requires already knowing the
real weapon name rather than guessing from text. Uses the unfiltered
defindexToItemName map (not itemNameToDefindex, which only keeps one
preferred defindex per name) since some decorated/promotional weapon variants
use a third schema entry sharing a name with the regular stock/Upgradeable
pair (e.g. "Purple Range Sniper Rifle", defindex 15007) that the by-name
dedup would otherwise have discarded.
*/
export async function getItemNameByDefindex(defindex) {
  const schema = await getSchemaMaps();
  return schema?.defindexToItemName?.[defindex] ?? null;
}

/*
@description: Looks up an item's used-by class list by its display name
(e.g. "Noh Mercy" -> ["Spy"]). Returns [] both when the item genuinely isn't
class-restricted and when the schema itself isn't available at all (no API
key configured, or the item name isn't found) - callers that need to tell
"confirmed unrestricted" apart from "couldn't look this up" should check
schema availability themselves rather than relying on this return value
alone.
*/
export async function getItemClasses(itemName) {
  const schema = await getSchemaMaps();
  return schema?.itemNameToClasses?.[itemName] ?? [];
}

/*
@description: An item icon URL's file name without its hash and extension,
e.g. "taunt_the_bunnyhopper" for both Valve's schema image_url
(media.steampowered.com/apps/440/icons/taunt_the_bunnyhopper.dfb3....png) and
the same icon on steamcdn-a.akamaihd.net. null when it isn't an icons URL.
*/
export function iconNameFromUrl(url) {
  return /\/apps\/440\/icons\/([^/.]+)\./.exec(url || "")?.[1] ?? null;
}

// The taunt whose icon is `iconName` (see iconNameFromUrl), or null.
export async function getTauntNameByIcon(iconName) {
  const schema = await getSchemaMaps();
  return schema?.tauntIconToItemName?.[iconName] ?? null;
}

/*
@description: Every item name Valve's own schema classifies as
craft_class:"weapon", needed by the trade offer page's metal adding (Add
Metal, the listing price pre-fill; relayed by
steamcommunity.com/tradeOfferSettingsBridge/content.js) to search a WHOLE
inventory for any available craftable weapon to top up a sub-scrap
remainder. NOT itself a signal that a
given inventory item is actually Unique-quality and Craftable (craft_class is
a property of the item NAME/catalog entry, not of an individual owned
instance) - a caller matching this list against real inventory items still
needs its own quality/craftability check, or (as tradeoffer.js's own
'CRAFTWEAPON' collectItems mode does) rely on an EXACT market_hash_name match
alone, which already excludes non-Unique/non-Craftable variants on its own
(those always carry a quality/"Non-Craftable " prefix Valve's schema name
never does).
@returns {Promise<string[]>} Every schema-classified weapon name, or [] if
the schema isn't available at all (no Steam Web API key configured, and
nothing cached yet).
*/
export async function getCraftWeaponNames() {
  const schema = await getSchemaMaps();
  if (!schema?.itemNameToCraftClass) return [];

  return Object.keys(schema.itemNameToCraftClass).filter((name) => schema.itemNameToCraftClass[name] === "weapon");
}

/*
@description: Looks up an Unusual effect's particle id by its display name
(e.g. "Burning Flames"). Matched case-insensitively against the schema's own
effect names - confirmed live: scrap.tf's tooltip text for an effect doesn't
always match the schema's casing exactly (e.g. "Sixth Sense"), which silently
dropped the particle id (and so the classifieds link's "particle" param) for
an exact-match lookup.

The static table (utils/unusualEffectIds.js) is checked first, same "static
table first, live schema only as a fallback" pattern the REVERSE (id->name)
lookup (getUnusualEffectNameById) uses: it needs no Steam Web API key and
covers nearly every effect; the live schema only matters for an effect added
to TF2 since the table was last regenerated.
See #122.
*/
export async function getEffectId(effectName) {
  const hardcodedMatch = Object.keys(UNUSUAL_EFFECT_IDS).find((n) => n.toLowerCase() === effectName.toLowerCase());
  if (hardcodedMatch) return UNUSUAL_EFFECT_IDS[hardcodedMatch];

  const schema = await getSchemaMaps();
  if (!schema?.effectNameToId) return null;
  const matchedName = Object.keys(schema.effectNameToId).find((n) => n.toLowerCase() === effectName.toLowerCase());
  return matchedName ? schema.effectNameToId[matchedName] : null;
}

/*
@description: The reverse of getEffectId - looks up an Unusual effect's
display name by its numeric particle id. Used by
posts.tf/itemQuickLinks/content.js as a FALLBACK, only when
utils/unusualEffectIds.js's own static, no-API-key-needed table doesn't have
an entry for the id. That table only changes when
scripts/updateUnusualEffects.js is re-run, so it lags behind each TF2 update
that adds effects; a live schema lookup (when a key IS configured) covers
exactly that gap.
Returns null (not a guess) when the schema hasn't loaded, same as a genuine
no-match - same cost/gap every other name<->id lookup in this file already
has.
*/
export async function getEffectNameById(effectId) {
  const schema = await getSchemaMaps();
  if (!schema?.effectNameToId) return null;
  const matchedName = Object.keys(schema.effectNameToId).find((n) => schema.effectNameToId[n] === effectId);
  return matchedName || null;
}

/*
@description: Returns the full effect name -> particle id map, for callers
that need to search which known effect name is contained in an item name -
notably utils/tf2StatsLinks/unusual.js's own resolveUnusualEffect, the
shared resolution path most of this extension's own Unusual-effect links
(stats, classifieds, marketplace.tf, the item quick-link rows) go through.

The static table (utils/unusualEffectIds.js) is the base, with the live
schema's own entries layered on top (only actually contributing anything for
a brand-new effect the table doesn't have yet - see that table's own header
note), so this works without a Steam Web API key.
See #123.
*/
export async function getEffectNameToIdMap() {
  const schema = await getSchemaMaps();
  return { ...UNUSUAL_EFFECT_IDS, ...(schema?.effectNameToId || {}) };
}

/*
@description: Returns the full effect name -> category ("hat"/"taunt"/
"weapon") map, for a caller that needs to classify many effect entries on one
page (e.g. the /effects list pages) without a separate case-insensitive scan
per entry - the /effects pages' own effect names are read straight off the
schema-backed markup already, so an exact-key lookup against this map is
enough there.
*/
export async function getEffectNameToCategoryMap() {
  const schema = await getSchemaMaps();
  return schema?.effectNameToCategory || {};
}
