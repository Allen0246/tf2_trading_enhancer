import { test } from "node:test";
import assert from "node:assert/strict";
import {
  itemsTableFilters,
  __resetClassCacheForTests,
  __resetSelectionsForTests,
  __resetClassFilterAvailabilityForTests,
  __resetDropdownRefsForTests,
} from "../backpack.tf/nextUI/itemsTableFilters/content.js";
import { __resetSchemaCacheForTests } from "../utils/tf2Schema.js";

// utils/tf2Schema.js memoizes a schema promise at module scope - see
// tests/nextUiEffectClassFilter.test.js's own header note on why this and
// the module's own classCache/selection Sets/classFilterUnavailable flag/
// updateQualityCounts+updateClassCounts refs all need resetting between
// tests.
test.beforeEach(() => {
  __resetSchemaCacheForTests();
  __resetClassCacheForTests();
  __resetSelectionsForTests();
  __resetClassFilterAvailabilityForTests();
  __resetDropdownRefsForTests();
});

const ITEM_LINK_SELECTOR = 'td:first-child a[href^="/items/"]';
const QUALITY_STRONG_SELECTOR = "td:nth-child(3) .quality-list strong";
const SEARCH_INPUT_SELECTOR = "input.p-column-filter";
const CLEAR_BUTTON_SELECTOR = ".p-column-filter-clear-button";
const ROW_SELECTOR = 'tbody.p-datatable-tbody > tr[role="row"]';

// Minimal hand-rolled fakes (see tests/helpers/fakeDom.js's own header on why
// this repo hand-rolls rather than pulling in jsdom). Row/link/quality
// shapes mirror the real /items table's own pasted markup - see content.js's
// own header note.

let insertedElements = [];
let bodyChildren = [];

function fakeGenericElement() {
  const children = [];
  const listeners = {};
  const classSet = new Set();
  const attrs = {};
  // A real DOM textContent assignment tears down/rebuilds the child text
  // node even when the string is unchanged, which is exactly what let a
  // real MutationObserver loop forever in production the first time this
  // feature was built (see content.js's own header note, point 1) -
  // _textContentWrites counts actual SETS (not reads) so a test can assert
  // an unchanged value doesn't re-write at all.
  let text = "";
  const el = {
    // className and classList share one class set, like the real DOM (the
    // key button sets its classes through className).
    get className() {
      return Array.from(classSet).join(" ");
    },
    set className(value) {
      classSet.clear();
      String(value)
        .split(/\s+/)
        .filter(Boolean)
        .forEach((c) => classSet.add(c));
    },
    get textContent() {
      return text;
    },
    set textContent(value) {
      text = value;
      el._textContentWrites = (el._textContentWrites || 0) + 1;
    },
    style: {},
    classList: {
      add: (...cs) => cs.forEach((c) => classSet.add(c)),
      remove: (...cs) => cs.forEach((c) => classSet.delete(c)),
      toggle: (cls, force) => {
        const nextState = force === undefined ? !classSet.has(cls) : force;
        if (nextState) classSet.add(cls);
        else classSet.delete(cls);
      },
      contains: (c) => classSet.has(c),
    },
    setAttribute: (name, value) => {
      attrs[name] = value;
    },
    // Used by the "needs a key" button (utils/linkButtonStates.js).
    removeAttribute: (name) => {
      delete attrs[name];
    },
    dataset: {},
    getAttributeNames: () => Object.keys(attrs),
    getAttribute: (name) => attrs[name] ?? null,
    appendChild: (child) => {
      children.push(child);
      return child;
    },
    // Any element built by content.js may become an insertion anchor (the
    // class filter anchors off the quality filter's own wrapper once it
    // exists, not just the real clear button) - tracking every
    // insertAdjacentElement call generically, regardless of which element
    // it's called on, is what lets the class-based document.querySelector
    // fake below find a dynamically-inserted wrapper later.
    insertAdjacentElement: (position, child) => {
      insertedElements.push(child);
      return child;
    },
    remove: () => {
      const i = insertedElements.indexOf(el);
      if (i !== -1) insertedElements.splice(i, 1);
    },
    addEventListener: (eventName, cb) => {
      listeners[eventName] = cb;
    },
    contains: (node) => node === el || children.some((child) => child === node || child.contains?.(node)),
    // Mutable (not a fixed literal) so a test can move the wrapper between
    // an initial _click() open and a simulated scroll, and assert the panel
    // actually re-reads the rect rather than reusing whatever it computed
    // at open time - that's the exact bug being fixed.
    _rect: { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 },
    getBoundingClientRect: () => el._rect,
    _click: async () => {
      await listeners.click?.({ target: el });
    },
    _children: children,
  };
  return el;
}

function fakeRow({ href = null, qualities = [] } = {}) {
  const link = href ? { getAttribute: (name) => (name === "href" ? href : null) } : null;
  const qualityEls = qualities.map((q) => ({ textContent: `${q}\n          ` })); // real markup has trailing whitespace
  const classSet = new Set();
  return {
    querySelector: (selector) => (selector === ITEM_LINK_SELECTOR ? link : null),
    querySelectorAll: (selector) => (selector === QUALITY_STRONG_SELECTOR ? qualityEls : []),
    classList: {
      toggle: (cls, force) => {
        const nextState = force === undefined ? !classSet.has(cls) : force;
        if (nextState) classSet.add(cls);
        else classSet.delete(cls);
      },
      contains: (c) => classSet.has(c),
      remove: (cls) => classSet.delete(cls),
    },
  };
}

// The panel is portaled to document.body (see content.js's own header note
// on why - the table's own scrollable wrapper clips it otherwise), so it's
// not among wrapper._children - find it among document.body's own tracked
// children instead, by the wrapper marker class content.js also stamps
// onto the panel itself for exactly this reason.
function findPanel(wrapperClassName) {
  return bodyChildren.find((el) => el.classList.contains(wrapperClassName));
}

function setupDom({ rows = [], hasClearButton = true, hasSearchInput = true, storage = {}, pathname = "/items" } = {}) {
  insertedElements = [];
  bodyChildren = [];
  const documentListeners = {};
  const clearButton = hasClearButton ? fakeGenericElement() : null;
  const searchInput = hasSearchInput ? fakeGenericElement() : null;
  if (searchInput) searchInput.setAttribute("data-v-7332f3c4", ""); // confirmed-live scoped attr

  let mutationCallback = null;

  global.document = {
    querySelectorAll: (selector) => {
      if (selector === ROW_SELECTOR) return rows;
      const classMatch = /^\.(\S+)$/.exec(selector);
      return classMatch ? insertedElements.filter((el) => el.classList.contains(classMatch[1])) : [];
    },
    querySelector: (selector) => {
      if (selector === CLEAR_BUTTON_SELECTOR) return clearButton;
      if (selector === SEARCH_INPUT_SELECTOR) return searchInput;
      const classMatch = /^\.(\S+)$/.exec(selector);
      if (classMatch) return insertedElements.find((el) => el.classList.contains(classMatch[1])) || null;
      return null;
    },
    getElementById: (id) => (id === "tf2te-items-filter-styles" ? null : null),
    createElement: () => fakeGenericElement(),
    createElementNS: () => fakeGenericElement(),
    createTextNode: (text) => ({ textContent: text }),
    addEventListener: (eventName, cb) => {
      documentListeners[eventName] = cb;
    },
    head: { appendChild() {} },
    body: {
      appendChild: (el) => {
        bodyChildren.push(el);
        return el;
      },
    },
  };
  global.MutationObserver = class {
    constructor(cb) {
      mutationCallback = cb;
    }
    observe() {}
  };
  // Tracks scroll/resize listeners the panel's open/close logic attaches to
  // window (capture:true, since the real scroll container is the table's
  // own wrapper, not window - scroll doesn't bubble to window) so a test
  // can invoke them directly to simulate the page scrolling.
  const windowListeners = {};
  global.window = {
    location: { origin: "https://next.backpack.tf", pathname },
    addEventListener: (eventName, cb) => {
      windowListeners[eventName] = cb;
    },
    removeEventListener: (eventName) => {
      delete windowListeners[eventName];
    },
    _listeners: windowListeners,
  };
  // Node has no requestAnimationFrame; the panel throttles reposition work
  // through it, so tests need something that actually runs the callback.
  global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  const onChangedListeners = [];
  global.chrome = {
    storage: {
      local: {
        get: async (keys) => {
          const result = {};
          for (const k of keys) if (k in storage) result[k] = storage[k];
          return result;
        },
        set: async () => {},
      },
      onChanged: {
        addListener: (cb) => onChangedListeners.push(cb),
      },
    },
    runtime: {
      sendMessage: async () => ({ ok: false, error: "no key configured in this test" }),
    },
  };
  global.__triggerApiKeySaved = () =>
    Promise.all(onChangedListeners.map((cb) => cb({ steamApiKey: { newValue: "KEY123" } }, "local")));
  // Simulates a page change (search/pagination re-rendering the tbody) -
  // fires the same MutationObserver callback content.js itself registered.
  global.__triggerMutation = () => mutationCallback?.();
  global.__setRows = (newRows) => {
    rows = newRows;
    global.document.querySelectorAll = (selector) => (selector === ROW_SELECTOR ? rows : []);
  };
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 10));
}

// content.js's own scheduleRefresh debounces the actual row-rescan by
// 200ms (collapses a hover-tooltip-driven mutation storm into one pass) - a
// mutation fired via __triggerMutation needs to wait that out for real, not
// content.js's usual 10ms flush().
async function flushAfterMutation() {
  await new Promise((resolve) => setTimeout(resolve, 220));
}

const schemaMock = (items) => async (msg) => {
  if (msg.url.includes("GetSchemaItems")) return { ok: true, data: { result: { items, next: null } } };
  if (msg.url.includes("GetSchemaOverview")) return { ok: true, data: { result: {} } };
  return { ok: false };
};

test("does nothing on a page other than /items", async () => {
  setupDom({ rows: [fakeRow({ href: "/items/Pencil%20Pusher", qualities: ["Unique"] })], pathname: "/effects" });

  itemsTableFilters();
  await flush();

  assert.equal(insertedElements.length, 0);
});

test("does nothing when there are no rows", async () => {
  setupDom({ rows: [] });

  itemsTableFilters();
  await flush();

  assert.equal(insertedElements.length, 0);
});

test("does nothing when the clear button or search input isn't found", async () => {
  setupDom({ rows: [fakeRow({ href: "/items/Pencil%20Pusher", qualities: ["Unique"] })], hasClearButton: false });

  itemsTableFilters();
  await flush();

  assert.equal(insertedElements.length, 0);
});

test("inserts the Quality filter without needing a Steam API key - it reads straight off the DOM", async () => {
  setupDom({
    rows: [fakeRow({ href: "/items/Pencil%20Pusher", qualities: ["Strange", "Unique", "Unusual"] })],
    storage: {},
  });

  itemsTableFilters();
  await flush();

  const qualityWrapper = insertedElements.find((el) => el.classList.contains("tf2te-items-quality-filter-wrapper"));
  assert.ok(qualityWrapper);
  const classWrapper = insertedElements.find((el) => el.classList.contains("tf2te-items-class-filter-wrapper"));
  assert.equal(classWrapper, undefined); // no key - Class filter withheld
});

// Without a key the Class filter can't work, but it used to just not appear,
// which looked broken. Now a "needs a key" button sits in its spot
// (../backpack.tf/nextUI/shared/filterKeyHint.js), chosen from a mockup.
test("without a Steam API key, shows a 'Class filter' key button in its spot, and swaps it for the real filter once a key is saved", async () => {
  const storage = {};
  setupDom({ rows: [fakeRow({ href: "/items/Pencil%20Pusher", qualities: ["Unique"] })], storage });
  const keyHint = () => insertedElements.find((el) => el.classList.contains("tf2te-items-class-filter-key-hint"));

  itemsTableFilters();
  await flush();
  assert.equal(
    insertedElements.find((el) => el.classList.contains("tf2te-items-class-filter-wrapper")),
    undefined
  );
  assert.ok(keyHint(), "expected the key button in the Class filter's spot");
  assert.equal(keyHint().dataset.tf2teNeedsKey, "1");
  assert.match(keyHint().title, /class filter needs a Steam Web API key/);
  // Right after the Quality filter, where the Class filter goes.
  const qualityIdx = insertedElements.findIndex((el) => el.classList.contains("tf2te-items-quality-filter-wrapper"));
  assert.ok(qualityIdx !== -1);

  // A table re-render that wipes it gets it back on the next tick.
  keyHint().remove();
  global.__triggerMutation();
  await flush();
  assert.ok(keyHint());

  storage.steamApiKey = "KEY123";
  global.chrome.runtime.sendMessage = schemaMock([]);
  await global.__triggerApiKeySaved();

  assert.ok(insertedElements.find((el) => el.classList.contains("tf2te-items-class-filter-wrapper")));
  assert.equal(keyHint(), undefined, "the key button is replaced by the real filter");
});

test("does not repeatedly re-check hasSchemaAccess on every mutation tick once it's come back false - only a reported key change resets it", async () => {
  const storage = {};
  setupDom({ rows: [fakeRow({ href: "/items/Pencil%20Pusher", qualities: ["Unique"] })], storage });
  // Counts chrome.storage.local.get calls directly - the actual thing that
  // flooded badly enough to stall the whole extension's messaging channel
  // live (see content.js's own header note, point 2). With no API key
  // configured, hasSchemaAccess() bails out before ever attempting a
  // network fetch at all, so counting fetch attempts wouldn't exercise
  // this specific regression the way counting storage reads does.
  let storageGetCalls = 0;
  const originalGet = global.chrome.storage.local.get;
  global.chrome.storage.local.get = async (keys) => {
    storageGetCalls++;
    return originalGet(keys);
  };

  itemsTableFilters();
  await flush();
  const callsAfterFirstTick = storageGetCalls;
  assert.ok(callsAfterFirstTick > 0); // it did check once

  // Several more mutation ticks - should NOT trigger further storage reads
  // for the class filter's own schema-access check.
  global.__triggerMutation();
  await flushAfterMutation();
  global.__triggerMutation();
  await flushAfterMutation();

  assert.equal(storageGetCalls, callsAfterFirstTick);
});

test("Quality dropdown lists every known quality option with correct counts from the current rows", async () => {
  setupDom({
    rows: [
      fakeRow({ href: "/items/A", qualities: ["Strange", "Unique"] }),
      fakeRow({ href: "/items/B", qualities: ["Unique"] }),
      fakeRow({ href: "/items/C", qualities: ["Unusual", "Strange"] }),
    ],
  });

  itemsTableFilters();
  await flush();

  const panel = findPanel("tf2te-items-quality-filter-wrapper");
  const [, itemsWrapper] = panel._children; // header, itemsWrapper
  const list = itemsWrapper._children[0];
  const findOption = (label) => list._children.find((li) => li.getAttribute("aria-label") === label);

  assert.equal(list._children.length, 9); // full QUALITY_OPTIONS list, not just what's on this page
  const countOf = (li) => li._children[li._children.length - 2].textContent;
  assert.equal(countOf(findOption("Strange")), "2");
  assert.equal(countOf(findOption("Unique")), "2");
  assert.equal(countOf(findOption("Unusual")), "1");
  assert.equal(countOf(findOption("Genuine")), "0");
});

test("checking a quality filters rows with 'at least one' OR semantics, matching the site's own real Priced-Qualities-filter wording", async () => {
  const strangeRow = fakeRow({ href: "/items/A", qualities: ["Strange"] });
  const unusualRow = fakeRow({ href: "/items/B", qualities: ["Unusual", "Strange"] });
  const uniqueOnlyRow = fakeRow({ href: "/items/C", qualities: ["Unique"] });
  setupDom({ rows: [strangeRow, unusualRow, uniqueOnlyRow] });

  itemsTableFilters();
  await flush();

  const panel = findPanel("tf2te-items-quality-filter-wrapper");
  const [, itemsWrapper] = panel._children;
  const list = itemsWrapper._children[0];
  const findOption = (label) => list._children.find((li) => li.getAttribute("aria-label") === label);

  await findOption("Strange")._click();
  await flush();

  assert.equal(strangeRow.classList.contains("tf2te-items-filtered-out"), false);
  assert.equal(unusualRow.classList.contains("tf2te-items-filtered-out"), false); // has Strange too - OR match
  assert.equal(uniqueOnlyRow.classList.contains("tf2te-items-filtered-out"), true);

  await findOption("Unique")._click(); // add a second quality - union grows
  await flush();
  assert.equal(uniqueOnlyRow.classList.contains("tf2te-items-filtered-out"), false);
});

test("checking a class filters rows via the same schema-lookup bucketing effectClassFilter uses, reading the item name off the URL path", async () => {
  const soldierRow = fakeRow({ href: "/items/Tomislav", qualities: ["Unique"] });
  const scoutRow = fakeRow({ href: "/items/Bonk!%20Atomic%20Punch", qualities: ["Unique"] });
  setupDom({ rows: [soldierRow, scoutRow], storage: { steamApiKey: "KEY123" } });
  global.chrome.runtime.sendMessage = schemaMock([
    { item_name: "Tomislav", defindex: 1, used_by_classes: ["Heavy"] },
    { item_name: "Bonk! Atomic Punch", defindex: 2, used_by_classes: ["Scout"] },
  ]);

  itemsTableFilters();
  await flush();

  const wrapper = insertedElements.find((el) => el.classList.contains("tf2te-items-class-filter-wrapper"));
  assert.ok(wrapper);
  const panel = findPanel("tf2te-items-class-filter-wrapper");
  const [, itemsWrapper] = panel._children;
  const list = itemsWrapper._children[0];
  const findOption = (label) => list._children.find((li) => li.getAttribute("aria-label") === label);

  await findOption("Heavy")._click();
  await flush();

  assert.equal(soldierRow.classList.contains("tf2te-items-filtered-out"), false);
  assert.equal(scoutRow.classList.contains("tf2te-items-filtered-out"), true);
});

test("combines an active Class filter and Quality filter with AND semantics", async () => {
  const heavyStrange = fakeRow({ href: "/items/Tomislav", qualities: ["Strange"] });
  const heavyUnique = fakeRow({ href: "/items/Tomislav", qualities: ["Unique"] });
  const scoutStrange = fakeRow({ href: "/items/Bonk!%20Atomic%20Punch", qualities: ["Strange"] });
  setupDom({ rows: [heavyStrange, heavyUnique, scoutStrange], storage: { steamApiKey: "KEY123" } });
  global.chrome.runtime.sendMessage = schemaMock([
    { item_name: "Tomislav", defindex: 1, used_by_classes: ["Heavy"] },
    { item_name: "Bonk! Atomic Punch", defindex: 2, used_by_classes: ["Scout"] },
  ]);

  itemsTableFilters();
  await flush();

  const optionIn = (wrapperClassName, label) => {
    const panel = findPanel(wrapperClassName);
    const [, itemsWrapper] = panel._children;
    return itemsWrapper._children[0]._children.find((li) => li.getAttribute("aria-label") === label);
  };

  await optionIn("tf2te-items-class-filter-wrapper", "Heavy")._click();
  await optionIn("tf2te-items-quality-filter-wrapper", "Strange")._click();
  await flush();

  assert.equal(heavyStrange.classList.contains("tf2te-items-filtered-out"), false); // Heavy AND Strange
  assert.equal(heavyUnique.classList.contains("tf2te-items-filtered-out"), true); // Heavy but not Strange
  assert.equal(scoutStrange.classList.contains("tf2te-items-filtered-out"), true); // Strange but not Heavy
});

test("re-applies an active filter to a NEW set of rows after a page change, not just the rows present when the filter was first built", async () => {
  const page1Row = fakeRow({ href: "/items/A", qualities: ["Strange"] });
  setupDom({ rows: [page1Row] });

  itemsTableFilters();
  await flush();

  const panel = findPanel("tf2te-items-quality-filter-wrapper");
  const [, itemsWrapper] = panel._children;
  const list = itemsWrapper._children[0];
  await list._children.find((li) => li.getAttribute("aria-label") === "Strange")._click();
  await flush();
  assert.equal(page1Row.classList.contains("tf2te-items-filtered-out"), false);

  // Simulates navigating to page 2 - the old row is gone, replaced by new
  // ones the filter never saw at build time.
  const page2MatchRow = fakeRow({ href: "/items/B", qualities: ["Strange"] });
  const page2NoMatchRow = fakeRow({ href: "/items/C", qualities: ["Unique"] });
  global.__setRows([page2MatchRow, page2NoMatchRow]);
  global.__triggerMutation();
  await flushAfterMutation();

  assert.equal(page2MatchRow.classList.contains("tf2te-items-filtered-out"), false);
  assert.equal(page2NoMatchRow.classList.contains("tf2te-items-filtered-out"), true);
});

test("refreshes a dropdown's own displayed counts when the row set changes (e.g. switching to a larger page size), not just the filtering", async () => {
  setupDom({ rows: [fakeRow({ href: "/items/A", qualities: ["Strange"] })] });

  itemsTableFilters();
  await flush();

  const panel = findPanel("tf2te-items-quality-filter-wrapper");
  const [, itemsWrapper] = panel._children;
  const list = itemsWrapper._children[0];
  const findOption = (label) => list._children.find((li) => li.getAttribute("aria-label") === label);
  const countOf = (li) => li._children[li._children.length - 2].textContent;

  assert.equal(countOf(findOption("Strange")), "1");
  assert.equal(countOf(findOption("Unique")), "0");

  // Simulates bumping "10 per page" up to a larger size - many more rows
  // now render than were present when the dropdown was first built.
  global.__setRows([
    fakeRow({ href: "/items/A", qualities: ["Strange"] }),
    fakeRow({ href: "/items/B", qualities: ["Strange", "Unique"] }),
    fakeRow({ href: "/items/C", qualities: ["Unique"] }),
  ]);
  global.__triggerMutation();
  await flushAfterMutation();

  assert.equal(countOf(findOption("Strange")), "2");
  assert.equal(countOf(findOption("Unique")), "2");
});

test("never rewrites an option's count text when the recomputed value hasn't actually changed - this is the real bug that froze the whole page live: a textContent assignment is itself a mutation, and since the panel lives in document.body (subtree-observed), an unconditional rewrite on every observer tick re-triggered the observer forever", async () => {
  setupDom({ rows: [fakeRow({ href: "/items/A", qualities: ["Strange"] })] });

  itemsTableFilters();
  await flush();

  const panel = findPanel("tf2te-items-quality-filter-wrapper");
  const [, itemsWrapper] = panel._children;
  const list = itemsWrapper._children[0];
  const strangeLi = list._children.find((li) => li.getAttribute("aria-label") === "Strange");
  const countEl = strangeLi._children[strangeLi._children.length - 2];

  assert.equal(countEl.textContent, "1");
  const writesAfterBuild = countEl._textContentWrites;
  assert.ok(writesAfterBuild >= 1);

  // Simulates further mutations that don't actually change this row's own
  // qualities (e.g. an unrelated re-render elsewhere on the page) - same
  // row data, so the recomputed count is identical every time. Spaced out
  // past scheduleRefresh's own 200ms debounce window so each one actually
  // triggers its own refreshRowsAndCounts pass, rather than coalescing into
  // a single one.
  global.__triggerMutation();
  await flushAfterMutation();
  global.__triggerMutation();
  await flushAfterMutation();

  assert.equal(countEl.textContent, "1");
  assert.equal(countEl._textContentWrites, writesAfterBuild); // no new write - the value never changed
});

test("open dropdown panel re-tracks its trigger's position on scroll instead of staying stuck where it opened", async () => {
  setupDom({ rows: [fakeRow({ href: "/items/A", qualities: ["Strange"] })] });

  itemsTableFilters();
  await flush();

  const wrapper = insertedElements.find((el) => el.classList.contains("tf2te-items-quality-filter-wrapper"));
  const panel = findPanel("tf2te-items-quality-filter-wrapper");
  assert.ok(wrapper);
  assert.ok(panel);

  wrapper._rect = { top: 100, bottom: 130, left: 20, right: 200, width: 180, height: 30 };
  await wrapper._click(); // opens the panel
  await flush();

  assert.equal(panel.classList.contains("tf2te-dropdown-open"), true);
  assert.equal(panel.style.top, "130px");
  assert.equal(panel.style.left, "20px");

  const scrollListener = global.window._listeners.scroll;
  assert.ok(scrollListener); // registered on open, per content.js's own openPanel()

  // Simulates the page having scrolled the trigger somewhere else - a real
  // "scroll" event carries no position info itself, the fix is to re-read
  // the trigger's own current rect each time, not reuse the open-time one.
  wrapper._rect = { top: -50, bottom: -20, left: 20, right: 200, width: 180, height: 30 };
  scrollListener();
  await flush(); // requestAnimationFrame is polyfilled onto setTimeout in setupDom

  assert.equal(panel.style.top, "-20px");

  await wrapper._click(); // closes the panel
  assert.equal(panel.classList.contains("tf2te-dropdown-open"), false);
  assert.equal(global.window._listeners.scroll, undefined); // listener detached on close
});
