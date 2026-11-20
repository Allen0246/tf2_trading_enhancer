/*
@description: Adds a free-text "Filter these listings" search box to classic
backpack.tf's /classifieds pages, in the shared controls row underneath the
existing Killstreak-tier nav (#ks-tier-nav, see ../addKSButtons/content.js
and ../classifiedsControlsRow.js's own header note on why it's a separate
row now), alongside the spell-filter and Strange-filter toggles (see
../spellFilterToggle/content.js and ../strangeFilterToggle/content.js) -
typing into it hides every listing that doesn't match, live as the user
types. Matches against the listing's own
title (.listing-title h5, confirmed live against this exact page's markup -
see ../copyItemName/content.js's own header note) AND its Paint/Unusual
effect/Halloween Spell attributes (data-paint_name/data-effect_name/
data-spell_1/data-spell_2 on .listing-item .item - see below), so a search
like "Purple Energy" or "Team Spirit" finds matching listings even though
that specific text never appears in the visible title at all (case-
insensitive substring match against whichever of these is present).

Classic backpack.tf's own /classifieds search has no way to filter a generic
crafting-material item type (Strangifier, Strangifier Chemistry Set, Kit,
Fabricator) down to a SPECIFIC target item, nor to a specific Paint/Unusual
effect/Spell on a broader search - unlike next.backpack.tf's own dedicated
targetItem/particle/paint/spell query params (see
utils/tf2StatsLinks/index.js's own resolveClassifiedsFilters), a classic
"item=Chemistry Set" (or "item=Team Captain&quality=5") search just dumps
every listing together on one page with no server-side way to narrow it
further. This is deliberately general-purpose, not hardcoded to Chemistry
Sets/target-item tools specifically - it matches against whatever text is
actually typed, so it's equally useful for narrowing any classifieds search
result down further, by name OR by these attributes.

data-spell_1/data-spell_2 (and data-listing_comment, NOT used here - see
below) are confirmed live on THIS exact page's own .listing-item .item
markup by ../spellFilterToggle/content.js's own header note.
data-paint_name/data-effect_name are confirmed live on backpack.tf's
INVENTORY viewer's own item tiles instead (see
../inventoryGroupBy/content.js's own MODES note) - the same site-wide
item-rendering markup, so very likely identical here too, but not
independently confirmed on /classifieds specifically. Comment text
(data-listing_comment) is deliberately NOT included as a match target here,
unlike spellFilterToggle's own comment-keyword fallback - free-text comments
can mention all sorts of unrelated words, which would make this filter's own
matches noisy/surprising in a way the structured data-*_name/data-spell_*
attributes don't.

Same BUY-listing reliability caveat spellFilterToggle's own header note
documents for data-spell_1/data-spell_2 (a shared reference item's own
attributes, not necessarily reflecting that specific buyer's own want) likely
applies to data-paint_name/data-effect_name on a buy listing too, by the same
reasoning - not separately confirmed, but treated the same way here (matched
regardless of buy/sell, prioritizing "find everything relevant" over "only
ever match a sell listing's own real item").

Uses a CSS class + stylesheet rule (FILTERED_OUT_CLASS, "!important") rather
than directly setting listing.style.display the way
../spellFilterToggle/content.js's own toggle does - so the two compose
cleanly instead of fighting over the same inline style property: this
feature's own class rule always wins when a listing doesn't match the typed
search (regardless of the spell toggle's own inline style), and defers
entirely to whatever the spell toggle (or anything else) already set via
inline style once a listing DOES match (this feature's own class is simply
absent, so the cascade falls through to that inline style, or the page's own
default if neither applies).

No MutationObserver for new listings appearing later - same reasoning
spellFilterToggle's own header note documents: classic /classifieds is a
plain server-rendered page (confirmed live), not a Vue SPA with reactive
filter state, so every listing already exists in the DOM by the time this
runs; a fresh page load is the only way more ever appear.
*/

import { ensureClassifiedsControlsRow } from "../classifiedsControlsRow.js";

const LISTING_SELECTOR = "li.listing";
const TITLE_SELECTOR = ".listing-title h5";
const ITEM_SELECTOR = ".listing-item .item";
const INPUT_CLASS = "tf2te-classifieds-search-filter";
const FILTERED_OUT_CLASS = "tf2te-classifieds-search-filtered-out";
const STYLE_ID = "tf2te-classifieds-search-filter-styles";

// The .item attributes checked alongside the visible title - see this
// file's own header note on which are confirmed live where.
const ITEM_ATTRIBUTES = ["data-paint_name", "data-effect_name", "data-spell_1", "data-spell_2"];

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `.${FILTERED_OUT_CLASS} { display: none !important; }`;
  document.head.appendChild(style);
}

function readListingTitle(listing) {
  const title = listing.querySelector(TITLE_SELECTOR);
  return (title?.textContent || "").trim();
}

/*
@description: Everything this filter matches a typed query against for one
listing - the visible title plus its Paint/effect/Spell attributes (see this
file's own header note) - joined into one lowercase string so applyFilter can
run a single substring test rather than checking each field separately.
*/
function readListingSearchableText(listing) {
  const parts = [readListingTitle(listing)];

  const item = listing.querySelector(ITEM_SELECTOR);
  if (item) {
    ITEM_ATTRIBUTES.forEach((attr) => {
      const value = item.getAttribute(attr);
      if (value) parts.push(value);
    });
  }

  return parts.join(" ").toLowerCase();
}

function applyFilter(listings, rawQuery) {
  const query = rawQuery.trim().toLowerCase();
  listings.forEach((listing) => {
    const matches = !query || readListingSearchableText(listing).includes(query);
    listing.classList.toggle(FILTERED_OUT_CLASS, !matches);
  });
}

function buildInput(listings) {
  const input = document.createElement("input");
  input.type = "text";
  input.className = `form-control input-sm ${INPUT_CLASS}`;
  input.placeholder = "Filter by name, paint, effect, spell…";
  input.style.display = "inline-block";
  // Fixed width, not "auto" - confirmed live the placeholder text ("Filter
  // these listings by name…") was getting clipped at the old, too-narrow
  // 220px cap.
  input.style.width = "300px";
  input.style.maxWidth = "300px";

  input.addEventListener("input", () => applyFilter(listings, input.value));

  return input;
}

export function classifiedsSearchFilter() {
  if (document.querySelector(`.${INPUT_CLASS}`)) return; // already inserted

  const listings = Array.from(document.querySelectorAll(LISTING_SELECTOR));
  if (listings.length === 0) return; // nothing to filter - don't clutter the page with a no-op box

  injectStyles();
  const input = buildInput(listings);
  ensureClassifiedsControlsRow().appendChild(input);
}
