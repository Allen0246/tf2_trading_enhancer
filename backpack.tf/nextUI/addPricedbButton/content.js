/*
@description: Adds a "pricedb.io" button inside next.backpack.tf's
item-preview tooltip, right next to (inside the SAME row as) the gladiator.tf
button ../addGladiatorButton/content.js already adds there - same tooltip
../addMarketplaceButton/content.js and that file both already add their own
buttons/rows to (see ../addMarketplaceButton/content.js's own header note on
the tooltip's shape: a shared Vue/Tippy component, a single instance whose
props update reactively as you hover different items, Vue patching the SAME
DOM nodes in place rather than replacing them - the same "content signature,
not a plain boolean flag" dedupe reasoning applies here).

pricedb.io's own item page (https://pricedb.io/item/{sku}) takes a TF2 SKU
string (defindex;quality;u{effectId};w{wearId};pk{paintkitId};kt-{tier};
australium;festive - confirmed live against several real examples). That
SKU is deliberately NOT built from the tooltip's own resolved attributes: a
Decorated Weapon's own SKU defindex is NOT the same as its base weapon's
defindex (Valve gives decorated weapons their own distinct defindex, confirmed
live via a real example: defindex 15052 for a decorated Rocket Launcher-shaped
item, nowhere near the stock weapon's own ~200-range defindex), and nothing in
next.backpack.tf's own DOM exposes that decorated-variant defindex directly
(unlike scrap.tf's own item tiles, which carry a real data-defindex attribute
- see scrap.tf/itemLinks/skinDetection.js's own note on that).

Resolved instead via pricedb.io's own /api/search endpoint (confirmed live
against its own docs, no authentication needed - see utils/pricedb.js's own
header note) - given the SAME complete display name text
../addGladiatorButton/content.js already reads off the tooltip's own title
heading, pricedb's own search resolves the correct SKU for every item type
uniformly (Unusual, Decorated Weapon, Killstreak, Australium, Festivized, all
alike), without this file needing any of its own schema-backed defindex/
effect-id/paintkit-id resolution at all.

Deliberately anchored off ../addGladiatorButton/content.js's own button
(".tf2te-gladiator-tf-button") rather than building its own standalone row the
way that file itself deliberately avoided anchoring off
../addMarketplaceButton/content.js's own button - unlike marketplace.tf's own
resolution (schema-dependent, genuinely fails for some item types),
gladiator.tf's own button is synchronous and succeeds whenever the tooltip has
a title heading at all, so anchoring off it here doesn't meaningfully gate
this button's own visibility the way anchoring off marketplace.tf's would, the
two buttons belong in the same row anyway.
*/

import { searchPricedbSkuStatus } from "../../../utils/pricedb.js";
import { buildTargetToolFullName } from "../../../utils/tf2StatsLinks/index.js";
import { copyScopedStyleAttrs } from "../shared/vueScopedStyle.js";
import { CLASSIFIEDS_BUTTON_SELECTOR, findTooltipRoot, findTooltipTitle } from "../shared/tooltipItemDetails.js";
import { startRetryCountdown, clearRetryCountdown, stopRetryCountdown } from "../../../utils/linkButtonStates.js";

const PRICEDB_BUTTON_CLASS = "tf2te-pricedb-button";
// ../addGladiatorButton/content.js's own button - this file's own insertion
// point (see this file's own header note on why anchoring off it is safe).
const GLADIATOR_BUTTON_SELECTOR = ".tf2te-gladiator-tf-button";

// pricedb.io's own indexed name for an Unusual Taunt is "'72 Taunt: Conga" -
// the tooltip's own title just OMITS "Taunt: " for display (same
// title-stripping ../addMarketplaceButton/content.js's own header note
// documents for classic backpack.tf, just here on next.backpack.tf's own
// tooltip title instead). The Classifieds anchor's own itemName param still
// HAS the "Taunt: " prefix intact though, so it's used to detect a Taunt and
// recover the true base name, then "Taunt: " is spliced back in right before
// it, preserving whatever effect-name prefix the title already had
// (title.endsWith(baseName) is what locates that boundary). Falls back to
// the raw title unchanged when that assumption doesn't hold, and is a no-op
// for every non-Taunt item. See #37.
function buildPricedbSearchQuery(classifiedsAnchor, title) {
  // A fixed, arbitrary base - the Classifieds anchor's own href is always a
  // relative path (confirmed live), and only its query string is actually
  // read here, so there's no real navigation/origin dependency on
  // window.location at all.
  const url = new URL(classifiedsAnchor.getAttribute("href"), "https://next.backpack.tf/");
  const itemName = url.searchParams.get("itemName") || "";

  // A Strangifier/Chemistry Set's tooltip title doesn't name the tool (seen
  // live: searching it returned the plain target weapon, 773;6, instead of
  // "Pretty Boy's Pocket Pistol Strangifier", 6522;6;td-773). The anchor
  // carries both parts (itemName=Strangifier&targetItem=...), so the full
  // name is rebuilt from those, the same way ../addMannStoreButton does.
  const targetItem = url.searchParams.get("targetItem");
  if (targetItem && itemName) return buildTargetToolFullName(itemName, targetItem);

  if (!/^Taunt:\s*/i.test(itemName)) return title;

  const baseName = itemName.replace(/^Taunt:\s*/i, "").trim();
  if (!baseName || !title.endsWith(baseName)) return title;

  const effectPrefix = title.slice(0, title.length - baseName.length).trim();
  return effectPrefix ? `${effectPrefix} Taunt: ${baseName}` : `Taunt: ${baseName}`;
}

function buildPricedbHref(sku) {
  return `https://pricedb.io/item/${encodeURIComponent(sku)}`;
}

function findGladiatorButton(classifiedsAnchor) {
  return findTooltipRoot(classifiedsAnchor).querySelector?.(GLADIATOR_BUTTON_SELECTOR) ?? null;
}

/*
@description: Builds the pricedb.io button itself - cloned from the
gladiator.tf button's own classes/scoped-style attrs (not the Classifieds
anchor's, since it's the gladiator.tf button this sits directly beside), so
it's visually identical to its new neighbor. Strips the gladiator.tf button's
own marker class out of the clone first - without this, the pricedb.io
button would ALSO carry ".tf2te-gladiator-tf-button" (harmless today, since
findGladiatorButton's querySelector still finds the real one first in
document order, but confusing/fragile to leave in).
*/
function buildPricedbButton(referenceButton) {
  const button = document.createElement("a");
  button.target = "_blank";
  button.rel = "noopener noreferrer";
  const clonedClasses = referenceButton.className.replace(new RegExp(`\\b${GLADIATOR_BUTTON_SELECTOR.slice(1)}\\b`), "").trim();
  button.className = `${clonedClasses} ${PRICEDB_BUTTON_CLASS}`;
  copyScopedStyleAttrs(referenceButton, button);
  // Rendered flush against the gladiator.tf button with no gap at all -
  // always inserted right after it (see addPricedbButtonTo's own
  // insertAdjacentElement call below), so a fixed margin here is enough,
  // unlike ../../oldUI/linkButtonsRow.js's own dynamic version (that row's
  // button order isn't fixed the same way). No marginTop/marginBottom here -
  // the row (../shared/tooltipButtonRow.js) owns the vertical margin (see
  // its note on why: margin-collapsing risk between the two).
  button.style.marginLeft = "3.5px";
  return button;
}

/*
@description: Applies the resolved state onto an already-built button element
(fresh or reused across a Vue re-hover - see this file's own header note on
why the tooltip's DOM nodes get patched in place rather than replaced): a
real link for a resolved sku, or, for pricedb.io's per-IP rate limit (a real,
confirmed-live 429 - see utils/pricedb.js's searchPricedbSkuStatus), a
"pricedb.io ⏱ Ns" countdown that retries the lookup by itself at zero (see
utils/linkButtonStates.js). If the tooltip was closed by then, the signature
is released so the next hover retries instead. Never called with neither a
sku nor a rate limit - see addPricedbButtonTo's own early bail-out.
*/
function applyPricedbButtonState(button, { href, retryAfterMs }, classifiedsAnchor) {
  if (href) {
    clearRetryCountdown(button, "pricedb.io");
    button.href = href;
    button.target = "_blank";
    return;
  }

  startRetryCountdown(button, {
    label: "pricedb.io",
    retryAfterMs,
    onRetry: (isConnected) => {
      delete classifiedsAnchor.dataset.tf2tePricedbSignature;
      if (isConnected) addPricedbButtonTo(classifiedsAnchor);
    },
  });
}

function findExistingPricedbButton(classifiedsAnchor) {
  return findTooltipRoot(classifiedsAnchor).querySelector?.(`.${PRICEDB_BUTTON_CLASS}`) ?? null;
}

/*
@description: Resolves and inserts (or updates) the pricedb.io button for one
Classifieds anchor's tooltip, right after the gladiator.tf button in the SAME
row. Dedupes off the search query (buildPricedbSearchQuery), the only
thing this button's href depends on. Not the title alone: a Strangifier's
title is just its target weapon's name, the same title the plain weapon's
tooltip shows, while the two search (and link) differently.

The signature is set EAGERLY before the async searchPricedbSkuStatus call (not
after it resolves) and re-checked once it does, same "a fast re-hover can
make an in-flight resolve stale" race-guard
../addMarketplaceButton/content.js's own addMarketplaceButtonTo documents -
without it, a slower FIRST lookup resolving AFTER a faster SECOND one would
overwrite the button with stale, wrong data.
*/
async function addPricedbButtonTo(classifiedsAnchor) {
  const title = findTooltipTitle(classifiedsAnchor);
  if (!title) return;

  // Checked BEFORE claiming the signature below, not after - gladiator.tf's
  // own button may not have been inserted yet on the very first tooltip
  // render (its own observer callback is only registered to run before this
  // one, not guaranteed instant). If the signature were claimed first, a
  // "not ready yet" bail-out here would permanently skip this exact item
  // forever, since the signature guard below would then always match on any
  // later retry (e.g. gladiator.tf's own button insertion, itself a
  // childList mutation this file's own observer also sees) - checking first
  // means an unclaimed title keeps getting retried until gladiator.tf's
  // button genuinely exists.
  const existing = findExistingPricedbButton(classifiedsAnchor);
  const gladiatorButton = existing ? null : findGladiatorButton(classifiedsAnchor);
  if (!existing && !gladiatorButton) return;

  const searchQuery = buildPricedbSearchQuery(classifiedsAnchor, title);
  if (classifiedsAnchor.dataset.tf2tePricedbSignature === searchQuery) return;
  classifiedsAnchor.dataset.tf2tePricedbSignature = searchQuery;

  const { sku, rateLimited, retryAfterMs } = await searchPricedbSkuStatus(searchQuery);

  // The signature may have moved on again while the lookup above was in
  // flight (a fast re-hover) - a stale response landing now would overwrite
  // whatever the newer, still-in-flight call is about to set.
  if (classifiedsAnchor.dataset.tf2tePricedbSignature !== searchQuery) return;

  // No match found - don't guess. On a recycled tooltip, any button still
  // there belongs to the PREVIOUS item, so it's removed rather than left
  // linking to the wrong item's pricedb.io page.
  if (!sku && !rateLimited) {
    const stale = findExistingPricedbButton(classifiedsAnchor);
    if (stale) {
      stopRetryCountdown(stale);
      stale.remove();
    }
    return;
  }

  const href = sku ? buildPricedbHref(sku) : null;

  if (existing) {
    applyPricedbButtonState(existing, { href, retryAfterMs }, classifiedsAnchor);
    return;
  }

  // The tooltip may have already been torn down (hover ended) while the
  // lookup above was in flight - re-find gladiator.tf's own button fresh
  // rather than trusting the reference captured before the await, in case
  // Vue replaced it in the meantime.
  const freshGladiatorButton = findGladiatorButton(classifiedsAnchor);
  if (!freshGladiatorButton) return;

  const button = buildPricedbButton(freshGladiatorButton);
  applyPricedbButtonState(button, { href, retryAfterMs }, classifiedsAnchor);
  freshGladiatorButton.insertAdjacentElement("afterend", button);
}

function scan(root) {
  root.querySelectorAll?.(CLASSIFIEDS_BUTTON_SELECTOR).forEach((anchor) => {
    addPricedbButtonTo(anchor);
  });
}

// Re-attempts every classifieds anchor in the SAME tooltip a given
// gladiator.tf button belongs to - gladiator.tf's own button can appear as
// its OWN separate mutation, later than (and not nested inside) the
// classifieds anchor's own subtree, since it's built by a completely
// separate observer in ../addGladiatorButton/content.js. Without this, a
// classifieds anchor that bailed out of addPricedbButtonTo earlier for
// having no gladiator.tf button yet (see that function's own note) would
// never get a second chance - this file's own observer below only ever
// looked for classifieds anchors nested INSIDE whatever node was just added,
// which the gladiator.tf button's own row/button never is.
function retryForGladiatorButton(gladiatorButton) {
  findTooltipRoot(gladiatorButton).querySelectorAll?.(CLASSIFIEDS_BUTTON_SELECTOR).forEach((anchor) => addPricedbButtonTo(anchor));
}

function handleAddedNode(node) {
  if (node.matches?.(CLASSIFIEDS_BUTTON_SELECTOR)) {
    addPricedbButtonTo(node);
  } else {
    scan(node);
  }

  if (node.matches?.(GLADIATOR_BUTTON_SELECTOR)) {
    retryForGladiatorButton(node);
  } else {
    node.querySelectorAll?.(GLADIATOR_BUTTON_SELECTOR).forEach(retryForGladiatorButton);
  }
}

export function addPricedbButton() {
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
