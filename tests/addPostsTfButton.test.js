import { test } from "node:test";
import assert from "node:assert/strict";

// See tests/tf2StatsLinksIndex.test.js's own header comment: utils/tf2Schema.js
// memoizes its result at module scope for this file's lifetime, so a single
// pre-seeded fixture installed before import (not per-test) is the right
// shape. Unlike marketplace.tf/mannco.store (which search by name, needing
// no defindex at all), posts.tf needs a real Valve defindex per item - see
// utils/tf2StatsLinks/index.js's own buildPostsTfLink - so itemNameToDefindex
// has to actually cover every item name these tests use.
// One shared object (not a fresh literal per get()): utils/tf2Schema.js
// memoizes the first one it reads, so a test can add an item here to simulate
// "a key was saved and the schema now covers it".
const schemaFixture = {
            itemNameToDefindex: {
              "Reclaimed Metal": 143,
              "Rocket Launcher": 205,
              "Bazaar Bargain": 730,
              "Team Captain": 378,
              Eyelander: 132,
              // Confirmed live: the real TF2 schema keys this under the full
              // "Taunt: " prefix, NOT the bare "Conga" - see
              // addPostsTfButton/content.js's own header note.
              "Taunt: Conga": 1118,
            },
            defindexToItemName: {},
            effectNameToId: { "Green Black Hole": 71 },
            fetchedAt: Date.now(),
            schemaShapeVersion: 4,
};
// Whether a Steam Web API key is "saved" (utils/linkButtonStates.js's
// postsTfNeedsApiKey reads it); flipped per test.
let savedSteamApiKey = null;
const storageChangedListeners = [];
const sentMessages = [];
globalThis.chrome = {
  storage: {
    local: {
      async get() {
        return { tf2SchemaCache: schemaFixture, ...(savedSteamApiKey ? { steamApiKey: savedSteamApiKey } : {}) };
      },
      async set() {},
    },
    onChanged: { addListener: (fn) => storageChangedListeners.push(fn) },
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

const { addPostsTfButton } = await import("../backpack.tf/nextUI/addPostsTfButton/content.js");

// Same hand-rolled fake DOM as tests/addMarketplaceButton.test.js (see that
// file's own header comment on why this repo hand-rolls rather than pulling
// in jsdom) - duplicated rather than shared, matching this codebase's own
// per-test-file self-containment convention.

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

function fakeTextNode(text) {
  return { nodeType: 3, textContent: String(text), children: [] };
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
    // Like the real DOM: replaces every child with one text node, so a later
    // appendChild (e.g. utils/linkButtonStates.js's key icon) sits after it.
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
  remove() {
    if (!this.parentElement) return;
    const siblings = this.parentElement.children;
    const idx = siblings.indexOf(this);
    if (idx !== -1) siblings.splice(idx, 1);
    this.parentElement = null;
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
  global.window = { location: { href: "https://next.backpack.tf/stats?item=Reclaimed+Metal&quality=Unique" } };
  global.Node = { ELEMENT_NODE: 1 };
  global.MutationObserver = FakeMutationObserver;
  FakeMutationObserver.instances = [];
}

function getPostsTfButton() {
  return document.querySelector(".tf2te-posts-tf-button");
}

// Decodes a posts.tf search URL's own "q" param the same way
// utils/tf2StatsLinks/index.js's buildPostsTfLink encodes it - see
// tests/tf2StatsLinksIndex.test.js's own decodePostsTfQuery for the full
// confirmed-live write-up.
function decodePostsTfQuery(href) {
  const b64 = new URL(href).searchParams.get("q");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
}

function buildClassifiedsAnchor(itemName, qualityId, { scopedAttr = "data-v-b49f43c8", particle = null } = {}) {
  const anchor = new FakeElement("a");
  let href = `/classifieds?itemName=${encodeURIComponent(itemName)}&quality=${qualityId}`;
  // Confirmed live: next.backpack.tf's own Classifieds anchor already
  // carries the exact effect id directly for an Unusual Taunt
  // ("...&particle=3072") - see addPostsTfButton/content.js's own
  // knownEffectId note.
  if (particle != null) href += `&particle=${particle}`;
  anchor.setAttribute("href", href);
  anchor.className = "btn btn-outline-brand btn-item-tooltip";
  if (scopedAttr) anchor.setAttribute(scopedAttr, "");
  return anchor;
}

function buildContentLinksRow(anchor) {
  const row = new FakeElement("div");
  row.className = "item-tooltip__content__links";
  row.appendChild(anchor);
  return row;
}

// Same shape ../addPricedbButton/content.js's own test file's
// buildGladiatorRow builds - a standalone "item-tooltip__content__links
// mb-1" row containing just the pricedb.io button, this file's own
// insertion point (see addPostsTfButton/content.js's own header note on why
// it anchors off pricedb.io's button rather than building its own row).
function buildPricedbRow({ scopedAttr = "data-v-pricedb123" } = {}) {
  const button = new FakeElement("a");
  button.className = "btn btn-outline-brand btn-item-tooltip tf2te-pricedb-button";
  if (scopedAttr) button.setAttribute(scopedAttr, "");
  button.textContent = "pricedb.io";

  const row = new FakeElement("div");
  row.className = "item-tooltip__content__links mb-1";
  row.appendChild(button);
  return { row, button };
}

// Same shape as buildPricedbRow above, for gladiator.tf's own button - the
// fallback anchor point (see addPostsTfButton/content.js's own
// findAnchorButton note: pricedb.io's own button can fail/not appear for
// reasons unrelated to this file, e.g. an Unusual Taunt whose own
// pricedb.io /api/search lookup came back empty).
function buildGladiatorRow({ scopedAttr = "data-v-gladiator123" } = {}) {
  const button = new FakeElement("a");
  button.className = "btn btn-outline-brand btn-item-tooltip tf2te-gladiator-tf-button";
  if (scopedAttr) button.setAttribute(scopedAttr, "");
  button.textContent = "gladiator.tf";

  const row = new FakeElement("div");
  row.className = "item-tooltip__content__links mb-1";
  row.appendChild(button);
  return { row, button };
}

function buildSpecialAttributeRow(name) {
  const row = new FakeElement("div");
  row.classList.add("special-attribute");
  const nameDiv = new FakeElement("div");
  nameDiv.classList.add("special-attribute__name");
  nameDiv.textContent = `\n    ${name}\n  `;
  row.appendChild(nameDiv);
  return row;
}

function buildTooltip({
  itemName,
  qualityId,
  effectName,
  particle,
  sheenName,
  killstreakerName,
  spellName,
  basicKillstreak,
  titleText,
  paintName,
  withPricedb = true,
  withGladiator = false,
} = {}) {
  const popper = new FakeElement("div");
  popper.classList.add("tippy-popper");

  if (titleText) {
    const titleDiv = new FakeElement("div");
    titleDiv.classList.add("item-tooltip__header__title");
    titleDiv.textContent = `\n      ${titleText}\n    `;
    popper.appendChild(titleDiv);
  }

  if (effectName) {
    const effectLink = new FakeElement("a");
    effectLink.setAttribute("href", `/effects/${encodeURIComponent(effectName)}`);
    const nameDiv = new FakeElement("div");
    nameDiv.classList.add("special-attribute__name");
    nameDiv.textContent = `\n    ${effectName}\n  `;
    effectLink.appendChild(nameDiv);
    popper.appendChild(effectLink);
  }

  if (spellName || sheenName || killstreakerName || basicKillstreak || paintName) {
    const attrRow = new FakeElement("div");
    attrRow.classList.add("d-flex", "row", "g-1", "mx-0");
    if (spellName) attrRow.appendChild(buildSpecialAttributeRow(spellName));
    if (basicKillstreak) attrRow.appendChild(buildSpecialAttributeRow("Standard"));
    if (killstreakerName) attrRow.appendChild(buildSpecialAttributeRow(killstreakerName));
    if (sheenName) attrRow.appendChild(buildSpecialAttributeRow(sheenName));
    if (paintName) attrRow.appendChild(buildSpecialAttributeRow(paintName));
    popper.appendChild(attrRow);
  }

  const anchor = buildClassifiedsAnchor(itemName, qualityId, { particle });
  const linksWrap = buildContentLinksRow(anchor);
  popper.appendChild(linksWrap);

  let pricedbButton = null;
  if (withPricedb) {
    const { row, button } = buildPricedbRow();
    popper.appendChild(row);
    pricedbButton = button;
  }

  let gladiatorButton = null;
  if (withGladiator) {
    const { row, button } = buildGladiatorRow();
    popper.appendChild(row);
    gladiatorButton = button;
  }

  return { popper, anchor, pricedbButton, gladiatorButton };
}

test("inserts a posts.tf button searching by defindex/quality/craftable for a plain Unique item", async () => {
  installGlobals();
  const anchor = buildClassifiedsAnchor("Reclaimed Metal", 6); // Unique
  const wrap = buildContentLinksRow(anchor);
  const { row: pricedbRow } = buildPricedbRow();
  global.document = makeDocument([wrap, pricedbRow]);

  addPostsTfButton();
  await flush();

  const button = getPostsTfButton();
  assert.ok(button);
  assert.equal(button.textContent, "posts.tf");
  const query = decodePostsTfQuery(button.href);
  assert.deepEqual(query, { u: [{ defindex: 143, quality: 6, craftable: true }], p: [], d: "", m: false });
});

test("reconstructs the quality-word prefix for a non-Unique item, since the Classifieds anchor's own itemName/quality params are separate but posts.tf needs the resolved quality id, not the bare name", async () => {
  installGlobals();
  const anchor = buildClassifiedsAnchor("Rocket Launcher", 11); // Strange
  const wrap = buildContentLinksRow(anchor);
  const { row: pricedbRow } = buildPricedbRow();
  global.document = makeDocument([wrap, pricedbRow]);

  addPostsTfButton();
  await flush();

  const query = decodePostsTfQuery(getPostsTfButton().href);
  assert.equal(query.u[0].quality, 11);
  assert.equal(query.u[0].defindex, 205);
});

test("includes the tooltip's own Unusual-effect label as a numeric particle id", async () => {
  installGlobals();
  const { popper } = buildTooltip({ itemName: "Team Captain", qualityId: 5, effectName: "Green Black Hole" });
  global.document = makeDocument([popper]);

  addPostsTfButton();
  await flush();

  const query = decodePostsTfQuery(getPostsTfButton().href);
  assert.equal(query.u[0].effect, 71);
});

test("derives killstreak=3 (Professional) from the tooltip's own Killstreaker row, against the BASE weapon's own defindex", async () => {
  installGlobals();
  const { popper } = buildTooltip({ itemName: "Rocket Launcher", qualityId: 11, sheenName: "Manndarin", killstreakerName: "Fire Horns" });
  global.document = makeDocument([popper]);

  addPostsTfButton();
  await flush();

  const query = decodePostsTfQuery(getPostsTfButton().href);
  assert.deepEqual(query.u[0], { defindex: 205, quality: 11, craftable: true, killstreak: 3 });
});

// Same "australium=1" anchor param addMarketplaceButton/content.js reads -
// posts.tf's own search supports an australium flag (see
// utils/tf2StatsLinks/index.js's buildPostsTfLink).
test("marks an Australium weapon as australium, read off the Classifieds anchor's own australium=1 param", async () => {
  installGlobals();
  const { popper, anchor } = buildTooltip({ itemName: "Rocket Launcher", qualityId: 11 });
  anchor.setAttribute("href", "/classifieds?itemName=Rocket%20Launcher&quality=11&australium=1");
  global.document = makeDocument([popper]);

  addPostsTfButton();
  await flush();

  const query = decodePostsTfQuery(getPostsTfButton().href);
  assert.equal(query.u[0].australium, true);
});

test("includes the tooltip's own Paint row as its plain NAME (not marketplace.tf's derived RGB id)", async () => {
  installGlobals();
  const { popper } = buildTooltip({ itemName: "Team Captain", qualityId: 6, paintName: "A Deep Commitment to Purple" });
  global.document = makeDocument([popper]);

  addPostsTfButton();
  await flush();

  const query = decodePostsTfQuery(getPostsTfButton().href);
  assert.equal(query.u[0].paint, "A Deep Commitment to Purple");
});

test("includes the tooltip's own Halloween Spell row as a one-element spells array", async () => {
  installGlobals();
  const { popper } = buildTooltip({ itemName: "Bazaar Bargain", qualityId: 11, spellName: "Exorcism" });
  global.document = makeDocument([popper]);

  addPostsTfButton();
  await flush();

  const query = decodePostsTfQuery(getPostsTfButton().href);
  assert.deepEqual(query.u[0].spells, ["Exorcism"]);
});

test("does not insert a button for a Killstreak Kit - not built yet, resolveStatsAndClassifieds' own postsTfHref is null for that item type", async () => {
  installGlobals();
  const { popper } = buildTooltip({ itemName: "Kit", qualityId: 6, titleText: "Professional Killstreak Eyelander Kit" });
  global.document = makeDocument([popper]);

  addPostsTfButton();
  await flush();

  assert.equal(getPostsTfButton(), null);
});

// Vue reuses one tooltip for every hovered item. When the new item is a
// type posts.tf can't search (here a Killstreak Kit), the previous item's
// button must go rather than keep linking to the wrong item.
test("REGRESSION: when a recycled tooltip's new item has no posts.tf link, the previous item's button is removed rather than left linking to the wrong item", async () => {
  installGlobals();
  const { popper, anchor } = buildTooltip({ itemName: "Reclaimed Metal", qualityId: 6, titleText: "Reclaimed Metal" });
  global.document = makeDocument([popper]);

  addPostsTfButton();
  await flush();
  assert.ok(getPostsTfButton());

  popper.children[0].textContent = "Professional Killstreak Eyelander Kit"; // the title div
  anchor.setAttribute("href", "/classifieds?itemName=Kit&quality=6");

  addPostsTfButton();
  await flush();

  assert.equal(getPostsTfButton(), null);
});

test("inserts the posts.tf button as a sibling right after the pricedb.io button (same row), cloning ITS classes/scoped-style attribute, not the Classifieds anchor's", async () => {
  installGlobals();
  const anchor = buildClassifiedsAnchor("Reclaimed Metal", 6);
  const wrap = buildContentLinksRow(anchor);
  const { row: pricedbRow, button: pricedbButton } = buildPricedbRow();
  global.document = makeDocument([wrap, pricedbRow]);

  addPostsTfButton();
  await flush();

  assert.equal(wrap.children.length, 1); // native Classifieds row untouched
  assert.equal(pricedbRow.children.length, 2); // [pricedbButton, postsTfButton]
  assert.equal(pricedbRow.children[0], pricedbButton);

  const button = getPostsTfButton();
  assert.equal(button, pricedbRow.children[1]);
  assert.ok(button.classList.contains("btn-item-tooltip"));
  assert.ok(button.classList.contains("tf2te-pricedb-button") === false); // cloned classes, not the class itself
  assert.ok(button.classList.contains("tf2te-posts-tf-button"));
  assert.equal(button.target, "_blank");
  assert.equal(button.rel, "noopener noreferrer");
  assert.equal(button.getAttribute("data-v-pricedb123"), ""); // cloned from pricedb.io's own scoped-style attr
});

test("does not insert a button when pricedb.io's own button isn't there yet, but retries and succeeds once a later mutation adds it (doesn't permanently claim the signature early)", async () => {
  installGlobals();
  const { popper, anchor } = buildTooltip({ itemName: "Reclaimed Metal", qualityId: 6, withPricedb: false }); // no pricedb button yet
  global.document = makeDocument([popper]);

  addPostsTfButton();
  await flush();
  assert.equal(getPostsTfButton(), null);

  // pricedb.io's own button shows up moments later (its own async/observer
  // timing) - this file's own observer sees that same insertion and retries.
  const { row: pricedbRow, button: pricedbButton } = buildPricedbRow();
  popper.appendChild(pricedbRow);
  FakeMutationObserver.instances[0].cb([{ addedNodes: [pricedbRow] }]);
  await flush();

  const button = getPostsTfButton();
  assert.ok(button);
  assert.equal(button.parentElement, pricedbButton.parentElement);
});

test("does not insert a second button when the same unchanged Classifieds anchor is scanned twice (content-signature dedupe)", async () => {
  installGlobals();
  const anchor = buildClassifiedsAnchor("Reclaimed Metal", 6);
  const wrap = buildContentLinksRow(anchor);
  const { row: pricedbRow } = buildPricedbRow();
  global.document = makeDocument([wrap, pricedbRow]);

  addPostsTfButton();
  await flush();
  assert.equal(pricedbRow.children.length, 2);

  addPostsTfButton();
  await flush();
  assert.equal(pricedbRow.children.length, 2);
});

test("skips a Classifieds anchor with no itemName query param without throwing", async () => {
  installGlobals();
  const anchor = new FakeElement("a");
  anchor.setAttribute("href", "/classifieds?quality=6");
  anchor.className = "btn btn-outline-brand btn-item-tooltip";
  const wrap = buildContentLinksRow(anchor);
  global.document = makeDocument([wrap]);

  addPostsTfButton();
  await flush();

  assert.equal(wrap.children.length, 1);
});

test("the observer inserts a button for a Classifieds anchor added later (tooltip shown after initial page load)", async () => {
  installGlobals();
  global.document = makeDocument([]);
  addPostsTfButton();
  await flush();

  const anchor = buildClassifiedsAnchor("Rocket Launcher", 6);
  const wrap = buildContentLinksRow(anchor);
  const { row: pricedbRow } = buildPricedbRow();
  document.body.appendChild(wrap);
  document.body.appendChild(pricedbRow);

  FakeMutationObserver.instances[0].cb([{ addedNodes: [wrap, pricedbRow] }]);
  await flush();

  assert.equal(getPostsTfButton().textContent, "posts.tf");
});

test("addPostsTfButton sets up a subtree MutationObserver on document.body", () => {
  installGlobals();
  global.document = makeDocument([]);

  addPostsTfButton();

  assert.equal(FakeMutationObserver.instances.length, 1);
  assert.equal(FakeMutationObserver.instances[0].target, document.body);
  assert.deepEqual(FakeMutationObserver.instances[0].opts, { childList: true, subtree: true });
});

// Regression: an Unusual Taunt got no posts.tf button at all. Root cause
// was two gaps stacked together - NOT the "Taunt: " name prefix first
// suspected (confirmed live: "Taunt: Conga" IS the real TF2 schema key,
// see this file's own itemNameToDefindex fixture note).

test("falls back to gladiator.tf's own button when pricedb.io's isn't present at all, so this button's own visibility doesn't depend on an unrelated feature's success", async () => {
  installGlobals();
  const { popper } = buildTooltip({
    itemName: "Taunt: Conga",
    qualityId: 5, // Unusual
    particle: 3072, // the effect id, carried directly on the Classifieds anchor's own href
    withPricedb: false, // pricedb.io's own /api/search came back empty for this exact Taunt
    withGladiator: true,
  });
  global.document = makeDocument([popper]);

  addPostsTfButton();
  await flush();

  const button = getPostsTfButton();
  assert.ok(button);
  const query = decodePostsTfQuery(button.href);
  assert.deepEqual(query.u[0], { defindex: 1118, quality: 5, craftable: true, effect: 3072 });
});

test("reads the effect id directly off the Classifieds anchor's own 'particle' param when no '/effects/' link exists in the tooltip - confirmed live: an Unusual Taunt's own tooltip renders no such link at all, unlike a regular Unusual cosmetic", async () => {
  installGlobals();
  const { popper } = buildTooltip({
    itemName: "Taunt: Conga",
    qualityId: 5,
    particle: 3072,
    // no effectName - no "/effects/" link at all, matching a real Taunt's tooltip
  });
  global.document = makeDocument([popper]);

  addPostsTfButton();
  await flush();

  const query = decodePostsTfQuery(getPostsTfButton().href);
  assert.equal(query.u[0].effect, 3072);
});

test("does not mistake the 'particle=none' sentinel (next.backpack.tf's own convention for 'no effect') for a literal effect id", async () => {
  installGlobals();
  const anchor = buildClassifiedsAnchor("Reclaimed Metal", 6, { particle: "none" });
  const wrap = buildContentLinksRow(anchor);
  const { row: pricedbRow } = buildPricedbRow();
  global.document = makeDocument([wrap, pricedbRow]);

  addPostsTfButton();
  await flush();

  const query = decodePostsTfQuery(getPostsTfButton().href);
  assert.equal(query.u[0].effect, undefined);
});

// --- missing Steam Web API key hint (utils/linkButtonStates.js) ---

test("with no Steam Web API key saved, an item the schema can't resolve gets a dimmed key-hint button instead of nothing", async () => {
  installGlobals();
  savedSteamApiKey = null;
  const anchor = buildClassifiedsAnchor("Brotherhood of Arms", 6);
  const wrap = buildContentLinksRow(anchor);
  const { row: pricedbRow } = buildPricedbRow();
  global.document = makeDocument([wrap, pricedbRow]);

  addPostsTfButton();
  await flush();

  const button = getPostsTfButton();
  assert.ok(button, "expected the key-hint button in posts.tf's usual spot");
  assert.equal(button.dataset.tf2teNeedsKey, "1");
  assert.equal(button.getAttribute("href"), null);
  assert.equal(button.textContent, "posts.tf");
  assert.match(button.title, /Steam Web API key/);
});

test("clicking the key-hint button asks the background to open the Steam key settings", async () => {
  installGlobals();
  savedSteamApiKey = null;
  sentMessages.length = 0;
  const anchor = buildClassifiedsAnchor("Brotherhood of Arms", 6);
  const wrap = buildContentLinksRow(anchor);
  const { row: pricedbRow } = buildPricedbRow();
  global.document = makeDocument([wrap, pricedbRow]);

  addPostsTfButton();
  await flush();
  getPostsTfButton().dispatchEvent({ type: "click" });

  assert.deepEqual(sentMessages, [{ type: "OPEN_STEAM_API_KEY_SETTINGS" }]);
});

test("with a key saved, an item that still doesn't resolve gets no hint (a key wouldn't help)", async () => {
  installGlobals();
  savedSteamApiKey = "ABC123";
  try {
    const anchor = buildClassifiedsAnchor("Some Brand New Hat", 6);
    const wrap = buildContentLinksRow(anchor);
    const { row: pricedbRow } = buildPricedbRow();
    global.document = makeDocument([wrap, pricedbRow]);

    addPostsTfButton();
    await flush();

    assert.equal(getPostsTfButton(), null);
  } finally {
    savedSteamApiKey = null;
  }
});

test("saving a key turns an open tooltip's key-hint button into the real posts.tf link without a re-hover", async () => {
  installGlobals();
  savedSteamApiKey = null;
  storageChangedListeners.length = 0;
  const anchor = buildClassifiedsAnchor("Brotherhood of Arms", 6);
  const wrap = buildContentLinksRow(anchor);
  const { row: pricedbRow } = buildPricedbRow();
  global.document = makeDocument([wrap, pricedbRow]);

  addPostsTfButton();
  await flush();
  assert.equal(getPostsTfButton().dataset.tf2teNeedsKey, "1");

  // The key gets saved and the schema now covers the item.
  savedSteamApiKey = "ABC123";
  schemaFixture.itemNameToDefindex["Brotherhood of Arms"] = 30066;
  try {
    for (const listener of storageChangedListeners) listener({ steamApiKey: { newValue: "ABC123" } }, "local");
    await flush();

    const button = getPostsTfButton();
    assert.equal(button.dataset.tf2teNeedsKey, undefined);
    assert.equal(button.textContent, "posts.tf");
    assert.deepEqual(decodePostsTfQuery(button.href).u, [{ defindex: 30066, quality: 6, craftable: true }]);
    assert.equal(document.querySelectorAll(".tf2te-posts-tf-button").length, 1);
  } finally {
    delete schemaFixture.itemNameToDefindex["Brotherhood of Arms"];
    savedSteamApiKey = null;
  }
});

test("an item type posts.tf doesn't cover (a Killstreak Kit) gets no key hint even without a key", async () => {
  installGlobals();
  savedSteamApiKey = null;
  const { popper } = buildTooltip({ itemName: "Kit", qualityId: 6, titleText: "Professional Killstreak Eyelander Kit" });
  global.document = makeDocument([popper]);

  addPostsTfButton();
  await flush();

  assert.equal(getPostsTfButton(), null);
});
