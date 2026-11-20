/*
@description: Adds custom "Group by ..." options to classic backpack.tf's
own inventory viewer (https://backpack.tf/profiles/<steamid>) sort dropdown
(#inventory-sort-menu): level, paint, effect, spell, scm, classifieds,
killstreak, killstreaker and sheen (see MODES below). Each mode groups on a
data-* attribute already on every item tile (data-level, data-paint_name,
data-effect_name, data-spell_1/data-spell_2, data-p_scm, data-listing_price,
data-ks_tier, data-killstreaker, data-sheen). data-level, data-p_scm,
data-effect_name and the spell attributes are confirmed live; the others are
not independently confirmed.

Killstreak is three separately selectable modes: "Group by killstreak" (a
plain killstreak / no killstreak split), "Group by killstreaker" and "Group
by sheen". Spell puts a double-spelled item's two spells into one shared
group (e.g. "Exorcism and Team Spirit Footprints"), sorted alphabetically
before joining so the same pair always lands in one group regardless of
which attribute slot holds which spell.

The dropdown's native options (Group by page/value/market value/quality/
item index/slot/time/tag, each a plain `<li data-value="...">` with no id)
are confirmed live. This file adds its own `<li data-tf2te-mode="...">`
entries to that same <ul>, styled and behaving the same way.

Each group is wrapped in a `<div class="backpack-page"><div class=
"page-number">...</div><ul class="item-list">...</ul></div>` - the same
structure native pages use. backpack.tf's own "Select" (.select-page)
button scopes its selection to the .backpack-page it lives in, so it only
works for a group with that wrapper around it.

Clicking any of the dropdown's NATIVE options first un-wraps every one of
this file's own group wrappers (moving their items back to being direct
children of the top-level backpack container, then removing the now-empty
wrapper shells - removing a wrapper outright would take every item still
inside it along with it). Not confirmed whether backpack.tf's own native
sort rebuilds the list from its own data or reorders whatever DOM it finds,
so this un-wrap step is a defensive safety net.

Self-scopes off #inventory-sort-menu's own presence - unique to this page
(unlike #unusual-pricelist-input-group's id, which appears on more than one
classic-UI page), so no separate pathname check is needed.
*/

const CUSTOM_MODE_ATTR = "data-tf2te-mode";
const GROUP_WRAPPER_ATTR = "data-tf2te-group-wrapper";
const ITEM_SELECTOR = "li.item[data-defindex]";
// The top-level container every .backpack-page div (native or custom) lives in.
const BACKPACK_CONTAINER_ID = "backpack";

// Alphabetical compare with null (the "not applicable"/fallback bucket)
// always sorted last - shared by every mode below whose group keys are
// plain strings rather than numbers.
function compareStringKeysNullLast(a, b) {
  if (a === null) return 1;
  if (b === null) return -1;
  return a.localeCompare(b);
}

// No craft-number mode yet: the only known way to detect one is scanning each
// tile's rendered TEXT for a "#" (not a clean data attribute like the modes
// below), which needs a live-confirmed sample of that tile markup first.
const MODES = [
  {
    value: "level",
    label: "Group by level",
    groupKeyForItem: (item) => {
      const level = item.getAttribute("data-level");
      return level ? Number(level) : null;
    },
    formatGroupLabel: (key) => (key === null ? "Unknown Level" : `Level ${key}`),
    compareGroupKeys: (a, b) => {
      if (a === null) return 1; // Unknown last
      if (b === null) return -1;
      return a - b;
    },
  },
  {
    value: "paint",
    label: "Group by paint",
    groupKeyForItem: (item) => item.getAttribute("data-paint_name") || null,
    formatGroupLabel: (key) => key ?? "Not Painted",
    compareGroupKeys: compareStringKeysNullLast,
  },
  {
    // data-effect_name confirmed live on a real Unusual item's own
    // inventory-page tile - same attribute the bare /effects list page's
    // own items carry.
    value: "effect",
    label: "Group by effect",
    groupKeyForItem: (item) => item.getAttribute("data-effect_name") || null,
    formatGroupLabel: (key) => key ?? "Not Unusual",
    compareGroupKeys: compareStringKeysNullLast,
  },
  {
    value: "spell",
    label: "Group by spell",
    groupKeyForItem: (item) => {
      const spell1 = item.getAttribute("data-spell_1");
      const spell2 = item.getAttribute("data-spell_2");
      if (spell1 && spell2) return [spell1, spell2].sort().join(" and "); // sorted so the same pair always shares one group
      return spell1 || null;
    },
    formatGroupLabel: (key) => key ?? "No Spell",
    compareGroupKeys: compareStringKeysNullLast,
  },
  {
    value: "scm",
    label: "Group by scm",
    groupKeyForItem: (item) => (item.getAttribute("data-p_scm") ? "scm" : null),
    formatGroupLabel: (key) => (key === "scm" ? "Has SCM Price" : "No SCM Price"),
    compareGroupKeys: (a) => (a === "scm" ? -1 : 1),
  },
  {
    value: "classifieds",
    label: "Group by classifieds",
    groupKeyForItem: (item) => (item.getAttribute("data-listing_price") ? "listed" : null),
    formatGroupLabel: (key) => (key === "listed" ? "Listed on Classifieds" : "Not Listed"),
    compareGroupKeys: (a) => (a === "listed" ? -1 : 1),
  },
  {
    // A simple binary split (has any killstreak tier at all, or doesn't) -
    // NOT broken down by tier/effect/sheen, since that's what the two more
    // specific modes below are for; this one just answers "is this item a
    // killstreak item at all".
    value: "killstreak",
    label: "Group by killstreak",
    groupKeyForItem: (item) => (item.getAttribute("data-ks_tier") ? "Standard Killstreak" : null),
    formatGroupLabel: (key) => key ?? "No Killstreak",
    compareGroupKeys: (a) => (a === "Standard Killstreak" ? -1 : 1),
  },
  {
    // Its own directly-selectable mode (see this file's own header note) -
    // "killstreak" dropped from the label since the general tier-only mode
    // above already owns that name.
    value: "killstreak_effect",
    label: "Group by killstreaker",
    // No separate "Killstreak" (tier 1) bucket here, same reasoning as
    // sheen's own mode - a Basic kit has no killstreaker either, so it
    // folds into "No Killstreaker" together with a plain item rather than
    // being told apart.
    groupKeyForItem: (item) => item.getAttribute("data-killstreaker") || null,
    formatGroupLabel: (key) => key ?? "No Killstreaker",
    compareGroupKeys: compareStringKeysNullLast,
  },
  {
    value: "killstreak_sheen",
    label: "Group by sheen",
    // No separate "Killstreak" (tier 1) bucket here, unlike killstreaker's
    // own mode - a Basic kit has no sheen at all, same as a plain item, so
    // both land in "No Sheen" together rather than being told apart.
    groupKeyForItem: (item) => item.getAttribute("data-sheen") || null,
    formatGroupLabel: (key) => key ?? "No Sheen",
    compareGroupKeys: compareStringKeysNullLast,
  },
];

function injectStyles() {
  if (document.getElementById("tf2te-inventory-group-by-styles")) return;

  const style = document.createElement("style");
  style.id = "tf2te-inventory-group-by-styles";
  style.textContent = `
    /* padding, not margin - confirmed live on /unusuals (see
       ../unusualCategoryFilter/content.js) that margin on this site's
       .page-number bars produces no visible gap at all. */
    .page-number[${GROUP_WRAPPER_ATTR}],
    .backpack-page[${GROUP_WRAPPER_ATTR}] > .page-number { padding-top: 16px; padding-bottom: 4px; }
  `;
  document.head.appendChild(style);
}

/*
@description: Mirrors the native per-page .page-number bar's own full
structure - a .page-anchor jump target, a.label.label-default, and a
"Select"/.select-page button (all confirmed live) - see this file's own
header note on why the wrapping .backpack-page/.item-list this gets placed
into (not this bar alone) is what actually makes the Select button work.
*/
function buildGroupHeader(labelText, anchorId) {
  const bar = document.createElement("div");
  bar.className = "page-number";

  const anchor = document.createElement("div");
  anchor.className = "page-anchor";
  anchor.id = anchorId;

  const label = document.createElement("a");
  label.className = "label label-default";
  label.setAttribute("href", `#${anchorId}`);
  label.textContent = labelText;

  const selectButton = document.createElement("span");
  selectButton.className = "btn btn-primary btn-xs pull-right select-page";
  const icon = document.createElement("i");
  icon.className = "fa fa-th";
  selectButton.appendChild(icon);
  selectButton.appendChild(document.createTextNode(" Select"));

  bar.appendChild(anchor);
  bar.appendChild(label);
  bar.appendChild(selectButton);
  return bar;
}

// Builds one full <div class="backpack-page"><div class="page-number">...
// </div><ul class="item-list"></ul></div> group - matching the real native
// per-page shape exactly (see this file's own header note).
function buildGroupWrapper(labelText, anchorId) {
  const wrapper = document.createElement("div");
  wrapper.className = "backpack-page";
  wrapper.setAttribute(GROUP_WRAPPER_ATTR, "true");
  wrapper.appendChild(buildGroupHeader(labelText, anchorId));

  const itemList = document.createElement("ul");
  itemList.className = "item-list";
  wrapper.appendChild(itemList);

  return { wrapper, itemList };
}

function findBackpackContainer(referenceItem) {
  return document.getElementById(BACKPACK_CONTAINER_ID) || referenceItem.parentElement?.parentElement?.parentElement || null;
}

// Un-wraps every one of THIS file's own group wrapper divs - moving their
// items back to being direct children of the top-level backpack container
// FIRST, then removing the now-empty wrapper shell (see this file's own
// header note on why the order matters: removing a wrapper outright would
// take its still-nested items down with it).
function clearCustomGrouping() {
  const wrappers = Array.from(document.querySelectorAll(`[${GROUP_WRAPPER_ATTR}]`));
  if (wrappers.length === 0) return;

  const backpackContainer = wrappers[0].parentElement;
  wrappers.forEach((wrapper) => {
    Array.from(wrapper.querySelectorAll(ITEM_SELECTOR)).forEach((item) => {
      backpackContainer?.appendChild(item);
    });
    wrapper.remove();
  });
}

function applyMode(mode) {
  const items = Array.from(document.querySelectorAll(ITEM_SELECTOR));
  if (items.length === 0) return;

  const backpackContainer = findBackpackContainer(items[0]);
  if (!backpackContainer) return;

  // Wipes every existing page/group wrapper - native .backpack-page divs
  // AND any of this file's own from a previously-applied custom grouping.
  // items was already captured above as live element references (not a
  // live query), so removing their now-stale containers only detaches
  // them, it doesn't lose them ("capture references first, then clear the
  // container").
  Array.from(backpackContainer.children).forEach((child) => child.remove());

  const groups = new Map();
  items.forEach((item) => {
    const key = mode.groupKeyForItem(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });

  const sortedKeys = Array.from(groups.keys()).sort(mode.compareGroupKeys);

  injectStyles();
  sortedKeys.forEach((key, index) => {
    // Prefixed (never bare "pageN") to avoid colliding with the native
    // per-page anchors (#page1, #page2, ...) this same grouping wiped away
    // above but which other page state may still reference.
    const anchorId = `tf2te-group-${mode.value}-${index}`;
    const { wrapper, itemList } = buildGroupWrapper(mode.formatGroupLabel(key), anchorId);
    backpackContainer.appendChild(wrapper);
    groups.get(key).forEach((item) => itemList.appendChild(item));
  });
}

function buildMenuItems(menu) {
  MODES.forEach((mode) => {
    const li = document.createElement("li");
    li.setAttribute(CUSTOM_MODE_ATTR, mode.value);

    const link = document.createElement("a");
    link.textContent = mode.label;
    link.addEventListener("click", () => applyMode(mode));

    li.appendChild(link);
    menu.appendChild(li);
  });
}

export function inventoryGroupBy() {
  const menu = document.querySelector("#inventory-sort-menu .dropdown-menu");
  if (!menu) return;
  if (menu.querySelector(`[${CUSTOM_MODE_ATTR}]`)) return; // already inserted

  buildMenuItems(menu);

  // Every NATIVE option (no data-tf2te-mode of its own) un-wraps this
  // file's own group wrapper divs on click first - see this file's own
  // header note on why, and on the uncertainty around whether native code
  // needs this at all.
  Array.from(menu.querySelectorAll(`li[data-value]:not([${CUSTOM_MODE_ATTR}])`)).forEach((nativeLi) => {
    nativeLi.addEventListener("click", clearCustomGrouping);
  });
}
