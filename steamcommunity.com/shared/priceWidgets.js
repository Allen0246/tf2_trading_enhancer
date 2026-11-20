/**
 * Small UI helpers shared by steamcommunity.com's own stats-link features
 * (marketListingLinks, marketListingModal, itemQuickLinks) - all real ES modules under
 * steamcommunity.com/, so (unlike a module under another site's own folder,
 * which web_accessible_resources scopes to that site alone) nothing stops
 * them sharing a module here (hand-duplicated copies drift apart - see
 * steamcommunity.com/tradeOffer/shared.js's own sharedStyles.itemOverlay note
 * for a concrete case). Each file's own orchestration logic (which of these to
 * call, in what order, with what page-specific wrapper) is NOT pulled in here -
 * only the leaf, stateless pieces.
 */
import { parsePriceParts } from "../../utils/priceText.js";

/*
@description: Reads the real item identity off a Market listing page's own
URL (e.g. "/market/listings/440/Strange%20Voodoo%20Juju" -> "Strange Voodoo
Juju") - NOT any listing's own rendered title text, which can be silently
overridden by a seller's custom Name Tag (confirmed live: a renamed listing's
own <h2>/title text shows the custom name instead of the real item, breaking
every downstream quality/killstreak/Australium parse if trusted). This page's
own URL is keyed off the real market_hash_name (Steam groups every listing on
it by that exact type, custom names and all), never any one listing's custom
name, so it's the reliable source instead. Shared by marketListingLinks (the
page-level links row) and marketListingModal (the per-listing detail modal),
which both need this same item identity for the same reason.
@returns: the decoded item name, or null if this isn't a market listing URL.
*/
export function getMarketListingItemNameFromUrl() {
  const match = /\/market\/listings\/\d+\/([^/?]+)/.exec(window.location.pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

/*
@description: Yields the trimmed text of every LEAF (no element children of
its own) div/span within container, scoped to container specifically (not the
whole document).

Leaf-only, not just "any div/span" - confirmed live via a modal's own
outerHTML: "Killstreaker: X"/"Sheen: Y"/"Killstreaks Active" can be three
separate leaf <div>s sharing one common wrapping <div> with no whitespace text
node between them. querySelectorAll visits that wrapper BEFORE its children
(document order), and its own combined textContent concatenates all three with
no separator ("Killstreaker: XSheen: YKillstreaks Active") - which silently
matched an anchored `^`-prefixed pattern against the wrapper's own garbage
concatenation before ever reaching the real, clean leaf div for a
pattern whose label happens to start that concatenation. Skipping any element
with its own child elements avoids ever testing a concatenated-ancestor string
like this at all.
*/
export function* iterateLeafTexts(container) {
  for (const el of container.querySelectorAll("div, span")) {
    if (el.children.length > 0) continue;

    const text = el.textContent?.trim();
    if (text) yield text;
  }
}

/*
@description: Finds the first leaf text (see iterateLeafTexts) matching
labelPattern.
@returns: the captured group 1 text, or null if not found (or not rendered yet).
*/
export function findLabeledValue(container, labelPattern) {
  for (const text of iterateLeafTexts(container)) {
    const match = labelPattern.exec(text);
    if (match) return match[1].trim();
  }

  return null;
}

// Hand-drawn "Bars" stats icon - stroke-only, currentColor, so it inherits
// whichever link's own text color without extra styling. Paired with a plain
// 📰 classifieds icon wherever this is used (matches stntrading.eu/scrap.tf's
// existing emoji instead of introducing a third visual language).
export const BARS_ICON_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><line x1="3" y1="20" x2="21" y2="20"/><rect x="6" y="13" width="3" height="7"/><rect x="11" y="9" width="3" height="11"/><rect x="16" y="5" width="3" height="15"/></svg>';

// Same bulleted-list "history" icon used on the Steam trade offer page
// (steamcommunity.com/tradeOffer/pages/tradeoffer.js's own
// ITEM_HISTORY_ICON_SVG) and scrap.tf's item-hover item card
// (scrap.tf/itemLinks/itemCard.js's own HISTORY_ICON_SVG) - kept as its own
// copy in each rather than a single shared export, since those two live in
// completely different injected-script "worlds" with no module boundary
// reaching this file; this copy is for createStatsRow's own optional
// historyHref, reachable from every steamcommunity.com ES-module caller (see
// this file's own header).
export const HISTORY_ICON_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" width="13" height="13"><circle cx="4.5" cy="6" r="1.3" fill="currentColor" stroke="none"/><line x1="9" y1="6" x2="20" y2="6"/><circle cx="4.5" cy="12" r="1.3" fill="currentColor" stroke="none"/><line x1="9" y1="12" x2="20" y2="12"/><circle cx="4.5" cy="18" r="1.3" fill="currentColor" stroke="none"/><line x1="9" y1="18" x2="16" y2="18"/></svg>';

/*
@description: Builds one "{siteName}: [stats icon] [📰] [history icon]" row -
stats/classifieds/history href may each independently be null (an
unresolvable schema lookup, a classifieds-only/stats-only result from
utils/tf2StatsLinks/index.js's resolveStatsAndClassifieds, or a caller that has no
per-item asset id to link to at all), in which case that link is simply
omitted rather than shown broken.
@returns: the row element, or null if nothing at all resolved (no row).
@param {string} siteName - the full site name as its own label, e.g.
"next.backpack.tf" or "backpack.tf".
@param {string|null} [historyHref] - this exact item's own per-asset history
page on siteName (e.g. https://backpack.tf/item/{assetid}) - optional since
most of this function's callers (marketListingLinks/marketListingModal)
have no specific asset id to link to, only itemQuickLinks
(a Steam inventory page, where a specific owned asset IS always selected)
passes this.
*/
export function createStatsRow(siteName, statsHref, classifiedsHref, historyHref) {
  if (!statsHref && !classifiedsHref && !historyHref) return null;

  const row = document.createElement("div");
  row.style.display = "flex";
  row.style.alignItems = "center";
  row.style.gap = "6px";
  row.style.fontSize = "13px";
  row.style.color = "#8f98a0";
  row.style.lineHeight = "1";

  row.append(`${siteName}:`);

  if (statsHref) {
    const statsLink = document.createElement("a");
    statsLink.href = statsHref;
    statsLink.target = "_blank";
    statsLink.rel = "noopener noreferrer";
    statsLink.title = `${siteName} stats`;
    statsLink.style.color = "#7ab0d0";
    statsLink.style.display = "inline-flex";
    statsLink.innerHTML = BARS_ICON_SVG;
    row.appendChild(statsLink);
  }

  if (classifiedsHref) {
    const classifiedsLink = document.createElement("a");
    classifiedsLink.href = classifiedsHref;
    classifiedsLink.target = "_blank";
    classifiedsLink.rel = "noopener noreferrer";
    classifiedsLink.title = "Browse classifieds listings";
    classifiedsLink.style.textDecoration = "none";
    classifiedsLink.style.fontSize = "15px";
    classifiedsLink.textContent = "📰";
    row.appendChild(classifiedsLink);
  }

  if (historyHref) {
    const historyLink = document.createElement("a");
    historyLink.href = historyHref;
    historyLink.target = "_blank";
    historyLink.rel = "noopener noreferrer";
    historyLink.title = `View this exact item's history on ${siteName}`;
    historyLink.style.color = "#7ab0d0";
    historyLink.style.display = "inline-flex";
    historyLink.innerHTML = HISTORY_ICON_SVG;
    row.appendChild(historyLink);
  }

  return row;
}

/*
@description: Unlocks a Steam Market listing page's image panel so appended
content (the stats/classifieds links) actually renders instead of
squeezing beside the image or getting silently clipped (used by
marketListingLinks/content.js).

flexWrap: the panel lays its children out as a normal (non-wrapping) flex row,
justified/aligned to center - "wrap" forces appended content (given its own
flexBasis: "100%") onto a new line below the image instead of squeezing in
beside it, while the image itself (flexBasis: auto) still lands on the first
line same as before.

--max-height: confirmed live the panel carries its own inline "--max-height"
custom property (e.g. 330px for a commodity/crate listing, a larger value for
other item types - Steam sizes it per item type, not a fixed constant),
consumed by its own stylesheet as max-height: var(--max-height). Appended
content isn't accounted for in whatever budget Steam computed that from, and
since the panel has no overflow:hidden of its own, once the real needed
height passes that cap, it doesn't get clipped - it spills out past the
panel's box and gets visually painted over by whatever section comes next in
the page (confirmed live: the "This item is a commodity..." notice below it),
which looked like the appended content going missing. Overridden to "none"
(removing the cap entirely) rather than a larger fixed value, since there's no
reliable number that fits every item type/every amount of content either
feature can add.
*/
export function unlockImagePanelLayout(panel) {
  panel.style.flexWrap = "wrap";
  panel.style.setProperty("--max-height", "none");
}

/*
@description: Finds the item's own main preview image container on a Steam
Market listing page - matched by the image's src (community.steamstatic.com's
economy image CDN), not by any class name, since hashed CSS-module class
names churn across Steam front-end deploys. A real <img> tag, unlike a
listing card's own thumbnail (a plain background-image div), so this can't
accidentally match one of those instead.
@returns: the image's parent element, or null if not found yet.
*/
export function findImagePanel() {
  const img = document.querySelector('img[src*="steamstatic.com/economy/image/"]');
  return img?.parentElement || null;
}

/*
@description: The item header (including its own preview image) renders
client-side, so it isn't necessarily in the DOM yet at document_idle - waits
for it via MutationObserver. Gives up silently after timeoutMs, in case the
header's markup changes entirely.
*/
export function waitForImagePanel(callback, timeoutMs = 15000) {
  const existing = findImagePanel();
  if (existing) {
    callback(existing);
    return;
  }

  const observer = new MutationObserver(() => {
    const panel = findImagePanel();
    if (panel) {
      observer.disconnect();
      clearTimeout(timeoutId);
      callback(panel);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  const timeoutId = setTimeout(() => observer.disconnect(), timeoutMs);
}

/*
@description: Walks up from el until it finds an ancestor with its own
direct <h2> child - a Steam Market item info panel's own confirmed
structural signature (see findMarketInfoPanels). Dynamic (no fixed hop
count) rather than a fixed "parentElement x N" walk, since confirmed live,
that depth isn't actually constant across every anchor/item type - a fixed
3-levels-up walk from "Inspect in Game..." specifically missed a
Force-a-Nature listing that had no such link at all.

Lives here (not in steamcommunity.com/marketListingModal/content.js) so
steamcommunity.com/marketListingLinks/content.js can reuse it WITHOUT
importing the modal module (see this file's own header note on why it's
kept to leaf, stateless pieces only).
@returns: the ancestor element, or null if none up to document.body qualifies.
*/
export function findInfoPanelAncestor(el) {
  let node = el.parentElement;
  while (node && node !== document.body) {
    if (node.querySelector(":scope > h2") !== null) return node;
    node = node.parentElement;
  }
  return null;
}

/*
@description: Finds every currently-open Steam Market item info panel (the
column with the item title, price/Buy row, and effect/Sheen/Killstreaker
description) on the CURRENT page - plural because, confirmed live on the
per-listing detail modal, more than one can be present in the DOM at once
(clicking through to another listing from an open modal stacks a new panel
on top rather than replacing the one in place); the main listing page itself
only ever has one, so its own caller just takes the first result.

Anchored off TWO independent, literal-text markers rather than one - unlike
hashed class names (which churn across Steam deploys - see this file's own
findImagePanel for the same reasoning applied to the main page's own image):
- "Inspect in Game..." - present on most items.
- The green "Buy" button - confirmed live this is needed too: a Strange
  Festivized Professional Killstreak Australium Force-a-Nature's modal had
  NO "Inspect in Game..." button at all (just Buy), so relying on the
  Inspect link alone silently found no panel and never built a section for
  it. Buy is the one thing guaranteed on every purchasable listing's own
  panel, so it's a strictly more reliable anchor - kept alongside (not
  instead of) the Inspect link rather than replacing it, in case some future
  item lacks a Buy button of its own for some reason (e.g. already sold/
  delisted).
@returns: array of info panel elements (possibly empty), deduplicated via
Set since both anchors can walk up to the same panel for one listing.
*/
export function findMarketInfoPanels() {
  const panels = new Set();

  for (const link of document.querySelectorAll("a")) {
    if (!isInspectInGameLink(link)) continue;
    const infoPanel = findInfoPanelAncestor(link);
    if (infoPanel) panels.add(infoPanel);
  }

  for (const button of findListingBuyButtons()) {
    const infoPanel = findInfoPanelAncestor(button);
    if (infoPanel) panels.add(infoPanel);
  }

  return Array.from(panels);
}

// Confirmed live (Steam in Hungarian): both anchors' labels are translated
// ("Megvizsgálás játékban…", "Vétel"), so neither was ever found and the
// listing modal got no links at all. Each is recognized without its label
// first, the English label staying as a fallback.

// The link's steam:// address launches the game; its label is translated.
function isInspectInGameLink(link) {
  return /^steam:\/\/rungame\//i.test(link.getAttribute?.("href") || "") || /^Inspect in Game/i.test(link.textContent.trim());
}

/*
@description: Whether text is a listing's displayed price and nothing else -
a number with a short currency text around it ("€6.57", "215,07 EUR",
"$1,234.56 USD", "1 234,56 pуб."), parsed by utils/priceText.js's
parsePriceParts, which reads any wallet currency's separators. Currency text
is at most 4 characters all told ("$USD", "CDN$", "pуб."), which keeps out a
count with a word after it ("12 venne").
*/
export function isDisplayedPriceText(text) {
  const parsed = parsePriceParts(text);
  if (!parsed) return false;
  const affix = `${parsed.prefix}${parsed.suffix}`.replace(/[\s-]/g, "");
  return affix.length > 0 && affix.length <= 4 && !/[\d:]/.test(affix);
}

// A listing price element's own price text - its first text node, so a note
// added inside the same element later doesn't change it.
export function readListingPriceText(priceEl) {
  return priceEl?.firstChild?.textContent?.trim() ?? "";
}

/*
@description: Every listing's Buy button - a button right after a price
element (see isDisplayedPriceText), whatever its translated label says.
*/
export function findListingBuyButtons() {
  return Array.from(document.querySelectorAll("button")).filter(
    (button) => button.textContent.trim() === "Buy" || isDisplayedPriceText(readListingPriceText(button.previousElementSibling))
  );
}
