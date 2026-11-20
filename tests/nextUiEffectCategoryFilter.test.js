import { test } from "node:test";
import assert from "node:assert/strict";
import { effectCategoryFilter } from "../backpack.tf/nextUI/effectCategoryFilter/content.js";
import { __resetSchemaCacheForTests } from "../utils/tf2Schema.js";

// utils/tf2Schema.js memoizes a schema promise at module scope (see
// tf2Schema.test.js's own header note on why) - reset between tests so each
// gets its own storage/sendMessage-driven schema.
test.beforeEach(() => {
  __resetSchemaCacheForTests();
});

const SECTION_ATTR = "data-tf2te-section";
const FILTERED_OUT_CLASS = "tf2te-effect-category-filtered-out";

// Minimal hand-rolled fakes (see tests/helpers/fakeDom.js's own header on why
// this repo hand-rolls rather than pulling in jsdom). Item/dropdown shapes
// mirror real markup confirmed live against next.backpack.tf's own bare
// /effects list page - see content.js's own header note.

function fakeItemEl(href) {
  const classSet = new Set();
  const attrs = {};
  return {
    getAttribute: (name) => (name === "href" ? href : (attrs[name] ?? null)),
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

// The real container every item tile already lives in - appendChild here
// mirrors real DOM move semantics (relocating an already-attached node, not
// duplicating it), since content.js's own groupItemsIntoSections re-appends
// items that are already children of this same container.
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

// The real "Sort by Avg. Value" dropdown, used purely as a style reference -
// carries one Vue scoped-style attribute (confirmed live: data-v-7332f3c4)
// alongside its class list.
function fakeReferenceDropdown() {
  return {
    className: "sort-dropdown mb-3 p-dropdown p-component p-inputwrapper p-inputwrapper-filled",
    getAttributeNames: () => ["data-v-7332f3c4", "class"],
    getAttribute: (name) => (name === "data-v-7332f3c4" ? "" : null),
  };
}

// Used for every document.createElement() call in content.js other than the
// item tiles themselves - the dropdown's own div/span/ul/li nodes AND each
// section header bar (which also needs setAttribute/getAttribute for
// SECTION_ATTR, same as a real item does).
function fakeGenericElement() {
  const children = [];
  const listeners = {};
  // Backs BOTH className and classList, kept in sync exactly like real DOM
  // (className is just classList's own serialized token set there) -
  // content.js both assigns className directly (e.g. cloning the reference
  // dropdown's classes) AND calls classList.add/remove/toggle on the same
  // element, so a fake where those two are independent would silently pass
  // assertions for the wrong reason (or fail ones that are actually correct).
  const classSet = new Set();
  const attrs = {};
  const el = {
    id: "",
    textContent: "",
    style: {},
    parentElement: null,
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
  Object.defineProperty(el, "className", {
    get: () => Array.from(classSet).join(" "),
    set: (value) => {
      classSet.clear();
      String(value)
        .split(/\s+/)
        .filter(Boolean)
        .forEach((c) => classSet.add(c));
    },
  });
  return el;
}

function setupDom({
  items = [],
  searchInput = null,
  referenceDropdown = fakeReferenceDropdown(),
  existingWrapperEl = null,
  storage = {},
  pathname = "/effects",
} = {}) {
  const documentListeners = {};
  const list = fakeList(items);
  global.document = {
    querySelectorAll: (selector) => (selector === 'a.item[class*="item__quality-"]' ? items : []),
    querySelector: (selector) => {
      if (selector === 'input[placeholder="Search by name"]') return searchInput;
      if (selector === ".sort-dropdown.p-dropdown") return referenceDropdown;
      return null;
    },
    getElementById: (id) => {
      if (id === "tf2te-effect-category-filter-wrapper") return existingWrapperEl;
      if (id === "tf2te-effect-category-filter-styles") return null;
      return null;
    },
    createElement: () => fakeGenericElement(),
    createElementNS: () => fakeGenericElement(),
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

// A short delay to let effectCategoryFilter's own internal async work
// (hasSchemaAccess/getEffectNameToCategoryMap promise chains) settle before
// assertions - tryInsert() itself isn't awaited by the exported effectCategoryFilter().
async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 10));
}

test("does nothing when there are no item tiles on the page", async () => {
  setupDom({ items: [], searchInput: fakeGenericElement() });

  effectCategoryFilter();
  await flush();

  assert.equal(global.document.getElementById("tf2te-effect-category-filter-wrapper"), null);
});

test("does nothing when the 'Search by name' input isn't present", async () => {
  const item = fakeItemEl("/effects/Nebula");
  setupDom({ items: [item], searchInput: null });

  effectCategoryFilter();
  await flush();

  assert.doesNotThrow(() => {});
});

test("does nothing when there's no 'Sort by Avg. Value' dropdown to use as a style reference - never guesses at styling from scratch", async () => {
  const item = fakeItemEl("/effects/Nebula");
  const searchInput = fakeGenericElement();
  let insertCalls = 0;
  searchInput.insertAdjacentElement = () => {
    insertCalls++;
  };
  setupDom({ items: [item], searchInput, referenceDropdown: null, storage: { steamApiKey: "KEY123" } });

  effectCategoryFilter();
  await flush();

  assert.equal(insertCalls, 0);
});

// Without a key the dropdown can't work, but it used to just not appear,
// which looked broken. Now a "needs a key" button sits in its spot
// (../backpack.tf/nextUI/shared/filterKeyHint.js), chosen from a mockup.
test("with no Steam API key, shows an 'Unusual type' key button in the dropdown's spot instead of nothing", async () => {
  const item = fakeItemEl("/effects/Nebula");
  const searchInput = fakeGenericElement();
  const inserted = [];
  searchInput.insertAdjacentElement = (position, el) => inserted.push({ position, el });
  setupDom({ items: [item], searchInput, storage: {} }); // no steamApiKey in storage

  effectCategoryFilter();
  await flush();

  assert.equal(inserted.length, 1);
  const { position, el } = inserted[0];
  assert.equal(position, "afterend");
  assert.equal(el.id, ""); // not the real dropdown
  assert.equal(el.classList.contains("tf2te-effect-category-filter-key-hint"), true);
  assert.equal(el.dataset.tf2teNeedsKey, "1");
  assert.match(el.title, /Unusual type filter needs a Steam Web API key/);
  // Shaped like the dropdown: the reference's classes (minus its own
  // sort-dropdown marker) and its Vue scoped-style attribute.
  assert.equal(el.classList.contains("p-dropdown"), true);
  assert.equal(el.classList.contains("sort-dropdown"), false);
  assert.equal(el.getAttribute("data-v-7332f3c4"), "");
});

test("automatically inserts the dropdown once a Steam API key is saved in the popup, without needing a page reload", async () => {
  const item = fakeItemEl("/effects/Nebula");
  const searchInput = fakeGenericElement();
  const inserted = [];
  searchInput.insertAdjacentElement = (position, el) => inserted.push(el);
  const storage = {}; // no steamApiKey yet
  setupDom({ items: [item], searchInput, storage });

  effectCategoryFilter();
  await flush();
  assert.equal(inserted.length, 1); // just the key button - no key configured
  assert.equal(inserted[0].dataset.tf2teNeedsKey, "1");

  // Simulates the user saving a key in the popup while this page stays open.
  storage.steamApiKey = "KEY123";
  mockSchemaWithParticles([{ name: "Nebula", id: 99, system: "unusual_nebula" }]);
  await global.__triggerApiKeySaved();

  assert.equal(inserted.length, 2);
  assert.equal(inserted[1].id, "tf2te-effect-category-filter-wrapper");
});

test("does nothing on a specific effect page (not the bare list) - the opposite scoping of effectClassFilter", async () => {
  const item = fakeItemEl("/effects/Nebula");
  const searchInput = fakeGenericElement();
  let insertCalls = 0;
  searchInput.insertAdjacentElement = () => {
    insertCalls++;
  };
  setupDom({ items: [item], searchInput, storage: { steamApiKey: "KEY123" }, pathname: "/effects/Burning%20Flames" });

  effectCategoryFilter();
  await flush();

  assert.equal(insertCalls, 0);
});

test("does nothing on a dropdown re-insert when a dropdown is already present (idempotent across repeated calls/observer ticks)", async () => {
  const item = fakeItemEl("/effects/Nebula");
  const searchInput = fakeGenericElement();
  let insertCalls = 0;
  searchInput.insertAdjacentElement = () => {
    insertCalls++;
  };
  setupDom({ items: [item], searchInput, existingWrapperEl: fakeGenericElement(), storage: { steamApiKey: "KEY123" } });

  effectCategoryFilter();
  await flush();

  assert.equal(insertCalls, 0);
});

test("inserts the dropdown AFTER the search box, cloning the reference dropdown's classes and scoped-style attribute, with 4 category options in its panel", async () => {
  const item = fakeItemEl("/effects/Nebula");
  const searchInput = fakeGenericElement();
  let insertedWrapper = null;
  let insertedPosition = null;
  searchInput.insertAdjacentElement = (position, el) => {
    insertedPosition = position;
    insertedWrapper = el;
  };
  setupDom({ items: [item], searchInput, storage: { steamApiKey: "KEY123" } });
  mockSchemaWithParticles([{ id: 99, name: "Nebula", system: "unusual_nebula" }]);

  effectCategoryFilter();
  await flush();

  assert.equal(insertedPosition, "afterend");
  assert.ok(insertedWrapper);
  assert.equal(insertedWrapper.getAttribute("data-v-7332f3c4"), ""); // scoped-style attr copied from the reference
  assert.ok(insertedWrapper.className.includes("p-dropdown")); // PrimeVue classes carried over
  assert.equal(insertedWrapper.className.includes("sort-dropdown"), false); // the reference's own specific class is not

  // wrapper children, in append order: label, trigger, panel.
  const [label, , panel] = insertedWrapper._children;
  // "Unusual type" is only ever the closed dropdown's own placeholder text
  // (shown before any option has been clicked) - the list itself has no
  // option carrying this text, only "All"/"Hat"/"Taunt"/"Weapon".
  assert.equal(label.textContent, "Unusual type");
  assert.equal(label.classList.contains("p-placeholder"), true);
  const list = panel._children[0]._children[0]; // panel > itemsWrapper > ul
  assert.deepEqual(
    list._children.map((li) => li.textContent),
    ["All", "Hat", "Taunt", "Weapon"]
  );
});

test("groups items into Hat/Taunt/Weapon/Other sections in that order, each with an inventory-divider header bar showing a count, dropping empty sections", async () => {
  const hatItem = fakeItemEl("/effects/Nebula");
  const tauntItem = fakeItemEl("/effects/Startstorm%20Insomnia");
  const weaponItem = fakeItemEl("/effects/Sparkly%20Spruce");
  const unresolvedItem = fakeItemEl("/effects/Not%20A%20Real%20Effect");
  const searchInput = fakeGenericElement();
  searchInput.insertAdjacentElement = () => {};
  const { list } = setupDom({ items: [hatItem, tauntItem, weaponItem, unresolvedItem], searchInput, storage: { steamApiKey: "KEY123" } });
  mockSchemaWithParticles([
    { name: "Nebula", id: 99, system: "unusual_nebula" },
    { name: "Startstorm Insomnia", id: 3010, system: "utaunt_starstorm_purple_parent" },
    { name: "Sparkly Spruce", id: 700, system: "weapon_unusual_sparkly_green" },
  ]);

  effectCategoryFilter();
  await flush();

  // header, item, header, item, header, item, header, item - hat/taunt/weapon/other order.
  assert.equal(list._children.length, 8);
  const [hatHeader, hat1, tauntHeader, taunt1, weaponHeader, weapon1, otherHeader, other1] = list._children;

  assert.equal(hatHeader.className, "inventory-divider mb-2 ms-1");
  assert.equal(hatHeader.getAttribute(SECTION_ATTR), "hat");
  assert.equal(hatHeader._children[0].textContent, "Hat effects (1)");
  assert.equal(hatHeader._children[0].className, "badge inventory-divider__label");
  assert.equal(hat1, hatItem);

  assert.equal(tauntHeader.getAttribute(SECTION_ATTR), "taunt");
  assert.equal(tauntHeader._children[0].textContent, "Taunt effects (1)");
  assert.equal(taunt1, tauntItem);

  assert.equal(weaponHeader.getAttribute(SECTION_ATTR), "weapon");
  assert.equal(weaponHeader._children[0].textContent, "Weapon effects (1)");
  assert.equal(weapon1, weaponItem);

  // an effect the schema can't categorize lands in "Other effects" - never silently dropped from the page.
  assert.equal(otherHeader.getAttribute(SECTION_ATTR), "other");
  assert.equal(otherHeader._children[0].textContent, "Other effects (1)");
  assert.equal(other1, unresolvedItem);
});

test("builds no header bar for a category with zero items on the page", async () => {
  const hatItem = fakeItemEl("/effects/Nebula"); // hat only
  const searchInput = fakeGenericElement();
  searchInput.insertAdjacentElement = () => {};
  const { list } = setupDom({ items: [hatItem], searchInput, storage: { steamApiKey: "KEY123" } });
  mockSchemaWithParticles([{ name: "Nebula", id: 99, system: "unusual_nebula" }]);

  effectCategoryFilter();
  await flush();

  assert.equal(list._children.length, 2); // just the one header + the one item
  assert.equal(list._children[0].getAttribute(SECTION_ATTR), "hat");
});

test("categorizes an effect name case-insensitively against the schema's own casing", async () => {
  const item = fakeItemEl("/effects/nebula"); // lowercase, unlike the schema's "Nebula"
  const searchInput = fakeGenericElement();
  searchInput.insertAdjacentElement = () => {};
  setupDom({ items: [item], searchInput, storage: { steamApiKey: "KEY123" } });
  mockSchemaWithParticles([{ name: "Nebula", id: 99, system: "unusual_nebula" }]);

  effectCategoryFilter();
  await flush();

  assert.equal(item.getAttribute(SECTION_ATTR), "hat");
});

test("clicking a specific category hides every other section's header bar and items, updates the visible label (clearing the placeholder), and highlights only that option; explicitly clicking 'All' clears the filter again and shows 'All' (not the placeholder text)", async () => {
  const hatItem = fakeItemEl("/effects/Nebula");
  const tauntItem = fakeItemEl("/effects/Startstorm%20Insomnia");
  const weaponItem = fakeItemEl("/effects/Sparkly%20Spruce");
  const searchInput = fakeGenericElement();
  let insertedWrapper = null;
  searchInput.insertAdjacentElement = (position, el) => {
    insertedWrapper = el;
  };
  setupDom({ items: [hatItem, tauntItem, weaponItem], searchInput, storage: { steamApiKey: "KEY123" } });
  mockSchemaWithParticles([
    { name: "Nebula", id: 99, system: "unusual_nebula" },
    { name: "Startstorm Insomnia", id: 3010, system: "utaunt_starstorm_purple_parent" },
    { name: "Sparkly Spruce", id: 700, system: "weapon_unusual_sparkly_green" },
  ]);

  effectCategoryFilter();
  await flush();
  assert.ok(insertedWrapper);

  const [label, , panel] = insertedWrapper._children;
  const list = panel._children[0]._children[0];
  const findOption = (text) => list._children.find((li) => li.textContent === text);

  assert.equal(label.textContent, "Unusual type"); // placeholder, before any click
  assert.equal(label.classList.contains("p-placeholder"), true);

  await findOption("Taunt")._click();
  await flush();
  assert.equal(label.textContent, "Taunt");
  assert.equal(label.classList.contains("p-placeholder"), false); // placeholder cleared on first real selection
  assert.equal(findOption("Taunt").classList.contains("p-highlight"), true);
  assert.equal(findOption("All").classList.contains("p-highlight"), false);
  assert.equal(hatItem.classList.contains(FILTERED_OUT_CLASS), true);
  assert.equal(tauntItem.classList.contains(FILTERED_OUT_CLASS), false);
  assert.equal(weaponItem.classList.contains(FILTERED_OUT_CLASS), true);

  await findOption("All")._click();
  await flush();
  assert.equal(label.textContent, "All"); // a real selection, not a reversion to the placeholder text
  assert.equal(label.classList.contains("p-placeholder"), false);
  assert.equal(hatItem.classList.contains(FILTERED_OUT_CLASS), false);
  assert.equal(tauntItem.classList.contains(FILTERED_OUT_CLASS), false);
  assert.equal(weaponItem.classList.contains(FILTERED_OUT_CLASS), false);
});
