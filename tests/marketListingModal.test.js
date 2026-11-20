import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { __resetSchemaCacheForTests } from "../utils/tf2Schema.js";
import { __resetPricedbCacheForTests } from "../utils/pricedb.js";

import { marketListingDetailModal, buildModalSection } from "../steamcommunity.com/marketListingModal/content.js";

// marketListingModal/content.js inserts the same stats-links section into a
// Market listing's per-listing detail modal (one info panel per open modal,
// findModalInfoPanels - possibly more than one stacked at once). Uses the real
// utils/tf2StatsLinks/index.js (already covered by its own dedicated test
// files), fed the same
// chrome.storage.local/global fetch fixture shapes as
// tests/scmPricing.test.js and tests/marketListingLinks.test.js.
//
// A small tree-shaped FakeElement (children/parentElement/appendChild,
// tag-based querySelector/querySelectorAll, a ":scope > TAG" and
// `[data-marker="X"]` selector form) stands in for the actual modal DOM,
// since findInfoPanelAncestor genuinely walks parentElement chains and
// iterateLeafTexts (shared/priceWidgets.js) genuinely scans descendant
// div/span leaves - a flatter fake (like other files' simple id-lookup
// FakeElement) can't represent that walk.
test.beforeEach(() => {
  __resetSchemaCacheForTests();
});

class FakeElement {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    this._textContent = "";
    this._listeners = {};
    this.disabled = false;
    this.style = {};
  }
  get textContent() {
    return this._textContent;
  }
  set textContent(v) {
    this._textContent = v;
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
  remove() {
    if (!this.parentElement) return;
    const i = this.parentElement.children.indexOf(this);
    if (i !== -1) this.parentElement.children.splice(i, 1);
    this.parentElement = null;
  }
  // Standard DOM methods the pricedb.io loading slot / countdown
  // (utils/linkButtonStates.js) rely on.
  setAttribute(name, value) {
    (this._attrs ||= {})[name] = String(value);
  }
  getAttribute(name) {
    return this._attrs && name in this._attrs ? this._attrs[name] : null;
  }
  removeAttribute(name) {
    if (this._attrs) delete this._attrs[name];
  }
  replaceWith(other) {
    const parent = this.parentElement;
    if (!parent) return;
    parent.children.splice(parent.children.indexOf(this), 1, other);
    other.parentElement = parent;
    this.parentElement = null;
    this.detached = true;
  }
  get isConnected() {
    return !this.detached;
  }
  querySelectorAll(selector) {
    const wantTags = selector.split(",").map((s) => s.trim());
    const results = [];
    const visit = (node) => {
      for (const child of node.children || []) {
        if (child && typeof child === "object" && wantTags.includes(child.tagName)) results.push(child);
        if (child && typeof child === "object") visit(child);
      }
    };
    visit(this);
    return results;
  }
  querySelector(selector) {
    const trimmed = selector.trim();

    const scopeMatch = /^:scope\s*>\s*(\w+)$/.exec(trimmed);
    if (scopeMatch) {
      return this.children.find((c) => c.tagName === scopeMatch[1]) || null;
    }

    const markerMatch = /^\[data-marker="([^"]+)"\]$/.exec(trimmed);
    if (markerMatch) {
      const visit = (node) => {
        for (const child of node.children || []) {
          if (!child || typeof child !== "object") continue;
          if (child.dataset?.marker === markerMatch[1]) return child;
          const nested = visit(child);
          if (nested) return nested;
        }
        return null;
      };
      return visit(this);
    }

    return this.querySelectorAll(trimmed)[0] || null;
  }
}

function makeLeafDiv(text) {
  const el = new FakeElement("div");
  el.textContent = text;
  return el;
}

// Builds one modal's own info panel tree: a direct <h2> title, optional
// Effect/Sheen/Killstreaker leaf lines, and an inner wrapper holding the
// "Inspect in Game..." link and/or "Buy" button findModalInfoPanels anchors
// on - both walk parentElement up from themselves, so they're nested a level
// deeper than the panel itself, same as the real modal's own markup.
function buildInfoPanel({ itemTitle, effectLine, sheenLine, killstreakerLine, withInspectLink = true, withBuyButton = true }) {
  const infoPanel = new FakeElement("div");
  const h2 = new FakeElement("h2");
  h2.textContent = itemTitle;
  infoPanel.appendChild(h2);

  if (effectLine) infoPanel.appendChild(makeLeafDiv(effectLine));
  if (sheenLine) infoPanel.appendChild(makeLeafDiv(sheenLine));
  if (killstreakerLine) infoPanel.appendChild(makeLeafDiv(killstreakerLine));

  const inner = new FakeElement("div");
  infoPanel.appendChild(inner);

  let inspectLink = null;
  let buyButton = null;
  if (withInspectLink) {
    inspectLink = new FakeElement("a");
    inspectLink.textContent = "Inspect in Game...";
    inner.appendChild(inspectLink);
  }
  if (withBuyButton) {
    buyButton = new FakeElement("button");
    buyButton.textContent = "Buy";
    inner.appendChild(buyButton);
  }

  return { infoPanel, inspectLink, buyButton };
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

function fakeScmResponse(lowestPrice = "2,02€") {
  return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ success: true, lowest_price: lowestPrice }) };
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

// debounce's own single closed-over timeoutId always clears the previous
// pending call before scheduling a new one, so at most one is ever truly
// pending - tracked as a single slot rather than a general timer queue.
let scheduled = null;
let nextTimeoutId = 1;

function installGlobals({ pathname, links = [], buttons = [], storageData = {}, schemaFixture, sendMessage } = {}) {
  scheduled = null;
  FakeMutationObserver.instances = [];

  const storage = fakeStorageLocal(storageData);

  globalThis.document = {
    querySelectorAll: (selector) => (selector === "a" ? links : selector === "button" ? buttons : []),
    createElement: (tag) => new FakeElement(tag),
    createElementNS: (_ns, tag) => new FakeElement(tag),
    body: {},
  };
  globalThis.window = { location: { pathname } };
  globalThis.MutationObserver = FakeMutationObserver;
  globalThis.setTimeout = (fn) => {
    scheduled = { id: nextTimeoutId++, fn };
    return scheduled.id;
  };
  globalThis.clearTimeout = (id) => {
    if (scheduled && scheduled.id === id) scheduled = null;
  };

  globalThis.chrome = {
    storage: { local: storage },
    runtime: {
      sendMessage:
        sendMessage ||
        (async () => ({ ok: false, error: "no live fetch expected - schema is cache-only for this test file" })),
      getURL: (path) => path,
    },
  };
  globalThis.fetch = async () => fakeScmResponse();
  if (schemaFixture) {
    storage._store.tf2SchemaCache = schemaFixture;
  }

  return { storage };
}

const realSetTimeout = setTimeout;
async function flush(ticks = 8) {
  for (let i = 0; i < ticks; i++) await new Promise((resolve) => realSetTimeout(resolve, 0));
}

// Runs the currently-scheduled debounced call (maybeInsertIntoModal) and
// waits for its own internal awaits (resolveStatsAndClassifieds, ...) to
// settle.
async function runScheduled() {
  assert.ok(scheduled, "expected a debounced call to be scheduled");
  const { fn } = scheduled;
  scheduled = null;
  await fn();
  await flush();
}

const PLAIN_SCHEMA_FIXTURE = { itemNameToDefindex: {}, defindexToItemName: {}, effectNameToId: {}, fetchedAt: Date.now(), schemaShapeVersion: 4 };

test("inserts a section (the stats links) into the one open modal's info panel", async () => {
  const { infoPanel, inspectLink } = buildInfoPanel({ itemTitle: "Rocket Launcher" });
  installGlobals({ pathname: "/market/listings/440/Rocket%20Launcher", links: [inspectLink] });

  marketListingDetailModal();
  await runScheduled();

  const section = infoPanel.querySelector('[data-marker="tf2teModalSection"]');
  assert.ok(section);
  assert.equal(section.children.length, 1);
});

test("adds gladiator.tf/pricedb.io/marketplace.tf/mannco.store buttons to the section, and never a Steam Market one", async () => {
  const { infoPanel, inspectLink } = buildInfoPanel({ itemTitle: "Rocket Launcher" });
  installGlobals({ pathname: "/market/listings/440/Rocket%20Launcher", links: [inspectLink] });

  marketListingDetailModal();
  await runScheduled();

  const section = infoPanel.querySelector('[data-marker="tf2teModalSection"]');
  assert.ok(section);
  const statsRows = section.children[0];
  assert.ok(statsRows);

  const links = statsRows.querySelectorAll("a");
  const labels = links.map((l) => l.textContent);

  assert.ok(labels.includes("gladiator.tf"));
  assert.ok(labels.includes("marketplace.tf"));
  assert.ok(labels.includes("mannco.store"));
  assert.ok(!labels.includes("Steam Market"));
  // No posts.tf here - no schemaFixture at all was installed for this test,
  // so buildPostsTfLink's own getItemDefindex lookup has nothing to resolve
  // against (see the dedicated posts.tf test below).
  assert.ok(!labels.includes("posts.tf"));

  const gladiatorLink = links.find((l) => l.textContent === "gladiator.tf");
  assert.equal(gladiatorLink.href, "https://gladiator.tf/sales?item=Rocket+Launcher");
});

// gladiator.tf names an Unusual "{Effect} {Item}", with the effect this
// listing's own info panel shows.
test("REGRESSION: an Unusual listing's gladiator.tf link searches '{Effect} {Item}'", async () => {
  const { infoPanel, inspectLink } = buildInfoPanel({ itemTitle: "Unusual Hound Dog", effectLine: "★ Unusual Effect: Stormy Storm" });
  installGlobals({ pathname: "/market/listings/440/Unusual%20Hound%20Dog", links: [inspectLink] });

  marketListingDetailModal();
  await runScheduled();

  const section = infoPanel.querySelector('[data-marker="tf2teModalSection"]');
  const links = section.children[0].querySelectorAll("a");
  const gladiatorLink = links.find((l) => l.textContent === "gladiator.tf");
  assert.equal(gladiatorLink.href, "https://gladiator.tf/sales?item=Stormy+Storm+Hound+Dog");
});

// New feature: Sheen/Killstreaker filtering is user-toggleable via a General
// settings checkbox, default on. When off, this modal's mannco.store button
// (scoped to one real listing, unlike the page-level version - see this
// file's own header note) drops sheen/killstreaker entirely, same as every
// other consumer of the toggle.
test("omits sheen/killstreaker from the mannco.store link when the Sheen/Killstreaker filter setting is off", async () => {
  const { infoPanel, inspectLink } = buildInfoPanel({
    itemTitle: "Strange Professional Killstreak Rocket Launcher",
    sheenLine: "Sheen: Hot Rod",
    killstreakerLine: "Killstreaker: Incinerator",
  });
  installGlobals({
    pathname: "/market/listings/440/Strange%20Professional%20Killstreak%20Rocket%20Launcher",
    links: [inspectLink],
    storageData: { sheenKillstreakerFilterEnabled: false },
  });

  marketListingDetailModal();
  await runScheduled();

  const section = infoPanel.querySelector('[data-marker="tf2teModalSection"]');
  const statsRows = section.children[0];
  const links = statsRows.querySelectorAll("a");
  const mannStoreLink = links.find((l) => l.textContent === "mannco.store");
  assert.ok(mannStoreLink);
  const params = new URL(mannStoreLink.href).searchParams;
  assert.equal(params.get("sheen"), null);
  assert.equal(params.get("killstreaker"), null);
});

// Decodes a posts.tf search URL's own "q" param the same way
// utils/tf2StatsLinks/index.js's buildPostsTfLink encodes it - see
// tests/tf2StatsLinksIndex.test.js's own decodePostsTfQuery.
function decodePostsTfQuery(href) {
  const b64 = new URL(href).searchParams.get("q");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
}

test("adds a posts.tf button right after pricedb.io once the item's defindex resolves", async () => {
  const { infoPanel, inspectLink } = buildInfoPanel({ itemTitle: "Rocket Launcher" });
  installGlobals({
    pathname: "/market/listings/440/Rocket%20Launcher",
    links: [inspectLink],
    schemaFixture: { itemNameToDefindex: { "Rocket Launcher": 205 }, defindexToItemName: {}, effectNameToId: {}, fetchedAt: Date.now(), schemaShapeVersion: 4 },
    // pricedb.io's own search has to actually succeed here too, or its
    // button (hence the "right after" position this test checks) wouldn't
    // exist at all - same shape utils/pricedb.js's own header note documents.
    sendMessage: async (message) => {
      const url = String(message?.url || "");
      if (url.includes("pricedb.io")) return { ok: true, data: { success: true, data: { results: [{ sku: "205;6" }] } } };
      return { ok: false, error: "unexpected message in test fixture" };
    },
  });

  marketListingDetailModal();
  await runScheduled();

  const section = infoPanel.querySelector('[data-marker="tf2teModalSection"]');
  const statsRows = section.children[0];
  const links2 = statsRows.querySelectorAll("a");
  const labels = links2.map((l) => l.textContent);

  const pricedbIndex = labels.indexOf("pricedb.io");
  const postsTfIndex = labels.indexOf("posts.tf");
  assert.notEqual(postsTfIndex, -1);
  assert.equal(postsTfIndex, pricedbIndex + 1);

  const query = decodePostsTfQuery(links2[postsTfIndex].href);
  assert.deepEqual(query, { u: [{ defindex: 205, quality: 6, craftable: true }], p: [], d: "", m: false });
});

// An earlier version tried adding a per-item history icon here (reading a
// listing's own asset id off the URL's ?detail= query param, the same idea
// steamcommunity.com/itemQuickLinks' own inventory-page version uses via
// findActiveAssetId) - confirmed live that URL-based assetid never actually
// worked on this page, so it was removed. This guards against it quietly
// coming back.
test("never shows a per-item history icon on this page (no reliable per-listing asset id here)", async () => {
  const { infoPanel, inspectLink } = buildInfoPanel({ itemTitle: "Rocket Launcher" });
  installGlobals({ pathname: "/market/listings/440/Rocket%20Launcher", links: [inspectLink] });

  marketListingDetailModal();
  await runScheduled();

  const section = infoPanel.querySelector('[data-marker="tf2teModalSection"]');
  const statsRows = section.children[0];
  const links = statsRows.querySelectorAll("a");

  assert.ok(!links.some((l) => l.title?.startsWith("View this exact item's history")));
});

test("does nothing when the URL isn't a market listing page (getMarketListingItemNameFromUrl returns null)", async () => {
  const { infoPanel, inspectLink } = buildInfoPanel({ itemTitle: "Rocket Launcher" });
  installGlobals({ pathname: "/id/someuser/inventory", links: [inspectLink] });

  marketListingDetailModal();
  await runScheduled();

  assert.equal(infoPanel.querySelector('[data-marker="tf2teModalSection"]'), null);
});

test("finds the info panel via the Buy button too, when there's no Inspect in Game link (e.g. an already-sold listing)", async () => {
  const { infoPanel, buyButton } = buildInfoPanel({ itemTitle: "Rocket Launcher", withInspectLink: false });
  installGlobals({ pathname: "/market/listings/440/Rocket%20Launcher", buttons: [buyButton] });

  marketListingDetailModal();
  await runScheduled();

  assert.ok(infoPanel.querySelector('[data-marker="tf2teModalSection"]'));
});

test("does not build a section for a panel whose <h2> title hasn't rendered yet (readiness gate)", async () => {
  const { infoPanel, inspectLink } = buildInfoPanel({ itemTitle: "" });
  installGlobals({ pathname: "/market/listings/440/Rocket%20Launcher", links: [inspectLink] });

  marketListingDetailModal();
  await runScheduled();

  assert.equal(infoPanel.querySelector('[data-marker="tf2teModalSection"]'), null);
});

test("skips rebuilding when re-run against the same panel with an unchanged content signature", async () => {
  const { infoPanel, inspectLink } = buildInfoPanel({ itemTitle: "Rocket Launcher" });
  installGlobals({ pathname: "/market/listings/440/Rocket%20Launcher", links: [inspectLink] });

  marketListingDetailModal();
  await runScheduled();
  const firstSection = infoPanel.querySelector('[data-marker="tf2teModalSection"]');
  assert.ok(firstSection);

  // A later mutation notification (nothing actually changed about this
  // listing) re-triggers the debounced call via the MutationObserver.
  FakeMutationObserver.instances[0].cb();
  await runScheduled();

  assert.equal(infoPanel.querySelector('[data-marker="tf2teModalSection"]'), firstSection); // same instance, not rebuilt
});

test("rebuilds the section when the same panel's own Sheen/Killstreaker labels change (a different listing swapped into the same node)", async () => {
  const { infoPanel, inspectLink } = buildInfoPanel({ itemTitle: "Strange Professional Killstreak Rocket Launcher", sheenLine: "Sheen: Team Shine" });
  installGlobals({ pathname: "/market/listings/440/Strange%20Professional%20Killstreak%20Rocket%20Launcher", links: [inspectLink] });

  marketListingDetailModal();
  await runScheduled();
  const firstSection = infoPanel.querySelector('[data-marker="tf2teModalSection"]');
  assert.ok(firstSection);

  // Simulate the DOM diffing reusing this same node for a different listing:
  // the Sheen line's text changes.
  infoPanel.children.find((c) => c.textContent === "Sheen: Team Shine").textContent = "Sheen: Hot Rod";

  FakeMutationObserver.instances[0].cb();
  await runScheduled();

  const secondSection = infoPanel.querySelector('[data-marker="tf2teModalSection"]');
  assert.ok(secondSection);
  assert.notEqual(secondSection, firstSection); // stale section removed, a new one built
});

test("builds an independent section for each of 2 simultaneously-open modal panels", async () => {
  const panelA = buildInfoPanel({ itemTitle: "Rocket Launcher" });
  const panelB = buildInfoPanel({ itemTitle: "Scattergun" });
  installGlobals({
    pathname: "/market/listings/440/Rocket%20Launcher", // shared market_hash_name page for both stacked modals
    links: [panelA.inspectLink, panelB.inspectLink],
  });

  marketListingDetailModal();
  await runScheduled();

  assert.ok(panelA.infoPanel.querySelector('[data-marker="tf2teModalSection"]'));
  assert.ok(panelB.infoPanel.querySelector('[data-marker="tf2teModalSection"]'));
});

test("dedupes a panel matched by both the Inspect link and the Buy button into a single section", async () => {
  const { infoPanel, inspectLink, buyButton } = buildInfoPanel({ itemTitle: "Rocket Launcher" });
  installGlobals({ pathname: "/market/listings/440/Rocket%20Launcher", links: [inspectLink], buttons: [buyButton] });

  marketListingDetailModal();
  await runScheduled();

  // Only one section, not two stacked from being matched twice.
  const sections = infoPanel.querySelectorAll("div").filter((el) => el.dataset?.marker === "tf2teModalSection");
  assert.equal(sections.length, 1);
});

test("debounces rapid successive mutation notifications into a single maybeInsertIntoModal run", async () => {
  const { infoPanel, inspectLink } = buildInfoPanel({ itemTitle: "Rocket Launcher" });
  installGlobals({ pathname: "/market/listings/440/Rocket%20Launcher", links: [inspectLink] });

  marketListingDetailModal();
  const firstScheduledId = scheduled.id;

  // Several mutations fire in quick succession before the debounce delay
  // elapses - each should replace (clearTimeout + a fresh setTimeout) the
  // still-pending call rather than stacking additional ones.
  FakeMutationObserver.instances[0].cb();
  FakeMutationObserver.instances[0].cb();
  FakeMutationObserver.instances[0].cb();

  assert.notEqual(scheduled.id, firstScheduledId); // replaced, not stacked
  await runScheduled();

  assert.ok(infoPanel.querySelector('[data-marker="tf2teModalSection"]'));
});

// A rate-limited lookup used to look IDENTICAL to "this item genuinely has no
// pricedb.io listing" here too - both just silently omitted the button.
// searchPricedbSkuStatus surfaces the real 429 (see utils/pricedb.js's own
// note) so this can show something instead, as a non-clickable placeholder
// (never a dead <a> with no href) in the same slot.
test("REGRESSION: a real 429 turns pricedb.io's slot into the rate-limit countdown instead of silently omitting it", async () => {
  mock.timers.enable({ apis: ["setInterval"] }); // the countdown's own ticking
  // utils/pricedb.js's own in-memory cache is keyed per item name, not per
  // test - an earlier test above already cached "Rocket Launcher" -> a real
  // sku, so this needs a fresh (uncached) lookup to actually exercise the
  // 429 branch below.
  __resetPricedbCacheForTests();
  const { infoPanel, inspectLink } = buildInfoPanel({ itemTitle: "Rocket Launcher" });
  installGlobals({
    pathname: "/market/listings/440/Rocket%20Launcher",
    links: [inspectLink],
    sendMessage: async (message) => {
      const url = String(message?.url || "");
      if (url.includes("pricedb.io")) return { ok: false, status: 429, error: "Rate limited (429)" };
      return { ok: false, error: "unexpected message in test fixture" };
    },
  });

  try {
    marketListingDetailModal();
    await runScheduled();

    const section = infoPanel.querySelector('[data-marker="tf2teModalSection"]');
    const statsRows = section.children[0];
    assert.equal(statsRows.querySelectorAll("a").some((a) => a.textContent === "pricedb.io"), false);
    const countdown = statsRows.querySelectorAll("span").find((s) => /Retrying automatically in \d+s/.test(s.title || ""));
    assert.ok(countdown, "expected the rate-limit countdown in pricedb.io's slot");
  } finally {
    mock.timers.reset();
  }
});

// --- buildModalSection --- Direct unit tests of the pure builder rather than
// driving it through the full marketListingDetailModal()/mutation-observer
// machinery above.

const SIMPLE_RESOLVED = {
  nextBpStatsHref: null,
  nextClassifiedsHref: "https://next.backpack.tf/classifieds?itemName=Rocket+Launcher",
  classifiedsHref: null,
  postsTfHref: null,
  marketplaceHref: null,
};

test("buildModalSection shows just the stats links block", () => {
  installGlobals({ pathname: "/market/listings/440/Rocket%20Launcher" });

  const section = buildModalSection(SIMPLE_RESOLVED, null, null, null);

  assert.ok(section);
  assert.equal(section.children.length, 1, "only the stats-links block");
  const links = section.children[0].querySelectorAll("a");
  // createStatsRow (shared/priceWidgets.js) renders the site name as a plain
  // text node, not link text - SIMPLE_RESOLVED only has nextClassifiedsHref
  // set (no nextBpStatsHref), so the one link built is the "📰" classifieds
  // icon, titled accordingly.
  assert.ok(links.some((l) => l.title === "Browse classifieds listings"));
});

test("buildModalSection: no stats links resolved returns null (nothing to show at all)", () => {
  installGlobals({ pathname: "/market/listings/440/Rocket%20Launcher" });
  const emptyResolved = { nextBpStatsHref: null, nextClassifiedsHref: null, classifiedsHref: null, postsTfHref: null, marketplaceHref: null };

  const section = buildModalSection(emptyResolved, null, null, null);

  assert.equal(section, null);
});

// The sheen/killstreaker setting read is the LAST await before the section is
// appended. A newer listing swapped into the same panel during it used to end
// up with two sections (the stale one appended after the newer run's own).
test("REGRESSION: a run left stale during the setting read never appends its section", async () => {
  const { infoPanel, inspectLink } = buildInfoPanel({ itemTitle: "Strange Professional Killstreak Rocket Launcher", sheenLine: "Sheen: Team Shine" });
  const { storage } = installGlobals({ pathname: "/market/listings/440/Strange%20Professional%20Killstreak%20Rocket%20Launcher", links: [inspectLink] });

  let releaseFirstSettingRead;
  let settingReads = 0;
  const realGet = storage.get;
  storage.get = async (keys) => {
    // Read #1 is resolveStatsAndClassifieds' own; #2 is the modal's, after it.
    if (keys.includes("sheenKillstreakerFilterEnabled") && ++settingReads === 2) {
      await new Promise((resolve) => (releaseFirstSettingRead = resolve));
    }
    return realGet(keys);
  };

  marketListingDetailModal();
  const firstRun = scheduled.fn;
  scheduled = null;
  const firstRunDone = firstRun();
  await flush();
  assert.ok(releaseFirstSettingRead, "first run should be parked on the setting read");

  infoPanel.children.find((c) => c.textContent === "Sheen: Team Shine").textContent = "Sheen: Hot Rod";
  FakeMutationObserver.instances[0].cb();
  await runScheduled();

  releaseFirstSettingRead();
  await firstRunDone;
  await flush();

  const sections = infoPanel.children.filter((c) => c.dataset.marker === "tf2teModalSection");
  assert.equal(sections.length, 1);
});
