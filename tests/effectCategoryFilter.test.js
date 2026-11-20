import { test } from "node:test";
import assert from "node:assert/strict";
import { effectCategoryFilter } from "../backpack.tf/oldUI/effectCategoryFilter/content.js";
import { __resetSchemaCacheForTests } from "../utils/tf2Schema.js";

// See tests/nextUiEffectClassFilter.test.js's own header note on why this
// reset is needed between tests (utils/tf2Schema.js memoizes a schema
// promise at module scope).
test.beforeEach(() => {
  __resetSchemaCacheForTests();
});

const SECTION_ATTR = "data-tf2te-section";
const FILTERED_OUT_CLASS = "tf2te-effect-category-filtered-out";

// Minimal hand-rolled fakes (see tests/helpers/fakeDom.js's own header on why
// this repo hand-rolls rather than pulling in jsdom). Item shapes mirror real
// markup confirmed live against the bare classic backpack.tf /effects list
// page - see content.js's own header note.

function fakeItem(effectName) {
  const classSet = new Set();
  const attrs = { "data-effect_name": effectName };
  return {
    getAttribute: (name) => attrs[name] ?? null,
    setAttribute: (name, value) => {
      attrs[name] = value;
    },
    classList: {
      toggle: (cls, force) => {
        if (force) classSet.add(cls);
        else classSet.delete(cls);
      },
      contains: (cls) => classSet.has(cls),
    },
    parentElement: null,
  };
}

function fakeButton() {
  const listeners = {};
  const classSet = new Set();
  const attrs = {};
  const children = [];
  return {
    type: "",
    className: "",
    textContent: "",
    title: "",
    style: {},
    dataset: {},
    // Used by the "needs a key" button (utils/linkButtonStates.js).
    setAttribute: (name, value) => {
      attrs[name] = value;
    },
    getAttribute: (name) => attrs[name] ?? null,
    removeAttribute: (name) => {
      delete attrs[name];
    },
    appendChild: (child) => {
      children.push(child);
      return child;
    },
    addEventListener: (eventName, cb) => {
      listeners[eventName] = cb;
    },
    classList: {
      add: (cls) => classSet.add(cls),
      toggle: (cls, force) => (force ? classSet.add(cls) : classSet.delete(cls)),
      contains: (cls) => classSet.has(cls),
    },
    _click: async () => {
      await listeners.click?.();
    },
    _children: children,
  };
}

// Used for both the button group/badge (plain appendChild) and, via the
// same createElement("div") calls content.js itself makes, each section
// header bar - so also needs setAttribute/getAttribute (SECTION_ATTR) and
// its own classList (toggled by applySectionFilter, same as a real item).
function fakeGenericElement() {
  const children = [];
  const attrs = {};
  const classSet = new Set();
  return {
    id: "",
    className: "",
    textContent: "",
    parentElement: null,
    setAttribute: (name, value) => {
      attrs[name] = value;
    },
    getAttribute: (name) => attrs[name] ?? null,
    removeAttribute: (name) => {
      delete attrs[name];
    },
    style: {},
    dataset: {},
    appendChild: (child) => {
      children.push(child);
      return child;
    },
    remove() {
      this._removed = true;
    },
    classList: {
      add: (cls) => classSet.add(cls),
      toggle: (cls, force) => (force ? classSet.add(cls) : classSet.delete(cls)),
      contains: (cls) => classSet.has(cls),
    },
    _children: children,
  };
}

function fakeInputGroup() {
  const inserted = [];
  return {
    insertAdjacentElement: (position, el) => inserted.push({ position, el }),
    _inserted: inserted,
  };
}

// The real <ul> every item already lives in - appendChild here mirrors real
// DOM move semantics (relocating an already-attached node, not duplicating
// it), since content.js's own groupItemsIntoSections re-appends items that
// are already children of this same list.
function fakeList(initialItems) {
  const list = {
    _children: [...initialItems],
    appendChild: (child) => {
      const currentParent = child.parentElement;
      if (currentParent) {
        const idx = currentParent._children.indexOf(child);
        if (idx !== -1) currentParent._children.splice(idx, 1);
      }
      list._children.push(child);
      child.parentElement = list;
      return child;
    },
  };
  initialItems.forEach((item) => {
    item.parentElement = list;
  });
  return list;
}

function setupDom({ items = [], inputGroup = null, existingGroupEl = null, storage = {}, pathname = "/effects" } = {}) {
  const list = fakeList(items);
  global.window = { location: { pathname } };

  global.document = {
    getElementById: (id) => {
      if (id === "unusual-pricelist-input-group") return inputGroup;
      if (id === "tf2te-effect-category-filter") {
        return existingGroupEl ?? inputGroup?._inserted.map(({ el }) => el).find((el) => el.id === id) ?? null;
      }
      if (id === "tf2te-effect-category-filter-styles") return null;
      // The "needs a key" button, once inserted (and until removed).
      if (id === "tf2te-effect-category-filter-key-hint") {
        return inputGroup?._inserted.map(({ el }) => el).find((el) => el.id === id && !el._removed) ?? null;
      }
      return null;
    },
    querySelectorAll: (selector) => {
      if (selector === "li.item[data-effect_name]:not([data-class])") return items;
      if (selector === `[${SECTION_ATTR}]`) return list._children.filter((el) => el.getAttribute(SECTION_ATTR) != null);
      return [];
    },
    createElement: (tag) => (tag === "button" ? fakeButton() : fakeGenericElement()),
    createElementNS: () => fakeGenericElement(),
    head: { appendChild() {} },
  };
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
  return { list };
}

function mockSchemaWithParticles(particles) {
  global.chrome.runtime.sendMessage = async (msg) => {
    if (msg.url.includes("GetSchemaItems")) return { ok: true, data: { result: { items: [], next: null } } };
    if (msg.url.includes("GetSchemaOverview")) {
      return { ok: true, data: { result: { attribute_controlled_attached_particles: particles } } };
    }
    return { ok: false };
  };
}

test("does nothing when there's no #unusual-pricelist-input-group on the page", async () => {
  setupDom({ items: [fakeItem("Nebula")], inputGroup: null, storage: { steamApiKey: "KEY123" } });
  await assert.doesNotThrow(async () => effectCategoryFilter());
});

// backpack.tf's single-item Unusual price list shares the /effects list
// markup, but every effect there fits the one item, so the buttons only ever
// showed one section (reported live on /unusual/Virtual%20Viewfinder).
test("does nothing on a single item's Unusual price list (/unusual/{item}), even with matching markup", async () => {
  const inputGroup = fakeInputGroup();
  setupDom({
    items: [fakeItem("Nebula")],
    inputGroup,
    storage: { steamApiKey: "KEY123" },
    pathname: "/unusual/Virtual%20Viewfinder",
  });

  await effectCategoryFilter();

  assert.deepEqual(inputGroup._inserted, []);
});

test("does nothing when no item on the page carries data-effect_name at all", async () => {
  const inputGroup = fakeInputGroup();
  setupDom({ items: [], inputGroup, storage: { steamApiKey: "KEY123" } });

  await effectCategoryFilter();

  assert.deepEqual(inputGroup._inserted, []);
});

// Without a key the filter can't work, but it used to just not appear, which
// looked broken. Now a "needs a key" button sits where the button row goes,
// same as the next.backpack.tf filters.
test("with no Steam API key, shows a 'Hat / Taunt / Weapon filter' key button where the button row goes", async () => {
  const inputGroup = fakeInputGroup();
  setupDom({ items: [fakeItem("Nebula")], inputGroup, storage: {} });

  await effectCategoryFilter();

  assert.equal(inputGroup._inserted.length, 1);
  const { position, el } = inputGroup._inserted[0];
  assert.equal(position, "afterend");
  assert.equal(el.id, "tf2te-effect-category-filter-key-hint");
  const button = el._children[0];
  assert.equal(button.className, "btn btn-default"); // never Bootstrap's .disabled (blocks hover/click)
  assert.equal(button.dataset.tf2teNeedsKey, "1");
  assert.match(button.title, /Hat\/Taunt\/Weapon filter needs a Steam Web API key/);
});

test("swaps the key button for the button group once a Steam API key is saved in the popup, without needing a page reload", async () => {
  const inputGroup = fakeInputGroup();
  const storage = {}; // no steamApiKey yet
  setupDom({ items: [fakeItem("Nebula")], inputGroup, storage });

  await effectCategoryFilter();
  assert.equal(inputGroup._inserted.length, 1); // just the key button - no key configured
  const keyHint = inputGroup._inserted[0].el;

  // Simulates the user saving a key in the popup while this page stays open.
  storage.steamApiKey = "KEY123";
  mockSchemaWithParticles([{ id: 99, name: "Nebula", system: "unusual_nebula" }]);
  await global.__triggerApiKeySaved();

  assert.equal(inputGroup._inserted.length, 2);
  assert.equal(inputGroup._inserted[1].el.id, "tf2te-effect-category-filter");
  assert.equal(keyHint._removed, true, "the key button is removed once the real buttons are in");
});

test("REGRESSION: two concurrent key-saved retries insert only one button group and group the list only once", async () => {
  const inputGroup = fakeInputGroup();
  const storage = {};
  const { list } = setupDom({ items: [fakeItem("Nebula")], inputGroup, storage });

  await effectCategoryFilter();
  storage.steamApiKey = "KEY123";
  mockSchemaWithParticles([{ id: 99, name: "Nebula", system: "unusual_nebula" }]);
  // Two storage changes in quick succession (e.g. the key saved twice).
  await Promise.all([global.__triggerApiKeySaved(), global.__triggerApiKeySaved()]);

  const groups = inputGroup._inserted.filter(({ el }) => el.id === "tf2te-effect-category-filter");
  assert.equal(groups.length, 1);
  const headerBars = list._children.filter((el) => el.className === "page-number");
  assert.equal(headerBars.length, 1);
});

test("does nothing when the button group is already present (idempotent across repeated calls)", async () => {
  const inputGroup = fakeInputGroup();
  setupDom({ items: [fakeItem("Nebula")], inputGroup, existingGroupEl: fakeGenericElement(), storage: { steamApiKey: "KEY123" } });

  await effectCategoryFilter();

  assert.deepEqual(inputGroup._inserted, []);
});

test("inserts a 4-button group (All/Hat/Taunt/Weapon) into the input group when effect items exist and a key is configured", async () => {
  const inputGroup = fakeInputGroup();
  setupDom({ items: [fakeItem("Nebula")], inputGroup, storage: { steamApiKey: "KEY123" } });
  mockSchemaWithParticles([{ id: 99, name: "Nebula", system: "unusual_nebula" }]);

  await effectCategoryFilter();

  assert.equal(inputGroup._inserted.length, 1);
  assert.equal(inputGroup._inserted[0].position, "afterend"); // a sibling after the whole filter/sort row, not crammed inside it
  const group = inputGroup._inserted[0].el;
  assert.deepEqual(
    group._children.map((b) => b.textContent),
    ["All", "Hat", "Taunt", "Weapon"]
  );
});

test("groups items into Hat/Taunt/Weapon/Other sections in that order, each with a .page-number/.label header bar, dropping empty sections", async () => {
  const nebulaItem = fakeItem("Nebula"); // hat
  const phantasmItem = fakeItem("Haunted Phantasm"); // taunt
  const hotItem = fakeItem("Hot"); // weapon
  const unknownItem = fakeItem("Some Brand New Effect"); // not in the schema at all
  const inputGroup = fakeInputGroup();
  const { list } = setupDom({ items: [nebulaItem, phantasmItem, hotItem, unknownItem], inputGroup, storage: { steamApiKey: "KEY123" } });
  mockSchemaWithParticles([
    { id: 99, name: "Nebula", system: "unusual_nebula" },
    { id: 3011, name: "Haunted Phantasm", system: "utaunt_souls_green_parent" },
    { id: 701, name: "Hot", system: "weapon_unusual_hot" },
  ]);

  await effectCategoryFilter();

  // header, item, header, item, header, item, header, item - hat/taunt/weapon/other order.
  assert.equal(list._children.length, 8);
  const [hatHeader, hat1, tauntHeader, taunt1, weaponHeader, weapon1, otherHeader, other1] = list._children;

  assert.equal(hatHeader.className, "page-number");
  assert.equal(hatHeader.getAttribute(SECTION_ATTR), "hat");
  assert.equal(hatHeader._children[0].textContent, "Hat effects");
  assert.equal(hatHeader._children[0].className, "label label-default");
  assert.equal(hat1, nebulaItem);

  assert.equal(tauntHeader.getAttribute(SECTION_ATTR), "taunt");
  assert.equal(tauntHeader._children[0].textContent, "Taunt effects");
  assert.equal(taunt1, phantasmItem);

  assert.equal(weaponHeader.getAttribute(SECTION_ATTR), "weapon");
  assert.equal(weaponHeader._children[0].textContent, "Weapon effects");
  assert.equal(weapon1, hotItem);

  // an effect the schema can't categorize lands in "Other effects" - never silently dropped from the page.
  assert.equal(otherHeader.getAttribute(SECTION_ATTR), "other");
  assert.equal(otherHeader._children[0].textContent, "Other effects");
  assert.equal(other1, unknownItem);

  assert.equal(nebulaItem.getAttribute(SECTION_ATTR), "hat");
});

test("builds no header bar for a category with zero items on the page", async () => {
  const nebulaItem = fakeItem("Nebula"); // hat only - no taunt/weapon/other items at all
  const inputGroup = fakeInputGroup();
  const { list } = setupDom({ items: [nebulaItem], inputGroup, storage: { steamApiKey: "KEY123" } });
  mockSchemaWithParticles([{ id: 99, name: "Nebula", system: "unusual_nebula" }]);

  await effectCategoryFilter();

  assert.equal(list._children.length, 2); // just the one header + the one item
  assert.equal(list._children[0].getAttribute(SECTION_ATTR), "hat");
});

test("clicking 'Taunt' hides every other section's header bar and items, showing only the taunt section", async () => {
  const nebulaItem = fakeItem("Nebula"); // hat
  const phantasmItem = fakeItem("Haunted Phantasm"); // taunt
  const hotItem = fakeItem("Hot"); // weapon
  const inputGroup = fakeInputGroup();
  const { list } = setupDom({ items: [nebulaItem, phantasmItem, hotItem], inputGroup, storage: { steamApiKey: "KEY123" } });
  mockSchemaWithParticles([
    { id: 99, name: "Nebula", system: "unusual_nebula" },
    { id: 3011, name: "Haunted Phantasm", system: "utaunt_souls_green_parent" },
    { id: 701, name: "Hot", system: "weapon_unusual_hot" },
  ]);

  await effectCategoryFilter();
  const group = inputGroup._inserted[0].el;
  const findButton = (label) => group._children.find((b) => b.textContent === label);

  await findButton("Taunt")._click();

  const [hatHeader, , tauntHeader, , weaponHeader] = list._children;
  assert.equal(hatHeader.classList.contains(FILTERED_OUT_CLASS), true);
  assert.equal(nebulaItem.classList.contains(FILTERED_OUT_CLASS), true);
  assert.equal(tauntHeader.classList.contains(FILTERED_OUT_CLASS), false);
  assert.equal(phantasmItem.classList.contains(FILTERED_OUT_CLASS), false);
  assert.equal(weaponHeader.classList.contains(FILTERED_OUT_CLASS), true);
  assert.equal(hotItem.classList.contains(FILTERED_OUT_CLASS), true);

  await findButton("All")._click();
  assert.equal(hatHeader.classList.contains(FILTERED_OUT_CLASS), false);
  assert.equal(tauntHeader.classList.contains(FILTERED_OUT_CLASS), false);
  assert.equal(weaponHeader.classList.contains(FILTERED_OUT_CLASS), false);
});

test("categorizes an item's effect name case-insensitively against the schema's own casing", async () => {
  const item = fakeItem("nebula"); // lowercase, unlike the schema's "Nebula"
  const inputGroup = fakeInputGroup();
  setupDom({ items: [item], inputGroup, storage: { steamApiKey: "KEY123" } });
  mockSchemaWithParticles([{ id: 99, name: "Nebula", system: "unusual_nebula" }]);

  await effectCategoryFilter();

  assert.equal(item.getAttribute(SECTION_ATTR), "hat");
});
