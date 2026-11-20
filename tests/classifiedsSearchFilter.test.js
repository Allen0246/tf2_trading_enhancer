import { test } from "node:test";
import assert from "node:assert/strict";
import { classifiedsSearchFilter } from "../backpack.tf/oldUI/classifiedsSearchFilter/content.js";

// Minimal hand-rolled fakes (see tests/oldUiSpellFilterToggle.test.js's own
// header note on why this repo hand-rolls rather than pulling in jsdom) -
// same li.listing/.listing-title h5 markup shape that feature's own header
// note confirms live against real backpack.tf/classifieds pages.
//
// content.js now inserts its own input via the REAL
// ../backpack.tf/oldUI/classifiedsControlsRow.js (imported relatively, not
// mocked here) rather than managing its own insertion chain - so this
// file's own fake `document` only needs to satisfy THAT module's own
// requirements; the row's own fallback chain (nav vs #search-crumbs vs
// panel-body prepend) is already covered by
// tests/classifiedsControlsRow.test.js, so this file only exercises the
// nav-present path and asserts against the row's own children.

function fakeTitleEl(text) {
  return { textContent: text };
}

function fakeItemEl(attrs) {
  return { getAttribute: (name) => (name in attrs ? attrs[name] : null) };
}

function fakeListing(titleText, itemAttrs = null) {
  const classes = new Set();
  return {
    querySelector: (selector) => {
      if (selector === ".listing-title h5") return fakeTitleEl(titleText);
      if (selector === ".listing-item .item") return itemAttrs ? fakeItemEl(itemAttrs) : null;
      return null;
    },
    classList: {
      toggle(cls, force) {
        const shouldHave = force === undefined ? !classes.has(cls) : force;
        if (shouldHave) classes.add(cls);
        else classes.delete(cls);
      },
      contains: (cls) => classes.has(cls),
    },
  };
}

function fakeInputEl() {
  const listeners = {};
  return {
    type: null,
    className: "",
    placeholder: "",
    style: {},
    value: "",
    addEventListener(eventName, cb) {
      listeners[eventName] = cb;
    },
    _type(value) {
      this.value = value;
      return listeners.input?.();
    },
  };
}

function fakeRowEl() {
  const children = [];
  return {
    id: "",
    style: {},
    children,
    appendChild(el) {
      children.push(el);
      return el;
    },
  };
}

function fakeNav() {
  let controlsRow = null;
  return {
    insertAdjacentElement(position, el) {
      if (position === "afterend") controlsRow = el;
    },
    getControlsRow: () => controlsRow,
  };
}

function setupDom({ listings = [], existingInput = null, existingStyle = null } = {}) {
  const nav = fakeNav();
  const headAppended = [];
  global.document = {
    querySelectorAll: (selector) => (selector === "li.listing" ? listings : []),
    querySelector: (selector) => {
      if (selector === ".tf2te-classifieds-search-filter") return existingInput;
      return null;
    },
    getElementById: (id) => {
      if (id === "tf2te-oldui-classifieds-controls-row") return nav.getControlsRow();
      if (id === "ks-tier-nav") return nav;
      if (id === "tf2te-classifieds-search-filter-styles") return existingStyle;
      return null;
    },
    createElement: (tag) => (tag === "input" ? fakeInputEl() : fakeRowEl()),
    head: { appendChild: (el) => headAppended.push(el) },
    _headAppended: headAppended,
  };
  return nav;
}

function getInput(nav) {
  return nav.getControlsRow().children[0];
}

test("does nothing when there are no listings on the page at all", () => {
  const nav = setupDom({ listings: [] });

  classifiedsSearchFilter();

  assert.equal(nav.getControlsRow(), null);
});

test("does nothing when the search box is already inserted", () => {
  const listing = fakeListing("Professor Speks Strangifier Chemistry Set");
  const nav = setupDom({ listings: [listing], existingInput: { value: "" } });

  classifiedsSearchFilter();

  assert.equal(nav.getControlsRow(), null);
});

test("typing a query hides listings whose title doesn't contain it (case-insensitive), and clearing it shows everything again", () => {
  const speks = fakeListing("Professor Speks Strangifier Chemistry Set");
  const boston = fakeListing("Boston Boom-Bringer Strangifier Chemistry Set");
  const nav = setupDom({ listings: [speks, boston] });

  classifiedsSearchFilter();
  const input = getInput(nav);

  input._type("professor speks");
  assert.equal(speks.classList.contains("tf2te-classifieds-search-filtered-out"), false);
  assert.equal(boston.classList.contains("tf2te-classifieds-search-filtered-out"), true);

  input._type("");
  assert.equal(speks.classList.contains("tf2te-classifieds-search-filtered-out"), false);
  assert.equal(boston.classList.contains("tf2te-classifieds-search-filtered-out"), false);
});

// REGRESSION for a live feature request: a search like "Purple Energy" or a
// paint/spell name never appears in the listing's own visible TITLE text at
// all (same gap ../spellFilterToggle/content.js's own data-spell_1/2 check
// exists to cover) - matching against the .item element's own
// data-paint_name/data-effect_name/data-spell_1/data-spell_2 attributes too
// lets a query find these even though the title alone wouldn't.
test("matches a query against the item's data-effect_name even though it never appears in the visible title", () => {
  const unusual = fakeListing("Unusual Team Captain", { "data-effect_name": "Purple Energy" });
  const plain = fakeListing("Team Captain", null);
  const nav = setupDom({ listings: [unusual, plain] });

  classifiedsSearchFilter();
  const input = getInput(nav);
  input._type("purple energy");

  assert.equal(unusual.classList.contains("tf2te-classifieds-search-filtered-out"), false);
  assert.equal(plain.classList.contains("tf2te-classifieds-search-filtered-out"), true);
});

test("matches a query against the item's data-paint_name", () => {
  const painted = fakeListing("Team Captain", { "data-paint_name": "Australium Gold" });
  const unpainted = fakeListing("Team Captain", null);
  const nav = setupDom({ listings: [painted, unpainted] });

  classifiedsSearchFilter();
  const input = getInput(nav);
  input._type("australium gold");

  assert.equal(painted.classList.contains("tf2te-classifieds-search-filtered-out"), false);
  assert.equal(unpainted.classList.contains("tf2te-classifieds-search-filtered-out"), true);
});

test("matches a query against either data-spell_1 or data-spell_2", () => {
  const spelled = fakeListing("Ghastly Ghoul Mask", {
    "data-spell_1": "Paint Spell: Spectral Spectrum",
    "data-spell_2": "Footsteps Spell: Team Spirit Footprints",
  });
  const plain = fakeListing("Ghastly Ghoul Mask", null);
  const nav = setupDom({ listings: [spelled, plain] });

  classifiedsSearchFilter();
  const input = getInput(nav);

  input._type("spectral spectrum");
  assert.equal(spelled.classList.contains("tf2te-classifieds-search-filtered-out"), false);
  assert.equal(plain.classList.contains("tf2te-classifieds-search-filtered-out"), true);

  input._type("team spirit footprints");
  assert.equal(spelled.classList.contains("tf2te-classifieds-search-filtered-out"), false);
});

test("a listing with no matching .listing-title h5 at all is treated as non-matching for any real query, not a crash", () => {
  const noTitle = { querySelector: () => null, classList: { toggle() {}, contains: () => false } };
  let filteredOut = false;
  noTitle.classList.toggle = (cls, force) => {
    filteredOut = force;
  };
  const nav = setupDom({ listings: [noTitle] });

  classifiedsSearchFilter();
  const input = getInput(nav);
  input._type("anything");

  assert.equal(filteredOut, true);
});

test("lands after whatever the spell/Strange toggles already put in the shared row (call-order-based, not an explicit chain)", () => {
  const listing = fakeListing("Rocket Launcher");
  setupDom({ listings: [listing] });
  // Simulate the spell/Strange toggles having already run first.
  const preExistingRow = fakeRowEl();
  const spellButton = fakeRowEl();
  spellButton.textContent = "Hide spelled items";
  const strangeButton = fakeRowEl();
  strangeButton.textContent = "Hide Strange items";
  preExistingRow.appendChild(spellButton);
  preExistingRow.appendChild(strangeButton);
  global.document.getElementById = (id) => (id === "tf2te-oldui-classifieds-controls-row" ? preExistingRow : null);

  classifiedsSearchFilter();

  assert.equal(preExistingRow.children.length, 3);
  assert.equal(preExistingRow.children[2].type, "text"); // the search input, appended last
});

test("injects its own filtered-out stylesheet rule exactly once", () => {
  const listing = fakeListing("Rocket Launcher");
  setupDom({ listings: [listing] });

  classifiedsSearchFilter();

  assert.equal(document._headAppended.length, 1);
  assert.match(document._headAppended[0].textContent, /display:\s*none\s*!important/);
});
