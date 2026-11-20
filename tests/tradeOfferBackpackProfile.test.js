import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

// backpackProfile.js is a pages/*.js file - run shared.js's real source
// then this page's real source in the same sandbox - see
// tests/tradeOfferShared.test.js's own doc comment for the full rationale.
//
// Unlike every other pages/*.js file in this batch, backpackProfile.js is
// written entirely against jQuery (`$`, backpack.tf's own runtime dependency -
// DEPS.$ is just window.jQuery, see shared.js) rather than plain DOM APIs.
// There is no jQuery available in Node, and pulling in a real jQuery build
// would be a new npm dependency (against the repo's own zero-dependency
// rule) - so this file's own tests instead run against a small hand-written
// jQuery-alike ("Q"below) that implements only the exact surface this one
// page script actually calls ($(selector), .find/.filter/.not/.append/
// .appendTo/.each/.hide/.on/.trigger/.text/.attr/.closest/.val/.map/.get/
// .hasClass, plus a minimal CSS selector engine covering tag/.class/#id/
// [attr]/[attr="x"]/[attr*="x"]/:visible/:not(.x)/:first). It is NOT a
// general-purpose jQuery replacement - selectors/methods this page doesn't
// use are simply not implemented.
const sharedSrc = readFileSync(new URL("../steamcommunity.com/tradeOffer/shared.js", import.meta.url), "utf8");
const pageSrc = readFileSync(new URL("../steamcommunity.com/tradeOffer/pages/backpackProfile.js", import.meta.url), "utf8");

// --- Fake DOM --------------------------------------------------------------

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toLowerCase();
    this.id = "";
    this.style = { display: "" };
    this.dataset = {};
    this.children = [];
    this.parentElement = null;
    this.value = "";
    this._attrs = {};
    this._textContent = "";
    this._handlers = {};
    this._triggered = [];
    this.classList = {
      _set: new Set(),
      add: (...names) => names.forEach((n) => this.classList._set.add(n)),
      contains: (n) => this.classList._set.has(n),
      remove: (...names) => names.forEach((n) => this.classList._set.delete(n)),
    };
  }
  get textContent() { return this._textContent; }
  set textContent(v) { this._textContent = v; }
  appendChild(child) {
    if (child.parentElement) {
      const i = child.parentElement.children.indexOf(child);
      if (i !== -1) child.parentElement.children.splice(i, 1);
    }
    child.parentElement = this;
    this.children.push(child);
    return child;
  }
}

function el(tag, { id, classes = [], dataset = {}, display, value } = {}) {
  const e = new FakeElement(tag);
  if (id) e.id = id;
  classes.forEach((c) => e.classList.add(c));
  Object.assign(e.dataset, dataset);
  if (display !== undefined) e.style.display = display;
  if (value !== undefined) e.value = value;
  return e;
}

// --- Minimal jQuery-alike ("Q") ---------------------------------------------

function getAttrValue(node, name) {
  if (name.startsWith("data-")) return node.dataset ? node.dataset[name.slice(5)] : undefined;
  return node._attrs ? node._attrs[name] : undefined;
}

function isVisible(node) {
  return node.style ? node.style.display !== "none" : true;
}

const PART_RE = /[a-zA-Z*][\w-]*|\.[\w-]+|#[\w-]+|\[[^\]]+\]|:[a-zA-Z-]+(?:\([^)]*\))?/g;

function parseCompound(token) {
  const parsed = { tag: null, id: null, classes: [], attrs: [], pseudos: [] };
  const matches = token.match(PART_RE) || [];
  for (const m of matches) {
    if (m[0] === ".") parsed.classes.push(m.slice(1));
    else if (m[0] === "#") parsed.id = m.slice(1);
    else if (m[0] === "[") {
      const inner = m.slice(1, -1);
      const eqMatch = inner.match(/^([\w-]+)(\*?)=(?:"([^"]*)"|'([^']*)'|([^\]]*))$/);
      if (eqMatch) {
        parsed.attrs.push({ name: eqMatch[1], op: eqMatch[2] === "*" ? "contains" : "exact", value: eqMatch[3] ?? eqMatch[4] ?? eqMatch[5] });
      } else {
        parsed.attrs.push({ name: inner, op: "exists" });
      }
    } else if (m[0] === ":") {
      const pm = m.match(/^:([a-zA-Z-]+)(?:\((.*)\))?$/);
      parsed.pseudos.push({ name: pm[1], arg: pm[2] });
    } else {
      parsed.tag = m.toLowerCase();
    }
  }
  return parsed;
}

function matchesCompound(node, parsed) {
  if (parsed.tag && parsed.tag !== "*" && node.tagName !== parsed.tag) return false;
  if (parsed.id && node.id !== parsed.id) return false;
  for (const c of parsed.classes) {
    if (!node.classList || !node.classList.contains(c)) return false;
  }
  for (const attr of parsed.attrs) {
    const value = getAttrValue(node, attr.name);
    if (attr.op === "exists") {
      if (value === undefined || value === null) return false;
    } else if (attr.op === "exact") {
      if (String(value) !== attr.value) return false;
    } else if (attr.op === "contains") {
      if (value === undefined || value === null || !String(value).includes(attr.value)) return false;
    }
  }
  for (const p of parsed.pseudos) {
    if (p.name === "visible") {
      if (!isVisible(node)) return false;
    } else if (p.name === "not") {
      const innerParsed = parseCompound(p.arg);
      if (matchesCompound(node, innerParsed)) return false;
    }
    // :first is handled by the caller (selectAll/find), not per-node here.
  }
  return true;
}

function collectDescendants(root, parsed, out, seen) {
  for (const child of root.children || []) {
    if (matchesCompound(child, parsed) && !seen.has(child)) {
      seen.add(child);
      out.push(child);
    }
    collectDescendants(child, parsed, out, seen);
  }
}

// Splits a compound-selector chain on whitespace (the descendant combinator)
// WITHOUT splitting whitespace that's inside an attribute selector's [...]
// brackets (e.g. '.item[data-name="Mann Co. Supply Crate Key"]:first' must
// stay one token, not four) - a naive `.split(/\s+/)` breaks on exactly this
// selector, used for real by this page's own $crateKey lookup.
function splitOutsideBrackets(str) {
  const tokens = [];
  let current = "";
  let depth = 0;
  for (const ch of str) {
    if (ch === "[") depth++;
    if (ch === "]") depth = Math.max(0, depth - 1);
    if (/\s/.test(ch) && depth === 0) {
      if (current) tokens.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

function selectAll(roots, selectorStr) {
  const groups = selectorStr.split(",").map((s) => s.trim());
  const seenOverall = new Set();
  const result = [];
  for (const group of groups) {
    const tokens = splitOutsideBrackets(group);
    let currentRoots = roots;
    for (let i = 0; i < tokens.length; i++) {
      const parsed = parseCompound(tokens[i]);
      const matches = [];
      const seen = new Set();
      for (const root of currentRoots) collectDescendants(root, parsed, matches, seen);
      currentRoots = parsed.pseudos.some((p) => p.name === "first") ? matches.slice(0, 1) : matches;
    }
    for (const m of currentRoots) {
      if (!seenOverall.has(m)) {
        seenOverall.add(m);
        result.push(m);
      }
    }
  }
  return result;
}

class Q {
  constructor(elements) {
    this.elements = elements;
    elements.forEach((e, i) => { this[i] = e; });
  }
  get length() { return this.elements.length; }
  find(selector) {
    return new Q(selectAll(this.elements, selector));
  }
  filter(selector) {
    if (typeof selector === "function") {
      return new Q(this.elements.filter((e, i) => selector.call(e, i, e)));
    }
    const groups = selector.split(",").map((s) => parseCompound(s.trim()));
    return new Q(this.elements.filter((e) => groups.some((g) => matchesCompound(e, g))));
  }
  not(other) {
    const excluded = new Set(other instanceof Q ? other.elements : [other]);
    return new Q(this.elements.filter((e) => !excluded.has(e)));
  }
  append(x) {
    const items = x instanceof Q ? x.elements : [x];
    this.elements.forEach((e) => items.forEach((i) => e.appendChild(i)));
    return this;
  }
  appendTo(target) {
    const targetEl = (target instanceof Q ? target.elements[0] : target);
    this.elements.forEach((e) => targetEl.appendChild(e));
    return this;
  }
  each(fn) {
    this.elements.forEach((e, i) => fn.call(e, i, e));
    return this;
  }
  hide() {
    this.elements.forEach((e) => { e.style.display = "none"; });
    return this;
  }
  on(type, handler) {
    this.elements.forEach((e) => {
      e._handlers = e._handlers || {};
      (e._handlers[type] ||= []).push(handler);
    });
    return this;
  }
  trigger(type) {
    this.elements.forEach((e) => {
      e._triggered = e._triggered || [];
      e._triggered.push(type);
      e._handlers = e._handlers || {};
      (e._handlers[type] || []).forEach((h) => h.call(e, { type }));
    });
    return this;
  }
  text(val) {
    if (val === undefined) return this.elements[0] ? this.elements[0].textContent : undefined;
    this.elements.forEach((e) => { e.textContent = val; });
    return this;
  }
  attr(nameOrObj, val) {
    if (typeof nameOrObj === "object") {
      this.elements.forEach((e) => { Object.entries(nameOrObj).forEach(([k, v]) => { e._attrs[k] = v; }); });
    } else if (val !== undefined) {
      this.elements.forEach((e) => { e._attrs[nameOrObj] = val; });
    } else {
      return this.elements[0] ? this.elements[0]._attrs[nameOrObj] : undefined;
    }
    return this;
  }
  hasClass(name) {
    return this.elements[0] ? this.elements[0].classList.contains(name) : false;
  }
  closest(selector) {
    const parsed = parseCompound(selector);
    let node = this.elements[0] ? this.elements[0].parentElement : null;
    while (node) {
      if (matchesCompound(node, parsed)) return new Q([node]);
      node = node.parentElement;
    }
    return new Q([]);
  }
  val(newVal) {
    if (newVal === undefined) return this.elements[0] ? this.elements[0].value : undefined;
    this.elements.forEach((e) => { e.value = newVal; });
    return this;
  }
  map(fn) {
    const out = [];
    this.elements.forEach((e, i) => { out.push(fn.call(e, i, e)); });
    return { get: () => out };
  }
}

// `fakeDocumentObj` is the sandbox's own global `document` (a plain object,
// not part of the FakeElement tree at all - see FakeElement/`el()` above) -
// the real page code's own `$(document)` call needs to resolve to THAT exact
// object by reference (so `.on('keypress', ...)` attaches somewhere the test
// can later find it via sandbox.document._handlers), while every *selector*
// string still searches the separate FakeElement tree rooted at `documentRoot`.
function make$(documentRoot, fakeDocumentObj) {
  function $(arg) {
    if (arg === fakeDocumentObj) return new Q([fakeDocumentObj]);
    if (arg === documentRoot) return new Q([documentRoot]);
    if (typeof arg === "string" && arg.trim().startsWith("<")) {
      const tagMatch = arg.match(/^<(\w+)/);
      const classMatch = arg.match(/class="([^"]*)"/);
      const styleMatch = arg.match(/style="([^"]*)"/);
      const newEl = new FakeElement(tagMatch[1]);
      if (classMatch) classMatch[1].split(/\s+/).forEach((c) => newEl.classList.add(c));
      if (styleMatch) {
        styleMatch[1].split(";").forEach((decl) => {
          const [k, v] = decl.split(":").map((s) => s && s.trim());
          if (k === "display" && v) newEl.style.display = v;
        });
      }
      return new Q([newEl]);
    }
    if (typeof arg === "string") return new Q(selectAll([documentRoot], arg));
    if (arg instanceof FakeElement) return new Q([arg]);
    return new Q([]);
  }
  return $;
}

// --- Sandbox wiring ----------------------------------------------------

function loadBackpackProfilePage({ backpackEl, getStoredValue } = {}) {
  const documentRoot = backpackEl ? findRoot(backpackEl) : new FakeElement("html");

  const fakeDocument = {
    getElementById: (id) => (selectAll([documentRoot], `#${id}`)[0] || null),
    createElement: (tag) => new FakeElement(tag),
    body: { appendChild: () => {}, removeChild: () => {}, execCommand: () => {} },
    execCommand: () => {},
    addEventListener: () => {},
    dispatchEvent: () => true,
  };

  const $ = make$(documentRoot, fakeDocument);

  const localStorageStore = {};
  if (getStoredValue !== undefined) localStorageStore["tf2te.getInventory.key_price"] = getStoredValue;
  const localStorage = {
    getItem: (k) => (k in localStorageStore ? localStorageStore[k] : null),
    setItem: (k, v) => { localStorageStore[k] = String(v); },
    removeItem: (k) => { delete localStorageStore[k]; },
    key: (i) => Object.keys(localStorageStore)[i],
    get length() { return Object.keys(localStorageStore).length; },
  };

  const windowObj = {
    jQuery: $,
    location: { search: "" },
    __tf2teUnusualEffectsMap__: {},
    CDelayedAJAXData: class { RunWhenAJAXReady() {} },
  };
  windowObj.window = windowObj;
  windowObj.MutationObserver = FakeMutationObserver;

  const sandbox = {
    window: windowObj,
    document: fakeDocument,
    localStorage,
    console,
    MutationObserver: FakeMutationObserver,
    setTimeout: (fn) => { fn(); return 0; },
    clearTimeout: () => {},
    CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; Object.assign(this, init); } },
  };
  vm.createContext(sandbox);
  vm.runInContext(sharedSrc, sandbox);
  vm.runInContext(pageSrc, sandbox);

  const entry = sandbox.window.__tf2te__.scripts.find((s) => s.includes.some((p) => p.source.includes("backpack")));
  return { sandbox, entry, DEPS: sandbox.window.__tf2te__.DEPS, $, documentRoot };
}

function findRoot(node) {
  let n = node;
  while (n.parentElement) n = n.parentElement;
  return n;
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
  disconnect() { this.disconnected = true; }
}
FakeMutationObserver.instances = [];

// Builds the full fake page tree fn() expects: #backpack containing some
// li.item elements, a .refined-value display, and an #inventory-sort-menu.
function buildPage({ items = [], refinedText = "0", cmp } = {}) {
  FakeMutationObserver.instances = [];
  const root = new FakeElement("html");
  const backpackEl = el("div", { id: "backpack" });
  root.appendChild(backpackEl);
  items.forEach((item) => backpackEl.appendChild(item));

  const smallEl = el("small");
  smallEl.textContent = "refined";
  const liEl = el("li");
  liEl.appendChild(smallEl);
  const refinedEl = el("span", { classes: ["refined-value"] });
  refinedEl.textContent = refinedText;
  liEl.appendChild(refinedEl);
  root.appendChild(liEl);

  const sortMenuUl = el("ul", { classes: ["dropdown-menu"] });
  ["bpslot", "price", "market"].forEach((key) => {
    sortMenuUl.appendChild(el("li", { dataset: { value: key } }));
  });
  const sortMenuEl = el("div", { id: "inventory-sort-menu" });
  sortMenuEl.appendChild(sortMenuUl);
  root.appendChild(sortMenuEl);

  let cmpFromEl = null;
  let cmpToEl = null;
  if (cmp) {
    cmpFromEl = el("select", { id: "inventory-cmp-from", value: String(cmp.from) });
    if (cmp.disabled) cmpFromEl.classList.add("disabled");
    cmp.options.forEach((v) => cmpFromEl.appendChild(el("option", { value: String(v) })));
    cmpToEl = el("select", { id: "inventory-cmp-to", value: String(cmp.to) });
    root.appendChild(cmpFromEl);
    root.appendChild(cmpToEl);
  }

  return { root, backpackEl, refinedEl, sortMenuUl, cmpFromEl, cmpToEl };
}

// `selected` mirrors backpack.tf's own real selection convention that
// page.get.$selected (`li.item:visible:not(.unselected)`) relies on: EVERY
// item counts as selected by default, and clicking one toggles it OFF by
// adding an ".unselected" class - there's no separate "on" class at all, so
// `selected: false` here adds ".unselected", not `selected: true` adding
// something.
function makeItem({ id, defindex, priceKeys, priceMetal, listingPrice, selected = true, visible = true, isCrateKey = false }) {
  const dataset = { id: String(id) };
  if (priceKeys !== undefined || priceMetal !== undefined) {
    const parts = [];
    if (priceKeys !== undefined) parts.push(`${priceKeys} keys`);
    else if (priceMetal !== undefined) parts.push(`${priceMetal} ref`);
    dataset.p_bptf = parts.join(", ");
  }
  if (listingPrice) dataset.listing_price = listingPrice;
  if (isCrateKey) dataset.name = "Mann Co. Supply Crate Key";
  const classes = ["item"];
  if (!selected) classes.push("unselected");
  const itemEl = el("li", { classes, dataset, display: visible ? "" : "none" });
  return itemEl;
}

// --- registration / styles ------------------------------------------------

test("registers exactly one script matching backpack.tf's /id/ and /profiles/ inventory pages", () => {
  const { entry } = loadBackpackProfilePage();
  assert.ok(entry);
  assert.match("https://backpack.tf/id/someuser/", entry.includes[0]);
  assert.match("https://backpack.tf/profiles/76561198000000000", entry.includes[0]);
});

// --- getKeyValue (via the observer -> onBackpackLoad path) -----------------

test("onBackpackLoad computes and caches the key value from an item priced in keys, using p_bptf_all's ref total for precision", () => {
  const keyedItem = makeItem({ id: 1, priceKeys: 2 });
  keyedItem.dataset.p_bptf_all = "56.00 ref"; // getRefinedValue reads this
  const { root, backpackEl } = buildPage({ items: [keyedItem] });
  const { entry, DEPS } = loadBackpackProfilePage({ backpackEl });

  entry.fn(DEPS);

  // Fire the "backpack has loaded" mutation: a childList mutation whose
  // target is an .item-list element.
  const observer = FakeMutationObserver.instances.find((o) => o.target === backpackEl);
  observer.cb([{ addedNodes: [1], target: { className: "item-list" } }]);

  // 56 ref / 2 keys = 28 ref per key.
  assert.equal(DEPS.getStored("getInventory.key_price"), "28");
});

test("onBackpackLoad falls back to a Mann Co. Supply Crate Key's own refined value when no item is priced in keys", () => {
  const crateKey = makeItem({ id: 2, isCrateKey: true });
  crateKey.dataset.price = "22.5"; // raw refined value used as the fallback
  const { root, backpackEl } = buildPage({ items: [crateKey] });
  const { entry, DEPS } = loadBackpackProfilePage({ backpackEl });

  entry.fn(DEPS);
  const observer = FakeMutationObserver.instances.find((o) => o.target === backpackEl);
  observer.cb([{ addedNodes: [1], target: { className: "item-list" } }]);

  assert.equal(DEPS.getStored("getInventory.key_price"), "22.5");
});

test("a mutation whose target isn't an .item-list element does not trigger onBackpackLoad", () => {
  const keyedItem = makeItem({ id: 1, priceKeys: 2 });
  keyedItem.dataset.p_bptf_all = "56.00 ref";
  const { backpackEl } = buildPage({ items: [keyedItem] });
  const { entry, DEPS } = loadBackpackProfilePage({ backpackEl });

  entry.fn(DEPS);
  const observer = FakeMutationObserver.instances.find((o) => o.target === backpackEl);
  observer.cb([{ addedNodes: [1], target: { className: "something-else" } }]);

  assert.equal(DEPS.getStored("getInventory.key_price"), null);
});

// --- select= URL param -> selectItemsById/filterItems -----------------

test("a ?select=id,id URL param moves every non-matching item onto a hidden temp page, leaving matching items in place", () => {
  const keep1 = makeItem({ id: 10, priceKeys: 1 });
  const keep2 = makeItem({ id: 20, priceKeys: 1 });
  const dropped = makeItem({ id: 30, priceKeys: 1 });
  const { root, backpackEl } = buildPage({ items: [keep1, keep2, dropped] });
  const { entry, DEPS, sandbox } = loadBackpackProfilePage({ backpackEl });
  sandbox.window.location.search = "?select=10,20";

  entry.fn(DEPS);
  const observer = FakeMutationObserver.instances.find((o) => o.target === backpackEl);
  observer.cb([{ addedNodes: [1], target: { className: "item-list" } }]);

  assert.equal(keep1.parentElement, backpackEl);
  assert.equal(keep2.parentElement, backpackEl);
  assert.notEqual(dropped.parentElement, backpackEl);
  assert.equal(dropped.parentElement.classList.contains("temp-page"), true);
});

test("selectItemsById is skipped entirely when the select param is absent", () => {
  const item1 = makeItem({ id: 10, priceKeys: 1 });
  const { root, backpackEl } = buildPage({ items: [item1] });
  const { entry, DEPS } = loadBackpackProfilePage({ backpackEl });

  entry.fn(DEPS);
  const observer = FakeMutationObserver.instances.find((o) => o.target === backpackEl);
  assert.doesNotThrow(() => observer.cb([{ addedNodes: [1], target: { className: "item-list" } }]));
  assert.equal(item1.parentElement, backpackEl);
});

// --- keypress hotkeys --------------------------------------------------

test("pressing 'P' copies the selected items' ids to the clipboard, comma-joined", () => {
  const selected1 = makeItem({ id: 5, priceKeys: 1, selected: true });
  const selected2 = makeItem({ id: 6, priceKeys: 1, selected: true });
  const unselected = makeItem({ id: 7, priceKeys: 1, selected: false });
  const { root, backpackEl } = buildPage({ items: [selected1, selected2, unselected] });
  const { entry, DEPS, sandbox } = loadBackpackProfilePage({ backpackEl });

  let copied = null;
  DEPS.Utils.copyToClipboard = (str) => { copied = str; };

  entry.fn(DEPS);
  const observer = FakeMutationObserver.instances.find((o) => o.target === backpackEl);
  observer.cb([{ addedNodes: [1], target: { className: "item-list" } }]);

  // page.$document.on('keypress', ...) attaches to the sandbox's own real
  // `document` global (via $(document)), not the FakeElement tree - see
  // make$'s own fakeDocumentObj identity check above.
  const handlers = sandbox.document._handlers.keypress || [];
  handlers.forEach((h) => h({ target: { nodeName: "BODY", type: "" }, keyCode: 112 })); // 'P'

  assert.equal(copied, "5,6");
});

test("pressing '2' triggers a click on the sort menu's price <li>, and '1'/'3' target bpslot/market respectively", () => {
  const item1 = makeItem({ id: 1, priceKeys: 1 });
  const { root, backpackEl, sortMenuUl } = buildPage({ items: [item1] });
  const { entry, DEPS, sandbox } = loadBackpackProfilePage({ backpackEl });

  entry.fn(DEPS);
  const observer = FakeMutationObserver.instances.find((o) => o.target === backpackEl);
  observer.cb([{ addedNodes: [1], target: { className: "item-list" } }]);

  const handlers = sandbox.document._handlers.keypress || [];
  const priceLi = sortMenuUl.children.find((li) => li.dataset.value === "price");
  const bpslotLi = sortMenuUl.children.find((li) => li.dataset.value === "bpslot");
  const marketLi = sortMenuUl.children.find((li) => li.dataset.value === "market");

  handlers.forEach((h) => h({ target: { nodeName: "BODY", type: "" }, keyCode: 50 })); // '2'
  assert.equal(priceLi._triggered.includes("click"), true);
  assert.equal(bpslotLi._triggered.includes("click"), false);

  handlers.forEach((h) => h({ target: { nodeName: "BODY", type: "" }, keyCode: 49 })); // '1'
  assert.equal(bpslotLi._triggered.includes("click"), true);

  handlers.forEach((h) => h({ target: { nodeName: "BODY", type: "" }, keyCode: 51 })); // '3'
  assert.equal(marketLi._triggered.includes("click"), true);
});

test("hotkeys are ignored while focused in a text input, per Utils.execHotKey's own text-field guard", () => {
  const item1 = makeItem({ id: 1, priceKeys: 1, selected: true });
  const { root, backpackEl } = buildPage({ items: [item1] });
  const { entry, DEPS, sandbox } = loadBackpackProfilePage({ backpackEl });

  let copied = null;
  DEPS.Utils.copyToClipboard = (str) => { copied = str; };

  entry.fn(DEPS);
  const observer = FakeMutationObserver.instances.find((o) => o.target === backpackEl);
  observer.cb([{ addedNodes: [1], target: { className: "item-list" } }]);

  const handlers = sandbox.document._handlers.keypress || [];
  handlers.forEach((h) => h({ target: { nodeName: "INPUT", type: "text" }, keyCode: 112 }));

  assert.equal(copied, null);
});

// --- compare() (the 'W'/'S' hotkeys - day-comparison stepper) --------------

test("pressing 'W' (compare up) moves the endpoint FARTHER from the new value, picking the smallest option greater than 'to'", () => {
  const item1 = makeItem({ id: 1, priceKeys: 1 });
  const { backpackEl, cmpFromEl, cmpToEl } = buildPage({
    items: [item1],
    cmp: { from: 2, to: 4, options: [1, 2, 3, 4, 5] },
  });
  const { entry, DEPS, sandbox } = loadBackpackProfilePage({ backpackEl });

  entry.fn(DEPS);
  const observer = FakeMutationObserver.instances.find((o) => o.target === backpackEl);
  observer.cb([{ addedNodes: [1], target: { className: "item-list" } }]);

  const handlers = sandbox.document._handlers.keypress || [];
  handlers.forEach((h) => h({ target: { nodeName: "BODY", type: "" }, keyCode: 119 })); // 'W'

  // Candidates strictly above `to` (4), excluding from/to themselves: just 5.
  // |from(2) - 5| = 3, |to(4) - 5| = 1 - `to` is closer, so `from` (the
  // farther endpoint) is the one that gets replaced by the new value.
  assert.equal(cmpFromEl.value, 5);
  assert.equal(cmpToEl.value, "4"); // untouched
  assert.equal(cmpFromEl._triggered.includes("change"), true);
});

test("pressing 'S' (compare down) keeps the endpoint closest to the new value and moves the other one (a tie keeps 'from')", () => {
  const item1 = makeItem({ id: 1, priceKeys: 1 });
  const { backpackEl, cmpFromEl, cmpToEl } = buildPage({
    items: [item1],
    cmp: { from: 2, to: 4, options: [1, 2, 3, 4, 5] },
  });
  const { entry, DEPS, sandbox } = loadBackpackProfilePage({ backpackEl });

  entry.fn(DEPS);
  const observer = FakeMutationObserver.instances.find((o) => o.target === backpackEl);
  observer.cb([{ addedNodes: [1], target: { className: "item-list" } }]);

  const handlers = sandbox.document._handlers.keypress || [];
  handlers.forEach((h) => h({ target: { nodeName: "BODY", type: "" }, keyCode: 115 })); // 'S'

  // Candidates strictly below `to` (4), excluding from/to: 1 and 3 - the
  // largest (3) is picked. |from(2)-3|=1 == |to(4)-3|=1 - tie goes to
  // `from` per the closest === from check running first, so `to` updates.
  assert.equal(cmpToEl.value, 3);
  assert.equal(cmpFromEl.value, "2"); // untouched
});

test("compare() is a no-op when the from-selector is missing or disabled", () => {
  const item1 = makeItem({ id: 1, priceKeys: 1 });
  const { backpackEl, cmpFromEl, cmpToEl } = buildPage({
    items: [item1],
    cmp: { from: 2, to: 4, options: [1, 2, 3, 4, 5], disabled: true },
  });
  const { entry, DEPS, sandbox } = loadBackpackProfilePage({ backpackEl });

  entry.fn(DEPS);
  const observer = FakeMutationObserver.instances.find((o) => o.target === backpackEl);
  observer.cb([{ addedNodes: [1], target: { className: "item-list" } }]);

  const handlers = sandbox.document._handlers.keypress || [];
  assert.doesNotThrow(() => handlers.forEach((h) => h({ target: { nodeName: "BODY", type: "" }, keyCode: 119 })));

  assert.equal(cmpFromEl.value, "2");
  assert.equal(cmpToEl.value, "4");
});

// --- refined-value -> keys conversion -----------------------------------

test("without a cached key value, the label stays 'refined' so the unconverted ref total is never shown as keys", () => {
  const { backpackEl, root, refinedEl } = buildPage({ items: [], refinedText: "100" });
  const { entry, DEPS } = loadBackpackProfilePage({ backpackEl }); // no getStoredValue

  entry.fn(DEPS);

  const smallEl = selectAll([root], "small")[0];
  assert.equal(refinedEl.textContent, "100");
  assert.equal(smallEl.textContent, "refined");
});

test("the 'refined' label is relabeled to 'keys' immediately when fn() runs", () => {
  const { backpackEl, root } = buildPage({ items: [] });
  const { entry, DEPS } = loadBackpackProfilePage({ backpackEl, getStoredValue: "10" });

  entry.fn(DEPS);

  const smallEl = selectAll([root], "small")[0];
  assert.equal(smallEl.textContent, "keys");
});

test("with a cached key value already in storage, the ref total is converted to keys immediately on load", () => {
  const { backpackEl, refinedEl } = buildPage({ items: [], refinedText: "100" });
  const { entry, DEPS } = loadBackpackProfilePage({ backpackEl, getStoredValue: "10" });

  entry.fn(DEPS);

  // 100 ref / 10 ref-per-key = 10 keys.
  assert.equal(refinedEl.textContent, 10);
});

test("without a cached key value, the ref display is left untouched until onBackpackLoad establishes one", () => {
  const { backpackEl, refinedEl } = buildPage({ items: [], refinedText: "100" });
  const { entry, DEPS } = loadBackpackProfilePage({ backpackEl }); // no getStoredValue

  entry.fn(DEPS);

  assert.equal(refinedEl.textContent, "100"); // untouched - refinedValueChanged() early-returned
});
