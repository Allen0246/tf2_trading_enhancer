/*
@description: Adds a "pricedb.io" button into classic backpack.tf's item hover
popover, inserted into the shared "primary" link-buttons row
../linkButtonsRow.js manages (gladiator.tf, pricedb.io, posts.tf) - same
architecture as ../addMarketplaceButton/content.js's own classic version (see
that file's own header note: a plain Bootstrap popover, a fresh DOM tree per
hover with no Vue-node-reuse problem, so a plain "does this popover already
have our button" check is enough).

Same reconstructed display-name approach ../addGladiatorButton/content.js's
own classic version documents (../popoverItemDetails.js, including the
Unusual-effect-name substitution and the Decorated-Weapon-plus-Unusual known
gap) - resolved via pricedb.io's own /api/search (utils/pricedb.js), the exact same
network relay ../../nextUI/addPricedbButton/content.js already uses, not a
manually built SKU (see that file's own header note on why: a Decorated
Weapon's own SKU defindex isn't derivable from this popover's markup either).
*/

import { searchPricedbSkuStatus } from "../../../utils/pricedb.js";
import { findExistingLinkButton, insertLinkButton } from "../linkButtonsRow.js";
import { startRetryCountdown } from "../../../utils/linkButtonStates.js";
import {
  findPopoverRoot,
  findKnownEffectName,
  findTargetToolFullName,
  readClassifiedsLinkParams,
  buildItemNameRaw,
  buildReadableDecoratedWeaponName,
  watchAdditionalLinksRows,
} from "../popoverItemDetails.js";

const PRICEDB_BUTTON_CLASS = "tf2te-pricedb-button";

function buildPricedbHref(sku) {
  return `https://pricedb.io/item/${encodeURIComponent(sku)}`;
}

// Same "clone a real sibling's own classes, no icon" approach
// ../addGladiatorButton/content.js's own buildGladiatorButtonEl documents.
// href is null for pricedb.io's own rate-limited state (a real,
// confirmed-live 429 - see utils/pricedb.js's own searchPricedbSkuStatus
// note) - rendered as a non-clickable <span> instead of a real <a> with no
// href, same "never a dead link" reasoning every other placeholder in this
// codebase already follows.
function buildPricedbButtonEl(referenceButton, href, label) {
  const button = document.createElement(href ? "a" : "span");
  button.className = referenceButton.className || "btn btn-default btn-xs";
  button.classList.add(PRICEDB_BUTTON_CLASS);
  if (href) {
    button.setAttribute("href", href);
    button.setAttribute("target", "_blank");
    button.setAttribute("rel", "noopener noreferrer");
  } else {
    button.style.opacity = "0.55";
    button.style.cursor = "default";
  }

  const labelEl = document.createElement("span");
  labelEl.textContent = label ?? "pricedb.io";
  button.appendChild(labelEl);

  return button;
}

/*
@description: Resolves and appends the pricedb.io button for one
"#popover-additional-links" row. Re-checks "already has a button"/isConnected
AFTER the async search below, same as
../addMarketplaceButton/content.js's own addMarketplaceButtonTo - the popover
may have closed, or already gotten a button (this ran twice), while the
lookup was in flight.
*/
async function addPricedbButtonTo(additionalLinksEl) {
  const root = findPopoverRoot(additionalLinksEl);
  if (!root) return;
  if (findExistingLinkButton(root, PRICEDB_BUTTON_CLASS)) return;

  const params = readClassifiedsLinkParams(root);
  if (!params) return;
  const { itemName, qualityId, killstreakTier, isAustralium, isNonCraftable } = params;
  const knownEffectName = findKnownEffectName(root);

  // A target-item tool is searched by its full title (see
  // ../popoverItemDetails.js's findTargetToolFullName).
  const targetTool = findTargetToolFullName(root, itemName);
  if (targetTool.isTargetTool && !targetTool.fullName) return; // no full name to search by - don't guess
  const itemNameRaw =
    targetTool.fullName ??
    buildReadableDecoratedWeaponName(itemName, qualityId) ??
    buildItemNameRaw(itemName, qualityId, { isNonCraftable, killstreakTier, isAustralium, knownEffectName });

  const { sku, rateLimited, retryAfterMs } = await searchPricedbSkuStatus(itemNameRaw);
  if (!sku && !rateLimited) return; // no match found - don't guess

  if (!additionalLinksEl.isConnected) return;
  if (findExistingLinkButton(root, PRICEDB_BUTTON_CLASS)) return;

  const referenceButton = additionalLinksEl.children?.[0];
  if (!referenceButton) return; // markup changed - don't guess where/how to build it

  const button = buildPricedbButtonEl(referenceButton, sku ? buildPricedbHref(sku) : null);
  if (!sku) {
    // Rate limited: count down from pricedb.io's Retry-After, then swap in a
    // fresh lookup if the popover is still open (a closed one re-resolves on
    // its next hover anyway, since classic builds a new popover each time).
    startRetryCountdown(button, {
      label: "pricedb.io",
      retryAfterMs,
      onRetry: (isConnected) => {
        if (!isConnected) return;
        button.remove();
        addPricedbButtonTo(additionalLinksEl);
      },
    });
  }
  insertLinkButton(root, additionalLinksEl, button, PRICEDB_BUTTON_CLASS);
}

export function addPricedbButton() {
  watchAdditionalLinksRows(addPricedbButtonTo);
}
