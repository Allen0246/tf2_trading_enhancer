import { test, mock } from "node:test";
import assert from "node:assert/strict";
import {
  getActiveInventoryAppId,
  pickContainer,
  findActiveAssetId,
  findLoggedInSteamId64,
  resolveRealItemName,
  showItemQuickLinks,
  showSelectedItemEffect,
  __resetItemQuickLinksReactivityForTests,
} from "../steamcommunity.com/itemQuickLinks/content.js";
import { UNUSUAL_EFFECT_IDS } from "../utils/unusualEffectIds.js";
import { PARTICLE_HOST_URL } from "../utils/particleImages.js";
import { __resetSchemaCacheForTests } from "../utils/tf2Schema.js";
import { __resetPricedbCacheForTests } from "../utils/pricedb.js";
import { __resetWarpaintsCacheForTests } from "../utils/warpaints.js";

// Captured BEFORE the global.setTimeout override below replaces it - flush()
// (further down) needs the REAL setTimeout to actually drain pending
// microtask/macrotask work between test steps; insertQuickLinks' own new
// settle-and-reread delay (see its own note) needs the FAKE one so tests
// don't sit through a real 120ms wait per case.
const realSetTimeout = setTimeout;
global.setTimeout = (fn) => {
  fn();
  return 0;
};

// itemQuickLinks/content.js builds the next.backpack.tf:/backpack.tf:/
// marketplace.tf/Steam Market quick-link block on a steamcommunity.com
// inventory item panel, plus resolveRealItemName's own real-identity
// recovery (GetPlayerItems + the TF2 schema, defeating a custom Name Tag).
// utils/tf2PlayerItems.js/utils/tf2Schema.js/utils/tf2StatsLinks/index.js are all
// real, already-tested modules here - only their own chrome.storage.local/
// chrome.runtime.sendMessage are faked (same fixture shapes as
// tests/tf2PlayerItems.test.js/tests/tf2Schema.test.js). tf2Schema.js's own
// module-scope schema cache is reset every test (see beforeEach) so each
// test's own fixture is actually consulted, same pattern as
// tests/marketListingLinks.test.js. tf2PlayerItems.js's own per-steamId64
// dedupe needs no such reset - each test below just uses its own distinct
// steamId64 instead, since a fresh key never collides with another test's
// memoized result.
test.beforeEach(() => {
  __resetSchemaCacheForTests();
  // utils/pricedb.js's own in-memory cache is keyed per item name, not per
  // test - several tests below reuse "Rocket Launcher" with a different
  // pricedbSku fixture than an earlier test used for that same name.
  __resetPricedbCacheForTests();
  // showItemQuickLinks' own reactivity listener guard (see its own note) -
  // each test installs its own fresh fake chrome.storage.onChanged, so the
  // guard has to be re-armed too or only the very first test in this file
  // would ever actually register a listener against its own fixture.
  __resetItemQuickLinksReactivityForTests();
});

class FakeElement {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    this._classes = new Set();
    this.classList = {
      add: (...names) => names.forEach((n) => this._classes.add(n)),
      contains: (name) => this._classes.has(name),
    };
    this._textContent = "";
    this._id = "";
    this.style = {};
    this._listeners = {};
    this._attrs = {};
  }
  getAttribute(name) {
    return name in this._attrs ? this._attrs[name] : null;
  }
  setAttribute(name, value) {
    this._attrs[name] = String(value);
  }
  removeAttribute(name) {
    delete this._attrs[name];
  }
  // Like the real DOM: connected when the ancestor chain reaches an item
  // panel container (buildContainerWithTitle marks it as the page root).
  get isConnected() {
    let el = this;
    while (el.parentElement) el = el.parentElement;
    return el._isRoot === true;
  }
  addEventListener(type, cb) {
    (this._listeners[type] ||= []).push(cb);
  }
  dispatchEvent(evt) {
    const results = (this._listeners[evt.type] || []).map((cb) => cb(evt));
    return Promise.all(results);
  }
  get textContent() {
    // Real DOM textContent aggregates through descendants - needed since the
    // title's own name text lives on a nested <span> (see
    // buildContainerWithTitle's own note), not the <h1> itself.
    if (this.children.length > 0) return this.children.map((c) => c.textContent || "").join("");
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
  appendChild(child) {
    // A real DOM auto-wraps a raw string arg (e.g. `el.append("text", link)`)
    // into a genuine Text node whose own .textContent is that string - wrap
    // it the same way here (a real string has no .textContent property of
    // its own, so `children.map(c => c.textContent)` elsewhere would
    // otherwise silently drop it) rather than pushing the bare string in.
    if (typeof child === "string") child = { textContent: child };
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
  replaceWith(other) {
    const parent = this.parentElement;
    if (!parent) return;
    parent.children.splice(parent.children.indexOf(this), 1, other);
    other.parentElement = parent;
    this.parentElement = null;
  }
  insertBefore(newNode, referenceNode) {
    const idx = referenceNode ? this.children.indexOf(referenceNode) : -1;
    if (idx === -1) this.children.push(newNode);
    else this.children.splice(idx, 0, newNode);
    newNode.parentElement = this;
    return newNode;
  }
  matchesSelectorPart(part) {
    if (part.startsWith(".")) return this._classes.has(part.slice(1));
    if (part.startsWith("#")) return this._id === part.slice(1);
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
}

function makeLeafDiv(text) {
  const el = new FakeElement("div");
  el.textContent = text;
  return el;
}

function buildContainerWithTitle(
  itemDisplayName,
  { effectLine, sheenLine, killstreakerLine, spellLine, paintLine, renamedNoticeLine, outputSheenKillstreakerLine } = {}
) {
  const container = new FakeElement("div");
  container._isRoot = true; // stands in for being on the page (see isConnected)
  const title = new FakeElement("h1");
  // Confirmed live: the title's own name text lives on a nested <span>
  // child, not directly on the <h1> - see readVisibleTitleText's own note
  // for the OTHER confirmed-live shape (a hidden "doHide" duplicate child
  // alongside the visible one), covered separately below.
  const nameSpan = new FakeElement("span");
  nameSpan.textContent = itemDisplayName;
  title.appendChild(nameSpan);
  container.appendChild(title);
  if (effectLine) container.appendChild(makeLeafDiv(effectLine));
  if (sheenLine) container.appendChild(makeLeafDiv(sheenLine));
  if (killstreakerLine) container.appendChild(makeLeafDiv(killstreakerLine));
  if (spellLine) container.appendChild(makeLeafDiv(spellLine));
  if (paintLine) container.appendChild(makeLeafDiv(paintLine));
  // A Kit Fabricator's own OUTPUT section line, e.g.
  // "(Killstreaker: Fire Horns, Sheen: Mean Green)" - see
  // findFabricatorOutputSheenAndKillstreaker's own note. Pass the full
  // parenthesized text as-is.
  if (outputSheenKillstreakerLine) container.appendChild(makeLeafDiv(outputSheenKillstreakerLine));
  // Steam's own "This item has been renamed. Original name: X" notice - see
  // isItemRenamed/findRenamedOriginalName's own note. Pass `true` for a
  // renamed item whose original name shouldn't be recoverable this way
  // (simulates the notice's own guessed quote/punctuation shape not
  // matching), or a string for one that should recover via it.
  if (renamedNoticeLine === true) {
    container.appendChild(makeLeafDiv("This item has been renamed."));
  } else if (renamedNoticeLine) {
    container.appendChild(makeLeafDiv(`This item has been renamed. Original name: "${renamedNoticeLine}"`));
  }
  return { container, title };
}

// Discriminates the two chrome.runtime.sendMessage({type: "FETCH_JSON", url})
// calls insertQuickLinks' own Promise.all can issue in parallel
// (GetPlayerItems for resolveRealItemName, pricedb.io's own /api/search for
// searchPricedbSkuStatus) by the request url - same shape utils/pricedb.js's own
// header note documents (an extra "data" wrapper around the results array).
function mixedSendMessage({ items = [], pricedbSku = null, pricedbRateLimited = false, retryAfterMs } = {}) {
  return async (message) => {
    const url = String(message?.url || "");
    if (url.includes("GetPlayerItems")) return { ok: true, data: { result: { items } } };
    if (url.includes("pricedb.io")) {
      // Same real HTTP 429 status/shape background.js's own fetchJson
      // already returns on pricedb.io's own dynamic per-IP rate limit - see
      // utils/pricedb.js's own searchPricedbSkuStatus note.
      if (pricedbRateLimited) return { ok: false, status: 429, error: "Rate limited (429)", retryAfterMs };
      return { ok: true, data: { success: true, data: { results: pricedbSku ? [{ sku: pricedbSku }] : [] } } };
    }
    return { ok: false, error: "unexpected message in test fixture" };
  };
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

function installGlobals({
  hash = "",
  c0 = null,
  c1 = null,
  activeItem = null,
  inventoryEls = [],
  storageData = {},
  sendMessage,
  schemaFixture,
} = {}) {
  globalThis.window = { location: { hash } };
  globalThis.document = {
    querySelector: (sel) => {
      if (sel === "#iteminfo0") return c0;
      if (sel === "#iteminfo1") return c1;
      if (sel === ".item.activeInfo") return activeItem;
      return null;
    },
    querySelectorAll: (sel) => (sel === '[id^="inventory_"]' ? inventoryEls : []),
    createElement: (tag) => new FakeElement(tag),
    createElementNS: (_ns, tag) => new FakeElement(tag),
  };

  const storage = fakeStorageLocal(storageData);
  const onChangedListeners = [];
  globalThis.chrome = {
    storage: {
      local: storage,
      // Minimal real addListener - lets showItemQuickLinks' own reactivity
      // (see its own note) register against this fake exactly like the real
      // chrome.storage.onChanged API. fireStorageChange below simulates what
      // the popup's own settings Save actually triggers.
      onChanged: {
        addListener(fn) {
          onChangedListeners.push(fn);
        },
      },
    },
    runtime: {
      sendMessage: sendMessage || (async () => ({ ok: false, error: "no sendMessage fixture installed" })),
      getURL: (path) => path,
    },
  };
  globalThis.fetch = async () => ({ json: async () => [] }); // warpaints - unused here

  if (schemaFixture) storage._store.tf2SchemaCache = schemaFixture;

  // Simulates a chrome.storage.local.set({...}) elsewhere (the popup's own
  // Save button) - real chrome.storage.onChanged fires with {newValue} pairs
  // shaped exactly like this, "local" as the area.
  function fireStorageChange(changesByKey) {
    const changes = {};
    for (const [key, newValue] of Object.entries(changesByKey)) changes[key] = { newValue };
    onChangedListeners.slice().forEach((fn) => fn(changes, "local"));
  }

  return { storage, fireStorageChange };
}

function makeInventoryEl(id, { borderColor } = {}) {
  const el = new FakeElement("div");
  el.id = id;
  // Steam's own inline "border-color: rgb(r, g, b)" style on the grid tile -
  // see resolveQualityFromActiveTile's own note. Given as an "rgb(...)"
  // string (matching Steam's own live shape) rather than a hex string.
  if (borderColor) el.setAttribute("style", `border-color: ${borderColor}; background-color: rgb(60, 53, 46);`);
  return el;
}

async function flush(ticks = 6) {
  for (let i = 0; i < ticks; i++) await new Promise((resolve) => realSetTimeout(resolve, 0));
}

// --- getActiveInventoryAppId -------------------------------------------

test("getActiveInventoryAppId reads the numeric app id straight off the URL hash", () => {
  installGlobals({ hash: "#440" });
  assert.equal(getActiveInventoryAppId(), 440);
});

test("getActiveInventoryAppId falls back to the active tile's own {appid}_{contextid}_{assetid} id when the hash has none", () => {
  const activeItem = makeInventoryEl("730_2_123");
  installGlobals({ hash: "", activeItem });
  assert.equal(getActiveInventoryAppId(), 730);
});

test("getActiveInventoryAppId returns null when neither the hash nor an active tile is present", () => {
  installGlobals({ hash: "" });
  assert.equal(getActiveInventoryAppId(), null);
});

test("getActiveInventoryAppId returns null when the active tile's id isn't the expected 3-part shape", () => {
  const activeItem = makeInventoryEl("malformed");
  installGlobals({ hash: "", activeItem });
  assert.equal(getActiveInventoryAppId(), null);
});

// --- pickContainer -----------------------------------------------------

test("pickContainer prefers #iteminfo0 when it has a rendered <h1>", () => {
  const { container: c0 } = buildContainerWithTitle("Rocket Launcher");
  installGlobals({ c0 });
  const picked = pickContainer();
  assert.equal(picked.container, c0);
});

test("pickContainer falls back to #iteminfo1 when #iteminfo0 has no <h1> yet", () => {
  const { container: c1, title } = buildContainerWithTitle("Scattergun");
  installGlobals({ c0: new FakeElement("div"), c1 });
  const picked = pickContainer();
  assert.equal(picked.container, c1);
  assert.equal(picked.title, title);
});

test("pickContainer returns null when neither container has a rendered <h1>", () => {
  installGlobals({ c0: new FakeElement("div"), c1: new FakeElement("div") });
  assert.equal(pickContainer(), null);
});

// --- findActiveAssetId ---------------------------------------------------

test("findActiveAssetId reads the asset id off the selected tile's {appid}_{contextid}_{assetid} id", () => {
  const activeItem = makeInventoryEl("440_2_16973658616");
  installGlobals({ activeItem });
  assert.equal(findActiveAssetId(), "16973658616");
});

test("findActiveAssetId returns null when no tile is selected", () => {
  installGlobals({});
  assert.equal(findActiveAssetId(), null);
});

// --- resolveRealItemName -------------------------------------------------

const SCHEMA_FIXTURE = {
  itemNameToDefindex: {},
  defindexToItemName: { 202: "Minigun", 18: "Rocket Launcher" },
  effectNameToId: {},
  fetchedAt: Date.now(),
  schemaShapeVersion: 4,
};

function playerItemsSendMessage(items) {
  return async () => ({ ok: true, data: { result: { items } } });
}

// REGRESSION for a live bug report: buildContainerWithTitle's own
// renamedNoticeLine option models the notice as a pure-text leaf div, which
// happened to keep every OTHER test in this file passing even though the
// real detection logic was completely broken - Steam's actual notice wraps a
// decorative <svg> icon in the SAME div as its text
// ("<div><svg>...</svg>This item has been renamed...</div>"), which
// iterateLeafTexts' own "skip any div with a child element" rule silently
// disqualified, so isItemRenamed/findRenamedOriginalName never matched
// ANYTHING at all on the real page - every renamed item was treated as
// "not renamed" and silently built links from its fake renamed title. This
// builds the notice the way Steam actually does (confirmed live via its own
// HTML) to prove the fix instead of just the simplified fixture.
function buildRealisticRenameNotice(originalName) {
  const notice = new FakeElement("div");
  const icon = new FakeElement("svg"); // no text content of its own, same as Steam's real icon
  notice.appendChild(icon);
  notice.appendChild(`This item has been renamed.\nOriginal name: "${originalName}"`);
  return notice;
}

test("REGRESSION: detects a renamed item and recovers its original name even when Steam's own notice wraps an icon in the SAME div as its text", async () => {
  const { container } = buildContainerWithTitle("Prescription drugs");
  container.appendChild(buildRealisticRenameNotice("Hunter in Darkness"));

  const activeItem = makeInventoryEl("440_2_999", { borderColor: "rgb(134, 80, 172)" }); // Unusual
  installGlobals({
    c0: container,
    hash: "#440",
    activeItem,
    storageData: { steamApiKey: "KEY123" },
    sendMessage: async (msg) => {
      if (String(msg?.url || "").includes("GetPlayerItems")) throw new Error("not needed - Hunter in Darkness isn't Australium-eligible");
      return { ok: false, error: "not needed for this test" };
    },
  });

  showItemQuickLinks();
  await flush();

  const block = container.querySelectorAll(".tf2te-market-links")[0];
  assert.ok(block);
  const gladiatorLink = block.querySelectorAll("a").find((a) => a.href?.startsWith("https://gladiator.tf/sales"));
  assert.ok(gladiatorLink);
  assert.equal(new URL(gladiatorLink.href).searchParams.get("item"), "Unusual Hunter in Darkness");
});

// Confirmed live via the item panel's own "View in Community Market" link -
// present for any marketable item (renamed or not), pointing at Steam's own
// authoritative market_hash_name for it, e.g.
// ".../market/listings/440/Strange%20Professional%20Killstreak%20Dead%20
// Reckoner%20Revolver%20(Factory%20New)". Matched by the link's own href
// PATTERN (see findMarketListingLinkName's own note), not its label text.
function makeMarketLink(marketHashName) {
  const link = new FakeElement("a");
  link.setAttribute("href", `https://steamcommunity.com/market/listings/440/${encodeURIComponent(marketHashName)}`);
  return link;
}

// Confirmed live: Steam's own item panel lists every skin in a Decorated
// Weapon's Collection, marking THIS item's own skin with a "✔ " prefix
// (see findCollectionSkinName's own note) among otherwise-unmarked entries.
function makeCollectionCheckmarkLine(skinName) {
  return makeLeafDiv(`✔ ${skinName}`);
}

test("resolveRealItemName uses the item panel's own 'View in Community Market' link as the primary source for a renamed item - recovers the Decorated Weapon skin name too, which no other DOM source can", async () => {
  const { container } = buildContainerWithTitle("This Gun Killed John Lennon", {
    renamedNoticeLine: "Revolver",
  });
  container.appendChild(makeMarketLink("Strange Professional Killstreak Dead Reckoner Revolver (Factory New)"));
  const activeItem = makeInventoryEl("440_2_999", { borderColor: "rgb(207, 106, 50)" }); // Strange
  installGlobals({ activeItem, storageData: {} });

  const { name, unresolved } = await resolveRealItemName(container);
  assert.equal(name, "Strange Professional Killstreak Dead Reckoner Revolver (Factory New)");
  assert.equal(unresolved, false);
});

test("resolveRealItemName falls back to the Collection checkmark's own skin name when there's no Community Market link (a non-marketable/non-tradable item) - still combines it with the DOM-recovered quality + killstreak prefix", async () => {
  const { container } = buildContainerWithTitle("This Gun Killed John Lennon", {
    sheenLine: "Sheen: Deadly Daffodil",
    killstreakerLine: "Killstreaker: Incinerator",
    renamedNoticeLine: "Revolver",
  });
  container.appendChild(makeLeafDiv("Powerhouse Collection"));
  container.appendChild(makeLeafDiv("Liquid Asset Stickybomb Launcher"));
  // Confirmed live: a Collection entry is the War Paint's OWN catalog name
  // ("{Skin} War Paint"), not "{skin}{weapon}" - see findCollectionSkinName's
  // own note.
  container.appendChild(makeCollectionCheckmarkLine("Dead Reckoner War Paint"));
  container.appendChild(makeLeafDiv("Black Dahlia Pistol"));
  const activeItem = makeInventoryEl("440_2_999", { borderColor: "rgb(207, 106, 50)" }); // Strange
  installGlobals({ activeItem, storageData: {} });

  const { name, unresolved } = await resolveRealItemName(container);
  assert.equal(name, "Strange Professional Killstreak Dead Reckoner Revolver");
  assert.equal(unresolved, false);
});

// REGRESSION for a live bug report: findMarketListingLinkName's own check
// used to be nested inside the isRenamed branch, so a Decorated Weapon that
// ISN'T renamed at all (its own on-page title is already accurate text, just
// missing Quality/Killstreak words - see resolveRealItemName's own header
// note) skipped it entirely and built every link off the bare, incomplete
// on-page title instead.
test("REGRESSION: uses the Community Market link even when the item ISN'T renamed at all - a Decorated Weapon's own title omits Quality/Killstreak words regardless of rename status", async () => {
  const { container } = buildContainerWithTitle("Freedom Wrapped Black Box"); // no renamedNoticeLine - not renamed
  container.appendChild(makeMarketLink("Strange Unusual Professional Killstreak Freedom Wrapped Black Box (Factory New)"));
  installGlobals({ storageData: {} });

  const { name, unresolved } = await resolveRealItemName(container);
  assert.equal(name, "Strange Unusual Professional Killstreak Freedom Wrapped Black Box (Factory New)");
  assert.equal(unresolved, false);
});

// REGRESSION for a live bug report: Steam reuses the exact same "★ " glyph
// for an Unusual item's own "★ Unusual Effect: X" line AND for marking this
// item's own entry in its Collection list (e.g. "★ Freedom Wrapped War
// Paint") - a bare "starts with ★" match hit the effect line FIRST (it
// renders earlier in the panel) and wrongly returned "Unusual Effect: Hot"
// as if it were the skin name.
test("REGRESSION: findCollectionSkinName's own star marker isn't fooled by an Unusual item's own '★ Unusual Effect: X' line using the identical glyph", async () => {
  const { container } = buildContainerWithTitle("Some Renamed Weapon", { renamedNoticeLine: "Black Box" });
  container.appendChild(makeLeafDiv("★ Unusual Effect: Hot")); // renders BEFORE the collection entry, same as live
  container.appendChild(makeLeafDiv("Infernal Reward Collection"));
  container.appendChild(makeLeafDiv("Fire Glazed War Paint"));
  container.appendChild(makeLeafDiv("★ Freedom Wrapped War Paint"));
  const activeItem = makeInventoryEl("440_2_999", { borderColor: "rgb(134, 80, 172)" }); // Unusual
  installGlobals({ activeItem, storageData: {} });

  const { name } = await resolveRealItemName(container);
  // "Freedom Wrapped War Paint" (the Collection entry's own raw text) with
  // its literal " War Paint" suffix stripped ("Freedom Wrapped"), combined
  // with renamedOriginalName ("Black Box") - see resolveRealItemName's own
  // note on why this is no longer used as the name outright.
  assert.equal(name, "Unusual Freedom Wrapped Black Box");
});

test("resolveRealItemName prefers the Community Market link over the Collection checkmark when both are present", async () => {
  const { container } = buildContainerWithTitle("This Gun Killed John Lennon", {
    sheenLine: "Sheen: Deadly Daffodil",
    killstreakerLine: "Killstreaker: Incinerator",
    renamedNoticeLine: "Revolver",
  });
  container.appendChild(makeMarketLink("Strange Professional Killstreak Dead Reckoner Revolver (Factory New)"));
  container.appendChild(makeCollectionCheckmarkLine("Dead Reckoner War Paint"));
  const activeItem = makeInventoryEl("440_2_999", { borderColor: "rgb(207, 106, 50)" }); // Strange
  installGlobals({ activeItem, storageData: {} });

  const { name } = await resolveRealItemName(container);
  assert.equal(name, "Strange Professional Killstreak Dead Reckoner Revolver (Factory New)");
});

// REGRESSION for a live bug report: a non-marketable (untradeable) Decorated
// Weapon that ISN'T renamed at all used to short-circuit straight to
// { name: null } (case 2's old behavior), trusting the bare on-page title
// as-is - fine for an ordinary item, but a Decorated Weapon's own title never
// carries Quality/Killstreak words (see this function's own header note), so
// a Strange/Killstreak one's classifieds search always searched the wrong
// (default) quality. Seen via a Smissmas Sweater Flame Thrower
// whose classifieds link came out with quality=6 (Unique) instead of its real
// Strange quality. Uses findCollectionSkinName purely as a boolean "this item
// has a skin" signal (see resolveRealItemName's own note on why its VALUE -
// the War Paint's own "{Skin} War Paint" catalog name - is never used as the
// name itself) combined with the item's own already-correct on-page title
// plus the border-color quality + Sheen-derived killstreak prefix.
test("resolveRealItemName reconstructs a NON-renamed, non-marketable Decorated Weapon's Quality/Killstreak prefix from the Collection checkmark + border color, not just the bare on-page title", async () => {
  const { container } = buildContainerWithTitle("Smissmas Sweater Flame Thrower", {
    sheenLine: "Sheen: Team Shine",
    killstreakerLine: "Killstreaker: Hypno-Beam", // implies Professional Killstreak (tier 3)
  });
  container.appendChild(makeLeafDiv("Powerhouse Collection"));
  container.appendChild(makeCollectionCheckmarkLine("Smissmas Sweater War Paint"));
  const activeItem = makeInventoryEl("440_2_999", { borderColor: "rgb(207, 106, 50)" }); // Strange
  installGlobals({ activeItem, storageData: {} });

  const { name, unresolved, isMarketable } = await resolveRealItemName(container);
  assert.equal(name, "Strange Professional Killstreak Smissmas Sweater Flame Thrower");
  assert.equal(unresolved, false);
  assert.equal(isMarketable, false);
});

// REGRESSION for a live bug report, a SECOND time ("Smissmas Sweater Knife"):
// an earlier version of this fix used the Collection checkmark's own text AS
// the reconstructed name outright - which is the War Paint's own catalog
// name ("Smissmas Sweater War Paint"), not "{skin}{weapon}" - so a "Smissmas
// Sweater Knife" got reconstructed as "Smissmas Sweater War Paint" instead,
// losing "Knife" entirely. Proves the fix holds for a DIFFERENT weapon than
// the one the original bug report used, confirming this isn't just an
// accidental match against one specific fixture string.
test("REGRESSION: reconstructs a DIFFERENT weapon's own name correctly too (not just Flame Thrower) - 'Smissmas Sweater Knife' keeps 'Knife', not 'War Paint'", async () => {
  const { container } = buildContainerWithTitle("Smissmas Sweater Knife");
  container.appendChild(makeLeafDiv("Powerhouse Collection"));
  container.appendChild(makeCollectionCheckmarkLine("Smissmas Sweater War Paint"));
  installGlobals({ storageData: {} });

  const { name } = await resolveRealItemName(container);
  assert.equal(name, "Smissmas Sweater Knife");
});

// "Decorated Weapon" (STEAM_QUALITY_BORDER_COLORS' own name for the
// DEFAULT, non-Strange/Unusual border color) is never actually written as a
// literal word in a Decorated Weapon's own name text - matchDecoratedWeapon
// derives it purely from the ABSENCE of a "Strange "/"Unusual " prefix.
// Prepending it literally here (the most common case - most Decorated
// Weapons aren't Strange/Unusual) would have left matchDecoratedWeapon
// unable to find any skin name at all, since no bundled skin name starts
// with "Decorated Weapon ".
test("resolveRealItemName's Collection-checkmark reconstruction does NOT prepend a literal 'Decorated Weapon ' quality word for the default (non-Strange/Unusual) border color", async () => {
  const { container } = buildContainerWithTitle("Smissmas Sweater Flame Thrower");
  container.appendChild(makeCollectionCheckmarkLine("Smissmas Sweater War Paint"));
  const activeItem = makeInventoryEl("440_2_999", { borderColor: "rgb(250, 250, 250)" }); // Decorated Weapon (#fafafa)
  installGlobals({ activeItem, storageData: {} });

  const { name } = await resolveRealItemName(container);
  assert.equal(name, "Smissmas Sweater Flame Thrower");
});

test("resolveRealItemName still returns { name: null } for a NON-renamed, non-marketable item with no Collection marker at all (an ordinary, non-skinned item)", async () => {
  const { container } = buildContainerWithTitle("Rocket Launcher");
  installGlobals({ storageData: {} });

  assert.deepEqual(await resolveRealItemName(container), { name: null, unresolved: false, isMarketable: false });
});

test("resolveRealItemName reconstructs 'Strange Professional Killstreak Australium Minigun' from DOM signals + GetPlayerItems + schema", async () => {
  const steamId64 = "76561198000000101";
  const assetId = "111";
  const { container } = buildContainerWithTitle("Killing Is My Business...", {
    sheenLine: "Sheen: Team Shine",
    killstreakerLine: "Killstreaker: Hypno-Beam",
    renamedNoticeLine: "Minigun",
  });
  const activeItem = makeInventoryEl(`440_2_${assetId}`);
  const marker = makeInventoryEl(`inventory_${steamId64}_440_2`);
  installGlobals({
    activeItem,
    storageData: { steamApiKey: "KEY123" },
    sendMessage: playerItemsSendMessage([{ id: 111, defindex: 202, quality: 11, style: 1 }]),
    schemaFixture: SCHEMA_FIXTURE,
  });
  globalThis.document.querySelectorAll = (sel) => (sel === '[id^="inventory_"]' ? [marker] : []);

  const { name, unresolved } = await resolveRealItemName(container);
  assert.equal(name, "Strange Professional Killstreak Australium Minigun");
  assert.equal(unresolved, false);
});

test("resolveRealItemName returns { name: null, unresolved: false } when the steamId64 can't be read off the page - a page-structure issue, not a Steam API one, so no retry prompt regardless of key", async () => {
  const { container } = buildContainerWithTitle("Rocket Launcher");
  const activeItem = makeInventoryEl("440_2_111");
  installGlobals({ activeItem, storageData: { steamApiKey: "KEY123" } });
  globalThis.document.querySelectorAll = () => []; // no inventory_ marker at all

  assert.deepEqual(await resolveRealItemName(container), { name: null, unresolved: false, isMarketable: false });
});

test("resolveRealItemName returns { name: null, unresolved: false } when no tile is currently selected (no assetId)", async () => {
  const { container } = buildContainerWithTitle("Rocket Launcher");
  const marker = makeInventoryEl("inventory_76561198000000102_440_2");
  installGlobals({ storageData: { steamApiKey: "KEY123" } });
  globalThis.document.querySelectorAll = (sel) => (sel === '[id^="inventory_"]' ? [marker] : []);

  assert.deepEqual(await resolveRealItemName(container), { name: null, unresolved: false, isMarketable: false });
});

// REGRESSION for a live bug report: unresolved used to come back true for
// ANY item whenever GetPlayerItems failed, even a perfectly ordinary
// NON-renamed one - now gated on the item actually being renamed (see
// resolveRealItemName's own header note): this container includes
// renamedNoticeLine: true (Steam's own "This item has been renamed" notice,
// present but deliberately NOT in the guessed quote/punctuation shape this
// file's own findRenamedOriginalName looks for), so neither the API nor the
// DOM notice recovers anything, and insertQuickLinks can flag it with a
// Retry prompt instead of silently building links from the item's renamed
// title with no indication anything went wrong.
test("resolveRealItemName returns { name: null, unresolved: true } when this asset isn't in the fetched GetPlayerItems result, the item IS renamed, and its notice can't be parsed either", async () => {
  const steamId64 = "76561198000000103";
  const { container } = buildContainerWithTitle("Rocket Launcher", { renamedNoticeLine: true });
  const marker = makeInventoryEl(`inventory_${steamId64}_440_2`);
  const activeItem = makeInventoryEl("440_2_999");
  installGlobals({
    activeItem,
    storageData: { steamApiKey: "KEY123" },
    sendMessage: playerItemsSendMessage([{ id: 111, defindex: 202, quality: 11, style: 1 }]), // no id 999
  });
  globalThis.document.querySelectorAll = (sel) => (sel === '[id^="inventory_"]' ? [marker] : []);

  assert.deepEqual(await resolveRealItemName(container), { name: null, unresolved: true, isMarketable: false });
});

test("resolveRealItemName returns { name: null, unresolved: true } when the resolved defindex isn't in the cached schema, the item IS renamed, and its notice can't be parsed either", async () => {
  const steamId64 = "76561198000000104";
  const { container } = buildContainerWithTitle("Rocket Launcher", { renamedNoticeLine: true });
  const marker = makeInventoryEl(`inventory_${steamId64}_440_2`);
  const activeItem = makeInventoryEl("440_2_222");
  installGlobals({
    activeItem,
    storageData: { steamApiKey: "KEY123" },
    sendMessage: playerItemsSendMessage([{ id: 222, defindex: 99999, quality: 6 }]), // unknown defindex
    schemaFixture: SCHEMA_FIXTURE,
  });
  globalThis.document.querySelectorAll = (sel) => (sel === '[id^="inventory_"]' ? [marker] : []);

  assert.deepEqual(await resolveRealItemName(container), { name: null, unresolved: true, isMarketable: false });
});

// unresolved stays false here purely because the item isn't renamed at all
// (see the "does NOT show a warning for a NON-renamed item" test above for
// the same reasoning) - NOT because of the missing key specifically. A
// renamed item with no key configured DOES still come back unresolved: true
// (see the two "IS renamed" tests above) - buildUnresolvedWarning is what
// branches on hasSteamApiKey() to phrase that case differently (a "set up a
// key" prompt, no Retry link) - see the showItemQuickLinks-level "shows a
// 'Get a Steam Web API key' warning" test further down for that.
test("resolveRealItemName returns { name: null, unresolved: false } when resolution fails and NO key is configured at all, for a non-renamed item", async () => {
  const steamId64 = "76561198000000199";
  const { container } = buildContainerWithTitle("Rocket Launcher");
  const marker = makeInventoryEl(`inventory_${steamId64}_440_2`);
  const activeItem = makeInventoryEl("440_2_888");
  installGlobals({ activeItem, storageData: {} }); // no steamApiKey at all
  globalThis.document.querySelectorAll = (sel) => (sel === '[id^="inventory_"]' ? [marker] : []);

  assert.deepEqual(await resolveRealItemName(container), { name: null, unresolved: false, isMarketable: false });
});

// renamedNoticeLine is "Rocket Launcher" (Australium-eligible) so the API
// path actually runs - a non-Australium-eligible name would resolve entirely
// from DOM alone now and never reach entry.quality at all (see
// resolveRealItemName's own header note on why the API is only consulted at
// all for that narrow set of weapons, once a renamed item's own DOM-only
// result already has a usable name).
test("resolveRealItemName omits the quality prefix for Unique-quality items", async () => {
  const steamId64 = "76561198000000105";
  const { container } = buildContainerWithTitle("Rocket Launcher", { renamedNoticeLine: "Rocket Launcher" });
  const marker = makeInventoryEl(`inventory_${steamId64}_440_2`);
  const activeItem = makeInventoryEl("440_2_333");
  installGlobals({
    activeItem,
    storageData: { steamApiKey: "KEY123" },
    sendMessage: playerItemsSendMessage([{ id: 333, defindex: 18, quality: 6 }]), // 6 = Unique
    schemaFixture: SCHEMA_FIXTURE,
  });
  globalThis.document.querySelectorAll = (sel) => (sel === '[id^="inventory_"]' ? [marker] : []);

  assert.equal((await resolveRealItemName(container)).name, "Rocket Launcher");
});

// Specialized carries a Sheen but no Killstreaker; this used to be read as
// Professional (the Sheen and Killstreaker checks were swapped).
test("REGRESSION: resolveRealItemName uses 'Specialized Killstreak' when a Sheen is known but no Killstreaker", async () => {
  const steamId64 = "76561198000000106";
  const { container } = buildContainerWithTitle("Rocket Launcher", {
    sheenLine: "Sheen: Team Shine",
    renamedNoticeLine: "Rocket Launcher",
  });
  const marker = makeInventoryEl(`inventory_${steamId64}_440_2`);
  const activeItem = makeInventoryEl("440_2_444");
  installGlobals({
    activeItem,
    storageData: { steamApiKey: "KEY123" },
    sendMessage: playerItemsSendMessage([{ id: 444, defindex: 18, quality: 6 }]),
    schemaFixture: SCHEMA_FIXTURE,
  });
  globalThis.document.querySelectorAll = (sel) => (sel === '[id^="inventory_"]' ? [marker] : []);

  assert.equal((await resolveRealItemName(container)).name, "Specialized Killstreak Rocket Launcher");
});

test("resolveRealItemName uses plain 'Killstreak' (Basic tier) when only 'Killstreaks Active' is present", async () => {
  const steamId64 = "76561198000000107";
  const { container } = buildContainerWithTitle("Rocket Launcher", {
    effectLine: "Killstreaks Active",
    renamedNoticeLine: "Rocket Launcher",
  });
  const marker = makeInventoryEl(`inventory_${steamId64}_440_2`);
  const activeItem = makeInventoryEl("440_2_555");
  installGlobals({
    activeItem,
    storageData: { steamApiKey: "KEY123" },
    sendMessage: playerItemsSendMessage([{ id: 555, defindex: 18, quality: 6 }]),
    schemaFixture: SCHEMA_FIXTURE,
  });
  globalThis.document.querySelectorAll = (sel) => (sel === '[id^="inventory_"]' ? [marker] : []);

  assert.equal((await resolveRealItemName(container)).name, "Killstreak Rocket Launcher");
});

// "Some Hat" isn't Australium-eligible at all, so under the DOM-first design
// this resolves ENTIRELY from DOM now (renamedOriginalName alone) - the API
// mock below is never even consulted (needsAustraliumCheck stays false),
// which is itself a stronger guarantee than the original "checked the API
// and confirmed it declines to add the prefix" version of this test.
test("resolveRealItemName never adds 'Australium ' for a weapon not in the confirmed Australium set, even at style 1", async () => {
  const steamId64 = "76561198000000108";
  const { container } = buildContainerWithTitle("Some Hat", { renamedNoticeLine: "Some Hat" });
  const marker = makeInventoryEl(`inventory_${steamId64}_440_2`);
  const activeItem = makeInventoryEl("440_2_666");
  const fixture = { ...SCHEMA_FIXTURE, defindexToItemName: { ...SCHEMA_FIXTURE.defindexToItemName, 777: "Some Hat" } };
  installGlobals({
    activeItem,
    storageData: { steamApiKey: "KEY123" },
    sendMessage: playerItemsSendMessage([{ id: 666, defindex: 777, quality: 6, style: 1 }]),
    schemaFixture: fixture,
  });
  globalThis.document.querySelectorAll = (sel) => (sel === '[id^="inventory_"]' ? [marker] : []);

  assert.equal((await resolveRealItemName(container)).name, "Some Hat");
});

test("resolveRealItemName does not add 'Australium ' when the weapon IS in the set but style isn't the Australium index", async () => {
  const steamId64 = "76561198000000109";
  const { container } = buildContainerWithTitle("Minigun", { renamedNoticeLine: "Minigun" });
  const marker = makeInventoryEl(`inventory_${steamId64}_440_2`);
  const activeItem = makeInventoryEl("440_2_777");
  installGlobals({
    activeItem,
    storageData: { steamApiKey: "KEY123" },
    sendMessage: playerItemsSendMessage([{ id: 777, defindex: 202, quality: 6, style: 0 }]), // style 0, not 1
    schemaFixture: SCHEMA_FIXTURE,
  });
  globalThis.document.querySelectorAll = (sel) => (sel === '[id^="inventory_"]' ? [marker] : []);

  assert.equal((await resolveRealItemName(container)).name, "Minigun");
});

// --- showItemQuickLinks / insertQuickLinks (DOM orchestration) -------------

test("showItemQuickLinks does nothing when no item panel is currently rendered", async () => {
  installGlobals({});
  assert.doesNotThrow(() => showItemQuickLinks());
  await flush();
});

test("showItemQuickLinks clears any existing block and does nothing on a non-TF2 inventory tab", async () => {
  const { container } = buildContainerWithTitle("Some CS2 Item");
  const stale = new FakeElement("div");
  stale.classList.add("tf2te-market-links");
  container.appendChild(stale);
  installGlobals({ c0: container, hash: "#730" }); // CS2's app id, not TF2's 440

  showItemQuickLinks();
  await flush();

  assert.equal(container.querySelectorAll(".tf2te-market-links").length, 0);
});

test("showItemQuickLinks shows a loading notice immediately, then replaces it with the resolved links block", async () => {
  const { container, title } = buildContainerWithTitle("Rocket Launcher");
  installGlobals({ c0: container, hash: "#440" });

  showItemQuickLinks();
  // The loading notice is inserted synchronously, before insertQuickLinks'
  // own first await (resolveRealItemName) - it's the very next sibling of
  // title at this point.
  assert.equal(container.children[1]._classes.has("tf2te-market-links-loading"), true);

  await flush();

  assert.equal(container.querySelectorAll(".tf2te-market-links-loading").length, 0);
  assert.equal(container.querySelectorAll(".tf2te-market-links").length, 1);
});

test("showItemQuickLinks bails (clearing the loading notice) if the title is still changing when its settle-and-reread check fires, instead of building a link from a transitional read", async () => {
  const { container, title } = buildContainerWithTitle("Carbonado Botkiller Knife Mk.I");
  installGlobals({ c0: container, hash: "#440" });

  // Temporarily replace the module-wide instant-fire setTimeout mock with one
  // that mutates the title mid-render (simulating Steam's own fade-transition
  // leaving old+new text briefly concatenated) before resolving - exactly the
  // scenario the settle-and-reread check in insertQuickLinks exists to catch.
  const instantSetTimeout = global.setTimeout;
  global.setTimeout = (fn) => {
    title.children[0].textContent = "Carbonado Botkiller Knife Mk.IStrange Carbonado Botkiller Knife Mk.I";
    fn();
    return 0;
  };

  try {
    showItemQuickLinks();
    await flush();
  } finally {
    global.setTimeout = instantSetTimeout;
  }

  assert.equal(container.querySelectorAll(".tf2te-market-links-loading").length, 0);
  assert.equal(container.querySelectorAll(".tf2te-market-links").length, 0);
});

test("REGRESSION: an extra child element on the title (e.g. a stray span) does NOT bail the settle-and-reread check - a children.length===1 requirement was tried and reverted after it caused an infinite bail-and-retry loop live (see insertQuickLinks' own note)", async () => {
  const { container, title } = buildContainerWithTitle("Strange Carbonado Botkiller Knife Mk.I");
  installGlobals({ c0: container, hash: "#440" });

  const instantSetTimeout = global.setTimeout;
  global.setTimeout = (fn) => {
    const extraSpan = new FakeElement("span");
    extraSpan.textContent = "";
    title.appendChild(extraSpan);
    fn();
    return 0;
  };

  try {
    showItemQuickLinks();
    await flush();
  } finally {
    global.setTimeout = instantSetTimeout;
  }

  // The block still gets built - text alone (which is unaffected by the
  // empty extra span) is the only thing this check reacts to.
  assert.equal(container.querySelectorAll(".tf2te-market-links-loading").length, 0);
  assert.equal(container.querySelectorAll(".tf2te-market-links").length, 1);
});

test("REGRESSION: a hidden 'doHide' duplicate span alongside the visible title text does NOT double the item name in the built links - confirmed live shape is <h1><span class=\"doHide\">Name</span><a class=\"customName\">Name</a></h1> (a marketable item's own title), which plain textContent summed with no separator (e.g. 'Strasbourg ScholarStrasbourg Scholar')", async () => {
  const container = new FakeElement("div");
  const title = new FakeElement("h1");
  const hiddenSpan = new FakeElement("span");
  hiddenSpan.textContent = "Strasbourg Scholar";
  hiddenSpan.classList.add("doHide");
  const visibleLink = new FakeElement("a");
  visibleLink.textContent = "Strasbourg Scholar";
  title.appendChild(hiddenSpan);
  title.appendChild(visibleLink);
  container.appendChild(title);
  installGlobals({ c0: container, hash: "#440", storageData: {} });

  showItemQuickLinks();
  await flush();

  const block = container.querySelectorAll(".tf2te-market-links")[0];
  assert.ok(block);
  const classifiedsLink = block.querySelectorAll("a").find((a) => a.href && a.href.includes("next.backpack.tf/classifieds"));
  assert.ok(classifiedsLink);
  const url = new URL(classifiedsLink.href);
  assert.equal(url.searchParams.get("itemName"), "Strasbourg Scholar");
});

test("showItemQuickLinks adds per-item history icons (using the active tile's own asset id) to each site's row once the block resolves", async () => {
  const { container } = buildContainerWithTitle("Rocket Launcher");
  const activeItem = makeInventoryEl("440_2_17342991567");
  installGlobals({ c0: container, hash: "#440", storageData: {}, activeItem });

  showItemQuickLinks();
  await flush();

  const block = container.querySelectorAll(".tf2te-market-links")[0];
  assert.ok(block);

  const historyHrefs = block
    .querySelectorAll("a")
    .map((a) => a.href)
    .filter((href) => href && href.includes("/item/17342991567"));
  assert.deepEqual(historyHrefs.sort(), ["https://backpack.tf/item/17342991567", "https://next.backpack.tf/item/17342991567"]);
});

test("showItemQuickLinks adds no history icon at all when no tile is currently selected", async () => {
  const { container } = buildContainerWithTitle("Rocket Launcher");
  installGlobals({ c0: container, hash: "#440", storageData: {} }); // no activeItem

  showItemQuickLinks();
  await flush();

  const block = container.querySelectorAll(".tf2te-market-links")[0];
  assert.ok(block);
  // Matches a real per-item history href (.../item/{numeric assetId}), not
  // stntrading.eu's own /item/tf2/{name} item-page link - which also
  // contains the substring "/item/" but isn't a history icon at all.
  const links = block.querySelectorAll("a").filter((a) => a.href && /\/item\/\d+$/.test(a.href));
  assert.equal(links.length, 0);
});

// A Kit Fabricator's own item panel has no bare "Sheen: X"/"Killstreaker: X"
// leaf line - its finished Kit's fixed Sheen/Killstreaker instead shows up
// parenthesized in the OUTPUT section, e.g. "(Killstreaker: Fire Horns,
// Sheen: Mean Green)". findFabricatorOutputSheenAndKillstreaker reads that as
// a fallback, feeding mannco.store's own button the same way a real Kit's
// bare lines already did.
test("showItemQuickLinks reads a Fabricator's own OUTPUT line for Sheen/Killstreaker and includes them in the mannco.store link", async () => {
  const { container } = buildContainerWithTitle("Professional Killstreak Minigun Kit Fabricator", {
    outputSheenKillstreakerLine: "(Killstreaker: Fire Horns, Sheen: Mean Green)",
  });
  installGlobals({ c0: container, hash: "#440", storageData: {} });

  showItemQuickLinks();
  await flush();

  const block = container.querySelectorAll(".tf2te-market-links")[0];
  assert.ok(block);
  const mannStoreLink = block.querySelectorAll("a").find((a) => a.href && a.href.includes("mannco.store"));
  assert.ok(mannStoreLink);
  const url = new URL(mannStoreLink.href);
  assert.equal(url.searchParams.get("search"), "Professional Killstreak Minigun Kit Fabricator");
  assert.equal(url.searchParams.get("sheen"), "Mean Green");
  assert.equal(url.searchParams.get("killstreaker"), "Fire Horns");
});

test("showItemQuickLinks falls back to the on-page display title when resolveRealItemName can't resolve a real identity", async () => {
  // No Steam Web API key configured -> resolveRealItemName resolves to null
  // -> insertQuickLinks falls back to the raw display title.
  const { container } = buildContainerWithTitle("Rocket Launcher");
  installGlobals({ c0: container, hash: "#440", storageData: {} });

  showItemQuickLinks();
  await flush();

  const block = container.querySelectorAll(".tf2te-market-links")[0];
  assert.ok(block);
  // A generic item always resolves at least a backpack.tf stats link.
  const links = block.querySelectorAll("a");
  assert.ok(links.length > 0);
});

// REGRESSION for a live bug report: this used to look for a "Halloween
// Spell: X" label (scrap.tf/itemLinks/tooltipData.js's own tooltip shape) -
// Steam's inventory item panel actually renders "Halloween: {name} (spell
// only active during event)" instead, a completely different shape that
// never matched at all, so a spelled item's classifieds link always got
// spell=none regardless (see findSpellName's own note).
test("showItemQuickLinks threads a Halloween Spell line into the next.backpack.tf classifieds link's spell param", async () => {
  // No Steam Web API key configured -> resolveRealItemName resolves to null
  // -> insertQuickLinks falls back to the raw display title, same as the
  // test above - the spell line comes from findSpellName reading the item
  // panel directly, independent of that resolution path.
  const { container } = buildContainerWithTitle("Strange Rocket Launcher", {
    spellLine: "Halloween: Exorcism (spell only active during event)",
  });
  installGlobals({ c0: container, hash: "#440", storageData: {} });

  showItemQuickLinks();
  await flush();

  const block = container.querySelectorAll(".tf2te-market-links")[0];
  assert.ok(block);
  const classifiedsLink = block.querySelectorAll("a").find((a) => a.href && a.href.includes("next.backpack.tf/classifieds"));
  assert.ok(classifiedsLink);
  const url = new URL(classifiedsLink.href);
  assert.equal(url.searchParams.get("spell"), "weapon-SPELL: Halloween death ghosts");
});

// Confirmed live: a single weapon can carry MORE than one Halloween Spell
// line at once (e.g. Pumpkin Bombs + Exorcism on the same Grenade Launcher) -
// findSpellName only returns the first one found, same limitation every
// other known* option here already has for a single value, and the only one
// backpack.tf's/next.backpack.tf's own single-spell classifieds filter could
// use anyway.
test("showItemQuickLinks uses the FIRST Halloween Spell line when an item carries more than one", async () => {
  const { container } = buildContainerWithTitle("Strange Rocket Launcher", {
    spellLine: "Halloween: Pumpkin Bombs (spell only active during event)",
  });
  container.appendChild(makeLeafDiv("Halloween: Exorcism (spell only active during event)"));
  installGlobals({ c0: container, hash: "#440", storageData: {} });

  showItemQuickLinks();
  await flush();

  const block = container.querySelectorAll(".tf2te-market-links")[0];
  const classifiedsLink = block.querySelectorAll("a").find((a) => a.href && a.href.includes("next.backpack.tf/classifieds"));
  const url = new URL(classifiedsLink.href);
  assert.equal(url.searchParams.get("spell"), "weapon-SPELL: Halloween pumpkin explosions");
});

test("showItemQuickLinks sends spell=none on the next.backpack.tf classifieds link when the item has no Halloween Spell", async () => {
  const { container } = buildContainerWithTitle("Strange Rocket Launcher");
  installGlobals({ c0: container, hash: "#440", storageData: {} });

  showItemQuickLinks();
  await flush();

  const block = container.querySelectorAll(".tf2te-market-links")[0];
  assert.ok(block);
  const classifiedsLink = block.querySelectorAll("a").find((a) => a.href && a.href.includes("next.backpack.tf/classifieds"));
  assert.ok(classifiedsLink);
  const url = new URL(classifiedsLink.href);
  assert.equal(url.searchParams.get("spell"), "none");
});

test("showItemQuickLinks is idempotent for the same requestKey and self-heals if the block is later wiped", async () => {
  const { container } = buildContainerWithTitle("Rocket Launcher");
  installGlobals({ c0: container, hash: "#440", storageData: {} });

  showItemQuickLinks();
  await flush();
  assert.equal(container.querySelectorAll(".tf2te-market-links").length, 1);

  // Re-running for the exact same selection (same key, block still present)
  // must not insert a second copy.
  showItemQuickLinks();
  await flush();
  assert.equal(container.querySelectorAll(".tf2te-market-links").length, 1);

  // Simulate Steam's own re-render wiping the block out from under us.
  container.querySelectorAll(".tf2te-market-links").forEach((n) => n.remove());
  assert.equal(container.querySelectorAll(".tf2te-market-links").length, 0);

  showItemQuickLinks();
  await flush();
  assert.equal(container.querySelectorAll(".tf2te-market-links").length, 1);
});

// REGRESSION for a live bug report, WITH the actual page HTML this time: the
// Steam Market button showed for a non-marketable item on its FIRST
// selection, then correctly disappeared once the same item was reselected.
// The item's <h1> "customName" link (this feature's ORIGINAL isMarketable
// signal) turned out to be rendered UNCONDITIONALLY for every item,
// marketable or not (confirmed live via the exact HTML of a "( Not Tradable
// or Marketable )" Decorated Weapon, whose <h1> still had this exact link) -
// so that signal was never actually correct to begin with, not merely
// racy. isMarketable is now derived from the item panel's own hidden "Tags:"
// line instead (see resolveIsMarketable), which - like other late-arriving
// signals on this page - can still lag a render pass behind the rest of the
// panel: the very first insertQuickLinks run can catch it not rendered yet,
// falling back to the (wrong, for a non-marketable item) marketLinkName
// presence. Once Steam's DOM actually settles and the Tags line appears,
// this content script's own MutationObserver reruns insertQuickLinks (see
// steamcommunity.com/content.js's own router) - requestKey now includes the
// Tags text specifically so that later, CORRECT run isn't swallowed by the
// "already built for this key" short-circuit.
function makeTagsLine(tagsText) {
  return makeLeafDiv(`Tags:   ${tagsText}`);
}

test("REGRESSION: self-heals once the Tags line's own 'Not Marketable' arrives a render pass after the (always-present) market link - the Steam Market button disappears on the very next mutation, no reselect needed", async () => {
  const { container } = buildContainerWithTitle("Smissmas Sweater Flame Thrower");
  // The item's own <h1> "customName" link - present for every item, per the
  // live HTML, not just marketable ones (see findMarketListingLinkName's own
  // note) - but the Tags line hasn't rendered yet on this very first pass.
  container.appendChild(makeMarketLink("Smissmas Sweater Flame Thrower (Factory New)"));
  installGlobals({ c0: container, hash: "#440", storageData: {} });

  showItemQuickLinks();
  await flush();
  let block = container.querySelectorAll(".tf2te-market-links")[0];
  assert.ok(block);
  assert.ok(block.querySelectorAll("a").find((a) => a.textContent === "Steam Market"));

  // Steam's own Tags line finally renders: "Not Tradable, Not Marketable" -
  // nothing else about the item's own display changes at all.
  container.appendChild(makeTagsLine("Decorated Weapon, Primary weapon, Pyro, Factory New, Not Tradable, Not Marketable"));

  showItemQuickLinks();
  await flush();
  block = container.querySelectorAll(".tf2te-market-links")[0];
  assert.ok(block);
  assert.equal(block.querySelectorAll("a").find((a) => a.textContent === "Steam Market"), undefined);
});

// --- Steam Market button gating + non-marketable Decorated Weapon split ---

// The item panel's own <h1> "customName" link is rendered for EVERY item,
// marketable or not (its href is still shaped like a real Community Market
// listing URL even when there isn't one) - isMarketable can no longer be
// derived from that link's mere presence (resolveRealItemName's own
// ORIGINAL, wrong assumption). The item panel's own hidden "Tags:" line is
// the actual authoritative signal - it lists literal "Marketable"/"Not
// Marketable" tokens directly.
test("resolveRealItemName's isMarketable is false when the Tags line says 'Not Marketable', even with the (always-present) market link showing a real-shaped href", async () => {
  const { container } = buildContainerWithTitle("Smissmas Sweater Flame Thrower");
  container.appendChild(makeMarketLink("Smissmas Sweater Flame Thrower (Factory New)"));
  container.appendChild(makeTagsLine("Decorated Weapon, Primary weapon, Pyro, Factory New, Not Tradable, Not Marketable"));
  installGlobals({ storageData: {} });

  const { name, isMarketable } = await resolveRealItemName(container);
  // The market link is still the BEST name source (case 1) - only
  // isMarketable is affected by the Tags line, not name recovery itself.
  assert.equal(name, "Smissmas Sweater Flame Thrower (Factory New)");
  assert.equal(isMarketable, false);
});

test("resolveRealItemName's isMarketable is true when the Tags line says 'Marketable' (not preceded by 'Not')", async () => {
  const { container } = buildContainerWithTitle("Rocket Launcher");
  container.appendChild(makeMarketLink("Strange Rocket Launcher"));
  container.appendChild(makeTagsLine("Strange, Primary weapon, Soldier, Tradable, Marketable"));
  installGlobals({ storageData: {} });

  const { isMarketable } = await resolveRealItemName(container);
  assert.equal(isMarketable, true);
});

// A non-marketable (untradeable) item has no real Steam Community Market
// listing at all - this used to build and show a "Steam Market" button for
// one anyway (createSteamMarketLink was called unconditionally whenever
// classifiedsFilters resolved), linking out to a search for a listing that
// doesn't exist.
test("showItemQuickLinks does NOT show a Steam Market button for a non-marketable item (no 'View in Community Market' link on the page)", async () => {
  const { container } = buildContainerWithTitle("Rocket Launcher");
  installGlobals({ c0: container, hash: "#440", storageData: {} });

  showItemQuickLinks();
  await flush();

  const block = container.querySelectorAll(".tf2te-market-links")[0];
  assert.ok(block);
  const steamMarketLink = block.querySelectorAll("a").find((a) => a.textContent === "Steam Market");
  assert.equal(steamMarketLink, undefined);
});

test("showItemQuickLinks DOES show a Steam Market button for a marketable item (a real 'View in Community Market' link is present)", async () => {
  const { container } = buildContainerWithTitle("Rocket Launcher");
  container.appendChild(makeMarketLink("Rocket Launcher"));
  installGlobals({ c0: container, hash: "#440", storageData: {} });

  showItemQuickLinks();
  await flush();

  const block = container.querySelectorAll(".tf2te-market-links")[0];
  assert.ok(block);
  const steamMarketLink = block.querySelectorAll("a").find((a) => a.textContent === "Steam Market");
  assert.ok(steamMarketLink);
  assert.ok(steamMarketLink.href.startsWith("https://steamcommunity.com/market/listings/440/Rocket%20Launcher"));
});

// REGRESSION for the live bug report this whole feature was built for: a
// non-marketable, non-renamed Decorated Weapon's classifieds search used to
// come out as a single opaque "Smissmas Sweater Flame Thrower" item name
// with quality=6 (Unique/default) and no texture filter at all - the item's
// own on-page title (confirmed present via the Collection checkmark - see
// the resolveRealItemName tests above) now flows all the way through
// resolveStatsAndClassifieds into a properly split weapon name + Decorated
// Weapon quality id + texture id.
test("REGRESSION: a non-marketable, non-renamed Decorated Weapon's classifieds link splits skin from weapon (not the raw full name), same as a marketable one", async () => {
  const { container } = buildContainerWithTitle("Smissmas Sweater Flame Thrower");
  container.appendChild(makeCollectionCheckmarkLine("Smissmas Sweater War Paint"));
  const activeItem = makeInventoryEl("440_2_999", { borderColor: "rgb(250, 250, 250)" }); // Decorated Weapon (default)
  installGlobals({ c0: container, hash: "#440", activeItem, storageData: {} });
  __resetWarpaintsCacheForTests();
  globalThis.fetch = async () => ({ json: async () => [{ name: "Smissmas Sweater", defindex: 391 }] });

  try {
    showItemQuickLinks();
    await flush();

    const block = container.querySelectorAll(".tf2te-market-links")[0];
    assert.ok(block);
    const nextClassifiedsLink = block.querySelectorAll("a").find((a) => a.href?.startsWith("https://next.backpack.tf/classifieds"));
    assert.ok(nextClassifiedsLink);
    const params = new URL(nextClassifiedsLink.href).searchParams;
    assert.equal(params.get("itemName"), "Flame Thrower");
    assert.equal(params.get("quality"), "15"); // Decorated Weapon
    assert.equal(params.get("texture"), "391");
  } finally {
    // Reset again so this test's fixture doesn't leak a fake "Smissmas
    // Sweater" skin into any warpaints-dependent test that runs after it.
    __resetWarpaintsCacheForTests();
  }
});

// REGRESSION for a live bug report ("Smissmas Sweater Knife"): an earlier
// version of this same fix used the Collection checkmark's own text AS the
// reconstructed item name outright - the War Paint's own catalog name
// ("Smissmas Sweater War Paint"), never the weapon name - so this exact
// classifieds search came out searching "Smissmas Sweater War Paint" with no
// quality/texture filtering at all, losing "Knife" entirely. End-to-end
// proof (same shape as the Flame Thrower regression above, different
// weapon) that the fix holds generally, not just for one fixture string.
test("REGRESSION: a non-marketable, non-renamed 'Smissmas Sweater Knife' splits skin from weapon correctly too, not 'Smissmas Sweater War Paint'", async () => {
  const { container } = buildContainerWithTitle("Smissmas Sweater Knife");
  container.appendChild(makeCollectionCheckmarkLine("Smissmas Sweater War Paint"));
  installGlobals({ c0: container, hash: "#440", storageData: {} });
  __resetWarpaintsCacheForTests();
  globalThis.fetch = async () => ({ json: async () => [{ name: "Smissmas Sweater", defindex: 391 }] });

  try {
    showItemQuickLinks();
    await flush();

    const block = container.querySelectorAll(".tf2te-market-links")[0];
    assert.ok(block);
    const nextClassifiedsLink = block.querySelectorAll("a").find((a) => a.href?.startsWith("https://next.backpack.tf/classifieds"));
    assert.ok(nextClassifiedsLink);
    const params = new URL(nextClassifiedsLink.href).searchParams;
    assert.equal(params.get("itemName"), "Knife");
    assert.equal(params.get("quality"), "15"); // Decorated Weapon
    assert.equal(params.get("texture"), "391");
  } finally {
    __resetWarpaintsCacheForTests();
  }
});

// --- gladiator.tf / pricedb.io / mannco.store buttons ----------------------

test("showItemQuickLinks adds a gladiator.tf button linking to gladiator.tf/sales?item={itemName}", async () => {
  const { container } = buildContainerWithTitle("Rocket Launcher");
  installGlobals({ c0: container, hash: "#440", storageData: {} });

  showItemQuickLinks();
  await flush();

  const block = container.querySelectorAll(".tf2te-market-links")[0];
  assert.ok(block);
  const gladiatorLink = block.querySelectorAll("a").find((a) => a.href?.startsWith("https://gladiator.tf/sales"));
  assert.ok(gladiatorLink);
  assert.equal(new URL(gladiatorLink.href).searchParams.get("item"), "Rocket Launcher");
});

// gladiator.tf names an Unusual "{Effect} {Item}" like pricedb.io does;
// "Unusual {Item}" searched every effect at once (reported live: Stormy Storm
// Hound Dog linked gladiator.tf/sales?item=Unusual+Hound+Dog).
test("REGRESSION: an Unusual's gladiator.tf link searches '{Effect} {Item}', not 'Unusual {Item}'", async () => {
  const { container } = buildContainerWithTitle("Unusual Hound Dog", { effectLine: "Unusual Effect: Stormy Storm" });
  installGlobals({ c0: container, hash: "#440", storageData: {} });

  showItemQuickLinks();
  await flush();

  const block = container.querySelectorAll(".tf2te-market-links")[0];
  const gladiatorLink = block.querySelectorAll("a").find((a) => a.href?.startsWith("https://gladiator.tf/sales"));
  assert.equal(new URL(gladiatorLink.href).searchParams.get("item"), "Stormy Storm Hound Dog");
});

// New: stntrading.eu right before marketplace.tf - same relative placement every
// other port of this button already uses. Never omitted (unlike
// marketplace.tf/posts.tf/pricedb.io) - buildSteamMarketName always produces SOME
// reasonable link off the item name alone.
test("showItemQuickLinks adds an stntrading.eu button, right before marketplace.tf, always present", async () => {
  const { container } = buildContainerWithTitle("Rocket Launcher");
  installGlobals({ c0: container, hash: "#440", storageData: {} });

  showItemQuickLinks();
  await flush();

  const block = container.querySelectorAll(".tf2te-market-links")[0];
  assert.ok(block);
  const links = block.querySelectorAll("a");
  const stnLink = links.find((a) => a.textContent === "stntrading.eu");
  assert.ok(stnLink);
  assert.equal(stnLink.href, "https://stntrading.eu/item/tf2/Rocket+Launcher");

  const marketplaceIndex = links.findIndex((a) => a.textContent === "marketplace.tf");
  assert.equal(links.indexOf(stnLink), marketplaceIndex - 1);
});

test("showItemQuickLinks adds a pricedb.io button linking to the resolved sku's own item page", async () => {
  const { container } = buildContainerWithTitle("Rocket Launcher");
  installGlobals({ c0: container, hash: "#440", storageData: {}, sendMessage: mixedSendMessage({ pricedbSku: "18;6" }) });

  showItemQuickLinks();
  await flush();

  const block = container.querySelectorAll(".tf2te-market-links")[0];
  assert.ok(block);
  const pricedbLink = block.querySelectorAll("a").find((a) => a.href?.startsWith("https://pricedb.io/item/"));
  assert.ok(pricedbLink);
  assert.equal(pricedbLink.href, "https://pricedb.io/item/18%3B6");
});

// pricedb.io names an Unusual "{Effect} {Item}" (see
// utils/tf2StatsLinks/index.js's buildPricedbSearchName), and its exact-name
// match never finds "Unusual {Item}".
test("REGRESSION: an Unusual's pricedb.io search uses '{Effect} {Item}', not the 'Unusual {Item}' title", async () => {
  const { container } = buildContainerWithTitle("Unusual Team Captain", { effectLine: "Unusual Effect: Purple Energy" });
  const searched = [];
  const sendMessage = mixedSendMessage({ pricedbSku: "378;5;u10" });
  installGlobals({
    c0: container,
    hash: "#440",
    storageData: {},
    sendMessage: async (message) => {
      const url = String(message?.url || "");
      if (url.includes("pricedb.io")) searched.push(new URL(url).searchParams.get("q"));
      return sendMessage(message);
    },
  });

  showItemQuickLinks();
  await flush();

  assert.deepEqual(searched, ["Purple Energy Team Captain"]);
});

// Confirmed live: dropping "Strange" exact-matched the plain Unusual on
// pricedb.io (31216;5;u203), a different item at a different price.
test("REGRESSION: a Strange Unusual's pricedb.io search keeps 'Strange', so it never links the plain Unusual", async () => {
  const { container } = buildContainerWithTitle("Strange Unusual Hat Outta Hell", { effectLine: "Unusual Effect: Frightened Poltergeist" });
  const searched = [];
  const sendMessage = mixedSendMessage({ pricedbSku: "31216;5;u203" });
  installGlobals({
    c0: container,
    hash: "#440",
    storageData: {},
    sendMessage: async (message) => {
      const url = String(message?.url || "");
      if (url.includes("pricedb.io")) searched.push(new URL(url).searchParams.get("q"));
      return sendMessage(message);
    },
  });

  showItemQuickLinks();
  await flush();

  assert.deepEqual(searched, ["Strange Frightened Poltergeist Hat Outta Hell"]);
});

// REGRESSION for a live bug report: pricedb.io's own search used to be
// awaited alongside resolveStatsAndClassifieds via Promise.all, so EVERY
// button in the row waited on it too, even though it's the one part of this
// whole flow with an uncached network round trip on a fresh item (see
// utils/pricedb.js's own cache note) - seen as the whole row taking
// noticeably long to appear. Proves the two-phase split: the rest of the row
// renders as soon as resolveStatsAndClassifieds settles, and the pricedb.io
// button is spliced in separately, later, once its own search resolves.
test("REGRESSION: renders the rest of the row before pricedb.io resolves, then splices its own button in once it does - doesn't make every button wait on it", async () => {
  const { container } = buildContainerWithTitle("Rocket Launcher");
  let resolvePricedb;
  const pricedbGate = new Promise((resolve) => {
    resolvePricedb = resolve;
  });
  installGlobals({
    c0: container,
    hash: "#440",
    storageData: {},
    sendMessage: async (message) => {
      const url = String(message?.url || "");
      if (url.includes("GetPlayerItems")) return { ok: true, data: { result: { items: [] } } };
      if (url.includes("pricedb.io")) {
        await pricedbGate;
        return { ok: true, data: { success: true, data: { results: [{ sku: "18;6" }] } } };
      }
      return { ok: false, error: "unexpected message in test fixture" };
    },
  });

  showItemQuickLinks();
  await flush();

  // pricedb.io's own search is still stuck on pricedbGate - the rest of the
  // row is already there, with pricedb.io's slot in its loading state.
  let block = container.querySelectorAll(".tf2te-market-links")[0];
  assert.ok(block);
  assert.ok(block.querySelectorAll("a").find((a) => a.href?.startsWith("https://gladiator.tf/sales")));
  assert.equal(block.querySelectorAll("a").some((a) => a.href?.startsWith("https://pricedb.io/")), false);
  const loadingSlot = findPricedbLoadingSlot(block);
  assert.ok(loadingSlot, "expected pricedb.io's loading slot while its lookup runs");
  assert.equal(loadingSlot.getAttribute("aria-busy"), "true");

  resolvePricedb();
  await flush();

  block = container.querySelectorAll(".tf2te-market-links")[0];
  assert.ok(block);
  const pricedbLink = block.querySelectorAll("a").find((a) => a.href?.startsWith("https://pricedb.io/item/"));
  assert.ok(pricedbLink);
  assert.equal(pricedbLink.href, "https://pricedb.io/item/18%3B6");
  assert.equal(findPricedbLoadingSlot(block), undefined);
  // The rest of the row is untouched, not just the new button.
  assert.ok(block.querySelectorAll("a").find((a) => a.href?.startsWith("https://gladiator.tf/sales")));
});

test("showItemQuickLinks adds no pricedb.io button when the search finds no match", async () => {
  const { container } = buildContainerWithTitle("Rocket Launcher");
  installGlobals({ c0: container, hash: "#440", storageData: {}, sendMessage: mixedSendMessage({ pricedbSku: null }) });

  showItemQuickLinks();
  await flush();

  const block = container.querySelectorAll(".tf2te-market-links")[0];
  assert.ok(block);
  const pricedbLink = block.querySelectorAll("a").find((a) => a.href?.includes("pricedb.io"));
  assert.equal(pricedbLink, undefined);
  // The loading slot is removed, not left spinning.
  assert.equal(findPricedbLoadingSlot(block), undefined);
});

// A rate-limited lookup used to look IDENTICAL to "this item genuinely has no
// pricedb.io listing" here too - both just silently omitted the button.
// searchPricedbSkuStatus surfaces the real 429 (see utils/pricedb.js's own
// note) so this can show something instead, as a non-clickable placeholder
// (never a dead <a> with no href) in the same slot.
test("REGRESSION: a real 429 shows a 'pricedb.io Ns' countdown instead of silently omitting the button", async () => {
  mock.timers.enable({ apis: ["setInterval"] });
  try {
    const { container } = buildContainerWithTitle("Rocket Launcher");
    installGlobals({ c0: container, hash: "#440", storageData: {}, sendMessage: mixedSendMessage({ pricedbRateLimited: true, retryAfterMs: 7000 }) });

    showItemQuickLinks();
    await flush();

    const block = container.querySelectorAll(".tf2te-market-links")[0];
    assert.ok(block);
    assert.equal(block.querySelectorAll("a").some((a) => a.href?.includes("pricedb.io")), false);
    const countdown = findPricedbCountdown(block);
    assert.ok(countdown, "expected the countdown in pricedb.io's slot");
    assert.match(countdown.title, /in 7s/);
  } finally {
    mock.timers.reset();
  }
});

test("when the pricedb.io countdown ends, the block retries by itself and shows the real link", async () => {
  mock.timers.enable({ apis: ["setInterval"] });
  try {
    const { container } = buildContainerWithTitle("Rocket Launcher");
    const globals = installGlobals({ c0: container, hash: "#440", storageData: {}, sendMessage: mixedSendMessage({ pricedbRateLimited: true, retryAfterMs: 2000 }) });

    showItemQuickLinks();
    await flush();
    assert.ok(findPricedbCountdown(container.querySelectorAll(".tf2te-market-links")[0]));

    globalThis.chrome.runtime.sendMessage = mixedSendMessage({ pricedbSku: "18;6" });
    mock.timers.tick(2000);
    await flush();

    const block = container.querySelectorAll(".tf2te-market-links")[0];
    assert.ok(block.querySelectorAll("a").some((a) => a.href === "https://pricedb.io/item/18%3B6"));
    assert.equal(findPricedbCountdown(block), undefined);
    assert.equal(container.querySelectorAll(".tf2te-market-links").length, 1);
    void globals;
  } finally {
    mock.timers.reset();
  }
});

// Decodes a posts.tf search URL's own "q" param the same way
// utils/tf2StatsLinks/index.js's buildPostsTfLink encodes it - see
// tests/tf2StatsLinksIndex.test.js's own decodePostsTfQuery.
// The key-hint and countdown buttons (utils/linkButtonStates.js) set their
// label as text and then append an icon; this file's fake reads only the
// children's text once any exist, so the label is read off _textContent.
function findKeyHint(block, label) {
  return block.querySelectorAll("span").find((el) => el.dataset.tf2teNeedsKey === "1" && el._textContent === label);
}

function findPricedbLoadingSlot(block) {
  return block.querySelectorAll("span").find((el) => el._textContent === "pricedb.io" && el.dataset.tf2teLoading === "1");
}

function findPricedbCountdown(block) {
  return block.querySelectorAll("span").find((el) => el._textContent === "pricedb.io" && /Retrying automatically/.test(el.title || ""));
}

function decodePostsTfQuery(href) {
  const b64 = new URL(href).searchParams.get("q");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
}

test("showItemQuickLinks adds a posts.tf button right after pricedb.io, in the same row, searching by the resolved item's own defindex/quality/craftable", async () => {
  const { container } = buildContainerWithTitle("Rocket Launcher");
  installGlobals({
    c0: container,
    hash: "#440",
    storageData: {},
    sendMessage: mixedSendMessage({ pricedbSku: "18;6" }),
    // resolveRealItemName itself still fails here (no steamApiKey - same as
    // every other test in this file using bare storageData: {}), so itemName
    // falls back to the on-page title "Rocket Launcher" - getItemDefindex
    // only needs THAT name resolvable, independent of resolveRealItemName's
    // own success/failure.
    schemaFixture: {
      itemNameToDefindex: { "Rocket Launcher": 205 },
      defindexToItemName: {},
      effectNameToId: {},
      fetchedAt: Date.now(),
      schemaShapeVersion: 4,
    },
  });

  showItemQuickLinks();
  await flush();

  const block = container.querySelectorAll(".tf2te-market-links")[0];
  assert.ok(block);
  const buttons = block.querySelectorAll("a");
  const pricedbIndex = buttons.findIndex((a) => a.href?.startsWith("https://pricedb.io/"));
  const postsTfLink = buttons.find((a) => a.href?.startsWith("https://posts.tf/"));
  assert.ok(postsTfLink);
  assert.equal(buttons.indexOf(postsTfLink), pricedbIndex + 1); // right after pricedb.io
  const query = decodePostsTfQuery(postsTfLink.href);
  assert.deepEqual(query, { u: [{ defindex: 205, quality: 6, craftable: true }], p: [], d: "", m: false });
});

test("showItemQuickLinks adds no posts.tf button when the item's defindex can't be resolved (no schema cache/API key)", async () => {
  const { container } = buildContainerWithTitle("Rocket Launcher");
  installGlobals({ c0: container, hash: "#440", storageData: {}, sendMessage: mixedSendMessage({ pricedbSku: "18;6" }) });

  showItemQuickLinks();
  await flush();

  const block = container.querySelectorAll(".tf2te-market-links")[0];
  assert.ok(block);
  const postsTfLink = block.querySelectorAll("a").find((a) => a.href?.startsWith("https://posts.tf/"));
  assert.equal(postsTfLink, undefined);

  // Instead of the old warning box: posts.tf's own compact key hint in its
  // slot. A plain item's stats links are name-based (no key needed), so no
  // stats prompt either.
  assert.ok(findKeyHint(block, "posts.tf"), "expected posts.tf's key hint");
  assert.equal(findKeyHint(block, "Set Steam API key for stats/classifieds"), undefined);
  assert.equal(block.querySelectorAll("a").some((a) => a.textContent === "Get a Steam Web API key"), false, "the old warning box is gone");
});

test("with a key saved, a posts.tf link that still can't resolve gets no key hint (a key wouldn't help)", async () => {
  const { container } = buildContainerWithTitle("Rocket Launcher");
  installGlobals({ c0: container, hash: "#440", storageData: { steamApiKey: "KEY123" }, sendMessage: mixedSendMessage({ pricedbSku: "18;6" }) });

  showItemQuickLinks();
  await flush();

  const block = container.querySelectorAll(".tf2te-market-links")[0];
  assert.ok(block);
  assert.equal(findKeyHint(block, "posts.tf"), undefined);
  assert.equal(block.querySelectorAll("a").some((a) => a.href?.startsWith("https://posts.tf/")), false);
});

test("an Unusual whose effect id needs the key gets ONE compact stats/classifieds prompt (covering posts.tf too) where the stats rows would be", async () => {
  const { container } = buildContainerWithTitle("Unusual Team Captain", { effectLine: "Unusual Effect: Some Brand New Effect" });
  installGlobals({ c0: container, hash: "#440", storageData: {}, sendMessage: mixedSendMessage({ pricedbSku: "378;5;u13" }) });

  showItemQuickLinks();
  await flush();

  const block = container.querySelectorAll(".tf2te-market-links")[0];
  assert.ok(block);
  const statsPrompt = findKeyHint(block, "Set Steam API key for stats/classifieds");
  assert.ok(statsPrompt, "expected the stats/classifieds key prompt");
  assert.match(statsPrompt.title, /posts\.tf/);
  assert.equal(findKeyHint(block, "posts.tf"), undefined, "no second prompt for posts.tf");
  assert.equal(block.querySelectorAll("a").some((a) => a.href?.includes("backpack.tf/stats")), false);
});

// Companion to the test above - proves the warning is conditional, not
// always-on, using the exact same schema fixture the working posts.tf test
// further up this file already establishes.
test("showItemQuickLinks shows NO 'needs a Steam Web API key' warning once everything (including posts.tf) resolves normally", async () => {
  const { container } = buildContainerWithTitle("Rocket Launcher");
  installGlobals({
    c0: container,
    hash: "#440",
    storageData: {},
    sendMessage: mixedSendMessage({ pricedbSku: "18;6" }),
    schemaFixture: {
      itemNameToDefindex: { "Rocket Launcher": 205 },
      defindexToItemName: {},
      effectNameToId: {},
      fetchedAt: Date.now(),
      schemaShapeVersion: 4,
    },
  });

  showItemQuickLinks();
  await flush();

  const block = container.querySelectorAll(".tf2te-market-links")[0];
  assert.ok(block);
  assert.ok(block.querySelectorAll("a").find((a) => a.href?.startsWith("https://posts.tf/")), "expected posts.tf to resolve");
  const warningLink = block.querySelectorAll("a").find((a) => a.textContent === "Get a Steam Web API key");
  assert.equal(warningLink, undefined, "nothing is actually missing here - no warning expected");
});

// REGRESSION - showItemQuickLinks now listens for chrome.storage.onChanged
// and re-runs itself, reusing the exact same clear-and-rerun mechanism the
// Retry link's own click handler already uses (see showItemQuickLinks' own
// header note).
test("re-resolves posts.tf on its own once a Steam Web API key is saved - no page reload needed", async () => {
  const { container } = buildContainerWithTitle("Rocket Launcher");
  const { storage, fireStorageChange } = installGlobals({
    c0: container,
    hash: "#440",
    storageData: {},
    sendMessage: mixedSendMessage({ pricedbSku: "18;6" }),
  });

  showItemQuickLinks();
  await flush();

  let block = container.querySelectorAll(".tf2te-market-links")[0];
  assert.ok(findKeyHint(block, "posts.tf"));
  assert.equal(block.querySelectorAll("a").find((a) => a.href?.startsWith("https://posts.tf/")), undefined);

  // Simulate the popup's own Save: chrome.storage.local now has a real
  // schema cache, AND storage.onChanged fires - exactly what a successful
  // key save (which re-fetches/caches the schema) looks like.
  storage._store.tf2SchemaCache = {
    itemNameToDefindex: { "Rocket Launcher": 205 },
    defindexToItemName: {},
    effectNameToId: {},
    fetchedAt: Date.now(),
    schemaShapeVersion: 4,
  };
  fireStorageChange({ steamApiKey: "abc123" });
  await flush();

  block = container.querySelectorAll(".tf2te-market-links")[0];
  assert.ok(block, "expected a rebuilt block, not a wiped-out one");
  assert.equal(findKeyHint(block, "posts.tf"), undefined);
  assert.ok(block.querySelectorAll("a").find((a) => a.href?.startsWith("https://posts.tf/")), "expected posts.tf now that the schema resolved");
});

// Unticking "Filter links by Sheen & Killstreaker" in the popup applies to
// the item that's already open, not only to the next one selected.
test("switching the sheen/killstreaker filter off rebuilds the open item's links without them", async () => {
  const { container } = buildContainerWithTitle("Professional Killstreak Rocket Launcher", {
    sheenLine: "Sheen: Team Shine",
    killstreakerLine: "Killstreaker: Hypno-Beam",
  });
  const { storage, fireStorageChange } = installGlobals({ c0: container, hash: "#440", storageData: {} });
  const manncoHref = () =>
    container.querySelectorAll(".tf2te-market-links")[0].querySelectorAll("a").find((a) => a.href?.startsWith("https://mannco.store/"))?.href;

  showItemQuickLinks();
  await flush();
  assert.match(manncoHref(), /sheen=Team/);

  storage._store.sheenKillstreakerFilterEnabled = false;
  fireStorageChange({ sheenKillstreakerFilterEnabled: { oldValue: true, newValue: false } });
  await flush();

  assert.doesNotMatch(manncoHref(), /sheen=|killstreaker=/);
});

test("a change to an unrelated storage key doesn't trigger a re-resolve", async () => {
  const { container } = buildContainerWithTitle("Rocket Launcher");
  const { fireStorageChange } = installGlobals({ c0: container, hash: "#440", storageData: {} });

  showItemQuickLinks();
  await flush();
  const blockBefore = container.querySelectorAll(".tf2te-market-links")[0];

  fireStorageChange({ someUnrelatedSetting: true });
  await flush();

  // Same element instance - proof nothing was torn down and rebuilt.
  assert.equal(container.querySelectorAll(".tf2te-market-links")[0], blockBefore);
});

test("showItemQuickLinks adds a mannco.store button with the generic-item defaults (quality/festivized/killstreak/warpaints all set to their 'none' value) for a plain item", async () => {
  const { container } = buildContainerWithTitle("Rocket Launcher");
  installGlobals({ c0: container, hash: "#440", storageData: {} });

  showItemQuickLinks();
  await flush();

  const block = container.querySelectorAll(".tf2te-market-links")[0];
  assert.ok(block);
  const mannLink = block.querySelectorAll("a").find((a) => a.href?.startsWith("https://mannco.store/tf2"));
  assert.ok(mannLink);
  const params = new URL(mannLink.href).searchParams;
  assert.equal(params.get("search"), "Rocket Launcher");
  assert.equal(params.get("quality"), "Unique");
  assert.equal(params.get("festivized"), "No festivized");
  assert.equal(params.get("killstreak"), "No");
  assert.equal(params.get("warpaints"), "No WarPaints");
});

// REGRESSION for a live bug report: buildMannStoreHref used to return null
// for EVERY target-item tool (Strangifiers, Strangifier Chemistry Sets), so
// this button was silently missing from the whole row for them - confirmed
// live it's actually supported, just with a much simpler bare "search" param:
// https://mannco.store/tf2?search=Professor+Speks+Strangifier+Chemistry+Set
test("showItemQuickLinks adds a mannco.store button for a Strangifier Chemistry Set, searching '{target} Strangifier {itemName}' with no 'Series #n' suffix", async () => {
  const { container } = buildContainerWithTitle("Professor Speks Strangifier Chemistry Set Series #2");
  installGlobals({ c0: container, hash: "#440", storageData: {} });

  showItemQuickLinks();
  await flush();

  const block = container.querySelectorAll(".tf2te-market-links")[0];
  assert.ok(block);
  const mannLink = block.querySelectorAll("a").find((a) => a.href?.startsWith("https://mannco.store/tf2"));
  assert.ok(mannLink);
  const params = new URL(mannLink.href).searchParams;
  assert.equal(params.get("search"), "Professor Speks Strangifier Chemistry Set");
});

// REGRESSION for a live bug report ("The Spine-Chilling Skull 2011"): a
// PERMANENTLY non-craftable item (a Halloween/promotional cosmetic) never
// carries the usual "Non-Craftable " prefix in its own on-page title -
// Steam's own convention only adds that for an item someone crafted non-
// craftable themselves. Every craftability derivation in
// utils/tf2StatsLinks/index.js (stats link, classifieds link, Steam
// Market's own filter term) independently reads ONLY that name-text prefix,
// so this used to come out "Craftable" everywhere. Confirmed live the DOM
// carries a separate "( Not Usable in Crafting )" notice instead - fixed by
// prepending "Non-Craftable " onto itemName itself before it reaches any of
// those, so each one's own EXISTING prefix handling picks it up correctly.
test("REGRESSION: a permanently non-craftable item (no 'Non-Craftable ' name prefix, only a '( Not Usable in Crafting )' notice) gets Non-Craftable everywhere - stats, classifieds, and the Steam Market filter term", async () => {
  const { container } = buildContainerWithTitle("The Spine-Chilling Skull 2011");
  container.appendChild(makeMarketLink("The Spine-Chilling Skull 2011"));
  container.appendChild(makeLeafDiv("( Not Usable in Crafting )"));
  installGlobals({ c0: container, hash: "#440", storageData: {} });

  showItemQuickLinks();
  await flush();

  const block = container.querySelectorAll(".tf2te-market-links")[0];
  assert.ok(block);

  const nextStatsLink = block.querySelectorAll("a").find((a) => a.href?.startsWith("https://next.backpack.tf/stats/"));
  assert.ok(nextStatsLink);
  assert.ok(nextStatsLink.href.endsWith("/Non-Craftable"));

  const nextClassifiedsLink = block.querySelectorAll("a").find((a) => a.href?.startsWith("https://next.backpack.tf/classifieds"));
  assert.ok(nextClassifiedsLink);
  assert.equal(new URL(nextClassifiedsLink.href).searchParams.get("craftable"), "0");

  const steamMarketLink = block.querySelectorAll("a").find((a) => a.textContent === "Steam Market");
  assert.ok(steamMarketLink);
  const steamUrl = new URL(steamMarketLink.href);
  assert.equal(steamUrl.searchParams.get("q"), "Not Usable in Crafting");
  // The listing NAME itself stays the bare item name - Steam doesn't
  // distinguish craftable/non-craftable in the market_hash_name itself (see
  // buildSteamMarketName's own note), only in this "q=" filter term.
  assert.equal(decodeURIComponent(steamUrl.pathname.split("/").pop()), "The Spine-Chilling Skull 2011");
});

test("does NOT prepend 'Non-Craftable ' for an ordinary craftable item with no '( Not Usable in Crafting )' notice", async () => {
  const { container } = buildContainerWithTitle("Team Captain");
  installGlobals({ c0: container, hash: "#440", storageData: {} });

  showItemQuickLinks();
  await flush();

  const block = container.querySelectorAll(".tf2te-market-links")[0];
  assert.ok(block);
  const nextClassifiedsLink = block.querySelectorAll("a").find((a) => a.href?.startsWith("https://next.backpack.tf/classifieds"));
  assert.ok(nextClassifiedsLink);
  assert.equal(new URL(nextClassifiedsLink.href).searchParams.get("craftable"), "1");
});

test("showItemQuickLinks threads known Sheen/Killstreaker lines into the mannco.store link once the real item name resolves (its own reconstructed 'Professional Killstreak ' prefix is what the generic classifieds-filter parser actually keys the tier off - knownKillstreakTier only matters for a Decorated Weapon, see resolveKillstreakTier's own note)", async () => {
  const steamId64 = "76561198000000201";
  const assetId = "12345";
  const { container } = buildContainerWithTitle("Some Renamed Weapon", {
    sheenLine: "Sheen: Team Shine",
    killstreakerLine: "Killstreaker: Hypno-Beam",
    // "Rocket Launcher" (Australium-eligible) so the API path actually runs
    // and its own entry.quality=11 (Strange) drives the assertion below -
    // see resolveRealItemName's own header note on why a non-eligible name
    // would resolve from DOM alone and never reach the API at all.
    renamedNoticeLine: "Rocket Launcher",
  });
  const activeItem = makeInventoryEl(`440_2_${assetId}`);
  const marker = makeInventoryEl(`inventory_${steamId64}_440_2`);
  installGlobals({
    activeItem,
    c0: container,
    hash: "#440",
    storageData: { steamApiKey: "KEY123" },
    sendMessage: mixedSendMessage({ items: [{ id: Number(assetId), defindex: 18, quality: 11, style: 0 }] }),
    schemaFixture: SCHEMA_FIXTURE,
    inventoryEls: [marker],
  });

  showItemQuickLinks();
  await flush();

  const block = container.querySelectorAll(".tf2te-market-links")[0];
  const mannLink = block.querySelectorAll("a").find((a) => a.href?.startsWith("https://mannco.store/tf2"));
  assert.ok(mannLink);
  const params = new URL(mannLink.href).searchParams;
  assert.equal(params.get("search"), "Rocket Launcher");
  assert.equal(params.get("quality"), "Strange");
  assert.equal(params.get("killstreak"), "Professional Killstreak");
  assert.equal(params.get("sheen"), "Team Shine");
  assert.equal(params.get("killstreaker"), "Hypno-Beam");
});

// New feature: Sheen/Killstreaker filtering is user-toggleable via a General
// settings checkbox, default on. When off, the mannco.store button drops its
// sheen/killstreaker params entirely, while everything else
// (quality/killstreak tier) stays exactly as it was - same item/setup as the
// "threads known Sheen/Killstreaker lines" test just above, only with the
// setting turned off.
test("showItemQuickLinks omits sheen/killstreaker from the mannco.store link when the Sheen/Killstreaker filter setting is off, keeping killstreak tier intact", async () => {
  const steamId64 = "76561198000000201";
  const assetId = "12345";
  const { container } = buildContainerWithTitle("Some Renamed Weapon", {
    sheenLine: "Sheen: Team Shine",
    killstreakerLine: "Killstreaker: Hypno-Beam",
    renamedNoticeLine: "Rocket Launcher",
  });
  const activeItem = makeInventoryEl(`440_2_${assetId}`);
  const marker = makeInventoryEl(`inventory_${steamId64}_440_2`);
  installGlobals({
    activeItem,
    c0: container,
    hash: "#440",
    storageData: { steamApiKey: "KEY123", sheenKillstreakerFilterEnabled: false },
    sendMessage: mixedSendMessage({ items: [{ id: Number(assetId), defindex: 18, quality: 11, style: 0 }] }),
    schemaFixture: SCHEMA_FIXTURE,
    inventoryEls: [marker],
  });

  showItemQuickLinks();
  await flush();

  const block = container.querySelectorAll(".tf2te-market-links")[0];
  const mannLink = block.querySelectorAll("a").find((a) => a.href?.startsWith("https://mannco.store/tf2"));
  assert.ok(mannLink);
  const params = new URL(mannLink.href).searchParams;
  assert.equal(params.get("quality"), "Strange");
  assert.equal(params.get("killstreak"), "Professional Killstreak");
  assert.equal(params.get("sheen"), null);
  assert.equal(params.get("killstreaker"), null);
});

// REGRESSION for a live bug report: this used to look for a "Painted X" label
// (scrap.tf/itemLinks/tooltipData.js's own tooltip-data shape) - Steam's
// inventory item panel actually renders "Paint Color: {name}" instead, which
// never matched at all, so a Painted item's mannco.store link always got no
// paint param regardless (see findPaintName's own note).
test("showItemQuickLinks threads a Paint Color line into the mannco.store link's paint param for a plain cosmetic", async () => {
  const { container } = buildContainerWithTitle("Team Captain", { paintLine: "Paint Color: Australium Gold" });
  installGlobals({ c0: container, hash: "#440", storageData: {} });

  showItemQuickLinks();
  await flush();

  const block = container.querySelectorAll(".tf2te-market-links")[0];
  const mannLink = block.querySelectorAll("a").find((a) => a.href?.startsWith("https://mannco.store/tf2"));
  const params = new URL(mannLink.href).searchParams;
  assert.equal(params.get("paint"), "Australium Gold");
});

// REGRESSION for a live bug report: knownPaintName was already resolved
// (findPaintName) and already threaded into buildMannStoreHref (see the test
// above), but was never actually passed into resolveStatsAndClassifieds
// itself - the classic/next.backpack.tf classifieds paint filter never
// applied at all for a Painted item viewed on this page, independent of
// whether a Halloween Spell was also present. Confirmed live: a real Paint
// AND a "paint"-type Spell (e.g. "Spectral Spectrum") can both apply to the
// same item at once - neither should exclude the other (only Unusual does).
test("showItemQuickLinks applies BOTH a real Paint Color AND a Halloween Spell together on the same item's classifieds links", async () => {
  const { container } = buildContainerWithTitle("Strange Grenade Launcher", {
    paintLine: "Paint Color: Cream Spirit",
    spellLine: "Halloween: Spectral Spectrum (spell only active during event)",
  });
  installGlobals({ c0: container, hash: "#440", storageData: {} });

  showItemQuickLinks();
  await flush();

  const block = container.querySelectorAll(".tf2te-market-links")[0];
  const classifiedsLink = block.querySelectorAll("a").find((a) => a.href && a.href.includes("next.backpack.tf/classifieds"));
  const url = new URL(classifiedsLink.href);
  assert.equal(url.searchParams.get("paint"), "5065"); // Cream Spirit
  assert.equal(url.searchParams.get("spell"), "paint-3"); // Spectral Spectrum
});

// Confirmed live: an unnamed/rare paint can renders as "Paint Color: Color
// No. {r}-{g}-{b}" instead of a friendly name - this literal string is
// itself a real entry in utils/tf2StatsLinks/index.js's own PAINT_IDS table,
// so no separate "Color No." parsing is needed here at all.
test("showItemQuickLinks resolves an unnamed 'Color No. R-G-B' Paint Color line the same way as a friendly-named one", async () => {
  const { container } = buildContainerWithTitle("Team Captain", { paintLine: "Paint Color: Color No. 216-190-216" });
  installGlobals({ c0: container, hash: "#440", storageData: {} });

  showItemQuickLinks();
  await flush();

  const block = container.querySelectorAll(".tf2te-market-links")[0];
  const mannLink = block.querySelectorAll("a").find((a) => a.href?.startsWith("https://mannco.store/tf2"));
  const params = new URL(mannLink.href).searchParams;
  assert.equal(params.get("paint"), "Color No. 216-190-216");
});

// Regression: bp.tf/next.bp.tf's own stats/classifieds links need the exact
// numeric effect id, not just the name, to point at the SPECIFIC effect this
// item has - Steam's own item panel gives knownEffectName (the "★ Unusual
// Effect: X" line) but never a numeric id, so without a Steam Web API key
// those two should stay hidden (rather than showing a generic/wrong page)
// while mannco.store/marketplace.tf/pricedb.io - which stay useful off just
// the name - keep working. This used to assert the OLD behavior - a known
// effect NAME with no LIVE schema meant stats links got hidden behind an API
// key prompt, since nothing could resolve the name to its numeric particle
// id. Now that utils/tf2Schema.js's own getEffectId/getEffectNameToIdMap
// merge in utils/unusualEffectIds.js's own static table (see that file's own
// note), "Purple Energy" (a real, common effect already in that table)
// resolves with NO Steam Web API key needed at all - stats links now work
// too, not just mannco.store. The combined API key prompt can still appear
// for a DIFFERENT reason (posts.tf's own item-name->defindex lookup is
// unrelated to effect ids and still genuinely needs a live schema) - this
// test only asserts what the fix actually changed: stats links themselves
// now resolve, not that the whole card is key-prompt-free.
test("resolves a known effect NAME to its id via the static table, with no Steam Web API key configured at all - stats links work", async () => {
  const { container } = buildContainerWithTitle("Unusual Team Captain", { effectLine: "Unusual Effect: Purple Energy" });
  installGlobals({ c0: container, hash: "#440", storageData: {} }); // no schema/key at all

  showItemQuickLinks();
  await flush();

  const block = container.querySelectorAll(".tf2te-market-links")[0];
  assert.ok(block);
  const links = block.querySelectorAll("a");

  const bpStatsLink = links.find((a) => a.href?.startsWith("https://backpack.tf/stats/"));
  const nextBpStatsLink = links.find((a) => a.href?.startsWith("https://next.backpack.tf/stats"));
  assert.ok(bpStatsLink, "expected backpack.tf stats to resolve via the static effect-id table");
  assert.ok(nextBpStatsLink, "expected next.backpack.tf stats to resolve via the static effect-id table");
  // Trailing path segment is the effect's own numeric particle id (10 for
  // Purple Energy in utils/unusualEffectIds.js) - confirms the STATIC
  // table's id specifically, not a live schema value.
  assert.ok(bpStatsLink.href.endsWith("/10"));
  assert.ok(nextBpStatsLink.href.endsWith("/10"));

  const mannLink = links.find((a) => a.href?.startsWith("https://mannco.store/tf2"));
  assert.ok(mannLink);
  assert.equal(new URL(mannLink.href).searchParams.get("effect"), "Purple Energy");
});

test("REGRESSION: showItemQuickLinks never applies the Paint filter to an Unusual item's mannco.store link", async () => {
  const { container } = buildContainerWithTitle("Unusual Team Captain", {
    effectLine: "Unusual Effect: Purple Energy",
    paintLine: "Paint Color: Australium Gold",
  });
  const effectSchemaFixture = { ...SCHEMA_FIXTURE, effectNameToId: { "Purple Energy": 13 } };
  installGlobals({ c0: container, hash: "#440", storageData: { steamApiKey: "KEY123" }, schemaFixture: effectSchemaFixture });

  showItemQuickLinks();
  await flush();

  const block = container.querySelectorAll(".tf2te-market-links")[0];
  const mannLink = block.querySelectorAll("a").find((a) => a.href?.startsWith("https://mannco.store/tf2"));
  assert.ok(mannLink);
  const params = new URL(mannLink.href).searchParams;
  assert.equal(params.get("quality"), "Unusual");
  assert.equal(params.get("effect"), "Purple Energy");
  assert.equal(params.get("paint"), null);
});

test("showItemQuickLinks clears the loading notice (doesn't leave it stuck) when resolveStatsAndClassifieds throws", async () => {
  const { container } = buildContainerWithTitle("Rocket Launcher");
  installGlobals({ c0: container, hash: "#440", storageData: { steamApiKey: "KEY123" } });
  // Force resolveRealItemName's own getPlayerItemsById call to throw - a
  // genuinely unexpected failure, not a "no key configured" no-op.
  globalThis.chrome.runtime.sendMessage = async () => {
    throw new Error("network down");
  };
  const originalWarn = console.warn;
  console.warn = () => {};

  try {
    showItemQuickLinks();
    await flush();
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(container.querySelectorAll(".tf2te-market-links-loading").length, 0);
});

// Removing the loading notice in the error path is itself a DOM mutation, and
// steamcommunity.com/content.js's own subtree observer then calls this again
// for the same item - without a guard, a persistent failure retried (and
// re-sent every request) on every one of those calls, forever.
test("REGRESSION: a persistently failing build is attempted once per selection, not retried on every later observer call", async () => {
  const { container } = buildContainerWithTitle("Rocket Launcher");
  installGlobals({ c0: container, hash: "#440", storageData: { steamApiKey: "KEY123" } });
  globalThis.chrome.storage.local.get = async () => {
    throw new Error("storage unavailable");
  };
  const warnCalls = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnCalls.push(args);

  try {
    showItemQuickLinks();
    await flush();
    showItemQuickLinks();
    await flush();
    showItemQuickLinks();
    await flush();
  } finally {
    console.warn = originalWarn;
  }

  const failures = warnCalls.filter((args) => String(args[0]).includes("failed to resolve links"));
  assert.equal(failures.length, 1);
  assert.equal(container.querySelectorAll(".tf2te-market-links-loading").length, 0);
});

// --- unresolved warning + Retry (live bug report) --------------------------

// REGRESSION for a live bug report: the warning used to show for ANY item
// whenever GetPlayerItems failed, even a perfectly ordinary NON-renamed one.
// For a non-renamed item the on-page title is already correct, so a failed
// lookup is a complete non-issue - see resolveRealItemName's own note on why
// isRenamed gates this.
test("does NOT show a warning for a NON-renamed item, even when GetPlayerItems fails outright - buttons build normally from the on-page title", async () => {
  const steamId64 = "76561198000000201";
  const { container } = buildContainerWithTitle("Unusual Cotton Head"); // no renamedNoticeLine - not renamed
  const marker = makeInventoryEl(`inventory_${steamId64}_440_2`);
  const activeItem = makeInventoryEl("440_2_12345");
  const originalWarn = console.warn;
  console.warn = () => {};

  try {
    installGlobals({
      c0: container,
      hash: "#440",
      activeItem,
      inventoryEls: [marker],
      storageData: { steamApiKey: "KEY123" },
      sendMessage: async () => ({ ok: false, status: 503, error: "Request failed (503)" }),
    });

    showItemQuickLinks();
    await flush();

    const block = container.querySelectorAll(".tf2te-market-links")[0];
    assert.ok(block);
    const warningText = block.querySelectorAll("div").map((d) => d.textContent).join(" ");
    assert.doesNotMatch(warningText, /renamed|couldn't be verified/i);
    const gladiatorLink = block.querySelectorAll("a").find((a) => a.href?.startsWith("https://gladiator.tf/sales"));
    assert.equal(new URL(gladiatorLink.href).searchParams.get("item"), "Unusual Cotton Head");
  } finally {
    console.warn = originalWarn;
  }
});

// REGRESSION for a live bug report: a transient GetPlayerItems 503 used to
// fail resolveRealItemName instantly with no visible indication at all - the
// quick-link buttons still appeared, fully clickable, silently built from
// the item's RENAMED title. Now, for a CONFIRMED-renamed item (see
// renamedNoticeLine: true below) whose real identity can't be recovered from
// EITHER the Web API or Steam's own notice, NO buttons show at all - just
// the warning + manual Retry.
test("shows a Retry warning with NO buttons at all for a renamed item when a key IS configured but neither the API nor Steam's own notice can resolve it", async () => {
  const steamId64 = "76561198000000202";
  const { container } = buildContainerWithTitle("Renamed Item", { renamedNoticeLine: true });
  const marker = makeInventoryEl(`inventory_${steamId64}_440_2`);
  const activeItem = makeInventoryEl("440_2_12345");
  installGlobals({
    c0: container,
    hash: "#440",
    activeItem,
    inventoryEls: [marker],
    storageData: { steamApiKey: "KEY123" },
    sendMessage: mixedSendMessage({ items: [] }), // GetPlayerItems succeeds but has no entry for 12345
  });

  showItemQuickLinks();
  await flush();

  const block = container.querySelectorAll(".tf2te-market-links")[0];
  assert.ok(block);
  const warningText = block.querySelectorAll("div").map((d) => d.textContent).join(" ");
  assert.match(warningText, /its real identity couldn't be verified/);
  const retryLink = block.querySelectorAll("a").find((a) => a.textContent === "Retry");
  assert.ok(retryLink);
  // No quick-link buttons at all - not even a partial/best-guess set.
  assert.equal(block.querySelectorAll("a").some((a) => a.href?.startsWith("https://gladiator.tf")), false);
});

test("a renamed item with no key gets a one-sentence explanation plus the 'Add Steam Web API key' button (no Retry, no links)", async () => {
  const { container } = buildContainerWithTitle("Renamed Item", { renamedNoticeLine: true });
  installGlobals({ c0: container, hash: "#440", storageData: {} }); // no key, no activeItem/inventoryEls either

  showItemQuickLinks();
  await flush();

  const block = container.querySelectorAll(".tf2te-market-links")[0];
  assert.ok(block);
  const warningText = block.querySelectorAll("div").map((d) => d._textContent).join(" ");
  assert.match(warningText, /needs a Steam Web API key, so no links are shown yet/);
  assert.equal(block.querySelectorAll("a").some((a) => a.textContent === "Retry"), false);
  assert.ok(findKeyHint(block, "Add Steam Web API key"), "expected the key button");
  assert.equal(block.querySelectorAll("a").some((a) => a.textContent === "Get a Steam Web API key"), false);
  assert.equal(block.querySelectorAll("a").some((a) => a.href?.startsWith("https://gladiator.tf")), false);
});

// The new second-tier fallback (point C of the live bug report): Steam's own
// "This item has been renamed. Original name: X" notice recovers the real
// BASE name with no Web API call needed at all - strictly better than the
// item's fake renamed text, even without Quality/Australium (which that
// notice can't convey - see resolveRealItemName's own header note). Buttons
// DO show here, built from the recovered name, with no warning at all.
test("recovers a usable name from Steam's own renamed-item notice when GetPlayerItems fails outright, and shows buttons normally (no warning)", async () => {
  const steamId64 = "76561198000000203";
  const { container } = buildContainerWithTitle("Killing Is My Business...", {
    renamedNoticeLine: "Minigun",
    sheenLine: "Sheen: Team Shine",
  });
  const marker = makeInventoryEl(`inventory_${steamId64}_440_2`);
  const activeItem = makeInventoryEl("440_2_777");
  const originalWarn = console.warn;
  console.warn = () => {};

  try {
    installGlobals({
      c0: container,
      hash: "#440",
      activeItem,
      inventoryEls: [marker],
      storageData: { steamApiKey: "KEY123" },
      sendMessage: async () => ({ ok: false, status: 503, error: "Request failed (503)" }),
    });

    showItemQuickLinks();
    await flush();

    const block = container.querySelectorAll(".tf2te-market-links")[0];
    assert.ok(block);
    const warningText = block.querySelectorAll("div").map((d) => d.textContent).join(" ");
    assert.doesNotMatch(warningText, /renamed|couldn't be verified/i);
    // Killstreak tier IS recoverable here (a pure DOM signal, no API needed)
    // even though Quality/Australium aren't.
    const gladiatorLink = block.querySelectorAll("a").find((a) => a.href?.startsWith("https://gladiator.tf/sales"));
    assert.equal(new URL(gladiatorLink.href).searchParams.get("item"), "Specialized Killstreak Minigun");
  } finally {
    console.warn = originalWarn;
  }
});

// DOM-first Quality recovery (the direct follow-up to the live bug report):
// the active grid tile's own inline border-color, confirmed live against
// several real Steam inventory tiles - NOT the same colors
// utils/tf2Quality.js's own QUALITY_COLOR_BY_NAME uses (that's backpack.tf's
// own site color, confirmed live to disagree for Unusual specifically).
// "Some Hat" is deliberately NOT Australium-eligible, so this resolves
// ENTIRELY from DOM - no API call at all, not even attempted (the test's own
// sendMessage always throws, proving it's never called).
// The throwing sendMessage mock is scoped to GetPlayerItems specifically -
// posts.tf's own separate schema lookup (utils/tf2StatsLinks/index.js's own
// buildPostsTfLink, unrelated to name resolution) still legitimately needs
// its own cold schema fetch here (no tf2SchemaCache in storageData), so
// letting THAT one fail benignly (an ordinary ok:false, not a thrown
// exception) keeps this test scoped to what it's actually verifying: that
// resolveRealItemName itself never touches GetPlayerItems for a non-
// Australium-eligible renamed item.
function throwOnGetPlayerItems(message) {
  if (String(message?.url || "").includes("GetPlayerItems")) {
    throw new Error("should not need GetPlayerItems for a non-Australium-eligible renamed item");
  }
  return { ok: false, error: "not needed for this test" };
}

test("recovers Quality from the active tile's own border-color (Strange) with zero GetPlayerItems calls, for a renamed non-Australium-eligible item", async () => {
  const steamId64 = "76561198000000205";
  const { container } = buildContainerWithTitle("Some Renamed Hat", { renamedNoticeLine: "Some Hat" });
  const marker = makeInventoryEl(`inventory_${steamId64}_440_2`);
  const activeItem = makeInventoryEl("440_2_888", { borderColor: "rgb(207, 106, 50)" }); // Strange
  installGlobals({
    c0: container,
    hash: "#440",
    activeItem,
    inventoryEls: [marker],
    storageData: { steamApiKey: "KEY123" },
    sendMessage: async (message) => throwOnGetPlayerItems(message),
  });

  showItemQuickLinks();
  await flush();

  const block = container.querySelectorAll(".tf2te-market-links")[0];
  assert.ok(block);
  const gladiatorLink = block.querySelectorAll("a").find((a) => a.href?.startsWith("https://gladiator.tf/sales"));
  assert.equal(new URL(gladiatorLink.href).searchParams.get("item"), "Strange Some Hat");
});

test("recovers Quality from the active tile's own border-color (Unusual) the same way", async () => {
  const steamId64 = "76561198000000206";
  const { container } = buildContainerWithTitle("Some Renamed Hat", { renamedNoticeLine: "Some Hat" });
  const marker = makeInventoryEl(`inventory_${steamId64}_440_2`);
  const activeItem = makeInventoryEl("440_2_889", { borderColor: "rgb(134, 80, 172)" }); // Unusual
  installGlobals({
    c0: container,
    hash: "#440",
    activeItem,
    inventoryEls: [marker],
    storageData: { steamApiKey: "KEY123" },
    sendMessage: async (message) => throwOnGetPlayerItems(message),
  });

  showItemQuickLinks();
  await flush();

  const block = container.querySelectorAll(".tf2te-market-links")[0];
  const gladiatorLink = block.querySelectorAll("a").find((a) => a.href?.startsWith("https://gladiator.tf/sales"));
  assert.equal(new URL(gladiatorLink.href).searchParams.get("item"), "Unusual Some Hat");
});

test("treats an unrecognized border-color as Unique (no quality prefix)", async () => {
  const steamId64 = "76561198000000207";
  const { container } = buildContainerWithTitle("Some Renamed Hat", { renamedNoticeLine: "Some Hat" });
  const marker = makeInventoryEl(`inventory_${steamId64}_440_2`);
  const activeItem = makeInventoryEl("440_2_890", { borderColor: "rgb(1, 2, 3)" }); // not a known quality color
  installGlobals({
    c0: container,
    hash: "#440",
    activeItem,
    inventoryEls: [marker],
    storageData: { steamApiKey: "KEY123" },
    sendMessage: async (message) => throwOnGetPlayerItems(message),
  });

  showItemQuickLinks();
  await flush();

  const block = container.querySelectorAll(".tf2te-market-links")[0];
  const gladiatorLink = block.querySelectorAll("a").find((a) => a.href?.startsWith("https://gladiator.tf/sales"));
  assert.equal(new URL(gladiatorLink.href).searchParams.get("item"), "Some Hat");
});

// Simulates the ACTUAL reported bug (a transient GetPlayerItems 503), not an
// "asset not found" case - getPlayerItemsById's own per-page-load dedupe
// memoizes a SUCCESSFUL fetch indefinitely (even one that just doesn't have
// this particular asset), so that scenario could never self-heal via a
// plain retry within the same page load anyway. A genuine fetch FAILURE
// deliberately isn't memoized (see that file's own note), so it's the one
// case where clicking Retry can actually recover something. renamedNoticeLine
// is deliberately `true` (unparseable) rather than a real name, so this
// exercises the Retry path (case 3) rather than the DOM-fallback path
// (case 2, covered by the test above).
test("clicking Retry clears the cached resolution state and re-runs resolution, succeeding once a transient GetPlayerItems failure clears up", async () => {
  const steamId64 = "76561198000000204";
  const { container } = buildContainerWithTitle("Renamed Item", { renamedNoticeLine: true });
  const marker = makeInventoryEl(`inventory_${steamId64}_440_2`);
  const activeItem = makeInventoryEl("440_2_54321");
  let shouldFail = true; // first attempt: GetPlayerItems fails outright (matches the live 503 report)
  installGlobals({
    c0: container,
    hash: "#440",
    activeItem,
    inventoryEls: [marker],
    storageData: { steamApiKey: "KEY123" },
    schemaFixture: SCHEMA_FIXTURE, // defindex 18 -> "Rocket Launcher", needed once the item resolves below
    sendMessage: async (message) => {
      const url = String(message?.url || "");
      if (url.includes("GetPlayerItems")) {
        if (shouldFail) return { ok: false, status: 503, error: "Request failed (503)" };
        return { ok: true, data: { result: { items: [{ id: 54321, defindex: 18, quality: 6 }] } } };
      }
      if (url.includes("pricedb.io")) return { ok: true, data: { success: true, data: { results: [] } } };
      return { ok: false, error: "unexpected message in test fixture" };
    },
  });
  const originalWarn = console.warn;
  console.warn = () => {};

  try {
    showItemQuickLinks();
    await flush();

    let block = container.querySelectorAll(".tf2te-market-links")[0];
    let retryLink = block.querySelectorAll("a").find((a) => a.textContent === "Retry");
    assert.ok(retryLink, "expected the initial (failed) resolution to show a Retry link");

    // The underlying API recovers - clicking Retry should re-attempt
    // resolution rather than staying stuck on the earlier failure forever.
    shouldFail = false;
    await retryLink.dispatchEvent({ type: "click", preventDefault: () => {} });
    await flush();

    block = container.querySelectorAll(".tf2te-market-links")[0];
    assert.ok(block);
    retryLink = block.querySelectorAll("a").find((a) => a.textContent === "Retry");
    assert.equal(retryLink, undefined, "expected the warning/Retry link to be gone once resolution succeeds");

    const gladiatorLink = block.querySelectorAll("a").find((a) => a.href?.startsWith("https://gladiator.tf/sales"));
    assert.equal(new URL(gladiatorLink.href).searchParams.get("item"), "Rocket Launcher");
  } finally {
    console.warn = originalWarn;
  }
});

// findLoggedInSteamId64 - the LOGGED-IN VISITOR's own id, a different value
// from findSteamId64 (the profile/inventory being VIEWED) whenever they
// differ - e.g. browsing a friend's inventory while logged in as yourself.
// Used by fabricatorMultiBuy/content.js to gate its own "Buy Parts" button
// to the visitor's own inventory only (see that file's own tests).

test("findLoggedInSteamId64 reads the visitor's own id off an inline script's g_steamID assignment", () => {
  const script = new FakeElement("script");
  script.textContent = 'g_steamID = "76561198000000000";';
  globalThis.document.querySelectorAll = (sel) => (sel === "script" ? [script] : []);

  assert.equal(findLoggedInSteamId64(), "76561198000000000");
});

test("findLoggedInSteamId64 returns null when logged out (g_steamID = false) or no matching script exists", () => {
  const loggedOutScript = new FakeElement("script");
  loggedOutScript.textContent = "g_steamID = false;";
  globalThis.document.querySelectorAll = (sel) => (sel === "script" ? [loggedOutScript] : []);
  assert.equal(findLoggedInSteamId64(), null);

  globalThis.document.querySelectorAll = () => [];
  assert.equal(findLoggedInSteamId64(), null);
});

// --- the selected item's Unusual effect, behind its large panel image ---

// Steam's current item panel (confirmed live): the large picture is an
// id-less <img> from /economy/image/ inside a div with generated class names,
// and the panel also holds a 32x32 game icon from /community_assets/.
function buildPanelWithIcon() {
  const container = new FakeElement("div");
  container.id = "iteminfo0";
  const gameIcon = new FakeElement("img");
  gameIcon.src = "https://shared.fastly.steamstatic.com/community_assets/images/apps/440/f56891287.jpg";
  container.appendChild(gameIcon);
  const box = new FakeElement("div");
  const icon = new FakeElement("img");
  icon.src = "https://community.fastly.steamstatic.com/economy/image/IzMF03bi9WpSBq-S-ekoE33L-/192fx192f";
  box.appendChild(icon);
  container.appendChild(box);
  global.document = { ...(global.document || {}), createElement: (tag) => new FakeElement(tag) };
  return { container, box, icon };
}

// Effect images load instantly here (see shared/itemEffectBackground.js and
// its own tests for the bundled/hosted choice and the fallback).
function installInstantImage() {
  globalThis.Image = class {
    set src(_url) {
      queueMicrotask(() => this.onload?.());
    }
  };
}

test("shows the selected Unusual's effect as its large image's own background (not the game icon's)", async () => {
  installInstantImage();
  const { container, icon } = buildPanelWithIcon();
  const gameIcon = container.children[0];

  await showSelectedItemEffect(container, "Kill-a-Watt");

  // The 192px picture gets our host's 188px effect image.
  assert.equal(icon.style.backgroundImage, `url("${PARTICLE_HOST_URL}/188/${UNUSUAL_EFFECT_IDS["Kill-a-Watt"]}.png")`);
  assert.equal(icon.style.backgroundSize, "contain");
  assert.equal(gameIcon.style.backgroundImage, undefined);
});

test("swaps the effect for the next selected Unusual, and clears it for an item without one", async () => {
  installInstantImage();
  const { container, icon } = buildPanelWithIcon();

  await showSelectedItemEffect(container, "Kill-a-Watt");
  await showSelectedItemEffect(container, "burning flames"); // case-insensitive
  assert.equal(icon.style.backgroundImage, `url("${PARTICLE_HOST_URL}/188/${UNUSUAL_EFFECT_IDS["Burning Flames"]}.png")`);

  await showSelectedItemEffect(container, null);
  assert.equal(icon.style.backgroundImage, "");

  await showSelectedItemEffect(container, "Not A Real Effect");
  assert.equal(icon.style.backgroundImage, "");
});

test("leaves an already-set effect alone (runs on every page mutation)", async () => {
  installInstantImage();
  const { container, icon } = buildPanelWithIcon();

  await showSelectedItemEffect(container, "Kill-a-Watt");
  icon.style.backgroundImage = "sentinel"; // would be overwritten by a second write
  await showSelectedItemEffect(container, "Kill-a-Watt");

  assert.equal(icon.style.backgroundImage, "sentinel");
});

// --- Non-English Steam page (English stand-in panel) ----------------------
//
// Confirmed live (Steam in Hungarian): every attribute line is translated,
// values included, so nothing can be read off the page's own panel. The
// item's English description is fetched (Steam's item-hover endpoint) and the
// buttons are held until it arrives.

function englishHoverHtml(description) {
  return `<div class="clienthoverpage_content"></div><script>BuildHover( 'economy_item_1',  ${JSON.stringify(description)} );</script>`;
}

function installHungarianPage({ container, assetId, classid, hoverResponse }) {
  const activeItem = makeInventoryEl(`440_2_${assetId}`);
  const searched = [];
  const sendMessage = mixedSendMessage({ pricedbSku: "378;5;u13" });
  installGlobals({
    c0: container,
    hash: "#440",
    activeItem,
    sendMessage: async (message) => {
      const url = String(message?.url || "");
      if (url.includes("pricedb.io")) searched.push(new URL(url).searchParams.get("q"));
      return sendMessage(message);
    },
  });
  globalThis.document.documentElement = { lang: "hu" };
  globalThis.window.wrappedJSObject = {
    g_rgAppContextData: { 440: { rgContexts: { 2: { inventory: { m_rgAssets: { [assetId]: { description: { classid, instanceid: "0" } } } } } } } },
  };
  const hoverUrls = [];
  globalThis.fetch = async (url) => {
    if (String(url).includes("itemclasshover")) {
      hoverUrls.push(url);
      return hoverResponse;
    }
    return { json: async () => [] }; // warpaints - unused here
  };
  return { searched, hoverUrls };
}

test("on a non-English page, links are built from the item's English description, not the translated panel text", async () => {
  const { container } = buildContainerWithTitle("Szokatlan Csapatkapitány", { effectLine: "★ Szokatlan hatás: Égő lángok" });
  const { searched, hoverUrls } = installHungarianPage({
    container,
    assetId: "777",
    classid: "9001",
    hoverResponse: {
      ok: true,
      text: async () =>
        englishHoverHtml({
          appid: "440",
          name: "Unusual Team Captain",
          market_hash_name: "Unusual Team Captain",
          tradable: 1,
          marketable: 1,
          descriptions: [{ value: "★ Unusual Effect: Burning Flames", color: "ffd700" }],
          tags: [{ name: "Unusual" }],
        }),
    },
  });

  showItemQuickLinks();

  // Held: only the loading notice until the English description arrives -
  // never a button built from the translated text.
  assert.equal(container.querySelectorAll(".tf2te-market-links").length, 0);
  assert.equal(container.querySelectorAll(".tf2te-market-links-loading").length, 1);

  await flush(12);

  assert.equal(hoverUrls.length, 1);
  assert.match(hoverUrls[0], /itemclasshover\/440\/9001\/0\?content_only=1&l=english$/);
  assert.equal(container.querySelectorAll(".tf2te-market-links").length, 1);
  assert.deepEqual(searched, ["Burning Flames Team Captain"]);
});

test("on a non-English page, a failed English lookup shows a warning with Retry and no buttons at all", async () => {
  const { container } = buildContainerWithTitle("Szokatlan Csapatkapitány", { effectLine: "★ Szokatlan hatás: Égő lángok" });
  const { searched } = installHungarianPage({
    container,
    assetId: "778",
    classid: "9002",
    hoverResponse: { ok: false, text: async () => "" },
  });

  showItemQuickLinks();
  await flush(12);

  const block = container.querySelectorAll(".tf2te-market-links")[0];
  assert.ok(block);
  const links = block.querySelectorAll("a");
  assert.deepEqual(links.map((a) => a.textContent), ["Retry"]);
  assert.deepEqual(searched, []);
});
