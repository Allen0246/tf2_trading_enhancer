/*
@description: Adds a "mannco.store" button inside next.backpack.tf's
item-preview tooltip, right next to (inside the SAME row as)
../addMarketplaceButton/content.js's own marketplace.tf button - same "anchor
off a specific sibling button, not a standalone row" approach
../addPricedbButton/content.js already established for the gladiator.tf
button (see that file's own header note on the reasoning), applied here to
marketplace.tf instead.

Unlike pricedb.io, mannco.store needs no network call at all - it has its own
site-wide filtered-search page (https://mannco.store/tf2?search=...&quality=
...&festivized=...&killstreak=...&sheen=...&killstreaker=...&paint=...&
warpaints=...&effect=...), confirmed live against several real filter
combinations built on that page. Every
param value is a literal display-name string (not an id), so this is built
entirely synchronously from the SAME tooltip signals
../addMarketplaceButton/content.js reads (../shared/tooltipItemDetails.js),
with NO Steam Web API schema resolution needed at all (unlike
marketplace.tf's own resolveStatsAndClassifieds) - the only thing this file
depends on marketplace.tf's OWN button for is where to insert itself, not
whether it can build a link at all.

Deliberately links to the FILTERED SEARCH page, not a single item's own page
(https://mannco.store/item/{slug}) - discussed at length with the user: an
item-page slug only encodes quality/skin/weapon/wear/killstreak-tier/
festivized/australium/craftability, since Sheen/Killstreaker/Paint/Spell/Parts
aren't part of an item's NAME at all, they're per-listing rolled attributes -
so two completely different Sheens on the same-named item would share the
exact same item-page slug regardless. The filtered search page can narrow by
those too, which is strictly more precise for a trader checking a SPECIFIC
item's own worth (this extension's own primary audience, not casual buyers
who'd be fine landing on a whole category page).

Confirmed live gaps, not yet handled: Wear tier and Spell/Parts/Class/Type
filters (not in any of the confirmed-live examples this was built from).

A Killstreak Kit/Fabricator's anchor itemName is just "Kit"/"Fabricator"
(see ../shared/tooltipItemDetails.js's isKillstreakToolName), so its search
uses the tooltip title's full name instead, plus its fixed Sheen/
Killstreaker - the same confirmed-live shape
steamcommunity.com/shared/quickLinkButtons.js's buildMannStoreHref uses for
those two item types.
*/

import { buildTargetToolFullName } from "../../../utils/tf2StatsLinks/index.js";
import { QUALITY_NAME_BY_ID } from "../../../utils/tf2Quality.js";
import { copyScopedStyleAttrs } from "../shared/vueScopedStyle.js";
import { isSheenKillstreakerFilterEnabled } from "../../../utils/sheenKillstreakerFilterSetting.js";
import {
  CLASSIFIEDS_BUTTON_SELECTOR,
  findTooltipRoot,
  readClassifiedsAnchorParams,
  findKnownEffectName,
  findKnownSkinName,
  findKnownAttributes,
  findTooltipTitle,
  isKillstreakToolName,
  killstreakTierFromAttributes,
} from "../shared/tooltipItemDetails.js";

// Cached - same reasoning ../../oldUI/addMannStoreButton/content.js's own
// module-level cache documents (this file's own addMannStoreButtonTo/
// buildMannStoreParams are both fully synchronous, and buildMannStoreHref is
// also called directly by ../statsPageQuickLinks/content.js). Started by
// addMannStoreButton() at feature start-up, never at module load, so a plain
// import of this file stays side-effect-free.
let sheenKillstreakerFilterEnabled = true;
let sheenKillstreakerFilterWatcherStarted = false;
function ensureSheenKillstreakerFilterWatcher() {
  if (sheenKillstreakerFilterWatcherStarted) return;
  sheenKillstreakerFilterWatcherStarted = true;
  isSheenKillstreakerFilterEnabled().then((enabled) => {
    sheenKillstreakerFilterEnabled = enabled;
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.sheenKillstreakerFilterEnabled) {
      sheenKillstreakerFilterEnabled = changes.sheenKillstreakerFilterEnabled.newValue !== false;
    }
  });
}

const MANNSTORE_BUTTON_CLASS = "tf2te-mannco-store-button";
// ../addMarketplaceButton/content.js's own button - this file's own insertion
// point (see this file's own header note on why).
const MARKETPLACE_BUTTON_SELECTOR = ".tf2te-marketplace-tf-button";

// Confirmed live against several real mannco.store/tf2 search URLs.
const KILLSTREAK_PARAM_BY_TIER = {
  0: "No",
  1: "Killstreak",
  2: "Specialized Killstreak",
  3: "Professional Killstreak",
};

/*
@description: Builds mannco.store's own filtered-search query string,
confirmed live: every param is the exact display-name text mannco's own
filter dropdowns show (spaces as "+", same URLSearchParams default encoding
utils/tf2StatsLinks/index.js's buildGladiatorHref also relies on),
not an id. search comes straight from the Classifieds anchor's own itemName
param, already stripped of quality/killstreak-tier words - the exact same
value every other button in this tooltip already reads (plus "Australium",
re-added from the anchor's own australium=1 param - see below).

quality/festivized/killstreak/warpaints are always set (even to their "none"
value - "No festivized", "No", "No WarPaints") since this file always knows
that state for certain from the tooltip's own scan, rather than leaving mannco
to guess/include everything; sheen/killstreaker/paint/effect are only set
when actually present, since "no value" isn't a confirmed-live param mannco
accepts for those.

targetItem (only ever set for a Strangifier/Chemistry Set - see
buildTargetToolFullName) short-circuits all of the above entirely -
the confirmed-live shape for one of these is a bare "search" param alone.

ItemName never carries "Australium" as a literal word (the Classifieds
anchor instead carries a separate "australium=1" boolean query param, with
itemName staying completely bare, e.g. "Medi Gun"). Unlike marketplace.tf (a
dedicated saustralium filter - see ../addMarketplaceButton/content.js's own
matching fix), mannco.store has no such filter param at all, so the word has
to be embedded directly into the "search" text itself instead - see
isAustralium below.
See #144.
*/
function buildMannStoreParams({
  itemName,
  qualityId,
  knownEffectName,
  knownSkinName,
  knownSheenName,
  knownKillstreakerName,
  knownPaintName,
  isFestivized,
  isAustralium,
  killstreakTier,
  targetItem,
  killstreakToolName,
}) {
  ensureSheenKillstreakerFilterWatcher();

  // A Kit/Fabricator searches by its full name (the anchor's itemName is just
  // "Kit"/"Fabricator") plus its fixed Sheen/Killstreaker - see this file's
  // header note.
  if (killstreakToolName) {
    const params = new URLSearchParams({ search: killstreakToolName });
    if (sheenKillstreakerFilterEnabled && knownSheenName) params.set("sheen", knownSheenName);
    if (sheenKillstreakerFilterEnabled && knownKillstreakerName) params.set("killstreaker", knownKillstreakerName);
    return params;
  }

  if (targetItem) {
    // A target tool searches mannco.store by its full name alone (e.g.
    // ?search=Professor+Speks+Strangifier+Chemistry+Set), with the target
    // read from the Classifieds anchor's own "targetItem" param. See #44.
    return new URLSearchParams({ search: buildTargetToolFullName(itemName, targetItem) });
  }

  const params = new URLSearchParams();
  params.set("search", `${isAustralium ? "Australium " : ""}${itemName}`);

  const qualityName = QUALITY_NAME_BY_ID[qualityId];
  if (qualityName) params.set("quality", qualityName);

  params.set("festivized", isFestivized ? "Festivized" : "No festivized");
  params.set("killstreak", KILLSTREAK_PARAM_BY_TIER[killstreakTier] ?? "No");
  params.set("warpaints", knownSkinName || "No WarPaints");

  if (sheenKillstreakerFilterEnabled && knownSheenName) params.set("sheen", knownSheenName);
  if (sheenKillstreakerFilterEnabled && knownKillstreakerName) params.set("killstreaker", knownKillstreakerName);
  // Never applied for an Unusual - what makes an Unusual worth finding is its
  // effect, not whichever paint (if any) happens to be applied, and filtering
  // by both together risks eliminating results a user actually wants. Same
  // exclusion rule utils/tf2StatsLinks/index.js's own
  // resolveClassifiedsFilters already enforces for marketplace.tf's own
  // spaint[] filter (see its classicPaintId note).
  if (knownPaintName && QUALITY_NAME_BY_ID[qualityId] !== "Unusual") params.set("paint", knownPaintName);
  if (knownEffectName) params.set("effect", knownEffectName);

  return params;
}

// Exported - backpack.tf/nextUI/statsPageQuickLinks/content.js reuses this
// exact builder for the /stats page's own quick-links row - already a pure
// function of already-known values, nothing tied to this file's own
// tooltip-scraping context.
export function buildMannStoreHref(itemName, qualityId, attrs) {
  const params = buildMannStoreParams({ itemName, qualityId, ...attrs });
  return `https://mannco.store/tf2?${params.toString()}`;
}

function findMarketplaceButton(classifiedsAnchor) {
  return findTooltipRoot(classifiedsAnchor).querySelector?.(MARKETPLACE_BUTTON_SELECTOR) ?? null;
}

/*
@description: Builds the mannco.store button itself - cloned from the
marketplace.tf button's own classes/scoped-style attrs (not the Classifieds
anchor's, since it's the marketplace.tf button this sits directly beside), so
it's visually identical to its new neighbor. Strips the marketplace.tf
button's own marker class out of the clone first - same reasoning
../addPricedbButton/content.js's own buildPricedbButton documents for
gladiator.tf's marker class.
*/
function buildMannStoreButton(referenceButton, href) {
  const button = document.createElement("a");
  button.href = href;
  button.target = "_blank";
  button.rel = "noopener noreferrer";
  const clonedClasses = referenceButton.className
    .replace(new RegExp(`\\b${MARKETPLACE_BUTTON_SELECTOR.slice(1)}\\b`), "")
    .trim();
  button.className = `${clonedClasses} ${MANNSTORE_BUTTON_CLASS}`;
  copyScopedStyleAttrs(referenceButton, button);
  // Rendered flush against the marketplace.tf button with no gap at all -
  // always inserted right after it (see addMannStoreButtonTo's own
  // insertAdjacentElement call below), same fixed-position reasoning
  // ../addPricedbButton/content.js's own buildPricedbButton documents for its
  // own margin. No marginTop/marginBottom here - the row
  // (../shared/tooltipButtonRow.js) owns the vertical margin.
  button.style.marginLeft = "3.5px";
  button.textContent = "mannco.store";
  return button;
}

function findExistingMannStoreButton(classifiedsAnchor) {
  return findTooltipRoot(classifiedsAnchor).querySelector?.(`.${MANNSTORE_BUTTON_CLASS}`) ?? null;
}

/*
@description: Resolves and inserts (or updates) the mannco.store button for
one Classifieds anchor's tooltip, right after the marketplace.tf button in
the SAME row. Fully synchronous (unlike ../addPricedbButton/content.js's own
addPricedbButtonTo) - no network call needed at all, so there's no async
resolve to race-guard against, but the SAME "wait for the dependency button,
retry once it appears" problem still applies, since marketplace.tf's own
button is itself inserted asynchronously (behind its own schema resolve) and
may not exist yet on the very first scan.
*/
function addMannStoreButtonTo(classifiedsAnchor) {
  const href = classifiedsAnchor.getAttribute("href");
  const { itemName, qualityId, targetItem, isAustralium } = readClassifiedsAnchorParams(classifiedsAnchor);
  if (!itemName) return;

  const knownEffectName = findKnownEffectName(classifiedsAnchor);
  const knownSkinName = findKnownSkinName(classifiedsAnchor);
  const { knownSheenName, knownKillstreakerName, knownPaintName, isFestivized, isBasicKillstreak } =
    findKnownAttributes(classifiedsAnchor);
  const killstreakTier = killstreakTierFromAttributes(knownSheenName, knownKillstreakerName, isBasicKillstreak);
  const tooltipTitle = findTooltipTitle(classifiedsAnchor);
  const killstreakToolName = isKillstreakToolName(tooltipTitle) ? tooltipTitle : null;

  const signature = [
    href,
    knownEffectName,
    knownSkinName,
    knownSheenName,
    knownKillstreakerName,
    knownPaintName,
    isFestivized,
    killstreakTier,
    killstreakToolName,
  ].join("|");

  // Checked BEFORE claiming the signature below, same ordering
  // ../addPricedbButton/content.js's own addPricedbButtonTo documents - a
  // "not ready yet" bail-out here must not permanently block a later retry
  // once marketplace.tf's own button actually appears.
  const existing = findExistingMannStoreButton(classifiedsAnchor);
  const marketplaceButton = existing ? null : findMarketplaceButton(classifiedsAnchor);
  if (!existing && !marketplaceButton) return;

  if (classifiedsAnchor.dataset.tf2teMannStoreSignature === signature) return;
  classifiedsAnchor.dataset.tf2teMannStoreSignature = signature;

  const mannStoreHref = buildMannStoreHref(itemName, qualityId, {
    knownEffectName,
    knownSkinName,
    knownSheenName,
    knownKillstreakerName,
    knownPaintName,
    isFestivized,
    isAustralium,
    killstreakTier,
    targetItem,
    killstreakToolName,
  });

  if (existing) {
    existing.href = mannStoreHref;
    return;
  }

  // The tooltip may have already been torn down (hover ended), or Vue may
  // have replaced marketplace.tf's own button, since the checks above -
  // re-find it fresh rather than trusting the reference captured earlier.
  const freshMarketplaceButton = findMarketplaceButton(classifiedsAnchor);
  if (!freshMarketplaceButton) return;

  freshMarketplaceButton.insertAdjacentElement("afterend", buildMannStoreButton(freshMarketplaceButton, mannStoreHref));
}

function scan(root) {
  root.querySelectorAll?.(CLASSIFIEDS_BUTTON_SELECTOR).forEach((anchor) => {
    addMannStoreButtonTo(anchor);
  });
}

// Re-attempts every classifieds anchor in the SAME tooltip a given
// marketplace.tf button belongs to - same reasoning
// ../addPricedbButton/content.js's own retryForGladiatorButton documents for
// gladiator.tf's button, applied here to marketplace.tf's instead.
function retryForMarketplaceButton(marketplaceButton) {
  findTooltipRoot(marketplaceButton).querySelectorAll?.(CLASSIFIEDS_BUTTON_SELECTOR).forEach((anchor) => addMannStoreButtonTo(anchor));
}

function handleAddedNode(node) {
  if (node.matches?.(CLASSIFIEDS_BUTTON_SELECTOR)) {
    addMannStoreButtonTo(node);
  } else {
    scan(node);
  }

  if (node.matches?.(MARKETPLACE_BUTTON_SELECTOR)) {
    retryForMarketplaceButton(node);
  } else {
    node.querySelectorAll?.(MARKETPLACE_BUTTON_SELECTOR).forEach(retryForMarketplaceButton);
  }
}

export function addMannStoreButton() {
  // Started at feature start-up, not only lazily on the first button build -
  // see ../../oldUI/addMannStoreButton/content.js's own addMannStoreButton
  // note (the first tooltip on every page load ignored a filter turned off).
  ensureSheenKillstreakerFilterWatcher();
  scan(document);

  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        handleAddedNode(node);
      });
    });
  });

  observer.observe(document.body, { childList: true, subtree: true });
}
