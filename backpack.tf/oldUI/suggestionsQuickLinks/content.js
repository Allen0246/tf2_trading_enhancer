/*
@description: Adds the same
marketplace.tf/mannco.store/gladiator.tf/pricedb.io/posts.tf/stntrading.eu
quick-links row ../statsPageQuickLinks/content.js already adds to classic
backpack.tf's own /stats page, on TWO of classic's own suggestion-related
pages instead: 1. The "Create a price suggestion" page (/vote/.../...),
confirmed live:
https://backpack.tf/vote/Vintage/Blutsauger/Tradable/Craftable. 2. A single
suggestion's own detail page (/suggestion/{id}), confirmed live:
https://backpack.tf/suggestion/6a8008ebe414a22bb907b6ab - a DIFFERENT markup
shape (see findInsertionTarget's own note), not just a different URL for the
same DOM. Same feature ../../nextUI/suggestionsQuickLinks/content.js already
adds for next.backpack.tf's own equivalent /suggestions/create page.

Resolves the item's identity straight off the item element's own data-*
attributes (confirmed live on /vote: data-base_name="Blutsauger"
data-q_name="Vintage" data-quality="3" data-priceindex="0"
data-craftable="1" data-tradable="1"; confirmed live on /suggestion/{id}, an
Unusual: data-base_name="Train of Thought" data-q_name="Unusual"
data-quality="5" data-priceindex="32" data-effect_name="Orbiting Planets"),
same mechanism ../statsPageQuickLinks/content.js's own resolveIdentity
already uses for /stats (the shared row styling and button builders are
imported from there; the identity reader is a local variant). Unlike that
page, neither of these has a
killstreak-tier tab bar to read an active tier from at all (confirmed live:
no ".stats-killstreak-list" on either), and no confirmed data-* attribute
for killstreak tier or Australium on either page - scope is plain items
and Unusuals only for now (same "ship what's confirmed" convention this
codebase already follows elsewhere, e.g. ../../nextUI/statsPageQuickLinks/
content.js's own header note), rather than guessing an unconfirmed attribute
name.

data-effect_name (confirmed live on /suggestion/{id}'s own item element,
same attribute ../effectCategoryFilter/content.js and ../inventoryGroupBy/
content.js already rely on elsewhere) lets gladiator.tf/pricedb.io search the
trading community's own "{Effect} {Item}" convention directly - same
distinction ../../nextUI/statsPageQuickLinks/content.js's own
searchDisplayName documents for the identical gap on that page. It is not
confirmed present on /vote's own item element, so there the name resolved
from data-priceindex's effect id (resolveStatsAndClassifieds' knownEffectId
path, which reads the bundled effect table) is used instead.

Also gets a Snapshot button (first in the row, matching
../../nextUI/statsPageQuickLinks/content.js's own placement) - classic
backpack.tf has no snapshots page of its own, so this deliberately links
to next.backpack.tf's own /classifieds/snapshots/ page instead, the one
confirmed-working case this codebase has (see buildSnapshotHref below -
duplicated rather than imported, since next.backpack.tf's own
web_accessible_resources entry doesn't expose backpack.tf/nextUI/** to a
page on plain backpack.tf at all).

Appended as the last child of the relevant page's own content container
(".item-panel" on /vote, ".main" on /suggestion/{id} - see
findInsertionTarget's own note on why ".main" specifically, not its own
".body" child), not a sibling after the whole panel - seen on the next-gen
version that a sibling row landed outside its own box entirely (see
../../nextUI/suggestionsQuickLinks/content.js's own header note).
*/

import { resolveStatsAndClassifieds, buildTargetToolFullName, buildStnTradingHref, buildGladiatorHref } from "../../../utils/tf2StatsLinks/index.js";
import { buildMannStoreHref } from "../addMannStoreButton/content.js";
import {
  CONTROLS_WRAP_CLASS,
  ROW_CLASS,
  ensureStyleInjected,
  buildQuickLinkButton,
  buildDisabledQuickLinkButton,
  buildPricedbLoadingSlot,
  settlePricedbSlot,
} from "../statsPageQuickLinks/content.js";

// Confirmed live - the item panel at the top of /vote/.../... (item icon +
// name, above the actual voting controls further down the page).
const VOTE_ITEM_PANEL_SELECTOR = ".item-panel";
// Confirmed live - a single suggestion's own detail page (/suggestion/{id}):
// ".suggestion.sg-base" > ".main" > ".body" (holding both ".header" -
// title/submitter/price-change/vote-count controls - and the item element
// itself, as siblings, not nested inside a ".item-singular" wrapper the way
// /vote's own item is). The row is appended into ".main" itself, one level
// UP from ".body" - appending inside ".body" (a flex row sitting the header
// text and the item icon side by side) squeezed the row in as a third flex
// item next to the icon instead of stacking it below the whole "12
// keys"/vote-count line; ".main" only ever holds ".body" on this page
// (confirmed live - the page's own separate "Leave a Comment" panel further
// down is a sibling of the whole ".panel.panel-main", not a child of
// ".main"), so appending there instead lands the row as its own full-width
// block right below everything else, still inside the same boxed panel.
const SUGGESTION_SELECTOR = ".suggestion.sg-base";
const SUGGESTION_MAIN_SELECTOR = ".main";
const ITEM_SELECTOR = ".item";

// next.backpack.tf's own classifieds price-history page - see this file's
// own header note on why classic links there instead of a (nonexistent)
// classic equivalent. Same builder ../../nextUI/statsPageQuickLinks/content.js's
// own buildSnapshotHref documents, duplicated here rather than imported.
function buildSnapshotHref(itemNameRaw) {
  return `https://next.backpack.tf/classifieds/snapshots/${encodeURIComponent(itemNameRaw)}`;
}

function isSupportedPage() {
  return window.location.pathname.startsWith("/vote/") || window.location.pathname.startsWith("/suggestion/");
}

/*
@description: Finds the container this feature both searches for the item
element inside (querySelector reaches any descendant depth, so it doesn't
matter whether the item sits directly inside this container or one level
deeper via /vote's own ".item-singular" wrapper - see this file's own header
note) AND appends its own row into. Tries /vote's own shape first, then
/suggestion/{id}'s own - the two pages are mutually exclusive by URL, but
checking both keeps this one function working for either without the caller
needing to know which page it's on.
*/
function findInsertionTarget() {
  const votePanel = document.querySelector(VOTE_ITEM_PANEL_SELECTOR);
  if (votePanel) return votePanel;
  const suggestion = document.querySelector(SUGGESTION_SELECTOR);
  return suggestion?.querySelector(SUGGESTION_MAIN_SELECTOR) ?? null;
}

/*
@description: Reads the item's identity straight off its own data-*
attributes - same shape ../statsPageQuickLinks/content.js's own
resolveIdentity uses for /stats, minus the killstreak-tier tab reading
(neither page this feature covers has one - see this file's own header
note). Returns null when the item element or its required attributes
aren't found.
*/
function resolveIdentity(container) {
  const item = container.querySelector(ITEM_SELECTOR);
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

  const itemNameRaw = qualityName === "Unique" ? baseName : `${qualityName} ${baseName}`;

  const priceindexRaw = item.getAttribute("data-priceindex");
  const priceindex = priceindexRaw ? Number(priceindexRaw) : 0;
  const knownEffectId = qualityName === "Unusual" && priceindex > 0 ? priceindex : null;

  // Confirmed live on /suggestion/{id}'s own item element - see this file's
  // own header note. Not confirmed present on /vote's own item element, so
  // this can come back null there (see searchDisplayName's own note at the
  // call site for the fallback).
  const knownEffectName = qualityName === "Unusual" ? item.getAttribute("data-effect_name") || null : null;

  return { itemName: baseName, qualityId, itemNameRaw, knownEffectId, knownEffectName };
}

/*
@description: Resolves and (re)builds the quick-links row for the current
item - same "signature = current URL, set eagerly before the async resolves"
race-guard shape every other port of this feature uses.
*/
async function addSuggestionsQuickLinks() {
  if (!isSupportedPage()) return;

  const target = findInsertionTarget();
  if (!target) return;

  const signature = window.location.href;
  if (target.dataset.tf2teSuggestionsQuickLinksSignature === signature) return;
  target.dataset.tf2teSuggestionsQuickLinksSignature = signature;

  target.querySelectorAll(`.${CONTROLS_WRAP_CLASS}`).forEach((el) => el.remove());

  const identity = resolveIdentity(target);
  if (!identity) return;

  const { itemName, qualityId, itemNameRaw, knownEffectId, knownEffectName } = identity;

  // pricedb.io is looked up after the row is shown (settlePricedbSlot), so
  // its lookup never holds the whole row back.
  const resolved = await resolveStatsAndClassifieds(itemNameRaw, { knownEffectId, knownEffectName });

  // The page may have navigated on again while the above was in flight -
  // see this function's own header note.
  if (window.location.href !== signature) return;

  // gladiator.tf/pricedb.io want the trading community's own "{Effect}
  // {Item}" convention, not Steam's raw "Unusual {Item}" text itemNameRaw
  // carries (correct for resolveStatsAndClassifieds/stntrading.eu, wrong for
  // these two) - see this file's own header note. The effect name is the
  // page's own data-effect_name, else the one resolved from
  // data-priceindex's effect id (/vote's item element has no
  // data-effect_name); itemNameRaw unchanged when neither is known.
  const effectName = knownEffectName ?? resolved.classifiedsFilters?.effectName ?? null;
  const searchDisplayName = effectName ? itemNameRaw.replace(/^Unusual\s+/, `${effectName} `) : itemNameRaw;

  const buttons = [];
  // First in the row. Same effect-name-substituted searchDisplayName
  // gladiator.tf/pricedb.io use below (not itemNameRaw's own literal
  // "Unusual" word) - confirmed live:
  // "/classifieds/snapshots/Orbiting%20Planets%20Train%20of%20Thought", not
  // "...Unusual%20Train...".
  buttons.push(["snapshot", buildSnapshotHref(searchDisplayName)]);
  buttons.push(["stntrading.eu", buildStnTradingHref(itemNameRaw, resolved.classifiedsFilters)]);
  if (resolved.marketplaceHref) buttons.push(["marketplace.tf", resolved.marketplaceHref]);
  buttons.push(["mannco.store", buildMannStoreHref({ itemName, qualityId, knownEffectName: effectName })]);
  buttons.push(["gladiator.tf", buildGladiatorHref(searchDisplayName)]);
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
  // CONTROLS_WRAP_CLASS's own shared style pads 10px above the row and 14px
  // below it (tuned for ../statsPageQuickLinks/content.js's own placement) -
  // overridden here to match the 10px on both sides. Set inline (not in the
  // shared style itself) so the /stats page's own row is unaffected - same
  // approach ../../nextUI/suggestionsQuickLinks/content.js's own row uses.
  wrap.style.paddingBottom = "10px";
  wrap.appendChild(row);

  // The target may have been re-rendered while the above was in flight -
  // re-find it fresh rather than trusting the reference captured before
  // the await.
  const freshTarget = findInsertionTarget() || target;
  freshTarget.appendChild(wrap);

  settlePricedbSlot(pricedbSlot, searchDisplayName, () => window.location.href === signature);
}

export function suggestionsQuickLinks() {
  addSuggestionsQuickLinks();

  const observer = new MutationObserver(() => addSuggestionsQuickLinks());
  observer.observe(document.body, { childList: true, subtree: true });
}
