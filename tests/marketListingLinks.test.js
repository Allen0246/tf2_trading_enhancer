import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { marketListingLinks, showHeaderPictureEffect } from "../steamcommunity.com/marketListingLinks/content.js";
import { PARTICLE_HOST_URL } from "../utils/particleImages.js";
import { UNUSUAL_EFFECT_IDS } from "../utils/unusualEffectIds.js";
import { __resetSchemaCacheForTests } from "../utils/tf2Schema.js";
import { __resetPricedbCacheForTests } from "../utils/pricedb.js";

// utils/tf2Schema.js memoizes its resolved schema at module scope
// (schemaPromise) for the lifetime of this test file's one module instance -
// without resetting it between tests, a later test's own (different)
// tf2SchemaCache fixture would be silently ignored in favor of whatever an
// earlier test already resolved. Same reset-between-tests pattern
// tests/tf2Schema.test.js/tests/itemShape.test.js establish.
test.beforeEach(() => {
  __resetSchemaCacheForTests();
});

// marketListingLinks/content.js builds the next.backpack.tf:/backpack.tf:/
// marketplace.tf stack under a Steam Market listing page's preview image. Uses the REAL utils/tf2StatsLinks/index.js
// (already covered by its own dedicated test files) fed a real (schema-cache-
// only, no live fetch) tf2Schema fixture - same fixture shape as
// tests/itemShape.test.js - so this file only needs to prove marketListingLinks'
// OWN DOM orchestration (image-panel wait/retry, standalone insertion,
// self-healing observer), not re-derive backpack.tf URL
// building.
function createFakePanel() {
  return {
    dataset: {},
    style: { setProperty(name, value) { this[name] = value; } },
    children: [],
    appendChild(el) {
      this.children.push(el);
      return el;
    },
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

let imgQueryResult;
let elementsById;

function installGlobals({ pathname, schemaFixture, sendMessage } = {}) {
  imgQueryResult = null;
  elementsById = new Map();
  FakeMutationObserver.instances = [];

  globalThis.document = {
    querySelector: (selector) => (selector.includes("steamstatic.com") ? imgQueryResult : null),
    // Backs findMarketInfoPanels' own "a"/"button" scans (shared/
    // priceWidgets.js) - empty by default, same as "no info panel found",
    // which keeps every pre-existing test in this file exercising the exact
    // same unfiltered-search behavior as before that function existed.
    // Dedicated tests for the info-panel-reading behavior itself override
    // this directly.
    querySelectorAll: () => [],
    getElementById: (id) => elementsById.get(id) || null,
    createElement: (tag) => {
      const el = {
        tagName: tag,
        style: {},
        children: [],
        dataset: {},
        _attrs: {},
        // Standard DOM methods the pricedb.io loading slot / countdown
        // (utils/linkButtonStates.js) rely on.
        setAttribute(name, value) {
          this._attrs[name] = String(value);
        },
        getAttribute(name) {
          return name in this._attrs ? this._attrs[name] : null;
        },
        removeAttribute(name) {
          delete this._attrs[name];
        },
        replaceWith(other) {
          const parent = this.parentElement;
          if (!parent) return;
          parent.children.splice(parent.children.indexOf(this), 1, other);
          other.parentElement = parent;
          this.parentElement = null;
          this.detached = true;
        },
        get isConnected() {
          return !this.detached;
        },
        remove() {
          const parent = this.parentElement;
          if (parent) parent.children.splice(parent.children.indexOf(this), 1);
          this.parentElement = null;
          this.detached = true;
        },
        // No-op - only exercised by shared/quickLinkButtons.js's own
        // createButtonLink (mouseenter/mouseleave brighten effect), which
        // this file doesn't otherwise need to simulate.
        addEventListener() {},
        appendChild(child) {
          this.children.push(child);
          if (child && typeof child === "object") child.parentElement = this;
          return child;
        },
        append(...items) {
          for (const item of items) this.appendChild(item);
        },
        // Minimal tag-only querySelector("a") - enough for
        // buildStatsRowsBlock's own "did anything real land in here" check.
        querySelector(selector) {
          const wantTag = selector.trim();
          const search = (node) => {
            for (const child of node.children || []) {
              if (typeof child === "object" && child.tagName === wantTag) return child;
              const nested = search(child);
              if (nested) return nested;
            }
            return null;
          };
          return search(this);
        },
      };
      return el;
    },
    createElementNS: (_ns, tag) => globalThis.document.createElement(tag),
    body: {},
  };
  globalThis.window = { location: { pathname } };
  globalThis.MutationObserver = FakeMutationObserver;
  globalThis.setTimeout = (fn, delay) => {
    (globalThis.__timeouts ||= []).push({ fn, delay });
    return globalThis.__timeouts.length;
  };
  globalThis.clearTimeout = () => {};

  globalThis.chrome = {
    storage: {
      local: {
        get: async () => ({ tf2SchemaCache: schemaFixture }),
        set: async () => {},
      },
    },
    runtime: {
      sendMessage:
        sendMessage ||
        (async () => ({ ok: false, error: "no live fetch expected - schema is cache-only for this test file" })),
      getURL: (path) => path,
    },
  };
  globalThis.fetch = async () => ({ json: async () => [] }); // warpaints - unused by any fixture here
}

const PLAIN_SCHEMA_FIXTURE = {
  itemNameToDefindex: {},
  defindexToItemName: {},
  effectNameToId: {},
  fetchedAt: Date.now(),
  schemaShapeVersion: 4,
};

// Non-empty effectNameToId (but with no entry matching "Team Captain") so
// resolveUnusualEffect's own "schema unavailable" bail-out doesn't fire -
// see that function's own note: an empty map specifically means "schema
// never loaded", which is a different (unresolvable) case from "loaded, but
// this item just has no effect / no matching known name".
const UNUSUAL_CAPABLE_SCHEMA_FIXTURE = {
  itemNameToDefindex: {},
  defindexToItemName: {},
  effectNameToId: { "Battle Bot Boogaloo": 100 },
  fetchedAt: Date.now(),
  schemaShapeVersion: 4,
};

const realSetTimeout = setTimeout;
async function flush(ticks = 8) {
  for (let i = 0; i < ticks; i++) {
    await new Promise((resolve) => realSetTimeout(resolve, 0));
  }
}

test("does nothing when the current URL isn't a market listing page (no item name to resolve)", async () => {
  installGlobals({ pathname: "/id/someuser/inventory", schemaFixture: PLAIN_SCHEMA_FIXTURE });
  imgQueryResult = { parentElement: createFakePanel() };

  marketListingLinks();
  await flush();

  // No exception, and (since getMarketListingItemNameFromUrl bailed) the panel this test
  // never even captured a reference to was left untouched - nothing else to
  // assert here beyond "didn't throw".
});

test("waits via MutationObserver + timeout when the image panel isn't rendered yet, then builds once it appears", async () => {
  installGlobals({
    pathname: "/market/listings/440/Rocket%20Launcher",
    schemaFixture: PLAIN_SCHEMA_FIXTURE,
  });
  imgQueryResult = null;

  marketListingLinks();

  assert.equal(FakeMutationObserver.instances.length, 1);
  assert.equal(globalThis.__timeouts.length, 1);
  assert.equal(globalThis.__timeouts[0].delay, 15000);

  const panel = createFakePanel();
  imgQueryResult = { parentElement: panel };
  FakeMutationObserver.instances[0].cb();
  await flush();

  assert.equal(panel.dataset.tf2teLinksInserted, "1");
  assert.equal(panel.children.length, 1); // the standalone block (no price row present)
});

test("is idempotent - a second call for a panel already marked tf2teLinksInserted does nothing more", async () => {
  installGlobals({ pathname: "/market/listings/440/Rocket%20Launcher", schemaFixture: PLAIN_SCHEMA_FIXTURE });
  const panel = createFakePanel();
  imgQueryResult = { parentElement: panel };

  marketListingLinks();
  await flush();
  assert.equal(panel.children.length, 1);

  marketListingLinks();
  await flush();
  assert.equal(panel.children.length, 1); // unchanged
});

test("the standalone block's own MutationObserver re-appends it if Steam's own re-render wipes it out", async () => {
  installGlobals({ pathname: "/market/listings/440/Rocket%20Launcher", schemaFixture: PLAIN_SCHEMA_FIXTURE });
  const panel = createFakePanel();
  imgQueryResult = { parentElement: panel };

  marketListingLinks();
  await flush();

  assert.equal(panel.children.length, 1);
  const standaloneBlock = panel.children[0];
  assert.equal(standaloneBlock.id, "tf2te_stats_links_row");

  // Simulate Steam's own re-render wiping the panel's children (a fresh
  // panel object, as findImagePanel would re-query and find after a DOM
  // replace) - the watcher's own MutationObserver callback should re-append
  // the SAME standaloneBlock into whatever findImagePanel finds now.
  const freshPanel = createFakePanel();
  imgQueryResult = { parentElement: freshPanel };
  document.getElementById = (id) => (id === "tf2te_stats_links_row" ? null : null); // simulate "no longer attached"

  // 2 observers exist by now: the one from waitForImagePanel (already fired,
  // now a no-op re-check) and the standalone block's own self-heal watcher.
  FakeMutationObserver.instances.forEach((obs) => obs.cb());

  assert.equal(freshPanel.children.length, 1);
  assert.equal(freshPanel.children[0], standaloneBlock);
});

test("adds gladiator.tf/pricedb.io/marketplace.tf/mannco.store buttons, and never a Steam Market one (this page IS Steam Market)", async () => {
  installGlobals({ pathname: "/market/listings/440/Rocket%20Launcher", schemaFixture: PLAIN_SCHEMA_FIXTURE });
  const panel = createFakePanel();
  imgQueryResult = { parentElement: panel };

  marketListingLinks();
  await flush();

  const statsRows = panel.children[0].children[0];
  const links = statsRows.children.flatMap((row) => row.children || []).filter((c) => typeof c === "object" && c.href);
  const labels = links.map((l) => l.textContent);

  assert.ok(labels.includes("gladiator.tf"));
  assert.ok(labels.includes("marketplace.tf"));
  assert.ok(labels.includes("mannco.store"));
  assert.ok(!labels.includes("Steam Market"));
  // No posts.tf here - PLAIN_SCHEMA_FIXTURE's own itemNameToDefindex has no
  // entry for "Rocket Launcher", so buildPostsTfLink's own getItemDefindex
  // lookup comes back null (see the dedicated posts.tf test below, which
  // uses a schema fixture that actually has one).
  assert.ok(!labels.includes("posts.tf"));

  const gladiatorLink = links.find((l) => l.textContent === "gladiator.tf");
  assert.equal(gladiatorLink.href, "https://gladiator.tf/sales?item=Rocket+Launcher");
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
  installGlobals({
    pathname: "/market/listings/440/Rocket%20Launcher",
    schemaFixture: { ...PLAIN_SCHEMA_FIXTURE, itemNameToDefindex: { "Rocket Launcher": 205 } },
    // pricedb.io's own search has to actually succeed here too, or its
    // button (hence the "right after" position this test checks) wouldn't
    // exist at all - same shape utils/pricedb.js's own header note documents.
    sendMessage: async (message) => {
      const url = String(message?.url || "");
      if (url.includes("pricedb.io")) return { ok: true, data: { success: true, data: { results: [{ sku: "205;6" }] } } };
      return { ok: false, error: "unexpected message in test fixture" };
    },
  });
  const panel = createFakePanel();
  imgQueryResult = { parentElement: panel };

  marketListingLinks();
  await flush();

  const statsRows = panel.children[0].children[0];
  const links = statsRows.children.flatMap((row) => row.children || []).filter((c) => typeof c === "object" && c.href);
  const labels = links.map((l) => l.textContent);

  const pricedbIndex = labels.indexOf("pricedb.io");
  const postsTfIndex = labels.indexOf("posts.tf");
  assert.notEqual(postsTfIndex, -1);
  assert.equal(postsTfIndex, pricedbIndex + 1);

  const postsTfLink = links[postsTfIndex];
  const query = decodePostsTfQuery(postsTfLink.href);
  assert.deepEqual(query, { u: [{ defindex: 205, quality: 6, craftable: true }], p: [], d: "", m: false });
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
  installGlobals({
    pathname: "/market/listings/440/Rocket%20Launcher",
    schemaFixture: PLAIN_SCHEMA_FIXTURE,
    sendMessage: async (message) => {
      const url = String(message?.url || "");
      if (url.includes("pricedb.io")) return { ok: false, status: 429, error: "Rate limited (429)" };
      return { ok: false, error: "unexpected message in test fixture" };
    },
  });
  const panel = createFakePanel();
  imgQueryResult = { parentElement: panel };

  try {
    marketListingLinks();
    await flush();

    const statsRows = panel.children[0].children[0];
    const allEntries = statsRows.children.flatMap((row) => row.children || []).filter((c) => typeof c === "object");
    assert.equal(allEntries.some((c) => c.href?.includes("pricedb.io")), false);
    const countdown = allEntries.find((c) => /Retrying automatically in \d+s/.test(c.title || ""));
    assert.ok(countdown, "expected the rate-limit countdown in pricedb.io's slot");
    assert.equal(countdown.tagName, "span");
  } finally {
    mock.timers.reset();
  }
});

test("shows the 'search without sheen and killstreaker filter' caption for a Specialized/Professional Killstreak weapon", async () => {
  installGlobals({ pathname: "/market/listings/440/Strange%20Professional%20Killstreak%20Rocket%20Launcher", schemaFixture: PLAIN_SCHEMA_FIXTURE });
  const panel = createFakePanel();
  imgQueryResult = { parentElement: panel };

  marketListingLinks();
  await flush();

  const block = panel.children[0];
  // buildStandaloneBlock's own only child is the statsRows wrapper.
  const statsRows = block.children[0];
  const captionTexts = statsRows.children.filter((c) => typeof c === "object" && !c.href).map((c) => c.textContent);
  assert.ok(captionTexts.some((t) => t === "Search without sheen and killstreaker filter"));
});

test("shows the 'search without unusual effect filter' caption for an Unusual whose effect resolves (schema loaded, no matching known name)", async () => {
  installGlobals({
    pathname: "/market/listings/440/Unusual%20Team%20Captain",
    schemaFixture: UNUSUAL_CAPABLE_SCHEMA_FIXTURE,
  });
  const panel = createFakePanel();
  imgQueryResult = { parentElement: panel };

  marketListingLinks();
  await flush();

  assert.equal(panel.children.length, 1); // did resolve to something - not the "nothing" bail-out
  const statsRows = panel.children[0].children[0];
  const captionTexts = statsRows.children.filter((c) => typeof c === "object" && !c.href).map((c) => c.textContent);
  assert.ok(captionTexts.some((t) => t === "Search without unusual effect filter"));
});

test("still shows gladiator.tf (needs no schema at all) even when the Unusual effect schema itself is unavailable", async () => {
  installGlobals({
    pathname: "/market/listings/440/Unusual%20Team%20Captain",
    schemaFixture: PLAIN_SCHEMA_FIXTURE, // effectNameToId: {} - "schema never loaded"
  });
  const panel = createFakePanel();
  imgQueryResult = { parentElement: panel };

  marketListingLinks();
  await flush();

  // gladiator.tf is always buildable off the item name alone (see
  // utils/tf2StatsLinks/index.js's buildGladiatorHref) - unlike backpack.tf/
  // marketplace.tf, it never depended on the Unusual effect schema resolving
  // in the first place, so this no longer bails out to nothing.
  assert.equal(panel.children.length, 1);
  assert.equal(panel.dataset.tf2teLinksInserted, "1");
  const statsRows = panel.children[0].children[0];
  const gladiatorLink = statsRows.querySelector("a");
  assert.ok(gladiatorLink);
});

// --- reading Sheen/Killstreaker/Unusual Effect off this page's own item info
// panel --------------- Minimal fake DOM tree, just enough for
// findMarketInfoPanels/findLabeledValue (shared/priceWidgets.js) to walk: an
// "Inspect in Game..." link as a direct child of the info panel (so
// findInfoPanelAncestor's very first walk-up step already finds the panel's
// own ":scope > h2"), plus plain leaf div/span children for each labeled line.

class FakeDomElement {
  constructor(tagName, { textContent = "" } = {}) {
    this.tagName = tagName;
    this._textContent = textContent;
    this.children = [];
    this.parentElement = null;
  }
  get textContent() {
    return this.children.length > 0 ? this.children.map((c) => c.textContent).join("") : this._textContent;
  }
  appendChild(child) {
    this.children.push(child);
    child.parentElement = this;
    return child;
  }
  querySelector(selector) {
    if (selector === ":scope > h2") return this.children.find((c) => c.tagName === "h2") || null;
    const stack = [...this.children];
    while (stack.length) {
      const el = stack.shift();
      if (el.tagName === selector) return el;
      stack.push(...el.children);
    }
    return null;
  }
  querySelectorAll(selector) {
    const tags = selector.split(",").map((s) => s.trim());
    const results = [];
    const walk = (node) => {
      for (const child of node.children) {
        if (tags.includes(child.tagName)) results.push(child);
        walk(child);
      }
    };
    walk(this);
    return results;
  }
}

function buildFakeInfoPanel(lines) {
  const infoPanel = new FakeDomElement("div");
  infoPanel.appendChild(new FakeDomElement("h2", { textContent: "Strange Professional Killstreak Rocket Launcher" }));
  for (const text of lines) infoPanel.appendChild(new FakeDomElement("div", { textContent: text }));
  const inspectLink = new FakeDomElement("a", { textContent: "Inspect in Game..." });
  infoPanel.appendChild(inspectLink);
  return { infoPanel, inspectLink };
}

test("reads Sheen/Killstreaker off the page's own item info panel and includes them in the classic/next backpack.tf links, hiding the caption", async () => {
  installGlobals({ pathname: "/market/listings/440/Strange%20Professional%20Killstreak%20Rocket%20Launcher", schemaFixture: PLAIN_SCHEMA_FIXTURE });
  const { inspectLink } = buildFakeInfoPanel(["Sheen: Hot Rod", "Killstreaker: Incinerator"]);
  globalThis.document.querySelectorAll = (selector) => (selector === "a" ? [inspectLink] : []);

  const panel = createFakePanel();
  imgQueryResult = { parentElement: panel };

  marketListingLinks();
  await flush();

  const statsRows = panel.children[0].children[0];
  const captionTexts = statsRows.children.filter((c) => typeof c === "object" && !c.href).map((c) => c.textContent);
  assert.equal(captionTexts.includes("Search without sheen and killstreaker filter"), false);

  const links = statsRows.children.flatMap((row) => row.children || []).filter((c) => typeof c === "object" && c.href);
  // Specifically the classifieds (📰) link, not the stats icon link - both
  // point at next.backpack.tf, but only the classifieds one carries the
  // sheen/killstreaker filter.
  const nextLink = links.find((l) => l.href?.includes("next.backpack.tf/classifieds"));
  assert.ok(nextLink);
  const nextUrl = new URL(nextLink.href);
  assert.equal(nextUrl.searchParams.get("sheen"), "7");
  assert.equal(nextUrl.searchParams.get("killstreaker"), "2007");

  const mannStoreLink = links.find((l) => l.href?.includes("mannco.store"));
  assert.ok(mannStoreLink);
  const mannUrl = new URL(mannStoreLink.href);
  assert.equal(mannUrl.searchParams.get("sheen"), "Hot Rod");
  assert.equal(mannUrl.searchParams.get("killstreaker"), "Incinerator");
});

// New feature: Sheen/Killstreaker filtering is user-toggleable via a General
// settings checkbox, default on. Same page/info panel as the test just
// above, only with the setting off - every link (classic/next backpack.tf,
// mannco.store) drops sheen/killstreaker, and the caption stays hidden too
// (an unfiltered search is now expected behavior, not a fallback worth
// flagging - see buildStatsRowsBlock's own note).
test("omits sheen/killstreaker from every link (and keeps the caption hidden) when the Sheen/Killstreaker filter setting is off", async () => {
  installGlobals({ pathname: "/market/listings/440/Strange%20Professional%20Killstreak%20Rocket%20Launcher", schemaFixture: PLAIN_SCHEMA_FIXTURE });
  globalThis.chrome.storage.local.get = async () => ({ tf2SchemaCache: PLAIN_SCHEMA_FIXTURE, sheenKillstreakerFilterEnabled: false });
  const { inspectLink } = buildFakeInfoPanel(["Sheen: Hot Rod", "Killstreaker: Incinerator"]);
  globalThis.document.querySelectorAll = (selector) => (selector === "a" ? [inspectLink] : []);

  const panel = createFakePanel();
  imgQueryResult = { parentElement: panel };

  marketListingLinks();
  await flush();

  const statsRows = panel.children[0].children[0];
  const captionTexts = statsRows.children.filter((c) => typeof c === "object" && !c.href).map((c) => c.textContent);
  assert.equal(captionTexts.includes("Search without sheen and killstreaker filter"), false);

  const links = statsRows.children.flatMap((row) => row.children || []).filter((c) => typeof c === "object" && c.href);
  const nextLink = links.find((l) => l.href?.includes("next.backpack.tf/classifieds"));
  assert.ok(nextLink);
  assert.equal(new URL(nextLink.href).searchParams.get("sheen"), null);
  assert.equal(new URL(nextLink.href).searchParams.get("killstreaker"), null);

  const mannStoreLink = links.find((l) => l.href?.includes("mannco.store"));
  assert.ok(mannStoreLink);
  assert.equal(new URL(mannStoreLink.href).searchParams.get("sheen"), null);
  assert.equal(new URL(mannStoreLink.href).searchParams.get("killstreaker"), null);
});

// A Kit Fabricator's own listing has no bare "Sheen: X" line at all, only a
// parenthesized one inside its OUTPUT section - same fallback
// findFabricatorOutputSheenAndKillstreaker gives the inventory page.
test("falls back to the Fabricator output line's own parenthesized Sheen/Killstreaker when no bare line exists", async () => {
  installGlobals({
    pathname: "/market/listings/440/Professional%20Killstreak%20Minigun%20Kit%20Fabricator",
    schemaFixture: PLAIN_SCHEMA_FIXTURE,
  });
  const { inspectLink } = buildFakeInfoPanel(["(Killstreaker: Fire Horns, Sheen: Mean Green)"]);
  globalThis.document.querySelectorAll = (selector) => (selector === "a" ? [inspectLink] : []);

  const panel = createFakePanel();
  imgQueryResult = { parentElement: panel };

  marketListingLinks();
  await flush();

  const statsRows = panel.children[0].children[0];
  const links = statsRows.children.flatMap((row) => row.children || []).filter((c) => typeof c === "object" && c.href);
  const mannStoreLink = links.find((l) => l.href?.includes("mannco.store"));
  assert.ok(mannStoreLink);
  const mannUrl = new URL(mannStoreLink.href);
  assert.equal(mannUrl.searchParams.get("sheen"), "Mean Green");
  assert.equal(mannUrl.searchParams.get("killstreaker"), "Fire Horns");
});

// gladiator.tf names an Unusual "{Effect} {Item}" (see
// utils/tf2StatsLinks/index.js's buildPricedbSearchName); the effect comes
// from the page's own info panel.
test("REGRESSION: an Unusual's gladiator.tf link searches '{Effect} {Item}' when the page shows the effect", async () => {
  installGlobals({ pathname: "/market/listings/440/Unusual%20Hound%20Dog", schemaFixture: PLAIN_SCHEMA_FIXTURE });
  const { inspectLink } = buildFakeInfoPanel(["Unusual Effect: Stormy Storm"]);
  globalThis.document.querySelectorAll = (selector) => (selector === "a" ? [inspectLink] : []);

  const panel = createFakePanel();
  imgQueryResult = { parentElement: panel };

  marketListingLinks();
  await flush();

  const statsRows = panel.children[0].children[0];
  const links = statsRows.children.flatMap((row) => row.children || []).filter((c) => typeof c === "object" && c.href);
  const gladiatorLink = links.find((l) => l.textContent === "gladiator.tf");
  assert.equal(gladiatorLink.href, "https://gladiator.tf/sales?item=Stormy+Storm+Hound+Dog");
});

// --- the page header's large picture ------------------------------------

// Just enough of an element for showHeaderPictureEffect: children/parent,
// querySelectorAll("img") and ("div, span"), text, dataset and style.
class HeaderEl {
  constructor(tagName, { text = "", src = "" } = {}) {
    this.tagName = tagName.toUpperCase();
    this.textContent = text;
    this.src = src;
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    this.style = {};
  }
  append(...kids) {
    for (const kid of kids) {
      kid.parentElement = this;
      this.children.push(kid);
    }
    return this;
  }
  querySelectorAll(selector) {
    const tags = selector.split(",").map((t) => t.trim().toUpperCase());
    const out = [];
    const walk = (el) => el.children.forEach((child) => (tags.includes(child.tagName) && out.push(child), walk(child)));
    walk(this);
    return out;
  }
}

// The header as Steam renders it (confirmed live): one row holding the image
// panel (with the 360px picture) and the info column with the effect line.
function buildHeader(effectLine) {
  const picture = new HeaderEl("img", { src: "https://community.steamstatic.com/economy/image/abc" });
  picture.width = 360; // laid out at Steam's own --width: min(360px, 95vw)
  const panel = new HeaderEl("div").append(new HeaderEl("div"), picture);
  const infoColumn = new HeaderEl("div").append(new HeaderEl("span", { text: "Level 1 Special Taunt" }));
  if (effectLine) infoColumn.append(new HeaderEl("div", { text: effectLine }));
  const row = new HeaderEl("div").append(panel, infoColumn);
  return { row, panel, picture, infoColumn };
}

function installInstantImage() {
  globalThis.Image = class {
    set src(_url) {
      queueMicrotask(() => this.onload?.());
    }
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("shows the header's own Unusual effect behind its large picture, sharp (380px)", async () => {
  installGlobals({ pathname: "/market/listings/440/Unusual%20Taunt%3A%20Battin'%20a%20Thousand" });
  globalThis.setTimeout = (fn) => queueMicrotask(fn);
  installInstantImage();
  const { panel, picture } = buildHeader("★ Unusual Effect: Midnight Whirlwind");

  showHeaderPictureEffect(panel);
  await settle();

  assert.equal(picture.style.backgroundImage, `url("${PARTICLE_HOST_URL}/380/${UNUSUAL_EFFECT_IDS["Midnight Whirlwind"]}.png")`);
});

test("picks up a header effect line React renders after the picture, and sets up only one watcher per panel", async () => {
  installGlobals({ pathname: "/market/listings/440/Unusual%20Taunt%3A%20Battin'%20a%20Thousand" });
  globalThis.setTimeout = (fn) => queueMicrotask(fn);
  installInstantImage();
  const { panel, picture, infoColumn } = buildHeader(null);

  showHeaderPictureEffect(panel);
  showHeaderPictureEffect(panel);
  assert.equal(FakeMutationObserver.instances.length, 1);
  assert.equal(picture.style.backgroundImage, undefined);

  infoColumn.append(new HeaderEl("div", { text: "★ Unusual Effect: Midnight Whirlwind" }));
  FakeMutationObserver.instances[0].cb();
  await settle();

  assert.match(picture.style.backgroundImage, new RegExp(`/380/${UNUSUAL_EFFECT_IDS["Midnight Whirlwind"]}\.png`));
});

test("leaves the header picture alone on a non-Unusual page (e.g. Keys)", async () => {
  installGlobals({ pathname: "/market/listings/440/Mann%20Co.%20Supply%20Crate%20Key" });
  installInstantImage();
  const { panel, picture } = buildHeader("★ Unusual Effect: Midnight Whirlwind");

  showHeaderPictureEffect(panel);

  assert.equal(picture.style.backgroundImage, undefined);
  assert.equal(FakeMutationObserver.instances.length, 0);
});
