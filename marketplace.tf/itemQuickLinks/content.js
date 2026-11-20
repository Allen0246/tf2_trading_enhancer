/*
@description: Adds the same outbound quick-link row this codebase already
builds everywhere else (backpack.tf, gladiator.tf, pricedb.io, posts.tf,
stntrading.eu, mannco.store, Steam Market) onto marketplace.tf's own item
detail page (/items/tf2/{sku}), right below the page's own native
title/button row.

Rendered as a new, visible row (not a collapsed dropdown, unlike
../../scrap.tf/scrapItemsTableLinks/content.js's own "Links ▾" redesign) -
that dropdown exists specifically because ITS page repeats the same 8
buttons down dozens of table rows at once, which genuinely got noisy; this
is a single item's own detail page with a whole page of vertical room and
only ONE row of buttons to show, the same shape every other single-item
page in this codebase (scrap.tf's own hover item card, Steam Market listing
pages, backpack.tf's own /stats pages) already uses a plain visible row for.

Deliberately does NOT include: - marketplace.tf itself - this page IS
marketplace.tf, same reasoning backpack.tf's own /stats page quick-links
never link back to backpack.tf/next.backpack.tf either (see
../../backpack.tf/oldUI/statsPageQuickLinks/content.js's own button list).
next.backpack.tf stats - marketplace.tf's own native "BackpackTF" button
(#btnBackpackTFStats, confirmed live, right next to "Watch Item") already
links there (confirmed live twice). Classic backpack.tf (a
genuinely different destination) is what this row's own "backpack.tf" button
links to instead.

Identity is read straight off that SAME native "BackpackTF" button's own
href (confirmed live:
"https://next.backpack.tf/stats?item=Summer+2026+Cosmetic+Key&craftable=0&quality=6")
rather than scraping .item-title's own text - the title text already has
"Uncraftable "/quality prefixed onto it for display (confirmed live:
"Uncraftable Summer 2026 Cosmetic Key"), which would need its own
re-stripping logic to recover the bare name the href's own "item" param
already gives directly, cleanly, for free - same "prefer a native link's
own query params over scraping title text" principle
../../backpack.tf/nextUI/addPricedbButton/content.js's own header note
documents for a similar case. priceindex (Unusual effect id) and
killstreakTier are read the same way IF marketplace.tf's own generated href
happens to include them for those item types (next.backpack.tf's own
established URL param convention, confirmed live elsewhere in this
codebase - see ../../backpack.tf/nextUI/statsPageQuickLinks/content.js's own
resolveIdentityFromUrl) - NOT independently confirmed live for
marketplace.tf specifically (only the one plain, non-craftable, non-Unusual
example above was confirmed), only assumed; falls back gracefully to
Unique/no tier if either param is genuinely absent from the href for some
item type.

Buttons styled with marketplace.tf's own native ".btn.btn-info.btn-sm"
Bootstrap classes (confirmed live on the page's own "Watch Item"/
"BackpackTF" buttons) rather than this codebase's usual dark custom button
look, so this new row reads as part of the native page instead of a
visually bolted-on extra.
*/

import {
  resolveStatsAndClassifieds,
  createSteamMarketLink,
  isUnusualEffectIdUnresolved,
  isPostsTfUnresolved,
  stripStarMarker,
  buildTargetToolFullName,
  attributeNameForId,
  resolveIdByName,
  buildClassifiedsLink,
  SHEEN_IDS,
  KILLSTREAKER_IDS,
  buildStnTradingHref,
  buildGladiatorHref,
} from "../../utils/tf2StatsLinks/index.js";
import { getEffectNameToIdMap, hasSteamApiKey } from "../../utils/tf2Schema.js";
import { QUALITY_NAME_BY_ID } from "../../utils/tf2Quality.js";
import { resolveTargetToolNameFromTitle } from "../../utils/tf2StatsLinks/targetTool.js";
import { searchPricedbSkuStatus } from "../../utils/pricedb.js";
import { isSheenKillstreakerFilterEnabled } from "../../utils/sheenKillstreakerFilterSetting.js";
import {
  applyApiKeyHint,
  applyLoadingState,
  fillPricedbSlot,
  POSTS_TF_KEY_HINT_TITLE,
  STATS_KEY_HINT_LABEL,
  STATS_KEY_HINT_TITLE,
} from "../../utils/linkButtonStates.js";

const ROW_CLASS = "tf2te-mptf-quick-links-row";
const STYLE_ID = "tf2te-mptf-quick-links-style";
const BUTTON_CLASS = "tf2te-mptf-quick-link-button";
const PAIR_CLASS = "tf2te-mptf-quick-link-pair";
// The 📰 next.backpack.tf classifieds half joined onto marketplace.tf's own
// "BackpackTF" button (which opens next.backpack.tf stats), and the class
// that squares that native button's right corners to meet it.
const NATIVE_CLASSIFIEDS_CLASS = "tf2te-mptf-native-bptf-classifieds";
const NATIVE_JOINED_CLASS = "tf2te-mptf-native-bptf-joined";
// The per-row "📰 next | 📰 classic" split button in the Item List (one row
// per listed copy of this item), each filtered to that row's own
// Sheen/Killstreaker.
const ROW_COMBO_CLASS = "tf2te-mptf-row-combo";
const ITEM_LIST_ROW_SELECTOR = "#items-list table tbody tr";
// Set on #items-list while the per-row buttons are on, to give the Actions
// column room for them (see its CSS).
const ROW_COMBOS_ON_CLASS = "tf2te-mptf-row-combos-on";
const CLASSIFIEDS_ICON_CLASS = "tf2te-mptf-quick-link-classifieds";
const TITLE_CONTAINER_SELECTOR = ".item-title-container";
// Confirmed live - see this file's own header note on why identity is read
// off this button's own href rather than .item-title's text.
const BACKPACKTF_BUTTON_SELECTOR = "#btnBackpackTFStats";

// Rewritten when it differs, not just added once: after an extension update
// the page can still hold the previous version's <style> (same id), and its
// old rules would otherwise stay in force until the page is refreshed.
function ensureStyleInjected() {
  let style = document.getElementById(STYLE_ID);
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    document.head.appendChild(style);
  }
  if (style.textContent !== STYLE_TEXT) style.textContent = STYLE_TEXT;
}

const STYLE_TEXT = `
    .${ROW_CLASS} {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      padding: 10px 20px;
      /* Matches the blue divider separating the "Item Details" header bar
         from the page's title/button row above (a best-effort color match,
         not verified pixel-for-pixel). */
      border-bottom: 1px solid #2e6da4;
    }
    /* The backpack.tf stats button and its 📰 classifieds button drawn as
       one split button (same as mannco.store's row):
       the inner corners are squared and the two share a softer divider. */
    .${ROW_CLASS} .${PAIR_CLASS} {
      display: inline-flex;
    }
    .${ROW_CLASS} .${PAIR_CLASS} > .${BUTTON_CLASS}:first-child {
      border-top-right-radius: 0;
      border-bottom-right-radius: 0;
    }
    .${ROW_CLASS} .${PAIR_CLASS} > .${CLASSIFIEDS_ICON_CLASS} {
      margin-left: -1px;
      border-top-left-radius: 0;
      border-bottom-left-radius: 0;
      border-left-color: rgba(255, 255, 255, 0.35);
    }
    /* The same split look on marketplace.tf's own BackpackTF button. The
       native button stays where it is (never moved or wrapped); ours sits
       right after it, so !important only overrides spacing the page's own
       button row may give its children. */
    #btnBackpackTFStats.${NATIVE_JOINED_CLASS} {
      border-top-right-radius: 0;
      border-bottom-right-radius: 0;
    }
    /* On the same line as the native buttons, with a little more room
       before it than they have between them. The Actions cell stays on one
       line; the room comes from the key price having moved into the Price
       cell (../keyPriceDisplay/content.js) instead of its own column. */
    .${ROW_COMBO_CLASS} {
      display: inline-flex;
      margin-left: 8px;
      vertical-align: middle;
    }
    #items-list.${ROW_COMBOS_ON_CLASS} table td:last-child {
      white-space: nowrap;
    }
    .${ROW_COMBO_CLASS} > a:first-child {
      border-top-right-radius: 0;
      border-bottom-right-radius: 0;
    }
    .${ROW_COMBO_CLASS} > a + a {
      margin-left: -1px;
      border-top-left-radius: 0;
      border-bottom-left-radius: 0;
      border-left-color: rgba(255, 255, 255, 0.35);
    }
    .${NATIVE_CLASSIFIEDS_CLASS} {
      margin-left: -1px !important;
      border-top-left-radius: 0;
      border-bottom-left-radius: 0;
      border-left-color: rgba(255, 255, 255, 0.35);
    }
`;

const KILLSTREAK_TIER_PREFIXES = { 3: "Professional Killstreak ", 2: "Specialized Killstreak ", 1: "Killstreak ", 0: "" };

// Same reconstruction ../../backpack.tf/oldUI/addPricedbButton/content.js's
// own buildItemNameRaw documents, just fed this page's own resolved
// identity instead of a popover's data-* attributes.
function buildItemNameRaw(itemName, qualityId, { isNonCraftable, killstreakTier, isAustralium, isFestivized, knownEffectName }) {
  const qualityName = QUALITY_NAME_BY_ID[qualityId];
  const craftPrefix = isNonCraftable ? "Non-Craftable " : "";
  const isUnusual = qualityName === "Unusual";
  const qualityPrefix = isUnusual
    ? knownEffectName
      ? `${knownEffectName} `
      : "Unusual "
    : qualityName && qualityName !== "Unique"
      ? `${qualityName} `
      : "";
  // "Festivized" right after the quality, where the shared resolver reads it
  // ("Strange Festivized Professional Killstreak Australium Force-a-Nature",
  // confirmed live there).
  const festivizedPrefix = isFestivized ? "Festivized " : "";
  const killstreakPrefix = KILLSTREAK_TIER_PREFIXES[killstreakTier] ?? "";
  // "Australium" sits between the killstreak tier and the weapon, the order
  // backpack.tf's own stats names use ("Strange Professional Killstreak
  // Australium Rocket Launcher"). Skipped if the item param already says it.
  const australiumPrefix = isAustralium && !/^Australium\s/i.test(itemName) ? "Australium " : "";
  return `${craftPrefix}${qualityPrefix}${festivizedPrefix}${killstreakPrefix}${australiumPrefix}${itemName}`;
}

/*
@description: Reads identity straight off the native "BackpackTF" button's
own href - see this file's own header note on why, and on priceindex/
killstreakTier not being independently confirmed live for this site.
Returns null when the required item/quality params aren't found - markup/
URL shape changed, don't guess.
*/
function resolveIdentityFromBackpackTfHref(href) {
  const url = new URL(href, window.location.href);
  const itemName = url.searchParams.get("item");
  const qualityIdRaw = url.searchParams.get("quality");
  if (!itemName || qualityIdRaw === null) return null;
  const qualityId = Number(qualityIdRaw);
  if (Number.isNaN(qualityId)) return null;

  const isNonCraftable = url.searchParams.get("craftable") === "0";
  const killstreakTierRaw = url.searchParams.get("killstreakTier");
  const killstreakTier = killstreakTierRaw ? Number(killstreakTierRaw) : 0;
  const priceindexRaw = url.searchParams.get("priceindex");
  const knownEffectId = QUALITY_NAME_BY_ID[qualityId] === "Unusual" && priceindexRaw ? Number(priceindexRaw) : null;
  // The item param is the bare weapon ("Rocket Launcher"); Australium is its
  // own flag, next.backpack.tf's "australium=1" convention; without it an
  // Australium would get the plain weapon's links.
  const isAustralium = url.searchParams.get("australium") === "1";
  // Not seen in this href yet; read in case marketplace.tf includes it (the
  // page title is the confirmed source, see isFestivizedTitle).
  const isFestivized = url.searchParams.get("festivized") === "1";
  // Sheen/Killstreaker as next.backpack.tf's own ids (confirmed live:
  // "...&killstreakTier=3&sheen=7&killstreaker=2004" for a Hot Rod/Tornado
  // Professional Killstreak Black Box, matching its "Sheen: Hot Rod" /
  // "Killstreaker: Tornado" description lines), so every link can filter by
  // them.
  const knownSheenName = attributeNameForId(SHEEN_IDS, url.searchParams.get("sheen"));
  const knownKillstreakerName = attributeNameForId(KILLSTREAKER_IDS, url.searchParams.get("killstreaker"));

  return { itemName, qualityId, isNonCraftable, killstreakTier, isAustralium, isFestivized, knownEffectId, knownSheenName, knownKillstreakerName };
}

// The BackpackTF button names a target-item tool by its bare base name only
// (confirmed live for "Apparition's Aspect Strangifier":
// "https://next.backpack.tf/stats?item=Strangifier&quality=6"), so every link
// built from it searched the bare "Strangifier". The page title has the full
// name (confirmed live: <div class="item-title"><span>Apparition's Aspect
// Strangifier</span></div>); resolveTargetToolNameFromTitle checks it.
function resolveTargetToolItemName(itemName, qualityId, titleContainer) {
  const titleText = titleContainer.querySelector(".item-title")?.textContent;
  return resolveTargetToolNameFromTitle(itemName, titleText, QUALITY_NAME_BY_ID[qualityId]) ?? itemName;
}

// The page title names a Festivized item (seen live: "Basic Killstreak
// Festivized Australium Black Box"); the BackpackTF button's href doesn't
// say so, so every link searched as not Festivized.
function isFestivizedTitle(titleContainer) {
  return /\bFestivized\b/i.test(titleContainer.querySelector(".item-title")?.textContent ?? "");
}

// Same reverse-lookup ../../backpack.tf/nextUI/statsPageQuickLinks/content.js's
// own resolveEffectNameById documents in full - resolveUnusualEffect's own
// knownEffectId fast path just echoes back whatever knownEffectName it was
// ALSO given, rather than ever resolving a name from an id itself.
async function resolveEffectNameById(effectId) {
  const effectNameToId = await getEffectNameToIdMap();
  return Object.keys(effectNameToId).find((name) => effectNameToId[name] === effectId) ?? null;
}

// Same "smaller local twin" ../../scrap.tf/scrapItemsTableLinks/content.js's
// own buildMannStoreHref documents (this page has no full item "shape"
// object, just resolveStatsAndClassifieds' own classifiedsFilters) - a
// narrower search than the full Festivized/warpaint-aware version in
// steamcommunity.com/shared/quickLinkButtons.js (scoped to steamcommunity.com,
// so not importable here), but with its two parts that matter most:
// - Australium: "Australium" belongs in the search text, with no quality
//   param - confirmed live: "search=Australium+Rocket+Launcher&killstreak=
//   Professional+Killstreak" for a Strange Professional Killstreak Australium
//   Rocket Launcher. Searching filters.itemName alone ("Rocket Launcher")
//   found the plain weapon.
// - Target-item tool (Strangifier, Chemistry Set): the full name in the
//   search, since filters.itemName is just the generic tool ("Strangifier")
//   - confirmed live: "search=Ghastlierest+Gibus+Strangifier&quality=Unique".
// - Killstreak tier: same param values as that full version's
//   MANNSTORE_KILLSTREAK_PARAM_BY_TIER (confirmed live there); left out for
//   a non-killstreak item.
const MANNSTORE_KILLSTREAK_PARAM_BY_TIER = {
  1: "Killstreak",
  2: "Specialized Killstreak",
  3: "Professional Killstreak",
};

function buildMannStoreHref(filters, itemNameRaw) {
  const params = new URLSearchParams();
  if (filters?.isAustralium) {
    params.set("search", `Australium ${filters.itemName}`);
  } else if (filters?.targetItemName) {
    params.set("search", buildTargetToolFullName(filters.itemName, filters.targetItemName));
    if (filters.quality) params.set("quality", filters.quality);
  } else {
    params.set("search", filters?.itemName ?? itemNameRaw);
    if (filters?.quality) params.set("quality", filters.quality);
  }
  const killstreak = MANNSTORE_KILLSTREAK_PARAM_BY_TIER[filters?.killstreakTier];
  if (killstreak) params.set("killstreak", killstreak);
  // Same value the other mannco.store builders send for a Festivized item.
  if (filters?.isFestivized) params.set("festivized", "Festivized");
  // By name, same params as the shared Steam-side builder (confirmed live:
  // "...&sheen=Hot+Rod&killstreaker=Incinerator"). The filter ids are null
  // when Sheen/Killstreaker filtering is switched off.
  const sheen = attributeNameForId(SHEEN_IDS, filters?.sheenId);
  const killstreaker = attributeNameForId(KILLSTREAKER_IDS, filters?.killstreakerId);
  if (sheen) params.set("sheen", sheen);
  if (killstreaker) params.set("killstreaker", killstreaker);
  return `https://mannco.store/tf2?${params.toString()}`;
}

function buildQuickLinkButton(label, href) {
  const link = document.createElement("a");
  link.href = href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.className = `btn btn-info btn-sm ${BUTTON_CLASS}`;
  link.textContent = label;
  return link;
}

/*
@description: Joins a 📰 next.backpack.tf classifieds half onto
marketplace.tf's own "BackpackTF" button, the same split look as this row's
backpack.tf button. Kept in sync on every row rebuild: updated in place, or
taken off again when there's no classifieds link to give (an Unusual whose
effect id isn't known yet).
*/
function syncNativeBackpackTfClassifieds(nativeButton, classifiedsHref) {
  let classifieds = document.querySelector(`.${NATIVE_CLASSIFIEDS_CLASS}`);
  if (!classifiedsHref) {
    classifieds?.remove();
    nativeButton.classList.remove(NATIVE_JOINED_CLASS);
    return;
  }
  if (!classifieds) {
    classifieds = document.createElement("a");
    classifieds.target = "_blank";
    classifieds.rel = "noopener noreferrer";
    classifieds.className = `btn btn-info btn-sm ${NATIVE_CLASSIFIEDS_CLASS}`;
    classifieds.textContent = "📰";
    classifieds.title = "next.backpack.tf classifieds";
    classifieds.setAttribute("aria-label", "next.backpack.tf classifieds");
    nativeButton.insertAdjacentElement("afterend", classifieds);
  }
  classifieds.href = classifiedsHref;
  nativeButton.classList.add(NATIVE_JOINED_CLASS);
}

// The current item's classifieds filters, for the Item List's per-row
// buttons; null while they shouldn't show (Sheen/Killstreaker filtering
// switched off, nothing resolved yet, or an item shape - Kit, Fabricator,
// War Paint, Decorated Weapon - whose filters aren't a plain item's).
let rowComboBase = null;
let rowComboSignature = null;

function isPlainItemFilters(filters) {
  return !!filters?.itemName && !filters.killstreakKit && !filters.fabricatorKit && !filters.warPaintTool && !filters.decoratedWeapon;
}

/*
@description: One Item List row's Sheen/Killstreaker. Read from the name
cell's hover popover (confirmed live: data-content holds "...Sheen:
Manndarin<br/>Eyes: Singularity<br/>..." - "Eyes" is marketplace.tf's word
for the Killstreaker), falling back to the title's "(Manndarin,
Singularity)" (sheen first). Only names in SHEEN_IDS/KILLSTREAKER_IDS count.
*/
function readRowSheenKillstreaker(row) {
  const content = row.querySelector("td[data-content]")?.getAttribute("data-content") ?? "";
  let sheenId = resolveIdByName(SHEEN_IDS, /Sheen:\s*([^<]+)/i.exec(content)?.[1]?.trim());
  let killstreakerId = resolveIdByName(KILLSTREAKER_IDS, /(?:Eyes|Killstreaker):\s*([^<]+)/i.exec(content)?.[1]?.trim());

  if (!sheenId && !killstreakerId) {
    const title = row.querySelector(".item-html-name")?.textContent ?? "";
    const parts = /\(([^()]+)\)\s*$/.exec(title)?.[1]?.split(",").map((part) => part.trim()) ?? [];
    for (const part of parts) {
      sheenId ||= resolveIdByName(SHEEN_IDS, part);
      killstreakerId ||= resolveIdByName(KILLSTREAKER_IDS, part);
    }
  }
  return { sheenId, killstreakerId };
}

function buildRowComboButton(label, href, title) {
  const link = document.createElement("a");
  link.href = href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.className = "btn btn-primary btn-xs";
  link.textContent = label;
  link.title = title;
  return link;
}

/*
@description: Adds (or refreshes) the per-row "📰 next | 📰 classic" button
on every Item List row whose Sheen or Killstreaker is known. Rows without
either get nothing - their search would just repeat the buttons at the top.
Cheap to re-run on every DOM change: a row already showing a button for the
current item is skipped.
*/
function syncItemListRowCombos() {
  const itemList = document.getElementById("items-list");
  if (itemList) {
    if (rowComboBase) itemList.classList.add(ROW_COMBOS_ON_CLASS);
    else itemList.classList.remove(ROW_COMBOS_ON_CLASS);
  }
  const rows = document.querySelectorAll(ITEM_LIST_ROW_SELECTOR);
  for (const row of rows) {
    const existing = row.querySelector(`.${ROW_COMBO_CLASS}`);
    if (!rowComboBase) {
      existing?.remove();
      continue;
    }
    if (existing?.dataset.tf2teComboFor === rowComboSignature) continue;
    existing?.remove();

    const { sheenId, killstreakerId } = readRowSheenKillstreaker(row);
    if (!sheenId && !killstreakerId) continue;
    const actionsCell = row.querySelector("td:last-child");
    if (!actionsCell) continue;

    const filters = { ...rowComboBase, sheenId, killstreakerId };
    const combo = [attributeNameForId(SHEEN_IDS, sheenId), attributeNameForId(KILLSTREAKER_IDS, killstreakerId)].filter(Boolean).join(" + ");
    const pair = document.createElement("span");
    pair.className = ROW_COMBO_CLASS;
    pair.dataset.tf2teComboFor = rowComboSignature;
    pair.appendChild(buildRowComboButton("📰 next", buildClassifiedsLink(filters, true), `next.backpack.tf classifieds: ${combo}`));
    pair.appendChild(buildRowComboButton("📰 classic", buildClassifiedsLink(filters, false), `backpack.tf classifieds: ${combo}`));
    actionsCell.appendChild(pair);
  }
}

/*
@description: A stats button joined to its site's classifieds search, as one
split button: "{site}" opens stats, the 📰 half opens classifieds (the same
📰 the Steam inventory, stntrading.eu, scrap.tf and mannco.store use).
*/
function buildStatsClassifiedsPair(label, statsHref, classifiedsHref) {
  const pair = document.createElement("span");
  pair.className = PAIR_CLASS;
  pair.appendChild(buildQuickLinkButton(label, statsHref));

  const classifieds = buildQuickLinkButton("📰", classifiedsHref);
  classifieds.classList.add(CLASSIFIEDS_ICON_CLASS);
  classifieds.title = `${label} classifieds`;
  classifieds.setAttribute("aria-label", `${label} classifieds`);
  pair.appendChild(classifieds);
  return pair;
}

/*
@description: One row entry as an element: a real link, a stats + classifieds
split button, or a non-link state from utils/linkButtonStates.js - the key
hint (keyHintTitle) or pricedb.io's loading slot (loading), which
fillPricedbSlot settles later. A plain span without Bootstrap's "disabled"
class, whose pointer-events: none would also block the hover text and the
key hint's click.
*/
function buildRowButton({ label, href, classifiedsHref, keyHintTitle, loading }) {
  if (href && classifiedsHref) return buildStatsClassifiedsPair(label, href, classifiedsHref);
  if (href) return buildQuickLinkButton(label, href);
  const span = document.createElement("span");
  span.className = `btn btn-info btn-sm ${BUTTON_CLASS}`;
  if (keyHintTitle) {
    applyApiKeyHint(span, { label, title: keyHintTitle });
  } else if (loading) {
    applyLoadingState(span, label);
  } else {
    span.textContent = label;
  }
  return span;
}

/*
@description: Resolves and (re)builds the quick-links row for the current
item. Signature is the native BackpackTF button's own href (not just the
page URL) - re-checked after each await below, same "a fast in-app
navigation shouldn't let a slower earlier resolve land after a newer one"
race-guard every other quick-links feature in this codebase already uses.
*/
async function addQuickLinksRow() {
  const titleContainer = document.querySelector(TITLE_CONTAINER_SELECTOR);
  if (!titleContainer) return;

  const backpackTfButton = document.querySelector(BACKPACKTF_BUTTON_SELECTOR);
  if (!backpackTfButton) return; // no identity to resolve from - don't guess

  const href = backpackTfButton.getAttribute("href");
  if (!href) return;

  // Critically, this ALSO requires the row to still actually be present in
  // the DOM, not just the signature to match - a reactive re-render of this
  // container elsewhere (confirmed live for the identical pattern on
  // ../../mannco.store/itemQuickLinks/content.js's own card, same
  // underlying risk here) could wipe the row without touching
  // titleContainer itself, in which case the dataset marker alone would
  // permanently skip rebuilding it - same fix
  // steamcommunity.com/itemQuickLinks/content.js's own header note
  // documents for the identical "buttons sometimes just don't show up" bug
  // there.
  const signature = href;
  if (titleContainer.dataset.tf2teQuickLinksSignature === signature && document.querySelectorAll(`.${ROW_CLASS}`).length > 0) return;
  titleContainer.dataset.tf2teQuickLinksSignature = signature;

  const identity = resolveIdentityFromBackpackTfHref(href);
  if (!identity) return;

  const { qualityId, isNonCraftable, killstreakTier, isAustralium, knownEffectId, knownSheenName, knownKillstreakerName } = identity;
  const itemName = resolveTargetToolItemName(identity.itemName, qualityId, titleContainer);
  const isFestivized = identity.isFestivized || isFestivizedTitle(titleContainer);

  const knownEffectName = knownEffectId != null ? await resolveEffectNameById(knownEffectId) : null;
  if (titleContainer.dataset.tf2teQuickLinksSignature !== signature) return;

  // Two names for an Unusual. resolveStatsAndClassifieds only takes its
  // Unusual branch when the name contains the literal word "Unusual"
  // ("Unusual Connoisseur's Cap"); handed "Phosphorous Connoisseur's Cap" it
  // built a Unique item of that name (seen live: /stats/Unique/Phosphorous
  // Connoisseur's Cap/...). gladiator.tf and pricedb.io want the effect in
  // place of the word instead ("Phosphorous Connoisseur's Cap"). Same for
  // every other item, where the two names are identical. stripStarMarker:
  // the "★" clean-up mannco.store needed, harmless without a star.
  const itemNameRaw = stripStarMarker(buildItemNameRaw(itemName, qualityId, { isNonCraftable, killstreakTier, isAustralium, isFestivized, knownEffectName: null }));
  const searchName = stripStarMarker(buildItemNameRaw(itemName, qualityId, { isNonCraftable, killstreakTier, isAustralium, isFestivized, knownEffectName }));

  // The resolver drops Sheen/Killstreaker itself when the user switched
  // that filtering off in the popup.
  const resolved = await resolveStatsAndClassifieds(itemNameRaw, {
    knownEffectName,
    knownEffectId,
    knownKillstreakTier: killstreakTier,
    knownSheenName,
    knownKillstreakerName,
  });
  if (titleContainer.dataset.tf2teQuickLinksSignature !== signature) return;

  const hasKey = await hasSteamApiKey();
  const sheenKillstreakerFilterOn = await isSheenKillstreakerFilterEnabled();
  if (titleContainer.dataset.tf2teQuickLinksSignature !== signature) return;

  // Nothing below may await: from removing the old row until the new one is
  // in, the row is missing, and any page change in that gap starts another
  // full rebuild (the early-return check above sees no row). An await here
  // once made the two rebuilds trigger each other ~500 times a second
  // (confirmed live: the page kept jumping).
  ensureStyleInjected();
  document.querySelectorAll(`.${ROW_CLASS}`).forEach((el) => el.remove());

  const unusualEffectIdUnresolved = isUnusualEffectIdUnresolved(resolved.classifiedsFilters);

  syncNativeBackpackTfClassifieds(backpackTfButton, unusualEffectIdUnresolved ? null : resolved.nextClassifiedsHref);

  // The Item List's per-row buttons. Hidden with Sheen/Killstreaker
  // filtering switched off: every row would then search the same thing as
  // the buttons above.
  const filters = resolved.classifiedsFilters;
  rowComboBase = !unusualEffectIdUnresolved && isPlainItemFilters(filters) && sheenKillstreakerFilterOn ? filters : null;
  rowComboSignature = signature;
  syncItemListRowCombos();

  // Links that only a missing Steam Web API key blocks get the key hint
  // (utils/linkButtonStates.js); the stats prompt also covers posts.tf, so
  // posts.tf gets no hint of its own then. With a key saved, an unresolved
  // link is just left out, since a key wouldn't help.
  const statsNeedKey = (resolved.statsUnresolved || unusualEffectIdUnresolved) && !hasKey;

  const buttons = [];
  if (statsNeedKey) buttons.push({ label: STATS_KEY_HINT_LABEL, keyHintTitle: STATS_KEY_HINT_TITLE });
  // Classic backpack.tf only: next.backpack.tf stats is marketplace.tf's own
  // native "BackpackTF" button (see this file's header note).
  if (resolved.bpStatsHref && !unusualEffectIdUnresolved) {
    buttons.push({ label: "backpack.tf", href: resolved.bpStatsHref, classifiedsHref: resolved.classifiedsHref });
  }
  buttons.push({ label: "gladiator.tf", href: buildGladiatorHref(searchName) });
  // pricedb.io's own lookup (up to a few requests) doesn't hold the whole
  // row back: its slot shows a loading state and settles once it answers.
  buttons.push({ label: "pricedb.io", loading: true });
  if (resolved.postsTfHref) {
    buttons.push({ label: "posts.tf", href: resolved.postsTfHref });
  } else if (!hasKey && !statsNeedKey && isPostsTfUnresolved(resolved.classifiedsFilters, resolved.postsTfHref)) {
    buttons.push({ label: "posts.tf", keyHintTitle: POSTS_TF_KEY_HINT_TITLE });
  }
  buttons.push({ label: "stntrading.eu", href: buildStnTradingHref(itemNameRaw, resolved.classifiedsFilters) });
  buttons.push({ label: "mannco.store", href: buildMannStoreHref(resolved.classifiedsFilters, itemNameRaw) });
  if (resolved.classifiedsFilters) buttons.push({ label: "Steam Market", href: createSteamMarketLink(itemNameRaw, resolved.classifiedsFilters) });
  if (buttons.length === 0) return;

  const row = document.createElement("div");
  row.className = ROW_CLASS;
  let pricedbSlot = null;
  buttons.forEach((entry) => {
    const el = buildRowButton(entry);
    if (entry.loading) pricedbSlot = el;
    row.appendChild(el);
  });

  // The title container may have been re-rendered while the above was in
  // flight - re-find it fresh rather than trusting the reference captured
  // before the first await.
  const freshTitleContainer = document.querySelector(TITLE_CONTAINER_SELECTOR) || titleContainer;
  freshTitleContainer.insertAdjacentElement("afterend", row);

  fillPricedbSlot(pricedbSlot, {
    lookup: () => searchPricedbSkuStatus(searchName),
    buildLink: (href) => buildQuickLinkButton("pricedb.io", href),
    isCurrent: () => titleContainer.dataset.tf2teQuickLinksSignature === signature && row.isConnected,
  });
}

// Forgets the current item's signature so addQuickLinksRow resolves afresh.
function rebuildRow() {
  const titleContainer = document.querySelector(TITLE_CONTAINER_SELECTOR);
  if (titleContainer) delete titleContainer.dataset.tf2teQuickLinksSignature;
  addQuickLinksRow();
}

export function itemQuickLinks() {
  addQuickLinksRow();

  // The Item List can render or page after the row above is built, so its
  // per-row buttons are re-checked on every change too.
  const observer = new MutationObserver(() => {
    addQuickLinksRow();
    syncItemListRowCombos();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // A key saved in the popup turns key-hint buttons into real links without
  // a reload (the schema download happens inside the rebuild's resolve).
  // Switching Sheen/Killstreaker filtering rebuilds every link that uses it.
  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area === "local" && ("steamApiKey" in changes || "sheenKillstreakerFilterEnabled" in changes)) rebuildRow();
  });
}
