import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

// steamcommunity.com/tradeOffer/pages/tradeSlotOverrides.js - see
// tests/tradeOfferShared.test.js's own header for the full explanation of
// why/how this whole folder is tested via node:vm instead of jsdom, and
// tests/tradeOfferPage.test.js's own header for why shared.js must run
// first (it builds window.__tf2te__, which this file's own top-level
// `window.__tf2te__.installTradeSlotOverrides = function (page, TRADE_STATUS) {...}`
// assignment requires to already exist).
//
// Unlike pages/tradeoffer.js, installTradeSlotOverrides is a function this
// file attaches directly onto window - not something that only runs as a
// side effect of a registered script's own fn(). So tests here call it
// directly with a hand-built `page`/TRADE_STATUS, then invoke the specific
// WINDOW.UpdateSlots/PutItemInSlot/EnsureSufficientTradeSlots/
// GTradeStateManager.RemoveItemsFromTrade functions it installs, one at a
// time - no button clicks or DOM event wiring needed at all, unlike
// tests/tradeOfferPage.test.js's own harness.
const sharedSrc = readFileSync(new URL("../steamcommunity.com/tradeOffer/shared.js", import.meta.url), "utf8");
const overridesSrc = readFileSync(new URL("../steamcommunity.com/tradeOffer/pages/tradeSlotOverrides.js", import.meta.url), "utf8");

// Cross-realm plain-object/array comparisons - see tests/tradeOfferShared.test.js's own note.
function toPlain(value) {
  return JSON.parse(JSON.stringify(value));
}

// --- Minimal fake DOM --------------------------------------------------

function parseSimpleSelector(selector) {
  const m = selector.trim().match(/^([a-zA-Z0-9]*)((?:\.[\w-]+)*)$/);
  if (!m) return null;
  return { tag: m[1] ? m[1].toUpperCase() : null, classes: (m[2].match(/\.[\w-]+/g) || []).map((c) => c.slice(1)) };
}
function elementMatchesSelector(el, parsed) {
  if (!el || !el.tagName) return false;
  if (parsed.tag && el.tagName !== parsed.tag) return false;
  for (const c of parsed.classes) {
    if (!el.classList || !el.classList.contains(c)) return false;
  }
  return true;
}
function queryAll(root, selector) {
  const results = [];
  // #id lookups - EnsureSufficientTradeSlots' own compacting branch does
  // $slots.find('#' + prefix + i), unlike every other selector this
  // code uses elsewhere (all plain tag/class).
  if (selector.startsWith("#")) {
    const id = selector.slice(1);
    (function walk(el) {
      for (const child of el.children || []) {
        if (child.id === id) results.push(child);
        walk(child);
      }
    })(root);
    return results;
  }
  const parsed = parseSimpleSelector(selector);
  if (!parsed) return results;
  (function walk(el) {
    for (const child of el.children || []) {
      if (elementMatchesSelector(child, parsed)) results.push(child);
      walk(child);
    }
  })(root);
  return results;
}

class FakeElement {
  constructor(tagName) {
    this.tagName = (tagName || "div").toUpperCase();
    this.nodeType = 1; // ELEMENT_NODE - see Node.DOCUMENT_FRAGMENT_NODE (11) comparison in PutItemInSlot
    this.style = {};
    this.children = [];
    this.parentNode = null;
    this._attrs = {};
    this._listeners = {};
    this.classList = {
      _set: new Set(),
      add: (...names) => names.forEach((n) => this.classList._set.add(n)),
      contains: (n) => this.classList._set.has(n),
    };
  }
  get id() {
    return this._attrs.id || "";
  }
  set id(v) {
    this._attrs.id = String(v);
  }
  get childElementCount() {
    return this.children.length;
  }
  setAttribute(name, value) {
    this._attrs[name] = String(value);
  }
  getAttribute(name) {
    return name in this._attrs ? this._attrs[name] : null;
  }
  appendChild(child) {
    // Real DOM (and this file's own EnsureSufficientTradeSlots) appends a
    // DocumentFragment by moving ITS children in, not by nesting the
    // fragment itself as one child.
    if (child.nodeType === 11) {
      child.children.forEach((c) => {
        c.parentNode = this;
        this.children.push(c);
      });
      child.children = [];
      return child;
    }
    this.children.push(child);
    child.parentNode = this;
    return child;
  }
  querySelector(selector) {
    return queryAll(this, selector)[0] || null;
  }
  querySelectorAll(selector) {
    return queryAll(this, selector);
  }
  addEventListener(type, cb) {
    (this._listeners[type] ||= []).push(cb);
  }
  removeEventListener(type, cb) {
    this._listeners[type] = (this._listeners[type] || []).filter((existing) => existing !== cb);
  }
  dispatchEvent(evt) {
    (this._listeners[evt.type] || []).slice().forEach((cb) => cb(evt));
    return true;
  }
  // Prototype.js's own Element#remove (what this code actually
  // runs against on the real page, per WINDOW.EnsureSufficientTradeSlots'
  // own `$parent.append(element.remove())` chaining) returns the removed
  // element itself, unlike native DOM's Element.prototype.remove().
  remove() {
    if (this.parentNode) {
      this.parentNode.children = this.parentNode.children.filter((c) => c !== this);
      this.parentNode = null;
    }
    return this;
  }
}

class FakeJQuery {
  constructor(elements) {
    this._elements = elements;
    elements.forEach((el, i) => {
      this[i] = el;
    });
    this.length = elements.length;
  }
  find(selector) {
    const found = [];
    this._elements.forEach((el) => found.push(...queryAll(el, selector)));
    return new FakeJQuery(found);
  }
  parent() {
    return new FakeJQuery([...new Set(this._elements.map((el) => el.parentNode).filter(Boolean))]);
  }
  append(x) {
    this._elements.forEach((el) => el.appendChild(x));
    return this;
  }
}

function jq(elements) {
  return new FakeJQuery(Array.isArray(elements) ? elements : [elements]);
}

// --- Harness -------------------------------------------------------------

function loadOverrides() {
  const elementsById = new Map();
  const fakeDocument = {
    createElement: (tag) => new FakeElement(tag),
    getElementById: (id) => elementsById.get(id) || null,
    createDocumentFragment: () => {
      const frag = new FakeElement("#fragment");
      frag.nodeType = 11;
      return frag;
    },
  };

  const calls = {
    RevertItem: [],
    CleanupSlot: [],
    SetStackableItemInTrade: [],
    HighlightNewlyAddedItem: [],
    UpdateTradeItemStackDisplay: [],
    UpdateCurrencyDisplay: [],
    HandleTradeActionMenu: [],
    CreateSlotElement: [],
    UpdateTradeStatus: [],
    logEvents: [], // { text } pushed via new WINDOW.Element(...).update(text) appended to $('log')
  };

  const logEl = new FakeElement("div");
  logEl.id = "log";
  elementsById.set("log", logEl);

  const windowObj = {
    $: (id) => elementsById.get(id) || null, // Prototype.js-style $(id) - see this file's own header
    BIsInTradeSlot: () => false,
    RevertItem: (item) => calls.RevertItem.push(item),
    CleanupSlot: (el) => calls.CleanupSlot.push(el),
    SetStackableItemInTrade: (item, amount) => calls.SetStackableItemInTrade.push({ item, amount }),
    HighlightNewlyAddedItem: (el) => calls.HighlightNewlyAddedItem.push(el),
    GetTradeItemStack: (user, item) => item.__stack || { amount: 0, fee: 0, element: item.element, version: 0 },
    UpdateTradeItemStackDisplay: (parentItem, stack, amount) => {
      calls.UpdateTradeItemStackDisplay.push({ parentItem, stack, amount });
      stack.amount = amount;
    },
    UpdateCurrencyDisplay: (currency) => calls.UpdateCurrencyDisplay.push(currency),
    CreateSlotElement: (id) => {
      calls.CreateSlotElement.push(id);
      const el = new FakeElement("div");
      el.id = id;
      return el;
    },
    Economy_UseResponsiveLayout: () => false,
    g_bTradeOffer: false,
    g_rgAppContextData: {},
    g_rgnItemsExpiringBeforeEscrow: [0, 0],
    GTradeStateManager: {
      m_bChangesMade: false,
      UpdateTradeStatus: () => calls.UpdateTradeStatus.push(true),
    },
    Element: class Element {
      constructor(tag, attrs) {
        this.tag = tag;
        this.attrs = attrs;
      }
      update(text) {
        calls.logEvents.push(text);
        this.text = text;
        return this;
      }
    },
  };
  windowObj.window = windowObj;

  const UserYou = {
    BAllowedToRecieveItems: () => true,
    BInventoryIsFull: () => false,
  };
  const UserThem = {
    BIsLoadingInventoryData: () => false,
  };

  const sandbox = {
    window: windowObj,
    document: fakeDocument,
    console,
    // Bare (non-WINDOW.-prefixed) globals tradeSlotOverrides.js's own
    // UpdateSlots/PutItemInSlot reference directly - real Steam page
    // globals, not reachable via destructuring since this file's own
    // installTradeSlotOverrides doesn't locally bind them (see this file's
    // own header on why, unlike pages/tradeoffer.js's `const { UserYou,
    // UserThem } = WINDOW;`).
    UserYou,
    UserThem,
    g_dateEscrowEnd: null,
    g_nItemsFromContextWithNoPermissionToReceive: 0,
    g_rgAppContextData: windowObj.g_rgAppContextData,
    g_rgPlayedApps: false,
    Node: { DOCUMENT_FRAGMENT_NODE: 11 },
    HandleTradeActionMenu: (...args) => calls.HandleTradeActionMenu.push(args),
    // Array.prototype.invoke is a Prototype.js extension the real Steam
    // page loads and this code relies on (EnsureSufficientTradeSlots'
    // own `rgElementsToRemove.invoke('remove')`) - vm.createContext gives
    // this sandbox its own separate Array.prototype, so it needs its own
    // copy of the same polyfill Prototype.js would normally provide.
  };
  vm.createContext(sandbox);
  vm.runInContext(sharedSrc, sandbox);
  vm.runInContext("Array.prototype.invoke = function(name) { var args = Array.prototype.slice.call(arguments, 1); return this.map(function(el) { return el[name].apply(el, args); }); };", sandbox);
  vm.runInContext(overridesSrc, sandbox);

  const TRADE_STATUS = {
    version: 0,
    me: { assets: [] },
    them: { assets: [] },
  };

  const yourSlotsEl = new FakeElement("div");
  const theirSlotsEl = new FakeElement("div");
  const page = {
    $yourSlots: jq(yourSlotsEl),
    $theirSlots: jq(theirSlotsEl),
  };

  sandbox.window.__tf2te__.installTradeSlotOverrides(page, TRADE_STATUS);

  return { sandbox, windowObj, page, TRADE_STATUS, elementsById, calls, UserYou, UserThem, logEl };
}

function makeItemEl(rgItem) {
  const el = new FakeElement("div");
  el.classList.add("item");
  el.rgItem = rgItem;
  return el;
}

function makeSlotContainerEl() {
  const slotInner = new FakeElement("div");
  slotInner.classList.add("slot_inner");
  // PutItemInSlot's own "already occupied elsewhere" cleanup path looks up
  // .slot_actionmenu_button via elItem.parentNode.querySelector(...) - i.e.
  // as a DESCENDANT of .slot_inner (elItem's own parent once placed), not a
  // sibling of it - so it's nested here to match. elSlot.querySelector(...)
  // (used everywhere else in this file) still finds it fine either way,
  // since that walks the whole subtree.
  const actionBtn = new FakeElement("div");
  actionBtn.classList.add("slot_actionmenu_button");
  actionBtn.style.display = "none";
  slotInner.appendChild(actionBtn);

  const applogo = new FakeElement("div");
  applogo.classList.add("slot_applogo");
  applogo.style.display = "none";
  const img = new FakeElement("img");
  applogo.appendChild(img);
  const fraudwarning = new FakeElement("div");
  fraudwarning.classList.add("slot_app_fraudwarning");
  fraudwarning.style.display = "none";

  const elSlot = new FakeElement("div");
  elSlot.appendChild(slotInner);
  elSlot.appendChild(applogo);
  elSlot.appendChild(fraudwarning);
  return elSlot;
}

// === PutItemInSlot =======================================================

test("PutItemInSlot moves the item into .slot_inner, shows the app logo, and marks the slot has_item", () => {
  const h = loadOverrides();
  h.windowObj.g_rgAppContextData["440"] = { icon: "https://example.com/440.png" };
  h.windowObj.g_rgPlayedApps = { 440: true }; // played -> no NoPlaytime fraud warning
  const elSlot = makeSlotContainerEl();
  const item = { appid: "440", id: "1" };
  const elItem = makeItemEl(item);

  h.sandbox.window.PutItemInSlot(elItem, elSlot);

  const slotInner = elSlot.querySelector(".slot_inner");
  assert.equal(slotInner.children.includes(elItem), true);
  // PutItemInSlot sets the .src PROPERTY directly (`slotAppLogo.querySelector('img').src = ...`),
  // not via setAttribute.
  const applogoImg = elSlot.querySelector(".slot_applogo").querySelector("img");
  assert.equal(applogoImg.src, "https://example.com/440.png");
  assert.equal(elSlot.querySelector(".slot_applogo").style.display, "");
  assert.equal(elSlot.classList.contains("has_item"), true);
  assert.equal(elSlot.hasItem, true);
});

test("PutItemInSlot hides the app logo and fraud warning entirely for an item whose appid has no g_rgAppContextData entry", () => {
  const h = loadOverrides();
  const elSlot = makeSlotContainerEl();
  const elItem = makeItemEl({ appid: "999", id: "1" });

  h.sandbox.window.PutItemInSlot(elItem, elSlot);

  assert.equal(elSlot.querySelector(".slot_applogo").style.display, "none");
  assert.equal(elSlot.querySelector(".slot_app_fraudwarning").style.display, "none");
});

test("PutItemInSlot pushes a NoPlaytime fraud warning (and shows the fraud badge) for a game the account has never played", () => {
  const h = loadOverrides();
  h.windowObj.g_rgAppContextData["440"] = { icon: "icon.png" };
  h.windowObj.g_rgPlayedApps = {}; // 440 not present -> "never played"
  const elSlot = makeSlotContainerEl();
  const item = { appid: "440", id: "1" };
  const elItem = makeItemEl(item);

  h.sandbox.window.PutItemInSlot(elItem, elSlot);

  assert.deepEqual(toPlain(item.fraudwarnings), ["You've never played the game this item is from."]);
  assert.equal(elSlot.querySelector(".slot_app_fraudwarning").style.display, "");
});

test("PutItemInSlot never pushes a duplicate NoPlaytime warning if one is already present", () => {
  const h = loadOverrides();
  h.windowObj.g_rgAppContextData["440"] = { icon: "icon.png" };
  h.windowObj.g_rgPlayedApps = {};
  const elSlot = makeSlotContainerEl();
  const item = { appid: "440", id: "1", fraudwarnings: ["You've never played the game this item is from."] };
  const elItem = makeItemEl(item);

  h.sandbox.window.PutItemInSlot(elItem, elSlot);

  assert.equal(item.fraudwarnings.length, 1);
});

test("PutItemInSlot hides the fraud badge when the item has no id yet, even with fraud warnings present", () => {
  const h = loadOverrides();
  h.windowObj.g_rgAppContextData["440"] = { icon: "icon.png" };
  h.windowObj.g_rgPlayedApps = { 440: true };
  const elSlot = makeSlotContainerEl();
  const item = { appid: "440", id: null, fraudwarnings: ["something"] };
  const elItem = makeItemEl(item);

  h.sandbox.window.PutItemInSlot(elItem, elSlot);

  assert.equal(elSlot.querySelector(".slot_app_fraudwarning").style.display, "none");
});

test("PutItemInSlot's action menu button click calls HandleTradeActionMenu with UserThem for their item, UserYou otherwise", () => {
  const h = loadOverrides();
  h.windowObj.g_rgAppContextData["440"] = { icon: "icon.png" };
  h.windowObj.g_rgPlayedApps = { 440: true };

  const theirSlot = makeSlotContainerEl();
  const theirItem = { appid: "440", id: "1", is_their_item: true };
  h.sandbox.window.PutItemInSlot(makeItemEl(theirItem), theirSlot);
  theirSlot.querySelector(".slot_actionmenu_button").dispatchEvent({ type: "click" });
  assert.equal(h.calls.HandleTradeActionMenu.length, 1);
  assert.equal(h.calls.HandleTradeActionMenu[0][1], theirItem);
  assert.equal(h.calls.HandleTradeActionMenu[0][2], h.UserThem);

  const yourSlot = makeSlotContainerEl();
  const yourItem = { appid: "440", id: "2", is_their_item: false };
  h.sandbox.window.PutItemInSlot(makeItemEl(yourItem), yourSlot);
  yourSlot.querySelector(".slot_actionmenu_button").dispatchEvent({ type: "click" });
  assert.equal(h.calls.HandleTradeActionMenu[1][2], h.UserYou);
});

test("PutItemInSlot replaces (not stacks) the action menu handler when a reused slot gets a new item", () => {
  const h = loadOverrides();
  h.windowObj.g_rgAppContextData["440"] = { icon: "icon.png" };
  h.windowObj.g_rgPlayedApps = { 440: true };

  const slot = makeSlotContainerEl();
  const firstItem = { appid: "440", id: "1", is_their_item: false };
  const secondItem = { appid: "440", id: "2", is_their_item: false };
  const firstEl = makeItemEl(firstItem);
  h.sandbox.window.PutItemInSlot(firstEl, slot);
  firstEl.remove();
  h.sandbox.window.PutItemInSlot(makeItemEl(secondItem), slot);

  slot.querySelector(".slot_actionmenu_button").dispatchEvent({ type: "click" });

  assert.equal(h.calls.HandleTradeActionMenu.length, 1);
  assert.equal(h.calls.HandleTradeActionMenu[0][1], secondItem);
});

test("PutItemInSlot moves the item out of (and hides the action button in) whatever slot it was previously sitting in", () => {
  const h = loadOverrides();
  h.windowObj.g_rgAppContextData["440"] = { icon: "icon.png" };
  h.windowObj.g_rgPlayedApps = { 440: true };
  const item = { appid: "440", id: "1" };
  const elItem = makeItemEl(item);
  const oldSlot = makeSlotContainerEl();
  oldSlot.querySelector(".slot_inner").appendChild(elItem); // elItem.parentNode = old .slot_inner
  const oldBtn = oldSlot.querySelector(".slot_actionmenu_button");
  oldBtn.style.display = ""; // previously visible

  const newSlot = makeSlotContainerEl();
  h.sandbox.window.PutItemInSlot(elItem, newSlot);

  assert.equal(oldBtn.style.display, "none");
  assert.equal(oldSlot.querySelector(".slot_inner").children.includes(elItem), false);
  assert.equal(newSlot.querySelector(".slot_inner").children.includes(elItem), true);
});

// === EnsureSufficientTradeSlots ==========================================

test("EnsureSufficientTradeSlots creates slots up to the rounded-up-to-4 minimum-8 target when growing from empty", () => {
  const h = loadOverrides();

  h.sandbox.window.EnsureSufficientTradeSlots(true, 0, 0);

  assert.equal(h.page.$yourSlots[0].childElementCount, 8); // max(floor((0+5)/4)*4, 8) = 8
  assert.deepEqual(h.calls.CreateSlotElement, ["your_slot_0", "your_slot_1", "your_slot_2", "your_slot_3", "your_slot_4", "your_slot_5", "your_slot_6", "your_slot_7"]);
});

test("EnsureSufficientTradeSlots only creates the slots still missing when some already exist", () => {
  const h = loadOverrides();
  h.sandbox.window.EnsureSufficientTradeSlots(true, 0, 0); // seeds 8 slots
  h.calls.CreateSlotElement.length = 0;

  h.sandbox.window.EnsureSufficientTradeSlots(true, 5, 0); // desired = max(floor(10/4)*4,8) = 8, still 8 total

  assert.equal(h.calls.CreateSlotElement.length, 0); // already had 8, nothing more needed
});

test("EnsureSufficientTradeSlots uses cSlotsInUse+cCurrencySlotsInUse+1 under responsive layout instead of the round-to-4 formula", () => {
  const h = loadOverrides();
  h.windowObj.Economy_UseResponsiveLayout = () => true;

  h.sandbox.window.EnsureSufficientTradeSlots(true, 3, 1);

  // desired total = (3+1)+1 = 5; item slots = 5 - currency(1) = 4
  assert.equal(h.page.$yourSlots[0].childElementCount, 4);
});

test("EnsureSufficientTradeSlots compacts (removes) excess slot elements when the desired count shrinks", () => {
  const h = loadOverrides();
  h.sandbox.window.EnsureSufficientTradeSlots(true, 20, 0); // grow to a large slot count first
  const before = h.page.$yourSlots[0].childElementCount;
  assert.ok(before > 8);

  h.sandbox.window.EnsureSufficientTradeSlots(true, 0, 0); // shrink back down to 8

  assert.equal(h.page.$yourSlots[0].childElementCount, 8);
});

// === GTradeStateManager.RemoveItemsFromTrade =============================

function makeTradeItem({ appid = "440", contextid = "2", id, is_stackable = false, is_their_item = false, inTradeSlot = false }) {
  const homeBtn = new FakeElement("div");
  homeBtn.classList.add("slot_actionmenu_button");
  homeBtn.show = () => (homeBtn.shown = true);
  const item = { appid, contextid, id, is_stackable, is_their_item, homeElement: { down: () => homeBtn } };
  const el = new FakeElement("div");
  el.rgItem = item;
  el.__inTradeSlot = inTradeSlot;
  el.parentNode = { parentNode: new FakeElement("div") }; // for CleanupSlot(elItem.parentNode.parentNode)
  return { item, el, homeBtn };
}

function loadOverridesForRemoval(itemsInTradeSlot = new Set()) {
  const h = loadOverrides();
  h.windowObj.BIsInTradeSlot = (elItem) => itemsInTradeSlot.has(elItem);
  return h;
}

test("RemoveItemsFromTrade reverts and removes a matching non-stackable asset from TRADE_STATUS.me, and flags changes made", () => {
  const h = loadOverridesForRemoval();
  const { item, el, homeBtn } = makeTradeItem({ id: "1", is_their_item: false });
  h.TRADE_STATUS.me.assets = [{ appid: "440", contextid: "2", assetid: "1" }, { appid: "440", contextid: "2", assetid: "2" }];

  h.sandbox.window.GTradeStateManager.RemoveItemsFromTrade([el]);

  assert.equal(h.calls.RevertItem[0], item);
  assert.equal(homeBtn.shown, true);
  assert.deepEqual(h.TRADE_STATUS.me.assets, [{ appid: "440", contextid: "2", assetid: "2" }]);
  assert.equal(h.windowObj.GTradeStateManager.m_bChangesMade, true);
  assert.equal(h.calls.UpdateTradeStatus.length, 1);
});

test("RemoveItemsFromTrade removes a matching asset from TRADE_STATUS.them for an is_their_item element", () => {
  const h = loadOverridesForRemoval();
  const { el } = makeTradeItem({ id: "5", is_their_item: true });
  h.TRADE_STATUS.them.assets = [{ appid: "440", contextid: "2", assetid: "5" }];

  h.sandbox.window.GTradeStateManager.RemoveItemsFromTrade([el]);

  assert.deepEqual(h.TRADE_STATUS.them.assets, []);
});

test("RemoveItemsFromTrade handles a mix of your and their items in one call, updating both TRADE_STATUS sides", () => {
  const h = loadOverridesForRemoval();
  const mine = makeTradeItem({ id: "1", is_their_item: false });
  const theirs = makeTradeItem({ id: "2", is_their_item: true });
  h.TRADE_STATUS.me.assets = [{ appid: "440", contextid: "2", assetid: "1" }];
  h.TRADE_STATUS.them.assets = [{ appid: "440", contextid: "2", assetid: "2" }];

  h.sandbox.window.GTradeStateManager.RemoveItemsFromTrade([mine.el, theirs.el]);

  assert.deepEqual(h.TRADE_STATUS.me.assets, []);
  assert.deepEqual(h.TRADE_STATUS.them.assets, []);
  assert.equal(h.calls.UpdateTradeStatus.length, 1);
});

test("RemoveItemsFromTrade calls SetStackableItemInTrade(item, 0) for a stackable item instead of RevertItem, and does not touch TRADE_STATUS", () => {
  const h = loadOverridesForRemoval();
  const { item, el } = makeTradeItem({ id: "1", is_stackable: true });
  h.TRADE_STATUS.me.assets = [{ appid: "440", contextid: "2", assetid: "1" }];

  h.sandbox.window.GTradeStateManager.RemoveItemsFromTrade([el]);

  assert.deepEqual(h.calls.SetStackableItemInTrade, [{ item, amount: 0 }]);
  assert.equal(h.calls.RevertItem.length, 0);
  // Stackable items are excluded from the asset-matching pass entirely (see
  // this file's own comment on iterItems) - TRADE_STATUS.me.assets is left
  // untouched and no "changes made" flag is raised for a stackable-only removal.
  assert.deepEqual(h.TRADE_STATUS.me.assets, [{ appid: "440", contextid: "2", assetid: "1" }]);
  assert.equal(h.windowObj.GTradeStateManager.m_bChangesMade, false);
  assert.equal(h.calls.UpdateTradeStatus.length, 0);
});

test("RemoveItemsFromTrade calls CleanupSlot for an item still sitting in a trade slot", () => {
  const { item, el } = makeTradeItem({ id: "1" });
  const h = loadOverridesForRemoval(new Set([el]));
  h.TRADE_STATUS.me.assets = [{ appid: "440", contextid: "2", assetid: "1" }];

  h.sandbox.window.GTradeStateManager.RemoveItemsFromTrade([el]);

  assert.equal(h.calls.CleanupSlot[0], el.parentNode.parentNode);
});

test("RemoveItemsFromTrade does nothing (no changes-made flag, no UpdateTradeStatus) for an empty items array", () => {
  const h = loadOverridesForRemoval();

  h.sandbox.window.GTradeStateManager.RemoveItemsFromTrade([]);

  assert.equal(h.windowObj.GTradeStateManager.m_bChangesMade, false);
  assert.equal(h.calls.UpdateTradeStatus.length, 0);
});

test("RemoveItemsFromTrade leaves changes-made false when the item wasn't actually found among the tracked assets", () => {
  const h = loadOverridesForRemoval();
  const { el } = makeTradeItem({ id: "999" }); // no matching entry in TRADE_STATUS.me.assets
  h.TRADE_STATUS.me.assets = [{ appid: "440", contextid: "2", assetid: "1" }];

  h.sandbox.window.GTradeStateManager.RemoveItemsFromTrade([el]);

  assert.equal(h.windowObj.GTradeStateManager.m_bChangesMade, false);
  assert.deepEqual(h.TRADE_STATUS.me.assets, [{ appid: "440", contextid: "2", assetid: "1" }]);
});

// Regression test, confirmed live: a plain one-time
// `WINDOW.GTradeStateManager.RemoveItemsFromTrade = ...` assignment stops
// working at some point after page load ("Clear my items" throws "...is not
// a function", while everything else this file patches directly onto WINDOW
// keeps working). Turning GTradeStateManager into a self-healing accessor
// property does not help either - window.GTradeStateManager is most likely
// a non-configurable global, which Object.defineProperty can't convert to
// an accessor. So the function is exposed on window.__tf2te__ instead (this
// extension's own namespace, never touched by Steam) and pages/tradeoffer.js
// calls it there. This test simulates GTradeStateManager being replaced
// afterwards and confirms window.__tf2te__.removeItemsFromTrade keeps
// working regardless.
test("window.__tf2te__.removeItemsFromTrade keeps working even after window.GTradeStateManager is replaced with a brand-new object", () => {
  const h = loadOverridesForRemoval();
  const { item, el } = makeTradeItem({ id: "1" });
  h.TRADE_STATUS.me.assets = [{ appid: "440", contextid: "2", assetid: "1" }];

  // Simulates Steam's own page code doing `window.GTradeStateManager = new
  // CTradeStateManager()` (or similar) well after this file's own initial
  // patch - a plain assignment, not going through any extension code.
  h.windowObj.GTradeStateManager = { m_bChangesMade: false, UpdateTradeStatus: () => h.calls.UpdateTradeStatus.push(true) };

  assert.equal(typeof h.windowObj.__tf2te__.removeItemsFromTrade, "function");

  h.windowObj.__tf2te__.removeItemsFromTrade([el]);

  assert.equal(h.calls.RevertItem[0], item);
  assert.deepEqual(h.TRADE_STATUS.me.assets, []);
  assert.equal(h.windowObj.GTradeStateManager.m_bChangesMade, true);
});

// === UpdateSlots ===========================================================

// Note: UpdateSlots' own "am I allowed to receive this" / "is my inventory
// full" checks (see its own source) are always against the bare global
// UserYou - NOT this `user` param (which represents whichever side the
// slot items being placed belong to, i.e. "them" when bYourSlots is
// false) - so those two are configured via h.UserYou.* directly in tests
// that need them, not through this factory.
function makeUser({ inventories = {}, findAssetElements = {} }) {
  return {
    getInventory: (appid, contextid) => inventories[`${appid}_${contextid}`] || null,
    FindCurrency: () => ({}),
    findAssetElement: (appid, contextid, assetid) => findAssetElements[`${appid}_${contextid}_${assetid}`],
    findAsset: (appid, contextid, assetid) => {
      const el = findAssetElements[`${appid}_${contextid}_${assetid}`];
      return el ? el.rgItem : null;
    },
    BAllowedToRecieveItems: () => true,
    BInventoryIsFull: () => false,
  };
}

// Each slot needs the full .slot_inner/.slot_applogo/.slot_app_fraudwarning/
// .slot_actionmenu_button structure PutItemInSlot itself expects (see
// makeSlotContainerEl) - UpdateSlots calls the real PutItemInSlot for any
// slot that ends up receiving a brand-new item.
function makeSlotsContainer(nSlots) {
  const container = new FakeElement("div");
  for (let i = 0; i < nSlots; i++) {
    container.appendChild(makeSlotContainerEl());
  }
  return container;
}

test("UpdateSlots skips a currency update whose inventory is still pending", () => {
  const h = loadOverrides();
  h.elementsById.set("your_slots", makeSlotsContainer(0));
  h.elementsById.set("your_slots_currency", new FakeElement("div"));
  const user = makeUser({});
  user.getInventory = () => ({ BIsPendingInventory: () => true });

  assert.doesNotThrow(() =>
    h.sandbox.window.UpdateSlots([], [{ appid: "440", contextid: "2", currencyid: "1", amount: 5 }], true, user, 1)
  );
  assert.equal(h.calls.UpdateTradeItemStackDisplay.length, 0);
});

test("UpdateSlots updates a changed currency stack and highlights it for a newly-changed item on their side (non-trade-offer mode)", () => {
  const h = loadOverrides();
  h.elementsById.set("your_slots", makeSlotsContainer(0));
  const currencyEl = new FakeElement("div");
  h.elementsById.set("their_slots", makeSlotsContainer(0));
  h.elementsById.set("their_slots_currency", currencyEl);
  const stackEl = new FakeElement("div");
  const user = makeUser({});
  user.getInventory = () => ({ BIsPendingInventory: () => false });
  user.FindCurrency = () => ({ id: "1" });
  h.windowObj.GetTradeItemStack = () => ({ amount: 0, fee: 0, element: stackEl, version: 0 });
  h.windowObj.g_bTradeOffer = false;

  h.sandbox.window.UpdateSlots([], [{ appid: "440", contextid: "2", currencyid: "1", amount: 3 }], false, user, 1);

  assert.equal(h.calls.UpdateTradeItemStackDisplay.length, 1);
  assert.equal(h.calls.HighlightNewlyAddedItem[0], stackEl);
});

test("UpdateSlots puts a brand-new item into an empty slot and highlights it (their side, non-trade-offer mode)", () => {
  const h = loadOverrides();
  const slotsContainer = makeSlotsContainer(1);
  h.elementsById.set("their_slots", slotsContainer);
  h.elementsById.set("their_slots_currency", new FakeElement("div"));
  const itemEl = makeItemEl({ appid: "440", contextid: "2", id: "1", is_their_item: true });
  const user = makeUser({ findAssetElements: { "440_2_1": itemEl } });
  h.windowObj.g_bTradeOffer = false;
  let putItemInSlotCalledWith = null;
  h.windowObj.PutItemInSlot = (el, slot) => (putItemInSlotCalledWith = { el, slot });

  h.sandbox.window.UpdateSlots([{ appid: "440", contextid: "2", assetid: "1", amount: 1 }], [], false, user, 1);

  assert.ok(putItemInSlotCalledWith);
  assert.equal(putItemInSlotCalledWith.el, itemEl);
  assert.equal(h.calls.HighlightNewlyAddedItem.includes(itemEl), true);
});

test("UpdateSlots does not call PutItemInSlot again for an item that's already correctly sitting in its slot", () => {
  const h = loadOverrides();
  const slotsContainer = new FakeElement("div");
  slotsContainer.id = "your_slots";
  const item = { appid: "440", contextid: "2", id: "1" };
  const existingItemEl = makeItemEl(item);
  const slotEl = new FakeElement("div");
  slotEl.appendChild(existingItemEl);
  slotsContainer.appendChild(slotEl);
  h.elementsById.set("your_slots", slotsContainer);
  h.elementsById.set("your_slots_currency", new FakeElement("div"));
  const user = makeUser({ findAssetElements: { "440_2_1": existingItemEl } });
  let putItemInSlotCalls = 0;
  h.windowObj.PutItemInSlot = () => putItemInSlotCalls++;

  h.sandbox.window.UpdateSlots([{ appid: "440", contextid: "2", assetid: "1", amount: 1 }], [], true, user, 1);

  assert.equal(putItemInSlotCalls, 0);
});

test("UpdateSlots counts items the receiving user isn't allowed to receive and logs a singular-vs-plural message", () => {
  const h = loadOverrides();
  h.elementsById.set("their_slots", makeSlotsContainer(1));
  h.elementsById.set("their_slots_currency", new FakeElement("div"));
  const badItem = { appid: "440", contextid: "2", id: "1", name: "Rare Hat" };
  const itemEl = makeItemEl(badItem);
  const user = makeUser({ findAssetElements: { "440_2_1": itemEl } });
  h.UserYou.BAllowedToRecieveItems = () => false; // the check is always against the bare global UserYou, not `user`
  h.sandbox.g_nItemsFromContextWithNoPermissionToReceive = 0;

  h.sandbox.window.UpdateSlots([{ appid: "440", contextid: "2", assetid: "1", amount: 1 }], [], false, user, 1);

  assert.equal(h.calls.logEvents.length, 1);
  assert.equal(h.calls.logEvents[0], 'You are not allowed to receive the item "Rare Hat."');
});

test("UpdateSlots appends a 'full inventory' note (the TDZ-fix branch) without throwing when the receiving inventory is full", () => {
  const h = loadOverrides();
  h.elementsById.set("their_slots", makeSlotsContainer(1));
  h.elementsById.set("their_slots_currency", new FakeElement("div"));
  const badItem = { appid: "440", contextid: "2", id: "1", name: "Rare Hat" };
  const itemEl = makeItemEl(badItem);
  const user = makeUser({ findAssetElements: { "440_2_1": itemEl } });
  h.UserYou.BAllowedToRecieveItems = () => false;
  h.UserYou.BInventoryIsFull = () => true;
  h.windowObj.g_rgAppContextData["440"] = { name: "Team Fortress 2" };
  h.sandbox.g_nItemsFromContextWithNoPermissionToReceive = 0;

  assert.doesNotThrow(() =>
    h.sandbox.window.UpdateSlots([{ appid: "440", contextid: "2", assetid: "1", amount: 1 }], [], false, user, 1)
  );

  assert.match(h.calls.logEvents[0], /Your inventory for Team Fortress 2 is full\.$/);
});

test("UpdateSlots logs an expiring-item warning when the item expires before escrow ends", () => {
  const h = loadOverrides();
  h.elementsById.set("your_slots", makeSlotsContainer(1));
  h.elementsById.set("your_slots_currency", new FakeElement("div"));
  const item = { appid: "440", contextid: "2", id: "1", name: "Old Hat", item_expiration: "2020-01-01T00:00:00Z" };
  const itemEl = makeItemEl(item);
  const user = makeUser({ findAssetElements: { "440_2_1": itemEl } });
  h.sandbox.g_dateEscrowEnd = new Date("2025-01-01T00:00:00Z");

  h.sandbox.window.UpdateSlots([{ appid: "440", contextid: "2", assetid: "1", amount: 1 }], [], true, user, 1);

  assert.equal(h.calls.logEvents.length, 1);
  assert.match(h.calls.logEvents[0], /Old Hat.*expire before the trade hold period is over/);
});

test("UpdateSlots does not flag a bad-item count that hasn't actually changed since the last call", () => {
  const h = loadOverrides();
  h.elementsById.set("their_slots", makeSlotsContainer(0));
  h.elementsById.set("their_slots_currency", new FakeElement("div"));
  const user = makeUser({});

  h.sandbox.window.UpdateSlots([], [], false, user, 1);

  assert.equal(h.calls.logEvents.length, 0);
});

// Real DOM .children is a LIVE collection: removing one slot shifts the next
// into the current index. This container's children array is mutated in
// place on remove() to model that, unlike the default FakeElement's.
test("UpdateSlots removes every stale currency slot, including two in a row", () => {
  const h = loadOverrides();
  h.elementsById.set("your_slots", makeSlotsContainer(0));
  const currencyContainer = new FakeElement("div");
  const makeStaleSlot = (id) => {
    const slot = new FakeElement("div");
    slot.stack = { version: 0, appid: "753", contextid: "6", id };
    slot.remove = function () {
      const siblings = this.parentNode.children;
      siblings.splice(siblings.indexOf(this), 1);
      this.parentNode = null;
      return this;
    };
    return slot;
  };
  currencyContainer.appendChild(makeStaleSlot("a"));
  currencyContainer.appendChild(makeStaleSlot("b"));
  h.elementsById.set("your_slots_currency", currencyContainer);
  const user = makeUser({});
  user.FindCurrency = (appid, contextid, id) => ({ id, amount: 0, original_amount: 7 });

  h.sandbox.window.UpdateSlots([], [], true, user, 1);

  assert.equal(currencyContainer.children.length, 0);
  assert.equal(h.calls.UpdateCurrencyDisplay.length, 2);
});
