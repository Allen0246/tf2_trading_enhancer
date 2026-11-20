/*
@description: Adds a "posts.tf" button inside next.backpack.tf's
item-preview tooltip (shown when hovering an item icon anywhere on the site
- Almanac item grids, classifieds listings, etc.), right next to (inside
the SAME row as) the pricedb.io button ../addPricedbButton/content.js
already adds there - same tooltip ../addMarketplaceButton/content.js and
every other button module in this folder already add their own buttons/rows
to (see that file's own header note for the full write-up of the tooltip's
own Vue/Tippy shape, why a MutationObserver is needed, and why it's a
single shared component whose props get patched in place rather than torn
down and rebuilt on every hover). The tooltip readers are shared
(../shared/tooltipItemDetails.js); the "anchor off an existing sibling
button and insert afterend" mechanism follows
../addPricedbButton/content.js's own addPricedbButtonTo (see that file's
own header note for why anchoring off an existing button, rather than
building a standalone row, is safe here).

posts.tf's own search schema was reverse-engineered live (see
utils/tf2StatsLinks/index.js's own buildPostsTfLink for the full write-up)
and needs a real Valve defindex, unlike every other button in this file's
sibling folders - resolveStatsAndClassifieds already resolves that via
getItemDefindex and returns it as postsTfHref, so this file only has to
read the same known attributes off the tooltip addMarketplaceButton already
reads and hand them to that one shared call - no separate resolution logic
of its own.

SCOPE: generic items only (plain/painted/Unusual/Killstreak/Spelled),
Kits/Fabricators/War Paint tools/Decorated Weapons (skins)/Strangifier
Chemistry Sets all resolve postsTfHref to null for now (see
buildPostsTfLink's own note), so this button simply doesn't appear for
those item types. Same "not built yet" scope gap
addMannStoreButton/content.js's own buildMannStoreHref already documents
for a similar set of types.

A plain Strangifier is NOT in that list - see utils/tf2StatsLinks/index.js's
own buildPostsTfLink note (see #2) - so it falls through to the plain-item
branch and resolves a real (generic, not target-filtered) posts.tf link,
same as any other plain item.

Two details matter for an Unusual Taunt (see #145). pricedb.io's own
(text-search-based) button can be missing for an item this file's
(schema-defindex-based) resolution handles fine, so findAnchorButton falls
back to gladiator.tf's own button (reliable - see
../addPricedbButton/content.js's own header note) rather than letting this
button's visibility depend on an unrelated feature's success. And an Unusual
Taunt's tooltip renders no "/effects/" link at all, so its effect comes from
the Classifieds anchor's own "particle" param as knownEffectId.
*/

import { resolveStatsAndClassifieds } from "../../../utils/tf2StatsLinks/index.js";
import { copyScopedStyleAttrs } from "../shared/vueScopedStyle.js";
import { postsTfNeedsApiKey, applyPostsTfKeyHint, clearPostsTfKeyHint } from "../../../utils/linkButtonStates.js";
import {
  CLASSIFIEDS_BUTTON_SELECTOR,
  findTooltipRoot,
  readClassifiedsAnchorParams,
  findKnownEffectName,
  findTooltipTitle,
  findKnownAttributes,
  killstreakTierFromAttributes,
  KILLSTREAK_TIER_PREFIXES,
  buildItemNameRaw,
  isKillstreakToolName,
} from "../shared/tooltipItemDetails.js";

const POSTS_TF_BUTTON_CLASS = "tf2te-posts-tf-button";
// ../addPricedbButton/content.js's own button class - this file inserts
// posts.tf right after it in the same row, the same way that file anchors
// off ../addGladiatorButton/content.js's own button.
const PRICEDB_BUTTON_SELECTOR = ".tf2te-pricedb-button";
// ../addGladiatorButton/content.js's own button class - the fallback anchor
// point when pricedb.io's own button isn't there (see findAnchorButton's
// own note: pricedb.io can fail/not appear for reasons unrelated to this
// file, e.g. seen for an Unusual Taunt whose own pricedb.io /api/search
// lookup came back empty - this button shouldn't disappear along with it).
const GLADIATOR_BUTTON_SELECTOR = ".tf2te-gladiator-tf-button";
function findPricedbButton(classifiedsAnchor) {
  return findTooltipRoot(classifiedsAnchor).querySelector?.(PRICEDB_BUTTON_SELECTOR) ?? null;
}

function findGladiatorButton(classifiedsAnchor) {
  return findTooltipRoot(classifiedsAnchor).querySelector?.(GLADIATOR_BUTTON_SELECTOR) ?? null;
}

// pricedb.io's own button can fail to appear for an item (confirmed for
// an Unusual Taunt - its own text-based /api/search lookup came back with
// no match) for reasons entirely unrelated to this file's own ability to
// resolve a posts.tf link (which, unlike pricedb.io, needs no live
// network search at all - just a schema-backed defindex lookup).
// Anchoring ONLY off pricedb.io meant this button silently disappeared
// along with it. Falls back to gladiator.tf's own button (synchronous,
// succeeds whenever the tooltip has a title heading at all - see
// ../addPricedbButton/content.js's own header note on why depending on it
// is safe) so posts.tf still has somewhere to attach.
function findAnchorButton(classifiedsAnchor) {
  return findPricedbButton(classifiedsAnchor) ?? findGladiatorButton(classifiedsAnchor);
}

// See ../addPricedbButton/content.js's own buildPricedbButton for the full
// confirmed-live reasoning behind every value here (cloned from the
// reference button - whichever this actually landed beside, not the
// Classifieds anchor's - with ITS OWN marker class stripped out of the
// clone first, and a fixed marginLeft rather than depending on the row's
// own gap). referenceButton may be either pricedb.io's or gladiator.tf's
// own button (see findAnchorButton's own note), so both marker classes are
// stripped, not just one - only one will ever actually be present on a
// given clone, the other strip is just a harmless no-op.
function buildPostsTfButton(referenceButton, href) {
  const button = document.createElement("a");
  if (href) button.href = href;
  button.target = "_blank";
  button.rel = "noopener noreferrer";
  const clonedClasses = referenceButton.className
    .replace(new RegExp(`\\b${PRICEDB_BUTTON_SELECTOR.slice(1)}\\b`), "")
    .replace(new RegExp(`\\b${GLADIATOR_BUTTON_SELECTOR.slice(1)}\\b`), "")
    .trim();
  button.className = `${clonedClasses} ${POSTS_TF_BUTTON_CLASS}`;
  copyScopedStyleAttrs(referenceButton, button);
  button.style.marginLeft = "3.5px";
  button.textContent = "posts.tf";
  return button;
}

function findExistingPostsTfButton(classifiedsAnchor) {
  return findTooltipRoot(classifiedsAnchor).querySelector?.(`.${POSTS_TF_BUTTON_CLASS}`) ?? null;
}

// See ../addMarketplaceButton/content.js's own addMarketplaceButtonTo for
// the full confirmed-live reasoning behind the content-signature dedupe
// (the tooltip is a single shared Vue component whose props get patched in
// place, so a plain boolean flag would see a reused DOM node as "already
// handled" forever and never rebuild the button for a newly-hovered item).
async function addPostsTfButtonTo(classifiedsAnchor) {
  // knownEffectId: an Unusual Taunt's tooltip has no "/effects/" row, so its
  // effect only comes from the anchor's own "particle" param (see #145).
  const { itemName, qualityId, isAustralium, knownEffectId } = readClassifiedsAnchorParams(classifiedsAnchor);
  if (!itemName) return;

  const knownEffectName = findKnownEffectName(classifiedsAnchor);
  const { knownSheenName, knownKillstreakerName, knownSpellName, knownPaintName, isBasicKillstreak } =
    findKnownAttributes(classifiedsAnchor);
  const tooltipTitle = findTooltipTitle(classifiedsAnchor);

  const signature = [
    classifiedsAnchor.getAttribute("href"),
    knownEffectName,
    knownSheenName,
    knownKillstreakerName,
    knownSpellName,
    knownPaintName,
    isBasicKillstreak,
    tooltipTitle,
  ].join("|");

  // Checked BEFORE claiming the signature below, same reasoning
  // ../addPricedbButton/content.js's own addPricedbButtonTo documents - the
  // anchor button this attaches beside may not exist yet on the very first
  // tooltip render (a separate observer, no ordering guarantee), and
  // claiming the signature before that would permanently skip this exact
  // item once one of them DOES show up.
  const existing = findExistingPostsTfButton(classifiedsAnchor);
  const anchorButton = existing ? null : findAnchorButton(classifiedsAnchor);
  if (!existing && !anchorButton) return;

  if (classifiedsAnchor.dataset.tf2tePostsTfSignature === signature) return;
  classifiedsAnchor.dataset.tf2tePostsTfSignature = signature; // set eagerly - resolveStatsAndClassifieds below is async

  // A Kit/Fabricator's own itemName is just the bare word "Kit"/"Fabricator"
  // (see ../addMarketplaceButton/content.js's own isKillstreakToolName
  // note) - postsTfHref resolves to null for those anyway (see this file's
  // own header note), but the raw name still has to make sense going into
  // resolveStatsAndClassifieds, so the tooltip title is used the same way
  // addMarketplaceButtonTo does rather than feeding it a nonsensical
  // "Professional Kit".
  const killstreakTier = killstreakTierFromAttributes(knownSheenName, knownKillstreakerName, isBasicKillstreak);
  const itemNameRaw = isKillstreakToolName(tooltipTitle)
    ? tooltipTitle
    : buildItemNameRaw(itemName, qualityId, { killstreakPrefix: KILLSTREAK_TIER_PREFIXES[killstreakTier], isAustralium });

  const resolved = await resolveStatsAndClassifieds(itemNameRaw, {
    knownEffectName,
    knownEffectId,
    knownSheenName,
    knownKillstreakerName,
    knownSpellName,
    knownKillstreakTier: killstreakTier,
    knownPaintName,
  });

  // The signature may have moved on again while the resolve above was in
  // flight (a fast re-hover) - a stale response landing now would overwrite
  // whatever the newer, still-in-flight call is about to set.
  if (classifiedsAnchor.dataset.tf2tePostsTfSignature !== signature) return;

  if (!resolved.postsTfHref) {
    await showKeyHintOrRemove(classifiedsAnchor, resolved, signature);
    return;
  }

  if (existing) {
    clearPostsTfKeyHint(existing);
    existing.href = resolved.postsTfHref;
    existing.target = "_blank";
    return;
  }

  // The tooltip may have already been torn down (hover ended), or the
  // anchor button replaced by Vue, while the resolve above was in flight -
  // re-find it fresh rather than trusting the reference captured before the
  // await. Prefers pricedb.io's own button again here too (not whichever
  // was found above) in case it appeared in the meantime.
  const freshAnchorButton = findAnchorButton(classifiedsAnchor);
  if (!freshAnchorButton) return;

  freshAnchorButton.insertAdjacentElement("afterend", buildPostsTfButton(freshAnchorButton, resolved.postsTfHref));
}

/*
@description: No posts.tf link for this item. If that's only because no Steam
Web API key is saved, show the dimmed key-hint button in posts.tf's usual
spot (see utils/linkButtonStates.js); otherwise (an item type posts.tf
doesn't cover) remove any button left over from the PREVIOUS item on this
recycled tooltip rather than leaving it linking to the wrong item.
*/
async function showKeyHintOrRemove(classifiedsAnchor, resolved, signature) {
  const needsKey = await postsTfNeedsApiKey(resolved.classifiedsFilters, resolved.postsTfHref);
  if (classifiedsAnchor.dataset.tf2tePostsTfSignature !== signature) return;

  const current = findExistingPostsTfButton(classifiedsAnchor);
  if (!needsKey) {
    current?.remove();
    return;
  }

  if (current) {
    applyPostsTfKeyHint(current);
    return;
  }

  const anchorButton = findAnchorButton(classifiedsAnchor);
  if (!anchorButton) return;
  const button = buildPostsTfButton(anchorButton, null);
  applyPostsTfKeyHint(button);
  anchorButton.insertAdjacentElement("afterend", button);
}

function scan(root) {
  root.querySelectorAll?.(CLASSIFIEDS_BUTTON_SELECTOR).forEach((anchor) => {
    addPostsTfButtonTo(anchor);
  });
}

// Re-attempts every classifieds anchor in the SAME tooltip a given anchor
// button (pricedb.io's or gladiator.tf's - see findAnchorButton's own note)
// belongs to - either can appear as its OWN separate mutation, later than
// (and not nested inside) the classifieds anchor's own subtree, since
// they're built by completely separate observers in
// ../addPricedbButton/content.js and ../addGladiatorButton/content.js.
// Without this, a classifieds anchor that bailed out of addPostsTfButtonTo
// earlier for having neither yet would never get a second chance - same
// reasoning ../addPricedbButton/content.js's own retryForGladiatorButton
// documents.
function retryForAnchorButton(anchorButton) {
  findTooltipRoot(anchorButton).querySelectorAll?.(CLASSIFIEDS_BUTTON_SELECTOR).forEach((anchor) => addPostsTfButtonTo(anchor));
}

function handleAddedNode(node) {
  if (node.matches?.(CLASSIFIEDS_BUTTON_SELECTOR)) {
    addPostsTfButtonTo(node);
  } else {
    scan(node);
  }

  if (node.matches?.(PRICEDB_BUTTON_SELECTOR) || node.matches?.(GLADIATOR_BUTTON_SELECTOR)) {
    retryForAnchorButton(node);
  } else {
    node.querySelectorAll?.(PRICEDB_BUTTON_SELECTOR).forEach(retryForAnchorButton);
    node.querySelectorAll?.(GLADIATOR_BUTTON_SELECTOR).forEach(retryForAnchorButton);
  }
}

export function addPostsTfButton() {
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

  // A key saved in the popup turns an open tooltip's key-hint button into the
  // real link without a re-hover: forget every signature so the next scan
  // resolves afresh (the schema download happens inside that resolve).
  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area !== "local" || !("steamApiKey" in changes)) return;
    document.querySelectorAll(CLASSIFIEDS_BUTTON_SELECTOR).forEach((anchor) => {
      delete anchor.dataset.tf2tePostsTfSignature;
    });
    scan(document);
  });
}
