/*
@description: Adds a "gladiator.tf" button, in its own row, inside
next.backpack.tf's item-preview tooltip - the same tooltip
../addMarketplaceButton/content.js already adds its own marketplace.tf
button/row to (see that file's own header note on the tooltip's shape: a
shared Vue/Tippy component, a single instance whose props update reactively
as you hover different items, with Vue patching the SAME DOM nodes in place
rather than replacing them - the same "content signature, not a plain
boolean flag" dedupe reasoning applies here).

gladiator.tf's own search URL takes a single plain `item` query param -
confirmed live: "https://gladiator.tf/sales?item=
Smoking+Splitting+Headache" - spaces as "+" (URLSearchParams' own default
encoding, not encodeURIComponent's "%20"). Unlike marketplace.tf, which needs
the item's quality/effect/killstreak/paint/etc. broken out into separate
structured filter params (see ../addMarketplaceButton/content.js's own
extensive resolution pipeline), gladiator.tf just wants the exact same
complete display name already shown to the user - read straight off the
tooltip's own title heading (".item-tooltip__header__title", read by
../shared/tooltipItemDetails.js's findTooltipTitle). No async
resolution needed at all here, unlike marketplace.tf's own
resolveStatsAndClassifieds call.

Deliberately its own independent row (own scan off the tooltip's Classifieds
button, ../shared/tooltipButtonRow.js), NOT anchored off
../addMarketplaceButton/content.js's own row/button - anchoring off that
would silently hide this button too whenever marketplace.tf's own (much
stricter) resolution fails to find a marketplaceHref for an item type it
doesn't support, even though gladiator.tf itself needs none of that
resolution and could still work fine. The tradeoff: both features insert
their own row via insertAdjacentElement("afterend", ...) off the SAME native
last content-links row, so which one ends up visually above the other
depends on which finishes first - untested live which that settles to in
practice (this file's own insertion is synchronous while marketplace.tf's own
is async behind a schema resolve, so this one likely wins the race and lands
first/above, but that's not guaranteed by construction).
*/

import { CLASSIFIEDS_BUTTON_SELECTOR, findTooltipRoot, findTooltipTitle } from "../shared/tooltipItemDetails.js";
import { findLastContentLinksRow, buildTooltipButtonRow } from "../shared/tooltipButtonRow.js";
import { buildGladiatorHref } from "../../../utils/tf2StatsLinks/index.js";

const GLADIATOR_BUTTON_CLASS = "tf2te-gladiator-tf-button";

function findExistingGladiatorButton(classifiedsAnchor) {
  return findTooltipRoot(classifiedsAnchor).querySelector?.(`.${GLADIATOR_BUTTON_CLASS}`) ?? null;
}

/*
@description: Resolves and inserts (or updates) the gladiator.tf button's own
row for one Classifieds anchor's tooltip. Dedupes off the title text alone
(not a hash of the anchor's own href/attributes the way
../addMarketplaceButton/content.js's own signature does) - this button's
href depends on nothing else, so the title text alone is already the
complete content signature.
*/
function addGladiatorButtonTo(classifiedsAnchor) {
  const title = findTooltipTitle(classifiedsAnchor);
  if (!title) return;

  if (classifiedsAnchor.dataset.tf2teGladiatorSignature === title) return;
  classifiedsAnchor.dataset.tf2teGladiatorSignature = title;

  const href = buildGladiatorHref(title);

  const existing = findExistingGladiatorButton(classifiedsAnchor);
  if (existing) {
    existing.href = href;
    return;
  }

  // The tooltip may have already been torn down (hover ended) by now -
  // inserting into a detached anchor is a harmless no-op.
  const targetRow = findLastContentLinksRow(classifiedsAnchor);
  if (!targetRow) return; // markup changed - don't guess where to put it

  const row = buildTooltipButtonRow(classifiedsAnchor, { href, label: "gladiator.tf", markerClass: GLADIATOR_BUTTON_CLASS });
  targetRow.insertAdjacentElement("afterend", row);
}

function scan(root) {
  root.querySelectorAll?.(CLASSIFIEDS_BUTTON_SELECTOR).forEach((anchor) => {
    addGladiatorButtonTo(anchor);
  });
}

export function addGladiatorButton() {
  scan(document);

  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType !== Node.ELEMENT_NODE) return;

        if (node.matches?.(CLASSIFIEDS_BUTTON_SELECTOR)) {
          addGladiatorButtonTo(node);
        } else {
          scan(node);
        }
      });
    });
  });

  observer.observe(document.body, { childList: true, subtree: true });
}
