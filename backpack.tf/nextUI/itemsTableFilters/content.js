/*
@description: Adds Class and Priced-Quality filter dropdowns to
next.backpack.tf's /items catalog table (list view), inserted right after
its own real "Search by name" column filter's own filter-menu/clear buttons
(confirmed live via pasted markup: a ".p-column-filter" group holding the
search input, a filter-menu button, and a filter-clear button), placed as
the next siblings of that clear button.

This page mutates constantly (each row's own hover tooltip, a popper.js
instance per row, mounts/unmounts on hover), which a naive observer turns
into a page freeze. Four rules keep it stable:

1. NEVER write an already-correct value. A textContent write is ITSELF a
childList mutation, so refreshing the per-option counts on every mutation
re-triggered the very MutationObserver that scheduled it, forever.
buildMultiselect's own updateCounts only writes when the value changed.
2. Don't re-check hasSchemaAccess() on every tick. With no Steam Web API key,
retrying on every mutation flooded chrome.storage.local.get() badly enough to
stall the ENTIRE extension's messaging channel (the popup's Save/Check
buttons included). classFilterUnavailable is checked once and only re-checked
when the popup reports a key change.
3. Portal the panel to document.body. Nested under the wrapper, it renders
clipped - this table's own ".p-datatable-wrapper" scrolls (confirmed live:
"p-datatable-responsive-scroll") and clips any absolutely-positioned
descendant. Positioned instead with JS-computed position:fixed coordinates.
4. Debounce the row-rescan. scheduleRefresh coalesces a burst of mutations
into at most one refreshRowsAndCounts pass per 200ms. Complementary to rule 1,
not a substitute for it.

Quality filtering needs no schema/API lookup at all - each row's own "Priced
Qualities" column already lists its priced quality names as plain text
(confirmed live: colored <strong> tags inside a ".quality-list" div), read
directly rather than resolved. "At least one" OR semantics across checked
qualities matches the site's own real explanation for this exact concept
(confirmed live: the column's own header tooltip literally reads "you can
use the Priced Qualities filter to find items that have at least one item
priced for a certain quality" - that native filter only exists in GRID view,
not this list view, which is why this file adds an equivalent here).

Class filtering reuses the same schema-lookup approach
backpack.tf/nextUI/effectClassFilter/content.js already established (item
name -> utils/tf2Schema.js's own getItemClasses) - only the item-name
extraction differs: this page's own item links are "/items/<name>" URL PATH
segments (confirmed live via pasted markup), not a "?item=" query param, so
it needs its own readItemNameFromPath.

KNOWN LIMITATION, reported and accepted rather than solved here: this table
is genuinely paginated (confirmed live: exactly 10 <tr> rows exist in the
DOM at a time by default, "Showing 1 to 10 of 2708") - both filters only
ever affect whichever page's rows are currently rendered, not the full
catalog at once. Switching to a larger "rows per page" (the paginator
dropdown at the bottom) reduces how many page-clicks that takes but doesn't
eliminate it; a true single-pass full-catalog filter would need whatever
real API backs this table's own search (not yet reverse-engineered).

Not attempted: a pinned/sticky filter header. CSS position:sticky never
works nested inside this table (confirmed live with a control test), and a
JS position:fixed portal of the real header broke the site's own column
sorting, since it moved Vue-owned interactive elements out of Vue's DOM tree.
*/

import { getItemClasses, hasSchemaAccess } from "../../../utils/tf2Schema.js";
import { buildFilterKeyHint, removeFilterKeyHints } from "../shared/filterKeyHint.js";
import { copyScopedStyleAttrs } from "../shared/vueScopedStyle.js";

// The key button standing in for the Class dropdown while no key is saved
// (../shared/filterKeyHint.js).
const CLASS_KEY_HINT_MARKER_CLASS = "tf2te-items-class-filter-key-hint";
const CLASS_KEY_HINT_TITLE = "The class filter needs a Steam Web API key to look up which class each item is for. Click to add one (one-time setup).";

const ROW_SELECTOR = 'tbody.p-datatable-tbody > tr[role="row"]';
// First <td>'s own item link - confirmed live: "/items/Pencil%20Pusher".
const ITEM_LINK_SELECTOR = 'td:first-child a[href^="/items/"]';
// Third <td> (Item, Average Value, Priced Qualities, # Priced, in that
// confirmed-live column order) - each priced quality is its own <strong>.
const QUALITY_STRONG_SELECTOR = "td:nth-child(3) .quality-list strong";
const SEARCH_INPUT_SELECTOR = "input.p-column-filter";
const CLEAR_BUTTON_SELECTOR = ".p-column-filter-clear-button";
const FILTERED_OUT_CLASS = "tf2te-items-filtered-out";
// The wrapper "pill" itself (label + chevron).
const FILTER_DROPDOWN_CLASS = "tf2te-items-filter-dropdown";
// The OPEN panel's own direct class - portaled to document.body rather
// than nested under the wrapper (see this file's own header note), so its
// own checkbox/row/text styling has to be scoped off this instead of
// FILTER_DROPDOWN_CLASS.
const PANEL_MARKER_CLASS = "tf2te-items-filter-panel";
const CLASS_WRAPPER_CLASS = "tf2te-items-class-filter-wrapper";
const QUALITY_WRAPPER_CLASS = "tf2te-items-quality-filter-wrapper";

const SPECIFIC_CLASSES = ["Scout", "Soldier", "Pyro", "Demoman", "Heavy", "Engineer", "Medic", "Sniper", "Spy"];
const CLASS_OPTIONS = [...SPECIFIC_CLASSES, "Multi", "All"];
const CLASS_LABELS = { Multi: "Multi-Class", All: "All-Class" };
// "fak fa-tf2-<suffix>" - same confirmed-live icon font
// effectClassFilter/content.js already uses for these.
const CLASS_ICON_SUFFIX = {
  Scout: "scout",
  Soldier: "soldier",
  Pyro: "pyro",
  Demoman: "demoman",
  Heavy: "heavy",
  Engineer: "engineer",
  Medic: "medic",
  Sniper: "sniper",
  Spy: "spy",
  Multi: "multi",
  All: "logo",
};

// Every quality utils/tf2Quality.js knows about, as filter options - a user
// may want to filter by a quality this specific page of 10 doesn't happen
// to show right now, so the option list isn't limited to what's currently
// visible. Only these 5 colors are confirmed live (off this exact table's
// own "Priced Qualities" column, pasted markup) - deliberately NOT reusing
// utils/tf2Quality.js's own QUALITY_COLOR_BY_NAME table, which holds Steam's
// inventory colors and differs from this table (e.g. Collector's #aa0000
// there vs #830000 here, and no Unique color at all) - the rest render in the
// default text color rather than guessed at.
const QUALITY_OPTIONS = ["Collector's", "Strange", "Unusual", "Unique", "Genuine", "Vintage", "Haunted", "Self Made", "Normal"];
const QUALITY_COLOR = {
  "Collector's": "#830000",
  Strange: "#cf6a32",
  Unusual: "#8650ac",
  Unique: "#ffd700",
  Genuine: "#4d7455",
};

const PANEL_CLASS = "p-multiselect-panel";
const ITEMS_WRAPPER_CLASS = "p-multiselect-items-wrapper";
const ITEMS_CLASS = "p-multiselect-items";
const ITEM_CLASS = "p-multiselect-item";
const CHECKBOX_HIGHLIGHT_CLASS = "p-highlight";
const OPEN_CLASS = "tf2te-dropdown-open";

// itemName -> Promise<string[]> - same reasoning as
// effectClassFilter/content.js's own classCache.
const classCache = new Map();

function getClassesCached(itemName) {
  if (!classCache.has(itemName)) {
    classCache.set(itemName, getItemClasses(itemName));
  }
  return classCache.get(itemName);
}

export function __resetClassCacheForTests() {
  classCache.clear();
}

// Decodes the item name off "/items/<name>" - NOT the same shape
// effectClassFilter/content.js's own readItemName reads ("?item="), so this
// can't reuse that one.
function readItemNameFromPath(href) {
  try {
    const pathname = new URL(href, window.location.origin).pathname;
    const segments = pathname.split("/").filter(Boolean);
    const last = segments[segments.length - 1];
    return last ? decodeURIComponent(last) : null;
  } catch {
    return null;
  }
}

function classifyItem(classes) {
  if (classes.length === 0) return "All";
  if (classes.length > 1) return "Multi";
  return classes[0];
}

function readRowQualities(row) {
  return Array.from(row.querySelectorAll(QUALITY_STRONG_SELECTOR)).map((el) => el.textContent.trim());
}

function currentRows() {
  return Array.from(document.querySelectorAll(ROW_SELECTOR));
}

function countByKey(keys, resolvedList, matchesKey) {
  const counts = Object.fromEntries(keys.map((k) => [k, 0]));
  resolvedList.forEach((entry) => {
    keys.forEach((k) => {
      if (matchesKey(entry, k)) counts[k]++;
    });
  });
  return counts;
}

const selectedClasses = new Set();
const selectedQualities = new Set();

export function __resetSelectionsForTests() {
  selectedClasses.clear();
  selectedQualities.clear();
}

function rowMatchesQualities(qualities) {
  if (selectedQualities.size === 0) return true;
  return qualities.some((q) => selectedQualities.has(q));
}

function rowMatchesClasses(bucket) {
  if (selectedClasses.size === 0) return true;
  return bucket != null && selectedClasses.has(bucket);
}

// Set once each dropdown is built (see buildMultiselect's own return value)
// - lets refreshRowsAndCounts push freshly-computed counts back into an
// already-open dropdown's own option list.
let updateQualityCounts = null;
let updateClassCounts = null;

// Test-only: same reasoning as __resetClassCacheForTests/
// __resetSelectionsForTests - a real page never rebuilds these mid-lifetime
// (each dropdown is only ever built once), but separate test cases in this
// file share the module instance, and a stale updateClassCounts closure
// left over from an EARLIER test that built one makes needsClasses (in
// refreshRowsAndCounts) wrongly evaluate true in a LATER test that never
// built its own - triggering unwanted schema resolution and extra
// chrome.storage.local.get calls that have nothing to do with that test.
export function __resetDropdownRefsForTests() {
  updateQualityCounts = null;
  updateClassCounts = null;
}

// Re-resolves against whichever rows are CURRENTLY rendered and (a) applies
// whichever filters are active, and (b) refreshes each dropdown's own
// displayed per-option counts - both need the same per-row
// qualities/class resolution, so this does both in one pass. A page change
// (pagination/search/a larger page size) replaces the <tr> rows entirely,
// so a filter selection or a stale count would otherwise silently stay
// wrong on rows this never re-saw.
//
// The count-refresh side is what can freeze the page (see this file's own
// header note, rules 1 and 4): updateCounts (in buildMultiselect) only ever writes textContent when the
// value actually changed (a same-value write is STILL a childList mutation
// otherwise, re-triggering the very observer that scheduled this), and the
// call site (scheduleRefresh) still debounces bursts into one pass. Neither
// alone is a complete fix on its own - the compare-before-write guard stops
// the loop from being infinite, but without the debounce a genuinely
// changing row set could still fire this far more often than needed.
async function refreshRowsAndCounts() {
  const rows = currentRows();
  // Needed for COUNTS whenever the Class dropdown exists at all, not just
  // when a class filter is actively selected - the counts have to stay
  // accurate either way.
  const needsClasses = selectedClasses.size > 0 || updateClassCounts != null;

  const resolved = await Promise.all(
    rows.map(async (row) => {
      const qualities = readRowQualities(row);
      let bucket = null;
      if (needsClasses) {
        const link = row.querySelector(ITEM_LINK_SELECTOR);
        const name = link ? readItemNameFromPath(link.getAttribute("href")) : null;
        const classes = name ? await getClassesCached(name) : [];
        bucket = classifyItem(classes);
      }
      return { row, qualities, bucket };
    })
  );

  updateQualityCounts?.(countByKey(QUALITY_OPTIONS, resolved, (entry, key) => entry.qualities.includes(key)));
  if (needsClasses) updateClassCounts?.(countByKey(CLASS_OPTIONS, resolved, (entry, key) => entry.bucket === key));

  if (selectedClasses.size === 0 && selectedQualities.size === 0) {
    resolved.forEach(({ row }) => row.classList.remove(FILTERED_OUT_CLASS));
    return;
  }
  resolved.forEach(({ row, qualities, bucket }) => {
    const matches = rowMatchesQualities(qualities) && rowMatchesClasses(bucket);
    row.classList.toggle(FILTERED_OUT_CLASS, !matches);
  });
}

function injectStyles() {
  if (document.getElementById("tf2te-items-filter-styles")) return;

  const style = document.createElement("style");
  style.id = "tf2te-items-filter-styles";
  style.textContent = `
    .${FILTERED_OUT_CLASS} { display: none !important; }
    .${FILTER_DROPDOWN_CLASS} { cursor: pointer; min-width: 140px; position: relative; display: inline-block; }
    .${FILTER_DROPDOWN_CLASS} .p-multiselect-label { white-space: nowrap; padding-left: 0.75rem; }
    .${PANEL_MARKER_CLASS} {
      position: fixed; z-index: 2001;
      transform-origin: top;
      opacity: 0;
      transform: scaleY(0.8);
      pointer-events: none;
      transition: opacity 0.12s cubic-bezier(0, 0, 0.2, 1), transform 0.12s cubic-bezier(0, 0, 0.2, 1);
    }
    .${PANEL_MARKER_CLASS}.${OPEN_CLASS} {
      opacity: 1;
      transform: scaleY(1);
      pointer-events: auto;
    }
    /* Same confirmed-live colors effectClassFilter/content.js's own
       styles use - see that file's own header note on how these were
       pinned down (--accent-primary/--accent-inverse/
       --component-text-secondary), site-wide variables, not page-specific
       ones, so they apply here unchanged. */
    .${PANEL_MARKER_CLASS} .p-checkbox-box.${CHECKBOX_HIGHLIGHT_CLASS} {
      background: var(--accent-primary, #6c8ba1);
      border-color: var(--accent-inverse, #151515);
    }
    .${PANEL_MARKER_CLASS} .p-checkbox-icon.${CHECKBOX_HIGHLIGHT_CLASS}::before {
      content: "\\2713";
      color: var(--accent-inverse, #151515);
      font-size: 11px;
      line-height: 1;
    }
    .${PANEL_MARKER_CLASS} .${ITEM_CLASS}.${CHECKBOX_HIGHLIGHT_CLASS} {
      background: var(--accent-primary, #6c8ba1);
      color: var(--accent-inverse, #151515);
    }
    .${PANEL_MARKER_CLASS} .p-text-secondary {
      color: var(--component-text-secondary, hsla(0, 0%, 100%, 0.6));
    }
    .${PANEL_MARKER_CLASS} .${ITEM_CLASS} {
      display: flex;
      align-items: center;
    }
  `;
  document.head.appendChild(style);
}

function buildCheckboxEl(checked, scopedAttrsSource) {
  const box = document.createElement("div");
  box.className = "p-checkbox-box";
  box.classList.toggle(CHECKBOX_HIGHLIGHT_CLASS, checked);
  copyScopedStyleAttrs(scopedAttrsSource, box);

  const icon = document.createElement("span");
  icon.className = "p-checkbox-icon";
  icon.classList.toggle(CHECKBOX_HIGHLIGHT_CLASS, checked);
  copyScopedStyleAttrs(scopedAttrsSource, icon);
  box.appendChild(icon);

  const checkbox = document.createElement("div");
  checkbox.className = "p-checkbox p-component";
  copyScopedStyleAttrs(scopedAttrsSource, checkbox);
  checkbox.appendChild(box);
  return { checkbox, box, icon };
}

/*
@description: Builds one checkbox-multiselect dropdown - shared shape for
both the Class and Quality filters here (see effectClassFilter/content.js's
own buildDropdown for where this was adapted from, including the confirmed
-live checked/highlight colors). No real dropdown element exists on THIS
page to clone base classes from (no ".sort-dropdown" here - sorting is done
via clickable column headers instead), so the wrapper's own PrimeVue classes
are the confirmed-live literal list from the real Classes multiselect
elsewhere on the site instead of a cloned className string. The
scoped-style attribute still has to come from a real element on this page
though (confirmed live: the "Search by name" input itself carries
data-v-7332f3c4), copied onto every element built here the same way
effectClassFilter/content.js's own buildDropdown does (Vue stamps that
attribute onto every element a scoped component renders, not just one
root). Counts start from the rows present at build time and are kept
current by the returned updateCounts (see refreshRowsAndCounts).
*/
function buildMultiselect({ wrapperClass, options, labelFor, colorFor, iconSuffixFor, counts, placeholder, scopedAttrsSource, selected, onChange }) {
  const wrapper = document.createElement("div");
  // "p-multiselect p-component p-inputwrapper p-inputwrapper-filled" -
  // confirmed live off the real Classes filter's own war-paints/paints
  // markup (see effectClassFilter/content.js's own header note on that
  // paste).
  wrapper.className = "p-multiselect p-component p-inputwrapper p-inputwrapper-filled me-2";
  wrapper.classList.add(FILTER_DROPDOWN_CLASS, wrapperClass);
  copyScopedStyleAttrs(scopedAttrsSource, wrapper);

  const labelContainer = document.createElement("div");
  labelContainer.className = "p-multiselect-label-container";
  copyScopedStyleAttrs(scopedAttrsSource, labelContainer);
  const label = document.createElement("div");
  label.className = "p-multiselect-label p-placeholder";
  label.textContent = placeholder;
  copyScopedStyleAttrs(scopedAttrsSource, label);
  labelContainer.appendChild(label);

  const triggerIcon = document.createElement("span");
  triggerIcon.className = "p-multiselect-trigger-icon pi pi-chevron-down";
  copyScopedStyleAttrs(scopedAttrsSource, triggerIcon);
  const trigger = document.createElement("div");
  trigger.className = "p-multiselect-trigger";
  copyScopedStyleAttrs(scopedAttrsSource, trigger);
  trigger.appendChild(triggerIcon);

  const panel = document.createElement("div");
  panel.className = `${PANEL_CLASS} p-component`;
  // wrapperClass here too (not just PANEL_MARKER_CLASS) - harmless for
  // styling, identifies which dropdown a portaled panel belongs to.
  panel.classList.add(PANEL_MARKER_CLASS, wrapperClass);
  copyScopedStyleAttrs(scopedAttrsSource, panel);

  const header = document.createElement("div");
  header.className = "p-multiselect-header";
  copyScopedStyleAttrs(scopedAttrsSource, header);
  const { checkbox: selectAllCheckbox, box: selectAllBox, icon: selectAllIcon } = buildCheckboxEl(false, scopedAttrsSource);
  header.appendChild(selectAllCheckbox);

  const closeIcon = document.createElement("span");
  closeIcon.className = "p-multiselect-close-icon pi pi-times";
  copyScopedStyleAttrs(scopedAttrsSource, closeIcon);
  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "p-multiselect-close p-link";
  copyScopedStyleAttrs(scopedAttrsSource, closeButton);
  closeButton.appendChild(closeIcon);
  header.appendChild(closeButton);

  const itemsWrapper = document.createElement("div");
  itemsWrapper.className = ITEMS_WRAPPER_CLASS;
  copyScopedStyleAttrs(scopedAttrsSource, itemsWrapper);

  const list = document.createElement("ul");
  list.className = `${ITEMS_CLASS} p-component`;
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-multiselectable", "true");
  copyScopedStyleAttrs(scopedAttrsSource, list);

  const optionBoxes = {};
  const optionIcons = {};
  const optionRows = {};
  const optionCounts = {};

  // Re-run on every scroll/resize while open, not just at open time: a
  // position:fixed panel tracks the viewport, not the wrapper, so it would
  // otherwise stay put while the wrapper scrolls away underneath it.
  function positionPanel() {
    const rect = wrapper.getBoundingClientRect();
    panel.style.top = `${rect.bottom}px`;
    panel.style.left = `${rect.left}px`;
    panel.style.minWidth = `${rect.width}px`;
  }

  let repositionScheduled = false;
  function onScrollOrResize() {
    if (repositionScheduled) return;
    repositionScheduled = true;
    requestAnimationFrame(() => {
      repositionScheduled = false;
      positionPanel();
    });
  }

  function openPanel() {
    positionPanel();
    panel.classList.add(OPEN_CLASS);
    // capture: true - the actual scrolling may happen on an ancestor
    // scroll container (confirmed live: this table's own
    // ".p-datatable-wrapper" scrolls internally), not necessarily the
    // window itself, and "scroll" doesn't bubble - capture is what catches
    // it regardless of which ancestor is the one actually scrolling.
    window.addEventListener("scroll", onScrollOrResize, { passive: true, capture: true });
    window.addEventListener("resize", onScrollOrResize, { passive: true });
  }

  function closePanel() {
    panel.classList.remove(OPEN_CLASS);
    window.removeEventListener("scroll", onScrollOrResize, { capture: true });
    window.removeEventListener("resize", onScrollOrResize);
  }

  function updateLabel() {
    if (selected.size === 0) {
      label.textContent = placeholder;
      label.classList.add("p-placeholder");
    } else if (selected.size <= 2) {
      label.textContent = [...selected].map((k) => labelFor(k)).join(", ");
      label.classList.remove("p-placeholder");
    } else {
      label.textContent = `${selected.size} selected`;
      label.classList.remove("p-placeholder");
    }
  }

  function updateSelectAllCheckbox() {
    const allSelected = selected.size === options.length;
    selectAllBox.classList.toggle(CHECKBOX_HIGHLIGHT_CLASS, allSelected);
    selectAllIcon.classList.toggle(CHECKBOX_HIGHLIGHT_CLASS, allSelected);
  }

  function toggleOption(key) {
    if (selected.has(key)) selected.delete(key);
    else selected.add(key);

    const isSelected = selected.has(key);
    optionBoxes[key].classList.toggle(CHECKBOX_HIGHLIGHT_CLASS, isSelected);
    optionIcons[key].classList.toggle(CHECKBOX_HIGHLIGHT_CLASS, isSelected);
    optionRows[key].classList.toggle(CHECKBOX_HIGHLIGHT_CLASS, isSelected);

    updateSelectAllCheckbox();
    updateLabel();
    onChange();
  }

  options.forEach((key) => {
    const li = document.createElement("li");
    li.className = ITEM_CLASS;
    li.setAttribute("role", "option");
    const optionLabel = labelFor(key);
    li.setAttribute("aria-label", optionLabel);
    copyScopedStyleAttrs(scopedAttrsSource, li);
    optionRows[key] = li;

    const { checkbox, box, icon } = buildCheckboxEl(selected.has(key), scopedAttrsSource);
    optionBoxes[key] = box;
    optionIcons[key] = icon;
    li.appendChild(checkbox);

    if (iconSuffixFor) {
      const optionIcon = document.createElement("i");
      optionIcon.className = `me-1 fak fa-tf2-${iconSuffixFor(key)} attribute__null`;
      copyScopedStyleAttrs(scopedAttrsSource, optionIcon);
      li.appendChild(optionIcon);
    }

    const nameSpan = document.createElement("span");
    if (colorFor?.(key)) nameSpan.style.color = colorFor(key);
    nameSpan.textContent = optionLabel;
    copyScopedStyleAttrs(scopedAttrsSource, nameSpan);
    li.appendChild(nameSpan);

    li.appendChild(document.createTextNode(" ("));
    const countEl = document.createElement("span");
    countEl.className = "p-text-secondary";
    countEl.textContent = String(counts[key] || 0);
    copyScopedStyleAttrs(scopedAttrsSource, countEl);
    optionCounts[key] = countEl;
    li.appendChild(countEl);
    li.appendChild(document.createTextNode(")"));

    li.addEventListener("click", () => toggleOption(key));
    list.appendChild(li);
  });
  updateSelectAllCheckbox();
  updateLabel();

  selectAllCheckbox.addEventListener("click", () => {
    const shouldSelectAll = selected.size !== options.length;
    selected.clear();
    if (shouldSelectAll) options.forEach((key) => selected.add(key));

    options.forEach((key) => {
      optionBoxes[key].classList.toggle(CHECKBOX_HIGHLIGHT_CLASS, shouldSelectAll);
      optionIcons[key].classList.toggle(CHECKBOX_HIGHLIGHT_CLASS, shouldSelectAll);
      optionRows[key].classList.toggle(CHECKBOX_HIGHLIGHT_CLASS, shouldSelectAll);
    });
    updateSelectAllCheckbox();
    updateLabel();
    onChange();
  });

  closeButton.addEventListener("click", (event) => {
    event.stopPropagation();
    closePanel();
  });

  itemsWrapper.appendChild(list);
  panel.appendChild(header);
  panel.appendChild(itemsWrapper);

  // Portaled to document.body instead of nested under the wrapper (see
  // this file's own header note on the table's own scrollable wrapper
  // clipping it otherwise) - positioned with JS-computed position:fixed
  // coordinates, recalculated on open AND on every scroll/resize while open
  // (see positionPanel/openPanel above). panel.contains()/wrapper.contains()
  // below both still work correctly regardless of where panel physically
  // lives in the tree - contains() only cares about ancestry, not DOM
  // position.
  document.body.appendChild(panel);

  wrapper.addEventListener("click", (event) => {
    if (panel.contains(event.target)) return;
    if (panel.classList.contains(OPEN_CLASS)) closePanel();
    else openPanel();
  });
  document.addEventListener("click", (event) => {
    if (!wrapper.contains(event.target) && !panel.contains(event.target)) closePanel();
  });

  wrapper.appendChild(labelContainer);
  wrapper.appendChild(trigger);

  // Pushes freshly-computed counts back into the already-built option rows
  // - called from refreshRowsAndCounts whenever the underlying row set
  // changes (a page-size bump, pagination, a search), not just at build
  // time.
  //
  // CRITICAL: only writes textContent when the value actually changed - see
  // this file's own header note (rule 1) on why an unconditional write here
  // freezes the page.
  function updateCounts(newCounts) {
    options.forEach((key) => {
      const next = String(newCounts[key] || 0);
      if (optionCounts[key].textContent !== next) optionCounts[key].textContent = next;
    });
  }

  return { wrapper, updateCounts };
}

let insertingQuality = false;
let insertingClass = false;
// Set once hasSchemaAccess() comes back false, to stop tryInsertClassFilter
// re-checking it on every single MutationObserver tick - see this file's
// own header note (rule 2) on why that matters here specifically. Reset
// only when the popup actually reports a key change.
let classFilterUnavailable = false;

export function __resetClassFilterAvailabilityForTests() {
  classFilterUnavailable = false;
}

function isSupportedPage() {
  return window.location.pathname === "/items";
}

async function tryInsertQualityFilter() {
  if (insertingQuality || document.querySelector(`.${QUALITY_WRAPPER_CLASS}`)) return;
  if (!isSupportedPage()) return;

  const clearButton = document.querySelector(CLEAR_BUTTON_SELECTOR);
  const searchInput = document.querySelector(SEARCH_INPUT_SELECTOR);
  if (!clearButton || !searchInput) return;

  const rows = currentRows();
  if (rows.length === 0) return;

  insertingQuality = true;
  try {
    if (document.querySelector(`.${QUALITY_WRAPPER_CLASS}`)) return;

    const resolved = rows.map((row) => ({ row, qualities: readRowQualities(row) }));
    const counts = countByKey(QUALITY_OPTIONS, resolved, (entry, key) => entry.qualities.includes(key));

    injectStyles();
    const { wrapper, updateCounts } = buildMultiselect({
      wrapperClass: QUALITY_WRAPPER_CLASS,
      options: QUALITY_OPTIONS,
      labelFor: (key) => key,
      colorFor: (key) => QUALITY_COLOR[key],
      counts,
      placeholder: "Any quality",
      scopedAttrsSource: searchInput,
      selected: selectedQualities,
      onChange: refreshRowsAndCounts,
    });
    updateQualityCounts = updateCounts;
    clearButton.insertAdjacentElement("afterend", wrapper);
  } finally {
    insertingQuality = false;
  }
}

// No key: the key button where the Class dropdown would go (after the
// Quality dropdown, or the clear button). Cheap and idempotent, so it can run
// on every tick and put the button back after a table re-render.
function ensureClassKeyHint(clearButton, searchInput) {
  if (document.querySelector(`.${CLASS_KEY_HINT_MARKER_CLASS}`)) return;
  const anchor = document.querySelector(`.${QUALITY_WRAPPER_CLASS}`) || clearButton;
  const hint = buildFilterKeyHint({
    className: `p-multiselect p-component p-inputwrapper me-2 ${FILTER_DROPDOWN_CLASS}`,
    scopedAttrsSource: searchInput,
    markerClass: CLASS_KEY_HINT_MARKER_CLASS,
    label: "Class filter",
    title: CLASS_KEY_HINT_TITLE,
  });
  anchor.insertAdjacentElement("afterend", hint);
}

async function tryInsertClassFilter() {
  if (insertingClass || document.querySelector(`.${CLASS_WRAPPER_CLASS}`)) return;
  if (!isSupportedPage()) return;

  const clearButton = document.querySelector(CLEAR_BUTTON_SELECTOR);
  const searchInput = document.querySelector(SEARCH_INPUT_SELECTOR);
  if (!clearButton || !searchInput) return;

  const rows = currentRows();
  if (rows.length === 0) return;

  if (classFilterUnavailable) {
    ensureClassKeyHint(clearButton, searchInput);
    return;
  }

  insertingClass = true;
  try {
    if (!(await hasSchemaAccess())) {
      classFilterUnavailable = true; // don't re-check on every future tick - see this flag's own note
      ensureClassKeyHint(clearButton, searchInput);
      return;
    }
    if (document.querySelector(`.${CLASS_WRAPPER_CLASS}`)) return;

    const resolved = await Promise.all(
      rows.map(async (row) => {
        const link = row.querySelector(ITEM_LINK_SELECTOR);
        const name = link ? readItemNameFromPath(link.getAttribute("href")) : null;
        const classes = name ? await getClassesCached(name) : [];
        return { row, bucket: classifyItem(classes) };
      })
    );
    if (document.querySelector(`.${CLASS_WRAPPER_CLASS}`)) return; // a concurrent call already inserted it while this awaited

    const counts = countByKey(CLASS_OPTIONS, resolved, (entry, key) => entry.bucket === key);

    injectStyles();
    // Inserted right after the quality dropdown when both are present, or
    // right after the clear button when the quality one hasn't landed yet
    // (its own tryInsert has no async gate, so in practice it's always
    // first - but this doesn't assume that).
    const anchor = document.querySelector(`.${QUALITY_WRAPPER_CLASS}`) || clearButton;
    const { wrapper, updateCounts } = buildMultiselect({
      wrapperClass: CLASS_WRAPPER_CLASS,
      options: CLASS_OPTIONS,
      labelFor: (key) => CLASS_LABELS[key] || key,
      iconSuffixFor: (key) => CLASS_ICON_SUFFIX[key],
      counts,
      placeholder: "Any class",
      scopedAttrsSource: searchInput,
      selected: selectedClasses,
      onChange: refreshRowsAndCounts,
    });
    updateClassCounts = updateCounts;
    removeFilterKeyHints(document, CLASS_KEY_HINT_MARKER_CLASS);
    anchor.insertAdjacentElement("afterend", wrapper);
  } finally {
    insertingClass = false;
  }
}

let refreshScheduled = false;

// Coalesces a burst of mutations into at most one refreshRowsAndCounts per
// 200ms, rather than one per mutation - see this file's own header note
// (rule 4).
function scheduleRefresh() {
  if (refreshScheduled) return;
  refreshScheduled = true;
  setTimeout(() => {
    refreshScheduled = false;
    refreshRowsAndCounts();
  }, 200);
}

export function itemsTableFilters() {
  tryInsertQualityFilter();
  tryInsertClassFilter();

  // Rows/pagination/search re-render client-side - a MutationObserver is
  // the only way to keep re-attaching the dropdowns and re-applying an
  // already-active filter to whatever rows replaced the old ones.
  // tryInsertQualityFilter/tryInsertClassFilter themselves stay ungated
  // (cheap idempotent checks once built, or once classFilterUnavailable is
  // set) - only the actual row-rescan is debounced.
  const observer = new MutationObserver(() => {
    tryInsertQualityFilter();
    tryInsertClassFilter();
    scheduleRefresh();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes.steamApiKey) {
      classFilterUnavailable = false; // a key was just saved - worth re-checking once
      return tryInsertClassFilter();
    }
  });
}
