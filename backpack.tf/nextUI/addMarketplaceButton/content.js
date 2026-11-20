/*
@description: Adds a "marketplace.tf" button, in its own row, inside
next.backpack.tf's item-preview tooltip (shown when hovering an item icon
anywhere on the site - Almanac item grids, classifieds listings, etc.),
placed after the tooltip's own two rows (Classifieds/Inventory/Aggs/Item DB,
then Item/History/Wiki) - see ../shared/tooltipButtonRow.js on why a
standalone row, not inline next to Classifieds. That tooltip is a Vue/Tippy
component (confirmed live: `id="tippy-NN"`, `class="tippy-popper"`, appended via
`appendto="()=>document.getElementById('content-wrapper')"`) - there's no
static element to attach to at page load, so a MutationObserver is the only
way to catch it appearing.

It is NOT torn down and rebuilt fresh on every hover - confirmed live it's
actually a single shared component whose props update reactively as you
hover different items, with Vue patching the SAME
DOM nodes (including the Classifieds anchor this hooks off) in place rather
than replacing them. See addMarketplaceButtonTo's own note on why that means
a content signature, not a plain boolean flag, is what has to guard against
re-processing.

Everything read off the tooltip (Classifieds anchor params, effect/skin
rows, Sheen/Killstreaker/Spell/wear/Paint/Festivized rows, title heading) and
the raw-name reconstruction live in ../shared/tooltipItemDetails.js, shared
with the other tooltip buttons that resolve the item.
*/

import { resolveStatsAndClassifieds, buildTargetToolFullName } from "../../../utils/tf2StatsLinks/index.js";
import { findLastContentLinksRow, buildTooltipButtonRow } from "../shared/tooltipButtonRow.js";
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

const MARKETPLACE_BUTTON_CLASS = "tf2te-marketplace-tf-button";

/*
@description: Finds the marketplace.tf button this function already
inserted into the current tooltip, if one's still there - see
addMarketplaceButtonTo's own note on why a re-render can leave one behind
that needs updating in place rather than a fresh one just getting inserted
again (which would duplicate the whole row).
*/
function findExistingMarketplaceButton(classifiedsAnchor) {
  return findTooltipRoot(classifiedsAnchor).querySelector?.(`.${MARKETPLACE_BUTTON_CLASS}`) ?? null;
}

/*
@description: Resolves and inserts (or updates) the marketplace.tf button's
own row for one Classifieds anchor's tooltip.

Uses a content signature (everything the marketplace.tf href is actually
derived from), not a plain "already handled" boolean - confirmed live that
next.backpack.tf's tooltip is a SINGLE shared Vue component whose props get
updated reactively as you hover different items, not torn down and rebuilt
fresh each time: the SAME classifiedsAnchor DOM node can be reused across
completely different items, with Vue patching its href/attributes in place. A
boolean flag would see that reused node as "already handled" forever after
the first hover and never rebuild the button - exactly the stale-link bug
observed (hovering a Specialized Killstreak item after a Professional one
kept the Professional item's own sks[]/ske[]/skillstreak values). Same fix
shape as backpack.tf/nextUI/fixTradeOfferLinks/content.js's own
content-signature dedupe, which solved the identical "Vue recycles this DOM
node" problem for a different feature.
*/
async function addMarketplaceButtonTo(classifiedsAnchor) {
  const { itemName, qualityId, targetItem, isAustralium, knownEffectId } = readClassifiedsAnchorParams(classifiedsAnchor);
  if (!itemName) return;

  const knownEffectName = findKnownEffectName(classifiedsAnchor);
  const knownSkinName = findKnownSkinName(classifiedsAnchor);
  const {
    knownSheenName,
    knownKillstreakerName,
    knownSpellName,
    knownWearTier,
    knownPaintName,
    isFestivized,
    isBasicKillstreak,
  } = findKnownAttributes(classifiedsAnchor);
  // Only read for a Kit/Fabricator (see isKillstreakToolName's own note) -
  // itemName alone can't tell either apart from anything else (it's just
  // "Kit"/"Fabricator"), so the title has to be checked too.
  const tooltipTitle = findTooltipTitle(classifiedsAnchor);

  const signature = [
    classifiedsAnchor.getAttribute("href"),
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
  if (classifiedsAnchor.dataset.tf2teMarketplaceSignature === signature) return;
  classifiedsAnchor.dataset.tf2teMarketplaceSignature = signature; // set eagerly - resolveStatsAndClassifieds below is async

  const killstreakTier = killstreakTierFromAttributes(knownSheenName, knownKillstreakerName, isBasicKillstreak);

  // A Killstreak Kit/Fabricator (see isKillstreakToolName's own note) uses
  // its title text as-is, since itemName has no target weapon in it at all
  // for either. A Decorated Weapon (skin + wear tier both found) needs its
  // own name shape instead - see buildDecoratedWeaponNameRaw's own note on
  // why the Effect/Killstreak words can't be embedded in it the way the
  // plain-weapon path below embeds them, and why knownKillstreakTier carries
  // the tier.
  // A target tool's anchor carries only the tool name ("Strangifier") plus a
  // separate targetItem param; rebuilding the full name lets
  // resolveStatsAndClassifieds split it correctly. See #35.
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

  // knownEffectId matters for an Unusual Taunt, whose tooltip has no
  // "/effects/" row to read a name from (see #145).
  const resolved = await resolveStatsAndClassifieds(itemNameRaw, {
    knownEffectName,
    knownEffectId,
    knownSheenName,
    knownKillstreakerName,
    knownSpellName,
    knownKillstreakTier: killstreakTier,
    knownPaintName,
  });
  if (!resolved.marketplaceHref) return;

  // The signature may have moved on again while the resolve above was in
  // flight (a fast re-hover) - a stale response landing now would overwrite
  // whatever the newer, still-in-flight call is about to set. The newer call
  // owns the final result, so this one backs off instead.
  if (classifiedsAnchor.dataset.tf2teMarketplaceSignature !== signature) return;

  const existing = findExistingMarketplaceButton(classifiedsAnchor);
  if (existing) {
    existing.href = resolved.marketplaceHref;
    return;
  }

  // The tooltip may have already been torn down (hover ended) by the time
  // this resolves - inserting into a detached anchor is a harmless no-op.
  const targetRow = findLastContentLinksRow(classifiedsAnchor);
  if (!targetRow) return; // markup changed - don't guess where to put it

  const row = buildTooltipButtonRow(classifiedsAnchor, { href: resolved.marketplaceHref, label: "marketplace.tf", markerClass: MARKETPLACE_BUTTON_CLASS });
  targetRow.insertAdjacentElement("afterend", row);
}

function scan(root) {
  root.querySelectorAll?.(CLASSIFIEDS_BUTTON_SELECTOR).forEach((anchor) => {
    addMarketplaceButtonTo(anchor);
  });
}

export function addMarketplaceButton() {
  scan(document);

  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType !== Node.ELEMENT_NODE) return;

        if (node.matches?.(CLASSIFIEDS_BUTTON_SELECTOR)) {
          addMarketplaceButtonTo(node);
        } else {
          scan(node);
        }
      });
    });
  });

  observer.observe(document.body, { childList: true, subtree: true });
}
