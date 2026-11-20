import { test } from "node:test";
import assert from "node:assert/strict";
import { strangeFilterToggle, __resetStrangeFilterToggleForTests } from "../backpack.tf/nextUI/strangeFilterToggle/content.js";

// Minimal hand-rolled fakes, mirroring tests/spellFilterToggle.test.js's own
// fixtures - see that file's header note on why this repo hand-rolls rather
// than pulling in jsdom. Unlike that sibling feature (which drives a real
// site filter VALUE), this one scans listing/.item markup directly and
// toggles inline style.display - see this feature's own content.js header
// note on why (confirmed live: no "None"/"No Elevated Quality" trait-filter
// value exists to drive instead, unlike Spells' own "No Spells").

function fakeGenericElement() {
  const listeners = {};
  let removed = false;
  return {
    id: "",
    type: null,
    className: "",
    textContent: "",
    style: {},
    addEventListener(eventName, cb) {
      listeners[eventName] = cb;
    },
    async _click() {
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
      if (selector === ".tf2te-strange-filter-toggle") return isPresent() ? appended : null;
      return null;
    },
    appendChild(el) {
      appended = el;
      return el;
    },
  };
}

// A listing's own .item element - classList.contains("item__elevated_strange")
// is the exact confirmed-live signal this feature checks (see content.js's
// own header note).
function fakeItemEl(classes = []) {
  return {
    classList: { contains: (cls) => classes.includes(cls) },
  };
}

function fakeListing(item) {
  let display = "";
  return {
    querySelector: (selector) => (selector === ".item" ? item : null),
    style: {
      get display() {
        return display;
      },
      set display(v) {
        display = v;
      },
      // content.js uses setProperty/removeProperty (with "important"), not
      // a plain assignment - see its own header note on why (Bootstrap's
      // "d-flex" utility class otherwise wins the cascade over a
      // non-!important inline style).
      setProperty(prop, value) {
        if (prop === "display") display = value;
      },
      removeProperty(prop) {
        if (prop === "display") display = "";
      },
    },
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

function setupDom({ leftContents = [], listings = [], href } = {}) {
  __resetStrangeFilterToggleForTests(); // module-level `hidden` would otherwise leak across tests
  FakeMutationObserver.instances = [];
  global.MutationObserver = FakeMutationObserver;

  global.document = {
    querySelectorAll: (selector) => {
      if (selector === ".p-paginator-left-content") return leftContents;
      if (selector === ".listing") return listings;
      return [];
    },
    createElement: () => fakeGenericElement(),
    body: {},
  };
  global.window = { location: { href, pathname: new URL(href).pathname } };
}

test("inserts a button next to the native Refresh button, cloning its classes, labelled 'Hide Strange items' by default", () => {
  const referenceButton = { className: "btn btn-outline-brand btn-sm" };
  const leftContent = fakeLeftContent(referenceButton);
  setupDom({ leftContents: [leftContent], href: "https://next.backpack.tf/classifieds?itemName=Commando%20Elite&quality=5" });

  strangeFilterToggle();

  assert.equal(leftContent.appendedCount(), 1);
  const button = leftContent.lastAppended();
  assert.equal(button.className, "btn btn-outline-brand btn-sm tf2te-strange-filter-toggle");
  assert.equal(button.textContent, "Hide Strange items");
});

test("a later MutationObserver tick never inserts a second button", () => {
  const referenceButton = { className: "btn btn-outline-brand btn-sm" };
  const leftContent = fakeLeftContent(referenceButton);
  setupDom({ leftContents: [leftContent], href: "https://next.backpack.tf/classifieds" });

  strangeFilterToggle();
  assert.equal(leftContent.appendedCount(), 1);
  const firstButton = leftContent.lastAppended();

  FakeMutationObserver.instances[0].cb();

  assert.equal(leftContent.appendedCount(), 1);
  assert.equal(leftContent.lastAppended(), firstButton);
});

test("does nothing when the page has no paginator left-content at all", () => {
  setupDom({ leftContents: [], href: "https://next.backpack.tf/classifieds" });
  assert.doesNotThrow(() => strangeFilterToggle());
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

  assert.doesNotThrow(() => strangeFilterToggle());
});

test("never inserts the button at all when the page isn't /classifieds", () => {
  const referenceButton = { className: "btn btn-outline-brand btn-sm" };
  const leftContent = fakeLeftContent(referenceButton);
  setupDom({ leftContents: [leftContent], href: "https://next.backpack.tf/items" });

  strangeFilterToggle();

  assert.equal(leftContent.appendedCount(), 0);
});

test("removes an already-inserted button once the SPA navigates away from /classifieds without a page reload", () => {
  const referenceButton = { className: "btn btn-outline-brand btn-sm" };
  const leftContent = fakeLeftContent(referenceButton);
  setupDom({ leftContents: [leftContent], href: "https://next.backpack.tf/classifieds" });

  strangeFilterToggle();
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

  strangeFilterToggle();
  assert.equal(leftContent.appendedCount(), 0);

  window.location.href = "https://next.backpack.tf/classifieds";
  window.location.pathname = "/classifieds";
  FakeMutationObserver.instances[0].cb();

  assert.equal(leftContent.appendedCount(), 1);
});

test("clicking the button hides only listings whose item carries item__elevated_strange, leaving everything else alone, and re-shows on a second click", async () => {
  const referenceButton = { className: "btn btn-outline-brand btn-sm" };
  const leftContent = fakeLeftContent(referenceButton);
  const strangeListing = fakeListing(fakeItemEl(["item", "item__quality-440-5-dark", "item__elevated_strange", "p-440-11"]));
  const plainListing = fakeListing(fakeItemEl(["item", "item__quality-440-6-dark"]));
  setupDom({ leftContents: [leftContent], listings: [strangeListing, plainListing], href: "https://next.backpack.tf/classifieds" });

  strangeFilterToggle();
  const button = leftContent.lastAppended();

  assert.equal(strangeListing.style.display, "");
  assert.equal(plainListing.style.display, "");

  await button._click();
  assert.equal(button.textContent, "Show Strange items");
  assert.equal(strangeListing.style.display, "none");
  assert.equal(plainListing.style.display, "");

  await button._click();
  assert.equal(button.textContent, "Hide Strange items");
  assert.equal(strangeListing.style.display, "");
  assert.equal(plainListing.style.display, "");
});

test("a listing with no .item element at all is treated as non-Strange, not a crash", async () => {
  const referenceButton = { className: "btn btn-outline-brand btn-sm" };
  const leftContent = fakeLeftContent(referenceButton);
  const noItemListing = { querySelector: () => null, style: {} };
  setupDom({ leftContents: [leftContent], listings: [noItemListing], href: "https://next.backpack.tf/classifieds" });

  strangeFilterToggle();
  await assert.doesNotReject(() => Promise.resolve(leftContent.lastAppended()._click()));
});

// Confirmed live: next.backpack.tf's own classifieds list keeps inserting
// new listing rows after the initial load (infinite scroll / live updates) -
// a listing that only appears on a LATER MutationObserver tick still needs
// to end up hidden if the toggle is currently on, not just whatever existed
// at click time.
test("hides a newly-appeared Strange listing on a later scan tick, once the toggle is already on", async () => {
  const referenceButton = { className: "btn btn-outline-brand btn-sm" };
  const leftContent = fakeLeftContent(referenceButton);
  const listings = [];
  setupDom({ leftContents: [leftContent], listings, href: "https://next.backpack.tf/classifieds" });

  strangeFilterToggle();
  await leftContent.lastAppended()._click(); // turn the toggle on while no listings exist yet

  const lateStrangeListing = fakeListing(fakeItemEl(["item", "item__elevated_strange"]));
  listings.push(lateStrangeListing);
  FakeMutationObserver.instances[0].cb(); // simulate the Vue SPA inserting a new row

  assert.equal(lateStrangeListing.style.display, "none");
});

test("never re-hides listings once the toggle is off, even on a later scan tick", () => {
  const referenceButton = { className: "btn btn-outline-brand btn-sm" };
  const leftContent = fakeLeftContent(referenceButton);
  const listings = [];
  setupDom({ leftContents: [leftContent], listings, href: "https://next.backpack.tf/classifieds" });

  strangeFilterToggle(); // toggle stays off (default)

  const lateStrangeListing = fakeListing(fakeItemEl(["item", "item__elevated_strange"]));
  listings.push(lateStrangeListing);
  FakeMutationObserver.instances[0].cb();

  assert.equal(lateStrangeListing.style.display, "");
});
