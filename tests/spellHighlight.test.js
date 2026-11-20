import { test } from "node:test";
import assert from "node:assert/strict";
import { spellHighlight } from "../backpack.tf/oldUI/spellHighlight/content.js";

// Minimal hand-rolled fakes (see tests/helpers/fakeDom.js's own header on why
// this repo hand-rolls rather than pulling in jsdom).

function fakeItem(attrs) {
  const styleProps = {};
  return {
    getAttribute: (name) => (name in attrs ? attrs[name] : null),
    style: {
      setProperty: (name, value, priority) => {
        styleProps[name] = { value, priority };
      },
    },
    _styleProps: styleProps,
  };
}

function setupDom(items) {
  global.document = {
    querySelectorAll: (selector) => (selector === "[data-spell_1]" ? items : []),
    body: {},
  };
  global.MutationObserver = class {
    observe() {}
  };
}

test("gives a single-spell item a green dotted bottom border", () => {
  const item = fakeItem({ "data-spell_1": "Paint Spell: Spectral Spectrum" });
  setupDom([item]);

  spellHighlight();

  assert.deepEqual(item._styleProps["border-bottom"], { value: "6px dotted #10ff00", priority: "important" });
});

test("gives a double-spell item (both data-spell_1 and data-spell_2) a red dotted bottom border instead", () => {
  const item = fakeItem({
    "data-spell_1": "Paint Spell: Chromatic Corruption",
    "data-spell_2": "Footsteps Spell: Headless Horseshoes",
  });
  setupDom([item]);

  spellHighlight();

  assert.deepEqual(item._styleProps["border-bottom"], { value: "6px dotted #ff2121", priority: "important" });
});

test("only ever sets the border-bottom property, never touches any other style property (e.g. an existing border-color/background-color)", () => {
  const item = fakeItem({ "data-spell_1": "Paint Spell: Spectral Spectrum" });
  setupDom([item]);

  spellHighlight();

  assert.deepEqual(Object.keys(item._styleProps), ["border-bottom"]);
});

test("does nothing when there are no spelled items on the page", () => {
  setupDom([]);
  assert.doesNotThrow(() => spellHighlight());
});
