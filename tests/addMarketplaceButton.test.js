import { test } from "node:test";
import assert from "node:assert/strict";

// See tests/tf2StatsLinksIndex.test.js's own header comment: utils/tf2Schema.js
// memoizes its result at module scope for this file's lifetime, so a single
// pre-seeded fixture installed before import (not per-test) is the right
// shape - effect id 71 for "Green Black Hole" is confirmed live from the
// user's own pasted tooltip markup (particle image src
// ".../particles/71_94x94.png").
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
// utils/warpaints.js's own bundled skin-name -> texture-id list (getTextureId/
// findSkinNamePrefix) - "Brain Candy" confirmed live from the user's own
// pasted tooltip markup (href="/war-paints/Brain%20Candy"), defindex is an
// arbitrary test fixture value (not itself confirmed live).
globalThis.fetch = async () => ({ json: async () => [{ name: "Brain Candy", defindex: 500 }] });

const { addMarketplaceButton } = await import("../backpack.tf/nextUI/addMarketplaceButton/content.js");

// Minimal hand-rolled fake DOM (see tests/fixTradeOfferLinks.test.js's own
// header comment for why this repo hand-rolls this instead of pulling in
// jsdom) - extended with a `*=` attribute-substring matcher (on top of the
// `^=` prefix matcher fixTradeOfferLinks' own copy has) since this feature's
// selector needs to match a Classifieds href containing "?itemName=" anywhere
// in it, plus insertAdjacentElement, which addMarketplaceButtonTo relies on.

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
    // Real DOM textContent aggregates all descendant text - needed here since
    // the effect link's text lives on a nested .special-attribute__name div,
    // not the anchor itself (see buildTooltip).
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

// The marketplace.tf button now lives in its own row, inserted as a sibling
// AFTER the tooltip's last ".item-tooltip__content__links" row - not next to
// the Classifieds anchor anymore (see backpack.tf/nextUI/shared/tooltipButtonRow.js's
// note) - so tests look it up by its own class from the document, mirroring
// content.js's own findExistingMarketplaceButton, rather than walking
// siblings off the anchor.
function getMarketplaceButton() {
  return document.querySelector(".tf2te-marketplace-tf-button");
}

// Builds a Classifieds anchor shaped exactly like the real one confirmed live
// in next.backpack.tf's item-preview tooltip:
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

// Wraps a Classifieds anchor in a row shaped like the real
// ".item-tooltip__content__links" container (confirmed live) -
// findLastContentLinksRow needs at least one of these present to know where
// to insert the marketplace.tf button's own row.
function buildContentLinksRow(anchor) {
  const row = new FakeElement("div");
  row.className = "item-tooltip__content__links";
  row.appendChild(anchor);
  return row;
}

// Builds one Sheen/Killstreaker attribute row, confirmed live to have NO
// href of its own (unlike the effect row) - just an icon + name div:
// <div class="special-attribute ..."><svg .../><div class="special-attribute__name">Name</div></div>
function buildSpecialAttributeRow(name) {
  const row = new FakeElement("div");
  row.classList.add("special-attribute");
  const nameDiv = new FakeElement("div");
  nameDiv.classList.add("special-attribute__name");
  nameDiv.textContent = `\n    ${name}\n  `;
  row.appendChild(nameDiv);
  return row;
}

// Builds a full tooltip shell: a ".tippy-popper" wrapper (confirmed live -
// see this file's own header note) containing an optional title heading
// (confirmed live: <div class="item-tooltip__header__title">Name</div> -
// only ever needed for a Kit, see isKillstreakKitName's own note), an
// optional Unusual-effect row (confirmed live: <a href="/effects/Name">
// <div class="special-attribute__name">Name</div></a>), an optional skin row
// (confirmed live, same shape: <a href="/war-paints/Name">...</a>), optional
// Sheen/Killstreaker/wear-tier rows (confirmed live, no <a> - see
// buildSpecialAttributeRow), and the Classifieds anchor, same as a real
// next.backpack.tf tooltip.
function buildTooltip({
  itemName,
  qualityId,
  effectName,
  sheenName,
  killstreakerName,
  spellName,
  festivized,
  basicKillstreak,
  skinName,
  wearTier,
  titleText,
  paintName,
  targetItem,
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

  if (spellName || festivized || sheenName || killstreakerName || basicKillstreak || wearTier || paintName) {
    const attrRow = new FakeElement("div");
    attrRow.classList.add("d-flex", "row", "g-1", "mx-0");
    // Confirmed live ordering: Spell(s), then Festivized, then wear tier,
    // then Killstreaker, then Sheen, then Paint - shouldn't matter to the
    // classify-by-table-membership logic, but kept close to the real order
    // anyway. "Standard" (confirmed live - a Basic Killstreak weapon's own
    // tier row) never co-occurs with Sheen/Killstreaker in reality, but
    // nothing stops a test from asking for both.
    if (spellName) attrRow.appendChild(buildSpecialAttributeRow(spellName));
    if (festivized) attrRow.appendChild(buildSpecialAttributeRow("Festivized"));
    if (basicKillstreak) attrRow.appendChild(buildSpecialAttributeRow("Standard"));
    if (wearTier) attrRow.appendChild(buildSpecialAttributeRow(wearTier));
    if (killstreakerName) attrRow.appendChild(buildSpecialAttributeRow(killstreakerName));
    if (sheenName) attrRow.appendChild(buildSpecialAttributeRow(sheenName));
    if (paintName) attrRow.appendChild(buildSpecialAttributeRow(paintName));
    popper.appendChild(attrRow);
  }

  if (skinName) {
    const skinLink = new FakeElement("a");
    skinLink.setAttribute("href", `/war-paints/${encodeURIComponent(skinName)}`);
    const nameDiv = new FakeElement("div");
    nameDiv.classList.add("special-attribute__name");
    nameDiv.textContent = `\n    ${skinName}\n  `;
    skinLink.appendChild(nameDiv);
    popper.appendChild(skinLink);
  }

  const anchor = buildClassifiedsAnchor(itemName, qualityId, { targetItem });
  const linksWrap = buildContentLinksRow(anchor);
  popper.appendChild(linksWrap);

  return { popper, anchor };
}

test("reads the tooltip's own Unusual-effect label and includes it in the marketplace.tf link's seffect[] filter", async () => {
  installGlobals();
  const { popper, anchor } = buildTooltip({ itemName: "Team Captain", qualityId: 5, effectName: "Green Black Hole" });
  global.document = makeDocument([popper]);

  addMarketplaceButton();
  await flush();

  const button = getMarketplaceButton();
  const url = new URL(button.href, "https://marketplace.tf/");
  assert.equal(url.searchParams.get("seffect[]"), "71");
});

test("a Decorated Weapon (skin + wear tier rows found) dispatches to the decoratedWeapon builder: spaintkit/swear set, sterm is the bare weapon name", async () => {
  installGlobals();
  const { popper, anchor } = buildTooltip({
    itemName: "Pistol",
    qualityId: 11, // Strange
    skinName: "Brain Candy",
    wearTier: "Field-Tested",
  });
  global.document = makeDocument([popper]);

  addMarketplaceButton();
  await flush();

  const button = getMarketplaceButton();
  const url = new URL(button.href, "https://marketplace.tf/");
  assert.equal(url.searchParams.get("spaintkit"), "500"); // Brain Candy's test-fixture defindex
  assert.equal(url.searchParams.get("swear"), "3"); // Field-Tested
  assert.equal(url.searchParams.get("sterm"), "Pistol");
  assert.equal(url.searchParams.get("sstrange"), "1");
});

test("a Killstreak Kit's own Classifieds itemName is just the bare word 'Kit' (confirmed live) - the target weapon comes from the tooltip's title heading instead, dispatching to stype=Killstreak Kit with its own Sheen/Killstreaker still threaded through", async () => {
  installGlobals();
  const { popper, anchor } = buildTooltip({
    itemName: "Kit", // confirmed live - no target weapon in this param at all
    qualityId: 6, // Unique - a Kit is always Unique quality
    titleText: "Professional Killstreak Eyelander Kit",
    sheenName: "Team Shine",
    killstreakerName: "Fire Horns",
  });
  global.document = makeDocument([popper]);

  addMarketplaceButton();
  await flush();

  const button = getMarketplaceButton();
  const url = new URL(button.href, "https://marketplace.tf/");
  assert.equal(url.searchParams.get("stype"), "Killstreak Kit");
  assert.equal(url.searchParams.get("skillstreak"), "3"); // Professional, parsed from the name itself
  assert.equal(url.searchParams.get("sks[]"), "1"); // Team Shine
  assert.equal(url.searchParams.get("ske[]"), "2002"); // Fire Horns
  assert.equal(url.searchParams.get("sterm"), "Eyelander"); // target weapon, not "Eyelander Kit"
});

test("a Killstreak Kit with no Sheen/Killstreaker rows found matches the user's own confirmed-live marketplace.tf URL exactly, param-for-param", async () => {
  installGlobals();
  const { popper, anchor } = buildTooltip({
    itemName: "Kit", // confirmed live - bare, no target weapon
    qualityId: 6, // Unique
    titleText: "Professional Killstreak Stickybomb Launcher Kit",
    // no sheenName/killstreakerName - confirmed live: this Kit's own
    // marketplace.tf search has no sks[]/ske[] at all, not even omitted-when-
    // absent silently - genuinely never sent for a Kit with none found.
  });
  global.document = makeDocument([popper]);

  addMarketplaceButton();
  await flush();

  const button = getMarketplaceButton();
  // Confirmed live:
  // https://marketplace.tf/browse/tf2?squality%5B%5D=6&stype=Killstreak+Kit&
  // sstrange=0&skillstreak=3&spaintkit=-2&seffect%5B%5D=-2&sbotkiller=none&
  // sfestivized=0&saustralium=0&sterm=Stickybomb+Launcher
  assert.equal(
    button.href,
    "https://marketplace.tf/browse/tf2?squality%5B%5D=6&stype=Killstreak+Kit&sstrange=0&skillstreak=3&spaintkit=-2&seffect%5B%5D=-2&sbotkiller=none&sfestivized=0&saustralium=0&sterm=Stickybomb+Launcher"
  );
});

// REGRESSION for a live bug report, with a real confirmed-working URL for
// "Ghastlierest Gibus Strangifier": this file used to never read the
// Classifieds anchor's own "targetItem" param at all, so a target-item
// tool's (Strangifier) itemNameRaw ended up as just the bare word
// "Strangifier" - too short to ever match matchTargetItemTool's own suffix
// check, so it fell through to a bogus plain-item search built from that
// bare word alone, losing the target weapon entirely.
test("a Strangifier's own Classifieds itemName is just the bare word 'Strangifier' - the anchor's own targetItem param carries the target weapon, matching the user's confirmed-live marketplace.tf URL exactly", async () => {
  installGlobals();
  const { popper } = buildTooltip({
    itemName: "Strangifier", // confirmed live - bare, no target weapon
    qualityId: 6, // Unique - a Strangifier is always Unique quality
    targetItem: "Ghastlierest Gibus",
  });
  global.document = makeDocument([popper]);

  addMarketplaceButton();
  await flush();

  const button = getMarketplaceButton();
  // Confirmed live:
  // https://marketplace.tf/browse/tf2?squality%5B%5D=6&sstrange=0&scraftable=1&
  // skillstreak=0&spaintkit=-2&seffect%5B%5D=-2&sbotkiller=none&sfestivized=0&
  // saustralium=0&sterm=Ghastlierest+Gibus+Strangifier
  assert.equal(
    button.href,
    "https://marketplace.tf/browse/tf2?squality%5B%5D=6&sstrange=0&scraftable=1&skillstreak=0&spaintkit=-2&seffect%5B%5D=-2&sbotkiller=none&sfestivized=0&saustralium=0&sterm=Ghastlierest+Gibus+Strangifier"
  );
});

test("a Killstreak Kit Fabricator's own Classifieds itemName is just the bare word 'Fabricator' (confirmed live, same gap as the Kit) - the title heading carries the target weapon instead", async () => {
  installGlobals();
  const { popper, anchor } = buildTooltip({
    itemName: "Fabricator", // confirmed live - bare, no target weapon
    qualityId: 6, // Unique
    titleText: "Professional Killstreak Sniper Rifle Kit Fabricator",
  });
  global.document = makeDocument([popper]);

  addMarketplaceButton();
  await flush();

  const button = getMarketplaceButton();
  const url = new URL(button.href, "https://marketplace.tf/");
  assert.equal(url.searchParams.get("stype"), "Fabricator");
  assert.equal(url.searchParams.get("skillstreak"), "3");
  assert.equal(url.searchParams.get("sterm"), "Sniper Rifle");
});

test("a Killstreak Kit Fabricator with its own Sheen/Killstreaker rows found threads sks[]/ske[] too (confirmed live - a Fabricator's own Sheen/Killstreaker used to get silently dropped, unlike a Kit's), matching the user's own confirmed-live marketplace.tf URL exactly", async () => {
  installGlobals();
  const { popper, anchor } = buildTooltip({
    itemName: "Fabricator",
    qualityId: 6,
    titleText: "Professional Killstreak Sniper Rifle Kit Fabricator",
    sheenName: "Mean Green",
    killstreakerName: "Flames",
  });
  global.document = makeDocument([popper]);

  addMarketplaceButton();
  await flush();

  const button = getMarketplaceButton();
  // Confirmed live:
  // https://marketplace.tf/browse/tf2?squality%5B%5D=6&stype=Fabricator&
  // sstrange=0&skillstreak=3&sks%5B%5D=4&ske%5B%5D=2005&spaintkit=-2&
  // seffect%5B%5D=-2&sbotkiller=none&sfestivized=0&saustralium=0&
  // sterm=Sniper+Rifle
  assert.equal(
    button.href,
    "https://marketplace.tf/browse/tf2?squality%5B%5D=6&stype=Fabricator&sstrange=0&skillstreak=3&sks%5B%5D=4&ske%5B%5D=2005&spaintkit=-2&seffect%5B%5D=-2&sbotkiller=none&sfestivized=0&saustralium=0&sterm=Sniper+Rifle"
  );
});

test("an Unusual-quality Decorated Weapon (quality=5 on the Classifieds anchor) keeps its Unusual quality in the marketplace.tf link", async () => {
  installGlobals();
  const { popper } = buildTooltip({
    itemName: "Pistol",
    qualityId: 5, // Unusual
    skinName: "Brain Candy",
    wearTier: "Field-Tested",
    effectName: "Green Black Hole",
  });
  global.document = makeDocument([popper]);

  addMarketplaceButton();
  await flush();

  const url = new URL(getMarketplaceButton().href, "https://marketplace.tf/");
  assert.equal(url.searchParams.get("squality[]"), "5");
  assert.equal(url.searchParams.get("sstrange"), "0");
  assert.equal(url.searchParams.get("spaintkit"), "500");
  assert.equal(url.searchParams.get("sterm"), "Pistol");
});

test("a Decorated Weapon combining skin + Unusual effect + Professional Killstreak (the exact live-reported combo) sends spaintkit/seffect[]/sks[]/ske[]/skillstreak all together", async () => {
  installGlobals();
  const { popper, anchor } = buildTooltip({
    itemName: "Pistol",
    qualityId: 11, // Strange
    skinName: "Brain Candy",
    wearTier: "Field-Tested",
    effectName: "Green Black Hole",
    sheenName: "Villainous Violet",
    killstreakerName: "Flames",
  });
  global.document = makeDocument([popper]);

  addMarketplaceButton();
  await flush();

  const button = getMarketplaceButton();
  const url = new URL(button.href, "https://marketplace.tf/");
  assert.equal(url.searchParams.get("spaintkit"), "500");
  assert.equal(url.searchParams.get("swear"), "3");
  assert.equal(url.searchParams.get("seffect[]"), "71"); // Green Black Hole
  assert.equal(url.searchParams.get("sks[]"), "6"); // Villainous Violet
  assert.equal(url.searchParams.get("ske[]"), "2005"); // Flames
  assert.equal(url.searchParams.get("skillstreak"), "3"); // Professional
  assert.equal(url.searchParams.get("sterm"), "Pistol");
});

test("a skin row with no wear-tier row found falls back to the plain-weapon path rather than guessing a Decorated Weapon dispatch", async () => {
  installGlobals();
  const { popper, anchor } = buildTooltip({
    itemName: "Pistol",
    qualityId: 11,
    skinName: "Brain Candy", // no wearTier
  });
  global.document = makeDocument([popper]);

  addMarketplaceButton();
  await flush();

  const button = getMarketplaceButton();
  const url = new URL(button.href, "https://marketplace.tf/");
  assert.equal(url.searchParams.get("sterm"), "Pistol");
  assert.equal(url.searchParams.get("spaintkit"), "-2"); // not resolved as a Decorated Weapon at all
});

test("reads the tooltip's Halloween Spell row into marketplace.tf's own sspell slug (a third, independent id scheme from next.backpack.tf's own)", async () => {
  installGlobals();
  const { popper, anchor } = buildTooltip({ itemName: "Bazaar Bargain", qualityId: 11, spellName: "Exorcism" });
  global.document = makeDocument([popper]);

  addMarketplaceButton();
  await flush();

  const button = getMarketplaceButton();
  const url = new URL(button.href, "https://marketplace.tf/");
  assert.equal(url.searchParams.get("sspell"), "effect_exorcism");
});

test("reads the tooltip's Festivized row and synthesizes the 'Festivized ' name prefix, since the Classifieds button's own itemName strips it out too", async () => {
  installGlobals();
  const { popper, anchor } = buildTooltip({ itemName: "Bazaar Bargain", qualityId: 11, festivized: true });
  global.document = makeDocument([popper]);

  addMarketplaceButton();
  await flush();

  const button = getMarketplaceButton();
  const url = new URL(button.href, "https://marketplace.tf/");
  assert.equal(url.searchParams.get("sfestivized"), "1");
  assert.equal(url.searchParams.get("sterm"), "Bazaar Bargain"); // synthesized prefix must not leak into sterm
});

test("a Festivized Professional Killstreak item with a Spell combines all three correctly, in the confirmed-live word order", async () => {
  installGlobals();
  const { popper, anchor } = buildTooltip({
    itemName: "Bazaar Bargain",
    qualityId: 11, // Strange
    spellName: "Exorcism",
    festivized: true,
    sheenName: "Manndarin",
    killstreakerName: "Cerebral Discharge",
  });
  global.document = makeDocument([popper]);

  addMarketplaceButton();
  await flush();

  const button = getMarketplaceButton();
  const url = new URL(button.href, "https://marketplace.tf/");
  assert.equal(url.searchParams.get("sspell"), "effect_exorcism");
  assert.equal(url.searchParams.get("sfestivized"), "1");
  assert.equal(url.searchParams.get("skillstreak"), "3");
  assert.equal(url.searchParams.get("sks[]"), "3");
  assert.equal(url.searchParams.get("ske[]"), "2003");
  assert.equal(url.searchParams.get("sterm"), "Bazaar Bargain");
});

test("no Spell/Festivized row found sends neither sspell nor sfestivized=1", async () => {
  installGlobals();
  const { popper, anchor } = buildTooltip({ itemName: "Bazaar Bargain", qualityId: 11 });
  global.document = makeDocument([popper]);

  addMarketplaceButton();
  await flush();

  const button = getMarketplaceButton();
  const url = new URL(button.href, "https://marketplace.tf/");
  assert.equal(url.searchParams.has("sspell"), false);
  assert.equal(url.searchParams.get("sfestivized"), "0");
});

test("reads the tooltip's Sheen and Killstreaker rows (classified by name-table membership, no label text to key off) into sks[]/ske[], and derives skillstreak=3 (Professional) since the Classifieds button's own itemName never carries the tier word", async () => {
  installGlobals();
  const { popper, anchor } = buildTooltip({
    itemName: "Bazaar Bargain", // confirmed live: bare name, no "Professional Killstreak " prefix baked in
    qualityId: 11, // Strange
    sheenName: "Manndarin",
    killstreakerName: "Cerebral Discharge",
  });
  global.document = makeDocument([popper]);

  addMarketplaceButton();
  await flush();

  const button = getMarketplaceButton();
  const url = new URL(button.href, "https://marketplace.tf/");
  assert.equal(url.searchParams.get("sks[]"), "3"); // Manndarin
  assert.equal(url.searchParams.get("ske[]"), "2003"); // Cerebral Discharge
  assert.equal(url.searchParams.get("skillstreak"), "3"); // Professional - only a Professional weapon ever has a Killstreaker
  assert.equal(url.searchParams.get("sterm"), "Bazaar Bargain"); // the synthesized tier prefix must not leak into sterm
});

test("Incinerator (Killstreaker) + Hot Rod (Sheen) - confirmed live via the user's own pasted 'Special Attributes' markup - resolve to ske[]=2007/sks[]=7 with no new code needed, same table-membership scan as every other combo", async () => {
  installGlobals();
  const { popper, anchor } = buildTooltip({
    itemName: "Bazaar Bargain",
    qualityId: 11,
    killstreakerName: "Incinerator",
    sheenName: "Hot Rod",
  });
  global.document = makeDocument([popper]);

  addMarketplaceButton();
  await flush();

  const button = getMarketplaceButton();
  const url = new URL(button.href, "https://marketplace.tf/");
  assert.equal(url.searchParams.get("ske[]"), "2007"); // Incinerator
  assert.equal(url.searchParams.get("sks[]"), "7"); // Hot Rod
  assert.equal(url.searchParams.get("skillstreak"), "3"); // Professional
});

test("reads the tooltip's Paint row (confirmed live: 'A Deep Commitment to Purple') into marketplace.tf's own spaint[] decimal-RGB id", async () => {
  installGlobals();
  const { popper, anchor } = buildTooltip({
    itemName: "Team Captain",
    qualityId: 6, // Unique
    paintName: "A Deep Commitment to Purple",
  });
  global.document = makeDocument([popper]);

  addMarketplaceButton();
  await flush();

  const button = getMarketplaceButton();
  const url = new URL(button.href, "https://marketplace.tf/");
  assert.equal(url.searchParams.get("spaint[]"), "8208497"); // 0x7d4071
});

test("a Paint row found on an Unusual item is NOT filtered by - narrowing an Unusual's own effect search by paint color would cut wanted results", async () => {
  installGlobals();
  const { popper, anchor } = buildTooltip({
    itemName: "Team Captain",
    qualityId: 5, // Unusual
    effectName: "Green Black Hole",
    paintName: "A Deep Commitment to Purple",
  });
  global.document = makeDocument([popper]);

  addMarketplaceButton();
  await flush();

  const button = getMarketplaceButton();
  const url = new URL(button.href, "https://marketplace.tf/");
  assert.equal(url.searchParams.get("seffect[]"), "71"); // effect filter still applies
  assert.equal(url.searchParams.has("spaint[]"), false); // paint filter does not
});

test("a Halloween Spell row found on an Unusual item is NOT filtered by either - same reasoning as Paint, narrowing an Unusual's own effect search by spell would cut wanted results", async () => {
  installGlobals();
  const { popper, anchor } = buildTooltip({
    itemName: "Team Captain",
    qualityId: 5, // Unusual
    effectName: "Green Black Hole",
    spellName: "Exorcism",
  });
  global.document = makeDocument([popper]);

  addMarketplaceButton();
  await flush();

  const button = getMarketplaceButton();
  const url = new URL(button.href, "https://marketplace.tf/");
  assert.equal(url.searchParams.get("seffect[]"), "71"); // effect filter still applies
  assert.equal(url.searchParams.has("sspell"), false); // spell filter does not
});

test("no Paint row found sends no spaint[] at all (not even an 'off' sentinel)", async () => {
  installGlobals();
  const { popper, anchor } = buildTooltip({ itemName: "Team Captain", qualityId: 6 });
  global.document = makeDocument([popper]);

  addMarketplaceButton();
  await flush();

  const button = getMarketplaceButton();
  const url = new URL(button.href, "https://marketplace.tf/");
  assert.equal(url.searchParams.has("spaint[]"), false);
});

test("a Sheen with no Killstreaker derives skillstreak=2 (Specialized)", async () => {
  installGlobals();
  const { popper, anchor } = buildTooltip({ itemName: "Bazaar Bargain", qualityId: 11, sheenName: "Manndarin" });
  global.document = makeDocument([popper]);

  addMarketplaceButton();
  await flush();

  const button = getMarketplaceButton();
  const url = new URL(button.href, "https://marketplace.tf/");
  assert.equal(url.searchParams.get("sks[]"), "3");
  assert.equal(url.searchParams.has("ske[]"), false);
  assert.equal(url.searchParams.get("skillstreak"), "2");
});

test("a plain (non-Killstreak) item with no special-attribute rows at all gets skillstreak=0", async () => {
  installGlobals();
  const { popper, anchor } = buildTooltip({ itemName: "Bazaar Bargain", qualityId: 11 }); // no rows at all
  global.document = makeDocument([popper]);

  addMarketplaceButton();
  await flush();

  const button = getMarketplaceButton();
  const url = new URL(button.href, "https://marketplace.tf/");
  assert.equal(url.searchParams.has("sks[]"), false);
  assert.equal(url.searchParams.has("ske[]"), false);
  assert.equal(url.searchParams.get("skillstreak"), "0");
});

test("a Basic Killstreak weapon's own 'Standard' row (confirmed live, no Sheen/Killstreaker of its own) derives skillstreak=1", async () => {
  installGlobals();
  const { popper, anchor } = buildTooltip({ itemName: "Bazaar Bargain", qualityId: 11, basicKillstreak: true });
  global.document = makeDocument([popper]);

  addMarketplaceButton();
  await flush();

  const button = getMarketplaceButton();
  const url = new URL(button.href, "https://marketplace.tf/");
  assert.equal(url.searchParams.has("sks[]"), false);
  assert.equal(url.searchParams.has("ske[]"), false);
  assert.equal(url.searchParams.get("skillstreak"), "1");
  assert.equal(url.searchParams.get("sterm"), "Bazaar Bargain"); // synthesized "Killstreak " prefix must not leak into sterm
});

// An Unusual Taunt's tooltip has no "/effects/" row at all; its effect id is
// only on the Classifieds anchor's own "particle" param (confirmed live, #145).
test("REGRESSION: an Unusual Taunt with no effect row still filters by the anchor's own particle param", async () => {
  installGlobals();
  const { popper, anchor } = buildTooltip({ itemName: "Taunt: The Boston Breakdance", qualityId: 5 });
  anchor.setAttribute("href", "/classifieds?itemName=Taunt%3A%20The%20Boston%20Breakdance&quality=5&particle=3072");
  global.document = makeDocument([popper]);

  addMarketplaceButton();
  await flush();

  const url = new URL(getMarketplaceButton().href, "https://marketplace.tf/");
  assert.equal(url.searchParams.get("seffect[]"), "3072");
});

test("an Unusual item with no effect label found still gets a marketplace.tf link, just with no effect filter", async () => {
  installGlobals();
  const { popper, anchor } = buildTooltip({ itemName: "Team Captain", qualityId: 5 }); // no effectName
  global.document = makeDocument([popper]);

  addMarketplaceButton();
  await flush();

  const button = getMarketplaceButton();
  const url = new URL(button.href, "https://marketplace.tf/");
  assert.equal(url.searchParams.get("seffect[]"), "-2");
});

test("inserts a marketplace.tf button in its own row after the Classifieds row, cloning the button's classes and reusing the mb-1 row class", async () => {
  installGlobals();
  const anchor = buildClassifiedsAnchor("Reclaimed Metal", 6); // Unique
  const wrap = buildContentLinksRow(anchor);
  global.document = makeDocument([wrap]);

  addMarketplaceButton();
  await flush();

  // wrap (the native row) is untouched - the button lives in a NEW sibling
  // row, not inside this one.
  assert.equal(wrap.children.length, 1);
  assert.equal(document.body.children.length, 2); // native row, marketplace.tf row
  const row = document.body.children[1];
  assert.ok(row.classList.contains("item-tooltip__content__links"));
  assert.ok(row.classList.contains("mb-1"));

  const button = getMarketplaceButton();
  assert.equal(button.parentElement, row);
  assert.equal(button.textContent, "marketplace.tf");
  assert.ok(button.classList.contains("btn-item-tooltip"));
  assert.ok(button.classList.contains("tf2te-marketplace-tf-button"));
  assert.equal(button.target, "_blank");
  assert.equal(button.rel, "noopener noreferrer");
});

test("inserts the marketplace.tf row after the LAST of two content-links rows (Classifieds row, then Item/History/Wiki row), not the first", async () => {
  installGlobals();
  const anchor = buildClassifiedsAnchor("Reclaimed Metal", 6);
  const classifiedsRow = buildContentLinksRow(anchor);
  const historyRow = new FakeElement("div");
  historyRow.className = "item-tooltip__content__links px-2 mb-1"; // confirmed live shape
  global.document = makeDocument([classifiedsRow, historyRow]);

  addMarketplaceButton();
  await flush();

  assert.equal(document.body.children.length, 3);
  assert.equal(document.body.children[0], classifiedsRow);
  assert.equal(document.body.children[1], historyRow);
  assert.ok(document.body.children[2].classList.contains("item-tooltip__content__links"));
  assert.equal(getMarketplaceButton().parentElement, document.body.children[2]);
});

test("copies the Classifieds anchor's Vue scoped-style attribute (data-v-XXXXXXXX) onto the new button, so scoped CSS sizes it the same", async () => {
  installGlobals();
  const anchor = buildClassifiedsAnchor("Reclaimed Metal", 6, { scopedAttr: "data-v-b49f43c8" });
  const wrap = buildContentLinksRow(anchor);
  global.document = makeDocument([wrap]);

  addMarketplaceButton();
  await flush();

  const button = getMarketplaceButton();
  assert.equal(button.getAttribute("data-v-b49f43c8"), "");
});

test("builds the marketplace.tf link with the quality prefix applied for a non-Unique item (Strange)", async () => {
  installGlobals();
  const anchor = buildClassifiedsAnchor("Rocket Launcher", 11); // Strange
  const wrap = buildContentLinksRow(anchor);
  global.document = makeDocument([wrap]);

  addMarketplaceButton();
  await flush();

  const button = getMarketplaceButton();
  const url = new URL(button.href, "https://marketplace.tf/");
  assert.equal(url.origin + url.pathname, "https://marketplace.tf/browse/tf2");
  assert.equal(url.searchParams.get("sstrange"), "1");
  assert.equal(url.searchParams.get("sterm"), "Rocket Launcher");
});

test("REGRESSION: a Botkiller weapon's marketplace.tf link sends sbotkiller='{grade}_{roman tier}' and searches sterm by the bare weapon name, not the full Botkiller name (was previously always sbotkiller=none - see utils/tf2StatsLinks/index.js's own note)", async () => {
  installGlobals();
  const anchor = buildClassifiedsAnchor("Diamond Botkiller Sniper Rifle Mk.I", 11); // Strange
  const wrap = buildContentLinksRow(anchor);
  global.document = makeDocument([wrap]);

  addMarketplaceButton();
  await flush();

  const button = getMarketplaceButton();
  const url = new URL(button.href, "https://marketplace.tf/");
  assert.equal(url.searchParams.get("sbotkiller"), "Diamond_I");
  assert.equal(url.searchParams.get("sterm"), "Sniper Rifle");
});

test("a Unique item's marketplace.tf link is built from the bare item name (no quality prefix)", async () => {
  installGlobals();
  const anchor = buildClassifiedsAnchor("Reclaimed Metal", 6); // Unique
  const wrap = buildContentLinksRow(anchor);
  global.document = makeDocument([wrap]);

  addMarketplaceButton();
  await flush();

  const button = getMarketplaceButton();
  const url = new URL(button.href, "https://marketplace.tf/");
  assert.equal(url.searchParams.get("sterm"), "Reclaimed Metal");
  assert.equal(url.searchParams.get("sstrange"), "0");
});

// REGRESSION for a live bug report, with a real confirmed-working
// marketplace.tf URL ("saustralium=1") for a "Professional Killstreak
// Australium Medi Gun": this file's own comment used to (wrongly) assume the
// Classifieds anchor's itemName param always carries "Australium" as a
// literal embedded word already - confirmed live it does NOT for this real
// example; the anchor instead carries a separate "australium=1" boolean
// param, with itemName staying completely bare ("Medi Gun"). saustralium
// used to always come back "0" for every item, since isAustralium was never
// derived from anything at all.
test("reads the Classifieds anchor's own 'australium=1' param and sends saustralium=1, while sterm stays the bare item name", async () => {
  installGlobals();
  const { popper, anchor } = buildTooltip({
    itemName: "Medi Gun",
    qualityId: 11, // Strange
    sheenName: "Team Shine",
    killstreakerName: "Tornado",
  });
  anchor.setAttribute("href", `${anchor.getAttribute("href")}&killstreakTier=3&australium=1`);
  global.document = makeDocument([popper]);

  addMarketplaceButton();
  await flush();

  const button = getMarketplaceButton();
  const url = new URL(button.href, "https://marketplace.tf/");
  assert.equal(url.searchParams.get("saustralium"), "1");
  assert.equal(url.searchParams.get("sterm"), "Medi Gun");
  assert.equal(url.searchParams.get("sstrange"), "1");
  assert.equal(url.searchParams.get("skillstreak"), "3");
});

test("does not insert a second button when the same unchanged Classifieds anchor is scanned twice (content-signature dedupe)", async () => {
  installGlobals();
  const anchor = buildClassifiedsAnchor("Reclaimed Metal", 6);
  const wrap = buildContentLinksRow(anchor);
  global.document = makeDocument([wrap]);

  addMarketplaceButton();
  await flush();
  assert.equal(wrap.children.length, 1); // untouched - button lives in its own row
  assert.equal(document.body.children.length, 2); // native row, marketplace.tf row

  // Re-run the initial scan again with nothing changed (e.g. addMarketplaceButton
  // called a second time, or the same anchor re-observed) - the signature
  // must prevent a duplicate row, since a real tooltip only ever gets ONE.
  addMarketplaceButton();
  await flush();

  assert.equal(document.body.children.length, 2);
});

test("REGRESSION: when Vue recycles the same Classifieds anchor node for a DIFFERENT item (confirmed live - the tooltip is one shared component, not torn down per hover), the button's href updates to the new item instead of staying stuck on the first one", async () => {
  installGlobals();
  // First hover: a Professional Killstreak item.
  const { popper, anchor } = buildTooltip({
    itemName: "Knife",
    qualityId: 11,
    sheenName: "Hot Rod",
    killstreakerName: "Hypno-Beam",
  });
  global.document = makeDocument([popper]);

  addMarketplaceButton();
  await flush();
  const firstUrl = new URL(getMarketplaceButton().href, "https://marketplace.tf/");
  assert.equal(firstUrl.searchParams.get("skillstreak"), "3");
  assert.equal(firstUrl.searchParams.get("sks[]"), "7"); // Hot Rod

  // Second hover: Vue reuses the SAME anchor node (not a fresh one) and
  // patches the attribute row's own content for a Specialized item instead -
  // simulated here by swapping just that one slot's content, WITHOUT
  // touching wrap or the marketplace.tf row Vue doesn't manage (real Vue
  // only patches nodes it rendered itself, and leaves this file's own
  // injected row alone entirely).
  const newAttrRow = new FakeElement("div");
  newAttrRow.appendChild(buildSpecialAttributeRow("Mean Green"));
  newAttrRow.parentElement = popper;
  popper.children[0] = newAttrRow; // buildTooltip's own append order: attrRow is always index 0 here
  anchor.setAttribute("href", "/classifieds?itemName=Knife&quality=11");

  addMarketplaceButton();
  await flush();

  // Still exactly one button (updated in place), not a second stale one.
  assert.equal(document.querySelectorAll(".tf2te-marketplace-tf-button").length, 1);
  const secondUrl = new URL(getMarketplaceButton().href, "https://marketplace.tf/");
  assert.equal(secondUrl.searchParams.get("skillstreak"), "2"); // Specialized now
  assert.equal(secondUrl.searchParams.get("sks[]"), "4"); // Mean Green
  assert.equal(secondUrl.searchParams.has("ske[]"), false); // no Killstreaker anymore
});

test("skips a Classifieds anchor with no itemName query param without throwing", async () => {
  installGlobals();
  const anchor = new FakeElement("a");
  anchor.setAttribute("href", "/classifieds?quality=6");
  anchor.className = "btn btn-outline-brand btn-item-tooltip";
  const wrap = buildContentLinksRow(anchor);
  global.document = makeDocument([wrap]);

  addMarketplaceButton();
  await flush();

  assert.equal(wrap.children.length, 1);
});

test("the observer inserts a button for a Classifieds anchor added later (tooltip shown after initial page load)", async () => {
  installGlobals();
  global.document = makeDocument([]);
  addMarketplaceButton();
  await flush();

  const anchor = buildClassifiedsAnchor("Rocket Launcher", 6);
  const wrap = buildContentLinksRow(anchor);
  // A real MutationObserver only ever fires for nodes already live in the
  // document (that's what makes them "added") - document.querySelectorAll
  // (used to find where to insert the marketplace.tf row) needs wrap to
  // actually be attached, not just passed as the mutation record's own
  // addedNodes entry.
  document.body.appendChild(wrap);

  FakeMutationObserver.instances[0].cb([{ addedNodes: [wrap] }]);
  await flush();

  assert.equal(wrap.children.length, 1);
  assert.equal(getMarketplaceButton().textContent, "marketplace.tf");
});

test("addMarketplaceButton sets up a subtree MutationObserver on document.body", () => {
  installGlobals();
  global.document = makeDocument([]);

  addMarketplaceButton();

  assert.equal(FakeMutationObserver.instances.length, 1);
  assert.equal(FakeMutationObserver.instances[0].target, document.body);
  assert.deepEqual(FakeMutationObserver.instances[0].opts, { childList: true, subtree: true });
});
