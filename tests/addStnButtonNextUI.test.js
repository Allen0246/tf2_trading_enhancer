import { test } from "node:test";
import assert from "node:assert/strict";

// Same pre-seeded schema cache pattern tests/addMarketplaceButton.test.js's
// own header note documents - effect id 71 for "Green Black Hole" confirmed
// live from the user's own pasted tooltip markup.
globalThis.chrome = {
  storage: {
    local: {
      async get() {
        return {
          tf2SchemaCache: {
            itemNameToDefindex: {},
            defindexToItemName: {},
            effectNameToId: { "Green Black Hole": 71 },
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

const { addStnButton } = await import("../backpack.tf/nextUI/addStnButton/content.js");
const { addMarketplaceButton } = await import("../backpack.tf/nextUI/addMarketplaceButton/content.js");

// Same hand-rolled fake DOM as tests/addMannStoreButton.test.js - see that
// file's own header comment - extended so insertAdjacentElement also
// supports "beforebegin" (this feature's own insertion position, unlike
// mannco.store's "afterend").

function parseCompound(selector) {
  const attrSubMatch = /\[([\w-]+)\*="([^"]*)"\]/.exec(selector);
  const attrPrefixMatch = /\[([\w-]+)\^="([^"]*)"\]/.exec(selector);
  const rest = selector.replace(/\[[^\]]*\]/g, "");
  const classes = [...rest.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
  const tagMatch = /^[a-zA-Z][\w-]*/.exec(rest);
  return {
    tag: tagMatch ? tagMatch[0].toLowerCase() : null,
    classes,
    attrSub: attrSubMatch ? { name: attrSubMatch[1], value: attrSubMatch[2] } : null,
    attrPrefix: attrPrefixMatch ? { name: attrPrefixMatch[1], value: attrPrefixMatch[2] } : null,
  };
}

function matchesCompound(el, parsed) {
  if (!el || el.nodeType !== 1) return false;
  if (parsed.tag && el.tagName.toLowerCase() !== parsed.tag) return false;
  if (!parsed.classes.every((c) => el.classList.contains(c))) return false;
  if (parsed.attrSub) {
    const v = el.getAttribute(parsed.attrSub.name);
    if (!v || !v.includes(parsed.attrSub.value)) return false;
  }
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
  getAttributeNames() {
    return Object.keys(this._attrs);
  }
  appendChild(child) {
    this.children.push(child);
    child.parentElement = this;
    return child;
  }
  insertAdjacentElement(position, el) {
    if (!this.parentElement) throw new Error("insertAdjacentElement: no parentElement");
    const siblings = this.parentElement.children;
    const idx = siblings.indexOf(this);
    if (position === "afterend") {
      siblings.splice(idx + 1, 0, el);
    } else if (position === "beforebegin") {
      siblings.splice(idx, 0, el);
    } else {
      throw new Error(`unsupported position: ${position}`);
    }
    el.parentElement = this.parentElement;
    return el;
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
  global.window = { location: { href: "https://next.backpack.tf/stats?item=Reclaimed+Metal&quality=Unique" } };
  global.Node = { ELEMENT_NODE: 1 };
  global.MutationObserver = FakeMutationObserver;
  FakeMutationObserver.instances = [];
}

function getStnButton() {
  return document.querySelector(".tf2te-stn-button");
}

// Same shape confirmed live in next.backpack.tf's item-preview tooltip:
// <a href="/classifieds?itemName=...&quality=11" class="btn btn-outline-brand btn-item-tooltip">
function buildClassifiedsAnchor(itemName, qualityId) {
  const anchor = new FakeElement("a");
  anchor.setAttribute("href", `/classifieds?itemName=${encodeURIComponent(itemName)}&quality=${qualityId}`);
  anchor.className = "btn btn-outline-brand btn-item-tooltip";
  return anchor;
}

function buildContentLinksRow(anchor) {
  const row = new FakeElement("div");
  row.className = "item-tooltip__content__links";
  row.appendChild(anchor);
  return row;
}

// Same shape backpack.tf/nextUI/shared/tooltipButtonRow.js's buildTooltipButtonRow
// builds - this file's own insertion anchor.
function buildMarketplaceRow({ scopedAttr = "data-v-marketplace123" } = {}) {
  const button = new FakeElement("a");
  button.className = "btn btn-outline-brand btn-item-tooltip tf2te-marketplace-tf-button";
  if (scopedAttr) button.setAttribute(scopedAttr, "");
  button.textContent = "marketplace.tf";

  const row = new FakeElement("div");
  row.className = "item-tooltip__content__links mb-1";
  row.appendChild(button);
  return { row, button };
}

function buildEffectLink(name) {
  const link = new FakeElement("a");
  link.setAttribute("href", `/effects/${encodeURIComponent(name)}`);
  const nameDiv = new FakeElement("div");
  nameDiv.classList.add("special-attribute__name");
  nameDiv.textContent = `\n    ${name}\n  `;
  link.appendChild(nameDiv);
  return link;
}

// Builds a ".tippy-popper" tooltip shell, same shape tests/addMannStoreButton.test.js's
// own buildTooltip uses, trimmed to what this file's own tests actually need.
function buildTooltip({ itemName, qualityId, effectName, withMarketplace = false } = {}) {
  const popper = new FakeElement("div");
  popper.classList.add("tippy-popper");

  if (effectName) popper.appendChild(buildEffectLink(effectName));

  const anchor = buildClassifiedsAnchor(itemName, qualityId);
  const linksWrap = buildContentLinksRow(anchor);
  popper.appendChild(linksWrap);

  let marketplaceButton = null;
  let marketplaceRow = null;
  if (withMarketplace) {
    const { row, button } = buildMarketplaceRow();
    popper.appendChild(row);
    marketplaceButton = button;
    marketplaceRow = row;
  }

  return { popper, anchor, marketplaceButton, marketplaceRow };
}

test("inserts the stntrading.eu button as a sibling right BEFORE the marketplace.tf button (same row), cloning ITS classes/scoped-style attribute, not the Classifieds anchor's", async () => {
  installGlobals();
  const { popper, marketplaceButton, marketplaceRow } = buildTooltip({ itemName: "Reclaimed Metal", qualityId: 6, withMarketplace: true });
  global.document = makeDocument([popper]);

  addStnButton();
  await flush();

  assert.equal(marketplaceRow.children.length, 2); // [stnButton, marketplaceButton]
  const button = getStnButton();
  assert.ok(button);
  assert.equal(marketplaceRow.children[0], button);
  assert.equal(marketplaceRow.children[1], marketplaceButton);
  assert.equal(button.textContent, "stntrading.eu");
  assert.ok(button.classList.contains("btn-item-tooltip"));
  assert.ok(button.classList.contains("tf2te-marketplace-tf-button") === false); // cloned classes, not the class itself
  assert.ok(button.classList.contains("tf2te-stn-button"));
  assert.equal(button.target, "_blank");
  assert.equal(button.rel, "noopener noreferrer");
  assert.equal(button.getAttribute("data-v-marketplace123"), ""); // copied from the marketplace.tf button, not the Classifieds anchor
  assert.equal(button.href, "https://stntrading.eu/item/tf2/Reclaimed+Metal");
});

// Confirmed live (scrap.tf/itemLinks/links.js's own buildStnTradingHref): an
// Unusual keeps the literal "Unusual" word and inserts the effect name.
test("an Unusual item's href keeps the literal 'Unusual' word and inserts the effect name", async () => {
  installGlobals();
  const { popper } = buildTooltip({ itemName: "Team Captain", qualityId: 5, effectName: "Green Black Hole", withMarketplace: true });
  global.document = makeDocument([popper]);

  addStnButton();
  await flush();

  assert.equal(getStnButton()?.href, "https://stntrading.eu/item/tf2/Unusual+Green+Black+Hole+Team+Captain");
});

// An Unusual Taunt's tooltip has no "/effects/" row; its effect is only the
// anchor's "particle" param (see addMarketplaceButton's matching test). This
// button never passed that id on, so the link lost the effect entirely
// ("Unusual Taunt: The Boston Breakdance").
test("REGRESSION: an Unusual Taunt with no effect row still gets its effect name from the anchor's own particle param", async () => {
  installGlobals();
  const { popper, anchor } = buildTooltip({ itemName: "Taunt: The Boston Breakdance", qualityId: 5, withMarketplace: true });
  anchor.setAttribute("href", "/classifieds?itemName=Taunt%3A%20The%20Boston%20Breakdance&quality=5&particle=3072");
  global.document = makeDocument([popper]);

  addStnButton();
  await flush();

  assert.equal(getStnButton()?.href, "https://stntrading.eu/item/tf2/Unusual+Aurora+Polaris+Taunt%3A+The+Boston+Breakdance");
});

// The Classifieds anchor carries Australium as its own "australium=1" param,
// never as a word in itemName (confirmed live - see
// addMarketplaceButton/content.js's own buildItemNameRaw note).
test("an Australium weapon's href includes 'Australium', read off the Classifieds anchor's own australium=1 param", async () => {
  installGlobals();
  const { popper, anchor } = buildTooltip({ itemName: "Rocket Launcher", qualityId: 11, withMarketplace: true });
  anchor.setAttribute("href", "/classifieds?itemName=Rocket%20Launcher&quality=11&australium=1");
  global.document = makeDocument([popper]);

  addStnButton();
  await flush();

  assert.equal(getStnButton()?.href, "https://stntrading.eu/item/tf2/Strange+Australium+Rocket+Launcher");
});

// A target tool's Classifieds anchor names only the tool ("Strangifier")
// and carries the target in its own targetItem param (same shape
// addMarketplaceButton/content.js reads); the STN page is the full
// "{target} Strangifier" item, not the bare tool.
test("REGRESSION: a Strangifier's href is built from the anchor's targetItem param, not the bare 'Strangifier' itemName", async () => {
  installGlobals();
  const { popper, anchor } = buildTooltip({ itemName: "Strangifier", qualityId: 6, withMarketplace: true });
  anchor.setAttribute("href", "/classifieds?itemName=Strangifier&quality=6&targetItem=Righteous%20Bison");
  global.document = makeDocument([popper]);

  addStnButton();
  await flush();

  assert.equal(getStnButton()?.href, "https://stntrading.eu/item/tf2/Righteous+Bison+Strangifier");
});

test("does not insert a button when marketplace.tf's own button isn't there yet, but retries and succeeds once a later mutation adds it (doesn't permanently claim the signature early)", async () => {
  installGlobals();
  const { popper } = buildTooltip({ itemName: "Reclaimed Metal", qualityId: 6 }); // no marketplace button yet
  global.document = makeDocument([popper]);

  addStnButton();
  await flush();
  assert.equal(getStnButton(), null);

  const { row, button: marketplaceButton } = buildMarketplaceRow();
  popper.appendChild(row);
  FakeMutationObserver.instances[0].cb([{ addedNodes: [row] }]);
  await flush();

  const button = getStnButton();
  assert.ok(button);
  assert.equal(button.parentElement, marketplaceButton.parentElement);
});

test("does not insert a second button when the same unchanged tooltip is scanned twice (content-signature dedupe)", async () => {
  installGlobals();
  const { popper, marketplaceRow } = buildTooltip({ itemName: "Reclaimed Metal", qualityId: 6, withMarketplace: true });
  global.document = makeDocument([popper]);

  addStnButton();
  await flush();
  assert.equal(marketplaceRow.children.length, 2);

  addStnButton();
  await flush();

  assert.equal(marketplaceRow.children.length, 2);
});

test("REGRESSION: when Vue recycles the same tooltip for a DIFFERENT item, the button's href updates to the new item's own params instead of staying stuck on the first one", async () => {
  installGlobals();
  const { popper, anchor } = buildTooltip({ itemName: "Reclaimed Metal", qualityId: 6, withMarketplace: true });
  global.document = makeDocument([popper]);

  addStnButton();
  await flush();
  assert.equal(getStnButton()?.href, "https://stntrading.eu/item/tf2/Reclaimed+Metal");

  // Vue patches the SAME Classifieds anchor's own href for a different item.
  anchor.setAttribute("href", "/classifieds?itemName=Refined%20Metal&quality=6");

  addStnButton();
  await flush();

  assert.equal(document.querySelectorAll(".tf2te-stn-button").length, 1);
  assert.equal(getStnButton()?.href, "https://stntrading.eu/item/tf2/Refined+Metal");
});

test("REGRESSION: an older resolve that finishes after a newer one (fast re-hover) does not overwrite the newer item's href", async () => {
  installGlobals();
  const { popper, anchor } = buildTooltip({ itemName: "Reclaimed Metal", qualityId: 6, withMarketplace: true });
  global.document = makeDocument([popper]);

  // Hold the first storage read (the Sheen/Killstreaker setting lookup inside
  // resolveStatsAndClassifieds) so the first hover's resolve stalls.
  const realGet = globalThis.chrome.storage.local.get;
  let releaseFirst;
  let held = false;
  globalThis.chrome.storage.local.get = async (...args) => {
    if (!held) {
      held = true;
      await new Promise((resolve) => (releaseFirst = resolve));
    }
    return realGet(...args);
  };

  try {
    addStnButton(); // first hover: Reclaimed Metal, stalled
    await flush();

    anchor.setAttribute("href", "/classifieds?itemName=Refined%20Metal&quality=6");
    addStnButton(); // second hover: Refined Metal, resolves right away
    await flush();
    assert.equal(getStnButton()?.href, "https://stntrading.eu/item/tf2/Refined+Metal");

    releaseFirst(); // the stale first resolve finishes last
    await flush();
  } finally {
    globalThis.chrome.storage.local.get = realGet;
  }

  assert.equal(document.querySelectorAll(".tf2te-stn-button").length, 1);
  assert.equal(getStnButton()?.href, "https://stntrading.eu/item/tf2/Refined+Metal");
});

test("the observer inserts a button for a Classifieds anchor (with marketplace.tf's own button already present) added later, in one mutation", async () => {
  installGlobals();
  global.document = makeDocument([]);

  addStnButton();
  await flush();
  assert.equal(getStnButton(), null);

  const { popper } = buildTooltip({ itemName: "Refined Metal", qualityId: 6, withMarketplace: true });
  document.body.appendChild(popper);
  FakeMutationObserver.instances[0].cb([{ addedNodes: [popper] }]);
  await flush();

  const button = getStnButton();
  assert.ok(button);
  assert.equal(button.href, "https://stntrading.eu/item/tf2/Refined+Metal");
});

test("falls back without throwing when itemName is present but empty on the Classifieds anchor's href", async () => {
  installGlobals();
  const anchor = new FakeElement("a");
  anchor.setAttribute("href", "/classifieds?itemName=&quality=6");
  anchor.className = "btn btn-outline-brand btn-item-tooltip";
  const wrap = buildContentLinksRow(anchor);
  global.document = makeDocument([wrap]);

  addStnButton();
  await flush();

  assert.equal(getStnButton(), null);
});

// Integration check against the REAL ../addMarketplaceButton/content.js (not
// this file's own buildMarketplaceRow fixture) - confirms the two files'
// selectors/classes genuinely line up. This fake MutationObserver only ever
// fires when its own .cb is called manually (it doesn't actually observe
// real DOM mutations) - marketplace.tf's own insertion is a real mutation a
// live browser's observer would catch automatically, so it's replayed by
// hand here once marketplace.tf's own async resolve has had time to finish,
// same "manually fire the retry" shape the dedicated retry test above uses.
test("works alongside the REAL addMarketplaceButton, landing stntrading.eu before it once marketplace.tf's own button appears", async () => {
  installGlobals();
  const anchor = buildClassifiedsAnchor("Reclaimed Metal", 6);
  const popper = new FakeElement("div");
  popper.classList.add("tippy-popper");
  popper.appendChild(buildContentLinksRow(anchor));
  global.document = makeDocument([popper]);

  // Real page order (see backpack.tf/content.js's own router): addStnButton
  // wired before addMarketplaceButton.
  addStnButton();
  addMarketplaceButton();
  await flush(12); // enough for marketplace.tf's own resolve+insert to land

  const marketplaceButton = document.querySelector(".tf2te-marketplace-tf-button");
  assert.ok(marketplaceButton, "expected addMarketplaceButton to have inserted its own button by now");
  assert.equal(getStnButton(), null); // not yet - STN's own observer never "saw" that real insertion

  // STN's own observer is FakeMutationObserver.instances[0] (created first,
  // by addStnButton() above) - replay the mutation a live browser's observer
  // would have delivered automatically.
  FakeMutationObserver.instances[0].cb([{ addedNodes: [marketplaceButton.parentElement] }]);
  await flush();

  const stnButton = getStnButton();
  assert.ok(stnButton);
  assert.equal(stnButton.parentElement, marketplaceButton.parentElement);
  const siblings = stnButton.parentElement.children;
  assert.ok(siblings.indexOf(stnButton) < siblings.indexOf(marketplaceButton));
});
