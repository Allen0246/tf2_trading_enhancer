import { test, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

// Same pre-seeded schema cache / no-real-fetch pattern
// tests/tf2StatsLinksIndex.test.js's own header note documents in full -
// scrapItemsTableLinks's own buildExtraLinks routes through the exact same
// utils/tf2StatsLinks/index.js resolveStatsAndClassifieds/utils/tf2Schema.js
// pipeline that file exercises directly, so the same fixture shape is needed
// here too (installed before content.js is ever imported, since
// utils/tf2Schema.js memoizes its schema promise at module scope for this
// test file's whole lifetime). chrome.runtime.sendMessage also has to answer
// a real FETCH_JSON message now - utils/pricedb.js's own searchPricedbSkuStatus
// (buildExtraLinks' own pricedbPromise) routes through it, same relay
// reasoning that file's own header note documents. Defaults to "no match" (an
// empty results array) - individual tests override it to exercise a real
// pricedb.io hit.
// Whether a Steam Web API key is "saved" (posts.tf's key hint reads it).
let savedSteamApiKey = null;
globalThis.chrome = {
  storage: {
    local: {
      async get() {
        return {
          ...(savedSteamApiKey ? { steamApiKey: savedSteamApiKey } : {}),
          tf2SchemaCache: {
            itemNameToDefindex: { "Rocket Launcher": 205, Festivizer: 1000 },
            defindexToItemName: {},
            // "Burning Flames" populated (not empty) - resolving an Unusual
            // effect baked into raw concatenated text (this table has no
            // separate tooltip/data-content to read one from independently,
            // unlike scrap.tf's own hover card) needs the schema to confirm
            // where the item name ends and the effect name begins, same
            // shape tests/tf2StatsLinksIndex.test.js's own "dispatches to
            // the Unusual branch" test already establishes.
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
    async sendMessage(msg) {
      if (msg?.type === "FETCH_JSON") {
        return { ok: true, data: { success: true, data: { results: [] } } };
      }
      throw new Error("should not need a real fetch - schema cache is pre-seeded and fresh");
    },
  },
};
globalThis.fetch = async () => ({ json: async () => [] });

const { scrapItemsTableLinks } = await import("../scrap.tf/scrapItemsTableLinks/content.js");
const { __resetSchemaCacheForTests } = await import("../utils/tf2Schema.js");
const { __resetPricedbCacheForTests } = await import("../utils/pricedb.js");

beforeEach(() => {
  __resetSchemaCacheForTests();
  __resetPricedbCacheForTests();
});

// A fake table row cell - the DOM surface scrapItemsTableLinks touches: reads
// textContent off the item-name cell (its own markup is left untouched by the
// Version - see content.js's own header note - only a single "Links ▾"
// dropdown wrapper gets appendChild'd onto it).
function fakeCell(html) {
  return {
    innerHTML: html,
    _children: [],
    get textContent() {
      // Approximates real textContent-off-innerHTML behavior for the plain
      // (no nested tags) fixtures this file uses - good enough since none of
      // these tests need genuine HTML parsing.
      return this.innerHTML.replace(/<[^>]*>/g, "");
    },
    appendChild(el) {
      this._children.push(el);
      return el;
    },
  };
}

// Generic fake DOM element - covers every property/method the redesigned
// dropdown actually touches (button/div/span/a/style), so one factory can
// stand in for document.createElement(anyTag).
function fakeElement(tagName) {
  const el = {
    tagName: tagName.toUpperCase(),
    className: "",
    textContent: "",
    hidden: false,
    disabled: false,
    href: undefined,
    target: undefined,
    type: undefined,
    _children: [],
    _innerHTML: "",
    _listeners: {},
    _removed: false,
    _attrs: {},
    dataset: {},
    style: {},
    // Every panel in these fixtures lives in a table cell on the page.
    isConnected: true,
    appendChild(child) {
      this._children.push(child);
      return child;
    },
    // A string is a text node in the real DOM; folded into textContent here.
    append(...items) {
      for (const item of items) {
        if (typeof item === "string") this.textContent += item;
        else this.appendChild(item);
      }
    },
    setAttribute(name, value) {
      this._attrs[name] = value;
    },
    getAttribute(name) {
      return name in this._attrs ? this._attrs[name] : null;
    },
    removeAttribute(name) {
      delete this._attrs[name];
    },
    remove() {
      this._removed = true;
    },
    addEventListener(type, handler) {
      (this._listeners[type] ||= []).push(handler);
    },
    click() {
      (this._listeners.click || []).forEach((h) => h({ stopPropagation() {} }));
    },
  };
  // renderPanelLinks starts with `panel.innerHTML = ""` (real DOM behavior:
  // clears every existing child) before appendChild-ing the fresh set - a
  // plain property here would leave stale children from the PREVIOUS render
  // (e.g. the placeholder) still counted once the real links replace it.
  Object.defineProperty(el, "innerHTML", {
    get() {
      return this._innerHTML;
    },
    set(value) {
      this._innerHTML = value;
      this._children = [];
    },
  });
  return el;
}

function fakeTable(rows) {
  // rows: array of arrays of cells (row 0 is the header row, skipped by
  // scrapItemsTableLinks itself) - .rows mimics a real HTMLTableElement's
  // own live .rows collection closely enough (Array.from(table.rows) is all
  // the real code ever does with it).
  return { rows: rows.map((cells) => ({ cells })) };
}

// All panel elements created this test (content.js's own closeAllPanels
// reads document.querySelectorAll(".tf2te-items-links-panel") - this
// registry stands in for that one specific selector, the only one the
// source code ever actually queries).
let panelRegistry;

function installDom(table) {
  panelRegistry = [];
  const headEl = fakeElement("head");
  global.document = {
    getElementById: (id) => (id === "tf2te-items-links-dropdown-style" ? null : table),
    createElement: (tag) => {
      const el = fakeElement(tag);
      if (tag === "div") {
        // className is set right after creation in content.js, before this
        // registry would otherwise need to inspect it - tracked via a
        // wrapping setter so panelRegistry always reflects the real set.
        Object.defineProperty(el, "className", {
          get() {
            return this._className || "";
          },
          set(value) {
            this._className = value;
            if (value === "tf2te-items-links-panel" && !panelRegistry.includes(el)) panelRegistry.push(el);
          },
        });
      }
      return el;
    },
    head: headEl,
    createElementNS: (_ns, tag) => fakeElement(tag),
    addEventListener: () => {},
    querySelectorAll: (selector) => (selector === ".tf2te-items-links-panel" ? panelRegistry : []),
  };
}

// The dropdown wrapper <span> is always the last (and, for these
// single-item-cell fixtures, only) appended child of the cell.
function dropdownWrapper(cell) {
  return cell._children[cell._children.length - 1];
}

function toggleButton(cell) {
  return dropdownWrapper(cell)._children[0];
}

function panelOf(cell) {
  return dropdownWrapper(cell)._children[1];
}

// Pulls out each rendered link entry's {label, href} from a panel's own
// child elements, in DOM order - lets a test assert on the resulting ORDER
// without also re-asserting every href's own exact shape (each href's shape
// is already covered by utils/tf2StatsLinks/index.js's/scrap.tf/itemLinks/links.js's
// own dedicated tests).
function panelEntries(cell) {
  return panelOf(cell)._children.map((el) => ({ label: el.textContent, href: el.href, tag: el.tagName }));
}

async function flushAsync() {
  // Node drains the whole microtask queue before firing a timer callback, no
  // matter how many chained awaits resolveStatsAndClassifieds's own pipeline
  // needs - same reasoning tests/apiKeyStatus.test.js's own flush note and
  // tests/scrapTfContent.test.js's own header comment document, just a
  // shorter wait since there's no real dynamic import in this chain.
  await new Promise((resolve) => setTimeout(resolve, 20));
}

test("does nothing when the item-banking table isn't present on the page", () => {
  global.document = { getElementById: () => null };
  assert.doesNotThrow(() => scrapItemsTableLinks());
});

test("skips the header row (row 0) entirely - no cell lookup, no link insertion", () => {
  const headerCell = fakeCell("Item Name");
  const table = fakeTable([[null, headerCell]]);
  installDom(table);

  scrapItemsTableLinks();

  assert.equal(headerCell.innerHTML, "Item Name"); // untouched
  assert.equal(headerCell._children.length, 0);
});

test("skips a row whose item-name cell is missing (shorter row than expected)", () => {
  const table = fakeTable([[null, fakeCell("Header")], [null]]);
  installDom(table);
  assert.doesNotThrow(() => scrapItemsTableLinks());
});

// --- the "Links ▾" dropdown itself ---

test("appends a single disabled 'Links ▾' toggle with a hidden, empty panel synchronously, ahead of the async resolution", () => {
  const cell = fakeCell("Rocket Launcher");
  const table = fakeTable([[null, fakeCell("Header")], [null, cell]]);
  installDom(table);

  scrapItemsTableLinks();

  assert.equal(cell._children.length, 1);
  const toggle = toggleButton(cell);
  assert.equal(toggle.textContent, "Links ▾");
  assert.equal(toggle.disabled, true);
  assert.equal(panelOf(cell).hidden, true);
});

test("enables the toggle and fills the panel once the extra links resolve", async () => {
  const cell = fakeCell("Rocket Launcher");
  const table = fakeTable([[null, fakeCell("Header")], [null, cell]]);
  installDom(table);

  scrapItemsTableLinks();
  await flushAsync();

  assert.equal(toggleButton(cell).disabled, false);
  assert.ok(panelEntries(cell).length > 0);
});

test("clicking the toggle opens the panel, closes it again on a second click, and stops the click from also reaching the document-level outside-click handler", async () => {
  const cell = fakeCell("Rocket Launcher");
  const table = fakeTable([[null, fakeCell("Header")], [null, cell]]);
  installDom(table);

  scrapItemsTableLinks();
  await flushAsync();

  const toggle = toggleButton(cell);
  const panel = panelOf(cell);
  assert.equal(panel.hidden, true);

  toggle.click();
  assert.equal(panel.hidden, false);

  toggle.click();
  assert.equal(panel.hidden, true);
});

test("resolves and renders every extra link, in the confirmed order (next BP, classic BP, Gladiator, posts.tf, MP, Mannco, STN, SCM) - pricedb.io omitted entirely when it has no match", async () => {
  const cell = fakeCell("Rocket Launcher");
  const table = fakeTable([[null, fakeCell("Header")], [null, cell]]);
  installDom(table);

  scrapItemsTableLinks();
  await flushAsync();

  const entries = panelEntries(cell);
  assert.deepEqual(
    entries.map((e) => e.label),
    ["next BP", "classic BP", "Gladiator", "posts.tf", "MP", "Mannco", "STN", "SCM"]
  );
  assert.ok(entries.every((e) => e.tag === "A")); // every entry resolved to a real link, none a placeholder <span>

  const byLabel = Object.fromEntries(entries.map((e) => [e.label, e.href]));
  assert.match(byLabel["next BP"], /^https:\/\/next\.backpack\.tf\/classifieds\?.*itemName=Rocket\+Launcher/);
  assert.match(byLabel["classic BP"], /^https:\/\/backpack\.tf\/classifieds\?.*item=Rocket\+Launcher/);
  assert.equal(byLabel["Gladiator"], "https://gladiator.tf/sales?item=Rocket+Launcher");
  assert.match(byLabel["posts.tf"], /^https:\/\/posts\.tf\/posts\/search\/results\?q=/);
  assert.match(byLabel["MP"], /^https:\/\/marketplace\.tf\/browse\/tf2\?.*sterm=Rocket\+Launcher/);
  assert.equal(byLabel["Mannco"], "https://mannco.store/tf2?search=Rocket+Launcher&quality=Unique");
  assert.equal(byLabel["STN"], "https://stntrading.eu/item/tf2/Rocket+Launcher");
  assert.match(byLabel["SCM"], /^https:\/\/steamcommunity\.com\/market\/listings\/440\/Rocket/);
});

// An Unusual's own STN link keeps the literal "Unusual" word AND inserts the
// effect name - see ../scrap.tf/itemLinks/links.js's own buildStnTradingHref
// for the fuller writeup of that distinction. "Unusual Team Captain Burning
// Flames" - the effect name baked into the raw text itself, same
// confirmed-live shape tests/tf2StatsLinksIndex.test.js's own "dispatches to
// the Unusual branch" test already uses - resolves
// classifiedsFilters.effectName without needing a schema entry.
test("an Unusual row's STN link keeps 'Unusual' and inserts the effect name, unlike SCM's own effect-stripped listing name", async () => {
  const cell = fakeCell("Unusual Team Captain Burning Flames");
  const table = fakeTable([[null, fakeCell("Header")], [null, cell]]);
  installDom(table);

  scrapItemsTableLinks();
  await flushAsync();

  const byLabel = Object.fromEntries(panelEntries(cell).map((e) => [e.label, e.href]));
  assert.equal(byLabel["STN"], "https://stntrading.eu/item/tf2/Unusual+Burning+Flames+Team+Captain");
  // SCM's own listing name never includes the effect - just confirming the
  // two buttons genuinely differ here, not coincidentally the same.
  assert.match(byLabel["SCM"], /^https:\/\/steamcommunity\.com\/market\/listings\/440\/Unusual%20Team%20Captain/);
});

test("splices a real pricedb.io match in right after Gladiator, ahead of posts.tf", async () => {
  const originalSendMessage = globalThis.chrome.runtime.sendMessage;
  globalThis.chrome.runtime.sendMessage = async (msg) => {
    if (msg?.type === "FETCH_JSON") {
      return { ok: true, data: { success: true, data: { results: [{ sku: "205;6" }] } } };
    }
    throw new Error("unexpected message");
  };

  try {
    const cell = fakeCell("Rocket Launcher");
    const table = fakeTable([[null, fakeCell("Header")], [null, cell]]);
    installDom(table);

    scrapItemsTableLinks();
    await flushAsync();

    const entries = panelEntries(cell);
    assert.deepEqual(
      entries.map((e) => e.label),
      ["next BP", "classic BP", "Gladiator", "pricedb.io", "posts.tf", "MP", "Mannco", "STN", "SCM"]
    );
    const pricedbEntry = entries.find((e) => e.label === "pricedb.io");
    assert.equal(pricedbEntry.href, "https://pricedb.io/item/205%3B6");
  } finally {
    globalThis.chrome.runtime.sendMessage = originalSendMessage;
  }
});

test("while pricedb.io is still being looked up, its slot shows the loading state (label + spinner), then becomes the real link in place", async () => {
  const originalSendMessage = globalThis.chrome.runtime.sendMessage;
  let releaseGate;
  const gate = new Promise((resolve) => (releaseGate = resolve));
  globalThis.chrome.runtime.sendMessage = async (msg) => {
    if (msg?.type === "FETCH_JSON") {
      await gate;
      return { ok: true, data: { success: true, data: { results: [{ sku: "205;6" }] } } };
    }
    throw new Error("unexpected message");
  };

  try {
    const cell = fakeCell("Rocket Launcher");
    const table = fakeTable([[null, fakeCell("Header")], [null, cell]]);
    installDom(table);

    scrapItemsTableLinks();
    await flushAsync();

    const slot = panelOf(cell)._children[3];
    assert.equal(slot.tagName, "SPAN");
    assert.equal(slot.textContent, "pricedb.io");
    assert.equal(slot.dataset.tf2teLoading, "1");
    assert.equal(slot.getAttribute("aria-busy"), "true");
    assert.match(slot.title, /Looking up this item on pricedb\.io/);

    releaseGate();
    await flushAsync();

    const entries = panelEntries(cell);
    assert.equal(entries[3].label, "pricedb.io");
    assert.equal(entries[3].tag, "A");
    assert.equal(entries[3].href, "https://pricedb.io/item/205%3B6");
  } finally {
    globalThis.chrome.runtime.sendMessage = originalSendMessage;
  }
});

// A rate-limited lookup used to look IDENTICAL to "this item genuinely has
// no pricedb.io listing" here too - both just silently omitted the entry.
// searchPricedbSkuStatus surfaces the real 429 (see utils/pricedb.js's own
// note) so this can show something instead, as a non-clickable <span>
// (already dimmed by this panel's own existing CSS).
function rateLimitedThen(resolvedSku, calls) {
  let limited = true;
  const sendMessage = async (msg) => {
    if (msg?.type !== "FETCH_JSON") throw new Error("unexpected message");
    calls.count++;
    if (limited) return { ok: false, status: 429, error: "Rate limited (429)", retryAfterMs: 3000 };
    const q = new URL(msg.url).searchParams.get("q");
    return { ok: true, data: { success: true, data: { results: [{ name: q, sku: resolvedSku }] } } };
  };
  return { sendMessage, stopLimiting: () => (limited = false) };
}

test("on a real 429, shows a 'pricedb.io Ns' countdown in the same slot instead of omitting it", async () => {
  mock.timers.enable({ apis: ["setInterval"] });
  const originalSendMessage = globalThis.chrome.runtime.sendMessage;
  const calls = { count: 0 };
  globalThis.chrome.runtime.sendMessage = rateLimitedThen("205;6", calls).sendMessage;

  try {
    const cell = fakeCell("Rocket Launcher");
    const table = fakeTable([[null, fakeCell("Header")], [null, cell]]);
    installDom(table);

    scrapItemsTableLinks();
    await flushAsync();

    const entries = panelEntries(cell);
    assert.deepEqual(
      entries.map((e) => e.label),
      ["next BP", "classic BP", "Gladiator", "pricedb.io 3s", "posts.tf", "MP", "Mannco", "STN", "SCM"]
    );
    const pricedbEntry = entries.find((e) => e.label === "pricedb.io 3s");
    assert.equal(pricedbEntry.tag, "SPAN");
    assert.equal(pricedbEntry.href, undefined);
  } finally {
    globalThis.chrome.runtime.sendMessage = originalSendMessage;
    mock.timers.reset();
  }
});

test("a countdown that ends while the panel is open retries right away and shows the real link", async () => {
  mock.timers.enable({ apis: ["setInterval"] });
  const originalSendMessage = globalThis.chrome.runtime.sendMessage;
  const calls = { count: 0 };
  const fake = rateLimitedThen("205;6", calls);
  globalThis.chrome.runtime.sendMessage = fake.sendMessage;

  try {
    const cell = fakeCell("Rocket Launcher");
    installDom(fakeTable([[null, fakeCell("Header")], [null, cell]]));
    scrapItemsTableLinks();
    await flushAsync();

    toggleButton(cell).click(); // open
    assert.equal(panelOf(cell).hidden, false);
    fake.stopLimiting();
    mock.timers.tick(3000);
    await flushAsync();

    const pricedb = panelEntries(cell).find((e) => e.label === "pricedb.io");
    assert.ok(pricedb);
    assert.equal(pricedb.href, "https://pricedb.io/item/205%3B6");
  } finally {
    globalThis.chrome.runtime.sendMessage = originalSendMessage;
    mock.timers.reset();
  }
});

test("a countdown that ends while the panel is closed waits, then retries when the panel is next opened (no retry storm across rows)", async () => {
  mock.timers.enable({ apis: ["setInterval"] });
  const originalSendMessage = globalThis.chrome.runtime.sendMessage;
  const calls = { count: 0 };
  const fake = rateLimitedThen("205;6", calls);
  globalThis.chrome.runtime.sendMessage = fake.sendMessage;

  try {
    const cell = fakeCell("Rocket Launcher");
    installDom(fakeTable([[null, fakeCell("Header")], [null, cell]]));
    scrapItemsTableLinks();
    await flushAsync();
    const lookupsAfterLoad = calls.count;

    fake.stopLimiting();
    mock.timers.tick(3000); // runs out while the panel is still closed
    await flushAsync();
    assert.equal(calls.count, lookupsAfterLoad, "no retry while closed");

    toggleButton(cell).click(); // open -> the pending retry runs now
    await flushAsync();
    assert.equal(calls.count, lookupsAfterLoad + 1);
    assert.equal(panelEntries(cell).find((e) => e.label === "pricedb.io")?.href, "https://pricedb.io/item/205%3B6");
  } finally {
    globalThis.chrome.runtime.sendMessage = originalSendMessage;
    mock.timers.reset();
  }
});

test("with no Steam Web API key, an item posts.tf can't resolve keeps a posts.tf key-hint entry instead of dropping it", async () => {
  savedSteamApiKey = null;
  const cell = fakeCell("Brotherhood of Arms");
  installDom(fakeTable([[null, fakeCell("Header")], [null, cell]]));

  scrapItemsTableLinks();
  await flushAsync();

  const panel = panelOf(cell);
  const hint = panel._children.find((el) => el.textContent === "posts.tf");
  assert.ok(hint, "expected the posts.tf key hint");
  assert.equal(hint.tagName, "SPAN");
  assert.equal(hint.dataset.tf2teNeedsKey, "1");
  assert.match(hint.title, /Steam Web API key/);
});

test("with a key saved, an item posts.tf still can't resolve gets no posts.tf entry", async () => {
  savedSteamApiKey = "ABC123";
  try {
    const cell = fakeCell("Brotherhood of Arms");
    installDom(fakeTable([[null, fakeCell("Header")], [null, cell]]));

    scrapItemsTableLinks();
    await flushAsync();

    assert.equal(panelEntries(cell).some((e) => e.label === "posts.tf"), false);
  } finally {
    savedSteamApiKey = null;
  }
});

test("strips trailing '#...' table junk before resolving the extra links", async () => {
  const cell = fakeCell("Rocket Launcher #1");
  const table = fakeTable([[null, fakeCell("Header")], [null, cell]]);
  installDom(table);

  scrapItemsTableLinks();
  await flushAsync();

  const gladiator = panelEntries(cell).find((e) => e.label === "Gladiator");
  assert.equal(gladiator.href, "https://gladiator.tf/sales?item=Rocket+Launcher");
});

test("prefixes Non-Craftable for a store-bought item before resolving the extra links", async () => {
  const cell = fakeCell("Festivizer");
  const table = fakeTable([[null, fakeCell("Header")], [null, cell]]);
  installDom(table);

  scrapItemsTableLinks();
  await flushAsync();

  const gladiator = panelEntries(cell).find((e) => e.label === "Gladiator");
  assert.equal(gladiator.href, "https://gladiator.tf/sales?item=Non-Craftable+Festivizer");
});

// Scrap.tf's own item banking table renders an apostrophe'd item's name
// with the apostrophe silently dropped entirely - this used to 404 every
// exact-match lookup built from the raw text. getCanonicalItemName
// (utils/tf2Schema.js) now recovers it - see this file's own header note
// on why it's run before anything downstream reads itemName. Gladiator's
// own href is a convenient, visible way to confirm the CORRECTED name
// actually made it downstream (it never validates the name against
// anything itself, so a difference here can only come from the correction
// step).
test("corrects a missing apostrophe against the schema before resolving the extra links", async () => {
  const originalGet = globalThis.chrome.storage.local.get;
  globalThis.chrome.storage.local.get = async () => ({
    tf2SchemaCache: {
      itemNameToDefindex: { "Bill's Hat": 999 },
      defindexToItemName: {},
      effectNameToId: {},
      fetchedAt: Date.now(),
      schemaShapeVersion: 4,
    },
  });

  try {
    const cell = fakeCell("Bills Hat");
    const table = fakeTable([[null, fakeCell("Header")], [null, cell]]);
    installDom(table);

    scrapItemsTableLinks();
    await flushAsync();

    const gladiator = panelEntries(cell).find((e) => e.label === "Gladiator");
    assert.equal(gladiator.href, "https://gladiator.tf/sales?item=Bill%27s+Hat");
  } finally {
    globalThis.chrome.storage.local.get = originalGet;
  }
});

// "Australium Gold" is a real Paint can name, not an Australium weapon -
// every "isAustralium" check across this codebase used to strip the
// literal "Australium " prefix unconditionally, treating it as
// Australium+"Gold" (a nonexistent weapon) and silently breaking every
// lookup built from the wrongly-stripped remainder. See
// utils/tf2StatsLinks/index.js's own hasLiteralAustraliumPrefix.
test("never strips 'Australium ' from the Paint can 'Australium Gold' - it's a real paint name, not an Australium weapon", async () => {
  const cell = fakeCell("Australium Gold");
  const table = fakeTable([[null, fakeCell("Header")], [null, cell]]);
  installDom(table);

  scrapItemsTableLinks();
  await flushAsync();

  const gladiator = panelEntries(cell).find((e) => e.label === "Gladiator");
  assert.equal(gladiator.href, "https://gladiator.tf/sales?item=Australium+Gold");
  // Never wrongly split into a bare "Gold" search - confirms the whole name
  // is treated as one atomic item, not Australium + a weapon.
  assert.ok(!panelEntries(cell).some((e) => e.href?.includes("item=Gold")));
});

test("removes the whole dropdown instead of throwing when the extra-links resolution rejects", async () => {
  const originalGet = globalThis.chrome.storage.local.get;
  const originalWarn = console.warn;
  console.warn = () => {}; // expected - this test deliberately forces the failure path
  globalThis.chrome.storage.local.get = async () => {
    throw new Error("simulated storage failure");
  };
  __resetSchemaCacheForTests();

  try {
    const cell = fakeCell("Rocket Launcher");
    const table = fakeTable([[null, fakeCell("Header")], [null, cell]]);
    installDom(table);

    scrapItemsTableLinks();
    await flushAsync();

    assert.equal(dropdownWrapper(cell)._removed, true);
  } finally {
    globalThis.chrome.storage.local.get = originalGet;
    console.warn = originalWarn;
    __resetSchemaCacheForTests();
  }
});
