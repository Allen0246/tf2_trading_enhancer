import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { __resetSchemaCacheForTests } from "../utils/tf2Schema.js";
import { __resetWarpaintsCacheForTests } from "../utils/warpaints.js";
import { __resetPricedbCacheForTests } from "../utils/pricedb.js";

import { link2Backpack } from "../stntrading.eu/link2Backpack/content.js";

// link2Backpack.js transitively imports utils/tf2StatsLinks/index.js,
// which pulls in utils/tf2Schema.js and utils/warpaints.js - both memoize their
// own resolved promise at module scope for as long as the module stays
// loaded (see each one's own __resetXForTests comment). Since this test file
// imports link2Backpack.js exactly once (not per-test), every test would
// otherwise share whichever schema/warpaints fixture the FIRST test happened
// to resolve, instead of each test's own storage/fetch fixture - reset both
// before every test so they start clean.
test.beforeEach(() => {
  __resetSchemaCacheForTests();
  __resetWarpaintsCacheForTests();
});

// Reused compound-selector fake DOM approach from tests/fixTradeOfferLinks.test.js
// (tag + .class + [attr^=value] matching) - link2Backpack's own DOM queries
// only ever use those three shapes.
function parseCompound(selector) {
  const attrMatch = /\[([\w-]+)\^="([^"]*)"\]/.exec(selector);
  const rest = selector.replace(/\[[^\]]*\]/g, "");
  const classes = [...rest.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
  const tagMatch = /^[a-zA-Z][\w-]*/.exec(rest);
  return {
    tag: tagMatch ? tagMatch[0].toLowerCase() : null,
    classes,
    attrPrefix: attrMatch ? { name: attrMatch[1], value: attrMatch[2] } : null,
  };
}

function matchesCompound(el, parsed) {
  if (!el || el.nodeType !== 1) return false;
  if (parsed.tag && el.tagName.toLowerCase() !== parsed.tag) return false;
  if (!parsed.classes.every((c) => el.classList.contains(c))) return false;
  if (parsed.attrPrefix) {
    const v = el.getAttribute(parsed.attrPrefix.name);
    if (!v || !v.startsWith(parsed.attrPrefix.value)) return false;
  }
  return true;
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.nodeType = 1;
    this.parentElement = null;
    this.children = [];
    this._attrs = {};
    this.dataset = {};
    this.style = {};
    this._textContent = "";
    this._listeners = {};
    this.disabled = false;
    this._classSet = new Set();
    this.classList = {
      contains: (c) => this._classSet.has(c),
      add: (...cs) => cs.forEach((c) => this._classSet.add(c)),
      remove: (...cs) => cs.forEach((c) => this._classSet.delete(c)),
    };
  }
  get textContent() {
    return this._textContent;
  }
  set textContent(v) {
    this._textContent = v;
    this.children = [];
  }
  get className() {
    return [...this._classSet].join(" ");
  }
  set className(v) {
    // A real Element's className/classList are two views onto the same
    // underlying token list - link2Backpack.js itself relies on this (e.g.
    // renderStnPriceInKeys sets `.className` once, then later reads it back
    // via `.classList.contains(...)` to decide whether to reuse the same
    // node), so this fake keeps them in sync too instead of modeling them as
    // two independent, driftable pieces of state.
    this._classSet.clear();
    String(v)
      .split(/\s+/)
      .filter(Boolean)
      .forEach((c) => this._classSet.add(c));
  }
  get isConnected() {
    let el = this;
    while (el.parentElement) el = el.parentElement;
    return el === globalThis.document?.body;
  }
  get href() {
    return this._attrs.href || "";
  }
  set href(v) {
    this._attrs.href = String(v);
  }
  get childElementCount() {
    return this.children.length;
  }
  get nextSibling() {
    if (!this.parentElement) return null;
    const idx = this.parentElement.children.indexOf(this);
    return this.parentElement.children[idx + 1] || null;
  }
  get nextElementSibling() {
    return this.nextSibling;
  }
  getAttribute(name) {
    return name in this._attrs ? this._attrs[name] : null;
  }
  setAttribute(name, value) {
    this._attrs[name] = value;
  }
  // Standard DOM methods the link-state buttons (utils/linkButtonStates.js)
  // rely on: the key hint and the pricedb.io countdown.
  removeAttribute(name) {
    delete this._attrs[name];
  }
  prepend(el) {
    this.children.unshift(el);
    el.parentElement = this;
  }
  replaceWith(el) {
    const siblings = this.parentElement.children;
    siblings.splice(siblings.indexOf(this), 1, el);
    el.parentElement = this.parentElement;
    this.parentElement = null;
  }
  addEventListener(type, cb) {
    (this._listeners[type] ||= []).push(cb);
  }
  dispatchEvent(evt) {
    return Promise.all((this._listeners[evt.type] || []).map((cb) => cb(evt)));
  }
  appendChild(child) {
    if (child.isFragment) {
      for (const c of child.children) this.appendChild(c);
      child.children = [];
      return child;
    }
    this.children.push(child);
    child.parentElement = this;
    return child;
  }
  append(...items) {
    for (const item of items) {
      if (typeof item === "string") {
        // Approximates a real Text node's contribution to this element's own
        // textContent (concatenated with whatever's already there) - link2Backpack.js's
        // own resultEl.append("no live sell listings...") relies on this being readable.
        this._textContent += item;
        continue;
      }
      this.appendChild(item);
    }
  }
  replaceChildren(...items) {
    this.children = [];
    this.append(...items);
  }
  insertBefore(newNode, referenceNode) {
    const idx = referenceNode ? this.children.indexOf(referenceNode) : this.children.length;
    this.children.splice(idx === -1 ? this.children.length : idx, 0, newNode);
    newNode.parentElement = this;
    return newNode;
  }
  insertAdjacentElement(_position, node) {
    if (this.parentElement) {
      const idx = this.parentElement.children.indexOf(this);
      this.parentElement.children.splice(idx + 1, 0, node);
      node.parentElement = this.parentElement;
    }
    return node;
  }
  matches(selector) {
    return matchesCompound(this, parseCompound(selector));
  }
  contains(other) {
    // Matches real Node.contains() semantics, including "a node contains
    // itself" - see findKnownUnusualEffectName's own use of this.
    let el = other;
    while (el) {
      if (el === this) return true;
      el = el.parentElement;
    }
    return false;
  }
  remove() {
    // Matches real Element.remove() - link2Backpack's own live-reactivity
    // listener calls this on the previous wrapper before rebuilding.
    if (!this.parentElement) return;
    const idx = this.parentElement.children.indexOf(this);
    if (idx !== -1) this.parentElement.children.splice(idx, 1);
    this.parentElement = null;
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

function makeFragment() {
  return {
    isFragment: true,
    children: [],
    appendChild(c) {
      this.children.push(c);
      return c;
    },
  };
}

// Builds STN's own page markup shape: an <h1> title, a "Sell it for:"/"Buy
// it for:" price row (two sibling columns under one .row.g-0), each with its
// own <b> price text - just enough structure for findPriceRow/findSellColumn/
// findBuyColumn/findStnPriceElement (all of which locate things by their own
// text content, not by a class name STN might churn).
function buildStnPage({ title, sellPriceText = "19 keys, 31.88 ref", buyPriceText = "20 keys" } = {}) {
  const body = new FakeElement("body");
  const h1 = new FakeElement("h1");
  h1.textContent = title;
  body.appendChild(h1);

  const row = new FakeElement("div");
  row.classList.add("row", "g-0");
  body.appendChild(row);

  const sellCol = new FakeElement("div");
  const sellLabel = new FakeElement("p");
  sellLabel.textContent = "Sell it for:";
  const sellPrice = new FakeElement("p");
  const sellB = new FakeElement("b");
  sellB.textContent = sellPriceText;
  sellPrice.appendChild(sellB);
  sellCol.appendChild(sellLabel);
  sellCol.appendChild(sellPrice);
  row.appendChild(sellCol);

  const buyCol = new FakeElement("div");
  const buyLabel = new FakeElement("p");
  buyLabel.textContent = "Buy it for:";
  const buyPrice = new FakeElement("p");
  const buyB = new FakeElement("b");
  buyB.textContent = buyPriceText;
  buyPrice.appendChild(buyB);
  buyCol.appendChild(buyLabel);
  buyCol.appendChild(buyPrice);
  row.appendChild(buyCol);

  return { body, h1, row, sellCol, buyCol };
}

function installDocument(body) {
  global.document = {
    body,
    querySelector: (selector) => {
      if (selector === ".d-none.d-sm-block h1") return null; // desktop layout - only the plain "h1" match applies
      if (selector === "h1") return body.querySelectorAll("h1")[0] || null;
      return body.querySelector(selector);
    },
    querySelectorAll: (selector) => body.querySelectorAll(selector),
    getElementById: (id) => body.querySelectorAll("*").find((el) => el.getAttribute("id") === id) || null,
    createElement: (tag) => new FakeElement(tag),
    createElementNS: (_ns, tag) => new FakeElement(tag),
    createDocumentFragment: () => makeFragment(),
  };
}

// Base globals every test needs: a real, empty (no cached schema/warpaints)
// backpack.tf/Steam environment, matching tests/tf2StatsLinksIndex.test.js's
// own fixture shapes for chrome.storage.local/chrome.runtime.sendMessage/
// fetch, so resolveStatsAndClassifieds (a real import, not re-mocked) and
// utils/warpaints.js behave exactly as its own
// dedicated test files already establish.
function installBaseGlobals({ storage = {}, sendMessage, fetchImpl } = {}) {
  const onChangedListeners = [];
  global.chrome = {
    storage: {
      local: {
        async get(keys) {
          const result = {};
          for (const k of keys) if (k in storage) result[k] = storage[k];
          return result;
        },
        async set(obj) {
          Object.assign(storage, obj);
        },
      },
      // Minimal real addListener/removeListener - lets link2Backpack's own
      // reactivity (see its own header note on currentReactivityListener)
      // register/re-register against this fake exactly like the real
      // chrome.storage.onChanged API, and lets fireStorageChange below
      // simulate what the popup's own settings Save actually triggers.
      onChanged: {
        addListener(fn) {
          onChangedListeners.push(fn);
        },
        removeListener(fn) {
          const i = onChangedListeners.indexOf(fn);
          if (i !== -1) onChangedListeners.splice(i, 1);
        },
      },
    },
    runtime: {
      sendMessage: sendMessage || (async () => ({ ok: false, error: "no live fetch expected for this test" })),
    },
  };
  global.fetch = fetchImpl || (async () => ({ json: async () => [] })); // warpaints.json - empty by default (no skins needed)
  global.MutationObserver = class {
    constructor(cb) {
      this.cb = cb;
      this.disconnected = false;
      global.MutationObserver.instances.push(this);
    }
    observe(target, opts) {
      this.target = target;
      this.opts = opts;
    }
    disconnect() {
      this.disconnected = true;
    }
  };
  global.MutationObserver.instances = [];

  // Simulates a chrome.storage.local.set({...}) elsewhere (the popup's own
  // Save button) - real chrome.storage.onChanged fires with {newValue} pairs
  // shaped exactly like this, "local" as the area. Doesn't touch `storage`
  // itself (a caller wanting the fake get() to also reflect the new value
  // should update `storage` directly first) - this only fires the event.
  function fireStorageChange(changesByKey) {
    const changes = {};
    for (const [key, newValue] of Object.entries(changesByKey)) changes[key] = { newValue };
    onChangedListeners.slice().forEach((fn) => fn(changes, "local"));
  }

  return { storage, fireStorageChange };
}

// Same fixture pattern tests/nextUiCopyItemName.test.js/
// tests/oldUiCopyItemName.test.js already use for their own click-to-copy
// coverage.
function installFakeClipboard(writeTextImpl) {
  Object.defineProperty(global, "navigator", {
    value: { clipboard: { writeText: writeTextImpl } },
    configurable: true,
  });
}

test("does nothing (and doesn't throw) when no h1 item title is found on the page", async () => {
  const body = new FakeElement("body");
  installDocument(body);
  installBaseGlobals();

  await assert.doesNotReject(() => link2Backpack());
  assert.equal(body.children.length, 0);
});

test("builds next.bp.tf and bp.tf stats+classifieds button rows, plus gladiator.tf, marketplace.tf, mannco.store, and Steam Market, for a plain item", async () => {
  const { body } = buildStnPage({ title: "Rocket Launcher" });
  installDocument(body);
  installBaseGlobals();

  await link2Backpack();

  const wrapper = body.querySelectorAll(".px-3")[0];
  assert.ok(wrapper, "expected the link wrapper to have been inserted");

  const allLinks = wrapper.querySelectorAll("a");
  const labels = allLinks.map((a) => a.textContent);
  assert.ok(labels.includes("next.bp.tf stats"));
  assert.ok(labels.includes("bp.tf stats"));
  assert.ok(labels.includes("gladiator.tf"));
  assert.ok(labels.includes("marketplace.tf"));
  assert.ok(labels.includes("mannco.store"));
  assert.ok(labels.includes("Steam Market"));
  // pricedb.io's own search fails by default (installBaseGlobals' default
  // sendMessage always returns {ok: false}), and posts.tf needs a schema
  // defindex this test's own empty storage never provides - both are
  // covered by their own dedicated tests below instead.
  assert.equal(labels.includes("pricedb.io"), false);
  assert.equal(labels.includes("posts.tf"), false);

  const gladiatorLink = allLinks.find((a) => a.textContent === "gladiator.tf");
  assert.equal(gladiatorLink.href, "https://gladiator.tf/sales?item=Rocket+Launcher");

  const mannStoreLink = allLinks.find((a) => a.textContent === "mannco.store");
  const mannParams = new URL(mannStoreLink.href).searchParams;
  assert.equal(mannParams.get("search"), "Rocket Launcher");
  assert.equal(mannParams.get("quality"), "Unique");

  const steamMarketLink = allLinks.find((a) => a.textContent === "Steam Market");
  assert.match(steamMarketLink.href, /^https:\/\/steamcommunity\.com\/market\/listings\/440\/Rocket%20Launcher/);
});

// Regression: marketplace.tf and mannco.store visually wrapped onto separate
// lines at the default Bootstrap button size, so both compact rows use the
// smaller btn-sm size. They must still be allowed to wrap: a nowrap row wider
// than the Sell column overflowed into the Buy column and overlapped what
// was there (STN's price row has no column gutter).
test("marketplace.tf/mannco.store share one compact (btn-sm) row that can still wrap instead of overflowing the column", async () => {
  const { body } = buildStnPage({ title: "Rocket Launcher" });
  installDocument(body);
  installBaseGlobals();

  await link2Backpack();

  const wrapper = body.querySelectorAll(".px-3")[0];
  const marketplaceLink = wrapper.querySelectorAll("a").find((a) => a.textContent === "marketplace.tf");
  const mannStoreLink = wrapper.querySelectorAll("a").find((a) => a.textContent === "mannco.store");

  assert.equal(marketplaceLink.classList.contains("btn-sm"), true);
  assert.equal(mannStoreLink.classList.contains("btn-sm"), true);
  assert.equal(marketplaceLink.parentElement, mannStoreLink.parentElement, "expected both in the same row div");
  assert.equal(marketplaceLink.parentElement.style.flexWrap, "wrap");
});

test("gladiator.tf/pricedb.io/posts.tf also use the compact (btn-sm) sizing and wrap instead of overflowing the column", async () => {
  const { body } = buildStnPage({ title: "Rocket Launcher" });
  installDocument(body);
  installBaseGlobals();

  await link2Backpack();

  const wrapper = body.querySelectorAll(".px-3")[0];
  const gladiatorLink = wrapper.querySelectorAll("a").find((a) => a.textContent === "gladiator.tf");
  assert.equal(gladiatorLink.classList.contains("btn-sm"), true);
  assert.equal(gladiatorLink.parentElement.style.flexWrap, "wrap");
});

test("includes a pricedb.io button, right after gladiator.tf, once its search resolves a sku", async () => {
  const { body } = buildStnPage({ title: "Rocket Launcher" });
  installDocument(body);
  installBaseGlobals({
    sendMessage: async (msg) => {
      if (msg.url.includes("pricedb.io/api/search")) {
        return { ok: true, data: { success: true, data: { results: [{ sku: "205;6" }] } } };
      }
      return { ok: false, error: "unexpected url: " + msg.url };
    },
  });

  await link2Backpack();
  await flushMicrotasks(); // pricedb.io's slot settles after the buttons are shown

  const wrapper = body.querySelectorAll(".px-3")[0];
  const allLinks = wrapper.querySelectorAll("a");
  const labels = allLinks.map((a) => a.textContent);
  const gladiatorIndex = labels.indexOf("gladiator.tf");
  const pricedbIndex = labels.indexOf("pricedb.io");
  assert.ok(gladiatorIndex >= 0);
  assert.equal(pricedbIndex, gladiatorIndex + 1);

  const pricedbLink = allLinks.find((a) => a.textContent === "pricedb.io");
  assert.equal(pricedbLink.href, "https://pricedb.io/item/205%3B6");
});

// A rate-limited lookup used to look IDENTICAL to "this item genuinely has
// no pricedb.io listing" here too - both just silently omitted the button.
// searchPricedbSkuStatus surfaces the real 429 (see utils/pricedb.js's own
// note) so this can show something instead, as a non-clickable <span> (never
// a dead <a> with no href) in the same slot.
test("shows a non-clickable 'pricedb.io (rate limited)' span, right after gladiator.tf, on a real 429", async () => {
  // utils/pricedb.js's own in-memory cache is keyed per item name, not per
  // test - every other test in this file that uses "Rocket Launcher" expects
  // the SAME real sku, so nothing else here ever resets it. This test needs
  // a fresh (uncached) lookup to actually exercise the 429 branch below.
  __resetPricedbCacheForTests();
  const { body } = buildStnPage({ title: "Rocket Launcher" });
  installDocument(body);
  installBaseGlobals({
    sendMessage: async (msg) => {
      if (msg.url.includes("pricedb.io/api/search")) {
        return { ok: false, status: 429, error: "Rate limited (429)" };
      }
      return { ok: false, error: "unexpected url: " + msg.url };
    },
  });

  await link2Backpack();
  await flushMicrotasks(); // pricedb.io's slot settles after the buttons are shown

  const wrapper = body.querySelectorAll(".px-3")[0];
  assert.equal(wrapper.querySelectorAll("a").some((a) => a.textContent.includes("pricedb.io")), false);

  // A countdown from pricedb.io's Retry-After (30s by default here), then a
  // retry - see the next test.
  const placeholder = wrapper.querySelectorAll("span").find((s) => s.textContent === "pricedb.io 30s");
  assert.ok(placeholder, "expected the countdown");
  assert.match(placeholder.title, /Retrying automatically in 30s/);

  const rowLabels = placeholder.parentElement.children.map((c) => c.textContent);
  const gladiatorIndex = rowLabels.indexOf("gladiator.tf");
  const placeholderIndex = rowLabels.indexOf("pricedb.io 30s");
  assert.equal(placeholderIndex, gladiatorIndex + 1);
});

test("when the pricedb.io countdown ends, only that button retries and is replaced in place by the real link", async () => {
  mock.timers.enable({ apis: ["setInterval"] });
  try {
    __resetPricedbCacheForTests();
    const { body } = buildStnPage({ title: "Rocket Launcher" });
    installDocument(body);
    let limited = true;
    let lookups = 0;
    installBaseGlobals({
      sendMessage: async (msg) => {
        if (msg.url.includes("pricedb.io/api/search")) {
          lookups++;
          if (limited) return { ok: false, status: 429, error: "Rate limited (429)", retryAfterMs: 2000 };
          const q = new URL(msg.url).searchParams.get("q");
          return { ok: true, data: { success: true, data: { results: [{ name: q, sku: "205;6" }] } } };
        }
        return { ok: false, error: "unexpected url: " + msg.url };
      },
    });

    await link2Backpack();
  await flushMicrotasks(); // pricedb.io's slot settles after the buttons are shown
    const wrapper = body.querySelectorAll(".px-3")[0];
    const countdown = wrapper.querySelectorAll("span").find((s) => s.textContent === "pricedb.io 2s");
    assert.ok(countdown);
    const row = countdown.parentElement;
    const indexBefore = row.children.indexOf(countdown);

    limited = false;
    const lookupsBefore = lookups;
    mock.timers.tick(2000);
    await flushMicrotasks();

    assert.equal(lookups - lookupsBefore, 1, "only the pricedb.io lookup re-runs, not the whole page");
    const link = row.children[indexBefore];
    assert.equal(link.tagName, "a");
    assert.equal(link.href, "https://pricedb.io/item/205%3B6");
  } finally {
    mock.timers.reset();
  }
});

// Regression: pricedb.io's own /api/search silently returns zero results for a
// query that still has the literal "Unusual " quality word in it (confirmed live
// against the real API - "Unusual Burning Flames Flamehawk" => 0 results,
// "Burning Flames Flamehawk" => 1 result), so the button used to just never
// appear for any Unusual item at all - this page's own raw title DOES include
// that literal word (confirmed live via the page's own h1 text), it doesn't omit
// it the way an earlier note here assumed. Same "{Effect Name} {Item Name}"
// convention pricedb.io itself uses.
test("pricedb.io search omits the literal 'Unusual' word for an Unusual item, matching pricedb.io's own convention", async () => {
  const { body } = buildStnPage({ title: "Unusual Burning Flames Flamehawk" });
  installDocument(body);
  let capturedQuery = null;
  installBaseGlobals({
    storage: {
      tf2SchemaCache: {
        itemNameToDefindex: {},
        defindexToItemName: {},
        effectNameToId: { "Burning Flames": 13 },
        fetchedAt: Date.now(),
        schemaShapeVersion: 4,
      },
    },
    sendMessage: async (msg) => {
      if (msg.url.includes("pricedb.io/api/search")) {
        capturedQuery = new URL(msg.url).searchParams.get("q");
        return { ok: true, data: { success: true, data: { results: [{ sku: "31107;5;u13" }] } } };
      }
      return { ok: false, error: "unexpected url: " + msg.url };
    },
  });

  await link2Backpack();
  await flushMicrotasks(); // pricedb.io's slot settles after the buttons are shown

  assert.equal(capturedQuery, "Burning Flames Flamehawk");

  const wrapper = body.querySelectorAll(".px-3")[0];
  const pricedbLink = wrapper.querySelectorAll("a").find((a) => a.textContent === "pricedb.io");
  assert.ok(pricedbLink, "expected a pricedb.io button once the corrected query resolves a sku");
  assert.equal(pricedbLink.href, "https://pricedb.io/item/31107%3B5%3Bu13");
});

// E1 on the manual test pass: gladiator.tf names an Unusual "{Effect} {Item}"
// like pricedb.io (reported live: ?item=Unusual+Smoking+Elf+Esteem should be
// ?item=Smoking+Elf+Esteem).
test("gladiator.tf searches '{Effect} {Item}' for an Unusual, without stntrading.eu's 'Unusual' word", async () => {
  const { body } = buildStnPage({ title: "Unusual Smoking Elf Esteem" });
  installDocument(body);
  installBaseGlobals({
    storage: {
      tf2SchemaCache: {
        itemNameToDefindex: {},
        defindexToItemName: {},
        effectNameToId: { Smoking: 35 },
        fetchedAt: Date.now(),
        schemaShapeVersion: 4,
      },
    },
    sendMessage: async () => ({ ok: false, error: "no network needed for gladiator.tf" }),
  });

  await link2Backpack();
  await flushMicrotasks();

  const wrapper = body.querySelectorAll(".px-3")[0];
  const gladiatorLink = wrapper.querySelectorAll("a").find((a) => a.textContent === "gladiator.tf");
  assert.equal(gladiatorLink.href, "https://gladiator.tf/sales?item=Smoking+Elf+Esteem");
});

// Regression: without a key, resolveUnusualEffect had no way to even know
// WHICH part of the raw title was the effect name, so the ENTIRE Unusual
// branch bailed out with statsUnresolved - killing next.bp.tf/bp.tf stats,
// marketplace.tf, mannco.store, posts.tf, and pricedb.io all at once, even
// though most of them only actually need the effect NAME (not its numeric
// id) to work at all. stntrading.eu's own item page already prints the name
// explicitly ("★ Unusual Effect: X") - findKnownUnusualEffectName reads it
// and passes it through as knownEffectName, letting resolveUnusualEffect's
// own graceful no-schema fallback (see utils/tf2StatsLinks/unusual.js) kick
// in.
//
// bp.tf/next.bp.tf themselves are a deliberate EXCEPTION to that: unlike
// pricedb.io/mannco.store, their own stats/classifieds links need the exact
// numeric effect id to point at the specific effect, not just its name -
// without one they'd show every effect of the item mixed together (or, for
// next.backpack.tf, none at all), which isn't the correct, specific link the
// user wants. So those two stay hidden (with the "needs a Steam Web API key"
// warning shown again) until a key resolves the real id - see this file's
// own unusualEffectIdUnresolved note. This used to assert bp.tf/next.bp.tf
// stats stayed hidden without a Steam Web API key, even with a known effect
// NAME - utils/tf2Schema.js's own getEffectId now checks
// utils/unusualEffectIds.js's own static table FIRST, and "Otherworldly
// Weather" is a real entry there (id 307), so stats links now resolve with
// no key at all too, not just pricedb.io/mannco.store. The API key warning
// can still appear for a DIFFERENT reason on this page (posts.tf's own
// item-name->defindex lookup is unrelated to effect ids and still genuinely
// needs a live schema, per this file's own "includes a posts.tf button...
// once the item's schema defindex resolves" test right below) - this fixture
// has no schema configured at all, so that half of the combined warning
// still fires.
test("resolves an Unusual's effect name from stntrading.eu's own '★ Unusual Effect:' label via the static table, unlocking bp.tf/next.bp.tf stats too - with no Steam Web API key needed", async () => {
  const { body } = buildStnPage({ title: "Unusual Otherworldly Weather Mean Captain" });
  // Real markup shape (confirmed live): a <p> with a trailing <br> child, not
  // a true leaf - this file's own header note above findKnownUnusualEffectName
  // in link2Backpack/content.js explains why a strict "no children at all"
  // check (an earlier version of that function) never matched this and
  // requires FakeElement.append (not the textContent setter, which wipes
  // children) so this fixture actually has a non-text child too.
  const effectLabel = new FakeElement("p");
  effectLabel.append("★ Unusual Effect: Otherworldly Weather");
  effectLabel.appendChild(new FakeElement("br"));
  body.appendChild(effectLabel);
  installDocument(body);

  let capturedPricedbQuery = null;
  installBaseGlobals({
    // Deliberately no tf2SchemaCache/steamApiKey at all - the whole point of
    // this test is that pricedb.io/mannco.store no longer need either.
    sendMessage: async (msg) => {
      if (msg.url.includes("pricedb.io/api/search")) {
        capturedPricedbQuery = new URL(msg.url).searchParams.get("q");
        return { ok: true, data: { success: true, data: { results: [{ sku: "378;5;u126" }] } } };
      }
      return { ok: false, error: "unexpected url: " + msg.url };
    },
  });

  await link2Backpack();
  await flushMicrotasks(); // pricedb.io's slot settles after the buttons are shown

  assert.equal(capturedPricedbQuery, "Otherworldly Weather Mean Captain");

  const wrapper = body.querySelectorAll(".px-3")[0];
  const allLinks = wrapper.querySelectorAll("a");

  assert.ok(allLinks.find((a) => a.textContent === "pricedb.io"), "expected a pricedb.io button");

  const mannStoreLink = allLinks.find((a) => a.textContent === "mannco.store");
  assert.ok(mannStoreLink, "expected a mannco.store button");
  const mannParams = new URL(mannStoreLink.href).searchParams;
  assert.equal(mannParams.get("search"), "Mean Captain");
  assert.equal(mannParams.get("effect"), "Otherworldly Weather");

  const bpStatsLink = allLinks.find((a) => a.textContent === "bp.tf stats");
  const nextBpStatsLink = allLinks.find((a) => a.textContent === "next.bp.tf stats");
  assert.ok(bpStatsLink, "expected bp.tf stats to resolve via the static effect-id table");
  assert.ok(nextBpStatsLink, "expected next.bp.tf stats to resolve via the static effect-id table");
  // Trailing path segment is the effect's own numeric particle id (307 for
  // Otherworldly Weather in utils/unusualEffectIds.js).
  assert.ok(bpStatsLink.href.endsWith("/307"));
  assert.ok(nextBpStatsLink.href.endsWith("/307"));

  // posts.tf still needs the key (this fixture has no schema at all, and
  // posts.tf's defindex lookup is unrelated to effect ids): its own compact
  // key hint, no stats prompt, no warning box.
  assert.ok(findKeyHint(wrapper, "posts.tf"), "expected posts.tf's key hint");
  assert.equal(findKeyHint(wrapper, "Set Steam API key for stats/classifieds"), undefined);
  assert.equal(allLinks.find((a) => a.textContent === "Get a Steam Web API key"), undefined, "the old warning box is gone");
});

test("includes a posts.tf button, right after pricedb.io, once the item's schema defindex resolves", async () => {
  const { body } = buildStnPage({ title: "Rocket Launcher" });
  installDocument(body);
  installBaseGlobals({
    storage: {
      tf2SchemaCache: {
        itemNameToDefindex: { "Rocket Launcher": 205 },
        defindexToItemName: {},
        effectNameToId: {},
        fetchedAt: Date.now(),
        schemaShapeVersion: 4,
      },
    },
    sendMessage: async (msg) => {
      if (msg.url.includes("pricedb.io/api/search")) {
        return { ok: true, data: { success: true, data: { results: [{ sku: "205;6" }] } } };
      }
      return { ok: false, error: "unexpected url: " + msg.url };
    },
  });

  await link2Backpack();
  await flushMicrotasks(); // pricedb.io's slot settles after the buttons are shown

  const wrapper = body.querySelectorAll(".px-3")[0];
  const allLinks = wrapper.querySelectorAll("a");
  const labels = allLinks.map((a) => a.textContent);
  const pricedbIndex = labels.indexOf("pricedb.io");
  const postsTfIndex = labels.indexOf("posts.tf");
  assert.ok(pricedbIndex >= 0);
  assert.equal(postsTfIndex, pricedbIndex + 1);

  const postsTfLink = allLinks.find((a) => a.textContent === "posts.tf");
  const b64 = new URL(postsTfLink.href).searchParams.get("q");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const query = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  assert.deepEqual(query.u[0], { defindex: 205, quality: 6, craftable: true });
});

// Regression: buildPostsTfLink needs the item's numeric defindex from the
// schema for EVERY item type it covers, unlike bp.tf/next.bp.tf's own
// name-based stats URLs, which need no schema at all for a generic item -
// confirmed live the user had no Steam Web API key configured, but
// statsUnresolved stayed false the whole time since
// resolveStatsAndClassifieds genuinely resolved everything IT needed. See
// link2Backpack's own postsTfUnresolved note.
test("shows the 'needs a Steam Web API key' warning when only posts.tf fails to resolve, even though stats/classifieds/everything else worked fine", async () => {
  const { body } = buildStnPage({ title: "Earbuds" });
  installDocument(body);
  // No tf2SchemaCache at all - matches "no key configured" (getItemDefindex
  // returns null for every name), same real-world state that surfaced this.
  installBaseGlobals();

  await link2Backpack();

  const wrapper = body.querySelectorAll(".px-3")[0];
  const allLinks = wrapper.querySelectorAll("a");

  // Confirms the premise: nothing else is broken here.
  assert.ok(allLinks.find((a) => a.textContent === "bp.tf stats"), "expected bp.tf stats to still work");
  assert.ok(allLinks.find((a) => a.textContent === "next.bp.tf stats"), "expected next.bp.tf stats to still work");
  assert.ok(allLinks.find((a) => a.textContent === "Steam Market"), "expected Steam Market to still work");
  assert.equal(allLinks.find((a) => a.textContent === "posts.tf"), undefined, "posts.tf should be missing");

  // Only posts.tf needs the key here, so only posts.tf gets the key hint.
  assert.ok(findKeyHint(wrapper, "posts.tf"), "expected posts.tf's key hint");
  assert.equal(findKeyHint(wrapper, "Set Steam API key for stats/classifieds"), undefined);
  assert.equal(allLinks.find((a) => a.textContent === "Get a Steam Web API key"), undefined, "the old warning box is gone");
});

test("with a key saved, a posts.tf link that still can't resolve gets no key hint (a key wouldn't help)", async () => {
  const { body } = buildStnPage({ title: "Earbuds" });
  installDocument(body);
  const { storage } = installBaseGlobals();
  storage.steamApiKey = "abc123";

  await link2Backpack();

  const wrapper = body.querySelectorAll(".px-3")[0];
  assert.equal(findKeyHint(wrapper, "posts.tf"), undefined);
  assert.equal(wrapper.querySelectorAll("a").find((a) => a.textContent === "posts.tf"), undefined);
});

test("does NOT show the 'needs a Steam Web API key' warning for an item type posts.tf never covers regardless of any key (e.g. a Killstreak Kit)", async () => {
  const { body } = buildStnPage({ title: "Specialized Killstreak Rocket Launcher Kit" });
  installDocument(body);
  installBaseGlobals({
    storage: {
      tf2SchemaCache: {
        itemNameToDefindex: { "Rocket Launcher": 205 },
        defindexToItemName: {},
        effectNameToId: {},
        fetchedAt: Date.now(),
        schemaShapeVersion: 4,
      },
    },
  });

  await link2Backpack();

  const wrapper = body.querySelectorAll(".px-3")[0];
  const allLinks = wrapper.querySelectorAll("a");
  assert.equal(allLinks.find((a) => a.textContent === "posts.tf"), undefined, "posts.tf isn't built for Kits at all yet");

  const warningLink = allLinks.find((a) => a.textContent === "Get a Steam Web API key");
  assert.equal(warningLink, undefined, "no Steam Web API key would fix this - a real key IS configured, this is just an unbuilt item type");
});

test("builds a mannco.store search with the resolved Unusual effect name, once a Steam API key resolves it", async () => {
  // Same raw title shape this file's own "clicking the item title copies its
  // plain text" test above already uses: STN's own page bakes the quality
  // word AND the effect name together into the raw title text (unlike
  // scrap.tf's tooltip-only effect display) - resolveUnusualEffect finds the
  // effect name via a schema substring match against the text following
  // "Unusual ".
  const { body } = buildStnPage({ title: "Unusual Burning Flames Troublemaker's Tossle Cap" });
  installDocument(body);
  installBaseGlobals({
    storage: {
      steamApiKey: "KEY",
      tf2SchemaCache: {
        itemNameToDefindex: {},
        defindexToItemName: {},
        effectNameToId: { "Burning Flames": 13 },
        fetchedAt: Date.now(),
        schemaShapeVersion: 4,
      },
    },
  });

  await link2Backpack();

  const wrapper = body.querySelectorAll(".px-3")[0];
  const mannStoreLink = wrapper.querySelectorAll("a").find((a) => a.textContent === "mannco.store");
  const params = new URL(mannStoreLink.href).searchParams;
  assert.equal(params.get("search"), "Troublemaker's Tossle Cap");
  assert.equal(params.get("quality"), "Unusual");
  assert.equal(params.get("effect"), "Burning Flames");
});

// REGRESSION for a live bug report: this file's own buildMannStoreHref
// (duplicated from steamcommunity.com/shared/quickLinkButtons.js's own twin,
// since a stntrading.eu content script can't reach that file - see this
// function's own header note) used to assume a Decorated Weapon is only ever
// Unique or Strange, confirmed live wrong via "Strange Unusual Professional
// Killstreak Star Crossed Iron Bomber" - genuinely Unusual, with Strange just
// an add-on tracking descriptor.
test("builds a mannco.store search with Unusual quality for a Killstreak-attached Unusual Decorated Weapon, even though the raw title also says Strange", async () => {
  const { body } = buildStnPage({ title: "Strange Unusual Professional Killstreak Star Crossed Iron Bomber (Factory New)" });
  installDocument(body);
  installBaseGlobals({
    fetchImpl: async () => ({ json: async () => [{ name: "Star Crossed", defindex: 100 }] }),
  });
  global.chrome.runtime.getURL = (path) => path;

  await link2Backpack();

  const wrapper = body.querySelectorAll(".px-3")[0];
  const mannStoreLink = wrapper.querySelectorAll("a").find((a) => a.textContent === "mannco.store");
  const params = new URL(mannStoreLink.href).searchParams;
  assert.equal(params.get("search"), "Iron Bomber");
  assert.equal(params.get("quality"), "Unusual");
});

// --- click-to-copy on the item title ----------------------------------------

test("marks the item title clickable-to-copy", async () => {
  const { body, h1 } = buildStnPage({ title: "Rocket Launcher" });
  installDocument(body);
  installBaseGlobals();

  await link2Backpack();

  assert.equal(h1.style.cursor, "pointer");
  assert.equal(h1.title, "Click to copy item name");
});

test("hovering the item title dims it, and unhovering restores it", async () => {
  const { body, h1 } = buildStnPage({ title: "Rocket Launcher" });
  installDocument(body);
  installBaseGlobals();

  await link2Backpack();

  await h1.dispatchEvent({ type: "mouseenter" });
  assert.equal(h1.style.opacity, "0.8");

  await h1.dispatchEvent({ type: "mouseleave" });
  assert.equal(h1.style.opacity, "");
});

test("clicking the item title copies its plain text and flashes success", async () => {
  const { body, h1 } = buildStnPage({ title: "Unusual Burning Flames Troublemaker's Tossle Cap" });
  installDocument(body);
  installBaseGlobals();

  const written = [];
  installFakeClipboard(async (text) => written.push(text));

  await link2Backpack();
  await h1.dispatchEvent({ type: "click" });

  assert.deepEqual(written, ["Unusual Burning Flames Troublemaker's Tossle Cap"]);
  assert.equal(h1.style.backgroundColor, "rgba(0, 150, 0, 0.3)");
});

test("clicking the item title flashes error (not success) when the clipboard write rejects", async () => {
  const { body, h1 } = buildStnPage({ title: "Rocket Launcher" });
  installDocument(body);
  installBaseGlobals();
  installFakeClipboard(async () => {
    throw new Error("denied");
  });

  await link2Backpack();
  await h1.dispatchEvent({ type: "click" });

  assert.equal(h1.style.backgroundColor, "rgba(150, 0, 0, 0.3)");
});

test("shows the API key warning banner instead of stats links when a schema lookup can't resolve (Strangifier, no Steam key)", async () => {
  const { body } = buildStnPage({ title: "Righteous Bison Strangifier" });
  installDocument(body);
  installBaseGlobals(); // no steamApiKey in storage at all

  await link2Backpack();

  const wrapper = body.querySelectorAll(".px-3")[0];
  // One compact prompt where the stats rows would be; it covers posts.tf too.
  const statsPrompt = findKeyHint(wrapper, "Set Steam API key for stats/classifieds");
  assert.ok(statsPrompt, "expected the stats/classifieds key prompt");
  assert.match(statsPrompt.title, /posts\.tf/);
  assert.equal(findKeyHint(wrapper, "posts.tf"), undefined, "no second prompt for posts.tf");
  assert.equal(wrapper.querySelectorAll("a").find((a) => a.textContent === "Get a Steam Web API key"), undefined);
});

test("resolves a Strangifier's stats link once its target weapon is in the cached schema", async () => {
  const { body } = buildStnPage({ title: "Rocket Launcher Strangifier" });
  installDocument(body);
  installBaseGlobals({
    storage: {
      steamApiKey: "KEY",
      tf2SchemaCache: {
        // "Strangifier" itself (not just its target weapon) is now also
        // needed for a full resolve - see buildPostsTfLink's own CORRECTION
        // note: a plain Strangifier's posts.tf link is no longer excluded by
        // design, so a real, complete schema (which this fixture is meant to
        // simulate) would carry that entry too, same as it would for any
        // other plain item's own defindex.
        itemNameToDefindex: { "Rocket Launcher": 205, Strangifier: 5661 },
        defindexToItemName: {},
        effectNameToId: {},
        fetchedAt: Date.now(),
        schemaShapeVersion: 4,
      },
    },
  });

  await link2Backpack();

  const wrapper = body.querySelectorAll(".px-3")[0];
  const warningLink = wrapper.querySelectorAll("a").find((a) => a.textContent === "Get a Steam Web API key");
  assert.equal(warningLink, undefined, "should not show the API key warning once the schema resolves");
  const bpStats = wrapper.querySelectorAll("a").find((a) => a.textContent === "bp.tf stats");
  assert.ok(bpStats);
});

// REGRESSION for a live bug report, with a real screenshot ("Widowmaker
// Strangifier" on stntrading.eu's own item page): this file's own
// buildMannStoreHref (duplicated from steamcommunity.com/shared/
// quickLinkButtons.js's own twin) used to bail out to null unconditionally
// for every target-item tool (filters.targetItemName set), even after that
// shared twin already got a confirmed-live fix for exactly this case - it
// just never got ported back into this file's own separate copy. No Steam
// Web API key needed for this - resolveClassifiedsFilters' own target-tool
// branch (and buildMannStoreHref itself) resolve synchronously, no schema
// lookup involved (unlike the bp.tf/next.bp.tf stats links, which DO need
// one - see the API-key-warning test above for that separate gap).
test("builds a mannco.store search for a target-item tool (Strangifier), not just a null/missing button", async () => {
  const { body } = buildStnPage({ title: "Widowmaker Strangifier" });
  installDocument(body);
  installBaseGlobals(); // no steamApiKey - shouldn't matter for this button

  await link2Backpack();

  const wrapper = body.querySelectorAll(".px-3")[0];
  const mannStoreLink = wrapper.querySelectorAll("a").find((a) => a.textContent === "mannco.store");
  assert.ok(mannStoreLink, "expected a mannco.store button for a Strangifier");
  const params = new URL(mannStoreLink.href).searchParams;
  assert.equal(params.get("search"), "Widowmaker Strangifier");
});

// REGRESSION for a live bug report: buildPostsTfLink (utils/tf2StatsLinks/
// index.js) used to exclude EVERY target-item tool unconditionally, on the
// (too strong) claim that posts.tf has no search for them at all. Corrected
// after decoding a REAL posts.tf URL off backpack.tf's own hover tooltip for
// a different Strangifier - the payload was {"defindex":5661,"quality":6,
// "craftable":true}, no target field at all, proving posts.tf DOES have a
// working (if generic, non-target-filtered) search for a plain Strangifier.
// "Strangifier" itself is a real schema item name (defindex 5661, per that
// same decoded payload), so this needs the schema cached to resolve.
test("builds a generic (non-target-filtered) posts.tf search for a target-item tool (Strangifier), once its own schema entry resolves", async () => {
  const { body } = buildStnPage({ title: "Widowmaker Strangifier" });
  installDocument(body);
  installBaseGlobals({
    storage: {
      steamApiKey: "KEY",
      tf2SchemaCache: {
        itemNameToDefindex: { Strangifier: 5661 },
        defindexToItemName: {},
        effectNameToId: {},
        fetchedAt: Date.now(),
        schemaShapeVersion: 4,
      },
    },
  });

  await link2Backpack();

  const wrapper = body.querySelectorAll(".px-3")[0];
  const postsTfLink = wrapper.querySelectorAll("a").find((a) => a.textContent === "posts.tf");
  assert.ok(postsTfLink, "expected a posts.tf button for a Strangifier");
  const payload = JSON.parse(Buffer.from(new URL(postsTfLink.href).searchParams.get("q"), "base64").toString());
  assert.deepEqual(payload, { u: [{ defindex: 5661, quality: 6, craftable: true }], p: [], d: "", m: false });
});

// --- Australium name-casing fix ---------------------------------------

// Stntrading.eu's own raw item title capitalized this Australium weapon
// wrong ("Force-A-Nature", capital A) - the real schema entry is
// "Force-a-Nature" (lowercase a) - which silently 404'd EVERY exact-case
// link built from it (next.backpack.tf's classifieds AND stats pages,
// confirmed live). Corrected once, before any link is built (see correctAustraliumCasing's
// own note) so every downstream button benefits, not just one. Schema
// fixture matches the REAL confirmed-live TF2 schema for this weapon (dumped
// live via GetSchemaItems): only a bare "Force-a-Nature" (defindex 45) and
// "Festive Force-a-Nature" entry exist - there is NO separate "Australium
// Force-a-Nature" schema entry at all. The casing fix here comes from the
// hardcoded KNOWN_ITEM_NAME_CASINGS table (not this schema fixture) - see
// the "even with ZERO schema data" test below for that same case proven
// independently of any schema at all.
test("corrects a mis-cased Australium weapon name before building ANY of the outbound links, and resolves posts.tf via the BARE weapon's own defindex + australium flag", async () => {
  const { body, h1 } = buildStnPage({ title: "Strange Australium Force-A-Nature" });
  installDocument(body);
  installBaseGlobals({
    storage: {
      tf2SchemaCache: {
        itemNameToDefindex: { "Force-a-Nature": 45 },
        defindexToItemName: {},
        effectNameToId: {},
        fetchedAt: Date.now(),
        schemaShapeVersion: 4,
      },
    },
  });

  await link2Backpack();

  const wrapper = body.querySelectorAll(".px-3")[0];
  const allLinks = wrapper.querySelectorAll("a");

  const gladiatorLink = allLinks.find((a) => a.textContent === "gladiator.tf");
  assert.equal(gladiatorLink.href, "https://gladiator.tf/sales?item=Strange+Australium+Force-a-Nature");

  const nextStats = allLinks.find((a) => a.textContent === "next.bp.tf stats");
  const nextParams = new URL(nextStats.href).searchParams;
  assert.equal(nextParams.get("item"), "Force-a-Nature");
  assert.equal(nextParams.get("australium"), "true");

  const bpStats = allLinks.find((a) => a.textContent === "bp.tf stats");
  assert.equal(bpStats.href, "https://backpack.tf/stats/Strange/Australium%20Force-a-Nature/Tradable/Craftable");

  // Posts.tf's own item picker uses the weapon's PLAIN defindex plus a
  // separate "australium" boolean, not a distinct Australium schema entry
  // - confirmed live by decoding a real posts.tf search URL for this
  // exact item.
  const postsTfLink = allLinks.find((a) => a.textContent === "posts.tf");
  assert.ok(postsTfLink, "expected posts.tf to resolve via the plain weapon's own defindex");
  const b64 = new URL(postsTfLink.href).searchParams.get("q");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const query = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  assert.deepEqual(query.u[0], { defindex: 45, quality: 11, craftable: true, australium: true });

  // The clickable copy-to-name text stays the RAW displayed text (not the
  // schema-corrected variant) - copies exactly what the page shows.
  assert.equal(h1.title, "Click to copy item name");
});

test("leaves a non-Australium item's name completely untouched (no schema lookup attempted at all)", async () => {
  const { body } = buildStnPage({ title: "Strange Rocket Launcher" });
  installDocument(body);
  installBaseGlobals({
    sendMessage: async (msg) => ({ ok: false, error: "should not need any fetch: " + msg?.url }),
  });

  await link2Backpack();

  const wrapper = body.querySelectorAll(".px-3")[0];
  const gladiatorLink = wrapper.querySelectorAll("a").find((a) => a.textContent === "gladiator.tf");
  assert.equal(gladiatorLink.href, "https://gladiator.tf/sales?item=Strange+Rocket+Launcher");
});

// "Force-a-Nature" is in the hardcoded KNOWN_ITEM_NAME_CASINGS table, so it
// gets corrected even with zero schema data - see the test below this one
// for that. This one uses a DIFFERENT Australium weapon (not in that table)
// to exercise the schema-based correctAustraliumCasing fallback specifically,
// confirming it degrades gracefully (raw name unchanged, no crash) rather
// than the hardcoded table masking a real gap in schema-based coverage.
test("falls back to the raw (uncorrected) Australium name when no schema data is available and the name isn't in the hardcoded table either", async () => {
  const { body } = buildStnPage({ title: "Strange Australium Rocket Launcher" });
  installDocument(body);
  installBaseGlobals(); // no tf2SchemaCache, no steamApiKey - getCanonicalItemName can't resolve anything

  await link2Backpack();

  const wrapper = body.querySelectorAll(".px-3")[0];
  const gladiatorLink = wrapper.querySelectorAll("a").find((a) => a.textContent === "gladiator.tf");
  assert.equal(gladiatorLink.href, "https://gladiator.tf/sales?item=Strange+Australium+Rocket+Launcher");
});

// The schema has no separate "Australium X" entries (see the fixture note
// above), so the schema-based fallback must canonicalize the bare weapon
// name. "Black Box" is not in KNOWN_ITEM_NAME_CASINGS, so only the schema
// path can fix this casing.
test("corrects a mis-cased Australium weapon via the schema's BARE weapon entry when it isn't in the hardcoded table", async () => {
  const { body } = buildStnPage({ title: "Strange Australium Black box" });
  installDocument(body);
  installBaseGlobals({
    storage: {
      tf2SchemaCache: {
        itemNameToDefindex: { "Black Box": 228 },
        defindexToItemName: {},
        effectNameToId: {},
        fetchedAt: Date.now(),
        schemaShapeVersion: 4,
      },
    },
  });

  await link2Backpack();

  const wrapper = body.querySelectorAll(".px-3")[0];
  const allLinks = wrapper.querySelectorAll("a");
  const gladiatorLink = allLinks.find((a) => a.textContent === "gladiator.tf");
  assert.equal(gladiatorLink.href, "https://gladiator.tf/sales?item=Strange+Australium+Black+Box");
  const nextStats = allLinks.find((a) => a.textContent === "next.bp.tf stats");
  assert.equal(new URL(nextStats.href).searchParams.get("item"), "Black Box");
});

// This is the actual live bug report - without the hardcoded
// KNOWN_ITEM_NAME_CASINGS table, a user with no Steam Web API key configured
// (or a cold/stale schema cache) got NO correction at all, since
// correctAustraliumCasing alone is entirely schema-gated.
test("corrects a known mis-cased weapon name even with ZERO schema data available - doesn't require a Steam Web API key at all", async () => {
  const { body } = buildStnPage({ title: "Strange Australium Force-A-Nature" });
  installDocument(body);
  installBaseGlobals(); // no tf2SchemaCache, no steamApiKey at all

  await link2Backpack();

  const wrapper = body.querySelectorAll(".px-3")[0];
  const allLinks = wrapper.querySelectorAll("a");

  const gladiatorLink = allLinks.find((a) => a.textContent === "gladiator.tf");
  assert.equal(gladiatorLink.href, "https://gladiator.tf/sales?item=Strange+Australium+Force-a-Nature");

  const nextStats = allLinks.find((a) => a.textContent === "next.bp.tf stats");
  assert.equal(new URL(nextStats.href).searchParams.get("item"), "Force-a-Nature");

  const bpStats = allLinks.find((a) => a.textContent === "bp.tf stats");
  assert.equal(bpStats.href, "https://backpack.tf/stats/Strange/Australium%20Force-a-Nature/Tradable/Craftable");
});

test("inserts the link wrapper into the Sell it for: column when present", async () => {
  const { body, sellCol } = buildStnPage({ title: "Rocket Launcher" });
  installDocument(body);
  installBaseGlobals();

  await link2Backpack();

  const wrapper = sellCol.children.find((c) => c.classList.contains("px-3"));
  assert.ok(wrapper, "expected the wrapper to have been appended into the Sell column");
});

// insertLinks() used to have a "priceRow found but no Sell column" fallback
// branch here (priceRow.parentElement.insertBefore(...)) - removed from the
// source, since findPriceRow and findSellColumn both locate the SAME
// "Sell it for:" <p> (just read a different ancestor off it:
// .closest(".row.g-0") vs .parentElement), so any markup where the label
// exists at all always makes findSellColumn resolve too - that branch was
// unreachable through legitimate markup, not just untested.

test("falls back to appending next to the Wishlist button when there's no price row at all", async () => {
  const body = new FakeElement("body");
  const h1 = new FakeElement("h1");
  h1.textContent = "Rocket Launcher";
  body.appendChild(h1);
  const wishlistWrap = new FakeElement("div");
  const wishlistBtn = new FakeElement("button");
  wishlistBtn.setAttribute("id", "wishlist_add");
  wishlistWrap.appendChild(wishlistBtn);
  body.appendChild(wishlistWrap);

  installDocument(body);
  global.document.getElementById = (id) => (id === "wishlist_add" ? wishlistBtn : null);
  installBaseGlobals();

  await link2Backpack();

  const wrapper = wishlistWrap.children.find((c) => c.classList.contains("px-3"));
  assert.ok(wrapper, "expected the wrapper to land next to the Wishlist button");
});

test("when neither a price row nor the Wishlist button exist yet, the wrapper is inserted once the observer finds the Wishlist button later", async () => {
  const body = new FakeElement("body");
  const h1 = new FakeElement("h1");
  h1.textContent = "Rocket Launcher";
  body.appendChild(h1);

  installDocument(body);
  global.document.getElementById = () => null; // Wishlist button doesn't exist yet
  installBaseGlobals();

  await link2Backpack();

  const observer = global.MutationObserver.instances[0];
  assert.ok(observer, "expected the wishlist-watching MutationObserver to have been created");
  assert.equal(observer.target, body);

  // The Wishlist button shows up later (Steam-style AJAX-rendered markup) -
  // the observer's own callback re-checks for it on every DOM mutation.
  const wishlistWrap = new FakeElement("div");
  const wishlistBtn = new FakeElement("button");
  wishlistBtn.setAttribute("id", "wishlist_add");
  wishlistWrap.appendChild(wishlistBtn);
  body.appendChild(wishlistWrap);
  global.document.getElementById = (id) => (id === "wishlist_add" ? wishlistBtn : null);

  observer.cb();

  assert.equal(observer.disconnected, true);
  const wrapper = wishlistWrap.children.find((c) => c.classList.contains("px-3"));
  assert.ok(wrapper, "expected the wrapper to land next to the Wishlist button once found");
});

test("gives up after 15s and falls back to right after the title when the Wishlist button never appears", async () => {
  const body = new FakeElement("body");
  const h1 = new FakeElement("h1");
  h1.textContent = "Rocket Launcher";
  body.appendChild(h1);

  installDocument(body);
  global.document.getElementById = () => null; // Wishlist button never appears
  installBaseGlobals();

  const realSetTimeout = global.setTimeout;
  const timeoutCalls = [];
  global.setTimeout = (fn, delay) => {
    timeoutCalls.push({ fn, delay });
    return timeoutCalls.length;
  };
  try {
    await link2Backpack();

    const giveUpCall = timeoutCalls.find((c) => c.delay === 15000);
    assert.ok(giveUpCall, "expected a 15s give-up timeout to have been scheduled");
    giveUpCall.fn();

    const observer = global.MutationObserver.instances[0];
    assert.equal(observer.disconnected, true);
    const wrapper = h1.nextSibling;
    assert.ok(wrapper && wrapper.classList.contains("px-3"), "expected the wrapper right after the title");
  } finally {
    global.setTimeout = realSetTimeout;
  }
});

// --- Live reactivity (no reload needed once a key is saved) ---------------

// Regression: saving a Steam Web API key via the popup while this page was already open left it stuck showing the "needs a
// key" state until the user manually reloaded - this page never listened for
// chrome.storage.onChanged at all. Now it does (see link2Backpack's own
// currentReactivityListener note) - removes the old wrapper and reruns
// itself fresh on either key changing.
test("re-resolves on its own once a Steam Web API key is saved - no page reload needed", async () => {
  const { body } = buildStnPage({ title: "Unusual Otherworldly Weather Mean Captain" });
  installDocument(body);
  const { storage, fireStorageChange } = installBaseGlobals();
  // No tf2SchemaCache at all yet - matches "no key configured" until the
  // change fires below.

  await link2Backpack();

  assert.ok(findKeyHint(body.querySelectorAll(".px-3")[0], "posts.tf"), "expected posts.tf's key hint before the key is saved");

  // Simulate the popup's own Save: chrome.storage.local now has a real
  // (non-empty) schema cache, AND storage.onChanged fires - exactly what a
  // successful key save (which re-fetches/caches the schema) looks like.
  // itemNameToDefindex has to be populated too, not just effectNameToId -
  // posts.tf's own postsTfUnresolved check (see link2Backpack's own note)
  // keeps the warning up until THAT resolves as well, same as it now does
  // live for any item missing just a defindex.
  storage.tf2SchemaCache = {
    itemNameToDefindex: { "Mean Captain": 12345 },
    defindexToItemName: {},
    effectNameToId: { "Otherworldly Weather": 126 },
    fetchedAt: Date.now(),
    schemaShapeVersion: 4,
  };
  fireStorageChange({ steamApiKey: "abc123" });
  await flushMicrotasks();

  // Exactly one wrapper should exist afterward, not two - proof the old one
  // was actually removed rather than a second one stacking alongside it.
  assert.equal(body.querySelectorAll(".px-3").length, 1);

  storage.steamApiKey = "abc123";
  const after = body.querySelectorAll(".px-3")[0].querySelectorAll("a");
  assert.equal(findKeyHint(body.querySelectorAll(".px-3")[0], "posts.tf"), undefined, "key hint should be gone");
  assert.ok(after.find((a) => a.textContent === "bp.tf stats"), "expected bp.tf stats now that the effect id resolved");
});

test("a key-save re-run does not stack a second click-to-copy listener on the title", async () => {
  const { body, h1 } = buildStnPage({ title: "Rocket Launcher" });
  installDocument(body);
  const { storage, fireStorageChange } = installBaseGlobals();
  const written = [];
  installFakeClipboard(async (text) => written.push(text));

  await link2Backpack();
  storage.steamApiKey = "abc123";
  fireStorageChange({ steamApiKey: "abc123" });
  await flushMicrotasks();

  await h1.dispatchEvent({ type: "click" });
  assert.deepEqual(written, ["Rocket Launcher"]);
});

test("a change to an unrelated storage key doesn't trigger a re-resolve", async () => {
  const { body } = buildStnPage({ title: "Rocket Launcher" });
  installDocument(body);
  const { fireStorageChange } = installBaseGlobals();

  await link2Backpack();
  const wrapperBefore = body.querySelectorAll(".px-3")[0];

  fireStorageChange({ someUnrelatedSetting: true });
  await flushMicrotasks();

  // Same element instance - proof nothing was torn down and rebuilt.
  assert.equal(body.querySelectorAll(".px-3")[0], wrapperBefore);
});

// Drains the same handful of microtask ticks flush() elsewhere in this file
// already uses for the pricedb.io splice - the reactivity listener's own
// call to link2Backpack() is fire-and-forget (not awaited by fireStorageChange
// itself, matching how a real chrome.storage.onChanged listener can't be
// awaited by whoever triggered the change either), so tests need a moment
// for that inner async run to actually finish before asserting on its result.
// The compact key-hint buttons (utils/linkButtonStates.js) that replaced the
// old "Get a Steam Web API key" warning box.
function findKeyHint(root, label) {
  return root.querySelectorAll("span").find((s) => s.dataset.tf2teNeedsKey === "1" && s.textContent === label);
}

function flushMicrotasks(ticks = 10) {
  return (async () => {
    for (let i = 0; i < ticks; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  })();
}

// The rest of the buttons no longer wait for pricedb.io's lookup: its slot
// shows a loading state (label + spinner, aria-busy) until it answers.
test("shows the buttons right away with a loading pricedb.io slot, then swaps in the link when the lookup answers", async () => {
  __resetPricedbCacheForTests();
  const { body } = buildStnPage({ title: "Rocket Launcher" });
  installDocument(body);
  let answer;
  installBaseGlobals({
    sendMessage: (msg) => {
      if (!msg.url.includes("pricedb.io/api/search")) return Promise.resolve({ ok: false, error: "unexpected url: " + msg.url });
      return new Promise((resolve) => {
        answer = () => resolve({ ok: true, data: { success: true, data: { results: [{ name: "Rocket Launcher", sku: "205;6" }] } } });
      });
    },
  });

  await link2Backpack();
  const wrapper = body.querySelectorAll(".px-3")[0];
  assert.ok(wrapper.querySelectorAll("a").find((a) => a.textContent === "gladiator.tf"), "buttons must not wait for pricedb.io");
  const loading = wrapper.querySelectorAll("span").find((s) => s.textContent === "pricedb.io" && s.getAttribute("aria-busy") === "true");
  assert.ok(loading, "expected the loading pricedb.io slot");

  answer();
  await flushMicrotasks();
  const link = wrapper.querySelectorAll("a").find((a) => a.textContent === "pricedb.io");
  assert.equal(link?.href, "https://pricedb.io/item/205%3B6");
});
