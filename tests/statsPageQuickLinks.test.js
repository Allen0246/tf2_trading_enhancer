import { test } from "node:test";
import assert from "node:assert/strict";

// See tests/addPostsTfButton.test.js's own header comment: utils/tf2Schema.js
// memoizes its result at module scope for this file's lifetime, so a
// pre-seeded fixture installed before import (not per-test) is the right
// shape. posts.tf needs a real Valve defindex per item name.
globalThis.chrome = {
  storage: {
    local: {
      async get() {
        return {
          tf2SchemaCache: {
            itemNameToDefindex: {
              "Rocket Launcher": 205,
              "Reclaimed Metal": 143,
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
    // backpack.tf/nextUI/addMannStoreButton/content.js's own
    // ensureSheenKillstreakerFilterWatcher (this file's own buildMannStoreHref
    // is reused by statsPageQuickLinks for the mannco.store button below)
    // registers a listener here on first actual button build.
    onChanged: { addListener() {} },
  },
  runtime: {
    getURL: (path) => path,
    // Routes pricedb.io's own /api/search - every other call this feature
    // makes (posts.tf's own defindex lookup) is served entirely from the
    // pre-seeded schema cache above and never reaches this at all.
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
let pricedbSku = "205;6";

const { statsPageQuickLinks } = await import("../backpack.tf/nextUI/statsPageQuickLinks/content.js");
const { __resetPricedbCacheForTests } = await import("../utils/pricedb.js");

// Same hand-rolled fake DOM every other tooltip-button feature's own test
// file already uses (see tests/addGladiatorButton.test.js's own header
// comment for why this repo hand-rolls rather than pulling in jsdom) -
// duplicated rather than shared, matching this codebase's own
// per-test-file self-containment convention. No descendant-combinator
// support (matchesCompound only ever checks one element's own classes) -
// content.js's own selectors are written to never need one, chaining
// closest()/querySelector() on simple selectors instead.

function parseCompound(selector) {
  const rest = selector;
  const classes = [...rest.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
  const tagMatch = /^[a-zA-Z][\w-]*/.exec(rest);
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
  getAttributeNames() {
    return Object.keys(this._attrs);
  }
  appendChild(child) {
    this.children.push(child);
    child.parentElement = this;
    return child;
  }
  insertBefore(newNode, referenceNode) {
    const idx = referenceNode ? this.children.indexOf(referenceNode) : -1;
    if (idx === -1) this.children.push(newNode);
    else this.children.splice(idx, 0, newNode);
    newNode.parentElement = this;
    return newNode;
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

function installGlobals({ href = "https://next.backpack.tf/stats?item=Rocket+Launcher&quality=Unique", sku = "205;6" } = {}) {
  global.window = { location: { href } };
  global.Node = { ELEMENT_NODE: 1 };
  global.MutationObserver = FakeMutationObserver;
  FakeMutationObserver.instances = [];
  lastPricedbQuery = null;
  pricedbSku = sku;
  __resetPricedbCacheForTests();
}

// Confirmed live shape (Item Information card): a ".card" containing a
// ".card__header" (with ".card__header__title" starting with "Item
// Information", and ".card__header__actions" > ".row" holding the native
// Wiki/Place Buy Order actions) and a SIBLING ".card__content" (the item
// icon/name/price/trends block) - the quick-links row is appended at the
// end of ".card__content", not into the header at all.
function buildItemInfoCard({ titleText = "Item Information" } = {}) {
  const card = new FakeElement("div");
  card.classList.add("card");

  const titleEl = new FakeElement("div");
  titleEl.className = "card__header__title";
  titleEl.textContent = titleText;
  card.appendChild(titleEl);

  const actions = new FakeElement("div");
  actions.className = "card__header__actions";
  card.appendChild(actions);

  const nativeRow = new FakeElement("div");
  nativeRow.className = "row g-2";
  actions.appendChild(nativeRow);

  const wikiAction = new FakeElement("div");
  wikiAction.className = "card__header__actions__action col-auto";
  nativeRow.appendChild(wikiAction);

  const wikiLink = new FakeElement("a");
  wikiLink.className = "card__header__actions__action__link";
  wikiLink.setAttribute("href", "https://wiki.teamfortress.com/wiki/Rocket%20Launcher");
  wikiLink.textContent = "Wiki";
  wikiAction.appendChild(wikiLink);

  const content = new FakeElement("div");
  content.className = "card__content";
  card.appendChild(content);

  const itemBlock = new FakeElement("div");
  itemBlock.className = "p-3 header";
  itemBlock.textContent = "item icon/name/price/trends";
  content.appendChild(itemBlock);

  return { card, actions, nativeRow, content, itemBlock };
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

test("adds snapshot, stntrading.eu, marketplace.tf, mannco.store, gladiator.tf, pricedb.io, and posts.tf buttons for a plain Unique item", async () => {
  installGlobals({ href: "https://next.backpack.tf/stats?item=Rocket+Launcher&quality=Unique", sku: "205;6" });
  const { card } = buildItemInfoCard();
  global.document = makeDocument([card]);

  statsPageQuickLinks();
  await flush();

  // First in the row.
  assert.equal(getQuickLinks()[0]?.textContent, "snapshot");
  assert.equal(getQuickLink("snapshot")?.href, "https://next.backpack.tf/classifieds/snapshots/Rocket%20Launcher");
  assert.equal(getQuickLink("stntrading.eu")?.href, "https://stntrading.eu/item/tf2/Rocket+Launcher");
  assert.match(getQuickLink("marketplace.tf")?.href, /^https:\/\/marketplace\.tf\/browse\/tf2\?/);
  assert.match(getQuickLink("marketplace.tf")?.href, /sterm=Rocket\+Launcher/);
  assert.equal(
    getQuickLink("mannco.store")?.href,
    "https://mannco.store/tf2?search=Rocket+Launcher&quality=Unique&festivized=No+festivized&killstreak=No&warpaints=No+WarPaints"
  );
  assert.equal(getQuickLink("gladiator.tf")?.href, "https://gladiator.tf/sales?item=Rocket+Launcher");
  assert.equal(getQuickLink("pricedb.io")?.href, "https://pricedb.io/item/205%3B6");
  assert.match(getQuickLink("posts.tf")?.href, /^https:\/\/posts\.tf\/posts\/search\/results\?q=/);
  assert.equal(getQuickLinks().length, 7);
});

// STN is unconditionally shown, unlike marketplace.tf/posts.tf/pricedb.io
// (each of which can genuinely fail to resolve) - buildSteamMarketName
// always produces SOME reasonable link off itemNameRaw alone, even when
// classifiedsFilters itself came back null.
test("the stntrading.eu button never disappears, even for an item outside this feature's schema/pricedb fixtures", async () => {
  installGlobals({ href: "https://next.backpack.tf/stats?item=Some+Unknown+Item&quality=Unique", sku: null });
  const { card } = buildItemInfoCard();
  global.document = makeDocument([card]);

  statsPageQuickLinks();
  await flush();

  assert.equal(getQuickLink("stntrading.eu")?.href, "https://stntrading.eu/item/tf2/Some+Unknown+Item");
});

// Pricedb.io's own dynamic per-IP rate limit (a real, confirmed-live 429)
// used to look identical to "this item genuinely has no pricedb.io
// listing" - the button just silently vanished either way. Now shows a
// non-clickable "pricedb.io (rate limited)" placeholder instead, so a rate
// limit doesn't look like a plain missing result.
test("turns pricedb.io's slot into the rate-limit countdown on a real 429 instead of silently omitting it", async () => {
  installGlobals({ href: "https://next.backpack.tf/stats?item=Rocket+Launcher&quality=Unique" });
  const { card } = buildItemInfoCard();
  global.document = makeDocument([card]);

  const originalSendMessage = globalThis.chrome.runtime.sendMessage;
  globalThis.chrome.runtime.sendMessage = async (msg) => {
    const url = new URL(msg.url);
    if (url.hostname.includes("pricedb.io")) return { ok: false, status: 429, error: "Rate limited (429)", retryAfterMs: 30000 };
    throw new Error(`unexpected sendMessage: ${msg.url}`);
  };

  try {
    statsPageQuickLinks();
    await flush();

    // pricedb.io's slot turns into the countdown (utils/linkButtonStates.js)
    // in place of the old "(rate limited)" label, then retries by itself.
    const countdown = getQuickLinks().find((el) => /Retrying automatically in 30s/.test(el.title || ""));
    assert.ok(countdown, "expected the rate-limit countdown to render");
    assert.equal(countdown.tagName.toLowerCase(), "span"); // not a clickable <a>
    assert.equal(countdown.getAttribute("href"), null);
    assert.equal(getQuickLinks().some((el) => el.tagName.toLowerCase() === "a" && el.href?.includes("pricedb.io")), false);
  } finally {
    globalThis.chrome.runtime.sendMessage = originalSendMessage;
  }
});

test("the quick-links row is appended to the END of the card's own .card__content (below the item icon/name/price/trends block), not into the header at all", async () => {
  installGlobals();
  const { card, actions, content, itemBlock } = buildItemInfoCard();
  global.document = makeDocument([card]);

  statsPageQuickLinks();
  await flush();

  assert.equal(actions.children.length, 1); // header untouched - still just the native row
  const wrap = document.querySelector(".tf2te-stats-controls");
  assert.deepEqual(content.children, [itemBlock, wrap]);
  // The killstreak-tier switcher (see its own dedicated tests) sits ahead
  // of the row within that same wrap.
  assert.equal(wrap.children[wrap.children.length - 1], getQuickLinksRow());
});

// Four tier links, each the current URL with only killstreakTier
// swapped, the currently-active one visually marked.
test("builds a killstreak-tier switcher (No Kit/Normal KS/Specialized KS/Professional KS), marking the current tier active, preserving every other URL param", async () => {
  installGlobals({ href: "https://next.backpack.tf/stats?item=Wrench&quality=Strange&killstreakTier=2" });
  const { card } = buildItemInfoCard();
  global.document = makeDocument([card]);

  statsPageQuickLinks();
  await flush();

  const tabs = document.querySelectorAll(".tf2te-stats-ks-tab");
  assert.deepEqual(
    tabs.map((t) => t.textContent),
    ["No Kit", "Normal KS", "Specialized KS", "Professional KS"]
  );
  tabs.forEach((t) => {
    const url = new URL(t.href);
    assert.equal(url.searchParams.get("item"), "Wrench");
    assert.equal(url.searchParams.get("quality"), "Strange");
  });
  assert.equal(new URL(tabs[0].href).searchParams.get("killstreakTier"), "0");
  assert.equal(new URL(tabs[3].href).searchParams.get("killstreakTier"), "3");

  const active = tabs.find((t) => t.classList.contains("tf2te-stats-ks-tab--active"));
  assert.equal(active?.textContent, "Specialized KS");
  assert.equal(tabs.filter((t) => t.classList.contains("tf2te-stats-ks-tab--active")).length, 1);
});

// The four tabs used to render as separate pill buttons with gaps
// between them; now a joined "segmented control" strip, same technique
// ../killstreakTierFilter/content.js's own applyGroupedCorners already
// established for next.backpack.tf's classifieds page.
test("groups the killstreak-tier tabs into a joined strip - clears only the touching corners, overlaps borders by 1px", async () => {
  installGlobals({ href: "https://next.backpack.tf/stats?item=Wrench&quality=Strange&killstreakTier=0" });
  const { card } = buildItemInfoCard();
  global.document = makeDocument([card]);

  statsPageQuickLinks();
  await flush();

  const tabs = document.querySelectorAll(".tf2te-stats-ks-tab");
  assert.equal(tabs.length, 4);

  // First tab: keeps its own left corners, loses its right ones (touches
  // the next tab), no negative margin (nothing to its left).
  assert.equal(tabs[0].style.borderTopLeftRadius, undefined);
  assert.equal(tabs[0].style.borderTopRightRadius, "0");
  assert.equal(tabs[0].style.borderBottomRightRadius, "0");
  assert.equal(tabs[0].style.marginLeft, undefined);

  // A middle tab: loses every corner (touches a neighbor on both sides),
  // overlaps the previous tab's border by 1px.
  assert.equal(tabs[1].style.borderTopLeftRadius, "0");
  assert.equal(tabs[1].style.borderTopRightRadius, "0");
  assert.equal(tabs[1].style.marginLeft, "-1px");

  // Last tab: keeps its own right corners, loses its left ones.
  assert.equal(tabs[3].style.borderTopRightRadius, undefined);
  assert.equal(tabs[3].style.borderTopLeftRadius, "0");
  assert.equal(tabs[3].style.marginLeft, "-1px");
});

test("the killstreak-tier switcher is built synchronously, before the async quick-links resolve completes", async () => {
  installGlobals({ href: "https://next.backpack.tf/stats?item=Wrench&quality=Strange&killstreakTier=1" });
  const { card } = buildItemInfoCard();
  global.document = makeDocument([card]);

  statsPageQuickLinks();
  // No flush() yet - the async resolveStatsAndClassifieds/searchPricedbSkuStatus
  // calls haven't settled, but the switcher shouldn't need them.
  await Promise.resolve();

  assert.equal(document.querySelectorAll(".tf2te-stats-ks-tab").length, 4);
});

test("buttons are real <a> elements styled as buttons (own class, opens in a new tab), not clones of the native text-link style", async () => {
  installGlobals();
  const { card } = buildItemInfoCard();
  global.document = makeDocument([card]);

  statsPageQuickLinks();
  await flush();

  const button = getQuickLink("gladiator.tf");
  assert.ok(button.classList.contains("tf2te-stats-quick-link-button"));
  assert.equal(button.target, "_blank");
  assert.equal(button.rel, "noopener noreferrer");
  // Injects its own stylesheet once - not relying on borrowed/cloned Vue
  // scoped classes that might not actually carry any styling outside their
  // own component's scope hash.
  assert.ok(document.getElementById("tf2te-stats-quick-links-style"));
});

// Posts.tf's own defindex lookup can genuinely fail for an item this schema
// cache fixture doesn't cover -
// marketplace.tf/gladiator.tf/mannco.store/pricedb.io still resolve fine
// for the same item (none of them depend on a Valve defindex at all), so
// only posts.tf's own button should be missing, not the whole row.
test("omits just the posts.tf button (not the others) when its own defindex lookup finds nothing, for an item outside this test's schema fixture", async () => {
  installGlobals({ href: "https://next.backpack.tf/stats?item=Unknown+Widget&quality=Unique", sku: "999;6" });
  const { card } = buildItemInfoCard();
  global.document = makeDocument([card]);

  statsPageQuickLinks();
  await flush();

  assert.equal(getQuickLink("posts.tf"), null);
  assert.ok(getQuickLink("gladiator.tf"));
  assert.ok(getQuickLink("mannco.store"));
  assert.ok(getQuickLink("pricedb.io"));
});

// This used to assert the effect NAME stayed unresolved (literal "Unusual"
// kept in the gladiator.tf search) for priceindex=12 under this test's own
// empty-schema fixture - resolveEffectNameById's own reverse scan (this
// file's own header note on why it exists at all) goes through
// utils/tf2Schema.js's own getEffectNameToIdMap, which now merges in
// utils/unusualEffectIds.js's own static table (see that file's own note) -
// id 12 IS "Massed Flies" there, so the real effect name now resolves with
// no live schema needed at all, same as every other port of this button
// already does for a DOM-labeled effect name.
test("resolves an Unusual's effect NAME (not just its id) from the URL's own priceindex via the static table, with no live schema needed", async () => {
  installGlobals({ href: "https://next.backpack.tf/stats?item=Team+Captain&quality=Unusual&priceindex=12", sku: null });
  const { card } = buildItemInfoCard();
  global.document = makeDocument([card]);

  statsPageQuickLinks();
  await flush();

  assert.equal(getQuickLink("gladiator.tf")?.href, "https://gladiator.tf/sales?item=Massed+Flies+Team+Captain");
  // pricedb.io omitted - this test's own sendMessage mock returns no match.
  assert.equal(getQuickLink("pricedb.io"), null);
});

// Gladiator.tf/pricedb.io both need the trading community's own "{Effect}
// {Item}" search term, not Steam's raw "Unusual {Item}" text -
// itemNameRaw's own shape, correct for
// resolveStatsAndClassifieds/marketplace.tf/stntrading.eu but wrong for
// these two. The test above (empty effectNameToId fixture) never exercised
// this - it only ever hits the "couldn't resolve the effect name" fallback,
// which correctly keeps the literal "Unusual" word. This one gives the
// schema a real effectNameToId entry so the substitution actually happens.
test("substitutes the resolved effect name for the literal 'Unusual' word when searching gladiator.tf/pricedb.io, unlike the item's own resolveStatsAndClassifieds/stntrading.eu links", async () => {
  installGlobals({ href: "https://next.backpack.tf/stats?item=Mining+Light&quality=Unusual&priceindex=12", sku: "48;5;u12" });
  const { card } = buildItemInfoCard();
  global.document = makeDocument([card]);

  const originalGet = globalThis.chrome.storage.local.get;
  globalThis.chrome.storage.local.get = async () => ({
    tf2SchemaCache: {
      itemNameToDefindex: {},
      defindexToItemName: {},
      effectNameToId: { "Massed Flies": 12 },
      fetchedAt: Date.now(),
      schemaShapeVersion: 4,
    },
  });

  try {
    const { __resetSchemaCacheForTests } = await import("../utils/tf2Schema.js");
    __resetSchemaCacheForTests();

    statsPageQuickLinks();
    await flush();

    assert.equal(getQuickLink("gladiator.tf")?.href, "https://gladiator.tf/sales?item=Massed+Flies+Mining+Light");
    assert.equal(getQuickLink("pricedb.io")?.href, "https://pricedb.io/item/48%3B5%3Bu12");
    assert.equal(lastPricedbQuery, "Massed Flies Mining Light"); // the actual query sent, not "Unusual Mining Light"
    // snapshot gets the same substitution - confirmed live: "/classifieds/
    // snapshots/Orbiting%20Planets%20Train%20of%20Thought", not "...Unusual...".
    assert.equal(getQuickLink("snapshot")?.href, "https://next.backpack.tf/classifieds/snapshots/Massed%20Flies%20Mining%20Light");
    // Meanwhile stntrading.eu keeps its own confirmed-live "Unusual {Effect}
    // {Item}" shape (a THIRD, distinct convention) - not affected by this fix.
    assert.equal(getQuickLink("stntrading.eu")?.href, "https://stntrading.eu/item/tf2/Unusual+Massed+Flies+Mining+Light");
    // mannco.store filters by the effect too, like the tooltip's own
    // mannco.store button (it used to get no effect param on this page).
    assert.equal(new URL(getQuickLink("mannco.store")?.href).searchParams.get("effect"), "Massed Flies");
  } finally {
    globalThis.chrome.storage.local.get = originalGet;
    const { __resetSchemaCacheForTests } = await import("../utils/tf2Schema.js");
    __resetSchemaCacheForTests();
  }
});

// Confirmed live: "?item=Wrench&quality=Strange&killstreakTier=3" (a
// Professional Killstreak Wrench) - "item" itself always stays bare (never
// "Professional Killstreak Wrench"), the tier is its own separate param
// (0 = No Kit through 3 = Professional). Baked into the built name AND
// passed as its own knownKillstreakTier/killstreakTier option, same "both
// at once" pattern the classic-UI version of this file also uses.
test("resolves a Killstreak-tiered weapon using the URL's own killstreakTier param, baking the tier prefix into the built name", async () => {
  installGlobals({ href: "https://next.backpack.tf/stats?item=Wrench&quality=Strange&killstreakTier=3", sku: "738;11;kt-3" });
  const { card } = buildItemInfoCard();
  global.document = makeDocument([card]);

  statsPageQuickLinks();
  await flush();

  assert.equal(getQuickLink("gladiator.tf")?.href, "https://gladiator.tf/sales?item=Strange+Professional+Killstreak+Wrench");
  assert.match(getQuickLink("mannco.store")?.href, /killstreak=Professional\+Killstreak/);
  assert.equal(getQuickLink("pricedb.io")?.href, "https://pricedb.io/item/738%3B11%3Bkt-3");
});

// REGRESSION for a live bug report, with real confirmed-working
// marketplace.tf/mannco.store URLs for a "Professional Killstreak
// Australium Medi Gun": confirmed live this page's own URL carries
// "&australium=true" too (the item-preview tooltip's own equivalent
// Classifieds anchor carries "&australium=1" instead - see
// ../addMarketplaceButton/content.js's own matching fix) - marketplace.tf/
// mannco.store used to search for the bare item name with no Australium
// signal at all.
test("resolves an Australium item using the URL's own australium=true param, embedding 'Australium ' into the built name", async () => {
  installGlobals({ href: "https://next.backpack.tf/stats?item=Wrench&quality=Strange&killstreakTier=3&australium=true", sku: "738;11;kt-3" });
  const { card } = buildItemInfoCard();
  global.document = makeDocument([card]);

  statsPageQuickLinks();
  await flush();

  assert.equal(
    getQuickLink("gladiator.tf")?.href,
    "https://gladiator.tf/sales?item=Strange+Professional+Killstreak+Australium+Wrench"
  );
  assert.match(getQuickLink("mannco.store")?.href, /search=Australium\+Wrench/);
});

// REGRESSION for a live confirmation ("killstreak items"): a Killstreak/
// Australium item is never Unusual, so searchDisplayName's own effect-name
// substitution never applies (it's a no-op there, falling straight back to
// itemNameRaw) - confirmed live: "/classifieds/snapshots/Strange%20
// Professional%20Killstreak%20Australium%20Eyelander", the same full name
// gladiator.tf/mannco.store already use, not some different shape.
test("snapshot uses the full quality+killstreak+Australium name for a non-Unusual item, unaffected by the effect-name substitution", async () => {
  installGlobals({ href: "https://next.backpack.tf/stats?item=Eyelander&quality=Strange&killstreakTier=3&australium=true", sku: null });
  const { card } = buildItemInfoCard();
  global.document = makeDocument([card]);

  statsPageQuickLinks();
  await flush();

  assert.equal(
    getQuickLink("snapshot")?.href,
    "https://next.backpack.tf/classifieds/snapshots/Strange%20Professional%20Killstreak%20Australium%20Eyelander"
  );
});

test("a killstreakTier of 0 (or missing) builds the plain name with no Killstreak prefix at all", async () => {
  installGlobals({ href: "https://next.backpack.tf/stats?item=Wrench&quality=Strange&killstreakTier=0" });
  const { card } = buildItemInfoCard();
  global.document = makeDocument([card]);

  statsPageQuickLinks();
  await flush();

  assert.equal(getQuickLink("gladiator.tf")?.href, "https://gladiator.tf/sales?item=Strange+Wrench");
  assert.match(getQuickLink("mannco.store")?.href, /killstreak=No\b/);
});

test("does not insert a row at all when the URL is missing item/quality (not this feature's scope)", async () => {
  installGlobals({ href: "https://next.backpack.tf/stats" });
  const { card, content, itemBlock } = buildItemInfoCard();
  global.document = makeDocument([card]);

  statsPageQuickLinks();
  await flush();

  assert.equal(getQuickLinksRow(), null);
  assert.deepEqual(content.children, [itemBlock]); // untouched
});

test("does not insert a row when the quality name isn't recognized (unusual URL shape, don't guess)", async () => {
  installGlobals({ href: "https://next.backpack.tf/stats?item=Rocket+Launcher&quality=NotARealQuality" });
  const { card, content, itemBlock } = buildItemInfoCard();
  global.document = makeDocument([card]);

  statsPageQuickLinks();
  await flush();

  assert.equal(getQuickLinksRow(), null);
  assert.deepEqual(content.children, [itemBlock]);
});

test("does nothing when the page has no 'Item Information' card at all (not a /stats page)", async () => {
  installGlobals();
  global.document = makeDocument([]);

  await assert.doesNotReject(async () => {
    statsPageQuickLinks();
    await flush();
  });
  assert.equal(getQuickLinksRow(), null);
});

test("finds the Item Information card specifically, not another card's own header actions (e.g. a fullscreen icon row)", async () => {
  installGlobals();
  const otherCard = new FakeElement("div");
  otherCard.classList.add("card");
  const otherTitle = new FakeElement("div");
  otherTitle.className = "card__header__title";
  otherTitle.textContent = "Classifieds Trends";
  otherCard.appendChild(otherTitle);
  const otherActions = new FakeElement("div");
  otherActions.className = "card__header__actions";
  otherCard.appendChild(otherActions);
  const otherRow = new FakeElement("div");
  otherRow.className = "row";
  otherActions.appendChild(otherRow);

  const { card } = buildItemInfoCard();
  global.document = makeDocument([otherCard, card]);

  statsPageQuickLinks();
  await flush();

  assert.equal(otherRow.children.length, 0); // untouched
  assert.ok(getQuickLinksRow()); // the real card got the buttons
});

test("re-running for the SAME url doesn't duplicate the row (signature dedupe)", async () => {
  installGlobals();
  const { card, content } = buildItemInfoCard();
  global.document = makeDocument([card]);

  statsPageQuickLinks();
  await flush();
  const countAfterFirst = content.children.length;

  // A later observer tick for an unrelated mutation on the same page.
  FakeMutationObserver.instances[0].cb([{ addedNodes: [] }]);
  await flush();

  assert.equal(content.children.length, countAfterFirst);
  assert.equal(document.querySelectorAll(".tf2te-stats-quick-links-row").length, 1);
});

test("navigating to a different item's /stats page (URL changes, same SPA, no reload) rebuilds the row for the new item", async () => {
  installGlobals({ href: "https://next.backpack.tf/stats?item=Rocket+Launcher&quality=Unique", sku: "205;6" });
  const { card } = buildItemInfoCard();
  global.document = makeDocument([card]);

  statsPageQuickLinks();
  await flush();
  assert.equal(getQuickLink("gladiator.tf")?.href, "https://gladiator.tf/sales?item=Rocket+Launcher");

  // Vue-style in-app navigation: URL changes, same DOM nodes get reused/patched.
  window.location.href = "https://next.backpack.tf/stats?item=Reclaimed+Metal&quality=Unique";
  pricedbSku = "143;6";

  FakeMutationObserver.instances[0].cb([{ addedNodes: [] }]);
  await flush();

  assert.equal(getQuickLink("gladiator.tf")?.href, "https://gladiator.tf/sales?item=Reclaimed+Metal");
  // Old item's row isn't left behind duplicated alongside the new one.
  assert.equal(document.querySelectorAll(".tf2te-stats-quick-links-row").length, 1);
});

test("statsPageQuickLinks sets up a subtree MutationObserver on document.body", () => {
  installGlobals();
  global.document = makeDocument([]);

  statsPageQuickLinks();

  assert.equal(FakeMutationObserver.instances.length, 1);
  assert.equal(FakeMutationObserver.instances[0].target, document.body);
  assert.deepEqual(FakeMutationObserver.instances[0].opts, { childList: true, subtree: true });
});

// The rest of the row no longer waits for pricedb.io's lookup: its slot
// shows a loading state (label + spinner, aria-busy) until it answers, and a
// genuine "no listing" answer removes the slot.
test("shows the row right away with a loading pricedb.io slot, which is removed when pricedb.io has no listing", async () => {
  installGlobals({ href: "https://next.backpack.tf/stats?item=Rocket+Launcher&quality=Unique" });
  const { card } = buildItemInfoCard();
  global.document = makeDocument([card]);

  const originalSendMessage = globalThis.chrome.runtime.sendMessage;
  let answer;
  globalThis.chrome.runtime.sendMessage = (msg) => {
    const url = new URL(msg.url);
    if (!url.hostname.includes("pricedb.io")) return Promise.reject(new Error(`unexpected sendMessage: ${msg.url}`));
    return new Promise((resolve) => (answer = () => resolve({ ok: true, data: { success: true, data: { results: [] } } })));
  };

  try {
    statsPageQuickLinks();
    await flush();

    assert.ok(getQuickLink("gladiator.tf"), "the row must not wait for pricedb.io");
    const loading = getQuickLinks().find((el) => el.getAttribute("aria-busy") === "true");
    assert.ok(loading, "expected the loading pricedb.io slot");
    assert.match(loading.title, /Looking up this item on pricedb\.io/);

    answer();
    await flush();
    assert.equal(getQuickLinks().some((el) => el.getAttribute("aria-busy") === "true"), false, "no listing: the slot is removed");
    assert.ok(getQuickLink("gladiator.tf"));
  } finally {
    globalThis.chrome.runtime.sendMessage = originalSendMessage;
  }
});
