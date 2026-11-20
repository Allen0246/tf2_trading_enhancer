import { test } from "node:test";
import assert from "node:assert/strict";

// isSheenKillstreakerFilterEnabled's own storage read + the module's
// chrome.storage.onChanged watcher (see content.js's own
// ensureSheenKillstreakerFilterWatcher note) both need a minimal chrome
// fake, lazily touched on the first actual button build rather than at
// import time - default-enabled (get() returns {}, same "absent reads as
// enabled" convention utils/sheenKillstreakerFilterSetting.js documents).
// The watcher only ever registers once (module-level guard), so a LATER
// test that wants to simulate the setting changing mid-session fires it
// through this same captured listener, not by re-overriding get() (which
// the watcher would never re-read).
const sheenKillstreakerOnChangedListeners = [];
globalThis.chrome = {
  storage: {
    local: { async get() { return {}; } },
    onChanged: {
      addListener(fn) {
        sheenKillstreakerOnChangedListeners.push(fn);
      },
    },
  },
};
function fireSheenKillstreakerFilterChange(enabled) {
  const changes = { sheenKillstreakerFilterEnabled: { newValue: enabled } };
  sheenKillstreakerOnChangedListeners.slice().forEach((fn) => fn(changes, "local"));
}

import { addMannStoreButton } from "../backpack.tf/oldUI/addMannStoreButton/content.js";

// Same hand-rolled fake DOM as tests/addGladiatorButtonOldUI.test.js /
// tests/addMarketplaceButtonOldUI.test.js.

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

function getMannStoreButton(root) {
  return root.querySelector(".tf2te-mannco-store-button");
}

function mannStoreParams(button) {
  return new URL(button.getAttribute("href"), "https://mannco.store/").searchParams;
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

function buildPaintDd(paintName) {
  const dd = new FakeElement("dd");
  const span = new FakeElement("span");
  span.className = "label label-paint";
  span.textContent = paintName;
  dd.appendChild(span);
  return dd;
}

function buildPopover({
  itemName = "Rocket Launcher",
  quality = 11,
  craftable = "1",
  australium = "-1",
  killstreakTier = 0,
  effectLine,
  sheenLine,
  killstreakerLine,
  paintLine,
} = {}) {
  const content = new FakeElement("div");
  content.className = "popover-content";

  if (effectLine) content.appendChild(buildItemDetailsDd(`Effect: ${effectLine}`));
  if (killstreakerLine) content.appendChild(buildItemDetailsDd(`Killstreaker: ${killstreakerLine}`));
  if (sheenLine) content.appendChild(buildItemDetailsDd(`Sheen: ${sheenLine}`));
  if (paintLine) content.appendChild(buildPaintDd(paintLine));

  const searchLinks = new FakeElement("dd");
  searchLinks.setAttribute("id", "popover-search-links");
  searchLinks.appendChild(buildClassifiedsAnchor(itemName, { quality, craftable, australium, killstreakTier }));
  content.appendChild(searchLinks);

  const additionalLinks = new FakeElement("dd");
  additionalLinks.setAttribute("id", "popover-additional-links");
  const statsButton = new FakeElement("a");
  statsButton.className = "btn btn-default btn-xs";
  statsButton.setAttribute("href", "/stats/Strange/Rocket%20Launcher/Tradable/Craftable");
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

test("plain Strange item: search/quality set, killstreak/warpaints default to their 'none' values, no festivized param at all (classic has no Festivized signal)", async () => {
  installGlobals();
  const { content, additionalLinks } = buildPopover({ itemName: "Rocket Launcher", quality: 11 });
  global.document = makeDocument([content]);

  addMannStoreButton();
  await flush();

  const params = mannStoreParams(getMannStoreButton(content));
  assert.equal(params.get("search"), "Rocket Launcher");
  assert.equal(params.get("quality"), "Strange");
  assert.equal(params.get("killstreak"), "No");
  assert.equal(params.get("warpaints"), "No WarPaints");
  assert.equal(params.has("festivized"), false);
  assert.equal(params.has("sheen"), false);
  assert.equal(params.has("killstreaker"), false);
  assert.equal(params.has("paint"), false);
  assert.equal(params.has("effect"), false);
});

test("Killstreak tier reads straight from killstreak_tier, no Sheen/Killstreaker inference needed", async () => {
  installGlobals();
  const { content, additionalLinks } = buildPopover({ itemName: "Rocket Launcher", quality: 11, killstreakTier: 2 });
  global.document = makeDocument([content]);

  addMannStoreButton();
  await flush();

  assert.equal(mannStoreParams(getMannStoreButton(content)).get("killstreak"), "Specialized Killstreak");
});

test("Sheen/Killstreaker read off their own 'Label: value' Item Details lines", async () => {
  installGlobals();
  const { content, additionalLinks } = buildPopover({
    itemName: "Rocket Launcher",
    quality: 11,
    killstreakTier: 3,
    sheenLine: "Agonizing Emerald",
    killstreakerLine: "Fire Horns",
  });
  global.document = makeDocument([content]);

  addMannStoreButton();
  await flush();

  const params = mannStoreParams(getMannStoreButton(content));
  assert.equal(params.get("sheen"), "Agonizing Emerald");
  assert.equal(params.get("killstreaker"), "Fire Horns");
});

// New feature: Sheen/Killstreaker filtering is user-toggleable via a General
// settings checkbox, default on - simulated here via chrome.storage.onChanged
// (see this file's own fireSheenKillstreakerFilterChange note), the same
// mechanism a real Save in the popup fires. When off, the button still reads
// the DOM lines (killstreak tier is unaffected - a separate signal, see the
// URL's own killstreak_tier param) but omits sheen/killstreaker from the
// built href.
test("omits sheen/killstreaker from the mannco.store link once the filter setting is turned off", async () => {
  installGlobals();
  fireSheenKillstreakerFilterChange(false);
  try {
    const { content } = buildPopover({
      itemName: "Rocket Launcher",
      quality: 11,
      killstreakTier: 3,
      sheenLine: "Agonizing Emerald",
      killstreakerLine: "Fire Horns",
    });
    global.document = makeDocument([content]);

    addMannStoreButton();
    await flush();

    const params = mannStoreParams(getMannStoreButton(content));
    assert.equal(params.get("killstreak"), "Professional Killstreak");
    assert.equal(params.has("sheen"), false);
    assert.equal(params.has("killstreaker"), false);
  } finally {
    fireSheenKillstreakerFilterChange(true); // restore default for every later test in this file
  }
});

test("Paint reads off its nested '.label-paint' span, not the dd's own text (which also carries a trailing price estimate)", async () => {
  installGlobals();
  const { content, additionalLinks } = buildPopover({ itemName: "Troublemaker's Tossle Cap", quality: 6, paintLine: "After Eight" });
  global.document = makeDocument([content]);

  addMannStoreButton();
  await flush();

  assert.equal(mannStoreParams(getMannStoreButton(content)).get("paint"), "After Eight");
});

test("REGRESSION: Paint is never applied for an Unusual item", async () => {
  installGlobals();
  const { content } = buildPopover({
    itemName: "Troublemaker's Tossle Cap",
    quality: 5,
    effectLine: "Death at Dusk",
    paintLine: "After Eight",
  });
  global.document = makeDocument([content]);

  addMannStoreButton();
  await flush();

  const params = mannStoreParams(getMannStoreButton(content));
  assert.equal(params.get("effect"), "Death at Dusk");
  assert.equal(params.has("paint"), false);
});

test("Unusual with an effect: quality=Unusual, effect param set", async () => {
  installGlobals();
  const { content, additionalLinks } = buildPopover({
    itemName: "Troublemaker's Tossle Cap",
    quality: 5,
    effectLine: "Death at Dusk",
  });
  global.document = makeDocument([content]);

  addMannStoreButton();
  await flush();

  const params = mannStoreParams(getMannStoreButton(content));
  assert.equal(params.get("quality"), "Unusual");
  assert.equal(params.get("effect"), "Death at Dusk");
});

test("REGRESSION: a Decorated Weapon's own 'skin | weapon (wear)' item param splits into a bare weapon-name search and a separate warpaints value", async () => {
  installGlobals();
  const { content, additionalLinks } = buildPopover({
    itemName: "Potent Poison | Rocket Launcher (Field-Tested)",
    quality: 15,
    killstreakTier: 0,
  });
  global.document = makeDocument([content]);

  addMannStoreButton();
  await flush();

  const params = mannStoreParams(getMannStoreButton(content));
  assert.equal(params.get("search"), "Rocket Launcher");
  assert.equal(params.get("warpaints"), "Potent Poison");
});

test("REGRESSION: Australium is manually prepended into the search text (classic's own item param has no literal 'Australium' word, unlike next.backpack.tf's tooltip title)", async () => {
  installGlobals();
  const { content, additionalLinks } = buildPopover({ itemName: "Rocket Launcher", quality: 11, australium: "1", killstreakTier: 1 });
  global.document = makeDocument([content]);

  addMannStoreButton();
  await flush();

  const params = mannStoreParams(getMannStoreButton(content));
  assert.equal(params.get("search"), "Australium Rocket Launcher");
  assert.equal(params.get("killstreak"), "Killstreak");
});

// REGRESSION for a live bug report, with the real pasted popover HTML for a
// "Third Degree Strangifier" (item param was just the bare "Strangifier",
// mannco.store button searched only that - no target weapon at all): the
// popover's own ".popover-title" carries the item's real full name, read via
// the outer ".popover" container since it's a SIBLING of ".popover-content",
// not a descendant.
test("reads the popover's own title text for a target-item tool (Strangifier), bare-searching its full name with no quality/killstreak/warpaints structure", async () => {
  installGlobals();
  const { content, additionalLinks } = buildPopover({ itemName: "Strangifier", quality: 6 });
  const popover = wrapWithPopoverTitle(content, "Third Degree Strangifier");
  global.document = makeDocument([popover]);

  addMannStoreButton();
  await flush();

  const params = mannStoreParams(getMannStoreButton(content));
  assert.equal(params.get("search"), "Third Degree Strangifier");
  assert.equal(params.has("quality"), false);
  assert.equal(params.has("killstreak"), false);
  assert.equal(params.has("warpaints"), false);
});

// The classifieds "item" param of a Strangifier popover can also be the
// target weapon alone (reported live for the pricedb.io button, see #33).
test("REGRESSION: a target-item tool whose item param is just the target weapon is still bare-searched by its popover title", async () => {
  installGlobals();
  const { content } = buildPopover({ itemName: "Pretty Boy's Pocket Pistol", quality: 6 });
  const popover = wrapWithPopoverTitle(content, "Pretty Boy's Pocket Pistol Strangifier");
  global.document = makeDocument([popover]);

  addMannStoreButton();
  await flush();

  const params = mannStoreParams(getMannStoreButton(content));
  assert.equal(params.get("search"), "Pretty Boy's Pocket Pistol Strangifier");
  assert.equal(params.has("quality"), false);
});

test("falls back to the bare tool name for a target-item tool when the popover has no title element at all (markup changed)", async () => {
  installGlobals();
  const { content, additionalLinks } = buildPopover({ itemName: "Strangifier", quality: 6 });
  global.document = makeDocument([content]); // no outer .popover / .popover-title at all

  addMannStoreButton();
  await flush();

  assert.equal(mannStoreParams(getMannStoreButton(content)).get("search"), "Strangifier");
});

test("appends into #popover-additional-links, cloning the row's own first button's class, and is idempotent", async () => {
  installGlobals();
  const { content, additionalLinks } = buildPopover();
  global.document = makeDocument([content]);

  addMannStoreButton();
  await flush();
  addMannStoreButton();
  await flush();

  assert.equal(content.querySelectorAll(".tf2te-mannco-store-button").length, 1);
  assert.equal(getMannStoreButton(content).className.includes("btn btn-default btn-xs"), true);
});

test("does nothing when the row has no #popover-search-links classifieds anchor (markup changed)", async () => {
  installGlobals();
  const content = new FakeElement("div");
  content.className = "popover-content";
  const additionalLinks = new FakeElement("dd");
  additionalLinks.setAttribute("id", "popover-additional-links");
  content.appendChild(additionalLinks);
  global.document = makeDocument([content]);

  addMannStoreButton();
  await flush();

  assert.equal(getMannStoreButton(content), null);
});

test("the MutationObserver picks up a #popover-additional-links row added later", async () => {
  installGlobals();
  global.document = makeDocument([]);

  addMannStoreButton();
  await flush();

  const { content, additionalLinks } = buildPopover({ itemName: "Refined Metal", quality: 6 });
  document.body.appendChild(content);
  FakeMutationObserver.instances[0].cb([{ addedNodes: [content] }]);
  await flush();

  const button = getMannStoreButton(content);
  assert.ok(button);
  assert.equal(mannStoreParams(button).get("search"), "Refined Metal");
});
