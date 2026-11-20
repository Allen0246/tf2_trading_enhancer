/*
@description: Adds the same quick-link buttons next.backpack.tf's own
item-preview tooltip already gets (marketplace.tf, mannco.store,
gladiator.tf, pricedb.io, posts.tf - see ../addMarketplaceButton,
../addMannStoreButton, ../addGladiatorButton, ../addPricedbButton,
../addPostsTfButton) into the /stats page's own "Item Information" card
too.

Resolves the item's identity straight off THIS page's own URL (confirmed
live: "?item=Master%27s%20Yellow%20Belt&quality=Unusual&priceindex=12",
and separately "?item=Wrench&quality=Strange&killstreakTier=3" - 0 = no
Killstreak, 3 = Professional) rather than scraping the tooltip's DOM the
way every other button in this folder does - a stats page's own URL
already carries a clean item name + quality NAME + Unusual effect id
(priceindex) + Killstreak tier (killstreakTier) as their own separate
params, no special-attribute-row scanning needed at all for these item
types. Unlike classic backpack.tf's own /stats page (see
../../oldUI/statsPageQuickLinks/content.js), there's no native
killstreak-tier tab control here to relocate - a different item variant is
reached by navigating to a different killstreakTier param value directly
(confirmed live: no other UI for it found on this page).

Scope for now (same incremental-shipping convention
../addPostsTfButton/content.js's own header note already establishes - ship
what's confirmed, expand later rather than guess): plain items, Unusuals,
and Killstreak-tiered weapons only. Killstreak Kits/Fabricators (the TOOL
items that PRODUCE a kit, a different thing from a Killstreak-tiered weapon
itself)/Decorated Weapons/War Paint tools aren't handled - this page's own
URL shape for those hasn't been confirmed live yet, and guessing wrong
would build a broken link rather than none at all.

Each button is omitted entirely (not shown broken/misleading) when its own
resolution comes back empty: marketplace.tf/posts.tf can both genuinely
fail (unsupported item type, or posts.tf's own missing-Steam-key gate -
see utils/tf2StatsLinks/index.js's own resolveStatsAndClassifieds), and
pricedb.io's own /api/search can find nothing. gladiator.tf/mannco.store
are pure string builders with no lookup to fail, so they always show once
the item's identity itself resolves.

Rendered as its own small pill-button row - self-contained inline CSS, not
cloned from the native Wiki link's classes: first, it reads as actual clickable buttons instead of blending into the
header as plain text; second, next.backpack.tf's own classes are Vue
`scoped` CSS (see copyScopedStyleAttrs' own note elsewhere in this folder) -
cloning a class name alone without also being inside that exact component's
own scope hash risks picking up none of its actual styling.

Placed in its own full-width row at the very bottom of the card's own
".card__content" (below the item/price/trends row): guaranteed full-width
space that never competes with existing content and keeps the header
uncluttered. Not in the header (two stacked rows of small buttons crowd it),
and not in the empty-looking gap between the item name/price block and the
Market Trends box (incidental flexbox leftover space that a longer name, a
wider Trends box or a narrower window shrinks or moves, so buttons there
could overlap the Trends numbers).

Also builds a killstreak-tier switcher (No Kit/Normal KS/Specialized
KS/Professional KS), sitting above the quick-links row in the same controls
wrap. Unlike classic backpack.tf's own version
(../../oldUI/statsPageQuickLinks/content.js), there's no NATIVE control here
to relocate (confirmed live - none found on this page), so this one is built
from scratch: four plain links, each the CURRENT URL with only
"killstreakTier" swapped (every other param - item, quality, priceindex -
carried through unchanged), so clicking one is a normal same-tab page
navigation to that tier's own view of this exact item - no attempt to hook
into Vue's own client-side routing. Shown unconditionally, the same way
classic backpack.tf's own tab bar does (confirmed live even on a Mann Co.
Supply Crate Key, which can't actually carry a Killstreak Kit in-game) -
this codebase has no reliable way to know which items realistically can, and
the native site already accepts that same tradeoff. Grouped into a joined
"segmented control" strip - same corner-clearing/1px-border-overlap
technique ../killstreakTierFilter/content.js's own applyGroupedCorners
already established for next.backpack.tf's classifieds page, applied here to
buildKillstreakTabBar's own tabs instead of separate pill buttons.

STN (stntrading.eu) also added to the quick-links row, right before
marketplace.tf, same relative placement and same confirmed-live href shape
(utils/tf2StatsLinks/index.js's buildStnTradingHref) every other port of
this button already uses. Unlike
marketplace.tf/posts.tf/pricedb.io, never omitted - buildSteamMarketName
always produces SOME reasonable link off itemNameRaw alone, even when
classifiedsFilters itself came back null.
*/

import { resolveStatsAndClassifieds, buildStnTradingHref, buildGladiatorHref } from "../../../utils/tf2StatsLinks/index.js";
import { getEffectNameToIdMap } from "../../../utils/tf2Schema.js";
import { QUALITY_ID_BY_NAME } from "../../../utils/tf2Quality.js";
import { searchPricedbSkuStatus } from "../../../utils/pricedb.js";
import { buildMannStoreHref } from "../addMannStoreButton/content.js";
import { applyLoadingState, fillPricedbSlot } from "../../../utils/linkButtonStates.js";
import { KILLSTREAK_TIER_PREFIXES } from "../shared/tooltipItemDetails.js";

// Exported - ../suggestionsQuickLinks/content.js reuses this same style
// injection, class naming, and identity/href-building logic wholesale for
// the /suggestions/create page's own quick-links row, rather than a second
// copy (that page's URL carries the exact same item/quality/priceindex/
// killstreakTier param shape - see that file's own header note).
const STYLE_ID = "tf2te-stats-quick-links-style";
export const CONTROLS_WRAP_CLASS = "tf2te-stats-controls";
export const ROW_CLASS = "tf2te-stats-quick-links-row";
const BUTTON_CLASS = "tf2te-stats-quick-link-button";
const BUTTON_DISABLED_CLASS = "tf2te-stats-quick-link-button--disabled";
const KS_TAB_LIST_CLASS = "tf2te-stats-ks-tabs";
const KS_TAB_CLASS = "tf2te-stats-ks-tab";
const KS_TAB_ACTIVE_CLASS = "tf2te-stats-ks-tab--active";
// Confirmed live - the "Item Information" card's own header title text,
// used to find ITS card specifically rather than any other card's (several
// other cards on this page - Classifieds Trends, History, Sell/Buy Orders -
// have their own titles/content too).
const ITEM_INFO_TITLE_TEXT = "Item Information";
const HEADER_TITLE_SELECTOR = ".card__header__title";
const CARD_CONTENT_SELECTOR = ".card__content";

export function ensureStyleInjected() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .${CONTROLS_WRAP_CLASS} {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 10px 16px 14px;
      margin-top: 4px;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
    }
    .${ROW_CLASS} {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .${KS_TAB_LIST_CLASS} {
      /* Joined "segmented control" strip, not spaced-out pills - see
         buildKillstreakTabBar's own applyGroupedCorners note (same
         technique ../killstreakTierFilter/content.js's own buildButtonRow
         already uses on /classifieds). */
      display: inline-flex;
      flex-wrap: nowrap;
    }
    .${BUTTON_CLASS}, .${KS_TAB_CLASS} {
      display: inline-flex;
      align-items: center;
      padding: 3px 10px;
      border: 1px solid rgba(255, 255, 255, 0.25);
      border-radius: 4px;
      font-size: 12px;
      font-weight: 600;
      color: #eaeaea;
      text-decoration: none;
      background: rgba(255, 255, 255, 0.05);
      white-space: nowrap;
    }
    .${BUTTON_CLASS}:hover, .${KS_TAB_CLASS}:hover {
      background: rgba(255, 255, 255, 0.14);
      border-color: rgba(255, 255, 255, 0.45);
    }
    .${KS_TAB_ACTIVE_CLASS} {
      color: #1c1c1c;
      background: #eaeaea;
      border-color: #eaeaea;
    }
    .${KS_TAB_ACTIVE_CLASS}:hover {
      background: #eaeaea;
      border-color: #eaeaea;
    }
    /* Rendered as a non-clickable <span> for a rate-limited/unavailable
       state (same "don't render a dead/misleading link" reasoning
       scrap.tf/itemLinks/itemCard.js's own placeholder rendering already
       establishes) so there's at least a visible reason instead of the
       button just vanishing. See #20. */
    .${BUTTON_DISABLED_CLASS} {
      opacity: 0.55;
      cursor: default;
    }
    .${BUTTON_DISABLED_CLASS}:hover {
      background: rgba(255, 255, 255, 0.05);
      border-color: rgba(255, 255, 255, 0.25);
    }
  `;
  document.head.appendChild(style);
}

// Created once per item card (own idempotent lookup, same "find or build"
// shape ../../oldUI/statsPageQuickLinks/content.js's own ensureControlsWrap
// uses) - holds the killstreak-tier switcher above the quick-links row.
function ensureControlsWrap(content) {
  let wrap = content.querySelector(`.${CONTROLS_WRAP_CLASS}`);
  if (wrap) return wrap;
  wrap = document.createElement("div");
  wrap.className = CONTROLS_WRAP_CLASS;
  content.appendChild(wrap);
  return wrap;
}

const KS_TIER_LABELS = { 0: "No Kit", 1: "Normal KS", 2: "Specialized KS", 3: "Professional KS" };
const KS_TIER_VALUES = Object.keys(KS_TIER_LABELS);

// Clears only the two corners that touch an adjacent tab in the group,
// leaving the outermost corners (first tab's own left side, last tab's own
// right side) exactly as the shared KS_TAB_CLASS rule already renders them -
// same "segmented control" technique ../killstreakTierFilter/content.js's
// own applyGroupedCorners uses for next.backpack.tf's classifieds page, so
// the four tabs read as one joined strip rather than separate pills.
function applyGroupedCorners(el, index, total) {
  if (index > 0) {
    el.style.borderTopLeftRadius = "0";
    el.style.borderBottomLeftRadius = "0";
  }
  if (index < total - 1) {
    el.style.borderTopRightRadius = "0";
    el.style.borderBottomRightRadius = "0";
  }
}

// Four plain links, each the CURRENT URL with only "killstreakTier"
// swapped - see this file's own header note on why a real link (same-tab
// navigation) rather than any Vue-router hook.
function buildKillstreakTabBar(currentTier) {
  const wrap = document.createElement("div");
  wrap.className = KS_TAB_LIST_CLASS;
  Object.entries(KS_TIER_LABELS).forEach(([tierStr, label], index) => {
    const tier = Number(tierStr);
    const url = new URL(window.location.href);
    url.searchParams.set("killstreakTier", tierStr);

    const link = document.createElement("a");
    link.href = url.toString();
    link.textContent = label;
    link.className = tier === currentTier ? `${KS_TAB_CLASS} ${KS_TAB_ACTIVE_CLASS}` : KS_TAB_CLASS;
    applyGroupedCorners(link, index, KS_TIER_VALUES.length);
    // Overlaps the adjacent tab's own border by 1px instead of sitting flush
    // against it - same standard button-group trick avoiding a doubled-
    // thickness seam where two 1px borders would otherwise stack.
    if (index > 0) link.style.marginLeft = "-1px";
    wrap.appendChild(link);
  });
  return wrap;
}

// Chained single-class lookup (find the card via its own title text, then
// ".card__content" inside it), matching this folder's own established
// convention (closest()/querySelector() chained on simple selectors, never
// a descendant-combinator string).
function findItemInfoCardContent() {
  const titles = document.querySelectorAll(HEADER_TITLE_SELECTOR);
  for (const titleEl of titles) {
    if (!titleEl.textContent.trim().startsWith(ITEM_INFO_TITLE_TEXT)) continue;
    const card = titleEl.closest(".card");
    const content = card?.querySelector(CARD_CONTENT_SELECTOR);
    if (content) return content;
  }
  return null;
}

/*
@description: Reads the item's identity straight off this /stats page's own
URL. Returns null for anything outside this feature's own scope (missing
item/quality, or an unrecognized quality name) rather than guessing.
The URL's killstreakTier is 0 (No Kit) to 3 (Professional), confirmed live,
and "item" is always the bare weapon name (never "Professional Killstreak
Wrench"), so the tier prefix is added back from KILLSTREAK_TIER_PREFIXES.
itemNameRaw is the quality + Killstreak-tier-prefixed display name (e.g.
"Unusual Master's Yellow Belt", "Strange Professional Killstreak Wrench")
resolveStatsAndClassifieds/gladiator.tf/pricedb.io all expect - Unique gets
no quality prefix at all, same convention every other resolver in this
codebase already follows. killstreakTier is ALSO returned on its own (not
just baked into itemNameRaw) - resolveStatsAndClassifieds/mannco.store both
want it as a separate, explicit option too, same "both at once" pattern
../addMarketplaceButton/content.js's own addMarketplaceButtonTo and the
classic-UI version of this file both already use.

This page's own URL carries "&australium=true" (the item-preview tooltip's
own equivalent Classifieds anchor carries "&australium=1" instead - see
../addMarketplaceButton/content.js's own matching fix) - checked against
both string shapes below. Australium is embedded as a literal "Australium "
word right before the item name (same position
../addMarketplaceButton/content.js's own buildItemNameRaw uses) so the
shared resolveClassifiedsFilters can detect it, and returned as its own
isAustralium value too for mannco.store's own search-text embedding (which
has no separate Australium filter param the way marketplace.tf does).

Accepts an optional href to parse instead of window.location.href (still the
default) - ../suggestionDetailQuickLinks/content.js's own single-suggestion
page (/suggestions/{id}) reuses this exact parser against its own item
preview anchor's own href (confirmed live: "/stats?item=Train%20of%20Thought&
quality=Unusual&priceindex=32"), which carries the identical item/quality/
priceindex param shape but sits on an anchor element, not the page's own URL.
See #114.
*/
export function resolveIdentityFromUrl(href = window.location.href) {
  const params = new URL(href, window.location.href).searchParams;
  const itemName = params.get("item");
  const qualityName = params.get("quality");
  if (!itemName || !qualityName) return null;

  const qualityId = QUALITY_ID_BY_NAME[qualityName];
  if (qualityId === undefined) return null;

  const priceindex = params.get("priceindex");
  const knownEffectId = qualityName === "Unusual" && priceindex ? Number(priceindex) : null;

  const killstreakTierRaw = params.get("killstreakTier");
  const killstreakTier = killstreakTierRaw ? Number(killstreakTierRaw) : 0;
  const killstreakPrefix = KILLSTREAK_TIER_PREFIXES[killstreakTier] || "";

  const australiumRaw = params.get("australium");
  const isAustralium = australiumRaw === "1" || australiumRaw === "true";
  const australiumPrefix = isAustralium ? "Australium " : "";

  const itemNameRaw =
    qualityName === "Unique"
      ? `${killstreakPrefix}${australiumPrefix}${itemName}`
      : `${qualityName} ${killstreakPrefix}${australiumPrefix}${itemName}`;

  return { itemName, qualityId, itemNameRaw, knownEffectId, killstreakTier, isAustralium };
}

// next.backpack.tf's own classifieds price-history page for this exact item
// name - confirmed live:
// "https://next.backpack.tf/classifieds/snapshots/Strange%20Medi%20Gun"
// (itemNameRaw itself, path-segment encoded - a plain encodeURIComponent,
// unlike buildStnTradingHref's own "+"-joined query param below). Needs no
// lookup at all (same as gladiator.tf/mannco.store), so it's never omitted
// - exported for ../suggestionsQuickLinks/content.js to reuse too.
export function buildSnapshotHref(itemNameRaw) {
  return `https://next.backpack.tf/classifieds/snapshots/${encodeURIComponent(itemNameRaw)}`;
}

// This page's own URL only ever carries the numeric priceindex
// (knownEffectId), never the effect's plain name. Reverse-looked-up here,
// straight off the same effectNameToId map getEffectId's own forward lookup
// already uses, and passed through as knownEffectName so every downstream
// use of classifiedsFilters.effectName (stntrading.eu's own
// buildStnTradingHref included) gets it correctly, not just
// gladiator.tf/pricedb.io below. See #115.
export async function resolveEffectNameById(effectId) {
  const effectNameToId = await getEffectNameToIdMap();
  return Object.keys(effectNameToId).find((name) => effectNameToId[name] === effectId) ?? null;
}

export function buildQuickLinkButton(label, href) {
  const link = document.createElement("a");
  link.href = href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.className = BUTTON_CLASS;
  link.textContent = label;
  return link;
}

/*
@description: pricedb.io's slot while its lookup is still running
(utils/linkButtonStates.js's loading state: label + spinner), so the rest of
the row never waits on pricedb.io. The plain button class, not
BUTTON_DISABLED_CLASS, so it keeps its hover text. settlePricedbSlot turns it
into the link, the rate-limit countdown, or removes it. Exported for the two
suggestion pages' rows, which share this module's buttons.
*/
export function buildPricedbLoadingSlot() {
  const span = document.createElement("span");
  span.className = BUTTON_CLASS;
  applyLoadingState(span);
  return span;
}

export function settlePricedbSlot(slot, searchName, isCurrent) {
  if (!slot) return;
  fillPricedbSlot(slot, {
    lookup: () => searchPricedbSkuStatus(searchName),
    buildLink: (href) => buildQuickLinkButton("pricedb.io", href),
    isCurrent,
  });
}

// Non-clickable placeholder for pricedb.io's own rate-limited state (see
// this file's own BUTTON_DISABLED_CLASS note) - a plain <span>, not an <a>
// with no href, same "never a dead link" reasoning every other placeholder
// in this codebase already follows.
export function buildDisabledQuickLinkButton(label) {
  const span = document.createElement("span");
  span.className = `${BUTTON_CLASS} ${BUTTON_DISABLED_CLASS}`;
  span.textContent = label;
  return span;
}

/*
@description: Resolves and (re)builds the quick-links row for the current
item, replacing whatever this function built for a previous item.

Signature is the current URL alone, set eagerly before the async resolves
below (not after) - a fast in-app navigation to a DIFFERENT item's /stats
page (no full page reload on this Vue SPA) must not have a slower earlier
resolve land after a newer one and attach the wrong item's links.
*/
async function addStatsPageQuickLinks() {
  const content = findItemInfoCardContent();
  if (!content) return;

  const signature = window.location.href;
  if (content.dataset.tf2teStatsQuickLinksSignature === signature) return;
  content.dataset.tf2teStatsQuickLinksSignature = signature;

  // Removing the wrap removes the row (and the tier switcher) along with
  // it, both living inside it - no need for a separate ROW_CLASS removal.
  content.querySelectorAll(`.${CONTROLS_WRAP_CLASS}`).forEach((el) => el.remove());

  const identity = resolveIdentityFromUrl();
  if (!identity) return;

  const { itemName, qualityId, itemNameRaw, knownEffectId, killstreakTier, isAustralium } = identity;

  // Built synchronously, inserted immediately - unlike the quick-links row
  // below, the tier switcher needs no lookup at all, so there's no reason
  // to make it wait on (or disappear because of) the async resolve.
  ensureStyleInjected();
  ensureControlsWrap(content).appendChild(buildKillstreakTabBar(killstreakTier));

  // Reverse-looked-up BEFORE resolveStatsAndClassifieds (not derived from
  // its own result afterward) so it can be passed in as knownEffectName -
  // see resolveEffectNameById's own note on why this page's own URL alone
  // is never enough for resolveUnusualEffect's knownEffectId fast path to
  // resolve a real effect name on its own.
  const knownEffectName = knownEffectId != null ? await resolveEffectNameById(knownEffectId) : null;

  const resolved = await resolveStatsAndClassifieds(itemNameRaw, { knownEffectName, knownEffectId, knownKillstreakTier: killstreakTier });

  // The URL may have moved on again while the above was in flight - see
  // this function's own header note.
  if (window.location.href !== signature) return;

  // gladiator.tf/pricedb.io are both community trading-price sites that
  // expect the trading community's own "{Effect} {Item}" Unusual naming
  // convention (e.g. "Purple Energy Team Captain"), never Steam's raw
  // market_hash_name (which keeps the literal word "Unusual" - itemNameRaw's
  // own shape, correct for
  // resolveStatsAndClassifieds/marketplace.tf/stntrading.eu above but wrong
  // for these two) - same distinction
  // scrap.tf/itemLinks/resolveItemDetails.js's own searchDisplayName already
  // establishes for the identical gap on that page. Falls back to
  // itemNameRaw's own literal "Unusual " word when the effect name itself
  // couldn't be resolved (an effect newer than the bundled table, with no
  // Steam Web API key configured), same fallback
  // that file's own version uses - gladiator.tf/pricedb.io still search
  // SOMETHING rather than nothing in that case.
  const searchDisplayName =
    qualityId === QUALITY_ID_BY_NAME.Unusual && knownEffectName ? itemNameRaw.replace(/^Unusual\s+/, `${knownEffectName} `) : itemNameRaw;

  const buttons = [];
  // First in the row. Same effect-name-substituted searchDisplayName
  // gladiator.tf/pricedb.io use above (not itemNameRaw's own literal
  // "Unusual" word) - confirmed live:
  // "/classifieds/snapshots/Orbiting%20Planets%20Train%20of%20Thought", not
  // "...Unusual%20Train...".
  buttons.push(["snapshot", buildSnapshotHref(searchDisplayName)]);
  // Right before marketplace.tf - same relative placement every other port
  // of this button already uses (see scrap.tf/itemLinks/links.js's own
  // buildStnTradingHref call site). Full "stntrading.eu" label, not the
  // "STN" abbreviation, matching every other button in this same row (and
  // the tooltip/popover ports of this same button on both UIs).
  buttons.push(["stntrading.eu", buildStnTradingHref(itemNameRaw, resolved.classifiedsFilters)]);
  if (resolved.marketplaceHref) buttons.push(["marketplace.tf", resolved.marketplaceHref]);
  // mannco.store/gladiator.tf need no lookup, so they're never omitted for
  // an item within this feature's own scope (see this file's own header
  // note on why that's still safe to always show).
  buttons.push(["mannco.store", buildMannStoreHref(itemName, qualityId, { killstreakTier, isAustralium, knownEffectName })]);
  buttons.push(["gladiator.tf", buildGladiatorHref(searchDisplayName)]);
  // Loading slot, settled after the row is on the page (settlePricedbSlot),
  // so pricedb.io's lookup never holds the whole row back.
  buttons.push(["pricedb.io", null, "loading"]);
  if (resolved.postsTfHref) buttons.push(["posts.tf", resolved.postsTfHref]);

  const row = document.createElement("div");
  row.className = ROW_CLASS;
  let pricedbSlot = null;
  buttons.forEach(([label, href, state]) => {
    const el = state === "loading" ? (pricedbSlot = buildPricedbLoadingSlot()) : href ? buildQuickLinkButton(label, href) : buildDisabledQuickLinkButton(label);
    row.appendChild(el);
  });

  // The card may have been torn down/replaced by Vue while the above was in
  // flight - re-find it fresh rather than trusting the reference captured
  // before the await. Appended into the controls wrap (below the tier
  // switcher already built above), not straight into the card content.
  const freshContent = findItemInfoCardContent() || content;
  ensureControlsWrap(freshContent).appendChild(row);

  settlePricedbSlot(pricedbSlot, searchDisplayName, () => window.location.href === signature);
}

export function statsPageQuickLinks() {
  addStatsPageQuickLinks();

  const observer = new MutationObserver(() => addStatsPageQuickLinks());
  observer.observe(document.body, { childList: true, subtree: true });
}
