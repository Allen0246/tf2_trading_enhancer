import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sellSelectButtons,
  findDuplicateGroups,
  pickDuplicatesToSelect,
  pickUnselectedVisibleItems,
} from "../stntrading.eu/sellSelectButtons/content.js";

const CONTROLS_ID = "tf2te-sell-select-buttons";
const TOOLBAR_SELECTOR = '.btn-toolbar[role="toolbar"]';

// Minimal fake DOM element - same shape tests/sellDuplicates.test.js's own
// FakeElement uses (classList, dataset, style, addEventListener/
// dispatchEvent, appendChild/append, id/textContent), just enough surface
// for sellSelectButtons()'s own DOM-orchestration to run against without
// pulling in jsdom. dispatchEvent returns Promise.all(...) of whatever its
// listeners returned so a test can `await` a dispatched click straight
// through an async click handler instead of guessing how many microtask
// ticks to flush.
class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.style = {};
    this.dataset = {};
    this.children = [];
    this.disabled = false;
    this._attrs = {};
    this._id = "";
    this._textContent = "";
    this._listeners = {};
    this.classList = {
      _set: new Set(),
      contains(name) {
        return this._set.has(name);
      },
      add(name) {
        this._set.add(name);
      },
      toggle(name) {
        if (this._set.has(name)) this._set.delete(name);
        else this._set.add(name);
      },
    };
  }
  get id() {
    return this._id;
  }
  set id(v) {
    this._id = v;
    if (v) attachedById.set(v, this);
  }
  get textContent() {
    return this._textContent;
  }
  set textContent(v) {
    this._textContent = v;
  }
  addEventListener(type, cb) {
    (this._listeners[type] ||= []).push(cb);
  }
  hasAttribute(name) {
    return name in this._attrs;
  }
  setAttribute(name, value) {
    this._attrs[name] = value;
  }
  getAttribute(name) {
    return name in this._attrs ? this._attrs[name] : null;
  }
  dispatchEvent(evt) {
    const results = (this._listeners[evt.type] || []).map((cb) => cb(evt));
    return Promise.all(results);
  }
  appendChild(child) {
    this.children.push(child);
    if (child.id) attachedById.set(child.id, child);
    return child;
  }
  append(...items) {
    for (const item of items) this.appendChild(item);
  }
}

let attachedById; // reset per test, simulates "still present in the live DOM"

function removeAllChildren(el) {
  for (const child of el.children) {
    if (child.id) attachedById.delete(child.id);
  }
  el.children = [];
}

// duplicate=true sets the real, confirmed-live empty-valued "duplicate"
// attribute (hasAttribute("duplicate") is what findDuplicateGroups reads,
// not its value). itemname/quality mirror the tile's own real attributes -
// findDuplicateGroups groups by "itemname::quality". selected=true sets the
// confirmed-live `selected` class stntrading.eu adds to a selected tile.
function makeTileEl({ duplicate = false, visible = true, selected = false, itemname = "Rocket Launcher", quality = "6" } = {}) {
  const el = new FakeElement("div");
  if (duplicate) el.setAttribute("duplicate", "");
  if (selected) el.classList.add("selected");
  el.setAttribute("itemname", itemname);
  el.setAttribute("quality", quality);
  el.offsetParent = visible ? {} : null;
  return el;
}

class FakeMutationObserver {
  constructor(cb) {
    this.cb = cb;
    FakeMutationObserver.instances.push(this);
  }
  observe(target, opts) {
    this.target = target;
    this.opts = opts;
  }
  disconnect() {}
}
FakeMutationObserver.instances = [];

// sellSelectButtons()'s own createControls/clickItemsWithDelay reference the
// browser globals MutationObserver, MouseEvent and window, none of which
// exist in plain Node.
function installDomGlobals({ toolbarEl = null, tiles = [] } = {}) {
  attachedById = new Map();
  FakeMutationObserver.instances = [];
  const bodyEl = new FakeElement("body");

  global.document = {
    querySelector: (selector) => (selector === TOOLBAR_SELECTOR ? toolbarEl : null),
    querySelectorAll: () => tiles,
    getElementById: (id) => attachedById.get(id) || null,
    createElement: (tag) => new FakeElement(tag),
    body: bodyEl,
  };
  global.MutationObserver = FakeMutationObserver;
  global.MouseEvent = class MouseEvent {
    constructor(type, opts) {
      this.type = type;
      Object.assign(this, opts);
    }
  };
  global.window = global;
  // clickItemsWithDelay's 120ms stagger would otherwise slow the suite down
  // for no benefit - the test only cares about call order/final state, not
  // real wall-clock timing, so resolve immediately instead of after 120ms.
  global.setTimeout = (fn) => fn();

  return { bodyEl };
}

test("sellSelectButtons does nothing (and doesn't throw) when the toolbar row isn't present yet", () => {
  installDomGlobals({ toolbarEl: null });

  sellSelectButtons();

  assert.equal(document.getElementById(CONTROLS_ID), null);
  // The MutationObserver still gets set up so a later-appearing toolbar
  // (e.g. after an AJAX re-render or a category-tab switch) gets picked up
  // on the next mutation.
  assert.equal(FakeMutationObserver.instances.length, 1);
  assert.equal(FakeMutationObserver.instances[0].target, document.body);
});

test("sellSelectButtons inserts the controls into the toolbar exactly once", () => {
  const toolbarEl = new FakeElement("div");
  installDomGlobals({ toolbarEl });

  sellSelectButtons();
  assert.equal(toolbarEl.children.length, 1);
  assert.equal(toolbarEl.children[0].id, CONTROLS_ID);

  // A later mutation notification (nothing actually changed) must not
  // duplicate the controls - ensureControlsInserted's own getElementById
  // check should short-circuit.
  FakeMutationObserver.instances[0].cb();
  assert.equal(toolbarEl.children.length, 1);
});

test("the MutationObserver re-inserts the controls if stntrading.eu's own re-render wipes them out", () => {
  const toolbarEl = new FakeElement("div");
  installDomGlobals({ toolbarEl });

  sellSelectButtons();
  assert.equal(toolbarEl.children.length, 1);

  removeAllChildren(toolbarEl); // simulate the toolbar row's DOM node being replaced
  assert.equal(document.getElementById(CONTROLS_ID), null);

  FakeMutationObserver.instances[0].cb();

  assert.equal(toolbarEl.children.length, 1);
  assert.equal(toolbarEl.children[0].id, CONTROLS_ID);
});

test("'Select All' shows the empty-state status and never disables either button when there are no items", async () => {
  const toolbarEl = new FakeElement("div");
  installDomGlobals({ toolbarEl, tiles: [] });

  sellSelectButtons();
  const [selectAllBtn, selectDuplicatesBtn, statusEl] = toolbarEl.children[0].children;

  await selectAllBtn.dispatchEvent({ type: "click" });

  assert.equal(statusEl.textContent, "No items to select.");
  assert.equal(selectAllBtn.disabled, false);
  assert.equal(selectDuplicatesBtn.disabled, false);
});

test("'Select All' clicks every visible tile, turning itself into a 'Stop' button (not disabled) while disabling the OTHER button", async () => {
  const toolbarEl = new FakeElement("div");
  const tiles = [makeTileEl(), makeTileEl(), makeTileEl({ visible: false })];
  installDomGlobals({ toolbarEl, tiles });

  sellSelectButtons();
  const [selectAllBtn, selectDuplicatesBtn, statusEl] = toolbarEl.children[0].children;

  let clickedCount = 0;
  tiles.forEach((el) => el.addEventListener("click", () => clickedCount++));

  const clickPromise = selectAllBtn.dispatchEvent({ type: "click" });
  // The synchronous portion of the async click handler (up through the
  // "Selecting..." status write) has already run by the time dispatchEvent
  // returns, since it all happens before the handler's first await.
  assert.equal(selectAllBtn.textContent, "Stop");
  assert.equal(selectAllBtn.disabled, false); // stays clickable - it's the Stop button now
  assert.equal(selectDuplicatesBtn.disabled, true); // the OTHER button is what's disabled
  assert.equal(statusEl.textContent, "Selecting 2 items...");

  await clickPromise;

  // Only the 2 VISIBLE tiles were clicked - the hidden one (offsetParent
  // null, e.g. filtered out by a category tab) is skipped.
  assert.equal(clickedCount, 2);
  assert.equal(selectAllBtn.textContent, "Select All"); // restored once the run finishes
  assert.equal(selectAllBtn.disabled, false);
  assert.equal(selectDuplicatesBtn.disabled, false);
  assert.equal(statusEl.textContent, "Selected 2 items.");
});

test("clicking 'Stop' mid-run stops the remaining clicks and reports how many were actually selected", async () => {
  // A REAL setTimeout here (not the immediate-resolve stub installDomGlobals
  // installs) - the whole point of this test is to click "Stop" DURING the
  // stagger, between two of clickItemsWithDelay's own awaited delays, which
  // an immediately-resolving setTimeout would never leave room for.
  const realSetTimeout = setTimeout;
  const toolbarEl = new FakeElement("div");
  const tiles = [makeTileEl(), makeTileEl(), makeTileEl(), makeTileEl()];
  installDomGlobals({ toolbarEl, tiles });
  global.setTimeout = (fn, delay) => realSetTimeout(fn, delay);

  sellSelectButtons();
  const [selectAllBtn, selectDuplicatesBtn, statusEl] = toolbarEl.children[0].children;

  let clickedCount = 0;
  tiles.forEach((el) => el.addEventListener("click", () => clickedCount++));

  const runPromise = selectAllBtn.dispatchEvent({ type: "click" });
  assert.equal(selectAllBtn.textContent, "Stop");

  // Let the first tile's own click + stagger delay land, then hit Stop
  // before the loop reaches its 2nd/3rd/4th tile.
  await new Promise((resolve) => realSetTimeout(resolve, 130));
  assert.ok(clickedCount >= 1 && clickedCount < 4); // stopped partway through
  await selectAllBtn.dispatchEvent({ type: "click" }); // the "Stop" click itself

  await runPromise;

  assert.ok(clickedCount < 4); // never reached the last tile(s)
  assert.equal(statusEl.textContent, `Stopped after selecting ${clickedCount} item${clickedCount === 1 ? "" : "s"}.`);
  assert.equal(selectAllBtn.textContent, "Select All"); // restored
  assert.equal(selectAllBtn.disabled, false);
  assert.equal(selectDuplicatesBtn.disabled, false);
});

test("'Select All' uses singular wording when exactly one item is selected", async () => {
  const toolbarEl = new FakeElement("div");
  installDomGlobals({ toolbarEl, tiles: [makeTileEl()] });

  sellSelectButtons();
  const [selectAllBtn, , statusEl] = toolbarEl.children[0].children;

  const clickPromise = selectAllBtn.dispatchEvent({ type: "click" });
  assert.equal(statusEl.textContent, "Selecting 1 item...");

  await clickPromise;
  assert.equal(statusEl.textContent, "Selected 1 item.");
});

test("findDuplicateGroups groups visible duplicate-flagged tiles by itemname::quality, dropping non-duplicate-flagged ones entirely", () => {
  const plainTile = makeTileEl({ duplicate: false });
  const rocketA = makeTileEl({ duplicate: true, itemname: "Rocket Launcher", quality: "6" });
  const rocketB = makeTileEl({ duplicate: true, itemname: "Rocket Launcher", quality: "6" });
  const strangeRocket = makeTileEl({ duplicate: true, itemname: "Strange Rocket Launcher", quality: "11" });
  global.document = { querySelectorAll: () => [plainTile, rocketA, rocketB, strangeRocket] };

  const groups = findDuplicateGroups();

  // plainTile never appears at all (no "duplicate" attribute) - even a
  // singleton "duplicate"-flagged group (strangeRocket, alone) stays in the
  // map here, unlike scrap.tf's own findDuplicateGroups (which drops
  // singletons itself) - this file relies entirely on stntrading.eu's own
  // "duplicate" attribute to have already decided what counts as a group.
  assert.equal(groups.size, 2);
  assert.deepEqual(groups.get("Rocket Launcher::6"), [rocketA, rocketB]);
  assert.deepEqual(groups.get("Strange Rocket Launcher::11"), [strangeRocket]);
});

// "Select Duplicates" must keep one copy of each item: selecting every
// duplicate-flagged tile would stage every last copy instead of leaving one
// behind.
test("pickDuplicatesToSelect leaves exactly one tile unselected per duplicate group", () => {
  const rocketA = makeTileEl({ duplicate: true, itemname: "Rocket Launcher", quality: "6" });
  const rocketB = makeTileEl({ duplicate: true, itemname: "Rocket Launcher", quality: "6" });
  const rocketC = makeTileEl({ duplicate: true, itemname: "Rocket Launcher", quality: "6" });
  global.document = { querySelectorAll: () => [rocketA, rocketB, rocketC] };

  const toSelect = pickDuplicatesToSelect();

  assert.equal(toSelect.length, 2); // 3 copies - 1 kept = 2 selected
  assert.equal(toSelect.includes(rocketA), false); // the first tile in the group is the one kept
});

test("pickDuplicatesToSelect returns nothing for a lone duplicate-flagged tile with no group-mate", () => {
  const lone = makeTileEl({ duplicate: true, itemname: "Strange Rocket Launcher", quality: "11" });
  global.document = { querySelectorAll: () => [lone] };

  assert.deepEqual(pickDuplicatesToSelect(), []);
});

test("'Select Duplicates' clicks all-but-one tile per duplicate group, ignoring plain (non-duplicate-flagged) ones", async () => {
  const toolbarEl = new FakeElement("div");
  const plainTile = makeTileEl({ duplicate: false, itemname: "Rocket Launcher", quality: "6" });
  const rocketA = makeTileEl({ duplicate: true, itemname: "Rocket Launcher", quality: "6" });
  const rocketB = makeTileEl({ duplicate: true, itemname: "Rocket Launcher", quality: "6" });
  installDomGlobals({ toolbarEl, tiles: [plainTile, rocketA, rocketB] });

  sellSelectButtons();
  const [, selectDuplicatesBtn, statusEl] = toolbarEl.children[0].children;

  const clicked = [];
  [plainTile, rocketA, rocketB].forEach((el, i) => el.addEventListener("click", () => clicked.push(i)));

  // rocketA/rocketB share one group (2 copies) - one is kept, one selected.
  const clickPromise = selectDuplicatesBtn.dispatchEvent({ type: "click" });
  assert.equal(statusEl.textContent, "Selecting 1 item...");

  await clickPromise;

  assert.deepEqual(clicked, [2]); // plainTile (0) never clicked, rocketA (1, kept) never clicked
  assert.equal(statusEl.textContent, "Selected 1 duplicate.");
});

test("'Select Duplicates' shows its own empty-state status when there are no spare duplicates (only singletons)", async () => {
  const toolbarEl = new FakeElement("div");
  const lone = makeTileEl({ duplicate: true, itemname: "Strange Rocket Launcher", quality: "11" });
  installDomGlobals({ toolbarEl, tiles: [lone] });

  sellSelectButtons();
  const [, selectDuplicatesBtn, statusEl] = toolbarEl.children[0].children;

  await selectDuplicatesBtn.dispatchEvent({ type: "click" });

  assert.equal(statusEl.textContent, "No spare duplicates to select.");
});

test("'Select Duplicates' respects visibility too - a hidden duplicate tile isn't counted into its group at all", async () => {
  const toolbarEl = new FakeElement("div");
  const hiddenDup = makeTileEl({ duplicate: true, visible: false, itemname: "Rocket Launcher", quality: "6" });
  const visibleDup1 = makeTileEl({ duplicate: true, visible: true, itemname: "Rocket Launcher", quality: "6" });
  const visibleDup2 = makeTileEl({ duplicate: true, visible: true, itemname: "Rocket Launcher", quality: "6" });
  installDomGlobals({ toolbarEl, tiles: [hiddenDup, visibleDup1, visibleDup2] });

  sellSelectButtons();
  const [, selectDuplicatesBtn, statusEl] = toolbarEl.children[0].children;

  const clicked = [];
  [hiddenDup, visibleDup1, visibleDup2].forEach((el, i) => el.addEventListener("click", () => clicked.push(i)));

  await selectDuplicatesBtn.dispatchEvent({ type: "click" });

  // Only the 2 visible tiles form the group - 1 kept, 1 selected; the
  // hidden one is invisible to findDuplicateGroups entirely.
  assert.deepEqual(clicked, [2]);
  assert.equal(statusEl.textContent, "Selected 1 duplicate.");
});

// Clicking a tile on stntrading.eu toggles its selection, so these mirror that
// with a click listener that toggles the `selected` class.
function toggleSelectionOnClick(tiles) {
  tiles.forEach((el) => el.addEventListener("click", () => el.classList.toggle("selected")));
}

test("pickUnselectedVisibleItems skips tiles that are already selected", () => {
  const selectedTile = makeTileEl({ selected: true });
  const freeTile = makeTileEl();
  const hiddenTile = makeTileEl({ visible: false });
  global.document = { querySelectorAll: () => [selectedTile, freeTile, hiddenTile] };

  assert.deepEqual(pickUnselectedVisibleItems(), [freeTile]);
});

// Regression: a second "Select All" run re-clicked every tile, which on
// stntrading.eu un-selects the ones the first run had selected.
test("running 'Select All' twice leaves every visible tile selected instead of toggling them back off", async () => {
  const toolbarEl = new FakeElement("div");
  const tiles = [makeTileEl(), makeTileEl(), makeTileEl()];
  installDomGlobals({ toolbarEl, tiles });
  toggleSelectionOnClick(tiles);

  sellSelectButtons();
  const [selectAllBtn, , statusEl] = toolbarEl.children[0].children;

  await selectAllBtn.dispatchEvent({ type: "click" });
  assert.equal(statusEl.textContent, "Selected 3 items.");

  await selectAllBtn.dispatchEvent({ type: "click" });

  assert.ok(tiles.every((el) => el.classList.contains("selected")));
  assert.equal(statusEl.textContent, "No items to select.");
});

test("'Select All' only clicks the tiles not already selected by hand", async () => {
  const toolbarEl = new FakeElement("div");
  const tiles = [makeTileEl({ selected: true }), makeTileEl(), makeTileEl({ selected: true })];
  installDomGlobals({ toolbarEl, tiles });
  toggleSelectionOnClick(tiles);

  sellSelectButtons();
  const [selectAllBtn, , statusEl] = toolbarEl.children[0].children;

  await selectAllBtn.dispatchEvent({ type: "click" });

  assert.ok(tiles.every((el) => el.classList.contains("selected")));
  assert.equal(statusEl.textContent, "Selected 1 item.");
});

test("pickDuplicatesToSelect counts already-selected copies toward the 'all but one' target", () => {
  const rocketA = makeTileEl({ duplicate: true });
  const rocketB = makeTileEl({ duplicate: true, selected: true });
  const rocketC = makeTileEl({ duplicate: true });
  global.document = { querySelectorAll: () => [rocketA, rocketB, rocketC] };

  // 3 copies, 1 already selected: one more click reaches 2 selected, and the
  // first copy is the one kept.
  assert.deepEqual(pickDuplicatesToSelect(), [rocketC]);
});

test("pickDuplicatesToSelect never clicks a group that already has every copy selected", () => {
  const rocketA = makeTileEl({ duplicate: true, selected: true });
  const rocketB = makeTileEl({ duplicate: true, selected: true });
  global.document = { querySelectorAll: () => [rocketA, rocketB] };

  assert.deepEqual(pickDuplicatesToSelect(), []);
});

test("running 'Select Duplicates' twice keeps exactly one copy unselected per group", async () => {
  const toolbarEl = new FakeElement("div");
  const tiles = [makeTileEl({ duplicate: true }), makeTileEl({ duplicate: true }), makeTileEl({ duplicate: true })];
  installDomGlobals({ toolbarEl, tiles });
  toggleSelectionOnClick(tiles);

  sellSelectButtons();
  const [, selectDuplicatesBtn, statusEl] = toolbarEl.children[0].children;

  await selectDuplicatesBtn.dispatchEvent({ type: "click" });
  await selectDuplicatesBtn.dispatchEvent({ type: "click" });

  assert.equal(tiles.filter((el) => el.classList.contains("selected")).length, 2);
  assert.equal(statusEl.textContent, "No spare duplicates to select.");
});
