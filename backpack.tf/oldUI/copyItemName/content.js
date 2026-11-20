/*
@description: Click-to-copy item name on classic backpack.tf - clicking a
classifieds listing's own title, a /stats page's own item title, or an item
hover popover's own title copies the plain item name text to the clipboard.
Deliberately has no batching/WeakSet/requestAnimationFrame machinery - that
kind of scale handling solves a problem (thousands of elements) this site
never actually has here (a classifieds page is at most a few dozen listings).

.listing-title h5 is confirmed live against this extension's own earlier
work on this exact page (see ../spellFilterToggle/content.js's own header
note on real listing markup - the same <h5>Item Name</h5> structure).
.popover-title is confirmed live too (a real popover for a "Third Degree
Strangifier": <h3 class="popover-title ...">Third Degree Strangifier</h3>, a
SIBLING of .popover-content under the same outer ".popover" container, not a
descendant of it). The popover link buttons read that same element for a
target-item tool's (Strangifier's) full display name, since classic's own
classifieds href never carries the whole name - see
../popoverItemDetails.js's findTargetToolFullName.
*/

const COPY_CLASS = "tf2te-copy-item-name";
const SUCCESS_CLASS = "tf2te-copy-item-name-success";
const ERROR_CLASS = "tf2te-copy-item-name-error";
const TARGET_SELECTORS = [".listing-title h5", ".stats-header-title", ".popover-title"];
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

  // Registered in the CAPTURE phase with stopImmediatePropagation() (not
  // just stopPropagation() in the ordinary bubble phase) - same defensive
  // fix ../../nextUI/copyItemName/content.js's own makeClickable applies,
  // for a bug confirmed live there (a next.backpack.tf tooltip variant with
  // its own native "On Click: View Listing" handler on the exact same title
  // element, which fired before a plain bubble-phase listener could stop
  // it). No confirmed-live equivalent native handler found on classic
  // backpack.tf's own .listing-title/.stats-header-title/.popover-title
  // elements (this UI has no Vue click-to-navigate tooltips at all), but
  // applying the same protection here too is free insurance against the
  // identical failure mode.
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
}

export function copyItemName() {
  injectStyles();
  scan(document);

  // Listing titles/stats headers are present at load, but popover titles
  // only exist once a hover popover has actually been built - re-scan on
  // every DOM change to catch those (and any listings/stats content Steam-
  // style AJAX navigation might swap in later).
  const observer = new MutationObserver(() => scan(document));
  observer.observe(document.body, { childList: true, subtree: true });
}
