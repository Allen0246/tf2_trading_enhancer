/**
 * Adds the same next.backpack.tf:/backpack.tf:/gladiator.tf/pricedb.io/
 * posts.tf/marketplace.tf/mannco.store block used on the main Market listing
 * page (steamcommunity.com/marketListingLinks) into the per-listing detail modal
 * that opens when clicking a card
 * (steamcommunity.com/market/listings/440/{item}?...). No Steam Market
 * button, unlike steamcommunity.com/itemQuickLinks' inventory-page version -
 * this page IS Steam Market. No per-item history icon either (unlike that
 * same inventory-page version) - confirmed live there's no reliable way to
 * recover a specific listing's own asset id here the way findActiveAssetId
 * does on the inventory page (the URL's own query string doesn't carry it).
 *
 * This exists as its own copy rather than reusing marketListingLinks' own
 * builders for a real reason, not just file
 * organization: the page-level "★ Unusual Effect: X" label that one reads
 * only reflects ONE arbitrary listing (whichever the page defaults to
 * showing), but a Market listing page for an Unusual mixes many DIFFERENT
 * effects under one shared item name/URL - confirmed live, this exact page
 * showed "Mega Strike" at the page level while an individual card's own
 * modal showed "Tangled Lights" for that specific listing. Every one of
 * those singleton builders (ROW_ID-keyed, one instance per page) also isn't
 * shaped for something that can open/close/reopen for a different listing
 * many times over one page load, each needing its own fresh
 * resolveStatsAndClassifieds call - hence a per-modal-instance marker
 * (dataset on the modal's own info panel) instead of a page-wide one.
 */
import { findNearestItemPicture, showEffectBehindPicture } from "../shared/itemEffectBackground.js";
import { isEnglishSteamPage, loadEnglishPanelForMarketItem } from "../shared/englishItemDescription.js";
import { resolveStatsAndClassifieds, buildPricedbSearchName, buildGladiatorHref } from "../../utils/tf2StatsLinks/index.js";
import { searchPricedbSkuStatus } from "../../utils/pricedb.js";
import { fillPricedbSlot } from "../../utils/linkButtonStates.js";
import { isSheenKillstreakerFilterEnabled } from "../../utils/sheenKillstreakerFilterSetting.js";
import {
  createStatsRow,
  findLabeledValue,
  getMarketListingItemNameFromUrl,
  findMarketInfoPanels,
} from "../shared/priceWidgets.js";
import {
  createButtonLink,
  createPricedbLoadingSlot,
  buildButtonRow,
  buildMannStoreHref,
} from "../shared/quickLinkButtons.js";

// Stored on an info panel once we've built a section for it. The VALUE is a
// "{itemName}|{effectName}|{sheenName}|{killstreakerName}" signature, not
// just a boolean - confirmed live
// (via screenshots showing an old and new modal panel visible in the DOM at
// the same time), clicking to a different listing from within an open modal
// does NOT reuse the same info panel node; it stacks a brand new one on top
// and leaves the old one sitting in the DOM behind it. So per-node identity
// alone is enough to tell listings apart in the common case, but comparing
// content too means that IF some navigation path ever does reuse a node
// (e.g. via internal DOM diffing on a close/reopen), the stale section still
// gets rebuilt instead of silently kept.
const CONTENT_MARKER = "tf2teModalContent";
// Marks our own inserted section specifically, so maybeInsertIntoModal can
// find and remove a stale one before rebuilding, without touching anything
// else Steam itself rendered into the same info panel.
const SECTION_MARKER = "tf2teModalSection";

/*
@description: Reads this modal's own DISPLAY title - its info panel's direct
<h2> child (see findMarketInfoPanels' own sanity check on this). Despite the
name, this is NOT the item's real identity for parsing purposes -
confirmed live, an individual listing can carry a custom Name Tag (e.g.
"Pro Memoria", quotes and all, for a listing whose real item is "Strange
Professional Killstreak Australium Rocket Launcher"), and Steam substitutes
that custom name for the real one right here, in this exact element. Trusting
it as the item's identity silently broke every downstream quality/killstreak/
Australium parse for a renamed listing (wrong item entirely, not just a
formatting quirk). Kept only as a cheap "has this panel's own content
actually rendered yet" readiness signal (any non-empty h2 text, real name or
not) - see shared/priceWidgets.js's own getMarketListingItemNameFromUrl for
the name maybeInsertIntoModal actually resolves against (stays correct for
EVERY currently-open modal panel, even a stale one stacked behind a newer one,
see findMarketInfoPanels' own note on that - unlike this function's own
per-panel <h2> text, which only ever reflects whichever listing is on top).
@returns: trimmed title text, or null.
*/
function findModalItemName(infoPanel) {
  return infoPanel.querySelector(":scope > h2")?.textContent?.trim() || null;
}

/*
@description: Reads this modal's own "★ Unusual Effect: {name}" label, via
shared/priceWidgets.js's leaf-only findLabeledValue scoped to this panel
(see that function's own note on why only leaf elements are read).
@returns: the effect name (e.g. "Tangled Lights"), or null if this item
isn't Unusual (or the label hasn't rendered into this modal yet).
*/
function findModalEffectName(infoPanel) {
  return findLabeledValue(infoPanel, /^★?\s*Unusual Effect:\s*(.+)$/i);
}

/*
@description: Reads this modal's own "Sheen: {name}" label - only present on
a Killstreak weapon that actually has a Sheen applied.
@returns: the sheen name (e.g. "Hot Rod"), or null.
*/
function findModalSheenName(infoPanel) {
  return findLabeledValue(infoPanel, /^Sheen:\s*(.+)$/i);
}

/*
@description: Reads this modal's own "Killstreaker: {name}" label - only
present on a Professional Killstreak weapon that actually has a Killstreaker
applied.
@returns: the killstreaker name (e.g. "Hypno-Beam"), or null.
*/
function findModalKillstreakerName(infoPanel) {
  return findLabeledValue(infoPanel, /^Killstreaker:\s*(.+)$/i);
}

/*
@description: Builds the next:/classic:/marketplace.tf stack. Deliberately
does NOT show steamcommunity.com/marketListingLinks/content.js's "Search
without ... filter" captions: those cover the page-level panel's labels not
being readable, while this modal is scoped to ONE listing whose own labels
were just read (findModalEffectName and friends), so its searches DO filter
by them.
@returns: the wrapper element, or null if nothing had anything to show.
*/
function buildStatsRows(resolved, gladiatorHref, pricedbSlot, mannStoreHref) {
  const wrapper = document.createElement("div");
  wrapper.style.display = "flex";
  wrapper.style.flexDirection = "column";
  wrapper.style.gap = "5px";

  // No per-item history icon here, unlike steamcommunity.com/itemQuickLinks'
  // own inventory-page version - see this file's own header note: there's no
  // reliable way to recover a specific listing's own asset id on this page.
  const nextRow = createStatsRow("next.backpack.tf", resolved.nextBpStatsHref, resolved.nextClassifiedsHref);
  if (nextRow) wrapper.appendChild(nextRow);

  const classicRow = createStatsRow("backpack.tf", resolved.bpStatsHref, resolved.classifiedsHref);
  if (classicRow) wrapper.appendChild(classicRow);

  // Same button-styled row pairing steamcommunity.com/itemQuickLinks/content.js
  // established (gladiator.tf+pricedb.io+posts.tf on their own row,
  // marketplace.tf+mannco.store on theirs) - no Steam Market button, since
  // this page IS Steam Market. Unlike marketListingLinks' own page-level
  // version, this modal is scoped to one real listing, so mannStoreHref here
  // reflects that listing's actual Sheen/Killstreaker/effect, not a broad
  // unfiltered search - resolved.postsTfHref is scoped to it the same way
  // (comes for free off the same resolveStatsAndClassifieds call, which
  // already receives this listing's own knownEffectName/knownSheenName/
  // knownKillstreakerName below).
  const gladiatorRowButtons = [
    createButtonLink("gladiator.tf", gladiatorHref),
    // Loading slot, settled once the section is on the page (fillPricedbSlot).
    pricedbSlot ?? null,
    createButtonLink("posts.tf", resolved.postsTfHref),
  ].filter(Boolean);
  if (gladiatorRowButtons.length) wrapper.appendChild(buildButtonRow(gladiatorRowButtons));

  const marketplaceRowButtons = [createButtonLink("marketplace.tf", resolved.marketplaceHref), createButtonLink("mannco.store", mannStoreHref)].filter(
    Boolean
  );
  if (marketplaceRowButtons.length) wrapper.appendChild(buildButtonRow(marketplaceRowButtons));

  return wrapper.querySelector("a") ? wrapper : null;
}

/*
@description: Builds the full section (next:/classic:/marketplace.tf stack)
for one resolved listing, left-aligned to match the modal's own surrounding
text (unlike the main page's own centered-under-the-image version) and with a
top border standing in for the modal's own <div role="separator"> convention
(not reused directly - hashed class name, same reasoning as everywhere else
in this file).
@returns: the wrapper element, or null if there was nothing to show at all
(no stats/classifieds/marketplace.tf links resolved).
*/
export function buildModalSection(resolved, gladiatorHref, pricedbSlot, mannStoreHref) {
  const statsRows = buildStatsRows(resolved, gladiatorHref, pricedbSlot, mannStoreHref);
  if (!statsRows) return null; // nothing to show at all

  const wrapper = document.createElement("div");
  wrapper.dataset.marker = SECTION_MARKER;
  wrapper.style.marginTop = "4px";
  wrapper.style.paddingTop = "12px";
  wrapper.style.borderTop = "1px solid rgba(255, 255, 255, 0.1)";
  wrapper.style.display = "flex";
  wrapper.style.flexDirection = "column";
  wrapper.style.alignItems = "flex-start";
  wrapper.style.gap = "8px";
  wrapper.appendChild(statsRows);

  return wrapper;
}

/*
@description: Debounces fn so it only actually runs once DOM mutations
settle, not on every single one - switching to a different listing fires
several mutations in quick succession while React updates the info panel's
content, and running the check on every one of them is wasted work (each
would just see the same not-yet-final DOM and no-op or re-check
redundantly). Waiting for a short quiet period after the last mutation means
maybeInsertIntoModal only actually runs once, against React's final,
settled content for the new listing.
*/
function debounce(fn, delayMs) {
  let timeoutId = null;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delayMs);
  };
}

/*
@description: Walks every currently-open modal info panel (see
findMarketInfoPanels - there can be more than one stacked at once) and, for
any whose own "{itemName}|{effectName}|{sheenName}|{killstreakerName}"
content signature (see CONTENT_MARKER) doesn't match what its section was
last built for, removes the stale section and rebuilds it. Per-panel, not
global, since each panel is its own independent listing. Sheen/Killstreaker
are included in the signature (not just the item name/effect) because two
different listings of the exact same Killstreak weapon (same name, neither
one Unusual) can still carry different Sheens/Killstreakers - itemName+effect
alone would treat those as identical and never re-trigger between them.
*/
async function maybeInsertIntoModal() {
  // Real item identity - see shared/priceWidgets.js's own
  // getMarketListingItemNameFromUrl for why this, not any modal's own <h2>
  // text, is what parsing must run against. Read once per call (not per
  // panel) since every panel on this page shares the same real item type
  // regardless of which listing's modal is open.
  const itemName = getMarketListingItemNameFromUrl();
  if (!itemName) return;

  for (const infoPanel of findMarketInfoPanels()) {
    // Readiness gate only (has this panel's own content rendered yet) - NOT
    // this listing's identity, see findModalItemName's own note.
    if (!findModalItemName(infoPanel)) continue;

    // Confirmed live (Steam in Hungarian): the listing's effect/Sheen/
    // Killstreaker lines are translated, so on a non-English page they're
    // read from its English description instead (see
    // ../shared/englishItemDescription.js), reached through the modal's
    // title or picture - the page script stamps whichever React gives the
    // listing's class ids to. Falls back to this panel's own text.
    const picture = findNearestItemPicture(infoPanel);
    const signalsPanel = isEnglishSteamPage()
      ? infoPanel
      : (await loadEnglishPanelForMarketItem(infoPanel.querySelector(":scope > h2"), picture)) || infoPanel;

    const knownEffectName = findModalEffectName(signalsPanel);
    // The listing's effect behind the modal's large picture, like the
    // inventory panel shows it.
    showEffectBehindPicture(picture, knownEffectName);
    const knownSheenName = findModalSheenName(signalsPanel);
    const knownKillstreakerName = findModalKillstreakerName(signalsPanel);
    const signature = `${itemName}|${knownEffectName ?? ""}|${knownSheenName ?? ""}|${knownKillstreakerName ?? ""}`;
    if (infoPanel.dataset[CONTENT_MARKER] === signature) continue;

    // Marked BEFORE the await, not after - closes the same re-entrancy race
    // this always needed (another mutation firing while
    // resolveStatsAndClassifieds is still in flight for this exact panel
    // shouldn't kick off a second, redundant resolve).
    infoPanel.dataset[CONTENT_MARKER] = signature;
    infoPanel.querySelector(`[data-marker="${SECTION_MARKER}"]`)?.remove();

    // pricedb.io is looked up after the section is shown (fillPricedbSlot
    // below), so its lookup never holds the other links back.
    const resolved = await resolveStatsAndClassifieds(itemName, {
      knownEffectName,
      knownSheenName,
      knownKillstreakerName,
    });
    const sheenKillstreakerFilterEnabled = await isSheenKillstreakerFilterEnabled();

    // This panel's own content may have changed again while those awaits
    // were in flight - only insert if we're still the most recently
    // requested signature, otherwise this result is already stale and the
    // (by-then-already-running) call for the newer signature owns this panel.
    // Checked after the LAST await, so nothing stale can be appended.
    if (infoPanel.dataset[CONTENT_MARKER] !== signature) continue;

    // gladiator.tf names an Unusual "{Effect} {Item}", same as pricedb.io.
    const gladiatorHref = buildGladiatorHref(buildPricedbSearchName(itemName, resolved.classifiedsFilters));
    const pricedbSlot = createPricedbLoadingSlot();
    // No knownPaintName here, unlike steamcommunity.com/itemQuickLinks'
    // inventory-page equivalent (its own findPaintName, which reads a
    // "Paint Color: {name}" line). Not confirmed live whether this modal's
    // own info panel carries that line at all, so it's left as a known gap
    // rather than guessed at.
    // resolveStatsAndClassifieds already gates itself internally (see
    // resolveClassifiedsFilters' own note) - buildMannStoreHref reads
    // knownSheenName/knownKillstreakerName directly though (its
    // fabricatorKit/killstreakKit branch bypasses classifiedsFilters
    // entirely), so that one call needs its own gated copy here.
    const mannStoreHref = resolved.classifiedsFilters
      ? buildMannStoreHref(
          resolved.classifiedsFilters,
          {
            knownEffectName,
            knownSheenName: sheenKillstreakerFilterEnabled ? knownSheenName : null,
            knownKillstreakerName: sheenKillstreakerFilterEnabled ? knownKillstreakerName : null,
          },
          itemName
        )
      : null;

    const modalSection = buildModalSection(resolved, gladiatorHref, pricedbSlot, mannStoreHref);
    if (modalSection) {
      infoPanel.appendChild(modalSection);
      fillPricedbSlot(pricedbSlot, {
        lookup: () => searchPricedbSkuStatus(buildPricedbSearchName(itemName, resolved.classifiedsFilters)),
        buildLink: (href) => createButtonLink("pricedb.io", href),
        isCurrent: () => infoPanel.dataset[CONTENT_MARKER] === signature,
      });
    }
  }
}

const debouncedMaybeInsertIntoModal = debounce(maybeInsertIntoModal, 250);

export function marketListingDetailModal() {
  debouncedMaybeInsertIntoModal(); // in case a modal's already open when this first runs
  new MutationObserver(debouncedMaybeInsertIntoModal).observe(document.body, { childList: true, subtree: true });
}
