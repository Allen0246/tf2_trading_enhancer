/*
@description: Adds the same quick-link buttons (stntrading.eu, marketplace.tf,
mannco.store, gladiator.tf, pricedb.io, posts.tf) as
backpack.tf/nextUI/statsPageQuickLinks/content.js, but for classic
backpack.tf's own /stats page instead of next.backpack.tf's - see that
file's own header note for the shared reasoning (per-button omission on
failure rather than showing a broken link, plain+Unusual-only v1 scope, own
self-contained styled pill-button row placed at the bottom of the panel
rather than crowding the header).

Resolves the item's identity straight off the item element's own data-*
attributes (confirmed live: data-name="Mann Co. Supply Crate Key"
data-base_name="Mann Co. Supply Crate Key" data-quality="6"
data-q_name="Unique" data-priceindex="0" data-craftable="1"), not a URL
query string the way the next.backpack.tf version does - classic /stats
encodes identity in the URL PATH instead (/stats/Unique/Mann%20Co.%20
Supply%20Crate%20Key/Tradable/Craftable), which is harder to parse reliably
than just reading the same data already sitting on the page's own item
element.

Killstreak tier isn't in any data-* attribute at all here - read instead
from whichever of the page's own killstreak-tier tabs (No Kit/Normal
KS/Specialized KS/Professional KS) currently carries the "active" class,
and baked into the name sent to
resolveStatsAndClassifieds/gladiator.tf/pricedb.io the same way this
codebase's own buildItemNameRaw helpers do elsewhere (quality +
killstreak-tier prefix + bare name), plus passed to
resolveStatsAndClassifieds/mannco.store separately as their own
knownKillstreakTier/killstreakTier options - same "both at once" pattern
../../nextUI/addMarketplaceButton/content.js's own addMarketplaceButtonTo
already uses.

Light theme for the button row (not the next-UI version's dark one) -
classic backpack.tf's own UI is a light theme, so that file's white-on-dark
pill style would be nearly invisible here.

Also relocates the page's own native killstreak-tier tab bar
(".stats-killstreak-list") down into this same bottom section, above the
quick-links row, so the tier switcher and the quick-links live together
instead of split between the header and the bottom of the panel. A real DOM
move (insertBefore/appendChild on the actual element), not a clone - this
page is classic server-rendered HTML with no reactive framework
re-rendering it back to its original spot, so the move is stable, and
moving the real node (rather than rebuilding it) keeps its native click
behavior (a plain page navigation to that tier's own /stats URL) working
completely unchanged. Quality tabs stay in the header.
*/

import {
  resolveStatsAndClassifieds,
  buildTargetToolFullName,
  buildStnTradingHref,
  buildPricedbSearchName,
  buildGladiatorHref,
} from "../../../utils/tf2StatsLinks/index.js";
import { searchPricedbSkuStatus } from "../../../utils/pricedb.js";
import { buildMannStoreHref } from "../addMannStoreButton/content.js";
import { applyLoadingState, fillPricedbSlot } from "../../../utils/linkButtonStates.js";
import { KILLSTREAK_TIER_PREFIXES } from "../popoverItemDetails.js";

// Exported - ../suggestionsQuickLinks/content.js reuses this same style
// injection, class naming, and STN href builder wholesale for the classic
// "Create a price suggestion" page's (/vote/...) own quick-links row,
// rather than a second copy.
const STYLE_ID = "tf2te-oldui-stats-quick-links-style";
export const CONTROLS_WRAP_CLASS = "tf2te-oldui-stats-controls";
export const ROW_CLASS = "tf2te-oldui-stats-quick-links-row";
const BUTTON_CLASS = "tf2te-oldui-stats-quick-link-button";
const BUTTON_DISABLED_CLASS = "tf2te-oldui-stats-quick-link-button--disabled";

// Confirmed live - ".stats-header-panel" names THE item info panel
// specifically (not shared with any other block further down the page the
// way next.backpack.tf's own generic ".card" is), so a single
// document-wide querySelector is safe without needing title-text
// disambiguation the way the next-UI version needs.
const PANEL_SELECTOR = ".stats-header-panel";
const BODY_SELECTOR = ".stats-body";
const ITEM_WRAP_SELECTOR = ".stats-header-item";
const ITEM_SELECTOR = ".item";
const KS_TAB_LIST_SELECTOR = ".stats-killstreak-list";
const KS_TAB_ACTIVE_SELECTOR = ".btn-variety.active";

export function ensureStyleInjected() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .${CONTROLS_WRAP_CLASS} {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 10px 15px 14px;
      margin-top: 4px;
      border-top: 1px solid rgba(0, 0, 0, 0.1);
    }
    .${ROW_CLASS} {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .${BUTTON_CLASS} {
      display: inline-flex;
      align-items: center;
      padding: 3px 10px;
      border: 1px solid rgba(0, 0, 0, 0.18);
      border-radius: 3px;
      font-size: 12px;
      font-weight: 600;
      color: #333;
      text-decoration: none;
      background: #f5f5f5;
      white-space: nowrap;
    }
    .${BUTTON_CLASS}:hover {
      background: #e8e8e8;
      border-color: rgba(0, 0, 0, 0.3);
    }
    /* Non-clickable placeholder for pricedb.io's own rate-limited state (a
       real, confirmed-live 429 - see utils/pricedb.js's own
       searchPricedbSkuStatus note) - used instead of silently omitting the
       button, same reasoning ../../nextUI/statsPageQuickLinks/content.js's
       own BUTTON_DISABLED_CLASS documents. */
    .${BUTTON_DISABLED_CLASS} {
      opacity: 0.55;
      cursor: default;
    }
    .${BUTTON_DISABLED_CLASS}:hover {
      background: #f5f5f5;
      border-color: rgba(0, 0, 0, 0.18);
    }
  `;
  document.head.appendChild(style);
}

function findStatsBody() {
  const panel = document.querySelector(PANEL_SELECTOR);
  return panel?.querySelector(BODY_SELECTOR) ?? null;
}

// Created once per page (own idempotent lookup, same "find or build" shape
// findStatsBody's own callers already use) - holds the relocated killstreak
// tab bar (if any) above the quick-links row, both living in the same
// bottom section of the panel.
function ensureControlsWrap(body) {
  let wrap = body.querySelector(`.${CONTROLS_WRAP_CLASS}`);
  if (wrap) return wrap;
  wrap = document.createElement("div");
  wrap.className = CONTROLS_WRAP_CLASS;
  body.appendChild(wrap);
  return wrap;
}

// Moves the real killstreak-tier tab bar element (not a clone - see this
// file's own header note on why that's safe here) into the controls wrap,
// ahead of anything already there (the quick-links row, once built) -
// idempotent, a no-op once it's already there.
function relocateKillstreakTabs(body) {
  const tabList = body.querySelector(KS_TAB_LIST_SELECTOR);
  if (!tabList) return;
  const wrap = ensureControlsWrap(body);
  if (tabList.parentElement === wrap) return;
  // children[0] (not firstChild) - wrap only ever holds elements this file
  // itself creates, so the two are equivalent here, and children[0] is what
  // this repo's own hand-rolled test fake DOM (see this feature's own test
  // file) supports.
  wrap.insertBefore(tabList, wrap.children[0] ?? null);
}

// "No Kit"/"Normal KS"/"Specialized KS"/"Professional KS" - confirmed live
// text on the killstreak-tier tab bar's own buttons.
const KS_TIER_BY_LABEL = { "No Kit": 0, "Normal KS": 1, "Specialized KS": 2, "Professional KS": 3 };

// Chained single-class lookups, not a ".stats-killstreak-list .btn-variety.active"
// descendant-combinator selector - see ../../nextUI/statsPageQuickLinks/
// content.js's own note on why this folder's own convention avoids those.
function findActiveKillstreakTier(body) {
  const activeTab = body.querySelector(KS_TAB_LIST_SELECTOR)?.querySelector(KS_TAB_ACTIVE_SELECTOR);
  if (!activeTab) return 0;
  const label = activeTab.textContent.replace(/\s+/g, " ").trim();
  return KS_TIER_BY_LABEL[label] ?? 0;
}

/*
@description: Reads the item's identity straight off its own data-*
attributes plus the currently-active killstreak-tier tab (see this file's
own header note). Returns null when the item element or its required
attributes aren't found - markup changed, don't guess. Chained single-class
lookups (".stats-header-item", then ".item" inside it), not one
".stats-header-item .item" descendant-combinator selector - see this
folder's own established convention (every other tooltip-button feature
here chains closest()/querySelector() on simple selectors instead).
*/
function resolveIdentity(body) {
  const item = body.querySelector(ITEM_WRAP_SELECTOR)?.querySelector(ITEM_SELECTOR);
  if (!item) return null;

  const rawBaseName = item.getAttribute("data-base_name");
  // A Strangifier/Chemistry Set's tile names only the tool
  // (data-base_name="Strangifier"); the weapon is its own data-target_item
  // ("Cleaner's Carbine", seen live). The two are combined into the real item
  // name ("Cleaner's Carbine Strangifier") so no link searches the bare word
  // "Strangifier", same helper next.backpack.tf uses.
  const targetItem = item.getAttribute("data-target_item");
  const baseName = targetItem && rawBaseName ? buildTargetToolFullName(rawBaseName, targetItem) : rawBaseName;
  const qualityName = item.getAttribute("data-q_name");
  const qualityIdRaw = item.getAttribute("data-quality");
  if (!baseName || !qualityName || qualityIdRaw === null) return null;
  const qualityId = Number(qualityIdRaw);
  if (Number.isNaN(qualityId)) return null;

  const killstreakTier = findActiveKillstreakTier(body);
  const killstreakPrefix = KILLSTREAK_TIER_PREFIXES[killstreakTier] || "";
  const itemNameRaw = qualityName === "Unique" ? `${killstreakPrefix}${baseName}` : `${qualityName} ${killstreakPrefix}${baseName}`;

  const priceindexRaw = item.getAttribute("data-priceindex");
  const priceindex = priceindexRaw ? Number(priceindexRaw) : 0;
  const knownEffectId = qualityName === "Unusual" && priceindex > 0 ? priceindex : null;

  return { itemName: baseName, qualityId, itemNameRaw, knownEffectId, killstreakTier };
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
into the link, the rate-limit countdown, or removes it. Exported for
../suggestionsQuickLinks/content.js's row, which shares these buttons.
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

// Non-clickable placeholder (e.g. a label with no link) - a plain <span>,
// not an <a> with no href, same "never a dead link" reasoning every other
// placeholder in this codebase already follows.
export function buildDisabledQuickLinkButton(label) {
  const span = document.createElement("span");
  span.className = `${BUTTON_CLASS} ${BUTTON_DISABLED_CLASS}`;
  span.textContent = label;
  return span;
}

/*
@description: Resolves and (re)builds the quick-links row for the current
item - same "signature = current URL, set eagerly before the async
resolves" race-guard shape as the next.backpack.tf version (see that file's
own note), kept here too even though classic backpack.tf navigates with a
real page load per item rather than client-side routing, so a stale
in-flight resolve landing after a newer one is a much rarer case here in
practice - costs nothing to guard against anyway.
*/
async function addStatsPageQuickLinks() {
  const body = findStatsBody();
  if (!body) return;

  const signature = window.location.href;
  if (body.dataset.tf2teStatsQuickLinksSignature === signature) return;
  body.dataset.tf2teStatsQuickLinksSignature = signature;

  // Moved regardless of whether identity/the buttons below end up
  // resolving, this should happen either way. Styles injected first (not
  // just before building the button row further down) - otherwise an item
  // where identity/the buttons never resolve would still move the tab bar
  // into an unstyled wrap.
  ensureStyleInjected();
  relocateKillstreakTabs(body);

  body.querySelectorAll(`.${ROW_CLASS}`).forEach((el) => el.remove());

  const identity = resolveIdentity(body);
  if (!identity) return;

  const { itemName, qualityId, itemNameRaw, knownEffectId, killstreakTier } = identity;

  // pricedb.io is looked up after the row is shown (settlePricedbSlot), so
  // its lookup never holds the whole row back.
  const resolved = await resolveStatsAndClassifieds(itemNameRaw, { knownEffectId, knownKillstreakTier: killstreakTier });

  // The page may have navigated on again while the above was in flight -
  // see this function's own header note.
  if (window.location.href !== signature) return;

  // gladiator.tf/pricedb.io search the trading community's "{Effect} {Item}"
  // name for an Unusual, never "Unusual {Item}" (pricedb.io's exact-name
  // match can't find that shape at all). The effect name comes from the
  // resolve above (looked up from data-priceindex's effect id).
  const effectName = resolved.classifiedsFilters?.effectName ?? null;
  const searchDisplayName = buildPricedbSearchName(itemNameRaw, resolved.classifiedsFilters);

  const buttons = [];
  // Right before marketplace.tf - same relative placement every other port
  // of this button already uses (see
  // ../../nextUI/statsPageQuickLinks/content.js's own stntrading.eu
  // call site). Never omitted, unlike marketplace.tf/posts.tf/pricedb.io -
  // buildSteamMarketName always produces SOME reasonable link off
  // itemNameRaw alone, even when classifiedsFilters itself came back null.
  buttons.push(["stntrading.eu", buildStnTradingHref(itemNameRaw, resolved.classifiedsFilters)]);
  if (resolved.marketplaceHref) buttons.push(["marketplace.tf", resolved.marketplaceHref]);
  // mannco.store/gladiator.tf need no lookup, so they're never omitted for
  // an item within this feature's own scope (same reasoning the
  // next.backpack.tf version's own header note documents).
  buttons.push(["mannco.store", buildMannStoreHref({ itemName, qualityId, killstreakTier, knownEffectName: effectName })]);
  buttons.push(["gladiator.tf", buildGladiatorHref(searchDisplayName)]);
  buttons.push(["pricedb.io", null, "loading"]);
  if (resolved.postsTfHref) buttons.push(["posts.tf", resolved.postsTfHref]);

  const row = document.createElement("div");
  row.className = ROW_CLASS;
  let pricedbSlot = null;
  buttons.forEach(([label, href, state]) => {
    const el = state === "loading" ? (pricedbSlot = buildPricedbLoadingSlot()) : href ? buildQuickLinkButton(label, href) : buildDisabledQuickLinkButton(label);
    row.appendChild(el);
  });

  // The panel may have been re-rendered while the above was in flight -
  // re-find it fresh rather than trusting the reference captured before
  // the await. Appended into the controls wrap (below the relocated
  // killstreak tabs, or created fresh if that relocation found nothing to
  // move), not straight into the body.
  const freshBody = findStatsBody() || body;
  ensureControlsWrap(freshBody).appendChild(row);

  settlePricedbSlot(pricedbSlot, searchDisplayName, () => window.location.href === signature);
}

export function statsPageQuickLinks() {
  addStatsPageQuickLinks();

  const observer = new MutationObserver(() => addStatsPageQuickLinks());
  observer.observe(document.body, { childList: true, subtree: true });
}
