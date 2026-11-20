import { test } from "node:test";
import assert from "node:assert/strict";
import { ensureClassifiedsControlsRow } from "../backpack.tf/oldUI/classifiedsControlsRow.js";

// Minimal hand-rolled fakes (see tests/oldUiSpellFilterToggle.test.js's own
// header comment for why this repo hand-rolls rather than pulling in
// jsdom). A `registry` map stands in for "findable by id in the document" -
// insertAdjacentElement on whichever real anchor element (nav/crumbs) is
// used registers the newly-created row into it, the same way a real
// insertAdjacentElement call would make the row findable via
// document.getElementById on a real page.

function fakeInsertTarget() {
  const inserted = [];
  return {
    insertAdjacentElement: (position, el) => inserted.push({ position, el }),
    prepend: (el) => inserted.push({ position: "prepend", el }),
    querySelector: () => null,
    _inserted: inserted,
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

function setupDom({ navEl = null, panelBody = null, existingRow = null } = {}) {
  global.document = {
    getElementById: (id) => {
      if (id === "tf2te-oldui-classifieds-controls-row") return existingRow;
      if (id === "ks-tier-nav") return navEl;
      return null;
    },
    querySelector: (selector) => (selector === ".panel.panel-main .panel-body" ? panelBody : null),
    createElement: () => fakeRowEl(),
  };
}

test("creates and inserts a new row right after #ks-tier-nav when present", () => {
  const nav = fakeInsertTarget();
  setupDom({ navEl: nav });

  const row = ensureClassifiedsControlsRow();

  assert.equal(nav._inserted.length, 1);
  assert.equal(nav._inserted[0].position, "afterend");
  assert.equal(nav._inserted[0].el, row);
  assert.equal(row.id, "tf2te-oldui-classifieds-controls-row");
});

test("returns the already-existing row instead of creating a second one", () => {
  const nav = fakeInsertTarget();
  const existingRow = fakeRowEl();
  setupDom({ navEl: nav, existingRow });

  const row = ensureClassifiedsControlsRow();

  assert.equal(row, existingRow);
  assert.deepEqual(nav._inserted, []); // never touched the nav - nothing new to insert
});

test("falls back to inserting after #search-crumbs when #ks-tier-nav is missing", () => {
  const crumbs = fakeInsertTarget();
  const panelBody = { querySelector: (selector) => (selector === "#search-crumbs" ? crumbs : null) };
  setupDom({ navEl: null, panelBody });

  const row = ensureClassifiedsControlsRow();

  assert.equal(crumbs._inserted.length, 1);
  assert.equal(crumbs._inserted[0].position, "afterend");
  assert.equal(crumbs._inserted[0].el, row);
});

test("falls back to prepending into the panel body when neither #ks-tier-nav nor #search-crumbs exist", () => {
  const panelBody = fakeInsertTarget();
  panelBody.querySelector = () => null; // no #search-crumbs either
  setupDom({ navEl: null, panelBody });

  const row = ensureClassifiedsControlsRow();

  assert.equal(panelBody._inserted.length, 1);
  assert.equal(panelBody._inserted[0].position, "prepend");
  assert.equal(panelBody._inserted[0].el, row);
});

test("still returns a (detached) row rather than throwing when nothing exists to anchor on at all", () => {
  setupDom({ navEl: null, panelBody: null });

  assert.doesNotThrow(() => {
    const row = ensureClassifiedsControlsRow();
    assert.equal(row.id, "tf2te-oldui-classifieds-controls-row");
  });
});
