/*
@description: Groups next.backpack.tf's own BARE /effects list page (e.g.
https://next.backpack.tf/effects - the page that lists particle effects
themselves, not items) into always-visible "Hat effects" / "Taunt effects" /
"Weapon effects" sections, PLUS an "Unusual type" dropdown filter that narrows
the page down to just one section at a time - the next-UI equivalent of
../../oldUI/effectCategoryFilter/content.js's own button-row-plus-sections
combo, built to match this UI's own shape: section headers reuse this page's
own native "Page N (M)" divider component (confirmed live sample: `<div
class="inventory-divider mb-2 ms-1" style="display: block;"><div class="badge
inventory-divider__label">Page 1 (50)</div></div>` - observed as a styling
reference only, not literally present on this page today) instead of
approximating a bar from scratch, same "reuse the site's own real classes so
its real stylesheet supplies the background/padding/spacing" reasoning
../../oldUI/effectCategoryFilter/content.js's own header note documents for
reusing /unusuals' .page-number bars there. The dropdown itself sits in the
same filter row as "Priced Qualities"/"Classes"/"Slots"/"Sort by Avg. Value",
confirmed live, placed right after the "Search by name" input.

Category comes from the SAME utils/tf2Schema.js's own getEffectNameToCategoryMap
../../oldUI/effectCategoryFilter/content.js already uses (see its own header
note on categorizeEffectSystem's "unusual_"/"utaunt_"/"weapon_unusual_" prefix
logic) - requires a Steam Web API key to be configured. Without one, a
"needs a key" pill (../shared/filterKeyHint.js) sits in the dropdown's spot
instead of sections/a dropdown that can't actually categorize anything, same
as ../effectClassFilter/content.js.

An item tile here carries no category signal of its own either (confirmed
live: `<a ... href="/effects/Nebula" class="m-1 item item__quality-undefined-
0-dark ...">` - no data attribute, no visible text beyond the price label).
The only usable signal is the effect's own name, read off the tile's `href`'s
own last path segment (e.g. "/effects/Burning%20Flames" -> "Burning Flames"),
unlike ../effectClassFilter/content.js which reads a specific-effect page's
item name from an "item" query param instead - this page's tiles link to a
per-effect page by path segment, not query string.

An effect name the schema can't resolve (stale cache, brand-new effect) is
bucketed into its own "Other effects" section rather than guessed into one of
the three real categories or silently dropped from the page - same "other"
bucket ../../oldUI/effectCategoryFilter/content.js's own SECTIONS documents,
though unlike that version's own dropdown-equivalent (a button row with no
"Other" option), this file's dropdown also has no "Other" option - that
section is only ever reachable via "All".

NOTE: particle icons failing to load on this page (NS_ERROR_DOM_NETWORK_ERR)
are NOT caused by this file moving item tiles or toggling their classes -
confirmed live that the failures persist identically with every such
mutation removed, alongside failures this codebase cannot produce at all (a
malformed double-slash CDN url, a literal "/undefined" request), i.e. a
backpack.tf/CDN-side issue.

Explicitly REQUIRES the bare /effects list page (the opposite of
../effectClassFilter/content.js's own exclusion of it) - confirmed live that
page has no per-item class signal to filter by at all, but every item on it
IS a particle effect, which this feature needs.
*/

import { getEffectNameToCategoryMap, hasSchemaAccess } from "../../../utils/tf2Schema.js";
import { buildFilterKeyHint, removeFilterKeyHints } from "../shared/filterKeyHint.js";
import { copyScopedStyleAttrs } from "../shared/vueScopedStyle.js";

const ITEM_SELECTOR = 'a.item[class*="item__quality-"]';
const SEARCH_INPUT_SELECTOR = 'input[placeholder="Search by name"]';
// The page's own "Sort by Avg. Value" dropdown, confirmed live present on
// this same bare /effects page - used purely as a style reference (see
// buildDropdown's own note), not interacted with. Scoped to
// ".p-dropdown" (not just ".sort-dropdown", which also matches the
// "Priced Qualities"/"Classes"/"Slots" p-multiselect filters on this same
// page) so this always picks the single-select dropdown, not a multiselect.
const SORT_DROPDOWN_SELECTOR = ".sort-dropdown.p-dropdown";
const WRAPPER_ID = "tf2te-effect-category-filter-wrapper";
// The key button standing in for the dropdown while no key is saved
// (../shared/filterKeyHint.js).
const KEY_HINT_MARKER_CLASS = "tf2te-effect-category-filter-key-hint";
const KEY_HINT_TITLE = "The Unusual type filter needs a Steam Web API key to sort these effects into hats, taunts and weapons. Click to add one (one-time setup).";
const FILTERED_OUT_CLASS = "tf2te-effect-category-filtered-out";
const SECTION_ATTR = "data-tf2te-section";
// Section build order, each keyed the same as tf2Schema.js's own
// categorizeEffectSystem return values - "other" is this file's own bucket
// for an effect the schema couldn't resolve at all (see this file's own
// header note).
const SECTIONS = [
  { key: "hat", label: "Hat effects" },
  { key: "taunt", label: "Taunt effects" },
  { key: "weapon", label: "Weapon effects" },
  { key: "other", label: "Other effects" },
];
const CATEGORY_OPTIONS = ["All", "Hat", "Taunt", "Weapon"];
const CATEGORY_KEYS = { Hat: "hat", Taunt: "taunt", Weapon: "weapon" };
// Shown as the closed dropdown's own label ONLY before any option has ever
// been clicked - a description of what the dropdown is for, not a selectable
// value itself (so the "All" list option reads "All", not this text -
// observed that showing this same text as if it WERE the "All" option's own
// label read as a confusing duplicate/broken-looking entry). Matches the real
// "Priced Qualities"/"Classes"/"Slots" multiselects' own p-placeholder
// pattern on this same page: a description shown until a real selection is
// made, then replaced by that selection's own label - including selecting
// "All" explicitly, which is a real selection like any other and shows "All",
// not a reversion back to this text.
const PLACEHOLDER_TEXT = "Unusual type";
// Same PrimeVue Dropdown structure ../effectClassFilter/content.js's own
// header note documents (confirmed-live vs inferred split included) -
// reused verbatim since both dropdowns are built the same way against the
// same "Sort by Avg. Value" reference element.
const PANEL_CLASS = "p-dropdown-panel";
const ITEMS_WRAPPER_CLASS = "p-dropdown-items-wrapper";
const ITEMS_CLASS = "p-dropdown-items";
const ITEM_CLASS = "p-dropdown-item";
const HIGHLIGHT_CLASS = "p-highlight";
// This codebase's own class, not a PrimeVue one - toggled to drive the
// open/close transition declared in injectStyles (see its own note).
const OPEN_CLASS = "tf2te-dropdown-open";

function readEffectName(el) {
  const href = el.getAttribute("href");
  if (!href) return null;
  const segments = href.split("/").filter(Boolean);
  const last = segments[segments.length - 1];
  if (!last) return null;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

// Lowercased so lookups can match the page's own path-segment text loosely,
// same "backpack.tf's own effect text doesn't always match the schema's
// exact casing" reasoning tf2Schema.js's own getEffectId documents.
function buildLowercaseCategoryIndex(nameToCategory) {
  const index = {};
  Object.entries(nameToCategory).forEach(([name, category]) => {
    index[name.toLowerCase()] = category;
  });
  return index;
}

/*
@description: Reuses this page's own native "Page N (M)" divider component
(see this file's own header note on why) - a plain <div>, not the real one's
Vue-managed instance, since there's no page-jump behavior to give it here,
just a styled label with a count.
*/
function buildSectionHeader(key, label, count) {
  const bar = document.createElement("div");
  bar.className = "inventory-divider mb-2 ms-1";
  bar.style.display = "block";
  bar.setAttribute(SECTION_ATTR, key);

  const badge = document.createElement("div");
  badge.className = "badge inventory-divider__label";
  badge.textContent = `${label} (${count})`;

  bar.appendChild(badge);
  return bar;
}

/*
@description: Moves every item into its category's group, in SECTIONS order,
inserting a header bar before each non-empty group - appendChild on an
already-attached node relocates it (removing it from its current position),
so this reorders the real list in place rather than cloning anything. Returns
one {key, header, items} entry per non-empty section, for applySectionFilter
to toggle later without needing to re-query the DOM.
*/
function groupItemsIntoSections(list, items, lowercaseCategoryIndex) {
  const bySection = { hat: [], taunt: [], weapon: [], other: [] };
  items.forEach((item) => {
    const name = readEffectName(item);
    const category = name ? lowercaseCategoryIndex[name.toLowerCase()] : null;
    const key = category && SECTIONS.some((s) => s.key === category) ? category : "other";
    item.setAttribute(SECTION_ATTR, key);
    bySection[key].push(item);
  });

  const sectionEls = [];
  SECTIONS.forEach(({ key, label }) => {
    const group = bySection[key];
    if (group.length === 0) return; // no empty "Weapon effects" bar with nothing under it

    const header = buildSectionHeader(key, label, group.length);
    list.appendChild(header);
    group.forEach((item) => list.appendChild(item));
    sectionEls.push({ key, header, items: group });
  });
  return sectionEls;
}

function applySectionFilter(selected, sectionEls) {
  sectionEls.forEach(({ key, header, items }) => {
    const matches = selected === "All" || key === CATEGORY_KEYS[selected];
    header.classList.toggle(FILTERED_OUT_CLASS, !matches);
    items.forEach((item) => item.classList.toggle(FILTERED_OUT_CLASS, !matches));
  });
}

function injectStyles() {
  if (document.getElementById("tf2te-effect-category-filter-styles")) return;

  const style = document.createElement("style");
  style.id = "tf2te-effect-category-filter-styles";
  style.textContent = `
    .${FILTERED_OUT_CLASS} { display: none !important; }
    #${WRAPPER_ID} { cursor: pointer; }
    /* Opacity/transform + transition (not a display toggle) so the panel
       actually animates open/closed - confirmed live: PrimeVue's own real
       dropdown panels (Priced Qualities/Classes/Slots/Sort by Avg. Value)
       fade+scale in via their own .p-connected-overlay-enter-active
       transition, timing copied here (0.12s cubic-bezier(0,0,.2,1)) so this
       custom panel opens with the same feel instead of snapping open
       instantly. pointer-events: none while closed keeps it non-interactive
       (and unclickable through) despite never using display: none. */
    #${WRAPPER_ID} .${PANEL_CLASS} {
      position: absolute; top: 100%; left: 0; z-index: 1001; min-width: 100%;
      transform-origin: top;
      opacity: 0;
      transform: scaleY(0.8);
      pointer-events: none;
      transition: opacity 0.12s cubic-bezier(0, 0, 0.2, 1), transform 0.12s cubic-bezier(0, 0, 0.2, 1);
    }
    #${WRAPPER_ID} .${PANEL_CLASS}.${OPEN_CLASS} {
      opacity: 1;
      transform: scaleY(1);
      pointer-events: auto;
    }
    /* The divider sits inside the same flex-wrap
       row as the item tiles (each tile is "col-auto"-sized, not a block-level
       row of its own), so a bare display: block on the divider had no effect
       on the row's own wrapping - it just sat inline before the next tile
       instead of forcing a line break. flex-basis: 100% makes it consume
       the row's own full width, which forces every flex item after it onto
       a new line, matching how a genuine full-width row divider behaves. */
    /* The native "mb-2" Bootstrap utility class this
       file's own bar already carries only adds space BELOW it (~7px), and
       nothing above - the bar sat flush against the row of tiles before it.
       10px above / 2px below gives it breathing room on both sides instead of
       just below. !important since this same "margin on this site sometimes
       silently does nothing" caution bit this codebase repeatedly on classic
       backpack.tf's own page-number bars (see
       ../../oldUI/effectCategoryFilter/content.js's own header note) -
       cheap insurance against a repeat here, even though this rule's own
       higher specificity should already beat "mb-2" on its own. */
    [${SECTION_ATTR}].inventory-divider { flex: 0 0 100%; width: 100%; margin-top: 10px !important; margin-bottom: 2px !important; }
    /* The real .inventory-divider__label's own pill styling is Vue-scoped
       (compiles to ".inventory-divider__label[data-v-XXXXXXXX]"), and this
       specific divider component isn't rendered anywhere on the /effects
       page itself to clone that hashed attribute from the way buildDropdown
       clones one off the real "Sort by Avg. Value" element on the SAME page
       - a hardcoded hash would silently stop matching on any future
       backpack.tf deploy that touches that one component. Values below are
       copied from the Computed panel of a real instance (a "Page 1 (50)"
       divider elsewhere on the site) rather than the scoped rule itself, so
       this stays correct regardless of the hash. The plain Bootstrap
       ".badge" class this file's own badge already carries supplies
       box-sizing/text-align on its own; only the properties that
       class alone does NOT provide are set here.  */
    [${SECTION_ATTR}] .inventory-divider__label {
      background-color: rgb(39, 50, 65);
      border-radius: 3.5px;
      color: rgb(243, 244, 246);
      display: inline-block;
      font-family: Roboto, sans-serif;
      font-size: 11.2px;
      font-weight: 700;
      line-height: 11.2px;
      padding: 3.92px 7.28px;
      text-shadow: rgb(0, 0, 0) 0 0 2px, rgb(0, 0, 0) 0 0 2px;
      white-space: nowrap;
    }
  `;
  document.head.appendChild(style);
}

// copyScopedStyleAttrs (imported above) - same confirmed-live reasoning
// ../shared/vueScopedStyle.js documents (Vue scoped CSS compiles rules to
// ".foo[data-v-XXXXXXXX]", not just ".foo" alone).

/*
@description: Builds the dropdown the same way ../effectClassFilter/content.js's
own buildDropdown does - cloning the real "Sort by Avg. Value" dropdown's own
classes/scoped-style attributes onto a wrapper, with a fully custom
click-toggled panel built from PrimeVue's own item classes. Selecting an
option toggles whole sections (header + items) via applySectionFilter, rather
than re-deriving each item's category on every click - that was already
resolved once, in groupItemsIntoSections.
*/
function buildDropdown(sectionEls, referenceDropdown) {
  const wrapper = document.createElement("div");
  wrapper.id = WRAPPER_ID;
  wrapper.className = referenceDropdown.className.replace(/\bsort-dropdown\b/, "tf2te-effect-category-filter").trim();
  wrapper.classList.add("me-3");
  wrapper.style.position = "relative";
  copyScopedStyleAttrs(referenceDropdown, wrapper);

  const label = document.createElement("span");
  // p-placeholder matches the real "Priced Qualities"/"Classes"/"Slots"
  // multiselects' own placeholder-state class - removed the moment any
  // option is actually clicked (see the click handler below), same as the
  // real ones no longer showing their own placeholder text once something's
  // selected.
  label.className = "p-dropdown-label p-inputtext p-placeholder";
  label.textContent = PLACEHOLDER_TEXT;

  const triggerIcon = document.createElement("span");
  triggerIcon.className = "p-dropdown-trigger-icon pi pi-chevron-down";
  const trigger = document.createElement("div");
  trigger.className = "p-dropdown-trigger";
  trigger.appendChild(triggerIcon);

  const panel = document.createElement("div");
  panel.className = `${PANEL_CLASS} p-component`;

  const itemsWrapper = document.createElement("div");
  itemsWrapper.className = ITEMS_WRAPPER_CLASS;

  const list = document.createElement("ul");
  list.className = `${ITEMS_CLASS} p-component`;
  list.setAttribute("role", "listbox");

  const optionEls = {};
  let selected = "All";

  function setHighlight() {
    Object.entries(optionEls).forEach(([opt, li]) => {
      const isSelected = opt === selected;
      li.classList.toggle(HIGHLIGHT_CLASS, isSelected);
      li.setAttribute("aria-selected", String(isSelected));
    });
  }

  function closePanel() {
    panel.classList.remove(OPEN_CLASS);
  }

  CATEGORY_OPTIONS.forEach((option) => {
    const li = document.createElement("li");
    li.className = ITEM_CLASS;
    li.setAttribute("role", "option");
    li.setAttribute("aria-label", option);
    li.textContent = option;
    li.addEventListener("click", () => {
      selected = option;
      label.textContent = option;
      label.classList.remove("p-placeholder");
      setHighlight();
      closePanel();
      applySectionFilter(option, sectionEls);
    });
    optionEls[option] = li;
    list.appendChild(li);
  });
  setHighlight();

  itemsWrapper.appendChild(list);
  panel.appendChild(itemsWrapper);

  wrapper.addEventListener("click", (event) => {
    if (panel.contains(event.target)) return;
    panel.classList.toggle(OPEN_CLASS);
  });

  document.addEventListener("click", (event) => {
    if (!wrapper.contains(event.target)) closePanel();
  });

  wrapper.appendChild(label);
  wrapper.appendChild(trigger);
  wrapper.appendChild(panel);
  return wrapper;
}

let inserting = false;

// Exact segment match, not a bare .includes("effects") substring check -
// same reasoning ../effectClassFilter/content.js's own isSupportedPage
// documents (that file's check EXCLUDES this page; this file REQUIRES it).
function isBareEffectsListPage() {
  const segments = window.location.pathname.split("/").filter(Boolean);
  return segments.length === 1 && segments[0] === "effects";
}

async function tryInsert() {
  if (inserting || document.getElementById(WRAPPER_ID)) return;
  if (!isBareEffectsListPage()) return;

  const items = Array.from(document.querySelectorAll(ITEM_SELECTOR));
  if (items.length === 0) return;

  const searchInput = document.querySelector(SEARCH_INPUT_SELECTOR);
  if (!searchInput) return;

  const referenceDropdown = document.querySelector(SORT_DROPDOWN_SELECTOR);
  if (!referenceDropdown) return; // no style reference to clone from - don't guess at styling from scratch

  inserting = true;
  try {
    // No key: show the key button in the dropdown's spot instead.
    if (!(await hasSchemaAccess())) {
      if (!document.querySelector(`.${KEY_HINT_MARKER_CLASS}`)) {
        const hint = buildFilterKeyHint({
          className: `${referenceDropdown.className.replace(/\bsort-dropdown\b/, "").trim()} me-3`,
          scopedAttrsSource: referenceDropdown,
          markerClass: KEY_HINT_MARKER_CLASS,
          label: PLACEHOLDER_TEXT,
          title: KEY_HINT_TITLE,
        });
        searchInput.insertAdjacentElement("afterend", hint);
      }
      return;
    }
    if (document.getElementById(WRAPPER_ID)) return; // a concurrent call already inserted it

    const categoryMap = await getEffectNameToCategoryMap();
    const lowercaseCategoryIndex = buildLowercaseCategoryIndex(categoryMap);

    // The container every item tile already lives in - reordering happens
    // in place inside it, rather than building a separate container, so the
    // page's own grid CSS keeps applying exactly as it already does.
    const list = items[0].parentElement;
    const sectionEls = groupItemsIntoSections(list, items, lowercaseCategoryIndex);

    injectStyles();
    removeFilterKeyHints(document, KEY_HINT_MARKER_CLASS);
    // Right after the search input.
    searchInput.insertAdjacentElement("afterend", buildDropdown(sectionEls, referenceDropdown));
  } finally {
    inserting = false;
  }
}

export function effectCategoryFilter() {
  tryInsert();

  // Item tiles and the filter row itself render/re-render client-side
  // (search results, sort changes) - a MutationObserver is the only way to
  // keep re-attaching this if a re-render replaces the row this was
  // inserted into. tryInsert's own WRAPPER_ID guard makes repeated calls
  // safe/idempotent.
  const observer = new MutationObserver(() => tryInsert());
  observer.observe(document.body, { childList: true, subtree: true });

  // Re-attempts the instant a Steam API key is saved/changed in the
  // extension popup - without this, a page already open when no key was
  // configured stayed without these sections/dropdown forever
  // (hasSchemaAccess() failing once inside tryInsert is never retried on its
  // own; only new DOM mutations re-trigger tryInsert, and saving a key
  // causes none here), requiring a manual reload to pick it up. Same
  // pattern already established for other Steam-API-key-gated features
  // (e.g. scrap.tf/itemLinks/content.js's own chrome.storage.onChanged
  // listener).
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes.steamApiKey) return tryInsert();
  });
}
