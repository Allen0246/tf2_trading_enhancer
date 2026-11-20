import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

// profileShowcase.js is a pages/*.js file - testing its real `fn` requires
// running BOTH shared.js's real source AND this page's real source in the
// SAME sandbox context, shared.js first (it builds window.__tf2te__.DEPS/
// scripts, which the page file then reads and pushes its own registration
// into) - see tests/tradeOfferShared.test.js's own doc
// comment for the full rationale behind this node:vm-based approach.
const sharedSrc = readFileSync(new URL("../steamcommunity.com/tradeOffer/shared.js", import.meta.url), "utf8");
const pageSrc = readFileSync(new URL("../steamcommunity.com/tradeOffer/pages/profileShowcase.js", import.meta.url), "utf8");

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.style = {};
    this.children = [];
    this._attrs = {};
    this.classList = {
      _set: new Set(),
      add: (...names) => names.forEach((n) => this.classList._set.add(n)),
      contains: (n) => this.classList._set.has(n),
    };
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
  appendChild(child) {
    this.children.push(child);
    return child;
  }
}

// Loads shared.js then profileShowcase.js into one fresh sandbox, and
// returns the page script's own registered entry off window.__tf2te__.scripts
// (there's exactly one, pushed by this page's own IIFE).
function loadProfileShowcasePage({ showcaseItems = [] } = {}) {
  const localStorageStore = {};
  const localStorage = {
    getItem: (k) => (k in localStorageStore ? localStorageStore[k] : null),
    setItem: (k, v) => { localStorageStore[k] = String(v); },
    removeItem: (k) => { delete localStorageStore[k]; },
    key: (i) => Object.keys(localStorageStore)[i],
    get length() { return Object.keys(localStorageStore).length; },
  };
  const fakeDocument = {
    createElement: (tag) => new FakeElement(tag),
    getElementsByClassName: (name) => (name === "item_showcase_item" ? showcaseItems : []),
    body: { appendChild: () => {}, removeChild: () => {}, execCommand: () => {} },
    execCommand: () => {},
    addEventListener: () => {},
    dispatchEvent: () => true,
  };
  const windowObj = {
    jQuery: undefined,
    location: { search: "" },
    __tf2teUnusualEffectsMap__: { "Burning Flames": 13 },
    CDelayedAJAXData: class { RunWhenAJAXReady() {} },
  };
  windowObj.window = windowObj;

  const sandbox = {
    window: windowObj,
    document: fakeDocument,
    localStorage,
    console,
    setTimeout: (fn) => { fn(); return 0; },
    clearTimeout: () => {},
    CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; Object.assign(this, init); } },
  };
  vm.createContext(sandbox);
  vm.runInContext(sharedSrc, sandbox);
  vm.runInContext(pageSrc, sandbox);

  const entry = sandbox.window.__tf2te__.scripts.find((s) => s.styles && s.styles.includes("item_showcase_item"));
  return { sandbox, entry, DEPS: sandbox.window.__tf2te__.DEPS };
}

test("registers exactly one script matching steamcommunity.com/id/ and /profiles/ URLs", () => {
  const { entry } = loadProfileShowcasePage();
  assert.ok(entry);
  assert.equal(entry.includes.length, 1);
  assert.match("https://steamcommunity.com/id/someuser/", entry.includes[0]);
  assert.match("https://steamcommunity.com/profiles/76561198000000000", entry.includes[0]);
  assert.equal(entry.includes[0].test("https://steamcommunity.com/id/someuser/inventory"), false);
});

test("styles include both the shared itemOverlay block and this page's own strange:before pointer-events override", () => {
  const { entry } = loadProfileShowcasePage();
  assert.match(entry.styles, /\.unusual \{/); // from shared itemOverlay
  assert.match(entry.styles, /\.strange:before \{\s*pointer-events: none;/);
});

test("fn() passes the item_showcase_item elements straight through to addAttributesToHoverItems", () => {
  const el = new FakeElement("div");
  el.setAttribute("data-economy-item", "classinfo/440/111/222");
  const { entry, DEPS, sandbox } = loadProfileShowcasePage({ showcaseItems: [el] });

  sandbox.window.CDelayedAJAXData.prototype.RunWhenAJAXReady = function (cb) {
    this.m_$Data = [null, null, { innerHTML: 'BuildHover( \'economy_item_x\', {"name_color":"7D6D00","market_hash_name":"Rocket Launcher","descriptions":[]} );' }];
    cb();
  };

  entry.fn(DEPS);

  // real end-to-end proof the element reached shared.js's own attribute
  // pipeline (fetch -> parse -> mark data-checked), not just "didn't throw".
  assert.equal(el.hasAttribute("data-checked"), true);
});

test("fn() is a no-op (doesn't throw) when there are no showcase items on the page", () => {
  const { entry, DEPS } = loadProfileShowcasePage({ showcaseItems: [] });
  assert.doesNotThrow(() => entry.fn(DEPS));
});
