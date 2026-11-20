import { test } from "node:test";
import assert from "node:assert/strict";
import { addGladiatorButton } from "../backpack.tf/nextUI/addGladiatorButton/content.js";

// Minimal hand-rolled fake DOM (see tests/addMarketplaceButton.test.js's own
// header comment for why this repo hand-rolls this instead of pulling in
// jsdom) - same shape, since this file targets the exact same tooltip
// markup, just a much smaller slice of it (no attribute rows needed at all,
// only the Classifieds anchor + optional title heading + content-links row).

function parseCompound(selector) {
  const attrSubMatch = /\[([\w-]+)\*="([^"]*)"\]/.exec(selector);
  const rest = selector.replace(/\[[^\]]*\]/g, "");
  const classes = [...rest.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
  const tagMatch = /^[a-zA-Z][\w-]*/.exec(rest);
  return {
    tag: tagMatch ? tagMatch[0].toLowerCase() : null,
    classes,
    attrSub: attrSubMatch ? { name: attrSubMatch[1], value: attrSubMatch[2] } : null,
  };
}

function matchesCompound(el, parsed) {
  if (!el || el.nodeType !== 1) return false;
  if (parsed.tag && el.tagName.toLowerCase() !== parsed.tag) return false;
  if (!parsed.classes.every((c) => el.classList.contains(c))) return false;
  if (parsed.attrSub) {
    const v = el.getAttribute(parsed.attrSub.name);
    if (!v || !v.includes(parsed.attrSub.value)) return false;
  }
  return true;
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.nodeType = 1; // Node.ELEMENT_NODE
    this.parentElement = null;
    this.children = [];
    this._attrs = {};
    this.dataset = {};
    this._textContent = "";
    this._className = "";
    this.style = {};
    const classSet = new Set();
    this.classList = {
      contains: (c) => classSet.has(c),
      add: (...cs) => cs.forEach((c) => classSet.add(c)),
    };
  }
  get textContent() {
    if (this.children.length > 0) return this.children.map((c) => c.textContent || "").join("");
    return this._textContent;
  }
  set textContent(v) {
    this._textContent = v;
  }
  get className() {
    return this._className;
  }
  set className(v) {
    this._className = v;
    (v || "").split(/\s+/).filter(Boolean).forEach((c) => this.classList.add(c));
  }
  get href() {
    return this._attrs.href || "";
  }
  set href(v) {
    this._attrs.href = v;
  }
  getAttribute(name) {
    return name in this._attrs ? this._attrs[name] : null;
  }
  setAttribute(name, value) {
    this._attrs[name] = value;
  }
  getAttributeNames() {
    return Object.keys(this._attrs);
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
  matches(selector) {
    return matchesCompound(this, parseCompound(selector));
  }
  closest(selector) {
    const parsed = parseCompound(selector);
    let el = this;
    while (el) {
      if (matchesCompound(el, parsed)) return el;
      el = el.parentElement;
    }
    return null;
  }
  querySelectorAll(selector) {
    const parsed = parseCompound(selector);
    const out = [];
    const walk = (el) => {
      for (const child of el.children) {
        if (matchesCompound(child, parsed)) out.push(child);
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

function makeDocument(rootChildren = []) {
  const body = new FakeElement("body");
  for (const c of rootChildren) body.appendChild(c);
  return {
    body,
    createElement: (tag) => new FakeElement(tag),
    querySelectorAll: (selector) => body.querySelectorAll(selector),
    querySelector: (selector) => body.querySelector(selector),
  };
}

class FakeMutationObserver {
  constructor(cb) {
    this.cb = cb;
    FakeMutationObserver.instances.push(this);
  }
  observe(target, opts) {
    this.target = target;
    this.opts = opts;
  }
  disconnect() {}
}
FakeMutationObserver.instances = [];

const realSetTimeout = setTimeout;
async function flush(ticks = 8) {
  for (let i = 0; i < ticks; i++) await new Promise((resolve) => realSetTimeout(resolve, 0));
}

function installGlobals() {
  global.Node = { ELEMENT_NODE: 1 };
  global.MutationObserver = FakeMutationObserver;
  FakeMutationObserver.instances = [];
}

function getGladiatorButton() {
  return document.querySelector(".tf2te-gladiator-tf-button");
}

// Same shape confirmed live in next.backpack.tf's item-preview tooltip:
// <a href="/classifieds?itemName=...&quality=11" class="btn btn-outline-brand btn-item-tooltip">
function buildClassifiedsAnchor(itemName, qualityId, { scopedAttr = "data-v-b49f43c8" } = {}) {
  const anchor = new FakeElement("a");
  anchor.setAttribute("href", `/classifieds?itemName=${encodeURIComponent(itemName)}&quality=${qualityId}`);
  anchor.className = "btn btn-outline-brand btn-item-tooltip";
  if (scopedAttr) anchor.setAttribute(scopedAttr, "");
  return anchor;
}

function buildContentLinksRow(anchor) {
  const row = new FakeElement("div");
  row.className = "item-tooltip__content__links";
  row.appendChild(anchor);
  return row;
}

// Builds a ".tippy-popper" tooltip shell (confirmed live) with an optional
// title heading (confirmed live: <div class="item-tooltip__header__title">
// Name</div>) and the Classifieds anchor.
function buildTooltip({ itemName, qualityId, titleText } = {}) {
  const popper = new FakeElement("div");
  popper.classList.add("tippy-popper");

  if (titleText) {
    const titleDiv = new FakeElement("div");
    titleDiv.classList.add("item-tooltip__header__title");
    titleDiv.textContent = `\n      ${titleText}\n    `;
    popper.appendChild(titleDiv);
  }

  const anchor = buildClassifiedsAnchor(itemName, qualityId);
  const linksWrap = buildContentLinksRow(anchor);
  popper.appendChild(linksWrap);

  return { popper, anchor };
}

test("builds the gladiator.tf link from the tooltip's own title heading, spaces encoded as '+' (confirmed live, not %20)", async () => {
  installGlobals();
  const { popper } = buildTooltip({ itemName: "Splitting Headache", qualityId: 5, titleText: "Smoking Splitting Headache" });
  global.document = makeDocument([popper]);

  addGladiatorButton();
  await flush();

  const button = getGladiatorButton();
  assert.equal(button.href, "https://gladiator.tf/sales?item=Smoking+Splitting+Headache");
});

test("falls back to no title heading present without throwing (an item type with no title row at all)", async () => {
  installGlobals();
  const anchor = buildClassifiedsAnchor("Reclaimed Metal", 6);
  const wrap = buildContentLinksRow(anchor);
  global.document = makeDocument([wrap]);

  addGladiatorButton();
  await flush();

  assert.equal(getGladiatorButton(), null);
  assert.equal(wrap.children.length, 1); // untouched
});

test("inserts a gladiator.tf button in its own row after the Classifieds row, cloning the button's classes and reusing the mb-1 row class", async () => {
  installGlobals();
  const { popper } = buildTooltip({ itemName: "Reclaimed Metal", qualityId: 6, titleText: "Reclaimed Metal" });
  global.document = makeDocument([popper]);

  addGladiatorButton();
  await flush();

  // popper: [titleDiv, linksWrap (native row), gladiator row] - the native
  // row is untouched, the button lives in a NEW sibling row.
  assert.equal(popper.children.length, 3);
  const nativeRow = popper.children[1];
  assert.equal(nativeRow.children.length, 1); // just the Classifieds anchor still
  const row = popper.children[2];
  assert.ok(row.classList.contains("item-tooltip__content__links"));
  assert.ok(row.classList.contains("mb-1"));

  const button = getGladiatorButton();
  assert.equal(button.parentElement, row);
  assert.equal(button.textContent, "gladiator.tf");
  assert.ok(button.classList.contains("btn-item-tooltip"));
  assert.ok(button.classList.contains("tf2te-gladiator-tf-button"));
  assert.equal(button.target, "_blank");
  assert.equal(button.rel, "noopener noreferrer");
});

test("inserts the gladiator.tf row after the LAST of two content-links rows (Classifieds row, then Item/History/Wiki row), not the first", async () => {
  installGlobals();
  const { popper } = buildTooltip({ itemName: "Reclaimed Metal", qualityId: 6, titleText: "Reclaimed Metal" });
  const historyRow = new FakeElement("div");
  historyRow.className = "item-tooltip__content__links px-2 mb-1"; // confirmed live shape
  popper.appendChild(historyRow);
  global.document = makeDocument([popper]);

  addGladiatorButton();
  await flush();

  assert.equal(popper.children.length, 4);
  assert.equal(popper.children[2], historyRow);
  assert.ok(popper.children[3].classList.contains("item-tooltip__content__links"));
  assert.equal(getGladiatorButton().parentElement, popper.children[3]);
});

test("copies the Classifieds anchor's Vue scoped-style attribute (data-v-XXXXXXXX) onto the new button, so scoped CSS sizes it the same", async () => {
  installGlobals();
  const { popper } = buildTooltip({ itemName: "Reclaimed Metal", qualityId: 6, titleText: "Reclaimed Metal" });
  global.document = makeDocument([popper]);

  addGladiatorButton();
  await flush();

  const button = getGladiatorButton();
  assert.equal(button.getAttribute("data-v-b49f43c8"), "");
});

test("does not insert a second button when the same unchanged tooltip is scanned twice (content-signature dedupe on the title text)", async () => {
  installGlobals();
  const { popper } = buildTooltip({ itemName: "Reclaimed Metal", qualityId: 6, titleText: "Reclaimed Metal" });
  global.document = makeDocument([popper]);

  addGladiatorButton();
  await flush();
  assert.equal(popper.children.length, 3);

  addGladiatorButton();
  await flush();

  assert.equal(popper.children.length, 3);
});

test("REGRESSION: when Vue recycles the same tooltip for a DIFFERENT item (confirmed live pattern - see addMarketplaceButton.test.js's own regression test), the button's href updates to the new item instead of staying stuck on the first one", async () => {
  installGlobals();
  const { popper, anchor } = buildTooltip({ itemName: "Knife", qualityId: 11, titleText: "Strange Knife" });
  global.document = makeDocument([popper]);

  addGladiatorButton();
  await flush();
  assert.equal(getGladiatorButton().href, "https://gladiator.tf/sales?item=Strange+Knife");

  // Vue patches the SAME title node's text in place for a different item.
  const titleDiv = popper.children[0];
  titleDiv.textContent = "Vintage Bonk! Atomic Punch";
  anchor.setAttribute("href", "/classifieds?itemName=Bonk!%20Atomic%20Punch&quality=3");

  addGladiatorButton();
  await flush();

  assert.equal(document.querySelectorAll(".tf2te-gladiator-tf-button").length, 1);
  assert.equal(getGladiatorButton().href, "https://gladiator.tf/sales?item=Vintage+Bonk%21+Atomic+Punch");
});

test("the observer inserts a button for a Classifieds anchor added later (tooltip shown after initial page load)", async () => {
  installGlobals();
  global.document = makeDocument([]);
  addGladiatorButton();
  await flush();

  const { popper } = buildTooltip({ itemName: "Rocket Launcher", qualityId: 6, titleText: "Rocket Launcher" });
  document.body.appendChild(popper);

  FakeMutationObserver.instances[0].cb([{ addedNodes: [popper] }]);
  await flush();

  assert.equal(getGladiatorButton()?.textContent, "gladiator.tf");
});

test("addGladiatorButton sets up a subtree MutationObserver on document.body", () => {
  installGlobals();
  global.document = makeDocument([]);

  addGladiatorButton();

  assert.equal(FakeMutationObserver.instances.length, 1);
  assert.equal(FakeMutationObserver.instances[0].target, document.body);
  assert.deepEqual(FakeMutationObserver.instances[0].opts, { childList: true, subtree: true });
});
