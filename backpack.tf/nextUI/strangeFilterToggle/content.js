/*
@description: Adds a "Hide Strange items"/"Show Strange items" toggle
button next to next.backpack.tf classifieds' own "Refresh" button (inside its
PrimeVue paginator's .p-paginator-left-content, alongside
../spellFilterToggle/content.js's own button), hiding every listing whose
own item carries an Elevated Quality of "Strange" via style.display = "none"
(reversible by clicking again) - the same show-by-default, hide-on-click
mechanism ../../oldUI/strangeFilterToggle/content.js already established for
classic backpack.tf, mirrored here since (unlike Spells, see below) this UI
has no native filter VALUE this can drive instead.

Confirmed live: this site's own "Add filters" funnel DOES have an "Elevated
Qualities" category (same funnel panel ../spellFilterToggle/content.js's own
header note documents for "Spells"), and its own value panel lists "Strange"
as an option - BUT (confirmed live) there is no "None"/"No Elevated Quality"
VALUE the way Spells has "No Spells". Checking "Strange" itself there would
filter the page down to ONLY Strange-elevated listings - the opposite of what a "remove" toggle needs -
and with no "absence" value to check instead, the native filter mechanism
../killstreakTierFilter/content.js and ../spellFilterToggle/content.js both
drive can't be used to HIDE Strange listings here. So this reads the same
confirmed-live signal ../../oldUI/strangeFilterToggle/content.js's own header
note documents finding on classic backpack.tf (an item carrying an Elevated
Quality of "Strange"), just under this UI's own different markup: an
"item__elevated_strange" class on the listing's own ".item" element
(confirmed live, e.g. class="... item item__quality-440-5-dark
item__elevated_strange p-440-11 ...") - not the "Strange" trait-filter VALUE
at all.

Continuously re-applies the hide/show state on every scan (this module's own
body-wide MutationObserver tick), not just once at click time - next.backpack.tf
is a Vue SPA whose own classifieds list keeps inserting new listing rows
after the initial load (infinite scroll / live updates), so a listing that
appears AFTER the button was clicked still needs to end up in whatever state
the toggle is currently in, not just whatever was on the page at click time.

Site-wide registration with its own pathname self-check on every scan - same
"router runs once, Vue SPA can navigate without a reload" fix
../spellFilterToggle/content.js's own header note documents.
*/

const LEFT_CONTENT_SELECTOR = ".p-paginator-left-content";
const LISTING_SELECTOR = ".listing";
const ITEM_SELECTOR = ".item";
const ELEVATED_STRANGE_CLASS = "item__elevated_strange";
const BUTTON_CLASS = "tf2te-strange-filter-toggle";
const CLASSIFIEDS_PATHNAME_SUBSTRING = "classifieds";

// Module-level, not per-button - there's only ever one toggle state for the
// whole page, and applyHiddenState (called from every scan tick, not just a
// click handler) needs to read it independently of any particular button
// instance.
let hidden = false;

/*
@description: Test-only reset hook (see utils/tf2Schema.js's own
__resetSchemaCacheForTests for the full writeup of why this repo resets
module-level state between tests via an exported function rather than a
fresh dynamic import per test) - without this, `hidden` would leak between
test cases in the same file, since ES module state is cached across a whole
test run once imported.
*/
export function __resetStrangeFilterToggleForTests() {
  hidden = false;
}

function isElevatedStrangeListing(listing) {
  const item = listing.querySelector(ITEM_SELECTOR);
  return Boolean(item?.classList.contains(ELEVATED_STRANGE_CLASS));
}

function applyHiddenState(root) {
  root.querySelectorAll(LISTING_SELECTOR).forEach((listing) => {
    if (!isElevatedStrangeListing(listing)) return;
    // setProperty(..., "important"), not a plain style.display assignment -
    // confirmed live: a listing's own class list includes Bootstrap's
    // "d-flex" utility (class="listing d-flex ..."), whose own
    // `display: flex !important` rule otherwise wins the cascade over a
    // non-!important inline style, silently no-opping a plain assignment
    // (the button's own label still updated fine, since that's independent
    // JS state - only the visual hide never took effect).
    if (hidden) {
      listing.style.setProperty("display", "none", "important");
    } else {
      listing.style.removeProperty("display");
    }
  });
}

// "Hide"/"Show", not "Remove"/"Readd" - same wording fix
// ../spellFilterToggle/content.js's own buttonLabel documents.
function buttonLabel() {
  return hidden ? "Show Strange items" : "Hide Strange items";
}

function buildButton(referenceButton) {
  const button = document.createElement("button");
  button.type = "button";
  // Cloned from the native Refresh button's own classes (not hardcoded
  // here), same reasoning ../spellFilterToggle/content.js's own buildButton
  // documents.
  button.className = `${referenceButton.className} ${BUTTON_CLASS}`;
  button.style.marginLeft = "8px";
  button.textContent = buttonLabel();

  button.addEventListener("click", () => {
    hidden = !hidden;
    applyHiddenState(document);
    button.textContent = buttonLabel();
  });

  return button;
}

// Same "router runs once, self-check pathname on every scan instead" fix
// ../spellFilterToggle/content.js's own header note documents.
function ensureButton(leftContent) {
  const existing = leftContent.querySelector(`.${BUTTON_CLASS}`);

  if (!window.location.pathname.includes(CLASSIFIEDS_PATHNAME_SUBSTRING)) {
    existing?.remove();
    return;
  }

  if (existing) return; // nothing to keep in sync - the label only changes on click, not per scan

  const referenceButton = leftContent.querySelector("button");
  if (!referenceButton) return; // markup changed - nothing to clone style from

  leftContent.appendChild(buildButton(referenceButton));
}

function scan(root) {
  root.querySelectorAll?.(LEFT_CONTENT_SELECTOR).forEach(ensureButton);

  // Keeps newly-loaded listings (infinite scroll / live updates) in sync
  // with whatever the toggle's current state already is - only worth doing
  // once actually hidden, since a freshly-rendered listing already starts
  // with no inline display override of its own.
  if (hidden && window.location.pathname.includes(CLASSIFIEDS_PATHNAME_SUBSTRING)) {
    applyHiddenState(root);
  }
}

export function strangeFilterToggle() {
  scan(document);

  const observer = new MutationObserver(() => scan(document));
  observer.observe(document.body, { childList: true, subtree: true });
}
