import { test } from "node:test";
import assert from "node:assert/strict";
import { spellFilterToggle } from "../backpack.tf/nextUI/spellFilterToggle/content.js";

// Minimal hand-rolled fakes (see tests/helpers/fakeDom.js's own header on why
// this repo hand-rolls rather than pulling in jsdom) - just enough surface
// for spellFilterToggle()'s own scan/ensureButton/toggle logic to run
// against, following the same "override document.querySelector(All) to
// return a canned fixture" style tests/sellDuplicates.test.js already uses.

// Generic enough to stand in for both the toggle <button> and the
// <style> element hidePanelsWhileAutomating creates - real document.
// createElement returns the same base Element/HTMLElement surface
// regardless of tag.
function fakeGenericElement() {
  const listeners = {};
  let text = "";
  let textAssignments = 0;
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
      textAssignments++; // tracked regardless of whether v === the current value
      text = v;
    },
    textAssignmentCount: () => textAssignments,
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
  // isRemoved()-aware (not just "was appendChild ever called") - matches
  // real DOM: once .remove() is called on the appended button, a real
  // leftContent.querySelector no longer finds it either.
  const isPresent = () => appended && !appended.isRemoved?.();
  return {
    appendedCount: () => (isPresent() ? 1 : 0),
    lastAppended: () => appended,
    querySelector(selector) {
      if (selector === "button") return referenceButton;
      if (selector === ".tf2te-spell-filter-toggle") return isPresent() ? appended : null;
      return null;
    },
    appendChild(el) {
      appended = el;
      return el;
    },
  };
}

// A single <li role="option"> from either PrimeVue panel - hasItemTraitName
// distinguishes a real Spells-panel VALUE option ("No Spells", confirmed
// live with an ".item-trait__name" div) from the funnel Add-filters panel's
// own plain-<span> CATEGORY option ("Spells") - see content.js's own header
// note on why that's the one reliable way to tell the two panels apart.
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
// as the real ".p-multiselect-close" button's effect, so the next
// document.querySelector(".p-multiselect-panel") call (openIfSpellsTrait's
// own poll) correctly sees nothing open again.
// hasAnyOption defaults to true - a real PrimeVue panel always has SOME
// <li role="option"> once populated (even an "unrelated" one, e.g. a Paints
// column's own color options); waitForPopulatedPanel's own live-confirmed
// fix (PrimeVue renders the panel shell before filling in its option list)
// polls for exactly this signal, so a fake panel with no options at all
// would make that poll run out its real timeout - only tests specifically
// covering "the panel never actually populates" should pass hasAnyOption:
// false.
function fakePanel({ noSpells = null, spellsCategory = null, hasAnyOption = true } = {}, domCtl) {
  return {
    querySelector(selector) {
      if (selector === 'li[role="option"]') return hasAnyOption ? {} : null;
      if (selector === 'li[aria-label="No Spells"]') return noSpells;
      if (selector === 'li[aria-label="Spells"]') return spellsCategory;
      if (selector === ".p-multiselect-close") return { click: () => domCtl.setOpenPanel(null) };
      return null;
    },
  };
}

// A .trait-filter dropdown - clicking its trigger opens the given panel
// (recorded via domCtl.setOpenPanel), same as a real click would eventually
// render a portal-teleported .p-multiselect-panel somewhere in the document.
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
  let headEl = null; // the last <style> hidePanelsWhileAutomating appended, if not since .remove()'d
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

test("inserts a button next to the native Refresh button, cloning its classes, labelled 'Hide spelled items' when no spell filter is active", () => {
  const referenceButton = { className: "btn btn-outline-brand btn-sm" };
  const leftContent = fakeLeftContent(referenceButton);
  setupDom({ leftContents: [leftContent], href: "https://next.backpack.tf/classifieds?itemName=Max%27s%20Severed%20Head&quality=6" });

  spellFilterToggle();

  assert.equal(leftContent.appendedCount(), 1);
  const button = leftContent.lastAppended();
  assert.equal(button.className, "btn btn-outline-brand btn-sm tf2te-spell-filter-toggle");
  assert.equal(button.textContent, "Hide spelled items");
});

test("labels the button 'Show spelled items' when the page URL already has spell=none", () => {
  const referenceButton = { className: "btn btn-outline-brand btn-sm" };
  const leftContent = fakeLeftContent(referenceButton);
  setupDom({ leftContents: [leftContent], href: "https://next.backpack.tf/classifieds?itemName=Max%27s%20Severed%20Head&quality=6&spell=none" });

  spellFilterToggle();

  assert.equal(leftContent.lastAppended().textContent, "Show spelled items");
});

test("a later MutationObserver tick never inserts a second button, and refreshes the label if the URL changed since insertion", () => {
  const referenceButton = { className: "btn btn-outline-brand btn-sm" };
  const leftContent = fakeLeftContent(referenceButton);
  setupDom({ leftContents: [leftContent], href: "https://next.backpack.tf/classifieds?itemName=Rocket%20Launcher&quality=6" });

  spellFilterToggle();
  assert.equal(leftContent.appendedCount(), 1);
  assert.equal(leftContent.lastAppended().textContent, "Hide spelled items");

  window.location.href = "https://next.backpack.tf/classifieds?itemName=Rocket%20Launcher&quality=6&spell=none";
  FakeMutationObserver.instances[0].cb();

  assert.equal(leftContent.appendedCount(), 1);
  assert.equal(leftContent.lastAppended().textContent, "Show spelled items");
});

test("REGRESSION: a MutationObserver tick with no actual label change never reassigns textContent - an earlier version did unconditionally, and since Node.textContent = value always mutates the DOM even for an unchanged value, that mutation retriggered this module's own childList observer forever and froze the tab (confirmed live, twice)", () => {
  const referenceButton = { className: "btn btn-outline-brand btn-sm" };
  const leftContent = fakeLeftContent(referenceButton);
  setupDom({ leftContents: [leftContent], href: "https://next.backpack.tf/classifieds?itemName=Rocket%20Launcher&quality=6" });

  spellFilterToggle();
  const button = leftContent.lastAppended();
  const assignmentsAfterInsert = button.textAssignmentCount();

  // Simulate several more observer ticks with NOTHING actually changed
  // (the exact scenario the observer's own re-entrant call after appendChild
  // itself produces) - none of these should touch textContent again.
  FakeMutationObserver.instances[0].cb();
  FakeMutationObserver.instances[0].cb();
  FakeMutationObserver.instances[0].cb();

  assert.equal(button.textAssignmentCount(), assignmentsAfterInsert);
});

test("does nothing when the page has no paginator left-content at all", () => {
  setupDom({ leftContents: [], href: "https://next.backpack.tf/classifieds" });
  assert.doesNotThrow(() => spellFilterToggle());
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

  assert.doesNotThrow(() => spellFilterToggle());
});

// Next.backpack.tf's own Vue SPA can navigate to /classifieds via an
// in-app link with no full page reload, and this extension's own router
// only ever decides ONCE (at whatever page first injected the content
// script) whether to call spellFilterToggle() at all - so pathname now has
// to be checked HERE, on every scan, not just once at the router level.
// See content.js's own header note.
test("never inserts the button at all when the page isn't /classifieds (however unlikely - .p-paginator-left-content could exist on some other paginated page)", () => {
  const referenceButton = { className: "btn btn-outline-brand btn-sm" };
  const leftContent = fakeLeftContent(referenceButton);
  setupDom({ leftContents: [leftContent], href: "https://next.backpack.tf/items" });

  spellFilterToggle();

  assert.equal(leftContent.appendedCount(), 0);
});

test("removes an already-inserted button once the SPA navigates away from /classifieds without a page reload", () => {
  const referenceButton = { className: "btn btn-outline-brand btn-sm" };
  const leftContent = fakeLeftContent(referenceButton);
  setupDom({ leftContents: [leftContent], href: "https://next.backpack.tf/classifieds?itemName=Rocket%20Launcher&quality=6" });

  spellFilterToggle();
  assert.equal(leftContent.appendedCount(), 1);

  // In-app SPA navigation - href AND pathname both change, no page reload.
  window.location.href = "https://next.backpack.tf/items";
  window.location.pathname = "/items";
  FakeMutationObserver.instances[0].cb();

  assert.equal(leftContent.appendedCount(), 0);
});

test("re-adds the button once the SPA navigates back to /classifieds without a page reload", () => {
  const referenceButton = { className: "btn btn-outline-brand btn-sm" };
  const leftContent = fakeLeftContent(referenceButton);
  setupDom({ leftContents: [leftContent], href: "https://next.backpack.tf/items" });

  spellFilterToggle();
  assert.equal(leftContent.appendedCount(), 0);

  window.location.href = "https://next.backpack.tf/classifieds?itemName=Rocket%20Launcher&quality=6";
  window.location.pathname = "/classifieds";
  FakeMutationObserver.instances[0].cb();

  assert.equal(leftContent.appendedCount(), 1);
  assert.equal(leftContent.lastAppended().textContent, "Hide spelled items");
});

test("clicking the button when the Spells column is already visible opens it, clicks 'No Spells' (toggling it), then closes the panel", async () => {
  const noSpells = fakeLi({ hasItemTraitName: true, checked: false });
  const referenceButton = { className: "btn btn-outline-brand btn-sm" };
  const leftContent = fakeLeftContent(referenceButton);
  const domCtl = setupDom({
    leftContents: [leftContent],
    href: "https://next.backpack.tf/classifieds",
  });
  const panel = fakePanel({ noSpells }, domCtl);
  domCtl.setOpenPanel(null);
  const traitFilter = fakeTraitFilter(panel, domCtl);
  global.document.querySelectorAll = (selector) => {
    if (selector === ".p-paginator-left-content") return [leftContent];
    if (selector === ".trait-filter") return [traitFilter];
    return [];
  };

  spellFilterToggle();
  await leftContent.lastAppended()._click();

  assert.equal(noSpells.clickCount(), 1);
  assert.equal(noSpells.isChecked(), true);
  // The panel was closed afterward - a fresh document.querySelector(".p-multiselect-panel") sees nothing open.
  assert.equal(global.document.querySelector(".p-multiselect-panel"), null);
});

test("REGRESSION: a second click while the first toggle is still running is ignored (would otherwise click 'No Spells' twice and undo the toggle)", async () => {
  const noSpells = fakeLi({ hasItemTraitName: true, checked: false });
  const referenceButton = { className: "btn btn-outline-brand btn-sm" };
  const leftContent = fakeLeftContent(referenceButton);
  const domCtl = setupDom({
    leftContents: [leftContent],
    href: "https://next.backpack.tf/classifieds",
  });
  const panel = fakePanel({ noSpells }, domCtl);
  domCtl.setOpenPanel(null);
  const traitFilter = fakeTraitFilter(panel, domCtl);
  global.document.querySelectorAll = (selector) => {
    if (selector === ".p-paginator-left-content") return [leftContent];
    if (selector === ".trait-filter") return [traitFilter];
    return [];
  };

  spellFilterToggle();
  const button = leftContent.lastAppended();
  await Promise.all([button._click(), button._click()]);

  assert.equal(noSpells.clickCount(), 1);
  assert.equal(noSpells.isChecked(), true);

  // Once the first run has finished, a new click works again.
  await button._click();
  assert.equal(noSpells.clickCount(), 2);
});

test("clicking the button skips a non-Spells trait-filter (no 'No Spells' option in its panel) and moves on to find the real one", async () => {
  const noSpells = fakeLi({ hasItemTraitName: true, checked: false });
  const referenceButton = { className: "btn btn-outline-brand btn-sm" };
  const leftContent = fakeLeftContent(referenceButton);
  const domCtl = setupDom({ leftContents: [leftContent], href: "https://next.backpack.tf/classifieds" });

  const unrelatedPanel = fakePanel({}, domCtl); // no "No Spells" option - e.g. a "Paints" column
  const spellsPanel = fakePanel({ noSpells }, domCtl);
  const unrelatedTrait = fakeTraitFilter(unrelatedPanel, domCtl);
  const spellsTrait = fakeTraitFilter(spellsPanel, domCtl);

  global.document.querySelectorAll = (selector) => {
    if (selector === ".p-paginator-left-content") return [leftContent];
    if (selector === ".trait-filter") return [unrelatedTrait, spellsTrait];
    return [];
  };

  spellFilterToggle();
  await leftContent.lastAppended()._click();

  assert.equal(noSpells.clickCount(), 1);
});

// Covers the funnel button generically (via the combined selector both real
// labels - "Add filters" with nothing added yet, "Add more filters" once at
// least one already is - match), rather than duplicating this test per label:
// CSS's own comma-selector semantics guarantee either literal attribute
// value is found, so there's nothing behaviorally different left to cover.
test("clicking the button when the Spells column isn't visible yet adds it via the 'Add (more) filters' funnel panel first", async () => {
  const noSpells = fakeLi({ hasItemTraitName: true, checked: false });
  const spellsCategoryOption = fakeLi({ hasItemTraitName: false, checked: false });
  const referenceButton = { className: "btn btn-outline-brand btn-sm" };
  const leftContent = fakeLeftContent(referenceButton);
  const domCtl = setupDom({ leftContents: [leftContent], href: "https://next.backpack.tf/classifieds" });

  const addFiltersPanel = fakePanel({ spellsCategory: spellsCategoryOption }, domCtl);
  const addFiltersButton = { click: () => domCtl.setOpenPanel(addFiltersPanel) };

  // The Spells trait-filter doesn't exist in the bar until AFTER the funnel
  // panel's "Spells" option is clicked - simulated by having that click
  // (wrapped below) populate what .trait-filter then returns.
  const spellsPanel = fakePanel({ noSpells }, domCtl);
  let traitFilters = [];
  const baseClick = spellsCategoryOption.click.bind(spellsCategoryOption);
  spellsCategoryOption.click = () => {
    baseClick();
    traitFilters = [fakeTraitFilter(spellsPanel, domCtl)];
  };

  global.document.querySelectorAll = (selector) => {
    if (selector === ".p-paginator-left-content") return [leftContent];
    if (selector === ".trait-filter") return traitFilters;
    return [];
  };
  // Overrides just the "Add more filters" button lookup, delegating everything
  // else (including ".p-multiselect-panel", which reads the SAME openPanel
  // closure setupDom's own domCtl.setOpenPanel mutates) back to the original
  // querySelector setupDom already built, captured here before overwriting it.
  const baseQuerySelector = global.document.querySelector;
  global.document.querySelector = (selector) =>
    selector === 'button[content="Add filters"], button[content="Add more filters"]' ? addFiltersButton : baseQuerySelector(selector);

  spellFilterToggle();
  await leftContent.lastAppended()._click();

  assert.equal(noSpells.clickCount(), 1);
});

test("clicking the button never re-clicks an already-checked 'Spells' category option in the funnel panel (that would remove the column)", async () => {
  const spellsCategoryOption = fakeLi({ hasItemTraitName: false, checked: true }); // already added, somehow not found as a visible .trait-filter
  const referenceButton = { className: "btn btn-outline-brand btn-sm" };
  const leftContent = fakeLeftContent(referenceButton);
  const domCtl = setupDom({ leftContents: [leftContent], href: "https://next.backpack.tf/classifieds" });

  const addFiltersPanel = fakePanel({ spellsCategory: spellsCategoryOption }, domCtl);
  const addFiltersButton = { click: () => domCtl.setOpenPanel(addFiltersPanel) };
  global.document.querySelectorAll = (selector) => {
    if (selector === ".p-paginator-left-content") return [leftContent];
    if (selector === ".trait-filter") return []; // never finds a Spells trait-filter, even after the funnel step
    return [];
  };
  const baseQuerySelector = global.document.querySelector;
  global.document.querySelector = (selector) =>
    selector === 'button[content="Add filters"], button[content="Add more filters"]' ? addFiltersButton : baseQuerySelector(selector);

  spellFilterToggle();
  await leftContent.lastAppended()._click();

  assert.equal(spellsCategoryOption.clickCount(), 0);
});

test("gives up quietly (no throw) when neither an existing Spells trait-filter nor the 'Add more filters' button can be found", async () => {
  const referenceButton = { className: "btn btn-outline-brand btn-sm" };
  const leftContent = fakeLeftContent(referenceButton);
  setupDom({ leftContents: [leftContent], traitFilters: [], addFiltersButton: null, href: "https://next.backpack.tf/classifieds" });

  spellFilterToggle();
  await assert.doesNotReject(() => Promise.resolve(leftContent.lastAppended()._click()));
});
