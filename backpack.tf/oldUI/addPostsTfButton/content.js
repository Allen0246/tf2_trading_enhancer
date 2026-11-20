/*
@description: Adds a "posts.tf" button into classic backpack.tf's item hover
popover, inserted into the shared "primary" link-buttons row
../linkButtonsRow.js manages (gladiator.tf, pricedb.io, posts.tf, in that
fixed order - see that file's own header note). Closely modeled on
../addMarketplaceButton/content.js's own classic version (same "reconstruct
the raw display name from the classifieds href's own params, then call
resolveStatsAndClassifieds" approach) rather than
../addGladiatorButton/content.js's or ../addPricedbButton/content.js's own
(which substitute the popover's own known Effect name in place of the
literal quality word "Unusual") - unlike gladiator.tf/pricedb.io, this
button's own resolveStatsAndClassifieds call NEEDS the literal word
"Unusual" in the raw name text to dispatch into its own Unusual branch at
all (see utils/tf2StatsLinks/index.js's own isUnusual check), same
constraint ../addMarketplaceButton/content.js's own classic version already
has to satisfy.

posts.tf's own search schema was reverse-engineered live (see
utils/tf2StatsLinks/index.js's own buildPostsTfLink for the full write-up)
and needs a real Valve defindex, unlike every other button in this file's
sibling folders - resolveStatsAndClassifieds already resolves that via
getItemDefindex and returns it as postsTfHref, so this file only has to
read the same known attributes ../addMarketplaceButton/content.js already
reads and hand them to that one shared call - no separate resolution logic
of its own.

SCOPE: generic items only (plain/painted/Unusual/Killstreak/Spelled),
matching ../../nextUI/addPostsTfButton/content.js's own scope exactly.
Kits/Fabricators/War Paint tools/Decorated Weapons (skins)/Strangifier
Chemistry Sets all resolve postsTfHref to null for now (see
buildPostsTfLink's own note), so this button simply doesn't appear for those
item types.

A plain Strangifier is NOT in that list - see
../../nextUI/addPostsTfButton/content.js's own note for the full reasoning
(this file's own itemNameRaw reconstruction hits the exact same "just the
bare word 'Strangifier', no target weapon anywhere in classic's own
classifieds href" case, which resolves a real, working, but genuinely
non-target-filtered posts.tf link, same as next.backpack.tf's tooltip).

Unlike ../../nextUI/addPostsTfButton/content.js, this file needs no
fallback-anchor logic at all - ../linkButtonsRow.js's own shared row
resolves insertion position fresh from whatever's actually in the DOM on
every call, regardless of which of gladiator.tf/pricedb.io/posts.tf has
resolved yet, so there's no risk of this button's own visibility depending
on an unrelated feature's success the way anchoring directly off one
specific sibling button (next.backpack.tf's own tooltip has no such shared
row) would have.
*/

import { resolveStatsAndClassifieds } from "../../../utils/tf2StatsLinks/index.js";
import { findExistingLinkButton, insertLinkButton } from "../linkButtonsRow.js";
import { postsTfNeedsApiKey, applyPostsTfKeyHint } from "../../../utils/linkButtonStates.js";
import {
  findPopoverRoot,
  findKnownSpellName,
  findKnownPaintName,
  findTargetToolFullName,
  readClassifiedsLinkParams,
  buildItemNameRaw,
  buildReadableDecoratedWeaponName,
  watchAdditionalLinksRows,
} from "../popoverItemDetails.js";

const POSTS_TF_BUTTON_CLASS = "tf2te-posts-tf-button";

/*
@description: Builds the posts.tf button, copying the row's own first
existing button's class (confirmed live: "Stats", class="btn btn-default
btn-xs") so it matches classic UI's styling without hardcoding a guess -
same "match a real sibling's own classes rather than hand-carry them" idea
every other button in this folder uses.
*/
function buildPostsTfButtonEl(referenceButton, href) {
  const button = document.createElement("a");
  button.className = referenceButton.className || "btn btn-default btn-xs";
  button.classList.add(POSTS_TF_BUTTON_CLASS);
  if (href) {
    button.setAttribute("href", href);
    button.setAttribute("target", "_blank");
    button.setAttribute("rel", "noopener noreferrer");
  }

  const label = document.createElement("span");
  label.textContent = "posts.tf";
  button.appendChild(label);

  return button;
}

/*
@description: Resolves and appends the posts.tf button for one
"#popover-additional-links" row. Each popover instance is a fresh DOM tree
(see ../addMarketplaceButton/content.js's own header on why, unlike
next.backpack.tf, no content-signature dedupe is needed) - a plain "does
this row already have our button" check, re-checked after the async resolve
below in case the popover closed (or this ran twice) while it was in
flight, is enough.
*/
async function addPostsTfButtonTo(additionalLinksEl) {
  const root = findPopoverRoot(additionalLinksEl);
  if (!root) return;
  if (findExistingLinkButton(root, POSTS_TF_BUTTON_CLASS)) return;

  const params = readClassifiedsLinkParams(root);
  if (!params) return;
  const { itemName, qualityId, killstreakTier, isAustralium, isNonCraftable, knownEffectId } = params;

  // A Decorated Weapon/War Paint tool always resolves postsTfHref to null
  // (see this file's own header note), but its name is still reconstructed
  // so resolveStatsAndClassifieds classifies it correctly instead of falling
  // through to the generic branch. The literal "Unusual" quality word is kept
  // (no knownEffectName): resolveStatsAndClassifieds needs it to dispatch.
  // Sheen/Killstreaker are deliberately not read: posts.tf's own search has
  // no filter for either (confirmed live via its own search form).
  // A target-item tool's "item" param can be the target weapon alone, so its
  // full name comes from the popover title (see findTargetToolFullName).
  const itemNameRaw =
    findTargetToolFullName(root, itemName).fullName ??
    buildReadableDecoratedWeaponName(itemName, qualityId) ??
    buildItemNameRaw(itemName, qualityId, { isNonCraftable, killstreakTier, isAustralium });

  const resolved = await resolveStatsAndClassifieds(itemNameRaw, {
    knownEffectId,
    knownSpellName: findKnownSpellName(root),
    knownPaintName: findKnownPaintName(root),
    knownKillstreakTier: killstreakTier,
  });
  // No link: show the key-hint button only when a missing Steam Web API key
  // is the reason (see utils/linkButtonStates.js); otherwise nothing (an item
  // type posts.tf doesn't cover).
  const needsKey = !resolved.postsTfHref && (await postsTfNeedsApiKey(resolved.classifiedsFilters, resolved.postsTfHref));
  if (!resolved.postsTfHref && !needsKey) return;

  // The popover may have closed (DOM torn down) or already gotten a button
  // (e.g. this ran twice for the same row) while the resolve above was in
  // flight.
  if (!additionalLinksEl.isConnected) return;
  if (findExistingLinkButton(root, POSTS_TF_BUTTON_CLASS)) return;

  const referenceButton = additionalLinksEl.children?.[0];
  if (!referenceButton) return; // markup changed - don't guess where/how to build it

  const button = buildPostsTfButtonEl(referenceButton, resolved.postsTfHref);
  if (needsKey) applyPostsTfKeyHint(button);
  insertLinkButton(root, additionalLinksEl, button, POSTS_TF_BUTTON_CLASS);
}

export function addPostsTfButton() {
  watchAdditionalLinksRows(addPostsTfButtonTo);
}
