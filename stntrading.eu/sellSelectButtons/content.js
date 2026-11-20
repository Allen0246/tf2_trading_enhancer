/*
@description: Adds "Select All" and "Select Duplicates (keep 1 of each)"
buttons to stntrading.eu's Sell Items page (/sell) toolbar, right after its
"Only show Duplicates" filter, to stage every visible item (or just the spare
copies) for a sell trade without clicking each tile.

Selection dispatches a genuine bubbling click on each tile's .inventoryItem
element, so stntrading.eu's own click handling runs exactly as for a real
click (same technique as scrap.tf/sellDuplicates), staggered by
utils/clickItemsWithDelay.js. While a run is in progress its button becomes
"Stop", and the other button is disabled (createStopController, shared with
scrap.tf's selectors).

"Select Duplicates" groups tiles carrying stntrading.eu's `duplicate`
attribute (present, empty-valued, on the .inventoryItem div) by their
`itemname` + `quality` attributes and selects all but one per group.
`itemname` rather than `name`, because only it includes a crate's series
suffix ("Mann Co. Supply Munition Series #84").

Clicking a tile toggles it, so neither button ever clicks a tile that is
already selected (confirmed live: selection adds a `selected` class to the
.inventoryItem div, which stays in place in the grid). Re-running either
button only tops up what's missing instead of un-selecting earlier picks.

Assumption not confirmed live: `duplicate` is on every copy of a 2+ group,
not only the extra copies (otherwise "keep 1" would keep 2).
*/
import { createStopController } from "../../utils/clickItemsWithDelay.js";

const CONTROLS_ID = "tf2te-sell-select-buttons";
// Confirmed live: the toolbar row holding the sort dropdown, class-filter
// icons, and the page's own "Only show Duplicates" button - the controls
// below are appended here (after that button) so they read as part of the
// same toolbar rather than a separate section.
const TOOLBAR_SELECTOR = '.btn-toolbar[role="toolbar"]';
const ITEM_SELECTOR = ".inventoryItem";
const SELECTED_CLASS = "selected";

// offsetParent !== null scopes this to whichever class/duplicate filter is
// currently active on the page - e.g. with the "Only show Duplicates"
// filter on, "Select All" only selects what's actually visible, not every
// item hidden behind that filter too.
function getVisibleItems() {
  return Array.from(document.querySelectorAll(ITEM_SELECTOR)).filter((el) => el.offsetParent !== null);
}

function isSelected(el) {
  return el.classList.contains(SELECTED_CLASS);
}

/*
@description: Every visible tile "Select All" still needs to click, i.e. the
visible ones not already selected.
*/
export function pickUnselectedVisibleItems() {
  return getVisibleItems().filter((el) => !isSelected(el));
}

/*
@description: Groups every currently-visible tile stntrading.eu has already
flagged as a duplicate (see this file's own header note on the `duplicate`
attribute) by its own "itemname::quality" identity.
@returns: Map<string, HTMLElement[]>, one entry per identity. A group can
hold a single tile, e.g. when its other copies are filtered out of view
(only visible tiles count); pickDuplicatesToSelect leaves such a group alone.
*/
export function findDuplicateGroups() {
  const duplicateTiles = getVisibleItems().filter((el) => el.hasAttribute("duplicate"));

  const groups = new Map();
  for (const el of duplicateTiles) {
    const key = `${el.getAttribute("itemname")}::${el.getAttribute("quality")}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(el);
  }
  return groups;
}

/*
@description: Every tile still to click for "keep 1 of each": per duplicate
group, enough not-yet-selected tiles to bring the group up to "every copy
but one selected". Already-selected copies count toward that target without
being clicked again, so a group that already has enough selected (including
all of them, chosen by hand) is left alone. Picks from the end of the
group (DOM/pos order), so the copy kept is the first unselected one.
*/
export function pickDuplicatesToSelect() {
  const toSelect = [];
  for (const tiles of findDuplicateGroups().values()) {
    const missing = tiles.length - 1 - tiles.filter(isSelected).length;
    if (missing <= 0) continue;
    toSelect.push(...tiles.filter((el) => !isSelected(el)).slice(-missing));
  }
  return toSelect;
}

function createButton(label) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn btn-info";
  btn.textContent = label;
  return btn;
}

function createControls() {
  // inline-flex (not the default block) so this sits on the same line as
  // the toolbar's own sort/filter/duplicates buttons instead of wrapping
  // onto its own row underneath them.
  const wrapper = document.createElement("div");
  wrapper.id = CONTROLS_ID;
  wrapper.style.display = "inline-flex";
  wrapper.style.alignItems = "center";
  wrapper.style.gap = "8px";
  wrapper.style.marginLeft = "8px";

  const selectAllBtn = createButton("Select All");
  const selectDuplicatesBtn = createButton("Select Duplicates (keep 1 of each)");
  const statusEl = document.createElement("span");
  statusEl.style.fontSize = "12px";
  statusEl.style.color = "#fff";

  // One run at a time: the button that started it reads "Stop" and stays
  // clickable, the other one is disabled (see createStopController).
  const stopController = createStopController([selectAllBtn, selectDuplicatesBtn]);

  async function runSelection(button, getItems, emptyMessage, doneNoun) {
    const items = getItems();
    if (items.length === 0) {
      statusEl.textContent = emptyMessage;
      return;
    }

    statusEl.textContent = `Selecting ${items.length} item${items.length === 1 ? "" : "s"}...`;

    const { clicked, stopped } = await stopController.run(button, items);

    statusEl.textContent = stopped
      ? `Stopped after selecting ${clicked} item${clicked === 1 ? "" : "s"}.`
      : `Selected ${clicked} ${doneNoun}${clicked === 1 ? "" : "s"}.`;
  }

  function handleClick(button, getItems, emptyMessage, doneNoun) {
    // A click while a run is going can only come from that run's own
    // "Stop" button (the other one is disabled).
    if (stopController.stopIfRunning()) return;
    // Returned so the tests' fake dispatchEvent can await the whole run.
    return runSelection(button, getItems, emptyMessage, doneNoun);
  }

  selectAllBtn.addEventListener("click", () => handleClick(selectAllBtn, pickUnselectedVisibleItems, "No items to select.", "item"));
  selectDuplicatesBtn.addEventListener("click", () =>
    handleClick(selectDuplicatesBtn, pickDuplicatesToSelect, "No spare duplicates to select.", "duplicate")
  );

  wrapper.append(selectAllBtn, selectDuplicatesBtn, statusEl);
  return wrapper;
}

function ensureControlsInserted() {
  const toolbarEl = document.querySelector(TOOLBAR_SELECTOR);
  if (!toolbarEl) return;
  if (document.getElementById(CONTROLS_ID)) return; // already inserted (and still in the DOM)

  toolbarEl.appendChild(createControls());
}

export function sellSelectButtons() {
  ensureControlsInserted();

  // The toolbar may re-render (e.g. switching tabs), so re-insert on any
  // mutation, like scrap.tf/sellDuplicates.
  const observer = new MutationObserver(() => ensureControlsInserted());
  observer.observe(document.body, { childList: true, subtree: true });
}
