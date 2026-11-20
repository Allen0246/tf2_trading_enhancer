import { test } from "node:test";
import assert from "node:assert/strict";

// See tests/tf2StatsLinksIndex.test.js's own header comment: utils/tf2Schema.js
// memoizes its result at module scope for this file's lifetime, so a single
// pre-seeded fixture installed before import (not per-test) is the right
// shape. Unlike marketplace.tf/mannco.store/gladiator.tf/pricedb.io (which
// all search by name, needing no defindex at all), posts.tf needs a real
// Valve defindex per item - see utils/tf2StatsLinks/index.js's own
// buildPostsTfLink - so itemNameToDefindex has to actually cover every item
// name these tests use.
// Whether a Steam Web API key is "saved" (utils/linkButtonStates.js's
// postsTfNeedsApiKey reads it); flipped per test.
let savedSteamApiKey = null;
const sentMessages = [];
globalThis.chrome = {
  storage: {
    local: {
      async get() {
        return {
          ...(savedSteamApiKey ? { steamApiKey: savedSteamApiKey } : {}),
          tf2SchemaCache: {
            itemNameToDefindex: {
              "Reclaimed Metal": 143,
              "Rocket Launcher": 205,
              "Bazaar Bargain": 730,
              "Team Captain": 378,
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
  },
  runtime: {
    getURL: (path) => path,
    async sendMessage(message) {
      sentMessages.push(message);
      if (message?.type === "OPEN_STEAM_API_KEY_SETTINGS") return undefined;
      throw new Error("should not need a real fetch - schema cache is pre-seeded and fresh");
    },
  },
};
globalThis.fetch = async () => ({ json: async () => [] });

const { addPostsTfButton } = await import("../backpack.tf/oldUI/addPostsTfButton/content.js");

// Same hand-rolled fake DOM as tests/addMarketplaceButtonOldUI.test.js (see
// that file's own header comment for why this repo hand-rolls this instead
// of pulling in jsdom).

function parseCompound(selector) {
  const attrSubMatch = /\[([\w-]+)\*="([^"]*)"\]/.exec(selector);
  const rest = selector.replace(/\[[^\]]*\]/g, "");
  const idMatch = /#([\w-]+)/.exec(rest);
  const classes = [...rest.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
  const tagMatch = /^[a-zA-Z][\w-]*/.exec(rest);
  return {
    tag: tagMatch ? tagMatch[0].toLowerCase() : null,
    id: idMatch ? idMatch[1] : null,
    classes,
    attrSub: attrSubMatch ? { name: attrSubMatch[1], value: attrSubMatch[2] } : null,
  };
}

function matchesCompound(el, parsed) {
  if (!el || el.nodeType !== 1) return false;
  if (parsed.tag && el.tagName.toLowerCase() !== parsed.tag) return false;
  if (parsed.id && el.getAttribute("id") !== parsed.id) return false;
  if (!parsed.classes.every((c) => el.classList.contains(c))) return false;
  if (parsed.attrSub) {
    const v = el.getAttribute(parsed.attrSub.name);
    if (!v || !v.includes(parsed.attrSub.value)) return false;
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
    this.isConnected = true;
    this.style = {};
    this.dataset = {};
    const classSet = new Set();
    this.classList = {
      contains: (c) => classSet.has(c),
      add: (...cs) => cs.forEach((c) => classSet.add(c)),
    };
  }
  get textContent() {
    if (this.children.length > 0) return this.children.map((c) => c.textContent || "").join("");
    return this._textContent || "";
  }
  set textContent(v) {
    // Like the real DOM: replaces every child with one text node.
    this._textContent = v;
    this.children = v ? [fakeTextNode(v)] : [];
  }
  append(...nodes) {
    for (const node of nodes) {
      if (typeof node === "string") this.children.push(fakeTextNode(node));
      else this.appendChild(node);
    }
  }
  removeAttribute(name) {
    delete this._attrs[name];
  }
  addEventListener(type, fn) {
    (this._listeners ||= {})[type] ||= [];
    this._listeners[type].push(fn);
  }
  dispatchEvent(event) {
    for (const fn of this._listeners?.[event.type] || []) fn({ currentTarget: this, preventDefault() {}, stopPropagation() {}, ...event });
    return true;
  }
  get className() {
    return this._attrs.class || "";
  }
  set className(v) {
    this._attrs.class = v;
    (v || "").split(/\s+/).filter(Boolean).forEach((c) => this.classList.add(c));
  }
  getAttribute(name) {
    return name in this._attrs ? this._attrs[name] : null;
  }
  setAttribute(name, value) {
    this._attrs[name] = value;
    if (name === "class") (value || "").split(/\s+/).filter(Boolean).forEach((c) => this.classList.add(c));
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
  insertBefore(newNode, referenceNode) {
    const idx = this.children.indexOf(referenceNode);
    this.children.splice(idx === -1 ? this.children.length : idx, 0, newNode);
    newNode.parentElement = this;
    return newNode;
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

function fakeTextNode(text) {
  return { nodeType: 3, textContent: String(text), children: [] };
}

function makeDocument(rootChildren = []) {
  const body = new FakeElement("body");
  for (const c of rootChildren) body.appendChild(c);
  return {
    body,
    createElement: (tag) => new FakeElement(tag),
    createElementNS: (_ns, tag) => new FakeElement(tag),
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

function installGlobals() {
  global.window = { location: { href: "https://backpack.tf/classifieds" } };
  global.Node = { ELEMENT_NODE: 1 };
  global.MutationObserver = FakeMutationObserver;
  FakeMutationObserver.instances = [];
}

function getPostsTfButton(root) {
  return root.querySelector(".tf2te-posts-tf-button");
}

// Decodes a posts.tf search URL's own "q" param the same way
// utils/tf2StatsLinks/index.js's buildPostsTfLink encodes it - see
// tests/tf2StatsLinksIndex.test.js's own decodePostsTfQuery.
function decodePostsTfQuery(href) {
  const b64 = new URL(href).searchParams.get("q");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
}

// Same shape confirmed live in the popover's own "#popover-search-links"
// row: <a href="/classifieds?item=...&quality=...&tradable=1&craftable=1&
// australium=-1&particle=94&killstreak_tier=0">.
function buildClassifiedsAnchor(itemName, { quality = 6, craftable = "1", australium = "-1", killstreakTier = 0, particle = null } = {}) {
  const anchor = new FakeElement("a");
  const params = new URLSearchParams({
    item: itemName,
    quality: String(quality),
    tradable: "1",
    craftable,
    australium,
    killstreak_tier: String(killstreakTier),
  });
  if (particle != null) params.set("particle", String(particle));
  anchor.setAttribute("href", `/classifieds?${params.toString()}`);
  return anchor;
}

function buildItemDetailsDd(text) {
  const dd = new FakeElement("dd");
  dd.textContent = text;
  return dd;
}

function buildPaintDd(paintName) {
  const dd = new FakeElement("dd");
  const span = new FakeElement("span");
  span.className = "label label-paint";
  span.textContent = paintName;
  dd.appendChild(span);
  return dd;
}

// Same full popover shell tests/addMarketplaceButtonOldUI.test.js's own
// buildPopover documents.
function buildPopover({
  itemName = "Reclaimed Metal",
  quality = 6,
  craftable = "1",
  australium = "-1",
  killstreakTier = 0,
  particle = null,
  spellLine,
  spellTypeLabel = "Footsteps Spell",
  paintLine,
} = {}) {
  const content = new FakeElement("div");
  content.className = "popover-content";

  if (spellLine) content.appendChild(buildItemDetailsDd(`${spellTypeLabel}: ${spellLine}`));
  if (paintLine) content.appendChild(buildPaintDd(paintLine));

  const searchLinks = new FakeElement("dd");
  searchLinks.setAttribute("id", "popover-search-links");
  searchLinks.appendChild(buildClassifiedsAnchor(itemName, { quality, craftable, australium, killstreakTier, particle }));
  content.appendChild(searchLinks);

  const additionalLinks = new FakeElement("dd");
  additionalLinks.setAttribute("id", "popover-additional-links");
  const statsButton = new FakeElement("a");
  statsButton.className = "btn btn-default btn-xs";
  statsButton.setAttribute("href", "/stats/Unique/Reclaimed%20Metal/Tradable/Craftable");
  additionalLinks.appendChild(statsButton);
  content.appendChild(additionalLinks);

  return { content, additionalLinks };
}

test("inserts a posts.tf button searching by defindex/quality/craftable for a plain Unique item", async () => {
  installGlobals();
  const { content } = buildPopover({ itemName: "Reclaimed Metal", quality: 6 });
  global.document = makeDocument([content]);

  addPostsTfButton();
  await flush();

  const button = getPostsTfButton(content);
  assert.ok(button);
  const query = decodePostsTfQuery(button.getAttribute("href"));
  assert.deepEqual(query, { u: [{ defindex: 143, quality: 6, craftable: true }], p: [], d: "", m: false });
});

test("builds the query with the quality prefix applied for a non-Unique item (Strange)", async () => {
  installGlobals();
  const { content } = buildPopover({ itemName: "Rocket Launcher", quality: 11 });
  global.document = makeDocument([content]);

  addPostsTfButton();
  await flush();

  const query = decodePostsTfQuery(getPostsTfButton(content).getAttribute("href"));
  assert.equal(query.u[0].quality, 11);
  assert.equal(query.u[0].defindex, 205);
});

test("reads the effect id straight off the classifieds anchor's own 'particle' param (already the exact numeric id, confirmed live) - no schema lookup needed", async () => {
  installGlobals();
  const { content } = buildPopover({ itemName: "Team Captain", quality: 5, particle: 94 });
  global.document = makeDocument([content]);

  addPostsTfButton();
  await flush();

  const query = decodePostsTfQuery(getPostsTfButton(content).getAttribute("href"));
  assert.equal(query.u[0].effect, 94);
});

test("derives killstreak from the classifieds anchor's own plain killstreak_tier param", async () => {
  installGlobals();
  const { content } = buildPopover({ itemName: "Rocket Launcher", quality: 11, killstreakTier: 3 });
  global.document = makeDocument([content]);

  addPostsTfButton();
  await flush();

  const query = decodePostsTfQuery(getPostsTfButton(content).getAttribute("href"));
  assert.deepEqual(query.u[0], { defindex: 205, quality: 11, craftable: true, killstreak: 3 });
});

test("includes the popover's own Paint line as its plain NAME", async () => {
  installGlobals();
  const { content } = buildPopover({ itemName: "Team Captain", quality: 6, paintLine: "A Deep Commitment to Purple" });
  global.document = makeDocument([content]);

  addPostsTfButton();
  await flush();

  const query = decodePostsTfQuery(getPostsTfButton(content).getAttribute("href"));
  assert.equal(query.u[0].paint, "A Deep Commitment to Purple");
});

test("includes the popover's own Spell line as a one-element spells array", async () => {
  installGlobals();
  const { content } = buildPopover({ itemName: "Bazaar Bargain", quality: 11, spellLine: "Exorcism" });
  global.document = makeDocument([content]);

  addPostsTfButton();
  await flush();

  const query = decodePostsTfQuery(getPostsTfButton(content).getAttribute("href"));
  assert.deepEqual(query.u[0].spells, ["Exorcism"]);
});

test("sends craftable: false for a Non-Craftable item", async () => {
  installGlobals();
  const { content } = buildPopover({ itemName: "Rocket Launcher", quality: 11, craftable: "-1" });
  global.document = makeDocument([content]);

  addPostsTfButton();
  await flush();

  const query = decodePostsTfQuery(getPostsTfButton(content).getAttribute("href"));
  assert.equal(query.u[0].craftable, false);
});

test("does not insert a button for a Killstreak Kit - not built yet, resolveStatsAndClassifieds' own postsTfHref is null for that item type", async () => {
  installGlobals();
  const { content } = buildPopover({ itemName: "Professional Killstreak Eyelander Kit", quality: 6 });
  global.document = makeDocument([content]);

  addPostsTfButton();
  await flush();

  assert.equal(getPostsTfButton(content), null);
});

test("inserts into the shared primary link-buttons row alongside gladiator.tf, not the native #popover-additional-links row", async () => {
  installGlobals();
  const { content, additionalLinks } = buildPopover();
  global.document = makeDocument([content]);

  addPostsTfButton();
  await flush();

  assert.equal(additionalLinks.children.length, 1); // native row untouched
  const row = content.querySelector(".tf2te-link-buttons-row-primary");
  assert.ok(row);
  assert.equal(row.children[0], getPostsTfButton(content));
  assert.ok(getPostsTfButton(content).classList.contains("btn-item-tooltip") === false); // cloned Stats button's classes instead
  assert.ok(getPostsTfButton(content).className.includes("btn btn-default btn-xs"));
});

test("does not insert a second button when the same popover is scanned twice", async () => {
  installGlobals();
  const { content } = buildPopover();
  global.document = makeDocument([content]);

  addPostsTfButton();
  await flush();
  const row = content.querySelector(".tf2te-link-buttons-row-primary");
  assert.equal(row.children.length, 1);

  addPostsTfButton();
  await flush();
  assert.equal(row.children.length, 1);
});

test("does not insert if the popover was closed (isConnected false) while resolving", async () => {
  installGlobals();
  const { content, additionalLinks } = buildPopover();
  global.document = makeDocument([content]);

  const promise = addPostsTfButton();
  additionalLinks.isConnected = false;
  await promise;
  await flush();

  assert.equal(getPostsTfButton(content), null);
});

test("does nothing when the row has no classifieds anchor (markup changed)", async () => {
  installGlobals();
  const content = new FakeElement("div");
  content.className = "popover-content";
  const additionalLinks = new FakeElement("dd");
  additionalLinks.setAttribute("id", "popover-additional-links");
  content.appendChild(additionalLinks);
  global.document = makeDocument([content]);

  addPostsTfButton();
  await flush();

  assert.equal(getPostsTfButton(content), null);
});

test("the observer inserts a button for a popover added later", async () => {
  installGlobals();
  global.document = makeDocument([]);
  addPostsTfButton();
  await flush();

  const { content } = buildPopover();
  document.body.appendChild(content);

  FakeMutationObserver.instances[0].cb([{ addedNodes: [content] }]);
  await flush();

  assert.ok(getPostsTfButton(content));
});

test("addPostsTfButton sets up a subtree MutationObserver on document.body", () => {
  installGlobals();
  global.document = makeDocument([]);

  addPostsTfButton();

  assert.equal(FakeMutationObserver.instances.length, 1);
  assert.equal(FakeMutationObserver.instances[0].target, document.body);
  assert.deepEqual(FakeMutationObserver.instances[0].opts, { childList: true, subtree: true });
});

// --- missing Steam Web API key hint (utils/linkButtonStates.js) ---

test("with no Steam Web API key saved, an item the schema can't resolve gets a dimmed key-hint button that opens the key settings", async () => {
  installGlobals();
  savedSteamApiKey = null;
  sentMessages.length = 0;
  const { content } = buildPopover({ itemName: "Brotherhood of Arms", quality: 6 });
  global.document = makeDocument([content]);

  addPostsTfButton();
  await flush();

  const button = getPostsTfButton(content);
  assert.ok(button, "expected the key-hint button in posts.tf's usual spot");
  assert.equal(button.dataset.tf2teNeedsKey, "1");
  assert.equal(button.getAttribute("href"), null);
  assert.equal(button.textContent, "posts.tf");
  assert.match(button.title, /Steam Web API key/);

  button.dispatchEvent({ type: "click" });
  assert.deepEqual(sentMessages, [{ type: "OPEN_STEAM_API_KEY_SETTINGS" }]);
});

test("with a key saved, an item that still doesn't resolve gets no hint (a key wouldn't help)", async () => {
  installGlobals();
  savedSteamApiKey = "ABC123";
  try {
    const { content } = buildPopover({ itemName: "Some Brand New Hat", quality: 6 });
    global.document = makeDocument([content]);

    addPostsTfButton();
    await flush();

    assert.equal(getPostsTfButton(content), null);
  } finally {
    savedSteamApiKey = null;
  }
});

// See tests/addMarketplaceButtonOldUI.test.js's own copy for the real shape.
function wrapWithPopoverTitle(content, titleText) {
  const popover = new FakeElement("div");
  popover.className = "popover";
  const title = new FakeElement("h3");
  title.className = "popover-title";
  title.textContent = titleText;
  popover.appendChild(title);
  popover.appendChild(content);
  return popover;
}

// A Strangifier popover's classifieds "item" param can be the target weapon
// alone (see popoverItemDetails.js, #33); the posts.tf search used to be for
// the plain weapon's own defindex (205) instead of the Strangifier.
test("REGRESSION: a target-item tool whose item param is just the target weapon never searches the plain weapon's defindex", async () => {
  installGlobals();
  const { content } = buildPopover({ itemName: "Rocket Launcher", quality: 6 });
  global.document = makeDocument([wrapWithPopoverTitle(content, "Rocket Launcher Strangifier")]);

  addPostsTfButton();
  await flush();

  const href = getPostsTfButton(content)?.getAttribute("href");
  if (href) assert.notEqual(decodePostsTfQuery(href).u[0].defindex, 205);
});
