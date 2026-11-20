/*
@description: Adds a "gladiator.tf" button into classic backpack.tf's item
hover popover, inserted into the shared "primary" link-buttons row
../linkButtonsRow.js manages (gladiator.tf, pricedb.io, posts.tf, in that
fixed order - see that file's own header note on the two-row layout).

Unlike ../../nextUI/addGladiatorButton/content.js, this doesn't read a
title element for the full display name - it's reconstructed from the
classifieds link's own item/quality/craftable/australium/killstreak_tier
params (../popoverItemDetails.js), without the schema-backed
marketplace.tf/classifieds filter resolution ../addMarketplaceButton needs:
gladiator.tf just wants the plain display name text, same as its
next.backpack.tf counterpart.

For an Unusual item specifically, the literal "Unusual " quality word would
be WRONG for this purpose (real display names read "{Effect} {ItemName}",
e.g. "Purple Energy Team Captain", never "Unusual Team Captain"), so the
popover's own known Effect name is substituted when present - available
directly, with no schema/API-key-gated lookup.

Known gap: a Decorated Weapon that's ALSO Unusual gets no effect-name
substitution (the decorated-weapon name has no such slot) - rare, and
unconfirmed live.
*/

import { findExistingLinkButton, insertLinkButton } from "../linkButtonsRow.js";
import {
  findPopoverRoot,
  findKnownEffectName,
  findTargetToolFullName,
  readClassifiedsLinkParams,
  buildItemNameRaw,
  buildReadableDecoratedWeaponName,
  watchAdditionalLinksRows,
} from "../popoverItemDetails.js";
import { buildGladiatorHref } from "../../../utils/tf2StatsLinks/index.js";

const GLADIATOR_BUTTON_CLASS = "tf2te-gladiator-tf-button";

/*
@description: Builds the gladiator.tf button, cloning the row's own first
existing button's class (confirmed live: "Stats", class="btn btn-default
btn-xs") - same "match a real sibling's own classes rather than hand-carry
them" idea ../addMarketplaceButton/content.js's own buildMarketplaceButtonEl
uses. No icon (unlike that file's own marketplace-small.png, backpack.tf's own
hosted partner icon) - there's no equivalent native icon for gladiator.tf on
this popover to reuse, so a plain text label matches this feature's own
next.backpack.tf version instead.
*/
function buildGladiatorButtonEl(referenceButton, href) {
  const button = document.createElement("a");
  button.className = referenceButton.className || "btn btn-default btn-xs";
  button.classList.add(GLADIATOR_BUTTON_CLASS);
  button.setAttribute("href", href);
  button.setAttribute("target", "_blank");
  button.setAttribute("rel", "noopener noreferrer");

  const label = document.createElement("span");
  label.textContent = "gladiator.tf";
  button.appendChild(label);

  return button;
}

/*
@description: Resolves and appends the gladiator.tf button for one
"#popover-additional-links" row. Fully synchronous - gladiator.tf needs no
network call/schema resolution at all, unlike ../addPricedbButton/content.js's
own classic version (searchPricedbSkuStatus) or
../addMarketplaceButton/content.js's own (resolveStatsAndClassifieds).
*/
function addGladiatorButtonTo(additionalLinksEl) {
  const root = findPopoverRoot(additionalLinksEl);
  if (!root) return;
  if (findExistingLinkButton(root, GLADIATOR_BUTTON_CLASS)) return;

  const params = readClassifiedsLinkParams(root);
  if (!params) return;
  const { itemName, qualityId, killstreakTier, isAustralium, isNonCraftable } = params;
  const knownEffectName = findKnownEffectName(root);

  // A target-item tool's "item" param can be the target weapon alone, so its
  // full name comes from the popover title (see findTargetToolFullName).
  const itemNameRaw =
    findTargetToolFullName(root, itemName).fullName ??
    buildReadableDecoratedWeaponName(itemName, qualityId) ??
    buildItemNameRaw(itemName, qualityId, { isNonCraftable, killstreakTier, isAustralium, knownEffectName });

  const referenceButton = additionalLinksEl.children?.[0];
  if (!referenceButton) return; // markup changed - don't guess where/how to build it

  const button = buildGladiatorButtonEl(referenceButton, buildGladiatorHref(itemNameRaw));
  insertLinkButton(root, additionalLinksEl, button, GLADIATOR_BUTTON_CLASS);
}

export function addGladiatorButton() {
  watchAdditionalLinksRows(addGladiatorButtonTo);
}
