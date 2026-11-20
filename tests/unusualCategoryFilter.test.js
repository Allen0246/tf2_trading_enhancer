import { test } from "node:test";
import assert from "node:assert/strict";
import { unusualCategoryFilter } from "../backpack.tf/oldUI/unusualCategoryFilter/content.js";

// Minimal hand-rolled fakes (see tests/helpers/fakeDom.js's own header on why
// this repo hand-rolls rather than pulling in jsdom). Item/level-bar shapes
// mirror real markup confirmed live against backpack.tf's own /unusuals page
// - see content.js's own header note.

const SECTION_ATTR = "data-tf2te-unusual-section";
const FILTERED_OUT_CLASS = "tf2te-unusual-category-filtered-out";

function fakeItem(dataSlot) {
  const classSet = new Set();
  const attrs = { "data-slot": dataSlot };
  return {
    getAttribute: (name) => attrs[name] ?? null,
    setAttribute: (name, value) => {
      attrs[name] = value;
    },
    classList: {
      toggle: (cls, force) => (force ? classSet.add(cls) : classSet.delete(cls)),
      contains: (cls) => classSet.has(cls),
    },
    parentElement: null,
  };
}

function fakeLink(href) {
  const attrs = { href };
  return {
    getAttribute: (name) => attrs[name] ?? null,
    setAttribute: (name, value) => {
      attrs[name] = value;
    },
  };
}

// A NATIVE .page-number level bar, already on the page before this feature
// runs - distinct from buildSectionHeader's own output (this file's own
// content.js never creates one of these itself, only clones/removes them).
function fakeLevelBar(pageId) {
  const attrs = {};
  const classSet = new Set(["page-number"]);
  const anchor = { id: pageId };
  const link = fakeLink(`#${pageId}`);
  const bar = {
    classList: {
      contains: (c) => classSet.has(c),
      add: (c) => classSet.add(c),
      toggle: (c, force) => (force ? classSet.add(c) : classSet.delete(c)),
    },
    getAttribute: (name) => attrs[name] ?? null,
    setAttribute: (name, value) => {
      attrs[name] = value;
    },
    hasAttribute: (name) => name in attrs,
    parentElement: null,
    querySelector: (selector) => {
      if (selector === ".page-anchor") return anchor;
      if (selector === 'a[href^="#"]') return link;
      return null;
    },
    cloneNode: () => fakeLevelBar(pageId), // a fresh, independent copy with the SAME starting anchor id/href
    remove: () => {
      if (bar.parentElement) {
        const idx = bar.parentElement._children.indexOf(bar);
        if (idx !== -1) bar.parentElement._children.splice(idx, 1);
      }
    },
    _anchor: anchor,
    _link: link,
  };
  return bar;
}

function fakeButton() {
  const listeners = {};
  const classSet = new Set();
  return {
    type: "",
    className: "",
    textContent: "",
    addEventListener: (eventName, cb) => {
      listeners[eventName] = cb;
    },
    classList: {
      add: (cls) => classSet.add(cls),
      toggle: (cls, force) => (force ? classSet.add(cls) : classSet.delete(cls)),
      contains: (cls) => classSet.has(cls),
    },
    _click: () => listeners.click?.(),
  };
}

// Used for the button group + the section header bars/badges this file's
// own content.js builds via document.createElement (never for a NATIVE
// level bar - see fakeLevelBar above for that).
function fakeGenericElement() {
  const children = [];
  const attrs = {};
  const classSet = new Set();
  const el = {
    id: "",
    className: "",
    textContent: "",
    parentElement: null,
    setAttribute: (name, value) => {
      attrs[name] = value;
    },
    getAttribute: (name) => attrs[name] ?? null,
    appendChild: (child) => {
      children.push(child);
      child.parentElement = el;
      return child;
    },
    classList: {
      add: (cls) => classSet.add(cls),
      contains: (cls) => classSet.has(cls),
      toggle: (cls, force) => (force ? classSet.add(cls) : classSet.delete(cls)),
    },
    _children: children,
  };
  return el;
}

function fakeInputGroup() {
  const inserted = [];
  return {
    insertAdjacentElement: (position, el) => inserted.push({ position, el }),
    _inserted: inserted,
  };
}

// The real <ul> every item/level-bar already lives in - appendChild mirrors
// real DOM move semantics (relocating an already-attached node), matching
// content.js's own groupItemsIntoSections, which re-appends nodes already
// present in this same list.
function fakeList(initialChildren) {
  const list = {
    _children: [...initialChildren],
    get children() {
      return list._children;
    },
    appendChild: (child) => {
      const currentParent = child.parentElement;
      if (currentParent?._children) {
        const idx = currentParent._children.indexOf(child);
        if (idx !== -1) currentParent._children.splice(idx, 1);
      }
      list._children.push(child);
      child.parentElement = list;
      return child;
    },
  };
  initialChildren.forEach((child) => {
    child.parentElement = list;
  });
  return list;
}

function setupDom({ children = [], items = [], inputGroup = null, existingGroupEl = null, pathname = "/unusuals" } = {}) {
  const list = fakeList(children);

  global.document = {
    getElementById: (id) => {
      if (id === "unusual-pricelist-input-group") return inputGroup;
      if (id === "tf2te-unusual-category-filter") return existingGroupEl;
      if (id === "tf2te-unusual-category-filter-styles") return null;
      return null;
    },
    querySelectorAll: (selector) => {
      if (selector === "li.item[data-slot]") return items;
      if (selector === `[${SECTION_ATTR}]`) return list._children.filter((el) => el.getAttribute?.(SECTION_ATTR) != null);
      return [];
    },
    createElement: (tag) => (tag === "button" ? fakeButton() : fakeGenericElement()),
    head: { appendChild() {} },
  };
  global.window = { location: { pathname } };

  return { list };
}

test("does nothing off /unusuals, even with matching items on the page", () => {
  const item = fakeItem("misc");
  const inputGroup = fakeInputGroup();
  setupDom({ children: [item], items: [item], inputGroup, pathname: "/effects" });

  unusualCategoryFilter();

  assert.deepEqual(inputGroup._inserted, []);
});

test("does nothing when the button group is already present (idempotent across repeated calls)", () => {
  const item = fakeItem("misc");
  const inputGroup = fakeInputGroup();
  setupDom({ children: [item], items: [item], inputGroup, existingGroupEl: fakeGenericElement() });

  unusualCategoryFilter();

  assert.deepEqual(inputGroup._inserted, []);
});

test("does nothing when there's no #unusual-pricelist-input-group on the page", () => {
  setupDom({ items: [fakeItem("misc")], inputGroup: null });
  assert.doesNotThrow(() => unusualCategoryFilter());
});

test("does nothing when no item on the page carries data-slot at all", () => {
  const inputGroup = fakeInputGroup();
  setupDom({ items: [], inputGroup });

  unusualCategoryFilter();

  assert.deepEqual(inputGroup._inserted, []);
});

test("inserts a 3-button group (All/Hats/Taunts) after the input group, needing no Steam API key at all", () => {
  const item = fakeItem("misc");
  const inputGroup = fakeInputGroup();
  setupDom({ children: [item], items: [item], inputGroup });

  unusualCategoryFilter();

  assert.equal(inputGroup._inserted.length, 1);
  assert.equal(inputGroup._inserted[0].position, "afterend");
  const group = inputGroup._inserted[0].el;
  assert.deepEqual(
    group._children.map((b) => b.textContent),
    ["All", "Hats", "Taunts"]
  );
});

test("groups items into Hat/Taunt sections, each keeping its own nested per-level bars (cloned with unique anchor ids) in original level order", () => {
  const levelBar1 = fakeLevelBar("page1");
  const hatItem1 = fakeItem("misc"); // level 1, hat
  const tauntItem1 = fakeItem("taunt"); // level 1, taunt - same level split across both categories
  const levelBar2 = fakeLevelBar("page2");
  const hatItem2 = fakeItem("misc"); // level 2, hat only

  const inputGroup = fakeInputGroup();
  const { list } = setupDom({
    children: [levelBar1, hatItem1, tauntItem1, levelBar2, hatItem2],
    items: [hatItem1, tauntItem1, hatItem2],
    inputGroup,
  });

  unusualCategoryFilter();

  assert.equal(list._children.length, 8);
  const [hatHeader, l1HatBar, h1, l2HatBar, h2, tauntHeader, l1TauntBar, t1] = list._children;

  assert.equal(hatHeader.className, "page-number");
  assert.equal(hatHeader.getAttribute(SECTION_ATTR), "hat");
  assert.equal(hatHeader._children[0].textContent, "Hats");
  assert.equal(hatHeader._children[0].className, "label label-default");

  assert.equal(l1HatBar.getAttribute(SECTION_ATTR), "hat");
  assert.equal(l1HatBar._anchor.id, "page1-hat"); // suffixed, not the native "page1" - avoids a duplicate id
  assert.equal(l1HatBar._link.getAttribute("href"), "#page1-hat");
  assert.equal(h1, hatItem1);

  assert.equal(l2HatBar._anchor.id, "page2-hat");
  assert.equal(h2, hatItem2);

  assert.equal(tauntHeader.getAttribute(SECTION_ATTR), "taunt");
  assert.equal(tauntHeader._children[0].textContent, "Taunts");

  assert.equal(l1TauntBar.getAttribute(SECTION_ATTR), "taunt");
  assert.equal(l1TauntBar._anchor.id, "page1-taunt"); // the SAME native level, a DIFFERENT clone/id for this section
  assert.equal(t1, tauntItem1);

  // the native bars themselves are gone - only clones remain.
  assert.equal(list._children.includes(levelBar1), false);
  assert.equal(list._children.includes(levelBar2), false);

  assert.equal(hatItem1.getAttribute(SECTION_ATTR), "hat");
  assert.equal(tauntItem1.getAttribute(SECTION_ATTR), "taunt");
});

test("builds no 'Taunts' section at all when every item on the page is a hat", () => {
  const levelBar1 = fakeLevelBar("page1");
  const hatItem = fakeItem("misc");
  const inputGroup = fakeInputGroup();
  const { list } = setupDom({ children: [levelBar1, hatItem], items: [hatItem], inputGroup });

  unusualCategoryFilter();

  assert.equal(list._children.length, 3); // hat header + 1 level bar + 1 item
  assert.equal(list._children.every((el) => el.getAttribute(SECTION_ATTR) !== "taunt"), true);
});

test("an item with no data-slot at all defaults to the Hat section, not dropped", () => {
  const item = fakeItem(null);
  const inputGroup = fakeInputGroup();
  setupDom({ children: [item], items: [item], inputGroup });

  unusualCategoryFilter();

  assert.equal(item.getAttribute(SECTION_ATTR), "hat");
});

test("clicking 'Taunts' hides every hat-section element (header + nested level bar + items), showing only the taunt section; 'All' restores everything", () => {
  const levelBar1 = fakeLevelBar("page1");
  const hatItem = fakeItem("misc");
  const tauntItem = fakeItem("taunt");
  const inputGroup = fakeInputGroup();
  const { list } = setupDom({ children: [levelBar1, hatItem, tauntItem], items: [hatItem, tauntItem], inputGroup });

  unusualCategoryFilter();
  const group = inputGroup._inserted[0].el;
  const findButton = (label) => group._children.find((b) => b.textContent === label);

  findButton("Taunts")._click();

  const [hatHeader, l1HatBar, , tauntHeader, l1TauntBar] = list._children;
  assert.equal(hatHeader.classList.contains(FILTERED_OUT_CLASS), true);
  assert.equal(l1HatBar.classList.contains(FILTERED_OUT_CLASS), true);
  assert.equal(hatItem.classList.contains(FILTERED_OUT_CLASS), true);
  assert.equal(tauntHeader.classList.contains(FILTERED_OUT_CLASS), false);
  assert.equal(l1TauntBar.classList.contains(FILTERED_OUT_CLASS), false);
  assert.equal(tauntItem.classList.contains(FILTERED_OUT_CLASS), false);

  findButton("All")._click();
  assert.equal(hatHeader.classList.contains(FILTERED_OUT_CLASS), false);
  assert.equal(tauntHeader.classList.contains(FILTERED_OUT_CLASS), false);
});
