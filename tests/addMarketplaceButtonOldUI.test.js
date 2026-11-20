import { test } from "node:test";
import assert from "node:assert/strict";

// See tests/tf2StatsLinksIndex.test.js's own header comment: utils/tf2Schema.js
// memoizes its result at module scope for this file's lifetime, so a single
// pre-seeded fixture installed before import (not per-test) is the right
// shape - effect id 94 for "Electric Hat Protector" confirmed live from the
// user's own pasted popover markup ("Effect: Electric Hat Protector" +
// "particle=94" on the same item's own classifieds href).
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
// "Secretly Serviced" -> 412, "Ocean Mapped" -> 437, both confirmed live via
// the repo's own bundled utils/data/warpaints.json (used by the Decorated
// Weapon and standalone War Paint tool regression tests below).
globalThis.fetch = async () => ({
  json: async () => [
    { name: "Secretly Serviced", defindex: 412 },
    { name: "Ocean Mapped", defindex: 437 },
  ],
});

const { addMarketplaceButton } = await import("../backpack.tf/oldUI/addMarketplaceButton/content.js");
const { __resetSchemaCacheForTests } = await import("../utils/tf2Schema.js");

// Same hand-rolled fake DOM (attribute-substring `*=` matcher, closest/
// querySelectorAll/matches) as tests/addMarketplaceButton.test.js - see that
// file's own header comment for why this repo hand-rolls this instead of
// pulling in jsdom.

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

function getMarketplaceButton(root) {
  return root.querySelector(".tf2te-marketplace-tf-button");
}

// Builds the classifieds anchor exactly as confirmed live in the popover's
// own "#popover-search-links" row: <a href="/classifieds?item=...&
// quality=...&tradable=1&craftable=1&australium=-1&particle=94&
// killstreak_tier=0">.
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

// Builds the "Item Details" <dd> lines, confirmed live shape (a flat list of
// <dd>s, "Effect: X" among them for an Unusual).
function buildItemDetailsDd(text) {
  const dd = new FakeElement("dd");
  dd.textContent = text;
  return dd;
}

// Builds a Paint line, confirmed live shape: <dd>Paint: <span class="label
// label-paint" style="...">{name}</span> ~1.95-2.2 keys</dd> - the name
// lives on a nested span, not the dd's own direct text (which also carries a
// trailing price estimate) - only the span itself is modeled here since
// findKnownPaintName reads that directly, never dd.textContent.
function buildPaintDd(paintName) {
  const dd = new FakeElement("dd");
  const span = new FakeElement("span");
  span.className = "label label-paint";
  span.textContent = paintName;
  dd.appendChild(span);
  return dd;
}

// Builds the full popover shell: ".popover-content" containing "Item
// Details" <dd>s, "#popover-search-links" (with the Classifieds anchor), and
// "#popover-additional-links" (with the existing Stats/Unusual/Effect/
// History/Wiki buttons this feature's own button joins) - same structure
// confirmed live in the user's own pasted popover markup.
function buildPopover({
  itemName = "Captain Space Mann",
  quality = 5,
  craftable = "1",
  australium = "-1",
  killstreakTier = 0,
  effectLine,
  particle = null,
  sheenLine,
  killstreakerLine,
  spellLine,
  spellTypeLabel = "Footsteps Spell",
  paintLine,
} = {}) {
  const content = new FakeElement("div");
  content.className = "popover-content";

  if (effectLine) content.appendChild(buildItemDetailsDd(`Effect: ${effectLine}`));
  if (killstreakerLine) content.appendChild(buildItemDetailsDd(`Killstreaker: ${killstreakerLine}`));
  if (sheenLine) content.appendChild(buildItemDetailsDd(`Sheen: ${sheenLine}`));
  if (paintLine) content.appendChild(buildPaintDd(paintLine));
  // Confirmed live: its own separate "Spells" <dt> group, not "Item
  // Details" - harmless to build it as a plain sibling <dd> here too, same
  // as every other line, since findLabeledDetailText scans every <dd> under
  // the popover root regardless of which <dt> group it's under.
  if (spellLine) content.appendChild(buildItemDetailsDd(`${spellTypeLabel}: ${spellLine}`));

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

// Confirmed live: a real popover's ".popover-title" is a SIBLING of
// ".popover-content" under one outer ".popover" container, not a descendant
// of ".popover-content" itself (which is all buildPopover above builds,
// matching the existing tests' own real-confirmed shape for everything
// else) - only needed for the target-item-tool (Strangifier) tests below.
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

test("inserts a marketplace.tf button into the shared link-buttons row (not the native #popover-additional-links row), cloning that row's own first button's class", async () => {
  installGlobals();
  const { content, additionalLinks } = buildPopover({ effectLine: "Electric Hat Protector" });
  global.document = makeDocument([content]);

  addMarketplaceButton();
  await flush();

  const button = getMarketplaceButton(content);
  assert.ok(button);
  assert.equal(button.className.includes("btn btn-default btn-xs"), true);
  assert.equal(additionalLinks.children.length, 1); // native row untouched
  // marketplace.tf/mannco.store now share their OWN "secondary" row, split
  // out from gladiator.tf/pricedb.io/posts.tf's own "primary" row - see
  // ../backpack.tf/oldUI/linkButtonsRow.js's own header note.
  const row = content.querySelector(".tf2te-link-buttons-row-secondary");
  assert.equal(row.children[0], button);
});

test("REGRESSION: the icon is sized to match the row's other icons, not left at its own native (huge, layout-breaking) size - reported live", async () => {
  installGlobals();
  const { content, additionalLinks } = buildPopover();
  global.document = makeDocument([content]);

  addMarketplaceButton();
  await flush();

  const button = getMarketplaceButton(content);
  const icon = button.querySelector("img");
  assert.ok(icon);
  assert.equal(icon.style.width, "14px");
  assert.equal(icon.style.height, "14px");
});

test("builds the marketplace.tf href from the classifieds anchor's own item/quality/craftable/australium/killstreak_tier params", async () => {
  installGlobals();
  const { content, additionalLinks } = buildPopover({
    itemName: "Rocket Launcher",
    quality: 11, // Strange
    craftable: "1",
    australium: "1",
    killstreakTier: 3,
  });
  global.document = makeDocument([content]);

  addMarketplaceButton();
  await flush();

  const button = getMarketplaceButton(content);
  assert.ok(button);
  const url = new URL(button.getAttribute("href"), "https://marketplace.tf/");
  assert.equal(url.searchParams.get("sstrange"), "1");
  assert.equal(url.searchParams.get("saustralium"), "1");
  assert.equal(url.searchParams.get("skillstreak"), "3");
  assert.equal(url.searchParams.get("sterm"), "Rocket Launcher");
});

// REGRESSION for a live bug report, with the real pasted popover HTML for a
// "Third Degree Strangifier" (item param was just the bare "Strangifier",
// marketplace.tf's own sterm searched only that - no target weapon at all):
// the popover's own ".popover-title" carries the item's real full name, read
// via the outer ".popover" container since it's a SIBLING of
// ".popover-content", not a descendant - once fed into resolveStatsAndClassifieds
// as the raw name, matchTargetItemTool correctly re-derives the split
// itemName/targetItemName fields, and buildMarketplaceLink's own fix builds
// the full-name sterm from them.
test("reads the popover's own title text for a target-item tool (Strangifier), searching the full name (not the bare tool name) via sterm", async () => {
  installGlobals();
  const { content, additionalLinks } = buildPopover({ itemName: "Strangifier", quality: 6 });
  const popover = wrapWithPopoverTitle(content, "Third Degree Strangifier");
  global.document = makeDocument([popover]);

  addMarketplaceButton();
  await flush();

  const button = getMarketplaceButton(content);
  assert.ok(button);
  const url = new URL(button.getAttribute("href"), "https://marketplace.tf/");
  assert.equal(url.searchParams.get("sterm"), "Third Degree Strangifier");
  assert.equal(url.searchParams.get("squality[]"), "6");
});

// The classifieds "item" param of a Strangifier popover can also be the
// target weapon alone (reported live for the pricedb.io button, see #33),
// which used to resolve the plain weapon's link instead of the Strangifier's.
test("REGRESSION: a target-item tool whose item param is just the target weapon is still recognized by its popover title", async () => {
  installGlobals();
  const { content } = buildPopover({ itemName: "Pretty Boy's Pocket Pistol", quality: 6 });
  const popover = wrapWithPopoverTitle(content, "Pretty Boy's Pocket Pistol Strangifier");
  global.document = makeDocument([popover]);

  addMarketplaceButton();
  await flush();

  const button = getMarketplaceButton(content);
  assert.ok(button);
  const url = new URL(button.getAttribute("href"), "https://marketplace.tf/");
  assert.equal(url.searchParams.get("sterm"), "Pretty Boy's Pocket Pistol Strangifier");
});

test("falls back to the bare tool name for a target-item tool when the popover has no title element at all (markup changed)", async () => {
  installGlobals();
  const { content, additionalLinks } = buildPopover({ itemName: "Strangifier", quality: 6 });
  global.document = makeDocument([content]); // no outer .popover / .popover-title at all

  addMarketplaceButton();
  await flush();

  const button = getMarketplaceButton(content);
  const url = new URL(button.getAttribute("href"), "https://marketplace.tf/");
  assert.equal(url.searchParams.get("sterm"), "Strangifier");
});

test("REGRESSION: a Decorated Weapon's own skin/weapon/wear/Sheen/Killstreaker/Killstreak tier/Effect all resolve correctly - confirmed live via 'Cool Professional Killstreak Secretly Serviced Powerjack (Battle Scarred)', whose item= param text is 'Secretly Serviced | Powerjack (Battle Scarred)' (a ' | ' separator matchDecoratedWeapon can't parse as-is, previously fell through to the generic branch entirely and built a garbage search)", async () => {
  installGlobals();
  const { content, additionalLinks } = buildPopover({
    itemName: "Secretly Serviced | Powerjack (Battle Scarred)",
    quality: 15, // Decorated Weapon
    craftable: "1",
    australium: "-1",
    killstreakTier: 3,
    effectLine: "Cool", // confirmed live via a DIFFERENT item ("Isotope") that a Decorated-Weapon-family item's own Effect/particle CAN be a genuine effect - always threaded through now
    particle: 703,
    sheenLine: "Villainous Violet",
    killstreakerLine: "Fire Horns",
  });
  global.document = makeDocument([content]);

  addMarketplaceButton();
  await flush();

  const button = getMarketplaceButton(content);
  assert.ok(button);
  const url = new URL(button.getAttribute("href"), "https://marketplace.tf/");
  assert.equal(url.searchParams.get("skillstreak"), "3");
  assert.equal(url.searchParams.get("sks[]"), "6"); // Villainous Violet
  assert.equal(url.searchParams.get("ske[]"), "2002"); // Fire Horns
  assert.equal(url.searchParams.get("swear"), "5"); // Battle Scarred
  assert.equal(url.searchParams.get("spaintkit"), "412"); // Secretly Serviced's own texture id
  assert.equal(url.searchParams.get("sterm"), "Powerjack");
  assert.equal(url.searchParams.get("seffect[]"), "703");
});

test("REGRESSION: a standalone War Paint tool (no weapon applied yet) resolves correctly, needing a SPACE before the literal 'War Paint' text (the opposite of a real weapon's no-separator rule), and its own genuine Unusual effect is threaded into seffect[] - confirmed live via 'Ocean Mapped | War Paint (Field-Tested)' with Effect 'Isotope'/particle=702 (an earlier version of this fix wrongly assumed Effect/particle never meant a real effect for this item family at all - confirmed live wrong)", async () => {
  installGlobals();
  const { content, additionalLinks } = buildPopover({
    itemName: "Ocean Mapped | War Paint (Field-Tested)",
    quality: 15, // Decorated Weapon
    craftable: "1",
    australium: "-1",
    killstreakTier: 0,
    effectLine: "Isotope",
    particle: 702,
  });
  global.document = makeDocument([content]);

  addMarketplaceButton();
  await flush();

  const button = getMarketplaceButton(content);
  assert.ok(button);
  const url = new URL(button.getAttribute("href"), "https://marketplace.tf/");
  assert.equal(url.searchParams.get("swear"), "3"); // Field-Tested
  assert.equal(url.searchParams.get("spaintkit"), "437"); // Ocean Mapped's own texture id
  assert.equal(url.searchParams.get("sterm"), "War Paint");
  assert.equal(url.searchParams.get("seffect[]"), "702");
});

test("REGRESSION: reads a Halloween Spell from its own 'Spells' section and threads it into sspell - confirmed live via 'Footsteps Spell: Violent Violet Footprints' (not the fixed 'Halloween Spell:' wording Effect/Sheen/Killstreaker use)", async () => {
  installGlobals();
  const { content, additionalLinks } = buildPopover({
    itemName: "Bear Necessities",
    quality: 6, // Unique
    spellLine: "Violent Violet Footprints",
    spellTypeLabel: "Footsteps Spell",
  });
  global.document = makeDocument([content]);

  addMarketplaceButton();
  await flush();

  const button = getMarketplaceButton(content);
  assert.ok(button);
  const url = new URL(button.getAttribute("href"), "https://marketplace.tf/");
  assert.equal(url.searchParams.get("sspell"), "footprint_violent_violet");
});

test("REGRESSION: reads a Paint name off its nested '.label-paint' span (not the dd's own text, which also carries a trailing price estimate) and threads it into spaint[] as the decimal-RGB id", async () => {
  installGlobals();
  const { content, additionalLinks } = buildPopover({
    itemName: "Team Captain",
    quality: 6, // Unique
    paintLine: "An Extraordinary Abundance of Tinge",
  });
  global.document = makeDocument([content]);

  addMarketplaceButton();
  await flush();

  const button = getMarketplaceButton(content);
  assert.ok(button);
  const url = new URL(button.getAttribute("href"), "https://marketplace.tf/");
  assert.equal(url.searchParams.get("spaint[]"), "15132390"); // 0xe6e6e6
});

test("REGRESSION: a Paint on an Unusual item is NOT filtered by (same exclusion rule the next.backpack.tf tooltip button already enforces, respected here for free since both share buildMarketplaceLink)", async () => {
  installGlobals();
  const { content, additionalLinks } = buildPopover({
    itemName: "Team Captain",
    quality: 5, // Unusual
    effectLine: "Electric Hat Protector",
    particle: 94,
    paintLine: "An Extraordinary Abundance of Tinge",
  });
  global.document = makeDocument([content]);

  addMarketplaceButton();
  await flush();

  const button = getMarketplaceButton(content);
  assert.ok(button);
  const url = new URL(button.getAttribute("href"), "https://marketplace.tf/");
  assert.equal(url.searchParams.has("spaint[]"), false);
});

test("resolves the Unusual effect from the popover's own 'particle' query param (the anchor's already-resolved effect id)", async () => {
  installGlobals();
  const { content, additionalLinks } = buildPopover({
    itemName: "Captain Space Mann",
    quality: 5, // Unusual
    effectLine: "Electric Hat Protector",
    particle: 94,
  });
  global.document = makeDocument([content]);

  addMarketplaceButton();
  await flush();

  const button = getMarketplaceButton(content);
  assert.ok(button);
  const url = new URL(button.getAttribute("href"), "https://marketplace.tf/");
  assert.equal(url.searchParams.get("seffect[]"), "94");
});

test("REGRESSION: resolves an Unusual's marketplace.tf link even with no Steam Web API key configured (empty effect schema) - the popover's own 'particle' query param already has the resolved effect id, so it never needs the schema at all", async () => {
  const originalGet = globalThis.chrome.storage.local.get;
  const originalLog = console.log;
  console.log = () => {};
  globalThis.chrome.storage.local.get = async () => ({
    tf2SchemaCache: { itemNameToDefindex: {}, defindexToItemName: {}, effectNameToId: {}, fetchedAt: Date.now(), schemaShapeVersion: 4 },
  });
  __resetSchemaCacheForTests();

  try {
    installGlobals();
    const { content, additionalLinks } = buildPopover({
      itemName: "Captain Space Mann",
      quality: 5, // Unusual
      effectLine: "Electric Hat Protector",
      particle: 94,
    });
    global.document = makeDocument([content]);

    addMarketplaceButton();
    await flush();

    const button = getMarketplaceButton(content);
    assert.ok(button);
    const url = new URL(button.getAttribute("href"), "https://marketplace.tf/");
    assert.equal(url.searchParams.get("seffect[]"), "94");
  } finally {
    globalThis.chrome.storage.local.get = originalGet;
    console.log = originalLog;
    __resetSchemaCacheForTests(); // restore the shared non-empty fixture for every later test in this file
  }
});

test("does nothing when the row has no #popover-search-links classifieds anchor (markup changed)", async () => {
  installGlobals();
  const content = new FakeElement("div");
  content.className = "popover-content";
  const additionalLinks = new FakeElement("dd");
  additionalLinks.setAttribute("id", "popover-additional-links");
  content.appendChild(additionalLinks);
  global.document = makeDocument([content]);

  addMarketplaceButton();
  await flush();

  assert.equal(getMarketplaceButton(content), null);
});

test("is idempotent - running twice for the same popover doesn't duplicate the button", async () => {
  installGlobals();
  const { content, additionalLinks } = buildPopover();
  global.document = makeDocument([content]);

  addMarketplaceButton();
  await flush();
  addMarketplaceButton();
  await flush();

  assert.equal(content.querySelectorAll(".tf2te-marketplace-tf-button").length, 1);
});

test("does not insert if the popover was closed (isConnected false) while resolving", async () => {
  installGlobals();
  const { content, additionalLinks } = buildPopover();
  global.document = makeDocument([content]);

  addMarketplaceButton();
  additionalLinks.isConnected = false;
  await flush();

  assert.equal(getMarketplaceButton(content), null);
});

test("the MutationObserver picks up a #popover-additional-links row added later, including nested inside another added node", async () => {
  installGlobals();
  global.document = makeDocument([]);

  addMarketplaceButton();
  await flush();

  const { content, additionalLinks } = buildPopover();
  document.body.appendChild(content);
  const observer = FakeMutationObserver.instances[0];
  observer.cb([{ addedNodes: [content] }]);
  await flush();

  assert.ok(getMarketplaceButton(content));
});
