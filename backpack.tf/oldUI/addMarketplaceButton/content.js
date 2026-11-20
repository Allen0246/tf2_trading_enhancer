/*
@description: Adds a "marketplace.tf" button into classic backpack.tf's item
hover popover (Bootstrap `.popover-content` - shown when hovering an item
icon anywhere on the old UI - Almanac grids, classifieds listings, profile
inventories, etc.), inserted into the shared "secondary" link-buttons row
../linkButtonsRow.js manages (stntrading.eu, marketplace.tf, mannco.store, in
that fixed order - see that file's own header note), right after the native
"#popover-additional-links" row of Stats/Unusual/Effect/History/Wiki buttons.

The popover's own Classifieds anchor already carries everything needed to
rebuild the raw display name resolveStatsAndClassifieds expects (see
../popoverItemDetails.js): "item" (the REAL, Name-Tag-proof identity
backpack.tf itself already resolved), quality, craftable/australium,
killstreak_tier (plain 0-3, no Sheen/Killstreaker-presence inference needed
the way next.backpack.tf's tooltip requires), and the Unusual effect's own
numeric particle id, passed straight through as knownEffectId so an
Unusual's links work with no Steam Web API key configured.

Effect/Sheen/Killstreaker/Spell/Paint are read off the popover's Item
Details and passed unconditionally: they resolve from static tables
(SHEEN_IDS/KILLSTREAKER_IDS/SPELL_IDS/MARKETPLACE_SPELL_SLUGS/PAINT_IDS), and
utils/tf2StatsLinks/index.js's resolveClassifiedsFilters decides per matched
item type whether its branch uses them. That includes a Decorated-Weapon-
family item's effect (confirmed live: "Isotope"/702 on an "Ocean Mapped War
Paint (Field-Tested)" belongs in seffect[]=702).

Decorated Weapons and standalone War Paint tools need their own name
reconstruction (buildSchemaDecoratedWeaponName): their "item" param is
"{skin} | {weapon} (wear)", while matchDecoratedWeapon/matchWarPaintTool each
expect a different joined shape, and a plain "Decorated Weapon" quality
(id 15) never has a text quality prefix. Without it the item falls through
to the generic branch and gets a garbage marketplace.tf search (confirmed
live via "Cool Professional Killstreak Secretly Serviced Powerjack (Battle
Scarred)" and "Ocean Mapped | War Paint (Field-Tested)"). See #4. See #34.
*/

import { resolveStatsAndClassifieds } from "../../../utils/tf2StatsLinks/index.js";
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

const MARKETPLACE_BUTTON_CLASS = "tf2te-marketplace-tf-button";

/*
@description: Builds the marketplace.tf button, copying the row's own first
existing button's class (confirmed live: "Stats", class="btn btn-default
btn-xs") so it matches classic UI's styling without hardcoding a guess here -
same "match a real sibling's own classes rather than hand-carry them" idea
backpack.tf/nextUI/shared/tooltipButtonRow.js uses for the Classifieds
anchor. Reuses the native
marketplace.tf partner link's own icon image (confirmed live:
"#popover-price-links" already has <img src="/images/marketplace-small.png?v=2">)
instead of a FontAwesome glyph, since backpack.tf itself already established
that as marketplace.tf's own icon on this exact popover - no guessed icon
needed.
*/
function buildMarketplaceButtonEl(referenceButton, href) {
  const button = document.createElement("a");
  button.className = referenceButton.className || "btn btn-default btn-xs";
  button.classList.add(MARKETPLACE_BUTTON_CLASS);
  button.setAttribute("href", href);
  button.setAttribute("target", "_blank");
  button.setAttribute("rel", "noopener noreferrer");

  // Explicit size - confirmed live this image renders at its own large
  // native dimensions (not actually "small" despite the filename) unless
  // constrained: "#popover-price-links" only shows it small because that
  // row's OWN CSS scopes a size rule to it specifically, which doesn't reach
  // an <img> placed anywhere else (like this button, in this extension's own
  // link-buttons row instead) - seen as a huge button breaking
  // the row's layout. Sized/aligned to match the row's own FontAwesome icons
  // (fa-list-alt etc., ~14px, vertical-align: text-bottom) rather than left
  // at native size.
  const icon = document.createElement("img");
  icon.setAttribute("src", "/images/marketplace-small.png?v=2");
  icon.style.width = "14px";
  icon.style.height = "14px";
  icon.style.verticalAlign = "text-bottom";
  icon.style.marginRight = "3px";
  button.appendChild(icon);

  const label = document.createElement("span");
  label.textContent = "marketplace.tf";
  button.appendChild(label);

  return button;
}

/*
@description: Resolves and appends the marketplace.tf button for one
"#popover-additional-links" row. Each popover instance is a fresh DOM tree
(see this file's own header on why, unlike next.backpack.tf, no
content-signature dedupe is needed) - a plain "does this row already have our
button" check, re-checked after the async resolve below in case the popover
closed (or this ran twice) while it was in flight, is enough.
*/
async function addMarketplaceButtonTo(additionalLinksEl) {
  const root = findPopoverRoot(additionalLinksEl);
  if (!root) return;
  if (findExistingLinkButton(root, MARKETPLACE_BUTTON_CLASS)) return;

  const params = readClassifiedsLinkParams(root);
  if (!params) return;
  const { itemName, qualityId, killstreakTier, isAustralium, isNonCraftable, knownEffectId } = params;

  // A target-item tool resolves from its full popover title (target weapon
  // included), which lets resolveStatsAndClassifieds re-derive the split
  // itemName/targetItemName fields itself. See #33.
  const targetToolFullName = findTargetToolFullName(root, itemName).fullName;
  const itemNameRaw =
    targetToolFullName ??
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
  if (!resolved.marketplaceHref) return;

  // The popover may have closed (DOM torn down) or already gotten a button
  // (e.g. this ran twice for the same row) while the resolve above was in
  // flight.
  if (!additionalLinksEl.isConnected) return;
  if (findExistingLinkButton(root, MARKETPLACE_BUTTON_CLASS)) return;

  const referenceButton = additionalLinksEl.children?.[0];
  if (!referenceButton) return; // markup changed - don't guess where/how to build it

  const button = buildMarketplaceButtonEl(referenceButton, resolved.marketplaceHref);
  insertLinkButton(root, additionalLinksEl, button, MARKETPLACE_BUTTON_CLASS);
}

export function addMarketplaceButton() {
  watchAdditionalLinksRows(addMarketplaceButtonTo);
}
