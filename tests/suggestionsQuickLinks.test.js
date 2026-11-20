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
              "Medi Gun": 211,
              "Rocket Launcher": 205,
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
let pricedbSku = "211;6";

const { suggestionsQuickLinks } = await import("../backpack.tf/nextUI/suggestionsQuickLinks/content.js");
const { __resetPricedbCacheForTests } = await import("../utils/pricedb.js");

// Same hand-rolled fake DOM every other tooltip/quick-links feature's own
// test file already uses (see tests/statsPageQuickLinks.test.js's own header
// comment) - duplicated rather than shared, matching this codebase's own
// per-test-file self-containment convention.

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
    this.children.push(child);
    child.parentElement = this;
    return child;
  }
  insertAdjacentElement(position, el) {
    if (position !== "afterend") throw new Error(`unsupported position: ${position}`);
    if (!this.parentElement) throw new Error("insertAdjacentElement: no parentElement");
    const siblings = this.parentElement.children;
    const idx = siblings.indexOf(this);
    siblings.splice(idx + 1, 0, el);
    el.parentElement = this.parentElement;
    return el;
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

function installGlobals({ href = "https://next.backpack.tf/suggestions/create?item=Medi+Gun&quality=Strange", sku = "211;6" } = {}) {
  global.window = { location: { href, pathname: new URL(href).pathname } };
  global.Node = { ELEMENT_NODE: 1 };
  global.MutationObserver = FakeMutationObserver;
  FakeMutationObserver.instances = [];
  lastPricedbQuery = null;
  pricedbSku = sku;
  __resetPricedbCacheForTests();
}

// Confirmed live shape: a parent wrapper div holding the ".editor" card
// (item preview + its own inner ".bg-card-inset" panel holding the
// dropdowns/toggles) - the quick-links row is appended as the LAST CHILD of
// that inset panel (see content.js's own header note on why: a sibling row
// after the whole card landed outside its dark rounded box entirely).
function buildEditorPage() {
  const parent = new FakeElement("div");

  const editor = new FakeElement("div");
  editor.className = "editor d-flex flex-row flex-nowrap rounded bg-card-background p-2";
  parent.appendChild(editor);

  const preview = new FakeElement("div");
  preview.className = "editor__item-preview d-flex align-items-center justify-content-center rounded me-2";
  editor.appendChild(preview);

  const inset = new FakeElement("div");
  inset.className = "bg-card-inset flex-grow-1 p-2 g-2";
  editor.appendChild(inset);

  const toggleRow = new FakeElement("div");
  toggleRow.className = "d-flex align-items-center";
  toggleRow.textContent = "Expand Recipe Tray toggle";
  inset.appendChild(toggleRow);

  return { parent, editor, inset, toggleRow };
}

function getWrap() {
  return document.querySelector(".tf2te-stats-controls");
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

test("adds snapshot (first), stntrading.eu, marketplace.tf, mannco.store, gladiator.tf, pricedb.io, and posts.tf buttons, inside the editor's own inset panel", async () => {
  installGlobals();
  const { editor, inset, toggleRow } = buildEditorPage();
  global.document = makeDocument([editor]);

  suggestionsQuickLinks();
  await flush();

  // First in the row.
  assert.equal(getQuickLinks()[0]?.textContent, "snapshot");
  assert.equal(getQuickLink("snapshot")?.href, "https://next.backpack.tf/classifieds/snapshots/Strange%20Medi%20Gun");
  assert.equal(getQuickLink("stntrading.eu")?.href, "https://stntrading.eu/item/tf2/Strange+Medi+Gun");
  assert.match(getQuickLink("marketplace.tf")?.href, /^https:\/\/marketplace\.tf\/browse\/tf2\?/);
  assert.ok(getQuickLink("mannco.store"));
  assert.equal(getQuickLink("gladiator.tf")?.href, "https://gladiator.tf/sales?item=Strange+Medi+Gun");
  assert.equal(getQuickLink("pricedb.io")?.href, "https://pricedb.io/item/211%3B6");
  assert.match(getQuickLink("posts.tf")?.href, /^https:\/\/posts\.tf\/posts\/search\/results\?q=/);

  // Appended as the last child of the inset panel (below the toggles),
  // staying visually inside the same card - not a sibling of the whole
  // editor, which ended up landing outside its box entirely.
  assert.deepEqual(inset.children, [toggleRow, getWrap()]);
  // Same 14px padding above the row as below it (margin-top zeroed out so
  // padding-top is the only thing setting the gap) - see content.js's own
  // header note.
  assert.equal(getWrap().style.paddingTop, "14px");
  assert.equal(getWrap().style.marginTop, "0");
});

// Unlike ../statsPageQuickLinks/content.js's own row, no tier switcher
// here at all.
test("never builds a Killstreak-tier switcher, even for a Killstreak-tiered weapon", async () => {
  installGlobals({ href: "https://next.backpack.tf/suggestions/create?item=Wrench&quality=Strange&killstreakTier=3", sku: null });
  const { editor } = buildEditorPage();
  global.document = makeDocument([editor]);

  suggestionsQuickLinks();
  await flush();

  assert.equal(document.querySelectorAll(".tf2te-stats-ks-tab").length, 0);
  // The killstreakTier param still feeds into link building, though.
  assert.equal(getQuickLink("gladiator.tf")?.href, "https://gladiator.tf/sales?item=Strange+Professional+Killstreak+Wrench");
});

// REGRESSION for a live bug report (see tests/statsPageQuickLinks.test.js's
// own matching test) - this page reuses resolveIdentityFromUrl wholesale, so
// the same fix applies here too.
test("resolves an Australium item using the URL's own australium=true param, embedding 'Australium ' into the built name", async () => {
  installGlobals({
    href: "https://next.backpack.tf/suggestions/create?item=Wrench&quality=Strange&killstreakTier=3&australium=true",
    sku: null,
  });
  const { editor } = buildEditorPage();
  global.document = makeDocument([editor]);

  suggestionsQuickLinks();
  await flush();

  assert.equal(
    getQuickLink("gladiator.tf")?.href,
    "https://gladiator.tf/sales?item=Strange+Professional+Killstreak+Australium+Wrench"
  );
  assert.match(getQuickLink("mannco.store")?.href, /search=Australium\+Wrench/);
});

// REGRESSION for a live confirmation ("killstreak items") - see
// tests/statsPageQuickLinks.test.js's own matching test for the full
// reasoning: a non-Unusual item's snapshot link is unaffected by the
// effect-name substitution, so it keeps the full quality+killstreak+
// Australium name unchanged.
test("snapshot uses the full quality+killstreak+Australium name for a non-Unusual item", async () => {
  installGlobals({
    href: "https://next.backpack.tf/suggestions/create?item=Eyelander&quality=Strange&killstreakTier=3&australium=true",
    sku: null,
  });
  const { editor } = buildEditorPage();
  global.document = makeDocument([editor]);

  suggestionsQuickLinks();
  await flush();

  assert.equal(
    getQuickLink("snapshot")?.href,
    "https://next.backpack.tf/classifieds/snapshots/Strange%20Professional%20Killstreak%20Australium%20Eyelander"
  );
});

// REGRESSION for a live bug report ("unusual snapshot links with effect
// name"): the snapshot button used to link with itemNameRaw's own literal
// "Unusual" word instead of the resolved effect name, unlike gladiator.tf/
// pricedb.io (which already got this fix) - confirmed live:
// "/classifieds/snapshots/Orbiting%20Planets%20Train%20of%20Thought", not
// "...Unusual%20Train%20of%20Thought".
test("snapshot uses the resolved effect name for an Unusual, same as gladiator.tf/pricedb.io", async () => {
  installGlobals({ href: "https://next.backpack.tf/suggestions/create?item=Train+of+Thought&quality=Unusual&priceindex=32", sku: null });
  const { editor } = buildEditorPage();
  global.document = makeDocument([editor]);

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

    suggestionsQuickLinks();
    await flush();

    assert.equal(
      getQuickLink("snapshot")?.href,
      "https://next.backpack.tf/classifieds/snapshots/Orbiting%20Planets%20Train%20of%20Thought"
    );
    assert.equal(getQuickLink("gladiator.tf")?.href, "https://gladiator.tf/sales?item=Orbiting+Planets+Train+of+Thought");
  } finally {
    globalThis.chrome.storage.local.get = originalGet;
    const { __resetSchemaCacheForTests } = await import("../utils/tf2Schema.js");
    __resetSchemaCacheForTests();
  }
});

test("does nothing on any page other than /suggestions/create, even with a matching item/quality URL", async () => {
  installGlobals({ href: "https://next.backpack.tf/stats?item=Medi+Gun&quality=Strange" });
  const { editor } = buildEditorPage();
  global.document = makeDocument([editor]);

  suggestionsQuickLinks();
  await flush();

  assert.equal(getQuickLinksRow(), null);
});

test("does nothing when the page has no item editor at all", async () => {
  installGlobals();
  global.document = makeDocument([]);

  await assert.doesNotReject(async () => {
    suggestionsQuickLinks();
    await flush();
  });
  assert.equal(getQuickLinksRow(), null);
});

test("does not insert a row when the URL is missing item/quality (not this feature's scope)", async () => {
  installGlobals({ href: "https://next.backpack.tf/suggestions/create" });
  const { editor, inset, toggleRow } = buildEditorPage();
  global.document = makeDocument([editor]);

  suggestionsQuickLinks();
  await flush();

  assert.equal(getQuickLinksRow(), null);
  assert.deepEqual(inset.children, [toggleRow]);
});

test("re-running for the SAME url doesn't duplicate the row (signature dedupe)", async () => {
  installGlobals();
  const { editor, inset } = buildEditorPage();
  global.document = makeDocument([editor]);

  suggestionsQuickLinks();
  await flush();
  const countAfterFirst = inset.children.length;

  FakeMutationObserver.instances[0].cb([{ addedNodes: [] }]);
  await flush();

  assert.equal(inset.children.length, countAfterFirst);
  assert.equal(document.querySelectorAll(".tf2te-stats-quick-links-row").length, 1);
});

test("navigating to a different item's suggestion form (URL changes, same SPA, no reload) rebuilds the row for the new item", async () => {
  installGlobals({ href: "https://next.backpack.tf/suggestions/create?item=Medi+Gun&quality=Strange", sku: "211;6" });
  const { editor } = buildEditorPage();
  global.document = makeDocument([editor]);

  suggestionsQuickLinks();
  await flush();
  assert.equal(getQuickLink("gladiator.tf")?.href, "https://gladiator.tf/sales?item=Strange+Medi+Gun");

  window.location.href = "https://next.backpack.tf/suggestions/create?item=Rocket+Launcher&quality=Unique";
  window.location.pathname = "/suggestions/create";
  pricedbSku = "205;6";

  FakeMutationObserver.instances[0].cb([{ addedNodes: [] }]);
  await flush();

  assert.equal(getQuickLink("gladiator.tf")?.href, "https://gladiator.tf/sales?item=Rocket+Launcher");
  assert.equal(document.querySelectorAll(".tf2te-stats-quick-links-row").length, 1);
});

test("suggestionsQuickLinks sets up a subtree MutationObserver on document.body", () => {
  installGlobals();
  global.document = makeDocument([]);

  suggestionsQuickLinks();

  assert.equal(FakeMutationObserver.instances.length, 1);
  assert.equal(FakeMutationObserver.instances[0].target, document.body);
  assert.deepEqual(FakeMutationObserver.instances[0].opts, { childList: true, subtree: true });
});
