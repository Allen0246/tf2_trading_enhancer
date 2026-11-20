import { test } from "node:test";
import assert from "node:assert/strict";
import { findExistingLinkButton, insertLinkButton } from "../backpack.tf/oldUI/linkButtonsRow.js";

// Same hand-rolled fake DOM as tests/addGladiatorButtonOldUI.test.js (see
// that file's own header comment for why this repo hand-rolls this instead
// of pulling in jsdom) - trimmed to only what this file's own direct calls
// to insertLinkButton/findExistingLinkButton need (no MutationObserver/popover
// scanning at all, since this module has no observer of its own - each
// caller's own content.js supplies that).

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.nodeType = 1;
    this.parentElement = null;
    this.children = [];
    this._attrs = {};
    this.style = {};
    const classSet = new Set();
    this.classList = {
      contains: (c) => classSet.has(c),
      add: (...cs) => cs.forEach((c) => classSet.add(c)),
    };
  }
  get className() {
    return this._attrs.class || "";
  }
  set className(v) {
    this._attrs.class = v;
    (v || "").split(/\s+/).filter(Boolean).forEach((c) => this.classList.add(c));
  }
  getAttribute(name) {
    return name in this._attrs ? this._attrs[name] : null;
  }
  setAttribute(name, value) {
    this._attrs[name] = value;
  }
  appendChild(child) {
    this.children.push(child);
    child.parentElement = this;
    return child;
  }
  insertAdjacentElement(position, el) {
    if (position !== "afterend") throw new Error(`unsupported position: ${position}`);
    if (!this.parentElement) throw new Error("insertAdjacentElement: no parentElement");
    const siblings = this.parentElement.children;
    const idx = siblings.indexOf(this);
    siblings.splice(idx + 1, 0, el);
    el.parentElement = this.parentElement;
    return el;
  }
  insertBefore(newNode, referenceNode) {
    const idx = this.children.indexOf(referenceNode);
    this.children.splice(idx === -1 ? this.children.length : idx, 0, newNode);
    newNode.parentElement = this;
    return newNode;
  }
  querySelectorAll(selector) {
    const cls = selector.replace(/^\./, "");
    const out = [];
    const walk = (el) => {
      for (const child of el.children) {
        if (child.classList.contains(cls)) out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
}

// findOrCreateRowForGroup calls document.createElement("dd") directly (not
// passed in) to build a new row - a minimal global stub is enough since
// nothing else in this module touches document.
global.document = { createElement: (tag) => new FakeElement(tag) };

function buildButton(cls) {
  const button = new FakeElement("a");
  button.className = cls;
  return button;
}

// Builds a minimal ".popover-content" containing a lone
// "#popover-additional-links" row - the anchor every row this module builds
// gets inserted "afterend" of.
function buildPopover() {
  const content = new FakeElement("div");
  content.className = "popover-content";
  const additionalLinks = new FakeElement("dd");
  additionalLinks.setAttribute("id", "popover-additional-links");
  content.appendChild(additionalLinks);
  return { content, additionalLinks };
}

test("creates a primary row for gladiator.tf/pricedb.io/posts.tf, right after #popover-additional-links", () => {
  const { content, additionalLinks } = buildPopover();
  const button = buildButton("tf2te-gladiator-tf-button");

  insertLinkButton(content, additionalLinks, button, "tf2te-gladiator-tf-button");

  assert.equal(content.children.length, 2); // additionalLinks, primary row
  const row = content.querySelector(".tf2te-link-buttons-row-primary");
  assert.equal(row.parentElement.children[1], row);
  assert.equal(row.children[0], button);
});

test("creates a separate secondary row for marketplace.tf/mannco.store, not mixed into the primary one", () => {
  const { content, additionalLinks } = buildPopover();
  insertLinkButton(content, additionalLinks, buildButton("tf2te-gladiator-tf-button"), "tf2te-gladiator-tf-button");
  insertLinkButton(content, additionalLinks, buildButton("tf2te-marketplace-tf-button"), "tf2te-marketplace-tf-button");

  const primary = content.querySelector(".tf2te-link-buttons-row-primary");
  const secondary = content.querySelector(".tf2te-link-buttons-row-secondary");
  assert.equal(primary.children.length, 1);
  assert.equal(secondary.children.length, 1);
});

test("keeps the primary row before the secondary row regardless of which one resolves first - secondary first, then primary", () => {
  const { content, additionalLinks } = buildPopover();
  // marketplace.tf/mannco.store often resolve AFTER gladiator.tf/pricedb.io
  // in practice, but this has to hold even in the opposite order - resolved
  // purely from what's actually in the DOM right now, never assumed.
  insertLinkButton(content, additionalLinks, buildButton("tf2te-marketplace-tf-button"), "tf2te-marketplace-tf-button");
  insertLinkButton(content, additionalLinks, buildButton("tf2te-gladiator-tf-button"), "tf2te-gladiator-tf-button");

  const rows = content.children.filter((c) => c !== additionalLinks);
  assert.equal(rows.length, 2);
  assert.ok(rows[0].classList.contains("tf2te-link-buttons-row-primary"));
  assert.ok(rows[1].classList.contains("tf2te-link-buttons-row-secondary"));
});

test("keeps the primary row before the secondary row when primary resolves first too", () => {
  const { content, additionalLinks } = buildPopover();
  insertLinkButton(content, additionalLinks, buildButton("tf2te-gladiator-tf-button"), "tf2te-gladiator-tf-button");
  insertLinkButton(content, additionalLinks, buildButton("tf2te-marketplace-tf-button"), "tf2te-marketplace-tf-button");

  const rows = content.children.filter((c) => c !== additionalLinks);
  assert.equal(rows.length, 2);
  assert.ok(rows[0].classList.contains("tf2te-link-buttons-row-primary"));
  assert.ok(rows[1].classList.contains("tf2te-link-buttons-row-secondary"));
});

test("orders buttons within the primary row as gladiator.tf, pricedb.io, posts.tf regardless of insertion order", () => {
  const { content, additionalLinks } = buildPopover();
  insertLinkButton(content, additionalLinks, buildButton("tf2te-posts-tf-button"), "tf2te-posts-tf-button");
  insertLinkButton(content, additionalLinks, buildButton("tf2te-gladiator-tf-button"), "tf2te-gladiator-tf-button");
  insertLinkButton(content, additionalLinks, buildButton("tf2te-pricedb-button"), "tf2te-pricedb-button");

  const row = content.querySelector(".tf2te-link-buttons-row-primary");
  assert.deepEqual(
    row.children.map((c) => c.className),
    ["tf2te-gladiator-tf-button", "tf2te-pricedb-button", "tf2te-posts-tf-button"]
  );
});

test("orders buttons within the secondary row as marketplace.tf, mannco.store regardless of insertion order", () => {
  const { content, additionalLinks } = buildPopover();
  insertLinkButton(content, additionalLinks, buildButton("tf2te-mannco-store-button"), "tf2te-mannco-store-button");
  insertLinkButton(content, additionalLinks, buildButton("tf2te-marketplace-tf-button"), "tf2te-marketplace-tf-button");

  const row = content.querySelector(".tf2te-link-buttons-row-secondary");
  assert.deepEqual(
    row.children.map((c) => c.className),
    ["tf2te-marketplace-tf-button", "tf2te-mannco-store-button"]
  );
});

// Stntrading.eu added into the same secondary row, right before marketplace.tf -
// see ../backpack.tf/oldUI/addStnButton/content.js's own header note.
test("orders stntrading.eu before marketplace.tf and mannco.store in the secondary row, regardless of insertion order", () => {
  const { content, additionalLinks } = buildPopover();
  insertLinkButton(content, additionalLinks, buildButton("tf2te-mannco-store-button"), "tf2te-mannco-store-button");
  insertLinkButton(content, additionalLinks, buildButton("tf2te-marketplace-tf-button"), "tf2te-marketplace-tf-button");
  insertLinkButton(content, additionalLinks, buildButton("tf2te-stn-button"), "tf2te-stn-button");

  const row = content.querySelector(".tf2te-link-buttons-row-secondary");
  assert.deepEqual(
    row.children.map((c) => c.className),
    ["tf2te-stn-button", "tf2te-marketplace-tf-button", "tf2te-mannco-store-button"]
  );
});

test("findExistingLinkButton finds a button scoped to its own group's row, not the other group's", () => {
  const { content, additionalLinks } = buildPopover();
  insertLinkButton(content, additionalLinks, buildButton("tf2te-gladiator-tf-button"), "tf2te-gladiator-tf-button");
  insertLinkButton(content, additionalLinks, buildButton("tf2te-marketplace-tf-button"), "tf2te-marketplace-tf-button");

  assert.ok(findExistingLinkButton(content, "tf2te-gladiator-tf-button"));
  assert.ok(findExistingLinkButton(content, "tf2te-marketplace-tf-button"));
  assert.equal(findExistingLinkButton(content, "tf2te-pricedb-button"), null);
});

test("applies spacing across the whole row on every insertion, not just the newly-added button", () => {
  const { content, additionalLinks } = buildPopover();
  insertLinkButton(content, additionalLinks, buildButton("tf2te-pricedb-button"), "tf2te-pricedb-button");
  insertLinkButton(content, additionalLinks, buildButton("tf2te-gladiator-tf-button"), "tf2te-gladiator-tf-button"); // resolves second, sorts first

  const row = content.querySelector(".tf2te-link-buttons-row-primary");
  assert.equal(row.children[0].style.marginLeft, ""); // first button - no left margin
  assert.equal(row.children[1].style.marginLeft, "3px"); // pricedb.io, now second - re-applied even though it was inserted first
});
