import { test, mock } from "node:test";
import assert from "node:assert/strict";

// Same "pre-seeded schema cache installed before import" pattern
// tests/statsPageQuickLinks.test.js's own header comment documents in full -
// utils/tf2Schema.js memoizes its result at module scope for this file's
// whole lifetime.
globalThis.chrome = {
  storage: {
    local: {
      async get() {
        return {
          ...(savedSteamApiKey ? { steamApiKey: savedSteamApiKey } : {}),
          ...(sheenKillstreakerFilterOff ? { sheenKillstreakerFilterEnabled: false } : {}),
          tf2SchemaCache: {
            itemNameToDefindex: { "Summer 2026 Cosmetic Key": 5977, "Rocket Launcher": 205, "Team Captain": 378, "Apparition's Aspect": 571 },
            defindexToItemName: {},
            effectNameToId: { "Burning Flames": 13 },
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
    // Routes pricedb.io's own /api/search - every other call this feature
    // makes (posts.tf's own defindex lookup) is served entirely from the
    // pre-seeded schema cache above and never reaches this at all.
    async sendMessage(msg) {
      const url = new URL(msg.url);
      if (!url.hostname.includes("pricedb.io")) {
        throw new Error(`unexpected sendMessage: ${msg.url}`);
      }
      if (pricedbRateLimited) return { ok: false, status: 429, error: "Rate limited (429)", retryAfterMs: pricedbRetryAfterMs };
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
let pricedbSku = "5977;6;uncraftable";
let pricedbRateLimited = false;
let pricedbRetryAfterMs;
// Whether a Steam Web API key is "saved" (the posts.tf key hint reads it).
let savedSteamApiKey = null;
// The popup's Sheen/Killstreaker filtering toggle, switched off.
let sheenKillstreakerFilterOff = false;

// The key-hint and countdown buttons (utils/linkButtonStates.js) set their
// label as text and then append an icon; this file's fake reads only the
// children's text once any exist, so the label is read off _textContent.
function findStateButton(label, { needsKey = false } = {}) {
  return (getQuickLinks() || []).find((el) => el._textContent === label && (needsKey ? el.dataset.tf2teNeedsKey === "1" : /Retrying automatically/.test(el.title || ""))) || null;
}

const { itemQuickLinks } = await import("../marketplace.tf/itemQuickLinks/content.js");
const { __resetPricedbCacheForTests } = await import("../utils/pricedb.js");

// Same hand-rolled fake DOM every other quick-links test file in this repo
// already uses (see tests/addGladiatorButton.test.js's own header comment
// for why this repo hand-rolls rather than pulling in jsdom).
function parseCompound(selector) {
  const attrMatch = /\[id="([^"]+)"\]/.exec(selector); // not used by this file's own selectors, kept for parity
  // Bare [attr] presence checks (e.g. td[data-content]) and :last-child.
  const attrPresence = [...selector.matchAll(/\[([\w-]+)\]/g)].map((m) => m[1]);
  const lastChild = /:last-child/.test(selector);
  const rest = selector.replace(/\[[^\]]*\]/g, "").replace(/:last-child/g, "");
  const idMatch = /#([\w-]+)/.exec(rest);
  const classes = [...rest.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
  const tagMatch = /^[a-zA-Z][\w-]*/.exec(rest);
  return { tag: tagMatch ? tagMatch[0].toLowerCase() : null, id: idMatch ? idMatch[1] : null, classes, attrMatch, attrPresence, lastChild };
}

function matchesCompound(el, parsed) {
  if (!el || el.nodeType !== 1) return false;
  if (parsed.tag && el.tagName.toLowerCase() !== parsed.tag) return false;
  if (parsed.id && el.getAttribute("id") !== parsed.id) return false;
  if (parsed.attrPresence?.some((name) => el.getAttribute(name) == null)) return false;
  if (parsed.lastChild) {
    const siblings = (el.parentElement?.children ?? []).filter((c) => c.nodeType === 1);
    if (siblings[siblings.length - 1] !== el) return false;
  }
  return parsed.classes.every((c) => el.classList.contains(c));
}

// A descendant selector ("#items-list table tbody tr"): the last part must
// match the element, the earlier parts its ancestors, in order.
function matchesSelector(el, parts) {
  if (!matchesCompound(el, parts[parts.length - 1])) return false;
  let i = parts.length - 2;
  let ancestor = el.parentElement;
  while (i >= 0 && ancestor) {
    if (matchesCompound(ancestor, parts[i])) i--;
    ancestor = ancestor.parentElement;
  }
  return i < 0;
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
      remove: (...cs) => cs.forEach((c) => classSet.delete(c)),
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
  // Standard DOM methods the link-state buttons (utils/linkButtonStates.js)
  // rely on: the key hint and the pricedb.io countdown.
  removeAttribute(name) {
    delete this._attrs[name];
  }
  addEventListener(type, cb) {
    ((this._listeners ||= {})[type] ||= []).push(cb);
  }
  dispatchEvent(evt) {
    for (const cb of this._listeners?.[evt.type] || []) cb({ currentTarget: this, preventDefault() {}, stopPropagation() {}, ...evt });
    return true;
  }
  // A string becomes a text node, as in the real DOM.
  append(...nodes) {
    for (const n of nodes) {
      if (typeof n === "string") this.children.push({ nodeType: 3, textContent: n, children: [], parentElement: this });
      else this.appendChild(n);
    }
  }
  prepend(el) {
    this.children.unshift(el);
    el.parentElement = this;
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
  remove() {
    if (!this.parentElement) return;
    const siblings = this.parentElement.children;
    const idx = siblings.indexOf(this);
    if (idx !== -1) siblings.splice(idx, 1);
    this.parentElement = null;
  }
  querySelectorAll(selector) {
    const parts = selector.trim().split(/\s+/).map(parseCompound);
    const out = [];
    const walk = (el) => {
      for (const child of el.children) {
        if (matchesSelector(child, parts)) out.push(child);
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
  const head = new FakeElement("head");
  for (const c of rootChildren) body.appendChild(c);
  return {
    body,
    head,
    createElement: (tag) => new FakeElement(tag),
    createElementNS: (_ns, tag) => new FakeElement(tag),
    getElementById: (id) => body.querySelectorAll(`#${id}`)[0] || head.querySelectorAll(`#${id}`)[0] || null,
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

function installGlobals({ sku = "5977;6;uncraftable", rateLimited = false } = {}) {
  global.window = { location: { href: "https://marketplace.tf/items/tf2/5977;6;uncraftable" } };
  global.Node = { ELEMENT_NODE: 1 };
  global.MutationObserver = FakeMutationObserver;
  FakeMutationObserver.instances = [];
  lastPricedbQuery = null;
  pricedbSku = sku;
  pricedbRateLimited = rateLimited;
  __resetPricedbCacheForTests();
}

// Confirmed live shape (see this feature's own header note): a
// ".item-title-container" holding ".item-title" and ".item-buttons" (with
// the native "#btnBackpackTFStats" link inside it) - the quick-links row is
// inserted as a SIBLING right after ".item-title-container" itself.
function buildTitleContainer({ href = "https://next.backpack.tf/stats?item=Rocket+Launcher&craftable=1&quality=6", title = null } = {}) {
  const container = new FakeElement("div");
  container.className = "item-title-container";

  const titleEl = new FakeElement("div");
  titleEl.className = "item-title";
  // Confirmed live: the name sits in a colored <span> inside .item-title.
  if (title) {
    const span = new FakeElement("span");
    span.textContent = title;
    titleEl.appendChild(span);
  }
  container.appendChild(titleEl);

  const buttonsEl = new FakeElement("div");
  buttonsEl.className = "item-buttons";
  container.appendChild(buttonsEl);

  const backpackTfBtn = new FakeElement("a");
  backpackTfBtn.id = "btnBackpackTFStats";
  backpackTfBtn.setAttribute("href", href);
  buttonsEl.appendChild(backpackTfBtn);

  return { container, backpackTfBtn };
}

function getRow() {
  return document.querySelectorAll(".tf2te-mptf-quick-links-row")[0] || null;
}

function getQuickLinks() {
  return getRow()?.querySelectorAll(".tf2te-mptf-quick-link-button") ?? [];
}

function getQuickLink(label) {
  return getQuickLinks().find((link) => link.textContent === label) || null;
}

test("adds gladiator.tf/pricedb.io/stntrading.eu/mannco.store/Steam Market buttons for a plain item, reading identity off the native BackpackTF button's own href", async () => {
  installGlobals();
  const { container } = buildTitleContainer({
    href: "https://next.backpack.tf/stats?item=Summer+2026+Cosmetic+Key&craftable=0&quality=6",
  });
  global.document = makeDocument([container]);

  itemQuickLinks();
  await flush();

  assert.equal(getQuickLink("gladiator.tf")?.href, "https://gladiator.tf/sales?item=Non-Craftable+Summer+2026+Cosmetic+Key");
  assert.equal(getQuickLink("pricedb.io")?.href, "https://pricedb.io/item/5977%3B6%3Buncraftable");
  // stntrading.eu's own general-case href reuses buildSteamMarketName, which
  // strips the "Non-Craftable " prefix (Steam's own market_hash_name
  // convention - already established/tested behavior, not new here).
  assert.equal(getQuickLink("stntrading.eu")?.href, "https://stntrading.eu/item/tf2/Summer+2026+Cosmetic+Key");
  assert.ok(getQuickLink("mannco.store"));
  assert.ok(getQuickLink("Steam Market"));
  // "Non-Craftable " comes from the href's own craftable=0 param, matching
  // the on-page title text ("Uncraftable Summer 2026 Cosmetic Key") without
  // ever having to parse/strip that display text itself.
  assert.equal(lastPricedbQuery, "Non-Craftable Summer 2026 Cosmetic Key");
});

// The page's own native "BackpackTF" button already goes to
// next.backpack.tf, so this row's "backpack.tf" button links to CLASSIC
// backpack.tf instead - a genuinely different destination, not a duplicate
// of the native button.
test("adds a classic backpack.tf button (not next.backpack.tf), and never a marketplace.tf button - this page IS marketplace.tf", async () => {
  installGlobals();
  const { container } = buildTitleContainer();
  global.document = makeDocument([container]);

  itemQuickLinks();
  await flush();

  assert.equal(getQuickLink("backpack.tf")?.href, "https://backpack.tf/stats/Unique/Rocket%20Launcher/Tradable/Craftable");
  assert.equal(getQuickLink("next.backpack.tf"), null);
  const labels = getQuickLinks().map((l) => l.textContent);
  assert.equal(labels.some((l) => l.includes("marketplace.tf")), false);
});

test("does nothing (and doesn't throw) when the native BackpackTF button isn't present - no identity to resolve from", async () => {
  installGlobals();
  const container = new FakeElement("div");
  container.className = "item-title-container";
  global.document = makeDocument([container]);

  itemQuickLinks();
  await flush();

  assert.equal(getRow(), null);
});

test("a real 429 shows a 'pricedb.io Ns' countdown instead of silently omitting the button, then retries by itself", async () => {
  mock.timers.enable({ apis: ["setInterval"] });
  try {
    installGlobals({ rateLimited: true });
    pricedbRetryAfterMs = 2000;
    const { container } = buildTitleContainer();
    global.document = makeDocument([container]);

    itemQuickLinks();
    await flush();

    assert.equal(getQuickLink("pricedb.io"), null);
    const countdown = findStateButton("pricedb.io");
    assert.ok(countdown, "expected the countdown");
    assert.equal(countdown.tagName.toLowerCase(), "span");
    assert.match(countdown.title, /in 2s/);
    assert.equal(countdown.classList.contains("disabled"), false, "Bootstrap's disabled class would block its hover text");

    pricedbRateLimited = false;
    mock.timers.tick(2000);
    await flush();

    assert.ok(getQuickLink("pricedb.io"), "expected the real pricedb.io link after the retry");
    assert.equal(findStateButton("pricedb.io"), null);
  } finally {
    pricedbRetryAfterMs = undefined;
    mock.timers.reset();
  }
});

test("with no Steam Web API key, an item posts.tf can't resolve gets posts.tf's key hint", async () => {
  installGlobals();
  savedSteamApiKey = null;
  const { container } = buildTitleContainer({ href: "https://next.backpack.tf/stats?item=Brotherhood+of+Arms&craftable=1&quality=6" });
  global.document = makeDocument([container]);

  itemQuickLinks();
  await flush();

  const hint = findStateButton("posts.tf", { needsKey: true });
  assert.ok(hint, "expected posts.tf's key hint");
  assert.match(hint.title, /Steam Web API key/);
});

test("with a key saved, an item posts.tf still can't resolve gets no key hint", async () => {
  installGlobals();
  savedSteamApiKey = "abc123";
  try {
    const { container } = buildTitleContainer({ href: "https://next.backpack.tf/stats?item=Brotherhood+of+Arms&craftable=1&quality=6" });
  global.document = makeDocument([container]);

    itemQuickLinks();
    await flush();

    assert.equal(findStateButton("posts.tf", { needsKey: true }), null);
  } finally {
    savedSteamApiKey = null;
  }
});

test("omits the pricedb.io button entirely for a genuine no-match (not rate limited)", async () => {
  installGlobals({ sku: null });
  const { container } = buildTitleContainer();
  global.document = makeDocument([container]);

  itemQuickLinks();
  await flush();

  assert.equal(getQuickLink("pricedb.io"), null);
  assert.equal(getQuickLink("pricedb.io (rate limited)"), null);
});

test("resolves an Unusual's effect name from its own priceindex param (reverse-looked-up against the schema), for gladiator.tf/pricedb.io/stntrading.eu", async () => {
  installGlobals();
  const { container } = buildTitleContainer({
    href: "https://next.backpack.tf/stats?item=Team+Captain&craftable=1&quality=5&priceindex=13",
  });
  global.document = makeDocument([container]);

  itemQuickLinks();
  await flush();

  // gladiator.tf/pricedb.io both expect the trading community's own
  // "{Effect} {Item}" form, not Steam's raw "Unusual {Item}" text.
  assert.equal(getQuickLink("gladiator.tf")?.href, "https://gladiator.tf/sales?item=Burning+Flames+Team+Captain");
  assert.equal(lastPricedbQuery, "Burning Flames Team Captain");
});

test("re-running for the SAME native button href doesn't duplicate the row (signature dedupe)", async () => {
  installGlobals();
  const { container } = buildTitleContainer();
  global.document = makeDocument([container]);

  itemQuickLinks();
  await flush();
  assert.equal(document.querySelectorAll(".tf2te-mptf-quick-links-row").length, 1);

  FakeMutationObserver.instances[0].cb();
  await flush();
  assert.equal(document.querySelectorAll(".tf2te-mptf-quick-links-row").length, 1);
});

// A reactive re-render of the surrounding page could wipe the row out
// without touching .item-title-container itself, in which case the
// dataset-marker-only dedupe check would think it was already there forever
// and never rebuild it. Applied here proactively - not itself seen on
// marketplace.tf, but the identical risk.
test("REGRESSION: rebuilds the row if it's wiped out (e.g. by a reactive re-render) even though the native button's own href hasn't changed", async () => {
  installGlobals();
  const { container } = buildTitleContainer();
  global.document = makeDocument([container]);

  itemQuickLinks();
  await flush();
  assert.ok(getRow());

  getRow().remove(); // simulate the framework wiping the row out on its own
  assert.equal(getRow(), null);

  FakeMutationObserver.instances[0].cb();
  await flush();

  assert.ok(getRow());
});

test("itemQuickLinks sets up a subtree MutationObserver on document.body", () => {
  installGlobals();
  global.document = makeDocument([]);

  itemQuickLinks();

  assert.equal(FakeMutationObserver.instances.length, 1);
  assert.equal(FakeMutationObserver.instances[0].target, document.body);
  assert.deepEqual(FakeMutationObserver.instances[0].opts, { childList: true, subtree: true });
});

// Same split button as mannco.store's row (Option B from the "mannco.store
// Link Row Options" mockup): classic backpack.tf stats + its classifieds.
test("pairs the backpack.tf stats button with its classifieds search as one split button (stats + 📰)", async () => {
  installGlobals();
  const { container } = buildTitleContainer();
  global.document = makeDocument([container]);

  itemQuickLinks();
  await flush();

  const pairs = getRow().querySelectorAll(".tf2te-mptf-quick-link-pair");
  assert.equal(pairs.length, 1, "classic backpack.tf only - next.backpack.tf stats is the page's own native button");
  const [stats, classifieds] = pairs[0].children;
  assert.equal(stats.textContent, "backpack.tf");
  assert.match(stats.href, /^https:\/\/backpack\.tf\/stats\//);
  assert.equal(classifieds.textContent, "📰");
  assert.match(classifieds.href, /^https:\/\/backpack\.tf\/classifieds\?/);
  assert.equal(new URL(classifieds.href).searchParams.get("item"), "Rocket Launcher");
  assert.equal(classifieds.title, "backpack.tf classifieds");
});

// Seen live: an Unusual's backpack.tf links were built as a Unique item named
// "{Effect} {Item}" (/stats/Unique/Phosphorous Connoisseur's Cap/...) because
// the effect-first search name was also fed to resolveStatsAndClassifieds,
// which needs the literal "Unusual" word to take its Unusual branch.
test("REGRESSION: an Unusual's backpack.tf stats and classifieds links are built as Unusual with the effect, not as a Unique '{Effect} {Item}'", async () => {
  installGlobals();
  const { container } = buildTitleContainer({
    href: "https://next.backpack.tf/stats?item=Connoisseur%27s+Cap&craftable=1&quality=5&priceindex=63",
  });
  global.document = makeDocument([container]);

  itemQuickLinks();
  await flush();

  const [stats, classifieds] = getRow().querySelectorAll(".tf2te-mptf-quick-link-pair")[0].children;
  assert.equal(stats.href, "https://backpack.tf/stats/Unusual/Connoisseur's%20Cap/Tradable/Craftable/63");
  const params = new URL(classifieds.href).searchParams;
  assert.equal(params.get("item"), "Connoisseur's Cap");
  assert.equal(params.get("quality"), "5");
  assert.equal(params.get("particle"), "63");

  // gladiator.tf/pricedb.io still get the effect-first name they need.
  assert.equal(getQuickLink("gladiator.tf")?.href, "https://gladiator.tf/sales?item=Phosphorous+Connoisseur%27s+Cap");
  assert.equal(lastPricedbQuery, "Phosphorous Connoisseur's Cap");
});

// Seen live: a Strange Professional Killstreak Australium Rocket Launcher got
// the plain Rocket Launcher's links - the native href's item param is the
// bare weapon, with Australium as its own "australium=1" flag.
test("REGRESSION: reads the native href's australium=1 flag, so an Australium gets the Australium stats/classifieds links", async () => {
  installGlobals();
  const { container } = buildTitleContainer({
    href: "https://next.backpack.tf/stats?item=Rocket+Launcher&craftable=1&quality=11&killstreakTier=3&australium=1",
  });
  global.document = makeDocument([container]);

  itemQuickLinks();
  await flush();

  const [stats, classifieds] = getRow().querySelectorAll(".tf2te-mptf-quick-link-pair")[0].children;
  assert.equal(stats.href, "https://backpack.tf/stats/Strange/Professional%20Killstreak%20Australium%20Rocket%20Launcher/Tradable/Craftable");
  const params = new URL(classifieds.href).searchParams;
  assert.equal(params.get("item"), "Rocket Launcher");
  assert.equal(params.get("quality"), "11");
  assert.equal(params.get("australium"), "1");
  assert.equal(params.get("killstreak_tier"), "3");
  assert.equal(lastPricedbQuery, "Strange Professional Killstreak Australium Rocket Launcher");
});

test("a plain (non-Australium) weapon still gets australium=-1", async () => {
  installGlobals();
  const { container } = buildTitleContainer({
    href: "https://next.backpack.tf/stats?item=Rocket+Launcher&craftable=1&quality=11&killstreakTier=3",
  });
  global.document = makeDocument([container]);

  itemQuickLinks();
  await flush();

  const [stats, classifieds] = getRow().querySelectorAll(".tf2te-mptf-quick-link-pair")[0].children;
  assert.equal(stats.href, "https://backpack.tf/stats/Strange/Professional%20Killstreak%20Rocket%20Launcher/Tradable/Craftable");
  assert.equal(new URL(classifieds.href).searchParams.get("australium"), "-1");
});

// "Australium Gold" is a Paint Can, not an Australium weapon (the same trap
// scrap.tf's /items page hit before - see utils/tf2AttributeIds.js's
// PAINT_IDS / hasLiteralAustraliumPrefix). Its own name must never be
// treated as "Australium " + "Gold", with or without an australium flag.
for (const href of [
  "https://next.backpack.tf/stats?item=Australium+Gold&craftable=1&quality=6",
  "https://next.backpack.tf/stats?item=Australium+Gold&craftable=1&quality=6&australium=1",
]) {
  test(`the Australium Gold paint keeps its own name and australium=-1 (${href.includes("australium=1") ? "even with an australium=1 flag" : "no flag"})`, async () => {
    installGlobals();
    const { container } = buildTitleContainer({ href });
    global.document = makeDocument([container]);

    itemQuickLinks();
    await flush();

    const [stats, classifieds] = getRow().querySelectorAll(".tf2te-mptf-quick-link-pair")[0].children;
    assert.equal(stats.href, "https://backpack.tf/stats/Unique/Australium%20Gold/Tradable/Craftable");
    const params = new URL(classifieds.href).searchParams;
    assert.equal(params.get("item"), "Australium Gold");
    assert.equal(params.get("australium"), "-1");
  });
}

// Confirmed live (user-provided correct link) for a Strange Professional
// Killstreak Australium Rocket Launcher: "Australium" in the search text, the
// killstreak tier as its own param, no quality param.
test("REGRESSION: an Australium's mannco.store link searches 'Australium {weapon}' with its killstreak tier and no quality", async () => {
  installGlobals();
  const { container } = buildTitleContainer({
    href: "https://next.backpack.tf/stats?item=Rocket+Launcher&craftable=1&quality=11&killstreakTier=3&australium=1",
  });
  global.document = makeDocument([container]);

  itemQuickLinks();
  await flush();

  assert.equal(getQuickLink("mannco.store")?.href, "https://mannco.store/tf2?search=Australium+Rocket+Launcher&killstreak=Professional+Killstreak");
});

for (const [tier, value] of [[2, "Specialized+Killstreak"], [1, "Killstreak"]]) {
  test(`a non-Australium killstreak weapon's mannco.store link keeps its quality and adds killstreak=${value}`, async () => {
    installGlobals();
    const { container } = buildTitleContainer({
      href: `https://next.backpack.tf/stats?item=Rocket+Launcher&craftable=1&quality=11&killstreakTier=${tier}`,
    });
    global.document = makeDocument([container]);

    itemQuickLinks();
    await flush();

    assert.equal(getQuickLink("mannco.store")?.href, `https://mannco.store/tf2?search=Rocket+Launcher&quality=Strange&killstreak=${value}`);
  });
}

// Confirmed live: for a Strangifier the native BackpackTF button's href is
// only "?item=Strangifier&quality=6" (no target), so every link searched the
// bare "Strangifier". The full name comes off the page title instead.
const APPARITION_STRANGIFIER = {
  href: "https://next.backpack.tf/stats?item=Strangifier&quality=6",
  title: "Apparition's Aspect Strangifier",
};

test("REGRESSION: a Strangifier's links use its full name from the page title (the href only says 'Strangifier')", async () => {
  installGlobals();
  const { container } = buildTitleContainer(APPARITION_STRANGIFIER);
  global.document = makeDocument([container]);

  itemQuickLinks();
  await flush();

  // User-provided correct links.
  assert.equal(getQuickLink("gladiator.tf")?.href, "https://gladiator.tf/sales?item=Apparition%27s+Aspect+Strangifier");
  assert.equal(getQuickLink("mannco.store")?.href, "https://mannco.store/tf2?search=Apparition%27s+Aspect+Strangifier&quality=Unique");
  // Built by the shared builders from the full name (571 = the target's
  // defindex, the same "td-571" the page's own SKU carries).
  assert.equal(getQuickLink("backpack.tf")?.href, "https://backpack.tf/stats/Unique/Strangifier/Tradable/Craftable/571");
  assert.equal(getQuickLink("stntrading.eu")?.href, "https://stntrading.eu/item/tf2/Apparition's+Aspect+Strangifier");
  assert.equal(getQuickLink("Steam Market")?.href, "https://steamcommunity.com/market/listings/440/Apparition's%20Aspect%20Strangifier");
  assert.equal(lastPricedbQuery, "Apparition's Aspect Strangifier");
});

test("a Strangifier whose title doesn't match the expected '{target} Strangifier' shape keeps the href's own name (no guessing)", async () => {
  installGlobals();
  const { container } = buildTitleContainer({ href: APPARITION_STRANGIFIER.href, title: "Something Unexpected" });
  global.document = makeDocument([container]);

  itemQuickLinks();
  await flush();

  assert.equal(getQuickLink("gladiator.tf")?.href, "https://gladiator.tf/sales?item=Strangifier");
});

// Confirmed live: the BackpackTF button's href carries a Killstreak item's
// Sheen/Killstreaker as next.backpack.tf ids (sheen=7 = Hot Rod,
// killstreaker=2004 = Tornado, matching the page's own description lines).
// They were never read, so no link filtered by them.
const HOT_ROD_TORNADO_BLACK_BOX = "https://next.backpack.tf/stats?item=Black+Box&australium=1&quality=11&killstreakTier=3&sheen=7&killstreaker=2004";

test("REGRESSION: a Killstreak item's Sheen/Killstreaker (ids in the BackpackTF href) filter the classifieds, mannco.store and Steam Market links", async () => {
  installGlobals();
  const { container } = buildTitleContainer({ href: HOT_ROD_TORNADO_BLACK_BOX });
  global.document = makeDocument([container]);

  itemQuickLinks();
  await flush();

  assert.equal(
    getQuickLink("📰")?.href,
    "https://backpack.tf/classifieds?item=Black+Box&quality=11&tradable=1&craftable=1&australium=1&killstreak_tier=3&sheen=7&killstreaker=2004&spell=None"
  );
  assert.equal(
    getQuickLink("mannco.store")?.href,
    "https://mannco.store/tf2?search=Australium+Black+Box&killstreak=Professional+Killstreak&sheen=Hot+Rod&killstreaker=Tornado"
  );
  // Killstreaker first, then Sheen - the same q= order confirmed live for Kits.
  assert.equal(
    getQuickLink("Steam Market")?.href,
    "https://steamcommunity.com/market/listings/440/Strange%20Professional%20Killstreak%20Australium%20Black%20Box?appid=440&q=Tornado%2CHot+Rod"
  );
});

test("with Sheen/Killstreaker filtering switched off in the popup, those links keep only the killstreak tier", async () => {
  installGlobals();
  sheenKillstreakerFilterOff = true;
  try {
    const { container } = buildTitleContainer({ href: HOT_ROD_TORNADO_BLACK_BOX });
    global.document = makeDocument([container]);

    itemQuickLinks();
    await flush();

    assert.doesNotMatch(getQuickLink("📰")?.href ?? "", /sheen=|killstreaker=/);
    assert.equal(getQuickLink("mannco.store")?.href, "https://mannco.store/tf2?search=Australium+Black+Box&killstreak=Professional+Killstreak");
    assert.equal(getQuickLink("Steam Market")?.href, "https://steamcommunity.com/market/listings/440/Strange%20Professional%20Killstreak%20Australium%20Black%20Box");
  } finally {
    sheenKillstreakerFilterOff = false;
  }
});

test("a plain item's mannco.store link is unchanged (name + quality, no killstreak param)", async () => {
  installGlobals();
  const { container } = buildTitleContainer();
  global.document = makeDocument([container]);

  itemQuickLinks();
  await flush();

  assert.equal(getQuickLink("mannco.store")?.href, "https://mannco.store/tf2?search=Rocket+Launcher&quality=Unique");
});

// The rest of the row no longer waits for pricedb.io's lookup: its slot
// shows a loading state (label + spinner, aria-busy) until it answers.
test("shows the row right away with a loading pricedb.io slot, then swaps in the link when the lookup answers", async () => {
  installGlobals();
  const { container } = buildTitleContainer();
  global.document = makeDocument([container]);
  const realSendMessage = globalThis.chrome.runtime.sendMessage;
  let answer;
  globalThis.chrome.runtime.sendMessage = (msg) => new Promise((resolve) => (answer = () => resolve(realSendMessage(msg))));
  try {
    itemQuickLinks();
    await flush();

    assert.ok(getRow(), "the row must not wait for pricedb.io");
    const loading = getQuickLinks().find((el) => el._textContent === "pricedb.io" && el.getAttribute("aria-busy") === "true");
    assert.ok(loading, "expected the loading pricedb.io slot");
    assert.match(loading.title, /Looking up this item on pricedb\.io/);

    answer();
    await flush();
    assert.ok(getQuickLink("pricedb.io")?.href?.startsWith("https://pricedb.io/item/"), "the slot becomes the real link");
    assert.equal(getQuickLinks().some((el) => el.getAttribute("aria-busy") === "true"), false);
  } finally {
    globalThis.chrome.runtime.sendMessage = realSendMessage;
  }
});

// A 📰 next.backpack.tf classifieds half joined onto marketplace.tf's own
// "BackpackTF" button (which opens next.backpack.tf stats) - the same split
// look as the row's own backpack.tf button. The native button itself is left
// in place, never moved or wrapped.
test("joins a 📰 next.backpack.tf classifieds button right after marketplace.tf's own BackpackTF button", async () => {
  installGlobals();
  const { container, backpackTfBtn } = buildTitleContainer();
  global.document = makeDocument([container]);

  itemQuickLinks();
  await flush();

  const siblings = backpackTfBtn.parentElement.children;
  const next = siblings[siblings.indexOf(backpackTfBtn) + 1];
  assert.ok(next?.classList.contains("tf2te-mptf-native-bptf-classifieds"), "expected the 📰 right after the native button");
  assert.equal(next.textContent, "📰");
  assert.match(next.href, /^https:\/\/next\.backpack\.tf\/classifieds\?itemName=Rocket\+Launcher&quality=6&/);
  assert.equal(next.target, "_blank");
  assert.equal(backpackTfBtn.classList.contains("tf2te-mptf-native-bptf-joined"), true);
});

test("a row rebuild keeps exactly one 📰 on the native BackpackTF button", async () => {
  installGlobals();
  const { container, backpackTfBtn } = buildTitleContainer();
  global.document = makeDocument([container]);

  itemQuickLinks();
  await flush();
  getRow().remove(); // a re-render wiping our row
  FakeMutationObserver.instances[0].cb();
  await flush();

  assert.ok(getRow());
  const icons = backpackTfBtn.parentElement.children.filter((el) => el.classList?.contains("tf2te-mptf-native-bptf-classifieds"));
  assert.equal(icons.length, 1);
});

// Seen live: marketplace.tf's title names a Festivized item ("Basic
// Killstreak Festivized Australium Black Box") but its BackpackTF button's
// href doesn't, so every link searched as not Festivized (festivized=0).
test("REGRESSION: a Festivized item (named in the page title) gets festivized=1 on next.backpack.tf classifieds", async () => {
  installGlobals();
  const { container } = buildTitleContainer({
    href: "https://next.backpack.tf/stats?item=Black+Box&australium=1&quality=11&killstreakTier=1",
    title: "Basic Killstreak Festivized Australium Black Box",
  });
  global.document = makeDocument([container]);

  itemQuickLinks();
  await flush();

  // The 📰 on marketplace.tf's own BackpackTF button - the user's own
  // confirmed-correct link.
  const nextClassifieds = container.parentElement.querySelectorAll(".tf2te-mptf-native-bptf-classifieds")[0];
  assert.equal(
    nextClassifieds?.href,
    "https://next.backpack.tf/classifieds?itemName=Black+Box&quality=11&tradable=1&craftable=1&australium=1&killstreakTier=1&festivized=1&particle=none&texture=none&spell=none&paint=none"
  );
  assert.equal(getQuickLink("mannco.store")?.href, "https://mannco.store/tf2?search=Australium+Black+Box&killstreak=Killstreak&festivized=Festivized");
  assert.equal(getQuickLink("gladiator.tf")?.href, "https://gladiator.tf/sales?item=Strange+Festivized+Killstreak+Australium+Black+Box");
});

// --- Item List per-row "📰 next | 📰 classic" ------------------------------
// Confirmed live shape: #items-list > .table-responsive > table > tbody > tr,
// the name cell's hover popover in data-content ("Sheen: X<br/>Eyes: Y" -
// "Eyes" is the Killstreaker), the title "(Sheen, Killstreaker)", and the
// Actions cell last, ending in the native "View on Backpack.tf" link.

function buildItemListRow({ title, popover = null, withAttachmentsAlert = false }) {
  const tr = new FakeElement("tr");
  const nameCell = new FakeElement("td");
  if (popover !== null) nameCell.setAttribute("data-content", popover);
  const nameWrap = new FakeElement("span");
  if (withAttachmentsAlert) {
    const alert = new FakeElement("span");
    alert.className = "item-popover-alert";
    nameWrap.appendChild(alert);
  }
  const name = new FakeElement("span");
  name.className = "item-html-name";
  name.textContent = title;
  nameWrap.appendChild(name);
  nameCell.appendChild(nameWrap);
  tr.appendChild(nameCell);

  for (const text of ["≈28.65 keys", "€48.35"]) {
    const td = new FakeElement("td");
    td.textContent = text;
    tr.appendChild(td);
  }

  const actions = new FakeElement("td");
  for (const label of ["Add to cart", "Inspect in-game", "View on Backpack.tf"]) {
    const b = new FakeElement("a");
    b.className = "btn btn-primary btn-xs";
    b.textContent = label;
    actions.appendChild(b);
  }
  tr.appendChild(actions);
  return tr;
}

function buildItemList(rows) {
  const list = new FakeElement("div");
  list.id = "items-list";
  const wrap = new FakeElement("div");
  wrap.className = "table-responsive";
  const table = new FakeElement("table");
  const tbody = new FakeElement("tbody");
  rows.forEach((r) => tbody.appendChild(r));
  table.appendChild(tbody);
  wrap.appendChild(table);
  list.appendChild(wrap);
  return { list, tbody };
}

const popoverFor = (sheen, eyes, extra = "") =>
  `<div class='item-popover-container appid-440'><span class='item-html-name'>Professional Australium Black Box (${sheen}, ${eyes})</span><br/>Level 17 Rocket Launcher<br/><br/>Killstreaks Active<br/>Sheen: ${sheen}<br/>Eyes: ${eyes}<br/>${extra}</div>`;

function rowCombo(row) {
  return row.querySelectorAll(".tf2te-mptf-row-combo")[0] || null;
}

test("Item List: each row gets a '📰 next | 📰 classic' button filtered to that row's own Sheen/Killstreaker", async () => {
  installGlobals();
  const { container } = buildTitleContainer({ href: HOT_ROD_TORNADO_BLACK_BOX });
  const manndarin = buildItemListRow({ title: "Professional Australium Black Box (Manndarin, Singularity)", popover: popoverFor("Manndarin", "Singularity") });
  // A ❗ row (Strange Parts attached) - same handling.
  const emerald = buildItemListRow({
    title: "Professional Australium Black Box (Agonizing Emerald, Singularity)",
    popover: popoverFor("Agonizing Emerald", "Singularity", "<br/><span style='color:#CF6A32'>Strange Part: Non-Critical Kills</span>"),
    withAttachmentsAlert: true,
  });
  const { list } = buildItemList([manndarin, emerald]);
  global.document = makeDocument([container, list]);

  itemQuickLinks();
  await flush();

  const combo = rowCombo(manndarin);
  assert.ok(combo, "expected the split button in the Manndarin row");
  // Last in the Actions cell, after the native "View on Backpack.tf".
  const actions = manndarin.children[manndarin.children.length - 1];
  assert.equal(actions.children[actions.children.length - 1], combo);
  const [next, classic] = combo.children;
  assert.equal(next.textContent, "📰 next");
  assert.equal(classic.textContent, "📰 classic");
  // Manndarin = sheen 3, Singularity = killstreaker 2006.
  assert.match(next.href, /^https:\/\/next\.backpack\.tf\/classifieds\?itemName=Black\+Box&quality=11&.*&australium=1&killstreakTier=3&.*&sheen=3&killstreaker=2006/);
  assert.match(classic.href, /^https:\/\/backpack\.tf\/classifieds\?item=Black\+Box&quality=11&.*&killstreak_tier=3&sheen=3&killstreaker=2006/);
  assert.equal(next.target, "_blank");
  assert.match(next.title, /Manndarin \+ Singularity/);

  // Agonizing Emerald = sheen 5.
  assert.match(rowCombo(emerald)?.children[0].href ?? "", /&sheen=5&killstreaker=2006/);

  // Reserves the Actions column's width (see content.js's CSS note).
  assert.equal(list.classList.contains("tf2te-mptf-row-combos-on"), true);
});

test("Item List: falls back to the title's '(Sheen, Killstreaker)' when the row has no popover", async () => {
  installGlobals();
  const { container } = buildTitleContainer({ href: HOT_ROD_TORNADO_BLACK_BOX });
  const row = buildItemListRow({ title: "Professional Australium Black Box (Team Shine, Fire Horns)" });
  const { list } = buildItemList([row]);
  global.document = makeDocument([container, list]);

  itemQuickLinks();
  await flush();

  // Team Shine = sheen 1, Fire Horns = killstreaker 2002.
  assert.match(rowCombo(row)?.children[0].href ?? "", /&sheen=1&killstreaker=2002/);
});

test("Item List: a row with no Sheen/Killstreaker gets no button (it would repeat the buttons at the top)", async () => {
  installGlobals();
  const { container } = buildTitleContainer();
  const row = buildItemListRow({ title: "Rocket Launcher", popover: "<div>Level 1 Rocket Launcher</div>" });
  const { list } = buildItemList([row]);
  global.document = makeDocument([container, list]);

  itemQuickLinks();
  await flush();

  assert.equal(rowCombo(row), null);
});

test("Item List: rows that render later (paging) get their button, and a rescan never duplicates one", async () => {
  installGlobals();
  const { container } = buildTitleContainer({ href: HOT_ROD_TORNADO_BLACK_BOX });
  const first = buildItemListRow({ title: "Professional Australium Black Box (Hot Rod, Incinerator)", popover: popoverFor("Hot Rod", "Incinerator") });
  const { list, tbody } = buildItemList([first]);
  global.document = makeDocument([container, list]);

  itemQuickLinks();
  await flush();

  const later = buildItemListRow({ title: "Professional Australium Black Box (Mean Green, Flames)", popover: popoverFor("Mean Green", "Flames") });
  tbody.appendChild(later);
  FakeMutationObserver.instances[0].cb();
  FakeMutationObserver.instances[0].cb();
  await flush();

  assert.equal(first.querySelectorAll(".tf2te-mptf-row-combo").length, 1);
  assert.match(rowCombo(later)?.children[0].href ?? "", /&sheen=4&killstreaker=2005/); // Mean Green, Flames
});

test("Item List: with Sheen/Killstreaker filtering switched off in the popup, rows get no button", async () => {
  installGlobals();
  sheenKillstreakerFilterOff = true;
  try {
    const { container } = buildTitleContainer({ href: HOT_ROD_TORNADO_BLACK_BOX });
    const row = buildItemListRow({ title: "Professional Australium Black Box (Manndarin, Singularity)", popover: popoverFor("Manndarin", "Singularity") });
    const { list } = buildItemList([row]);
    global.document = makeDocument([container, list]);

    itemQuickLinks();
    await flush();

    assert.equal(rowCombo(row), null);
    assert.equal(list.classList.contains("tf2te-mptf-row-combos-on"), false);
  } finally {
    sheenKillstreakerFilterOff = false;
  }
});

// Seen live: after an extension update the page still held the previous
// version's <style> (same id), and since it was only ever added once, the
// new rules (Actions cell on one line) never applied until a page refresh.
test("replaces an outdated copy of its own <style> left on the page by a previous version", async () => {
  installGlobals();
  const { container } = buildTitleContainer();
  global.document = makeDocument([container]);
  const stale = new FakeElement("style");
  stale.id = "tf2te-mptf-quick-links-style";
  stale.textContent = ".old-rule { color: red; }";
  document.head.appendChild(stale);

  itemQuickLinks();
  await flush();

  assert.equal(document.head.querySelectorAll("style").length, 1);
  assert.match(stale.textContent, /tf2te-mptf-row-combo/);
  assert.doesNotMatch(stale.textContent, /old-rule/);
});

// Confirmed live (a page-wide mutation count): the quick-links row was being
// rebuilt ~500 times a second, which made the page jump. An await sat
// between removing the old row and inserting the new one; any page change in
// that gap found no row and started another full rebuild, which removed the
// row and awaited again - the two rebuilds kept triggering each other. Here
// every DOM change fires the observer, the way the real browser does.
test("REGRESSION: page changes during a rebuild don't make the row rebuild itself in a loop", async () => {
  installGlobals();
  const { container } = buildTitleContainer({ href: HOT_ROD_TORNADO_BLACK_BOX });
  const row = buildItemListRow({ title: "Professional Australium Black Box (Manndarin, Singularity)", popover: popoverFor("Manndarin", "Singularity") });
  const { list } = buildItemList([row]);
  global.document = makeDocument([container, list]);

  // Count full rebuilds: each one writes the title container's signature.
  let signatureWrites = 0;
  container.dataset = new Proxy(container.dataset, {
    set(target, key, value) {
      if (key === "tf2teQuickLinksSignature") signatureWrites++;
      target[key] = value;
      return true;
    },
  });

  // Like the real browser: the observer fires as a microtask right after
  // each DOM change, while an extension storage read takes a moment (here a
  // timer tick) - that's the window the loop needs.
  const proto = FakeElement.prototype;
  const original = { remove: proto.remove, appendChild: proto.appendChild, insertAdjacentElement: proto.insertAdjacentElement };
  const notify = () => queueMicrotask(() => FakeMutationObserver.instances.forEach((o) => o.cb()));
  const realGet = globalThis.chrome.storage.local.get;
  globalThis.chrome.storage.local.get = (keys) => new Promise((resolve) => setTimeout(() => resolve(realGet(keys)), 0));
  for (const name of Object.keys(original)) {
    proto[name] = function (...args) {
      const result = original[name].apply(this, args);
      notify();
      return result;
    };
  }
  try {
    itemQuickLinks();
    await flush(60);
  } finally {
    Object.assign(proto, original);
    globalThis.chrome.storage.local.get = realGet;
  }

  assert.ok(getRow(), "the row is built");
  assert.ok(signatureWrites <= 2, `the row was rebuilt ${signatureWrites} times`);
});
