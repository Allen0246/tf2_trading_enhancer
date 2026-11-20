import { test } from "node:test";
import assert from "node:assert/strict";
import { addGladiatorButton } from "../backpack.tf/oldUI/addGladiatorButton/content.js";

// Same hand-rolled fake DOM (id selector, attribute-substring `*=` matcher,
// closest/querySelectorAll/matches) as tests/addMarketplaceButtonOldUI.test.js
// - see that file's own header comment for why this repo hand-rolls this
// instead of pulling in jsdom.

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

function getGladiatorButton(root) {
  return root.querySelector(".tf2te-gladiator-tf-button");
}

function buildClassifiedsAnchor(itemName, { quality = 6, craftable = "1", australium = "-1", killstreakTier = 0 } = {}) {
  const anchor = new FakeElement("a");
  const params = new URLSearchParams({
    item: itemName,
    quality: String(quality),
    tradable: "1",
    craftable,
    australium,
    killstreak_tier: String(killstreakTier),
  });
  anchor.setAttribute("href", `/classifieds?${params.toString()}`);
  return anchor;
}

function buildItemDetailsDd(text) {
  const dd = new FakeElement("dd");
  dd.textContent = text;
  return dd;
}

// Same popover shell tests/addMarketplaceButtonOldUI.test.js's own
// buildPopover documents.
function buildPopover({ itemName = "Captain Space Mann", quality = 5, craftable = "1", australium = "-1", killstreakTier = 0, effectLine } = {}) {
  const content = new FakeElement("div");
  content.className = "popover-content";

  if (effectLine) content.appendChild(buildItemDetailsDd(`Effect: ${effectLine}`));

  const searchLinks = new FakeElement("dd");
  searchLinks.setAttribute("id", "popover-search-links");
  searchLinks.appendChild(buildClassifiedsAnchor(itemName, { quality, craftable, australium, killstreakTier }));
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

test("builds gladiator.tf's item= param from a plain Strange item", async () => {
  installGlobals();
  const { content, additionalLinks } = buildPopover({ itemName: "Rocket Launcher", quality: 11, craftable: "1", australium: "-1" });
  global.document = makeDocument([content]);

  addGladiatorButton();
  await flush();

  const button = getGladiatorButton(content);
  assert.ok(button);
  const url = new URL(button.getAttribute("href"), "https://gladiator.tf/");
  assert.equal(url.searchParams.get("item"), "Strange Rocket Launcher");
});

test("includes Killstreak tier and Australium prefixes in the right order", async () => {
  installGlobals();
  const { content, additionalLinks } = buildPopover({
    itemName: "Rocket Launcher",
    quality: 11,
    craftable: "1",
    australium: "1",
    killstreakTier: 3,
  });
  global.document = makeDocument([content]);

  addGladiatorButton();
  await flush();

  const url = new URL(getGladiatorButton(content).getAttribute("href"), "https://gladiator.tf/");
  assert.equal(url.searchParams.get("item"), "Strange Professional Killstreak Australium Rocket Launcher");
});

test("Non-Craftable prefix comes first", async () => {
  installGlobals();
  const { content, additionalLinks } = buildPopover({ itemName: "Voodoo Juju", quality: 11, craftable: "-1" });
  global.document = makeDocument([content]);

  addGladiatorButton();
  await flush();

  const url = new URL(getGladiatorButton(content).getAttribute("href"), "https://gladiator.tf/");
  assert.equal(url.searchParams.get("item"), "Non-Craftable Strange Voodoo Juju");
});

test("REGRESSION: an Unusual substitutes the popover's own known Effect name in place of the literal quality word 'Unusual'", async () => {
  installGlobals();
  const { content, additionalLinks } = buildPopover({
    itemName: "Team Captain",
    quality: 5,
    craftable: "1",
    australium: "-1",
    effectLine: "Purple Energy",
  });
  global.document = makeDocument([content]);

  addGladiatorButton();
  await flush();

  const url = new URL(getGladiatorButton(content).getAttribute("href"), "https://gladiator.tf/");
  assert.equal(url.searchParams.get("item"), "Purple Energy Team Captain");
});

test("falls back to the literal word 'Unusual' when no Effect line is present (e.g. no known effect name resolved)", async () => {
  installGlobals();
  const { content, additionalLinks } = buildPopover({ itemName: "Team Captain", quality: 5, craftable: "1", australium: "-1" });
  global.document = makeDocument([content]);

  addGladiatorButton();
  await flush();

  const url = new URL(getGladiatorButton(content).getAttribute("href"), "https://gladiator.tf/");
  assert.equal(url.searchParams.get("item"), "Unusual Team Captain");
});

test("REGRESSION: a Decorated Weapon's own 'skin | weapon (wear)' item param joins with a single space, the real readable display-name form", async () => {
  installGlobals();
  const { content, additionalLinks } = buildPopover({
    itemName: "Secretly Serviced | Powerjack (Battle Scarred)",
    quality: 15,
    craftable: "1",
    australium: "-1",
    killstreakTier: 3,
  });
  global.document = makeDocument([content]);

  addGladiatorButton();
  await flush();

  const url = new URL(getGladiatorButton(content).getAttribute("href"), "https://gladiator.tf/");
  assert.equal(url.searchParams.get("item"), "Secretly Serviced Powerjack (Battle Scarred)");
});

test("appends into #popover-additional-links, cloning the row's own first button's class, and is idempotent", async () => {
  installGlobals();
  const { content, additionalLinks } = buildPopover();
  global.document = makeDocument([content]);

  addGladiatorButton();
  await flush();
  addGladiatorButton();
  await flush();

  assert.equal(content.querySelectorAll(".tf2te-gladiator-tf-button").length, 1);
  assert.equal(getGladiatorButton(content).className.includes("btn btn-default btn-xs"), true);
});

test("does nothing when the row has no #popover-search-links classifieds anchor (markup changed)", async () => {
  installGlobals();
  const content = new FakeElement("div");
  content.className = "popover-content";
  const additionalLinks = new FakeElement("dd");
  additionalLinks.setAttribute("id", "popover-additional-links");
  content.appendChild(additionalLinks);
  global.document = makeDocument([content]);

  addGladiatorButton();
  await flush();

  assert.equal(getGladiatorButton(content), null);
});

test("the MutationObserver picks up a #popover-additional-links row added later", async () => {
  installGlobals();
  global.document = makeDocument([]);

  addGladiatorButton();
  await flush();

  const { content, additionalLinks } = buildPopover();
  document.body.appendChild(content);
  FakeMutationObserver.instances[0].cb([{ addedNodes: [content] }]);
  await flush();

  assert.ok(getGladiatorButton(content));
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
// alone (see popoverItemDetails.js, #33); the search used to be for the
// plain weapon instead of the Strangifier.
test("REGRESSION: a target-item tool whose item param is just the target weapon searches the Strangifier's full popover title", async () => {
  installGlobals();
  const { content } = buildPopover({ itemName: "Pretty Boy's Pocket Pistol", quality: 6 });
  global.document = makeDocument([wrapWithPopoverTitle(content, "Pretty Boy's Pocket Pistol Strangifier")]);

  addGladiatorButton();
  await flush();

  const url = new URL(getGladiatorButton(content).getAttribute("href"));
  assert.equal(url.searchParams.get("item"), "Pretty Boy's Pocket Pistol Strangifier");
});
