/*
@description: The standalone button row that ../addMarketplaceButton and
../addGladiatorButton each add below next.backpack.tf's item-preview tooltip
links (the other tooltip buttons then sit inside one of these two rows).

The tooltip's own two link rows share the base class
"item-tooltip__content__links" (confirmed live: the Classifieds/Inventory/
Aggs/Item DB row has just that class, the Item/History/Wiki row below it adds
"px-2 mb-1"). A new row goes after the LAST of them, reusing that class plus
"mb-1" rather than inline next to Classifieds: inline placement crowded the
native row into wrapping ("Item DB" alone on its own line), while a row with
the native class gets the native spacing for free.
*/
import { copyScopedStyleAttrs } from "./vueScopedStyle.js";
import { findTooltipRoot } from "./tooltipItemDetails.js";

const CONTENT_LINKS_ROW_SELECTOR = ".item-tooltip__content__links";

/*
@description: The tooltip's last native link row (or one of ours added after
it), which a new row is inserted after; null if the markup changed.
*/
export function findLastContentLinksRow(classifiedsAnchor) {
  const rows = findTooltipRoot(classifiedsAnchor).querySelectorAll?.(CONTENT_LINKS_ROW_SELECTOR) ?? [];
  return rows[rows.length - 1] || null;
}

/*
@description: A new row holding one link button. The button copies the
Classifieds anchor's classes and Vue scoped-style attributes (see
./vueScopedStyle.js), so it looks identical even if next.backpack.tf restyles
its buttons; the row copies the scoped attributes too, or its own classes
would fall back to unscoped styling. Only the row carries a margin
(margin-bottom 3.5px, the native "Item" row's confirmed-live value, set
inline in case "mb-1" does not resolve): a margin on both the button and the
row collapsed unpredictably.
*/
export function buildTooltipButtonRow(classifiedsAnchor, { href, label, markerClass }) {
  const button = document.createElement("a");
  button.href = href;
  button.target = "_blank";
  button.rel = "noopener noreferrer";
  button.className = `${classifiedsAnchor.className} ${markerClass}`;
  copyScopedStyleAttrs(classifiedsAnchor, button);
  button.textContent = label;

  const row = document.createElement("div");
  row.className = `${CONTENT_LINKS_ROW_SELECTOR.slice(1)} mb-1`;
  copyScopedStyleAttrs(classifiedsAnchor, row);
  row.style.marginBottom = "3.5px";
  row.appendChild(button);
  return row;
}
