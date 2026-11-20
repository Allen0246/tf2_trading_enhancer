/*
@description: Adds an "stntrading.eu" button into classic backpack.tf's item
hover popover, into the shared "secondary" link-buttons row
../linkButtonsRow.js manages - right before marketplace.tf (see that file's
own header note on the two-row layout/ordering this shares with
marketplace.tf and mannco.store).

Otherwise the same popover-parsing pipeline as
../addMarketplaceButton/content.js (../popoverItemDetails.js: classifieds-href
params, the known* Effect/Sheen/Killstreaker/Spell/Paint readers, the
Decorated Weapon/War Paint tool name reconstruction). STN needs the FULL
resolveStatsAndClassifieds resolution (classifiedsFilters), same as
marketplace.tf and unlike gladiator.tf's lighter plain-name-only version.

The href comes from utils/tf2StatsLinks/index.js's buildStnTradingHref
(same shape scrap.tf/itemLinks/links.js's own variant confirms live): the
general case matches
Steam's own market_hash_name convention (buildSteamMarketName), while an
Unusual keeps the literal "Unusual" word AND inserts the effect name right
after it - a THIRD, distinct convention from both Steam's own name (no
effect) and gladiator.tf's community "{Effect} {Item}" one (no "Unusual"
word). Not gated on resolved.classifiedsFilters being non-null the way this
file's own marketplace.tf sibling gates on marketplaceHref - buildSteamMarketName
still produces SOME reasonable link straight off itemNameRaw even when
classifiedsFilters itself couldn't be resolved.
*/

import { resolveStatsAndClassifieds, buildStnTradingHref } from "../../../utils/tf2StatsLinks/index.js";
import { findExistingLinkButton, insertLinkButton } from "../linkButtonsRow.js";
import {
  findPopoverRoot,
  findKnownEffectName,
  findKnownSheenName,
  findKnownKillstreakerName,
  findKnownSpellName,
  findKnownPaintName,
  findTargetToolFullName,
  readClassifiedsLinkParams,
  buildItemNameRaw,
  buildSchemaDecoratedWeaponName,
  watchAdditionalLinksRows,
} from "../popoverItemDetails.js";

const STN_BUTTON_CLASS = "tf2te-stn-button";

/*
@description: Builds the stntrading.eu button, copying the row's own first
existing button's class (see ../addMarketplaceButton/content.js's own
buildMarketplaceButtonEl note) so it matches classic UI's styling without
hardcoding a guess here. No native partner-link icon exists for stntrading.eu
on this popover the way marketplace.tf's does, so this is text-only, same as
gladiator.tf's/pricedb.io's/mannco.store's own buttons in this same row.
*/
function buildStnButtonEl(referenceButton, href) {
  const button = document.createElement("a");
  button.className = referenceButton.className || "btn btn-default btn-xs";
  button.classList.add(STN_BUTTON_CLASS);
  button.setAttribute("href", href);
  button.setAttribute("target", "_blank");
  button.setAttribute("rel", "noopener noreferrer");

  const label = document.createElement("span");
  label.textContent = "stntrading.eu";
  button.appendChild(label);

  return button;
}

async function addStnButtonTo(additionalLinksEl) {
  const root = findPopoverRoot(additionalLinksEl);
  if (!root) return;
  if (findExistingLinkButton(root, STN_BUTTON_CLASS)) return;

  const params = readClassifiedsLinkParams(root);
  if (!params) return;
  const { itemName, qualityId, killstreakTier, isAustralium, isNonCraftable, knownEffectId } = params;

  // A target-item tool's "item" param can be the target weapon alone, so its
  // full name comes from the popover title (see findTargetToolFullName).
  const itemNameRaw =
    findTargetToolFullName(root, itemName).fullName ??
    buildSchemaDecoratedWeaponName(itemName, qualityId) ??
    buildItemNameRaw(itemName, qualityId, { isNonCraftable, killstreakTier, isAustralium });

  const resolved = await resolveStatsAndClassifieds(itemNameRaw, {
    knownEffectName: findKnownEffectName(root),
    knownEffectId,
    knownSheenName: findKnownSheenName(root),
    knownKillstreakerName: findKnownKillstreakerName(root),
    knownPaintName: findKnownPaintName(root),
    knownSpellName: findKnownSpellName(root),
    knownKillstreakTier: killstreakTier,
  });

  const href = buildStnTradingHref(itemNameRaw, resolved.classifiedsFilters);

  // The popover may have closed (DOM torn down) or already gotten a button
  // (e.g. this ran twice for the same row) while the resolve above was in
  // flight.
  if (!additionalLinksEl.isConnected) return;
  if (findExistingLinkButton(root, STN_BUTTON_CLASS)) return;

  const referenceButton = additionalLinksEl.children?.[0];
  if (!referenceButton) return; // markup changed - don't guess where/how to build it

  const button = buildStnButtonEl(referenceButton, href);
  insertLinkButton(root, additionalLinksEl, button, STN_BUTTON_CLASS);
}

export function addStnButton() {
  watchAdditionalLinksRows(addStnButtonTo);
}
