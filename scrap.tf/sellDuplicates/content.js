/*
@description: Adds a "Select Duplicates" button to scrap.tf's Sell Items
pages (scrap.tf/sell/*) that auto-selects every SPARE copy of an owned item
currently shown (2nd, 3rd, ... copy of the same item type/quality), leaving
exactly one copy of each type unselected - a quick way to bulk-stage
duplicate stock weapons (or any other duplicated item type, on whichever
category tab is active) for a sell trade while keeping one of each for
crafting/backup, instead of clicking through dozens of identical tiles by
hand.

Selection is done by dispatching a genuine, bubbling click MouseEvent on each
chosen item's own DOM element - same technique scrap.tf/auctionBidHelper's
own Auto-Select uses (see that file's own note on why: this runs scrap.tf's
OWN existing click handling for that tile exactly the same way a real click
would, so it can never drift out of sync with whatever that handler actually
does), not by reimplementing scrap.tf's own selection state.

Confirmed live (via a real backpack sample, both before/after clicking one
tile by hand): selecting an item tile adds a "selected-item" class to it
WITHOUT removing it from .items-container - unlike scrap.tf/auctionBidHelper's
own auction-page item picker, where a selected tile disappears from its own
container entirely. So "already selected" here has to be read off that class,
not inferred from container membership the way that other feature does.
*/
import { getQualityIdFromClassList } from "../../utils/tf2Quality.js";
import { getPaintName, getSheenName, getKillstreakerName, getSpellName, getUnusualEffectName } from "../itemLinks/tooltipData.js";
import { createStopController } from "../../utils/clickItemsWithDelay.js";
import { getKillstreakTier } from "../shared/getKillstreakTier.js";

const CONTROLS_ID = "tf2te-sell-duplicates";
// Confirmed live: the sell page's own backpack grid lives at the exact same
// #user-bp-440/.items-container structure scrap.tf/auctionBidHelper's own
// getAvailableBackpackItems already uses on the auction page.
const BACKPACK_SELECTOR = "#user-bp-440 .items-container .item[data-defindex]";
// Confirmed live: the row holding the filter toggle, the "Search for items"
// input, and the "Clear Selected" eraser button - the controls below are
// appended here (after the eraser button) so they read as part of the same
// toolbar rather than a separate section above the item grid.
const TOOLBAR_SELECTOR = "#reverse-header .rev-filters .form-inline";

/*
@description: Never auto-selected, even if it means a duplicate group's spare
count comes up short of "leave exactly one" - confirmed live, scrap.tf's own
tooltip (data-content) labels a currently in-game-equipped item with an
"Equipped on <Class>" line, and staging that specific instance for a sell
trade (even though any other copy of the same stock weapon is functionally
identical in TF2 itself) risks surprising a user who specifically kept THAT
instance equipped - or who gave it a custom craft name/number (the one real
"Crafted by ... Craft #N" example seen live only ever showed up on one of two
otherwise-identical duplicate copies, with the OTHER copy being the equipped
one). Safer to just sell one fewer of that particular group than to guess
which copy is "safe" to touch.
*/
export function isEquipped(el) {
  return /Equipped on/.test(el.dataset.content || "");
}

/*
@description: Groups every currently-visible backpack tile by item identity -
defindex + Valve quality id + killstreak tier (a Killstreak weapon shares its
plain counterpart's defindex and quality, so tier must be part of the key),
plus Paint/Sheen/Killstreaker/Halloween Spell/
Unusual effect name (via itemLinks/tooltipData.js's own data-content
extractors, the same signals already trusted elsewhere in this codebase for
per-item identity) - two items sharing a defindex/quality/killstreak-tier but
differing in one of those still customize the item's own value/desirability,
so treating them as interchangeable could sell the more customized copy.
NOT a complete identity check - Strange Parts specifically
have no existing data-content (or other) extractor anywhere in this codebase
to read which parts are attached on scrap.tf's own tile markup, so two
otherwise-identical Strange items differing only by attached Strange Parts
can still collapse into one group; narrowing further than this isn't
possible without building that extractor first. offsetParent !== null scopes
this to whichever category tab is actually showing right now - a defensive
check even though a real backpack sample only ever contained Weapons-slot
items while the Weapons tab was active (suggesting the grid may only ever
hold the active category's tiles at all), since that wasn't independently
confirmed against every tab.
@returns: Map<string, HTMLElement[]> keyed by "defindex::qualityId::killstreakTier::paint::sheen::killstreaker::spell::effect",
only for groups with length > 1.
*/
export function findDuplicateGroups() {
  const tiles = Array.from(document.querySelectorAll(BACKPACK_SELECTOR)).filter((el) => el.offsetParent !== null);

  const groups = new Map();
  for (const el of tiles) {
    const key = [
      el.dataset.defindex,
      getQualityIdFromClassList(el.classList),
      getKillstreakTier(el.classList),
      getPaintName(el),
      getSheenName(el),
      getKillstreakerName(el),
      getSpellName(el),
      getUnusualEffectName(el),
    ].join("::");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(el);
  }

  for (const key of Array.from(groups.keys())) {
    if (groups.get(key).length <= 1) groups.delete(key);
  }

  return groups;
}

/*
@description: For one duplicate group, picks which not-yet-selected,
not-equipped tiles still need a click to reach "every copy but one selected".
Already-selected tiles count toward that target without being re-clicked -
running this again later (or after some copies were selected by hand) only
tops up what's missing, it never re-clicks an already-selected tile.
*/
export function pickTilesToSelect(tiles) {
  const alreadySelected = tiles.filter((el) => el.classList.contains("selected-item"));
  const target = tiles.length - 1 - alreadySelected.length;
  if (target <= 0) return [];

  const candidates = tiles.filter((el) => !el.classList.contains("selected-item") && !isEquipped(el));
  return candidates.slice(0, target);
}

function createControls() {
  // inline-flex (not the default block) so this sits on the same line as
  // the toolbar's own filter/search/clear-selected buttons instead of
  // wrapping onto its own row underneath them.
  const wrapper = document.createElement("div");
  wrapper.id = CONTROLS_ID;
  wrapper.style.display = "inline-flex";
  wrapper.style.alignItems = "center";
  wrapper.style.gap = "8px";
  wrapper.style.marginLeft = "8px";
  wrapper.style.verticalAlign = "middle";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn btn-embossed btn-info";
  btn.textContent = "Select Duplicates (keep 1 of each)";

  const statusEl = document.createElement("span");
  statusEl.className = "bp-txt";
  statusEl.style.fontSize = "12px";
  statusEl.style.color = "#a8a196";

  // While a run is going this button reads "Stop" (see createStopController).
  const stopController = createStopController([btn]);

  btn.addEventListener("click", async () => {
    if (stopController.stopIfRunning()) return;

    const groups = findDuplicateGroups();

    const toSelect = [];
    for (const tiles of groups.values()) {
      toSelect.push(...pickTilesToSelect(tiles));
    }

    if (toSelect.length === 0) {
      statusEl.textContent = "No spare duplicates to select.";
      return;
    }

    statusEl.textContent = `Selecting ${toSelect.length} item${toSelect.length === 1 ? "" : "s"}...`;

    const { clicked, stopped } = await stopController.run(btn, toSelect);

    statusEl.textContent = stopped
      ? `Stopped after selecting ${clicked} duplicate${clicked === 1 ? "" : "s"}.`
      : `Selected ${clicked} duplicate${clicked === 1 ? "" : "s"}.`;
  });

  wrapper.append(btn, statusEl);
  return wrapper;
}

function ensureControlsInserted() {
  const toolbarEl = document.querySelector(TOOLBAR_SELECTOR);
  if (!toolbarEl) return;
  if (document.getElementById(CONTROLS_ID)) return; // already inserted (and still in the DOM)

  toolbarEl.appendChild(createControls());
}

export function sellDuplicates() {
  ensureControlsInserted();

  // It's not confirmed whether TOOLBAR_SELECTOR's row is part of the page's
  // static initial markup or loads/re-renders via AJAX like the backpack
  // grid itself does, nor whether scrap.tf's own category tab switcher ever
  // replaces that row's DOM node outright - if it does, our inserted
  // controls would be wiped out along with it. Rather than a one-shot "wait
  // for it to appear once" (see scrap.tf/auctionBidHelper's own
  // waitForFilterRow for that pattern, used where this uncertainty doesn't
  // apply), this keeps re-checking on every mutation for the rest of the
  // page's lifetime and cheaply re-inserts the controls any time they've
  // gone missing, so it stays correct either way without needing to know
  // which case is actually true.
  const observer = new MutationObserver(() => ensureControlsInserted());
  observer.observe(document.body, { childList: true, subtree: true });
}
