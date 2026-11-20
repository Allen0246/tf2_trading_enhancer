/*
@description: classic (non-next) backpack.tf's own native trade-offer link
only ever carries ?partner=&token= (plus for_item=440_2_<assetid>, but ONLY
for a sell listing - confirmed live a buy listing's native link has no
for_item at all) - and never carries listing_intent/listing_currencies_*.
This file derives those from data visible on the page, the same way
backpack.tf/nextUI/fixTradeOfferLinks/content.js's patchAnchor does, using
URLSearchParams.set so a key can never be duplicated.

Plus the item's NAME (for_item_name), which classic's own native link never
carries on EITHER kind of listing - added for the same reason as nextUI's own
for_item_name: so steamcommunity.com/tradeOffer/pages/tradeoffer.js's
addListingItem can still add more of - or, for a buy listing, add a matching
item from your own inventory for - this listing's item, even once the
specific pre-added asset is gone (sold/traded), or (for a buy listing) never
existed as a real asset to begin with.

Classic's classifieds page is server-rendered (not next's Vue SPA), so a
MutationObserver here is just cheap insurance against AJAX-paginated/lazy-
loaded rows rather than a hard requirement - matches nextUI's own
patchAllVisible-on-load-plus-observe-for-later structure for consistency, but
skips its content-signature dedupe (only needed there because Vue recycles
the same DOM node with different listing data - classic's rows are static
once rendered, so a plain "already patched" flag is enough here).
*/

import { watchTradeLinkClicks } from "../../../utils/tradeLinkTrust.js";
import { parseListingPriceText } from "../../shared/listingPriceText.js";

// The params patchAnchor derives from the row. for_item is not one of them:
// it is classic's own, on a sell listing's native link.
const PREFILL_PARAMS = ["listing_intent", "listing_currencies_keys", "listing_currencies_metal", "for_item_name"];

/*
@description: Patches one tradeoffer/new anchor's href in place, from the
signals on its own .listing row (an anchor outside any .listing row has none,
so it gets no params). listing_intent/listing_currencies_* and for_item_name
are each set independently of one another - a row missing one signal (e.g. an
unparseable price) still gets whichever of the others could be resolved,
rather than an all-or-nothing bail-out.
*/
function patchAnchor(anchor) {
  if (anchor.dataset.tf2teFixed) return;

  const href = anchor.getAttribute("href") || "";
  if (!href.includes("tradeoffer/new")) return;

  let url;
  try {
    url = new URL(href, window.location.href);
  } catch {
    return;
  }

  anchor.dataset.tf2teFixed = "1";

  // Classic's native link never carries these (see the file header), so one
  // already in the href did not come from this listing's row. Cleared first,
  // since the ones below are only set when the row has the data for them: a
  // leftover amount would otherwise be pre-filled as this listing's price.
  for (const param of PREFILL_PARAMS) {
    url.searchParams.delete(param);
  }

  const row = anchor.closest(".listing");

  // listing_intent/listing_currencies_* - read straight off the row's own
  // .item element (data-listing_intent="buy"/"sell", data-listing_price="18
  // ref") - confirmed live on both a sell listing ("My Listings" row) and a
  // real public buy-listing row.
  const itemEl = row ? row.querySelector(".item") : null;
  const listingIntentAttr = itemEl ? itemEl.getAttribute("data-listing_intent") : null;
  let keys = 0;
  let metal = 0;

  if (listingIntentAttr === "buy" || listingIntentAttr === "sell") {
    // Matches tradeoffer.js's own "0 = buy order, 1 = sell order" convention.
    url.searchParams.set("listing_intent", listingIntentAttr === "sell" ? "1" : "0");

    ({ keys, metal } = parseListingPriceText(itemEl.getAttribute("data-listing_price")));
    if (keys) url.searchParams.set("listing_currencies_keys", String(keys));
    if (metal) url.searchParams.set("listing_currencies_metal", String(metal));
  }

  // The listing's own item name - confirmed live in both a sell listing's
  // "My Listings" row and a real buy listing's public classifieds row, both
  // sharing the same li.listing > .listing-body > .listing-header >
  // .listing-title > h5 structure (backpack.tf's item-preview widget, reused
  // site-wide).
  const headerEl = row ? row.querySelector(".listing-title h5") : null;
  const itemName = headerEl ? headerEl.textContent.replace(/\s+/g, " ").trim() : "";

  if (itemName) {
    url.searchParams.set("for_item_name", itemName);
  }

  anchor.setAttribute("href", url.toString());
}

function patchAllVisible(root) {
  root.querySelectorAll('a[href*="tradeoffer/new"]').forEach(patchAnchor);
}

// Only a link this file patched inside a real .listing row counts as a
// backpack.tf listing link (see utils/tradeLinkTrust.js). A trade link
// anywhere else on the site, e.g. one posted on the forums, never does.
function isListingTradeLink(anchor) {
  return Boolean(anchor.dataset.tf2teFixed && anchor.closest(".listing"));
}

export function fixTradeOfferLinks() {
  patchAllVisible(document);
  watchTradeLinkClicks(isListingTradeLink);

  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType !== Node.ELEMENT_NODE) return;

        if (node.matches?.('a[href*="tradeoffer/new"]')) {
          patchAnchor(node);
        } else {
          patchAllVisible(node);
        }
      });
    });
  });

  observer.observe(document.body, { childList: true, subtree: true });
}
