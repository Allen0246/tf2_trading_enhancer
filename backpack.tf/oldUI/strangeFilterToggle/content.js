/*
@description: Adds a "Hide Strange items"/"Show Strange items" toggle
button to classic backpack.tf's /classifieds pages, in the shared controls
row underneath the Killstreak-tier nav (#ks-tier-nav, see
../addKSButtons/content.js and ../classifiedsControlsRow.js's own header
note on that row), alongside the spell-filter toggle (see
../spellFilterToggle/content.js) - same show-by-default, hide-on-click
mechanism as that sibling feature, but for
listings carrying an Elevated Quality of "Strange" (the sub-quality shown on
Unusuals/Haunted items etc. as a "Strange" prefix in their name, e.g.
"Strange Misty Skull Bonk Boy" - an Unusual Bonk Boy that's ALSO Strange),
not the base item Quality itself.

Deliberately NOT a name-text ("contains 'Strange'") check - confirmed live
that would also match two cases explicitly meant to stay untouched: a plain
Strange-quality weapon ("Strange Rocket Launcher", where "Strange" IS the
base data-quality, not an elevated one) and a Festivized Strange weapon
(same base quality, just a Festive skin) - both display "Strange" in their
name too. Instead this reads the real underlying signal confirmed live on a
listing's own .item element - data-quality_elevated="11"/data-qe_name="Strange"
- which is the exact same value already driving the site's own "Elevated
Quality: Strange" filter chip. This attribute is structurally exclusive with
a plain Strange base quality (an item can't be "Strange" both as its base
quality AND its elevated quality at once), so it can never fire on a plain
or Festivized Strange weapon by construction, not just by observed example.

Checked regardless of listing_intent (buy or sell) - same generalized policy
../spellFilterToggle/content.js's own header note documents adopting for
data-spell_1/data-spell_2 (a buy listing's own item element may be a shared
reference instance, not verifiably reflecting that specific buyer's want, but
the site's own "Elevated Quality: Strange" filter/chip is item-shape data,
not buyer-stated intent, so this caveat matters less here than it does for
spells anyway).

Inserted into the same shared controls row ../classifiedsControlsRow.js
creates underneath the Killstreak-tier nav (see that file's own header note
on why it's a separate row now, not chained directly off the nav) - a plain
appendChild there, landing after the spell-filter toggle's own button since
backpack.tf/content.js's own router always calls spellFilterToggle() before
this, not because of any explicit "insert after X" logic here.
*/

import { ensureClassifiedsControlsRow, setListingHiddenBy } from "../classifiedsControlsRow.js";

const LISTING_SELECTOR = "li.listing";
const ITEM_SELECTOR = ".listing-item .item";
const BUTTON_CLASS = "tf2te-oldui-strange-filter-toggle";

// Confirmed live: data-qe_name is the exact human-readable name backing the
// site's own "Elevated Quality: Strange" filter chip.
const ELEVATED_STRANGE_NAME = "Strange";

function hasElevatedStrangeQuality(item) {
  return item.getAttribute("data-qe_name") === ELEVATED_STRANGE_NAME;
}

function findElevatedStrangeListings(root = document) {
  const flagged = [];

  root.querySelectorAll(LISTING_SELECTOR).forEach((listing) => {
    const item = listing.querySelector(ITEM_SELECTOR);
    if (item && hasElevatedStrangeQuality(item)) flagged.push(listing);
  });

  return flagged;
}

// "Hide"/"Show", not "Remove"/"Readd" - same wording fix
// ../spellFilterToggle/content.js's own buttonLabel documents (this only
// ever toggles style.display, never actually removes anything).
function buttonLabel(hidden) {
  return hidden ? "Show Strange items" : "Hide Strange items";
}

function buildButton(flaggedListings) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `btn btn-default btn-sm ${BUTTON_CLASS}`;

  let hidden = false; // flagged listings start VISIBLE - same default spellFilterToggle uses
  button.textContent = buttonLabel(hidden);

  button.addEventListener("click", () => {
    hidden = !hidden;
    flaggedListings.forEach((listing) => setListingHiddenBy(listing, "strange", hidden));
    button.textContent = buttonLabel(hidden);
  });

  return button;
}

export function strangeFilterToggle() {
  if (document.querySelector(`.${BUTTON_CLASS}`)) return; // already inserted

  const flaggedListings = findElevatedStrangeListings();
  if (flaggedListings.length === 0) return; // nothing to toggle - don't clutter the page with a no-op button

  const button = buildButton(flaggedListings);
  ensureClassifiedsControlsRow().appendChild(button);
}
