import { test } from "node:test";
import assert from "node:assert/strict";
import { TRADE_LINK_CLICKS_STORAGE_KEY, tradeLinkFingerprint } from "../utils/tradeLinkTrust.js";
import { fixTradeOfferLinks } from "../backpack.tf/oldUI/fixTradeOfferLinks/content.js";

// Minimal hand-rolled fake DOM (see tests/fixTradeOfferLinks.test.js's own
// header comment, and tests/sellDuplicates.test.js's, for why this repo
// hand-rolls this instead of pulling in jsdom) - just enough surface for this
// file's own 3 selector shapes: ".listing" (closest), ".listing-title h5"
// (querySelector, a 2-token descendant selector) and 'a[href*="..."]'
// (querySelectorAll/matches, a tag+attribute-contains selector).

function parseToken(token) {
  const attrMatch = /\[([\w-]+)\*="([^"]*)"\]/.exec(token);
  const rest = token.replace(/\[[^\]]*\]/g, "");
  const classes = [...rest.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
  const tagMatch = /^[a-zA-Z][\w-]*/.exec(rest);
  return {
    tag: tagMatch ? tagMatch[0].toLowerCase() : null,
    classes,
    attrContains: attrMatch ? { name: attrMatch[1], value: attrMatch[2] } : null,
  };
}

function matchesToken(el, token) {
  if (!el || el.nodeType !== 1) return false;
  const parsed = parseToken(token);
  if (parsed.tag && el.tagName.toLowerCase() !== parsed.tag) return false;
  if (!parsed.classes.every((c) => el.classList.contains(c))) return false;
  if (parsed.attrContains) {
    const v = el.getAttribute(parsed.attrContains.name) || "";
    if (!v.includes(parsed.attrContains.value)) return false;
  }
  return true;
}

function collectDescendants(root) {
  const out = [];
  const walk = (el) => {
    for (const child of el.children) {
      out.push(child);
      walk(child);
    }
  };
  walk(root);
  return out;
}

// Supports a single compound token, or a 2-token descendant selector - the
// only shapes this feature's own source actually uses.
function queryAll(root, selector) {
  const tokens = selector.trim().split(/\s+/);
  const descendants = collectDescendants(root);

  if (tokens.length === 1) {
    return descendants.filter((el) => matchesToken(el, tokens[0]));
  }

  const [ancestorSel, targetSel] = tokens;
  return descendants.filter((el) => {
    if (!matchesToken(el, targetSel)) return false;
    let p = el.parentElement;
    while (p) {
      if (matchesToken(p, ancestorSel)) return true;
      p = p.parentElement;
    }
    return false;
  });
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
    const classSet = new Set();
    this.classList = {
      contains: (c) => classSet.has(c),
      add: (...cs) => cs.forEach((c) => classSet.add(c)),
    };
  }
  get textContent() {
    return this._textContent;
  }
  set textContent(v) {
    this._textContent = v;
  }
  // A real anchor's href property (what utils/tradeLinkTrust.js records).
  get href() {
    return this._attrs.href || "";
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
  matches(selector) {
    return matchesToken(this, selector);
  }
  closest(selector) {
    let el = this;
    while (el) {
      if (matchesToken(el, selector)) return el;
      el = el.parentElement;
    }
    return null;
  }
  querySelectorAll(selector) {
    return queryAll(this, selector);
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
}

function fakeTextNode() {
  return { nodeType: 3 };
}

function makeDocument(rootChildren = []) {
  const body = new FakeElement("body");
  for (const c of rootChildren) body.appendChild(c);
  const listeners = {};
  return {
    body,
    listeners,
    querySelectorAll: (selector) => body.querySelectorAll(selector),
    querySelector: (selector) => body.querySelector(selector),
    addEventListener: (type, cb) => {
      (listeners[type] ||= []).push(cb);
    },
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

// Minimal chrome.storage.local fake (the trade-link trust check reads it).
function fakeStorageLocal(initial = {}) {
  const store = { ...initial };
  return {
    async get(keys) {
      const result = {};
      for (const k of keys) if (k in store) result[k] = store[k];
      return result;
    },
    async set(obj) {
      Object.assign(store, obj);
    },
    _store: store,
  };
}

const realSetTimeout = globalThis.setTimeout;
async function flush(ticks = 4) {
  for (let i = 0; i < ticks; i++) {
    await new Promise((resolve) => realSetTimeout(resolve, 0));
  }
}

function installGlobals({ storageData = {} } = {}) {
  global.window = { location: { href: "https://backpack.tf/classifieds?item=Rocket+Launcher" } };
  global.Node = { ELEMENT_NODE: 1 };
  global.MutationObserver = FakeMutationObserver;
  FakeMutationObserver.instances = [];
  global.chrome = {
    storage: { local: fakeStorageLocal(storageData) },
    runtime: { sendMessage: async () => ({ ok: false, error: "no sendMessage fixture installed" }) },
  };
}

/*
Builds a classic backpack.tf-shaped listing row (li.listing), matching the
structure confirmed live off both a real "My Listings" (sell) row and a real
public buy-listing row: the trade-offer anchor sits directly under the row,
the item name lives in .listing-title h5's text, and listing_intent/price
live as data-listing_intent/data-listing_price attributes on a .item element.
*/
function buildListingRow({
  headerText,
  anchorHref = "https://steamcommunity.com/tradeoffer/new/?partner=1&token=abc&for_item=440_2_555",
  listingIntent,
  listingPrice,
} = {}) {
  const row = new FakeElement("li");
  row.classList.add("listing");

  if (headerText !== undefined) {
    const title = new FakeElement("div");
    title.classList.add("listing-title");
    const h5 = new FakeElement("h5");
    h5.textContent = headerText;
    title.appendChild(h5);
    row.appendChild(title);
  }

  if (listingIntent !== undefined || listingPrice !== undefined) {
    const itemEl = new FakeElement("div");
    itemEl.classList.add("item");
    if (listingIntent !== undefined) itemEl.setAttribute("data-listing_intent", listingIntent);
    if (listingPrice !== undefined) itemEl.setAttribute("data-listing_price", listingPrice);
    row.appendChild(itemEl);
  }

  const anchor = new FakeElement("a");
  anchor.setAttribute("href", anchorHref);
  row.appendChild(anchor);

  return { row, anchor };
}

test("patches a listing's trade-offer link with for_item_name read off the row's .listing-title h5", () => {
  installGlobals();
  const { row, anchor } = buildListingRow({ headerText: "Strange Manndatory Attire" });
  global.document = makeDocument([row]);

  fixTradeOfferLinks();

  const url = new URL(anchor.getAttribute("href"));
  assert.equal(url.searchParams.get("for_item_name"), "Strange Manndatory Attire");
  // pre-existing native for_item is left untouched
  assert.equal(url.searchParams.get("for_item"), "440_2_555");
});

// --- listing_intent/listing_currencies_* derivation (classic's native link
// never carries these at all - confirmed live - so this file's own
// patchAnchor adds them, the same way nextUI's own patchAnchor derives them
// from visible page data rather than trusting the link) ---

test("derives listing_intent=1 (sell) and listing_currencies_metal from the row's .item data attributes", () => {
  installGlobals();
  const { row, anchor } = buildListingRow({
    headerText: "Strange Manndatory Attire",
    listingIntent: "sell",
    listingPrice: "22.55 ref",
  });
  global.document = makeDocument([row]);

  fixTradeOfferLinks();

  const url = new URL(anchor.getAttribute("href"));
  assert.equal(url.searchParams.get("listing_intent"), "1");
  assert.equal(url.searchParams.get("listing_currencies_metal"), "22.55");
  assert.equal(url.searchParams.has("listing_currencies_keys"), false);
});

test("derives listing_intent=0 (buy) and listing_currencies_metal from the row's .item data attributes", () => {
  installGlobals();
  const { row, anchor } = buildListingRow({
    headerText: "Strange Manndatory Attire",
    anchorHref: "https://steamcommunity.com/tradeoffer/new/?partner=1&token=abc",
    listingIntent: "buy",
    listingPrice: "18.11 ref",
  });
  global.document = makeDocument([row]);

  fixTradeOfferLinks();

  const url = new URL(anchor.getAttribute("href"));
  assert.equal(url.searchParams.get("listing_intent"), "0");
  assert.equal(url.searchParams.get("listing_currencies_metal"), "18.11");
});

test("parses a mixed keys+metal listing price into both currency params", () => {
  installGlobals();
  const { row, anchor } = buildListingRow({
    headerText: "Unusual Team Captain",
    listingIntent: "sell",
    listingPrice: "2.04 keys, 5.5 ref",
  });
  global.document = makeDocument([row]);

  fixTradeOfferLinks();

  const url = new URL(anchor.getAttribute("href"));
  assert.equal(url.searchParams.get("listing_currencies_keys"), "2.04");
  assert.equal(url.searchParams.get("listing_currencies_metal"), "5.5");
});

test("a listing priced purely in fractional keys keeps the listing's own value", async () => {
  installGlobals(); // no token, nothing cached
  const { row, anchor } = buildListingRow({
    headerText: "Strange Manndatory Attire",
    anchorHref: "https://steamcommunity.com/tradeoffer/new/?partner=1&token=abc",
    listingIntent: "buy",
    listingPrice: "1.16 keys",
  });
  global.document = makeDocument([row]);

  fixTradeOfferLinks();
  await flush();

  const url = new URL(anchor.getAttribute("href"));
  assert.equal(url.searchParams.get("listing_currencies_keys"), "1.16");
  assert.equal(url.searchParams.has("listing_currencies_metal"), false);
});

test("sets listing_intent even when the price can't be parsed, without setting either currency param", () => {
  installGlobals();
  const { row, anchor } = buildListingRow({
    headerText: "Strange Manndatory Attire",
    listingIntent: "sell",
    listingPrice: "Free!",
  });
  global.document = makeDocument([row]);

  fixTradeOfferLinks();

  const url = new URL(anchor.getAttribute("href"));
  assert.equal(url.searchParams.get("listing_intent"), "1");
  assert.equal(url.searchParams.has("listing_currencies_keys"), false);
  assert.equal(url.searchParams.has("listing_currencies_metal"), false);
});

test("leaves listing_intent unset when the row has no .item element at all (nothing to derive it from)", () => {
  installGlobals();
  const { row, anchor } = buildListingRow({ headerText: "Strange Manndatory Attire" });
  global.document = makeDocument([row]);

  fixTradeOfferLinks();

  const url = new URL(anchor.getAttribute("href"));
  assert.equal(url.searchParams.has("listing_intent"), false);
  // for_item_name is still independently derived regardless
  assert.equal(url.searchParams.get("for_item_name"), "Strange Manndatory Attire");
});

// Classic's native link never carries the pre-fill params, so ones already in
// the href (e.g. appended to a trader's saved trade URL) are not this
// listing's and must not survive as its price.
const PLANTED_PREFILL =
  "https://steamcommunity.com/tradeoffer/new/?partner=1&token=abc&for_item=440_2_555" +
  "&listing_intent=0&listing_currencies_keys=50&listing_currencies_metal=99&for_item_name=Planted";

test("REGRESSION: replaces pre-fill params already in the href with the row's own", () => {
  installGlobals();
  const { row, anchor } = buildListingRow({
    headerText: "Strange Manndatory Attire",
    anchorHref: PLANTED_PREFILL,
    listingIntent: "sell",
    listingPrice: "5 ref",
  });
  global.document = makeDocument([row]);

  fixTradeOfferLinks();

  const url = new URL(anchor.getAttribute("href"));
  assert.equal(url.searchParams.get("listing_intent"), "1");
  assert.equal(url.searchParams.has("listing_currencies_keys"), false);
  assert.deepEqual(url.searchParams.getAll("listing_currencies_metal"), ["5"]);
  assert.deepEqual(url.searchParams.getAll("for_item_name"), ["Strange Manndatory Attire"]);
  assert.equal(url.searchParams.get("for_item"), "440_2_555"); // classic's own, kept
});

test("REGRESSION: drops pre-fill params already in the href when the row has nothing to derive them from", () => {
  installGlobals();
  const { row, anchor } = buildListingRow({ anchorHref: PLANTED_PREFILL });
  global.document = makeDocument([row]);

  fixTradeOfferLinks();

  const url = new URL(anchor.getAttribute("href"));
  for (const param of ["listing_intent", "listing_currencies_keys", "listing_currencies_metal", "for_item_name"]) {
    assert.equal(url.searchParams.has(param), false, param);
  }
  assert.equal(url.searchParams.get("for_item"), "440_2_555");
});

test("collapses whitespace in a multi-line item name the same way nextUI's own patcher does", () => {
  installGlobals();
  const { row, anchor } = buildListingRow({ headerText: "Strange\n   Manndatory Attire\n    " });
  global.document = makeDocument([row]);

  fixTradeOfferLinks();

  const url = new URL(anchor.getAttribute("href"));
  assert.equal(url.searchParams.get("for_item_name"), "Strange Manndatory Attire");
});

// Regression test: a buy listing's native link has NO for_item param at all
// (confirmed live - see the file's own header note) - patchAnchor used to
// require for_item's presence before doing anything, which silently skipped
// every buy listing. It must still add for_item_name here. The intent and
// price come from the row's own .item data, as on a real buy-listing row:
// the ones in the href are replaced, never relied on.
test("patches a BUY listing's link (no for_item at all - confirmed live) with for_item_name too", () => {
  installGlobals();
  const { row, anchor } = buildListingRow({
    headerText: "Strange Manndatory Attire",
    anchorHref: "https://steamcommunity.com/tradeoffer/new/?partner=87654321&token=EfGh5678&listing_intent=0&listing_currencies_metal=18",
    listingIntent: "buy",
    listingPrice: "18 ref",
  });
  global.document = makeDocument([row]);

  fixTradeOfferLinks();

  const url = new URL(anchor.getAttribute("href"));
  assert.equal(url.searchParams.get("for_item_name"), "Strange Manndatory Attire");
  assert.equal(url.searchParams.has("for_item"), false);
  assert.equal(url.searchParams.get("listing_intent"), "0");
});

test("leaves a non-tradeoffer link untouched", () => {
  installGlobals();
  const row = new FakeElement("li");
  row.classList.add("listing");
  const anchor = new FakeElement("a");
  anchor.setAttribute("href", "https://backpack.tf/classifieds/relist/440_555");
  row.appendChild(anchor);
  global.document = makeDocument([row]);

  fixTradeOfferLinks();

  assert.equal(anchor.getAttribute("href"), "https://backpack.tf/classifieds/relist/440_555");
});

test("skips a for_item link with no .listing ancestor to read a name off, without throwing", () => {
  installGlobals();
  const anchor = new FakeElement("a");
  anchor.setAttribute("href", "https://steamcommunity.com/tradeoffer/new/?partner=1&token=abc&for_item=440_2_555");
  global.document = makeDocument([anchor]); // dropped directly under body, no .listing wrapper

  assert.doesNotThrow(() => fixTradeOfferLinks());
  assert.equal(anchor.getAttribute("href"), "https://steamcommunity.com/tradeoffer/new/?partner=1&token=abc&for_item=440_2_555");
});

test("skips a for_item link whose row has no .listing-title h5 (name not found), without throwing", () => {
  installGlobals();
  const { row, anchor } = buildListingRow({}); // no headerText -> no .listing-title built at all
  global.document = makeDocument([row]);

  assert.doesNotThrow(() => fixTradeOfferLinks());
  const url = new URL(anchor.getAttribute("href"));
  assert.equal(url.searchParams.has("for_item_name"), false);
});

test("does not re-patch an anchor it already patched", () => {
  installGlobals();
  const { row, anchor } = buildListingRow({ headerText: "Strange Manndatory Attire" });
  global.document = makeDocument([row]);

  fixTradeOfferLinks();
  const firstHref = anchor.getAttribute("href");

  // Tamper with the href directly - if patchAnchor ran again unguarded it
  // would still just set the same for_item_name value (idempotent either
  // way), but the dataset.tf2teFixed flag is what actually short-circuits
  // re-processing, confirmed here via the flag itself rather than the href.
  FakeMutationObserver.instances[0].cb([{ addedNodes: [anchor] }]);

  assert.equal(anchor.dataset.tf2teFixed, "1");
  assert.equal(anchor.getAttribute("href"), firstHref);
});

test("sets up a subtree MutationObserver on document.body", () => {
  installGlobals();
  global.document = makeDocument([]);

  fixTradeOfferLinks();

  assert.equal(FakeMutationObserver.instances.length, 1);
  assert.equal(FakeMutationObserver.instances[0].target, document.body);
  assert.deepEqual(FakeMutationObserver.instances[0].opts, { childList: true, subtree: true });
});

test("the observer patches an added node directly when the node itself is the trade-offer anchor", () => {
  installGlobals();
  global.document = makeDocument([]);
  fixTradeOfferLinks();

  const { anchor } = buildListingRow({ headerText: "Strange Manndatory Attire" });

  FakeMutationObserver.instances[0].cb([{ addedNodes: [anchor] }]);

  const url = new URL(anchor.getAttribute("href"));
  assert.equal(url.searchParams.get("for_item_name"), "Strange Manndatory Attire");
});

test("the observer walks a newly-added container node's descendants for nested trade-offer anchors", () => {
  installGlobals();
  global.document = makeDocument([]);
  fixTradeOfferLinks();

  const { row, anchor } = buildListingRow({ headerText: "Strange Manndatory Attire" });
  const container = new FakeElement("div");
  container.appendChild(row);

  FakeMutationObserver.instances[0].cb([{ addedNodes: [container] }]);

  const url = new URL(anchor.getAttribute("href"));
  assert.equal(url.searchParams.get("for_item_name"), "Strange Manndatory Attire");
});

test("the observer ignores non-element added nodes (e.g. text nodes) without throwing", () => {
  installGlobals();
  global.document = makeDocument([]);
  fixTradeOfferLinks();

  assert.doesNotThrow(() => {
    FakeMutationObserver.instances[0].cb([{ addedNodes: [fakeTextNode()] }]);
  });
});

test("patchAllVisible's initial pass patches every matching anchor already on the page", () => {
  installGlobals();
  const first = buildListingRow({ headerText: "Strange Manndatory Attire", anchorHref: "https://steamcommunity.com/tradeoffer/new/?partner=1&token=a&for_item=440_2_1" });
  const second = buildListingRow({ headerText: "Rocket Launcher", anchorHref: "https://steamcommunity.com/tradeoffer/new/?partner=2&token=b&for_item=440_2_2" });
  global.document = makeDocument([first.row, second.row]);

  fixTradeOfferLinks();

  assert.equal(new URL(first.anchor.getAttribute("href")).searchParams.get("for_item_name"), "Strange Manndatory Attire");
  assert.equal(new URL(second.anchor.getAttribute("href")).searchParams.get("for_item_name"), "Rocket Launcher");
});

// --- click recording (utils/tradeLinkTrust.js): only a link this file
// patched inside a real listing row may unlock the Steam page's pre-fill ---

test("records a click on a patched listing trade link, so the Steam page may pre-fill from it", async () => {
  installGlobals();
  const { row, anchor } = buildListingRow({ headerText: "Rocket Launcher", listingIntent: "buy", listingPrice: "18 ref" });
  global.document = makeDocument([row]);

  fixTradeOfferLinks();
  document.listeners.mousedown[0]({ target: anchor });
  await flush();

  const records = chrome.storage.local._store[TRADE_LINK_CLICKS_STORAGE_KEY];
  assert.equal(records.length, 1);
  assert.equal(records[0].fingerprint, tradeLinkFingerprint(anchor.getAttribute("href")));
});

test("never records a trade link outside a listing row, e.g. one posted on the forums", async () => {
  installGlobals();
  const anchor = new FakeElement("a");
  anchor.setAttribute("href", "https://steamcommunity.com/tradeoffer/new/?partner=1&token=abc&listing_intent=1&listing_currencies_keys=50");
  global.document = makeDocument([anchor]);

  fixTradeOfferLinks();
  document.listeners.mousedown[0]({ target: anchor });
  await flush();

  assert.equal(chrome.storage.local._store[TRADE_LINK_CLICKS_STORAGE_KEY], undefined);
});
