import { test } from "node:test";
import assert from "node:assert/strict";
import { showInventoryMarketActions } from "../steamcommunity.com/inventoryMarketActions/content.js";
import { __resetSchemaCacheForTests } from "../utils/tf2Schema.js";

// inventoryMarketActions/content.js adds Quick Sell/Instant Sell/Bulk Sell
// buttons next to Steam's own native "Sell" button on an inventory item
// panel. Reuses the REAL pickContainer/findActiveAssetId/resolveRealItemName/
// getActiveInventoryAppId from steamcommunity.com/itemQuickLinks/content.js
// (already covered by tests/itemQuickLinks.test.js) and the real
// utils/tf2StatsLinks/index.js/utils/tf2PlayerItems.js - only chrome.storage.local/
// chrome.runtime.sendMessage/global fetch are faked. tf2Schema.js's own
// module-scope cache is reset every test (see beforeEach), same as
// tests/itemQuickLinks.test.js/tests/marketListingLinks.test.js.
//
// The mainWorld.js price-resolution bridge (resolveSellerPriceCents) is
// exercised two ways: most tests set window.wrappedJSObject.GetItemPriceFromTotal
// directly (the synchronous Firefox-only fast path this file's own source
// checks FIRST), which sidesteps the CustomEvent round-trip entirely; two
// dedicated tests drive the actual CustomEvent bridge (the Chrome path) by
// installing a fake "mainWorld responder" and, separately, by never
// responding at all to exercise its 8s timeout.
test.beforeEach(() => {
  __resetSchemaCacheForTests();
});

class FakeElement {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    this.attributes = {};
    this._classes = new Set();
    this.classList = {
      add: (...names) => names.forEach((n) => this._classes.add(n)),
      contains: (name) => this._classes.has(name),
    };
    this._textContent = "";
    this._id = "";
    this.style = {};
    this._listeners = {};
    this.disabled = false;
    this.offsetWidth = 60;
    this.title = "";
  }
  get textContent() {
    return this._textContent;
  }
  set textContent(v) {
    this._textContent = v;
  }
  get className() {
    return [...this._classes].join(" ");
  }
  set className(v) {
    this._classes = new Set(String(v).split(/\s+/).filter(Boolean));
  }
  get id() {
    return this._id;
  }
  set id(v) {
    this._id = v;
  }
  setAttribute(name, value) {
    this.attributes[name] = value;
  }
  getAttribute(name) {
    return this.attributes[name] ?? null;
  }
  addEventListener(type, cb) {
    (this._listeners[type] ||= []).push(cb);
  }
  dispatchEvent(evt) {
    const results = (this._listeners[evt.type] || []).map((cb) => cb(evt));
    return Promise.all(results);
  }
  appendChild(child) {
    this.children.push(child);
    if (child && typeof child === "object") child.parentElement = this;
    return child;
  }
  append(...items) {
    for (const item of items) this.appendChild(item);
  }
  insertAdjacentElement(position, el) {
    if (!this.parentElement) {
      this.appendChild(el);
      return el;
    }
    const idx = this.parentElement.children.indexOf(this);
    const insertAt = position === "afterend" ? idx + 1 : idx;
    this.parentElement.children.splice(insertAt, 0, el);
    el.parentElement = this.parentElement;
    return el;
  }
  remove() {
    if (!this.parentElement) return;
    const i = this.parentElement.children.indexOf(this);
    if (i !== -1) this.parentElement.children.splice(i, 1);
    this.parentElement = null;
  }
  matchesSelectorPart(part) {
    if (part.startsWith(".")) return this._classes.has(part.slice(1));
    const attrMatch = /^([a-zA-Z0-9-]*)\[([a-zA-Z0-9-]+)="([^"]*)"\]$/.exec(part);
    if (attrMatch) {
      const [, tag, attr, value] = attrMatch;
      if (tag && this.tagName !== tag) return false;
      return this.attributes[attr] === value;
    }
    return this.tagName === part;
  }
  querySelectorAll(selector) {
    const parts = selector.split(",").map((s) => s.trim());
    const results = [];
    const visit = (node) => {
      for (const child of node.children || []) {
        if (child && typeof child === "object") {
          if (parts.some((p) => child.matchesSelectorPart?.(p))) results.push(child);
          visit(child);
        }
      }
    };
    visit(this);
    return results;
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
  cloneNode() {
    const clone = new FakeElement(this.tagName);
    clone.attributes = { ...this.attributes };
    clone._classes = new Set(this._classes);
    clone._textContent = this._textContent;
    clone.offsetWidth = this.offsetWidth;
    return clone;
  }
}

function makeInventoryEl(id) {
  const el = new FakeElement("div");
  el.id = id;
  return el;
}

function buildInventoryPanel({
  hasSellButton = true,
  otherExtButtons = false,
  itemTitle = "Rocket Launcher",
  marketLinkHref = null,
  otherGreenButtonText = null,
} = {}) {
  const container = new FakeElement("div");
  const title = new FakeElement("h1");
  title.textContent = itemTitle;
  container.appendChild(title);

  // The item panel's own "customName" market listing link - see
  // itemQuickLinks/content.js's own findMarketListingLinkName note. Kept as a
  // sibling of title, not a child of it, so it doesn't affect
  // readVisibleTitleText's own child-summing (that function only ever looks
  // inside title itself).
  if (marketLinkHref) {
    const marketLink = new FakeElement("a");
    marketLink.setAttribute("href", marketLinkHref);
    container.appendChild(marketLink);
  }

  // A Steam Community Item/Trading Card panel's own "Turn into Gems..."
  // button - ALSO data-accent-color="green", and comes BEFORE the real Sell
  // button in document order - see findNativeSellButton's own note.
  let otherGreenButton = null;
  if (otherGreenButtonText) {
    otherGreenButton = new FakeElement("button");
    otherGreenButton.setAttribute("data-accent-color", "green");
    otherGreenButton.textContent = otherGreenButtonText;
    container.appendChild(otherGreenButton);
  }

  let sellButton = null;
  if (hasSellButton) {
    sellButton = new FakeElement("button");
    sellButton.setAttribute("data-accent-color", "green");
    sellButton.textContent = "Sell";
    container.appendChild(sellButton);
  }

  const otherButtons = {};
  if (otherExtButtons) {
    otherButtons.quick = new FakeElement("button");
    otherButtons.quick.className = "marketActionQuickSell";
    otherButtons.instant = new FakeElement("button");
    otherButtons.instant.className = "marketActionInstantSell";
    otherButtons.multi = new FakeElement("button");
    otherButtons.multi.className = "multiSellLink";
    container.appendChild(otherButtons.quick);
    container.appendChild(otherButtons.instant);
    container.appendChild(otherButtons.multi);
  }

  return { container, title, sellButton, otherButtons, otherGreenButton };
}

function fakeStorageLocal(initial = {}) {
  const store = { ...initial };
  return {
    async get(keys) {
      const result = {};
      for (const k of keys) if (k in store) result[k] = store[k];
      return result;
    },
    async set(obj) {
      Object.assign(store, obj);
    },
    _store: store,
  };
}

class FakeCustomEvent {
  constructor(type, { detail } = {}) {
    this.type = type;
    this.detail = detail;
  }
}

function installGlobals({
  c0 = null,
  hash = "#440",
  activeItem,
  cookie = "sessionid=SESSION123",
  storageData = {},
  sendMessage,
  schemaFixture,
  fetchImpl,
  confirmImpl = () => true,
  wrappedJSObject = undefined,
} = {}) {
  globalThis.window = {
    location: { hash },
    confirm: confirmImpl,
    open: (...args) => {
      globalThis.__openCalls = globalThis.__openCalls || [];
      globalThis.__openCalls.push(args);
    },
    wrappedJSObject,
  };
  globalThis.CustomEvent = FakeCustomEvent;
  const docListeners = {};
  globalThis.document = {
    cookie,
    querySelector: (sel) => {
      if (sel === "#iteminfo0") return c0;
      if (sel === "#iteminfo1") return null;
      if (sel === ".item.activeInfo") return activeItem ?? null;
      return null;
    },
    querySelectorAll: (sel) => [],
    createElement: (tag) => new FakeElement(tag),
    addEventListener: (type, cb) => {
      (docListeners[type] ||= []).push(cb);
    },
    removeEventListener: (type, cb) => {
      const arr = docListeners[type] || [];
      const i = arr.indexOf(cb);
      if (i !== -1) arr.splice(i, 1);
    },
    dispatchEvent: (evt) => {
      (docListeners[evt.type] || []).forEach((cb) => cb(evt));
    },
  };

  const storage = fakeStorageLocal(storageData);
  globalThis.chrome = {
    storage: { local: storage },
    runtime: {
      sendMessage: sendMessage || (async () => ({ ok: false, error: "no sendMessage fixture installed" })),
      getURL: (path) => path,
    },
  };
  globalThis.fetch = fetchImpl || (async () => ({ ok: true, json: async () => ({ success: true }) }));
  globalThis.setTimeout = (fn, delay) => {
    (globalThis.__timeouts ||= []).push({ fn, delay });
    return globalThis.__timeouts.length;
  };
  globalThis.clearTimeout = (id) => {
    const list = globalThis.__timeouts || [];
    const entry = list[id - 1];
    if (entry) entry.cleared = true;
  };
  globalThis.__timeouts = [];
  globalThis.__openCalls = [];

  if (schemaFixture) storage._store.tf2SchemaCache = schemaFixture;

  return { storage, docListeners };
}

const SCHEMA_FIXTURE = {
  itemNameToDefindex: {},
  defindexToItemName: { 18: "Rocket Launcher" },
  effectNameToId: {},
  fetchedAt: Date.now(),
  schemaShapeVersion: 4,
};

function playerItemsSendMessage(items) {
  return async () => ({ ok: true, data: { result: { items } } });
}

const realSetTimeout = setTimeout;
async function flush(ticks = 8) {
  for (let i = 0; i < ticks; i++) await new Promise((resolve) => realSetTimeout(resolve, 0));
}

// Full "happy path" wiring: a resolvable item name + player-items fixture,
// used by every test that needs the actions block to actually get built.
function installHappyPathGlobals(overrides = {}) {
  const steamId64 = overrides.steamId64 || "76561198000000201";
  const assetId = overrides.assetId || "500";
  const { container, sellButton } = buildInventoryPanel({ itemTitle: overrides.itemTitle || "Rocket Launcher" });
  const marker = makeInventoryEl(`inventory_${steamId64}_440_2`);
  const activeItem = makeInventoryEl(`440_2_${assetId}`);

  installGlobals({
    c0: container,
    activeItem,
    storageData: { steamApiKey: "KEY123" },
    sendMessage: playerItemsSendMessage([{ id: Number(assetId), defindex: 18, quality: 6 }]),
    schemaFixture: SCHEMA_FIXTURE,
    ...overrides.globalsOverrides,
  });
  globalThis.document.querySelectorAll = (sel) => (sel === '[id^="inventory_"]' ? [marker] : container.querySelectorAll(sel));

  return { container, sellButton };
}

function findActionsWrapper(container) {
  return container.querySelectorAll(".tf2te-market-actions")[0] || null;
}

// --- basic gating ------------------------------------------------------

test("removes any existing actions UI and does nothing when no inventory tab is active at all", async () => {
  const { container } = buildInventoryPanel();
  const stale = new FakeElement("span");
  stale.className = "tf2te-market-actions";
  container.appendChild(stale);
  // No "#{appid}" hash and no ".item.activeInfo" tile fallback either - see
  // getActiveInventoryAppId's own note on the two sources it tries.
  installGlobals({ c0: container, hash: "" });

  showInventoryMarketActions();
  await flush();

  assert.equal(findActionsWrapper(container), null);
});

test("does nothing (no throw) when Steam's native Sell button isn't present", async () => {
  const { container } = buildInventoryPanel({ hasSellButton: false });
  installGlobals({ c0: container, storageData: { steamApiKey: "KEY123" } });

  showInventoryMarketActions();
  await flush();

  assert.equal(findActionsWrapper(container), null);
});

test("REGRESSION: logs the missing-Sell-button bail only once per item, not on every call - see the requestKey guard's own note on the console flood this caused live", async () => {
  const { container } = buildInventoryPanel({ hasSellButton: false });
  const activeItem = makeInventoryEl("440_2_1");
  installGlobals({ c0: container, activeItem, storageData: { steamApiKey: "KEY123" } });

  const debugCalls = [];
  const originalDebug = console.debug;
  console.debug = (...args) => debugCalls.push(args);
  try {
    // Simulates the MutationObserver re-firing on unrelated page mutations
    // while the same item stays selected (its own real trigger, see
    // steamcommunity.com/content.js's own subtree: true observer).
    showInventoryMarketActions();
    await flush();
    showInventoryMarketActions();
    await flush();
    showInventoryMarketActions();
    await flush();
  } finally {
    console.debug = originalDebug;
  }

  const missingLogs = debugCalls.filter((args) => args[1] === "bailing - missing");
  assert.equal(missingLogs.length, 1);
});

test("does nothing when no tile is currently selected (no assetId)", async () => {
  const { container } = buildInventoryPanel();
  installGlobals({ c0: container, storageData: { steamApiKey: "KEY123" } }); // no activeItem

  showInventoryMarketActions();
  await flush();

  assert.equal(findActionsWrapper(container), null);
});

// This used to gate on hasSteamApiKey() UNCONDITIONALLY for every item, even
// a perfectly ordinary non-renamed one (like "Rocket Launcher" here) that
// resolveRealItemName never even touches the Steam Web API for at all (its
// own case 2 - not renamed - trusts the on-page title as-is, no API call).
// No key is configured here, and the buttons still build fine - see the
// DEDICATED "no Steam Web API key needed" test just below for the same
// proof.
test("no longer shows the API key notice for an ordinary NON-renamed item, even with no Steam Web API key configured", async () => {
  const { container } = installHappyPathGlobals({ globalsOverrides: { storageData: {} } });

  showInventoryMarketActions();
  await flush();

  assert.ok(findActionsWrapper(container));
  assert.equal(container.querySelectorAll(".tf2te-market-actions-notice").length, 0);
});

// The API key notice is now reserved for the one case that genuinely still
// needs it: a RENAMED item whose real identity couldn't be recovered from
// EITHER the DOM (no market link/no "Original name" in the rename notice/no
// Collection marker in this fixture) or the Steam Web API (see
// resolveRealItemName's own `unresolved` flag) - same "renamed AND
// unresolvable" scenario itemQuickLinks.test.js's own equivalent tests use.
test("shows the API key notice instead of buttons for a RENAMED item whose identity can't be recovered without a Steam Web API key", async () => {
  const { container } = buildInventoryPanel();
  // Steam's own rename notice, deliberately NOT in the guessed quote/
  // punctuation shape findRenamedOriginalName looks for - so DOM alone can't
  // recover the original name either, same as
  // itemQuickLinks.test.js's own renamedNoticeLine: true fixtures.
  const noticeDiv = new FakeElement("div");
  noticeDiv.textContent = "This item has been renamed.";
  container.appendChild(noticeDiv);
  const activeItem = makeInventoryEl("440_2_1");
  const marker = makeInventoryEl("inventory_76561198000000201_440_2");
  installGlobals({ c0: container, activeItem, storageData: {} });
  globalThis.document.querySelectorAll = (sel) => (sel === '[id^="inventory_"]' ? [marker] : container.querySelectorAll(sel));

  showInventoryMarketActions();
  await flush();

  assert.equal(findActionsWrapper(container), null);
  const notice = container.querySelectorAll(".tf2te-market-actions-notice")[0];
  assert.ok(notice);
  assert.match(notice.textContent, /Steam Web API key/i);
});

// --- happy path: builds the real action block -------------------------

test("builds the Quick Sell / Instant Sell / Bulk Sell buttons once the item name + market hash name resolve", async () => {
  const { container } = installHappyPathGlobals();

  showInventoryMarketActions();
  await flush();

  const wrapper = findActionsWrapper(container);
  assert.ok(wrapper);
  const [buttonsRow, statusEl] = wrapper.children;
  const [quickSell, instantSell, bulkSell] = buttonsRow.children;
  assert.equal(quickSell.textContent, "Quick Sell");
  assert.equal(instantSell.textContent, "Instant Sell");
  assert.equal(bulkSell.textContent, "Bulk Sell");
  assert.equal(statusEl.textContent, "");
});

test("is idempotent for the same requestKey - a second run doesn't rebuild the block", async () => {
  const { container } = installHappyPathGlobals();

  showInventoryMarketActions();
  await flush();
  const firstWrapper = findActionsWrapper(container);
  assert.ok(firstWrapper);

  showInventoryMarketActions();
  await flush();
  assert.equal(findActionsWrapper(container), firstWrapper);
});

// REGRESSION for a live bug report elsewhere (steamcommunity.com/
// itemQuickLinks/content.js's own resolveRealItemName went DOM-first): a
// NON-renamed item's on-page title is already correct, so resolveRealItemName
// now deliberately returns null for it regardless of what GetPlayerItems
// says (or, as here, doesn't have) - this used to mean a hard failure (no
// block at all), but this caller falls back to displayName the same way
// itemQuickLinks/content.js already does, so a plain item's own asset simply
// not being in some GetPlayerItems fixture no longer matters at all: the
// buttons still build fine from displayName ("Rocket Launcher" needs no
// schema/API data of its own either way).
test("still builds the actions block from displayName when this asset isn't in GetPlayerItems - it's a non-renamed plain item, so resolveRealItemName's null is expected, not a failure", async () => {
  const steamId64 = "76561198000000202";
  const { container } = buildInventoryPanel();
  const marker = makeInventoryEl(`inventory_${steamId64}_440_2`);
  const activeItem = makeInventoryEl("440_2_999");
  installGlobals({
    c0: container,
    activeItem,
    storageData: { steamApiKey: "KEY123" },
    sendMessage: playerItemsSendMessage([{ id: 1, defindex: 18, quality: 6 }]), // no id 999
    schemaFixture: SCHEMA_FIXTURE,
  });
  globalThis.document.querySelectorAll = (sel) => (sel === '[id^="inventory_"]' ? [marker] : container.querySelectorAll(sel));

  showInventoryMarketActions();
  await flush();

  const wrapper = findActionsWrapper(container);
  assert.ok(wrapper);
  assert.equal(container.querySelectorAll(".tf2te-market-actions-loading").length, 0);
});

// The effect-name->id lookup this ultimately goes through
// (resolveUnusualEffect, via
// resolveTf2MarketHashName/resolveStatsAndClassifieds) now merges in
// utils/unusualEffectIds.js's own static table (see utils/tf2Schema.js's own
// getEffectNameToIdMap note), so effectNameToId is never genuinely EMPTY
// anymore the way this fixture used to force it to be. That doesn't change
// what happens here, though: this item's own display name ("Unusual Team
// Captain") never embedded an effect NAME as text in the first place (case
// 6's own API-fallback resolution has no way to recover one - see
// itemQuickLinks/content.js's own resolveRealItemName note on Australium
// having the same gap), so resolveUnusualEffect's own text-substring search
// finds nothing to match regardless of how many effect names the table it's
// searching against actually has - exactly the same "no effect embedded in
// the text" outcome a real, populated live schema already produced for this
// same input before this fix, now reachable with no Steam Web API key needed
// either. Treated as a genuine no-effect Unusual (same as "Horseless
// Headless Horsemann's Headtaker" elsewhere in this codebase) rather than a
// resolution failure - the market actions block DOES build now, for "Unusual
// Team Captain".
test("builds the actions block for an Unusual with no effect embedded in its own display text, even with an empty live effect schema - the static table's own exhaustive search still finds no match, same as a real no-effect Unusual", async () => {
  const steamId64 = "76561198000000203";
  const { container } = buildInventoryPanel({ itemTitle: "Unusual Team Captain" });
  const marker = makeInventoryEl(`inventory_${steamId64}_440_2`);
  const activeItem = makeInventoryEl("440_2_600");
  const unusualSchemaFixture = {
    itemNameToDefindex: {},
    defindexToItemName: { 30: "Team Captain" }, // schema names never include the quality word
    effectNameToId: {}, // empty live schema - the static table still covers this
    fetchedAt: Date.now(),
    schemaShapeVersion: 4,
  };
  installGlobals({
    c0: container,
    activeItem,
    storageData: { steamApiKey: "KEY123" },
    sendMessage: playerItemsSendMessage([{ id: 600, defindex: 30, quality: 5 }]), // 5 = Unusual
    schemaFixture: unusualSchemaFixture,
  });
  globalThis.document.querySelectorAll = (sel) => (sel === '[id^="inventory_"]' ? [marker] : container.querySelectorAll(sel));

  showInventoryMarketActions();
  await flush();

  assert.ok(findActionsWrapper(container));
  assert.equal(container.querySelectorAll(".tf2te-market-actions-loading").length, 0);
});

test("hides the other extension's own Quick/Instant/Bulk Sell buttons on every run", async () => {
  const { container, otherButtons } = buildInventoryPanel({ otherExtButtons: true });
  const activeItem = makeInventoryEl("440_2_1");
  installGlobals({ c0: container, activeItem, storageData: {} }); // no key - still hides on the way through

  showInventoryMarketActions();
  await flush();

  assert.equal(otherButtons.quick.style.display, "none");
  assert.equal(otherButtons.instant.style.display, "none");
  assert.equal(otherButtons.multi.style.display, "none");
});

// --- non-TF2 inventory tabs (e.g. CS2) ---------------------------------
//
// This feature now runs on ANY game's inventory tab, not just TF2's - see
// content.js's own header note. A non-TF2 item skips
// resolveRealItemName/resolveTf2MarketHashName (both TF2
// schema/GetPlayerItems-backed) entirely and instead uses
// itemQuickLinks/content.js's own findMarketListingLinkName straight off the
// item panel's customName link.

test("builds Quick Sell / Instant Sell / Bulk Sell on a non-TF2 (e.g. CS2) inventory tab, from the item panel's own market listing link - no TF2 schema/GetPlayerItems call involved", async () => {
  let sendMessageCalls = 0;
  const { container } = buildInventoryPanel({
    itemTitle: "AK-47 | Redline (Field-Tested)",
    marketLinkHref: "/market/listings/730/AK-47%20%7C%20Redline%20%28Field-Tested%29",
  });
  const activeItem = makeInventoryEl("730_2_888");
  installGlobals({
    c0: container,
    hash: "#730", // CS2
    activeItem,
    sendMessage: async () => {
      sendMessageCalls++;
      return { ok: false, error: "should never be called for a non-TF2 item" };
    },
  });

  showInventoryMarketActions();
  await flush();

  const wrapper = findActionsWrapper(container);
  assert.ok(wrapper);
  const [buttonsRow] = wrapper.children;
  const [quickSell, instantSell, bulkSell] = buttonsRow.children;
  assert.equal(quickSell.textContent, "Quick Sell");
  assert.equal(instantSell.textContent, "Instant Sell");
  assert.equal(bulkSell.textContent, "Bulk Sell");
  assert.equal(sendMessageCalls, 0);
});

test("Bulk Sell on a non-TF2 inventory tab links to that game's own appid/contextid, not TF2's", async () => {
  const { container } = buildInventoryPanel({
    itemTitle: "AK-47 | Redline (Field-Tested)",
    marketLinkHref: "/market/listings/730/AK-47%20%7C%20Redline%20%28Field-Tested%29",
  });
  const activeItem = makeInventoryEl("730_2_888");
  installGlobals({ c0: container, hash: "#730", activeItem });

  showInventoryMarketActions();
  await flush();

  const wrapper = findActionsWrapper(container);
  const [, , bulkSell] = wrapper.children[0].children;
  bulkSell.dispatchEvent({ type: "click" });

  const [href] = globalThis.__openCalls[0];
  assert.match(href, /market\/multisell\?appid=730&contextid=2&items%5B%5D=/);
});

test("hides the other extension's own buttons on a non-TF2 inventory tab too", async () => {
  const { container, otherButtons } = buildInventoryPanel({
    otherExtButtons: true,
    itemTitle: "AK-47 | Redline (Field-Tested)",
    marketLinkHref: "/market/listings/730/AK-47%20%7C%20Redline%20%28Field-Tested%29",
  });
  const activeItem = makeInventoryEl("730_2_888");
  installGlobals({ c0: container, hash: "#730", activeItem });

  showInventoryMarketActions();
  await flush();

  assert.equal(otherButtons.quick.style.display, "none");
  assert.equal(otherButtons.instant.style.display, "none");
  assert.equal(otherButtons.multi.style.display, "none");
});

// Regression: that panel's own "Turn into Gems..." button is ALSO
// data-accent-color="green" and sits BEFORE the real "Sell" button - see
// findNativeSellButton's own note. Only reachable once this feature
// stopped being TF2-only, since TF2's own item panel never has a second
// green button to conflict with.
test("inserts the actions block after the REAL Sell button, not an unrelated earlier green button like 'Turn into Gems...'", async () => {
  const { container, sellButton, otherGreenButton } = buildInventoryPanel({
    itemTitle: "Balkan",
    marketLinkHref: "/market/listings/753/730-Balkan",
    otherGreenButtonText: "Turn into Gems...",
  });
  const activeItem = makeInventoryEl("753_6_37777020203");
  installGlobals({ c0: container, hash: "#753", activeItem });

  showInventoryMarketActions();
  await flush();

  const wrapper = findActionsWrapper(container);
  assert.ok(wrapper);
  // Inserted immediately after the real Sell button...
  const sellIdx = container.children.indexOf(sellButton);
  assert.equal(container.children[sellIdx + 1], wrapper);
  // ...not after "Turn into Gems...".
  const gemsIdx = container.children.indexOf(otherGreenButton);
  assert.notEqual(container.children[gemsIdx + 1], wrapper);
});

test("clears the loading notice without building a block on a non-TF2 tab when the item panel has no market listing link at all", async () => {
  const { container } = buildInventoryPanel({ itemTitle: "Some Non-Marketable Thing" }); // no marketLinkHref
  const activeItem = makeInventoryEl("730_2_889");
  installGlobals({ c0: container, hash: "#730", activeItem });

  showInventoryMarketActions();
  await flush();

  assert.equal(findActionsWrapper(container), null);
  assert.equal(container.querySelectorAll(".tf2te-market-actions-loading").length, 0);
});

// The bail above removes the loading notice, which is itself a DOM mutation -
// steamcommunity.com/content.js's own subtree observer then calls this again
// for the same item. Without a guard that re-run rebuilt the loading notice,
// resolved nothing again, removed it again, and so on forever.
test("REGRESSION: an item with no resolvable market_hash_name is attempted once per selection, not rebuilt on every later observer call", async () => {
  const { container } = buildInventoryPanel({ itemTitle: "Some Non-Marketable Thing" }); // no marketLinkHref
  const activeItem = makeInventoryEl("730_2_889");
  installGlobals({ c0: container, hash: "#730", activeItem });

  const debugCalls = [];
  const originalDebug = console.debug;
  console.debug = (...args) => debugCalls.push(args);
  try {
    showInventoryMarketActions();
    await flush();
    showInventoryMarketActions();
    await flush();
    showInventoryMarketActions();
    await flush();
  } finally {
    console.debug = originalDebug;
  }

  const noNameLogs = debugCalls.filter((args) => args[1] === "bailing - no market_hash_name resolved");
  assert.equal(noNameLogs.length, 1);
  assert.equal(container.querySelectorAll(".tf2te-market-actions-loading").length, 0);
});

test("findNativeSellButton skips its own already-inserted clones on a later run, so it doesn't try to re-anchor off one of them", async () => {
  const { container } = installHappyPathGlobals();

  showInventoryMarketActions();
  await flush();
  assert.ok(findActionsWrapper(container));

  // A second run for the SAME item (different request key would rebuild
  // fresh, so bypass the idempotency short-circuit by clearing the markers
  // the first run set, forcing findNativeSellButton to run again with the
  // clones now present in the DOM).
  delete container.dataset.tf2teMarketActionsRequestKey;
  showInventoryMarketActions();
  await flush();

  // Still exactly one actions wrapper - the native Sell button was found
  // correctly again, not one of its own clones.
  assert.equal(container.querySelectorAll(".tf2te-market-actions").length, 1);
});

// --- Quick Sell / Instant Sell / Bulk Sell click behavior -------------

// The item's Market listing page, as Steam's current UI renders it (shape
// confirmed live for the Fabricator value card - see
// steamcommunity.com/shared/marketListingOrderBook.js): the buy-order
// sentence with its hydration comment, and the cheapest listing's price
// right before a "Buy" button. Euro with a decimal comma, like the user's.
function euro(cents) {
  return `€${(cents / 100).toFixed(2).replace(".", ",")}`;
}
function listingResponse({ minSellCents, maxBuyCents, buyCount = 12 } = {}) {
  const buy = maxBuyCents != null ? `<div class="x">${buyCount} requests to buy at <!-- -->${euro(maxBuyCents)} or lower</div>` : "";
  const sell = minSellCents != null ? `<div><span class="p"><!-- -->${euro(minSellCents)}</span><button class="b">Buy</button></div>` : "";
  return { ok: true, text: async () => `<html><body>${buy}${sell}</body></html>` };
}

function fetchRouter({ listing = {}, sellItem = { success: true } } = {}) {
  return async (url) => {
    const u = String(url);
    if (u.includes("market/listings/")) return listingResponse(listing);
    if (u.includes("market/sellitem")) return { ok: true, json: async () => sellItem };
    throw new Error(`unexpected fetch url in test: ${u}`);
  };
}

test("Quick Sell undercuts the lowest listing by 1 cent, confirms, and reports success", async () => {
  const { container } = installHappyPathGlobals({
    globalsOverrides: {
      wrappedJSObject: { GetItemPriceFromTotal: (cents) => cents - 2, g_rgWalletInfo: {} },
      fetchImpl: fetchRouter({ listing: { minSellCents: 500 } }),
    },
  });

  showInventoryMarketActions();
  await flush();
  const wrapper = findActionsWrapper(container);
  const [quickSell] = wrapper.children[0].children;
  const statusEl = wrapper.children[1];

  const clickPromise = quickSell.dispatchEvent({ type: "click" });
  await flush();
  await clickPromise;

  assert.match(statusEl.textContent, /Listed! Confirm it in the Steam Mobile App/);
});

test("Quick Sell floors the undercut price at 3 cents when the lowest listing is already at or below 3", async () => {
  let capturedPrice = null;
  const { container } = installHappyPathGlobals({
    globalsOverrides: {
      wrappedJSObject: { GetItemPriceFromTotal: (cents) => cents, g_rgWalletInfo: {} },
      fetchImpl: async (url, options) => {
        const u = String(url);
        if (u.includes("market/listings/")) return listingResponse({ minSellCents: 2 });
        if (u.includes("market/sellitem")) {
          capturedPrice = new URLSearchParams(options.body).get("price");
          return { ok: true, json: async () => ({ success: true }) };
        }
        throw new Error("unexpected url");
      },
    },
  });

  showInventoryMarketActions();
  await flush();
  const wrapper = findActionsWrapper(container);
  const [quickSell] = wrapper.children[0].children;
  await quickSell.dispatchEvent({ type: "click" });
  await flush();

  assert.equal(capturedPrice, "3");
});

test("Quick Sell shows 'No other listings to undercut.' and never confirms when there's no lowest listing", async () => {
  let confirmCalls = 0;
  const { container } = installHappyPathGlobals({
    globalsOverrides: {
      wrappedJSObject: { GetItemPriceFromTotal: (cents) => cents, g_rgWalletInfo: {} },
      fetchImpl: fetchRouter({ listing: {} }), // no listings at all
      confirmImpl: () => {
        confirmCalls++;
        return true;
      },
    },
  });

  showInventoryMarketActions();
  await flush();
  const wrapper = findActionsWrapper(container);
  const [quickSell] = wrapper.children[0].children;
  const statusEl = wrapper.children[1];

  await quickSell.dispatchEvent({ type: "click" });
  await flush();

  assert.equal(statusEl.textContent, "No other listings to undercut.");
  assert.equal(confirmCalls, 0);
});

test("cancelling the confirm dialog clears the status and never submits a listing", async () => {
  const sellItemCalls = [];
  const { container } = installHappyPathGlobals({
    globalsOverrides: {
      wrappedJSObject: { GetItemPriceFromTotal: (cents) => cents, g_rgWalletInfo: {} },
      fetchImpl: async (url) => {
        const u = String(url);
        if (u.includes("market/listings/")) return listingResponse({ minSellCents: 500 });
        if (u.includes("market/sellitem")) {
          sellItemCalls.push(u);
          return { ok: true, json: async () => ({ success: true }) };
        }
        throw new Error("unexpected url");
      },
      confirmImpl: () => false,
    },
  });

  showInventoryMarketActions();
  await flush();
  const wrapper = findActionsWrapper(container);
  const [quickSell] = wrapper.children[0].children;
  const statusEl = wrapper.children[1];

  await quickSell.dispatchEvent({ type: "click" });
  await flush();

  assert.equal(statusEl.textContent, "");
  assert.equal(sellItemCalls.length, 0);
});

test("Instant Sell shows 'No buy orders to sell to.' when there's no highest buy order", async () => {
  const { container } = installHappyPathGlobals({
    globalsOverrides: {
      wrappedJSObject: { GetItemPriceFromTotal: (cents) => cents, g_rgWalletInfo: {} },
      fetchImpl: fetchRouter({ listing: {} }),
    },
  });

  showInventoryMarketActions();
  await flush();
  const wrapper = findActionsWrapper(container);
  const [, instantSell] = wrapper.children[0].children;
  const statusEl = wrapper.children[1];

  await instantSell.dispatchEvent({ type: "click" });
  await flush();

  assert.equal(statusEl.textContent, "No buy orders to sell to.");
});

test("Instant Sell lists at the highest buy order price directly (no undercut math) on success", async () => {
  const { container } = installHappyPathGlobals({
    globalsOverrides: {
      wrappedJSObject: { GetItemPriceFromTotal: (cents) => cents - 5, g_rgWalletInfo: {} },
      fetchImpl: fetchRouter({ listing: { maxBuyCents: 700 } }),
    },
  });

  showInventoryMarketActions();
  await flush();
  const wrapper = findActionsWrapper(container);
  const [, instantSell] = wrapper.children[0].children;
  const statusEl = wrapper.children[1];

  await instantSell.dispatchEvent({ type: "click" });
  await flush();

  assert.match(statusEl.textContent, /Listed!/);
});

test("reports a 'Failed: ...' status when Steam's own market/sellitem/ response reports failure", async () => {
  const { container } = installHappyPathGlobals({
    globalsOverrides: {
      wrappedJSObject: { GetItemPriceFromTotal: (cents) => cents, g_rgWalletInfo: {} },
      fetchImpl: fetchRouter({
        listing: { minSellCents: 500 },
        sellItem: { success: false, message: "You already have a listing for this item" },
      }),
    },
  });

  showInventoryMarketActions();
  await flush();
  const wrapper = findActionsWrapper(container);
  const [quickSell] = wrapper.children[0].children;
  const statusEl = wrapper.children[1];

  await quickSell.dispatchEvent({ type: "click" });
  await flush();

  assert.equal(statusEl.textContent, "Failed: You already have a listing for this item");
});

test("re-enables the clicked button once the run finishes, success or failure alike", async () => {
  const { container } = installHappyPathGlobals({
    globalsOverrides: {
      wrappedJSObject: { GetItemPriceFromTotal: (cents) => cents, g_rgWalletInfo: {} },
      fetchImpl: fetchRouter({ listing: {} }), // no listing -> early return path
    },
  });

  showInventoryMarketActions();
  await flush();
  const wrapper = findActionsWrapper(container);
  const [quickSell] = wrapper.children[0].children;

  const clickPromise = quickSell.dispatchEvent({ type: "click" });
  assert.equal(quickSell.disabled, true);
  await clickPromise;
  assert.equal(quickSell.disabled, false);
});

test("Bulk Sell opens Steam's own Sell Multiple page in a new tab, without any fetch/confirm", async () => {
  let fetchCalls = 0;
  const { container } = installHappyPathGlobals({
    globalsOverrides: {
      fetchImpl: async () => {
        fetchCalls++;
        throw new Error("Bulk Sell should never fetch");
      },
    },
  });

  showInventoryMarketActions();
  await flush();
  const wrapper = findActionsWrapper(container);
  const [, , bulkSell] = wrapper.children[0].children;

  bulkSell.dispatchEvent({ type: "click" });

  assert.equal(fetchCalls, 0);
  assert.equal(globalThis.__openCalls.length, 1);
  const [href, target] = globalThis.__openCalls[0];
  assert.match(href, /market\/multisell\?appid=440&contextid=2&items%5B%5D=/);
  assert.equal(target, "_blank");
});

// --- resolveSellerPriceCents' CustomEvent bridge (no wrappedJSObject) -----

test("falls through to the CustomEvent bridge (mainWorld.js) when window.wrappedJSObject isn't available, and resolves via its response", async () => {
  const { container } = installHappyPathGlobals({
    globalsOverrides: {
      wrappedJSObject: undefined, // Chrome - no Firefox shortcut
      fetchImpl: fetchRouter({ listing: { minSellCents: 500 } }),
    },
  });

  // Installs a fake "mainWorld.js" responder: answers every seller-price
  // request with buyerTotalCents - 4.
  document.addEventListener("tf2te-resolve-seller-price-request", (event) => {
    const detail = JSON.parse(event.detail);
    document.dispatchEvent(
      new CustomEvent("tf2te-resolve-seller-price-response", {
        detail: JSON.stringify({ requestId: detail.requestId, sellerPriceCents: detail.buyerTotalCents - 4 }),
      })
    );
  });

  showInventoryMarketActions();
  await flush();
  const wrapper = findActionsWrapper(container);
  const [quickSell] = wrapper.children[0].children;
  const statusEl = wrapper.children[1];

  await quickSell.dispatchEvent({ type: "click" });
  await flush();

  assert.match(statusEl.textContent, /Listed!/);
});

test("reports a timeout failure when nothing ever answers the CustomEvent bridge", async () => {
  const { container } = installHappyPathGlobals({
    globalsOverrides: {
      wrappedJSObject: undefined,
      fetchImpl: fetchRouter({ listing: { minSellCents: 500 } }),
    },
  });
  // No mainWorld.js responder installed at all this time.

  showInventoryMarketActions();
  await flush();
  const wrapper = findActionsWrapper(container);
  const [quickSell] = wrapper.children[0].children;
  const statusEl = wrapper.children[1];

  // Deliberately NOT awaited yet - the click handler's own await on
  // resolveSellerPriceCents (the CustomEvent bridge) never settles until the
  // 8s timeout below fires, so awaiting this promise first would deadlock
  // the test. The synchronous portion of the handler (through registering
  // the setTimeout) has already run by the time dispatchEvent returns this
  // promise, though.
  const clickPromise = quickSell.dispatchEvent({ type: "click" });
  await flush();

  // The 8s timeout is captured (not auto-firing, see installGlobals' own
  // fake setTimeout) - fire it manually instead of waiting 8 real seconds.
  const pendingTimeout = globalThis.__timeouts.find((t) => t.delay === 8000 && !t.cleared);
  assert.ok(pendingTimeout);
  pendingTimeout.fn();
  await clickPromise;

  assert.match(statusEl.textContent, /Failed: Timed out waiting for Steam's own fee calculation/);
});

// --- reported live: "Failed: No order book data for this item" -----------
// Prices now come from the item's listing page; the confirm shows the price
// in the wallet's own currency plus what the seller receives.

test("Quick Sell reads the item's own listing page and confirms 0.01 under the cheapest listing, with what you receive", async () => {
  const fetched = [];
  let confirmText = null;
  let capturedPrice = null;
  const { container } = installHappyPathGlobals({
    globalsOverrides: {
      wrappedJSObject: { GetItemPriceFromTotal: (cents) => cents - 16, g_rgWalletInfo: {} },
      fetchImpl: async (url, options) => {
        const u = String(url);
        fetched.push(u);
        if (u.includes("market/listings/")) return listingResponse({ minSellCents: 127, maxBuyCents: 110 });
        if (u.includes("market/sellitem")) {
          capturedPrice = new URLSearchParams(options.body).get("price");
          return { ok: true, json: async () => ({ success: true }) };
        }
        throw new Error("unexpected url");
      },
      confirmImpl: (text) => {
        confirmText = text;
        return true;
      },
    },
  });

  showInventoryMarketActions();
  await flush();
  const [quickSell] = findActionsWrapper(container).children[0].children;
  await quickSell.dispatchEvent({ type: "click" });
  await flush();

  assert.match(fetched[0], /^https:\/\/steamcommunity\.com\/market\/listings\/440\/[^?]+\?l=english$/);
  assert.equal(confirmText, "Quick Sell this item for €1.26? You receive €1.10 after Steam's fee.");
  assert.equal(capturedPrice, "110"); // the pre-fee amount market/sellitem/ expects
});

test("Instant Sell confirms at the highest buy order from the listing page", async () => {
  let confirmText = null;
  const { container } = installHappyPathGlobals({
    globalsOverrides: {
      wrappedJSObject: { GetItemPriceFromTotal: (cents) => cents - 14, g_rgWalletInfo: {} },
      fetchImpl: fetchRouter({ listing: { minSellCents: 127, maxBuyCents: 110 } }),
      confirmImpl: (text) => {
        confirmText = text;
        return true;
      },
    },
  });

  showInventoryMarketActions();
  await flush();
  const [, instantSell] = findActionsWrapper(container).children[0].children;
  await instantSell.dispatchEvent({ type: "click" });
  await flush();

  assert.equal(confirmText, "Instant Sell this item for €1.10? You receive €0.96 after Steam's fee.");
});

test("hovering adds the live price to each button's explanation; hover then click loads the listing page once", async () => {
  let listingFetches = 0;
  const { container } = installHappyPathGlobals({
    globalsOverrides: {
      wrappedJSObject: { GetItemPriceFromTotal: (cents) => cents - 16, g_rgWalletInfo: {} },
      fetchImpl: async (url) => {
        const u = String(url);
        if (u.includes("market/listings/")) {
          listingFetches++;
          return listingResponse({ minSellCents: 127, maxBuyCents: 110, buyCount: 5 });
        }
        if (u.includes("market/sellitem")) return { ok: true, json: async () => ({ success: true }) };
        throw new Error("unexpected url");
      },
    },
  });

  showInventoryMarketActions();
  await flush();
  const [quickSell, instantSell] = findActionsWrapper(container).children[0].children;
  assert.match(quickSell.title, /0\.01 below the cheapest listing/);
  assert.match(instantSell.title, /highest buy order/);

  await quickSell.dispatchEvent({ type: "mouseenter" });
  await instantSell.dispatchEvent({ type: "mouseenter" });
  await flush();
  assert.match(quickSell.title, /Right now: Lists at €1\.26, 0\.01 under the cheapest listing \(€1\.27\)\. You receive €1\.10 after Steam's fee\.$/);
  assert.match(instantSell.title, /Right now: Sells to the highest buy order, €1\.10 \(5 requests to buy at this price or lower\)\. You receive €0\.94 after Steam's fee\.$/);

  await quickSell.dispatchEvent({ type: "click" });
  await flush();
  assert.equal(listingFetches, 1);
});

// The listing page comes back in the account's own Market sort (confirmed
// live: with another sort, Quick Sell undercut a €2.25 listing while Steam's
// own panel said "Starting at: 0,30€"). Steam's panel line is then used, read
// only from the market box around the Sell button row (as live).
function listingPageInOtherSort() {
  const listing = (price) => `<div><span class="p"><!-- -->${price}</span><button class="b">Buy</button></div>`;
  return { ok: true, text: async () => `<html><body>${listing("€2,25")}${listing("€1,10")}${listing("€0,30")}</body></html>` };
}

function putSellButtonInMarketBox(container, sellButton, startingAtText) {
  const marketBox = new FakeElement("div");
  const buttonRow = new FakeElement("div");
  sellButton.remove();
  if (startingAtText) {
    const line = new FakeElement("div");
    line.textContent = startingAtText;
    marketBox.appendChild(line);
  }
  buttonRow.appendChild(sellButton);
  marketBox.appendChild(buttonRow);
  container.appendChild(marketBox);
}

test("REGRESSION: with the Market sorted another way, Quick Sell uses Steam's own \"Starting at\" price and says so", async () => {
  let confirmText = null;
  const { container, sellButton } = installHappyPathGlobals({
    globalsOverrides: {
      wrappedJSObject: { GetItemPriceFromTotal: (cents) => cents - 2, g_rgWalletInfo: {} },
      fetchImpl: async (url) => {
        if (String(url).includes("market/listings/")) return listingPageInOtherSort();
        if (String(url).includes("market/sellitem")) return { ok: true, json: async () => ({ success: true }) };
        throw new Error("unexpected url");
      },
      confirmImpl: (text) => {
        confirmText = text;
        return false;
      },
    },
  });
  putSellButtonInMarketBox(container, sellButton, "Starting at: 0,30€");
  // An item description imitating the line, outside the market box: never read.
  const description = new FakeElement("div");
  description.textContent = "Starting at: 0,03€";
  container.appendChild(description);

  showInventoryMarketActions();
  await flush();
  const [quickSell] = findActionsWrapper(container).children[0].children;
  await quickSell.dispatchEvent({ type: "mouseenter" });
  await flush();
  assert.match(quickSell.title, /Right now: Lists at 0\.29€, 0\.01 under the cheapest listing \(0\.30€, Steam's own "Starting at" price, since your Market sort isn't cheapest-first\)\./);

  await quickSell.dispatchEvent({ type: "click" });
  await flush();
  assert.equal(confirmText, "Quick Sell this item for 0.29€? You receive 0.27€ after Steam's fee.");
});

test("with the Market sorted another way and no \"Starting at\" shown yet, Quick Sell refuses instead of guessing", async () => {
  const { container, sellButton } = installHappyPathGlobals({
    globalsOverrides: {
      wrappedJSObject: { GetItemPriceFromTotal: (cents) => cents - 2, g_rgWalletInfo: {} },
      fetchImpl: async () => listingPageInOtherSort(),
      confirmImpl: () => assert.fail("must not ask to list at a guessed price"),
    },
  });
  putSellButtonInMarketBox(container, sellButton, null);

  showInventoryMarketActions();
  await flush();
  const wrapper = findActionsWrapper(container);
  const [quickSell] = wrapper.children[0].children;
  await quickSell.dispatchEvent({ type: "click" });
  await flush();

  assert.match(wrapper.children[1].textContent, /^Failed: Can't tell the cheapest listing: your Market sort isn't cheapest-first/);
});

// Steam won't list below 3 cents, so with the cheapest listing at 3 cents
// Quick Sell matches it instead of going 0.01 under, and must say so.
test("Quick Sell's hover says it lists at Steam's minimum when the cheapest listing is already there", async () => {
  const { container } = installHappyPathGlobals({
    globalsOverrides: {
      wrappedJSObject: { GetItemPriceFromTotal: (cents) => cents - 2, g_rgWalletInfo: {} },
      fetchImpl: fetchRouter({ listing: { minSellCents: 3, maxBuyCents: 3 } }),
    },
  });

  showInventoryMarketActions();
  await flush();
  const [quickSell] = findActionsWrapper(container).children[0].children;
  await quickSell.dispatchEvent({ type: "mouseenter" });
  await flush();

  assert.match(quickSell.title, /Right now: Lists at €0\.03, Steam's minimum price \(the cheapest listing is €0\.03\)\./);
});

test("a failed listing page load isn't reused - the next click tries again", async () => {
  let listingFetches = 0;
  const { container } = installHappyPathGlobals({
    globalsOverrides: {
      wrappedJSObject: { GetItemPriceFromTotal: (cents) => cents, g_rgWalletInfo: {} },
      fetchImpl: async (url) => {
        const u = String(url);
        if (u.includes("market/listings/")) {
          listingFetches++;
          return listingFetches === 1 ? { ok: false, status: 429 } : listingResponse({ minSellCents: 500 });
        }
        if (u.includes("market/sellitem")) return { ok: true, json: async () => ({ success: true }) };
        throw new Error("unexpected url");
      },
    },
  });

  showInventoryMarketActions();
  await flush();
  const wrapper = findActionsWrapper(container);
  const [quickSell] = wrapper.children[0].children;
  const statusEl = wrapper.children[1];

  await quickSell.dispatchEvent({ type: "click" });
  await flush();
  assert.equal(statusEl.textContent, "Failed: Could not load the item's Steam Market page (HTTP 429)");

  await quickSell.dispatchEvent({ type: "click" });
  await flush();
  assert.equal(listingFetches, 2);
  assert.match(statusEl.textContent, /Listed!/);
});
