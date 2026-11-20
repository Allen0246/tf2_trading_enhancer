import { test } from "node:test";
import assert from "node:assert/strict";

// See tests/addPostsTfButton.test.js's own header comment: utils/tf2Schema.js
// memoizes its result at module scope for this file's lifetime, so a
// pre-seeded fixture installed before import (not per-test) is the right
// shape. posts.tf needs a real Valve defindex per item name.
globalThis.chrome = {
  storage: {
    local: {
      async get() {
        return {
          tf2SchemaCache: {
            itemNameToDefindex: {
              "Mann Co. Supply Crate Key": 5021,
              "Professional Killstreak Mann Co. Supply Crate Key": 5021,
              "Reclaimed Metal": 143,
            },
            defindexToItemName: {},
            effectNameToId: {},
            fetchedAt: Date.now(),
            schemaShapeVersion: 4,
          },
        };
      },
      async set() {},
    },
    // backpack.tf/oldUI/addMannStoreButton/content.js's own
    // ensureSheenKillstreakerFilterWatcher (this file's own
    // buildMannStoreHref is reused by statsPageQuickLinks for the mannco.store
    // button below) registers a listener here on first actual button build.
    onChanged: { addListener() {} },
  },
  runtime: {
    getURL: (path) => path,
    // Routes pricedb.io's own /api/search - every other call this feature
    // makes (posts.tf's own defindex lookup) is served entirely from the
    // pre-seeded schema cache above and never reaches this at all.
    async sendMessage(msg) {
      const url = new URL(msg.url);
      if (!url.hostname.includes("pricedb.io")) {
        throw new Error(`unexpected sendMessage: ${msg.url}`);
      }
      // Same real HTTP 429 status/shape background.js's own fetchJson
      // already returns on pricedb.io's own dynamic per-IP rate limit - see
      // utils/pricedb.js's own searchPricedbSkuStatus note.
      if (pricedbRateLimited) return { ok: false, status: 429, error: "Rate limited (429)" };
      const q = url.searchParams.get("q");
      lastPricedbQuery = q;
      return {
        ok: true,
        data: { success: true, data: { query: q, results: pricedbSku ? [{ name: q, sku: pricedbSku }] : [], total: pricedbSku ? 1 : 0 } },
      };
    },
  },
};
globalThis.fetch = async () => ({ json: async () => [] });

let pricedbSku = "5021;6";
let lastPricedbQuery = null;
let pricedbRateLimited = false;

const { statsPageQuickLinks } = await import("../backpack.tf/oldUI/statsPageQuickLinks/content.js");
const { __resetPricedbCacheForTests } = await import("../utils/pricedb.js");

// Same hand-rolled fake DOM every other tooltip/stats-quick-links test file
// in this repo already uses (see tests/addGladiatorButton.test.js's own
// header comment for why this repo hand-rolls rather than pulling in
// jsdom). No descendant-combinator support - content.js's own selectors are
// written to never need one, chaining closest()/querySelector() on simple
// selectors instead.

function parseCompound(selector) {
  const rest = selector;
  const classes = [...rest.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
  const tagMatch = /^[a-zA-Z][\w-]*/.exec(rest);
  return { tag: tagMatch ? tagMatch[0].toLowerCase() : null, classes };
}

function matchesCompound(el, parsed) {
  if (!el || el.nodeType !== 1) return false;
  if (parsed.tag && el.tagName.toLowerCase() !== parsed.tag) return false;
  return parsed.classes.every((c) => el.classList.contains(c));
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.nodeType = 1;
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
  get id() {
    return this._attrs.id || "";
  }
  set id(v) {
    this._attrs.id = v;
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
  // Standard DOM methods the pricedb.io loading slot / countdown
  // (utils/linkButtonStates.js) rely on.
  removeAttribute(name) {
    delete this._attrs[name];
  }
  addEventListener(type, cb) {
    ((this._listeners ||= {})[type] ||= []).push(cb);
  }
  // A string becomes a text node, as in the real DOM.
  append(...nodes) {
    for (const n of nodes) {
      if (typeof n === "string") this.children.push({ nodeType: 3, textContent: n, children: [], parentElement: this });
      else this.appendChild(n);
    }
  }
  replaceWith(el) {
    const siblings = this.parentElement.children;
    siblings.splice(siblings.indexOf(this), 1, el);
    el.parentElement = this.parentElement;
    this.parentElement = null;
  }
  get isConnected() {
    let el = this;
    while (el.parentElement) el = el.parentElement;
    return el.tagName === "body";
  }
  getAttributeNames() {
    return Object.keys(this._attrs);
  }
  appendChild(child) {
    if (child.parentElement) {
      const oldSiblings = child.parentElement.children;
      const oldIdx = oldSiblings.indexOf(child);
      if (oldIdx !== -1) oldSiblings.splice(oldIdx, 1);
    }
    this.children.push(child);
    child.parentElement = this;
    return child;
  }
  insertBefore(newNode, referenceNode) {
    if (newNode.parentElement) {
      const oldSiblings = newNode.parentElement.children;
      const oldIdx = oldSiblings.indexOf(newNode);
      if (oldIdx !== -1) oldSiblings.splice(oldIdx, 1);
    }
    const idx = referenceNode ? this.children.indexOf(referenceNode) : -1;
    if (idx === -1) this.children.push(newNode);
    else this.children.splice(idx, 0, newNode);
    newNode.parentElement = this;
    return newNode;
  }
  remove() {
    if (!this.parentElement) return;
    const siblings = this.parentElement.children;
    const idx = siblings.indexOf(this);
    if (idx !== -1) siblings.splice(idx, 1);
    this.parentElement = null;
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

function findById(root, id) {
  if (root.id === id) return root;
  for (const child of root.children) {
    const found = findById(child, id);
    if (found) return found;
  }
  return null;
}

function makeDocument(rootChildren = []) {
  const body = new FakeElement("body");
  const head = new FakeElement("head");
  for (const c of rootChildren) body.appendChild(c);
  return {
    body,
    head,
    createElement: (tag) => new FakeElement(tag),
    createElementNS: (_ns, tag) => new FakeElement(tag),
    getElementById: (id) => findById(body, id) || findById(head, id),
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

function installGlobals({
  href = "https://backpack.tf/stats/Unique/Mann%20Co.%20Supply%20Crate%20Key/Tradable/Craftable",
  sku = "5021;6",
  pricedbRateLimited: rateLimited = false,
} = {}) {
  global.window = { location: { href } };
  global.Node = { ELEMENT_NODE: 1 };
  global.MutationObserver = FakeMutationObserver;
  FakeMutationObserver.instances = [];
  pricedbSku = sku;
  pricedbRateLimited = rateLimited;
  __resetPricedbCacheForTests();
}

// Confirmed live shape (classic backpack.tf's /stats page):
// .stats-header-panel > .stats-body > (.stats-header (with
// .stats-header-item .item[data-*] and .stats-killstreak-list), .stats-subheader).
function buildStatsPanel({
  name = "Mann Co. Supply Crate Key",
  baseName = "Mann Co. Supply Crate Key",
  quality = 6,
  qName = "Unique",
  priceindex = "0",
  activeKsLabel = "No Kit",
  includeKsTabs = true,
} = {}) {
  const panel = new FakeElement("div");
  panel.className = "col-md-12 stats-panel stats-header-panel";

  const body = new FakeElement("div");
  body.className = "stats-body";
  panel.appendChild(body);

  const header = new FakeElement("div");
  header.className = "stats-header";
  body.appendChild(header);

  const headerItem = new FakeElement("div");
  headerItem.className = "stats-header-item";
  header.appendChild(headerItem);

  const item = new FakeElement("div");
  item.className = "item q-440-6 q-440-border-6";
  item.setAttribute("data-name", name);
  item.setAttribute("data-base_name", baseName);
  item.setAttribute("data-quality", String(quality));
  item.setAttribute("data-q_name", qName);
  item.setAttribute("data-priceindex", priceindex);
  item.setAttribute("data-craftable", "1");
  headerItem.appendChild(item);

  if (includeKsTabs) {
    const ksTabs = new FakeElement("div");
    ksTabs.className = "btn-group btn-group-sm stats-killstreak-list";
    header.appendChild(ksTabs);
    ["No Kit", "Normal KS", "Specialized KS", "Professional KS"].forEach((label) => {
      const tab = new FakeElement("a");
      tab.className = label === activeKsLabel ? "btn btn-variety active" : "btn btn-variety";
      tab.textContent = label;
      ksTabs.appendChild(tab);
    });
  }

  const subheader = new FakeElement("div");
  subheader.className = "stats-subheader";
  subheader.textContent = "price boxes + market trends";
  body.appendChild(subheader);

  return { panel, body, header, subheader };
}

function getQuickLinksRow() {
  return document.querySelector(".tf2te-oldui-stats-quick-links-row");
}

function getQuickLinks() {
  return getQuickLinksRow()?.querySelectorAll(".tf2te-oldui-stats-quick-link-button") ?? [];
}

function getQuickLink(label) {
  return getQuickLinks().find((link) => link.textContent === label) || null;
}

test("adds stntrading.eu, marketplace.tf, mannco.store, gladiator.tf, pricedb.io, and posts.tf buttons for a plain Unique item, reading identity off the item's own data-* attributes", async () => {
  installGlobals();
  const { panel } = buildStatsPanel();
  global.document = makeDocument([panel]);

  statsPageQuickLinks();
  await flush();

  assert.equal(getQuickLink("stntrading.eu")?.href, "https://stntrading.eu/item/tf2/Mann+Co.+Supply+Crate+Key");
  assert.match(getQuickLink("marketplace.tf")?.href, /^https:\/\/marketplace\.tf\/browse\/tf2\?/);
  assert.equal(
    getQuickLink("mannco.store")?.href,
    "https://mannco.store/tf2?search=Mann+Co.+Supply+Crate+Key&quality=Unique&killstreak=No&warpaints=No+WarPaints"
  );
  assert.equal(getQuickLink("gladiator.tf")?.href, "https://gladiator.tf/sales?item=Mann+Co.+Supply+Crate+Key");
  assert.equal(getQuickLink("pricedb.io")?.href, "https://pricedb.io/item/5021%3B6");
  assert.match(getQuickLink("posts.tf")?.href, /^https:\/\/posts\.tf\/posts\/search\/results\?q=/);
  assert.equal(getQuickLinks().length, 6);
});

test("the quick-links row is appended to the end of .stats-body, after .stats-subheader - not into the header at all", async () => {
  installGlobals();
  const { panel, body, subheader } = buildStatsPanel();
  global.document = makeDocument([panel]);

  statsPageQuickLinks();
  await flush();

  const wrap = document.querySelector(".tf2te-oldui-stats-controls");
  assert.deepEqual(body.children.slice(-2), [subheader, wrap]);
  // The relocated killstreak tabs (see the dedicated relocation test below)
  // sit ahead of the row within that same wrap.
  assert.equal(wrap.children[wrap.children.length - 1], getQuickLinksRow());
});

// The real killstreak-tier tab bar itself moves down into the same
// controls section as the quick-links row, not just its own detected tier
// value - a real DOM move (same node, not a clone), so its native
// click-to-navigate behavior keeps working unchanged.
test("relocates the real killstreak-tier tab bar element into the controls wrap, above the quick-links row", async () => {
  installGlobals();
  const { panel, body, header } = buildStatsPanel();
  global.document = makeDocument([panel]);
  const ksTabList = header.querySelector(".stats-killstreak-list");

  statsPageQuickLinks();
  await flush();

  const wrap = document.querySelector(".tf2te-oldui-stats-controls");
  assert.equal(ksTabList.parentElement, wrap);
  assert.deepEqual(wrap.children, [ksTabList, getQuickLinksRow()]);
  // No longer in the header.
  assert.equal(header.querySelector(".stats-killstreak-list"), null);
});

test("relocation happens even when the rest of the feature doesn't resolve (no crash, tab bar still moves)", async () => {
  installGlobals();
  const { panel, body, header } = buildStatsPanel();
  global.document = makeDocument([panel]);
  const item = body.querySelector(".stats-header-item").querySelector(".item");
  item.setAttribute("data-base_name", ""); // forces resolveIdentity() to return null
  const ksTabList = header.querySelector(".stats-killstreak-list");

  await assert.doesNotReject(async () => {
    statsPageQuickLinks();
    await flush();
  });

  const wrap = document.querySelector(".tf2te-oldui-stats-controls");
  assert.equal(ksTabList.parentElement, wrap);
  assert.equal(getQuickLinksRow(), null); // buttons themselves never resolved
});

// Classic /stats has no data-* attribute for killstreak tier at all - it's
// read off whichever killstreak-tier tab currently carries the "active"
// class, then baked into the name sent to
// gladiator.tf/pricedb.io/resolveStatsAndClassifieds AND passed to
// mannco.store as its own separate "killstreak" param.
test("detects the active killstreak-tier tab and bakes it into the item name / mannco.store's own killstreak param", async () => {
  installGlobals({ href: "https://backpack.tf/stats/Unique/Professional%20Killstreak%20Mann%20Co.%20Supply%20Crate%20Key/Tradable/Craftable" });
  const { panel } = buildStatsPanel({ activeKsLabel: "Professional KS" });
  global.document = makeDocument([panel]);

  statsPageQuickLinks();
  await flush();

  assert.equal(
    getQuickLink("gladiator.tf")?.href,
    "https://gladiator.tf/sales?item=Professional+Killstreak+Mann+Co.+Supply+Crate+Key"
  );
  assert.match(getQuickLink("mannco.store")?.href, /killstreak=Professional\+Killstreak/);
});

test("defaults to killstreak tier 0 when there's no killstreak-tab bar at all (an item type with no killstreak variants)", async () => {
  installGlobals();
  const { panel } = buildStatsPanel({ includeKsTabs: false });
  global.document = makeDocument([panel]);

  statsPageQuickLinks();
  await flush();

  assert.equal(getQuickLink("gladiator.tf")?.href, "https://gladiator.tf/sales?item=Mann+Co.+Supply+Crate+Key");
});

// Posts.tf's own defindex lookup can genuinely fail for an item this schema
// cache fixture doesn't cover.
test("omits just the posts.tf button (not the others) when its own defindex lookup finds nothing", async () => {
  installGlobals({ sku: "999;6" });
  const { panel } = buildStatsPanel({ name: "Unknown Widget", baseName: "Unknown Widget" });
  global.document = makeDocument([panel]);

  statsPageQuickLinks();
  await flush();

  assert.equal(getQuickLink("posts.tf"), null);
  assert.ok(getQuickLink("gladiator.tf"));
  assert.ok(getQuickLink("mannco.store"));
  assert.ok(getQuickLink("pricedb.io"));
});

test("resolves an Unusual using the item's own data-priceindex as the effect id, no schema lookup needed", async () => {
  installGlobals({ sku: null });
  const { panel } = buildStatsPanel({ name: "Team Captain", baseName: "Team Captain", quality: 5, qName: "Unusual", priceindex: "12" });
  global.document = makeDocument([panel]);

  statsPageQuickLinks();
  await flush();

  // Effect 12 is "Massed Flies" (bundled table). gladiator.tf/pricedb.io
  // search the community "{Effect} {Item}" name - pricedb.io's exact-name
  // match can never find "Unusual Team Captain" - and stntrading.eu's/
  // mannco.store's links carry the effect too. All of these used to get the
  // bare "Unusual Team Captain", since a known effect id alone never yielded
  // the effect name.
  assert.equal(getQuickLink("gladiator.tf")?.href, "https://gladiator.tf/sales?item=Massed+Flies+Team+Captain");
  assert.equal(getQuickLink("stntrading.eu")?.href, "https://stntrading.eu/item/tf2/Unusual+Massed+Flies+Team+Captain");
  assert.equal(new URL(getQuickLink("mannco.store")?.href).searchParams.get("effect"), "Massed Flies");
  assert.equal(lastPricedbQuery, "Massed Flies Team Captain");
  // pricedb.io omitted - this test's own sendMessage mock returns no match.
  assert.equal(getQuickLink("pricedb.io"), null);
});

// A rate-limited lookup used to look IDENTICAL to "this item genuinely has
// no pricedb.io listing" here too - both just silently omitted the button.
// searchPricedbSkuStatus surfaces the real 429 (see utils/pricedb.js's own
// note) so this can show something instead.
test("REGRESSION: a real 429 turns pricedb.io's slot into the rate-limit countdown instead of silently omitting it", async () => {
  installGlobals({ pricedbRateLimited: true });
  const { panel } = buildStatsPanel();
  global.document = makeDocument([panel]);

  statsPageQuickLinks();
  await flush();

  assert.equal(getQuickLink("pricedb.io"), null);
  const countdown = getQuickLinks().find((el) => /Retrying automatically in \d+s/.test(el.title || ""));
  assert.ok(countdown, "expected the rate-limit countdown in pricedb.io's slot");
  assert.equal(countdown.tagName.toLowerCase(), "span"); // never a dead <a> with no href
});

// The rest of the row no longer waits for pricedb.io's lookup.
test("shows the row right away with a loading pricedb.io slot, then swaps in the link when the lookup answers", async () => {
  installGlobals();
  const { panel } = buildStatsPanel();
  global.document = makeDocument([panel]);
  const realSendMessage = globalThis.chrome.runtime.sendMessage;
  let answer;
  globalThis.chrome.runtime.sendMessage = (msg) => new Promise((resolve) => (answer = () => resolve(realSendMessage(msg))));
  try {
    statsPageQuickLinks();
    await flush();

    assert.ok(getQuickLink("gladiator.tf"), "the row must not wait for pricedb.io");
    const loading = getQuickLinks().find((el) => el.getAttribute("aria-busy") === "true");
    assert.ok(loading, "expected the loading pricedb.io slot");
    assert.match(loading.title, /Looking up this item on pricedb\.io/);

    answer();
    await flush();
    assert.ok(getQuickLink("pricedb.io")?.href?.startsWith("https://pricedb.io/item/"), "the slot becomes the real link");
  } finally {
    globalThis.chrome.runtime.sendMessage = realSendMessage;
  }
});

test("does not insert a row at all when the item element or its required data-* attributes aren't found", async () => {
  installGlobals();
  const panel = new FakeElement("div");
  panel.className = "stats-panel stats-header-panel";
  const body = new FakeElement("div");
  body.className = "stats-body";
  panel.appendChild(body);
  global.document = makeDocument([panel]);

  statsPageQuickLinks();
  await flush();

  assert.equal(getQuickLinksRow(), null);
});

test("does nothing when the page has no .stats-header-panel at all (not a /stats page)", async () => {
  installGlobals();
  global.document = makeDocument([]);

  await assert.doesNotReject(async () => {
    statsPageQuickLinks();
    await flush();
  });
  assert.equal(getQuickLinksRow(), null);
});

test("re-running for the SAME url doesn't duplicate the row (signature dedupe)", async () => {
  installGlobals();
  const { panel, body } = buildStatsPanel();
  global.document = makeDocument([panel]);

  statsPageQuickLinks();
  await flush();
  const countAfterFirst = body.children.length;

  FakeMutationObserver.instances[0].cb([{ addedNodes: [] }]);
  await flush();

  assert.equal(body.children.length, countAfterFirst);
  assert.equal(document.querySelectorAll(".tf2te-oldui-stats-quick-links-row").length, 1);
});

test("statsPageQuickLinks sets up a subtree MutationObserver on document.body", () => {
  installGlobals();
  global.document = makeDocument([]);

  statsPageQuickLinks();

  assert.equal(FakeMutationObserver.instances.length, 1);
  assert.equal(FakeMutationObserver.instances[0].target, document.body);
  assert.deepEqual(FakeMutationObserver.instances[0].opts, { childList: true, subtree: true });
});
