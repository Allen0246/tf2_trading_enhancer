import { test } from "node:test";
import assert from "node:assert/strict";
import {
  iterateLeafTexts,
  findLabeledValue,
  createStatsRow,
  unlockImagePanelLayout,
  findImagePanel,
  waitForImagePanel,
  getMarketListingItemNameFromUrl,
  BARS_ICON_SVG,
  HISTORY_ICON_SVG,
  findInfoPanelAncestor,
  findMarketInfoPanels,
  findListingBuyButtons,
  isDisplayedPriceText,
} from "../steamcommunity.com/shared/priceWidgets.js";

function createFakeElement() {
  return {
    style: {},
    children: [],
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    append(x) {
      this.children.push(x);
    },
  };
}

function installFakeDocument({ querySelector } = {}) {
  global.document = {
    createElement: () => createFakeElement(),
    querySelector: querySelector || (() => null),
  };
}

// --- getMarketListingItemNameFromUrl ---------------------------------------

test("getMarketListingItemNameFromUrl decodes the item name out of a market listing URL", () => {
  global.window = { location: { pathname: "/market/listings/440/Strange%20Voodoo%20Juju" } };
  assert.equal(getMarketListingItemNameFromUrl(), "Strange Voodoo Juju");
});

test("getMarketListingItemNameFromUrl returns null for a non-listing URL", () => {
  global.window = { location: { pathname: "/id/someuser/inventory" } };
  assert.equal(getMarketListingItemNameFromUrl(), null);
});

// --- iterateLeafTexts / findLabeledValue -----------------------------------

function fakeLeafEl(text) {
  return { children: [], textContent: text };
}
function fakeWrapperEl(childCount) {
  return { children: new Array(childCount).fill(0), textContent: "should never be read" };
}
function fakeContainer(els) {
  return { querySelectorAll: () => els };
}

test("iterateLeafTexts yields trimmed text of leaf div/span elements only, skipping elements with children", () => {
  const wrapper = fakeWrapperEl(3); // e.g. the 3-leaf-div wrapper from the doc comment
  const leafA = fakeLeafEl("  Killstreaker: Fire Horns  ");
  const leafB = fakeLeafEl("Sheen: Team Shine");
  const empty = fakeLeafEl("   ");

  const container = fakeContainer([wrapper, leafA, leafB, empty]);

  assert.deepEqual([...iterateLeafTexts(container)], ["Killstreaker: Fire Horns", "Sheen: Team Shine"]);
});

test("iterateLeafTexts tolerates a leaf with no textContent at all", () => {
  const container = fakeContainer([{ children: [], textContent: undefined }, fakeLeafEl("Level: 42")]);
  assert.deepEqual([...iterateLeafTexts(container)], ["Level: 42"]);
});

test("findLabeledValue returns the captured group of the first matching leaf text", () => {
  const container = fakeContainer([fakeLeafEl("Killstreaks Active"), fakeLeafEl("Sheen: Team Shine")]);
  assert.equal(findLabeledValue(container, /^Sheen:\s*(.+)$/), "Team Shine");
});

test("findLabeledValue returns null when no leaf text matches", () => {
  const container = fakeContainer([fakeLeafEl("Killstreaks Active")]);
  assert.equal(findLabeledValue(container, /^Sheen:\s*(.+)$/), null);
});

// --- unlockImagePanelLayout -------------------------------------------------

test("unlockImagePanelLayout sets flexWrap and removes the --max-height cap", () => {
  const properties = {};
  const panel = { style: { setProperty: (name, value) => (properties[name] = value) } };

  unlockImagePanelLayout(panel);

  assert.equal(panel.style.flexWrap, "wrap");
  assert.equal(properties["--max-height"], "none");
});

// --- createStatsRow ------------------------------------------------------

test("createStatsRow returns null when statsHref, classifiedsHref, and historyHref are all absent", () => {
  installFakeDocument();
  assert.equal(createStatsRow("backpack.tf", null, null), null);
  assert.equal(createStatsRow("backpack.tf", "", ""), null);
  assert.equal(createStatsRow("backpack.tf", null, null, null), null);
});

test("createStatsRow includes exactly one link (the stats link) when only statsHref is given", () => {
  installFakeDocument();
  const row = createStatsRow("backpack.tf", "https://backpack.tf/stats", null);

  const links = row.children.filter((c) => c && typeof c === "object" && "href" in c);
  assert.equal(links.length, 1);
  assert.equal(links[0].href, "https://backpack.tf/stats");
  assert.equal(links[0].title, "backpack.tf stats");
  assert.equal(links[0].innerHTML, BARS_ICON_SVG);
});

test("createStatsRow includes both links, each wired to its own href, when both are given", () => {
  installFakeDocument();
  const row = createStatsRow("backpack.tf", "https://backpack.tf/stats", "https://backpack.tf/classifieds");

  const links = row.children.filter((c) => c && typeof c === "object" && "href" in c);
  assert.equal(links.length, 2);
  assert.equal(links[0].href, "https://backpack.tf/stats");
  assert.equal(links[1].href, "https://backpack.tf/classifieds");
  assert.equal(links[1].textContent, "📰");
});

test("createStatsRow includes a third history icon link, wired to historyHref, when given alongside the other two", () => {
  installFakeDocument();
  const row = createStatsRow(
    "backpack.tf",
    "https://backpack.tf/stats",
    "https://backpack.tf/classifieds",
    "https://backpack.tf/item/17342991567"
  );

  const links = row.children.filter((c) => c && typeof c === "object" && "href" in c);
  assert.equal(links.length, 3);
  assert.equal(links[2].href, "https://backpack.tf/item/17342991567");
  assert.equal(links[2].title, "View this exact item's history on backpack.tf");
  assert.equal(links[2].innerHTML, HISTORY_ICON_SVG);
});

test("createStatsRow builds a row with only the history icon when neither statsHref nor classifiedsHref is given", () => {
  installFakeDocument();
  const row = createStatsRow("backpack.tf", null, null, "https://backpack.tf/item/17342991567");

  const links = row.children.filter((c) => c && typeof c === "object" && "href" in c);
  assert.equal(links.length, 1);
  assert.equal(links[0].href, "https://backpack.tf/item/17342991567");
});

// --- findImagePanel --------------------------------------------------------

test("findImagePanel returns the matching image's parentElement", () => {
  const parent = { id: "panel" };
  installFakeDocument({
    querySelector: (selector) => {
      assert.equal(selector, 'img[src*="steamstatic.com/economy/image/"]');
      return { parentElement: parent };
    },
  });
  assert.equal(findImagePanel(), parent);
});

test("findImagePanel returns null when no matching image is found yet", () => {
  installFakeDocument({ querySelector: () => null });
  assert.equal(findImagePanel(), null);
});

// --- waitForImagePanel -------------------------------------------------

// Captures MutationObserver instances (mirrors the pattern used by
// tests/sellDuplicates.test.js for the same class of DOM-orchestration code)
// plus fake setTimeout/clearTimeout so the 15s default timeout can be driven
// synchronously instead of actually waiting on it.
class FakeMutationObserver {
  constructor(cb) {
    this.cb = cb;
    this.disconnected = false;
    FakeMutationObserver.instances.push(this);
  }
  observe(target, opts) {
    this.target = target;
    this.opts = opts;
  }
  disconnect() {
    this.disconnected = true;
  }
}
FakeMutationObserver.instances = [];

function installObserverGlobals() {
  FakeMutationObserver.instances = [];
  global.MutationObserver = FakeMutationObserver;
  global.document.body = { id: "body" };

  const timeouts = [];
  const cleared = new Set();
  let nextId = 1;
  global.setTimeout = (fn, delay) => {
    const id = nextId++;
    timeouts.push({ id, fn, delay });
    return id;
  };
  global.clearTimeout = (id) => cleared.add(id);

  return { timeouts, cleared };
}

test("waitForImagePanel calls back immediately (no observer) when the image is already present", () => {
  const parent = { id: "panel" };
  installFakeDocument({ querySelector: () => ({ parentElement: parent }) });
  installObserverGlobals();

  let called = null;
  waitForImagePanel((panel) => (called = panel));

  assert.equal(called, parent);
  assert.equal(FakeMutationObserver.instances.length, 0);
});

test("waitForImagePanel watches via MutationObserver until the image appears, then disconnects and clears the timeout", () => {
  let queryResult = null;
  installFakeDocument({ querySelector: () => queryResult });
  const { timeouts, cleared } = installObserverGlobals();

  let called = null;
  waitForImagePanel((panel) => (called = panel));

  assert.equal(called, null); // not found yet
  assert.equal(FakeMutationObserver.instances.length, 1);
  assert.equal(FakeMutationObserver.instances[0].target, document.body);
  assert.equal(timeouts.length, 1);
  assert.equal(timeouts[0].delay, 15000);

  // Image shows up later - simulate the next mutation notification.
  const parent = { id: "panel" };
  queryResult = { parentElement: parent };
  FakeMutationObserver.instances[0].cb();

  assert.equal(called, parent);
  assert.equal(FakeMutationObserver.instances[0].disconnected, true);
  assert.equal(cleared.has(timeouts[0].id), true);
});

test("waitForImagePanel disconnects the observer if the image never appears before timeoutMs", () => {
  installFakeDocument({ querySelector: () => null });
  const { timeouts } = installObserverGlobals();

  waitForImagePanel(() => {}, 5000);

  assert.equal(timeouts[0].delay, 5000);
  assert.equal(FakeMutationObserver.instances[0].disconnected, false);

  timeouts[0].fn(); // simulate the timeout firing

  assert.equal(FakeMutationObserver.instances[0].disconnected, true);
});

test("a mutation notification that still finds nothing leaves the observer connected and doesn't call back", () => {
  installFakeDocument({ querySelector: () => null });
  installObserverGlobals();

  let called = false;
  waitForImagePanel(() => (called = true));

  FakeMutationObserver.instances[0].cb(); // still nothing found

  assert.equal(called, false);
  assert.equal(FakeMutationObserver.instances[0].disconnected, false);
});

// --- findInfoPanelAncestor / findMarketInfoPanels --------------------------
// Moved here from steamcommunity.com/marketListingModal/content.js (which
// still uses it for its own per-listing modal) so
// steamcommunity.com/marketListingLinks/content.js could reuse it for the
// main listing page's own single item panel without importing the modal
// module itself.

class FakePanelElement {
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
    return null;
  }
}

test("findInfoPanelAncestor walks up until it finds an ancestor with a direct h2 child", () => {
  global.document = { body: new FakePanelElement("body") };
  const infoPanel = new FakePanelElement("div");
  infoPanel.appendChild(new FakePanelElement("h2", { textContent: "Some Item" }));
  const wrapper = infoPanel.appendChild(new FakePanelElement("div"));
  const link = wrapper.appendChild(new FakePanelElement("a", { textContent: "Inspect in Game..." }));

  assert.equal(findInfoPanelAncestor(link), infoPanel);
});

test("findInfoPanelAncestor returns null when no ancestor up to document.body has a direct h2 child", () => {
  global.document = { body: new FakePanelElement("body") };
  const wrapper = new FakePanelElement("div");
  wrapper.parentElement = global.document.body;
  const link = wrapper.appendChild(new FakePanelElement("a"));

  assert.equal(findInfoPanelAncestor(link), null);
});

test("findMarketInfoPanels finds a panel via an 'Inspect in Game...' link OR a 'Buy' button, deduplicating one panel found via both", () => {
  const infoPanel = new FakePanelElement("div");
  infoPanel.appendChild(new FakePanelElement("h2", { textContent: "Some Item" }));
  const inspectLink = infoPanel.appendChild(new FakePanelElement("a", { textContent: "Inspect in Game..." }));
  const buyButton = infoPanel.appendChild(new FakePanelElement("button", { textContent: "Buy" }));

  global.document = {
    body: new FakePanelElement("body"),
    querySelectorAll: (selector) => (selector === "a" ? [inspectLink] : selector === "button" ? [buyButton] : []),
  };

  assert.deepEqual(findMarketInfoPanels(), [infoPanel]); // same panel found via both anchors, only once
});

test("findMarketInfoPanels returns an empty array when neither anchor is present", () => {
  global.document = { body: new FakePanelElement("body"), querySelectorAll: () => [] };
  assert.deepEqual(findMarketInfoPanels(), []);
});

// Confirmed live (Steam in Hungarian): the Inspect link reads "Megvizsgálás
// játékban…" and the Buy button "Vétel", so neither English label matched and
// the listing modal got no links at all. The Buy button is now recognized by
// the price right before it.
test("findMarketInfoPanels finds a panel on a translated page by its Buy button's price, not its label", () => {
  const infoPanel = new FakePanelElement("div");
  infoPanel.appendChild(new FakePanelElement("h2", { textContent: "Fura Rendkívüli Fenséges Föveg" }));
  const priceEl = infoPanel.appendChild(new FakePanelElement("span"));
  priceEl.firstChild = { textContent: "215,07 EUR" };
  const buyButton = infoPanel.appendChild(new FakePanelElement("button", { textContent: "Vétel" }));
  buyButton.previousElementSibling = priceEl;
  const inspectLink = infoPanel.appendChild(new FakePanelElement("a", { textContent: "Megvizsgálás játékban…" }));

  global.document = {
    body: new FakePanelElement("body"),
    querySelectorAll: (selector) => (selector === "a" ? [inspectLink] : selector === "button" ? [buyButton] : []),
  };

  assert.deepEqual(findMarketInfoPanels(), [infoPanel]);
});

test("findListingBuyButtons skips a button with no price right before it", () => {
  const notAPrice = new FakePanelElement("span");
  notAPrice.firstChild = { textContent: "Nem látod a kívánt tételt vagy árat?" };
  const button = new FakePanelElement("button", { textContent: "Vételi ajánlat létrehozása" });
  button.previousElementSibling = notAPrice;
  global.document = { querySelectorAll: () => [button] };

  assert.deepEqual(findListingBuyButtons(), []);
});

test("isDisplayedPriceText accepts a price in any wallet currency's format, and nothing else", () => {
  for (const text of ["€6.57", "215,07 EUR", "$1,234.56 USD", "1 234,56 pуб.", "¥ 1,234", "2,--€"]) {
    assert.equal(isDisplayedPriceText(text), true, text);
  }
  for (const text of ["", "Sold out", "1 of 35", "Uses: 1", "12 venne", "Level 5 Tool"]) {
    assert.equal(isDisplayedPriceText(text), false, text);
  }
});
