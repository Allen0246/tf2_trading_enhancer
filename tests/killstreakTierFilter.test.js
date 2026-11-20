import { test } from "node:test";
import assert from "node:assert/strict";
import { killstreakTierFilter } from "../backpack.tf/nextUI/killstreakTierFilter/content.js";

// Minimal hand-rolled fakes (see tests/spellFilterToggle.test.js's own
// header comment for why this repo hand-rolls rather than pulling in
// jsdom) - just enough surface for killstreakTierFilter()'s own
// scan/ensureButtonRow/selectKillstreakTier logic to run against.

// Generic enough to stand in for the row <div>, each tier <button>, and the
// <style> element hidePanelsWhileAutomating creates - real
// document.createElement returns the same base Element/HTMLElement surface
// regardless of tag, and this file's own buildButtonRow appends REAL
// child buttons into a REAL row element, so (unlike
// spellFilterToggle.test.js's own single-button fixture) this one needs
// working appendChild/querySelector too.
function fakeGenericElement() {
  const listeners = {};
  let text = "";
  let removed = false;
  const children = [];
  const el = {
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
    appendChild(child) {
      children.push(child);
      return child;
    },
    // Only ever queried for ".{BUTTON_CLASS}" (find all tier buttons) or a
    // specific class in this file's own tests - class-only, matching this
    // repo's own established "simple selectors only" convention.
    querySelectorAll(selector) {
      const cls = selector.replace(/^\./, "");
      return children.filter((c) => (c.className || "").split(/\s+/).includes(cls));
    },
    findByText(label) {
      return children.find((c) => c.textContent === label) || null;
    },
  };
  return el;
}

// The row is now inserted as a SIBLING of the whole .p-paginator bar (via
// insertAdjacentElement("afterend", ...) on it), not appended inside
// left-content itself - see content.js's own header note on why. So this
// fixture models leftContent.closest(".p-paginator") returning a fake
// paginator whose own .parentElement is the "container" the row actually
// lands in and is deduped against.
function fakeLeftContent(referenceButton) {
  let appended = null;
  const isPresent = () => appended && !appended.isRemoved?.();
  const container = {
    querySelector(selector) {
      return selector === ".tf2te-ks-tier-filter-row" && isPresent() ? appended : null;
    },
  };
  const paginator = {
    parentElement: container,
    insertAdjacentElement(position, el) {
      if (position === "afterend") appended = el;
      return el;
    },
  };
  return {
    appendedCount: () => (isPresent() ? 1 : 0),
    lastAppended: () => appended,
    closest(selector) {
      return selector === ".p-paginator" ? paginator : null;
    },
    querySelector(selector) {
      return selector === "button" ? referenceButton : null;
    },
  };
}

// A single <li role="option"> from either PrimeVue panel - hasItemTraitName
// distinguishes a real Killstreak-Tiers-panel VALUE option (e.g.
// "Standard") from the funnel Add-filters panel's own plain-<span>
// CATEGORY option ("Killstreak Tiers") - see content.js's own header note.
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

// A PrimeVue .p-multiselect-panel - domCtl.setOpenPanel(null) on close, same
// as tests/spellFilterToggle.test.js's own fakePanel documents. tierOptions
// is a {label: fakeLi} map for the Killstreak-Tiers panel's own 4 values;
// ksTierCategory is the funnel Add-filters panel's own category option.
function fakePanel({ tierOptions = {}, ksTierCategory = null, hasAnyOption = true } = {}, domCtl) {
  return {
    querySelector(selector) {
      if (selector === 'li[role="option"]') return hasAnyOption ? {} : null;
      if (selector === 'li[aria-label="Killstreak Tiers"]') return ksTierCategory;
      const match = /^li\[aria-label="([^"]+)"\]$/.exec(selector);
      if (match) return tierOptions[match[1]] || null;
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

function findTierButton(leftContent, label) {
  return leftContent.lastAppended()?.findByText(label) || null;
}

test("inserts a row of four tier buttons (None/Standard/Specialized/Professional) next to the native Refresh button, cloning its classes", () => {
  const referenceButton = { className: "btn btn-outline-brand btn-sm" };
  const leftContent = fakeLeftContent(referenceButton);
  setupDom({ leftContents: [leftContent], href: "https://next.backpack.tf/classifieds?itemName=Wrench&quality=11" });

  killstreakTierFilter();

  assert.equal(leftContent.appendedCount(), 1);
  const row = leftContent.lastAppended();
  assert.equal(row.className, "tf2te-ks-tier-filter-row");
  const labels = ["None", "Standard", "Specialized", "Professional"];
  labels.forEach((label) => {
    const button = row.findByText(label);
    assert.ok(button, `expected a "${label}" button`);
    assert.equal(button.className, "btn btn-outline-brand btn-sm tf2te-ks-tier-filter-button");
  });
});

test("a later MutationObserver tick never inserts a second row", () => {
  const referenceButton = { className: "btn btn-outline-brand btn-sm" };
  const leftContent = fakeLeftContent(referenceButton);
  setupDom({ leftContents: [leftContent], href: "https://next.backpack.tf/classifieds?itemName=Wrench&quality=11" });

  killstreakTierFilter();
  assert.equal(leftContent.appendedCount(), 1);
  const firstRow = leftContent.lastAppended();

  FakeMutationObserver.instances[0].cb();

  assert.equal(leftContent.appendedCount(), 1);
  assert.equal(leftContent.lastAppended(), firstRow); // same row, not rebuilt
});

test("does nothing when the page has no paginator left-content at all", () => {
  setupDom({ leftContents: [], href: "https://next.backpack.tf/classifieds" });
  assert.doesNotThrow(() => killstreakTierFilter());
});

test("does nothing when the left-content has no native button to clone style from", () => {
  const paginator = {
    parentElement: { querySelector: () => null },
    insertAdjacentElement: () => {
      throw new Error("should never be called - nothing to clone style from");
    },
  };
  const leftContent = {
    appendedCount: () => 0,
    closest: (selector) => (selector === ".p-paginator" ? paginator : null),
    querySelector: () => null,
  };
  setupDom({ leftContents: [leftContent], href: "https://next.backpack.tf/classifieds" });

  assert.doesNotThrow(() => killstreakTierFilter());
});

// Built with the pathname self-check from the start (see content.js's own
// header note) - same fix tests/spellFilterToggle.test.js's own regression
// tests cover for that sibling feature.
test("never inserts the row at all when the page isn't /classifieds", () => {
  const referenceButton = { className: "btn btn-outline-brand btn-sm" };
  const leftContent = fakeLeftContent(referenceButton);
  setupDom({ leftContents: [leftContent], href: "https://next.backpack.tf/items" });

  killstreakTierFilter();

  assert.equal(leftContent.appendedCount(), 0);
});

test("removes an already-inserted row once the SPA navigates away from /classifieds without a page reload", () => {
  const referenceButton = { className: "btn btn-outline-brand btn-sm" };
  const leftContent = fakeLeftContent(referenceButton);
  setupDom({ leftContents: [leftContent], href: "https://next.backpack.tf/classifieds?itemName=Wrench&quality=11" });

  killstreakTierFilter();
  assert.equal(leftContent.appendedCount(), 1);

  window.location.href = "https://next.backpack.tf/items";
  window.location.pathname = "/items";
  FakeMutationObserver.instances[0].cb();

  assert.equal(leftContent.appendedCount(), 0);
});

test("re-adds the row once the SPA navigates back to /classifieds without a page reload", () => {
  const referenceButton = { className: "btn btn-outline-brand btn-sm" };
  const leftContent = fakeLeftContent(referenceButton);
  setupDom({ leftContents: [leftContent], href: "https://next.backpack.tf/items" });

  killstreakTierFilter();
  assert.equal(leftContent.appendedCount(), 0);

  window.location.href = "https://next.backpack.tf/classifieds?itemName=Wrench&quality=11";
  window.location.pathname = "/classifieds";
  FakeMutationObserver.instances[0].cb();

  assert.equal(leftContent.appendedCount(), 1);
});

test("clicking a tier button when the Killstreak Tiers column is already visible checks only that tier, unchecking whichever other one was checked", async () => {
  const none = fakeLi({ hasItemTraitName: true, checked: true }); // currently applied filter
  const standard = fakeLi({ hasItemTraitName: true, checked: false });
  const specialized = fakeLi({ hasItemTraitName: true, checked: false });
  const professional = fakeLi({ hasItemTraitName: true, checked: false });
  const referenceButton = { className: "btn btn-outline-brand btn-sm" };
  const leftContent = fakeLeftContent(referenceButton);
  const domCtl = setupDom({ leftContents: [leftContent], href: "https://next.backpack.tf/classifieds" });
  const panel = fakePanel({ tierOptions: { None: none, Standard: standard, Specialized: specialized, Professional: professional } }, domCtl);
  domCtl.setOpenPanel(null);
  const traitFilter = fakeTraitFilter(panel, domCtl);
  global.document.querySelectorAll = (selector) => {
    if (selector === ".p-paginator-left-content") return [leftContent];
    if (selector === ".trait-filter") return [traitFilter];
    return [];
  };

  killstreakTierFilter();
  await findTierButton(leftContent, "Professional")._click();

  assert.equal(professional.isChecked(), true);
  assert.equal(none.isChecked(), false); // was checked, unchecked to make Professional the only one
  assert.equal(standard.isChecked(), false);
  assert.equal(specialized.isChecked(), false);
  assert.equal(none.clickCount(), 1);
  assert.equal(professional.clickCount(), 1);
  assert.equal(standard.clickCount(), 0); // never was checked, never touched
  assert.equal(specialized.clickCount(), 0);
  // The panel was closed afterward.
  assert.equal(global.document.querySelector(".p-multiselect-panel"), null);
});

test("clicking the ALREADY-active tier's button leaves it checked (no needless toggle)", async () => {
  const standard = fakeLi({ hasItemTraitName: true, checked: true });
  const referenceButton = { className: "btn btn-outline-brand btn-sm" };
  const leftContent = fakeLeftContent(referenceButton);
  const domCtl = setupDom({ leftContents: [leftContent], href: "https://next.backpack.tf/classifieds" });
  const panel = fakePanel({ tierOptions: { Standard: standard } }, domCtl);
  domCtl.setOpenPanel(null);
  const traitFilter = fakeTraitFilter(panel, domCtl);
  global.document.querySelectorAll = (selector) => {
    if (selector === ".p-paginator-left-content") return [leftContent];
    if (selector === ".trait-filter") return [traitFilter];
    return [];
  };

  killstreakTierFilter();
  await findTierButton(leftContent, "Standard")._click();

  assert.equal(standard.clickCount(), 0);
  assert.equal(standard.isChecked(), true);
});

test("clicking a tier button skips a non-Killstreak-Tiers trait-filter and moves on to find the real one", async () => {
  const standard = fakeLi({ hasItemTraitName: true, checked: false });
  const referenceButton = { className: "btn btn-outline-brand btn-sm" };
  const leftContent = fakeLeftContent(referenceButton);
  const domCtl = setupDom({ leftContents: [leftContent], href: "https://next.backpack.tf/classifieds" });

  const unrelatedPanel = fakePanel({}, domCtl); // no tier options at all - e.g. a "Paints" column
  const ksTierPanel = fakePanel({ tierOptions: { Standard: standard } }, domCtl);
  const unrelatedTrait = fakeTraitFilter(unrelatedPanel, domCtl);
  const ksTierTrait = fakeTraitFilter(ksTierPanel, domCtl);

  global.document.querySelectorAll = (selector) => {
    if (selector === ".p-paginator-left-content") return [leftContent];
    if (selector === ".trait-filter") return [unrelatedTrait, ksTierTrait];
    return [];
  };

  killstreakTierFilter();
  await findTierButton(leftContent, "Standard")._click();

  assert.equal(standard.clickCount(), 1);
});

test("clicking a tier button when the Killstreak Tiers column isn't visible yet adds it via the 'Add (more) filters' funnel panel first", async () => {
  const professional = fakeLi({ hasItemTraitName: true, checked: false });
  const ksTierCategoryOption = fakeLi({ hasItemTraitName: false, checked: false });
  const referenceButton = { className: "btn btn-outline-brand btn-sm" };
  const leftContent = fakeLeftContent(referenceButton);
  const domCtl = setupDom({ leftContents: [leftContent], href: "https://next.backpack.tf/classifieds" });

  const addFiltersPanel = fakePanel({ ksTierCategory: ksTierCategoryOption }, domCtl);
  const addFiltersButton = { click: () => domCtl.setOpenPanel(addFiltersPanel) };

  // "Standard" also present (not just "Professional") - a real panel
  // always has all 4 tier values together, and openIfKillstreakTierTrait's
  // own marker check specifically looks for "Standard" to confirm this
  // panel IS the Killstreak Tiers one.
  const ksTierPanel = fakePanel({ tierOptions: { Professional: professional, Standard: fakeLi({ hasItemTraitName: true }) } }, domCtl);
  let traitFilters = [];
  const baseClick = ksTierCategoryOption.click.bind(ksTierCategoryOption);
  ksTierCategoryOption.click = () => {
    baseClick();
    traitFilters = [fakeTraitFilter(ksTierPanel, domCtl)];
  };

  global.document.querySelectorAll = (selector) => {
    if (selector === ".p-paginator-left-content") return [leftContent];
    if (selector === ".trait-filter") return traitFilters;
    return [];
  };
  const baseQuerySelector = global.document.querySelector;
  global.document.querySelector = (selector) =>
    selector === 'button[content="Add filters"], button[content="Add more filters"]' ? addFiltersButton : baseQuerySelector(selector);

  killstreakTierFilter();
  await findTierButton(leftContent, "Professional")._click();

  assert.equal(professional.clickCount(), 1);
});

test("clicking a tier button never re-clicks an already-checked 'Killstreak Tiers' category option in the funnel panel (that would remove the column)", async () => {
  const ksTierCategoryOption = fakeLi({ hasItemTraitName: false, checked: true });
  const referenceButton = { className: "btn btn-outline-brand btn-sm" };
  const leftContent = fakeLeftContent(referenceButton);
  const domCtl = setupDom({ leftContents: [leftContent], href: "https://next.backpack.tf/classifieds" });

  const addFiltersPanel = fakePanel({ ksTierCategory: ksTierCategoryOption }, domCtl);
  const addFiltersButton = { click: () => domCtl.setOpenPanel(addFiltersPanel) };
  global.document.querySelectorAll = (selector) => {
    if (selector === ".p-paginator-left-content") return [leftContent];
    if (selector === ".trait-filter") return []; // never finds a Killstreak-Tiers trait-filter, even after the funnel step
    return [];
  };
  const baseQuerySelector = global.document.querySelector;
  global.document.querySelector = (selector) =>
    selector === 'button[content="Add filters"], button[content="Add more filters"]' ? addFiltersButton : baseQuerySelector(selector);

  killstreakTierFilter();
  await findTierButton(leftContent, "Standard")._click();

  assert.equal(ksTierCategoryOption.clickCount(), 0);
});

test("gives up quietly (no throw) when neither an existing Killstreak-Tiers trait-filter nor the 'Add more filters' button can be found", async () => {
  const referenceButton = { className: "btn btn-outline-brand btn-sm" };
  const leftContent = fakeLeftContent(referenceButton);
  setupDom({ leftContents: [leftContent], traitFilters: [], addFiltersButton: null, href: "https://next.backpack.tf/classifieds" });

  killstreakTierFilter();
  await assert.doesNotReject(() => Promise.resolve(findTierButton(leftContent, "None")._click()));
});
