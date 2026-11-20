import { test } from "node:test";
import assert from "node:assert/strict";
import { TRADE_LINK_CLICKS_STORAGE_KEY, tradeLinkFingerprint } from "../utils/tradeLinkTrust.js";
import { fixTradeOfferLinks } from "../backpack.tf/nextUI/fixTradeOfferLinks/content.js";

// Minimal hand-rolled fake DOM (see tests/sellDuplicates.test.js's own header
// comment for why this repo hand-rolls this instead of pulling in jsdom) -
// just enough surface (classList, dataset, closest, querySelector(All) over
// a small compound-selector subset, matches) for fixTradeOfferLinks()'s own
// patchAnchor/patchAllVisible/MutationObserver logic to run against.

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
  appendChild(child) {
    this.children.push(child);
    child.parentElement = this;
    return child;
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

// A text node - no classList/querySelector surface at all, same as a real
// DOM Text node, just enough to exercise the "skip non-element nodes" guard.
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

// Real setTimeout (captured before any test could fake it) - flushes pending
// microtasks (chrome.storage reads) so a test can await them deterministically
// instead of racing them.
const realSetTimeout = globalThis.setTimeout;
async function flush(ticks = 4) {
  for (let i = 0; i < ticks; i++) {
    await new Promise((resolve) => realSetTimeout(resolve, 0));
  }
}

function installGlobals({ storageData = {} } = {}) {
  global.window = { location: { href: "https://next.backpack.tf/classifieds" } };
  global.Node = { ELEMENT_NODE: 1 };
  global.MutationObserver = FakeMutationObserver;
  FakeMutationObserver.instances = [];
  global.chrome = {
    storage: { local: fakeStorageLocal(storageData) },
    runtime: { sendMessage: async () => ({ ok: false, error: "no sendMessage fixture installed" }) },
  };
}

/*
Builds a next.backpack.tf-shaped listing row: the row div (the closest()
target patchAnchor scopes everything else off of), a .item__price text node,
an optional .text-sell/.text-buy indicator, an optional item link
(a[href^="/classifieds/..."]), an optional .listing__details__header name
element, and the actions wrapper holding the actual trade-offer anchor
(.listing__details__actions__action) patchAnchor patches in place.
*/
function buildListingRow({
  priceText,
  isSell = false,
  isBuy = false,
  itemHref,
  headerText,
  commentText,
  anchorHref = "https://next.backpack.tf/trades/create?partner=76561198000000000&token=abcd1234",
  rowClasses = ["d-flex", "flex-row", "flex-grow-1"],
  exactCurrencies,
} = {}) {
  const row = new FakeElement("div");
  row.classList.add(...rowClasses);

  if (priceText !== undefined) {
    const priceEl = new FakeElement("span");
    priceEl.classList.add("item__price");
    priceEl.textContent = priceText;
    row.appendChild(priceEl);
  }

  if (commentText !== undefined) {
    const commentEl = new FakeElement("div");
    commentEl.classList.add("listing__details__comment");
    // Real markup nests a <span> inside this div (whose .textContent then
    // aggregates it) - set directly here instead, since this file's
    // FakeElement.textContent is a plain stored value, not a descendant
    // aggregate (see this file's own header comment on why this hand-rolled
    // DOM only implements the minimal surface patchAnchor actually needs).
    commentEl.textContent = commentText;
    row.appendChild(commentEl);
  }

  if (isSell) {
    const sellEl = new FakeElement("span");
    sellEl.classList.add("text-sell");
    row.appendChild(sellEl);
  }
  if (isBuy) {
    const buyEl = new FakeElement("span");
    buyEl.classList.add("text-buy");
    row.appendChild(buyEl);
  }

  if (itemHref !== undefined) {
    const itemLink = new FakeElement("a");
    itemLink.setAttribute("href", itemHref);
    row.appendChild(itemLink);
  }

  if (headerText !== undefined) {
    const headerEl = new FakeElement("div");
    headerEl.classList.add("listing__details__header");
    headerEl.textContent = headerText;
    row.appendChild(headerEl);
  }

  const actionsWrap = new FakeElement("div");
  actionsWrap.classList.add("listing__details__actions");
  const anchor = new FakeElement("a");
  anchor.classList.add("listing__details__actions__action");
  anchor.href = anchorHref;
  actionsWrap.appendChild(anchor);
  row.appendChild(actionsWrap);

  // The outer .listing element mainWorld.js writes data-tf2te-currencies on
  // (confirmed live: class="listing d-flex flex-row ..." wraps the whole row).
  // A test that needs it puts `listing` (not `row`) into the document.
  const listing = new FakeElement("div");
  listing.classList.add("listing");
  listing.appendChild(row);
  if (exactCurrencies !== undefined) listing.setAttribute("data-tf2te-currencies", exactCurrencies);

  return { row, anchor, listing };
}

test("patches a sell listing's link with intent=1, keys+metal currencies, for_item and for_item_name (whitespace-collapsed)", () => {
  installGlobals();
  const { row, anchor } = buildListingRow({
    priceText: "2.04 keys, 5.5 ref",
    isSell: true,
    itemHref: "/classifieds/440_123456",
    headerText: "Mann Co.\n   Supply Crate Key",
  });
  global.document = makeDocument([row]);

  fixTradeOfferLinks();

  const url = new URL(anchor.href);
  assert.equal(url.searchParams.get("listing_intent"), "1");
  assert.equal(url.searchParams.get("listing_currencies_keys"), "2.04");
  assert.equal(url.searchParams.get("listing_currencies_metal"), "5.5");
  assert.equal(url.searchParams.get("for_item"), "440_2_123456");
  assert.equal(url.searchParams.get("for_item_name"), "Mann Co. Supply Crate Key");
});

test("patches a buy listing's link with intent=0, for_item_name (no specific asset exists to set for_item to)", () => {
  installGlobals();
  const { row, anchor } = buildListingRow({
    priceText: "60 ref",
    isBuy: true,
    itemHref: "/classifieds/440_999",
    headerText: "Rocket Launcher",
  });
  global.document = makeDocument([row]);

  fixTradeOfferLinks();

  const url = new URL(anchor.href);
  assert.equal(url.searchParams.get("listing_intent"), "0");
  assert.equal(url.searchParams.get("listing_currencies_metal"), "60");
  assert.equal(url.searchParams.has("listing_currencies_keys"), false);
  // A buy order has no specific asset tied to it (see fixTradeOfferLinks.js's
  // own note) - tradeoffer.js instead uses for_item_name alone to auto-add a
  // matching item from the visitor's OWN inventory when fulfilling it.
  assert.equal(url.searchParams.has("for_item"), false);
  assert.equal(url.searchParams.get("for_item_name"), "Rocket Launcher");
});

test("a buy listing with no item name available (no .listing__details__header) sets neither for_item nor for_item_name", () => {
  installGlobals();
  const { row, anchor } = buildListingRow({ priceText: "60 ref", isBuy: true, itemHref: "/classifieds/440_999" });
  global.document = makeDocument([row]);

  fixTradeOfferLinks();

  const url = new URL(anchor.href);
  assert.equal(url.searchParams.has("for_item"), false);
  assert.equal(url.searchParams.has("for_item_name"), false);
});

test("a keys-only sell listing sets only the keys currency param", () => {
  installGlobals();
  const { row, anchor } = buildListingRow({ priceText: "3 keys", isSell: true, itemHref: "/classifieds/440_1" });
  global.document = makeDocument([row]);

  fixTradeOfferLinks();

  const url = new URL(anchor.href);
  assert.equal(url.searchParams.get("listing_currencies_keys"), "3");
  assert.equal(url.searchParams.has("listing_currencies_metal"), false);
});

// --- listing_currencies_* precision: .listing__details__comment (confirmed
// live) carries backpack.tf's own EXACT "Buying for 1 key 10.44 ref."-style
// auto-generated summary, preferred over .item__price's rounded "1.16 keys"
// badge whenever it's present and matches that auto-generated shape. ---

test("prefers the exact 'Buying for X key(s) Y ref.' comment over the rounded item__price badge, synchronously (no live key price needed)", () => {
  installGlobals(); // no token, nothing cached - proves this path needs neither
  const { row, anchor } = buildListingRow({
    priceText: "1.16 keys",
    isBuy: true,
    commentText: "Buying for 1 key 10.44 ref. ",
  });
  global.document = makeDocument([row]);

  fixTradeOfferLinks();

  const url = new URL(anchor.href);
  assert.equal(url.searchParams.get("listing_currencies_keys"), "1");
  assert.equal(url.searchParams.get("listing_currencies_metal"), "10.44");
});

test("prefers the exact 'Selling for' comment for a sell listing too", () => {
  installGlobals();
  const { row, anchor } = buildListingRow({
    priceText: "2.3 keys",
    isSell: true,
    itemHref: "/classifieds/440_1",
    commentText: "Selling for 2 keys 20.5 ref.",
  });
  global.document = makeDocument([row]);

  fixTradeOfferLinks();

  const url = new URL(anchor.href);
  assert.equal(url.searchParams.get("listing_currencies_keys"), "2");
  assert.equal(url.searchParams.get("listing_currencies_metal"), "20.5");
});

// A real trading bot's listing comment was "⚡⇄ 24/7 Trading bot
// ⚡Auto-accept⚡Buying Taunt: Peace! for 1 key 16.44 ref. Stock: 0/1⚡Send
// trade ⚡Item offer welcome!!" - backpack.tf's own auto-generated "Buying
// <item> for X key(s) Y ref." phrase, but with the bot's own branding text
// prepended/appended around it. The old start-anchored check
// (/^(buying|selling)\s+for\b/) rejected this outright and fell back to the
// live-key-price estimate, which landed on 16.00 ref (0.25 keys x a live 64
// ref/key) instead of the bot's own stated 16.44 ref - a real ~0.44 ref
// shortfall in what the resulting trade offer would have asked for.
test("finds the exact 'Buying for X key(s) Y ref.' phrase even when a bot wraps it in its own branding text, instead of falling back to a live-key-price estimate", () => {
  installGlobals(); // no token, nothing cached - proves this path needs neither, same as the plain "Buying for" case
  const { row, anchor } = buildListingRow({
    priceText: "1.25 keys",
    isBuy: true,
    commentText:
      "⚡⇄ 24/7 Trading bot ⚡Auto-accept⚡Buying Taunt: Peace! for 1 key 16.44 ref. Stock: 0/1⚡Send trade ⚡Item offer welcome!!",
  });
  global.document = makeDocument([row]);

  fixTradeOfferLinks();

  const url = new URL(anchor.href);
  assert.equal(url.searchParams.get("listing_currencies_keys"), "1");
  assert.equal(url.searchParams.get("listing_currencies_metal"), "16.44");
});

// A real listing's comment was "🔥 1 key, 48.66 ref 📦 Stock: 0 / 1. 💬 Add me
// and send sell_Taunt_The_Dueling_Banjo" - written in styled Unicode
// (mathematical bold digits/letters, e.g. "𝟏 𝐤𝐞𝐲") - and doesn't use
// backpack.tf's own "Buying/Selling for X" phrasing at all, just states the
// price plainly up front. Confirmed against the item's own next.backpack.tf
// tooltip (price="1 key, 48.66 ref") that this IS the real, exact listing
// price. The old code recognized neither the styled digits nor this
// non-"for"-phrased shape, so it fell back to the item__price badge's rounded
// "1.75 keys" and a live-key-price ESTIMATE that landed on 47.63 ref instead
// of the real 48.66 ref - a genuine ~1.03 ref shortfall in what the resulting
// trade offer would have asked for.
test("recognizes a bare 'N key(s), M ref' price stated at the very start of a styled-Unicode comment, even with no 'for' phrasing at all", () => {
  installGlobals(); // no token, nothing cached - proves this path needs neither
  const { row, anchor } = buildListingRow({
    priceText: "1.75 keys",
    isBuy: true,
    commentText:
      "🔥 𝟏 𝐤𝐞𝐲, 𝟒𝟖.𝟔𝟔 𝐫𝐞𝐟 📦 Stock : 0 / 1. 💬 Add me and send 𝘀𝗲𝗹𝗹_𝗧𝗮𝘂𝗻𝘁_𝗧𝗵𝗲_𝗗𝘂𝗲𝗹𝗶𝗻𝗴_𝗕𝗮𝗻𝗷𝗼",
  });
  global.document = makeDocument([row]);

  fixTradeOfferLinks();

  const url = new URL(anchor.href);
  assert.equal(url.searchParams.get("listing_currencies_keys"), "1");
  assert.equal(url.searchParams.get("listing_currencies_metal"), "48.66");
});

test("recognizes the same leading 'N key(s), M ref' shape in plain (non-styled) ASCII text too, not just the Unicode-styled case", () => {
  installGlobals();
  const { row, anchor } = buildListingRow({
    priceText: "1.75 keys",
    isBuy: true,
    commentText: "1 key, 48.66 ref. Stock: 0/1. Add me!",
  });
  global.document = makeDocument([row]);

  fixTradeOfferLinks();

  const url = new URL(anchor.href);
  assert.equal(url.searchParams.get("listing_currencies_keys"), "1");
  assert.equal(url.searchParams.get("listing_currencies_metal"), "48.66");
});

// A real listing's comment was "⚡COUNTER-OFFERS ENABLED⚡ 1 key 22 ref. Stock:
// 0/1 [Send empty/overpay/underpay offers and I will counter it with correct
// amount]❤️" - the price sits neither in a "buying/selling for X" phrase nor
// at the very start (branding text comes first), so neither the "for" check
// nor the leading-price check catches it. Confirmed against the item's own
// tooltip ("is buying for 1 key, 22 ref") that this genuinely is the real
// price. The old code fell back to the item__price badge's rounded "1.34
// keys" and a live-key-price ESTIMATE that landed on 21.59 ref instead of the
// real 22 ref.
test("recognizes a 'N key(s) M ref' price mentioned anywhere in the comment when BOTH currencies are stated, even mid-sentence after branding text", () => {
  installGlobals(); // no token, nothing cached - proves this path needs neither
  const { row, anchor } = buildListingRow({
    priceText: "1.34 keys",
    isBuy: true,
    commentText:
      "⚡COUNTER-OFFERS ENABLED⚡ 1 key 22 ref. Stock: 0/1 [Send empty/overpay/underpay offers and I will counter it with correct amount]❤️",
  });
  global.document = makeDocument([row]);

  fixTradeOfferLinks();

  const url = new URL(anchor.href);
  assert.equal(url.searchParams.get("listing_currencies_keys"), "1");
  assert.equal(url.searchParams.get("listing_currencies_metal"), "22");
});

test("does NOT trust a lone single-currency number mentioned mid-comment - only a comment stating BOTH keys and ref together is trusted unanchored", async () => {
  installGlobals();
  const { row, anchor } = buildListingRow({
    priceText: "1.16 keys",
    isBuy: true,
    // Mentions "keys" but never "ref" - not a full price breakdown, just a
    // threshold statement (the exact false-positive risk the "both
    // currencies" requirement above exists to avoid).
    commentText: "Need 2 keys minimum, no lowballs please",
  });
  global.document = makeDocument([row]);

  fixTradeOfferLinks();
  await flush();

  // The comment is ignored: the link carries the badge's own price.
  const url = new URL(anchor.href);
  assert.equal(url.searchParams.get("listing_currencies_keys"), "1.16");
  assert.equal(url.searchParams.get("listing_currencies_metal"), null);
});

test("does NOT treat a comment as a leading price statement just because a number appears early - only a genuine leading keys/ref amount counts", async () => {
  installGlobals();
  const { row, anchor } = buildListingRow({
    priceText: "1.16 keys",
    isBuy: true,
    // "Stock" is a word, not decoration - the leading-price check must not
    // strip past it, so this must NOT be mistaken for "5 key(s)/ref".
    commentText: "Stock: 5, add me!",
  });
  global.document = makeDocument([row]);

  fixTradeOfferLinks();
  await flush();

  // The comment is ignored: the link carries the badge's own price.
  const url = new URL(anchor.href);
  assert.equal(url.searchParams.get("listing_currencies_keys"), "1.16");
  assert.equal(url.searchParams.get("listing_currencies_metal"), null);
});

test("ignores a customized comment that doesn't match the auto-generated 'Buying/Selling for' shape, falling back to the item__price badge", async () => {
  installGlobals();
  const { row, anchor } = buildListingRow({
    priceText: "1.16 keys",
    isBuy: true,
    commentText: "add me on steam, quick trade only!",
  });
  global.document = makeDocument([row]);

  fixTradeOfferLinks();
  await flush();

  // The comment is ignored: the link carries the badge's own price.
  const url = new URL(anchor.href);
  assert.equal(url.searchParams.get("listing_currencies_keys"), "1.16");
  assert.equal(url.searchParams.get("listing_currencies_metal"), null);
});

// SECURITY: the comment is free text the listing's owner writes. A price in
// it that disagrees with the shown badge must not be pre-filled into the
// trade, or "Selling for 3 keys" on a listing shown at 5 ref would ask the
// user to pay 3 keys.
test("SECURITY: ignores a comment price that disagrees with the shown badge, falling back to the badge", () => {
  for (const [priceText, commentText, expectedKeys, expectedMetal] of [
    ["5 ref", "Selling for 3 keys.", null, "5"],
    ["1.9 keys", "Selling for 4 keys 1 ref.", "1.9", null],
    ["2.5 keys", "Selling for 0 keys 30 ref.", "2.5", null],
  ]) {
    installGlobals();
    const { row, anchor } = buildListingRow({ priceText, isSell: true, itemHref: "/classifieds/440_1", commentText });
    global.document = makeDocument([row]);

    fixTradeOfferLinks();

    const url = new URL(anchor.href);
    assert.equal(url.searchParams.get("listing_currencies_keys"), expectedKeys, commentText);
    assert.equal(url.searchParams.get("listing_currencies_metal"), expectedMetal, commentText);
  }
});

test("still trusts a comment whose price fits the badge, including a whole-key badge rounded up from just under it", () => {
  for (const [priceText, commentText, expectedKeys, expectedMetal] of [
    ["60.11 ref", "Selling for 60.11 ref.", null, "60.11"],
    ["2 keys", "Selling for 1 key 64.88 ref.", "1", "64.88"],
    ["3 keys", "Selling for 3 keys.", "3", null],
  ]) {
    installGlobals();
    const { row, anchor } = buildListingRow({ priceText, isSell: true, itemHref: "/classifieds/440_1", commentText });
    global.document = makeDocument([row]);

    fixTradeOfferLinks();

    const url = new URL(anchor.href);
    assert.equal(url.searchParams.get("listing_currencies_keys"), expectedKeys, commentText);
    assert.equal(url.searchParams.get("listing_currencies_metal"), expectedMetal, commentText);
  }
});

test("ignores a missing/empty comment element, falling back to the item__price badge", () => {
  installGlobals();
  const { row, anchor } = buildListingRow({ priceText: "3 keys", isSell: true, itemHref: "/classifieds/440_1" });
  global.document = makeDocument([row]);

  fixTradeOfferLinks();

  const url = new URL(anchor.href);
  assert.equal(url.searchParams.get("listing_currencies_keys"), "3");
});

test("a listing priced purely in fractional keys, with no exact price to read, keeps the badge's own value", async () => {
  installGlobals(); // no token, nothing cached
  const { row, anchor } = buildListingRow({ priceText: "1.16 keys", isBuy: true });
  global.document = makeDocument([row]);

  fixTradeOfferLinks();
  await flush();

  const url = new URL(anchor.href);
  assert.equal(url.searchParams.get("listing_currencies_keys"), "1.16");
  assert.equal(url.searchParams.has("listing_currencies_metal"), false);
});

test("a whole-number keys price is carried as-is, with no metal", async () => {
  installGlobals();
  const { row, anchor } = buildListingRow({ priceText: "3 keys", isSell: true, itemHref: "/classifieds/440_1" });
  global.document = makeDocument([row]);

  fixTradeOfferLinks();
  await flush();

  const url = new URL(anchor.href);
  assert.equal(url.searchParams.get("listing_currencies_keys"), "3");
  assert.equal(url.searchParams.has("listing_currencies_metal"), false);
});

test("leaves the anchor untouched when it has no ancestor matching the row selector", () => {
  installGlobals();
  const anchor = new FakeElement("a");
  anchor.classList.add("listing__details__actions__action");
  anchor.href = "https://next.backpack.tf/trades/create?partner=1&token=x";
  global.document = makeDocument([anchor]); // dropped directly under body, no row wrapper

  fixTradeOfferLinks();

  assert.equal(anchor.href, "https://next.backpack.tf/trades/create?partner=1&token=x");
  assert.equal(anchor.dataset.tf2teFixed, undefined);
});

test("leaves the anchor untouched when the row has no .item__price element", () => {
  installGlobals();
  const { row, anchor } = buildListingRow({ isSell: true }); // no priceText -> no .item__price built
  const originalHref = anchor.href;
  global.document = makeDocument([row]);

  fixTradeOfferLinks();

  assert.equal(anchor.href, originalHref);
});

test("leaves the anchor untouched when the price text has neither a keys nor a ref amount", () => {
  installGlobals();
  const { row, anchor } = buildListingRow({ priceText: "Free!", isSell: true });
  const originalHref = anchor.href;
  global.document = makeDocument([row]);

  fixTradeOfferLinks();

  assert.equal(anchor.href, originalHref);
});

test("leaves the anchor untouched when the row has neither a sell nor a buy indicator", () => {
  installGlobals();
  const { row, anchor } = buildListingRow({ priceText: "60 ref" }); // isSell/isBuy both false
  const originalHref = anchor.href;
  global.document = makeDocument([row]);

  fixTradeOfferLinks();

  assert.equal(anchor.href, originalHref);
});

test("skips for_item/for_item_name (but still sets intent/currencies) when the item link href doesn't match the expected /classifieds/<appid>_<assetid> shape", () => {
  installGlobals();
  const { row, anchor } = buildListingRow({
    priceText: "60 ref",
    isSell: true,
    itemHref: "/classifieds/not-a-valid-id",
  });
  global.document = makeDocument([row]);

  fixTradeOfferLinks();

  const url = new URL(anchor.href);
  assert.equal(url.searchParams.get("listing_intent"), "1");
  assert.equal(url.searchParams.has("for_item"), false);
  assert.equal(url.searchParams.has("for_item_name"), false);
});

test("a re-render with unchanged row content is not re-patched (content signature dedupe)", () => {
  installGlobals();
  const { row, anchor } = buildListingRow({ priceText: "60 ref", isSell: true, itemHref: "/classifieds/440_1" });
  global.document = makeDocument([row]);

  fixTradeOfferLinks();
  const signature = anchor.dataset.tf2teFixed;

  // Tamper with the href directly - if patchAnchor's own href-rewrite ran
  // again it would overwrite this back to the canonical computed URL, so it
  // staying tampered proves the signature check short-circuited before that.
  anchor.href = "https://next.backpack.tf/tampered";

  FakeMutationObserver.instances[0].cb([{ addedNodes: [anchor] }]);

  assert.equal(anchor.dataset.tf2teFixed, signature);
  assert.equal(anchor.href, "https://next.backpack.tf/tampered");
});

test("a row whose price genuinely changed (Vue recycling the same DOM node) IS re-patched with the new values", () => {
  installGlobals();
  const { row, anchor } = buildListingRow({ priceText: "60 ref", isSell: true, itemHref: "/classifieds/440_1" });
  global.document = makeDocument([row]);

  fixTradeOfferLinks();
  const firstSignature = anchor.dataset.tf2teFixed;

  row.children.find((c) => c.classList.contains("item__price")).textContent = "80 ref";
  FakeMutationObserver.instances[0].cb([{ addedNodes: [anchor] }]);

  assert.notEqual(anchor.dataset.tf2teFixed, firstSignature);
  const url = new URL(anchor.href);
  assert.equal(url.searchParams.get("listing_currencies_metal"), "80");
});

test("REGRESSION: a recycled row that switches from a sell to a buy listing drops the previous listing's for_item and keys", () => {
  installGlobals();
  const { row, anchor } = buildListingRow({ priceText: "1 key", isSell: true, itemHref: "/classifieds/440_1", headerText: "Team Captain" });
  global.document = makeDocument([row]);

  fixTradeOfferLinks();
  assert.equal(new URL(anchor.href).searchParams.get("for_item"), "440_2_1");

  // Vue reuses the node for the same trader's buy order and leaves the
  // anchor's (already patched) href alone, since its own value is unchanged.
  row.children.find((c) => c.classList.contains("item__price")).textContent = "5 ref";
  const sellIndex = row.children.findIndex((c) => c.classList.contains("text-sell"));
  const buyEl = new FakeElement("span");
  buyEl.classList.add("text-buy");
  buyEl.parentElement = row;
  row.children[sellIndex] = buyEl;
  row.children.find((c) => c.classList.contains("listing__details__header")).textContent = "Bill's Hat";
  FakeMutationObserver.instances[0].cb([{ addedNodes: [anchor] }]);

  const url = new URL(anchor.href);
  assert.equal(url.searchParams.get("listing_intent"), "0");
  assert.equal(url.searchParams.get("listing_currencies_metal"), "5");
  assert.equal(url.searchParams.has("listing_currencies_keys"), false);
  assert.equal(url.searchParams.has("for_item"), false);
  assert.equal(url.searchParams.get("for_item_name"), "Bill's Hat");
});

test("fixTradeOfferLinks sets up a subtree MutationObserver on document.body", () => {
  installGlobals();
  global.document = makeDocument([]);

  fixTradeOfferLinks();

  assert.equal(FakeMutationObserver.instances.length, 1);
  assert.equal(FakeMutationObserver.instances[0].target, document.body);
  assert.deepEqual(FakeMutationObserver.instances[0].opts, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["data-tf2te-currencies"],
  });
});

test("the observer patches an added node directly when the node itself is the trade-offer anchor", () => {
  installGlobals();
  global.document = makeDocument([]); // nothing present on the initial pass
  fixTradeOfferLinks();

  const { anchor } = buildListingRow({ priceText: "12 ref", isBuy: true });

  FakeMutationObserver.instances[0].cb([{ addedNodes: [anchor] }]);

  const url = new URL(anchor.href);
  assert.equal(url.searchParams.get("listing_intent"), "0");
});

test("the observer walks a newly-added container node's descendants for nested trade-offer anchors", () => {
  installGlobals();
  global.document = makeDocument([]);
  fixTradeOfferLinks();

  const { row, anchor } = buildListingRow({ priceText: "5 ref", isSell: true, itemHref: "/classifieds/440_1" });
  const container = new FakeElement("div"); // doesn't itself match the anchor selector
  container.appendChild(row);

  FakeMutationObserver.instances[0].cb([{ addedNodes: [container] }]);

  const url = new URL(anchor.href);
  assert.equal(url.searchParams.get("listing_intent"), "1");
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
  const first = buildListingRow({ priceText: "10 ref", isSell: true, itemHref: "/classifieds/440_1" });
  const second = buildListingRow({ priceText: "20 ref", isBuy: true });
  global.document = makeDocument([first.row, second.row]);

  fixTradeOfferLinks();

  assert.equal(new URL(first.anchor.href).searchParams.get("listing_intent"), "1");
  assert.equal(new URL(second.anchor.href).searchParams.get("listing_intent"), "0");
});

// Real listing confirmed live: badge "250.45 keys", custom comment "buying",
// Vue's own $props.listing.currencies { keys: 250, metal: 28.77 }.
const LIVE_ID = "440_76561198000000000_0123456789abcdef0123456789abcdef";
const liveExact = (id = LIVE_ID) => JSON.stringify({ id, keys: 250, metal: 28.77 });

test("prefers the exact Vue price (data-tf2te-currencies) over a rounded badge with a custom comment, with no key-price correction", async () => {
  installGlobals();
  const { listing, anchor } = buildListingRow({
    priceText: "250.45 keys",
    commentText: "buying",
    isBuy: true,
    itemHref: `/classifieds/${LIVE_ID}`,
    exactCurrencies: liveExact(),
  });
  global.document = makeDocument([listing]);

  fixTradeOfferLinks();
  await flush();

  const url = new URL(anchor.href);
  assert.equal(url.searchParams.get("listing_currencies_keys"), "250");
  assert.equal(url.searchParams.get("listing_currencies_metal"), "28.77");
});

test("the exact Vue price also wins over a parseable comment", () => {
  installGlobals();
  const { listing, anchor } = buildListingRow({
    priceText: "1.16 keys",
    commentText: "Selling for 1 key 9 ref.",
    isSell: true,
    itemHref: "/classifieds/440_1",
    exactCurrencies: JSON.stringify({ id: "440_1", keys: 1, metal: 10.44 }),
  });
  global.document = makeDocument([listing]);

  fixTradeOfferLinks();

  const url = new URL(anchor.href);
  assert.equal(url.searchParams.get("listing_currencies_keys"), "1");
  assert.equal(url.searchParams.get("listing_currencies_metal"), "10.44");
});

test("ignores an exact price whose listing id doesn't match the row's own item link (recycled row)", () => {
  installGlobals();
  const { listing, anchor } = buildListingRow({
    priceText: "60 ref",
    isBuy: true,
    itemHref: "/classifieds/440_other",
    exactCurrencies: liveExact(),
  });
  global.document = makeDocument([listing]);

  fixTradeOfferLinks();

  const url = new URL(anchor.href);
  assert.equal(url.searchParams.has("listing_currencies_keys"), false);
  assert.equal(url.searchParams.get("listing_currencies_metal"), "60");
});

test("ignores an exact price when the row has no item link to verify it against", () => {
  installGlobals();
  const { listing, anchor } = buildListingRow({ priceText: "60 ref", isBuy: true, exactCurrencies: liveExact() });
  global.document = makeDocument([listing]);

  fixTradeOfferLinks();

  assert.equal(new URL(anchor.href).searchParams.get("listing_currencies_metal"), "60");
});

test("ignores a malformed or all-zero exact price, falling back to the badge", () => {
  for (const exactCurrencies of ["{not json", JSON.stringify({ id: "440_1", keys: 0, metal: 0 })]) {
    installGlobals();
    const { listing, anchor } = buildListingRow({
      priceText: "60 ref",
      isSell: true,
      itemHref: "/classifieds/440_1",
      exactCurrencies,
    });
    global.document = makeDocument([listing]);

    fixTradeOfferLinks();

    assert.equal(new URL(anchor.href).searchParams.get("listing_currencies_metal"), "60", exactCurrencies);
  }
});

test("re-patches a row once mainWorld.js writes its exact price after the first pass", () => {
  installGlobals();
  const { listing, anchor } = buildListingRow({
    priceText: "250.45 keys",
    commentText: "buying",
    isBuy: true,
    itemHref: `/classifieds/${LIVE_ID}`,
  });
  global.document = makeDocument([listing]);

  fixTradeOfferLinks();
  assert.equal(new URL(anchor.href).searchParams.get("listing_currencies_keys"), "250.45");

  listing.setAttribute("data-tf2te-currencies", liveExact());
  FakeMutationObserver.instances[0].cb([{ type: "attributes", target: listing, addedNodes: [] }]);

  const url = new URL(anchor.href);
  assert.equal(url.searchParams.get("listing_currencies_keys"), "250");
  assert.equal(url.searchParams.get("listing_currencies_metal"), "28.77");
});

// --- click recording (utils/tradeLinkTrust.js): only a listing row's own
// trade action this file patched may unlock the Steam page's pre-fill ---

test("records a click on a patched listing trade action, so the Steam page may pre-fill from it", async () => {
  installGlobals();
  const { row, anchor } = buildListingRow({ priceText: "18 ref", isBuy: true, headerText: "Rocket Launcher" });
  global.document = makeDocument([row]);

  fixTradeOfferLinks();
  document.listeners.click[0]({ target: anchor });
  await flush();

  const records = chrome.storage.local._store[TRADE_LINK_CLICKS_STORAGE_KEY];
  assert.equal(records.length, 1);
  assert.equal(records[0].fingerprint, tradeLinkFingerprint(anchor.href));
});

test("never records a trade action it couldn't patch (no listing row signals around it)", async () => {
  installGlobals();
  const { row, anchor } = buildListingRow({ isBuy: true }); // no price, so patchAnchor leaves it alone
  global.document = makeDocument([row]);

  fixTradeOfferLinks();
  document.listeners.click[0]({ target: anchor });
  await flush();

  assert.equal(chrome.storage.local._store[TRADE_LINK_CLICKS_STORAGE_KEY], undefined);
});
