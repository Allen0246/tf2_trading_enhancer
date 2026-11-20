import { test } from "node:test";
import assert from "node:assert/strict";
import { warPaintFilterToggle, __resetWarPaintFilterToggleForTests } from "../backpack.tf/nextUI/warPaintFilterToggle/content.js";

// Minimal hand-rolled fakes, mirroring tests/spellFilterToggle.test.js's own
// fixtures (see that file's own header note on why this repo hand-rolls
// rather than pulling in jsdom) - same funnel/trait-filter mechanism, just
// for "War Paints"/"No War Paint" instead of "Spells"/"No Spells", and
// tracking "active" via a module-level boolean (see content.js's own header
// note on why) rather than a URL param.

function fakeGenericElement() {
  const listeners = {};
  let text = "";
  let removed = false;
  return {
    id: "",
    type: null,
    className: "",
    style: {},
    get textContent() {
      return text;
    },
    set textContent(v) {
      text = v;
    },
    addEventListener(eventName, cb) {
      listeners[eventName] = cb;
    },
    _click() {
      return listeners.click?.();
    },
    remove() {
      removed = true;
    },
    isRemoved: () => removed,
  };
}

function fakeLeftContent(referenceButton) {
  let appended = null;
  const isPresent = () => appended && !appended.isRemoved?.();
  return {
    appendedCount: () => (isPresent() ? 1 : 0),
    lastAppended: () => appended,
    querySelector(selector) {
      if (selector === "button") return referenceButton;
      if (selector === ".tf2te-warpaint-filter-toggle") return isPresent() ? appended : null;
      return null;
    },
    appendChild(el) {
      appended = el;
      return el;
    },
  };
}

function fakeLi({ hasItemTraitName, checked = false }) {
  let ariaSelected = checked ? "true" : "false";
  let clicks = 0;
  return {
    getAttribute: (name) => (name === "aria-selected" ? ariaSelected : null),
    querySelector: (selector) => (selector === ".item-trait__name" && hasItemTraitName ? {} : null),
    click() {
      clicks++;
      ariaSelected = ariaSelected === "true" ? "false" : "true";
    },
    clickCount: () => clicks,
    isChecked: () => ariaSelected === "true",
  };
}

function fakePanel({ noWarPaint = null, warPaintsCategory = null, hasAnyOption = true } = {}, domCtl) {
  return {
    querySelector(selector) {
      if (selector === 'li[role="option"]') return hasAnyOption ? {} : null;
      if (selector === 'li[aria-label="No War Paint"]') return noWarPaint;
      if (selector === 'li[aria-label="War Paints"]') return warPaintsCategory;
      if (selector === ".p-multiselect-close") return { click: () => domCtl.setOpenPanel(null) };
      return null;
    },
  };
}

function fakeTraitFilter(panel, domCtl) {
  return {
    querySelector: (selector) => (selector === ".p-multiselect-trigger" ? { click: () => domCtl.setOpenPanel(panel) } : null),
  };
}

class FakeMutationObserver {
  constructor(cb) {
    this.cb = cb;
    FakeMutationObserver.instances.push(this);
  }
  observe() {}
}
FakeMutationObserver.instances = [];

function setupDom({ leftContents = [], traitFilters = [], addFiltersButton = null, href } = {}) {
  __resetWarPaintFilterToggleForTests(); // module-level `active` would otherwise leak across tests
  FakeMutationObserver.instances = [];
  global.MutationObserver = FakeMutationObserver;

  let openPanel = null;
  let headEl = null;
  const domCtl = {
    setOpenPanel: (p) => {
      openPanel = p;
    },
  };

  global.document = {
    body: {},
    head: {
      appendChild: (el) => {
        headEl = el;
      },
    },
    getElementById: (id) => (headEl && headEl.id === id && !headEl.isRemoved() ? headEl : null),
    querySelectorAll: (selector) => {
      if (selector === ".p-paginator-left-content") return leftContents;
      if (selector === ".trait-filter") return traitFilters;
      return [];
    },
    querySelector: (selector) => {
      if (selector === ".p-multiselect-panel") return openPanel;
      if (selector === 'button[content="Add filters"], button[content="Add more filters"]') return addFiltersButton;
      return null;
    },
    createElement: () => fakeGenericElement(),
  };
  global.window = { location: { href, pathname: new URL(href).pathname } };

  return domCtl;
}

test("inserts a button next to the native Refresh button, cloning its classes, labelled 'Hide War Paint items' by default", () => {
  const referenceButton = { className: "btn btn-outline-brand btn-sm" };
  const leftContent = fakeLeftContent(referenceButton);
  setupDom({ leftContents: [leftContent], href: "https://next.backpack.tf/classifieds" });

  warPaintFilterToggle();

  assert.equal(leftContent.appendedCount(), 1);
  const button = leftContent.lastAppended();
  assert.equal(button.className, "btn btn-outline-brand btn-sm tf2te-warpaint-filter-toggle");
  assert.equal(button.textContent, "Hide War Paint items");
});

test("a later MutationObserver tick never inserts a second button", () => {
  const referenceButton = { className: "btn btn-outline-brand btn-sm" };
  const leftContent = fakeLeftContent(referenceButton);
  setupDom({ leftContents: [leftContent], href: "https://next.backpack.tf/classifieds" });

  warPaintFilterToggle();
  assert.equal(leftContent.appendedCount(), 1);
  const firstButton = leftContent.lastAppended();

  FakeMutationObserver.instances[0].cb();

  assert.equal(leftContent.appendedCount(), 1);
  assert.equal(leftContent.lastAppended(), firstButton);
});

test("does nothing when the page has no paginator left-content at all", () => {
  setupDom({ leftContents: [], href: "https://next.backpack.tf/classifieds" });
  assert.doesNotThrow(() => warPaintFilterToggle());
});

test("does nothing when the left-content has no native button to clone style from", () => {
  const leftContent = {
    appendedCount: () => 0,
    querySelector: () => null,
    appendChild: () => {
      throw new Error("should never be called - nothing to clone style from");
    },
  };
  setupDom({ leftContents: [leftContent], href: "https://next.backpack.tf/classifieds" });

  assert.doesNotThrow(() => warPaintFilterToggle());
});

test("never inserts the button at all when the page isn't /classifieds", () => {
  const referenceButton = { className: "btn btn-outline-brand btn-sm" };
  const leftContent = fakeLeftContent(referenceButton);
  setupDom({ leftContents: [leftContent], href: "https://next.backpack.tf/items" });

  warPaintFilterToggle();

  assert.equal(leftContent.appendedCount(), 0);
});

test("removes an already-inserted button once the SPA navigates away from /classifieds without a page reload", () => {
  const referenceButton = { className: "btn btn-outline-brand btn-sm" };
  const leftContent = fakeLeftContent(referenceButton);
  setupDom({ leftContents: [leftContent], href: "https://next.backpack.tf/classifieds" });

  warPaintFilterToggle();
  assert.equal(leftContent.appendedCount(), 1);

  window.location.href = "https://next.backpack.tf/items";
  window.location.pathname = "/items";
  FakeMutationObserver.instances[0].cb();

  assert.equal(leftContent.appendedCount(), 0);
});

test("re-adds the button once the SPA navigates back to /classifieds without a page reload", () => {
  const referenceButton = { className: "btn btn-outline-brand btn-sm" };
  const leftContent = fakeLeftContent(referenceButton);
  setupDom({ leftContents: [leftContent], href: "https://next.backpack.tf/items" });

  warPaintFilterToggle();
  assert.equal(leftContent.appendedCount(), 0);

  window.location.href = "https://next.backpack.tf/classifieds";
  window.location.pathname = "/classifieds";
  FakeMutationObserver.instances[0].cb();

  assert.equal(leftContent.appendedCount(), 1);
  assert.equal(leftContent.lastAppended().textContent, "Hide War Paint items");
});

test("clicking the button when the War Paints column is already visible opens it, clicks 'No War Paint' (toggling it), updates the label from the real resulting state, then closes the panel", async () => {
  const noWarPaint = fakeLi({ hasItemTraitName: true, checked: false });
  const referenceButton = { className: "btn btn-outline-brand btn-sm" };
  const leftContent = fakeLeftContent(referenceButton);
  const domCtl = setupDom({ leftContents: [leftContent], href: "https://next.backpack.tf/classifieds" });
  const panel = fakePanel({ noWarPaint }, domCtl);
  domCtl.setOpenPanel(null);
  const traitFilter = fakeTraitFilter(panel, domCtl);
  global.document.querySelectorAll = (selector) => {
    if (selector === ".p-paginator-left-content") return [leftContent];
    if (selector === ".trait-filter") return [traitFilter];
    return [];
  };

  warPaintFilterToggle();
  await leftContent.lastAppended()._click();

  assert.equal(noWarPaint.clickCount(), 1);
  assert.equal(noWarPaint.isChecked(), true);
  assert.equal(leftContent.lastAppended().textContent, "Show War Paint items");
  assert.equal(global.document.querySelector(".p-multiselect-panel"), null);

  // Clicking again unchecks it and flips the label back.
  await leftContent.lastAppended()._click();
  assert.equal(noWarPaint.isChecked(), false);
  assert.equal(leftContent.lastAppended().textContent, "Hide War Paint items");
});

test("clicking the button skips a non-War-Paints trait-filter (no 'No War Paint' option in its panel) and moves on to find the real one", async () => {
  const noWarPaint = fakeLi({ hasItemTraitName: true, checked: false });
  const referenceButton = { className: "btn btn-outline-brand btn-sm" };
  const leftContent = fakeLeftContent(referenceButton);
  const domCtl = setupDom({ leftContents: [leftContent], href: "https://next.backpack.tf/classifieds" });

  const unrelatedPanel = fakePanel({}, domCtl); // no "No War Paint" option - e.g. a "Spells" column
  const warPaintsPanel = fakePanel({ noWarPaint }, domCtl);
  const unrelatedTrait = fakeTraitFilter(unrelatedPanel, domCtl);
  const warPaintsTrait = fakeTraitFilter(warPaintsPanel, domCtl);

  global.document.querySelectorAll = (selector) => {
    if (selector === ".p-paginator-left-content") return [leftContent];
    if (selector === ".trait-filter") return [unrelatedTrait, warPaintsTrait];
    return [];
  };

  warPaintFilterToggle();
  await leftContent.lastAppended()._click();

  assert.equal(noWarPaint.clickCount(), 1);
});

test("clicking the button when the War Paints column isn't visible yet adds it via the 'Add (more) filters' funnel panel first", async () => {
  const noWarPaint = fakeLi({ hasItemTraitName: true, checked: false });
  const warPaintsCategoryOption = fakeLi({ hasItemTraitName: false, checked: false });
  const referenceButton = { className: "btn btn-outline-brand btn-sm" };
  const leftContent = fakeLeftContent(referenceButton);
  const domCtl = setupDom({ leftContents: [leftContent], href: "https://next.backpack.tf/classifieds" });

  const addFiltersPanel = fakePanel({ warPaintsCategory: warPaintsCategoryOption }, domCtl);
  const addFiltersButton = { click: () => domCtl.setOpenPanel(addFiltersPanel) };

  const warPaintsPanel = fakePanel({ noWarPaint }, domCtl);
  let traitFilters = [];
  const baseClick = warPaintsCategoryOption.click.bind(warPaintsCategoryOption);
  warPaintsCategoryOption.click = () => {
    baseClick();
    traitFilters = [fakeTraitFilter(warPaintsPanel, domCtl)];
  };

  global.document.querySelectorAll = (selector) => {
    if (selector === ".p-paginator-left-content") return [leftContent];
    if (selector === ".trait-filter") return traitFilters;
    return [];
  };
  const baseQuerySelector = global.document.querySelector;
  global.document.querySelector = (selector) =>
    selector === 'button[content="Add filters"], button[content="Add more filters"]' ? addFiltersButton : baseQuerySelector(selector);

  warPaintFilterToggle();
  await leftContent.lastAppended()._click();

  assert.equal(noWarPaint.clickCount(), 1);
});

test("clicking the button never re-clicks an already-checked 'War Paints' category option in the funnel panel (that would remove the column)", async () => {
  const warPaintsCategoryOption = fakeLi({ hasItemTraitName: false, checked: true });
  const referenceButton = { className: "btn btn-outline-brand btn-sm" };
  const leftContent = fakeLeftContent(referenceButton);
  const domCtl = setupDom({ leftContents: [leftContent], href: "https://next.backpack.tf/classifieds" });

  const addFiltersPanel = fakePanel({ warPaintsCategory: warPaintsCategoryOption }, domCtl);
  const addFiltersButton = { click: () => domCtl.setOpenPanel(addFiltersPanel) };
  global.document.querySelectorAll = (selector) => {
    if (selector === ".p-paginator-left-content") return [leftContent];
    if (selector === ".trait-filter") return [];
    return [];
  };
  const baseQuerySelector = global.document.querySelector;
  global.document.querySelector = (selector) =>
    selector === 'button[content="Add filters"], button[content="Add more filters"]' ? addFiltersButton : baseQuerySelector(selector);

  warPaintFilterToggle();
  await leftContent.lastAppended()._click();

  assert.equal(warPaintsCategoryOption.clickCount(), 0);
});

test("gives up quietly (no throw) when neither an existing War Paints trait-filter nor the 'Add more filters' button can be found", async () => {
  const referenceButton = { className: "btn btn-outline-brand btn-sm" };
  const leftContent = fakeLeftContent(referenceButton);
  setupDom({ leftContents: [leftContent], traitFilters: [], addFiltersButton: null, href: "https://next.backpack.tf/classifieds" });

  warPaintFilterToggle();
  await assert.doesNotReject(() => Promise.resolve(leftContent.lastAppended()._click()));
});
