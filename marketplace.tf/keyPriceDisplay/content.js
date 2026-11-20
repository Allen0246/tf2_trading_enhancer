/*
@description: Adds a "≈X.XX keys" line underneath every item price on
marketplace.tf (item grid tiles' own .item-box-price, and an item detail
page's own "Lowest Price" .current-bid-amount), converting whatever price is
shown into its key-equivalent using the live key price
../../utils/marketplaceTfPricing.js fetches/caches (1h TTL, see that file's
own header note).

Deliberately never converts currencies itself. Confirmed live: marketplace.tf
already tells us an item's USD-equivalent price directly, regardless of
which currency the account is set to display - a price shown in a
non-USD currency carries a title/data-original-title="Converted from $X.XX"
tooltip (confirmed live on both .item-box-price and .current-bid-amount), and
a USD-displayed price is already the USD figure. Since
../../utils/marketplaceTfPricing.js's own key price is also always
USD-denominated (confirmed live, matches marketplace.tf's own "priced
internally in USD" wording), both sides of the division are always USD -
this file never needs to know, store, or hand-tune an exchange rate for
EUR/GBP/whatever the account happens to be set to. A price shown in a
currency OTHER than USD with no "Converted from" tooltip present (not
confirmed to ever happen live) can't be resolved - skipped silently rather
than guessed.

Also adds the same "≈X.XX keys" line inside each price cell of an item
detail page's own "Item List" table, under the row's price - confirmed live
those rows carry the exact same "Converted from $X.XX" tooltip on their own
price <span>. Shown inside the Price cell (not its own column) to leave width
for the per-row classifieds buttons (../itemQuickLinks/content.js). The table is found by a real <th>
whose text is exactly "Price" (not a specific table class - .table-bordered
is shared with other, unrelated tables on this site), and that header's
index picks out each row's price <td> without assuming a column count.

Continuously re-scans on every MutationObserver tick (not just once at
load) - marketplace.tf renders/updates its own item grids and cart controls
dynamically (pagination, live price updates), so new price elements can
appear well after the initial page load. Re-fetching the key price on every
scan is safe/cheap, not wasteful - getMarketplaceLiveKeyPriceUsd's own 1h
cache means every call after the first just reads chrome.storage.local
rather than re-hitting the network.
*/

import { getMarketplaceLiveKeyPriceUsd } from "../../utils/marketplaceTfPricing.js";

const PRICE_CONTAINER_SELECTORS = [".item-box-price", ".current-bid-amount"];
const KEY_LABEL_CLASS = "tf2te-mptf-key-price";
const CONVERTED_FROM_PATTERN = /Converted from \$([\d,]+\.\d{2})/;
const PLAIN_USD_PATTERN = /\$([\d,]+\.\d{2})/;
const TABLE_SELECTOR = ".table-bordered";

/*
@description: Resolves one price <span>'s own USD-equivalent value - see
this file's own header note on why this is always possible (or safely
skippable) without any currency conversion of our own.
*/
function resolveItemPriceUsd(span) {
  const tooltip = span.getAttribute("data-original-title") || span.getAttribute("title") || "";
  const convertedMatch = tooltip.match(CONVERTED_FROM_PATTERN);
  if (convertedMatch) return Number(convertedMatch[1].replace(/,/g, ""));

  const plainMatch = (span.textContent || "").match(PLAIN_USD_PATTERN);
  if (plainMatch) return Number(plainMatch[1].replace(/,/g, ""));

  return null; // shown in a non-USD currency with no "Converted from" tooltip - can't resolve
}

// "≈", not "~": an approximation, not an exact conversion.
function formatKeyPriceLabel(itemPriceUsd, keyPriceUsd) {
  return `≈${(itemPriceUsd / keyPriceUsd).toFixed(2)} keys`;
}

function ensureKeyPriceLabel(container, keyPriceUsd) {
  if (container.querySelector(`.${KEY_LABEL_CLASS}`)) return; // already inserted

  const span = container.querySelector("span");
  if (!span) return;

  const itemPriceUsd = resolveItemPriceUsd(span);
  if (itemPriceUsd === null) return;

  const label = document.createElement("div");
  label.className = KEY_LABEL_CLASS;
  // Smaller/muted than the main price, not full price-sized text - but not
  // too small to read either (12px was reported too small live).
  label.style.fontSize = "14px";
  label.style.color = "#8f98a0";
  label.textContent = formatKeyPriceLabel(itemPriceUsd, keyPriceUsd);
  // Appended at the end of the container (not right after the span itself)
  // - .current-bid-amount has trailing " each" text after its own span, so
  // inserting straight after the span would land between the price and that
  // text; appending to the container puts the label on its own line below
  // everything else in both container shapes.
  container.appendChild(label);
}

function findPriceColumnIndex(headerRow) {
  return Array.from(headerRow.children).findIndex((th) => (th.textContent || "").trim() === "Price");
}

// The key price under each Item List row's own price, inside its Price cell
// (the same label ensureKeyPriceLabel adds under the page's other prices).
// Per-row and idempotent: pagination can swap the rows without re-rendering
// the header.
function ensureTablePriceLabels(table, keyPriceUsd) {
  const headerRow = table.querySelector("thead")?.querySelector("tr");
  if (!headerRow) return;

  const priceIndex = findPriceColumnIndex(headerRow);
  if (priceIndex === -1) return;

  table
    .querySelector("tbody")
    ?.querySelectorAll("tr")
    .forEach((row) => {
      const priceCell = row.children[priceIndex];
      if (priceCell) ensureKeyPriceLabel(priceCell, keyPriceUsd);
    });
}

async function scan(root) {
  const keyPriceUsd = await getMarketplaceLiveKeyPriceUsd();
  if (keyPriceUsd === null) return; // not logged in / fetch failed with nothing cached - nothing to compute against

  PRICE_CONTAINER_SELECTORS.forEach((selector) => {
    root.querySelectorAll(selector).forEach((container) => ensureKeyPriceLabel(container, keyPriceUsd));
  });

  root.querySelectorAll(TABLE_SELECTOR).forEach((table) => ensureTablePriceLabels(table, keyPriceUsd));
}

export function keyPriceDisplay() {
  scan(document);

  const observer = new MutationObserver(() => scan(document));
  observer.observe(document.body, { childList: true, subtree: true });
}
