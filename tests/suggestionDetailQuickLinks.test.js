import { test } from "node:test";
import assert from "node:assert/strict";

// See tests/statsPageQuickLinks.test.js's own header comment - same fixture
// shape, this feature reuses that file's own identity resolution/button
// builders wholesale.
globalThis.chrome = {
  storage: {
    local: {
      async get() {
        return {
          tf2SchemaCache: {
            itemNameToDefindex: {
              "Rocket Launcher": 205,
              "Train of Thought": 31254,
              "Pretty Boy's Pocket Pistol": 773,
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
    onChanged: { addListener() {} },
  },
  runtime: {
    getURL: (path) => path,
    async sendMessage(msg) {
      const url = new URL(msg.url);
      if (!url.hostname.includes("pricedb.io")) {
        throw new Error(`unexpected sendMessage: ${msg.url}`);
      }
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

let lastPricedbQuery = null;
let pricedbSku = "205;6";

const { suggestionDetailQuickLinks } = await import("../backpack.tf/nextUI/suggestionDetailQuickLinks/content.js");
const { __resetPricedbCacheForTests } = await import("../utils/pricedb.js");

// Same hand-rolled fake DOM every other quick-links test file in this repo
// already uses (see tests/statsPageQuickLinks.test.js's own header comment).

function parseCompound(selector) {
  const classes = [...selector.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
  const tagMatch = /^[a-zA-Z][\w-]*/.exec(selector);
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

function installGlobals({ href = "https://next.backpack.tf/suggestions/6a8008ebe414a22bb907b6ab", sku = "205;6" } = {}) {
  global.window = { location: { href, pathname: new URL(href).pathname } };
  global.Node = { ELEMENT_NODE: 1 };
  global.MutationObserver = FakeMutationObserver;
  FakeMutationObserver.instances = [];
  lastPricedbQuery = null;
  pricedbSku = sku;
  __resetPricedbCacheForTests();
}

// Confirmed live shape: https://next.backpack.tf/suggestions/6a8008ebe414a22bb907b6ab
// .card > (.card__header > .card__header__title, .card__content > (a row
// holding the vote buttons + the item preview anchor itself, .card__footer)).
function buildSuggestionDetailPage({
  itemName = "Train of Thought",
  qualityName = "Unusual",
  priceindex = "32",
  titleText = "Orbiting Planets Train of Thought",
} = {}) {
  const card = new FakeElement("div");
  card.className = "card";

  const header = new FakeElement("div");
  header.className = "card__header px-3 d-flex justify-content-between";
  const title = new FakeElement("div");
  title.className = "card__header__title";
  title.textContent = titleText;
  header.appendChild(title);
  card.appendChild(header);

  const content = new FakeElement("div");
  content.className = "card__content";
  card.appendChild(content);

  const itemRow = new FakeElement("div");
  itemRow.className = "p-3 d-flex justify-content-between align-items-start";
  content.appendChild(itemRow);

  const itemAnchor = new FakeElement("a");
  itemAnchor.className = "item item__quality-440-5-dark p-440-5 col-auto";
  const params = new URLSearchParams({ item: itemName, quality: qualityName });
  if (priceindex) params.set("priceindex", priceindex);
  itemAnchor.setAttribute("href", `/stats?${params.toString()}`);
  itemRow.appendChild(itemAnchor);

  const footer = new FakeElement("div");
  footer.className = "card__footer";
  footer.textContent = "This suggestion is currently open to voting.";
  content.appendChild(footer);

  return { card, header, title, content, itemRow, itemAnchor, footer };
}

function getQuickLinksRow() {
  return document.querySelector(".tf2te-stats-quick-links-row");
}

function getQuickLinks() {
  return getQuickLinksRow()?.querySelectorAll(".tf2te-stats-quick-link-button") ?? [];
}

function getQuickLink(label) {
  return getQuickLinks().find((link) => link.textContent === label) || null;
}

test("adds snapshot (first), stntrading.eu, marketplace.tf, mannco.store, gladiator.tf, pricedb.io, and posts.tf buttons, resolving identity off the item anchor's own href", async () => {
  installGlobals();
  const { card, content, footer } = buildSuggestionDetailPage();
  global.document = makeDocument([card]);

  suggestionDetailQuickLinks();
  await flush();

  assert.equal(getQuickLinks()[0]?.textContent, "snapshot");
  // This used to assert the literal "Unusual" word stayed unsubstituted
  // here - this file's own default schema fixture has no live
  // effectNameToId entries, but priceindex=32 (this page's default fixture,
  // see buildSuggestionDetailPage) IS "Orbiting Planets" in
  // utils/unusualEffectIds.js's own static table, which
  // utils/tf2Schema.js's own getEffectNameToIdMap now merges in
  // unconditionally - resolves correctly with no live schema/API key needed
  // at all now, same as the dedicated "resolves the effect name..." test
  // further down (which supplies an explicit, now-redundant, live schema
  // entry for the same effect).
  assert.equal(
    getQuickLink("snapshot")?.href,
    "https://next.backpack.tf/classifieds/snapshots/Orbiting%20Planets%20Train%20of%20Thought"
  );
  assert.ok(getQuickLink("stntrading.eu"));
  assert.ok(getQuickLink("mannco.store"));
  assert.equal(getQuickLink("gladiator.tf")?.href, "https://gladiator.tf/sales?item=Orbiting+Planets+Train+of+Thought");
  assert.match(getQuickLink("posts.tf")?.href ?? "", /^https:\/\/posts\.tf\/posts\/search\/results\?q=/);

  // Appended as the last child of .card__content, after the footer.
  const wrap = document.querySelector(".tf2te-stats-controls");
  assert.deepEqual(content.children.slice(-2), [footer, wrap]);
});

// Confirmed live (https://next.backpack.tf/suggestions/6ac19606f817bfe3450be893):
// a Strangifier's item link is "/stats?item=Strangifier&quality=Unique&
// priceindex=773" (the target only as a defindex), and the card title holds
// the full name in its own <span>, next to an empty subtitle <span>.
test("REGRESSION: a Strangifier suggestion's links use the full name from the card title, not the bare 'Strangifier'", async () => {
  installGlobals({ href: "https://next.backpack.tf/suggestions/6ac19606f817bfe3450be893" });
  const { card, title } = buildSuggestionDetailPage({ itemName: "Strangifier", qualityName: "Unique", priceindex: "773", titleText: "" });
  const nameSpan = new FakeElement("span");
  nameSpan.textContent = "Pretty Boy's Pocket Pistol Strangifier";
  title.appendChild(nameSpan);
  const subtitle = new FakeElement("span");
  subtitle.className = "card__header__subtitle";
  title.appendChild(subtitle);
  global.document = makeDocument([card]);

  suggestionDetailQuickLinks();
  await flush();

  assert.equal(getQuickLink("snapshot")?.href, "https://next.backpack.tf/classifieds/snapshots/Pretty%20Boy's%20Pocket%20Pistol%20Strangifier");
  assert.equal(getQuickLink("stntrading.eu")?.href, "https://stntrading.eu/item/tf2/Pretty+Boy's+Pocket+Pistol+Strangifier");
  assert.match(getQuickLink("marketplace.tf")?.href ?? "", /sterm=Pretty\+Boy%27s\+Pocket\+Pistol\+Strangifier$/);
  // The tooltip's confirmed-live target-tool shape: the full name alone.
  assert.equal(getQuickLink("mannco.store")?.href, "https://mannco.store/tf2?search=Pretty+Boy%27s+Pocket+Pistol+Strangifier");
  assert.equal(getQuickLink("gladiator.tf")?.href, "https://gladiator.tf/sales?item=Pretty+Boy%27s+Pocket+Pistol+Strangifier");
  assert.equal(lastPricedbQuery, "Pretty Boy's Pocket Pistol Strangifier");
});

test("resolves the effect name off the priceindex via the schema, no data-effect_name needed here (unlike classic's own /suggestion/{id})", async () => {
  installGlobals();
  const originalGet = globalThis.chrome.storage.local.get;
  globalThis.chrome.storage.local.get = async () => ({
    tf2SchemaCache: {
      itemNameToDefindex: {},
      defindexToItemName: {},
      effectNameToId: { "Orbiting Planets": 32 },
      fetchedAt: Date.now(),
      schemaShapeVersion: 4,
    },
  });

  try {
    const { __resetSchemaCacheForTests } = await import("../utils/tf2Schema.js");
    __resetSchemaCacheForTests();

    const { card } = buildSuggestionDetailPage();
    global.document = makeDocument([card]);

    suggestionDetailQuickLinks();
    await flush();

    assert.equal(getQuickLink("gladiator.tf")?.href, "https://gladiator.tf/sales?item=Orbiting+Planets+Train+of+Thought");
    assert.equal(lastPricedbQuery, "Orbiting Planets Train of Thought");
  } finally {
    globalThis.chrome.storage.local.get = originalGet;
    const { __resetSchemaCacheForTests } = await import("../utils/tf2Schema.js");
    __resetSchemaCacheForTests();
  }
});

test("does nothing on /suggestions/create - that page has its own dedicated feature", async () => {
  installGlobals({ href: "https://next.backpack.tf/suggestions/create?item=Rocket+Launcher&quality=Unique" });
  const { card } = buildSuggestionDetailPage();
  global.document = makeDocument([card]);

  suggestionDetailQuickLinks();
  await flush();

  assert.equal(getQuickLinksRow(), null);
});

test("does nothing on any other page, even with a matching item anchor present", async () => {
  installGlobals({ href: "https://next.backpack.tf/stats?item=Rocket+Launcher&quality=Unique" });
  const { card } = buildSuggestionDetailPage();
  global.document = makeDocument([card]);

  suggestionDetailQuickLinks();
  await flush();

  assert.equal(getQuickLinksRow(), null);
});

test("does nothing when the page has no item preview anchor at all", async () => {
  installGlobals();
  global.document = makeDocument([]);

  await assert.doesNotReject(async () => {
    suggestionDetailQuickLinks();
    await flush();
  });
  assert.equal(getQuickLinksRow(), null);
});

test("re-running for the SAME url doesn't duplicate the row (signature dedupe)", async () => {
  installGlobals();
  const { card, content } = buildSuggestionDetailPage();
  global.document = makeDocument([card]);

  suggestionDetailQuickLinks();
  await flush();
  const countAfterFirst = content.children.length;

  FakeMutationObserver.instances[0].cb([{ addedNodes: [] }]);
  await flush();

  assert.equal(content.children.length, countAfterFirst);
  assert.equal(document.querySelectorAll(".tf2te-stats-quick-links-row").length, 1);
});

test("suggestionDetailQuickLinks sets up a subtree MutationObserver on document.body", () => {
  installGlobals();
  global.document = makeDocument([]);

  suggestionDetailQuickLinks();

  assert.equal(FakeMutationObserver.instances.length, 1);
  assert.equal(FakeMutationObserver.instances[0].target, document.body);
  assert.deepEqual(FakeMutationObserver.instances[0].opts, { childList: true, subtree: true });
});
