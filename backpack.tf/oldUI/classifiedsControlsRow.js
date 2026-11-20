/*
@description: Shared row helper for classic backpack.tf's /classifieds page -
the Spell filter toggle (./spellFilterToggle/content.js), Strange filter
toggle (./strangeFilterToggle/content.js), and free-text search box
(./classifiedsSearchFilter/content.js) all land in their own shared row
right after the Killstreak-tier nav (#ks-tier-nav, see
./addKSButtons/content.js's own createButtonsClassifieds), rather than
chaining directly off #ks-tier-nav / each other's elements. Confirmed live
that chaining crams it all (4 tier tabs + up to 2 toggle buttons + a 300px
search input) onto one cramped line, since #ks-tier-nav's own btn-group has
no block-level wrapper forcing a line break. next.backpack.tf's
killstreakTierFilter uses the same "own row" approach.

Same "genuinely shared, not duplicated per file" reasoning
./linkButtonsRow.js's own header note documents for the item hover popover's
own two button rows - these three features are coordinating on ONE shared
row (not two), so whichever of them resolves first has to be the one that
creates it, and every feature just appends into it. Unlike linkButtonsRow's
own buttonOrder-based positioning (needed there because any of its 5 buttons
can resolve in any order), no explicit ordering logic is needed here - a
plain appendChild always lands each one after whatever
backpack.tf/content.js's own router already called before it (spell toggle,
then Strange toggle, then the search box, in that fixed order).

A plain flex row with a `gap` handles spacing between whatever ends up
inside it, rather than each feature setting its own marginLeft - simpler than
./linkButtonsRow.js's own applyButtonSpacing recompute, since this row's
membership only ever grows via a fixed call order, never reshuffles.

Also owns setListingHiddenBy, which the spell and Strange toggles in this row
share so they can't un-hide each other's listings.
*/

const ROW_ID = "tf2te-oldui-classifieds-controls-row";
const NAV_ID = "ks-tier-nav";

// Which toggles currently hide each listing (listing -> Set of reasons).
const hideReasonsByListing = new WeakMap();

/*
@description: Hides or re-shows one listing for one toggle ("reason"), for
the toggles in this row that set listing.style.display (spell, Strange). A
listing stays hidden while ANY toggle still hides it: a spelled Strange
listing hidden by both must not come back when only one is switched off.
*/
export function setListingHiddenBy(listing, reason, hidden) {
  let reasons = hideReasonsByListing.get(listing);
  if (!reasons) {
    reasons = new Set();
    hideReasonsByListing.set(listing, reasons);
  }
  if (hidden) reasons.add(reason);
  else reasons.delete(reason);
  // "" (not a guessed value like "flex") hands display back to the page's
  // own stylesheet.
  listing.style.display = reasons.size > 0 ? "none" : "";
}

export function ensureClassifiedsControlsRow() {
  const existing = document.getElementById(ROW_ID);
  if (existing) return existing;

  const row = document.createElement("div");
  row.id = ROW_ID;
  row.style.display = "flex";
  row.style.flexWrap = "wrap";
  row.style.alignItems = "center";
  row.style.gap = "8px";
  row.style.padding = "0 0 8px 0";

  const nav = document.getElementById(NAV_ID);
  if (nav) {
    nav.insertAdjacentElement("afterend", row);
    return row;
  }

  // No Killstreak nav on this page - fall back to the same insertion point
  // ./addKSButtons/content.js's own createButtonsClassifieds uses, so the
  // row still ends up somewhere sensible.
  const panelBody = document.querySelector(".panel.panel-main .panel-body");
  const crumbs = panelBody?.querySelector("#search-crumbs");
  if (crumbs) {
    crumbs.insertAdjacentElement("afterend", row);
  } else if (panelBody) {
    panelBody.prepend(row);
  }

  return row;
}
