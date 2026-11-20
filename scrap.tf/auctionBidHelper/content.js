/*
@description: Adds a "Metal"/"Keys" amount pair + one "Auto-Select Items"
button to a scrap.tf auction page (scrap.tf/auctions/*), next to the
existing "Total: X Keys, Y Refined" / "Place Bid" controls - lets a user
type a target metal value and/or key count and have this feature pick and
click the matching backpack items itself, instead of clicking each
individual Scrap/Reclaimed/Refined Metal or Key icon one at a time (scrap.tf
shows every metal/key unit as its own separate item tile, never stacked, so
reaching e.g. "13.33 ref" natively means clicking 13 separate Refined Metal
tiles plus 1 Reclaimed Metal tile one by one).

Selection is done by dispatching a genuine, bubbling click MouseEvent on
each chosen item's own DOM element - not by reimplementing scrap.tf's own
bid-selection state (which items count as "selected", updating the running
"Total: ..." display, moving the item into the "Selected Items" list, etc.).
This runs scrap.tf's OWN existing click handling for that item exactly the
same way a real click would, so it can never drift out of sync with
whatever that handler actually does.

The typed amounts are the bid's TOTALS: what's already selected counts
toward them, so only the difference is added, and any excess is removed
(see planMetal). An empty field leaves that currency alone.
*/
import { createStopController } from "../../utils/clickItemsWithDelay.js";

// scrap.tf's own internal item-value scale, confirmed live from each
// backpack item's own "data-item-value" attribute: 1 Scrap Metal = 1 unit,
// 1 Reclaimed Metal = 3 units (= 3 scrap), 1 Refined Metal = 9 units (= 1
// ref), matching TF2's own 1 ref = 3 reclaimed = 9 scrap crafting ratio - so
// a target ref amount converts to this scale via *9, no separate lookup
// needed.
const METAL_UNIT_VALUE_BY_TITLE = {
  "Refined Metal": 9,
  "Reclaimed Metal": 3,
  "Scrap Metal": 1,
};
const KEY_TITLE = "Mann Co. Supply Crate Key";
const REFINED_PER_UNIT = 1 / 9;

const CONTROLS_ID = "tf2te-auction-bid-helper";
const STYLES_ID = "tf2te-auction-bid-helper-styles";

/*
@description: scrap.tf's own ".form-control" input styling reads fine for
typed text, but its placeholder text rendered essentially invisible against
the page's dark theme (confirmed live) - some Bootstrap themes set
placeholder color via a low-opacity/light value meant for a WHITE input
background, which this dark theme never overrides. Injected once, scoped to
this feature's own inputs only so it can't affect placeholder styling
anywhere else on the page.
*/
function injectStyles() {
  if (document.getElementById(STYLES_ID)) return;

  const style = document.createElement("style");
  style.id = STYLES_ID;
  style.textContent = `
    #${CONTROLS_ID} input::placeholder {
      color: #8a8a8a;
      opacity: 1;
    }
  `;
  document.head.appendChild(style);
}

/*
@description: Finds every currently-available (not yet selected/clicked)
backpack item tile - scoped to "#user-bp-440" (TF2's own appid) specifically
since scrap.tf's inventory switcher can show a different game's backpack
instead, and this feature (like the rest of this extension) is TF2-only.
Re-queried fresh on every Auto-Select click rather than cached, since
whichever items are still available changes as the user (or a previous
Auto-Select run) selects more of them.
*/
function getAvailableBackpackItems() {
  return Array.from(document.querySelectorAll('#user-bp-440 .items-container > .item[data-title]'));
}

/*
@description: Finds every currently-selected item tile - confirmed live via
its own outerHTML, scrap.tf moves a selected item into a SEPARATE
".selected-raffle-items .items-container" list (same plain ".item" shape as
the available-items grid, no dedicated "remove" button/icon of its own) -
clicking the tile again there is what un-selects it, the same click-to-toggle
mechanism as selecting it in the first place, just scoped to this other
container. Re-queried fresh each time this feature clicks through them (same
reasoning as getAvailableBackpackItems).
*/
function getSelectedBackpackItems() {
  return Array.from(document.querySelectorAll('.selected-raffle-items .items-container > .item[data-title]'));
}

function metalUnitValue(el) {
  return METAL_UNIT_VALUE_BY_TITLE[el.dataset.title];
}

/*
@description: Plans the clicks that make the bid's SELECTED metal add up to
exactly targetUnits (scrap.tf's own unit scale, 9 = 1 ref) - the typed
amount is the bid's total, not an amount to add on top (asked for: re-running
after a Stop, or after selecting some by hand, must top up or trim, never
pile the whole amount on again or drop what's already there).

Greedy over every metal tile, selected and available alike, largest first -
optimal here since 3 divides 9 and 1 divides 3 (making change with 1/3/9
coins). Among tiles of the same value, already-selected ones come first, so
they're kept and the fewest clicks are needed.
@returns: { toSelect, toDeselect, remainingUnits } - remainingUnits is how
much of the target couldn't be reached with everything owned (0 if it
could).
*/
export function planMetal(targetUnits, selectedItems, availableItems) {
  const selectedMetal = selectedItems.filter((el) => metalUnitValue(el) != null);
  const selectedSet = new Set(selectedMetal);
  const pool = [...selectedMetal, ...availableItems.filter((el) => metalUnitValue(el) != null)];
  pool.sort((a, b) => metalUnitValue(b) - metalUnitValue(a) || selectedSet.has(b) - selectedSet.has(a));

  const keep = new Set();
  let remaining = targetUnits;
  for (const el of pool) {
    if (remaining <= 0) break;
    if (metalUnitValue(el) <= remaining) {
      keep.add(el);
      remaining -= metalUnitValue(el);
    }
  }

  return {
    toSelect: pool.filter((el) => keep.has(el) && !selectedSet.has(el)),
    toDeselect: selectedMetal.filter((el) => !keep.has(el)),
    remainingUnits: remaining,
  };
}

/*
@description: Same as planMetal, for keys: keeps up to targetCount of the
already-selected keys, removes any beyond it, adds the rest from the
backpack.
@returns: { toSelect, toDeselect, remainingCount } - remainingCount is how
many more keys were asked for than are owned.
*/
export function planKeys(targetCount, selectedItems, availableItems) {
  const selectedKeys = selectedItems.filter((el) => el.dataset.title === KEY_TITLE);
  const availableKeys = availableItems.filter((el) => el.dataset.title === KEY_TITLE);
  const missing = Math.max(0, targetCount - selectedKeys.length);
  const toSelect = availableKeys.slice(0, missing);
  return {
    toSelect,
    toDeselect: selectedKeys.slice(targetCount),
    remainingCount: missing - toSelect.length,
  };
}

/*
@description: A typed amount, or null for an empty field - an empty field
leaves that currency's selection as it is; "0" removes all of it.
*/
function readAmount(input, parse) {
  if (input.value.trim() === "") return null;
  const value = parse(input.value);
  return Number.isFinite(value) ? Math.max(0, value) : null;
}

function createBidHelperControls() {
  const wrapper = document.createElement("div");
  wrapper.id = CONTROLS_ID;
  wrapper.style.display = "flex";
  wrapper.style.flexWrap = "wrap";
  wrapper.style.alignItems = "center";
  wrapper.style.gap = "6px";
  wrapper.style.margin = "8px 0";

  const label = document.createElement("span");
  label.className = "bp-txt";
  label.textContent = "Auto-select for bid:";

  const keysInput = document.createElement("input");
  keysInput.type = "number";
  keysInput.min = "0";
  keysInput.step = "1";
  keysInput.placeholder = "keys";
  keysInput.className = "form-control";
  keysInput.style.width = "80px";
  keysInput.style.display = "inline-block";

  const metalInput = document.createElement("input");
  metalInput.type = "number";
  metalInput.min = "0";
  // "any", not "0.11": native step validation would flag valid values like
  // "3" (0.11 does not divide it evenly).
  metalInput.step = "any";
  metalInput.placeholder = "refs";
  metalInput.className = "form-control";
  metalInput.style.width = "100px";
  metalInput.style.display = "inline-block";

  const selectBtn = document.createElement("button");
  selectBtn.type = "button";
  selectBtn.className = "btn btn-embossed btn-info";
  selectBtn.textContent = "Auto-Select Items";

  // Clears by clicking each selected tile again (see
  // getSelectedBackpackItems). scrap.tf's own #ClearSelectedReverse eraser
  // does not work on auction pages ("Invalid SellType: viewauction").
  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "btn btn-embossed btn-info";
  clearBtn.textContent = "Clear All";

  const statusEl = document.createElement("span");
  statusEl.style.fontSize = "12px";
  statusEl.style.color = "#a8a196";

  const DEFAULT_BORDER_COLOR = "";
  const ERROR_COLOR = "#e04b4b";
  const NEUTRAL_COLOR = "#a8a196";

  wrapper.append(label, keysInput, metalInput, selectBtn, clearBtn, statusEl);

  // One run at a time: the running button reads "Stop", the other is
  // disabled (see createStopController).
  const stopController = createStopController([selectBtn, clearBtn]);

  selectBtn.addEventListener("click", async () => {
    if (stopController.stopIfRunning()) return;

    const targetKeys = readAmount(keysInput, (v) => parseInt(v, 10));
    const targetRefined = readAmount(metalInput, parseFloat);

    keysInput.style.borderColor = DEFAULT_BORDER_COLOR;
    metalInput.style.borderColor = DEFAULT_BORDER_COLOR;

    if (targetRefined === null && targetKeys === null) {
      statusEl.style.color = NEUTRAL_COLOR;
      statusEl.textContent = "Enter a metal value and/or key count first.";
      return;
    }

    // Rounded to the nearest whole scrap.tf unit (0.11 ref) - every metal
    // tile is a whole multiple of it. A small nonzero amount is floored at
    // 1 unit rather than rounding down to 0, which would remove all metal.
    const targetUnits = targetRefined === null ? null : targetRefined > 0 ? Math.max(1, Math.round(targetRefined * 9)) : 0;

    // Planned against what's selected right now, so the typed amounts are
    // the bid's totals. Only reads - availability is checked before anything
    // is clicked: a target that can't be fully met changes nothing.
    const selectedItems = getSelectedBackpackItems();
    const availableItems = getAvailableBackpackItems();
    const keyPlan = targetKeys === null ? null : planKeys(targetKeys, selectedItems, availableItems);
    const metalPlan = targetUnits === null ? null : planMetal(targetUnits, selectedItems, availableItems);

    const errors = [];
    if (keyPlan?.remainingCount > 0) {
      keysInput.style.borderColor = ERROR_COLOR;
      errors.push(`${keyPlan.remainingCount} key${keyPlan.remainingCount === 1 ? "" : "s"} short`);
    }
    if (metalPlan?.remainingUnits > 0) {
      metalInput.style.borderColor = ERROR_COLOR;
      errors.push(`${(metalPlan.remainingUnits * REFINED_PER_UNIT).toFixed(2)} ref short`);
    }

    if (errors.length > 0) {
      statusEl.style.color = ERROR_COLOR;
      statusEl.textContent = `Not enough in your backpack (${errors.join(", ")}) - nothing changed.`;
      return;
    }

    // Removals first, then additions (clicking a selected tile removes it).
    const toDeselect = [...(keyPlan?.toDeselect ?? []), ...(metalPlan?.toDeselect ?? [])];
    const toSelect = [...(keyPlan?.toSelect ?? []), ...(metalPlan?.toSelect ?? [])];
    const clicks = [...toDeselect, ...toSelect];
    statusEl.style.color = NEUTRAL_COLOR;

    if (clicks.length === 0) {
      statusEl.textContent = "Already selected - nothing to change.";
      return;
    }

    statusEl.textContent = "Selecting…";
    const { clicked, stopped } = await stopController.run(selectBtn, clicks);

    if (stopped) {
      // Inputs kept: clicking Auto-Select again finishes from what's selected.
      statusEl.textContent = `Stopped after ${clicked} of ${clicks.length} changes. Auto-Select again to finish.`;
      return;
    }

    // Inputs are cleared only on success, so a failed attempt can be
    // adjusted rather than retyped.
    keysInput.value = "";
    metalInput.value = "";

    const changes = [];
    if (toSelect.length) changes.push(`added ${toSelect.length}`);
    if (toDeselect.length) changes.push(`removed ${toDeselect.length}`);
    statusEl.textContent = `Done: ${changes.join(", ")}.`;
  });

  clearBtn.addEventListener("click", async () => {
    if (stopController.stopIfRunning()) return;

    const selectedItems = getSelectedBackpackItems();

    if (selectedItems.length === 0) {
      statusEl.style.color = NEUTRAL_COLOR;
      statusEl.textContent = "Nothing selected.";
      return;
    }

    statusEl.style.color = NEUTRAL_COLOR;
    statusEl.textContent = "Clearing…";

    const { clicked, stopped } = await stopController.run(clearBtn, selectedItems);

    statusEl.textContent = stopped ? `Stopped after clearing ${clicked} item${clicked === 1 ? "" : "s"}.` : "Cleared.";
  });

  return wrapper;
}

function findFilterRow() {
  return document.querySelector(".rev-filters .row.text-center");
}

/*
@description: The filter row (unlike the backpack item grid below it) is
part of the auction page's own initial markup, not something that loads in
later via AJAX - but waits for it anyway via MutationObserver rather than
assuming it, in case scrap.tf ever renders this section client-side too.
Gives up silently after timeoutMs.
*/
function waitForFilterRow(callback, timeoutMs = 15000) {
  const existing = findFilterRow();
  if (existing) {
    callback(existing);
    return;
  }

  const observer = new MutationObserver(() => {
    const row = findFilterRow();
    if (row) {
      observer.disconnect();
      clearTimeout(timeoutId);
      callback(row);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  const timeoutId = setTimeout(() => observer.disconnect(), timeoutMs);
}

export function auctionBidHelper() {
  waitForFilterRow((filterRow) => {
    if (document.getElementById(CONTROLS_ID)) return; // already inserted

    injectStyles();
    const controls = createBidHelperControls();
    filterRow.insertAdjacentElement("afterend", controls);
  });
}
