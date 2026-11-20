import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

// steamcommunity.com/tradeOffer/pages/tradeoffer.js is the core trade-offer
// enhancer page script - see tests/tradeOfferShared.test.js's own header for
// the full explanation of why/how this whole folder is tested via node:vm
// instead of jsdom (raw non-ESM IIFE, MAIN-world content script, no module
// boundary). This file follows the exact same "real source in a fresh vm
// sandbox per test" pattern, extended with a minimal jQuery-shaped fake (see
// FakeJQuery below) since tradeoffer.js's own fn() body is written entirely
// against jQuery ($), unlike shared.js which barely touches it.
//
// tradeoffer.js's own fn() calls window.__tf2te__.installTradeSlotOverrides
// at the very end (see its own header) - that function is defined by
// tradeSlotOverrides.js, so both real sources must be run in the same
// sandbox (after shared.js) for tradeoffer.js's fn() to run at all without
// throwing on that missing call.
const sharedSrc = readFileSync(new URL("../steamcommunity.com/tradeOffer/shared.js", import.meta.url), "utf8");
const overridesSrc = readFileSync(new URL("../steamcommunity.com/tradeOffer/pages/tradeSlotOverrides.js", import.meta.url), "utf8");
const pageSrc = readFileSync(new URL("../steamcommunity.com/tradeOffer/pages/tradeoffer.js", import.meta.url), "utf8");

// Cross-realm plain-object comparisons - see tradeOfferShared.test.js's own note.
function toPlain(value) {
  return JSON.parse(JSON.stringify(value));
}

// --- Minimal fake DOM (element + a real-enough querySelectorAll) -----------
//
// Real (not html-string-parsed) child/attribute/classList tracking, plus a
// small tag+class matcher for querySelectorAll/jQuery .find() - the only
// selector shapes tradeoffer.js's own querySelectorAll/.find calls ever use
// are "div.item"/".item"/"img" (see this file's own grep-verified survey),
// so a full CSS engine isn't needed.
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
  const parsed = parseSimpleSelector(selector);
  const results = [];
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
    this.style = {};
    this.children = [];
    this.parentNode = null;
    this._attrs = {};
    this._listeners = {};
    this._value = "";
    this._text = undefined;
    this.classList = {
      _set: new Set(),
      add: (...names) => names.forEach((n) => this.classList._set.add(n)),
      contains: (n) => this.classList._set.has(n),
      remove: (...names) => names.forEach((n) => this.classList._set.delete(n)),
    };
  }
  get id() {
    return this._attrs.id || "";
  }
  set id(v) {
    this._attrs.id = String(v);
  }
  get value() {
    return this._value;
  }
  set value(v) {
    this._value = v;
  }
  get textContent() {
    return this._text;
  }
  set textContent(v) {
    this._text = v;
  }
  setAttribute(name, value) {
    this._attrs[name] = String(value);
  }
  getAttribute(name) {
    return name in this._attrs ? this._attrs[name] : null;
  }
  hasAttribute(name) {
    return name in this._attrs;
  }
  removeAttribute(name) {
    delete this._attrs[name];
  }
  appendChild(child) {
    this.children.push(child);
    child.parentNode = this;
    return child;
  }
  append(...items) {
    items.forEach((item) => this.appendChild(item));
  }
  insertBefore(newNode, referenceNode) {
    const idx = referenceNode ? this.children.indexOf(referenceNode) : -1;
    if (idx === -1) this.children.push(newNode);
    else this.children.splice(idx, 0, newNode);
    newNode.parentNode = this;
    return newNode;
  }
  removeChild(child) {
    this.children = this.children.filter((c) => c !== child);
    return child;
  }
  addEventListener(type, cb) {
    (this._listeners[type] ||= []).push(cb);
  }
  dispatchEvent(evt) {
    (this._listeners[evt.type] || []).slice().forEach((cb) => cb(evt));
    return true;
  }
  querySelectorAll(selector) {
    return queryAll(this, selector);
  }
  querySelector(selector) {
    return queryAll(this, selector)[0] || null;
  }
  focus() {}
  select() {}
  // Fixed, arbitrary-but-nonzero coordinates - real screen position has no
  // meaning in this fake DOM and nothing here asserts on it; only exists so
  // positionNameDropdown's own getBoundingClientRect() call doesn't throw.
  getBoundingClientRect() {
    return { top: 100, left: 50, right: 250, bottom: 130, width: 200, height: 30 };
  }
  // Records calls (rather than being a pure no-op) so a test can confirm
  // renderNameDropdown's own scroll-the-highlighted-row-into-view fix
  // actually ran, and specifically ran on an element already attached to
  // the document at call time (a real bug in an earlier version of that fix
  // - see this._connectedAtCall below).
  scrollIntoView(options) {
    (this._scrollIntoViewCalls ||= []).push({ options, wasConnected: this._isConnectedForTests() });
  }
  _isConnectedForTests() {
    let el = this;
    while (el.parentNode) el = el.parentNode;
    return el.tagName === "BODY" || el._isRoot === true;
  }
  closest(selector) {
    const parsed = parseSimpleSelector(selector);
    let el = this;
    while (el) {
      if (elementMatchesSelector(el, parsed)) return el;
      el = el.parentNode;
    }
    return null;
  }
}

// --- Minimal jQuery-shaped fake ---------------------------------------------
//
// Covers exactly the jQuery API surface tradeoffer.js's own fn() body calls
// (grep-verified): get/toArray/find/filter/attr/hasClass/addClass/show/hide/
// toggle/is(':visible')/val/html/text/append/empty/insertAfter/on/trigger,
// plus array-index access (page.$yourSlots[0]). $(selector) resolves purely
// against a test-owned registry (Map<exact selector string, FakeElement[]>)
// - not a real CSS engine - the same "match the handful of known selector
// strings this file actually uses" approach tests/sellDuplicates.test.js's
// own fake document.querySelector already takes.
class FakeJQuery {
  constructor(elements) {
    this._elements = elements;
    elements.forEach((el, i) => {
      this[i] = el;
    });
    this.length = elements.length;
  }
  get(i) {
    return i === undefined ? this._elements.slice() : this._elements[i];
  }
  toArray() {
    return this._elements.slice();
  }
  find(selector) {
    const found = [];
    this._elements.forEach((el) => found.push(...queryAll(el, selector)));
    return new FakeJQuery(found);
  }
  filter(fn) {
    return new FakeJQuery(this._elements.filter((el, i) => fn.call(el, i, el)));
  }
  attr(name, value) {
    if (value === undefined) return this._elements[0] ? this._elements[0].getAttribute(name) : undefined;
    this._elements.forEach((el) => el.setAttribute(name, value));
    return this;
  }
  removeAttr(name) {
    this._elements.forEach((el) => el.removeAttribute(name));
    return this;
  }
  hasClass(name) {
    return this._elements[0] ? this._elements[0].classList.contains(name) : false;
  }
  addClass(name) {
    this._elements.forEach((el) => el.classList.add(name));
    return this;
  }
  removeClass(name) {
    this._elements.forEach((el) => el.classList.remove(name));
    return this;
  }
  show() {
    this._elements.forEach((el) => (el.style.display = ""));
    return this;
  }
  hide() {
    this._elements.forEach((el) => (el.style.display = "none"));
    return this;
  }
  toggle() {
    this._elements.forEach((el) => (el.style.display = el.style.display === "none" ? "" : "none"));
    return this;
  }
  is(sel) {
    if (sel === ":visible") return this._elements.length > 0 && this._elements[0].style.display !== "none";
    return false;
  }
  val(v) {
    if (v === undefined) return this._elements[0] ? this._elements[0].value : undefined;
    this._elements.forEach((el) => (el.value = v));
    return this;
  }
  html(v) {
    if (v === undefined) return this._elements[0] ? this._elements[0]._html : undefined;
    this._elements.forEach((el) => {
      el._html = v;
      el.children = [];
    });
    return this;
  }
  text(v) {
    if (v === undefined) return this._elements[0] ? this._elements[0]._text : undefined;
    this._elements.forEach((el) => (el._text = v));
    return this;
  }
  append(x) {
    this._elements.forEach((el) => {
      if (typeof x === "string") el._appendedHtml = (el._appendedHtml || "") + x;
      else el.appendChild(x);
    });
    return this;
  }
  empty() {
    this._elements.forEach((el) => (el.children = []));
    return this;
  }
  insertAfter() {
    return this; // purely cosmetic DOM positioning, not needed by any assertion
  }
  on(event, handler) {
    this._elements.forEach((el) => el.addEventListener(event, handler));
    return this;
  }
  trigger(event) {
    this._elements.forEach((el) => el.dispatchEvent({ type: event }));
    return this;
  }
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

// Non-auto-firing setTimeout/setInterval - tests decide exactly when (or
// whether) a given timer fires, rather than guessing microtask/real-time
// ordering. Mirrors tests/priceWidgets.test.js's own installObserverGlobals.
function makeTimers() {
  let nextId = 1;
  const pending = new Map(); // id -> { fn, delay, kind }
  return {
    setTimeout: (fn, delay) => {
      const id = nextId++;
      pending.set(id, { fn, delay, kind: "timeout" });
      return id;
    },
    clearTimeout: (id) => pending.delete(id),
    setInterval: (fn, delay) => {
      const id = nextId++;
      pending.set(id, { fn, delay, kind: "interval" });
      return id;
    },
    clearInterval: (id) => pending.delete(id),
    // Fires (and consumes) the earliest-registered still-pending timeout -
    // enough control for every test in this file, since each only ever has
    // one timeout of interest pending at the moment it wants to fire one.
    fireNextTimeout() {
      for (const [id, entry] of pending) {
        if (entry.kind === "timeout") {
          pending.delete(id);
          entry.fn();
          return true;
        }
      }
      return false;
    },
    pendingCount(kind) {
      return [...pending.values()].filter((e) => !kind || e.kind === kind).length;
    },
  };
}

// --- Harness: build a sandbox, load shared.js + tradeSlotOverrides.js +
// pages/tradeoffer.js's real source into it, and provide everything a test
// needs to drive the registered script's fn() and inspect its effects. ---

function makeAppData() {
  const rgInventory = {};
  return {
    data: { "440": { rgContexts: { "2": { inventory: { rgInventory } } } } },
    rgInventory,
  };
}

function loadTradeOfferPage({ effectsMap = { "Team Spirit": 6, "Burning Flames": 13 }, locationSearch = "" } = {}) {
  const registry = new Map(); // exact jQuery selector string -> FakeElement[]
  const docQueryRegistry = new Map(); // exact document.querySelector selector -> element
  const elementsById = new Map();
  const alerts = [];
  const documentListeners = {};
  const timers = makeTimers();
  FakeMutationObserver.instances = [];

  function registerEl(selector, el) {
    registry.set(selector, [el]);
    return el;
  }
  function idEl(id, tag = "div") {
    const el = new FakeElement(tag);
    el.setAttribute("id", id);
    elementsById.set(id, el);
    registerEl("#" + id, el);
    return el;
  }

  function $(selectorOrEl) {
    if (typeof selectorOrEl === "string") {
      if (selectorOrEl.startsWith("<")) return new FakeJQuery([new FakeElement("div")]);
      return new FakeJQuery(registry.get(selectorOrEl) || []);
    }
    if (selectorOrEl instanceof FakeJQuery) return selectorOrEl;
    if (selectorOrEl && selectorOrEl.nodeType === "document") return new FakeJQuery([selectorOrEl]);
    const arr = Array.isArray(selectorOrEl) ? selectorOrEl : [selectorOrEl];
    return new FakeJQuery(arr);
  }

  const fakeDocument = {
    nodeType: "document",
    body: new FakeElement("body"),
    // extensionUrlBridge.js's attribute, which the real page always has.
    documentElement: Object.assign(new FakeElement("html"), { dataset: { tf2teExtensionUrl: "moz-extension://test/" } }),
    head: new FakeElement("head"),
    createElement: (tag) => new FakeElement(tag),
    getElementById: (id) => elementsById.get(id) || null,
    querySelector: (sel) => docQueryRegistry.get(sel) || null,
    addEventListener: (type, cb) => {
      (documentListeners[type] ||= []).push(cb);
    },
    removeEventListener: (type, cb) => {
      documentListeners[type] = (documentListeners[type] || []).filter((f) => f !== cb);
    },
    dispatchEvent: (evt) => {
      (documentListeners[evt.type] || []).slice().forEach((cb) => cb(evt));
      return true;
    },
  };

  // showAlert() replaced window.alert() with a real DOM modal (see
  // .tf2te-alert-overlay in tradeoffer.js) - intercept it here at the
  // document.body.appendChild boundary and keep feeding the same `alerts`
  // array the old `sandbox.alert` stub used to, so every existing
  // "h.alerts" assertion keeps working unchanged against the new popup's
  // rendered message instead of a native alert() call.
  const originalBodyAppendChild = fakeDocument.body.appendChild.bind(fakeDocument.body);
  fakeDocument.body.appendChild = (el) => {
    originalBodyAppendChild(el);
    if (el.classList.contains("tf2te-alert-overlay")) {
      const messageEl = el.querySelector(".tf2te-alert-message");
      alerts.push(messageEl ? messageEl.textContent : "");
    }
    return el;
  };

  const yourInv = makeAppData();
  const theirInv = makeAppData();

  // No underscores - inventoryManager's own DOM-mutation observer splits
  // "inventory_<steamid>_<appid>_<contextid>" naively on '_' (see this
  // file's own inventory-observer tests), so a steamid containing '_' would
  // desync that split.
  const STEAMID = "STEAMIDYOU";
  const PARTNER_STEAMID = "STEAMIDTHEM";

  const TRADE_STATUS = {
    version: 0,
    me: { assets: [], currency: [] },
    them: { assets: [], currency: [] },
  };

  const UserYou = { strSteamId: STEAMID, rgAppInfo: yourInv.data };
  const UserThem = {
    strSteamId: PARTNER_STEAMID,
    rgAppInfo: theirInv.data,
    BIsLoadingInventoryData: () => false,
  };

  const windowObj = {
    jQuery: $,
    location: { search: locationSearch },
    __tf2teUnusualEffectsMap__: effectsMap,
    UserYou,
    UserThem,
    g_rgAppContextData: yourInv.data,
    g_rgPartnerAppContextData: theirInv.data,
    g_rgCurrentTradeStatus: TRADE_STATUS,
    GTradeStateManager: { m_bChangesMade: false, UpdateTradeStatus: () => {} },
    RefreshTradeStatus: () => {},
    Economy_UseResponsiveLayout: () => false,
    ResponsiveTrade_SwitchMode: () => {},
    BIsInTradeSlot: () => false,
  };
  windowObj.window = windowObj;

  const sandbox = {
    window: windowObj,
    document: fakeDocument,
    localStorage: (() => {
      const store = {};
      return {
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, v) => (store[k] = String(v)),
        removeItem: (k) => delete store[k],
        key: (i) => Object.keys(store)[i],
        get length() {
          return Object.keys(store).length;
        },
      };
    })(),
    console,
    MutationObserver: FakeMutationObserver,
    // Steam's own header is never floated/positioned - see enablePartnerSideColumn.
    getComputedStyle: () => ({ float: "none", position: "static" }),
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    setInterval: timers.setInterval,
    clearInterval: timers.clearInterval,
    CustomEvent: class CustomEvent {
      constructor(type, init) {
        this.type = type;
        Object.assign(this, init);
      }
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(sharedSrc, sandbox);
  vm.runInContext(overridesSrc, sandbox);
  vm.runInContext(pageSrc, sandbox);

  // Pre-register every static id tradeoffer.js's own fn() looks up, exactly
  // mirroring "these already exist as real elements on the trade offer page
  // by the time this script runs" (the #your_slots/etc ones) or "this
  // script's own $tradeBox.append(...) call created them" (the rest) -
  // registry membership stands in for both without parsing any HTML.
  [
    "your_slots",
    "their_slots",
    "inventories",
    "inventory_box",
    "inventory_displaycontrols",
    "inventory_select_your_inventory",
    "inventory_select_their_inventory",
    "tradeoffer_items_summary",
    "your_summary",
    "their_summary",
    "controls",
    "amount_control",
    "amount_control_dec",
    "amount_control_inc",
    "index_control",
    "index_control_dec",
    "index_control_inc",
    "name_control",
    "name_suggestion_dropdown",
    "name_amount_control",
    "name_amount_control_dec",
    "name_amount_control_inc",
    "keys_amount_control",
    "metal_amount_control",
    "ids_control",
    "id_fields",
    "add_btns",
    "btn_additems",
    "btn_addname",
    "btn_addkeys",
    "btn_addmetal",
    "btn_addrecent",
    "btn_clearmyitems",
    "btn_cleartheiritems",
    "btn_addlisting",
    "btn_addlistingitem",
    "btn_addids",
    "btn_getids",
  ].forEach((id) => idEl(id));
  registerEl("#inventory_box div.trade_box_contents", new FakeElement("div"));
  registerEl(".appselect_options .option", null); // overwritten below (needs an array, not one el)
  registry.set(".appselect_options .option", []);

  // Sensible defaults so the "configure state" block at the end of fn()
  // (which unconditionally calls tradeOfferWindow.userChanged(...) and
  // refreshNameSuggestions()) runs without throwing - see this file's own
  // notes on why $inventory.attr('id') must never be null/undefined here.
  // Reuses the SAME #inventory_select_your_inventory element registered
  // above (not a fresh disconnected one) - isYourInventorySelected() (read
  // by addItemsByName/getDefaultsForAddItems/refreshNameSuggestions/etc.)
  // resolves the active tab via page.get.$activeInventoryTab() i.e. the
  // ".inventory_user_tab.active" registry entry set below, which must point
  // at this same element for a default "your inventory selected" state.
  const yourTabEl = elementsById.get("inventory_select_your_inventory");
  yourTabEl.classList.add("inventory_user_tab", "active");
  registry.set(".inventory_user_tab.active", [yourTabEl]);
  const defaultInventoryCtn = new FakeElement("div");
  defaultInventoryCtn.setAttribute("id", `inventory_${STEAMID}_440_2`);
  registry.set(".inventory_ctn:visible", [defaultInventoryCtn]);
  registry.set("div.modify_trade_offer:visible", []);
  registry.set("#modify_trade_offer_opts div.content", []);
  registry.set("#appselect_activeapp img", []);
  registry.set('a[href$="_undefined"]', []);

  const entry = sandbox.window.__tf2te__.scripts.find((s) => s.includes.some((re) => re.test("https://steamcommunity.com/tradeoffer/123")));

  return {
    sandbox,
    entry,
    DEPS: sandbox.window.__tf2te__.DEPS,
    registry,
    docQueryRegistry,
    elementsById,
    alerts,
    documentListeners,
    timers,
    windowObj,
    TRADE_STATUS,
    UserYou,
    UserThem,
    yourInv,
    theirInv,
    STEAMID,
    PARTNER_STEAMID,
    $,
    // Runs the page's real fn() - call after any last-minute registry/window
    // tweaks a specific test needs (e.g. urlParams via locationSearch, or a
    // populated inventory) since fn() reads all of that synchronously as
    // soon as it starts.
    run() {
      entry.fn(this.DEPS);
      return this;
    },
    click(id) {
      const el = registry.get("#" + id)?.[0];
      if (!el) throw new Error(`no element registered for #${id}`);
      el.dispatchEvent({ type: "click" });
    },
    setVal(id, value) {
      registry.get("#" + id)[0].value = value;
    },
    getHtml(id) {
      return registry.get("#" + id)[0]._html;
    },
  };
}

function makeSlotItemEl({ assetid, appid = "440", contextid = "2", imgSrc = "https://example.com/img.png", borderColor = "#ffffff", effect, uncraft = false, strange = false, marketHashName }) {
  const el = new FakeElement("div");
  el.classList.add("item");
  el.setAttribute("id", `item${appid}_${contextid}_${assetid}`);
  el.style.borderColor = borderColor;
  if (effect !== undefined) el.setAttribute("data-effect", effect);
  if (uncraft) el.classList.add("uncraft");
  if (strange) el.classList.add("strange");
  const img = new FakeElement("img");
  img.setAttribute("src", imgSrc);
  el.appendChild(img);
  el.rgItem = { appid, contextid, id: assetid, appid_num: appid, market_hash_name: marketHashName };
  return el;
}

// Switches the "active inventory tab" state the same way a real click on
// the their-inventory tab would - mutating the SAME registered elements
// page.$inventorySelectYour/Their and page.get.$activeInventoryTab()/
// $inventory() already resolve to (not fresh disconnected stand-ins), then
// dispatches the click so tradeOfferWindow.userChanged's own handler runs
// and updates button visibility for real.
function switchToTheirInventory(h) {
  const yourTab = h.elementsById.get("inventory_select_your_inventory");
  yourTab.classList.remove("active");
  const theirTab = h.elementsById.get("inventory_select_their_inventory");
  theirTab.classList.add("inventory_user_tab", "active");
  h.registry.set(".inventory_user_tab.active", [theirTab]);
  const ctn = new FakeElement("div");
  ctn.setAttribute("id", `inventory_${h.PARTNER_STEAMID}_440_2`);
  h.registry.set(".inventory_ctn:visible", [ctn]);
  theirTab.dispatchEvent({ type: "click" });
}

function addInventoryAsset(harness, { isYou, appid = "440", contextid = "2", id, market_hash_name, is_stackable = false, is_their_item = !isYou, tags }) {
  const inv = isYou ? harness.yourInv : harness.theirInv;
  const item = { appid, contextid, id, market_hash_name, is_stackable, is_their_item, tags };
  inv.rgInventory[id] = item;
  const el = new FakeElement("div");
  el.classList.add("item");
  el.setAttribute("id", `item${appid}_${contextid}_${id}`);
  el.rgItem = item;
  harness.elementsById.set(el.getAttribute("id"), el);
  return item;
}

// --- script registration -----------------------------------------------

test("registers into window.__tf2te__.scripts with the /tradeoffer/* includes pattern and the shared itemOverlay style", () => {
  const h = loadTradeOfferPage();
  assert.equal(h.sandbox.window.__tf2te__.scripts.length, 1);
  assert.ok(h.entry, "expected the page to register a matching script entry");
  assert.equal(h.entry.includes[0].test("https://steamcommunity.com/tradeoffer/123"), true);
  assert.equal(h.entry.includes[0].test("https://steamcommunity.com/id/foo"), false);
  assert.match(h.entry.styles, /\.unusual/);
});

test("run() completes without throwing given a minimal but valid page state", () => {
  const h = loadTradeOfferPage();
  assert.doesNotThrow(() => h.run());
});

// --- collapseDuplicateSlots (visually collapsing duplicate-looking trade
// slot tiles into one + a "xN" badge - only reachable via observeSlots' own
// debounced slot-mutation timer, unlike summarize which also has the
// inventory-loaded shortcut used above, so these drive the fake timers
// directly instead). ---

function makeSlotWrapper(itemEl) {
  const wrapper = new FakeElement("div");
  wrapper.classList.add("trade_slot");
  wrapper.appendChild(itemEl);
  return wrapper;
}

// Builds shared.js's own real ".icons > img.parts/.ks/.spell" nesting (not
// just a bare marker <img> loose in the item), so getItemIconSrc's
// closest('.icons') exclusion is actually exercised the same way it would
// be against a real trade slot element.
function addTradeCustomizationIcon(itemEl, markerClass, src, tier) {
  const iconsEl = new FakeElement("div");
  iconsEl.classList.add("icons");
  const markerImg = new FakeElement("img");
  markerImg.classList.add(markerClass);
  markerImg.setAttribute("src", src);
  if (tier) markerImg.setAttribute("data-tier", String(tier));
  iconsEl.appendChild(markerImg);
  itemEl.appendChild(iconsEl);
}

// Fires the your_slots observer's debounced pass - registered first (see
// tradeoffer.js's own "observe changes to trade slots" block, which runs
// before "observe inventory changes"), so it's always instances[0]. Drains
// EVERY pending timeout (not just one), so the freshly-scheduled debounce
// timer this is trying to trigger always fires.
function fireYourSlotsObserver(h) {
  FakeMutationObserver.instances[0].cb([]);
  while (h.timers.fireNextTimeout()) {
    // drain
  }
}

test("collapses 3 visually-identical slot tiles into one, with a x3 badge, leaving a genuinely different item alone", () => {
  const h = loadTradeOfferPage();
  const yourSlots = h.elementsById.get("your_slots");
  const dupe1 = makeSlotWrapper(makeSlotItemEl({ assetid: "1", marketHashName: "Refined Metal" }));
  const dupe2 = makeSlotWrapper(makeSlotItemEl({ assetid: "2", marketHashName: "Refined Metal" }));
  const dupe3 = makeSlotWrapper(makeSlotItemEl({ assetid: "3", marketHashName: "Refined Metal" }));
  const other = makeSlotWrapper(makeSlotItemEl({ assetid: "4", strange: true, marketHashName: "Strange Rocket Launcher" }));
  [dupe1, dupe2, dupe3, other].forEach((w) => yourSlots.appendChild(w));

  h.run();
  fireYourSlotsObserver(h);

  assert.equal(dupe1.style.display, "");
  assert.equal(dupe2.style.display, "none");
  assert.equal(dupe3.style.display, "none");
  assert.equal(other.style.display, "");

  const badge = dupe1.querySelector(".tf2te-slot-badge");
  assert.ok(badge, "expected a badge on the representative (first) slot");
  assert.equal(badge.textContent, "×3");
  assert.equal(other.querySelector(".tf2te-slot-badge"), null);
});

// Regression test: confirmed live - two Strange Rocket Launchers with
// completely different Strange Parts attached render with the exact same
// icon/border/quality color, so getItemVisualSignature's plain img/border/
// effect/uncraft/strange fingerprint saw them as duplicates and collapsed
// them into one badged slot even though they're NOT interchangeable items.
// shared.js's own addAttributesToElement renders a small ".parts"/".ks"/
// ".spell" icon for these - any item carrying one must never be treated as
// a duplicate of anything else, even another item with the very same marker.
test("never collapses items carrying a Strange Part/Killstreak Kit/Spell marker, even against an otherwise-identical item", () => {
  const h = loadTradeOfferPage();
  const yourSlots = h.elementsById.get("your_slots");
  const partsItem1 = makeSlotItemEl({ assetid: "1", strange: true, marketHashName: "Strange Rocket Launcher" });
  addTradeCustomizationIcon(partsItem1, "parts", "moz-extension://test/images/icons/strange-parts.svg");
  const partsItem2 = makeSlotItemEl({ assetid: "2", strange: true, marketHashName: "Strange Rocket Launcher" });
  addTradeCustomizationIcon(partsItem2, "parts", "moz-extension://test/images/icons/strange-parts.svg");
  const ksItem = makeSlotItemEl({ assetid: "3", marketHashName: "Killstreak Rocket Launcher" });
  addTradeCustomizationIcon(ksItem, "ks", "moz-extension://test/images/icons/killstreak-1.svg");

  const dupe1 = makeSlotWrapper(partsItem1);
  const dupe2 = makeSlotWrapper(partsItem2);
  const dupe3 = makeSlotWrapper(ksItem);
  [dupe1, dupe2, dupe3].forEach((w) => yourSlots.appendChild(w));

  h.run();
  fireYourSlotsObserver(h);

  assert.equal(dupe1.style.display, "", "a Strange-Part item must never be hidden as someone else's duplicate");
  assert.equal(dupe2.style.display, "", "a second, different Strange-Part item must also stay visible");
  assert.equal(dupe3.style.display, "", "a Killstreak item must stay visible too");
  assert.equal(dupe1.querySelector(".tf2te-slot-badge"), null);
  assert.equal(dupe2.querySelector(".tf2te-slot-badge"), null);
  assert.equal(dupe3.querySelector(".tf2te-slot-badge"), null);
});

// Regression test: the ORIGINAL fix here excluded any "nextTarget"-classed
// slot from grouping entirely, on the assumption Steam only ever applies
// that class to a specially-tracked EMPTY slot - confirmed live it isn't
// exclusive to empty slots at all (a real duplicate can carry it too), which
// left that one duplicate permanently stray, no matter how many more of the
// same item got added afterward. Fixed by still counting it into its group -
// just always as the REPRESENTATIVE (kept visible), never one of the hidden
// duplicates, since setting display:none on this specific slot is separately
// confirmed live (via that same real trade offer) to cause a layout glitch
// ("removed a square"). Both the grouping bug and the hiding glitch are
// real; this is what satisfies both at once.
test("keeps a slot Steam has marked with its own 'nextTarget' class as the visible, badged representative of its duplicate group - never hidden, never excluded", () => {
  const h = loadTradeOfferPage();
  const yourSlots = h.elementsById.get("your_slots");
  const dupe1 = makeSlotWrapper(makeSlotItemEl({ assetid: "1", marketHashName: "Refined Metal" }));
  const dupe2 = makeSlotWrapper(makeSlotItemEl({ assetid: "2", marketHashName: "Refined Metal" }));
  dupe2.classList.add("nextTarget");
  [dupe1, dupe2].forEach((w) => yourSlots.appendChild(w));

  h.run();
  fireYourSlotsObserver(h);

  assert.equal(dupe1.style.display, "none", "the plain slot must be the one hidden, not the nextTarget one");
  assert.equal(dupe2.style.display, "", "the nextTarget-marked slot must stay visible");
  assert.equal(dupe1.querySelector(".tf2te-slot-badge"), null);
  const badge = dupe2.querySelector(".tf2te-slot-badge");
  assert.ok(badge, "the nextTarget-marked slot should carry the group's badge");
  assert.equal(badge.textContent, "×2");
});

// Regression test: a "keep at least N tiles visible" compromise was tried
// and reverted (confirmed live it blocked collapsing entirely for a small
// trade like this one, undoing the feature's whole point) - duplicates must
// always fully collapse regardless of how many total slots exist.
test("fully collapses 5 duplicates down to one badged tile even with no extra padding slots at all", () => {
  const h = loadTradeOfferPage();
  const yourSlots = h.elementsById.get("your_slots");
  const dupes = ["1", "2", "3", "4", "5"].map((id) => makeSlotWrapper(makeSlotItemEl({ assetid: id, marketHashName: "Refined Metal" })));
  dupes.forEach((w) => yourSlots.appendChild(w));

  h.run();
  fireYourSlotsObserver(h);

  const [representative, ...rest] = dupes;
  assert.equal(representative.style.display, "");
  rest.forEach((w) => assert.equal(w.style.display, "none"));

  const badge = representative.querySelector(".tf2te-slot-badge");
  assert.ok(badge, "expected a badge on the representative slot");
  assert.equal(badge.textContent, "×5");
});

test("leaves every slot alone (no badges) when nothing is duplicated", () => {
  const h = loadTradeOfferPage();
  const yourSlots = h.elementsById.get("your_slots");
  const a = makeSlotWrapper(makeSlotItemEl({ assetid: "1", marketHashName: "Rocket Launcher" }));
  const b = makeSlotWrapper(makeSlotItemEl({ assetid: "2", strange: true, marketHashName: "Strange Rocket Launcher" }));
  [a, b].forEach((w) => yourSlots.appendChild(w));

  h.run();
  fireYourSlotsObserver(h);

  assert.equal(a.style.display, "");
  assert.equal(b.style.display, "");
  assert.equal(a.querySelector(".tf2te-slot-badge"), null);
  assert.equal(b.querySelector(".tf2te-slot-badge"), null);
});

test("re-shows a previously-hidden duplicate and drops the stale badge once only one instance is left", () => {
  const h = loadTradeOfferPage();
  const yourSlots = h.elementsById.get("your_slots");
  const dupe1 = makeSlotWrapper(makeSlotItemEl({ assetid: "1", marketHashName: "Refined Metal" }));
  const dupe2 = makeSlotWrapper(makeSlotItemEl({ assetid: "2", marketHashName: "Refined Metal" }));
  [dupe1, dupe2].forEach((w) => yourSlots.appendChild(w));

  h.run();
  fireYourSlotsObserver(h);
  assert.equal(dupe2.style.display, "none");
  assert.ok(dupe1.querySelector(".tf2te-slot-badge"));

  // Simulate Steam's own removal path taking dupe2 out of the slot grid
  // entirely (a real removal always re-renders the whole grid, per
  // tradeSlotOverrides.js's own UpdateSlots).
  yourSlots.children = yourSlots.children.filter((w) => w !== dupe2);
  fireYourSlotsObserver(h);

  assert.equal(dupe1.style.display, "");
  assert.equal(dupe1.querySelector(".tf2te-slot-badge"), null);
});

test("collapses duplicates independently on their_slots too", () => {
  const h = loadTradeOfferPage();
  const theirSlots = h.elementsById.get("their_slots");
  const dupe1 = makeSlotWrapper(makeSlotItemEl({ assetid: "1", marketHashName: "Scrap Metal" }));
  const dupe2 = makeSlotWrapper(makeSlotItemEl({ assetid: "2", marketHashName: "Scrap Metal" }));
  [dupe1, dupe2].forEach((w) => theirSlots.appendChild(w));

  h.run();
  // their_slots observer is registered second (instances[1]) - see
  // fireYourSlotsObserver's own note on registration order.
  FakeMutationObserver.instances[1].cb([]);
  while (h.timers.fireNextTimeout()) {
    // drain - see fireYourSlotsObserver's own note on why
  }

  assert.equal(dupe1.style.display, "");
  assert.equal(dupe2.style.display, "none");
  assert.equal(dupe1.querySelector(".tf2te-slot-badge").textContent, "×2");
});

// --- addItemHistoryLinks (top-right "open on next.backpack.tf" link on
// EVERY itemful slot, not just collapsed-stack representatives) ---

test("adds a next.backpack.tf history link to a slot's item, pointing at that exact asset id", () => {
  const h = loadTradeOfferPage();
  const yourSlots = h.elementsById.get("your_slots");
  const wrapper = makeSlotWrapper(makeSlotItemEl({ assetid: "16579057759", marketHashName: "Rocket Launcher" }));
  yourSlots.appendChild(wrapper);

  h.run();
  fireYourSlotsObserver(h);

  const link = wrapper.querySelector(".tf2te-item-history-link");
  assert.ok(link, "expected a history link on the item's slot");
  assert.equal(link.href, "https://next.backpack.tf/item/16579057759");
  assert.equal(link.target, "_blank");
});

test("adds independent history links to multiple distinct (non-duplicate) items in the same trade", () => {
  const h = loadTradeOfferPage();
  const yourSlots = h.elementsById.get("your_slots");
  const a = makeSlotWrapper(makeSlotItemEl({ assetid: "1", marketHashName: "Rocket Launcher" }));
  const b = makeSlotWrapper(makeSlotItemEl({ assetid: "2", strange: true, marketHashName: "Strange Rocket Launcher" }));
  [a, b].forEach((w) => yourSlots.appendChild(w));

  h.run();
  fireYourSlotsObserver(h);

  assert.equal(a.querySelector(".tf2te-item-history-link").href, "https://next.backpack.tf/item/1");
  assert.equal(b.querySelector(".tf2te-item-history-link").href, "https://next.backpack.tf/item/2");
});

test("a collapsed duplicate stack's representative gets a history picker instead of a direct link, listing every real item in trade-window order", () => {
  const h = loadTradeOfferPage();
  const yourSlots = h.elementsById.get("your_slots");
  const dupe1 = makeSlotWrapper(makeSlotItemEl({ assetid: "1", marketHashName: "Refined Metal" }));
  const dupe2 = makeSlotWrapper(makeSlotItemEl({ assetid: "2", marketHashName: "Refined Metal" }));
  const dupe3 = makeSlotWrapper(makeSlotItemEl({ assetid: "3", marketHashName: "Refined Metal" }));
  [dupe1, dupe2, dupe3].forEach((w) => yourSlots.appendChild(w));
  h.yourInv.rgInventory["1"] = { market_hash_name: "Refined Metal" };

  h.run();
  fireYourSlotsObserver(h);

  const repLink = dupe1.querySelector(".tf2te-item-history-link");
  assert.equal(repLink.href, "javascript:void(0)", "representative's link must not navigate directly");

  repLink.dispatchEvent({ type: "click", stopPropagation: () => {}, preventDefault: () => {} });

  const overlay = h.sandbox.document.body.children[0];
  assert.ok(overlay, "expected the picker modal to open");
  assert.equal(overlay.querySelector(".tf2te-remove-qty-title").textContent, "Which Refined Metal do you want to check the history for?");

  const rows = overlay.querySelectorAll(".tf2te-history-pick-row");
  assert.equal(rows.length, 3);
  assert.equal(rows[0].textContent, "Item 1 of 3");
  assert.equal(rows[0].href, "https://next.backpack.tf/item/1");
  assert.equal(rows[1].textContent, "Item 2 of 3");
  assert.equal(rows[1].href, "https://next.backpack.tf/item/2");
  assert.equal(rows[2].textContent, "Item 3 of 3");
  assert.equal(rows[2].href, "https://next.backpack.tf/item/3");
});

// Regression/feature test: collapseDuplicateSlots groups purely on
// icon/border/effect/uncraft/strange-boolean, so two grouped items can
// still have genuinely different Level numbers or Strange kill counts -
// neither factors into that signature. Each row now shows its own item's
// "type" text (Steam's own subtitle, e.g. "Strange Rocket Launcher - Kills:
// 128") when resolvable, so the picker can actually be used to tell them
// apart instead of just "Item N of M".
test("history picker rows show each item's own type text when resolvable, to distinguish otherwise-identical duplicates", () => {
  const h = loadTradeOfferPage();
  const yourSlots = h.elementsById.get("your_slots");
  const dupe1 = makeSlotWrapper(makeSlotItemEl({ assetid: "1", marketHashName: "Strange Rocket Launcher" }));
  const dupe2 = makeSlotWrapper(makeSlotItemEl({ assetid: "2", marketHashName: "Strange Rocket Launcher" }));
  [dupe1, dupe2].forEach((w) => yourSlots.appendChild(w));
  h.yourInv.rgInventory["1"] = { market_hash_name: "Strange Rocket Launcher", type: "Strange Rocket Launcher - Kills: 128" };
  h.yourInv.rgInventory["2"] = { market_hash_name: "Strange Rocket Launcher", type: "Strange Rocket Launcher - Kills: 4" };

  h.run();
  fireYourSlotsObserver(h);

  dupe1.querySelector(".tf2te-item-history-link").dispatchEvent({ type: "click", stopPropagation: () => {}, preventDefault: () => {} });

  const overlay = h.sandbox.document.body.children[0];
  const rows = overlay.querySelectorAll(".tf2te-history-pick-row");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].textContent, "Item 1 of 2: Strange Rocket Launcher - Kills: 128");
  assert.equal(rows[1].textContent, "Item 2 of 2: Strange Rocket Launcher - Kills: 4");
});

test("clicking a row in the history picker closes it", () => {
  const h = loadTradeOfferPage();
  const yourSlots = h.elementsById.get("your_slots");
  const dupe1 = makeSlotWrapper(makeSlotItemEl({ assetid: "1", marketHashName: "Refined Metal" }));
  const dupe2 = makeSlotWrapper(makeSlotItemEl({ assetid: "2", marketHashName: "Refined Metal" }));
  [dupe1, dupe2].forEach((w) => yourSlots.appendChild(w));

  h.run();
  fireYourSlotsObserver(h);

  dupe1.querySelector(".tf2te-item-history-link").dispatchEvent({ type: "click", stopPropagation: () => {}, preventDefault: () => {} });

  const overlay = h.sandbox.document.body.children[0];
  overlay.querySelectorAll(".tf2te-history-pick-row")[0].dispatchEvent({ type: "click" });

  assert.equal(h.sandbox.document.body.children.length, 0);
});

// Feature test: the history picker used to have no explicit way out at
// all, only the dark overlay itself or Escape - neither discoverable as a
// real UI affordance.
test("the history picker has an explicit Cancel button that closes it without navigating anywhere", () => {
  const h = loadTradeOfferPage();
  const yourSlots = h.elementsById.get("your_slots");
  const dupe1 = makeSlotWrapper(makeSlotItemEl({ assetid: "1", marketHashName: "Refined Metal" }));
  const dupe2 = makeSlotWrapper(makeSlotItemEl({ assetid: "2", marketHashName: "Refined Metal" }));
  [dupe1, dupe2].forEach((w) => yourSlots.appendChild(w));

  h.run();
  fireYourSlotsObserver(h);

  dupe1.querySelector(".tf2te-item-history-link").dispatchEvent({ type: "click", stopPropagation: () => {}, preventDefault: () => {} });

  const overlay = h.sandbox.document.body.children[0];
  const cancelBtn = overlay.querySelector(".tf2te-remove-qty-cancel");
  assert.ok(cancelBtn, "expected an explicit Cancel button in the history picker");
  assert.equal(cancelBtn.textContent, "Cancel");

  cancelBtn.dispatchEvent({ type: "click" });

  assert.equal(h.sandbox.document.body.children.length, 0, "modal should be closed");
});

test("the hidden duplicate slots behind a collapsed stack's badge still get their own direct history link", () => {
  const h = loadTradeOfferPage();
  const yourSlots = h.elementsById.get("your_slots");
  const dupe1 = makeSlotWrapper(makeSlotItemEl({ assetid: "1", marketHashName: "Refined Metal" }));
  const dupe2 = makeSlotWrapper(makeSlotItemEl({ assetid: "2", marketHashName: "Refined Metal" }));
  [dupe1, dupe2].forEach((w) => yourSlots.appendChild(w));

  h.run();
  fireYourSlotsObserver(h);

  // dupe2 isn't the group's representative (collapseDuplicateSlots never
  // stashes tf2teGroupItems on it), so it falls back to a plain direct link
  // like any non-grouped item would - it's just unreachable in practice
  // since the slot itself is display:none.
  assert.equal(dupe2.querySelector(".tf2te-item-history-link").href, "https://next.backpack.tf/item/2");
});

test("never adds a history link to an empty slot", () => {
  const h = loadTradeOfferPage();
  const yourSlots = h.elementsById.get("your_slots");
  const empty = new FakeElement("div");
  yourSlots.appendChild(empty);

  h.run();
  fireYourSlotsObserver(h);

  assert.equal(empty.querySelector(".tf2te-item-history-link"), null);
});

// Regression test: confirmed live - a slot Steam marks "nextTarget" used to
// NEVER get a history link at all (this used to copy collapseDuplicateSlots'
// own exclusion verbatim), which meant that one specific item permanently
// never got its icon no matter how many more items got added afterward -
// Steam keeps the class on the same slot persistently, so it wasn't a
// one-off failure the resilience fix could recover from. Unlike
// collapseDuplicateSlots (which hides/moves slots - a real risk against
// Steam's own tracked slot), this function only ever appends a small link,
// so the same exclusion didn't actually need to apply here.
test("still adds a history link to a slot Steam has marked with its own 'nextTarget' class (only collapseDuplicateSlots excludes it)", () => {
  const h = loadTradeOfferPage();
  const yourSlots = h.elementsById.get("your_slots");
  const wrapper = makeSlotWrapper(makeSlotItemEl({ assetid: "1", marketHashName: "Rocket Launcher" }));
  wrapper.classList.add("nextTarget");
  yourSlots.appendChild(wrapper);

  h.run();
  fireYourSlotsObserver(h);

  assert.ok(wrapper.querySelector(".tf2te-item-history-link"));
});

test("refreshes an existing link's href instead of going stale when Steam swaps a different item into the same slot", () => {
  const h = loadTradeOfferPage();
  const yourSlots = h.elementsById.get("your_slots");
  const itemA = makeSlotItemEl({ assetid: "1", marketHashName: "Rocket Launcher" });
  const wrapper = makeSlotWrapper(itemA);
  yourSlots.appendChild(wrapper);

  h.run();
  fireYourSlotsObserver(h);
  assert.equal(wrapper.querySelector(".tf2te-item-history-link").href, "https://next.backpack.tf/item/1");

  // Simulates Steam's own PutItemInSlot swapping a different item into this
  // same slot wrapper (the slot element itself is reused positionally - see
  // EnsureSufficientTradeSlots in tradeSlotOverrides.js).
  wrapper.removeChild(itemA);
  const itemB = makeSlotItemEl({ assetid: "999", marketHashName: "Scattergun" });
  wrapper.appendChild(itemB);
  fireYourSlotsObserver(h);

  const links = wrapper.querySelectorAll(".tf2te-item-history-link");
  assert.equal(links.length, 1, "must update the existing link, not add a second one");
  assert.equal(links[0].href, "https://next.backpack.tf/item/999");
});

test("drops a slot's history link once the slot becomes empty again", () => {
  const h = loadTradeOfferPage();
  const yourSlots = h.elementsById.get("your_slots");
  const itemEl = makeSlotItemEl({ assetid: "1", marketHashName: "Rocket Launcher" });
  const wrapper = makeSlotWrapper(itemEl);
  yourSlots.appendChild(wrapper);

  h.run();
  fireYourSlotsObserver(h);
  assert.ok(wrapper.querySelector(".tf2te-item-history-link"));

  wrapper.removeChild(itemEl);
  fireYourSlotsObserver(h);

  assert.equal(wrapper.querySelector(".tf2te-item-history-link"), null);
});

test("adds history links independently on their_slots too", () => {
  const h = loadTradeOfferPage();
  const theirSlots = h.elementsById.get("their_slots");
  const wrapper = makeSlotWrapper(makeSlotItemEl({ assetid: "42", marketHashName: "Scrap Metal" }));
  theirSlots.appendChild(wrapper);

  h.run();
  FakeMutationObserver.instances[1].cb([]);
  while (h.timers.fireNextTimeout()) {
    // drain - see fireYourSlotsObserver's own note on why
  }

  assert.equal(wrapper.querySelector(".tf2te-item-history-link").href, "https://next.backpack.tf/item/42");
});

// --- collapseDuplicateSlots' own "-" button + promptRemoveQuantity (custom
// "remove how many?" modal, offered alongside Steam's own native single-item
// removal, not in place of it - only ever shown for a collapsed stack) ---

function clickDecrementButton(representativeEl) {
  const btn = representativeEl.querySelector(".tf2te-slot-decrement");
  btn.dispatchEvent({ type: "click", stopPropagation: () => {}, preventDefault: () => {} });
  return btn;
}

test("a non-stacked slot never gets a '-' button", () => {
  const h = loadTradeOfferPage();
  const yourSlots = h.elementsById.get("your_slots");
  const wrapper = makeSlotWrapper(makeSlotItemEl({ assetid: "1", marketHashName: "Rocket Launcher" }));
  yourSlots.appendChild(wrapper);

  h.run();
  fireYourSlotsObserver(h);

  assert.equal(wrapper.querySelector(".tf2te-slot-decrement"), null);
});

test("clicking the '-' button on a stacked slot's representative opens a modal defaulting to a quantity of 1, with the resolved item name and stack size shown", () => {
  const h = loadTradeOfferPage();
  const yourSlots = h.elementsById.get("your_slots");
  const dupe1 = makeSlotWrapper(makeSlotItemEl({ assetid: "1", marketHashName: "Refined Metal" }));
  const dupe2 = makeSlotWrapper(makeSlotItemEl({ assetid: "2", marketHashName: "Refined Metal" }));
  const dupe3 = makeSlotWrapper(makeSlotItemEl({ assetid: "3", marketHashName: "Refined Metal" }));
  [dupe1, dupe2, dupe3].forEach((w) => yourSlots.appendChild(w));
  h.yourInv.rgInventory["1"] = { market_hash_name: "Refined Metal" };

  h.run();
  fireYourSlotsObserver(h);

  clickDecrementButton(dupe1);

  const overlay = h.sandbox.document.body.children[0];
  assert.ok(overlay, "expected the modal overlay to be appended to document.body");
  assert.equal(overlay.querySelector(".tf2te-remove-qty-title").textContent, "Remove how many Refined Metal?");
  assert.equal(overlay.querySelector(".tf2te-stepper-input").value, "1");
  assert.equal(overlay.querySelector(".tf2te-remove-qty-slider").value, "1");
  assert.equal(overlay.querySelector(".tf2te-remove-qty-slider").max, "3");
  assert.equal(overlay.querySelector(".tf2te-remove-qty-hint").textContent, "1 - 3 currently in the trade");
});

test("the +/- stepper buttons nudge the quantity input (and keep the slider in sync), clamped to 1..maxCount", () => {
  const h = loadTradeOfferPage();
  const yourSlots = h.elementsById.get("your_slots");
  const dupe1 = makeSlotWrapper(makeSlotItemEl({ assetid: "1", marketHashName: "Refined Metal" }));
  const dupe2 = makeSlotWrapper(makeSlotItemEl({ assetid: "2", marketHashName: "Refined Metal" }));
  const dupe3 = makeSlotWrapper(makeSlotItemEl({ assetid: "3", marketHashName: "Refined Metal" }));
  [dupe1, dupe2, dupe3].forEach((w) => yourSlots.appendChild(w));

  h.run();
  fireYourSlotsObserver(h);
  clickDecrementButton(dupe1);

  const overlay = h.sandbox.document.body.children[0];
  const stepper = overlay.querySelector(".tf2te-stepper");
  const [decBtn, incBtn] = stepper.querySelectorAll(".tf2te-stepper-btn");
  const input = overlay.querySelector(".tf2te-stepper-input");
  const slider = overlay.querySelector(".tf2te-remove-qty-slider");

  decBtn.dispatchEvent({ type: "click" }); // 1 - 1, clamped to min 1
  assert.equal(input.value, "1");
  assert.equal(slider.value, "1");

  incBtn.dispatchEvent({ type: "click" });
  incBtn.dispatchEvent({ type: "click" });
  assert.equal(input.value, "3");
  assert.equal(slider.value, "3");

  incBtn.dispatchEvent({ type: "click" }); // 3 + 1, clamped to max 3
  assert.equal(input.value, "3");
});

test("dragging the slider updates the number input to match", () => {
  const h = loadTradeOfferPage();
  const yourSlots = h.elementsById.get("your_slots");
  const dupe1 = makeSlotWrapper(makeSlotItemEl({ assetid: "1", marketHashName: "Refined Metal" }));
  const dupe2 = makeSlotWrapper(makeSlotItemEl({ assetid: "2", marketHashName: "Refined Metal" }));
  const dupe3 = makeSlotWrapper(makeSlotItemEl({ assetid: "3", marketHashName: "Refined Metal" }));
  [dupe1, dupe2, dupe3].forEach((w) => yourSlots.appendChild(w));

  h.run();
  fireYourSlotsObserver(h);
  clickDecrementButton(dupe1);

  const overlay = h.sandbox.document.body.children[0];
  const slider = overlay.querySelector(".tf2te-remove-qty-slider");
  const input = overlay.querySelector(".tf2te-stepper-input");

  slider.value = "2";
  slider.dispatchEvent({ type: "input" });

  assert.equal(input.value, "2");
});

test("typing a valid number in the input moves the slider to match", () => {
  const h = loadTradeOfferPage();
  const yourSlots = h.elementsById.get("your_slots");
  const dupe1 = makeSlotWrapper(makeSlotItemEl({ assetid: "1", marketHashName: "Refined Metal" }));
  const dupe2 = makeSlotWrapper(makeSlotItemEl({ assetid: "2", marketHashName: "Refined Metal" }));
  const dupe3 = makeSlotWrapper(makeSlotItemEl({ assetid: "3", marketHashName: "Refined Metal" }));
  [dupe1, dupe2, dupe3].forEach((w) => yourSlots.appendChild(w));

  h.run();
  fireYourSlotsObserver(h);
  clickDecrementButton(dupe1);

  const overlay = h.sandbox.document.body.children[0];
  const slider = overlay.querySelector(".tf2te-remove-qty-slider");
  const input = overlay.querySelector(".tf2te-stepper-input");

  input.value = "1";
  input.dispatchEvent({ type: "input" });

  assert.equal(slider.value, "1");
});

test("confirming a custom quantity removes exactly that many items from the stack, in group order, and closes the modal", async () => {
  const h = loadTradeOfferPage();
  const yourSlots = h.elementsById.get("your_slots");
  const dupe1 = makeSlotWrapper(makeSlotItemEl({ assetid: "1", marketHashName: "Refined Metal" }));
  const dupe2 = makeSlotWrapper(makeSlotItemEl({ assetid: "2", marketHashName: "Refined Metal" }));
  const dupe3 = makeSlotWrapper(makeSlotItemEl({ assetid: "3", marketHashName: "Refined Metal" }));
  [dupe1, dupe2, dupe3].forEach((w) => yourSlots.appendChild(w));

  h.run();
  fireYourSlotsObserver(h);
  clickDecrementButton(dupe1);

  const overlay = h.sandbox.document.body.children[0];
  overlay.querySelector(".tf2te-stepper-input").value = "2";

  let removedItems = null;
  h.windowObj.__tf2te__.removeItemsFromTrade = (items) => {
    removedItems = items;
  };
  overlay.querySelector(".tf2te-remove-qty-confirm").dispatchEvent({ type: "click" });
  await Promise.resolve();

  // removedItems is a sandbox-realm array (built via the production code's
  // own .slice() inside the vm context) - Array.from here (called from the
  // outer realm) normalizes it to a plain outer-realm array first, since
  // assert.deepStrictEqual treats cross-realm Array instances as distinct
  // types even when their contents are identical.
  assert.deepEqual(
    Array.from(removedItems, (el) => el.getAttribute("id")),
    ["item440_2_1", "item440_2_2"]
  );
  assert.equal(h.sandbox.document.body.children.length, 0, "modal should be closed after confirming");
});

test("clicking Cancel on the quantity modal closes it without removing anything", async () => {
  const h = loadTradeOfferPage();
  const yourSlots = h.elementsById.get("your_slots");
  const dupe1 = makeSlotWrapper(makeSlotItemEl({ assetid: "1", marketHashName: "Refined Metal" }));
  const dupe2 = makeSlotWrapper(makeSlotItemEl({ assetid: "2", marketHashName: "Refined Metal" }));
  [dupe1, dupe2].forEach((w) => yourSlots.appendChild(w));

  h.run();
  fireYourSlotsObserver(h);
  clickDecrementButton(dupe1);

  const overlay = h.sandbox.document.body.children[0];
  let called = false;
  h.windowObj.__tf2te__.removeItemsFromTrade = () => {
    called = true;
  };
  overlay.querySelector(".tf2te-remove-qty-cancel").dispatchEvent({ type: "click" });
  await Promise.resolve();

  assert.equal(called, false);
  assert.equal(h.sandbox.document.body.children.length, 0);
});

test("entering an out-of-range quantity keeps the modal open, marks the input invalid, and removes nothing", async () => {
  const h = loadTradeOfferPage();
  const yourSlots = h.elementsById.get("your_slots");
  const dupe1 = makeSlotWrapper(makeSlotItemEl({ assetid: "1", marketHashName: "Refined Metal" }));
  const dupe2 = makeSlotWrapper(makeSlotItemEl({ assetid: "2", marketHashName: "Refined Metal" }));
  [dupe1, dupe2].forEach((w) => yourSlots.appendChild(w));

  h.run();
  fireYourSlotsObserver(h);
  clickDecrementButton(dupe1);

  const overlay = h.sandbox.document.body.children[0];
  const input = overlay.querySelector(".tf2te-stepper-input");
  input.value = "99";

  let called = false;
  h.windowObj.__tf2te__.removeItemsFromTrade = () => {
    called = true;
  };
  overlay.querySelector(".tf2te-remove-qty-confirm").dispatchEvent({ type: "click" });
  await Promise.resolve();

  assert.equal(called, false);
  assert.equal(h.sandbox.document.body.children.length, 1, "modal should stay open");
  // Invalid state lives on the stepper wrapper (the visible field box) now
  // that the input itself is borderless inside it - see the ghost-stepper
  // conversion's own note.
  assert.ok(overlay.querySelector(".tf2te-stepper").classList.contains("tf2te-remove-qty-invalid"));
});

// Feature test (requested live - "we should be able to remove a specific
// item which we don't need"): a toggle link switches the remove modal from
// "how many" (unchanged) to a per-item checklist, letting the user pick
// EXACTLY which real item(s) get removed instead of always the first N in
// trade-window order.
test("switching to checklist mode and checking a specific item removes exactly that one, not the first in trade-window order", async () => {
  const h = loadTradeOfferPage();
  const yourSlots = h.elementsById.get("your_slots");
  const dupe1 = makeSlotWrapper(makeSlotItemEl({ assetid: "1", marketHashName: "Strange Rocket Launcher" }));
  const dupe2 = makeSlotWrapper(makeSlotItemEl({ assetid: "2", marketHashName: "Strange Rocket Launcher" }));
  const dupe3 = makeSlotWrapper(makeSlotItemEl({ assetid: "3", marketHashName: "Strange Rocket Launcher" }));
  [dupe1, dupe2, dupe3].forEach((w) => yourSlots.appendChild(w));
  h.yourInv.rgInventory["1"] = { market_hash_name: "Strange Rocket Launcher", type: "Strange Rocket Launcher - Kills: 128" };
  h.yourInv.rgInventory["2"] = { market_hash_name: "Strange Rocket Launcher", type: "Strange Rocket Launcher - Kills: 4" };
  h.yourInv.rgInventory["3"] = { market_hash_name: "Strange Rocket Launcher", type: "Strange Rocket Launcher - Kills: 971" };

  h.run();
  fireYourSlotsObserver(h);
  clickDecrementButton(dupe1);

  const overlay = h.sandbox.document.body.children[0];
  overlay.querySelector(".tf2te-remove-mode-toggle-to-specific").dispatchEvent({ type: "click", preventDefault: () => {} });

  assert.equal(overlay.querySelector(".tf2te-remove-qty-title").textContent, "Which Strange Rocket Launcher(s) do you want to remove?");
  const rows = overlay.querySelectorAll(".tf2te-remove-pick-row");
  assert.equal(rows.length, 3);
  assert.equal(rows[1].querySelector("span").textContent, "Item 2 of 3: Strange Rocket Launcher - Kills: 4");

  const confirmBtn = overlay.querySelector(".tf2te-remove-qty-confirm");
  assert.equal(confirmBtn.disabled, true, "nothing selected yet");

  // Check only the middle one (the low-kill-count one someone would
  // actually want gone) - NOT the first in trade-window order.
  const checkbox = rows[1].querySelector(".tf2te-remove-pick-checkbox");
  checkbox.checked = true;
  checkbox.dispatchEvent({ type: "change" });
  assert.equal(confirmBtn.disabled, false);
  assert.equal(confirmBtn.textContent, "Remove (1 selected)");

  let removedItems = null;
  h.windowObj.__tf2te__.removeItemsFromTrade = (items) => {
    removedItems = items;
  };
  confirmBtn.dispatchEvent({ type: "click" });
  await Promise.resolve();

  assert.deepEqual(Array.from(removedItems, (el) => el.getAttribute("id")), ["item440_2_2"]);
  assert.equal(h.sandbox.document.body.children.length, 0, "modal should be closed after confirming");
});

test("the checklist mode's Remove button stays disabled with nothing checked, and confirming does nothing", async () => {
  const h = loadTradeOfferPage();
  const yourSlots = h.elementsById.get("your_slots");
  const dupe1 = makeSlotWrapper(makeSlotItemEl({ assetid: "1", marketHashName: "Refined Metal" }));
  const dupe2 = makeSlotWrapper(makeSlotItemEl({ assetid: "2", marketHashName: "Refined Metal" }));
  [dupe1, dupe2].forEach((w) => yourSlots.appendChild(w));

  h.run();
  fireYourSlotsObserver(h);
  clickDecrementButton(dupe1);

  const overlay = h.sandbox.document.body.children[0];
  overlay.querySelector(".tf2te-remove-mode-toggle-to-specific").dispatchEvent({ type: "click", preventDefault: () => {} });

  let called = false;
  h.windowObj.__tf2te__.removeItemsFromTrade = () => {
    called = true;
  };
  overlay.querySelector(".tf2te-remove-qty-confirm").dispatchEvent({ type: "click" });
  await Promise.resolve();

  assert.equal(called, false);
  assert.equal(h.sandbox.document.body.children.length, 1, "modal should still be open");
});

test("toggling back to quantity mode from the checklist restores the original title and re-enables plain quantity removal", async () => {
  const h = loadTradeOfferPage();
  const yourSlots = h.elementsById.get("your_slots");
  const dupe1 = makeSlotWrapper(makeSlotItemEl({ assetid: "1", marketHashName: "Refined Metal" }));
  const dupe2 = makeSlotWrapper(makeSlotItemEl({ assetid: "2", marketHashName: "Refined Metal" }));
  [dupe1, dupe2].forEach((w) => yourSlots.appendChild(w));
  h.yourInv.rgInventory["1"] = { market_hash_name: "Refined Metal" };

  h.run();
  fireYourSlotsObserver(h);
  clickDecrementButton(dupe1);

  const overlay = h.sandbox.document.body.children[0];
  overlay.querySelector(".tf2te-remove-mode-toggle-to-specific").dispatchEvent({ type: "click", preventDefault: () => {} });
  overlay.querySelector(".tf2te-remove-mode-toggle-to-quantity").dispatchEvent({ type: "click", preventDefault: () => {} });

  assert.equal(overlay.querySelector(".tf2te-remove-qty-title").textContent, "Remove how many Refined Metal?");
  assert.equal(overlay.querySelector(".tf2te-remove-qty-confirm").disabled, false);

  let removedItems = null;
  h.windowObj.__tf2te__.removeItemsFromTrade = (items) => {
    removedItems = items;
  };
  overlay.querySelector(".tf2te-remove-qty-confirm").dispatchEvent({ type: "click" });
  await Promise.resolve();

  assert.deepEqual(Array.from(removedItems, (el) => el.getAttribute("id")), ["item440_2_1"]);
});

test("works independently on their_slots too, resolving the item name from the partner's inventory", () => {
  const h = loadTradeOfferPage();
  const theirSlots = h.elementsById.get("their_slots");
  const dupe1 = makeSlotWrapper(makeSlotItemEl({ assetid: "10", marketHashName: "Mann Co. Supply Crate Key" }));
  const dupe2 = makeSlotWrapper(makeSlotItemEl({ assetid: "11", marketHashName: "Mann Co. Supply Crate Key" }));
  [dupe1, dupe2].forEach((w) => theirSlots.appendChild(w));
  h.theirInv.rgInventory["10"] = { market_hash_name: "Mann Co. Supply Crate Key" };

  h.run();
  FakeMutationObserver.instances[1].cb([]);
  while (h.timers.fireNextTimeout()) {
    // drain - see fireYourSlotsObserver's own note on why
  }

  clickDecrementButton(dupe1);

  const overlay = h.sandbox.document.body.children[0];
  assert.ok(overlay);
  assert.equal(overlay.querySelector(".tf2te-remove-qty-title").textContent, "Remove how many Mann Co. Supply Crate Key?");
});

// --- item summary (dumpSummary via the inventory-loaded event chain) ---

test("summarize renders a backpack.tf-linked item summary with per-item badges, grouped by identical attributes", () => {
  const h = loadTradeOfferPage();
  const yourSlots = h.elementsById.get("your_slots");
  const itemA = makeSlotItemEl({ assetid: "101", marketHashName: "Rocket Launcher" });
  const itemB = makeSlotItemEl({ assetid: "102", marketHashName: "Rocket Launcher" }); // same attrs -> grouped with A
  const itemC = makeSlotItemEl({ assetid: "103", strange: true, marketHashName: "Strange Rocket Launcher" });
  yourSlots.appendChild(itemA);
  yourSlots.appendChild(itemB);
  yourSlots.appendChild(itemC);
  h.yourInv.rgInventory["101"] = { id: "101" };
  h.yourInv.rgInventory["102"] = { id: "102" };
  h.yourInv.rgInventory["103"] = { id: "103" };

  h.run();

  // Trigger the "inventory added to page" MutationObserver, which is what
  // actually calls customizeElements -> tradeOfferWindow.summarize
  // synchronously (see this file's own header note on why this path is used
  // instead of the slots-mutation debounce timer).
  const invObserver = FakeMutationObserver.instances[FakeMutationObserver.instances.length - 1];
  invObserver.cb([{ addedNodes: [{ id: `inventory_${h.STEAMID}_440_2` }] }]);

  const html = h.getHtml("your_summary");
  assert.match(html, /My summary \(3 items\)</);
  // MUST be classic backpack.tf, not next - confirmed live next's inventory
  // page doesn't support ?select= at all (see production code's own note).
  assert.match(html, /href="https:\/\/backpack\.tf\/profiles\/STEAMIDYOU\?select=101,102,103"/);
  assert.equal(html.includes("next.backpack.tf"), false);
  // two identical (non-strange) items grouped under one badge showing "×2"
  assert.match(html, /<span class="summary_badge">×2<\/span>/);
  assert.match(html, /class="summary_item strange"/);
});

// Regression test: seen as the auto-add-by-name (for_item_name=) feature
// only ever working after a manual page refresh, never on first load. Root
// cause: the "observe inventory changes" MutationObserver only ever reports
// FUTURE childList changes to #inventories - if Steam's own
// #inventory_{steamid}_{appid}_{contextid} container is already sitting
// there (a fast/cached inventory racing ahead of tradeoffer.js's own earlier
// synchronous setup work) by the time that observer is attached, it's missed
// entirely and every inventoryManager.register()'d callback for that side
// (including the auto-add-by-name pre-add logic) silently never fires. A
// page refresh "fixed" it only by accident - V8's warm code cache lets the
// extension's own script re-execute faster on a second load, more often
// winning the race against Steam's own (roughly constant-latency) inventory
// fetch. Fixed by also checking #inventories' current children (deferred via
// a microtask, NOT called synchronously - see production code's own note on
// why calling it synchronously broke auto-add entirely, a regression from an
// earlier version of this same fix) before observer.observe() is ever
// called, closing the race outright.
test("REGRESSION: an inventory container already present in #inventories BEFORE fn() runs is still processed - not just ones the MutationObserver happens to catch afterward", async () => {
  const h = loadTradeOfferPage();
  const yourSlots = h.elementsById.get("your_slots");
  const itemA = makeSlotItemEl({ assetid: "101", marketHashName: "Rocket Launcher" });
  const itemB = makeSlotItemEl({ assetid: "102", marketHashName: "Rocket Launcher" });
  yourSlots.appendChild(itemA);
  yourSlots.appendChild(itemB);
  h.yourInv.rgInventory["101"] = { id: "101" };
  h.yourInv.rgInventory["102"] = { id: "102" };

  // Steam has ALREADY inserted this inventory's own container into
  // #inventories before fn() (and its own MutationObserver) ever runs -
  // appended directly, not via the observer's own cb(), since the whole
  // point is this node must pre-date the observer's attachment.
  const inventoryNode = new FakeElement("div");
  inventoryNode.setAttribute("id", `inventory_${h.STEAMID}_440_2`);
  h.elementsById.get("inventories").appendChild(inventoryNode);

  h.run();
  // The "already there" check is deferred via Promise.resolve().then(...),
  // matching a real MutationObserver callback's own microtask timing (see
  // production code's own note) - fn() itself has already fully returned by
  // this point, same as it always would have for a live-caught mutation too.
  await Promise.resolve();
  await Promise.resolve();

  // No invObserver.cb(...) call anywhere - if this only relied on the
  // MutationObserver (the pre-fix behavior), this would still show nothing.
  const html = h.getHtml("your_summary");
  assert.match(html, /My summary \(2 items\)</);
});

// An #inventories child whose id doesn't name one of the two trade parties
// used to throw on inventoryManager.call's spread of users[steamid], ending
// the startup scan before the real inventory container after it.
test("an unrelated #inventories child ahead of the real inventory container doesn't stop it being processed", async () => {
  const h = loadTradeOfferPage();
  const yourSlots = h.elementsById.get("your_slots");
  yourSlots.appendChild(makeSlotItemEl({ assetid: "101", marketHashName: "Rocket Launcher" }));
  h.yourInv.rgInventory["101"] = { id: "101" };

  const unrelatedNode = new FakeElement("div");
  unrelatedNode.setAttribute("id", "inventory_pending");
  h.elementsById.get("inventories").appendChild(unrelatedNode);
  const inventoryNode = new FakeElement("div");
  inventoryNode.setAttribute("id", `inventory_${h.STEAMID}_440_2`);
  h.elementsById.get("inventories").appendChild(inventoryNode);

  h.run();
  await Promise.resolve();
  await Promise.resolve();

  assert.match(h.getHtml("your_summary"), /My summary \(1 item\)</);
});

// Regression test: same underlying bug as collapseDuplicateSlots' own
// "never collapses items carrying a Strange Part/..." test above, but for
// the item summary below the slots - two Strange Rocket Launchers with
// different Strange Parts attached were getting merged into a single
// "summary_item" with a "×2" badge (as if they were the same item twice)
// since dumpSummary's own evaluateItems used the exact same plain img/
// border/effect/uncraft/strange fingerprint.

test("summarize never groups two items together if either carries a Strange Part/Killstreak Kit/Spell marker", () => {
  const h = loadTradeOfferPage();
  const yourSlots = h.elementsById.get("your_slots");
  const itemA = makeSlotItemEl({ assetid: "101", strange: true, imgSrc: "https://example.com/rocket-launcher.png", marketHashName: "Strange Rocket Launcher" });
  addTradeCustomizationIcon(itemA, "parts", "moz-extension://test/images/icons/strange-parts.svg");
  const itemB = makeSlotItemEl({ assetid: "102", strange: true, imgSrc: "https://example.com/rocket-launcher.png", marketHashName: "Strange Rocket Launcher" });
  addTradeCustomizationIcon(itemB, "parts", "moz-extension://test/images/icons/strange-parts.svg");
  yourSlots.appendChild(itemA);
  yourSlots.appendChild(itemB);
  h.yourInv.rgInventory["101"] = { id: "101" };
  h.yourInv.rgInventory["102"] = { id: "102" };

  h.run();
  const invObserver = FakeMutationObserver.instances[FakeMutationObserver.instances.length - 1];
  invObserver.cb([{ addedNodes: [{ id: `inventory_${h.STEAMID}_440_2` }] }]);

  const html = h.getHtml("your_summary");
  assert.match(html, /My summary \(2 items\)</);
  // Two separate summary_item spans, neither carrying a "×N" badge -
  // grouped together, this would instead be one span with a "×2" badge.
  assert.equal((html.match(/class="summary_item strange"/g) || []).length, 2);
  assert.equal(html.includes("summary_badge"), false);
  // Each renders its OWN real icon (not the wrench marker's image, which
  // getItemIconSrc must skip via closest('.icons')) as its background...
  assert.equal((html.match(/background-image: url\(https:\/\/example\.com\/rocket-launcher\.png\)/g) || []).length, 2);
  assert.equal(html.includes("url(moz-extension://test/images/icons/strange-parts.svg)"), false);
  // ...plus its own bottom-left ".icons" wrench overlay, same markup shape
  // shared.js's own addAttributesToElement renders on the real slot item.
  assert.equal((html.match(/<div class="icons"><img src="moz-extension:\/\/test\/images\/icons\/strange-parts\.svg" class="parts"\/><\/div>/g) || []).length, 2);
});

test("summarize renders the Killstreak Kit icon (not the Strange Part one) for a killstreak-only item", () => {
  const h = loadTradeOfferPage();
  const yourSlots = h.elementsById.get("your_slots");
  const item = makeSlotItemEl({ assetid: "1", imgSrc: "https://example.com/rocket-launcher.png", marketHashName: "Killstreak Rocket Launcher" });
  addTradeCustomizationIcon(item, "ks", "moz-extension://test/images/icons/killstreak-1.svg");
  yourSlots.appendChild(item);
  h.yourInv.rgInventory["1"] = { id: "1" };

  h.run();
  const invObserver = FakeMutationObserver.instances[FakeMutationObserver.instances.length - 1];
  invObserver.cb([{ addedNodes: [{ id: `inventory_${h.STEAMID}_440_2` }] }]);

  const html = h.getHtml("your_summary");
  assert.match(html, /background-image: url\(https:\/\/example\.com\/rocket-launcher\.png\)/);
  assert.match(html, /<div class="icons"><img src="moz-extension:\/\/test\/images\/icons\/killstreak-1\.svg" class="ks" data-tier="1"\/><\/div>/);
  assert.equal(html.includes('class="parts"'), false);
});

test("summarize keeps each item's Killstreak tier icon", () => {
  const h = loadTradeOfferPage();
  const yourSlots = h.elementsById.get("your_slots");
  for (const [assetid, tier] of [["1", 3], ["2", 2]]) {
    const item = makeSlotItemEl({ assetid, imgSrc: `https://example.com/weapon-${assetid}.png`, marketHashName: "Killstreak Rocket Launcher" });
    addTradeCustomizationIcon(item, "ks", `moz-extension://test/images/icons/killstreak-${tier}.svg`, tier);
    yourSlots.appendChild(item);
    h.yourInv.rgInventory[assetid] = { id: assetid };
  }

  h.run();
  const invObserver = FakeMutationObserver.instances[FakeMutationObserver.instances.length - 1];
  invObserver.cb([{ addedNodes: [{ id: `inventory_${h.STEAMID}_440_2` }] }]);

  const html = h.getHtml("your_summary");
  // data-tier gives Professional's wider icon its width (shared.js's CSS).
  assert.match(html, /images\/icons\/killstreak-3\.svg" class="ks" data-tier="3"/);
  assert.match(html, /images\/icons\/killstreak-2\.svg" class="ks" data-tier="2"/);
});

test("summarize shows singular 'item' wording and no backpack.tf link for a single non-TF2-appid item", () => {
  const h = loadTradeOfferPage();
  const yourSlots = h.elementsById.get("your_slots");
  const el = makeSlotItemEl({ assetid: "5", appid: "730", marketHashName: "Something" });
  yourSlots.appendChild(el);
  h.yourInv.data["730"] = { rgContexts: { "2": { inventory: { rgInventory: { "5": { id: "5" } } } } } };

  h.run();
  const invObserver = FakeMutationObserver.instances[FakeMutationObserver.instances.length - 1];
  invObserver.cb([{ addedNodes: [{ id: `inventory_${h.STEAMID}_440_2` }] }]);

  const html = h.getHtml("your_summary");
  assert.match(html, /My summary \(1 item\)</);
  assert.equal(html.includes("backpack.tf/profiles"), false);
});

test("summarize renders an empty string (no header) when the offer has no items", () => {
  const h = loadTradeOfferPage();
  h.run();
  const invObserver = FakeMutationObserver.instances[FakeMutationObserver.instances.length - 1];
  invObserver.cb([{ addedNodes: [{ id: `inventory_${h.STEAMID}_440_2` }] }]);

  assert.equal(h.getHtml("your_summary"), "");
});

test("summarize returns an empty string when a slot item isn't found in the loaded inventory data (not properly loaded)", () => {
  const h = loadTradeOfferPage();
  const yourSlots = h.elementsById.get("your_slots");
  const el = makeSlotItemEl({ assetid: "999", marketHashName: "Ghost Item" });
  yourSlots.appendChild(el);
  // deliberately NOT registering h.yourInv.rgInventory["999"]

  h.run();
  const invObserver = FakeMutationObserver.instances[FakeMutationObserver.instances.length - 1];
  invObserver.cb([{ addedNodes: [{ id: `inventory_${h.STEAMID}_440_2` }] }]);

  assert.equal(h.getHtml("your_summary"), "");
});

// Regression test: confirmed-plausible live crash under heavy/fast
// item-adding load - evaluateItems' own inventory lookup used to only guard
// `inventory[appid]`, not `inventory[appid].rgContexts[contextid]` (an appid
// can be present in the loaded inventory data before its own specific
// context has finished loading). resolveItemName already guarded this exact
// same chain via a try/catch, which is what gave this away. Before the fix,
// this would throw inside dumpSummary -> tradeOfferWindow.summarize, and
// (see the observeSlots resilience test below) permanently break the
// observer for this side if left uncaught.
test("summarize doesn't throw when an item's appid is loaded but its own rgContexts entry isn't yet", () => {
  const h = loadTradeOfferPage();
  const yourSlots = h.elementsById.get("your_slots");
  // Uses a different appid (not 440/2, the default active-tab context
  // main()'s own setup already resolves fine during h.run() via
  // refreshNameSuggestions) so this test isolates evaluateItems' own guard
  // specifically, rather than tripping over that unrelated startup path.
  const el = makeSlotItemEl({ assetid: "1", appid: "730", marketHashName: "Something" });
  yourSlots.appendChild(el);
  h.yourInv.data["730"] = { rgContexts: {} }; // "730" is loaded, but its own context isn't

  h.run();
  const invObserver = FakeMutationObserver.instances[FakeMutationObserver.instances.length - 1];
  assert.doesNotThrow(() => {
    invObserver.cb([{ addedNodes: [{ id: `inventory_${h.STEAMID}_440_2` }] }]);
  });
  assert.equal(h.getHtml("your_summary"), "");
});

// Regression test: confirmed live ("random" missing history icons under
// heavy/fast item-adding load) - the debounced observer's own summarize()
// used to call tradeOfferWindow.summarize/collapseDuplicateSlots/
// addItemHistoryLinks with no error handling at all, AFTER already calling
// observer.disconnect() and BEFORE the matching observer.observe() call. A
// single throw from any one of the three (e.g. the rgContexts race above,
// before it was fixed) left the observer permanently disconnected - no
// future slot change would ever re-trigger summarize/collapseDuplicateSlots/
// addItemHistoryLinks again for that side, for the rest of the page's
// lifetime. Simulated here the same way: force one pass to throw (a slot
// with no id at all breaks addItemHistoryLinks' own
// itemEl.getAttribute('id').replace(...) chain), then prove a LATER,
// healthy slot change still gets fully processed - not permanently stuck.
test("a throw during one debounced summarize pass doesn't permanently break future passes (observer must always reconnect)", () => {
  const h = loadTradeOfferPage();
  const yourSlots = h.elementsById.get("your_slots");
  const badItem = makeSlotItemEl({ assetid: "1", marketHashName: "Refined Metal" });
  badItem.removeAttribute("id"); // makes addItemHistoryLinks' own id-parsing throw
  const badWrapper = makeSlotWrapper(badItem);
  yourSlots.appendChild(badWrapper);
  h.yourInv.rgInventory["1"] = { id: "1" };

  h.run();
  assert.doesNotThrow(() => fireYourSlotsObserver(h));

  // A later, healthy item is added - if the observer stayed disconnected
  // after the bad pass above, this would never get its history icon at all.
  const goodItem = makeSlotItemEl({ assetid: "2", marketHashName: "Rocket Launcher" });
  const goodWrapper = makeSlotWrapper(goodItem);
  yourSlots.appendChild(goodWrapper);
  h.yourInv.rgInventory["2"] = { id: "2" };
  fireYourSlotsObserver(h);

  assert.ok(goodWrapper.querySelector(".tf2te-item-history-link"), "a later slot change must still be fully processed");
});

// --- addItemsByName / getIDs / addIDs (collectItems: finders.name / finders.id) ---

test("clicking 'Add by name' adds the requested count of matching-named items from the active inventory", () => {
  const h = loadTradeOfferPage();
  addInventoryAsset(h, { isYou: true, id: "10", market_hash_name: "Strange Shovel" });
  addInventoryAsset(h, { isYou: true, id: "11", market_hash_name: "Strange Shovel" });
  addInventoryAsset(h, { isYou: true, id: "12", market_hash_name: "Strange Shovel" });
  addInventoryAsset(h, { isYou: true, id: "13", market_hash_name: "Something Else" });
  h.run();

  h.setVal("name_control", "Strange Shovel");
  h.setVal("name_amount_control", "2");
  h.click("btn_addname");

  assert.equal(h.TRADE_STATUS.me.assets.length, 2);
  const addedIds = h.TRADE_STATUS.me.assets.map((a) => a.assetid).sort();
  assert.deepEqual(addedIds, ["10", "11"]);
  assert.equal(h.alerts.length, 0);
  // Resets back to the default so the next "Add by name" starts fresh
  // instead of silently reusing whatever amount was just typed.
  assert.equal(h.registry.get("#name_amount_control")[0].value, 1);
  // The name field itself used to stay filled in with whatever was just
  // typed after a successful add - only the amount field was ever reset.
  assert.equal(h.registry.get("#name_control")[0].value, "");
});

test("clicking 'Add by name' alerts when fewer matching items exist than requested, stating how many are actually available, and adds NOTHING (not even a partial amount)", () => {
  const h = loadTradeOfferPage();
  addInventoryAsset(h, { isYou: true, id: "10", market_hash_name: "Strange Shovel" });
  h.run();

  h.setVal("name_control", "Strange Shovel");
  h.setVal("name_amount_control", "5");
  h.click("btn_addname");

  assert.equal(h.alerts.length, 1);
  assert.match(h.alerts[0], /Could not find 5 of "Strange Shovel"/);
  assert.match(h.alerts[0], /only 1 available/);
  // Confirmed live: addItems' own collectItems fallback pads out to
  // whatever it could find even when the full amount isn't met, and used
  // to get added anyway despite the alert saying it failed - must add
  // nothing at all when the request can't be fully satisfied.
  assert.equal(h.TRADE_STATUS.me.assets.length, 0);
  // The failed attempt leaves the typed amount in place (only a success
  // resets it) so the user can see/adjust what they asked for.
  assert.equal(h.registry.get("#name_amount_control")[0].value, "5");
});

test("clicking 'Add by name' alerts that none are available when nothing at all matches the name", () => {
  const h = loadTradeOfferPage();
  addInventoryAsset(h, { isYou: true, id: "10", market_hash_name: "Something Else" });
  h.run();

  h.setVal("name_control", "Strange Shovel");
  h.setVal("name_amount_control", "3");
  h.click("btn_addname");

  assert.equal(h.alerts.length, 1);
  assert.match(h.alerts[0], /Could not find 3 of "Strange Shovel"/);
  assert.match(h.alerts[0], /none available/);
});

// Regression test ("add by name isn't working... it's fetching my inventory
// only, even after switching to their inventory").
// addItemsByName/getDefaultsForAddItems/refreshNameSuggestions used to
// check `page.$inventorySelectYour.hasClass('active')` directly - but
// confirmed live, Steam doesn't reliably toggle an "active" class on THAT
// specific element itself when the tabs switch; only the actual
// `.inventory_user_tab.active` selector (getIDs' own already-correct check)
// does. switchToTheirInventory's own fixture keeps both signals in sync
// (documented as an assumption never actually confirmed live), which is
// exactly why this bug shipped with 1729 passing tests - the old fixture
// couldn't distinguish the two implementations at all. This test doesn't
// use that helper - it deliberately diverges them (only
// .inventory_user_tab.active moves to "their" tab; #inventory_select_your_
// inventory's OWN class is left untouched, matching what's confirmed live),
// so it would have failed against the original hasClass('active') code.
test("'Add by name' finds items in THEIR inventory once that tab is selected, even if the your-inventory element's own 'active' class never actually toggles", () => {
  const h = loadTradeOfferPage();
  addInventoryAsset(h, { isYou: true, id: "10", market_hash_name: "Strange Shovel" });
  addInventoryAsset(h, { isYou: false, id: "20", market_hash_name: "Strange Shovel" });
  h.run();

  // Only the real, confirmed-live selector moves - #inventory_select_your_
  // inventory keeps its own 'active' class exactly as it started.
  const theirTab = h.elementsById.get("inventory_select_their_inventory");
  theirTab.classList.add("inventory_user_tab", "active");
  h.registry.set(".inventory_user_tab.active", [theirTab]);

  h.setVal("name_control", "Strange Shovel");
  h.setVal("name_amount_control", "1");
  h.click("btn_addname");

  assert.equal(h.alerts.length, 0);
  assert.equal(h.TRADE_STATUS.them.assets.length, 1, "should have added from THEIR inventory");
  assert.equal(h.TRADE_STATUS.them.assets[0].assetid, "20");
  assert.equal(h.TRADE_STATUS.me.assets.length, 0, "must not have added from your own inventory");
});

// --- Tab-to-autocomplete for name_control (replaced a native <datalist> -
// see refreshNameSuggestions/findMatchingNames's own notes on why: it
// silently dropped real matches once an inventory's own unique-name count
// got large, confirmed live via a 310-name inventory) ---

// Regression test: an item genuinely owned and on-screen still wasn't
// matched by "Add by name", even after waiting - availableNames used to
// only get recomputed on a tab/app switch or a side's first inventory
// registration, not at the actual moment of typing. For a slow-loading
// inventory, Steam can still be populating its own data well after the last
// of those events already fired. This test adds an item to the inventory
// AFTER h.run() (so none of those trigger events ever see it) and confirms
// typing still finds it - it would have failed against the old "only
// refresh on specific events" version.
function getDropdownEl(h) {
  return h.elementsById.get("name_suggestion_dropdown");
}

function getDropdownRowTexts(h) {
  return getDropdownEl(h).children.map((row) => row._text);
}

test("finds an item added to the inventory AFTER the initial load - matching is recomputed fresh on every keystroke, not cached from an earlier trigger", () => {
  const h = loadTradeOfferPage();
  h.run();

  // Simulates a slow-loading inventory: this item wasn't present for any
  // of refreshNameSuggestions' own trigger events (initial setup already
  // ran above), only shows up in the data afterward.
  addInventoryAsset(h, { isYou: true, id: "10", market_hash_name: "The Patriot Peak" });

  const nameInput = h.elementsById.get("name_control");
  nameInput.value = "the pat";
  nameInput.dispatchEvent({ type: "keyup", key: "t" });

  assert.deepEqual(getDropdownRowTexts(h), ["The Patriot Peak"]);
  assert.equal(getDropdownEl(h).hasAttribute("hidden"), false);
});

test("typing a prefix shows every match as its own clickable dropdown row, alphabetically sorted", () => {
  const h = loadTradeOfferPage();
  addInventoryAsset(h, { isYou: true, id: "10", market_hash_name: "The Patriot Peak" });
  addInventoryAsset(h, { isYou: true, id: "11", market_hash_name: "The Pain Train" });
  h.run();

  const nameInput = h.elementsById.get("name_control");
  nameInput.value = "the pa";
  nameInput.dispatchEvent({ type: "keyup", key: "a" });

  assert.deepEqual(getDropdownRowTexts(h), ["The Pain Train", "The Patriot Peak"]);
  // The first match is highlighted by default, ready for an immediate Enter.
  assert.ok(getDropdownEl(h).children[0].classList.contains("tf2te-name-dropdown-row-active"));
});

// REGRESSION for a live bug report (screenshot: typing "dream" found
// nothing for an owned "G3SG1 | Dream Glade", even though it's right there
// in the name) - matching used to be prefix-only, missing anything past the
// start of the name (a CS2 skin's "Weapon | Skin Name" shape, or a TF2 item
// searched by its base name without a quality prefix, e.g. "Rocket
// Launcher" for an owned "Australium Rocket Launcher").
test("typing a substring that ISN'T a prefix still matches, anywhere in the name", () => {
  const h = loadTradeOfferPage();
  addInventoryAsset(h, { isYou: true, id: "10", market_hash_name: "G3SG1 | Dream Glade" });
  addInventoryAsset(h, { isYou: true, id: "11", market_hash_name: "Australium Rocket Launcher" });
  h.run();

  const nameInput = h.elementsById.get("name_control");
  nameInput.value = "dream";
  nameInput.dispatchEvent({ type: "keyup", key: "m" });
  assert.deepEqual(getDropdownRowTexts(h), ["G3SG1 | Dream Glade"]);

  nameInput.value = "rocket launcher";
  nameInput.dispatchEvent({ type: "keyup", key: "r" });
  assert.deepEqual(getDropdownRowTexts(h), ["Australium Rocket Launcher"]);
});

// A query matching one item by PREFIX and a different item only by
// substring must rank the prefix match first - typing "g3" for both a
// "G3SG1 | ..." skin and an unrelated "Big G3 Case" (contrived, but the
// same shape as a real collision) should offer the more likely intent
// first, not just whatever order they happen to sort alphabetically in.
test("prefix matches are ranked ahead of substring-only matches for the same query", () => {
  const h = loadTradeOfferPage();
  addInventoryAsset(h, { isYou: true, id: "10", market_hash_name: "Big G3 Case" });
  addInventoryAsset(h, { isYou: true, id: "11", market_hash_name: "G3SG1 | Dream Glade" });
  h.run();

  const nameInput = h.elementsById.get("name_control");
  nameInput.value = "g3";
  nameInput.dispatchEvent({ type: "keyup", key: "3" });

  assert.deepEqual(getDropdownRowTexts(h), ["G3SG1 | Dream Glade", "Big G3 Case"]);
});

test("clicking a dropdown row fills the input with that name and closes the dropdown", () => {
  const h = loadTradeOfferPage();
  addInventoryAsset(h, { isYou: true, id: "10", market_hash_name: "The Patriot Peak" });
  addInventoryAsset(h, { isYou: true, id: "11", market_hash_name: "The Pain Train" });
  h.run();

  const nameInput = h.elementsById.get("name_control");
  nameInput.value = "the pa";
  nameInput.dispatchEvent({ type: "keyup", key: "a" });

  getDropdownEl(h).children[1].dispatchEvent({ type: "click" }); // "The Patriot Peak"

  assert.equal(nameInput.value, "The Patriot Peak");
  assert.equal(getDropdownEl(h).hasAttribute("hidden"), true);
  assert.equal(getDropdownEl(h).children.length, 0);
});

test("ArrowDown/ArrowUp move the highlighted row, wrapping around at either end", () => {
  const h = loadTradeOfferPage();
  addInventoryAsset(h, { isYou: true, id: "10", market_hash_name: "The Patriot Peak" });
  addInventoryAsset(h, { isYou: true, id: "11", market_hash_name: "The Pain Train" });
  h.run();

  const nameInput = h.elementsById.get("name_control");
  nameInput.value = "the pa";
  nameInput.dispatchEvent({ type: "keyup", key: "a" });
  // Starts on row 0 ("The Pain Train").

  nameInput.dispatchEvent({ type: "keydown", key: "ArrowDown", preventDefault: () => {} });
  assert.ok(getDropdownEl(h).children[1].classList.contains("tf2te-name-dropdown-row-active"));

  nameInput.dispatchEvent({ type: "keydown", key: "ArrowDown", preventDefault: () => {} });
  assert.ok(getDropdownEl(h).children[0].classList.contains("tf2te-name-dropdown-row-active"), "wraps back around to the first row");

  nameInput.dispatchEvent({ type: "keydown", key: "ArrowUp", preventDefault: () => {} });
  assert.ok(getDropdownEl(h).children[1].classList.contains("tf2te-name-dropdown-row-active"), "wraps to the last row going the other way");
});

// Regression test: moving the highlight with arrow keys didn't scroll the
// list to follow it, so past the first screenful of matches the
// highlighted row went invisible without manually scrolling. The first cut
// of this fix called scrollIntoView() on the row BEFORE appending it to
// the document - a no-op on a still-detached element - so this also
// confirms the call happens on an already-attached element, not just that
// it happened at all.
test("ArrowDown scrolls the newly-highlighted row into view, on an element already attached to the document", () => {
  const h = loadTradeOfferPage();
  addInventoryAsset(h, { isYou: true, id: "10", market_hash_name: "The Patriot Peak" });
  addInventoryAsset(h, { isYou: true, id: "11", market_hash_name: "The Pain Train" });
  h.run();

  const nameInput = h.elementsById.get("name_control");
  nameInput.value = "the pa";
  nameInput.dispatchEvent({ type: "keyup", key: "a" });

  const rowsAfterFirstMatch = getDropdownEl(h).children;
  assert.deepEqual(rowsAfterFirstMatch[0]._scrollIntoViewCalls?.length, 1, "the initially-highlighted row (index 0) should already have scrolled itself into view");
  assert.equal(rowsAfterFirstMatch[0]._scrollIntoViewCalls[0].wasConnected, true, "must run on an element already attached to <body>, not a still-detached one");

  nameInput.dispatchEvent({ type: "keydown", key: "ArrowDown", preventDefault: () => {} });

  const rowsAfterArrowDown = getDropdownEl(h).children;
  assert.equal(rowsAfterArrowDown[1]._scrollIntoViewCalls?.length, 1, "the newly-highlighted row (index 1) should have scrolled itself into view");
  assert.equal(rowsAfterArrowDown[1]._scrollIntoViewCalls[0].wasConnected, true);
  assert.equal(rowsAfterArrowDown[1]._scrollIntoViewCalls[0].options.block, "nearest", "must scroll only as far as needed, not force it to the top/center");
});

test("Enter accepts the highlighted row into the input, closes the dropdown, and does NOT also submit 'Add by name' on that same keypress", () => {
  const h = loadTradeOfferPage();
  addInventoryAsset(h, { isYou: true, id: "10", market_hash_name: "The Patriot Peak" });
  h.run();

  const nameInput = h.elementsById.get("name_control");
  nameInput.value = "the pa";
  nameInput.dispatchEvent({ type: "keyup", key: "a" });

  nameInput.dispatchEvent({ type: "keydown", key: "Enter", preventDefault: () => {} });
  assert.equal(nameInput.value, "The Patriot Peak");
  assert.equal(getDropdownEl(h).hasAttribute("hidden"), true);

  // The keypress handler still fires right after keydown (same physical
  // Enter press) - it must skip submitting, not add the item immediately.
  nameInput.dispatchEvent({ type: "keypress", which: 13 });
  assert.equal(h.TRADE_STATUS.me.assets.length, 0, "must not have added anything yet from the accept-keypress");

  // A second, distinct Enter press (dropdown now closed/nothing
  // highlighted) submits normally.
  nameInput.dispatchEvent({ type: "keypress", which: 13 });
  assert.equal(h.TRADE_STATUS.me.assets.length, 1);
});

test("Escape closes the dropdown without changing the input", () => {
  const h = loadTradeOfferPage();
  addInventoryAsset(h, { isYou: true, id: "10", market_hash_name: "The Patriot Peak" });
  h.run();

  const nameInput = h.elementsById.get("name_control");
  nameInput.value = "the pa";
  nameInput.dispatchEvent({ type: "keyup", key: "a" });

  nameInput.dispatchEvent({ type: "keydown", key: "Escape" });

  assert.equal(nameInput.value, "the pa");
  assert.equal(getDropdownEl(h).hasAttribute("hidden"), true);
});

test("blurring the field closes the dropdown", () => {
  const h = loadTradeOfferPage();
  addInventoryAsset(h, { isYou: true, id: "10", market_hash_name: "The Patriot Peak" });
  h.run();

  const nameInput = h.elementsById.get("name_control");
  nameInput.value = "the pa";
  nameInput.dispatchEvent({ type: "keyup", key: "a" });
  assert.equal(getDropdownEl(h).hasAttribute("hidden"), false);

  nameInput.dispatchEvent({ type: "blur" });
  assert.equal(getDropdownEl(h).hasAttribute("hidden"), true);
});

test("no matches closes/hides the dropdown", () => {
  const h = loadTradeOfferPage();
  addInventoryAsset(h, { isYou: true, id: "10", market_hash_name: "Refined Metal" });
  h.run();

  const nameInput = h.elementsById.get("name_control");
  nameInput.value = "zzz";
  nameInput.dispatchEvent({ type: "keyup", key: "z" });

  assert.equal(getDropdownEl(h).hasAttribute("hidden"), true);
  assert.equal(getDropdownEl(h).children.length, 0);
});

test("a successful 'Add by name' closes the dropdown too, not just the input/amount fields", () => {
  const h = loadTradeOfferPage();
  addInventoryAsset(h, { isYou: true, id: "10", market_hash_name: "The Patriot Peak" });
  h.run();

  const nameInput = h.elementsById.get("name_control");
  nameInput.value = "the pa";
  nameInput.dispatchEvent({ type: "keyup", key: "a" });
  assert.equal(getDropdownEl(h).hasAttribute("hidden"), false);

  h.setVal("name_control", "The Patriot Peak");
  h.click("btn_addname");

  assert.equal(getDropdownEl(h).hasAttribute("hidden"), true);
});

test("'Add by name' does nothing for a blank/whitespace-only name", () => {
  const h = loadTradeOfferPage();
  addInventoryAsset(h, { isYou: true, id: "10", market_hash_name: "Strange Shovel" });
  h.run();

  h.setVal("name_control", "   ");
  h.click("btn_addname");

  assert.equal(h.TRADE_STATUS.me.assets.length, 0);
  assert.equal(h.alerts.length, 0);
});

test("getIDs collects asset ids currently in the active side's trade slots, and addIDs re-adds by that id list", () => {
  const h = loadTradeOfferPage();
  const theirSlots = h.elementsById.get("their_slots");
  // simulate items already sitting in "their" trade slots (getIDs reads .rgItem.id off these)
  const already1 = makeSlotItemEl({ assetid: "20", marketHashName: "Team Captain" });
  theirSlots.appendChild(already1);
  addInventoryAsset(h, { isYou: false, id: "21", market_hash_name: "Team Captain" });
  h.run();
  switchToTheirInventory(h);

  h.click("btn_getids");
  assert.equal(h.registry.get("#ids_control")[0].value, "20");

  h.setVal("ids_control", "21");
  h.click("btn_addids");

  assert.equal(h.TRADE_STATUS.them.assets.length, 1);
  assert.equal(h.TRADE_STATUS.them.assets[0].assetid, "21");
});

test("addIDs adds every id from a list typed with spaces after the commas", () => {
  const h = loadTradeOfferPage();
  addInventoryAsset(h, { isYou: false, id: "21", market_hash_name: "Team Captain" });
  addInventoryAsset(h, { isYou: false, id: "22", market_hash_name: "Team Captain" });
  h.run();
  switchToTheirInventory(h);

  h.setVal("ids_control", "21, 22");
  h.click("btn_addids");

  assert.deepEqual(
    h.TRADE_STATUS.them.assets.map((asset) => asset.assetid),
    ["21", "22"]
  );
});

test("addIDs silently does nothing for an invalid (non-numeric) id list", () => {
  const h = loadTradeOfferPage();
  addInventoryAsset(h, { isYou: true, id: "1", market_hash_name: "Refined Metal" });
  h.run();

  h.setVal("ids_control", "not-a-number");
  h.click("btn_addids");

  assert.equal(h.TRADE_STATUS.me.assets.length, 0);
});

// --- Add Keys / Add Metal (collectItems: identifiers.isKey / getItemsForMetal) ---

test("clicking 'Add Keys' adds the requested number of Mann Co. Supply Crate Keys", () => {
  const h = loadTradeOfferPage();
  addInventoryAsset(h, { isYou: true, id: "1", market_hash_name: "Mann Co. Supply Crate Key" });
  addInventoryAsset(h, { isYou: true, id: "2", market_hash_name: "Mann Co. Supply Crate Key" });
  addInventoryAsset(h, { isYou: true, id: "3", market_hash_name: "Refined Metal" });
  h.run();

  h.setVal("keys_amount_control", "2");
  h.click("btn_addkeys");

  assert.equal(h.TRADE_STATUS.me.assets.length, 2);
  assert.deepEqual(h.TRADE_STATUS.me.assets.map((a) => a.assetid).sort(), ["1", "2"]);
  assert.equal(h.alerts.length, 0);
  // Resets back to blank (its own default - see getDefaultsForAddItems'
  // own note on why blank, not a literal "1") so the next click starts
  // fresh instead of silently reusing whatever amount was just typed.
  assert.equal(h.registry.get("#keys_amount_control")[0].value, "");
});

test("clicking 'Add Keys' for more than are available alerts how many actually are, and adds NOTHING (not even a partial amount)", () => {
  const h = loadTradeOfferPage();
  addInventoryAsset(h, { isYou: true, id: "1", market_hash_name: "Mann Co. Supply Crate Key" });
  h.run();

  h.setVal("keys_amount_control", "5");
  h.click("btn_addkeys");

  assert.equal(h.TRADE_STATUS.me.assets.length, 0);
  assert.equal(h.alerts.length, 1);
  assert.match(h.alerts[0], /Could not find 5 Mann Co\. Supply Crate Keys/);
  assert.match(h.alerts[0], /only 1 available/);
  // A failed attempt leaves the typed amount in place.
  assert.equal(h.registry.get("#keys_amount_control")[0].value, "5");
});

// No inventory panel visible yet (the same still-loading state the "main()
// doesn't crash" regression test below covers): pickItems has no app/context
// to read from. It used to return undefined there, so the click handler
// threw a TypeError (no alert at all) instead of reporting "none available".
test("clicking 'Add Keys' / 'Add Metals' / 'Add by name' while no inventory is visible alerts 'none available' instead of throwing", () => {
  const h = loadTradeOfferPage();
  addInventoryAsset(h, { isYou: true, id: "1", market_hash_name: "Mann Co. Supply Crate Key" });
  h.run();
  h.registry.set(".inventory_ctn:visible", []);

  h.setVal("keys_amount_control", "1");
  assert.doesNotThrow(() => h.click("btn_addkeys"));
  h.setVal("metal_amount_control", "1");
  assert.doesNotThrow(() => h.click("btn_addmetal"));
  h.setVal("name_control", "Mann Co. Supply Crate Key");
  assert.doesNotThrow(() => h.click("btn_addname"));

  assert.equal(h.TRADE_STATUS.me.assets.length, 0);
  assert.equal(h.alerts.length, 3);
  assert.match(h.alerts[0], /Could not find 1 Mann Co\. Supply Crate Key \(none available\)/);
  assert.match(h.alerts[1], /Could not make 1\.00 ref \(none available\)/);
  assert.match(h.alerts[2], /none available/);
});

test("clicking 'Add Keys' with a fractional amount alerts and adds nothing, instead of rounding up to an extra key", () => {
  const h = loadTradeOfferPage();
  for (const id of ["1", "2", "3"]) {
    addInventoryAsset(h, { isYou: true, id, market_hash_name: "Mann Co. Supply Crate Key" });
  }
  h.run();

  h.setVal("keys_amount_control", "2.5");
  h.click("btn_addkeys");

  assert.equal(h.TRADE_STATUS.me.assets.length, 0);
  assert.equal(h.alerts.length, 1);
  assert.match(h.alerts[0], /whole number/);
  assert.equal(h.registry.get("#keys_amount_control")[0].value, "2.5");
});

function keysFieldEvent(h, evt) {
  let prevented = false;
  h.registry.get("#keys_amount_control")[0].dispatchEvent({ ...evt, preventDefault: () => (prevented = true) });
  return prevented;
}

test("the keys field refuses non-digit keystrokes (decimal separators, letters, signs) but allows digits, editing keys and shortcuts", () => {
  const h = loadTradeOfferPage();
  h.run();

  for (const key of [".", ",", "e", "a", "-", "+", " "]) {
    assert.equal(keysFieldEvent(h, { type: "keydown", key }), true, `"${key}" should be blocked`);
  }
  for (const key of ["0", "5", "9", "Backspace", "Delete", "ArrowLeft", "Tab", "Enter"]) {
    assert.equal(keysFieldEvent(h, { type: "keydown", key }), false, `"${key}" should be allowed`);
  }
  assert.equal(keysFieldEvent(h, { type: "keydown", key: "v", ctrlKey: true }), false, "Ctrl+V should be allowed");
  assert.equal(keysFieldEvent(h, { type: "keydown", key: "a", metaKey: true }), false, "Cmd+A should be allowed");
});

test("the keys field only accepts a pasted whole number", () => {
  const h = loadTradeOfferPage();
  h.run();
  const paste = (text) =>
    keysFieldEvent(h, { type: "paste", originalEvent: { clipboardData: { getData: () => text } } });

  assert.equal(paste("3"), false);
  assert.equal(paste(" 12 "), false);
  assert.equal(paste("2.5"), true);
  assert.equal(paste("2,5"), true);
  assert.equal(paste("abc"), true);
  assert.equal(paste(""), true);
});

test("the showAlert() popup renders as a dismissible modal (not a native alert()), closable via OK, Escape, or clicking outside the box", () => {
  const h = loadTradeOfferPage();
  addInventoryAsset(h, { isYou: true, id: "1", market_hash_name: "Mann Co. Supply Crate Key" });
  h.run();

  h.setVal("keys_amount_control", "5");
  h.click("btn_addkeys");

  const overlay = h.sandbox.document.body.children[0];
  assert.ok(overlay, "expected the alert modal overlay to be appended to document.body");
  assert.ok(overlay.classList.contains("tf2te-alert-overlay"));
  assert.match(overlay.querySelector(".tf2te-alert-message").textContent, /Could not find 5 Mann Co\. Supply Crate Keys/);

  const okBtn = overlay.querySelector(".tf2te-alert-ok");
  assert.equal(okBtn.textContent, "OK");
  okBtn.dispatchEvent({ type: "click" });

  assert.equal(h.sandbox.document.body.children.length, 0, "OK should remove the overlay from the DOM");
});

test("the showAlert() popup closes on Escape and on clicking the dimmed backdrop, but not on clicking inside the box", () => {
  const h = loadTradeOfferPage();
  h.run();

  h.setVal("keys_amount_control", "5");
  h.click("btn_addkeys");

  let overlay = h.sandbox.document.body.children[0];
  // The Escape/Enter handler is registered on `document`, not the overlay
  // itself (so it works no matter what has focus).
  h.sandbox.document.dispatchEvent({ type: "keydown", key: "Escape" });
  assert.equal(h.sandbox.document.body.children.length, 0, "Escape should remove the overlay");

  h.setVal("keys_amount_control", "5");
  h.click("btn_addkeys");
  overlay = h.sandbox.document.body.children[0];
  const box = overlay.querySelector(".tf2te-alert-box");
  // The click-outside guard lives on the overlay itself and checks
  // `e.target === overlay` - simulating a real click bubbling up from an
  // inner element (target is the box, not the overlay) here.
  overlay.dispatchEvent({ type: "click", target: box });
  assert.equal(h.sandbox.document.body.children.length, 1, "clicking inside the box should not close it");

  overlay.dispatchEvent({ type: "click", target: overlay });
  assert.equal(h.sandbox.document.body.children.length, 0, "clicking the backdrop should close it");
});

test("clicking 'Add Keys' when none at all are available alerts that none are available", () => {
  const h = loadTradeOfferPage();
  addInventoryAsset(h, { isYou: true, id: "1", market_hash_name: "Refined Metal" });
  h.run();

  h.setVal("keys_amount_control", "1");
  h.click("btn_addkeys");

  assert.equal(h.TRADE_STATUS.me.assets.length, 0);
  assert.match(h.alerts[0], /Could not find 1 Mann Co\. Supply Crate Key /);
  assert.match(h.alerts[0], /none available/);
});

test("clicking 'Add Keys' with the field left blank defaults to adding 1 key", () => {
  const h = loadTradeOfferPage();
  addInventoryAsset(h, { isYou: true, id: "1", market_hash_name: "Mann Co. Supply Crate Key" });
  h.run();

  h.setVal("keys_amount_control", "");
  h.click("btn_addkeys");

  assert.equal(h.TRADE_STATUS.me.assets.length, 1);
  assert.equal(h.alerts.length, 0);
});

test("clicking 'Add Metal' picks the fewest metal items (highest denominations first) to reach the requested value", () => {
  const h = loadTradeOfferPage();
  addInventoryAsset(h, { isYou: true, id: "1", market_hash_name: "Refined Metal" });
  addInventoryAsset(h, { isYou: true, id: "2", market_hash_name: "Reclaimed Metal" });
  addInventoryAsset(h, { isYou: true, id: "3", market_hash_name: "Scrap Metal" });
  h.run();

  // 1.44 ref = 13 scrap = 1 refined (9) + 1 reclaimed (3) + 1 scrap (1)
  h.setVal("metal_amount_control", "1.44");
  h.click("btn_addmetal");

  assert.equal(h.TRADE_STATUS.me.assets.length, 3);
  assert.deepEqual(h.TRADE_STATUS.me.assets.map((a) => a.assetid).sort(), ["1", "2", "3"]);
  assert.equal(h.alerts.length, 0);
  // Resets back to blank so the next click starts fresh.
  assert.equal(h.registry.get("#metal_amount_control")[0].value, "");
});

test("clicking 'Add Metal' for more value than is achievable alerts the true max achievable, and adds NOTHING", () => {
  const h = loadTradeOfferPage();
  addInventoryAsset(h, { isYou: true, id: "1", market_hash_name: "Refined Metal" }); // 1 ref achievable
  h.run();

  h.setVal("metal_amount_control", "5");
  h.click("btn_addmetal");

  assert.equal(h.TRADE_STATUS.me.assets.length, 0);
  assert.equal(h.alerts.length, 1);
  assert.match(h.alerts[0], /Could not make 5\.00 ref/);
  assert.match(h.alerts[0], /only 1\.00 ref available/);
  // A failed attempt leaves the typed amount in place.
  assert.equal(h.registry.get("#metal_amount_control")[0].value, "5");
});

test("clicking 'Add Metal' when no metal at all is available alerts that none are available", () => {
  const h = loadTradeOfferPage();
  addInventoryAsset(h, { isYou: true, id: "1", market_hash_name: "Mann Co. Supply Crate Key" });
  h.run();

  h.setVal("metal_amount_control", "1");
  h.click("btn_addmetal");

  assert.equal(h.TRADE_STATUS.me.assets.length, 0);
  assert.match(h.alerts[0], /none available/);
});

test("clicking 'Add Metal' accepts a comma as the decimal separator", () => {
  const h = loadTradeOfferPage();
  addInventoryAsset(h, { isYou: true, id: "1", market_hash_name: "Refined Metal" });
  h.run();

  h.setVal("metal_amount_control", "1,00");
  h.click("btn_addmetal");

  assert.equal(h.TRADE_STATUS.me.assets.length, 1);
});

test("clicking 'Add Metals' with the field left blank defaults to adding 1 ref", () => {
  const h = loadTradeOfferPage();
  addInventoryAsset(h, { isYou: true, id: "1", market_hash_name: "Refined Metal" });
  h.run();

  h.click("btn_addmetal"); // never typed anything - field starts blank

  assert.equal(h.TRADE_STATUS.me.assets.length, 1);
  assert.equal(h.alerts.length, 0);
});

test("clicking 'Add Keys' with a starting index still returns the full requested amount via pickItems' own total-splice fallback", () => {
  // Documented "Bug fix" in pickItems' own getItems: with index=1 and only
  // 2 matching keys available, the first pass (which only pushes into
  // `items` once currentIndex >= index) can only ever collect 1 of the 2 -
  // the second only lands in `total`. Requires the total.splice(...)
  // fallback (items.length < amount, not the old buggy `items < amount`
  // array-to-number comparison) to still satisfy the full amount=2 request.
  const h = loadTradeOfferPage();
  addInventoryAsset(h, { isYou: true, id: "1", market_hash_name: "Mann Co. Supply Crate Key" });
  addInventoryAsset(h, { isYou: true, id: "2", market_hash_name: "Mann Co. Supply Crate Key" });
  h.run();

  h.setVal("index_control", "1");
  h.setVal("keys_amount_control", "2");
  h.click("btn_addkeys");

  assert.equal(h.TRADE_STATUS.me.assets.length, 2);
  assert.deepEqual(h.TRADE_STATUS.me.assets.map((a) => a.assetid).sort(), ["1", "2"]);
});

// Seeds craftWeaponNames (tradeoffer.js's own module-level cache, fed by
// steamcommunity.com/tradeOfferSettingsBridge/content.js's own broadcast - world:
// ISOLATED, see that file's own header note on why) - getItemsForMetal's
// craft-weapon fallback only ever finds anything once this has fired at
// least once.
function dispatchCraftWeaponNamesBroadcast(h, names) {
  const handler = h.documentListeners["tf2te-craft-weapon-names-broadcast"][0];
  return handler({ detail: JSON.stringify({ names }) });
}

// Seeds autoAddListingCurrencyEnabled (tradeoffer.js's own module-level
// flag, fed by steamcommunity.com/tradeOfferSettingsBridge/content.js's own
// broadcastAutoAddListingCurrencySetting - world: ISOLATED, see that
// function's own header note on why) - gates ONLY the automatic
// inventoryManager.register()'d currency add below, never the manual "Add
// requested pure" button (page.btns.$listing's own click handler calls
// addListingPrice directly, with no gate).
// What tradeOfferSettingsBridge/content.js sends when the page's URL matches
// a listing link the user opened on backpack.tf (utils/tradeLinkTrust.js).
function dispatchListingLinkTrust(h, trusted = true) {
  const handler = h.documentListeners["tf2te-listing-link-trust-broadcast"][0];
  return handler({ detail: JSON.stringify({ trusted }) });
}

function dispatchAutoAddListingCurrencySetting(h, enabled) {
  const handler = h.documentListeners["tf2te-auto-add-listing-currency-setting-broadcast"][0];
  return handler({ detail: JSON.stringify({ enabled }) });
}

// --- craft-weapon fallback, built into getItemsForMetal itself - covers
// EVERY caller that already routes through it uniformly (the Add Metal
// button directly, addListingPrice, and the "Add by key value" bridge), not
// just the one bridge that originally motivated it. craftWeaponNames (fed by
// tradeOfferSettingsBridge/content.js's own broadcast - world: ISOLATED, see this
// section's own dispatchCraftWeaponNamesBroadcast helper) starts empty in
// every test below unless a test seeds it. ---

test("with no craft-weapon names ever broadcast, a sub-scrap value behaves exactly as before (metal-only, best-effort)", () => {
  const h = loadTradeOfferPage();
  addInventoryAsset(h, { isYou: true, id: "1", market_hash_name: "Refined Metal" });
  h.run();

  h.setVal("metal_amount_control", "0.05"); // finer than 1 Scrap (1/9 ref) - no whole-scrap combo reaches it
  h.click("btn_addmetal");

  assert.equal(h.TRADE_STATUS.me.assets.length, 0, "nothing to add and no weapons known about - matches the pre-existing degrade");
  assert.match(h.alerts[0], /Could not make 0\.05 ref \(none available\)/);
});

test("Add Metal tops up a sub-scrap remainder with a craft weapon once one is known and available", () => {
  const h = loadTradeOfferPage();
  addInventoryAsset(h, { isYou: true, id: "1", market_hash_name: "Rocket Launcher" });
  h.run();
  dispatchCraftWeaponNamesBroadcast(h, ["Rocket Launcher"]);

  h.setVal("metal_amount_control", "0.05"); // exactly one craft weapon's own value
  h.click("btn_addmetal");

  assert.equal(h.TRADE_STATUS.me.assets.length, 1);
  assert.equal(h.TRADE_STATUS.me.assets[0].assetid, "1");
  assert.equal(h.alerts.length, 0);
});

test("Add Metal combines metal AND weapons in one request when metal alone falls short of a real shortage (not just a sub-scrap remainder)", () => {
  const h = loadTradeOfferPage();
  // Only 1/9 ref (~0.111) of real metal exists at all - requesting 0.30 ref
  // needs metalTarget=1/3 ref from metal (only the 1 Scrap actually
  // available contributes 1/9), then 4 weapons (0.20 ref) for the rest -
  // total 0.311 ref, satisfying (slightly overshooting) the 0.30 target.
  addInventoryAsset(h, { isYou: true, id: "1", market_hash_name: "Scrap Metal" });
  addInventoryAsset(h, { isYou: true, id: "2", market_hash_name: "Rocket Launcher" });
  addInventoryAsset(h, { isYou: true, id: "3", market_hash_name: "Scattergun" });
  addInventoryAsset(h, { isYou: true, id: "4", market_hash_name: "Pistol" });
  addInventoryAsset(h, { isYou: true, id: "5", market_hash_name: "Shotgun" });
  h.run();
  dispatchCraftWeaponNamesBroadcast(h, ["Rocket Launcher", "Scattergun", "Pistol", "Shotgun"]);

  h.setVal("metal_amount_control", "0.30");
  h.click("btn_addmetal");

  assert.equal(h.TRADE_STATUS.me.assets.length, 5, "the scrap plus all four weapons should all have been used");
  assert.deepEqual(h.TRADE_STATUS.me.assets.map((a) => a.assetid).sort(), ["1", "2", "3", "4", "5"]);
  assert.equal(h.alerts.length, 0);
});

test("still alerts truthfully when even metal + every available weapon can't reach the target", () => {
  const h = loadTradeOfferPage();
  addInventoryAsset(h, { isYou: true, id: "1", market_hash_name: "Rocket Launcher" });
  h.run();
  dispatchCraftWeaponNamesBroadcast(h, ["Rocket Launcher"]);

  h.setVal("metal_amount_control", "5"); // way more than one weapon (0.05 ref) can cover
  h.click("btn_addmetal");

  assert.equal(h.TRADE_STATUS.me.assets.length, 0, "an unsatisfied request must add nothing, same as the metal-only path already guaranteed");
  assert.match(h.alerts[0], /Could not make 5\.00 ref \(only 0\.05 ref available\)/);
});

test("a normal metal-only request that's fully achievable never touches weapons, even when some are known/available", () => {
  const h = loadTradeOfferPage();
  addInventoryAsset(h, { isYou: true, id: "1", market_hash_name: "Refined Metal" });
  addInventoryAsset(h, { isYou: true, id: "2", market_hash_name: "Reclaimed Metal" });
  addInventoryAsset(h, { isYou: true, id: "3", market_hash_name: "Scrap Metal" });
  addInventoryAsset(h, { isYou: true, id: "4", market_hash_name: "Rocket Launcher" });
  h.run();
  dispatchCraftWeaponNamesBroadcast(h, ["Rocket Launcher"]);

  h.setVal("metal_amount_control", "1.44"); // 1 Refined + 1 Reclaimed + 1 Scrap, exactly - the original passing case
  h.click("btn_addmetal");

  assert.equal(h.TRADE_STATUS.me.assets.length, 3);
  assert.deepEqual(h.TRADE_STATUS.me.assets.map((a) => a.assetid).sort(), ["1", "2", "3"]);
});

test("the craft-weapon-names broadcast listener registers, and an empty/missing list is treated as 'none known yet' rather than throwing", () => {
  const h = loadTradeOfferPage();
  h.run();

  assert.equal(typeof h.documentListeners["tf2te-craft-weapon-names-broadcast"]?.[0], "function");
  assert.doesNotThrow(() => dispatchCraftWeaponNamesBroadcast(h, []));
});

// Regression test: "1.33" is what a human means as "1 Refined + 1 Reclaimed"
// (the true value, 1.3333..., isn't representable in only 2 typed decimals)
// - flooring the raw 0.33 remainder against Reclaimed's own 1/3 ref alone
// gives 0.99, JUST under 1, silently skipping the Reclaimed a human
// obviously meant. This is what the "compare floor vs floor+1 at every
// denomination, keep whichever's closest" rewrite exists to catch - not just
// at the Scrap/weapon tail, but at the Refined/Reclaimed boundary too.
test("a typed value close to (but not exactly) a clean Refined+Reclaimed combo still resolves to that combo, not one denomination short", () => {
  const h = loadTradeOfferPage();
  addInventoryAsset(h, { isYou: true, id: "1", market_hash_name: "Refined Metal" });
  addInventoryAsset(h, { isYou: true, id: "2", market_hash_name: "Reclaimed Metal" });
  h.run();

  h.setVal("metal_amount_control", "1.33"); // true value of 1 Refined + 1 Reclaimed is 1.3333...
  h.click("btn_addmetal");

  assert.equal(h.TRADE_STATUS.me.assets.length, 2, "both the Refined and the Reclaimed should have been used");
  assert.deepEqual(h.TRADE_STATUS.me.assets.map((a) => a.assetid).sort(), ["1", "2"]);
  assert.equal(h.alerts.length, 0);
});

// Regression test matching a live worked example: 0.5 ref, with no
// Refined/Reclaimed available at all, should resolve to 4 Scrap Metal
// (0.444 ref, the closest whole-scrap amount without overshooting) + 1
// craft weapon (0.05 ref) for the remainder - 0.494 ref total, off by
// only 0.006 - rather than rounding up to 5 Scrap alone (0.556 ref, off
// by 0.056, more than 9x further from the true target).
test("0.5 ref with only Scrap and weapons available resolves to 4 Scrap + 1 weapon, matching the worked example", () => {
  const h = loadTradeOfferPage();
  addInventoryAsset(h, { isYou: true, id: "1", market_hash_name: "Scrap Metal" });
  addInventoryAsset(h, { isYou: true, id: "2", market_hash_name: "Scrap Metal" });
  addInventoryAsset(h, { isYou: true, id: "3", market_hash_name: "Scrap Metal" });
  addInventoryAsset(h, { isYou: true, id: "4", market_hash_name: "Scrap Metal" });
  addInventoryAsset(h, { isYou: true, id: "5", market_hash_name: "Rocket Launcher" });
  h.run();
  dispatchCraftWeaponNamesBroadcast(h, ["Rocket Launcher"]);

  h.setVal("metal_amount_control", "0.5");
  h.click("btn_addmetal");

  assert.equal(h.TRADE_STATUS.me.assets.length, 5, "all 4 Scrap plus the 1 weapon");
  assert.deepEqual(h.TRADE_STATUS.me.assets.map((a) => a.assetid).sort(), ["1", "2", "3", "4", "5"]);
  assert.equal(h.alerts.length, 0);
});

// Regression test (a 35.32 ref request landed within 0.0022 ref of exact
// using 39 items - a real Scrap Metal was available but not used - when an
// alternative one fewer item, only 0.0111 ref less precise, existed). Same
// shape at a hand-verified, testable scale: for "0.09" ref with 1 Scrap
// (0.1111 ref) available, "0 Scrap + 2 weapons" (0.10 ref, distance 0.01)
// is MARGINALLY more precise than "1 Scrap alone" (0.1111 ref, distance
// 0.0211) - a 0.0111 ref difference that used to fall just outside the old,
// too-tight 0.01 tie margin, wrongly preferring 2 items over the simpler
// 1-item Scrap answer for a barely-noticeable precision gain.
test("prefers one available Scrap over two weapons when the precision difference is small, even though the weapon combo is marginally closer", () => {
  const h = loadTradeOfferPage();
  addInventoryAsset(h, { isYou: true, id: "1", market_hash_name: "Scrap Metal" });
  addInventoryAsset(h, { isYou: true, id: "2", market_hash_name: "Rocket Launcher" });
  addInventoryAsset(h, { isYou: true, id: "3", market_hash_name: "Scattergun" });
  h.run();
  dispatchCraftWeaponNamesBroadcast(h, ["Rocket Launcher", "Scattergun"]);

  h.setVal("metal_amount_control", "0.09");
  h.click("btn_addmetal");

  assert.equal(h.TRADE_STATUS.me.assets.length, 1, "the 1 available Scrap alone, not 2 weapons");
  assert.equal(h.TRADE_STATUS.me.assets[0].assetid, "1");
  assert.equal(h.alerts.length, 0);
});

// --- index_control/amount_control/name_amount_control's +/- ghost stepper ---

test("the amount/index stepper buttons nudge their own field by 1, clamped to that field's own minimum", () => {
  const h = loadTradeOfferPage();
  h.run();

  h.setVal("index_control", "0");
  h.click("index_control_dec"); // 0 - 1, clamped to min 0
  assert.equal(h.registry.get("#index_control")[0].value, 0);

  h.click("index_control_inc");
  h.click("index_control_inc");
  assert.equal(h.registry.get("#index_control")[0].value, 2);

  h.setVal("amount_control", "3");
  h.click("amount_control_dec");
  assert.equal(h.registry.get("#amount_control")[0].value, 2);

  h.setVal("name_amount_control", "1");
  h.click("name_amount_control_dec"); // 1 - 1, clamped to min 1 (not 0)
  assert.equal(h.registry.get("#name_amount_control")[0].value, 1);

  h.click("name_amount_control_inc");
  assert.equal(h.registry.get("#name_amount_control")[0].value, 2);
});

test("clicking a stepper's '+' on a blank field starts from its own minimum", () => {
  const h = loadTradeOfferPage();
  h.run();

  h.setVal("amount_control", "");
  h.click("amount_control_inc");
  assert.equal(h.registry.get("#amount_control")[0].value, 1);

  h.setVal("name_amount_control", "");
  h.click("name_amount_control_inc");
  assert.equal(h.registry.get("#name_amount_control")[0].value, 1);
});

// --- Add / Add Recent (collectItems: ITEMS/RECENT modes, offsetIndex/getNearNumbers) ---

function appendVisibleInventoryItem(container, { assetid, marketHashName = "Widget" }) {
  const el = makeSlotItemEl({ assetid, marketHashName });
  container.appendChild(el); // sets el.parentNode = container, satisfying isVisible's style.display check
  return el;
}

test("clicking 'Add' (ITEMS mode) offsets near the end of the visible inventory grid when index+amount overruns it", () => {
  const h = loadTradeOfferPage();
  const invCtn = new FakeElement("div");
  invCtn.setAttribute("id", `inventory_${h.STEAMID}_440_2`);
  h.registry.set(".inventory_ctn:visible", [invCtn]);
  ["101", "102", "103"].forEach((id) => appendVisibleInventoryItem(invCtn, { assetid: id }));
  h.run();

  h.setVal("amount_control", "2");
  h.setVal("index_control", "2"); // 2 + 2 > 3 available -> offsetIndex clamps to 1
  h.click("btn_additems");

  assert.equal(h.TRADE_STATUS.me.assets.length, 2);
  assert.deepEqual(h.TRADE_STATUS.me.assets.map((a) => a.assetid).sort(), ["102", "103"]);
  // Resets both fields back to blank so the next click starts fresh
  // instead of silently reusing whatever amount/index was just typed.
  assert.equal(h.registry.get("#amount_control")[0].value, "");
  assert.equal(h.registry.get("#index_control")[0].value, "");
});

test("clicking 'Add' (ITEMS mode) for more than are available alerts how many actually are, adds NOTHING, and leaves the fields as typed", () => {
  const h = loadTradeOfferPage();
  const invCtn = new FakeElement("div");
  invCtn.setAttribute("id", `inventory_${h.STEAMID}_440_2`);
  h.registry.set(".inventory_ctn:visible", [invCtn]);
  appendVisibleInventoryItem(invCtn, { assetid: "101" }); // only 1 available
  h.run();

  h.setVal("amount_control", "5");
  h.setVal("index_control", "0");
  h.click("btn_additems");

  assert.equal(h.TRADE_STATUS.me.assets.length, 0);
  assert.equal(h.alerts.length, 1);
  assert.match(h.alerts[0], /Could not find 5 items/);
  assert.match(h.alerts[0], /only 1 available/);
  assert.equal(h.registry.get("#amount_control")[0].value, "5");
  assert.equal(h.registry.get("#index_control")[0].value, "0");
});

test("clicking 'Add' (ITEMS mode) when nothing at all is visible alerts that none are available", () => {
  const h = loadTradeOfferPage();
  const invCtn = new FakeElement("div");
  invCtn.setAttribute("id", `inventory_${h.STEAMID}_440_2`);
  h.registry.set(".inventory_ctn:visible", [invCtn]);
  h.run();

  h.setVal("amount_control", "1");
  h.setVal("index_control", "0");
  h.click("btn_additems");

  assert.equal(h.TRADE_STATUS.me.assets.length, 0);
  assert.match(h.alerts[0], /Could not find 1 item /);
  assert.match(h.alerts[0], /none available/);
});

test("clicking 'Add' (ITEMS mode) treats a negative amount as blank/invalid, defaulting to 1", () => {
  const h = loadTradeOfferPage();
  const invCtn = new FakeElement("div");
  invCtn.setAttribute("id", `inventory_${h.STEAMID}_440_2`);
  h.registry.set(".inventory_ctn:visible", [invCtn]);
  ["101", "102"].forEach((id) => appendVisibleInventoryItem(invCtn, { assetid: id }));
  h.run();

  h.setVal("amount_control", "-5");
  h.setVal("index_control", "0");
  h.click("btn_additems");

  assert.equal(h.TRADE_STATUS.me.assets.length, 1);
  assert.deepEqual(h.TRADE_STATUS.me.assets.map((a) => a.assetid), ["101"]);
  assert.equal(h.alerts.length, 0);
  assert.equal(h.registry.get("#amount_control")[0].value, "");
});

test("clicking 'Add' (ITEMS mode) with a fractional amount rounds it instead of permanently failing (amount_control has no integer-only step)", () => {
  const h = loadTradeOfferPage();
  const invCtn = new FakeElement("div");
  invCtn.setAttribute("id", `inventory_${h.STEAMID}_440_2`);
  h.registry.set(".inventory_ctn:visible", [invCtn]);
  ["101", "102", "103"].forEach((id) => appendVisibleInventoryItem(invCtn, { assetid: id }));
  h.run();

  // Math.round(2.5) is 3 (JS rounds .5 up) - previously
  // found.splice(offset, 2.5) always returned at most 2 items while the
  // satisfied check compared against the un-rounded 2.5, so this always
  // alerted "not enough" even with 3 truly available.
  h.setVal("amount_control", "2.5");
  h.setVal("index_control", "0");
  h.click("btn_additems");

  assert.equal(h.alerts.length, 0);
  assert.equal(h.TRADE_STATUS.me.assets.length, 3);
  assert.deepEqual(h.TRADE_STATUS.me.assets.map((a) => a.assetid).sort(), ["101", "102", "103"]);
});

test("clicking 'Add Recent' (RECENT mode) clusters ids near the highest one, stopping once the gap between consecutive distances is too large", () => {
  const h = loadTradeOfferPage();
  const invCtn = new FakeElement("div");
  invCtn.setAttribute("id", `inventory_${h.STEAMID}_440_2`);
  h.registry.set(".inventory_ctn:visible", [invCtn]);
  // distances from the highest id (600): 500->100, 110->490, 105->495, 100->500
  // the jump from distance 100 (id 500) to distance 490 (id 110) exceeds the
  // default gap of 100, so clustering stops after {600, 500}.
  ["100", "105", "110", "500", "600"].forEach((id) => appendVisibleInventoryItem(invCtn, { assetid: id }));
  h.run();

  h.click("btn_addrecent");

  assert.equal(h.TRADE_STATUS.me.assets.length, 2);
  assert.deepEqual(h.TRADE_STATUS.me.assets.map((a) => a.assetid).sort(), ["500", "600"]);
});

test("'Add Recent' excludes ids already present in the trade slots from its near-id clustering", () => {
  const h = loadTradeOfferPage();
  const invCtn = new FakeElement("div");
  invCtn.setAttribute("id", `inventory_${h.STEAMID}_440_2`);
  h.registry.set(".inventory_ctn:visible", [invCtn]);
  ["500", "600"].forEach((id) => appendVisibleInventoryItem(invCtn, { assetid: id }));
  // 600 is already sitting in the trade slots - it must be excluded from
  // both the "highest id" search and the final picked set.
  const yourSlots = h.elementsById.get("your_slots");
  const already = makeSlotItemEl({ assetid: "600", marketHashName: "Widget" });
  yourSlots.appendChild(already);
  h.run();

  h.click("btn_addrecent");

  assert.equal(h.TRADE_STATUS.me.assets.length, 1);
  assert.equal(h.TRADE_STATUS.me.assets[0].assetid, "500");
});

// --- clear (clearItemsInOffer -> WINDOW.__tf2te__.removeItemsFromTrade) ---

test("clicking 'Clear my items' passes every item currently in your slots, reversed, to __tf2te__.removeItemsFromTrade", () => {
  const h = loadTradeOfferPage();
  const yourSlots = h.elementsById.get("your_slots");
  const itemA = makeSlotItemEl({ assetid: "1", marketHashName: "A" });
  const itemB = makeSlotItemEl({ assetid: "2", marketHashName: "B" });
  yourSlots.appendChild(itemA);
  yourSlots.appendChild(itemB);
  h.run();

  // installTradeSlotOverrides (run for real at the end of fn()) already
  // assigned the real removeItemsFromTrade onto window.__tf2te__ - swapped
  // out here for a spy so this test isolates tradeoffer.js's own clear()/
  // clearItemsInOffer() behavior from tradeSlotOverrides.js's own (see
  // tests/tradeSlotOverrides.test.js for that file's own dedicated coverage,
  // including why this goes through window.__tf2te__ rather than
  // WINDOW.GTradeStateManager.RemoveItemsFromTrade directly).
  let receivedItems = null;
  h.windowObj.__tf2te__.removeItemsFromTrade = (items) => {
    receivedItems = items;
  };

  h.click("btn_clearmyitems");

  assert.deepEqual(receivedItems, [itemB, itemA]); // .reverse()
});

// --- Add requested pure (addListingPrice: addCurrencies, all-or-nothing) ---

test("addListingPrice adds both keys and metal only once every requested currency is fully satisfiable", () => {
  const h = loadTradeOfferPage({ locationSearch: "?listing_intent=1&listing_currencies_keys=1&listing_currencies_metal=2" });
  addInventoryAsset(h, { isYou: true, id: "1", market_hash_name: "Mann Co. Supply Crate Key" });
  addInventoryAsset(h, { isYou: true, id: "2", market_hash_name: "Refined Metal" });
  addInventoryAsset(h, { isYou: true, id: "3", market_hash_name: "Refined Metal" });
  h.run();

  h.click("btn_addlisting");

  assert.equal(h.TRADE_STATUS.me.assets.length, 3);
  assert.equal(h.alerts.length, 0);
});

test("addListingPrice adds nothing and alerts when only one of the two requested currencies can be fully satisfied", async () => {
  const h = loadTradeOfferPage({ locationSearch: "?listing_intent=1&listing_currencies_keys=1&listing_currencies_metal=5" });
  addInventoryAsset(h, { isYou: true, id: "1", market_hash_name: "Mann Co. Supply Crate Key" });
  addInventoryAsset(h, { isYou: true, id: "2", market_hash_name: "Refined Metal" }); // only 1 ref, 5 requested
  h.run();

  h.click("btn_addlisting");
  // addListingPrice's own final alert() only runs after its `await
  // addCurrencies(...)` resolves - a microtask hop even though addCurrencies
  // itself never awaits anything internally - so it hasn't fired yet at the
  // instant the (synchronous) click dispatch returns.
  await Promise.resolve();
  await Promise.resolve();

  // Bug-fix behavior documented in addCurrencies' own comment: nothing gets
  // partially added - the keys collected for the satisfied currency are
  // discarded rather than committed alone.
  assert.equal(h.TRADE_STATUS.me.assets.length, 0);
  assert.equal(h.alerts.length, 1);
  assert.match(h.alerts[0], /not enough metal/);
});

// REGRESSION for a live bug report: a high-volume 24/7 trading bot's own
// inventory can still be mid-fetch of its OWN further asset pages well
// after this side's #inventory_* container has already appeared (the exact
// moment addListingPrice/addCurrencies first runs, whether via the
// automatic on-load path or a manual "Add requested pure" click) - a
// currency that's genuinely there, just not fetched yet, used to read back
// indistinguishable from "not enough" (confirmed live: "not enough metal"
// for a listing whose bot plainly had plenty, that then added correctly a
// moment later once the rest of its inventory had finished loading). Rather
// than alerting on the very first (possibly premature) check,
// addCurrencies now retries while BIsLoadingInventoryData() for the paying
// side still reports true.
test("addListingPrice retries while the paying side's inventory is still loading, instead of immediately alerting \"not enough\"", async () => {
  const h = loadTradeOfferPage({ locationSearch: "?listing_intent=1&listing_currencies_keys=1&listing_currencies_metal=2" });
  addInventoryAsset(h, { isYou: true, id: "1", market_hash_name: "Mann Co. Supply Crate Key" });
  // Only 1 of the 2 requested Refined Metal has "arrived" so far - standing
  // in for a still-loading inventory that hasn't fetched the rest yet.
  addInventoryAsset(h, { isYou: true, id: "2", market_hash_name: "Refined Metal" });
  h.run();

  h.UserYou.BIsLoadingInventoryData = () => true;
  const pendingBeforeClick = h.timers.pendingCount("timeout");

  h.click("btn_addlisting");
  await Promise.resolve();
  await Promise.resolve();

  // The first attempt came up short, but since the inventory is still
  // loading, it retries (via a newly-scheduled pending timer) instead of
  // alerting right away.
  assert.equal(h.alerts.length, 0);
  assert.equal(h.TRADE_STATUS.me.assets.length, 0);
  assert.equal(h.timers.pendingCount("timeout"), pendingBeforeClick + 1);

  // The rest of the inventory "finishes loading" - the missing Refined
  // Metal shows up and the loading flag flips off - before the retry fires.
  addInventoryAsset(h, { isYou: true, id: "3", market_hash_name: "Refined Metal" });
  h.UserYou.BIsLoadingInventoryData = () => false;

  assert.equal(h.timers.fireNextTimeout(), true);
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(h.TRADE_STATUS.me.assets.length, 3);
  assert.equal(h.alerts.length, 0);
});

// A currency that's genuinely short (not just slow to load) must still
// alert, not retry forever - BIsLoadingInventoryData() reporting false from
// the very first check (this file's own default fixture) means the
// pre-existing "not enough" behavior (see the test above this one) is
// unaffected by the new retry loop.
test("addListingPrice does not retry (and alerts immediately) once the paying side's inventory has finished loading", async () => {
  const h = loadTradeOfferPage({ locationSearch: "?listing_intent=1&listing_currencies_keys=1&listing_currencies_metal=5" });
  addInventoryAsset(h, { isYou: true, id: "1", market_hash_name: "Mann Co. Supply Crate Key" });
  addInventoryAsset(h, { isYou: true, id: "2", market_hash_name: "Refined Metal" }); // only 1 ref, 5 requested
  h.run();

  const pendingBeforeClick = h.timers.pendingCount("timeout");

  h.click("btn_addlisting");
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(h.timers.pendingCount("timeout"), pendingBeforeClick);
  assert.equal(h.TRADE_STATUS.me.assets.length, 0);
  assert.equal(h.alerts.length, 1);
  assert.match(h.alerts[0], /not enough metal/);
});

test("a buy listing automatically adds the requested metal from THEIR (the buyer's) inventory once it finishes loading, with no click needed", async () => {
  const h = loadTradeOfferPage({ locationSearch: "?listing_intent=0&listing_currencies_metal=3&for_item_name=Rocket%20Launcher" });
  addInventoryAsset(h, { isYou: false, id: "1", market_hash_name: "Refined Metal" });
  addInventoryAsset(h, { isYou: false, id: "2", market_hash_name: "Refined Metal" });
  addInventoryAsset(h, { isYou: false, id: "3", market_hash_name: "Refined Metal" });
  h.run();
  dispatchListingLinkTrust(h);

  const invObserver = FakeMutationObserver.instances[FakeMutationObserver.instances.length - 1];
  invObserver.cb([{ addedNodes: [{ id: `inventory_${h.PARTNER_STEAMID}_440_2` }] }]);
  // withTheirInventoryVisible's own single setTimeout(0) tick (see
  // tradeoffer.js's own note on why it's there) - fired manually, then
  // flushed the same way the "not enough metal" test just below already
  // does for addListingPrice's own await addCurrencies(...) hop.
  h.timers.fireNextTimeout();
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(h.TRADE_STATUS.them.assets.length, 3);
  assert.equal(h.alerts.length, 0);
});

test("a sell listing automatically adds the requested price from YOUR OWN inventory once it finishes loading, with no click needed", () => {
  const h = loadTradeOfferPage({ locationSearch: "?listing_intent=1&listing_currencies_keys=1&for_item=440_2_555" });
  addInventoryAsset(h, { isYou: true, id: "1", market_hash_name: "Mann Co. Supply Crate Key" });
  h.run();
  dispatchListingLinkTrust(h);

  const invObserver = FakeMutationObserver.instances[FakeMutationObserver.instances.length - 1];
  invObserver.cb([{ addedNodes: [{ id: `inventory_${h.STEAMID}_440_2` }] }]);

  assert.equal(h.TRADE_STATUS.me.assets.length, 1);
  assert.equal(h.alerts.length, 0);
});

// New popup toggle - gates only the automatic pre-fill above, never the
// manual "Add requested pure" button.
test("does NOT auto-add the listing's currency once the popup's toggle broadcasts enabled:false, but the manual 'Add requested pure' button still works", () => {
  const h = loadTradeOfferPage({ locationSearch: "?listing_intent=1&listing_currencies_keys=1&for_item=440_2_555" });
  addInventoryAsset(h, { isYou: true, id: "1", market_hash_name: "Mann Co. Supply Crate Key" });
  h.run();
  dispatchListingLinkTrust(h);

  dispatchAutoAddListingCurrencySetting(h, false);

  const invObserver = FakeMutationObserver.instances[FakeMutationObserver.instances.length - 1];
  invObserver.cb([{ addedNodes: [{ id: `inventory_${h.STEAMID}_440_2` }] }]);

  assert.equal(h.TRADE_STATUS.me.assets.length, 0, "the automatic add must not run while the toggle is off");
  assert.equal(h.alerts.length, 0, "must fail silently, not alert - the user simply hasn't asked for this yet");

  h.click("btn_addlisting");

  assert.equal(h.TRADE_STATUS.me.assets.length, 1, "the manual button must still work regardless of the toggle");
});

// --- Trade links that did NOT come from backpack.tf: the listing params are
// plain URL text anyone can put on a link, so nothing of the user's own may
// be pre-filled from them without the bridge's trust broadcast. ---

test("a crafted sell-listing link never auto-adds YOUR keys without the backpack.tf trust broadcast, but the manual button still works", () => {
  const h = loadTradeOfferPage({ locationSearch: "?listing_intent=1&listing_currencies_keys=1" });
  addInventoryAsset(h, { isYou: true, id: "1", market_hash_name: "Mann Co. Supply Crate Key" });
  h.run();

  const invObserver = FakeMutationObserver.instances[FakeMutationObserver.instances.length - 1];
  invObserver.cb([{ addedNodes: [{ id: `inventory_${h.STEAMID}_440_2` }] }]);

  assert.equal(h.TRADE_STATUS.me.assets.length, 0, "nothing of yours is added from an untrusted link");
  assert.equal(h.alerts.length, 0);

  h.click("btn_addlisting");

  assert.equal(h.TRADE_STATUS.me.assets.length, 1, "an explicit click still adds the listing price");
});

test("a crafted buy-listing link never auto-adds the named item from YOUR inventory without the backpack.tf trust broadcast", () => {
  const h = loadTradeOfferPage({ locationSearch: "?listing_intent=0&for_item_name=Rocket%20Launcher" });
  addInventoryAsset(h, { isYou: true, id: "10", market_hash_name: "Rocket Launcher" });
  h.run();
  dispatchListingLinkTrust(h, false);

  const invObserver = FakeMutationObserver.instances[FakeMutationObserver.instances.length - 1];
  invObserver.cb([{ addedNodes: [{ id: `inventory_${h.STEAMID}_440_2` }] }]);

  assert.equal(h.TRADE_STATUS.me.assets.length, 0);
  assert.equal(h.alerts.length, 0);
});

test("a pre-fill that waited for the trust broadcast runs once it arrives after the inventory loaded, and only once", () => {
  const h = loadTradeOfferPage({ locationSearch: "?listing_intent=0&for_item_name=Rocket%20Launcher" });
  addInventoryAsset(h, { isYou: true, id: "10", market_hash_name: "Rocket Launcher" });
  h.run();

  const invObserver = FakeMutationObserver.instances[FakeMutationObserver.instances.length - 1];
  invObserver.cb([{ addedNodes: [{ id: `inventory_${h.STEAMID}_440_2` }] }]);
  assert.equal(h.TRADE_STATUS.me.assets.length, 0, "still waiting for the bridge");

  dispatchListingLinkTrust(h);
  dispatchListingLinkTrust(h); // the bridge may broadcast more than once

  assert.deepEqual(h.TRADE_STATUS.me.assets.map((a) => a.assetid), ["10"]);
});

test("a buy listing's automatic currency add alerts (rather than partially adding) when the buyer doesn't have enough metal", async () => {
  const h = loadTradeOfferPage({ locationSearch: "?listing_intent=0&listing_currencies_metal=5&for_item_name=Rocket%20Launcher" });
  addInventoryAsset(h, { isYou: false, id: "1", market_hash_name: "Refined Metal" }); // only 1 ref, 5 requested
  h.run();
  dispatchListingLinkTrust(h);

  const invObserver = FakeMutationObserver.instances[FakeMutationObserver.instances.length - 1];
  invObserver.cb([{ addedNodes: [{ id: `inventory_${h.PARTNER_STEAMID}_440_2` }] }]);
  // withTheirInventoryVisible's own single setTimeout(0) tick fires first,
  // then addListingPrice's own final alert() only runs after its `await
  // addCurrencies(...)` resolves - see the manual-click version of this same
  // wait above.
  h.timers.fireNextTimeout();
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(h.TRADE_STATUS.them.assets.length, 0);
  assert.equal(h.alerts.length, 1);
  assert.match(h.alerts[0], /not enough metal/);
});

test("a listing link with no listing_currencies_* params never triggers the automatic currency add", () => {
  const h = loadTradeOfferPage({ locationSearch: "?listing_intent=0&for_item_name=Rocket%20Launcher" });
  addInventoryAsset(h, { isYou: false, id: "1", market_hash_name: "Mann Co. Supply Crate Key" });
  h.run();

  const invObserver = FakeMutationObserver.instances[FakeMutationObserver.instances.length - 1];
  invObserver.cb([{ addedNodes: [{ id: `inventory_${h.PARTNER_STEAMID}_440_2` }] }]);

  assert.equal(h.TRADE_STATUS.them.assets.length, 0);
});

// --- toggleIDFields / keyPressed hotkey ---

test("pressing 'p' toggles the id fields visible and persists the visibility flag via setStored", () => {
  const h = loadTradeOfferPage();
  h.run();
  const idFields = h.registry.get("#id_fields")[0];
  idFields.style.display = "none";

  h.registry.get("#your_slots")[0]; // no-op, just confirms harness sanity
  h.sandbox.document.dispatchEvent({ type: "keypress", target: { nodeName: "BODY", type: "" }, keyCode: 112 });

  assert.equal(idFields.style.display, "");
  assert.equal(h.DEPS.getStored("getTradeOfferWindow.id_visible"), "1");
});

test("the id fields panel is shown on load when the visibility flag was previously stored", () => {
  const h = loadTradeOfferPage();
  h.DEPS.setStored("getTradeOfferWindow.id_visible", "1");
  const idFields = h.elementsById.get("id_fields");
  idFields.style.display = "none";

  h.run();

  assert.equal(idFields.style.display, "");
});

// --- updateDisplay / userChanged / appChanged (button visibility) ---

test("updateDisplay shows the keys+metal buttons for a TF2 inventory but hides the listing buttons with no listing_intent", () => {
  const h = loadTradeOfferPage();
  h.run();

  assert.equal(h.registry.get("#btn_addkeys")[0].style.display, "");
  assert.equal(h.registry.get("#btn_addmetal")[0].style.display, "");
  assert.equal(h.registry.get("#btn_addlisting")[0].style.display, "none");
  assert.equal(h.registry.get("#btn_addlistingitem")[0].style.display, "none");
});

test("updateDisplay hides the metal button (but keeps keys) for a CS2/CSGO (730) inventory", () => {
  const h = loadTradeOfferPage();
  h.run();

  // Drive it via userChanged's own inventory-tab path (re-resolved live via
  // page.get.$inventory()), rather than through appChanged/$appSelectOption
  // - page.$appSelectOption was captured once at fn() call time, so a
  // registry entry set up only after run() would never reach its handler.
  const ctn = new FakeElement("div");
  ctn.setAttribute("id", `inventory_${h.STEAMID}_730_2`);
  h.registry.set(".inventory_ctn:visible", [ctn]);
  h.registry.get("#inventory_select_your_inventory")[0].dispatchEvent({ type: "click" });

  assert.equal(h.registry.get("#btn_addkeys")[0].style.display, "");
  assert.equal(h.registry.get("#btn_addmetal")[0].style.display, "none");
});

// Regression test, confirmed live: main()'s own "configure
// state" block calls tradeOfferWindow.userChanged(page.get.$activeInventoryTab())
// unconditionally, which reads page.get.$inventory().attr('id') - if the
// trade partner's inventory hasn't finished loading yet (still mid-flight on
// its own foreigninventory XHR at the exact moment main() runs), that
// selector matches nothing, .attr('id') is undefined, and calling .match()
// on it threw uncaught. Since this happens BEFORE the later "override page
// functions" block's own window.__tf2te__.installTradeSlotOverrides(...)
// call in the same synchronous main() body, such a throw would silently
// abort everything after it - "Clear my items"/the collapse feature's own
// "-" button would then throw "window.__tf2te__.removeItemsFromTrade is not
// a function". It is a load-timing race, so a reload does not avoid it.
test("main() doesn't crash and still installs the trade-slot overrides even when the partner's inventory hasn't loaded yet", () => {
  const h = loadTradeOfferPage();
  h.registry.set(".inventory_ctn:visible", []); // nothing loaded yet

  assert.doesNotThrow(() => h.run());
  assert.equal(typeof h.windowObj.__tf2te__.removeItemsFromTrade, "function");
});

// The Add Keys/Add Metals/Add Recent row and the pure-totals panel only
// mean anything for TF2, so both hide for a different app's inventory -
// but Clear my items/Clear their items aren't currency-specific at all
// and stay visible regardless.
test("updateDisplay hides the Add Keys/Add Metals/Add Recent row and the pure-totals row for a non-TF2 inventory, but keeps Clear my items/Clear their items visible", () => {
  const h = loadTradeOfferPage();
  const header = new FakeElement("div");
  h.docQueryRegistry.set(".trade_partner_header", header);

  h.run();

  const pureRow = header.children[0].children.at(-1); // [links row, pure-totals row]

  assert.equal(h.registry.get("#add_btns")[0].style.display, "");
  assert.equal(pureRow.style.display, "inline-flex");
  // Clear my items/Clear their items are never toggled by updateDisplay at
  // all (unlike $addBtnsRow/pureTotalsRow above) - their style.display
  // stays whatever it started as (undefined - no inline override, native
  // CSS visibility), which IS "not hidden", just not the same value
  // .show() would have explicitly written.
  assert.notEqual(h.registry.get("#btn_clearmyitems")[0].style.display, "none");
  assert.notEqual(h.registry.get("#btn_cleartheiritems")[0].style.display, "none");

  const ctn = new FakeElement("div");
  ctn.setAttribute("id", `inventory_${h.STEAMID}_730_2`);
  h.registry.set(".inventory_ctn:visible", [ctn]);
  h.registry.get("#inventory_select_your_inventory")[0].dispatchEvent({ type: "click" });

  assert.equal(h.registry.get("#add_btns")[0].style.display, "none");
  assert.equal(pureRow.style.display, "none");
  assert.notEqual(h.registry.get("#btn_clearmyitems")[0].style.display, "none");
  assert.notEqual(h.registry.get("#btn_cleartheiritems")[0].style.display, "none");
});

test("updateDisplay shows the Add Keys/Add Metals/Add Recent row and the pure-totals row again once switching back to a TF2 inventory", () => {
  const h = loadTradeOfferPage();
  const header = new FakeElement("div");
  h.docQueryRegistry.set(".trade_partner_header", header);

  h.run();

  const pureRow = header.children[0].children.at(-1);
  const ctn730 = new FakeElement("div");
  ctn730.setAttribute("id", `inventory_${h.STEAMID}_730_2`);
  h.registry.set(".inventory_ctn:visible", [ctn730]);
  h.registry.get("#inventory_select_your_inventory")[0].dispatchEvent({ type: "click" });
  assert.equal(h.registry.get("#add_btns")[0].style.display, "none");
  assert.equal(pureRow.style.display, "none");

  // "If I selected CS2 at 'your inventory' and change to 'their inventory'
  // then it's loading the TF2 inventory, then the mentioned parts should
  // appear too" - simulated here via the their-inventory tab resolving to
  // a TF2 (440) container instead.
  const ctn440 = new FakeElement("div");
  ctn440.setAttribute("id", `inventory_${h.STEAMID}_440_2`);
  h.registry.set(".inventory_ctn:visible", [ctn440]);
  h.registry.get("#inventory_select_their_inventory")[0].dispatchEvent({ type: "click" });

  assert.equal(h.registry.get("#add_btns")[0].style.display, "");
  assert.equal(pureRow.style.display, "inline-flex");
});

// Regression test, confirmed live: on page load no .inventory_ctn was
// visible yet, so the initial userChanged resolved no appid and hid the
// pure-totals row (and Add Keys/Metals row) until a tab click re-ran it.
// The inventory container's own arrival now re-runs updateDisplay - but
// only for the side whose tab is showing.
test("REGRESSION: the pure-totals row reappears once the visible side's TF2 inventory container arrives, even though the initial check found no inventory", async () => {
  const h = loadTradeOfferPage();
  const header = new FakeElement("div");
  h.docQueryRegistry.set(".trade_partner_header", header);
  h.registry.set(".inventory_ctn:visible", []); // nothing loaded yet

  h.run();
  await Promise.resolve();

  const pureRow = header.children[0].children.at(-1);
  assert.equal(pureRow.style.display, "none");
  assert.equal(h.registry.get("#add_btns")[0].style.display, "none");

  const invObserver = FakeMutationObserver.instances[FakeMutationObserver.instances.length - 1];

  // The partner's inventory arriving while YOUR tab is active must not
  // decide anything for the visible side.
  const theirNode = new FakeElement("div");
  theirNode.setAttribute("id", `inventory_${h.PARTNER_STEAMID}_730_2`);
  invObserver.cb([{ addedNodes: [theirNode] }]);
  assert.equal(pureRow.style.display, "none");

  const yourNode = new FakeElement("div");
  yourNode.setAttribute("id", `inventory_${h.STEAMID}_440_2`);
  invObserver.cb([{ addedNodes: [yourNode] }]);

  assert.equal(pureRow.style.display, "inline-flex");
  assert.equal(h.registry.get("#add_btns")[0].style.display, "");
});

test("updateDisplay shows the 'Add requested pure' listing button only for a buying (your side) or selling (their side) TF2 listing", () => {
  const h = loadTradeOfferPage({ locationSearch: "?listing_intent=1" }); // buying
  h.run();
  assert.equal(h.registry.get("#btn_addlisting")[0].style.display, "");
});

test("updateDisplay shows 'Add More Listed Items' only on their-inventory tab when for_item is present", () => {
  const h = loadTradeOfferPage({ locationSearch: "?for_item=440_2_555" });
  h.run();
  // default active tab is "your inventory" -> button stays hidden
  assert.equal(h.registry.get("#btn_addlistingitem")[0].style.display, "none");

  switchToTheirInventory(h);

  assert.equal(h.registry.get("#btn_addlistingitem")[0].style.display, "");
});

// --- addListingItem (for_item / for_item_name / cachedListingItemName fallback) ---

// Note: whenever urlParams.for_item is present, the "register inventory
// events" block unconditionally pushes a raw {assetid: <for_item's own
// assetid>} placeholder straight into TRADE_STATUS.them.assets as soon as
// run() executes (see tradeoffer.js's own note on why - it's what makes the
// listing's own item show up pre-added at all) - independent of, and prior
// to, anything addListingItem() itself does. Assertions below account for
// that pre-seeded entry rather than assuming an empty starting state.
test("addListingItem adds more of the exact for_item asset by name when it's still present in their inventory", () => {
  const h = loadTradeOfferPage({ locationSearch: "?for_item=440_2_555" });
  addInventoryAsset(h, { isYou: false, id: "555", market_hash_name: "Team Captain" });
  addInventoryAsset(h, { isYou: false, id: "556", market_hash_name: "Team Captain" });
  h.run();

  h.setVal("name_amount_control", "2");
  h.click("btn_addlistingitem");

  const assetIds = h.TRADE_STATUS.them.assets.map((a) => a.assetid);
  assert.equal(assetIds.includes("555"), true);
  assert.equal(assetIds.includes("556"), true);
  assert.equal(h.alerts.length, 0);
});

test("addListingItem falls back to for_item_name (an already-known name) when the specific asset is gone", () => {
  const h = loadTradeOfferPage({ locationSearch: "?for_item=440_2_555&for_item_name=Team%20Captain" });
  addInventoryAsset(h, { isYou: false, id: "556", market_hash_name: "Team Captain" }); // 555 itself is absent
  h.run();

  h.setVal("name_amount_control", "1");
  h.click("btn_addlistingitem");

  // pre-seeded placeholder (555) + the freshly picked-by-name item (556)
  assert.equal(h.TRADE_STATUS.them.assets.length, 2);
  assert.equal(h.TRADE_STATUS.them.assets.some((a) => a.assetid === "556"), true);
  assert.equal(h.alerts.length, 0);
});

test("addListingItem asking for more than their inventory has alerts and adds NOTHING (not even a partial amount)", () => {
  const h = loadTradeOfferPage({ locationSearch: "?for_item=440_2_555" });
  addInventoryAsset(h, { isYou: false, id: "555", market_hash_name: "Team Captain" });
  addInventoryAsset(h, { isYou: false, id: "556", market_hash_name: "Team Captain" });
  h.run();
  const before = h.TRADE_STATUS.them.assets.length; // the load-time for_item pre-seed

  h.setVal("name_amount_control", "5");
  h.click("btn_addlistingitem");

  assert.equal(h.TRADE_STATUS.them.assets.length, before);
  assert.equal(h.alerts.length, 1);
  assert.match(h.alerts[0], /Could not find 5 of "Team Captain" in their inventory/);
  assert.match(h.alerts[0], /only \d+ available/);
});

test("addListingItem for a buy listing asking for more than your inventory has alerts and adds NOTHING", () => {
  const h = loadTradeOfferPage({ locationSearch: "?listing_intent=0&for_item_name=Rocket%20Launcher" });
  addInventoryAsset(h, { isYou: true, id: "10", market_hash_name: "Rocket Launcher" });
  h.run();

  h.setVal("name_amount_control", "3");
  h.click("btn_addlistingitem");

  assert.equal(h.TRADE_STATUS.me.assets.length, 0);
  assert.equal(h.alerts.length, 1);
  assert.match(h.alerts[0], /Could not find 3 of "Rocket Launcher" in your inventory \(only 1 available\)/);
});

test("addListingItem alerts that the asset is gone (not still loading) when there's no cached name to fall back to", () => {
  const h = loadTradeOfferPage({ locationSearch: "?for_item=440_2_555" });
  h.run(); // 555 was never in their inventory, and their inventory isn't "loading"

  h.click("btn_addlistingitem");

  // nothing further gets added on top of the load-time pre-seed
  assert.equal(h.TRADE_STATUS.them.assets.length, 1);
  assert.equal(h.alerts.length, 1);
  assert.match(h.alerts[0], /no longer available in their inventory|no longer in their inventory/);
});

// GetInventory() only guarded rgAppInfo[appid], not that app's own
// rgContexts[contextid] - so a for_item naming a context this side hasn't
// loaded threw a TypeError out of the click handler instead of degrading to
// the empty-inventory "|| {}" the function is shaped to return. Every other
// walk of this same chain in tradeoffer.js already guards level-by-level.
test("a for_item pointing at an unloaded inventory context degrades to 'asset is gone', not a TypeError", () => {
  const h = loadTradeOfferPage({ locationSearch: "?for_item=440_9_555" }); // context 9 is not in rgAppInfo
  h.run();

  h.click("btn_addlistingitem");

  assert.equal(h.alerts.length, 1);
  assert.match(h.alerts[0], /no longer/);
});

// --- buy-listing flow (for_item absent, for_item_name only - fulfilling
// someone else's buy order by adding a matching item from YOUR OWN
// inventory, the mirror image of the for_item tests above) ---

test("updateDisplay shows 'Add More Listed Items' on YOUR inventory tab (not theirs) for a buy listing", () => {
  const h = loadTradeOfferPage({ locationSearch: "?listing_intent=0&for_item_name=Rocket%20Launcher" });
  h.run();
  // default active tab is "your inventory" -> shown (opposite of the
  // for_item/sell-listing case, since there's no specific asset on their
  // side to add more of here - the match is in your own inventory instead).
  assert.equal(h.registry.get("#btn_addlistingitem")[0].style.display, "");

  switchToTheirInventory(h);

  assert.equal(h.registry.get("#btn_addlistingitem")[0].style.display, "none");
});

test("addListingItem adds a matching item from YOUR OWN inventory for a buy listing (no for_item, only for_item_name)", () => {
  const h = loadTradeOfferPage({ locationSearch: "?listing_intent=0&for_item_name=Rocket%20Launcher" });
  addInventoryAsset(h, { isYou: true, id: "10", market_hash_name: "Rocket Launcher" });
  h.run();

  h.setVal("name_amount_control", "1");
  h.click("btn_addlistingitem");

  const assetIds = h.TRADE_STATUS.me.assets.map((a) => a.assetid);
  assert.equal(assetIds.includes("10"), true);
  assert.equal(h.alerts.length, 0);
});

test("addListingItem alerts (mentioning your inventory) when no matching item exists for a buy listing", () => {
  const h = loadTradeOfferPage({ locationSearch: "?listing_intent=0&for_item_name=Rocket%20Launcher" });
  h.run(); // no matching item ever added to your inventory

  h.click("btn_addlistingitem");

  assert.equal(h.TRADE_STATUS.me.assets.length, 0);
  assert.equal(h.alerts.length, 1);
  assert.match(h.alerts[0], /your inventory/);
});

test("a buy listing automatically adds a matching item from your own inventory once it finishes loading, with no click needed", () => {
  const h = loadTradeOfferPage({ locationSearch: "?listing_intent=0&for_item_name=Rocket%20Launcher" });
  addInventoryAsset(h, { isYou: true, id: "10", market_hash_name: "Rocket Launcher" });
  h.run();
  dispatchListingLinkTrust(h);

  const invObserver = FakeMutationObserver.instances[FakeMutationObserver.instances.length - 1];
  invObserver.cb([{ addedNodes: [{ id: `inventory_${h.STEAMID}_440_2` }] }]);

  const assetIds = h.TRADE_STATUS.me.assets.map((a) => a.assetid);
  assert.equal(assetIds.includes("10"), true);
  assert.equal(h.alerts.length, 0);
});

// --- Taunt name mismatch (confirmed live: backpack.tf's listing rows show a
// Taunt's bare name, e.g. "Rocket Jockey", without the "Taunt: " prefix
// Steam's own market_hash_name always carries, so for_item_name ends up
// missing it too - matching must tolerate that gap rather than requiring an
// exact string match) ---

test("addListingItem matches a Taunt in YOUR OWN inventory even though for_item_name is missing the 'Taunt: ' prefix", () => {
  const h = loadTradeOfferPage({ locationSearch: "?listing_intent=0&for_item_name=Rocket%20Jockey" });
  addInventoryAsset(h, { isYou: true, id: "10", market_hash_name: "Taunt: Rocket Jockey" });
  h.run();

  h.setVal("name_amount_control", "1");
  h.click("btn_addlistingitem");

  const assetIds = h.TRADE_STATUS.me.assets.map((a) => a.assetid);
  assert.equal(assetIds.includes("10"), true);
  assert.equal(h.alerts.length, 0);
});

test("a buy listing for a Taunt automatically adds the matching item from your own inventory once it finishes loading, despite the 'Taunt: ' prefix mismatch", () => {
  const h = loadTradeOfferPage({ locationSearch: "?listing_intent=0&for_item_name=Rocket%20Jockey" });
  addInventoryAsset(h, { isYou: true, id: "10", market_hash_name: "Taunt: Rocket Jockey" });
  h.run();
  dispatchListingLinkTrust(h);

  const invObserver = FakeMutationObserver.instances[FakeMutationObserver.instances.length - 1];
  invObserver.cb([{ addedNodes: [{ id: `inventory_${h.STEAMID}_440_2` }] }]);

  const assetIds = h.TRADE_STATUS.me.assets.map((a) => a.assetid);
  assert.equal(assetIds.includes("10"), true);
  assert.equal(h.alerts.length, 0);
});

test("a sell listing (for_item present) never triggers the buy-listing auto-add, even once your own inventory loads", () => {
  const h = loadTradeOfferPage({ locationSearch: "?for_item=440_2_555" });
  addInventoryAsset(h, { isYou: true, id: "10", market_hash_name: "Rocket Launcher" });
  h.run();

  const invObserver = FakeMutationObserver.instances[FakeMutationObserver.instances.length - 1];
  invObserver.cb([{ addedNodes: [{ id: `inventory_${h.STEAMID}_440_2` }] }]);

  // only the pre-seeded for_item placeholder on THEIR side - nothing of
  // yours was auto-added.
  assert.equal(h.TRADE_STATUS.me.assets.length, 0);
});

// --- classic (non-next) backpack.tf's own native buy-listing link: sends
// for_item unconditionally (confirmed live it resolves to no real asset for
// a buy order), unlike next.backpack.tf which omits it entirely for a buy
// listing - listing_intent must take priority over for_item's mere presence
// for telling the two apart. ---

test("a buy listing with for_item present (classic backpack.tf's own native shape) does NOT blindly push it into their assets or alert 'no longer available'", () => {
  const h = loadTradeOfferPage({ locationSearch: "?for_item=440_2_0&listing_intent=0" });
  h.run();

  const invObserver = FakeMutationObserver.instances[FakeMutationObserver.instances.length - 1];
  invObserver.cb([{ addedNodes: [{ id: `inventory_${h.PARTNER_STEAMID}_440_2` }] }]);

  assert.equal(h.TRADE_STATUS.them.assets.length, 0);
  assert.equal(h.alerts.length, 0);
});

test("a buy listing with for_item present AND for_item_name still adds a matching item from YOUR OWN inventory (not for_item's junk asset)", () => {
  const h = loadTradeOfferPage({ locationSearch: "?for_item=440_2_0&listing_intent=0&for_item_name=Rocket%20Launcher" });
  addInventoryAsset(h, { isYou: true, id: "10", market_hash_name: "Rocket Launcher" });
  h.run();

  h.setVal("name_amount_control", "1");
  h.click("btn_addlistingitem");

  const assetIds = h.TRADE_STATUS.me.assets.map((a) => a.assetid);
  assert.equal(assetIds.includes("10"), true);
  assert.equal(h.TRADE_STATUS.them.assets.length, 0);
  assert.equal(h.alerts.length, 0);
});

// --- rep check banner (showRepCheckWarning) ---

// Regression test: seen as the next.bp.tf/bp.tf/posts.tf/rep.tf
// profile-link buttons only ever appearing once the ban-check banner above
// them did (an up to 15s round trip) - they need nothing from that check's
// own result, only PARTNER_STEAMID (already known synchronously), so they
// were never supposed to wait on it at all. This asserts the row is present
// immediately after h.run() returns, with NO response event dispatched at
// all - if this only relied on the pre-fix behavior (both appended together
// after the await), this would fail exactly the way the live report did.
test("REGRESSION: the profile links row (next.bp.tf/bp.tf/posts.tf/rep.tf) appears immediately, without waiting for the rep-check response at all", () => {
  const h = loadTradeOfferPage();
  const header = new FakeElement("div");
  h.docQueryRegistry.set(".trade_partner_header", header);

  h.run();

  // Neutral "Checking bans…" banner + links row + pure-totals row - the
  // banner is there right away, but no result yet.
  assert.equal(header.children[0].children.length, 3);
  assert.equal(header.children[0].children[0].children[0].textContent, "Checking bans…");
  const linksRow = header.children[0].children[1];
  const labels = linksRow.children.map((a) => a.textContent);
  assert.deepEqual(labels, ["next.bp.tf", "bp.tf", "posts.tf", "rep.tf"]);
  assert.equal(linksRow.children[3].href, `https://rep.tf/${h.PARTNER_STEAMID}`);
});

test("showRepCheckWarning renders a red banner listing banned sites for a flagged partner", async () => {
  const h = loadTradeOfferPage();
  const header = new FakeElement("div");
  h.docQueryRegistry.set(".trade_partner_header", header);

  let requestId = null;
  h.documentListeners["tf2te-resolve-rep-check-request"] = [
    (evt) => (requestId = JSON.parse(evt.detail).requestId),
  ];

  h.run();
  assert.ok(requestId, "expected the rep-check request event to have been dispatched immediately on load");

  h.sandbox.document.dispatchEvent({
    type: "tf2te-resolve-rep-check-response",
    detail: JSON.stringify({ requestId, bannedSites: ["MarketPlace.tf", "Rep.tf"] }),
  });
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(header.children[0].children.length, 3); // banner + profile links row + pure-totals row
  const banner = header.children[0].children[0];
  const title = banner.children[0];
  const detail = banner.children[1];
  assert.equal(title.textContent, "⚠ Potential scammer");
  assert.match(detail.textContent, /MarketPlace\.tf, Rep\.tf/);
});

test("showRepCheckWarning renders a green all-clear banner when the partner isn't flagged anywhere", async () => {
  const h = loadTradeOfferPage();
  const header = new FakeElement("div");
  h.docQueryRegistry.set(".trade_partner_header", header);

  let requestId = null;
  h.documentListeners["tf2te-resolve-rep-check-request"] = [
    (evt) => (requestId = JSON.parse(evt.detail).requestId),
  ];

  h.run();
  h.sandbox.document.dispatchEvent({
    type: "tf2te-resolve-rep-check-response",
    detail: JSON.stringify({ requestId, bannedSites: [] }),
  });
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(header.children[0].children[0].children[0].textContent, "✓ No bans found");
});

// The banner shows a neutral "Checking bans…" state straight away and is
// updated in place - a failed check stays neutral, never a green all-clear.
test("showRepCheckWarning turns the neutral 'Checking bans…' banner into 'Ban check unavailable' (not green) when the check fails", async () => {
  const h = loadTradeOfferPage();
  const header = new FakeElement("div");
  h.docQueryRegistry.set(".trade_partner_header", header);

  let requestId = null;
  h.documentListeners["tf2te-resolve-rep-check-request"] = [
    (evt) => (requestId = JSON.parse(evt.detail).requestId),
  ];

  h.run();
  const banner = header.children[0].children[0];
  assert.equal(banner.children[0].textContent, "Checking bans…");
  assert.ok(banner.style.cssText.includes("rgba(255, 255, 255, 0.25)"), "expected the neutral border");

  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    h.sandbox.document.dispatchEvent({
      type: "tf2te-resolve-rep-check-response",
      detail: JSON.stringify({ requestId, error: "rep.tf unreachable" }),
    });
    await Promise.resolve();
    await Promise.resolve();
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(header.children[0].children[0], banner, "updated in place, not replaced");
  assert.equal(banner.children[0].textContent, "Ban check unavailable");
  assert.doesNotMatch(banner.style.cssText, /#2ecc71/);
});

test("showRepCheckWarning does nothing (and doesn't throw) when the trade_partner_header element isn't present", () => {
  const h = loadTradeOfferPage(); // docQueryRegistry left empty -> querySelector returns null
  assert.doesNotThrow(() => h.run());
});

// --- "Total pure" row (Your/Their keys+metal, shown next to the profile
// links row - built immediately with "…" placeholders, then filled in per
// column either off inventoryManager (real inventory load) or, failing
// that, the fallback timeout so neither column can hang on "…" forever). ---

test("the pure-totals row is appended immediately with placeholders, independent of both the rep-check and inventoryManager", () => {
  const h = loadTradeOfferPage();
  const header = new FakeElement("div");
  h.docQueryRegistry.set(".trade_partner_header", header);

  h.run();

  assert.equal(header.children[0].children.length, 3); // checking-bans banner + links row + pure-totals row
  const pureRow = header.children[0].children.at(-1);
  const [yoursCol, , theirsCol] = pureRow.children; // [yours, divider, theirs]
  // title is now a wrapper (label span + info-dot span clarifying this
  // counts the whole inventory, not just what's staged) - the label text
  // itself lives on its own first child, not the wrapper's own textContent.
  assert.equal(yoursCol.children[0].children[0].textContent, "Your total pure:");
  assert.equal(yoursCol.children[1].textContent, "Keys: …");
  assert.equal(yoursCol.children[2].textContent, "Metals: … ref");
  assert.equal(theirsCol.children[0].children[0].textContent, "Their total pure:");
  assert.equal(theirsCol.children[1].textContent, "Keys: …");
});

test("each pure-totals column fills in from its own side's inventory once the fallback timeout fires", () => {
  const h = loadTradeOfferPage();
  addInventoryAsset(h, { isYou: true, id: "1", market_hash_name: "Mann Co. Supply Crate Key" });
  addInventoryAsset(h, { isYou: true, id: "2", market_hash_name: "Refined Metal" });
  addInventoryAsset(h, { isYou: false, id: "3", market_hash_name: "Scrap Metal" });
  const header = new FakeElement("div");
  h.docQueryRegistry.set(".trade_partner_header", header);

  h.run();

  const pureRow = header.children[0].children.at(-1);
  const [yoursCol, , theirsCol] = pureRow.children;

  // Registration order during run(): yours' own 8s fallback timer, then
  // theirs' - fireNextTimeout() consumes the earliest-registered pending
  // timeout, so the first call resolves "yours".
  h.timers.fireNextTimeout();
  assert.equal(yoursCol.children[1].textContent, "Keys: 1");
  assert.equal(yoursCol.children[2].textContent, "Metals: 1.00 ref");
  assert.equal(theirsCol.children[1].textContent, "Keys: …"); // not resolved yet

  h.timers.fireNextTimeout();
  assert.equal(theirsCol.children[1].textContent, "Keys: 0");
  assert.equal(theirsCol.children[2].textContent, "Metals: 0.11 ref"); // 1 scrap / 9
});

// REGRESSION (anticipated live: "if I have a different inventory selected
// than TF2 and switch to it, make sure it scans the right amount, not 0
// just because a different inventory was loaded first") - simulates the
// exact race: the 8s fallback fires FIRST (TF2's own inventory hasn't
// loaded yet, e.g. the user started on a different app's tab), rendering a
// bogus "Keys: 0", and TF2's real inventory only finishes loading well
// AFTER that. The old code's shared `updated` guard would have silently
// dropped this later, real update - this confirms it now corrects the
// fallback-rendered 0 instead.
test("a pure-totals column is corrected once TF2's own inventory actually loads, even after the 8s fallback already rendered a 0", () => {
  const h = loadTradeOfferPage();
  const header = new FakeElement("div");
  h.docQueryRegistry.set(".trade_partner_header", header);

  h.run();

  const pureRow = header.children[0].children.at(-1);
  const [yoursCol] = pureRow.children;

  // TF2 hasn't loaded yet at the 8s mark - fallback renders a bogus 0.
  h.timers.fireNextTimeout();
  assert.equal(yoursCol.children[1].textContent, "Keys: 0");
  assert.equal(yoursCol.children[2].textContent, "Metals: 0.00 ref");

  // TF2's own inventory finishes loading for real, sometime later.
  addInventoryAsset(h, { isYou: true, id: "1", market_hash_name: "Mann Co. Supply Crate Key" });
  const invObserver = FakeMutationObserver.instances[FakeMutationObserver.instances.length - 1];
  invObserver.cb([{ addedNodes: [{ id: `inventory_${h.STEAMID}_440_2` }] }]);

  assert.equal(yoursCol.children[1].textContent, "Keys: 1");
});

// --- Partner header as a left-hand column (enablePartnerSideColumn) ---
//
// The CSS (via :has()) finds Steam's own wrapper and decides side vs. top;
// these only cover the <html> opt-in class and stepping aside for another
// extension's layout of the header.
function setUpPartnerColumn(h, { headerFloat = "none" } = {}) {
  const header = new FakeElement("div");
  h.docQueryRegistry.set(".trade_partner_header", header);

  const computed = { float: headerFloat, position: "static" };
  h.sandbox.getComputedStyle = (el) => (el === header ? computed : { float: "none", position: "static" });
  h.sandbox.document.documentElement = new FakeElement("html");
  h.sandbox.document.head = new FakeElement("head");

  return { computed, root: h.sandbox.document.documentElement };
}

test("enablePartnerSideColumn opts <html> into the side-column CSS", () => {
  const h = loadTradeOfferPage();
  const { root } = setUpPartnerColumn(h);

  h.run();

  assert.ok(root.classList.contains("tf2te-side-layout"));
});

test("enablePartnerSideColumn steps aside when another extension already floats the header (its own sidebar)", () => {
  const h = loadTradeOfferPage();
  const { root } = setUpPartnerColumn(h, { headerFloat: "left" });

  h.run();

  assert.ok(!root.classList.contains("tf2te-side-layout"));
});

test("enablePartnerSideColumn follows another extension taking the header over, and giving it back, after it already ran", () => {
  const h = loadTradeOfferPage();
  const { computed, root } = setUpPartnerColumn(h);

  h.run();
  const observer = FakeMutationObserver.instances.find((o) => o.target === h.sandbox.document.head);

  // An unrelated <head> change doesn't drop the layout.
  observer.cb([]);
  assert.ok(root.classList.contains("tf2te-side-layout"));

  computed.float = "left";
  observer.cb([]);
  assert.ok(!root.classList.contains("tf2te-side-layout"));

  computed.float = "none";
  observer.cb([]);
  assert.ok(root.classList.contains("tf2te-side-layout"));
});
