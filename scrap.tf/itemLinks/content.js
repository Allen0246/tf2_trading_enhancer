/*
@description: Wires up the hover-and-wheel-click item card shown on every
scrap.tf page: hovering an item tracks it as the pending selection, then
middle-clicking it resolves and displays that item's identity and outbound
links (see resolveItemDetails.js).
*/
import { createItemCard } from "./itemCard.js";
import { SHEEN_KILLSTREAKER_FILTER_ENABLED_KEY } from "../../utils/sheenKillstreakerFilterSetting.js";

/*
@description: Strips scrap.tf's data-title down to plain text via a real HTML
parse rather than a regex - that attribute can contain quality spans like
"<span class='quality'>Strange</span> Commando", and item names containing an
apostrophe/ampersand need real entity decoding, which a plain regex strip
would leave encoded.

Parsed with DOMParser, not innerHTML on an element from the page's document:
DOMParser builds a separate inert document, so markup like
<img src=x onerror=...> neither loads nor runs its handler.
*/
function stripTags(html) {
  const parsed = new DOMParser().parseFromString(html || "", "text/html");
  return parsed.body.textContent.trim();
}

export function itemLinks() {
  // Only pages with scrap.tf's own item-hover tooltip container get the card
  // (the item name itself is read from data-title, see the mousedown handler).
  const hoverEl = document.querySelector(".hover-over");
  if (!hoverEl) {
    console.warn("[TF2 Trading Enhancer] Scrap.tf hover-over not found.");
    return;
  }

  const { update } = createItemCard();

  // store pending hover info
  let pendingItemEl = null;

  // What the card currently shows (kept after mouseout, unlike
  // pendingItemEl). Replayed when a Steam API key is saved, so a card showing
  // the "Set Steam API key" fallback resolves immediately.
  let lastShownArgs = null;

  /* Get the item information */
  document.addEventListener("mouseover", (e) => {
    const item = e.target.closest(".item.hoverable");
    if (!item) return;
    pendingItemEl = item;
  });

  document.addEventListener("mouseout", (e) => {
    if (e.target.closest(".item.hoverable")) pendingItemEl = null;
  });

  // Updates the item card when the user clicks with the mouse wheel on the item when hovering
  document.addEventListener(
    "mousedown",
    (e) => {
      //Verify if there is any pending item to be displayed
      if (!pendingItemEl) return;

      // Middle-click only: scrap.tf's Sell/Bank pages already use
      // Ctrl+click for multi-select.
      if (e.button !== 1) return;

      // Read the name from the tile's own data-title attribute, not
      // scrap.tf's .hover-over tooltip: cloned tiles (which scrap.tf pages
      // can produce) keep attributes but not the listeners that drive that
      // tooltip.
      const name = stripTags(pendingItemEl.getAttribute("data-title"));
      if (!name) return;

      // update item card
      lastShownArgs = { name, itemEl: pendingItemEl };
      update(name, pendingItemEl);

      // prevent auto-scroll (mouse wheel click's own default action)
      e.preventDefault();
    },
    true
  );

  // Re-resolves whatever's currently shown the moment a Steam API key or the
  // popup's sheen/killstreaker filter setting changes - see lastShownArgs' own
  // note above. A no-op until the item card has actually shown something.
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !("steamApiKey" in changes || SHEEN_KILLSTREAKER_FILTER_ENABLED_KEY in changes) || !lastShownArgs) return;
    return update(lastShownArgs.name, lastShownArgs.itemEl);
  });

  console.log("[TF2 Trading Enhancer] Hover capture + wheel-click to update active.");
}
