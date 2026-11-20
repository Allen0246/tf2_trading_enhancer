import { test } from "node:test";
import assert from "node:assert/strict";
import { isEquipped, findDuplicateGroups, pickTilesToSelect, sellDuplicates } from "../scrap.tf/sellDuplicates/content.js";

const CONTROLS_ID = "tf2te-sell-duplicates";
const TOOLBAR_SELECTOR = "#reverse-header .rev-filters .form-inline";

// Minimal fake DOM element - just enough surface (classList, dataset, style,
// addEventListener/dispatchEvent, appendChild/append, id/textContent) for
// sellDuplicates()'s own DOM-orchestration half (createControls,
// ensureControlsInserted, clickItemsWithDelay) to run against, without
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
  // findDuplicateGroups reads Paint/Sheen/Killstreaker/Spell/Effect via
  // itemLinks/tooltipData.js's own getAttribute("data-content")-based
  // extractors, not dataset.content directly - mirrors that same attribute.
  getAttribute(name) {
    return name === "data-content" ? this.dataset.content ?? null : null;
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

function makeTileEl({ defindex, qualityClass, selected = false, equipped = false }) {
  const el = new FakeElement("div");
  el.dataset.defindex = String(defindex);
  el.dataset.content = equipped ? "Equipped on Soldier" : "";
  if (qualityClass) el.classList.add(qualityClass);
  if (selected) el.classList.add("selected-item");
  el.offsetParent = {};
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

// sellDuplicates()'s own createControls/clickItemsWithDelay reference the
// browser globals MutationObserver, MouseEvent and window, none of which
// exist in plain Node.
// Kept before installDomGlobals swaps in its immediate-resolve stub.
globalThis.__realSetTimeout ??= setTimeout;

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

function fakeClassList(...classes) {
  const set = new Set(classes);
  return {
    contains: (name) => set.has(name),
    add: (name) => set.add(name),
  };
}

// qualityClass e.g. "quality11" for Strange, omitted for the default Unique.
// dataContent lets a test supply Paint/Sheen/Killstreaker/Spell/Effect lines
// (see findDuplicateGroups' own use of itemLinks/tooltipData.js) - defaults
// to a harmless filler line so every existing (pre-tooltipData) test fixture
// still reads as "no such attribute" rather than an empty, falsy string.
function fakeTile({ defindex, qualityClass, selected = false, equipped = false, visible = true, dataContent }) {
  const content = dataContent ?? (equipped ? "Equipped on Soldier\nSome other line" : "Some other line");
  return {
    dataset: { defindex: String(defindex), content },
    getAttribute: (name) => (name === "data-content" ? content : null),
    classList: fakeClassList(...(qualityClass ? [qualityClass] : []), ...(selected ? ["selected-item"] : [])),
    offsetParent: visible ? {} : null,
  };
}

test("isEquipped is true only when the tooltip content has an 'Equipped on' line", () => {
  assert.equal(isEquipped(fakeTile({ defindex: 1, equipped: true })), true);
  assert.equal(isEquipped(fakeTile({ defindex: 1, equipped: false })), false);
  assert.equal(isEquipped({ dataset: {} }), false);
});

test("findDuplicateGroups groups tiles by defindex + quality id and drops singleton groups", () => {
  const rocketA = fakeTile({ defindex: 18, qualityClass: undefined }); // Unique (default)
  const rocketB = fakeTile({ defindex: 18, qualityClass: undefined }); // Unique duplicate
  const strangeRocket = fakeTile({ defindex: 18, qualityClass: "quality11" }); // Strange - different group
  const scattergun = fakeTile({ defindex: 13, qualityClass: undefined }); // only one copy - not a duplicate group

  global.document = {
    querySelectorAll: () => [rocketA, rocketB, strangeRocket, scattergun],
  };

  const groups = findDuplicateGroups();

  assert.equal(groups.size, 1);
  const [[key, tiles]] = groups.entries();
  // defindex::qualityId::killstreakTier::paint::sheen::killstreaker::spell::effect,
  // 6 = Unique, 0 = no killstreak, every data-content-derived field empty
  // (Array#join renders null as "") since these fixtures carry no
  // Paint/Sheen/Killstreaker/Spell/Effect line.
  assert.equal(key, "18::6::0::::::::::");
  assert.deepEqual(tiles, [rocketA, rocketB]);
});

test("findDuplicateGroups only considers currently-visible tiles (offsetParent !== null)", () => {
  const visibleA = fakeTile({ defindex: 5, visible: true });
  const visibleB = fakeTile({ defindex: 5, visible: true });
  const hiddenC = fakeTile({ defindex: 5, visible: false });

  global.document = { querySelectorAll: () => [visibleA, visibleB, hiddenC] };

  const groups = findDuplicateGroups();

  assert.equal(groups.size, 1);
  const tiles = groups.get("5::6::0::::::::::");
  assert.equal(tiles.length, 2);
  assert.equal(tiles.includes(hiddenC), false);
});

test("findDuplicateGroups never treats a plain weapon and its Killstreak counterpart as duplicates", () => {
  // Same defindex, same quality (Unique) - only differ by the killstreakN
  // CSS class, the same way a real Professional Killstreak weapon shares its
  // plain counterpart's defindex/quality (killstreak tier is an attribute,
  // not a distinct item).
  const plainA = fakeTile({ defindex: 205, qualityClass: undefined });
  const plainB = fakeTile({ defindex: 205, qualityClass: undefined });
  const proKillstreak = fakeTile({ defindex: 205, qualityClass: undefined });
  proKillstreak.classList.add("killstreak3");

  global.document = {
    querySelectorAll: () => [plainA, plainB, proKillstreak],
  };

  const groups = findDuplicateGroups();

  assert.equal(groups.size, 1);
  const tiles = groups.get("205::6::0::::::::::");
  assert.deepEqual(tiles, [plainA, plainB]);
  assert.equal(groups.has("205::6::3::::::::::"), false); // single Professional Killstreak copy - not a duplicate group
});

test("findDuplicateGroups never treats two items with different Paint/Sheen/Killstreaker/Spell/Unusual effect as duplicates", () => {
  const plainPainted = fakeTile({ defindex: 30, dataContent: "Painted Australium Gold" });
  const differentPaint = fakeTile({ defindex: 30, dataContent: "Painted Team Spirit" });
  const unpainted = fakeTile({ defindex: 30, dataContent: "Some other line" });
  const samePaintDuplicate = fakeTile({ defindex: 30, dataContent: "Painted Australium Gold" });

  global.document = {
    querySelectorAll: () => [plainPainted, differentPaint, unpainted, samePaintDuplicate],
  };

  const groups = findDuplicateGroups();

  // Only plainPainted + samePaintDuplicate share every signal (including
  // Paint) - differentPaint and unpainted are each their own singleton group
  // and get dropped, so despite 4 same-defindex/quality/killstreak tiles,
  // only 1 real duplicate group comes out.
  assert.equal(groups.size, 1);
  const [[, tiles]] = groups.entries();
  assert.deepEqual(tiles, [plainPainted, samePaintDuplicate]);
});

test("pickTilesToSelect leaves exactly one tile unselected across a duplicate group", () => {
  const tiles = [fakeTile({ defindex: 1 }), fakeTile({ defindex: 1 }), fakeTile({ defindex: 1 })];

  const toSelect = pickTilesToSelect(tiles);

  assert.equal(toSelect.length, 2); // 3 tiles - 1 to keep = 2 to select
});

test("pickTilesToSelect counts already-selected tiles toward the target instead of re-clicking them", () => {
  const tiles = [fakeTile({ defindex: 1, selected: true }), fakeTile({ defindex: 1 }), fakeTile({ defindex: 1 })];

  const toSelect = pickTilesToSelect(tiles);

  // 1 already selected + 1 more needed = 2 selected, 1 left unselected.
  assert.equal(toSelect.length, 1);
  assert.equal(toSelect[0], tiles[1]);
});

test("pickTilesToSelect returns nothing more to do once enough tiles are already selected", () => {
  const tiles = [fakeTile({ defindex: 1, selected: true }), fakeTile({ defindex: 1 }), fakeTile({ defindex: 1 })];
  // Already at target (2 selected out of 3, 1 left unselected) - nothing to click.
  tiles[1].classList.add("selected-item");

  assert.deepEqual(pickTilesToSelect(tiles), []);
});

test("pickTilesToSelect never selects an equipped tile, even if that leaves fewer than target-1 selected", () => {
  const equipped = fakeTile({ defindex: 1, equipped: true });
  const tiles = [equipped, fakeTile({ defindex: 1 })];

  const toSelect = pickTilesToSelect(tiles);

  // Target is 1 (2 tiles - 1 to keep), but the only unselected candidate
  // besides the equipped one is the plain tile - equipped must never be picked.
  assert.equal(toSelect.includes(equipped), false);
  assert.deepEqual(toSelect, [tiles[1]]);
});

test("pickTilesToSelect can come up short of the target when every remaining candidate is equipped", () => {
  const tiles = [fakeTile({ defindex: 1, equipped: true }), fakeTile({ defindex: 1, equipped: true }), fakeTile({ defindex: 1 })];

  const toSelect = pickTilesToSelect(tiles);

  // Target is 2, but only 1 non-equipped candidate exists - safer to under-select.
  assert.deepEqual(toSelect, [tiles[2]]);
});

test("sellDuplicates does nothing (and doesn't throw) when the toolbar row isn't present yet", () => {
  installDomGlobals({ toolbarEl: null });

  sellDuplicates();

  assert.equal(document.getElementById(CONTROLS_ID), null);
  // The MutationObserver still gets set up so a later-appearing toolbar
  // (e.g. after an AJAX re-render) gets picked up on the next mutation.
  assert.equal(FakeMutationObserver.instances.length, 1);
  assert.equal(FakeMutationObserver.instances[0].target, document.body);
});

test("sellDuplicates inserts the controls into the toolbar exactly once", () => {
  const toolbarEl = new FakeElement("div");
  installDomGlobals({ toolbarEl });

  sellDuplicates();
  assert.equal(toolbarEl.children.length, 1);
  assert.equal(toolbarEl.children[0].id, CONTROLS_ID);

  // A later mutation notification (nothing actually changed) must not
  // duplicate the controls - ensureControlsInserted's own getElementById
  // check should short-circuit.
  FakeMutationObserver.instances[0].cb();
  assert.equal(toolbarEl.children.length, 1);
});

test("the MutationObserver re-inserts the controls if scrap.tf's own re-render wipes them out", () => {
  const toolbarEl = new FakeElement("div");
  installDomGlobals({ toolbarEl });

  sellDuplicates();
  assert.equal(toolbarEl.children.length, 1);

  removeAllChildren(toolbarEl); // simulate the toolbar row's DOM node being replaced
  assert.equal(document.getElementById(CONTROLS_ID), null);

  FakeMutationObserver.instances[0].cb();

  assert.equal(toolbarEl.children.length, 1);
  assert.equal(toolbarEl.children[0].id, CONTROLS_ID);
});

test("clicking the button with no spare duplicates shows the empty-state status and never disables the button", async () => {
  const toolbarEl = new FakeElement("div");
  installDomGlobals({ toolbarEl, tiles: [] }); // no backpack tiles at all

  sellDuplicates();
  const [btn, statusEl] = toolbarEl.children[0].children;

  await btn.dispatchEvent({ type: "click" });

  assert.equal(statusEl.textContent, "No spare duplicates to select.");
  assert.equal(btn.disabled, false);
});

test("clicking the button selects every spare duplicate, updates status through the run, and restores the button", async () => {
  const toolbarEl = new FakeElement("div");
  const rocketA = makeTileEl({ defindex: 18 });
  const rocketB = makeTileEl({ defindex: 18 });
  const rocketC = makeTileEl({ defindex: 18 });
  installDomGlobals({ toolbarEl, tiles: [rocketA, rocketB, rocketC] });

  sellDuplicates();
  const [btn, statusEl] = toolbarEl.children[0].children;

  const clickPromise = btn.dispatchEvent({ type: "click" });
  // The synchronous portion of the async click handler (up through the
  // "Selecting..." status write) has already run by the time dispatchEvent
  // returns, since it all happens before the handler's first await.
  assert.equal(btn.textContent, "Stop"); // clickable while running, to stop it
  assert.equal(statusEl.textContent, "Selecting 2 items...");

  await clickPromise;

  assert.equal(btn.textContent, "Select Duplicates (keep 1 of each)");
  assert.equal(statusEl.textContent, "Selected 2 duplicates.");
});

test("clicking the button uses singular wording when exactly one duplicate is selected", async () => {
  const toolbarEl = new FakeElement("div");
  const tiles = [makeTileEl({ defindex: 18 }), makeTileEl({ defindex: 18 })];
  installDomGlobals({ toolbarEl, tiles });

  sellDuplicates();
  const [btn, statusEl] = toolbarEl.children[0].children;

  const clickPromise = btn.dispatchEvent({ type: "click" });
  assert.equal(statusEl.textContent, "Selecting 1 item...");

  await clickPromise;
  assert.equal(statusEl.textContent, "Selected 1 duplicate.");
});

// Select Duplicates can be stopped, like stntrading.eu's.
test("'Stop' mid-run ends Select Duplicates early and says how many were selected", async () => {
  const realSetTimeout = globalThis.__realSetTimeout;
  const toolbarEl = new FakeElement("div");
  const tiles = [1, 2, 3, 4, 5].map(() => makeTileEl({ defindex: 18 }));
  installDomGlobals({ toolbarEl, tiles });
  global.setTimeout = (fn, delay) => realSetTimeout(fn, delay);

  sellDuplicates();
  const [btn, statusEl] = toolbarEl.children[0].children;
  let clicked = 0;
  tiles.forEach((el) => el.addEventListener("click", () => clicked++));

  const runPromise = btn.dispatchEvent({ type: "click" });
  await new Promise((resolve) => realSetTimeout(resolve, 130));
  await btn.dispatchEvent({ type: "click" }); // the Stop click
  await runPromise;

  assert.ok(clicked >= 1 && clicked < 4); // 4 spares, stopped before the last
  assert.equal(statusEl.textContent, `Stopped after selecting ${clicked} duplicate${clicked === 1 ? "" : "s"}.`);
  assert.equal(btn.textContent, "Select Duplicates (keep 1 of each)");
});
