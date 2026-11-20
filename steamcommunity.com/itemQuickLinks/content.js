/*
@description: Adds a
next.backpack.tf:/backpack.tf:/gladiator.tf/pricedb.io/stntrading.eu/marketplace.tf/mannco.store/Steam
Market quick-link block next to an item's title on a steamcommunity.com
inventory page - same link set (and shared
resolveStatsAndClassifieds/createSteamMarketLink logic) as
steamcommunity.com/marketListingLinks and steamcommunity.com/marketListingModal
already use on the Market listing page (with Unusual effect/Killstreak
attribute/paint filtering, not just the bare item name) - plus
gladiator.tf/pricedb.io/mannco.store, mirroring backpack.tf's own item hover
tooltip/popover (backpack.tf/nextUI/addGladiatorButton,
backpack.tf/nextUI/addPricedbButton, backpack.tf/oldUI/addMannStoreButton - see
each's own header note for the confirmed-live URL schemes), built here straight
off resolveStatsAndClassifieds' own resolved itemName/classifiedsFilters
instead of re-deriving them from page DOM the way those tooltip/popover
versions had to - this page already resolves all of it for the
marketplace.tf/Steam Market links above. stntrading.eu added right before
marketplace.tf, same relative placement every other port of this button already
uses (utils/tf2StatsLinks/index.js's buildStnTradingHref). Both button rows render
compact (smaller padding/font, tighter gap - see buildLinksBlock's own note) so
all 7 buttons still fit across the same 2 rows once stntrading.eu joined them.
*/
import {
  resolveStatsAndClassifieds,
  createSteamMarketLink,
  isUnusualEffectIdUnresolved,
  isPostsTfUnresolved,
  buildStnTradingHref,
  buildPricedbSearchName,
  buildGladiatorHref,
} from "../../utils/tf2StatsLinks/index.js";
import { getPlayerItemsById } from "../../utils/tf2PlayerItems.js";
import { isSheenKillstreakerFilterEnabled, SHEEN_KILLSTREAKER_FILTER_ENABLED_KEY } from "../../utils/sheenKillstreakerFilterSetting.js";
import { findItemPicture, showEffectBehindPicture } from "../shared/itemEffectBackground.js";
import { getItemNameByDefindex, hasSteamApiKey } from "../../utils/tf2Schema.js";
import { QUALITY_NAME_BY_ID, QUALITY_COLOR_BY_NAME } from "../../utils/tf2Quality.js";
import { searchPricedbSkuStatus } from "../../utils/pricedb.js";
import {
  applyApiKeyHint,
  applyPostsTfKeyHint,
  fillPricedbSlot,
  STATS_KEY_HINT_LABEL,
  STATS_KEY_HINT_TITLE,
} from "../../utils/linkButtonStates.js";
import { createStatsRow, iterateLeafTexts, findLabeledValue } from "../shared/priceWidgets.js";
import { isEnglishSteamPage, getAssetClassIds, fetchEnglishDescription, buildEnglishItemPanel } from "../shared/englishItemDescription.js";
import {
  createButtonLink,
  createDisabledButtonLink,
  createPricedbLoadingSlot,
  buildButtonRow,
  buildMannStoreHref,
} from "../shared/quickLinkButtons.js";

const LINKS_CLASS = "tf2te-market-links";
const LOADING_CLASS = "tf2te-market-links-loading";

// Shared by every place that clears this feature's own UI before showing
// something else (the real links, the loading notice, or nothing at all) -
// kept as one helper so LOADING_CLASS can't be forgotten in any one of those
// call sites the way a plain repeated querySelectorAll(".${LINKS_CLASS}")
// list would risk (same reasoning steamcommunity.com/inventoryMarketActions/
// content.js's own removeExistingActionsUi documents for its equivalent).
function removeExistingLinksUi(container) {
  container.querySelectorAll(`.${LINKS_CLASS}, .${LOADING_CLASS}`).forEach((n) => n.remove());
}

// Steam's inventory page hosts every game the account owns (CS2, Steam
// Trading Cards, ...), not just TF2 - everything in this file (Australium/
// killstreak/quality resolution, the schema/GetPlayerItems lookups) is
// TF2-specific and would either no-op or produce nonsense links on another
// game's items, so the whole feature is gated on this.
const TF2_APP_ID = 440;

/*
@description: Reads which game's inventory tab is actually active right now,
preferring the page URL's own "#440"/"#730" hash (confirmed live - see this
file's caller for the exact URLs). Re-read on every call rather than cached
once, since insertQuickLinks/insertMarketActions both already re-run on every
DOM mutation (see steamcommunity.com/content.js's own router) - if Steam's
inventory SPA swaps game tabs via a hash change without a full navigation,
this picks that up the same way; if it's actually a full reload instead, this
content script re-runs from scratch anyway, so either way this always
reflects whichever tab is showing right now.

Falls back to the currently-selected item tile's own
"{appid}_{contextid}_{assetid}" id (same confirmed-live id shape
findActiveAssetId already reads) when the hash doesn't specify an app id at
all - confirmed live: the plain ".../inventory" URL (no "#440"/"#730" at the
end - what a bookmark or typed-in URL normally looks like, as opposed to
explicitly clicking a game tab) still shows a specific game's items without
Steam ever stamping the hash for it, so a hash-only check would block every
feature there.
@returns: the numeric app id, or null if neither source has one.
*/
export function getActiveInventoryAppId() {
  const hashMatch = /^#(\d+)/.exec(window.location.hash);
  if (hashMatch) return Number(hashMatch[1]);

  const activeItem = document.querySelector(".item.activeInfo");
  const parts = activeItem?.id.split("_");
  return parts?.length === 3 ? Number(parts[0]) : null;
}

// TF2's full set of 19 Australium weapons - confirmed via
// https://wiki.teamfortress.com/wiki/Australium_weapons: two per class
// (three for Demoman), introduced in the November 2013 Two Cities Update as
// a rare Mann vs. Machine tour-of-duty reward (a Dec 2014 patch later
// widened that to every Advanced/Expert tour). Keyed by the weapon's own
// resolved base name (from getItemNameByDefindex), not defindex - Steam's
// own GetPlayerItems reports the exact same defindex for an Australium
// weapon as its plain stock version (confirmed live: a Strange Australium
// Minigun's entry has defindex 202, the same one a plain Strange Minigun
// uses - Australium-ness is conveyed entirely through that item's own
// "style" field instead, NOT a separate catalog item), so keying by
// defindex would need each of these 19 confirmed individually. Keying by
// name instead needs only ONE thing confirmed for all of them: which style
// index means Australium - see AUSTRALIUM_STYLE_INDEX's own note.
const AUSTRALIUM_WEAPON_NAMES = new Set([
  "Scattergun",
  "Force-a-Nature",
  "Rocket Launcher",
  "Black Box",
  "Flame Thrower",
  "Axtinguisher",
  "Grenade Launcher",
  "Stickybomb Launcher",
  "Eyelander",
  "Minigun",
  "Tomislav",
  "Frontier Justice",
  "Wrench",
  "Blutsauger",
  "Medi Gun",
  "Sniper Rifle",
  "SMG",
  "Ambassador",
  "Knife",
]);

// Confirmed live (via GetPlayerItems) only for the Minigun - style index 1
// there conveys Australium. Assumed, not independently confirmed, to be the
// same index for the other 18 weapons in AUSTRALIUM_WEAPON_NAMES too, since
// Valve rolled all 19 out together via the same single alternate-style
// mechanism rather than reinventing it per weapon - if a specific one turns
// out to disagree, this can no longer be one shared constant and needs its
// own per-weapon map instead.
const AUSTRALIUM_STYLE_INDEX = 1;

// Steam alternates between two item-detail containers (#iteminfo0/#iteminfo1)
// as the user clicks through inventory items, so the old one can fade out
// while the new one fades in - whichever currently has an <h1> is the one
// actually showing.
export function pickContainer() {
  const c0 = document.querySelector("#iteminfo0");
  const c1 = document.querySelector("#iteminfo1");

  const h0 = c0?.querySelector("h1");
  if (h0) return { container: c0, title: h0 };

  const h1 = c1?.querySelector("h1");
  if (h1) return { container: c1, title: h1 };

  return null;
}

/*
@description: Reads the item panel's title text, the way a user actually
sees it - NOT plain title.textContent, which sums every child node
regardless of visibility. Confirmed live: a marketable item's own <h1> holds
TWO element children with the identical name text - a "doHide"-classed
<span> (Steam's own "display: none" utility class, confirmed live it's also
applied to an unrelated <div role="separator"> in the very same panel) and
the actual visible "customName" <a> (linking to its Steam Market listing) -
so plain textContent doubled the name with no separator in every link this
feature builds (e.g. "Strasbourg ScholarStrasbourg Scholar"), even though
only ONE name is ever visible on the page itself. Skips any "doHide" child
rather than just taking title.children[0]/the <a> specifically, since which
element carries the visible name (a plain <span> vs the "customName" <a>)
depends on whether the item is marketable at all - both shapes are handled
by excluding whichever one is actually hidden instead of guessing a fixed
position or tag name.
@returns: the trimmed, de-duplicated title text.
*/
export function readVisibleTitleText(title) {
  if (title.children.length === 0) return title.textContent.trim();

  let text = "";
  for (const child of title.children) {
    if (child.classList?.contains("doHide")) continue;
    text += child.textContent;
  }
  return text.trim();
}

/*
@description: Same as findLabeledValue (shared/priceWidgets.js), but for a
plain yes/no label with no value of its own to capture (e.g. "Killstreaks
Active").
*/
function findHasLeafText(container, pattern) {
  for (const text of iterateLeafTexts(container)) {
    if (pattern.test(text)) return true;
  }

  return false;
}

function findEffectName(container) {
  return findLabeledValue(container, /^★?\s*Unusual Effect:\s*(.+)$/i);
}

/*
@description: Shows the selected item's Unusual effect behind its large
picture in the item panel, like the grid tiles have (see
../shared/itemEffectBackground.js).
*/
export function showSelectedItemEffect(container, effectName) {
  return showEffectBehindPicture(findItemPicture(container), effectName);
}

function findSheenName(container) {
  return findLabeledValue(container, /^Sheen:\s*(.+)$/i);
}

function findKillstreakerName(container) {
  return findLabeledValue(container, /^Killstreaker:\s*(.+)$/i);
}

/*
@description: A Kit Fabricator's own item panel has no BARE "Sheen: X"/
"Killstreaker: X" leaf line the way an actual Kit/weapon does (findSheenName/
findKillstreakerName above never match anything on one) - its finished Kit's
own fixed Sheen/Killstreaker instead shows up inside its OUTPUT section,
parenthesized on its own leaf line right under the produced Kit's name, e.g.
"(Killstreaker: Fire Horns, Sheen: Mean Green)" (confirmed live via a real
screenshot - a Specialized-tier Fabricator's own Kit has no Killstreaker at
all, so that one would presumably read "(Sheen: X)" alone, not independently
confirmed live). Used as a FALLBACK once the bare-line readers above found
nothing, not tried first - a real Kit/weapon's own bare lines take priority
and this never runs for those (no parenthesized line exists there to match
by accident).
@returns: {sheenName: ?string, killstreakerName: ?string} - both null if no
matching parenthesized line was found at all.

Exported for reuse by steamcommunity.com/marketListingLinks/content.js - a
Fabricator listed on the Market renders the same underlying description
text, so the same fallback applies there too, scoped to that page's own
single item panel instead of this page's container.
*/
export function findFabricatorOutputSheenAndKillstreaker(container) {
  for (const text of iterateLeafTexts(container)) {
    const match = /^\(([^)]+)\)$/.exec(text);
    if (!match) continue;

    let sheenName = null;
    let killstreakerName = null;
    for (const part of match[1].split(",")) {
      const sheenMatch = /^\s*Sheen:\s*(.+?)\s*$/i.exec(part);
      if (sheenMatch) sheenName = sheenMatch[1];
      const killstreakerMatch = /^\s*Killstreaker:\s*(.+?)\s*$/i.exec(part);
      if (killstreakerMatch) killstreakerName = killstreakerMatch[1];
    }
    if (sheenName || killstreakerName) return { sheenName, killstreakerName };
  }

  return { sheenName: null, killstreakerName: null };
}

// Matches Steam's own "Halloween: {name} (spell only active during event)"
// label shape. An item can carry MORE than one Spell line at once, but this
// still only returns the FIRST one found, same limitation every other
// known* option here already has for a single value, and the only one
// backpack.tf's/marketplace.tf's own single-spell filter params could use
// anyway. See #61.
function findSpellName(container) {
  return findLabeledValue(container, /^Halloween:\s*(.+?)\s*\(spell only active during event\)$/i);
}

// Matches Steam's own "Paint Color: {name}" label shape (e.g. "Paint Color:
// The Value of Teamwork", or "Paint Color: Color No. 216-190-216" for a
// paint with no friendly name of its own - both are real PAINT_IDS table
// entries in utils/tf2StatsLinks/index.js, no separate parsing needed for
// the "Color No. R-G-B" form). resolvePaintIdForMarketplace's own Unusual
// exclusion (see that function's own callers in resolveClassifiedsFilters)
// still applies unchanged - this only fixes DETECTING the name at all. See #62.
function findPaintName(container) {
  return findLabeledValue(container, /^Paint Color:\s*(.+)$/i);
}

// Straight, curly, and single-quote variants - not independently confirmed
// live which one Steam actually renders for this particular notice, so all
// of the plausible ones are accepted rather than guessing one.
const QUOTE_CHARS = `"'“”‘’`;
const RENAME_NOTICE_PATTERN = new RegExp(`^This item has been renamed\\.?\\s*Original name:\\s*[${QUOTE_CHARS}](.+?)[${QUOTE_CHARS}]$`, "i");

/*
@description: Finds Steam's OWN "This item has been renamed[.]\nOriginal
name: X" notice text, or null if it isn't present at all (a plain item never
shows this).

This does NOT sit in a pure-text leaf div the way
iterateLeafTexts/findLabeledValue (shared/priceWidgets.js, used by every
OTHER label reader in this file - findEffectName/findSheenName/etc.) require
- Steam wraps a decorative <svg> icon in the SAME div as the text
("<div><svg>...</svg>This item has been renamed.\nOriginal name:
\"X\"</div>"), which iterateLeafTexts' own child-element skip would wrongly
disqualify (that skip exists to avoid matching a WRAPPER's
garbage-concatenated text from unrelated sibling leaves), even though this
div's only non-text child (the icon) contributes nothing to its own
textContent. So this scans every div's own full textContent directly instead,
matched case-insensitively against just the "This item has been renamed"
prefix (not FULL RENAME_NOTICE_PATTERN below) so a wrapping ancestor div
(whose own textContent happens to equal the same text, since it has no other
children/text of its own) matching first is harmless - both give the
identical text.
See #63.
*/
function findRenamedNoticeText(container) {
  for (const el of container.querySelectorAll("div")) {
    const text = el.textContent?.trim();
    if (text && /^This item has been renamed\.?/i.test(text)) return text;
  }

  return null;
}

/*
@description: Whether Steam's OWN "This item has been renamed[.] Original
name: X" notice is present on the page at all - confirmed live via several
screenshots (a custom Name Tag'd item shows this, a plain item never does).
This is the ONE signal gating whether resolveRealItemName's own unresolved
flag can ever be true at all (see that function's own note): a NON-renamed
item's on-page title is already correct, so a failed GetPlayerItems lookup is
a complete non-issue for it, not something worth a "couldn't verify" warning
over.
*/
function isItemRenamed(container) {
  return findRenamedNoticeText(container) != null;
}

/*
@description: Best-effort recovery of a renamed item's REAL base name
straight from Steam's own already-on-the-page notice - no Steam Web API call
needed at all. Used as resolveRealItemName's own second-tier fallback when
GetPlayerItems itself can't be reached (confirmed live: a genuine Web API
outage, not just "no key configured") - strictly better than the item's fake
renamed title, even though (like Steam's own notice itself - see
resolveRealItemName's own header note) it can't convey Quality/Australium the
way GetPlayerItems can.
@returns: the bare recovered name, or null if the notice isn't present, or
is present but didn't match the guessed quote/punctuation shape above (not
independently confirmed live - isItemRenamed's own looser check is what
actually gates the unresolved flag, so a shape mismatch here just means this
particular fallback silently isn't available, not a crash).
*/
function findRenamedOriginalName(container) {
  const text = findRenamedNoticeText(container);
  if (!text) return null;

  const match = RENAME_NOTICE_PATTERN.exec(text);
  return match ? match[1].trim() : null;
}

/*
@description: The BEST available source for an item's real identity -
confirmed live: this item panel's own <h1> "customName" <a> link (the visible
half of the doHide/customName pair readVisibleTitleText's own note documents)
points at a "/market/listings/{appid}/{name}" URL shaped exactly like a real
Steam Market listing, whose name text is Steam's own authoritative
market_hash_name - Quality, Killstreak tier, Australium, AND (unlike every
other source this function has) the Decorated Weapon skin/wear text all
together, in one already-correctly-formatted string. Matched by the link's
own href PATTERN (not its label text, which Steam localizes per display
language) - same "/market/listings/{appid}/{name}" shape
getMarketListingItemNameFromUrl (steamcommunity.com/shared/priceWidgets.js)
already parses off the Market listing PAGE's own URL, reused here against a
link's href instead of window.location.pathname.

Tried before the notice+border-color+API combination below, not just as a
fallback for it - it's strictly more complete than what those can ever
produce together (they have no way to recover a skin at all), and needs no
guessing about quote/punctuation shapes or API access either.

This link is rendered unconditionally by Steam for every item, marketable or
not - still the best NAME source there is (its text is accurate either way),
but its mere presence can't be used as an isMarketable signal - see
resolveIsMarketable below for the actual one.
@returns: the decoded market_hash_name, or null if no such link is found at
all (the one remaining gap: a genuinely un-rendered/absent case, not simply
"non-marketable").

Exported for reuse by steamcommunity.com/inventoryMarketActions/content.js -
this link is Steam's own generic per-item render, present on ANY game's
inventory item panel (not just TF2's), so it's also the correct
market_hash_name source for that feature's own non-TF2 items, which have no
schema/GetPlayerItems-backed resolution of their own to fall back on the way
resolveRealItemName's TF2-specific cases 2-6 below do.
See #64.
*/
export function findMarketListingLinkName(container) {
  for (const link of container.querySelectorAll("a")) {
    const match = /\/market\/listings\/\d+\/([^/?]+)/.exec(link.getAttribute("href") || "");
    if (match) return decodeURIComponent(match[1]);
  }

  return null;
}

// Confirmed live: Steam's item panel carries a hidden ("doHide"-classed, same
// visibility trick as the <h1>'s own duplicate-name span - see
// readVisibleTitleText's own note) "Tags:" line listing this item's own
// attributes as a comma-separated list, including literal "Marketable"/"Not
// Marketable" (and "Tradable"/"Not Tradable") tokens - e.g. "Tags:
// Decorated Weapon, Primary weapon, Pyro, Factory New, Not Tradable, Not
// Marketable" for a non-marketable item, vs "...Tradable, Marketable" for an
// ordinary one.
function findTagsText(container) {
  return findLabeledValue(container, /^Tags:\s*(.+)$/i);
}

// Confirmed live: the same non-marketable item's own description panel also
// carries a plain "( Not Tradable or Marketable )" notice line - checked as a
// fallback source in resolveIsMarketable below, in case the Tags line itself
// isn't found (e.g. a different Steam UI render this hasn't been confirmed
// against).
const NOT_MARKETABLE_NOTICE_PATTERN = /Not\s+(?:Tradable\s+or\s+Marketable|Marketable)/i;

/*
@description: The authoritative isMarketable signal - see
findMarketListingLinkName's own note on why that link's mere presence can't
be trusted for this (it's rendered for every item, marketable or not).
Prefers the "Tags:" line's own explicit "Marketable"/"Not Marketable" token;
falls back to scanning for the "( Not Tradable or Marketable )" notice text
if Tags itself wasn't found; falls back to `fallbackWhenUnknown` (the
caller's own best guess) only if NEITHER signal is present at all - defensive
against a page state neither has been confirmed against, rather than
asserting an outright guess.
@returns {boolean}
*/
function resolveIsMarketable(container, fallbackWhenUnknown) {
  const tagsText = findTagsText(container);
  if (tagsText) {
    if (/\bNot Marketable\b/i.test(tagsText)) return false;
    if (/\bMarketable\b/i.test(tagsText)) return true;
  }

  for (const text of iterateLeafTexts(container)) {
    if (NOT_MARKETABLE_NOTICE_PATTERN.test(text)) return false;
  }

  return fallbackWhenUnknown;
}

// A permanently non-craftable item (a Halloween/promotional cosmetic that
// can never be crafted at all, unlike an ordinary item someone
// crafted-non-craftable themselves) never carries the usual "Non-Craftable "
// prefix in its own on-page title - Steam's real convention only ever adds
// that prefix for the second case. The item's own description panel carries
// a plain "( Not Usable in Crafting )" notice line instead - the same phrase
// createSteamMarketLink's own marketFilterTerms already uses for an ORDINARY
// non-craftable item's Steam Market search term (unrelated to this DOM read
// - that's a hardcoded string literal it always uses once it already knows
// isNonCraftable is true, not something parsed off the page). See #65.
const NOT_USABLE_IN_CRAFTING_PATTERN = /Not\s+Usable\s+in\s+Crafting/i;

function isPermanentlyNonCraftable(container) {
  for (const text of iterateLeafTexts(container)) {
    if (NOT_USABLE_IN_CRAFTING_PATTERN.test(text)) return true;
  }
  return false;
}

/*
@description: Prepends the "Non-Craftable " prefix Valve's own naming
convention uses (before any quality word, per
utils/tf2StatsLinks/common.js's own stripCraftabilityPrefix note) onto
itemName when isPermanentlyNonCraftable found the DOM notice AND the name
doesn't already carry that prefix (an item crafted non-craftable BY the
owner already has it baked into its own real name, via
resolveRealItemName/the on-page title either way - nothing to add there).
Fixing the shared SOURCE STRING here, once, means every downstream consumer
in utils/tf2StatsLinks/index.js benefits automatically through their own
EXISTING "Non-Craftable " prefix handling, rather than needing this same fix
threaded separately into each one's own independent derivation.
@returns {string} itemName, or itemName with the prefix added.
*/
function withPermanentNonCraftablePrefix(itemName, container) {
  if (/^Non-Craftable\s+/i.test(itemName)) return itemName; // already has it
  return isPermanentlyNonCraftable(container) ? `Non-Craftable ${itemName}` : itemName;
}

// Confirmed live: Steam marks an item's own entry in its Collection list
// with EITHER a "✔ " or a "★ " prefix depending on the Collection's own
// display style (e.g. "✔ Dead Reckoner Revolver" vs "★ Freedom Wrapped War
// Paint") - there's no way to tell in advance which one a given item's own
// Collection uses, so both are checked.
const COLLECTION_MARKER_PATTERN = /^[✔★]\s*(.+)/;

/*
@description: A fallback signal once findMarketListingLinkName above found
nothing (a non-marketable/non-tradable item has no Community Market link at
all) - confirmed live: Steam's own item panel lists every skin in a
Decorated Weapon's Collection, marking THIS item's own entry with a marker
prefix (see COLLECTION_MARKER_PATTERN's own note) ahead of its name among
otherwise-unmarked collection entries.

A Collection entry is the War Paint's OWN catalog name, which always ends in
the literal " War Paint" (e.g. "✔ Smissmas Sweater War Paint") - it never
contains the weapon name at all, only the skin's. Same underlying finding as
resolveRealItemName's own note, from this function's own side. Callers now
only use this as a boolean "does a Collection marker exist for this item at
all" signal, or combine it (after stripping the literal " War Paint" suffix)
with a weapon name recovered some other way - see each caller's own note.

"★ " is NOT exclusive to the Collection list - an Unusual item's own effect
line uses the exact same glyph right above it ("★ Unusual Effect: Hot").
Excluding any match whose own text contains "Effect:" (Steam's own fixed
wording for that line - see findEffectName's own labeled-value pattern for
the same text) tells the two apart without needing to locate the Collection
section itself.

Only present at all for a weapon that belongs to a named Collection - a miss
here just means "not a Decorated Weapon" or "no collection to read from", not
a bug.
@returns the raw Collection entry text (the War Paint's own "{Skin} War
Paint" name), or null if no marker was found.
See #17.
See #66.
*/
function findCollectionSkinName(container) {
  for (const el of container.querySelectorAll("div")) {
    const text = el.textContent?.trim();
    if (!text) continue;

    const match = COLLECTION_MARKER_PATTERN.exec(text);
    if (match && !/Effect:/i.test(match[1])) return match[1].trim();
  }

  return null;
}

/*
@description: "Killstreaks Active" is shown for EVERY Killstreak tier,
including Basic (tier 1) - which, unlike Specialized/Professional, has
neither a Sheen nor a Killstreaker line of its own to detect it by. Used
only as the fallback tier signal in resolveKillstreakPrefix below, when
neither a Sheen nor a Killstreaker was found.
*/
function findHasKillstreaksActive(container) {
  return findHasLeafText(container, /^Killstreaks Active$/i);
}

/*
@description: Reads the profile's SteamID64 straight off the inventory
page's own container id ("inventory_{steamid64}_{appid}_{contextid}", e.g.
"inventory_76561198000000000_440_2"), rather than needing to resolve a
vanity URL (.../id/{name}/) or read any page-injected JS global - works the
same regardless of which form the current page's own URL takes.

Checks every "[id^=\"inventory_\"]" match, not just the first - confirmed
live, Steam's own page always includes an "inventory_load_error_ctn" element
too, which also starts with "inventory_" but has no steamid64 in it at all.
It happens to come first in document order, so trusting querySelector's own
first match unconditionally always found that one instead and silently
failed to extract anything.
@returns: the SteamID64 as a string, or null if not found (e.g. the
inventory itself hasn't rendered yet).
*/
export function findSteamId64() {
  for (const el of document.querySelectorAll('[id^="inventory_"]')) {
    const match = /^inventory_(\d+)_\d+_\d+$/.exec(el.id);
    if (match) return match[1];
  }

  return null;
}

/*
@description: Reads the LOGGED-IN VISITOR's own SteamID64 - a completely
different value from findSteamId64 above whenever the page being viewed
isn't the visitor's own (e.g. browsing a friend's inventory while logged in
as yourself: findSteamId64 returns the FRIEND's id, this returns YOUR own).
Steam injects this as a page-global "g_steamID" via an inline <script> tag
on essentially every steamcommunity.com page while logged in (the literal
string "false" when logged out) - since that's a MAIN-world JS global, an
isolated-world content script can never read it as a live variable the way
a page script could, so this scans inline script tags' own raw TEXT for the
assignment instead, the same "read structured text without a MAIN-world
bridge" approach this codebase already uses for fetched HTML elsewhere.

NOT confirmed live - built from established
Steam-page convention, not a guess, but not yet verified against a real
page's actual current markup either.
@returns: the visitor's own SteamID64, or null if not found (logged out, or
Steam's markup has changed).
*/
export function findLoggedInSteamId64() {
  for (const script of document.querySelectorAll("script")) {
    const match = /\bg_steamID\s*=\s*"(\d{17})"/.exec(script.textContent || "");
    if (match) return match[1];
  }

  return null;
}

/*
@description: The currently-selected inventory grid tile - confirmed live,
Steam marks it with its own "activeInfo" class. Both findActiveAssetId (this
element's own stable identity, unaffected by a rename) and
resolveQualityFromActiveTile (this element's own inline border-color, see
that function's own note) read off this SAME tile.
*/
function findActiveItemTile() {
  return document.querySelector(".item.activeInfo");
}

/*
@description: Reads the currently-selected grid item's own asset id straight
off its "{appid}_{contextid}_{assetid}" element id (e.g.
"440_2_16973658616"). This id is a stable identity for the underlying item,
unaffected by a custom Name Tag rename the same way the item's own display
title is.
@returns: the asset id as a string, or null if none is currently selected.
*/
export function findActiveAssetId() {
  const el = findActiveItemTile();
  if (!el?.id) return null;

  const parts = el.id.split("_");
  return parts.length === 3 ? parts[2] : null;
}

/*
@description: Reads the currently-selected grid item's own context id - the
middle segment of the same "{appid}_{contextid}_{assetid}" element id
findActiveAssetId reads (e.g. "2" in "440_2_16973658616"). Exported for
steamcommunity.com/inventoryMarketActions/content.js, which needs this to
build a correct market/sellitem/ + market/multisell request for whichever
game's inventory is actually showing - TF2's own context id (2) can't just be
hardcoded there anymore now that feature isn't TF2-only.
@returns: the context id as a string, or null if none is currently selected.
*/
export function findActiveContextId() {
  const el = findActiveItemTile();
  if (!el?.id) return null;

  const parts = el.id.split("_");
  return parts.length === 3 ? parts[1] : null;
}

// Inventory grid tile border color (its inline "border-color: rgb(r, g, b)"
// style, confirmed live) -> quality name. utils/tf2Quality.js's
// QUALITY_COLOR_BY_NAME already holds Steam's own inventory colors; the one
// addition is Decorated Weapon's near-white #fafafa, which that table leaves
// out because its cards render that quality in the default color.
// Self-Made/Community/Valve are rare enough not to be chased down live - an
// unmatched color is treated as Unique (no quality prefix), the same fallback
// every other quality table here uses.
const STEAM_QUALITY_BORDER_COLORS = {
  ...Object.fromEntries(Object.entries(QUALITY_COLOR_BY_NAME).map(([name, color]) => [color.toLowerCase(), name])),
  "#fafafa": "Decorated Weapon",
};

/*
@description: Converts a computed/inline "rgb(r, g, b)" color string (the
shape Steam's own inline style attribute uses) to a lowercase "#rrggbb" hex
string, for matching against STEAM_QUALITY_BORDER_COLORS' own keys.
@returns: the hex string, or null if colorValue doesn't match that shape.
*/
function rgbStringToHex(colorValue) {
  const match = /rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\s*\)/.exec(colorValue || "");
  if (!match) return null;
  return (
    "#" +
    match
      .slice(1, 4)
      .map((n) => Number(n).toString(16).padStart(2, "0"))
      .join("")
  );
}

/*
@description: Recovers an item's Quality display word straight from its
inventory tile's own border-color (see STEAM_QUALITY_BORDER_COLORS' own
note) - no Steam Web API call needed at all. This is what makes
resolveRealItemName's own DOM-first path viable for a renamed item, not just
its bare name: Steam's own "Original name" notice (findRenamedOriginalName)
recovers the NAME, this recovers the QUALITY, and resolveKillstreakPrefix
(already DOM-only) recovers the Killstreak tier - between the three, only
Australium is still unrecoverable without the API (see this function's own
caller for why).

Confirmed live: a "Strange Unusual"/"Strange Collector's" item's border color
reflects whichever quality takes visual priority (Unusual/Collector's, not
Strange) - a separate "strange" CSS class is layered onto the tile for that
Strange-tracking add-on, NOT read here. This mirrors an EXISTING gap in this
feature's own API-backed path too (entry.quality is a single Valve id with no
"also Strange-tracking" concept bolted on either), so this isn't a new
regression relative to what GetPlayerItems-based resolution already handles.
@returns: the quality name (e.g. "Strange"), or null if the border color
doesn't match any known quality (treated as Unique) or the tile has no
border-color style at all.
*/
function resolveQualityFromActiveTile(tileEl) {
  const style = tileEl.getAttribute("style") || "";
  const match = /border-color:\s*([^;]+)/.exec(style);
  if (!match) return null;

  const hex = rgbStringToHex(match[1].trim());
  return STEAM_QUALITY_BORDER_COLORS[hex] ?? null;
}

/*
@description: Resolves the numeric Killstreak tier (0-3) from DOM signals
only (Sheen/Killstreaker/"Killstreaks Active" presence), since Killstreak
tier is an attribute layered on TOP of an item's own defindex, not something
GetPlayerItems' defindex-based real name recovers on its own the way
Australium is. Valve's fixed rules: ONLY Professional (tier 3) carries a
Killstreaker; Specialized (tier 2) carries a Sheen and no Killstreaker
(Professional has both); neither but "Killstreaks Active" implies Basic
(tier 1). Same mapping as backpack.tf/nextUI/shared/tooltipItemDetails.js's
killstreakTierFromAttributes. Feeds both resolveKillstreakPrefix
below (the real-name reconstruction) and resolveStatsAndClassifieds' own
knownKillstreakTier option (a Decorated Weapon's own Killstreak tier has no
name-text signal of its own to parse from - see that function's own note -
so passing this fixes marketplace.tf/mannco.store's links for a Killstreak
Decorated Weapon).
*/
function resolveKillstreakTier(container, knownSheenName, knownKillstreakerName) {
  if (knownKillstreakerName) return 3;
  if (knownSheenName) return 2;
  if (findHasKillstreaksActive(container)) return 1;
  return 0;
}

const KILLSTREAK_PREFIX_BY_TIER = ["", "Killstreak ", "Specialized Killstreak ", "Professional Killstreak "];

/*
@description: Reconstructs the "{tier prefix}Killstreak " text
utils/tf2StatsLinks/index.js's own resolveClassifiedsFilters already knows how to
strip back out (see stripKillstreakWeaponPrefix there).
@returns: "", "Killstreak ", "Specialized Killstreak ", or "Professional
Killstreak " - ready to prepend straight onto the resolved base name.
*/
function resolveKillstreakPrefix(container, knownSheenName, knownKillstreakerName) {
  return KILLSTREAK_PREFIX_BY_TIER[resolveKillstreakTier(container, knownSheenName, knownKillstreakerName)];
}

/*
@description: The "Australium " prefix for a GetPlayerItems entry, or "".
No text on the page recovers Australium - confirmed live: a renamed item's
own "Original name: X" notice drops it ("Minigun" alone), and the "Tags:"
line never mentions it. It is also NOT a separate defindex: a Strange
Australium Minigun's GetPlayerItems entry has defindex 202, the same as a
plain Strange Minigun - Australium-ness is conveyed entirely via the entry's
own "style" field (see AUSTRALIUM_WEAPON_NAMES/AUSTRALIUM_STYLE_INDEX).
@param {string} baseName - the schema name for the entry's defindex.
@param {{style: ?number}} entry - a getPlayerItemsById entry.
@returns {string} "Australium " or "".
*/
function resolveAustraliumPrefix(baseName, entry) {
  return AUSTRALIUM_WEAPON_NAMES.has(baseName) && entry.style === AUSTRALIUM_STYLE_INDEX ? "Australium " : "";
}

// "Unique" is TF2's unmarked default - never shown as a word, same exclusion
// utils/tf2StatsLinks/index.js's own buildSteamMarketName already applies for the
// same reason. "Decorated Weapon" (QUALITY_NAME_BY_ID's id 15 - the default,
// non-Strange/Unusual variant of a Decorated Weapon or standalone War Paint
// tool) is excluded the same way: unlike every OTHER quality here, it's never
// actually written as a literal word in that item's own name text -
// matchDecoratedWeapon/matchWarPaintTool (utils/tf2StatsLinks/) derive it
// purely from the ABSENCE of a "Strange "/"Unusual " prefix, not from a
// literal "Decorated Weapon " one - excluded here the same way "Unique" is. See #69.
function qualityPrefixFor(qualityName) {
  return qualityName && qualityName !== "Unique" && qualityName !== "Decorated Weapon" ? `${qualityName} ` : "";
}

// A Collection entry's own name is the War Paint's OWN catalog name, which
// always ends in the literal " War Paint" - see findCollectionSkinName's own
// note. Strips that suffix to recover the bare skin name alone (e.g.
// "Smissmas Sweater War Paint" -> "Smissmas Sweater"), ready to be combined
// with a weapon name recovered some other way, never used as a full item
// name by itself.
function stripCollectionWarPaintSuffix(collectionEntryText) {
  return collectionEntryText ? collectionEntryText.replace(/\s+War Paint$/i, "").trim() : null;
}

/*
@description: Resolves this item's REAL identity, DOM-first - the Steam Web
API is only consulted for the one thing no DOM signal can convey (Australium
- see resolveAustraliumPrefix's own note), and then only for the small,
fixed set of weapons that can actually carry it (AUSTRALIUM_WEAPON_NAMES), so
an API outage never takes down name resolution for everything else.

Cases, in order of decreasing accuracy:
  1. Market link - tried FIRST, UNCONDITIONALLY, not gated on isRenamed.
     isRenamed only tells you Steam's OWN rename notice is showing - it says
     nothing about whether a Decorated Weapon's own title text omits
     Quality/Killstreak words, which it always does regardless of rename
     status. Safe to try unconditionally: a correct title's own market link
     just decodes back to that exact same text.
  2. Not renamed, no market link (the rare non-marketable item) - the
     on-page title is the best available text. For a Decorated Weapon (a
     Collection marker is present) the title gets its missing
     Quality/Killstreak prefix prepended; otherwise name is null and the
     caller keeps the title as-is.
  3. Renamed, DOM-only: Steam's own "This item has been renamed. Original
     name: X" notice (findRenamedOriginalName) recovers the bare name, the
     active grid tile's own border-color (resolveQualityFromActiveTile)
     recovers Quality, and the Sheen/Killstreaker lines
     (resolveKillstreakPrefix) recover Killstreak tier - no Steam Web API
     needed. Returned directly for every weapon that isn't
     Australium-eligible.
  4. Renamed, Australium-eligible: the case-3 result is correct except
     possibly missing "Australium " - a targeted GetPlayerItems + schema
     call settles that. Its full reconstruction is used when it succeeds;
     the case-3 result is the fallback when it doesn't (still far better
     than the item's fake renamed text).
  5. Renamed, and case 3 recovered nothing (the notice's guessed
     quote/punctuation shape didn't match) - the API is tried as a last
     resort.
  6. Giving up - a renamed item where NEITHER DOM nor the API recovered
     anything. Every link built from the raw on-page title would use its
     fake renamed text, so the caller shows NO buttons at all rather than a
     confidently-wrong set - see insertQuickLinks' own unresolved branch.
@returns {Promise<{name: ?string, unresolved: boolean, isMarketable: boolean}>}
unresolved is true only in case 6. isMarketable (see resolveIsMarketable) is
the one signal callers have for whether a Steam Market button/link is worth
showing at all (see insertQuickLinks' own steamMarketHref) - the same value
is returned whichever case recovered the name, since it's an orthogonal fact
about the item.
See #67.
See #68.
*/
export async function resolveRealItemName(container) {
  const knownSheenName = findSheenName(container);
  const knownKillstreakerName = findKillstreakerName(container);
  const killstreakPrefix = resolveKillstreakPrefix(container, knownSheenName, knownKillstreakerName);

  // Case 1 (market link) - see this function's own header note on why this
  // is tried before even checking isRenamed. isMarketable is resolved
  // separately (see resolveIsMarketable's own note on why marketLinkName's
  // mere presence can't be used for that), using marketLinkName's
  // presence only as the last-resort fallback when neither the Tags line nor
  // the "( Not Tradable or Marketable )" notice was found at all.
  const marketLinkName = findMarketListingLinkName(container);
  const isMarketable = resolveIsMarketable(container, !!marketLinkName);
  if (marketLinkName) {
    return { name: marketLinkName, unresolved: false, isMarketable };
  }

  const renamedOriginalName = findRenamedOriginalName(container);
  const isRenamed = renamedOriginalName != null || isItemRenamed(container);

  // Case 2.
  if (!isRenamed) {
    // A non-marketable (untradeable) item has no Community Market link (case
    // 1) to recover a complete name from, and since it also isn't renamed, a
    // Decorated Weapon's own on-page title (which never carries a
    // Quality/Killstreak prefix at all - only the market_hash_name does,
    // same gap matchDecoratedWeapon's own note documents) is reconstructed
    // with that prefix rather than trusted as-is.
    //
    // The item's own on-page title (read fresh here, straight off
    // container's own <h1> - NOT the caller's displayName, which was
    // captured before this async work and could be stale for a different
    // selection by now) is ALREADY the correct "{skin}{weapon}" concatenated
    // text for a Decorated Weapon - the ONLY thing genuinely missing from it
    // is the Quality/Killstreak prefix. findCollectionSkinName is used
    // purely as a boolean "yes, this item has a skin and belongs to a named
    // Collection" signal confirming a prefix is worth prepending, not as the
    // name source itself. A miss here (no Collection marker at all - not
    // every item belongs to one) falls back to the original untouched
    // behavior. See #16.
    const hasCollectionEntry = !!findCollectionSkinName(container);
    if (hasCollectionEntry) {
      const activeTile = findActiveItemTile();
      const qualityName = activeTile ? resolveQualityFromActiveTile(activeTile) : null;
      const titleEl = container.querySelector("h1");
      const rawDisplayName = titleEl ? readVisibleTitleText(titleEl) : null;
      if (rawDisplayName) {
        return {
          name: `${qualityPrefixFor(qualityName)}${killstreakPrefix}${rawDisplayName}`,
          unresolved: false,
          isMarketable,
        };
      }
    }
    return { name: null, unresolved: false, isMarketable };
  }

  // Case 3 (DOM-only) - built even when renamedOriginalName is null, so
  // domName naturally stays null there too and every check below just falls
  // through to the API as the sole remaining source (cases 5/6).
  let domName = null;
  if (renamedOriginalName) {
    const activeTile = findActiveItemTile();
    const qualityName = activeTile ? resolveQualityFromActiveTile(activeTile) : null;
    // The Collection checkmark's own text is the War Paint's own catalog
    // name ("{Skin} War Paint"), never the weapon name. Stripping the
    // literal " War Paint" suffix and COMBINING it with renamedOriginalName
    // reconstructs the correct "{skin}{weapon}" concatenated text
    // matchDecoratedWeapon needs, falling back to the bare
    // renamedOriginalName alone when no Collection marker was found at all
    // (not every item belongs to a named Collection).
    const bareSkinName = stripCollectionWarPaintSuffix(findCollectionSkinName(container));
    const skinPlusWeapon = bareSkinName ? `${bareSkinName} ${renamedOriginalName}` : renamedOriginalName;
    domName = `${qualityPrefixFor(qualityName)}${killstreakPrefix}${skinPlusWeapon}`;
  }

  const needsAustraliumCheck = renamedOriginalName && AUSTRALIUM_WEAPON_NAMES.has(renamedOriginalName);
  if (domName && !needsAustraliumCheck) {
    return { name: domName, unresolved: false, isMarketable };
  }

  // Case 5 or 6 - the API is worth attempting either way (confirming
  // Australium one way or the other, or as the last resort when DOM alone
  // recovered nothing).
  const steamId64 = findSteamId64();
  const assetId = findActiveAssetId();

  if (!steamId64 || !assetId) {
    console.warn("[TF2 Trading Enhancer] itemQuickLinks: couldn't resolve the real item name - no steamId64/assetId found on the page (falling back to the on-page title).");
  } else {
    // Distinguishes "no key configured at all"/"the fetch itself failed"
    // from "this specific asset isn't in the fetched inventory" - the latter
    // would otherwise be indistinguishable from the former (both leave
    // playerItems.get(assetId) undefined), making a genuine per-item
    // resolution bug impossible to tell apart from ordinary missing-key
    // behavior from the console alone.
    const playerItems = await getPlayerItemsById(steamId64);
    const entry = playerItems?.get(assetId);
    const baseName = entry ? await getItemNameByDefindex(entry.defindex) : null;

    if (baseName) {
      const australiumPrefix = resolveAustraliumPrefix(baseName, entry);
      const qualityName = QUALITY_NAME_BY_ID[entry.quality];
      return {
        name: `${qualityPrefixFor(qualityName)}${killstreakPrefix}${australiumPrefix}${baseName}`,
        unresolved: false,
        isMarketable,
      };
    }

    if (!playerItems) {
      console.warn("[TF2 Trading Enhancer] itemQuickLinks: couldn't resolve the real item name - no Steam Web API key configured, or the GetPlayerItems fetch failed (see any warning above) - falling back to the on-page title.");
    } else if (!entry) {
      console.warn(`[TF2 Trading Enhancer] itemQuickLinks: couldn't resolve the real item name - asset id ${assetId} wasn't found in this profile's own GetPlayerItems response - falling back to the on-page title.`);
    } else {
      console.warn(`[TF2 Trading Enhancer] itemQuickLinks: couldn't resolve the real item name - defindex ${entry.defindex} isn't in the cached TF2 schema - falling back to the on-page title.`);
    }
  }

  // The API didn't work either - fall back to the DOM-only result (case 4's
  // own fallback: correct except possibly missing "Australium "), if there
  // was one at all (case 5's own last-resort attempt might have had none).
  if (domName) {
    return { name: domName, unresolved: false, isMarketable };
  }

  // Case 6 - renamed, and NEITHER the market link, DOM, nor the API
  // recovered anything at all.
  return { name: null, unresolved: true, isMarketable };
}

/*
@description: Shown right away, before resolveRealItemName/
resolveStatsAndClassifieds resolve (a GetPlayerItems fetch plus, for an
Unusual/Kit/Fabricator/Strangifier, a cold schema lookup - can take a few
seconds) - without this there was nothing on screen for that whole stretch,
which read as the feature just not working rather than still loading.
*/
function buildLoadingNotice() {
  const notice = document.createElement("div");
  notice.className = LOADING_CLASS;
  notice.style.fontSize = "13px";
  notice.style.color = "#8f98a0";
  notice.textContent = "Loading next.backpack.tf/backpack.tf/gladiator.tf/pricedb.io/marketplace.tf/mannco.store/Steam Market links…";
  return notice;
}

// Shared amber warning-box shell for buildUnresolvedWarning's own two
// message variants below.
function buildWarningEl() {
  const warning = document.createElement("div");
  warning.style.maxWidth = "420px";
  warning.style.padding = "6px 10px";
  warning.style.borderRadius = "4px";
  warning.style.border = "1px solid rgba(255, 193, 7, 0.5)";
  warning.style.background = "rgba(255, 193, 7, 0.12)";
  warning.style.color = "#eaeaea";
  warning.style.fontSize = "12px";
  warning.style.lineHeight = "1.4";
  return warning;
}

/*
@description: Shown INSTEAD OF the usual button set (see insertQuickLinks'
own unresolved branch - resolveRealItemName's own header note explains when
this happens) - phrased differently depending on whether a Steam Web API key
is even configured, since the two have different remedies: no key at all
means the standard "go set one up" key hint every other schema-backed feature
uses (utils/linkButtonStates.js's applyApiKeyHint), where Retry would just
fail again for the same reason every time. A key that IS
configured but still couldn't resolve anything means something else went
wrong - THAT case gets a manual Retry instead (not automatic re-polling -
doesn't risk hammering an already-struggling Steam Web API on a timer, and
puts the user in control of when to try again, same as this codebase's other
manual "Rescan"-style recoveries: stntrading.eu's own Rescan key price).
Clicking Retry clears this container's own "already built" markers (see
insertQuickLinks' own dataset checks) and re-runs insertQuickLinks fresh,
which naturally re-attempts every underlying fetch - neither
getPlayerItemsById nor getSchemaMaps memoize a FAILED result, only a
successful one, so a retry after a genuine failure always tries again rather
than replaying a cached miss.
*/
async function buildUnresolvedWarning(container) {
  const warning = buildWarningEl();

  if (!(await hasSteamApiKey())) {
    // One sentence saying why the panel has no links, plus the same key
    // button every other "needs a key" spot uses (utils/linkButtonStates.js:
    // opens the extension's key settings). No "reload" needed -
    // showItemQuickLinks' own chrome.storage.onChanged listener re-runs this
    // resolution live once a key is saved.
    warning.textContent = "This item has been renamed. Finding out what it really is needs a Steam Web API key, so no links are shown yet.";

    const keyButton = createDisabledButtonLink("Add Steam Web API key", { compact: true });
    applyApiKeyHint(keyButton, {
      label: "Add Steam Web API key",
      title: "Click to add your Steam Web API key (one-time setup). The links appear here on their own once it's saved.",
    });

    const block = document.createElement("div");
    block.style.display = "flex";
    block.style.flexDirection = "column";
    block.style.alignItems = "flex-start";
    block.style.gap = "5px";
    block.append(warning, buildButtonRow([keyButton], null, { compact: true }));
    return block;
  }

  warning.append(
    "⚠️ This item has been renamed, and its real identity couldn't be verified (a Steam Web API request failed) - no quick-links are shown for it, since they'd otherwise be built from its renamed title, not the real item. ",
    buildRetryLink(container)
  );

  return warning;
}

// Clears this container's own "already built" markers (see insertQuickLinks'
// own dataset checks) and re-runs insertQuickLinks fresh.
function buildRetryLink(container) {
  const retryLink = document.createElement("a");
  retryLink.href = "#";
  retryLink.textContent = "Retry";
  retryLink.style.color = "#ffc107";
  retryLink.style.textDecoration = "underline";
  retryLink.style.cursor = "pointer";

  retryLink.addEventListener("click", (e) => {
    e.preventDefault();
    retryLink.textContent = "Retrying…";
    retryLink.style.pointerEvents = "none";
    delete container.dataset.tf2teLinksRequestKey;
    delete container.dataset.tf2teLinksBuildingKey;
    insertQuickLinks();
  });

  return retryLink;
}

/*
@description: Shown INSTEAD OF the button set on a non-English page when the
item's English description couldn't be fetched - every link would otherwise
be built from translated attribute text and search for the wrong item.
*/
function buildEnglishUnavailableWarning(container) {
  const warning = buildWarningEl();
  warning.append(
    "⚠️ Couldn't load this item's details from Steam in English, so no quick-links are shown (on a non-English Steam page they'd otherwise search for the wrong item). ",
    buildRetryLink(container)
  );
  return warning;
}

/*
@description: The English stand-in for the selected item's panel on a
non-English page (see ../shared/englishItemDescription.js for why) - the
selected tile's asset id, its class ids from the page's own inventory data,
then its English description.
@returns {Promise<?Element>} null when any step comes up empty.
*/
async function loadEnglishItemPanel() {
  const parts = findActiveItemTile()?.id.split("_");
  if (parts?.length !== 3) return null;

  const [appid, contextid, assetid] = parts;
  const ids = await getAssetClassIds(appid, contextid, assetid);
  if (!ids) return null;

  const description = await fetchEnglishDescription(appid, ids.classid, ids.instanceid);
  return description ? buildEnglishItemPanel(description) : null;
}

/*
@description: Every attribute insertQuickLinks reads off an item panel -
Steam's real one, or loadEnglishItemPanel's English stand-in.
*/
function readItemSignals(panel) {
  // A Kit Fabricator's own item panel has neither line as a bare "Sheen: X"/
  // "Killstreaker: X" - see findFabricatorOutputSheenAndKillstreaker's own
  // note - so that's tried as a fallback once the bare-line readers find
  // nothing, letting a real Kit/weapon's own bare lines keep taking priority.
  const fabricatorOutputSheenKillstreaker = findFabricatorOutputSheenAndKillstreaker(panel);
  const knownSheenName = findSheenName(panel) || fabricatorOutputSheenKillstreaker.sheenName;
  const knownKillstreakerName = findKillstreakerName(panel) || fabricatorOutputSheenKillstreaker.killstreakerName;

  return {
    knownEffectName: findEffectName(panel),
    knownSheenName,
    knownKillstreakerName,
    knownSpellName: findSpellName(panel),
    knownPaintName: findPaintName(panel),
    knownKillstreakTier: resolveKillstreakTier(panel, knownSheenName, knownKillstreakerName),
    tagsText: findTagsText(panel),
  };
}

/*
@description: Builds the full
next.backpack.tf/backpack.tf/gladiator.tf/pricedb.io/posts.tf/stntrading.eu/marketplace.tf/mannco.store/Steam
Market block. The two button rows (gladiator.tf+pricedb.io+posts.tf, then
stntrading.eu+marketplace.tf+mannco.store+Steam Market) are each their own
row - see this function's own inline note on the pairing. Rendered compact
(smaller padding/font, tighter row gap) so the 4-button second row fits the
item panel's own sidebar width.
@param {string|null} assetId - the currently-selected item's own asset id
(findActiveAssetId) - this exact owned item, not a name/attribute search
like everything else this block links to, so each site's row gets its own
per-item history icon (https://{site}/item/{assetId}) alongside its
existing stats/classifieds icons when this is available.
@param {?string} gladiatorHref - gladiator.tf's own search link, always
buildable once itemName has resolved (no item-type gap, see buildGladiatorHref).
@param {?Element} pricedbSlot - pricedb.io's loading slot
(createPricedbLoadingSlot), settled by insertQuickLinks via fillPricedbSlot
once the block is on the page: the real link, the rate-limit countdown, or
removed for "no listing". null leaves pricedb.io out.
resolved.postsTfHref (already part of resolved, no separate param needed -
see utils/tf2StatsLinks/index.js's own buildPostsTfLink) is null for the
same item-type gaps as backpack.tf/nextUI/addPostsTfButton documents
(Kits/Fabricators/War Paint tools/Decorated Weapons/target-item tools).
@param {?string} mannStoreHref - mannco.store's own filtered-search link, null
for the item-type shapes buildMannStoreHref hasn't been built for yet.
@param {string} stnHref - stntrading.eu's own item page link, always buildable
once itemName has resolved (buildStnTradingHref falls back to Steam's own
market_hash_name for the general case - see its own note), same "never
omitted" treatment every other port of this button already gets.
@param {boolean} hasKey - whether a Steam Web API key is saved. Links that
can't resolve only for lack of one get the compact key hint instead (one
stats/classifieds prompt that also covers posts.tf, or posts.tf's own); with
a key saved, a still-unresolved link is just left out, since a key wouldn't
help.
@returns: the wrapper element, or null if nothing resolved to anything.
*/
function buildLinksBlock({
  resolved,
  steamMarketHref,
  assetId,
  gladiatorHref,
  pricedbSlot = null,
  mannStoreHref,
  stnHref,
  hasKey,
}) {
  const wrapper = document.createElement("div");
  wrapper.className = LINKS_CLASS;
  wrapper.style.marginTop = "8px";
  wrapper.style.display = "flex";
  wrapper.style.flexDirection = "column";
  wrapper.style.alignItems = "flex-start";
  wrapper.style.gap = "5px";

  // bp.tf/next.bp.tf's own stats AND classifieds links both need the exact
  // numeric effect id to point at the SPECIFIC effect this item actually has
  // - see isUnusualEffectIdUnresolved's own note (utils/tf2StatsLinks/
  // index.js) for the full reasoning (shared with stntrading.eu/link2Backpack/
  // content.js's own identical check). Hidden here rather than shown
  // pointing at a generic/wrong page - the key prompt below covers telling
  // the user why.
  const unusualEffectIdUnresolved = isUnusualEffectIdUnresolved(resolved.classifiedsFilters);

  // One compact prompt where the stats rows would be, when only a missing
  // key stands in their way. It covers posts.tf too (see postsTfButton).
  const statsNeedKey = (resolved.statsUnresolved || unusualEffectIdUnresolved) && !hasKey;
  if (statsNeedKey) {
    const keyButton = createDisabledButtonLink(STATS_KEY_HINT_LABEL, { compact: true });
    applyApiKeyHint(keyButton, { label: STATS_KEY_HINT_LABEL, title: STATS_KEY_HINT_TITLE });
    wrapper.appendChild(buildButtonRow([keyButton], null, { compact: true }));
  }

  if (!unusualEffectIdUnresolved) {
    const nextHistoryHref = assetId ? `https://next.backpack.tf/item/${assetId}` : null;
    const classicHistoryHref = assetId ? `https://backpack.tf/item/${assetId}` : null;

    const nextRow = createStatsRow("next.backpack.tf", resolved.nextBpStatsHref, resolved.nextClassifiedsHref, nextHistoryHref);
    if (nextRow) wrapper.appendChild(nextRow);

    const classicRow = createStatsRow("backpack.tf", resolved.bpStatsHref, resolved.classifiedsHref, classicHistoryHref);
    if (classicRow) wrapper.appendChild(classicRow);
  }

  // Two rows: gladiator.tf/pricedb.io on their own (same pairing
  // backpack.tf/nextUI/addGladiatorButton's own row already establishes
  // there), marketplace.tf/mannco.store/Steam Market on theirs (same
  // marketplace.tf+mannco.store pairing
  // backpack.tf/nextUI/addMannStoreButton's own row already establishes -
  // Steam Market has no backpack.tf equivalent to match, so it joins that
  // row here as the third). posts.tf joins this same row, right after
  // pricedb.io (matching backpack.tf/nextUI/addPostsTfButton's own
  // placement) - resolved.postsTfHref already comes for free off the same
  // resolveStatsAndClassifieds call this file already makes (see that
  // function's own header note in utils/tf2StatsLinks/index.js), so no new
  // resolution logic is needed here at all.
  let postsTfButton = null;
  if (resolved.postsTfHref) {
    postsTfButton = createButtonLink("posts.tf", resolved.postsTfHref, { compact: true });
  } else if (!hasKey && !statsNeedKey && isPostsTfUnresolved(resolved.classifiedsFilters, resolved.postsTfHref)) {
    postsTfButton = createDisabledButtonLink("posts.tf", { compact: true });
    applyPostsTfKeyHint(postsTfButton);
  }

  const gladiatorRowButtons = [createButtonLink("gladiator.tf", gladiatorHref, { compact: true }), pricedbSlot, postsTfButton].filter(Boolean);
  if (gladiatorRowButtons.length) wrapper.appendChild(buildButtonRow(gladiatorRowButtons, "3px", { compact: true }));

  // stntrading.eu right before marketplace.tf - same relative placement
  // every other port of this button already uses (see
  // scrap.tf/itemLinks/links.js's own buildStnTradingHref call site).
  const marketplaceRowButtons = [
    createButtonLink("stntrading.eu", stnHref, { compact: true }),
    createButtonLink("marketplace.tf", resolved.marketplaceHref, { compact: true }),
    createButtonLink("mannco.store", mannStoreHref, { compact: true }),
    createButtonLink("Steam Market", steamMarketHref, { compact: true }),
  ].filter(Boolean);
  // No extra marginTop here - wrapper's own flex-column "gap: 5px" already
  // spaces this row from the one above (or from classicRow, if the
  // gladiator.tf/pricedb.io row above was empty).
  if (marketplaceRowButtons.length) wrapper.appendChild(buildButtonRow(marketplaceRowButtons, null, { compact: true }));

  return wrapper.children.length ? wrapper : null;
}

/*
@description: Builds and inserts the links block for whichever item is
currently shown, replacing any previous one. Keyed off a full
"{displayName}|{effectName}|{sheenName}|{killstreakerName}" request key
(not just displayName) - same reasoning as marketListingModal's own
CONTENT_MARKER: clicking through the inventory can land on two different
instances of the very same item name (e.g. two Unusual hats with different
effects) back to back. Built from the on-page DISPLAY title, not
resolveRealItemName's own (async) result - it has to be something available
synchronously, checked and marked BEFORE either await below, so two
mutations firing in quick succession for the same selection (e.g. while
resolveRealItemName's own GetPlayerItems fetch is still in flight) don't
each kick off their own redundant resolve+insert. Re-checked after EACH
await for the same reason every other async build-and-insert in this
codebase does - the user may have already clicked through to a different
item while either was in flight, and that result is then stale.

Critically, the "already done" check ALSO requires the block to still
actually be present in the DOM, not just the key to match: Steam's own later
re-render can wipe the already-inserted block (its own DOM update touching
this same container, arriving after this feature's own insert), and a
marker-only check would then never rebuild it. This runs on every mutation
in the whole page (see steamcommunity.com/content.js's own router), so
re-checking "is it still there" cheaply here means a wipe self-heals on the
very next mutation instead of needing a dedicated watcher.
*/
async function insertQuickLinks() {
  const picked = pickContainer();
  if (!picked) return;

  const { container, title } = picked;

  // Bail out entirely on a non-TF2 inventory tab (see TF2_APP_ID's own
  // note) - also clears out any block this feature already inserted for the
  // previously-active TF2 item, in case Steam's own re-render into this same
  // container didn't wipe it first.
  if (getActiveInventoryAppId() !== TF2_APP_ID) {
    removeExistingLinksUi(container);
    showSelectedItemEffect(container, null);
    return;
  }

  const pageTitleText = readVisibleTitleText(title);
  if (!pageTitleText) return;

  // Confirmed live (Steam in Hungarian): every attribute line is translated,
  // so on a non-English page nothing is read off this panel at all - its
  // English stand-in (loadEnglishItemPanel) is fetched below, and until it
  // arrives only the loading notice shows, never a button built from
  // translated text.
  const needsEnglishPanel = !isEnglishSteamPage();
  let signals = needsEnglishPanel ? null : readItemSignals(container);
  if (signals) showSelectedItemEffect(container, signals.knownEffectName);

  // The "Tags:" line resolveIsMarketable reads can lag a render pass behind
  // the rest of the panel the same way other late-arriving signals on this
  // page already can (see the 120ms title-settle check below). Including it
  // in requestKey means a later mutation that only changes the Tags line
  // (nothing else about the item) is treated as a genuinely different key,
  // so it self-heals on its own, the same way every other known* signal
  // already does for the same reason. See #31. The English stand-in is fixed
  // per asset, so there the asset id stands in for all of them.
  const requestKey = signals
    ? `${pageTitleText}|${signals.knownEffectName ?? ""}|${signals.knownSheenName ?? ""}|${signals.knownKillstreakerName ?? ""}|${signals.knownSpellName ?? ""}|${signals.knownPaintName ?? ""}|${signals.tagsText ?? ""}`
    : `${pageTitleText}|asset:${findActiveAssetId() ?? ""}`;

  // Already building this EXACT key - bail rather than kick off a second,
  // redundant resolve. Keyed by requestKey, not a plain boolean, so a
  // genuinely NEW selection arriving while an OLDER one's build is still in
  // flight isn't blocked by it - only an exact repeat of the same
  // in-progress key is. See #32.
  if (container.dataset.tf2teLinksBuildingKey === requestKey) return;

  // A build that threw is attempted once per selection: the catch below
  // leaves no DOM marker behind, and removing the loading notice is itself a
  // mutation that re-runs this via content.js's observer - without this
  // guard, a persistent failure retried every request on every one of those
  // calls. Selecting a different item (or Retry/a saved API key, which clear
  // tf2teLinksRequestKey) clears it.
  if (container.dataset.tf2teLinksRequestKey !== requestKey) {
    delete container.dataset.tf2teLinksFailedKey;
  } else if (container.dataset.tf2teLinksFailedKey === requestKey) {
    return;
  }

  // Already fully built and still present - nothing to do. (If the block
  // got wiped by Steam's own later re-render, querySelector comes back
  // empty and this falls through to rebuild - see this function's own
  // header note on why that self-heals instead of needing a watcher.)
  if (container.dataset.tf2teLinksRequestKey === requestKey && container.querySelector(`.${LINKS_CLASS}`)) {
    return;
  }

  container.dataset.tf2teLinksBuildingKey = requestKey;
  container.dataset.tf2teLinksRequestKey = requestKey;

  try {
    // Shown right away, before the (potentially slow) resolves below - see
    // buildLoadingNotice's own note on why.
    removeExistingLinksUi(container);
    title.insertAdjacentElement("afterend", buildLoadingNotice());

    // Read once per run, not per button - only gates the mannco.store
    // button's own knownSignals below (resolveStatsAndClassifieds/
    // createSteamMarketLink already gate themselves internally, see
    // resolveClassifiedsFilters' own note). Deliberately does NOT null out
    // knownSheenName/knownKillstreakerName themselves - resolveKillstreakTier
    // above already used the RAW values to detect Basic/Specialized/
    // Professional correctly regardless of this toggle, which only ever
    // suppresses the two SPECIFIC attribute values as search filters, not
    // the coarser tier they're also used to detect. Read AFTER the loading
    // notice is inserted, not before - this is the function's first await,
    // and the notice has to land synchronously first (see buildLoadingNotice's
    // own note on why, and the regression this ordering protects against).
    const sheenKillstreakerFilterEnabled = await isSheenKillstreakerFilterEnabled();

    // Steam can fire several DOM mutations while a newly-selected item's own
    // title is still rendering (see the "already building" note above for a
    // confirmed-live example of that happening on first page load) - reading
    // the title (displayName, above) at exactly the wrong moment risks
    // catching a transitional state where the OLD and NEW title text briefly
    // coexist in the same node. A Botkiller weapon's own quick-links button
    // built a classifieds itemName of "Carbonado Botkiller Knife Mk.I" +
    // "Strange Carbonado Botkiller Knife Mk.I" concatenated with no
    // separator. Confirming the title has actually stopped changing before
    // spending the (potentially slow)
    // resolveRealItemName/resolveStatsAndClassifieds work on it catches this
    // before it happens - bailing here (rather than pressing on) leaves
    // requestKey mismatched against whatever the NEXT mutation computes once
    // the title stabilizes, so that one proceeds normally instead of being
    // blocked as "already built" the way a stuck bad key would.
    //
    // A title that's permanently duplicated (a marketable item's <h1> holds
    // a hidden "doHide" copy of its own name) is a different case, handled
    // by readVisibleTitleText reading only the visible text. Don't add a
    // structural check here (e.g. title.children.length === 1) to catch it:
    // the bail path never inserts a links block, so a check that always
    // fails for a stable title would bail-and-retry on every mutation.
    await new Promise((resolve) => setTimeout(resolve, 120));
    if (readVisibleTitleText(title) !== pageTitleText) {
      container.querySelectorAll(`.${LOADING_CLASS}`).forEach((n) => n.remove());
      return;
    }

    // Everything below reads attributes off `panel` - this page's own, or
    // on a non-English page its English stand-in.
    let panel = container;
    let displayName = pageTitleText;
    if (needsEnglishPanel) {
      panel = await loadEnglishItemPanel();
      if (container.dataset.tf2teLinksRequestKey !== requestKey) return;

      if (!panel) {
        const warningBlock = document.createElement("div");
        warningBlock.className = LINKS_CLASS;
        warningBlock.appendChild(buildEnglishUnavailableWarning(container));
        removeExistingLinksUi(container);
        title.insertAdjacentElement("afterend", warningBlock);
        return;
      }

      signals = readItemSignals(panel);
      displayName = readVisibleTitleText(panel.querySelector("h1")) || pageTitleText;
      showSelectedItemEffect(container, signals.knownEffectName);
    }

    const { knownEffectName, knownSheenName, knownKillstreakerName, knownSpellName, knownPaintName, knownKillstreakTier } = signals;

    // Prefer the real, unrenamed identity when it resolves (see
    // resolveRealItemName's own note on why the on-page title/Steam's own
    // rename notice can't be trusted as-is) - falls back to the display
    // title otherwise (this item isn't renamed at all, so the on-page title
    // is already correct - see that function's own note on why that's the
    // ONLY case unresolved stays false without a real name).
    const { name: realName, unresolved, isMarketable } = await resolveRealItemName(panel);

    if (container.dataset.tf2teLinksRequestKey !== requestKey) return;

    // A renamed item whose real identity couldn't be recovered from EITHER
    // the Steam Web API or Steam's own "Original name" notice. Every link
    // built from itemName below would be built from this item's fake
    // renamed text, indistinguishable on screen from a correctly-resolved
    // one - showing them anyway was actively misleading, not just
    // imprecise, so this shows ONLY the warning (+ Retry, or a "set up a
    // key" prompt - see buildUnresolvedWarning's own note), no button row
    // at all, rather than a full but confidently-wrong set.
    if (unresolved) {
      const warningBlock = document.createElement("div");
      warningBlock.className = LINKS_CLASS;
      warningBlock.appendChild(await buildUnresolvedWarning(container));
      // buildUnresolvedWarning awaits a storage read; a newer item selected
      // meanwhile owns the panel now.
      if (container.dataset.tf2teLinksRequestKey !== requestKey) return;
      removeExistingLinksUi(container);
      title.insertAdjacentElement("afterend", warningBlock);
      return;
    }

    // withPermanentNonCraftablePrefix corrects itemName BEFORE it reaches
    // resolveStatsAndClassifieds/createSteamMarketLink below - fixing this
    // one shared source string, rather than each downstream consumer's own
    // independent "Non-Craftable " prefix derivation separately.
    const itemName = withPermanentNonCraftablePrefix(realName || displayName, panel);

    // pricedb.io is NOT awaited here alongside resolveStatsAndClassifieds:
    // everything else is either synchronous or a (usually cached) schema
    // lookup, while a fresh pricedb.io search pays for a real network round
    // trip, so the rest of the row is shown as soon as
    // resolveStatsAndClassifieds resolves and the pricedb.io button settles
    // afterward via fillPricedbSlot below. knownPaintName is passed into resolveStatsAndClassifieds below
    // (not just threaded into buildMannStoreHref) so classicPaintId/nextPaintId
    // (see that file's own note) actually reflect a Painted item - a real Paint
    // and a "paint"-type Spell (e.g. "Spectral Spectrum") can both apply to the
    // same item at once, see resolveClassifiedsFilters' own note on why neither
    // one excludes the other except for the deliberate Unusual exclusion. A
    // non-marketable item has no Community Market link to recover a full
    // market_hash_name (with its wear tier) from - itemName here may be the
    // Collection-checkmark reconstruction (resolveRealItemName's own case 2
    // extension), which is missing a wear tier by construction.
    // allowSkinWithoutWearTier lets matchDecoratedWeapon still split skin from
    // weapon without one - see that function's own header note on why this is
    // opt-in rather than the default for every caller. See #15. See #18.
    const resolved = await resolveStatsAndClassifieds(itemName, {
      knownEffectName,
      knownSheenName,
      knownKillstreakerName,
      knownSpellName,
      knownKillstreakTier,
      knownPaintName,
      allowSkinWithoutWearTier: !isMarketable,
    });

    if (container.dataset.tf2teLinksRequestKey !== requestKey) return;

    // Gated on isMarketable (resolveRealItemName's own case 1) - the one
    // signal here backed by an actual "View in Community Market" link found
    // on the page, false for every other case. See #71.
    const steamMarketHref = isMarketable && resolved.classifiedsFilters ? createSteamMarketLink(itemName, resolved.classifiedsFilters) : null;
    // gladiator.tf names an Unusual "{Effect} {Item}", same as pricedb.io.
    const gladiatorHref = buildGladiatorHref(buildPricedbSearchName(itemName, resolved.classifiedsFilters));
    const mannStoreHref = resolved.classifiedsFilters
      ? buildMannStoreHref(
          resolved.classifiedsFilters,
          {
            knownEffectName,
            knownSheenName: sheenKillstreakerFilterEnabled ? knownSheenName : null,
            knownKillstreakerName: sheenKillstreakerFilterEnabled ? knownKillstreakerName : null,
            knownPaintName,
          },
          itemName
        )
      : null;
    const stnHref = buildStnTradingHref(itemName, resolved.classifiedsFilters);
    const assetId = findActiveAssetId();
    const hasKey = await hasSteamApiKey();
    if (container.dataset.tf2teLinksRequestKey !== requestKey) return;
    const pricedbSlot = createPricedbLoadingSlot({ compact: true });
    const block = buildLinksBlock({ resolved, steamMarketHref, assetId, gladiatorHref, pricedbSlot, mannStoreHref, stnHref, hasKey });

    removeExistingLinksUi(container);
    if (!block) return;

    title.insertAdjacentElement("afterend", block);

    // A block Steam wipes meanwhile is rebuilt (with its own lookup) by
    // the next mutation, so a disconnected slot is simply dropped.
    fillPricedbSlot(pricedbSlot, {
      lookup: () => searchPricedbSkuStatus(buildPricedbSearchName(itemName, resolved.classifiedsFilters)),
      buildLink: (href) => createButtonLink("pricedb.io", href, { compact: true }),
      isCurrent: () => container.dataset.tf2teLinksRequestKey === requestKey,
    });
  } catch (e) {
    // This function is always called fire-and-forget (see showItemQuickLinks
    // and steamcommunity.com/content.js's own MutationObserver callback), so
    // a failed resolveRealItemName/resolveStatsAndClassifieds (e.g. a
    // transient network error) is caught here - otherwise it would be an
    // unhandled rejection that leaves the "Loading…" notice stuck on screen.
    console.warn("[TF2 Trading Enhancer] itemQuickLinks: failed to resolve links for this item", e);
    // Only when still current, so a newer item's own loading notice or links
    // aren't wiped by this stale failure.
    if (container.dataset.tf2teLinksRequestKey === requestKey) {
      container.dataset.tf2teLinksFailedKey = requestKey;
      removeExistingLinksUi(container);
    }
  } finally {
    // Only clear if we're still the one who set it - a newer call for a
    // different key may have already taken over buildingKey, and clearing
    // it here would wrongly un-mark THAT one as in-flight too.
    if (container.dataset.tf2teLinksBuildingKey === requestKey) {
      delete container.dataset.tf2teLinksBuildingKey;
    }
  }
}

// Live reactivity for a Steam Web API key saved via the popup while this
// page is already open, so no manual reload is needed. Reuses the same
// "clear the cached resolution state, then re-run insertQuickLinks()"
// mechanism the Retry link's own click handler above uses, just triggered by
// a storage change instead of a click. pickContainer() is
// stateless (no captured references), so calling it fresh here to find
// whatever's currently on screen is exactly as safe as the
// mutation-observer-driven calls to insertQuickLinks() this same function
// already receives constantly (see steamcommunity.com/content.js's own
// router).
//
// Guarded to install ONLY ONCE (not per showItemQuickLinks() call) - unlike
// stntrading.eu's own per-page-load link2Backpack(), this function runs on
// EVERY DOM mutation courtesy of that same router's MutationObserver, so a
// "remove old listener, add new one" pattern on every call (the approach
// used there) would churn constantly here. __resetItemQuickLinksReactivityForTests
// exists solely so this file's own test suite can re-arm the guard against a
// fresh fake chrome.storage per test case, the way every other module-scope
// "install once" pattern in this codebase already needs its own reset hook
// for (e.g. utils/tf2Schema.js's own __resetSchemaCacheForTests).
let reactivityListenerInstalled = false;

export function __resetItemQuickLinksReactivityForTests() {
  reactivityListenerInstalled = false;
}

export function showItemQuickLinks() {
  if (!reactivityListenerInstalled) {
    reactivityListenerInstalled = true;
    // Rebuilds the open item's links when the Steam key or the popup's
    // sheen/killstreaker filter setting changes, so toggling the setting
    // applies right away instead of from the next selected item.
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local" || !("steamApiKey" in changes || SHEEN_KILLSTREAKER_FILTER_ENABLED_KEY in changes)) return;

      const picked = pickContainer();
      if (picked) {
        delete picked.container.dataset.tf2teLinksRequestKey;
        delete picked.container.dataset.tf2teLinksBuildingKey;
      }
      insertQuickLinks();
    });
  }

  insertQuickLinks();
}
