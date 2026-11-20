import { test } from "node:test";
import assert from "node:assert/strict";

// Same pre-seeded schema cache pattern tests/addMarketplaceButtonOldUI.test.js's
// own header note documents - effect id 94 for "Electric Hat Protector"
// confirmed live from the user's own pasted popover markup ("Effect: Electric
// Hat Protector" + "particle=94" on the same item's own classifieds href).
globalThis.chrome = {
  storage: {
    local: {
      async get() {
        return {
          tf2SchemaCache: {
            itemNameToDefindex: {},
            defindexToItemName: {},
            effectNameToId: { "Electric Hat Protector": 94 },
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
    async sendMessage() {
      throw new Error("should not need a real fetch - schema cache is pre-seeded and fresh");
    },
  },
};
globalThis.fetch = async () => ({ json: async () => [] });

const { addStnButton } = await import("../backpack.tf/oldUI/addStnButton/content.js");
const { addMarketplaceButton } = await import("../backpack.tf/oldUI/addMarketplaceButton/content.js");

// Same hand-rolled fake DOM as tests/addMarketplaceButtonOldUI.test.js - see
// that file's own header comment for why this repo hand-rolls this instead
// of pulling in jsdom.

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
    this.nodeType = 1; // Node.ELEMENT_NODE
    this.parentElement = null;
    this.children = [];
    this._attrs = {};
    this.isConnected = true;
    this.style = {};
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
    this._textContent = v;
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

function makeDocument(rootChildren = []) {
  const body = new FakeElement("body");
  for (const c of rootChildren) body.appendChild(c);
  return {
    body,
    createElement: (tag) => new FakeElement(tag),
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

function getStnButton(root) {
  return root.querySelector(".tf2te-stn-button");
}

function getMarketplaceButton(root) {
  return root.querySelector(".tf2te-marketplace-tf-button");
}

// Same confirmed-live popover shapes as tests/addMarketplaceButtonOldUI.test.js
// - see that file's own header comments for each.
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

function buildPopover({
  itemName = "Captain Space Mann",
  quality = 5,
  craftable = "1",
  australium = "-1",
  killstreakTier = 0,
  effectLine,
  particle = null,
} = {}) {
  const content = new FakeElement("div");
  content.className = "popover-content";

  if (effectLine) content.appendChild(buildItemDetailsDd(`Effect: ${effectLine}`));

  const searchLinks = new FakeElement("dd");
  searchLinks.setAttribute("id", "popover-search-links");
  searchLinks.appendChild(buildClassifiedsAnchor(itemName, { quality, craftable, australium, killstreakTier, particle }));
  content.appendChild(searchLinks);

  const additionalLinks = new FakeElement("dd");
  additionalLinks.setAttribute("id", "popover-additional-links");
  const statsButton = new FakeElement("a");
  statsButton.className = "btn btn-default btn-xs";
  statsButton.setAttribute("href", "/stats/Unusual/Captain%20Space%20Mann/Tradable/Craftable/94");
  additionalLinks.appendChild(statsButton);
  content.appendChild(additionalLinks);

  return { content, additionalLinks };
}

test("inserts an stntrading.eu button into the shared secondary link-buttons row (not the native #popover-additional-links row), cloning that row's own first button's class", async () => {
  installGlobals();
  const { content, additionalLinks } = buildPopover();
  global.document = makeDocument([content]);

  addStnButton();
  await flush();

  const button = getStnButton(content);
  assert.ok(button);
  assert.equal(button.className.includes("btn btn-default btn-xs"), true);
  assert.equal(additionalLinks.children.length, 1); // native row untouched
  const row = content.querySelector(".tf2te-link-buttons-row-secondary");
  assert.equal(row.children[0], button);
});

// The actual live-reported ask: stntrading.eu has to land BEFORE
// marketplace.tf in their shared row, regardless of which one resolves
// first - see ../backpack.tf/oldUI/linkButtonsRow.js's own buttonOrder.
test("lands before marketplace.tf in the shared secondary row, even when marketplace.tf resolves first", async () => {
  installGlobals();
  const { content, additionalLinks } = buildPopover({ itemName: "Rocket Launcher", quality: 6 });
  global.document = makeDocument([content]);

  addMarketplaceButton();
  await flush();
  addStnButton();
  await flush();

  const row = content.querySelector(".tf2te-link-buttons-row-secondary");
  // classList.add (used for each button's own tf2te-*-button marker class,
  // same as ../addMarketplaceButton/content.js's own buildMarketplaceButtonEl)
  // doesn't sync back into this fake DOM's className string - checked via
  // classList.contains instead, same as findExistingLinkButton/insertLinkButton
  // themselves already do.
  assert.equal(row.children.length, 2);
  assert.ok(row.children[0].classList.contains("tf2te-stn-button"));
  assert.ok(row.children[1].classList.contains("tf2te-marketplace-tf-button"));
});

test("builds the general-case href from Steam's own market_hash_name convention (buildSteamMarketName)", async () => {
  installGlobals();
  const { content, additionalLinks } = buildPopover({
    itemName: "Rocket Launcher",
    quality: 11, // Strange
    craftable: "1",
    australium: "-1",
    killstreakTier: 0,
  });
  global.document = makeDocument([content]);

  addStnButton();
  await flush();

  const button = getStnButton(content);
  assert.ok(button);
  assert.equal(button.getAttribute("href"), "https://stntrading.eu/item/tf2/Strange+Rocket+Launcher");
});

// Confirmed live (scrap.tf/itemLinks/links.js's own buildStnTradingHref): an
// Unusual keeps the literal "Unusual" word AND inserts the effect name right
// after it - a third, distinct convention from both Steam's own name (no
// effect) and gladiator.tf's community one (no "Unusual" word).
test("an Unusual item's href keeps the literal 'Unusual' word and inserts the effect name", async () => {
  installGlobals();
  const { content, additionalLinks } = buildPopover({
    itemName: "Captain Space Mann",
    quality: 5, // Unusual
    effectLine: "Electric Hat Protector",
    particle: 94,
  });
  global.document = makeDocument([content]);

  addStnButton();
  await flush();

  const button = getStnButton(content);
  assert.ok(button);
  assert.equal(button.getAttribute("href"), "https://stntrading.eu/item/tf2/Unusual+Electric+Hat+Protector+Captain+Space+Mann");
});

test("is idempotent - running twice for the same popover doesn't duplicate the button", async () => {
  installGlobals();
  const { content, additionalLinks } = buildPopover();
  global.document = makeDocument([content]);

  addStnButton();
  await flush();
  addStnButton();
  await flush();

  assert.equal(content.querySelectorAll(".tf2te-stn-button").length, 1);
});

test("does not insert if the popover was closed (isConnected false) while resolving", async () => {
  installGlobals();
  const { content, additionalLinks } = buildPopover();
  global.document = makeDocument([content]);

  addStnButton();
  additionalLinks.isConnected = false;
  await flush();

  assert.equal(getStnButton(content), null);
});

test("does nothing when the row has no #popover-search-links classifieds anchor (markup changed)", async () => {
  installGlobals();
  const content = new FakeElement("div");
  content.className = "popover-content";
  const additionalLinks = new FakeElement("dd");
  additionalLinks.setAttribute("id", "popover-additional-links");
  content.appendChild(additionalLinks);
  global.document = makeDocument([content]);

  addStnButton();
  await flush();

  assert.equal(getStnButton(content), null);
});

test("the MutationObserver picks up a #popover-additional-links row added later, including nested inside another added node", async () => {
  installGlobals();
  global.document = makeDocument([]);

  addStnButton();
  await flush();

  const { content, additionalLinks } = buildPopover();
  document.body.appendChild(content);
  const observer = FakeMutationObserver.instances[0];
  observer.cb([{ addedNodes: [content] }]);
  await flush();

  assert.ok(getStnButton(content));
});

// A real popover's ".popover-title" is a sibling of ".popover-content" under
// one outer ".popover" (see tests/addMarketplaceButtonOldUI.test.js).
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
// alone (see popoverItemDetails.js, #33); the link used to point at the
// plain weapon instead of the Strangifier.
test("REGRESSION: a target-item tool whose item param is just the target weapon links the Strangifier, read off the popover title", async () => {
  installGlobals();
  const { content } = buildPopover({ itemName: "Rocket Launcher", quality: 6 });
  global.document = makeDocument([wrapWithPopoverTitle(content, "Rocket Launcher Strangifier")]);

  addStnButton();
  await flush();

  assert.equal(getStnButton(content).getAttribute("href"), "https://stntrading.eu/item/tf2/Rocket+Launcher+Strangifier");
});
