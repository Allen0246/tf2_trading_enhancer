import { test } from "node:test";
import assert from "node:assert/strict";
import { effectClassFilter } from "../backpack.tf/oldUI/effectClassFilter/content.js";

// Minimal hand-rolled fakes (see tests/helpers/fakeDom.js's own header on why
// this repo hand-rolls rather than pulling in jsdom). Item shapes mirror
// real markup confirmed live against a classic backpack.tf /effect/<name>
// page - see content.js's own header note.

function fakeItem(dataClass) {
  const classSet = new Set();
  return {
    getAttribute: (name) => (name === "data-class" ? dataClass : null),
    classList: {
      toggle: (cls, force) => {
        if (force) classSet.add(cls);
        else classSet.delete(cls);
      },
      contains: (cls) => classSet.has(cls),
    },
  };
}

// Doubles as both the per-option <a> (click/dataset-driven) and the
// dropdown's own toggle <a> (appendChild/setAttribute-driven, for its icon +
// label span children) - document.createElement("a") returns this same
// shape for both in content.js.
function fakeAnchor() {
  const listeners = {};
  const children = [];
  const attrs = {};
  return {
    dataset: {},
    textContent: "",
    className: "",
    href: "",
    tabIndex: 0,
    addEventListener: (eventName, cb) => {
      listeners[eventName] = cb;
    },
    setAttribute: (name, value) => {
      attrs[name] = value;
    },
    appendChild: (el) => {
      children.push(el);
      return el;
    },
    _click: () => listeners.click?.(),
    _children: children,
  };
}

function fakeGenericElement() {
  const children = [];
  const attrs = {};
  return {
    id: "",
    className: "",
    innerHTML: "",
    textContent: "",
    dataset: {},
    style: {},
    setAttribute: (name, value) => {
      attrs[name] = value;
    },
    appendChild: (el) => {
      children.push(el);
      return el;
    },
    _children: children,
  };
}

function fakeInputGroup() {
  const prepended = [];
  return {
    prepend: (el) => prepended.push(el),
    _prepended: prepended,
  };
}

function setupDom({ items = [], inputGroup = null, nativeClassmenu = null } = {}) {
  const createdAnchors = [];
  global.document = {
    getElementById: (id) => {
      if (id === "classmenu") return nativeClassmenu;
      if (id === "unusual-pricelist-input-group") return inputGroup;
      if (id === "tf2te-effect-class-filter-styles") return null;
      return null;
    },
    querySelectorAll: (selector) => (selector === "li.item[data-class]" ? items : []),
    createElement: (tag) => {
      if (tag === "a") {
        const a = fakeAnchor();
        createdAnchors.push(a);
        return a;
      }
      return fakeGenericElement();
    },
    createTextNode: (text) => ({ textContent: text }),
    head: { appendChild() {} },
  };
  return { createdAnchors };
}

test("does nothing when the native /unusuals class dropdown (#classmenu) is already present", () => {
  const inputGroup = fakeInputGroup();
  setupDom({ items: [fakeItem("Spy")], inputGroup, nativeClassmenu: { already: "there" } });

  effectClassFilter();

  assert.deepEqual(inputGroup._prepended, []);
});

test("does nothing when there's no #unusual-pricelist-input-group on the page", () => {
  setupDom({ items: [fakeItem("Spy")], inputGroup: null });
  assert.doesNotThrow(() => effectClassFilter());
});

test("does nothing when no item on the page carries data-class at all (e.g. the bare /effect/ browse-all page)", () => {
  const inputGroup = fakeInputGroup();
  setupDom({ items: [], inputGroup });

  effectClassFilter();

  assert.deepEqual(inputGroup._prepended, []);
});

test("inserts the dropdown into the input group when items with data-class exist and no native dropdown is present", () => {
  const inputGroup = fakeInputGroup();
  setupDom({ items: [fakeItem("Spy")], inputGroup });

  effectClassFilter();

  assert.equal(inputGroup._prepended.length, 1);
});

test("clicking a specific class option filters out every item that doesn't match it", () => {
  const spyItem = fakeItem("Spy");
  const scoutItem = fakeItem("Scout");
  const inputGroup = fakeInputGroup();
  const { createdAnchors } = setupDom({ items: [spyItem, scoutItem], inputGroup });

  effectClassFilter();
  const spyOption = createdAnchors.find((a) => a.dataset.class === "Spy");
  spyOption._click();

  assert.equal(spyItem.classList.contains("tf2te-class-filtered-out"), false);
  assert.equal(scoutItem.classList.contains("tf2te-class-filtered-out"), true);
});

test("'Multi' only matches items whose data-class is literally 'Multi', not every item", () => {
  const multiItem = fakeItem("Multi");
  const spyItem = fakeItem("Spy");
  const inputGroup = fakeInputGroup();
  const { createdAnchors } = setupDom({ items: [multiItem, spyItem], inputGroup });

  effectClassFilter();
  const multiOption = createdAnchors.find((a) => a.dataset.class === "Multi");
  multiOption._click();

  assert.equal(multiItem.classList.contains("tf2te-class-filtered-out"), false);
  assert.equal(spyItem.classList.contains("tf2te-class-filtered-out"), true);
});

test("'All' shows every item regardless of data-class, including after a specific class was previously selected", () => {
  const spyItem = fakeItem("Spy");
  const scoutItem = fakeItem("Scout");
  const inputGroup = fakeInputGroup();
  const { createdAnchors } = setupDom({ items: [spyItem, scoutItem], inputGroup });

  effectClassFilter();
  createdAnchors.find((a) => a.dataset.class === "Spy")._click();
  createdAnchors.find((a) => a.dataset.class === "All")._click();

  assert.equal(spyItem.classList.contains("tf2te-class-filtered-out"), false);
  assert.equal(scoutItem.classList.contains("tf2te-class-filtered-out"), false);
});
