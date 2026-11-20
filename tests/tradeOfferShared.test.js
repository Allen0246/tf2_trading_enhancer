import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { PARTICLE_HOST_URL } from "../utils/particleImages.js";

// steamcommunity.com/tradeOffer/shared.js (and the rest of that folder) is a
// completely different architecture from every other file in this repo:
// it's a classic script that runs as a raw, non-ESM IIFE in a MV3
// "world": "MAIN" content script (sharing the real page's global scope, see
// manifest.json), building window.__tf2te__ as a side effect - there's no
// import/export at all, so it can't be loaded via a plain ESM `import()`
// the way every other content.js in this repo is tested. Instead, its source
// text is run inside a fresh node:vm sandbox context per test (a plain object
// standing in for the page's real global scope - window/document/localStorage/
// setTimeout/etc, all faked to just the surface this file actually touches),
// then window.__tf2te__.DEPS off that same sandbox is used to drive it -
// same "fake the environment, then call/inspect the real code" principle as
// every other test in this repo, just via vm.runInContext instead of import()
// since the source itself has no module boundary to import().
const sharedSrc = readFileSync(new URL("../steamcommunity.com/tradeOffer/shared.js", import.meta.url), "utf8");

// vm.createContext gives shared.js's code its own realm, with its own
// Object/Array/etc prototypes distinct from this test file's own - so a
// plain object/array RETURNED from sandboxed code fails assert.deepEqual's
// (deepStrictEqual's) prototype-identity check against an outer-realm
// literal even with identical own properties. JSON round-tripping strips
// that cross-realm identity, which is fine here since every value compared
// this way is plain JSON-shaped data (no functions/Dates/etc involved).
function toPlain(value) {
  return JSON.parse(JSON.stringify(value));
}

// Minimal fake DOM element - same shape/purpose as tests/sellDuplicates.test.js's
// own FakeElement, trimmed to what shared.js itself actually touches
// (classList.add/contains, style, setAttribute/getAttribute/hasAttribute,
// appendChild, and - only for Utils.copyToClipboard's <textarea> - value/select()).
class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.style = {};
    this.children = [];
    this._attrs = {};
    this.value = "";
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
  removeChild(child) {
    this.children = this.children.filter((c) => c !== child);
    return child;
  }
  select() {}
}

class FakeCDelayedAJAXData {
  constructor(uri, delay) {
    this.uri = uri;
    this.delay = delay;
  }
  RunWhenAJAXReady(cb) {
    this.m_$Data = [null, null, { innerHTML: FakeCDelayedAJAXData.nextHtml }];
    cb();
  }
}

// Builds a fresh sandbox (fresh window.__tf2te__/DEPS, fresh localStorage,
// fresh document) and runs shared.js's real source in it - one per test, so
// module-scope state (the localStorage-backed attribute cache, the
// window.ActOnTradeOffer wrapper) never leaks between tests, without needing
// shared.js's own source to expose any test-only reset hook (it can't -
// there's no module boundary to export one from).
// extensionUrl: what extensionUrlBridge.js writes onto <html> (null = not set).
function loadShared({
  effectsMap = { "Burning Flames": 13 },
  initialActOnTradeOffer,
  bundledParticleIds = [13],
  extensionUrl = "moz-extension://test/",
} = {}) {
  const localStorageStore = {};
  const localStorage = {
    getItem: (k) => (k in localStorageStore ? localStorageStore[k] : null),
    setItem: (k, v) => {
      localStorageStore[k] = String(v);
    },
    removeItem: (k) => {
      delete localStorageStore[k];
    },
    key: (i) => Object.keys(localStorageStore)[i],
    get length() {
      return Object.keys(localStorageStore).length;
    },
  };

  const documentListeners = {};
  const fakeDocument = {
    documentElement: { dataset: extensionUrl ? { tf2teExtensionUrl: extensionUrl } : {} },
    createElement: (tag) => new FakeElement(tag),
    dispatchEvent: (evt) => {
      (documentListeners[evt.type] || []).forEach((cb) => cb(evt));
      return true;
    },
    addEventListener: (type, cb) => {
      (documentListeners[type] ||= []).push(cb);
    },
    body: { appendChild: () => {}, removeChild: () => {}, execCommand: () => {} },
    execCommand: () => {},
  };

  const windowObj = {
    jQuery: undefined,
    location: { search: "" },
    __tf2teUnusualEffectsMap__: effectsMap,
    __tf2teBundledParticleIds__: bundledParticleIds,
    CDelayedAJAXData: FakeCDelayedAJAXData,
  };
  if (initialActOnTradeOffer !== undefined) windowObj.ActOnTradeOffer = initialActOnTradeOffer;
  windowObj.window = windowObj;

  const sandbox = {
    window: windowObj,
    document: fakeDocument,
    localStorage,
    console,
    // Runs synchronously (ignoring the real delay) - same "advance instantly"
    // approach tests/rateLimiter.test.js uses for its own real setTimeout
    // call, just simpler here since nothing needs the elapsed value itself.
    setTimeout: (fn) => {
      fn();
      return 0;
    },
    clearTimeout: () => {},
    CustomEvent: class CustomEvent {
      constructor(type, init) {
        this.type = type;
        Object.assign(this, init);
      }
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(sharedSrc, sandbox);

  return { sandbox, DEPS: sandbox.window.__tf2te__.DEPS, documentListeners };
}

// --- Utils -------------------------------------------------------------

test("Utils.getURLParams decodes '+' as a space before percent-decoding, keyed by param name", () => {
  const { sandbox, DEPS } = loadShared();
  sandbox.window.location.search = "?for_item_name=Fruit+Shoot&id=123";
  assert.deepEqual(toPlain(DEPS.Utils.getURLParams()), { for_item_name: "Fruit Shoot", id: "123" });
});

test("Utils.getURLParams keeps a malformed percent-escape as raw text instead of throwing", () => {
  const { sandbox, DEPS } = loadShared();
  sandbox.window.location.search = "?partner=123&x=%&for_item_name=Fruit+Shoot%E0%A4";
  assert.deepEqual(toPlain(DEPS.Utils.getURLParams()), {
    partner: "123",
    x: "%",
    for_item_name: "Fruit Shoot%E0%A4",
  });
});

test("Utils.getIDsFromString splits a valid comma-separated id list, and returns null for an invalid one", () => {
  const { DEPS } = loadShared();
  assert.deepEqual(toPlain(DEPS.Utils.getIDsFromString("1,2,3")), ["1", "2", "3"]);
  assert.equal(DEPS.Utils.getIDsFromString("not-a-number"), null);
});

// Every caller matches ids exactly (finders.id's ids.indexOf(item.id), and
// backpackProfile.js's [data-id="..."] selectors), so a space after a comma
// - which the validation pattern itself accepts - must not leak into an id.
test("Utils.getIDsFromString trims whitespace around each id and drops empty entries", () => {
  const { DEPS } = loadShared();
  assert.deepEqual(toPlain(DEPS.Utils.getIDsFromString("1,2, 3")), ["1", "2", "3"]);
  assert.deepEqual(toPlain(DEPS.Utils.getIDsFromString(" 111 , 222,")), ["111", "222"]);
});

test("Utils.execHotKey runs the matching hotkey's method, but not while focused in a text field", () => {
  const { DEPS } = loadShared();
  let called = 0;
  const hotKeys = { 65: () => called++ };

  DEPS.Utils.execHotKey({ target: { nodeName: "DIV", type: "" }, keyCode: 65 }, hotKeys);
  assert.equal(called, 1);

  DEPS.Utils.execHotKey({ target: { nodeName: "TEXTAREA", type: "" }, keyCode: 65 }, hotKeys);
  assert.equal(called, 1); // unchanged - text field guard blocked it

  DEPS.Utils.execHotKey({ target: { nodeName: "INPUT", type: "text" }, keyCode: 65 }, hotKeys);
  assert.equal(called, 1); // unchanged - text input guard blocked it too
});

test("Utils.flatten concatenates nested arrays one level deep", () => {
  const { DEPS } = loadShared();
  assert.deepEqual(toPlain(DEPS.Utils.flatten([[1, 2], [3], 4])), [1, 2, 3, 4]);
});

test("Utils.partition splits an array into [matching, non-matching]", () => {
  const { DEPS } = loadShared();
  assert.deepEqual(toPlain(DEPS.Utils.partition([1, 2, 3, 4], (n) => n % 2 === 0)), [[2, 4], [1, 3]]);
});

test("Utils.groupBy groups array elements by a key", () => {
  const { DEPS } = loadShared();
  const result = DEPS.Utils.groupBy([{ t: "a", v: 1 }, { t: "b", v: 2 }, { t: "a", v: 3 }], "t");
  assert.deepEqual(toPlain(result), { a: [{ t: "a", v: 1 }, { t: "a", v: 3 }], b: [{ t: "b", v: 2 }] });
});

test("Utils.copyToClipboard creates a textarea, selects it, and cleans it up via document.body", () => {
  const { DEPS } = loadShared();
  // No assertion target beyond "doesn't throw" - the fake document.body's
  // appendChild/removeChild/execCommand are all no-ops, so this just proves
  // the sequence of DOM calls shared.js makes is valid against a real
  // (fake) document interface, not a mistyped method name.
  assert.doesNotThrow(() => DEPS.Utils.copyToClipboard("hello"));
});

test("Utils.stringToCurrencies parses a 'N keys, N metal'-style string into a currencies object", () => {
  const { DEPS } = loadShared();
  assert.deepEqual(toPlain(DEPS.Utils.stringToCurrencies("2 keys, 11.66 metal")), { keys: 2, metal: 11.66 });
  assert.deepEqual(toPlain(DEPS.Utils.stringToCurrencies("1 key")), { keys: 1 });
  assert.deepEqual(toPlain(DEPS.Utils.stringToCurrencies("5 ref")), { metal: 5 });
});

test("Utils.stringToCurrencies returns null for an empty/falsy string", () => {
  const { DEPS } = loadShared();
  assert.equal(DEPS.Utils.stringToCurrencies(""), null);
  assert.equal(DEPS.Utils.stringToCurrencies(null), null);
});

test("Utils.stringToCurrencies returns null when no keys/metal currency is recognized", () => {
  const { DEPS } = loadShared();
  assert.equal(DEPS.Utils.stringToCurrencies("5 usd"), null);
});

// A segment the "<amount> <currency>" pattern doesn't match used to throw a
// TypeError (match was null), failing the whole listed-value sum.
test("REGRESSION: Utils.stringToCurrencies returns null (not a throw) for an unparseable segment", () => {
  const { DEPS } = loadShared();
  assert.equal(DEPS.Utils.stringToCurrencies("$12.34"), null);
  assert.equal(DEPS.Utils.stringToCurrencies("1 key, 2.33ref"), null);
});

// --- shared.offers.identifiers.getItemAttributes ----------------------------

function fakeItem(overrides = {}) {
  return {
    name_color: "7D6D00", // Unique (the "isUnique" color)
    market_hash_name: "Rocket Launcher",
    type: null,
    name: "Rocket Launcher",
    descriptions: [],
    ...overrides,
  };
}

test("getItemAttributes detects an Unusual effect from a gold ★ Unusual Effect description, skipping Unique items", () => {
  const { DEPS } = loadShared({ effectsMap: { "Burning Flames": 13 } });
  const item = fakeItem({
    name_color: "8650AC", // not the Unique color, so the effect check isn't skipped
    descriptions: [{ color: "ffd700", value: "★ Unusual Effect: Burning Flames" }],
  });
  const attributes = DEPS.shared.offers.identifiers.getItemAttributes(item);
  assert.equal(attributes.effect, 13);
});

test("getItemAttributes keeps the first Unusual effect description when an item lists more than one", () => {
  const { DEPS } = loadShared({ effectsMap: { "Burning Flames": 13, "Scorching Flames": 14 } });
  const item = fakeItem({
    name_color: "8650AC",
    descriptions: [
      { color: "ffd700", value: "★ Unusual Effect: Burning Flames" },
      { color: "ffd700", value: "★ Unusual Effect: Scorching Flames" },
    ],
  });
  const attributes = DEPS.shared.offers.identifiers.getItemAttributes(item);
  assert.equal(attributes.effect, 13);
});

test("getItemAttributes never sets effect on a Unique-colored item, even with a matching description", () => {
  const { DEPS } = loadShared({ effectsMap: { "Burning Flames": 13 } });
  const item = fakeItem({ descriptions: [{ color: "ffd700", value: "★ Unusual Effect: Burning Flames" }] });
  const attributes = DEPS.shared.offers.identifiers.getItemAttributes(item);
  assert.equal(attributes.effect, undefined);
});

test("getItemAttributes detects strange via the Strange Hat - Stat: N type pattern, but not for Strange-quality (color CF6A32) items", () => {
  const { DEPS } = loadShared();
  const strangeType = fakeItem({
    market_hash_name: "Strange Rocket Launcher",
    type: "Strange Rocket Launcher - Points Scored: 0",
  });
  assert.equal(DEPS.shared.offers.identifiers.getItemAttributes(strangeType).strange, true);

  const strangeQuality = fakeItem({
    name_color: "CF6A32",
    market_hash_name: "Strange Rocket Launcher",
    type: "Strange Rocket Launcher - Points Scored: 0",
  });
  assert.equal(DEPS.shared.offers.identifiers.getItemAttributes(strangeQuality).strange, undefined);
});

test("getItemAttributes detects strange via a Strange Stat Clock Attached description, same CF6A32-quality exclusion", () => {
  const { DEPS } = loadShared();
  const item = fakeItem({
    descriptions: [{ color: "CF6A32", value: "Strange Stat Clock Attached" }],
  });
  assert.equal(DEPS.shared.offers.identifiers.getItemAttributes(item).strange, true);
});

test("getItemAttributes detects spelled/parts/killstreak/uncraft from their own description color+text", () => {
  const { DEPS } = loadShared();
  const item = fakeItem({
    descriptions: [
      { color: "7ea9d1", value: "Halloween Spell: Something (spell only active during event)" },
      { color: "756b5e", value: "(Kills While Übercharged: 5)" },
      { color: "7ea9d1", value: "Killstreaks Active" },
      { color: "", value: "( Not Usable in Crafting )" },
    ],
  });
  const attributes = DEPS.shared.offers.identifiers.getItemAttributes(item);
  assert.equal(attributes.spelled, true);
  assert.equal(attributes.parts, true);
  assert.equal(attributes.killstreak, 1);
  assert.equal(attributes.uncraft, true);
});

test("getItemAttributes reads the Killstreak tier off the English market name, whatever the page language", () => {
  const { DEPS } = loadShared();
  const active = [{ color: "7ea9d1", value: "Killstreaks Active" }];
  const tierOf = (market_hash_name, descriptions = active) =>
    DEPS.shared.offers.identifiers.getItemAttributes(fakeItem({ market_hash_name, descriptions })).killstreak;

  assert.equal(tierOf("Killstreak Rocket Launcher"), 1);
  assert.equal(tierOf("Specialized Killstreak Rocket Launcher"), 2);
  assert.equal(tierOf("Strange Professional Killstreak Rocket Launcher"), 3);
  // No killstreak at all: no tier, even with a tier word in the name.
  assert.equal(tierOf("Professional Killstreak Rocket Launcher", []), undefined);
});

test("getKillstreakTier falls back to the Sheen and Killstreaker lines when the name has no tier", () => {
  const { DEPS } = loadShared();
  const { getKillstreakTier } = DEPS.shared.offers.identifiers;
  const lines = (...values) => values.map((value) => ({ color: "7ea9d1", value }));

  assert.equal(getKillstreakTier({ market_hash_name: "Rocket Launcher", descriptions: lines("Killstreaks Active") }), 1);
  assert.equal(getKillstreakTier({ descriptions: lines("Killstreaks Active", "Sheen: Team Shine") }), 2);
  assert.equal(getKillstreakTier({ descriptions: lines("Killstreaks Active", "Sheen: Team Shine", "Killstreaker: Fire Horns") }), 3);
});

test("the Killstreak marker shows one chevron per tier and carries its tier for the trade summary", () => {
  const { DEPS } = loadShared({});
  for (const tier of [1, 2, 3]) {
    const itemEl = new FakeElement("div");
    DEPS.shared.offers.identifiers.addAttributesToElement(itemEl, { killstreak: tier });
    const ksEl = itemEl.children.find((c) => c.classList.contains("icons")).children[0];
    assert.equal(ksEl.getAttribute("src"), `moz-extension://test/images/icons/killstreak-${tier}.svg`);
    assert.equal(ksEl.getAttribute("data-tier"), String(tier));
  }
});

test("getItemAttributes extracts a lowcraft number from a trailing '#N' in the item's own name", () => {
  const { DEPS } = loadShared();
  const item = fakeItem({ name: "Rocket Launcher #42" });
  assert.equal(DEPS.shared.offers.identifiers.getItemAttributes(item).lowcraft, 42);
});

test("getItemAttributes returns just the base color attribute (no lowcraft) with no descriptions and no matching name", () => {
  const { DEPS } = loadShared();
  const item = fakeItem({ descriptions: undefined });
  assert.deepEqual(toPlain(DEPS.shared.offers.identifiers.getItemAttributes(item)), { color: "7D6D00" });
});

// --- shared.offers.identifiers.addAttributesToElement -----------------------

test("addAttributesToElement is a no-op once the element is already marked data-checked", () => {
  const { DEPS } = loadShared();
  const el = new FakeElement("div");
  el.setAttribute("data-checked", 1);
  DEPS.shared.offers.identifiers.addAttributesToElement(el, { strange: true });
  assert.equal(el.classList.contains("strange"), false); // never ran
});

test("addAttributesToElement sets the effect background image + 'unusual' class, and marks data-checked", () => {
  const { DEPS } = loadShared();
  const el = new FakeElement("div");
  DEPS.shared.offers.identifiers.addAttributesToElement(el, { effect: 13 });
  assert.equal(el.getAttribute("data-effect"), "13");
  assert.equal(el.style.backgroundImage, "url('moz-extension://test/images/particles/94/13.png')");
  assert.equal(el.classList.contains("unusual"), true);
  assert.equal(el.hasAttribute("data-checked"), true);
});

test("addAttributesToElement builds a lowcraft craft-number badge with the item's own color", () => {
  const { DEPS } = loadShared();
  const el = new FakeElement("div");
  DEPS.shared.offers.identifiers.addAttributesToElement(el, { lowcraft: 42, color: "7D6D00" });
  assert.equal(el.children.length, 1);
  assert.equal(el.children[0].textContent, "#42");
  assert.equal(el.children[0].style.color, "#7D6D00");
});

test("addAttributesToElement groups spell/parts/killstreak icons under one 'icons' wrapper, only when at least one is present", () => {
  const { DEPS } = loadShared();
  const withIcons = new FakeElement("div");
  DEPS.shared.offers.identifiers.addAttributesToElement(withIcons, { spelled: true, parts: true, killstreak: true });
  const iconsWrapper = withIcons.children.find((c) => c.classList.contains("icons"));
  assert.ok(iconsWrapper);
  assert.equal(iconsWrapper.children.length, 3);

  const withoutIcons = new FakeElement("div");
  DEPS.shared.offers.identifiers.addAttributesToElement(withoutIcons, { strange: true });
  assert.equal(withoutIcons.children.length, 0); // strange only adds a class, no child element
  assert.equal(withoutIcons.classList.contains("strange"), true);
});

// --- shared.offers.unusual ---------------------------------------------

test("shared.offers.unusual.getEffectValue reads off the effectsMap installed via window.__tf2teUnusualEffectsMap__", () => {
  const { DEPS } = loadShared({ effectsMap: { "Team Spirit": 6 } });
  assert.equal(DEPS.shared.offers.unusual.getEffectValue("Team Spirit"), 6);
});

// The effect name comes from an item's description text. A plain property
// read also finds what every object inherits ("constructor", "toString"), so
// such a name came back as a function and the item was drawn as an Unusual
// with a nonsense effect image address.
test("getEffectValue only finds effects that are in the table, not inherited object properties", () => {
  const { DEPS } = loadShared({ effectsMap: { "Team Spirit": 6 } });
  for (const name of ["constructor", "toString", "hasOwnProperty", "__proto__"]) {
    assert.equal(DEPS.shared.offers.unusual.getEffectValue(name), undefined, name);
  }

  const item = fakeItem({
    name_color: "8650AC",
    descriptions: [{ color: "ffd700", value: "★ Unusual Effect: constructor" }],
  });
  assert.equal(DEPS.shared.offers.identifiers.getItemAttributes(item).effect, undefined);
});

test("getEffectURL uses the image bundled with the extension for a bundled effect id, string or number", () => {
  const { DEPS } = loadShared({ bundledParticleIds: [6] });
  assert.equal(DEPS.shared.offers.unusual.getEffectURL(6), "moz-extension://test/images/particles/94/6.png");
  assert.equal(DEPS.shared.offers.unusual.getEffectURL("6"), "moz-extension://test/images/particles/94/6.png");
});

test("getIconURL points at the marker icons bundled with the extension", () => {
  const { DEPS } = loadShared({});
  assert.equal(DEPS.shared.offers.identifiers.getIconURL("spell.svg"), "moz-extension://test/images/icons/spell.svg");
});

test("getEffectURL uses our own host for an effect newer than the bundled set", () => {
  const { DEPS } = loadShared({ bundledParticleIds: [6] });
  assert.equal(DEPS.shared.offers.unusual.getEffectURL(3243), `${PARTICLE_HOST_URL}/94/3243.png`);
});

test("getEffectURL uses our own host when the extension's URL isn't known (bridge didn't run)", () => {
  const { DEPS } = loadShared({ bundledParticleIds: [6], extensionUrl: null });
  assert.equal(DEPS.shared.offers.unusual.getEffectURL(6), `${PARTICLE_HOST_URL}/94/6.png`);
});

// --- addAttributesToHoverItems -----------------------------------------

test("addAttributesToHoverItems is a no-op for an empty list", () => {
  const { DEPS } = loadShared();
  assert.doesNotThrow(() => DEPS.addAttributesToHoverItems([]));
});

test("addAttributesToHoverItems skips an item with no data-economy-item attribute at all", () => {
  const { DEPS } = loadShared();
  const el = new FakeElement("div"); // no data-economy-item set
  assert.doesNotThrow(() => DEPS.addAttributesToHoverItems([el]));
  assert.equal(el.hasAttribute("data-checked"), false);
});

test("addAttributesToHoverItems skips a non-TF2 item (appid != 440)", () => {
  const { DEPS } = loadShared();
  const el = new FakeElement("div");
  el.setAttribute("data-economy-item", "classinfo/730/111/222"); // CS2, not TF2
  DEPS.addAttributesToHoverItems([el]);
  assert.equal(el.hasAttribute("data-checked"), false);
});

test("addAttributesToHoverItems fetches, parses, and applies attributes for a real TF2 item, then caches the result", () => {
  const { DEPS, sandbox } = loadShared();
  const el = new FakeElement("div");
  el.setAttribute("data-economy-item", "classinfo/440/111/222");
  FakeCDelayedAJAXData.nextHtml =
    'BuildHover( \'economy_item_x\', {"name_color":"7D6D00","market_hash_name":"Rocket Launcher","descriptions":[]} );';

  DEPS.addAttributesToHoverItems([el]);

  assert.equal(el.hasAttribute("data-checked"), true);
  // The attribute cache is persisted to localStorage under a version-prefixed
  // key (see shared.js's own CACHE_INDEX/setStored) - confirms the whole
  // fetch -> parse -> cache round trip actually ran, not just the DOM side.
  assert.equal(sandbox.window.__tf2te__.DEPS.getStored(DEPS.ATTRIBUTE_CACHE_VERSION + ".getTradeOffers.cache") !== null, true);
});

test("addAttributesToHoverItems reuses a cached attribute value (by classid:instanceid) without re-fetching", () => {
  const { DEPS } = loadShared();
  const el = new FakeElement("div");
  el.setAttribute("data-economy-item", "classinfo/440/111/222");
  let fetchAttempted = false;
  FakeCDelayedAJAXData.nextHtml = "";
  const originalRunWhenAJAXReady = FakeCDelayedAJAXData.prototype.RunWhenAJAXReady;
  FakeCDelayedAJAXData.prototype.RunWhenAJAXReady = function (cb) {
    fetchAttempted = true;
    originalRunWhenAJAXReady.call(this, cb);
  };

  try {
    // Pre-seed the version-prefixed cache exactly as setStored/CACHE_INDEX would.
    DEPS.setStored(DEPS.ATTRIBUTE_CACHE_VERSION + ".getTradeOffers.cache", JSON.stringify({ "111:222": { strange: true } }));

    DEPS.addAttributesToHoverItems([el]);

    assert.equal(fetchAttempted, false);
    assert.equal(el.classList.contains("strange"), true);
  } finally {
    FakeCDelayedAJAXData.prototype.RunWhenAJAXReady = originalRunWhenAJAXReady;
  }
});

// --- setStored / getStored ------------------------------------------------

test("setStored/getStored round-trip through localStorage under a 'tf2te.' prefixed key", () => {
  const { DEPS, sandbox } = loadShared();
  DEPS.setStored("myKey", "myValue");
  assert.equal(sandbox.localStorage.getItem("tf2te.myKey"), "myValue");
  assert.equal(DEPS.getStored("myKey"), "myValue");
});

test("getStored returns null for a missing key", () => {
  const { DEPS } = loadShared();
  assert.equal(DEPS.getStored("neverSet"), null);
});

// --- window.__tf2te__ scaffolding ---------------------------------------

test("window.__tf2te__ starts with an empty scripts array and a non-empty shared itemOverlay stylesheet", () => {
  const { sandbox } = loadShared();
  assert.deepEqual(toPlain(sandbox.window.__tf2te__.scripts), []);
  assert.match(sandbox.window.__tf2te__.sharedStyles.itemOverlay, /\.unusual/);
});

// --- installActOnTradeOfferWrap -----------------------------------------

test("wraps an existing window.ActOnTradeOffer so calling it also dispatches tf2te-tradeoffer-acted-on", () => {
  let originalCalls = 0;
  const original = (...args) => {
    originalCalls++;
    return args;
  };
  const { sandbox, documentListeners } = loadShared({ initialActOnTradeOffer: original });

  let dispatched = 0;
  documentListeners["tf2te-tradeoffer-acted-on"] = [() => dispatched++];

  const result = sandbox.window.ActOnTradeOffer("declined", 123);

  assert.equal(originalCalls, 1);
  assert.deepEqual(result, ["declined", 123]);
  assert.equal(dispatched, 1);
});

test("wraps window.ActOnTradeOffer even when Steam assigns it AFTER shared.js has already loaded", () => {
  const { sandbox, documentListeners } = loadShared(); // no ActOnTradeOffer set yet at load time
  documentListeners["tf2te-tradeoffer-acted-on"] = [];
  let dispatched = 0;
  documentListeners["tf2te-tradeoffer-acted-on"].push(() => dispatched++);

  let calledWith = null;
  sandbox.window.ActOnTradeOffer = (id) => {
    calledWith = id;
  };

  sandbox.window.ActOnTradeOffer("999");

  assert.equal(calledWith, "999");
  assert.equal(dispatched, 1);
});

test("doesn't throw (and just warns) when window.ActOnTradeOffer already exists as a non-configurable property", () => {
  // Seen as an uncaught TypeError ("can't redefine non-configurable
  // property") that aborted the rest of this file's own top-level IIFE -
  // reproduced here by pre-defining the property as non-configurable before
  // shared.js's own installActOnTradeOfferWrap IIFE runs, same as Steam's
  // page (or a stale copy of this exact wrap left behind by re-injecting
  // into an already-open tab) defining it that way ahead of us.
  const localStorageStore = {};
  const localStorage = {
    getItem: (k) => (k in localStorageStore ? localStorageStore[k] : null),
    setItem: (k, v) => {
      localStorageStore[k] = String(v);
    },
    removeItem: (k) => delete localStorageStore[k],
    key: (i) => Object.keys(localStorageStore)[i],
    get length() {
      return Object.keys(localStorageStore).length;
    },
  };
  const warnings = [];
  const fakeDocument = {
    createElement: (tag) => new FakeElement(tag),
    dispatchEvent: () => true,
    addEventListener: () => {},
  };
  const windowObj = {
    jQuery: undefined,
    __tf2teUnusualEffectsMap__: {},
    CDelayedAJAXData: FakeCDelayedAJAXData,
  };
  Object.defineProperty(windowObj, "ActOnTradeOffer", {
    configurable: false,
    value: () => {},
  });
  windowObj.window = windowObj;

  const sandbox = {
    window: windowObj,
    document: fakeDocument,
    localStorage,
    console: { ...console, warn: (...args) => warnings.push(args.join(" ")) },
    setTimeout: (fn) => {
      fn();
      return 0;
    },
    clearTimeout: () => {},
    CustomEvent: class CustomEvent {
      constructor(type, init) {
        this.type = type;
        Object.assign(this, init);
      }
    },
  };
  vm.createContext(sandbox);

  assert.doesNotThrow(() => vm.runInContext(sharedSrc, sandbox));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /could not wrap ActOnTradeOffer/);
  // Everything else shared.js sets up earlier in the same file still ran.
  assert.ok(sandbox.window.__tf2te__);
});

// --- shared.english (non-English Steam pages) ---

test("shared.english.isEnglishPage reads <html lang>", () => {
  const { DEPS, sandbox } = loadShared();
  assert.equal(DEPS.shared.english.isEnglishPage(), true); // no lang
  sandbox.document.documentElement.lang = "hu";
  assert.equal(DEPS.shared.english.isEnglishPage(), false);
  sandbox.document.documentElement.lang = "en-US";
  assert.equal(DEPS.shared.english.isEnglishPage(), true);
});

test("shared.english.getInventoryDescriptions follows Steam's paging and maps every asset to its English description", async () => {
  const { DEPS, sandbox } = loadShared();
  const urls = [];
  const pages = [
    { assets: [{ assetid: "1", classid: "10", instanceid: "0" }], descriptions: [{ classid: "10", instanceid: "0", name: "Key" }], more_items: 1, last_assetid: "1" },
    { assets: [{ assetid: "2", classid: "20", instanceid: "5" }], descriptions: [{ classid: "20", instanceid: "5", name: "Hat" }] },
  ];
  sandbox.fetch = async (url) => {
    urls.push(url);
    const page = pages.shift();
    return { ok: true, json: async () => page };
  };

  const byAsset = await DEPS.shared.english.getInventoryDescriptions("765", 440, 2);

  assert.deepEqual(urls, [
    "https://steamcommunity.com/inventory/765/440/2?l=english&count=2000",
    "https://steamcommunity.com/inventory/765/440/2?l=english&count=2000&start_assetid=1",
  ]);
  assert.equal(byAsset.get("1").name, "Key");
  assert.equal(byAsset.get("2").name, "Hat");
});

test("shared.english.getInventoryDescriptions gives null when Steam doesn't answer, and retries next time", async () => {
  const { DEPS, sandbox } = loadShared();
  let calls = 0;
  sandbox.fetch = async () => {
    calls++;
    return calls === 1 ? { ok: false } : { ok: true, json: async () => ({ assets: [], descriptions: [] }) };
  };

  assert.equal(await DEPS.shared.english.getInventoryDescriptions("765", 440, 2), null);
  assert.equal((await DEPS.shared.english.getInventoryDescriptions("765", 440, 2)).size, 0);
  assert.equal(calls, 2);
});
