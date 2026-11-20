/*
@description: Adds an "stntrading.eu" button inside next.backpack.tf's
item-preview tooltip, right BEFORE (in the SAME row as)
../addMarketplaceButton/content.js's own marketplace.tf button - same "anchor
off a specific sibling button" approach ../addMannStoreButton/content.js already
established for mannco.store (inserted right AFTER marketplace.tf instead - see
that file's own header note), just on the other side.

Unlike mannco.store, this button's own href needs the FULL
resolveStatsAndClassifieds resolution (classifiedsFilters - see
utils/tf2StatsLinks/index.js's buildStnTradingHref on why an Unusual needs the resolved effect
NAME, not just whatever's labeled on the tooltip), same scope as
../addMarketplaceButton/content.js itself, with the same itemNameRaw
reconstruction (a target tool's full name from its targetItem param, then
../shared/tooltipItemDetails.js: Killstreak Kit/Fabricator title-based name,
Decorated Weapon skin+weapon concatenation, or the generic
Festivized/Killstreak-tier-prefixed name).

Because this button's own resolve is async but its INSERTION POINT depends
on marketplace.tf's button already existing (itself behind ITS OWN async
resolve), the dependency is only checked at insert time, not before starting
this file's own resolve - unlike mannco.store's fully-synchronous version,
which can (and does) check upfront. If marketplace.tf's button still doesn't
exist once this file's own resolve finishes, this quietly returns without
inserting; retryForMarketplaceButton (fired by the MutationObserver below,
the moment marketplace.tf's own button actually appears) re-attempts the
whole thing then.
*/

import { resolveStatsAndClassifieds, buildStnTradingHref, buildTargetToolFullName } from "../../../utils/tf2StatsLinks/index.js";
import { copyScopedStyleAttrs } from "../shared/vueScopedStyle.js";
import {
  CLASSIFIEDS_BUTTON_SELECTOR,
  findTooltipRoot,
  readClassifiedsAnchorParams,
  findKnownEffectName,
  findKnownSkinName,
  findTooltipTitle,
  findKnownAttributes,
  killstreakTierFromAttributes,
  KILLSTREAK_TIER_PREFIXES,
  buildItemNameRaw,
  buildDecoratedWeaponNameRaw,
  isKillstreakToolName,
} from "../shared/tooltipItemDetails.js";

const STN_BUTTON_CLASS = "tf2te-stn-button";
const MARKETPLACE_BUTTON_SELECTOR = ".tf2te-marketplace-tf-button";

function findMarketplaceButton(classifiedsAnchor) {
  return findTooltipRoot(classifiedsAnchor).querySelector?.(MARKETPLACE_BUTTON_SELECTOR) ?? null;
}

function findExistingStnButton(classifiedsAnchor) {
  return findTooltipRoot(classifiedsAnchor).querySelector?.(`.${STN_BUTTON_CLASS}`) ?? null;
}

/*
@description: Builds the stntrading.eu button - cloned from the marketplace.tf
button's own classes/scoped-style attrs (same reasoning
../addMannStoreButton/content.js's own buildMannStoreButton documents), so
it's visually identical to its new neighbor. marginRight (not marginLeft) -
this button sits BEFORE marketplace.tf, unlike mannco.store which sits after
it, so the gap belongs on this button's own right side instead.
*/
function buildStnButtonEl(referenceButton, href) {
  const button = document.createElement("a");
  button.href = href;
  button.target = "_blank";
  button.rel = "noopener noreferrer";
  const clonedClasses = referenceButton.className.replace(new RegExp(`\\b${MARKETPLACE_BUTTON_SELECTOR.slice(1)}\\b`), "").trim();
  button.className = `${clonedClasses} ${STN_BUTTON_CLASS}`;
  copyScopedStyleAttrs(referenceButton, button);
  button.style.marginRight = "3.5px";
  button.textContent = "stntrading.eu";
  return button;
}

async function addStnButtonTo(classifiedsAnchor) {
  const href = classifiedsAnchor.getAttribute("href");
  const { itemName, qualityId, targetItem, isAustralium, knownEffectId } = readClassifiedsAnchorParams(classifiedsAnchor);
  if (!itemName) return;

  const knownEffectName = findKnownEffectName(classifiedsAnchor);
  const knownSkinName = findKnownSkinName(classifiedsAnchor);
  const { knownSheenName, knownKillstreakerName, knownSpellName, knownWearTier, knownPaintName, isFestivized, isBasicKillstreak } =
    findKnownAttributes(classifiedsAnchor);
  const tooltipTitle = findTooltipTitle(classifiedsAnchor);

  const signature = [
    href,
    knownEffectName,
    knownSkinName,
    knownSheenName,
    knownKillstreakerName,
    knownSpellName,
    knownWearTier,
    knownPaintName,
    isFestivized,
    isBasicKillstreak,
    tooltipTitle,
  ].join("|");
  // The signature must NOT be claimed until it has actually been fully
  // APPLIED (button inserted or updated): claiming it eagerly would
  // permanently block every later retry for this exact tooltip state even
  // though nothing was inserted. Only skip up front when a button already
  // exists AND already carries this exact signature - a bail-out with no
  // button (marketplace.tf not ready yet) must always be retryable. See #146.
  const existingBeforeResolve = findExistingStnButton(classifiedsAnchor);
  if (existingBeforeResolve && classifiedsAnchor.dataset.tf2teStnSignature === signature) return;
  // Tracks the newest REQUESTED signature separately from the applied one
  // above: on a fast re-hover, an older resolve can finish after a newer one
  // and must not overwrite its href (same race addMarketplaceButtonTo
  // guards against).
  classifiedsAnchor.dataset.tf2teStnPendingSignature = signature;

  const killstreakTier = killstreakTierFromAttributes(knownSheenName, knownKillstreakerName, isBasicKillstreak);

  // A target tool's anchor carries only the tool name ("Strangifier") plus a
  // separate targetItem param, so the full name is rebuilt from both, same
  // as ../addMarketplaceButton/content.js does; otherwise the link would
  // point at the bare "Strangifier" page.
  const itemNameRaw = targetItem
    ? buildTargetToolFullName(itemName, targetItem)
    : isKillstreakToolName(tooltipTitle)
      ? tooltipTitle
      : knownSkinName && knownWearTier
        ? buildDecoratedWeaponNameRaw(knownSkinName, itemName, qualityId, knownWearTier)
        : buildItemNameRaw(itemName, qualityId, {
            isFestivized,
            isAustralium,
            killstreakPrefix: KILLSTREAK_TIER_PREFIXES[killstreakTier],
          });

  // knownEffectId gives an Unusual Taunt (no "/effects/" row to read a name
  // from) its effect name too, same as ../addMarketplaceButton/content.js.
  const resolved = await resolveStatsAndClassifieds(itemNameRaw, {
    knownEffectName,
    knownEffectId,
    knownSheenName,
    knownKillstreakerName,
    knownSpellName,
    knownKillstreakTier: killstreakTier,
    knownPaintName,
  });

  if (classifiedsAnchor.dataset.tf2teStnPendingSignature !== signature) return;

  const stnHref = buildStnTradingHref(itemNameRaw, resolved.classifiedsFilters);

  const existing = findExistingStnButton(classifiedsAnchor);
  if (existing) {
    existing.href = stnHref;
    classifiedsAnchor.dataset.tf2teStnSignature = signature;
    return;
  }

  // marketplace.tf's own button may not exist yet (its own resolve hasn't
  // settled) - see this file's own header note on why that's only checked
  // here, not before starting this resolve. The signature is deliberately
  // left UNCLAIMED in this case (see this function's own note above) so
  // retryForMarketplaceButton can pick this back up once it actually
  // appears, rather than being silently blocked forever.
  const marketplaceButton = findMarketplaceButton(classifiedsAnchor);
  if (!marketplaceButton) return;

  marketplaceButton.insertAdjacentElement("beforebegin", buildStnButtonEl(marketplaceButton, stnHref));
  classifiedsAnchor.dataset.tf2teStnSignature = signature;
}

function scan(root) {
  root.querySelectorAll?.(CLASSIFIEDS_BUTTON_SELECTOR).forEach((anchor) => {
    addStnButtonTo(anchor);
  });
}

// Re-attempts every classifieds anchor in the SAME tooltip a given
// marketplace.tf button belongs to - same reasoning
// ../addMannStoreButton/content.js's own retryForMarketplaceButton documents.
function retryForMarketplaceButton(marketplaceButton) {
  findTooltipRoot(marketplaceButton).querySelectorAll?.(CLASSIFIEDS_BUTTON_SELECTOR).forEach((anchor) => addStnButtonTo(anchor));
}

function handleAddedNode(node) {
  if (node.matches?.(CLASSIFIEDS_BUTTON_SELECTOR)) {
    addStnButtonTo(node);
  } else {
    scan(node);
  }

  if (node.matches?.(MARKETPLACE_BUTTON_SELECTOR)) {
    retryForMarketplaceButton(node);
  } else {
    node.querySelectorAll?.(MARKETPLACE_BUTTON_SELECTOR).forEach(retryForMarketplaceButton);
  }
}

export function addStnButton() {
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
