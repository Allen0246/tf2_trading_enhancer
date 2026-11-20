/*
@description: Adds a "Hide spelled items"/"Show spelled items" toggle
button to classic backpack.tf's /classifieds pages, in the shared controls
row underneath the existing Killstreak-tier nav (#ks-tier-nav, see
../addKSButtons/content.js and ../classifiedsControlsRow.js's own header
note on why it's a separate row now, not chained directly off the nav),
hiding every listing detected as spelled via style.display = "none"
(reversible by clicking the button again). No query-param/live-filter trick
exists here the way next.backpack.tf's own Spells filter does (see
../../nextUI/spellFilterToggle/content.js) - classic /classifieds is a plain
server-rendered page, not a Vue SPA with reactive filter state.

Naively trusting data-spell_1/data-spell_2 on EVERY listing's own .item
element regardless of buy/sell is semantically unreliable for BUY listings
specifically - confirmed live: a buy order has no real underlying item instance (data-id=""
on its .item element, confirmed live), so its data-spell_1/data-spell_2
don't reflect that particular buyer's own actual want - two unrelated buy
listings (different buyers, different comments, one of which explicitly said
"any paint spell"/"any footprints" rather than naming specific ones) showed
the IDENTICAL spell pair, matching neither buyer's own stated comment -
strong evidence these are a shared reference item's attributes reused for
icon/tooltip rendering across every buy listing of the same item+quality on
the page, not per-listing data.

Despite that unreliability, data-spell_1/data-spell_2 is still checked for
EVERY listing (not sell-only) - deliberately prioritizing "nothing
spell-shaped stays visible" over "never hide a buy order that might not
really care about spells".
Comment-text keyword matching (data-listing_comment) is layered on top as an
ADDITIONAL catch for every listing too (most useful for buy orders whose
shared reference item happens to have no spell data at all, but the buyer's
own comment says otherwise) - still inherently best-effort itself, a listing
that wants a spelled item without ever naming one in its comment can't be
caught this way.
*/

import { ensureClassifiedsControlsRow, setListingHiddenBy } from "../classifiedsControlsRow.js";

const LISTING_SELECTOR = "li.listing";
const ITEM_SELECTOR = ".listing-item .item";
const BUTTON_CLASS = "tf2te-oldui-spell-filter-toggle";

// Comment-text signals for a listing wanting/offering a spelled item -
// best-effort only (see this file's own header note), not exhaustive (a
// listing that wants/has one but never named it in its comment still slips
// through this specific check, though data-spell_1/data-spell_2 below still
// catches most sell listings regardless). All 16 individual spell names are
// the exact confirmed-live set from next.backpack.tf's own "Spells" filter
// panel (see ../../nextUI/spellFilterToggle/content.js's own header note on
// that panel), not guessed - a comment naming one specific spell without
// ever using the word "spell" itself (e.g. "Voices from Below only") still
// needs to match. Also includes a couple of stylized Unicode letter variants
// traders sometimes use to dodge a plain-text "spell" search.
const COMMENT_SPELL_KEYWORDS = [
  "spell",
  "spelled",
  "spells",
  "𝘀𝗽𝗲𝗹𝗹",
  "𝐬𝐩𝐞𝐥𝐥𝐞𝐝",
  "exorcism",
  "voices from below",
  "pumpkin bombs",
  "halloween fire",
  "team spirit footprints",
  "headless horseshoes",
  "corpse gray footprints",
  "violent violet footprints",
  "bruised purple footprints",
  "gangreen footprints",
  "rotten orange footprints",
  "die job",
  "chromatic corruption",
  "putrescent pigmentation",
  "spectral spectrum",
  "sinister staining",
  "horseshoes/rotten orange",
  "cc/ss",
  "ro fp",
];

function hasSpellAttributes(item) {
  return Boolean(item.getAttribute("data-spell_1") || item.getAttribute("data-spell_2"));
}

function commentMentionsSpell(item) {
  const comment = (item.getAttribute("data-listing_comment") || "").toLowerCase();
  return COMMENT_SPELL_KEYWORDS.some((keyword) => comment.includes(keyword.toLowerCase()));
}

// Checked for every listing regardless of buy/sell (see this file's own
// header note on why data-spell_1/data-spell_2 is trusted for buy listings
// too, despite being semantically unreliable there) - either signal alone is
// enough.
function isListingSpelled(item) {
  return hasSpellAttributes(item) || commentMentionsSpell(item);
}

function findSpelledListings(root = document) {
  const spelled = [];

  root.querySelectorAll(LISTING_SELECTOR).forEach((listing) => {
    const item = listing.querySelector(ITEM_SELECTOR);
    if (item && isListingSpelled(item)) spelled.push(listing);
  });

  return spelled;
}

// "Hide"/"Show", not "Remove"/"Readd" - this only ever toggles a listing's
// own inline style.display, never actually removes anything from the page
// or the site itself, and "Remove" reads as if it does.
function buttonLabel(hidden) {
  return hidden ? "Show spelled items" : "Hide spelled items";
}

function buildButton(spelledListings) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `btn btn-default btn-sm ${BUTTON_CLASS}`;

  let hidden = false; // spelled listings start VISIBLE - see spellFilterToggle's own note on why
  button.textContent = buttonLabel(hidden);

  button.addEventListener("click", () => {
    hidden = !hidden;
    // Shared with the Strange toggle, so un-hiding here never re-shows a
    // listing that toggle still hides (see setListingHiddenBy).
    spelledListings.forEach((listing) => setListingHiddenBy(listing, "spell", hidden));
    button.textContent = buttonLabel(hidden);
  });

  return button;
}

export function spellFilterToggle() {
  if (document.querySelector(`.${BUTTON_CLASS}`)) return; // already inserted

  const spelledListings = findSpelledListings();
  if (spelledListings.length === 0) return; // nothing to toggle - don't clutter the page with a no-op button

  // Left VISIBLE on load, not auto-hidden - hiding spelled listings is an
  // explicit action via the button.
  const button = buildButton(spelledListings);
  ensureClassifiedsControlsRow().appendChild(button);
}
