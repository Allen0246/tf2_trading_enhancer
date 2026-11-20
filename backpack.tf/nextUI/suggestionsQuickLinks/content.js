/*
@description: Adds the same
marketplace.tf/mannco.store/gladiator.tf/pricedb.io/posts.tf/stntrading.eu
quick-links row ../statsPageQuickLinks/content.js already adds to the
/stats page's own "Item Information" card, underneath the item editor on
next.backpack.tf's "Suggest an item" form (/suggestions/create) instead.
Confirmed live: https://next.backpack.tf/suggestions/create?item=
Medi%20Gun&quality=Strange - this page's own URL carries the exact same
item/quality/priceindex/killstreakTier param shape
../statsPageQuickLinks/content.js's own resolveIdentityFromUrl already
parses, so that function (and every button/style helper it exports) is
reused wholesale here rather than a second copy.

Deliberately NO Killstreak-tier switcher (unlike
../statsPageQuickLinks/content.js's own buildKillstreakTabBar). A
killstreakTier URL param, when present, still feeds into
itemNameRaw/mannco.store's own filter for accurate LINK BUILDING on an
already-Killstreak-tiered weapon (e.g. a suggestion made from a
Professional Killstreak Wrench's own /stats page) - only the switcher UI
itself is skipped, not the identity resolution it would have driven.

Appended as the LAST child of the editor's own inner ".bg-card-inset" panel
(the dropdowns/toggles column, right of the item preview) - inserting it as
a sibling AFTER the whole ".editor" card instead lands the row outside/below
the card's own dark rounded box entirely, reading as a disconnected, out-of-place strip rather than part of
the form. Appending inside ".bg-card-inset" instead (itself a plain block
container, not the flex row ".editor" itself is - appending a THIRD flex
child there would squeeze rather than stack) keeps it visually inside the
same box, stacked below the
Craftable/Australium/Festivized/Expand-Recipe-Tray toggles. Gated on an
explicit pathname check (/suggestions/create) rather than the DOM-only
self-scoping ../statsPageQuickLinks/content.js uses for the /stats page -
this page has no unique card title to key off, and
".editor"/".bg-card-inset" alone are too generic to trust site-wide.
*/

import { resolveStatsAndClassifieds, buildStnTradingHref, buildGladiatorHref } from "../../../utils/tf2StatsLinks/index.js";
import { QUALITY_ID_BY_NAME } from "../../../utils/tf2Quality.js";
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

// Confirmed live - the item editor card at the top of /suggestions/create's
// own form (item preview + dropdowns + Craftable/Australium/Festivized
// toggles), and its own inner panel holding the dropdowns/toggles
// (INSET_SELECTOR) - the actual insertion target, see this file's own
// header note on why.
const EDITOR_SELECTOR = ".editor.bg-card-background";
const INSET_SELECTOR = ".bg-card-inset";

function isSupportedPage() {
  return window.location.pathname.startsWith("/suggestions/create");
}

function findEditor() {
  return document.querySelector(EDITOR_SELECTOR);
}

function findInsetPanel(editor) {
  return editor?.querySelector(INSET_SELECTOR) ?? null;
}

/*
@description: Resolves and (re)builds the quick-links row for the current
item, replacing whatever this function built for a previous item - same
"signature is the current URL, set eagerly before the async resolves below"
race protection ../statsPageQuickLinks/content.js's own addStatsPageQuickLinks
uses (a fast in-app navigation to a DIFFERENT item's suggestion form, no
full page reload on this Vue SPA, must not have a slower earlier resolve
land after a newer one and attach the wrong item's links).
*/
async function addSuggestionsQuickLinks() {
  if (!isSupportedPage()) return;

  const editor = findEditor();
  if (!editor) return;
  const inset = findInsetPanel(editor);
  if (!inset) return; // markup changed - don't guess where to put it

  const signature = window.location.href;
  if (editor.dataset.tf2teSuggestionsQuickLinksSignature === signature) return;
  editor.dataset.tf2teSuggestionsQuickLinksSignature = signature;

  editor.querySelectorAll(`.${CONTROLS_WRAP_CLASS}`).forEach((el) => el.remove());

  const identity = resolveIdentityFromUrl();
  if (!identity) return;

  const { itemName, qualityId, itemNameRaw, knownEffectId, killstreakTier, isAustralium } = identity;

  const knownEffectName = knownEffectId != null ? await resolveEffectNameById(knownEffectId) : null;

  const resolved = await resolveStatsAndClassifieds(itemNameRaw, { knownEffectName, knownEffectId, knownKillstreakTier: killstreakTier });

  // The URL may have moved on again while the above was in flight - see
  // this function's own header note.
  if (window.location.href !== signature) return;

  // Same gladiator.tf/pricedb.io display-name distinction ../statsPageQuickLinks/
  // content.js's own addStatsPageQuickLinks documents - see that function's
  // own note.
  const searchDisplayName =
    qualityId === QUALITY_ID_BY_NAME.Unusual && knownEffectName ? itemNameRaw.replace(/^Unusual\s+/, `${knownEffectName} `) : itemNameRaw;

  const buttons = [];
  // First in the row. Same effect-name-substituted searchDisplayName
  // gladiator.tf/pricedb.io use below (not itemNameRaw's own literal
  // "Unusual" word) - confirmed live:
  // "/classifieds/snapshots/Orbiting%20Planets%20Train%20of%20Thought", not
  // "...Unusual%20Train...".
  buttons.push(["snapshot", buildSnapshotHref(searchDisplayName)]);
  buttons.push(["stntrading.eu", buildStnTradingHref(itemNameRaw, resolved.classifiedsFilters)]);
  if (resolved.marketplaceHref) buttons.push(["marketplace.tf", resolved.marketplaceHref]);
  buttons.push(["mannco.store", buildMannStoreHref(itemName, qualityId, { killstreakTier, isAustralium, knownEffectName })]);
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
  // CONTROLS_WRAP_CLASS's own shared style pads 10px above the row and 14px
  // below it (tuned for ../statsPageQuickLinks/content.js's own placement) -
  // overridden here to the same 14px on both sides, and margin-top zeroed
  // out so padding-top is the only thing setting the gap above the row,
  // matching padding-bottom exactly. Set inline (not in the shared style
  // itself) so the /stats page's own row is unaffected.
  wrap.style.paddingTop = "14px";
  wrap.style.marginTop = "0";
  wrap.appendChild(row);

  // The editor/inset panel may have been torn down/replaced by Vue while
  // the above was in flight - re-find fresh rather than trusting the
  // reference captured before the await.
  const freshInset = findInsetPanel(findEditor()) || inset;
  freshInset.appendChild(wrap);

  settlePricedbSlot(pricedbSlot, searchDisplayName, () => window.location.href === signature);
}

export function suggestionsQuickLinks() {
  addSuggestionsQuickLinks();

  const observer = new MutationObserver(() => addSuggestionsQuickLinks());
  observer.observe(document.body, { childList: true, subtree: true });
}
