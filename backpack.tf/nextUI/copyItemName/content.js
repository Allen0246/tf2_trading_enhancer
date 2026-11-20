/*
@description: Click-to-copy item name on next.backpack.tf - clicking a
classifieds listing's own item name, an item-preview hover tooltip's own
title, or a /stats page's own item title, copies the plain item name text to
the clipboard. Same idea as the classic-UI version
(../../oldUI/copyItemName/content.js), rebuilt here against next.backpack.tf's
own Vue markup rather than guessed fresh:
  - .listing__details__header is the exact selector this extension's own
    fixTradeOfferLinks/content.js already reads a listing's item name from
    (confirmed live there - see its own itemName/headerEl note).
  - .item-tooltip__header__title is the exact selector the tooltip link
    buttons already read a hover tooltip's item title from (confirmed live -
    see ../shared/tooltipItemDetails.js's TITLE_SELECTOR/findTooltipTitle).
Neither selector is guessed for this feature - both are load-bearing
elsewhere in this same extension already.

The /stats page's own title (confirmed live via pasted markup: an
"<h2 class="m-0 mb-2">") is a DIFFERENT case - "m-0 mb-2" is a plain
Bootstrap spacing-utility combo, not a feature-specific class, so matching
it site-wide the way the two selectors above are matched would risk hitting
some unrelated h2 elsewhere on the site that happens to reuse the same two
common utility classes. Restricted to an exact "/stats" pathname check
instead, where the risk of a second unrelated match is much lower - not
independently confirmed there's only ever one such element even there.
*/

const COPY_CLASS = "tf2te-copy-item-name";
const SUCCESS_CLASS = "tf2te-copy-item-name-success";
const ERROR_CLASS = "tf2te-copy-item-name-error";
const TARGET_SELECTORS = [".listing__details__header", ".item-tooltip__header__title"];
// Only ever queried on an exact "/stats" pathname (see this file's own
// header note on why this one needs a page-restriction the others don't).
const STATS_TITLE_SELECTOR = "h2.m-0.mb-2";
const FEEDBACK_MS = 400;

function injectStyles() {
  if (document.getElementById("tf2te-copy-item-name-styles")) return;

  const style = document.createElement("style");
  style.id = "tf2te-copy-item-name-styles";
  style.textContent = `
    .${COPY_CLASS} { cursor: pointer; }
    .${COPY_CLASS}:hover { opacity: 0.8; }
    .${SUCCESS_CLASS} { background-color: rgba(0, 150, 0, 0.3) !important; }
    .${ERROR_CLASS} { background-color: rgba(150, 0, 0, 0.3) !important; }
  `;
  document.head.appendChild(style);
}

function cleanText(text) {
  return (text || "").replace(/\s+/g, " ").trim();
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    console.warn("[TF2 Trading Enhancer] Copy Item Name: clipboard write failed", e);
    return false;
  }
}

function flashFeedback(el, success) {
  const cls = success ? SUCCESS_CLASS : ERROR_CLASS;
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), FEEDBACK_MS);
}

function makeClickable(el) {
  if (el.classList.contains(COPY_CLASS)) return; // already wired up
  el.classList.add(COPY_CLASS);
  el.title = "Click to copy item name";

  // Copy silently didn't work for a Classifieds Listing's own item-preview
  // tooltip, which has its own native "On Click: View Listing" behavior
  // baked directly into the SAME title element this feature makes clickable,
  // registered before this content script's own listener so a plain
  // bubble-phase stopPropagation() here would run too late. Registered in
  // the CAPTURE phase instead ({ capture: true }) so it
  // always runs before any bubble-phase listener on this same element, and
  // stopImmediatePropagation() stops the native handler from ever running at
  // all, regardless of registration order. See #147.
  el.addEventListener(
    "click",
    async (event) => {
      const name = cleanText(el.textContent);
      if (!name) return;

      event.preventDefault();
      event.stopImmediatePropagation();

      const success = await copyToClipboard(name);
      flashFeedback(el, success);
    },
    { capture: true }
  );
}

function scan(root) {
  TARGET_SELECTORS.forEach((selector) => {
    root.querySelectorAll?.(selector).forEach(makeClickable);
  });

  if (window.location.pathname === "/stats") {
    root.querySelectorAll?.(STATS_TITLE_SELECTOR).forEach(makeClickable);
  }
}

export function copyItemName() {
  injectStyles();
  scan(document);

  // Both target shapes render/re-render client-side (listing rows on
  // pagination, tooltip titles on hover) well after this content script's
  // initial run - a MutationObserver is the only way to keep catching them,
  // same reasoning fixTradeOfferLinks/addMarketplaceButton already use for
  // this exact page.
  const observer = new MutationObserver(() => scan(document));
  observer.observe(document.body, { childList: true, subtree: true });
}
