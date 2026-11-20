import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

// marketListing.js is a pages/*.js file - run shared.js's real source then
// this page's real source in the same sandbox - see tests/tradeOfferShared.test.js's
// own doc comment for the full rationale.
const sharedSrc = readFileSync(new URL("../steamcommunity.com/tradeOffer/shared.js", import.meta.url), "utf8");
const pageSrc = readFileSync(new URL("../steamcommunity.com/tradeOffer/pages/marketListing.js", import.meta.url), "utf8");

function toPlain(value) {
  return JSON.parse(JSON.stringify(value));
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.style = {};
    this.children = [];
    this._attrs = {};
    this.classList = {
      _set: new Set(),
      add: (...names) => names.forEach((n) => this.classList._set.add(n)),
      remove: (...names) => names.forEach((n) => this.classList._set.delete(n)),
      contains: (n) => this.classList._set.has(n),
    };
  }
  setAttribute(name, value) {
    this._attrs[name] = String(value);
  }
  getAttribute(name) {
    return name in this._attrs ? this._attrs[name] : null;
  }
  hasAttribute(name) {
    return name in this._attrs;
  }
  removeAttribute(name) {
    delete this._attrs[name];
  }
  appendChild(child) {
    this.children.push(child);
    return child;
  }
  getElementsByClassName(name) {
    const out = [];
    const walk = (el) => {
      for (const child of el.children) {
        if (child.classList.contains(name)) out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
  }
  querySelector(selector) {
    // Only ever called with a single class-based selector in this file
    // ("div.market_listing_buy_button a", "div.market_listing_item_img_container",
    // "img.market_listing_item_img") - resolve the trailing tag+class token
    // against a recursive descendant scan.
    const parts = selector.trim().split(/\s+/);
    const last = parts[parts.length - 1];
    const [tag, ...classes] = last.split(".");
    const matches = (el) => {
      if (tag && el.tagName !== tag) return false;
      return classes.every((c) => el.classList.contains(c));
    };
    let found = null;
    const walk = (el) => {
      for (const child of el.children) {
        if (!found && matches(child)) found = child;
        if (!found) walk(child);
      }
    };
    walk(this);
    return found;
  }
}

// FakeElement plus the bit of tree the new Market page code walks: parents,
// span search by text, inserting after an element, removing.
class TreeElement extends FakeElement {
  constructor(tagName, text = "") {
    super(tagName);
    this.parentElement = null;
    this.textContent = text;
  }
  get textContent() {
    return this.children.length ? this.children.map((child) => child.textContent).join("") : this._text;
  }
  set textContent(text) {
    this.children = [];
    this._text = text;
  }
  appendChild(child) {
    child.parentElement = this;
    return super.appendChild(child);
  }
  querySelectorAll(selector) {
    assert.equal(selector, "span");
    const out = [];
    const walk = (el) => el.children.forEach((child) => (child.tagName === "span" && out.push(child), walk(child)));
    walk(this);
    return out;
  }
  insertAdjacentElement(position, el) {
    assert.equal(position, "afterend");
    const siblings = this.parentElement.children;
    siblings.splice(siblings.indexOf(this) + 1, 0, el);
    el.parentElement = this.parentElement;
  }
  remove() {
    const siblings = this.parentElement.children;
    siblings.splice(siblings.indexOf(this), 1);
    this.parentElement = null;
  }
  // On the page when its top ancestor is one (a tile from makeTilePicture).
  get isConnected() {
    let top = this;
    while (top.parentElement) top = top.parentElement;
    return Boolean(top.onPage);
  }
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
  disconnect() {
    this.disconnected = true;
  }
}
FakeMutationObserver.instances = [];

// pictures: what document.querySelectorAll('[style*="--bg-image"]') returns
// on Steam's current (React) Market page, which has no #searchResultsRows.
const UNUSUAL_PAGE = "/market/listings/440/Unusual%20Taunt%3A%20Battin'%20a%20Thousand";

// pageText: what document.body.textContent reads (the grouped layout's
// "for sale starting at" line is what marks a commodity page).
function loadMarketListingPage({
  resultsRowsEl,
  pictures = [],
  effectsMap = {},
  bundledParticleIds = [],
  pathname = UNUSUAL_PAGE,
  pageText = "Found 54 results",
  lang,
  fetch,
  stampable = [],
} = {}) {
  FakeMutationObserver.instances = [];
  const listeners = {};
  const dataset = { tf2teExtensionUrl: "moz-extension://test/" };
  const fakeDocument = {
    documentElement: { dataset, lang },
    createElement: (tag) => new TreeElement(tag),
    getElementById: (id) => (id === "searchResultsRows" ? resultsRowsEl : null),
    querySelectorAll: (selector) => {
      // Item titles/pictures stamped with their class ids on a non-English
      // page (see stampItemClassIds) - none in these fixtures.
      if (selector === 'h2, img[src*="/economy/image/"]') return stampable;
      assert.equal(selector, '[style*="--bg-image"]');
      return pictures;
    },
    body: { appendChild: () => {}, removeChild: () => {}, execCommand: () => {}, textContent: pageText },
    execCommand: () => {},
    addEventListener: (type, cb, opts) => (listeners[type] ||= []).push({ cb, once: opts?.once }),
    dispatchEvent: (evt) => {
      const registered = listeners[evt.type] || [];
      listeners[evt.type] = registered.filter((l) => !l.once);
      registered.forEach((l) => l.cb(evt));
      return true;
    },
  };
  const windowObj = {
    jQuery: undefined,
    location: { search: "", pathname },
    __tf2teUnusualEffectsMap__: effectsMap,
    __tf2teBundledParticleIds__: bundledParticleIds,
    CDelayedAJAXData: class { RunWhenAJAXReady() {} },
    g_rgAssets: {},
  };
  windowObj.window = windowObj;
  windowObj.MutationObserver = FakeMutationObserver;

  const localStorageStore = {};
  const localStorage = {
    getItem: (k) => (k in localStorageStore ? localStorageStore[k] : null),
    setItem: (k, v) => { localStorageStore[k] = String(v); },
    removeItem: (k) => { delete localStorageStore[k]; },
    key: (i) => Object.keys(localStorageStore)[i],
    get length() { return Object.keys(localStorageStore).length; },
  };

  const sandbox = {
    window: windowObj,
    document: fakeDocument,
    localStorage,
    console,
    MutationObserver: FakeMutationObserver,
    setTimeout: (fn) => { fn(); return 0; },
    clearTimeout: () => {},
    CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; Object.assign(this, init); } },
    fetch,
    // Steam's stylesheet draws a tile picture's --bg-image as its own
    // background; an inline style (ours) wins over it, like in a browser.
    getComputedStyle: (el) => ({
      backgroundImage: el.style.backgroundImage || (el.drawsOwnBackground ? 'url("https://community.steamstatic.com/economy/image/abc")' : "none"),
      backgroundSize: el.style.backgroundSize || "contain",
      backgroundPosition: el.style.backgroundPosition || "50% 50%",
      backgroundRepeat: el.style.backgroundRepeat || "no-repeat",
    }),
  };
  vm.createContext(sandbox);
  vm.runInContext(sharedSrc, sandbox);
  vm.runInContext(pageSrc, sandbox);

  const entry = sandbox.window.__tf2te__.scripts.find((s) => s.includes.some((p) => p.source.includes("market")));
  return { sandbox, entry, DEPS: sandbox.window.__tf2te__.DEPS };
}

// Builds a market_listing_row with a buy-button link encoding
// BuyMarketListing('g_rgCurrentAsset','440','2','12345') and an item image
// container, exactly the markup shape getItem()/getAsset() parse.
function makeRowEl({ appid = "440", contextid = "2", assetid = "12345", imgSrc = "https://example.com/a.png" } = {}) {
  const rowEl = new FakeElement("div");
  rowEl.classList.add("market_listing_row");

  const buyButtonEl = new FakeElement("div");
  buyButtonEl.classList.add("market_listing_buy_button");
  const linkEl = new FakeElement("a");
  // getItem() destructures with two leading commas ([ , , appid, contextid,
  // assetid] = split) after splitting the href on single-quoted groups, so
  // the first two quoted tokens are skipped entirely - mirroring Steam's own
  // real BuyMarketListing(...) onclick/href signature, which leads with a
  // couple of non-positional args before appid/contextid/assetid.
  linkEl.setAttribute("href", `javascript:BuyMarketListing( 'g_rgCurrentAsset', 'listing123', '${appid}', '${contextid}', '${assetid}' )`);
  buyButtonEl.appendChild(linkEl);
  rowEl.appendChild(buyButtonEl);

  const imgContainerEl = new FakeElement("div");
  imgContainerEl.classList.add("market_listing_item_img_container");
  const imgEl = new FakeElement("img");
  imgEl.classList.add("market_listing_item_img");
  imgEl.setAttribute("src", imgSrc);
  imgEl.setAttribute("style", "border: 1px solid black;");
  imgContainerEl.appendChild(imgEl);
  rowEl.appendChild(imgContainerEl);

  return { rowEl, imgContainerEl, imgEl };
}

test("registers exactly one script matching /market/listings/440/ URLs", () => {
  const { entry } = loadMarketListingPage();
  assert.ok(entry);
  assert.match("https://steamcommunity.com/market/listings/440/Rocket%20Launcher", entry.includes[0]);
  assert.equal(entry.includes[0].test("https://steamcommunity.com/market/listings/730/AWP"), false);
});

test("fn() wraps each row's item image in a new hoverable overlay element and adds attributes from the matched asset", () => {
  const { rowEl, imgContainerEl, imgEl } = makeRowEl();
  const resultsRowsEl = new FakeElement("div");
  resultsRowsEl.setAttribute("id", "searchResultsRows");
  resultsRowsEl.appendChild(rowEl);

  const { entry, DEPS, sandbox } = loadMarketListingPage({ resultsRowsEl });
  sandbox.window.g_rgAssets = {
    440: { 2: { 12345: { name_color: "7D6D00", market_hash_name: "Rocket Launcher", type: null, name: "Rocket Launcher", descriptions: [] } } },
  };

  entry.fn(DEPS);

  // A new wrapper div was inserted into the image container, holding the
  // (moved) original img element.
  const wrapperEl = imgContainerEl.children.find((c) => c !== imgEl);
  assert.ok(wrapperEl);
  assert.equal(wrapperEl.classList.contains("economy_item_hoverable"), true);
  assert.equal(wrapperEl.style.backgroundImage, "url('https://example.com/a.png')");
  assert.equal(wrapperEl.children.includes(imgEl), true);

  // the original img element had its own background-sizing class stripped
  // (now handled by the wrapper) and its background made transparent.
  assert.equal(imgEl.classList.contains("market_listing_item_img"), false);
  assert.equal(imgEl.style.backgroundColor, "transparent");

  // attributes were added to the new wrapper element (data-checked proves
  // the real getItemAttributes/addAttributesToElement pipeline ran).
  assert.equal(wrapperEl.hasAttribute("data-checked"), true);
});

test("fn() skips a row with no matching asset in window.g_rgAssets, without throwing", () => {
  const { rowEl } = makeRowEl({ assetid: "99999" }); // no matching asset registered below
  const resultsRowsEl = new FakeElement("div");
  resultsRowsEl.appendChild(rowEl);

  const { entry, DEPS, sandbox } = loadMarketListingPage({ resultsRowsEl });
  sandbox.window.g_rgAssets = { 440: { 2: {} } }; // no 99999 entry

  assert.doesNotThrow(() => entry.fn(DEPS));
});

test("fn() skips a row with no buy-button link at all", () => {
  const rowEl = new FakeElement("div");
  rowEl.classList.add("market_listing_row"); // getItem() returns null - no crash expected
  const resultsRowsEl = new FakeElement("div");
  resultsRowsEl.appendChild(rowEl);

  const { entry, DEPS } = loadMarketListingPage({ resultsRowsEl });

  assert.doesNotThrow(() => entry.fn(DEPS));
});

test("fn() re-runs addAttributesToResults whenever the results container mutates", () => {
  const resultsRowsEl = new FakeElement("div");
  const { entry, DEPS } = loadMarketListingPage({ resultsRowsEl });

  entry.fn(DEPS);
  assert.equal(FakeMutationObserver.instances.length, 1);
  assert.equal(FakeMutationObserver.instances[0].target, resultsRowsEl);
  assert.deepEqual(toPlain(FakeMutationObserver.instances[0].opts), { childList: true });

  const { rowEl } = makeRowEl();
  resultsRowsEl.appendChild(rowEl);
  assert.doesNotThrow(() => FakeMutationObserver.instances[0].cb());
});

// A row still present when the observer re-runs (its image already wrapped,
// so the img no longer carries market_listing_item_img) used to throw a
// TypeError on itemImgEl.getAttribute, aborting every later row in the pass.
test("fn() leaves an already-wrapped row alone on a later pass, without throwing", () => {
  const { rowEl, imgContainerEl } = makeRowEl();
  const resultsRowsEl = new FakeElement("div");
  resultsRowsEl.appendChild(rowEl);

  const { entry, DEPS, sandbox } = loadMarketListingPage({ resultsRowsEl });
  sandbox.window.g_rgAssets = {
    440: { 2: { 12345: { name_color: "7D6D00", market_hash_name: "Rocket Launcher", type: null, name: "Rocket Launcher", descriptions: [] } } },
  };

  entry.fn(DEPS);
  const childCountAfterFirstPass = imgContainerEl.children.length;

  assert.doesNotThrow(() => FakeMutationObserver.instances[0].cb());
  assert.equal(imgContainerEl.children.length, childCountAfterFirstPass);
});

// --- Steam's current (React) Market page --------------------------------

// A listing as Steam's React tiles carry it (same shape as its
// QueryListingsForItem answer, trimmed to what's read).
function makeListing(listingid, effectName) {
  const descriptions = [{ value: "Scout Taunt" }];
  if (effectName) descriptions.unshift({ value: `★ Unusual Effect: ${effectName}`, color: "ffd700" });
  return { listingid, description: { name: TILE_NAME, market_name: TILE_NAME, descriptions } };
}

const TILE_NAME = "Unusual Taunt: Battin' a Thousand";

// A listing tile shaped like Steam's (confirmed live): a header with the type
// line and the name (inside its own wrapper), then the picture: a <div> whose
// stylesheet paints the --bg-image variable, its React element a few
// component levels below the one holding props.listing.
function makeTilePicture(listing, { style = "--bg-image: url(https://community.steamstatic.com/economy/image/abc);" } = {}) {
  const tile = new TreeElement("div");
  tile.onPage = true;
  const header = tile.appendChild(new TreeElement("div"));
  header.appendChild(new TreeElement("span", "Level 81 Special Taunt"));
  const nameWrapper = header.appendChild(new TreeElement("div"));
  nameWrapper.appendChild(new TreeElement("span", TILE_NAME));
  const pictureBox = tile.appendChild(new TreeElement("div"));
  const picture = pictureBox.appendChild(new TreeElement("div"));
  picture.setAttribute("style", style);
  picture.drawsOwnBackground = true;
  picture.header = header;

  let fiber = { memoizedProps: { listing, expectEnhancedAppearance: false }, return: null };
  for (let i = 0; i < 5; i++) fiber = { memoizedProps: {}, return: fiber };
  picture.__reactFiber$test = fiber;
  picture.setListing = (next) => {
    let top = picture.__reactFiber$test;
    while (top.return) top = top.return;
    top.memoizedProps = { listing: next };
  };
  return picture;
}

// A Killstreak weapon's listing, with the lines Steam shows for it.
function makeKillstreakListing(listingid, { sheen, killstreaker } = {}) {
  const descriptions = [{ value: "Killstreaks Active", color: "7ea9d1" }];
  if (sheen) descriptions.push({ value: `Sheen: ${sheen}`, color: "7ea9d1" });
  if (killstreaker) descriptions.push({ value: `Killstreaker: ${killstreaker}`, color: "7ea9d1" });
  return { listingid, description: { name: TILE_NAME, market_name: TILE_NAME, descriptions } };
}

const EFFECTS = { "Silver Cyclone": 3010, "Mega Strike": 3011 };

const BUNDLED_3010 = "url('moz-extension://test/images/particles/94/3010.png')";

test("new Market page: puts each listing tile's Unusual effect under its picture as a second background layer", () => {
  const picture = makeTilePicture(makeListing("717899428255490194", "Silver Cyclone"));
  const { entry, DEPS } = loadMarketListingPage({ pictures: [picture], effectsMap: EFFECTS, bundledParticleIds: [3010] });

  entry.fn(DEPS);

  // The item stays on top with Steam's own size/position; the effect is under it.
  assert.equal(picture.style.backgroundImage, `var(--bg-image), ${BUNDLED_3010}`);
  assert.equal(picture.style.backgroundSize, "contain, contain");
  assert.equal(picture.style.backgroundPosition, "50% 50%, center");
  assert.equal(picture.style.backgroundRepeat, "no-repeat, no-repeat");
  assert.equal(picture.getAttribute("data-tf2te-listing"), "717899428255490194");
});

test("new Market page: a listing without an Unusual effect gets no extra layer", () => {
  const picture = makeTilePicture(makeListing("1", null));
  const { entry, DEPS } = loadMarketListingPage({ pictures: [picture], effectsMap: EFFECTS });

  entry.fn(DEPS);

  assert.equal(picture.style.backgroundImage, "");
});

test("new Market page: leaves pictures that aren't Steam item images, or have no listing, alone", () => {
  const notAnItem = makeTilePicture(makeListing("2", "Silver Cyclone"), { style: "--bg-image: url(https://example.com/banner.png);" });
  const noListing = new FakeElement("div");
  noListing.setAttribute("style", "--bg-image: url(https://community.steamstatic.com/economy/image/abc);");
  const { entry, DEPS } = loadMarketListingPage({ pictures: [notAnItem, noListing], effectsMap: EFFECTS });

  entry.fn(DEPS);

  assert.equal(notAnItem.style.backgroundImage, undefined);
  assert.equal(noListing.style.backgroundImage, undefined);
});

test("new Market page: a tile React reuses for another listing gets that listing's effect on the next change", () => {
  const picture = makeTilePicture(makeListing("1", "Silver Cyclone"));
  const { entry, DEPS } = loadMarketListingPage({ pictures: [picture], effectsMap: EFFECTS, bundledParticleIds: [3010, 3011] });
  entry.fn(DEPS);

  const observer = FakeMutationObserver.instances.at(-1);
  assert.deepEqual(toPlain(observer.opts), { childList: true, subtree: true, characterData: true });

  picture.setListing(makeListing("2", "Mega Strike"));
  observer.cb();
  assert.equal(picture.style.backgroundImage, "var(--bg-image), url('moz-extension://test/images/particles/94/3011.png')");
  // Steam's own values are read with ours removed, so layers don't pile up.
  assert.equal(picture.style.backgroundSize, "contain, contain");

  picture.setListing(makeListing("3", null));
  observer.cb();
  assert.equal(picture.style.backgroundImage, "");
  assert.equal(picture.style.backgroundSize, "");
});

test("new Market page: an effect newer than the bundled set loads from our own host", () => {
  const picture = makeTilePicture(makeListing("1", "Mega Strike"));
  const { entry, DEPS } = loadMarketListingPage({ pictures: [picture], effectsMap: EFFECTS, bundledParticleIds: [3010] });

  entry.fn(DEPS);

  assert.match(picture.style.backgroundImage, /^var\(--bg-image\), url\('https:\/\/tf2te-assets\.[^']+\/particles\/94\/3011\.png'\)$/);
});

const KEY_PAGE_TEXT = "59,116 for sale starting at €1,91\n476,548 requests to buy at €1,90 or lower";

test("new Market page: leaves the grouped (order-book) layout alone, e.g. Keys", () => {
  const picture = makeTilePicture(makeListing("1", "Silver Cyclone"));
  const { entry, DEPS } = loadMarketListingPage({
    pictures: [picture],
    effectsMap: EFFECTS,
    pathname: "/market/listings/440/Mann%20Co.%20Supply%20Crate%20Key",
    pageText: KEY_PAGE_TEXT,
  });

  entry.fn(DEPS);

  assert.equal(picture.style.backgroundImage, undefined);
  assert.equal(FakeMutationObserver.instances.length, 0);
});

test("new Market page: stops watching once a page that rendered late turns out to be the grouped layout", () => {
  const { entry, DEPS, sandbox } = loadMarketListingPage({ pathname: "/market/listings/440/Mann%20Co.%20Supply%20Crate%20Key", pageText: "" });
  entry.fn(DEPS);
  const observer = FakeMutationObserver.instances.at(-1);
  assert.equal(observer.disconnected, undefined);

  sandbox.document.body.textContent = KEY_PAGE_TEXT;
  observer.cb();

  assert.equal(observer.disconnected, true);
});

test("new Market page: runs on any individual-listings page, not just an Unusual's", () => {
  const listing = makeKillstreakListing("1");
  listing.description.descriptions.push({ value: "Halloween: Exorcism (spell only active during event)", color: "7ea9d1" });
  const picture = makeTilePicture(listing);
  const { entry, DEPS } = loadMarketListingPage({ pictures: [picture], effectsMap: EFFECTS, pathname: "/market/listings/440/Strange%20Holy%20Mackerel" });

  entry.fn(DEPS);

  assert.equal(picture.getAttribute("data-tf2te-listing"), "1");
});

// Confirmed live (Steam in Hungarian): a listing's description is translated,
// so the effect is read from its English description instead.
async function settle() {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
}

test("new Market page in another language: the effect comes from the listing's English description", async () => {
  const hungarianLine = { value: "★ Rendkívüli effekt: Ezüst ciklon", color: "ffd700" };
  const listing = {
    listingid: "9",
    description: { appid: 440, classid: "500", instanceid: "600", name: TILE_NAME, market_name: TILE_NAME, descriptions: [hungarianLine, { value: "Scout gúnyolódás" }] },
  };
  const picture = makeTilePicture(listing);
  const urls = [];
  const english = { descriptions: [{ value: "★ Unusual Effect: Silver Cyclone", color: "ffd700" }, { value: "Scout Taunt" }] };
  const { entry, DEPS } = loadMarketListingPage({
    pictures: [picture],
    effectsMap: EFFECTS,
    bundledParticleIds: [3010],
    lang: "hu",
    fetch: async (url) => {
      urls.push(url);
      return { ok: true, text: async () => `<script>BuildHover( 'economy_item_1', ${JSON.stringify(english)} );</script>` };
    },
  });

  entry.fn(DEPS);
  // Nothing done from the translated text while the English one loads.
  assert.equal(picture.getAttribute("data-tf2te-listing"), null);

  await settle();

  assert.deepEqual(urls, ["https://steamcommunity.com/economy/itemclasshover/440/500/600?content_only=1&l=english"]);
  assert.equal(picture.style.backgroundImage, `var(--bg-image), ${BUNDLED_3010}`);
});

// The isolated scripts can't see React's data, so on a non-English page each
// item title and picture is stamped with its class ids for them (confirmed
// live: the header title's props carry them 3 levels up, as `value`).
test("on a non-English page, stamps each item title with its class ids from React's data", () => {
  const title = new TreeElement("h2", "Fura Rendkívüli Fenséges Föveg");
  let fiber = { memoizedProps: { value: { appid: 440, classid: "9120072447", instanceid: "0" } }, return: null };
  for (let i = 0; i < 3; i++) fiber = { memoizedProps: {}, return: fiber };
  title.__reactFiber$test = fiber;
  const { entry, DEPS } = loadMarketListingPage({ lang: "hu", stampable: [title] });

  entry.fn(DEPS);

  assert.equal(title.getAttribute("data-tf2te-class"), "440_9120072447_0");
});

test("on an English page, stamps nothing", () => {
  const title = new TreeElement("h2", "Unusual Lordly Lid");
  title.__reactFiber$test = { memoizedProps: { value: { classid: "1", instanceid: "0" } }, return: null };
  const { entry, DEPS } = loadMarketListingPage({ stampable: [title] });

  entry.fn(DEPS);

  assert.equal(title.getAttribute("data-tf2te-class"), null);
});

// Confirmed live: a listing carries the currency its price is shown in
// (eCurrency 3, unPrice + unFee = 21507 on a tile showing "215,07 EUR"); the
// page has no g_rgWalletInfo, so it's put on <html> for the isolated scripts.
test("new Market page: puts the listings' currency on <html> for the isolated scripts", () => {
  const listing = makeListing("1", "Silver Cyclone");
  listing.eCurrency = 3;
  const picture = makeTilePicture(listing);
  const { entry, DEPS, sandbox } = loadMarketListingPage({ pictures: [picture], effectsMap: EFFECTS });

  entry.fn(DEPS);

  assert.equal(sandbox.document.documentElement.dataset.tf2teWalletCurrency, "3");
});
