/*
@description: Adds a "class filter" dropdown to a next.backpack.tf specific
-effect page (e.g. /effects/Burning%20Flames) OR specific-War-Paint page
(e.g. /war-paints/Mosaic) - same idea as
../../oldUI/effectClassFilter/content.js, but built completely differently:
confirmed live, an item tile here carries NO class signal of its own at all
(no data-class, no icon, no visible text - unlike classic UI's tiles). The
only usable signal is the item's own name (read off its `href`'s own "item"
query param - e.g. "Noh Mercy" for an effect, or the plain weapon name like
"Tomislav"/"Rocket Launcher"/"War Paint" itself for a War Paint variant,
confirmed live via pasted markup to need no special handling: a Decorated
Weapon's href still carries the exact same plain schema-recognized weapon
name this file already parses, quality/wearTier/texture params and all,
just added alongside it - not combined into one unparseable string),
cross-referenced against Valve's own TF2 item schema (utils/tf2Schema.js's
own getItemClasses) to learn its class.

That means this feature only works when a Steam Web API key is configured
(schema fetches need one) - checked via utils/tf2Schema.js's own
hasSchemaAccess(). With no key, a "needs a key" pill
(../shared/filterKeyHint.js) sits in the dropdown's spot instead of a
dropdown that can't actually filter anything.

Built as a checkbox multiselect with per-class icons and live item counts,
matching the real "Classes" filter next.backpack.tf's own War Paints/Paints
pages already have natively (effect pages have no such filter of their own -
that's the whole reason this feature exists) - cloned from that filter's own
live-pasted markup rather than guessed: same p-multiselect-* structure, the
same site-wide "fak fa-tf2-<class>" icon font (a global icon font, not
page-specific CSS, so it's safe to reference here even though no native
multiselect is ever present on an effects page itself to confirm it renders
against), and the same "sort-dropdown"-prefixed wrapper class + Vue
scoped-style attribute the reference "Sort by Value" dropdown already
carries (confirmed live: the real Classes multiselect's own wrapper carries
that exact same "sort-dropdown" class and scoped attribute too, alongside
its multiselect-specific ones - both are evidently built from one shared
internal filter-dropdown component, just parameterized differently, which is
why cloning the (single-select) Sort dropdown's base classes still produces
correct multiselect styling here). The header's own real accessibility
input/keyboard navigation is NOT replicated - this is a visual/mouse-click
approximation only.

Each item is bucketed into exactly ONE class per Valve's own schema
convention (utils/tf2Schema.js's own getItemClasses note): zero classes
listed at all means unrestricted ("All-Class"), 2+ means shared by multiple
specific classes ("Multi-Class"), otherwise its one listed class. A checked
class shows items in that bucket; checking several is an OR (union) across
buckets; checking none shows everything. This bucket-exclusive interpretation
(an unrestricted item does NOT also count toward every specific class)
matches how the real
filter's own per-class counts must work (an "All-Class" item can't also be
counted under "Scout" without double-counting), but the exact OR-vs-something
-else interaction between checked boxes was inferred from the pasted static
markup, not confirmed by actually clicking the real filter live - worth a
second look if real multi-selection ever turns out to behave differently.

Filtering is a purely additive CSS layer (!important, hide-only) exactly
like the classic-UI version - never touches an item the class filter would
keep visible, so it composes safely with the page's own "Search by name"
filtering regardless of how that's implemented (Vue re-rendering /
removing tiles, or its own CSS toggling). Counts are computed once, from
whichever items are present at insert time - like the item list itself
(see tryInsert's own items snapshot), they don't update if the page's own
pagination/infinite-scroll adds more items afterward.

Restricted to a specific-effect page (/effects/<name>) OR specific-War-Paint
page (/war-paints/<name>) via a pathname check, rather than relying on the
item-tile/search-box self-scoping alone the way the classic-UI version can -
confirmed live those same elements (item tiles, a "Search by name" input, a
sort dropdown) are ALSO present on other next.backpack.tf item-grid pages
(e.g. the BARE /war-paints list, which already has its own native "Classes"
filter that this dropdown would duplicate - unlike the classic-UI version's
own data-class-based self-scoping, which tells every page shape apart
without needing a pathname check at all). A specific
War Paint page (/war-paints/<name>) does NOT have that native filter itself
- confirmed live via pasted markup, same as a specific-effect page - so it's
included here rather than excluded the way the bare list is.

A specific-effect or specific-War-Paint page can show up to two independent
sections in their own ".card" - "Variants" (priced) and "Unpriced Variants" -
each with its OWN search box/sort dropdown/item grid (confirmed live via
pasted markup for both page types: every section shares the identical
internal filter-row component, same data-v-7332f3c4 scoped attribute, just
separate instances). Rather than hardcoding "exactly two", every "Search by
name" input found on the page gets its own independent dropdown, scoped to
items within that input's own closest ".card" ancestor - this also just
works if a given page only has one section (no unpriced variants at all) or,
should backpack.tf ever add a third, that too, with no changes needed here.
Each section's own dropdown has its own selection state and counts -
checking a class in "Variants" never touches "Unpriced Variants"' own
filtering.
*/

import { getItemClasses, hasSchemaAccess } from "../../../utils/tf2Schema.js";
import { copyScopedStyleAttrs } from "../shared/vueScopedStyle.js";
import { buildFilterKeyHint, removeFilterKeyHints } from "../shared/filterKeyHint.js";

const ITEM_SELECTOR = 'a.item[class*="item__quality-"]';
const SEARCH_INPUT_SELECTOR = 'input[placeholder="Search by name"]';
// The page's own "Sort by Value" dropdown - used purely as a style
// reference (see buildDropdown's own note), not interacted with.
const SORT_DROPDOWN_SELECTOR = ".sort-dropdown";
// The "Variants"/"Unpriced Variants" section boundary - see this file's own
// header note on why each "Search by name" input's closest ".card" ancestor,
// not the whole document, is what every other selector here gets scoped to.
const SECTION_SELECTOR = ".card";
// A class, not an id - a page can carry more than one dropdown at once (one
// per section), so this can't be a single document-wide unique id.
const WRAPPER_CLASS = "tf2te-effect-class-filter-wrapper";
// The key button standing in for the dropdown while no key is saved
// (../shared/filterKeyHint.js).
const KEY_HINT_MARKER_CLASS = "tf2te-effect-class-filter-key-hint";
const KEY_HINT_TITLE = "The class filter needs a Steam Web API key to look up which class each item is for. Click to add one (one-time setup).";
const FILTERED_OUT_CLASS = "tf2te-effect-class-filtered-out";
const SPECIFIC_CLASSES = ["Scout", "Soldier", "Pyro", "Demoman", "Heavy", "Engineer", "Medic", "Sniper", "Spy"];
// Order matches the real Classes filter's own panel (specific classes first,
// Multi-Class/All-Class last).
const CLASS_OPTIONS = [...SPECIFIC_CLASSES, "Multi", "All"];
const CLASS_LABELS = { Multi: "Multi-Class", All: "All-Class" };
// "fak fa-tf2-<suffix>" - confirmed live off the real Classes filter's own
// pasted markup, one icon per specific class plus "multi"/"logo" for the
// Multi-Class/All-Class rows.
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
const PANEL_CLASS = "p-multiselect-panel";
const ITEMS_WRAPPER_CLASS = "p-multiselect-items-wrapper";
const ITEMS_CLASS = "p-multiselect-items";
const ITEM_CLASS = "p-multiselect-item";
const CHECKBOX_HIGHLIGHT_CLASS = "p-highlight";
// This codebase's own class, not a PrimeVue one - toggled to drive the
// open/close transition declared in injectStyles (see its own note).
const OPEN_CLASS = "tf2te-dropdown-open";

// itemName -> Promise<string[]> - avoids re-querying tf2Schema.js (itself
// backed by a single cached/in-memory schema object, so this isn't about
// avoiding network calls) for the same name every time a MutationObserver
// tick re-applies the filter.
const classCache = new Map();

function getClassesCached(itemName) {
  if (!classCache.has(itemName)) {
    classCache.set(itemName, getItemClasses(itemName));
  }
  return classCache.get(itemName);
}

// Test-only: this module-scoped cache is intentionally never cleared during
// a real page's lifetime (an item's class list never changes), but that
// means it leaks between separate test cases in the same file that reuse an
// item name against different schema mocks - same reasoning as
// utils/tf2Schema.js's own __resetSchemaCacheForTests.
export function __resetClassCacheForTests() {
  classCache.clear();
}

function readItemName(el) {
  const href = el.getAttribute("href");
  if (!href) return null;
  try {
    return new URL(href, window.location.origin).searchParams.get("item");
  } catch {
    return null;
  }
}

// Buckets a resolved class list into exactly one of CLASS_OPTIONS - see this
// file's own header note on why this has to be exclusive (an unrestricted
// item counts as "All", never ALSO as "Scout").
function classifyItem(classes) {
  if (classes.length === 0) return "All";
  if (classes.length > 1) return "Multi";
  return classes[0];
}

// Resolves every item's class bucket once, up front - needed before the
// dropdown can even render its own per-class counts.
async function resolveItemBuckets(items) {
  return Promise.all(
    items.map(async (el) => {
      const name = readItemName(el);
      const classes = name ? await getClassesCached(name) : [];
      return { el, bucket: classifyItem(classes) };
    })
  );
}

function countByBucket(resolved) {
  const counts = Object.fromEntries(CLASS_OPTIONS.map((cls) => [cls, 0]));
  resolved.forEach(({ bucket }) => counts[bucket]++);
  return counts;
}

// No boxes checked = no filter, matching the real filter's own "nothing
// selected" placeholder state (see buildDropdown's own label note).
function applyFilter(selected, resolved) {
  resolved.forEach(({ el, bucket }) => {
    el.classList.toggle(FILTERED_OUT_CLASS, selected.size > 0 && !selected.has(bucket));
  });
}

function injectStyles() {
  if (document.getElementById("tf2te-effect-class-filter-styles")) return;

  const style = document.createElement("style");
  style.id = "tf2te-effect-class-filter-styles";
  style.textContent = `
    .${FILTERED_OUT_CLASS} { display: none !important; }
    /* min-width: the cloned Sort-dropdown's own
       width was too cramped for this multiselect's own label text (e.g.
       "Pyro" barely fit next to its chevron) - the Sort dropdown's own
       width evidently isn't a fixed site-wide dropdown size, just whatever
       fits ITS OWN typical label text ("Sort by Name"), so it doesn't carry
       over correctly for a differently-labeled component. white-space:
       nowrap on the label keeps a two-class label ("Pyro, Spy") from
       wrapping instead of just widening the pill. */
    .${WRAPPER_CLASS} { cursor: pointer; min-width: 140px; }
    /* The "Any class" text itself needed the same
       left padding "Search by name" has inside ITS OWN box (padding on the
       label, not a margin on the outer pill). PrimeVue's own .p-inputtext
       (which "Search by name" itself uses) has a well-documented default
       0.75rem horizontal padding - not independently confirmed live for
       this specific label, since no reference element carries it verbatim
       the way other cloned values here do, but it's the standard PrimeVue
       input padding rather than an arbitrary guess. */
    .${WRAPPER_CLASS} .p-multiselect-label { white-space: nowrap; padding-left: 0.75rem; }
    /* Matching space after the chevron too, mirroring
       the label's own left padding just above - the pill otherwise had
       the arrow sitting flush against its right edge. */
    .${WRAPPER_CLASS} .p-multiselect-trigger { padding-right: 0.75rem; }
    /* Opacity/transform + transition (not a display toggle) so the panel
       actually animates open/closed - confirmed live: PrimeVue's own real
       dropdown panels (Priced Qualities/Classes/Slots/Sort by Avg. Value)
       fade+scale in via their own .p-connected-overlay-enter-active
       transition, timing copied here (0.12s cubic-bezier(0,0,.2,1)) so this
       custom panel opens with the same feel instead of snapping open
       instantly. pointer-events: none while closed keeps it non-interactive
       (and unclickable through) despite never using display: none.  */
    .${WRAPPER_CLASS} .${PANEL_CLASS} {
      position: absolute; top: 100%; left: 0; z-index: 1001; min-width: 100%;
      transform-origin: top;
      opacity: 0;
      transform: scaleY(0.8);
      pointer-events: none;
      transition: opacity 0.12s cubic-bezier(0, 0, 0.2, 1), transform 0.12s cubic-bezier(0, 0, 0.2, 1);
    }
    .${WRAPPER_CLASS} .${PANEL_CLASS}.${OPEN_CLASS} {
      opacity: 1;
      transform: scaleY(1);
      pointer-events: auto;
    }
    /* PrimeVue's own checked-checkbox look - both colors are now confirmed
       live via devtools computed styles (not guessed): the box itself reads
       the site's own --accent-primary (#6c8ba1, matching
       --bs-brand/--brand-bright too), and the checkmark glyph reads
       --accent-inverse (#151515, near-black - confirmed off the actual
       checkmark icon element's own computed "color") rather than white -
       the "primary"/"inverse" variable pairing itself is a strong signal
       this is the intended combo (a colored fill with an inverse-toned icon
       on top for contrast), not a coincidence. Reads off the site's own CSS
       custom properties rather than hardcoded hexes so this tracks
       correctly if the site ever re-themes; the hex fallbacks only matter
       if that variable somehow isn't inherited at the point this is
       inserted. */
    /* border-color: a checked box was invisible
       (just a bare checkmark, no box) - it was set to the SAME
       --accent-primary as both its own fill AND the selected row's own
       background, so the border blended into everything around it. Using
       --accent-inverse (the same dark tone the checkmark itself uses) keeps
       the box outlined regardless of what's behind it. */
    .${WRAPPER_CLASS} .p-checkbox-box.${CHECKBOX_HIGHLIGHT_CLASS} {
      background: var(--accent-primary, #6c8ba1);
      border-color: var(--accent-inverse, #151515);
    }
    .${WRAPPER_CLASS} .p-checkbox-icon.${CHECKBOX_HIGHLIGHT_CLASS}::before {
      content: "\\2713";
      color: var(--accent-inverse, #151515);
      font-size: 11px;
      line-height: 1;
    }
    /* Confirmed live via devtools computed styles (not a guessed tint): a
       selected row gets a SOLID --accent-primary fill (not a translucent
       wash) with --accent-inverse text on top, the same
       primary/inverse pairing as the checkbox itself - one cohesive
       colored row, not a checkbox floating over a barely-tinted background. */
    .${WRAPPER_CLASS} .${ITEM_CLASS}.${CHECKBOX_HIGHLIGHT_CLASS} {
      background: var(--accent-primary, #6c8ba1);
      color: var(--accent-inverse, #151515);
    }
    /* Every count number rendered plain white instead of
       muted, even on UNchecked rows - --component-text-secondary (a 60%-
       opacity white) is the counterpart to --component-text-color (the
       panel's own base text color, confirmed live earlier), and matches
       PrimeVue's own "secondary/muted text" naming convention, so it's set
       explicitly here rather than trusting the site's own .p-text-secondary
       rule to apply on its own. Deliberately NOT overridden on a selected
       row the way the row's own label text is - observed that the count
       stays this same muted-white even when the row is checked/blue, only
       the label switches to --accent-inverse, so this rule is left as
       the only one touching .p-text-secondary's color. */
    .${WRAPPER_CLASS} .p-text-secondary {
      color: var(--component-text-secondary, hsla(0, 0%, 100%, 0.6));
    }
    /* Vertically centers each row's checkbox/icon/text on one line -
       they read as misaligned without this. */
    .${WRAPPER_CLASS} .${ITEM_CLASS} {
      display: flex;
      align-items: center;
    }
  `;
  document.head.appendChild(style);
}

// Copies every Vue scoped-style marker attribute (data-v-XXXXXXXX) from the
// reference dropdown onto EVERY element built below, not just the outer
// wrapper - copyScopedStyleAttrs (imported above) is what makes that work
// for this exact site (Vue's scoped CSS compiles rules to
// ".foo[data-v-XXXXXXXX]", not just ".foo" alone; see
// ../shared/vueScopedStyle.js's own note). Confirmed live the hard way: the
// panel/checkbox/selected-row's own real colors (--component-background-
// color, --component-border-color, etc.) still didn't apply with the
// attribute on the wrapper alone - Vue stamps that same attribute onto
// EVERY element a scoped component renders, not just its root, so a scoped
// selector like "[data-v-xxx] .p-multiselect-panel" only matches an element
// that ALSO carries the attribute itself, not just one nested inside
// something that does. PrimeVue's own base component classes (.p-multiselect,
// .p-multiselect-label, ...) are a third-party library's global CSS and
// apply regardless either way, but this site's own themed overrides
// evidently don't without this.
function buildCheckboxEl(checked, referenceDropdown) {
  const box = document.createElement("div");
  box.className = "p-checkbox-box";
  box.classList.toggle(CHECKBOX_HIGHLIGHT_CLASS, checked);
  copyScopedStyleAttrs(referenceDropdown, box);

  const icon = document.createElement("span");
  icon.className = "p-checkbox-icon";
  icon.classList.toggle(CHECKBOX_HIGHLIGHT_CLASS, checked);
  copyScopedStyleAttrs(referenceDropdown, icon);
  box.appendChild(icon);

  const checkbox = document.createElement("div");
  checkbox.className = "p-checkbox p-component";
  copyScopedStyleAttrs(referenceDropdown, checkbox);
  checkbox.appendChild(box);
  return { checkbox, box, icon };
}

/*
@description: Builds the multiselect by cloning the real "Sort by Value"
dropdown's own classes/scoped-style attributes onto a wrapper (rather than
guessing colors/sizing), with the same internal p-multiselect-* structure
(header select-all checkbox + close button, then one checkbox+icon+count row
per class) the real Classes filter's own pasted markup shows - see this
file's own header note on why cloning from the Sort dropdown still produces
correct multiselect styling here. A native <select multiple>'s own open list
can't be styled at all (an OS-level rendering limitation every browser has,
not something CSS can override), so there's no way to get a visually-matching
open state without reimplementing the open/close interaction by hand like
this.
*/
function buildDropdown(resolved, counts, referenceDropdown) {
  const wrapper = document.createElement("div");
  wrapper.className = referenceDropdown.className.replace(/\bsort-dropdown\b/, "tf2te-effect-class-filter").trim();
  wrapper.classList.add("me-3", WRAPPER_CLASS);
  wrapper.style.position = "relative";
  copyScopedStyleAttrs(referenceDropdown, wrapper);

  const labelContainer = document.createElement("div");
  labelContainer.className = "p-multiselect-label-container";
  copyScopedStyleAttrs(referenceDropdown, labelContainer);
  const label = document.createElement("div");
  label.className = "p-multiselect-label p-placeholder";
  label.textContent = "Any class";
  copyScopedStyleAttrs(referenceDropdown, label);
  labelContainer.appendChild(label);

  const triggerIcon = document.createElement("span");
  triggerIcon.className = "p-multiselect-trigger-icon pi pi-chevron-down";
  copyScopedStyleAttrs(referenceDropdown, triggerIcon);
  const trigger = document.createElement("div");
  trigger.className = "p-multiselect-trigger";
  copyScopedStyleAttrs(referenceDropdown, trigger);
  trigger.appendChild(triggerIcon);

  const panel = document.createElement("div");
  panel.className = `${PANEL_CLASS} p-component`;
  copyScopedStyleAttrs(referenceDropdown, panel);

  const header = document.createElement("div");
  header.className = "p-multiselect-header";
  copyScopedStyleAttrs(referenceDropdown, header);
  const { checkbox: selectAllCheckbox, box: selectAllBox, icon: selectAllIcon } = buildCheckboxEl(false, referenceDropdown);
  header.appendChild(selectAllCheckbox);

  const closeIcon = document.createElement("span");
  closeIcon.className = "p-multiselect-close-icon pi pi-times";
  copyScopedStyleAttrs(referenceDropdown, closeIcon);
  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "p-multiselect-close p-link";
  copyScopedStyleAttrs(referenceDropdown, closeButton);
  closeButton.appendChild(closeIcon);
  header.appendChild(closeButton);

  const itemsWrapper = document.createElement("div");
  itemsWrapper.className = ITEMS_WRAPPER_CLASS;
  copyScopedStyleAttrs(referenceDropdown, itemsWrapper);

  const list = document.createElement("ul");
  list.className = `${ITEMS_CLASS} p-component`;
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-multiselectable", "true");
  copyScopedStyleAttrs(referenceDropdown, list);

  const selected = new Set();
  const optionBoxes = {};
  const optionIcons = {};
  const optionRows = {};

  function closePanel() {
    panel.classList.remove(OPEN_CLASS);
  }

  function updateLabel() {
    if (selected.size === 0) {
      label.textContent = "Any class";
      label.classList.add("p-placeholder");
    } else if (selected.size <= 2) {
      label.textContent = [...selected].map((cls) => CLASS_LABELS[cls] || cls).join(", ");
      label.classList.remove("p-placeholder");
    } else {
      label.textContent = `${selected.size} classes selected`;
      label.classList.remove("p-placeholder");
    }
  }

  function updateSelectAllCheckbox() {
    const allSelected = selected.size === CLASS_OPTIONS.length;
    selectAllBox.classList.toggle(CHECKBOX_HIGHLIGHT_CLASS, allSelected);
    selectAllIcon.classList.toggle(CHECKBOX_HIGHLIGHT_CLASS, allSelected);
  }

  function toggleClass(cls) {
    if (selected.has(cls)) selected.delete(cls);
    else selected.add(cls);

    const isSelected = selected.has(cls);
    optionBoxes[cls].classList.toggle(CHECKBOX_HIGHLIGHT_CLASS, isSelected);
    optionIcons[cls].classList.toggle(CHECKBOX_HIGHLIGHT_CLASS, isSelected);
    optionRows[cls].classList.toggle(CHECKBOX_HIGHLIGHT_CLASS, isSelected);

    updateSelectAllCheckbox();
    updateLabel();
    applyFilter(selected, resolved);
  }

  CLASS_OPTIONS.forEach((cls) => {
    const li = document.createElement("li");
    li.className = ITEM_CLASS;
    li.setAttribute("role", "option");
    const label = CLASS_LABELS[cls] || cls;
    li.setAttribute("aria-label", label);
    copyScopedStyleAttrs(referenceDropdown, li);
    optionRows[cls] = li;

    const { checkbox, box, icon } = buildCheckboxEl(false, referenceDropdown);
    optionBoxes[cls] = box;
    optionIcons[cls] = icon;
    li.appendChild(checkbox);

    const classIcon = document.createElement("i");
    classIcon.className = `me-1 fak fa-tf2-${CLASS_ICON_SUFFIX[cls]} attribute__null`;
    copyScopedStyleAttrs(referenceDropdown, classIcon);
    li.appendChild(classIcon);

    li.appendChild(document.createTextNode(`${label} (`));
    const countEl = document.createElement("span");
    countEl.className = "p-text-secondary";
    countEl.textContent = String(counts[cls] || 0);
    copyScopedStyleAttrs(referenceDropdown, countEl);
    li.appendChild(countEl);
    li.appendChild(document.createTextNode(")"));

    // The panel stays open after each pick so several classes can be checked
    // in one pass - matching PrimeVue MultiSelect's own standard behavior (only the close
    // button/an outside click dismisses the panel).
    li.addEventListener("click", () => toggleClass(cls));
    list.appendChild(li);
  });

  // Selects everything if not already all selected, otherwise clears -
  // standard PrimeVue MultiSelect header-checkbox semantics.
  selectAllCheckbox.addEventListener("click", () => {
    const shouldSelectAll = selected.size !== CLASS_OPTIONS.length;
    selected.clear();
    if (shouldSelectAll) CLASS_OPTIONS.forEach((cls) => selected.add(cls));

    CLASS_OPTIONS.forEach((cls) => {
      optionBoxes[cls].classList.toggle(CHECKBOX_HIGHLIGHT_CLASS, shouldSelectAll);
      optionIcons[cls].classList.toggle(CHECKBOX_HIGHLIGHT_CLASS, shouldSelectAll);
      optionRows[cls].classList.toggle(CHECKBOX_HIGHLIGHT_CLASS, shouldSelectAll);
    });
    updateSelectAllCheckbox();
    updateLabel();
    applyFilter(selected, resolved);
  });

  // The close (X) button only dismisses the panel - it doesn't clear the
  // current selection, same as PrimeVue MultiSelect's own "showClose" button
  // (clearing is what the header checkbox is for).
  closeButton.addEventListener("click", (event) => {
    event.stopPropagation();
    closePanel();
  });

  itemsWrapper.appendChild(list);
  panel.appendChild(header);
  panel.appendChild(itemsWrapper);

  // Clicking anywhere on the closed pill (label/trigger) toggles the panel;
  // a click that originated inside the panel itself is left alone here -
  // each row's own click handler manages the panel's open state instead.
  wrapper.addEventListener("click", (event) => {
    if (panel.contains(event.target)) return;
    panel.classList.toggle(OPEN_CLASS);
  });

  // Closes on any click outside this dropdown entirely - the SAME click
  // that just opened the panel (via the listener above) also bubbles up to
  // document, but wrapper.contains(event.target) is still true for it, so
  // it doesn't immediately re-close what was just opened.
  document.addEventListener("click", (event) => {
    if (!wrapper.contains(event.target)) closePanel();
  });

  wrapper.appendChild(labelContainer);
  wrapper.appendChild(trigger);
  wrapper.appendChild(panel);
  return wrapper;
}

let inserting = false;

// True only for a specific-effect page ("/effects/Burning%20Flames") or a
// specific-War-Paint page ("/war-paints/Mosaic") - both exactly two path
// segments. False for either page TYPE's own bare list ("/effects",
// "/war-paints" - one segment, no class-specific items to filter, and for
// /war-paints specifically, already has its own native "Classes" filter -
// see this file's own header note) and for every other next.backpack.tf
// item-grid page, which share the same item-tile/search-box/sort-dropdown
// shape this file would otherwise self-scope off alone.
function isSupportedPage() {
  const segments = window.location.pathname.split("/").filter(Boolean);
  return segments.length === 2 && (segments[0] === "effects" || segments[0] === "war-paints");
}

// One entry per "Search by name" input found on the page, paired with its
// own enclosing section - see this file's own header note on why sections
// (not the whole document) are what everything else gets scoped to. A
// search input with no enclosing SECTION_SELECTOR ancestor is skipped
// defensively (shouldn't happen on a real page - there's no section
// boundary to scope its own items/reference dropdown to).
function findSections() {
  return Array.from(document.querySelectorAll(SEARCH_INPUT_SELECTOR))
    .map((searchInput) => ({ searchInput, section: searchInput.closest(SECTION_SELECTOR) }))
    .filter(({ section }) => section);
}

// Set on a section whose items all fell into one class bucket, holding the
// item count it was checked at (see tryInsertSection).
const SINGLE_CLASS_DATASET_KEY = "tf2teClassFilterSingleClassAt";

// Builds and inserts one section's own dropdown - a no-op if this section
// already has one, has no items yet (e.g. a genuinely empty "Unpriced
// Variants"), or has no reference dropdown of its own to clone from yet.
//
// Also skipped when every item falls into the same class bucket: a skin made
// for one weapon (e.g. /war-paints/Sand%20Cannon, all Sniper) could only be
// filtered to "everything" or "nothing". A multi-weapon War Paint or an
// effect page spans several classes and keeps it. The section remembers the
// item count it was checked at, so the observer's frequent re-runs don't
// re-resolve every item until more items actually load.
async function tryInsertSection(section, searchInput) {
  if (section.querySelector(`.${WRAPPER_CLASS}`)) return;

  const items = Array.from(section.querySelectorAll(ITEM_SELECTOR));
  if (items.length === 0) return;
  if (section.dataset[SINGLE_CLASS_DATASET_KEY] === String(items.length)) return;

  const referenceDropdown = section.querySelector(SORT_DROPDOWN_SELECTOR);
  if (!referenceDropdown) return; // no style reference to clone from - don't guess at styling from scratch

  const resolved = await resolveItemBuckets(items);
  if (section.querySelector(`.${WRAPPER_CLASS}`)) return; // a concurrent call already inserted it while this awaited

  const counts = countByBucket(resolved);
  if (Object.values(counts).filter((n) => n > 0).length < 2) {
    section.dataset[SINGLE_CLASS_DATASET_KEY] = String(items.length);
    removeFilterKeyHints(section, KEY_HINT_MARKER_CLASS);
    return;
  }
  delete section.dataset[SINGLE_CLASS_DATASET_KEY];

  injectStyles();
  removeFilterKeyHints(section, KEY_HINT_MARKER_CLASS);
  // Before the search box, not after.
  searchInput.insertAdjacentElement("beforebegin", buildDropdown(resolved, counts, referenceDropdown));
}

// No key saved: the key button in the dropdown's own spot, under the same
// conditions the dropdown itself would appear (items + a Sort dropdown).
function insertKeyHint(section, searchInput) {
  if (section.querySelector(`.${WRAPPER_CLASS}`) || section.querySelector(`.${KEY_HINT_MARKER_CLASS}`)) return;
  if (section.querySelectorAll(ITEM_SELECTOR).length === 0) return;
  const referenceDropdown = section.querySelector(SORT_DROPDOWN_SELECTOR);
  if (!referenceDropdown) return;

  const hint = buildFilterKeyHint({
    className: `${referenceDropdown.className.replace(/\bsort-dropdown\b/, "").trim()} me-3`,
    scopedAttrsSource: referenceDropdown,
    markerClass: KEY_HINT_MARKER_CLASS,
    label: "Class filter",
    title: KEY_HINT_TITLE,
  });
  searchInput.insertAdjacentElement("beforebegin", hint);
}

async function tryInsert() {
  if (inserting) return;
  if (!isSupportedPage()) return;

  const sections = findSections();
  if (sections.length === 0) return;

  inserting = true;
  try {
    // No key: the schema (each item's classes) is out of reach, so show the
    // key button instead of a dropdown that couldn't filter anything.
    if (!(await hasSchemaAccess())) {
      sections.forEach(({ section, searchInput }) => insertKeyHint(section, searchInput));
      return;
    }

    // Independent per section - one section already having its dropdown (or
    // still having no items) never blocks another section that's ready.
    await Promise.all(sections.map(({ section, searchInput }) => tryInsertSection(section, searchInput)));
  } finally {
    inserting = false;
  }
}

export function effectClassFilter() {
  tryInsert();

  // Item tiles and the filter row itself render/re-render client-side
  // (search results, navigating between effects) - a MutationObserver is
  // the only way to keep re-attaching this if a re-render replaces the row
  // this was inserted into. tryInsertSection's own per-section WRAPPER_CLASS
  // guard makes repeated calls safe/idempotent.
  const observer = new MutationObserver(() => tryInsert());
  observer.observe(document.body, { childList: true, subtree: true });

  // Re-attempts the instant a Steam API key is saved/changed in the
  // extension popup - without this, a page already open when no key was
  // configured stayed without this dropdown forever (hasSchemaAccess()
  // failing once inside tryInsert is never retried on its own; only new DOM
  // mutations re-trigger tryInsert, and saving a key causes none here),
  // requiring a manual reload to pick it up. Same pattern already
  // established for other Steam-API-key-gated features (e.g.
  // scrap.tf/itemLinks/content.js's own chrome.storage.onChanged listener).
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes.steamApiKey) return tryInsert();
  });
}
