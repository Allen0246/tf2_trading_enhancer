import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isEnglishSteamPage,
  readAssetClassIds,
  getAssetClassIds,
  parseHoverDescription,
  fetchEnglishDescription,
  buildEnglishItemPanel,
  getStampedClassIds,
  loadEnglishPanelForMarketItem,
  __resetEnglishDescriptionCacheForTests,
} from "../steamcommunity.com/shared/englishItemDescription.js";

class FakeElement {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.textContent = "";
    this._attrs = {};
  }
  setAttribute(name, value) {
    this._attrs[name] = String(value);
  }
  getAttribute(name) {
    return this._attrs[name] ?? null;
  }
  appendChild(child) {
    this.children.push(child);
    return child;
  }
}

function installDocument({ lang } = {}) {
  const listeners = {};
  globalThis.document = {
    documentElement: lang === undefined ? {} : { lang },
    createElement: (tag) => new FakeElement(tag),
    addEventListener: (type, fn) => (listeners[type] ||= []).push(fn),
    removeEventListener: (type, fn) => (listeners[type] = (listeners[type] || []).filter((f) => f !== fn)),
    dispatchEvent: (event) => (listeners[event.type] || []).slice().forEach((fn) => fn(event)),
  };
  globalThis.CustomEvent = class {
    constructor(type, init) {
      this.type = type;
      this.detail = init?.detail;
    }
  };
  globalThis.window = {};
}

// Same shape as a live item-hover response (Mann Co. Supply Crate Key,
// trimmed) - the description is the second BuildHover argument.
function hoverHtml(description) {
  return `<div class="clienthoverpage_content"><h1 class="hover_item_name"></h1></div>
<script type="text/javascript">
    var g_rgAppContextData = {"440":{"appid":440,"name":"Team Fortress 2"}};
    fnInitItemDisplay = function() {
      UserYou.LoadContexts( g_rgAppContextData );
      BuildHover( 'economy_item_6ae88353a6c13',  ${JSON.stringify(description)} );
    };
</script>`;
}

const KEY_DESCRIPTION = {
  appid: "440",
  classid: "101785959",
  instanceid: "11040578",
  name: "Mann Co. Supply Crate Key",
  market_hash_name: "Mann Co. Supply Crate Key",
  tradable: 1,
  marketable: 1,
  descriptions: [
    { value: "Used to open locked supply crates.", name: "attribute" },
    { value: " ", name: "attribute" },
    { value: "This is a limited use item. Uses: 1", color: "00a000", name: "attribute", app_data: { limited: 1 } },
  ],
  tags: [
    { internal_name: "Unique", name: "Unique", category: "Quality" },
    { internal_name: "TF_T", name: "Tool", category: "Type" },
  ],
};

// --- isEnglishSteamPage ---

test("isEnglishSteamPage reads <html lang>: Hungarian is not English, en/en-US are", () => {
  installDocument({ lang: "hu" });
  assert.equal(isEnglishSteamPage(), false);
  installDocument({ lang: "en" });
  assert.equal(isEnglishSteamPage(), true);
  installDocument({ lang: "en-US" });
  assert.equal(isEnglishSteamPage(), true);
});

test("isEnglishSteamPage treats a page with no lang as English, so nothing changes there", () => {
  installDocument();
  assert.equal(isEnglishSteamPage(), true);
});

// --- parseHoverDescription ---

test("parseHoverDescription pulls the description object out of an item-hover response", () => {
  assert.deepEqual(parseHoverDescription(hoverHtml(KEY_DESCRIPTION)), KEY_DESCRIPTION);
});

test("parseHoverDescription isn't thrown off by braces or quotes inside string values", () => {
  const description = { name: 'Odd {name} "quoted"', descriptions: [{ value: "} still text {" }] };
  assert.deepEqual(parseHoverDescription(hoverHtml(description)), description);
});

test("parseHoverDescription returns null for a response with no BuildHover call", () => {
  assert.equal(parseHoverDescription("<div>Error</div>"), null);
});

// --- buildEnglishItemPanel ---

function panelLines(panel) {
  return panel.children.filter((c) => c.tagName === "div").map((c) => c.textContent);
}

test("buildEnglishItemPanel renders the title, market link, description lines and a Tags line with the marketable flags", () => {
  installDocument({ lang: "hu" });
  const panel = buildEnglishItemPanel(KEY_DESCRIPTION);

  assert.equal(panel.children.find((c) => c.tagName === "h1").textContent, "Mann Co. Supply Crate Key");
  assert.equal(
    panel.children.find((c) => c.tagName === "a").getAttribute("href"),
    "https://steamcommunity.com/market/listings/440/Mann%20Co.%20Supply%20Crate%20Key"
  );
  assert.deepEqual(panelLines(panel), [
    "Used to open locked supply crates.",
    "This is a limited use item. Uses: 1",
    "Tags: Unique, Tool, Tradable, Marketable",
  ]);
});

test("buildEnglishItemPanel includes the rename notice, strips markup from html-type lines, and marks a non-marketable item", () => {
  installDocument({ lang: "hu" });
  const panel = buildEnglishItemPanel({
    appid: "440",
    name: "''Prescription drugs''",
    market_hash_name: "Unusual Hunter in Darkness",
    tradable: 0,
    marketable: 0,
    fraudwarnings: ['This item has been renamed.\nOriginal name: "Hunter in Darkness"'],
    descriptions: [{ type: "html", value: "★ Unusual Effect: <span>Burning Flames</span> &amp; more" }],
    tags: [{ localized_tag_name: "Unusual" }],
  });

  assert.deepEqual(panelLines(panel), [
    'This item has been renamed.\nOriginal name: "Hunter in Darkness"',
    "★ Unusual Effect: Burning Flames & more",
    "Tags: Unusual, Not Tradable, Not Marketable",
  ]);
});

// --- fetchEnglishDescription ---

test("fetchEnglishDescription asks Steam's item-hover endpoint in English and caches the result per class/instance", async () => {
  __resetEnglishDescriptionCacheForTests();
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(url);
    return { ok: true, text: async () => hoverHtml(KEY_DESCRIPTION) };
  };

  assert.deepEqual(await fetchEnglishDescription("440", "101785959", "11040578"), KEY_DESCRIPTION);
  await fetchEnglishDescription("440", "101785959", "11040578");

  assert.deepEqual(urls, ["https://steamcommunity.com/economy/itemclasshover/440/101785959/11040578?content_only=1&l=english"]);
});

test("fetchEnglishDescription doesn't keep a failed lookup, so the next attempt retries", async () => {
  __resetEnglishDescriptionCacheForTests();
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return calls === 1 ? { ok: false, text: async () => "" } : { ok: true, text: async () => hoverHtml(KEY_DESCRIPTION) };
  };

  assert.equal(await fetchEnglishDescription("440", "1", "2"), null);
  assert.deepEqual(await fetchEnglishDescription("440", "1", "2"), KEY_DESCRIPTION);
  assert.equal(calls, 2);
});

// --- asset class ids ---

const PAGE_DATA = {
  g_rgAppContextData: {
    440: { rgContexts: { 2: { inventory: { m_rgAssets: { 555: { description: { classid: 101785959, instanceid: 11040578 } } } } } } },
  },
};

test("readAssetClassIds reads an asset's class/instance ids from the page's own inventory data", () => {
  assert.deepEqual(readAssetClassIds(PAGE_DATA, "440", "2", "555"), { classid: "101785959", instanceid: "11040578" });
  assert.equal(readAssetClassIds(PAGE_DATA, "440", "2", "999"), null);
  assert.equal(readAssetClassIds(undefined, "440", "2", "555"), null);
});

test("getAssetClassIds reads the page directly through wrappedJSObject (Firefox)", async () => {
  installDocument({ lang: "hu" });
  globalThis.window.wrappedJSObject = PAGE_DATA;
  assert.deepEqual(await getAssetClassIds("440", "2", "555"), { classid: "101785959", instanceid: "11040578" });
});

test("getAssetClassIds falls back to the page-world bridge when wrappedJSObject isn't available", async () => {
  installDocument({ lang: "hu" });
  document.addEventListener("tf2te-asset-class-request", (event) => {
    const { requestId, assetid } = JSON.parse(event.detail);
    assert.equal(assetid, "555");
    document.dispatchEvent(
      new CustomEvent("tf2te-asset-class-response", { detail: JSON.stringify({ requestId, classid: "7", instanceid: "8" }) })
    );
  });

  assert.deepEqual(await getAssetClassIds("440", "2", "555"), { classid: "7", instanceid: "8" });
});

// --- class ids stamped on a Market item by the page script ---

class StampObserver {
  constructor(cb) {
    this.cb = cb;
    StampObserver.instances.push(this);
  }
  observe(target) {
    this.target = target;
  }
  disconnect() {
    this.disconnected = true;
  }
}
StampObserver.instances = [];

function stampedElement(value) {
  const el = new FakeElement("img");
  if (value) el.setAttribute("data-tf2te-class", value);
  return el;
}

test("getStampedClassIds reads the ids the page script stamped on a Market item", async () => {
  assert.deepEqual(await getStampedClassIds(stampedElement("440_9120072447_0")), { appid: "440", classid: "9120072447", instanceid: "0" });
});

test("getStampedClassIds waits for a stamp that lands after it's asked", async () => {
  StampObserver.instances = [];
  globalThis.MutationObserver = StampObserver;
  const el = stampedElement(null);

  const pending = getStampedClassIds(el);
  el.setAttribute("data-tf2te-class", "440_1_2");
  StampObserver.instances.at(-1).cb();

  assert.deepEqual(await pending, { appid: "440", classid: "1", instanceid: "2" });
  assert.equal(StampObserver.instances.at(-1).disconnected, true);
});

test("loadEnglishPanelForMarketItem builds the English panel from the first element with a stamp", async () => {
  installDocument({ lang: "hu" });
  __resetEnglishDescriptionCacheForTests();
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(url);
    return { ok: true, text: async () => hoverHtml({ ...KEY_DESCRIPTION, appid: "440" }) };
  };
  StampObserver.instances = [];
  globalThis.MutationObserver = StampObserver;
  const realSetTimeout = globalThis.setTimeout;
  // The unstamped title gives up at once instead of waiting out the real timeout.
  globalThis.setTimeout = (fn) => {
    fn();
    return 0;
  };

  try {
    const panel = await loadEnglishPanelForMarketItem(stampedElement(null), stampedElement("440_101785959_11040578"));
    assert.equal(panel.children.find((c) => c.tagName === "h1").textContent, "Mann Co. Supply Crate Key");
    assert.deepEqual(urls, ["https://steamcommunity.com/economy/itemclasshover/440/101785959/11040578?content_only=1&l=english"]);
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
});
