import { test } from "node:test";
import assert from "node:assert/strict";

// See tests/statsPageQuickLinksOldUI.test.js's own header comment - same
// fixture shape, this feature reuses that file's own STN href builder/style
// injection wholesale.
globalThis.chrome = {
  storage: {
    local: {
      async get() {
        return {
          tf2SchemaCache: {
            itemNameToDefindex: {
              Blutsauger: 36,
              "Mann Co. Supply Crate Key": 5021,
              "Train of Thought": 31254,
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

let pricedbSku = "36;3";
let pricedbRateLimited = false;
let lastPricedbQuery = null;

const { suggestionsQuickLinks } = await import("../backpack.tf/oldUI/suggestionsQuickLinks/content.js");
const { __resetPricedbCacheForTests } = await import("../utils/pricedb.js");

// Same hand-rolled fake DOM every other quick-links test file in this repo
// already uses (see tests/statsPageQuickLinksOldUI.test.js's own header
// comment).

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

function installGlobals({
  href = "https://backpack.tf/vote/Vintage/Blutsauger/Tradable/Craftable",
  sku = "36;3",
  pricedbRateLimited: rateLimited = false,
} = {}) {
  global.window = { location: { href, pathname: new URL(href).pathname } };
  global.Node = { ELEMENT_NODE: 1 };
  global.MutationObserver = FakeMutationObserver;
  FakeMutationObserver.instances = [];
  pricedbSku = sku;
  pricedbRateLimited = rateLimited;
  lastPricedbQuery = null;
  __resetPricedbCacheForTests();
}

// Confirmed live shape: https://backpack.tf/vote/Vintage/Blutsauger/Tradable/Craftable
// .item-panel > (.item-singular > .item[data-*], #item-panel-name > h2).
function buildVotePage({
  name = "Blutsauger",
  baseName = "Blutsauger",
  quality = 3,
  qName = "Vintage",
  priceindex = "0",
} = {}) {
  const panel = new FakeElement("div");
  panel.className = "item-panel";

  const itemSingular = new FakeElement("ul");
  itemSingular.className = "item-singular";
  panel.appendChild(itemSingular);

  const item = new FakeElement("li");
  item.className = "item q-440-3 q-440-border-3";
  item.setAttribute("data-name", name);
  item.setAttribute("data-base_name", baseName);
  item.setAttribute("data-quality", String(quality));
  item.setAttribute("data-q_name", qName);
  item.setAttribute("data-priceindex", priceindex);
  item.setAttribute("data-craftable", "1");
  item.setAttribute("data-tradable", "1");
  itemSingular.appendChild(item);

  const nameBlock = new FakeElement("div");
  nameBlock.id = "item-panel-name";
  const h2 = new FakeElement("h2");
  h2.textContent = `${qName} ${baseName}`;
  nameBlock.appendChild(h2);
  panel.appendChild(nameBlock);

  return { panel, nameBlock };
}

// Confirmed live shape: https://backpack.tf/suggestion/6a8008ebe414a22bb907b6ab
// .suggestion.sg-base > .main > .body > (.header, .item[data-*]) - the item
// is a SIBLING of .header, not wrapped in a ".item-singular" the way /vote's
// own item is.
function buildSuggestionDetailPage({
  name = "Train of Thought",
  baseName = "Train of Thought",
  quality = 5,
  qName = "Unusual",
  priceindex = "32",
  effectName = "Orbiting Planets",
} = {}) {
  const suggestion = new FakeElement("div");
  suggestion.className = "suggestion sg-base";

  const main = new FakeElement("div");
  main.className = "main";
  suggestion.appendChild(main);

  const body = new FakeElement("div");
  body.className = "body";
  main.appendChild(body);

  const header = new FakeElement("div");
  header.className = "header";
  header.textContent = `${qName} ${baseName} ${effectName}`;
  body.appendChild(header);

  const item = new FakeElement("div");
  item.className = "item q-440-5 q-440-border-5";
  item.setAttribute("data-name", name);
  item.setAttribute("data-base_name", baseName);
  item.setAttribute("data-quality", String(quality));
  item.setAttribute("data-q_name", qName);
  item.setAttribute("data-priceindex", priceindex);
  item.setAttribute("data-craftable", "1");
  item.setAttribute("data-tradable", "1");
  if (effectName) item.setAttribute("data-effect_name", effectName);
  body.appendChild(item);

  return { suggestion, main, body, header, item };
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

test("adds snapshot (first, linking to next.backpack.tf since classic has no snapshots page), stntrading.eu, marketplace.tf, mannco.store, gladiator.tf, pricedb.io, and posts.tf buttons, reading identity off the item's own data-* attributes", async () => {
  installGlobals();
  const { panel, nameBlock } = buildVotePage();
  global.document = makeDocument([panel]);

  suggestionsQuickLinks();
  await flush();

  assert.equal(getQuickLinks()[0]?.textContent, "snapshot");
  assert.equal(getQuickLink("snapshot")?.href, "https://next.backpack.tf/classifieds/snapshots/Vintage%20Blutsauger");
  assert.equal(getQuickLink("stntrading.eu")?.href, "https://stntrading.eu/item/tf2/Vintage+Blutsauger");
  assert.match(getQuickLink("marketplace.tf")?.href, /^https:\/\/marketplace\.tf\/browse\/tf2\?/);
  assert.ok(getQuickLink("mannco.store"));
  assert.equal(getQuickLink("gladiator.tf")?.href, "https://gladiator.tf/sales?item=Vintage+Blutsauger");
  assert.equal(getQuickLink("pricedb.io")?.href, "https://pricedb.io/item/36%3B3");
  assert.match(getQuickLink("posts.tf")?.href, /^https:\/\/posts\.tf\/posts\/search\/results\?q=/);

  // Appended as the last child of .item-panel, staying visually inside the
  // same box - not a sibling landing outside it.
  const wrap = document.querySelector(".tf2te-oldui-stats-controls");
  assert.deepEqual(panel.children, [panel.children[0], nameBlock, wrap]);
  // Same 10px padding above the row as below it (the shared style's own
  // 14px bottom padding is overridden here) - see content.js's own header
  // note.
  assert.equal(wrap.style.paddingBottom, "10px");
});

test("does nothing on any page other than /vote/..., even with a matching item panel present", async () => {
  installGlobals({ href: "https://backpack.tf/stats/Vintage/Blutsauger/Tradable/Craftable" });
  const { panel } = buildVotePage();
  global.document = makeDocument([panel]);

  suggestionsQuickLinks();
  await flush();

  assert.equal(getQuickLinksRow(), null);
});

test("does nothing when the page has no .item-panel at all", async () => {
  installGlobals();
  global.document = makeDocument([]);

  await assert.doesNotReject(async () => {
    suggestionsQuickLinks();
    await flush();
  });
  assert.equal(getQuickLinksRow(), null);
});

test("does not insert a row when the item element or its required data-* attributes aren't found", async () => {
  installGlobals();
  const panel = new FakeElement("div");
  panel.className = "item-panel";
  global.document = makeDocument([panel]);

  suggestionsQuickLinks();
  await flush();

  assert.equal(getQuickLinksRow(), null);
});

test("resolves an Unusual using the item's own data-priceindex as the effect id, no schema lookup needed", async () => {
  installGlobals({ sku: null });
  const { panel } = buildVotePage({ name: "Team Captain", baseName: "Team Captain", quality: 5, qName: "Unusual", priceindex: "12" });
  global.document = makeDocument([panel]);

  suggestionsQuickLinks();
  await flush();

  // /vote's item element carries no data-effect_name, so the name comes from
  // the effect id (12 = "Massed Flies", bundled table); it used to fall back
  // to the bare "Unusual Team Captain", and mannco.store got no effect at all.
  assert.equal(getQuickLink("gladiator.tf")?.href, "https://gladiator.tf/sales?item=Massed+Flies+Team+Captain");
  assert.equal(new URL(getQuickLink("mannco.store")?.href).searchParams.get("effect"), "Massed Flies");
  assert.equal(lastPricedbQuery, "Massed Flies Team Captain");
  assert.equal(getQuickLink("pricedb.io"), null);
});

// REGRESSION for a live follow-up request ("can we have all that on that
// suggestion address too?") - a single suggestion's own detail page
// (/suggestion/{id}), a genuinely different markup shape from /vote (see
// content.js's own findInsertionTarget note): the item element is a SIBLING
// of .header inside .body, not wrapped in .item-singular. Appending inside
// ".body" itself (an earlier version of this file did that) squeezed the
// row in as a THIRD item next to the header/item icon (".body" is a flex
// row laying those two out side by side), instead of stacking below the
// whole "12 keys"/vote-count line. Appended into ".main" instead (one level up
// - see content.js's own findInsertionTarget note) so it lands as its own
// full-width block below ".body" entirely.
test("adds the same buttons on a /suggestion/{id} page too, appended into .main (below .body, not squeezed inside its own flex row)", async () => {
  installGlobals({ href: "https://backpack.tf/suggestion/6a8008ebe414a22bb907b6ab", sku: "31254;5;u32" });
  const { suggestion, main, body, header, item } = buildSuggestionDetailPage();
  global.document = makeDocument([suggestion]);

  suggestionsQuickLinks();
  await flush();

  assert.equal(getQuickLinks()[0]?.textContent, "snapshot");
  assert.ok(getQuickLink("stntrading.eu"));
  assert.ok(getQuickLink("mannco.store"));
  assert.match(getQuickLink("posts.tf")?.href ?? "", /^https:\/\/posts\.tf\/posts\/search\/results\?q=/);

  const wrap = document.querySelector(".tf2te-oldui-stats-controls");
  assert.deepEqual(body.children, [header, item]); // untouched - still just the two flex items
  assert.deepEqual(main.children, [body, wrap]);
});

// REGRESSION for the same follow-up request: /suggestion/{id}'s own item
// element carries data-effect_name directly (confirmed live: "Orbiting
// Planets" for an "Unusual Train of Thought") - gladiator.tf/pricedb.io
// should search the trading community's own "{Effect} {Item}" convention
// with it, not Steam's raw "Unusual {Item}" text, with no schema lookup
// needed at all (unlike /vote's own item element, which doesn't carry this
// attribute and falls back to the plain name - see the "resolves an Unusual
// using the item's own data-priceindex..." test above).
test("uses the item element's own data-effect_name to search gladiator.tf/pricedb.io/snapshot with the trading community's own '{Effect} {Item}' convention", async () => {
  installGlobals({ href: "https://backpack.tf/suggestion/6a8008ebe414a22bb907b6ab", sku: "31254;5;u32" });
  const { suggestion } = buildSuggestionDetailPage();
  global.document = makeDocument([suggestion]);

  suggestionsQuickLinks();
  await flush();

  assert.equal(getQuickLink("gladiator.tf")?.href, "https://gladiator.tf/sales?item=Orbiting+Planets+Train+of+Thought");
  assert.equal(getQuickLink("pricedb.io")?.href, "https://pricedb.io/item/31254%3B5%3Bu32");
  assert.equal(lastPricedbQuery, "Orbiting Planets Train of Thought");
  // REGRESSION for a live bug report ("unusual snapshot links with effect
  // name"): confirmed live "/classifieds/snapshots/Orbiting%20Planets%20
  // Train%20of%20Thought", not "...Unusual%20Train%20of%20Thought".
  assert.equal(
    getQuickLink("snapshot")?.href,
    "https://next.backpack.tf/classifieds/snapshots/Orbiting%20Planets%20Train%20of%20Thought"
  );
});

test("re-running for the SAME url doesn't duplicate the row (signature dedupe)", async () => {
  installGlobals();
  const { panel } = buildVotePage();
  global.document = makeDocument([panel]);

  suggestionsQuickLinks();
  await flush();
  const countAfterFirst = panel.children.length;

  FakeMutationObserver.instances[0].cb([{ addedNodes: [] }]);
  await flush();

  assert.equal(panel.children.length, countAfterFirst);
  assert.equal(document.querySelectorAll(".tf2te-oldui-stats-quick-links-row").length, 1);
});

test("suggestionsQuickLinks sets up a subtree MutationObserver on document.body", () => {
  installGlobals();
  global.document = makeDocument([]);

  suggestionsQuickLinks();

  assert.equal(FakeMutationObserver.instances.length, 1);
  assert.equal(FakeMutationObserver.instances[0].target, document.body);
  assert.deepEqual(FakeMutationObserver.instances[0].opts, { childList: true, subtree: true });
});

// Real tile pasted live from a /suggestion/{id} page: data-base_name is the
// bare tool, data-target_item the weapon. Every link used to search just
// "Strangifier" (pricedb.io even landed on 6522;255;td-25000).
test("REGRESSION: a Strangifier's links search the full item ('{target} Strangifier' from data-target_item), not the bare word 'Strangifier'", async () => {
  installGlobals({ href: "https://backpack.tf/suggestion/6ac1978a6d97860fc206a879", sku: "6522;6;td-751" });
  const { suggestion, item } = buildSuggestionDetailPage({ name: "Strangifier", baseName: "Strangifier", quality: 6, qName: "Unique", priceindex: "751", effectName: null });
  item.setAttribute("data-target_item", "Cleaner's Carbine");
  global.document = makeDocument([suggestion]);

  suggestionsQuickLinks();
  await flush();

  assert.equal(lastPricedbQuery, "Cleaner's Carbine Strangifier");
  assert.equal(getQuickLink("pricedb.io")?.href, "https://pricedb.io/item/6522%3B6%3Btd-751");
  assert.equal(getQuickLink("snapshot")?.href, "https://next.backpack.tf/classifieds/snapshots/Cleaner's%20Carbine%20Strangifier");
  assert.equal(getQuickLink("gladiator.tf")?.href, "https://gladiator.tf/sales?item=Cleaner%27s+Carbine+Strangifier");
  assert.equal(getQuickLink("stntrading.eu")?.href, "https://stntrading.eu/item/tf2/Cleaner's+Carbine+Strangifier");
  for (const label of ["snapshot", "stntrading.eu", "marketplace.tf", "mannco.store", "gladiator.tf"]) {
    const href = getQuickLink(label)?.href ?? "";
    assert.ok(href, `${label} should be present`);
    assert.match(decodeURIComponent(href.replace(/\+/g, " ")), /Cleaner's Carbine/, `${label} should name the target weapon: ${href}`);
  }
});
