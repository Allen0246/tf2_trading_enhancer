import { test } from "node:test";
import assert from "node:assert/strict";

// isSheenKillstreakerFilterEnabled's own storage read + the module's
// chrome.storage.onChanged watcher (see content.js's own
// ensureSheenKillstreakerFilterWatcher note) both need a minimal chrome
// fake, lazily touched on the first actual button build rather than at
// import time - default-enabled (get() returns {}, same "absent reads as
// enabled" convention utils/sheenKillstreakerFilterSetting.js documents).
// The watcher only ever registers once (module-level guard), so a LATER test
// that wants to simulate the setting changing mid-session fires it through
// this same captured listener, not by re-overriding get() (which the watcher
// would never re-read).
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

import { addMannStoreButton } from "../backpack.tf/nextUI/addMannStoreButton/content.js";

// Minimal hand-rolled fake DOM (see tests/addMarketplaceButton.test.js's own
// header comment for why this repo hand-rolls this instead of pulling in
// jsdom) - same shape tests/addPricedbButton.test.js/tests/addMarketplaceButton.test.js
// already use, extended with the `^=` prefix matcher
// tests/addMarketplaceButton.test.js's own copy has (needed for this file's
// own EFFECT_LINK_SELECTOR/SKIN_LINK_SELECTOR).

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

function getMannStoreButton() {
  return document.querySelector(".tf2te-mannco-store-button");
}

function mannStoreParams(button) {
  return new URL(button.href, "https://mannco.store/").searchParams;
}

// Same shape confirmed live in next.backpack.tf's item-preview tooltip:
// <a href="/classifieds?itemName=...&quality=11" class="btn btn-outline-brand btn-item-tooltip">
function buildClassifiedsAnchor(itemName, qualityId, { scopedAttr = "data-v-b49f43c8", targetItem } = {}) {
  const anchor = new FakeElement("a");
  let href = `/classifieds?itemName=${encodeURIComponent(itemName)}&quality=${qualityId}`;
  if (targetItem) href += `&targetItem=${encodeURIComponent(targetItem)}`;
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

// Same shape backpack.tf/nextUI/shared/tooltipButtonRow.js's buildTooltipButtonRow
// builds - a standalone "item-tooltip__content__links mb-1" row containing
// just the marketplace.tf button, this file's own insertion point.
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

// Builds one Sheen/Killstreaker/Paint/Festivized/Standard attribute row,
// confirmed live shape - see tests/addMarketplaceButton.test.js's own
// buildSpecialAttributeRow.
function buildSpecialAttributeRow(name) {
  const row = new FakeElement("div");
  row.classList.add("special-attribute");
  const nameDiv = new FakeElement("div");
  nameDiv.classList.add("special-attribute__name");
  nameDiv.textContent = `\n    ${name}\n  `;
  row.appendChild(nameDiv);
  return row;
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

function buildSkinLink(name) {
  const link = new FakeElement("a");
  link.setAttribute("href", `/war-paints/${encodeURIComponent(name)}`);
  const nameDiv = new FakeElement("div");
  nameDiv.classList.add("special-attribute__name");
  nameDiv.textContent = `\n    ${name}\n  `;
  link.appendChild(nameDiv);
  return link;
}

// Builds a ".tippy-popper" tooltip shell (confirmed live) with the
// Classifieds anchor, any known-attribute rows requested, and (when
// withMarketplace is true) a marketplace.tf button/row already in place -
// this file's own insertion point, so most tests need one present the same
// way a real page would already have ../addMarketplaceButton/content.js's own
// observer run first.
function buildTooltip({
  itemName,
  qualityId,
  effectName,
  skinName,
  sheenName,
  killstreakerName,
  paintName,
  festivized,
  basicKillstreak,
  targetItem,
  withMarketplace = false,
} = {}) {
  const popper = new FakeElement("div");
  popper.classList.add("tippy-popper");

  if (effectName) popper.appendChild(buildEffectLink(effectName));

  if (sheenName || killstreakerName || paintName || festivized || basicKillstreak) {
    const attrRow = new FakeElement("div");
    if (festivized) attrRow.appendChild(buildSpecialAttributeRow("Festivized"));
    if (basicKillstreak) attrRow.appendChild(buildSpecialAttributeRow("Standard"));
    if (killstreakerName) attrRow.appendChild(buildSpecialAttributeRow(killstreakerName));
    if (sheenName) attrRow.appendChild(buildSpecialAttributeRow(sheenName));
    if (paintName) attrRow.appendChild(buildSpecialAttributeRow(paintName));
    popper.appendChild(attrRow);
  }

  if (skinName) popper.appendChild(buildSkinLink(skinName));

  const anchor = buildClassifiedsAnchor(itemName, qualityId, { targetItem });
  const linksWrap = buildContentLinksRow(anchor);
  popper.appendChild(linksWrap);

  let marketplaceButton = null;
  if (withMarketplace) {
    const { row, button } = buildMarketplaceRow();
    popper.appendChild(row);
    marketplaceButton = button;
  }

  return { popper, anchor, marketplaceButton };
}

test("plain Strange item with no killstreak/skin: search/quality set, festivized/killstreak/warpaints default to their 'none' values, no sheen/killstreaker/paint/effect", async () => {
  installGlobals();
  const { popper } = buildTooltip({ itemName: "Rocket Launcher", qualityId: 11, withMarketplace: true });
  global.document = makeDocument([popper]);

  addMannStoreButton();
  await flush();

  const params = mannStoreParams(getMannStoreButton());
  assert.equal(params.get("search"), "Rocket Launcher");
  assert.equal(params.get("quality"), "Strange");
  assert.equal(params.get("festivized"), "No festivized");
  assert.equal(params.get("killstreak"), "No");
  assert.equal(params.get("warpaints"), "No WarPaints");
  assert.equal(params.has("sheen"), false);
  assert.equal(params.has("killstreaker"), false);
  assert.equal(params.has("paint"), false);
  assert.equal(params.has("effect"), false);
});

test("Basic Killstreak (the 'Standard' attribute row) maps to killstreak=Killstreak", async () => {
  installGlobals();
  const { popper } = buildTooltip({ itemName: "Rocket Launcher", qualityId: 11, basicKillstreak: true, withMarketplace: true });
  global.document = makeDocument([popper]);

  addMannStoreButton();
  await flush();

  assert.equal(mannStoreParams(getMannStoreButton()).get("killstreak"), "Killstreak");
});

test("Specialized Killstreak (Sheen present, no Killstreaker) maps to killstreak=Specialized Killstreak and includes the sheen param", async () => {
  installGlobals();
  const { popper } = buildTooltip({ itemName: "Rocket Launcher", qualityId: 11, sheenName: "Agonizing Emerald", withMarketplace: true });
  global.document = makeDocument([popper]);

  addMannStoreButton();
  await flush();

  const params = mannStoreParams(getMannStoreButton());
  assert.equal(params.get("killstreak"), "Specialized Killstreak");
  assert.equal(params.get("sheen"), "Agonizing Emerald");
  assert.equal(params.has("killstreaker"), false);
});

test("Professional Killstreak (Sheen + Killstreaker both present) maps to killstreak=Professional Killstreak and includes both params", async () => {
  installGlobals();
  const { popper } = buildTooltip({
    itemName: "Rocket Launcher",
    qualityId: 11,
    sheenName: "Agonizing Emerald",
    killstreakerName: "Fire Horns",
    withMarketplace: true,
  });
  global.document = makeDocument([popper]);

  addMannStoreButton();
  await flush();

  const params = mannStoreParams(getMannStoreButton());
  assert.equal(params.get("killstreak"), "Professional Killstreak");
  assert.equal(params.get("sheen"), "Agonizing Emerald");
  assert.equal(params.get("killstreaker"), "Fire Horns");
});

// REGRESSION for a live bug report, with a real confirmed-working
// mannco.store URL ("search=Australium+Medi+Gun") for a "Professional
// Killstreak Australium Medi Gun": this file's own comment used to (wrongly)
// claim itemName already carries "Australium" as a literal word when
// present - confirmed live it does NOT for this real example; the anchor
// instead carries a separate "australium=1" boolean param, with itemName
// staying completely bare ("Medi Gun"). Unlike marketplace.tf (a dedicated
// saustralium filter param), mannco.store has no such filter, so the word
// has to be embedded directly into the search text.
test("reads the Classifieds anchor's own 'australium=1' param and embeds 'Australium ' into the search text", async () => {
  installGlobals();
  const { popper, anchor } = buildTooltip({
    itemName: "Medi Gun",
    qualityId: 11, // Strange
    sheenName: "Team Shine",
    killstreakerName: "Tornado",
    withMarketplace: true,
  });
  anchor.setAttribute("href", `${anchor.getAttribute("href")}&killstreakTier=3&australium=1`);
  global.document = makeDocument([popper]);

  addMannStoreButton();
  await flush();

  const params = mannStoreParams(getMannStoreButton());
  assert.equal(params.get("search"), "Australium Medi Gun");
  assert.equal(params.get("quality"), "Strange");
  assert.equal(params.get("killstreak"), "Professional Killstreak");
});

// New feature: Sheen/Killstreaker filtering is user-toggleable via a General
// settings checkbox, default on - simulated here via
// chrome.storage.onChanged (see this file's own
// fireSheenKillstreakerFilterChange note), the same mechanism a real Save in
// the popup fires. When off, the tooltip's own attribute scan still detects
// the Killstreak tier correctly (a separate signal from the specific
// Sheen/Killstreaker names), but the built href omits both params.
test("omits sheen/killstreaker from the mannco.store link once the filter setting is turned off", async () => {
  installGlobals();
  fireSheenKillstreakerFilterChange(false);
  try {
    const { popper } = buildTooltip({
      itemName: "Rocket Launcher",
      qualityId: 11,
      sheenName: "Agonizing Emerald",
      killstreakerName: "Fire Horns",
      withMarketplace: true,
    });
    global.document = makeDocument([popper]);

    addMannStoreButton();
    await flush();

    const params = mannStoreParams(getMannStoreButton());
    assert.equal(params.get("killstreak"), "Professional Killstreak");
    assert.equal(params.has("sheen"), false);
    assert.equal(params.has("killstreaker"), false);
  } finally {
    fireSheenKillstreakerFilterChange(true); // restore default for every later test in this file
  }
});

test("Unique item with a Paint: quality=Unique, paint param set", async () => {
  installGlobals();
  const { popper } = buildTooltip({ itemName: "Troublemaker's Tossle Cap", qualityId: 6, paintName: "After Eight", withMarketplace: true });
  global.document = makeDocument([popper]);

  addMannStoreButton();
  await flush();

  const params = mannStoreParams(getMannStoreButton());
  assert.equal(params.get("search"), "Troublemaker's Tossle Cap");
  assert.equal(params.get("quality"), "Unique");
  assert.equal(params.get("paint"), "After Eight");
});

test("Unusual with an effect: quality=Unusual, effect param set", async () => {
  installGlobals();
  const { popper } = buildTooltip({ itemName: "Troublemaker's Tossle Cap", qualityId: 5, effectName: "Death at Dusk", withMarketplace: true });
  global.document = makeDocument([popper]);

  addMannStoreButton();
  await flush();

  const params = mannStoreParams(getMannStoreButton());
  assert.equal(params.get("quality"), "Unusual");
  assert.equal(params.get("effect"), "Death at Dusk");
});

test("REGRESSION: Paint is never applied for an Unusual item", async () => {
  installGlobals();
  const { popper } = buildTooltip({
    itemName: "Troublemaker's Tossle Cap",
    qualityId: 5,
    effectName: "Death at Dusk",
    paintName: "After Eight",
    withMarketplace: true,
  });
  global.document = makeDocument([popper]);

  addMannStoreButton();
  await flush();

  const params = mannStoreParams(getMannStoreButton());
  assert.equal(params.get("effect"), "Death at Dusk");
  assert.equal(params.has("paint"), false);
});

// REGRESSION for a live bug report, with a real screenshot ("Widowmaker
// Strangifier" searched as just "Strangifier" on stntrading.eu - a separate
// file, but the SAME root cause applies here too): this file never read the
// Classifieds anchor's own "targetItem" param at all, so a target-item
// tool's mannco.store search always lost the target weapon. Confirmed live
// that param IS present on next.backpack.tf's own Classifieds anchor for one
// of these (see utils/tf2StatsLinks/index.js's own resolveClassifiedsFilters
// note) - qualityId here is 6 (Unique), same as every Strangifier's own
// fixed quality.
test("builds a target-aware mannco.store search ('{target} Strangifier') for a Strangifier, reading the Classifieds anchor's own targetItem param, instead of losing the target weapon", async () => {
  installGlobals();
  const { popper } = buildTooltip({ itemName: "Strangifier", qualityId: 6, targetItem: "Widowmaker", withMarketplace: true });
  global.document = makeDocument([popper]);

  addMannStoreButton();
  await flush();

  const params = mannStoreParams(getMannStoreButton());
  assert.equal(params.get("search"), "Widowmaker Strangifier");
  // Confirmed-live shape is a bare "search" param alone - no quality/
  // festivized/killstreak/warpaints structure for a target-item tool.
  assert.equal(params.has("quality"), false);
  assert.equal(params.has("festivized"), false);
});

// Same fix, the OTHER target-item tool shape (a Strangifier Chemistry Set) -
// confirmed-live mannco.store shape: "search={target} Strangifier {itemName}".
test("builds a target-aware mannco.store search for a Strangifier Chemistry Set ('{target} Strangifier {itemName}')", async () => {
  installGlobals();
  const { popper } = buildTooltip({ itemName: "Chemistry Set", qualityId: 6, targetItem: "Professor Speks", withMarketplace: true });
  global.document = makeDocument([popper]);

  addMannStoreButton();
  await flush();

  const params = mannStoreParams(getMannStoreButton());
  assert.equal(params.get("search"), "Professor Speks Strangifier Chemistry Set");
});

// A Kit's Classifieds anchor names it just "Kit" (see
// tooltipItemDetails.js's isKillstreakToolName); the full name is the
// tooltip title. Same search shape as steamcommunity.com/shared/
// quickLinkButtons.js's buildMannStoreHref for a Kit.
test("REGRESSION: a Killstreak Kit searches by the tooltip title's full name plus its Sheen/Killstreaker, not the bare 'Kit' itemName", async () => {
  installGlobals();
  const { popper } = buildTooltip({
    itemName: "Kit",
    qualityId: 6,
    sheenName: "Hot Rod",
    killstreakerName: "Incinerator",
    withMarketplace: true,
  });
  const title = new FakeElement("div");
  title.classList.add("item-tooltip__header__title");
  title.textContent = "Professional Killstreak Conniver's Kunai Kit";
  popper.appendChild(title);
  global.document = makeDocument([popper]);

  addMannStoreButton();
  await flush();

  const params = mannStoreParams(getMannStoreButton());
  assert.equal(params.get("search"), "Professional Killstreak Conniver's Kunai Kit");
  assert.equal(params.get("sheen"), "Hot Rod");
  assert.equal(params.get("killstreaker"), "Incinerator");
  assert.equal(params.has("quality"), false);
});

test("a Decorated Weapon skin sets warpaints to the skin name instead of 'No WarPaints', combined with Festivized", async () => {
  installGlobals();
  const { popper } = buildTooltip({ itemName: "Rocket Launcher", qualityId: 6, skinName: "Potent Poison", festivized: true, withMarketplace: true });
  global.document = makeDocument([popper]);

  addMannStoreButton();
  await flush();

  const params = mannStoreParams(getMannStoreButton());
  assert.equal(params.get("warpaints"), "Potent Poison");
  assert.equal(params.get("festivized"), "Festivized");
});

test("does not insert a button when marketplace.tf's own button isn't there yet, but retries and succeeds once a later mutation adds it (doesn't permanently claim the signature early)", async () => {
  installGlobals();
  const { popper } = buildTooltip({ itemName: "Reclaimed Metal", qualityId: 6 }); // no marketplace button yet
  global.document = makeDocument([popper]);

  addMannStoreButton();
  await flush();
  assert.equal(getMannStoreButton(), null);

  // marketplace.tf's own button shows up moments later (its own async schema
  // resolve) - this file's own observer sees that same insertion and retries.
  const { row, button: marketplaceButton } = buildMarketplaceRow();
  popper.appendChild(row);
  FakeMutationObserver.instances[0].cb([{ addedNodes: [row] }]);
  await flush();

  const button = getMannStoreButton();
  assert.ok(button);
  assert.equal(button.parentElement, marketplaceButton.parentElement);
});

test("inserts the mannco.store button as a sibling right after the marketplace.tf button (same row), cloning ITS classes/scoped-style attribute, not the Classifieds anchor's", async () => {
  installGlobals();
  const { popper, marketplaceButton } = buildTooltip({ itemName: "Reclaimed Metal", qualityId: 6, withMarketplace: true });
  global.document = makeDocument([popper]);

  addMannStoreButton();
  await flush();

  const marketplaceRow = marketplaceButton.parentElement;
  assert.equal(marketplaceRow.children.length, 2); // [marketplaceButton, mannStoreButton]
  assert.equal(marketplaceRow.children[0], marketplaceButton);

  const button = getMannStoreButton();
  assert.equal(button, marketplaceRow.children[1]);
  assert.equal(button.textContent, "mannco.store");
  assert.ok(button.classList.contains("btn-item-tooltip"));
  assert.ok(button.classList.contains("tf2te-marketplace-tf-button") === false); // cloned classes, not the class itself
  assert.ok(button.classList.contains("tf2te-mannco-store-button"));
  assert.equal(button.target, "_blank");
  assert.equal(button.rel, "noopener noreferrer");
  assert.equal(button.getAttribute("data-v-marketplace123"), ""); // copied from the marketplace.tf button, not the Classifieds anchor
});

test("does not insert a second button when the same unchanged tooltip is scanned twice (content-signature dedupe)", async () => {
  installGlobals();
  const { popper, marketplaceButton } = buildTooltip({ itemName: "Reclaimed Metal", qualityId: 6, withMarketplace: true });
  global.document = makeDocument([popper]);

  addMannStoreButton();
  await flush();
  assert.equal(marketplaceButton.parentElement.children.length, 2);

  addMannStoreButton();
  await flush();

  assert.equal(marketplaceButton.parentElement.children.length, 2);
});

test("REGRESSION: when Vue recycles the same tooltip for a DIFFERENT item, the button's href updates to the new item's own params instead of staying stuck on the first one", async () => {
  installGlobals();
  const { popper, anchor } = buildTooltip({ itemName: "Reclaimed Metal", qualityId: 6, withMarketplace: true });
  global.document = makeDocument([popper]);

  addMannStoreButton();
  await flush();
  assert.equal(mannStoreParams(getMannStoreButton()).get("search"), "Reclaimed Metal");

  // Vue patches the SAME Classifieds anchor's own href for a different item.
  anchor.setAttribute("href", "/classifieds?itemName=Refined%20Metal&quality=6");

  addMannStoreButton();
  await flush();

  assert.equal(document.querySelectorAll(".tf2te-mannco-store-button").length, 1);
  assert.equal(mannStoreParams(getMannStoreButton()).get("search"), "Refined Metal");
});

test("the observer inserts a button for a Classifieds anchor (with marketplace.tf's own button already present) added later, in one mutation", async () => {
  installGlobals();
  global.document = makeDocument([]);

  addMannStoreButton();
  await flush();
  assert.equal(getMannStoreButton(), null);

  const { popper } = buildTooltip({ itemName: "Refined Metal", qualityId: 6, withMarketplace: true });
  document.body.appendChild(popper);
  FakeMutationObserver.instances[0].cb([{ addedNodes: [popper] }]);
  await flush();

  const button = getMannStoreButton();
  assert.ok(button);
  assert.equal(mannStoreParams(button).get("search"), "Refined Metal");
});

test("falls back without throwing when itemName is present but empty on the Classifieds anchor's href", async () => {
  installGlobals();
  const anchor = new FakeElement("a");
  anchor.setAttribute("href", "/classifieds?itemName=&quality=6");
  anchor.className = "btn btn-outline-brand btn-item-tooltip";
  const wrap = buildContentLinksRow(anchor);
  global.document = makeDocument([wrap]);

  addMannStoreButton();
  await flush();

  assert.equal(getMannStoreButton(), null);
});
