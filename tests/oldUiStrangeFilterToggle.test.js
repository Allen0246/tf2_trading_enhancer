import { test } from "node:test";
import assert from "node:assert/strict";
import { strangeFilterToggle } from "../backpack.tf/oldUI/strangeFilterToggle/content.js";
import { spellFilterToggle } from "../backpack.tf/oldUI/spellFilterToggle/content.js";

// Minimal hand-rolled fakes, mirroring tests/oldUiSpellFilterToggle.test.js's
// own fixtures - see that file's header note on why this repo hand-rolls
// rather than pulling in jsdom, and on why this file's own fake `document`
// only needs to satisfy ../backpack.tf/oldUI/classifiedsControlsRow.js's own
// requirements (the row's own fallback chain is covered by
// tests/classifiedsControlsRow.test.js). Item/listing shapes below mirror
// the real markup confirmed live against backpack.tf/classifieds
// (data-qe_name="Strange" on an Elevated-Quality-Strange Unusual's own .item
// element - see this feature's own content.js header note for the full
// write-up, including why a plain/Festivized Strange-quality weapon's own
// .item element never carries this attribute at all).

function fakeItem(attrs) {
  return { getAttribute: (name) => (name in attrs ? attrs[name] : null) };
}

function fakeListing(item) {
  let display = "";
  return {
    querySelector: (selector) => (selector === ".listing-item .item" ? item : null),
    style: {
      get display() {
        return display;
      },
      set display(v) {
        display = v;
      },
    },
  };
}

function fakeGenericEl() {
  const listeners = {};
  const children = [];
  return {
    id: "",
    className: "",
    textContent: "",
    style: {},
    children,
    appendChild(el) {
      children.push(el);
      return el;
    },
    addEventListener(eventName, cb) {
      listeners[eventName] = cb;
    },
    _click() {
      return listeners.click?.();
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

function setupDom({ listings = [] } = {}) {
  const nav = fakeNav();
  global.document = {
    querySelectorAll: (selector) => (selector === "li.listing" ? listings : []),
    querySelector: () => null,
    getElementById: (id) => {
      if (id === "tf2te-oldui-classifieds-controls-row") return nav.getControlsRow();
      if (id === "ks-tier-nav") return nav;
      return null;
    },
    createElement: () => fakeGenericEl(),
  };
  return nav;
}

// Real confirmed-live shape (see this feature's own content.js header note):
// an Elevated-Quality-Strange Unusual's own .item element carries
// data-qe_name="Strange" alongside data-quality_elevated="11" - the exact
// signal already driving the site's own "Elevated Quality: Strange" chip.
function elevatedStrangeItem() {
  return fakeItem({
    "data-quality": "5", // Unusual base quality
    "data-quality_elevated": "11",
    "data-qe_name": "Strange",
  });
}

// A plain Strange-QUALITY weapon (not elevated) - data-quality itself is
// Strange (11), but there's no separate data-qe_name at all, since elevated
// quality is structurally exclusive with a plain Strange base quality. Must
// never get flagged.
function plainStrangeWeaponItem() {
  return fakeItem({
    "data-quality": "11",
    "data-q_name": "Strange",
  });
}

// A regular Unique item with no elevated quality at all.
function plainUniqueItem() {
  return fakeItem({
    "data-quality": "6",
    "data-q_name": "Unique",
  });
}

function clickToggle(nav) {
  nav.getControlsRow().children[0]._click();
}

test('flags a listing whose item carries data-qe_name="Strange" (Elevated Quality: Strange)', () => {
  const listing = fakeListing(elevatedStrangeItem());
  const nav = setupDom({ listings: [listing] });

  strangeFilterToggle();
  assert.equal(listing.style.display, ""); // visible on load
  clickToggle(nav);

  assert.equal(listing.style.display, "none");
});

test("never flags a plain Strange-QUALITY weapon (base data-quality is Strange, but no elevated quality at all)", () => {
  const listing = fakeListing(plainStrangeWeaponItem());
  const nav = setupDom({ listings: [listing] });

  strangeFilterToggle(); // nothing flagged -> no button/row gets inserted at all
  assert.equal(listing.style.display, "");
  assert.equal(nav.getControlsRow(), null);
});

test("leaves a plain Unique item alone", () => {
  const listing = fakeListing(plainUniqueItem());
  const nav = setupDom({ listings: [listing] });

  strangeFilterToggle();
  assert.equal(listing.style.display, "");
  assert.equal(nav.getControlsRow(), null);
});

test("does nothing (no button/row inserted) when there are no Elevated-Quality-Strange listings on the page at all", () => {
  const listing = fakeListing(plainStrangeWeaponItem());
  const nav = setupDom({ listings: [listing] });

  strangeFilterToggle();

  assert.equal(nav.getControlsRow(), null);
});

test("inserts the toggle button into the shared controls row underneath #ks-tier-nav", () => {
  const listing = fakeListing(elevatedStrangeItem());
  const nav = setupDom({ listings: [listing] });

  strangeFilterToggle();

  const row = nav.getControlsRow();
  assert.equal(row.children.length, 1);
  assert.equal(row.children[0].textContent, "Hide Strange items"); // visible on load, not yet hidden
});

test("lands after whatever the spell-filter toggle already put in the shared row (call-order-based, not an explicit chain)", () => {
  const listing = fakeListing(elevatedStrangeItem());
  const nav = setupDom({ listings: [listing] });
  // Simulate the spell toggle having already run first and populated the row.
  const preExistingRow = fakeGenericEl();
  const preExistingButton = fakeGenericEl();
  preExistingButton.textContent = "Hide spelled items";
  preExistingRow.appendChild(preExistingButton);
  global.document.getElementById = (id) => {
    if (id === "tf2te-oldui-classifieds-controls-row") return preExistingRow;
    return null;
  };

  strangeFilterToggle();

  assert.equal(preExistingRow.children.length, 2);
  assert.equal(preExistingRow.children[0].textContent, "Hide spelled items");
  assert.equal(preExistingRow.children[1].textContent, "Hide Strange items");
});

test("flagged listings stay VISIBLE on load (no auto-hide), and clicking the button hides/re-shows only those, leaving unrelated listings untouched throughout", () => {
  const strangeListing = fakeListing(elevatedStrangeItem());
  const plainListing = fakeListing(plainUniqueItem());
  const nav = setupDom({ listings: [strangeListing, plainListing] });

  strangeFilterToggle();
  const button = nav.getControlsRow().children[0];

  assert.equal(button.textContent, "Hide Strange items");
  assert.equal(strangeListing.style.display, "");
  assert.equal(plainListing.style.display, "");

  button._click(); // "Remove" -> hide the flagged listing
  assert.equal(button.textContent, "Show Strange items");
  assert.equal(strangeListing.style.display, "none");
  assert.equal(plainListing.style.display, "");

  button._click(); // "Readding" -> show it again
  assert.equal(button.textContent, "Hide Strange items");
  assert.equal(strangeListing.style.display, "");
  assert.equal(plainListing.style.display, "");
});

test("a second strangeFilterToggle() call never inserts a duplicate button", () => {
  const listing = fakeListing(elevatedStrangeItem());
  const nav = setupDom({ listings: [listing] });
  global.document.querySelector = (selector) =>
    selector === ".tf2te-oldui-strange-filter-toggle" ? { textContent: "Hide Strange items" } : null;

  strangeFilterToggle();

  assert.equal(nav.getControlsRow(), null); // bailed before ever touching the row
});

// Both toggles hide by inline style.display. A listing that is spelled AND
// Elevated-Strange is hidden by both; switching only the spell toggle back to
// "Show" used to blank its display and bring it back while the Strange toggle
// still read "Show Strange items" (i.e. "these are hidden").
test("REGRESSION: showing spelled items again does not re-show a spelled listing the Strange toggle still hides", () => {
  const item = fakeItem({ "data-quality": "5", "data-quality_elevated": "11", "data-qe_name": "Strange", "data-spell_1": "Exorcism" });
  const listing = fakeListing(item);
  const nav = setupDom({ listings: [listing] });

  spellFilterToggle();
  strangeFilterToggle();
  const [spellButton, strangeButton] = nav.getControlsRow().children;
  assert.equal(spellButton.textContent, "Hide spelled items");
  assert.equal(strangeButton.textContent, "Hide Strange items");

  strangeButton._click();
  spellButton._click();
  assert.equal(listing.style.display, "none");

  spellButton._click(); // spelled items shown again, Strange still hidden
  assert.equal(spellButton.textContent, "Hide spelled items");
  assert.equal(listing.style.display, "none");

  strangeButton._click(); // nothing hides it any more
  assert.equal(listing.style.display, "");
});
