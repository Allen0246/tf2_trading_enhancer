/*
@description: Adds the same
snapshot/stntrading.eu/marketplace.tf/mannco.store/gladiator.tf/pricedb.io/posts.tf
quick-links row ../statsPageQuickLinks/content.js already adds to the /stats
page, to a single suggestion's own detail page on next.backpack.tf instead
(/suggestions/{id} - NOT /suggestions/create, which
../suggestionsQuickLinks/content.js already covers). Confirmed live:
https://next.backpack.tf/suggestions/6a8008ebe414a22bb907b6ab.

This page's own URL carries no item/quality params at all (just the
suggestion's own id) - the item's identity instead sits on the item preview
element's own href (confirmed live: "/stats?item=Train%20of%20Thought&
quality=Unusual&priceindex=32", the SAME item/quality/priceindex param shape
../statsPageQuickLinks/content.js's own resolveIdentityFromUrl already
parses for the page's own URL - reused here against that anchor's href
instead, via resolveIdentityFromUrl's own optional href argument.

No killstreak-tier switcher (this is a read-only detail page, no tab bar to
build one from - matches ../suggestionsQuickLinks/content.js's own scope
decision for the same reason on its own two pages) and no confirmed data-*
signal for Killstreak tier/Australium on this specific item anchor either
(unlike the classic /suggestion/{id} page's own item element - see
../../oldUI/suggestionsQuickLinks/content.js's own header note on
data-effect_name/data-priceindex there) - resolveIdentityFromUrl's own
killstreakTier/isAustralium params/query-string reading still applies if
next.backpack.tf ever adds them to this anchor's href, so this isn't a
guessed omission, just nothing confirmed live to read yet.

Appended as the last child of the card's own ".card__content" (below the
vote-buttons/price/item-icon row and the "currently open to voting" footer
alert) - same "stay inside the box, at the very end of the content area"
placement ../statsPageQuickLinks/content.js's own addStatsPageQuickLinks
uses for its own row.
*/

import { resolveStatsAndClassifieds, buildStnTradingHref, buildGladiatorHref } from "../../../utils/tf2StatsLinks/index.js";
import { QUALITY_ID_BY_NAME, QUALITY_NAME_BY_ID } from "../../../utils/tf2Quality.js";
import { resolveTargetToolNameFromTitle, matchTargetItemTool } from "../../../utils/tf2StatsLinks/targetTool.js";
import { buildMannStoreHref } from "../addMannStoreButton/content.js";
import {
  CONTROLS_WRAP_CLASS,
  ROW_CLASS,
  ensureStyleInjected,
  resolveIdentityFromUrl,
  buildSnapshotHref,
  resolveEffectNameById,
  buildQuickLinkButton,
  buildDisabledQuickLinkButton,
  buildPricedbLoadingSlot,
  settlePricedbSlot,
} from "../statsPageQuickLinks/content.js";

// Confirmed live - the item preview element on a single suggestion's own
// detail page, its own href carrying the item/quality/priceindex params
// (see this file's own header note). Not scoped to any particular card
// class (".card" is a generic, reused-everywhere Vue component) - this
// selector alone is specific enough (an /stats-linking item element only
// ever appears once on this page).
const ITEM_ANCHOR_SELECTOR = 'a[href^="/stats?item="]';
const CARD_SELECTOR = ".card";
const CARD_CONTENT_SELECTOR = ".card__content";

// Matches /suggestions/{id} but NOT /suggestions/create (that page has its
// own dedicated feature - see ../suggestionsQuickLinks/content.js).
function isSupportedPage() {
  const path = window.location.pathname;
  return path.startsWith("/suggestions/") && path !== "/suggestions/create" && !path.startsWith("/suggestions/create/");
}

function findItemAnchor() {
  return document.querySelector(ITEM_ANCHOR_SELECTOR);
}

function findCardContent(itemAnchor) {
  return itemAnchor?.closest(CARD_SELECTOR)?.querySelector(CARD_CONTENT_SELECTOR) ?? null;
}

// The card's own title (confirmed live: <div class="card__header__title">
// <span>Pretty Boy's Pocket Pistol Strangifier</span> <span
// class="card__header__subtitle"></span></div>) - the name's own span, so a
// subtitle is never read as part of it.
function findCardTitleText(itemAnchor) {
  const title = itemAnchor.closest(CARD_SELECTOR)?.querySelector(".card__header__title");
  return (title?.querySelector("span") ?? title)?.textContent ?? null;
}

/*
@description: Resolves and (re)builds the quick-links row for the current
suggestion - same "signature = current URL, set eagerly before the async
resolves below" race-guard shape every other port of this feature uses.
*/
async function addSuggestionDetailQuickLinks() {
  if (!isSupportedPage()) return;

  const itemAnchor = findItemAnchor();
  if (!itemAnchor) return;
  const content = findCardContent(itemAnchor);
  if (!content) return;

  const signature = window.location.href;
  if (content.dataset.tf2teSuggestionDetailQuickLinksSignature === signature) return;
  content.dataset.tf2teSuggestionDetailQuickLinksSignature = signature;

  content.querySelectorAll(`.${CONTROLS_WRAP_CLASS}`).forEach((el) => el.remove());

  const identity = resolveIdentityFromUrl(itemAnchor.getAttribute("href"));
  if (!identity) return;

  const { itemName, qualityId, knownEffectId, killstreakTier } = identity;
  // A Strangifier's link only says "item=Strangifier&...&priceindex=773"
  // (confirmed live; the target only as a defindex). The card title has the
  // full name, so no link searches the bare "Strangifier".
  const fullToolName = resolveTargetToolNameFromTitle(itemName, findCardTitleText(itemAnchor), QUALITY_NAME_BY_ID[qualityId]);
  const itemNameRaw = fullToolName ? identity.itemNameRaw.slice(0, -itemName.length) + fullToolName : identity.itemNameRaw;

  const knownEffectName = knownEffectId != null ? await resolveEffectNameById(knownEffectId) : null;

  const resolved = await resolveStatsAndClassifieds(itemNameRaw, { knownEffectName, knownEffectId, knownKillstreakTier: killstreakTier });

  // The page may have navigated on again while the above was in flight -
  // see this function's own header note.
  if (window.location.href !== signature) return;

  // Same gladiator.tf/pricedb.io/snapshot display-name distinction
  // ../statsPageQuickLinks/content.js's own addStatsPageQuickLinks
  // documents - see that function's own note.
  const searchDisplayName =
    qualityId === QUALITY_ID_BY_NAME.Unusual && knownEffectName ? itemNameRaw.replace(/^Unusual\s+/, `${knownEffectName} `) : itemNameRaw;

  const buttons = [];
  buttons.push(["snapshot", buildSnapshotHref(searchDisplayName)]);
  buttons.push(["stntrading.eu", buildStnTradingHref(itemNameRaw, resolved.classifiedsFilters)]);
  if (resolved.marketplaceHref) buttons.push(["marketplace.tf", resolved.marketplaceHref]);
  // A target tool searches mannco.store by its full name (buildMannStoreHref's
  // own targetItem branch).
  const targetItem = fullToolName ? matchTargetItemTool(fullToolName)?.targetName : undefined;
  buttons.push(["mannco.store", buildMannStoreHref(itemName, qualityId, { killstreakTier, targetItem, knownEffectName })]);
  buttons.push(["gladiator.tf", buildGladiatorHref(searchDisplayName)]);
  // Loading slot, settled after the row is on the page (settlePricedbSlot).
  buttons.push(["pricedb.io", null, "loading"]);
  if (resolved.postsTfHref) buttons.push(["posts.tf", resolved.postsTfHref]);

  ensureStyleInjected();

  const row = document.createElement("div");
  row.className = ROW_CLASS;
  let pricedbSlot = null;
  buttons.forEach(([label, href, state]) => {
    const el = state === "loading" ? (pricedbSlot = buildPricedbLoadingSlot()) : href ? buildQuickLinkButton(label, href) : buildDisabledQuickLinkButton(label);
    row.appendChild(el);
  });

  const wrap = document.createElement("div");
  wrap.className = CONTROLS_WRAP_CLASS;
  wrap.appendChild(row);

  // The card may have been torn down/replaced by Vue while the above was in
  // flight - re-find it fresh rather than trusting the reference captured
  // before the await.
  const freshContent = findCardContent(findItemAnchor()) || content;
  freshContent.appendChild(wrap);

  settlePricedbSlot(pricedbSlot, searchDisplayName, () => window.location.href === signature);
}

export function suggestionDetailQuickLinks() {
  addSuggestionDetailQuickLinks();

  const observer = new MutationObserver(() => addSuggestionDetailQuickLinks());
  observer.observe(document.body, { childList: true, subtree: true });
}
