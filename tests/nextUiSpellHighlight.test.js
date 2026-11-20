import { test } from "node:test";
import assert from "node:assert/strict";
import { spellHighlight } from "../backpack.tf/nextUI/spellHighlight/content.js";

// Minimal hand-rolled fakes (see tests/helpers/fakeDom.js's own header on why
// this repo hand-rolls rather than pulling in jsdom). Icon shapes mirror
// real markup confirmed live on next.backpack.tf - see content.js's own
// header note for the exact attribute__<slug> class list this is built from.

function fakeSvg(classNames) {
  const classSet = new Set(classNames);
  return { classList: { contains: (c) => classSet.has(c) } };
}

// spellSvgs is mutable-by-reference (an array the test can reassign items
// into) so a test can simulate next.backpack.tf recycling the SAME DOM node
// for a different item's content between two spellHighlight() runs.
function fakeItemEl(spellSvgs) {
  const styleProps = {};
  let removePropertyCalls = 0;
  return {
    querySelectorAll: (selector) => (selector === ".item__icons svg" ? spellSvgs : []),
    style: {
      setProperty: (name, value, priority) => {
        styleProps[name] = { value, priority };
      },
      removeProperty: (name) => {
        removePropertyCalls++;
        delete styleProps[name];
      },
    },
    _styleProps: styleProps,
    _removePropertyCalls: () => removePropertyCalls,
  };
}

function setupDom(items) {
  global.document = {
    querySelectorAll: (selector) => (selector === 'a.item[class*="item__quality-"]' ? items : []),
    body: {},
  };
  global.MutationObserver = class {
    observe() {}
  };
}

test("gives an item with one spell icon a green dotted bottom border", () => {
  const item = fakeItemEl([fakeSvg(["item__icons__icon", "svg-inline--fa", "fa-ghost", "attribute__exorcism-spell"])]);
  setupDom([item]);

  spellHighlight();

  assert.deepEqual(item._styleProps["border-bottom"], { value: "6px dotted #10ff00", priority: "important" });
});

test("gives an item with two spell icons a red dotted bottom border instead", () => {
  const item = fakeItemEl([
    fakeSvg(["attribute__chromatic-corruption"]),
    fakeSvg(["attribute__headless-horseshoes-fp"]),
  ]);
  setupDom([item]);

  spellHighlight();

  assert.deepEqual(item._styleProps["border-bottom"], { value: "6px dotted #ff2121", priority: "important" });
});

test("an item with no spell icons never gets a border-bottom set (and clears one if present)", () => {
  const item = fakeItemEl([]);
  setupDom([item]);

  spellHighlight();

  assert.deepEqual(item._styleProps, {});
  assert.equal(item._removePropertyCalls(), 1);
});

test("never mistakes an unrelated special-attribute icon (e.g. a killstreak sheen) for a spell", () => {
  const item = fakeItemEl([fakeSvg(["item__icons__icon", "attribute__team-shine"])]); // a sheen, not a spell
  setupDom([item]);

  spellHighlight();

  assert.deepEqual(item._styleProps, {});
});

test("does nothing when there are no item tiles on the page", () => {
  setupDom([]);
  assert.doesNotThrow(() => spellHighlight());
});

// Confirmed live on a real classifieds listing: an item with 2 real spells
// AND an unrelated Paint icon (attribute__undefined) all inside the same
// .item__icons - the Paint icon must never be counted as a spell.
test("REGRESSION: a classifieds listing with 2 spells plus an unrelated attribute__undefined (Paint) icon is counted as exactly 2 spells, not 3", () => {
  const item = fakeItemEl([
    fakeSvg(["item__icons__icon", "fa-fill-drip", "attribute__undefined"]), // Paint
    fakeSvg(["item__icons__icon", "fa-flask-round-potion", "attribute__spectral-spectrum"]),
    fakeSvg(["item__icons__icon", "fa-shoe-prints", "attribute__rotten-orange-fp"]),
  ]);
  setupDom([item]);

  spellHighlight();

  assert.deepEqual(item._styleProps["border-bottom"], { value: "6px dotted #ff2121", priority: "important" });
});

// After using the "Hide spelled items" toggle, a tile that USED to be
// spelled kept its colored border even once next.backpack.tf recycled
// that same DOM node for a different item with no spell at all - an
// earlier version's markSpell just returned without touching
// border-bottom at all when count was 0.
test("REGRESSION: a previously-spelled item's border is cleared once a later scan (simulating a recycled DOM node showing different content) finds no spell on it anymore", () => {
  const spellSvgs = [fakeSvg(["attribute__exorcism-spell"])];
  const item = fakeItemEl(spellSvgs);
  setupDom([item]);

  spellHighlight();
  assert.equal(item._styleProps["border-bottom"].value, "6px dotted #10ff00");

  // Simulate Vue recycling this exact node for a different, unspelled item.
  spellSvgs.length = 0;
  spellHighlight(); // a fresh call, standing in for the MutationObserver's own re-scan

  assert.equal(item._styleProps["border-bottom"], undefined);
});
