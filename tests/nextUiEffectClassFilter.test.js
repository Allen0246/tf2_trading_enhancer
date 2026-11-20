import { test } from "node:test";
import assert from "node:assert/strict";
import { effectClassFilter, __resetClassCacheForTests } from "../backpack.tf/nextUI/effectClassFilter/content.js";
import { __resetSchemaCacheForTests } from "../utils/tf2Schema.js";

// utils/tf2Schema.js memoizes a schema promise at module scope, which this
// file's own tests indirectly depend on via effectClassFilter's own
// getItemClasses/hasSchemaAccess calls - without resetting it between tests
// (see tf2Schema.test.js's own header note on why), a schema resolved by
// one test would stay memoized for every later test in this file regardless
// of that test's own storage/sendMessage setup.
test.beforeEach(() => {
  __resetSchemaCacheForTests();
  __resetClassCacheForTests();
});

// Minimal hand-rolled fakes (see tests/helpers/fakeDom.js's own header on why
// this repo hand-rolls rather than pulling in jsdom). Item/dropdown/section
// shapes mirror real markup confirmed live against next.backpack.tf's own
// /effects/<name> pages - see content.js's own header note.

function fakeItemEl(href) {
  const classSet = new Set();
  return {
    getAttribute: (name) => (name === "href" ? href : null),
    classList: {
      toggle: (cls, force) => {
        if (force) classSet.add(cls);
        else classSet.delete(cls);
      },
      contains: (cls) => classSet.has(cls),
    },
  };
}

// The real "Sort by Value"/"Sort by Name"/"Sort by # in Existence" dropdown,
// used purely as a style reference - carries one Vue scoped-style attribute
// (confirmed live: data-v-7332f3c4) alongside its class list.
function fakeReferenceDropdown() {
  return {
    className: "sort-dropdown mb-3 p-dropdown p-component p-inputwrapper p-inputwrapper-filled",
    getAttributeNames: () => ["data-v-7332f3c4", "class"],
    getAttribute: (name) => (name === "data-v-7332f3c4" ? "" : null),
  };
}

// A generic element used for every document.createElement() call in
// content.js (div/span/ul/li alike) - `contains` walks `_children`
// recursively, matching real DOM's own Node.contains semantics, since
// content.js relies on that (both the wrapper's own toggle-click handler and
// the document-level close-on-outside-click handler check it against a
// click event's own target).
function fakeGenericElement() {
  const children = [];
  const listeners = {};
  const classSet = new Set();
  const attrs = {};
  const el = {
    id: "",
    // className and classList share one class set, like the real DOM (the
    // "needs a key" button sets its classes through className).
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
    textContent: "",
    style: {},
    dataset: {},
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
    removeAttribute: (name) => {
      delete attrs[name];
    },
    getAttributeNames: () => Object.keys(attrs),
    getAttribute: (name) => attrs[name] ?? null,
    appendChild: (child) => {
      children.push(child);
      return child;
    },
    insertAdjacentElement: () => {},
    addEventListener: (eventName, cb) => {
      listeners[eventName] = cb;
    },
    contains: (node) => node === el || children.some((child) => child === node || child.contains?.(node)),
    _click: async () => {
      await listeners.click?.({ target: el });
    },
    _children: children,
  };
  return el;
}

// A single "Variants"/"Unpriced Variants"-style section: wires up
// searchInput.closest(".card") to return a fake card scoped to this
// section's own items/reference dropdown/inserted-wrapper state, and wraps
// whatever insertAdjacentElement the test already assigned (its own
// insertCalls/insertedWrapper tracking, if any) so the card also learns
// about the insert - matching content.js's own per-section
// tryInsertSection, which re-queries the card (not the whole document) to
// check whether a dropdown is already there.
function buildSection({ items = [], searchInput, referenceDropdown = fakeReferenceDropdown(), existingWrapperEl = null }) {
  // Everything inserted into this section, matched by class like the real
  // DOM (the dropdown, or the "needs a key" button standing in for it).
  const inserted = existingWrapperEl ? [existingWrapperEl] : [];
  existingWrapperEl?.classList?.add("tf2te-effect-class-filter-wrapper");
  const byClass = (selector) => {
    const match = /^\.(\S+)$/.exec(selector);
    return match ? inserted.filter((el) => el.classList?.contains(match[1]) ?? true) : [];
  };
  const card = {
    dataset: {},
    querySelectorAll: (selector) => (selector === 'a.item[class*="item__quality-"]' ? items : byClass(selector)),
    querySelector: (selector) => {
      if (selector === ".sort-dropdown") return referenceDropdown;
      return byClass(selector)[0] ?? null;
    },
    _inserted: inserted,
  };
  searchInput.closest = (selector) => (selector === ".card" ? card : null);
  const previousInsert = searchInput.insertAdjacentElement;
  searchInput.insertAdjacentElement = (position, el) => {
    inserted.push(el);
    el.remove = () => {
      const i = inserted.indexOf(el);
      if (i !== -1) inserted.splice(i, 1);
    };
    previousInsert(position, el);
  };
  return card;
}

function setupDom({
  items = [],
  searchInput = null,
  referenceDropdown = fakeReferenceDropdown(),
  existingWrapperEl = null,
  extraSections = [],
  storage = {},
  pathname = "/effects/Burning%20Flames",
} = {}) {
  const documentListeners = {};
  const searchInputs = [];

  if (searchInput) {
    buildSection({ items, searchInput, referenceDropdown, existingWrapperEl });
    searchInputs.push(searchInput);
  }

  extraSections.forEach((section) => {
    const sectionSearchInput = section.searchInput ?? fakeGenericElement();
    buildSection({ ...section, searchInput: sectionSearchInput });
    searchInputs.push(sectionSearchInput);
  });

  global.document = {
    querySelectorAll: (selector) => (selector === 'input[placeholder="Search by name"]' ? searchInputs : []),
    querySelector: () => null,
    getElementById: (id) => (id === "tf2te-effect-class-filter-styles" ? null : null),
    createElement: () => fakeGenericElement(),
    createElementNS: () => fakeGenericElement(),
    createTextNode: (text) => ({ textContent: text }),
    addEventListener: (eventName, cb) => {
      documentListeners[eventName] = cb;
    },
    head: { appendChild() {} },
  };
  global.MutationObserver = class {
    observe() {}
  };
  global.window = { location: { origin: "https://next.backpack.tf", pathname } };
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
  // Simulates the extension popup saving a Steam API key while this page is
  // already open - fires every registered chrome.storage.onChanged listener
  // the same way the real chrome.storage.onChanged event would.
  global.__triggerApiKeySaved = () =>
    Promise.all(onChangedListeners.map((cb) => cb({ steamApiKey: { newValue: "KEY123" } }, "local")));
}

// A short delay to let effectClassFilter's own internal async work
// (hasSchemaAccess/getItemClasses promise chains) settle before assertions -
// tryInsert() itself isn't awaited by the exported effectClassFilter().
async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 10));
}

test("does nothing when there are no item tiles in a section", async () => {
  const searchInput = fakeGenericElement();
  let insertCalls = 0;
  searchInput.insertAdjacentElement = () => {
    insertCalls++;
  };
  setupDom({ items: [], searchInput, storage: { steamApiKey: "KEY123" } });

  effectClassFilter();
  await flush();

  assert.equal(insertCalls, 0);
});

test("does nothing when there's no 'Search by name' input anywhere on the page (no section to find at all)", async () => {
  setupDom({ items: [], searchInput: null });

  effectClassFilter();
  await flush();

  assert.doesNotThrow(() => {});
});

test("does nothing when a section has no 'Sort by Value' dropdown to use as a style reference - never guesses at styling from scratch", async () => {
  const item = fakeItemEl("/stats?item=Noh%20Mercy&quality=Unusual");
  const searchInput = fakeGenericElement();
  let insertCalls = 0;
  searchInput.insertAdjacentElement = () => {
    insertCalls++;
  };
  setupDom({ items: [item], searchInput, referenceDropdown: null, storage: { steamApiKey: "KEY123" } });

  effectClassFilter();
  await flush();

  assert.equal(insertCalls, 0);
});

// Without a key the dropdown can't work, but it used to just not appear,
// which looked broken (reported live on /effects/Misty Skull). Now a "needs a
// key" button sits in its spot (../backpack.tf/nextUI/shared/filterKeyHint.js),
// chosen from a mockup.
test("with no Steam API key, shows a 'Class filter' key button before the search box instead of nothing", async () => {
  const item = fakeItemEl("/stats?item=Noh%20Mercy&quality=Unusual");
  const searchInput = fakeGenericElement();
  const inserted = [];
  searchInput.insertAdjacentElement = (position, el) => inserted.push({ position, el });
  setupDom({ items: [item], searchInput, storage: {} }); // no steamApiKey in storage

  effectClassFilter();
  await flush();

  assert.equal(inserted.length, 1);
  const { position, el } = inserted[0];
  assert.equal(position, "beforebegin");
  assert.equal(el.classList.contains("tf2te-effect-class-filter-key-hint"), true);
  assert.equal(el.classList.contains("tf2te-effect-class-filter-wrapper"), false);
  assert.equal(el.dataset.tf2teNeedsKey, "1");
  assert.match(el.title, /class filter needs a Steam Web API key/);
  // Shaped like the dropdown: the reference's classes (minus its own
  // sort-dropdown marker) and its Vue scoped-style attribute.
  assert.equal(el.classList.contains("sort-dropdown"), false);
  assert.equal(el.getAttribute("data-v-7332f3c4"), "");

  // Repeated observer ticks don't add a second one.
  effectClassFilter();
  await flush();
  assert.equal(inserted.length, 1);
});

test("automatically swaps the key button for the dropdown once a Steam API key is saved in the popup, without needing a page reload", async () => {
  const item = fakeItemEl("/stats?item=Noh%20Mercy&quality=Unusual");
  const scoutItem = fakeItemEl("/stats?item=Bonk!%20Atomic%20Punch&quality=Unusual"); // a second class, see below
  const searchInput = fakeGenericElement();
  const storage = {}; // no steamApiKey yet
  setupDom({ items: [item, scoutItem], searchInput, storage });
  const card = searchInput.closest(".card");

  effectClassFilter();
  await flush();
  assert.equal(card._inserted.length, 1);
  assert.equal(card._inserted[0].dataset.tf2teNeedsKey, "1"); // just the key button - no key configured

  // Simulates the user saving a key in the popup while this page stays open.
  storage.steamApiKey = "KEY123";
  // Bonk resolves to Scout and Noh Mercy stays unrestricted: two classes, so
  // the dropdown is worth showing (a single-class page gets none).
  global.chrome.runtime.sendMessage = async (msg) => {
    if (msg.url.includes("GetSchemaItems")) {
      return { ok: true, data: { result: { items: [{ item_name: "Bonk! Atomic Punch", defindex: 46, used_by_classes: ["Scout"] }], next: null } } };
    }
    if (msg.url.includes("GetSchemaOverview")) return { ok: true, data: { result: {} } };
    return { ok: false };
  };
  await global.__triggerApiKeySaved();

  assert.equal(card._inserted.length, 1, "the key button is replaced, not kept next to the dropdown");
  assert.equal(card._inserted[0].classList.contains("tf2te-effect-class-filter-wrapper"), true);
});

test("inserts the dropdown BEFORE the search box (not after), cloning the reference dropdown's classes and scoped-style attribute, with 11 class options in its panel", async () => {
  const item = fakeItemEl("/stats?item=Noh%20Mercy&quality=Unusual");
  const searchInput = fakeGenericElement();
  let insertedWrapper = null;
  let insertedPosition = null;
  searchInput.insertAdjacentElement = (position, el) => {
    insertedPosition = position;
    insertedWrapper = el;
  };
  const scoutItem = fakeItemEl("/stats?item=Bonk!%20Atomic%20Punch&quality=Unusual");
  setupDom({ items: [item, scoutItem], searchInput, storage: { steamApiKey: "KEY123" } });
  // Noh Mercy has no schema match (unrestricted), Bonk is Scout: two classes.
  global.chrome.runtime.sendMessage = async (msg) => {
    if (msg.url.includes("GetSchemaItems")) {
      return { ok: true, data: { result: { items: [{ item_name: "Bonk! Atomic Punch", defindex: 46, used_by_classes: ["Scout"] }], next: null } } };
    }
    if (msg.url.includes("GetSchemaOverview")) return { ok: true, data: { result: {} } };
    return { ok: false };
  };

  effectClassFilter();
  await flush();

  assert.equal(insertedPosition, "beforebegin");
  assert.ok(insertedWrapper);
  assert.equal(insertedWrapper.getAttribute("data-v-7332f3c4"), ""); // scoped-style attr copied from the reference
  assert.ok(insertedWrapper.className.includes("p-dropdown")); // PrimeVue classes carried over
  assert.equal(insertedWrapper.className.includes("sort-dropdown"), false); // the reference's own specific class is not
  assert.ok(insertedWrapper.classList.contains("tf2te-effect-class-filter-wrapper")); // the per-section marker class

  // wrapper children, in append order: labelContainer, trigger, panel.
  const [labelContainer, , panel] = insertedWrapper._children;
  const label = labelContainer._children[0];
  assert.equal(label.textContent, "Any class");
  // panel children, in append order: header, itemsWrapper.
  const [header, itemsWrapper] = panel._children;
  assert.ok(header); // select-all checkbox + close button
  const list = itemsWrapper._children[0]; // itemsWrapper > ul
  assert.equal(list._children.length, 11); // 9 specific classes + Multi-Class + All-Class

  // The scoped-style attribute has to reach every element the site's own
  // themed CSS targets, not just the wrapper - observed that the
  // panel/checkbox's own real colors didn't apply without this (Vue stamps
  // that attribute onto every element a scoped component renders).
  assert.equal(panel.getAttribute("data-v-7332f3c4"), "");
  const firstRow = list._children[0];
  assert.equal(firstRow.getAttribute("data-v-7332f3c4"), "");
  const rowCheckboxBox = firstRow._children[0]._children[0]; // li > checkbox wrapper > box
  assert.equal(rowCheckboxBox.getAttribute("data-v-7332f3c4"), "");
});

test("does nothing on the bare /effects list page (no specific effect name) - item tiles/search box can also be present there", async () => {
  const item = fakeItemEl("/stats?item=Noh%20Mercy&quality=Unusual");
  const searchInput = fakeGenericElement();
  let insertCalls = 0;
  searchInput.insertAdjacentElement = () => {
    insertCalls++;
  };
  setupDom({ items: [item], searchInput, storage: { steamApiKey: "KEY123" }, pathname: "/effects" });

  effectClassFilter();
  await flush();

  assert.equal(insertCalls, 0);
});

test("does nothing on the bare /effects/ list page (trailing slash) either", async () => {
  const item = fakeItemEl("/stats?item=Noh%20Mercy&quality=Unusual");
  const searchInput = fakeGenericElement();
  let insertCalls = 0;
  searchInput.insertAdjacentElement = () => {
    insertCalls++;
  };
  setupDom({ items: [item], searchInput, storage: { steamApiKey: "KEY123" }, pathname: "/effects/" });

  effectClassFilter();
  await flush();

  assert.equal(insertCalls, 0);
});

test("does nothing on the bare /war-paints list page, which has the same item-tile/search-box/sort-dropdown shape but already has its own native class filter", async () => {
  const item = fakeItemEl("/stats?item=Noh%20Mercy&quality=Unusual");
  const searchInput = fakeGenericElement();
  let insertCalls = 0;
  searchInput.insertAdjacentElement = () => {
    insertCalls++;
  };
  setupDom({ items: [item], searchInput, storage: { steamApiKey: "KEY123" }, pathname: "/war-paints" });

  effectClassFilter();
  await flush();

  assert.equal(insertCalls, 0);
});

test("inserts on a specific-War-Paint page (/war-paints/Mosaic), which has the same section shape as a specific-effect page and no native class filter of its own", async () => {
  // Decorated Weapon hrefs carry the plain schema weapon name in the same
  // "item" param as an effect's item name - no special parsing needed (see
  // content.js's own header note).
  const rocketLauncherItem = fakeItemEl(
    "/stats?item=Rocket%20Launcher&quality=Decorated%20Weapon&wearTier=Field-Tested&texture=Mosaic"
  );
  // A multi-weapon War Paint: its variants span more than one class.
  const wrenchItem = fakeItemEl("/stats?item=Wrench&quality=Decorated%20Weapon&wearTier=Field-Tested&texture=Mosaic");
  const searchInput = fakeGenericElement();
  let insertCalls = 0;
  searchInput.insertAdjacentElement = () => {
    insertCalls++;
  };
  setupDom({ items: [rocketLauncherItem, wrenchItem], searchInput, storage: { steamApiKey: "KEY123" }, pathname: "/war-paints/Mosaic" });
  global.chrome.runtime.sendMessage = async (msg) => {
    if (msg.url.includes("GetSchemaItems")) {
      return {
        ok: true,
        data: {
          result: {
            items: [
              { item_name: "Rocket Launcher", defindex: 205, used_by_classes: ["Soldier"] },
              { item_name: "Wrench", defindex: 197, used_by_classes: ["Engineer"] },
            ],
            next: null,
          },
        },
      };
    }
    if (msg.url.includes("GetSchemaOverview")) return { ok: true, data: { result: {} } };
    return { ok: false };
  };

  effectClassFilter();
  await flush();

  assert.equal(insertCalls, 1);
});

test("still excludes the bare /war-paints/ list page (trailing slash) even with a name-shaped second segment check", async () => {
  const item = fakeItemEl("/stats?item=Noh%20Mercy&quality=Unusual");
  const searchInput = fakeGenericElement();
  let insertCalls = 0;
  searchInput.insertAdjacentElement = () => {
    insertCalls++;
  };
  setupDom({ items: [item], searchInput, storage: { steamApiKey: "KEY123" }, pathname: "/war-paints/" });

  effectClassFilter();
  await flush();

  assert.equal(insertCalls, 0);
});

test("does nothing in a section that already has a dropdown (idempotent across repeated calls/observer ticks)", async () => {
  const item = fakeItemEl("/stats?item=Noh%20Mercy&quality=Unusual");
  const searchInput = fakeGenericElement();
  let insertCalls = 0;
  searchInput.insertAdjacentElement = () => {
    insertCalls++;
  };
  setupDom({ items: [item], searchInput, existingWrapperEl: fakeGenericElement(), storage: { steamApiKey: "KEY123" } });

  effectClassFilter();
  await flush();

  assert.equal(insertCalls, 0);
});

test("inserts an independent dropdown into EACH section on the page (e.g. 'Variants' and 'Unpriced Variants'), filtering only that section's own items", async () => {
  // "Variants" (priced): a Spy item and an unrestricted one (two classes).
  const pricedSpyItem = fakeItemEl("/stats?item=Noh%20Mercy&quality=Unusual");
  const pricedHatItem = fakeItemEl("/stats?item=Bill's%20Hat&quality=Unusual");
  const pricedSearchInput = fakeGenericElement();
  let pricedInsertedWrapper = null;
  pricedSearchInput.insertAdjacentElement = (position, el) => {
    pricedInsertedWrapper = el;
  };

  // "Unpriced Variants": a Scout item and an unrestricted one.
  const unpricedScoutItem = fakeItemEl("/stats?item=Bonk!%20Atomic%20Punch&quality=Unusual");
  const unpricedHatItem = fakeItemEl("/stats?item=Bill's%20Hat&quality=Unusual");
  const unpricedSearchInput = fakeGenericElement();
  let unpricedInsertedWrapper = null;
  unpricedSearchInput.insertAdjacentElement = (position, el) => {
    unpricedInsertedWrapper = el;
  };

  setupDom({
    items: [pricedSpyItem, pricedHatItem],
    searchInput: pricedSearchInput,
    storage: { steamApiKey: "KEY123" },
    extraSections: [{ items: [unpricedScoutItem, unpricedHatItem], searchInput: unpricedSearchInput }],
  });
  global.chrome.runtime.sendMessage = async (msg) => {
    if (msg.url.includes("GetSchemaItems")) {
      return {
        ok: true,
        data: {
          result: {
            items: [
              { item_name: "Noh Mercy", defindex: 361, used_by_classes: ["Spy"] },
              { item_name: "Bonk! Atomic Punch", defindex: 46, used_by_classes: ["Scout"] },
            ],
            next: null,
          },
        },
      };
    }
    if (msg.url.includes("GetSchemaOverview")) return { ok: true, data: { result: {} } };
    return { ok: false };
  };

  effectClassFilter();
  await flush();

  // Both sections got their own dropdown - two distinct wrapper elements.
  assert.ok(pricedInsertedWrapper);
  assert.ok(unpricedInsertedWrapper);
  assert.notEqual(pricedInsertedWrapper, unpricedInsertedWrapper);

  // Filtering in the "Variants" section's own dropdown never touches the
  // "Unpriced Variants" section's own item.
  const findSpyOption = (wrapper) => {
    const [, , panel] = wrapper._children;
    const [, itemsWrapper] = panel._children;
    return itemsWrapper._children[0]._children.find((li) => li.getAttribute("aria-label") === "Spy");
  };
  await findSpyOption(pricedInsertedWrapper)._click();
  await flush();

  assert.equal(pricedSpyItem.classList.contains("tf2te-effect-class-filtered-out"), false);
  assert.equal(unpricedScoutItem.classList.contains("tf2te-effect-class-filtered-out"), false); // untouched - different section
});

test("clicking a specific class option filters items, updates the visible label, and highlights only that option; unchecking clears the filter again", async () => {
  const spyItem = fakeItemEl("/stats?item=Noh%20Mercy&quality=Unusual"); // resolves to ["Spy"]
  const scoutItem = fakeItemEl("/stats?item=Bonk!%20Atomic%20Punch&quality=Unusual"); // resolves to ["Scout"]
  const unrestrictedItem = fakeItemEl("/stats?item=Bill's%20Hat&quality=Unusual"); // no used_by_classes at all
  const searchInput = fakeGenericElement();
  let insertedWrapper = null;
  searchInput.insertAdjacentElement = (position, el) => {
    insertedWrapper = el;
  };
  setupDom({ items: [spyItem, scoutItem, unrestrictedItem], searchInput, storage: { steamApiKey: "KEY123" } });
  global.chrome.runtime.sendMessage = async (msg) => {
    if (msg.url.includes("GetSchemaItems")) {
      return {
        ok: true,
        data: {
          result: {
            items: [
              { item_name: "Noh Mercy", defindex: 361, used_by_classes: ["Spy"] },
              { item_name: "Bonk! Atomic Punch", defindex: 46, used_by_classes: ["Scout"] },
              { item_name: "Bill's Hat", defindex: 378 },
            ],
            next: null,
          },
        },
      };
    }
    if (msg.url.includes("GetSchemaOverview")) return { ok: true, data: { result: {} } };
    return { ok: false };
  };

  effectClassFilter();
  await flush();
  assert.ok(insertedWrapper);

  const [labelContainer, , panel] = insertedWrapper._children;
  const label = labelContainer._children[0];
  const [, itemsWrapper] = panel._children; // header, itemsWrapper
  const list = itemsWrapper._children[0];
  const findOption = (ariaLabel) => list._children.find((li) => li.getAttribute("aria-label") === ariaLabel);
  const checkboxBox = (li) => li._children[0]._children[0]; // li > checkbox wrapper > box

  // Checking "Spy" alone: exclusive bucketing means the unrestricted item
  // (bucket "All") does NOT also match, unlike the old single-select
  // version's "unrestricted matches every specific class" behavior.
  await findOption("Spy")._click();
  await flush();
  assert.equal(label.textContent, "Spy");
  assert.equal(checkboxBox(findOption("Spy")).classList.contains("p-highlight"), true);
  assert.equal(checkboxBox(findOption("Scout")).classList.contains("p-highlight"), false);
  assert.equal(spyItem.classList.contains("tf2te-effect-class-filtered-out"), false);
  assert.equal(scoutItem.classList.contains("tf2te-effect-class-filtered-out"), true);
  assert.equal(unrestrictedItem.classList.contains("tf2te-effect-class-filtered-out"), true);

  // Checking "All-Class" too (multi-select, on top of "Spy") shows both
  // buckets - the union, not a replacement.
  await findOption("All-Class")._click();
  await flush();
  assert.equal(label.textContent, "Spy, All-Class");
  assert.equal(spyItem.classList.contains("tf2te-effect-class-filtered-out"), false);
  assert.equal(scoutItem.classList.contains("tf2te-effect-class-filtered-out"), true);
  assert.equal(unrestrictedItem.classList.contains("tf2te-effect-class-filtered-out"), false);

  // Unchecking both clears the filter entirely (no boxes checked = show
  // everything), same as the old single-select's "Any class" reset.
  await findOption("Spy")._click();
  await findOption("All-Class")._click();
  await flush();
  assert.equal(label.textContent, "Any class");
  assert.equal(spyItem.classList.contains("tf2te-effect-class-filtered-out"), false);
  assert.equal(scoutItem.classList.contains("tf2te-effect-class-filtered-out"), false);
  assert.equal(unrestrictedItem.classList.contains("tf2te-effect-class-filtered-out"), false);
});

// A skin made for one weapon (reported live: /war-paints/Sand%20Cannon, every
// variant a Sniper weapon) could only be filtered to "everything" or
// "nothing", so it gets no class dropdown. A page spanning 2+ classes does.
function sniperOnlySchema(extraItems = []) {
  return async (msg) => {
    if (msg.url.includes("GetSchemaItems")) {
      return {
        ok: true,
        data: { result: { items: [{ item_name: "Sniper Rifle", defindex: 201, used_by_classes: ["Sniper"] }, ...extraItems], next: null } },
      };
    }
    if (msg.url.includes("GetSchemaOverview")) return { ok: true, data: { result: {} } };
    return { ok: false };
  };
}

test("adds no class dropdown on a single-weapon skin page, where every variant is one class", async () => {
  const variants = ["Factory%20New", "Field-Tested"].map((wear) =>
    fakeItemEl(`/stats?item=Sniper%20Rifle&quality=Decorated%20Weapon&wearTier=${wear}&texture=Sand%20Cannon`)
  );
  const searchInput = fakeGenericElement();
  let insertCalls = 0;
  searchInput.insertAdjacentElement = () => {
    insertCalls++;
  };
  setupDom({ items: variants, searchInput, storage: { steamApiKey: "KEY123" }, pathname: "/war-paints/Sand%20Cannon" });
  global.chrome.runtime.sendMessage = sniperOnlySchema();

  effectClassFilter();
  await flush();

  assert.equal(insertCalls, 0);
  assert.equal(searchInput.closest(".card").dataset.tf2teClassFilterSingleClassAt, "2", "remembers it checked these 2 items");
});

test("adds the dropdown once items of a second class load into a section that was single-class", async () => {
  const items = [fakeItemEl("/stats?item=Sniper%20Rifle&quality=Decorated%20Weapon&wearTier=Field-Tested&texture=Mosaic")];
  const searchInput = fakeGenericElement();
  let insertCalls = 0;
  searchInput.insertAdjacentElement = () => {
    insertCalls++;
  };
  setupDom({ items, searchInput, storage: { steamApiKey: "KEY123" }, pathname: "/war-paints/Mosaic" });
  global.chrome.runtime.sendMessage = sniperOnlySchema([{ item_name: "Wrench", defindex: 197, used_by_classes: ["Engineer"] }]);

  effectClassFilter();
  await flush();
  assert.equal(insertCalls, 0);

  // More variants render (the same section array the page's grid reads).
  items.push(fakeItemEl("/stats?item=Wrench&quality=Decorated%20Weapon&wearTier=Field-Tested&texture=Mosaic"));
  effectClassFilter();
  await flush();

  assert.equal(insertCalls, 1);
});
