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
          tf2SchemaCache: {
            itemNameToDefindex: { "Max's Severed Head": 162, "Rocket Launcher": 205 },
            defindexToItemName: {},
            effectNameToId: {},
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
let pricedbSku = "162;6";
let pricedbRateLimited = false;
let pricedbRetryAfterMs;
// Whether a Steam Web API key is "saved" (the posts.tf key hint reads it).
let savedSteamApiKey = null;

// The key-hint and countdown buttons (utils/linkButtonStates.js) set their
// label as text and then append an icon; this file's fake reads only the
// children's text once any exist, so the label is read off _textContent.
function findStateButton(label, { needsKey = false } = {}) {
  return (getQuickLinks() || []).find((el) => el._textContent === label && (needsKey ? el.dataset.tf2teNeedsKey === "1" : /Retrying automatically/.test(el.title || ""))) || null;
}

const { itemQuickLinks, isTf2ItemPage } = await import("../mannco.store/itemQuickLinks/content.js");
const { __resetPricedbCacheForTests } = await import("../utils/pricedb.js");

// Same hand-rolled fake DOM every other quick-links test file in this repo
// already uses (see tests/addGladiatorButton.test.js's own header comment
// for why this repo hand-rolls rather than pulling in jsdom).
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

function installGlobals({ sku = "162;6", rateLimited = false, href = "https://mannco.store/item/440-maxs-severed-head" } = {}) {
  global.window = { location: { href } };
  global.Node = { ELEMENT_NODE: 1 };
  global.MutationObserver = FakeMutationObserver;
  FakeMutationObserver.instances = [];
  lastPricedbQuery = null;
  pricedbSku = sku;
  pricedbRateLimited = rateLimited;
  __resetPricedbCacheForTests();
}

function buildDescriptionListItem(label, value) {
  const dl = new FakeElement("dl");
  dl.className = "description-list";
  const dt = new FakeElement("dt");
  dt.className = "description-list__label";
  dt.textContent = label;
  const dd = new FakeElement("dd");
  dd.className = "description-list__value";
  dd.textContent = value;
  dl.appendChild(dt);
  dl.appendChild(dd);
  return dl;
}

// Confirmed live shape (see this feature's own header note): a
// ".item-details" card holding ".item-details__title" and, nested inside
// ".item-details__content", a list of ".description-list" Label/Value rows
// (Quality/Craftable/SKU/...) plus ".item-details__description" - the quick-
// links row is inserted as a SIBLING right after ".item-details__description".
function buildItemDetailsCard({ itemName = "Rocket Launcher", qualityName = "Unique", isCraftable = true, withDescription = true } = {}) {
  const card = new FakeElement("div");
  card.className = "item-details";

  const titleEl = new FakeElement("div");
  titleEl.className = "item-details__title";
  titleEl.textContent = itemName;
  card.appendChild(titleEl);

  const content = new FakeElement("div");
  content.className = "item-details__content";
  card.appendChild(content);

  const list = new FakeElement("ul");
  list.className = "item-details__list";
  list.appendChild(buildDescriptionListItem("Quality", qualityName));
  list.appendChild(buildDescriptionListItem("Craftable", isCraftable ? "Yes" : "No"));
  content.appendChild(list);

  let description = null;
  if (withDescription) {
    description = new FakeElement("div");
    description.className = "item-details__description";
    content.appendChild(description);
  }

  return { card, description };
}

function getRow() {
  return document.querySelectorAll(".tf2te-mannco-quick-links-row")[0] || null;
}

function getQuickLinks() {
  return getRow()?.querySelectorAll(".tf2te-mannco-quick-link-button") ?? [];
}

function getQuickLink(label) {
  return getQuickLinks().find((link) => link.textContent === label) || null;
}

test("adds backpack.tf/next.backpack.tf/gladiator.tf/pricedb.io/stntrading.eu/marketplace.tf/Steam Market buttons for a plain item, reading identity off the card's own labeled rows", async () => {
  installGlobals();
  const { card } = buildItemDetailsCard({ itemName: "Max's Severed Head", qualityName: "Unique", isCraftable: true });
  global.document = makeDocument([card]);

  itemQuickLinks();
  await flush();

  assert.ok(getQuickLink("backpack.tf"));
  assert.ok(getQuickLink("next.backpack.tf"));
  // URLSearchParams' own form-encoding DOES escape an apostrophe (%27,
  // gladiator.tf below), but buildStnTradingHref builds its own query
  // manually via encodeURIComponent, which deliberately leaves one
  // unescaped (it's in that function's own "never escaped" set) - two
  // different, both-correct encodings for the same literal character.
  assert.equal(getQuickLink("gladiator.tf")?.href, "https://gladiator.tf/sales?item=Max%27s+Severed+Head");
  assert.equal(getQuickLink("pricedb.io")?.href, "https://pricedb.io/item/162%3B6");
  assert.equal(getQuickLink("stntrading.eu")?.href, "https://stntrading.eu/item/tf2/Max's+Severed+Head");
  // resolved.marketplaceHref was already available from
  // resolveStatsAndClassifieds, just never pushed onto the buttons array.
  assert.ok(getQuickLink("marketplace.tf"));
  assert.ok(getQuickLink("Steam Market"));
  assert.equal(lastPricedbQuery, "Max's Severed Head");
  // Never a mannco.store button - this page IS mannco.store.
  const labels = getQuickLinks().map((l) => l.textContent);
  assert.equal(labels.some((l) => l.includes("mannco.store")), false);
});

test("prefixes 'Non-Craftable ' when the Craftable row reads 'No'", async () => {
  installGlobals();
  const { card } = buildItemDetailsCard({ itemName: "Max's Severed Head", qualityName: "Unique", isCraftable: false });
  global.document = makeDocument([card]);

  itemQuickLinks();
  await flush();

  assert.equal(lastPricedbQuery, "Non-Craftable Max's Severed Head");
});

test("prefixes a non-Unique quality name onto the item name", async () => {
  installGlobals();
  const { card } = buildItemDetailsCard({ itemName: "Rocket Launcher", qualityName: "Strange", isCraftable: true });
  global.document = makeDocument([card]);

  itemQuickLinks();
  await flush();

  assert.equal(lastPricedbQuery, "Strange Rocket Launcher");
});

// Seen live: a Haunted item's card title already starts with its quality
// ("Haunted Voodoo-Cursed Engineer Soul"), so adding the prefix doubled it.
test("REGRESSION: doesn't prefix the quality again when the title already starts with it", async () => {
  installGlobals();
  const { card } = buildItemDetailsCard({ itemName: "Haunted Voodoo-Cursed Engineer Soul", qualityName: "Haunted", isCraftable: true });
  global.document = makeDocument([card]);

  itemQuickLinks();
  await flush();

  assert.equal(lastPricedbQuery, "Haunted Voodoo-Cursed Engineer Soul");
  const gladiator = Array.from(card.querySelectorAll("a")).find((a) => a.href.includes("gladiator.tf"));
  assert.equal(gladiator.href, "https://gladiator.tf/sales?item=Haunted+Voodoo-Cursed+Engineer+Soul");
});

test("does nothing (and doesn't throw) when the item-details card isn't present - no identity to resolve from", async () => {
  installGlobals();
  global.document = makeDocument([]);

  itemQuickLinks();
  await flush();

  assert.equal(getRow(), null);
});

test("does nothing when the card has no Description row to anchor insertion on - doesn't guess a fallback location", async () => {
  installGlobals();
  const { card } = buildItemDetailsCard({ withDescription: false });
  global.document = makeDocument([card]);

  itemQuickLinks();
  await flush();

  assert.equal(getRow(), null);
});

test("a real 429 shows a 'pricedb.io Ns' countdown instead of silently omitting the button, then retries by itself", async () => {
  mock.timers.enable({ apis: ["setInterval"] });
  try {
    installGlobals({ rateLimited: true });
    pricedbRetryAfterMs = 2000;
    const { card } = buildItemDetailsCard();
    global.document = makeDocument([card]);

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
  const { card } = buildItemDetailsCard({ itemName: "Brotherhood of Arms" });
  global.document = makeDocument([card]);

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
    const { card } = buildItemDetailsCard({ itemName: "Brotherhood of Arms" });
  global.document = makeDocument([card]);

    itemQuickLinks();
    await flush();

    assert.equal(findStateButton("posts.tf", { needsKey: true }), null);
  } finally {
    savedSteamApiKey = null;
  }
});

test("omits the pricedb.io button entirely for a genuine no-match (not rate limited)", async () => {
  installGlobals({ sku: null });
  const { card } = buildItemDetailsCard();
  global.document = makeDocument([card]);

  itemQuickLinks();
  await flush();

  assert.equal(getQuickLink("pricedb.io"), null);
  assert.equal(getQuickLink("pricedb.io (rate limited)"), null);
});

test("re-running for the SAME page URL doesn't duplicate the row (signature dedupe)", async () => {
  installGlobals();
  const { card } = buildItemDetailsCard();
  global.document = makeDocument([card]);

  itemQuickLinks();
  await flush();
  assert.equal(document.querySelectorAll(".tf2te-mannco-quick-links-row").length, 1);

  FakeMutationObserver.instances[0].cb();
  await flush();
  assert.equal(document.querySelectorAll(".tf2te-mannco-quick-links-row").length, 1);
});

// Mannco.store's own Vue app re-renders this card's inner content on its
// own, wiping out the row WITHOUT touching the outer ".item-details" node
// the signature lives on - the dedupe check used to compare the marker
// alone, so once that happened it thought the row was already there
// forever and never rebuilt it. Same class of bug
// steamcommunity.com/itemQuickLinks/content.js's own header note already
// documents a fix for.
test("REGRESSION: rebuilds the row if it's wiped out (e.g. by a reactive re-render) even though the page URL hasn't changed", async () => {
  installGlobals();
  const { card } = buildItemDetailsCard();
  global.document = makeDocument([card]);

  itemQuickLinks();
  await flush();
  assert.ok(getRow());

  getRow().remove(); // simulate the framework wiping the row out on its own
  assert.equal(getRow(), null);

  FakeMutationObserver.instances[0].cb();
  await flush();

  assert.ok(getRow());
});

// Seen live: opening an item from mannco.store's own search page showed no
// row until a refresh. The site navigates in-app, and the router used to
// check the URL only on the first real page load. The feature now runs on
// every page and checks the URL itself.
test("REGRESSION: an in-app navigation from a search page to an item page builds the row without a reload, and leaving the item removes it", async () => {
  installGlobals({ href: "https://mannco.store/tf2?search=Max%27s+Severed+Head" });
  const { card } = buildItemDetailsCard();
  global.document = makeDocument([card]);

  itemQuickLinks();
  await flush();
  assert.equal(getRow(), null, "no row on a non-item page");

  window.location.href = "https://mannco.store/item/440-maxs-severed-head";
  FakeMutationObserver.instances[0].cb();
  await flush();
  assert.ok(getRow(), "row built after the in-app navigation");

  window.location.href = "https://mannco.store/tf2";
  FakeMutationObserver.instances[0].cb();
  await flush();
  assert.equal(getRow(), null, "row removed after leaving the item page");
});

test("isTf2ItemPage only matches TF2 item detail pages", () => {
  assert.equal(isTf2ItemPage("https://mannco.store/item/440-maxs-severed-head"), true);
  assert.equal(isTf2ItemPage("https://mannco.store/item/730-some-csgo-skin"), false);
  assert.equal(isTf2ItemPage("https://mannco.store/tf2?search=Rocket+Launcher"), false);
});

test("itemQuickLinks sets up a subtree MutationObserver on document.body", () => {
  installGlobals();
  global.document = makeDocument([]);

  itemQuickLinks();

  assert.equal(FakeMutationObserver.instances.length, 1);
  assert.equal(FakeMutationObserver.instances[0].target, document.body);
  assert.deepEqual(FakeMutationObserver.instances[0].opts, { childList: true, subtree: true });
});

// Option B from the "mannco.store Link Row Options" mockup: each stats
// button joined to its site's classifieds search as one split button.
test("pairs each backpack.tf stats button with its classifieds search as one split button (stats + 📰)", async () => {
  installGlobals();
  const { card } = buildItemDetailsCard();
  global.document = makeDocument([card]);

  itemQuickLinks();
  await flush();

  const pairs = getRow().querySelectorAll(".tf2te-mannco-quick-link-pair");
  assert.equal(pairs.length, 2);

  const [classicStats, classicClassifieds] = pairs[0].children;
  assert.equal(classicStats.textContent, "backpack.tf");
  assert.match(classicStats.href, /^https:\/\/backpack\.tf\/stats\//);
  assert.equal(classicClassifieds.textContent, "📰");
  assert.match(classicClassifieds.href, /^https:\/\/backpack\.tf\/classifieds\?/);
  assert.equal(classicClassifieds.title, "backpack.tf classifieds");

  const [nextStats, nextClassifieds] = pairs[1].children;
  assert.equal(nextStats.textContent, "next.backpack.tf");
  assert.match(nextStats.href, /^https:\/\/next\.backpack\.tf\/stats\//);
  assert.match(nextClassifieds.href, /^https:\/\/next\.backpack\.tf\/classifieds\?/);
  assert.equal(nextClassifieds.title, "next.backpack.tf classifieds");
});

// Seen live: an Unusual's card title is "{Effect} ★ Unusual {Item}", and the
// star went straight into the backpack.tf stats links.
test("REGRESSION: an Unusual whose title is '{Effect} ★ Unusual {Item}' gets correct stats/classifieds links and an effect-first pricedb.io query", async () => {
  installGlobals();
  const { card } = buildItemDetailsCard({ itemName: "Bonzo The All-Gnawing ★ Unusual Connoisseur's Cap", qualityName: "Unusual" });
  global.document = makeDocument([card]);

  itemQuickLinks();
  await flush();

  const [classicStats, classicClassifieds] = getRow().querySelectorAll(".tf2te-mannco-quick-link-pair")[0].children;
  assert.equal(classicStats.href, "https://backpack.tf/stats/Unusual/Connoisseur's%20Cap/Tradable/Craftable/81");
  const classifiedsParams = new URL(classicClassifieds.href).searchParams;
  assert.equal(classifiedsParams.get("item"), "Connoisseur's Cap");
  assert.equal(classifiedsParams.get("particle"), "81");

  // The effect's real name has a lowercase "the" - also how pricedb.io names it.
  assert.equal(lastPricedbQuery, "Bonzo the All-Gnawing Connoisseur's Cap");
  assert.equal(getQuickLinks().some((el) => el.href?.includes("%E2%98%85")), false, "no button may carry the star");
});

// The rest of the row no longer waits for pricedb.io's lookup: its slot
// shows a loading state (label + spinner, aria-busy) until it answers.
test("shows the row right away with a loading pricedb.io slot, then swaps in the link when the lookup answers", async () => {
  installGlobals();
  const { card } = buildItemDetailsCard();
  global.document = makeDocument([card]);
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
