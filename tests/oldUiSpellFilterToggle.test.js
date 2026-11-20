import { test } from "node:test";
import assert from "node:assert/strict";
import { spellFilterToggle } from "../backpack.tf/oldUI/spellFilterToggle/content.js";

// Minimal hand-rolled fakes (see tests/helpers/fakeDom.js's own header on why
// this repo hand-rolls rather than pulling in jsdom). Item/listing shapes
// below mirror real markup confirmed live against backpack.tf/classifieds -
// see this feature's own content.js header note for the sell-vs-buy
// data-spell_1/2 reliability finding these fixtures are built to match.
//
// content.js now inserts its own button via the REAL
// ../backpack.tf/oldUI/classifiedsControlsRow.js (imported relatively, not
// mocked here) rather than managing its own insertion chain - so this
// file's own fake `document` only needs to satisfy THAT module's own
// requirements (getElementById("ks-tier-nav")/createElement/a nav element
// with insertAdjacentElement); the row's own fallback chain (nav vs
// #search-crumbs vs panel-body prepend) is already covered by
// tests/classifiedsControlsRow.test.js, so this file only exercises the
// nav-present path and asserts against the row's own children instead of a
// per-feature insertion chain.

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
  const nav = {
    insertAdjacentElement(position, el) {
      if (position === "afterend") controlsRow = el;
    },
    getControlsRow: () => controlsRow,
  };
  return nav;
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

// Real confirmed-live shapes: a SELL listing with a real item instance
// (data-id populated) genuinely carries its own spell data; a BUY listing
// has no real item (data-id="") and its data-spell_1/2 don't reflect that
// buyer's own want (see content.js's own header note on the live evidence).
function realSellSpelledItem() {
  return fakeItem({
    "data-listing_intent": "sell",
    "data-id": "16871525375",
    "data-spell_1": "Paint Spell: Spectral Spectrum",
    "data-spell_2": "Footsteps Spell: Team Spirit Footprints",
    "data-listing_comment": "Spectral Spectrum + Team Spirit Footprints! I love you, Honey Bunny. Feel free to offer",
  });
}

function realSellPlainItem() {
  return fakeItem({
    "data-listing_intent": "sell",
    "data-id": "12345",
    "data-listing_comment": "Selling for 5 keys, add me",
  });
}

// The confirmed-live "shared reference item" case: a buy order whose
// data-spell_1/2 are populated (from a reused reference item, not this
// buyer's own want) but whose own comment has nothing to do with spells.
// The user wants this hidden anyway (see content.js's own header note on
// prioritizing "nothing spell-shaped stays visible" over "never hide a
// buy order that might not really care") - so this DOES get flagged, on
// the data-spell_1/2 signal alone, despite it not being verifiably that
// specific buyer's own want.
function buySharedReferenceItem() {
  return fakeItem({
    "data-listing_intent": "buy",
    "data-id": "",
    "data-spell_1": "Paint Spell: Chromatic Corruption",
    "data-spell_2": "Footsteps Spell: Headless Horseshoes",
    "data-listing_comment": "Buying BPs and Keys with Paypal - 184 bought, 1.63 per key",
  });
}

function buyCommentMentionsSpells() {
  return fakeItem({
    "data-listing_intent": "buy",
    "data-id": "",
    "data-listing_comment": "Buying Spell ones. Voices from Below - 110+ keys. Any footprints - 140+ keys.",
  });
}

// Spelled listings are left VISIBLE on load (see content.js's own note on
// this default) - detection is verified indirectly here by clicking the
// toggle button once (which hides only what was actually flagged) and
// checking the resulting display, rather than checking display right after
// spellFilterToggle() alone.
function clickToggle(nav) {
  nav.getControlsRow().children[0]._click();
}

test("flags a sell listing spelled via its own data-spell_1/data-spell_2, ignoring the comment entirely", () => {
  const listing = fakeListing(realSellSpelledItem());
  const nav = setupDom({ listings: [listing] });

  spellFilterToggle();
  assert.equal(listing.style.display, ""); // visible on load
  clickToggle(nav);

  assert.equal(listing.style.display, "none");
});

test("leaves a plain (unspelled) sell listing alone even after the toggle is clicked", () => {
  const listing = fakeListing(realSellPlainItem());
  const nav = setupDom({ listings: [listing] });

  spellFilterToggle(); // no spelled listings at all here -> no button gets inserted
  assert.equal(listing.style.display, "");
  assert.equal(nav.getControlsRow(), null); // never even created the row
});

test("flags a buy listing via its data-spell_1/data-spell_2 even when they're a shared reference item's values, not this buyer's own comment-stated want", () => {
  const listing = fakeListing(buySharedReferenceItem());
  const nav = setupDom({ listings: [listing] });

  spellFilterToggle();
  clickToggle(nav);

  assert.equal(listing.style.display, "none");
});

test("flags a buy listing whose own comment mentions spells", () => {
  const listing = fakeListing(buyCommentMentionsSpells());
  const nav = setupDom({ listings: [listing] });

  spellFilterToggle();
  clickToggle(nav);

  assert.equal(listing.style.display, "none");
});

test("flags a listing via data-spell_1/data-spell_2 regardless of data-listing_intent - the check no longer branches on buy vs sell at all", () => {
  const item = fakeItem({ "data-spell_1": "Paint Spell: Team Spirit" }); // no data-listing_intent at all
  const listing = fakeListing(item);
  const nav = setupDom({ listings: [listing] });

  spellFilterToggle();
  clickToggle(nav);

  assert.equal(listing.style.display, "none");
});

test("does nothing (no button/row inserted) when there are no spelled listings on the page at all", () => {
  const listing = fakeListing(realSellPlainItem());
  const nav = setupDom({ listings: [listing] });

  spellFilterToggle();

  assert.equal(nav.getControlsRow(), null);
});

test("inserts the toggle button into the shared controls row underneath #ks-tier-nav", () => {
  const listing = fakeListing(realSellSpelledItem());
  const nav = setupDom({ listings: [listing] });

  spellFilterToggle();

  const row = nav.getControlsRow();
  assert.equal(row.children.length, 1);
  assert.equal(row.children[0].textContent, "Hide spelled items"); // visible on load, not yet hidden
});

test("spelled listings stay VISIBLE on load (no auto-hide), and clicking the button hides/re-shows only those, leaving unrelated listings untouched throughout", () => {
  const spelledListing = fakeListing(realSellSpelledItem());
  const plainListing = fakeListing(realSellPlainItem());
  const nav = setupDom({ listings: [spelledListing, plainListing] });

  spellFilterToggle();
  const button = nav.getControlsRow().children[0];

  // Left visible by default - the button's own label reflects the
  // NEXT action (removing), not the current state's own name.
  assert.equal(button.textContent, "Hide spelled items");
  assert.equal(spelledListing.style.display, "");
  assert.equal(plainListing.style.display, "");

  button._click(); // "Remove" -> hide the spelled listing
  assert.equal(button.textContent, "Show spelled items");
  assert.equal(spelledListing.style.display, "none");
  assert.equal(plainListing.style.display, "");

  button._click(); // "Readding" -> show it again
  assert.equal(button.textContent, "Hide spelled items");
  assert.equal(spelledListing.style.display, "");
  assert.equal(plainListing.style.display, "");
});

test("a second spellFilterToggle() call never inserts a duplicate button", () => {
  const listing = fakeListing(realSellSpelledItem());
  const nav = setupDom({ listings: [listing] });
  global.document.querySelector = (selector) =>
    selector === ".tf2te-oldui-spell-filter-toggle" ? { textContent: "Hide spelled items" } : null;

  spellFilterToggle();

  assert.equal(nav.getControlsRow(), null); // bailed before ever touching the row
});
