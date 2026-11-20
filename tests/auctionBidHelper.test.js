import { test } from "node:test";
import assert from "node:assert/strict";
import { auctionBidHelper, planMetal, planKeys } from "../scrap.tf/auctionBidHelper/content.js";

// Same hand-rolled FakeElement/FakeMutationObserver/installDomGlobals shape
// tests/sellDuplicates.test.js established for this exact scrap.tf/
// DOM-orchestration family - dispatchEvent returns Promise.all(...) of
// listener results so an async click handler can be awaited straight
// through, and FakeMutationObserver captures instances so a test can
// manually invoke `.cb()` to simulate a DOM mutation.
const CONTROLS_ID = "tf2te-auction-bid-helper";
const FILTER_ROW_SELECTOR = ".rev-filters .row.text-center";

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.style = {};
    this.dataset = {};
    this.children = [];
    this.disabled = false;
    this._id = "";
    this._textContent = "";
    this._listeners = {};
    this.value = "";
    this.classList = {
      _set: new Set(),
      contains(name) {
        return this._set.has(name);
      },
      add(name) {
        this._set.add(name);
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
  insertAdjacentElement(_position, el) {
    insertedAfter.push(el);
  }
}

let attachedById;
let insertedAfter;

class FakeMutationObserver {
  constructor(cb) {
    this.cb = cb;
    FakeMutationObserver.instances.push(this);
  }
  observe(target, opts) {
    this.target = target;
    this.opts = opts;
  }
  disconnect() {
    this.disconnected = true;
  }
}
FakeMutationObserver.instances = [];

const SELECTED_ITEMS_SELECTOR = '.selected-raffle-items .items-container > .item[data-title]';

// Kept before installDomGlobals swaps in its immediate-resolve stub.
globalThis.__realSetTimeout ??= setTimeout;

function installDomGlobals({ filterRowEl = null, backpackItems = [], selectedItems = [] } = {}) {
  attachedById = new Map();
  insertedAfter = [];
  FakeMutationObserver.instances = [];
  const bodyEl = new FakeElement("body");
  const headEl = new FakeElement("head");

  global.document = {
    querySelector: (selector) => (selector === FILTER_ROW_SELECTOR ? filterRowEl : null),
    querySelectorAll: (selector) => {
      if (selector === '#user-bp-440 .items-container > .item[data-title]') return backpackItems;
      if (selector === SELECTED_ITEMS_SELECTOR) return selectedItems;
      return [];
    },
    getElementById: (id) => attachedById.get(id) || null,
    createElement: (tag) => new FakeElement(tag),
    body: bodyEl,
    head: headEl,
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
  // for no benefit - same override tests/sellDuplicates.test.js uses.
  global.setTimeout = (fn) => fn();

  return { bodyEl };
}

function fakeBackpackItem(title) {
  const el = new FakeElement("div");
  el.dataset.title = title;
  return el;
}

test("does nothing but keeps watching (via MutationObserver) when the filter row isn't present yet", () => {
  installDomGlobals({ filterRowEl: null });

  auctionBidHelper();

  assert.equal(document.getElementById(CONTROLS_ID), null);
  assert.equal(FakeMutationObserver.instances.length, 1);
  assert.equal(FakeMutationObserver.instances[0].target, document.body);
});

test("inserts the controls right after the filter row when it's already present", () => {
  const filterRowEl = new FakeElement("div");
  installDomGlobals({ filterRowEl });

  auctionBidHelper();

  assert.equal(insertedAfter.length, 1);
  assert.equal(insertedAfter[0].id, CONTROLS_ID);
});

test("does not insert the controls twice if called again after they're already present", () => {
  const filterRowEl = new FakeElement("div");
  installDomGlobals({ filterRowEl });

  auctionBidHelper();
  auctionBidHelper();

  assert.equal(insertedAfter.length, 1);
});

test("the MutationObserver inserts the controls once the filter row later appears", () => {
  installDomGlobals({ filterRowEl: null });
  auctionBidHelper();

  const filterRowEl = new FakeElement("div");
  document.querySelector = (selector) => (selector === FILTER_ROW_SELECTOR ? filterRowEl : null);

  FakeMutationObserver.instances[0].cb();

  assert.equal(insertedAfter.length, 1);
  assert.equal(insertedAfter[0].id, CONTROLS_ID);
  assert.equal(FakeMutationObserver.instances[0].disconnected, true);
});

function getControls(filterRowEl) {
  // createBidHelperControls appends [label, keysInput, metalInput, selectBtn, clearBtn, statusEl].
  const controls = insertedAfter[0];
  const [, keysInput, metalInput, selectBtn, clearBtn, statusEl] = controls.children;
  return { keysInput, metalInput, selectBtn, clearBtn, statusEl };
}

test("clicking Auto-Select with nothing typed shows the neutral prompt and selects nothing", async () => {
  const filterRowEl = new FakeElement("div");
  installDomGlobals({ filterRowEl });
  auctionBidHelper();
  const { selectBtn, statusEl } = getControls();

  await selectBtn.dispatchEvent({ type: "click" });

  assert.equal(statusEl.textContent, "Enter a metal value and/or key count first.");
});

test("clicking Auto-Select with insufficient backpack items shows a short-by error and clicks nothing", async () => {
  const filterRowEl = new FakeElement("div");
  const keyItem = fakeBackpackItem("Mann Co. Supply Crate Key");
  installDomGlobals({ filterRowEl, backpackItems: [keyItem] });
  auctionBidHelper();
  const { keysInput, metalInput, selectBtn, statusEl } = getControls();
  keysInput.value = "3"; // only 1 key available
  metalInput.value = "0";

  let clicked = false;
  keyItem.addEventListener("click", () => (clicked = true));
  await selectBtn.dispatchEvent({ type: "click" });

  assert.match(statusEl.textContent, /Not enough in your backpack/);
  assert.match(statusEl.textContent, /2 keys short/);
  assert.equal(clicked, false);
  assert.equal(keysInput.style.borderColor, "#e04b4b");
  // A failed attempt leaves the typed amount in place - the user can see
  // what they asked for and adjust it, rather than retyping from scratch.
  assert.equal(keysInput.value, "3");
});

test("clicking Auto-Select with insufficient metal shows a short-by-ref error", async () => {
  const filterRowEl = new FakeElement("div");
  const scrap = fakeBackpackItem("Scrap Metal"); // only 1 unit available
  installDomGlobals({ filterRowEl, backpackItems: [scrap] });
  auctionBidHelper();
  const { keysInput, metalInput, selectBtn, statusEl } = getControls();
  keysInput.value = "0";
  metalInput.value = "1"; // needs 9 units, only 1 available -> 8 units short = 0.89 ref

  await selectBtn.dispatchEvent({ type: "click" });

  assert.match(statusEl.textContent, /0\.89 ref short/);
  assert.equal(metalInput.style.borderColor, "#e04b4b");
});

test("clicking Auto-Select with enough items selects the greedy metal combo and the requested keys, then restores the buttons", async () => {
  const filterRowEl = new FakeElement("div");
  const refined = fakeBackpackItem("Refined Metal");
  const reclaimed = fakeBackpackItem("Reclaimed Metal");
  const scrap = fakeBackpackItem("Scrap Metal");
  const key1 = fakeBackpackItem("Mann Co. Supply Crate Key");
  const key2 = fakeBackpackItem("Mann Co. Supply Crate Key");
  installDomGlobals({ filterRowEl, backpackItems: [refined, reclaimed, scrap, key1, key2] });
  auctionBidHelper();
  const { keysInput, metalInput, selectBtn, clearBtn, statusEl } = getControls();
  keysInput.value = "2";
  metalInput.value = "1.33"; // 12 units: 1 refined (9) + 1 reclaimed (3) = 12

  const clickedTitles = [];
  for (const el of [refined, reclaimed, scrap, key1, key2]) {
    el.addEventListener("click", () => clickedTitles.push(el.dataset.title));
  }

  const clickPromise = selectBtn.dispatchEvent({ type: "click" });
  // While running: this button is the Stop button, the other one disabled.
  assert.equal(selectBtn.textContent, "Stop");
  assert.equal(selectBtn.disabled, false);
  assert.equal(clearBtn.disabled, true);
  assert.equal(statusEl.textContent, "Selecting…");

  await clickPromise;

  assert.equal(selectBtn.textContent, "Auto-Select Items");
  assert.equal(clearBtn.disabled, false);
  assert.equal(statusEl.textContent, "Done: added 4."); // 2 keys + 1 refined + 1 reclaimed
  assert.equal(clickedTitles.filter((t) => t === "Mann Co. Supply Crate Key").length, 2);
  assert.equal(clickedTitles.includes("Refined Metal"), true);
  assert.equal(clickedTitles.includes("Reclaimed Metal"), true);
  assert.equal(clickedTitles.includes("Scrap Metal"), false); // not needed to reach 1.33 ref
  // A successful selection clears both fields so the next amount can be
  // typed fresh, instead of leaving the just-used values sitting there.
  assert.equal(keysInput.value, "");
  assert.equal(metalInput.value, "");
});

test("clicking Auto-Select resets a previous error border color on a fresh attempt", async () => {
  const filterRowEl = new FakeElement("div");
  installDomGlobals({ filterRowEl, backpackItems: [] });
  auctionBidHelper();
  const { keysInput, metalInput, selectBtn, statusEl } = getControls();

  keysInput.value = "1";
  await selectBtn.dispatchEvent({ type: "click" }); // fails, sets red border
  assert.equal(keysInput.style.borderColor, "#e04b4b");

  keysInput.value = "";
  metalInput.value = "";
  await selectBtn.dispatchEvent({ type: "click" }); // neutral path clears it first
  assert.equal(keysInput.style.borderColor, "");
  assert.equal(statusEl.textContent, "Enter a metal value and/or key count first.");
});

test("clicking Clear All with nothing selected shows a neutral message and clicks nothing", async () => {
  const filterRowEl = new FakeElement("div");
  installDomGlobals({ filterRowEl, selectedItems: [] });
  auctionBidHelper();
  const { clearBtn, statusEl } = getControls();

  await clearBtn.dispatchEvent({ type: "click" });

  assert.equal(statusEl.textContent, "Nothing selected.");
});

test("clicking Clear All clicks every item currently in the Selected Items list, then restores the buttons", async () => {
  const filterRowEl = new FakeElement("div");
  const selected1 = fakeBackpackItem("Mann Co. Supply Crate Key");
  const selected2 = fakeBackpackItem("Refined Metal");
  installDomGlobals({ filterRowEl, selectedItems: [selected1, selected2] });
  auctionBidHelper();
  const { selectBtn, clearBtn, statusEl } = getControls();

  const clickedTitles = [];
  for (const el of [selected1, selected2]) {
    el.addEventListener("click", () => clickedTitles.push(el.dataset.title));
  }

  const clickPromise = clearBtn.dispatchEvent({ type: "click" });
  assert.equal(clearBtn.textContent, "Stop");
  assert.equal(selectBtn.disabled, true);
  assert.equal(statusEl.textContent, "Clearing…");

  await clickPromise;

  assert.equal(clearBtn.textContent, "Clear All");
  assert.equal(selectBtn.disabled, false);
  assert.equal(statusEl.textContent, "Cleared.");
  assert.deepEqual(clickedTitles, ["Mann Co. Supply Crate Key", "Refined Metal"]);
});

test("injects the placeholder-color stylesheet into <head> exactly once", () => {
  const filterRowEl = new FakeElement("div");
  installDomGlobals({ filterRowEl });

  auctionBidHelper();
  assert.ok(document.getElementById("tf2te-auction-bid-helper-styles"));
  assert.equal(document.head.children.length, 1);

  // The controls are already present now, so calling again is a no-op
  // before injectStyles would even run a second time - simulate the style
  // element already existing (the actual short-circuit this test targets)
  // by calling auctionBidHelper() again with a fresh filter row but the
  // same styles id already registered.
  const secondFilterRowEl = new FakeElement("div");
  document.querySelector = (selector) => (selector === FILTER_ROW_SELECTOR ? secondFilterRowEl : null);
  document.getElementById = (id) => (id === CONTROLS_ID ? null : attachedById.get(id) || null);
  auctionBidHelper();

  assert.equal(document.head.children.length, 1); // still just the one style element
});

// Every scrap.tf selector run can be stopped, like stntrading.eu's.
// A REAL setTimeout so "Stop" can land between two staggered clicks.
async function stopMidRun(button, items) {
  const realSetTimeout = globalThis.__realSetTimeout;
  let clickedCount = 0;
  items.forEach((el) => el.addEventListener("click", () => clickedCount++));
  global.setTimeout = (fn, delay) => realSetTimeout(fn, delay);
  const runPromise = button.dispatchEvent({ type: "click" });
  await new Promise((resolve) => realSetTimeout(resolve, 130));
  await button.dispatchEvent({ type: "click" }); // the Stop click
  await runPromise;
  return clickedCount;
}

test("Auto-Select: 'Stop' mid-run ends it early, keeps the typed amounts, and says how far it got", async () => {
  const filterRowEl = new FakeElement("div");
  const keys = [1, 2, 3, 4].map(() => fakeBackpackItem("Mann Co. Supply Crate Key"));
  installDomGlobals({ filterRowEl, backpackItems: keys });
  auctionBidHelper();
  const { keysInput, selectBtn, clearBtn, statusEl } = getControls();
  keysInput.value = "4";

  const clicked = await stopMidRun(selectBtn, keys);

  assert.ok(clicked >= 1 && clicked < 4);
  assert.equal(statusEl.textContent, `Stopped after ${clicked} of 4 changes. Auto-Select again to finish.`);
  assert.equal(keysInput.value, "4"); // only partly selected - kept for a retry
  assert.equal(selectBtn.textContent, "Auto-Select Items");
  assert.equal(clearBtn.disabled, false);
});

test("Clear All: 'Stop' mid-run ends it early and says how many were cleared", async () => {
  const filterRowEl = new FakeElement("div");
  const selected = [1, 2, 3, 4].map(() => fakeBackpackItem("Refined Metal"));
  installDomGlobals({ filterRowEl, selectedItems: selected });
  auctionBidHelper();
  const { selectBtn, clearBtn, statusEl } = getControls();

  const clicked = await stopMidRun(clearBtn, selected);

  assert.ok(clicked >= 1 && clicked < 4);
  assert.equal(statusEl.textContent, `Stopped after clearing ${clicked} item${clicked === 1 ? "" : "s"}.`);
  assert.equal(clearBtn.textContent, "Clear All");
  assert.equal(selectBtn.disabled, false);
});

// The typed amounts are the bid's TOTALS. What's already selected
// (by hand, or before a Stop) counts toward them: only the missing part is
// added, and anything over is removed - never the whole amount again.
const titled = (title) => fakeBackpackItem(title);
const REF = "Refined Metal";
const REC = "Reclaimed Metal";
const SCRAP = "Scrap Metal";
const KEY = "Mann Co. Supply Crate Key";

test("planKeys - tops up, trims, or leaves the selected keys as they are", () => {
  const selected = [titled(KEY), titled(KEY)];
  const available = [titled(KEY), titled(KEY), titled(KEY)];

  const more = planKeys(4, selected, available);
  assert.deepEqual([more.toSelect.length, more.toDeselect.length, more.remainingCount], [2, 0, 0]);

  const fewer = planKeys(1, selected, available);
  assert.deepEqual([fewer.toSelect.length, fewer.toDeselect.length], [0, 1]);
  assert.equal(fewer.toDeselect[0], selected[1]);

  const same = planKeys(2, selected, available);
  assert.deepEqual([same.toSelect.length, same.toDeselect.length], [0, 0]);

  assert.equal(planKeys(9, selected, available).remainingCount, 4); // 5 owned in all
});

test("planMetal - keeps what's selected and only adds the difference", () => {
  const selectedRef = titled(REF);
  const plan = planMetal(9 + 3, [selectedRef], [titled(REF), titled(REC), titled(SCRAP)]); // 1.33 ref
  assert.deepEqual(plan.toDeselect, []);
  assert.deepEqual(plan.toSelect.map((el) => el.dataset.title), [REC]);
  assert.equal(plan.remainingUnits, 0);
});

test("planMetal - over the target: removes only the excess", () => {
  const selected = [titled(REF), titled(REF), titled(REC)]; // 2.33 ref
  const plan = planMetal(9, selected, []); // 1 ref
  assert.deepEqual(plan.toSelect, []);
  assert.deepEqual(plan.toDeselect.map((el) => el.dataset.title), [REF, REC]);
});

test("planMetal - a smaller target that a selected refined can't make swaps it for smaller metal", () => {
  const selectedRef = titled(REF);
  const rec = titled(REC);
  const plan = planMetal(3, [selectedRef], [rec, titled(SCRAP)]); // 0.33 ref
  assert.deepEqual(plan.toDeselect, [selectedRef]);
  assert.deepEqual(plan.toSelect, [rec]);
});

test("Auto-Select with part of the bid already selected only adds the rest", async () => {
  const filterRowEl = new FakeElement("div");
  const selectedKey = fakeBackpackItem(KEY);
  const availableKeys = [fakeBackpackItem(KEY), fakeBackpackItem(KEY)];
  installDomGlobals({ filterRowEl, backpackItems: availableKeys, selectedItems: [selectedKey] });
  auctionBidHelper();
  const { keysInput, selectBtn, statusEl } = getControls();
  let clicks = 0;
  [selectedKey, ...availableKeys].forEach((el) => el.addEventListener("click", () => clicks++));

  keysInput.value = "2";
  await selectBtn.dispatchEvent({ type: "click" });

  assert.equal(clicks, 1); // the 1 missing key, the selected one untouched
  assert.equal(statusEl.textContent, "Done: added 1.");
});

test("Auto-Select with more already selected than typed removes only the extra", async () => {
  const filterRowEl = new FakeElement("div");
  const selectedKeys = [fakeBackpackItem(KEY), fakeBackpackItem(KEY), fakeBackpackItem(KEY)];
  installDomGlobals({ filterRowEl, backpackItems: [], selectedItems: selectedKeys });
  auctionBidHelper();
  const { keysInput, selectBtn, statusEl } = getControls();
  const clicked = [];
  selectedKeys.forEach((el, i) => el.addEventListener("click", () => clicked.push(i)));

  keysInput.value = "1";
  await selectBtn.dispatchEvent({ type: "click" });

  assert.deepEqual(clicked, [1, 2]);
  assert.equal(statusEl.textContent, "Done: removed 2.");
});

test("Auto-Select: an empty field leaves that currency's selection alone", async () => {
  const filterRowEl = new FakeElement("div");
  const selectedKey = fakeBackpackItem(KEY);
  const ref = fakeBackpackItem(REF);
  installDomGlobals({ filterRowEl, backpackItems: [ref], selectedItems: [selectedKey] });
  auctionBidHelper();
  const { keysInput, metalInput, selectBtn } = getControls();
  let keyClicks = 0;
  selectedKey.addEventListener("click", () => keyClicks++);

  keysInput.value = "";
  metalInput.value = "1";
  await selectBtn.dispatchEvent({ type: "click" });

  assert.equal(keyClicks, 0); // keys field empty - the selected key stays
});

test("Auto-Select: when the bid already matches, nothing is clicked", async () => {
  const filterRowEl = new FakeElement("div");
  const selectedKey = fakeBackpackItem(KEY);
  installDomGlobals({ filterRowEl, backpackItems: [fakeBackpackItem(KEY)], selectedItems: [selectedKey] });
  auctionBidHelper();
  const { keysInput, selectBtn, statusEl } = getControls();

  keysInput.value = "1";
  await selectBtn.dispatchEvent({ type: "click" });

  assert.equal(statusEl.textContent, "Already selected - nothing to change.");
});
