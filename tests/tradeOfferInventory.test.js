import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

// vm.createContext gives the sandboxed code its own realm, with its own
// Object prototype distinct from this test file's own - so a plain object
// RETURNED from sandboxed code (e.g. MutationObserver's own `opts` argument)
// fails assert.deepEqual's prototype-identity check against an outer-realm
// literal even with identical own properties. See tests/tradeOfferShared.test.js's
// own toPlain() for the same issue/fix.
function toPlain(value) {
  return JSON.parse(JSON.stringify(value));
}

// inventory.js is a pages/*.js file - run shared.js's real source then this
// page's real source in the same sandbox - see tests/tradeOfferShared.test.js's
// own doc comment for the full rationale.
const sharedSrc = readFileSync(new URL("../steamcommunity.com/tradeOffer/shared.js", import.meta.url), "utf8");
const pageSrc = readFileSync(new URL("../steamcommunity.com/tradeOffer/pages/inventory.js", import.meta.url), "utf8");

class FakeElement {
  constructor(tagName, id) {
    this.tagName = tagName;
    this.id = id || "";
    this.style = { display: "" };
    this.children = [];
    this._attrs = {};
    // Real DOM nodes report this as true once attached anywhere under the
    // document - approximated here as "has this ever been appendChild'd
    // somewhere" (good enough for these tests; nothing here needs a real
    // document-root walk).
    this.isConnected = false;
    this.classList = {
      _set: new Set(),
      add: (...names) => names.forEach((n) => this.classList._set.add(n)),
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
  appendChild(child) {
    this.children.push(child);
    child.parent = this;
    child.isConnected = true;
    return child;
  }
  append(...items) {
    items.forEach((item) => this.appendChild(item));
  }
  insertAdjacentElement(position, el) {
    if (position !== "afterend") throw new Error(`unsupported position: ${position}`);
    if (!this.parent) throw new Error("no parent to insert into");
    const idx = this.parent.children.indexOf(this);
    this.parent.children.splice(idx + 1, 0, el);
    el.parent = this.parent;
    el.isConnected = true;
    return el;
  }
  // Simulates another script yanking this node out of the tree (e.g. a
  // container getting rebuilt) - used to test the self-healing re-check in
  // inventory.js's own ensurePureTotalsRow.
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
    this.isConnected = false;
  }
  querySelectorAll(selector) {
    // Only ".item:not(.pendingItem)" is ever used by inventory.js - a plain
    // recursive descendant scan filtering out .pendingItem is enough here.
    const out = [];
    const walk = (el) => {
      for (const child of el.children) {
        if (child.classList.contains("item") && !child.classList.contains("pendingItem")) out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
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

function loadInventoryPage({
  userSteamId = "76561198000000000",
  byId = {},
  bySelector = {},
  setTimeoutImpl = (fn) => { fn(); return 0; },
  lang,
  fetch,
} = {}) {
  FakeMutationObserver.instances = [];
  const idMap = { ...byId };
  const selectorMap = { ...bySelector };
  const fakeDocument = {
    documentElement: { lang },
    createElement: (tag) => new FakeElement(tag),
    getElementById: (id) => idMap[id] || null,
    querySelector: (selector) => selectorMap[selector] || null,
    body: { appendChild: () => {}, removeChild: () => {}, execCommand: () => {} },
    execCommand: () => {},
    addEventListener: () => {},
    dispatchEvent: () => true,
  };
  const windowObj = {
    jQuery: undefined,
    location: { search: "" },
    __tf2teUnusualEffectsMap__: {},
    CDelayedAJAXData: class { RunWhenAJAXReady() {} },
    UserYou: { strSteamId: userSteamId },
    g_rgAppContextData: undefined,
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
    setTimeout: setTimeoutImpl,
    clearTimeout: () => {},
    CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; Object.assign(this, init); } },
    // Real getComputedStyle reads the cascade; a FakeElement has no
    // stylesheet to cascade, so this just reflects whatever's been set
    // directly on .style - enough for inventory.js's own read of .position.
    getComputedStyle: (el) => el.style,
    fetch,
  };
  vm.createContext(sandbox);
  vm.runInContext(sharedSrc, sandbox);
  vm.runInContext(pageSrc, sandbox);

  const entry = sandbox.window.__tf2te__.scripts.find((s) => s.includes.some((p) => p.source.includes("inventory")));
  return { sandbox, entry, DEPS: sandbox.window.__tf2te__.DEPS, idMap };
}

test("registers exactly one script matching a steamcommunity.com .../inventory URL", () => {
  const { entry } = loadInventoryPage();
  assert.ok(entry);
  assert.match("https://steamcommunity.com/id/someuser/inventory", entry.includes[0]);
  assert.equal(entry.includes[0].test("https://steamcommunity.com/id/someuser/"), false);
});

// Confirmed live: an item link (e.g. from a profile's item showcase) puts the
// trailing slash BEFORE the hash - the old pattern only allowed it after, so
// nothing on the page ran for those links.
test("matches every inventory URL shape, including an item link with a slash before the hash", () => {
  const { entry } = loadInventoryPage();
  for (const url of [
    "https://steamcommunity.com/id/someuser/inventory",
    "https://steamcommunity.com/id/someuser/inventory/",
    "https://steamcommunity.com/id/someuser/inventory#440_2_1",
    "https://steamcommunity.com/id/someuser/inventory/#440_2_15868155302",
    "https://steamcommunity.com/profiles/76561198000000000/inventory/#730",
  ]) {
    assert.match(url, entry.includes[0]);
  }
  assert.equal(entry.includes[0].test("https://steamcommunity.com/id/someuser/inventoryhistory/"), false);
});

test("styles are the shared itemOverlay block", () => {
  const { entry } = loadInventoryPage();
  assert.match(entry.styles, /\.unusual \{/);
});

test("fn() sets up a MutationObserver on the #inventories element, observing childList+subtree", () => {
  const inventoriesEl = new FakeElement("div", "inventories");
  const { entry, DEPS } = loadInventoryPage({ byId: { inventories: inventoriesEl } });

  entry.fn(DEPS);

  assert.equal(FakeMutationObserver.instances.length, 1);
  assert.equal(FakeMutationObserver.instances[0].target, inventoriesEl);
  assert.deepEqual(toPlain(FakeMutationObserver.instances[0].opts), { childList: true, subtree: true });
});

test("once the TF2 inventory becomes visible with items, the outer observer disconnects and a new one watches the TF2 inventory itself", () => {
  const inventoriesEl = new FakeElement("div", "inventories");
  const steamId = "76561198000000000";
  const tf2InventoryEl = new FakeElement("div", `inventory_${steamId}_440_2`);
  const itemEl = new FakeElement("div", "440_2_111");
  itemEl.classList.add("item");
  tf2InventoryEl.appendChild(itemEl);

  const { entry, DEPS } = loadInventoryPage({ userSteamId: steamId, byId: { inventories: inventoriesEl, [tf2InventoryEl.id]: tf2InventoryEl } });

  entry.fn(DEPS);
  const outerObserver = FakeMutationObserver.instances[0];

  // No g_rgAppContextData yet - onTF2InventoryChange should bail out
  // harmlessly rather than throw when the mutation fires.
  assert.doesNotThrow(() => outerObserver.cb());
  assert.equal(outerObserver.disconnected, true);

  // A second MutationObserver is now watching the TF2 inventory element itself.
  assert.equal(FakeMutationObserver.instances.length, 2);
  assert.equal(FakeMutationObserver.instances[1].target, tf2InventoryEl);
  assert.deepEqual(toPlain(FakeMutationObserver.instances[1].opts), { childList: true, subtree: true });
});

test("onTF2InventoryChange adds attributes to each item element using its matched asset from g_rgAppContextData", () => {
  const inventoriesEl = new FakeElement("div", "inventories");
  const steamId = "76561198000000000";
  const tf2InventoryEl = new FakeElement("div", `inventory_${steamId}_440_2`);
  const itemEl = new FakeElement("div", "440_2_999");
  itemEl.classList.add("item");
  tf2InventoryEl.appendChild(itemEl);

  const { entry, DEPS, sandbox } = loadInventoryPage({ userSteamId: steamId, byId: { inventories: inventoriesEl, [tf2InventoryEl.id]: tf2InventoryEl } });

  sandbox.window.g_rgAppContextData = {
    440: {
      rgContexts: {
        2: {
          inventory: {
            m_rgAssets: {
              999: {
                description: {
                  name_color: "CF6A32",
                  market_hash_name: "Strange Rocket Launcher",
                  type: "Strange Rocket Launcher - Points Scored: 0",
                  name: "Strange Rocket Launcher",
                  descriptions: [],
                },
              },
            },
          },
        },
      },
    },
  };

  entry.fn(DEPS);
  FakeMutationObserver.instances[0].cb(); // triggers onTF2Inventory -> onTF2InventoryChange

  // CF6A32 (Strange-quality) items are deliberately excluded from getting
  // the "strange" class even though the type string matches - see shared.js's
  // own isStrangeQuality exclusion (already covered in tradeOfferShared.test.js).
  assert.equal(itemEl.hasAttribute("data-checked"), true);
  assert.equal(itemEl.classList.contains("strange"), false);
});

test("onTF2InventoryChange tallies keys/metal into a 'Total pure' box inserted into the logo banner, updated in place (not duplicated) on later calls", () => {
  const inventoriesEl = new FakeElement("div", "inventories");
  const steamId = "76561198000000000";
  const tf2InventoryEl = new FakeElement("div", `inventory_${steamId}_440_2`);
  const itemEl = new FakeElement("div", "440_2_1");
  itemEl.classList.add("item");
  tf2InventoryEl.appendChild(itemEl);
  const logoBannerEl = new FakeElement("div", "inventory_logos");

  const { entry, DEPS, sandbox } = loadInventoryPage({
    userSteamId: steamId,
    byId: { inventories: inventoriesEl, [tf2InventoryEl.id]: tf2InventoryEl, inventory_logos: logoBannerEl },
  });

  sandbox.window.g_rgAppContextData = {
    440: {
      rgContexts: {
        2: {
          inventory: {
            m_rgAssets: {
              1: { description: { market_hash_name: "Mann Co. Supply Crate Key" } },
              2: { description: { market_hash_name: "Mann Co. Supply Crate Key" } },
              3: { description: { market_hash_name: "Refined Metal" } },
              4: { description: { market_hash_name: "Scrap Metal" } },
              5: { description: { market_hash_name: "Rocket Launcher" } },
            },
          },
        },
      },
    },
  };

  entry.fn(DEPS);
  FakeMutationObserver.instances[0].cb(); // triggers onTF2Inventory -> onTF2InventoryChange

  assert.equal(logoBannerEl.children.length, 1);
  const row = logoBannerEl.children[0];
  const [title, keysLine, metalLine] = row.children;
  assert.equal(title.textContent, "Total pure:");
  assert.equal(keysLine.textContent, "Keys: 2");
  assert.equal(metalLine.textContent, "Metal: 1.11 ref"); // (9 + 1) scrap / 9

  // Remove a key and re-fire the observer callback - the row should update
  // in place, not grow a second copy.
  delete sandbox.window.g_rgAppContextData[440].rgContexts[2].inventory.m_rgAssets[2];
  FakeMutationObserver.instances[1].cb();

  assert.equal(logoBannerEl.children.length, 1);
  assert.equal(keysLine.textContent, "Keys: 1");
});

test("re-inserts the 'Total pure' box if it gets removed from the DOM by something else (e.g. another extension rebuilding the logo banner)", () => {
  const inventoriesEl = new FakeElement("div", "inventories");
  const steamId = "76561198000000000";
  const tf2InventoryEl = new FakeElement("div", `inventory_${steamId}_440_2`);
  const itemEl = new FakeElement("div", "440_2_1");
  itemEl.classList.add("item");
  tf2InventoryEl.appendChild(itemEl);
  const logoBannerEl = new FakeElement("div", "inventory_logos");

  const { entry, DEPS, sandbox } = loadInventoryPage({
    userSteamId: steamId,
    byId: { inventories: inventoriesEl, [tf2InventoryEl.id]: tf2InventoryEl, inventory_logos: logoBannerEl },
  });

  sandbox.window.g_rgAppContextData = {
    440: {
      rgContexts: {
        2: {
          inventory: {
            m_rgAssets: {
              1: { description: { market_hash_name: "Mann Co. Supply Crate Key" } },
            },
          },
        },
      },
    },
  };

  entry.fn(DEPS);
  FakeMutationObserver.instances[0].cb();

  assert.equal(logoBannerEl.children.length, 1);
  const firstRow = logoBannerEl.children[0];
  assert.equal(firstRow.isConnected, true);

  // Something else (e.g. another extension) tears the row back out of the
  // banner - simulates confirmed-live behavior where the box was built
  // once but wasn't present in the live DOM afterward.
  firstRow.remove();
  assert.equal(logoBannerEl.children.length, 0);

  FakeMutationObserver.instances[1].cb(); // next onTF2InventoryChange pass

  assert.equal(logoBannerEl.children.length, 1);
  const secondRow = logoBannerEl.children[0];
  assert.notEqual(secondRow, firstRow, "should have rebuilt a fresh row, not tried to reuse the detached one");
  const [, keysLine] = secondRow.children;
  assert.equal(keysLine.textContent, "Keys: 1");
});

test("pollInventoryLoading catches a backpack that keeps loading more pages after the initial mutation fires, and stops once the asset count settles", () => {
  const inventoriesEl = new FakeElement("div", "inventories");
  const steamId = "76561198000000000";
  const tf2InventoryEl = new FakeElement("div", `inventory_${steamId}_440_2`);
  const itemEl = new FakeElement("div", "440_2_1");
  itemEl.classList.add("item");
  tf2InventoryEl.appendChild(itemEl);
  const logoBannerEl = new FakeElement("div", "inventory_logos");

  // A controllable setTimeout - each scheduled poll sits in a queue until
  // the test explicitly fires it (simulating a real page load spread over
  // several seconds instead of everything settling within one microtask).
  const pending = [];
  const setTimeoutImpl = (fn) => { pending.push(fn); return pending.length; };
  const fireNextPoll = () => {
    const fn = pending.shift();
    if (!fn) throw new Error("no pending poll to fire");
    fn();
  };

  const { entry, DEPS, sandbox } = loadInventoryPage({
    userSteamId: steamId,
    byId: { inventories: inventoriesEl, [tf2InventoryEl.id]: tf2InventoryEl, inventory_logos: logoBannerEl },
    setTimeoutImpl,
  });

  const assets = {
    1: { description: { market_hash_name: "Mann Co. Supply Crate Key" } },
  };
  sandbox.window.g_rgAppContextData = { 440: { rgContexts: { 2: { inventory: { m_rgAssets: assets } } } } };

  entry.fn(DEPS);
  FakeMutationObserver.instances[0].cb(); // triggers onTF2Inventory: initial pass + schedules the first poll

  const row = logoBannerEl.children[0];
  const [, keysLine] = row.children;
  // Only page 1 has "loaded" so far - no partial count shown while loading.
  assert.equal(keysLine.textContent, "Keys: …");
  assert.equal(pending.length, 1, "expected exactly one poll scheduled after the initial pass");

  // "Page 2" of the backpack finishes loading before the next poll fires.
  assets[2] = { description: { market_hash_name: "Mann Co. Supply Crate Key" } };
  fireNextPoll();

  assert.equal(keysLine.textContent, "Keys: …");
  assert.equal(pending.length, 1, "count changed - another poll should be scheduled");

  // No further pages arrive - the next poll should see the same count and stop.
  fireNextPoll();

  assert.equal(keysLine.textContent, "Keys: 2");
  assert.equal(pending.length, 0, "count settled - no further poll should be scheduled");
});

// The logo banner is shared by every game's inventory - Steam keeps each
// loaded one in #inventories and hides the inactive ones, so the totals
// follow whether TF2's own container is the one showing.
test("the 'Total pure' box only shows while TF2's own inventory is the visible one", () => {
  const inventoriesEl = new FakeElement("div", "inventories");
  const steamId = "76561198000000000";
  const tf2InventoryEl = new FakeElement("div", `inventory_${steamId}_440_2`);
  const itemEl = new FakeElement("div", "440_2_1");
  itemEl.classList.add("item");
  tf2InventoryEl.appendChild(itemEl);
  const logoBannerEl = new FakeElement("div", "inventory_logos");

  const { entry, DEPS, sandbox } = loadInventoryPage({
    userSteamId: steamId,
    byId: { inventories: inventoriesEl, [tf2InventoryEl.id]: tf2InventoryEl, inventory_logos: logoBannerEl },
  });
  sandbox.window.g_rgAppContextData = {
    440: { rgContexts: { 2: { inventory: { m_rgAssets: { 1: { description: { market_hash_name: "Mann Co. Supply Crate Key" } } } } } } },
  };

  entry.fn(DEPS);
  FakeMutationObserver.instances[0].cb();

  const row = logoBannerEl.children[0];
  assert.equal(row.style.display, "flex");

  const visibilityObserver = FakeMutationObserver.instances.find((o) => o.target === inventoriesEl && o.opts.attributes);
  assert.ok(visibilityObserver, "expected an observer for Steam showing/hiding inventory containers");

  // Switched to another game - Steam hides TF2's container.
  tf2InventoryEl.style.display = "none";
  visibilityObserver.cb();
  assert.equal(row.style.display, "none");

  // Back to TF2.
  tf2InventoryEl.style.display = "";
  visibilityObserver.cb();
  assert.equal(row.style.display, "flex");
});

// Confirmed live: a large backpack loads in chunks, so a running tally read
// as a real total (75 keys that later became 1174) - the box now says it's
// loading until Steam reports the inventory fully loaded.
function setUpLoadingInventory({ context }) {
  const inventoriesEl = new FakeElement("div", "inventories");
  const steamId = "76561198000000000";
  const tf2InventoryEl = new FakeElement("div", `inventory_${steamId}_440_2`);
  const itemEl = new FakeElement("div", "440_2_1");
  itemEl.classList.add("item");
  tf2InventoryEl.appendChild(itemEl);
  const logoBannerEl = new FakeElement("div", "inventory_logos");
  const pendingTimeouts = [];

  const { entry, DEPS, sandbox } = loadInventoryPage({
    userSteamId: steamId,
    byId: { inventories: inventoriesEl, [tf2InventoryEl.id]: tf2InventoryEl, inventory_logos: logoBannerEl },
    setTimeoutImpl: (fn) => { pendingTimeouts.push(fn); return pendingTimeouts.length; },
  });
  sandbox.window.g_rgAppContextData = { 440: { rgContexts: { 2: context } } };

  entry.fn(DEPS);
  FakeMutationObserver.instances[0].cb();

  const [, keysLine, metalLine, statusLine] = logoBannerEl.children[0].children;
  return { keysLine, metalLine, statusLine, firePoll: () => pendingTimeouts.shift()() };
}

test("'Total pure' says it's loading until Steam's m_bFullyLoaded flag is set, then shows the full totals", () => {
  const assets = { 1: { description: { market_hash_name: "Mann Co. Supply Crate Key" } } };
  const inventory = { m_rgAssets: assets, m_bFullyLoaded: false };
  const { keysLine, metalLine, statusLine, firePoll } = setUpLoadingInventory({ context: { inventory } });

  assert.equal(keysLine.textContent, "Keys: …");
  assert.equal(metalLine.textContent, "Metal: … ref");
  assert.equal(statusLine.textContent, "Loading…");

  // Another chunk lands - still loading, still no partial count shown.
  assets[2] = { description: { market_hash_name: "Mann Co. Supply Crate Key" } };
  firePoll();
  assert.equal(keysLine.textContent, "Keys: …");

  inventory.m_bFullyLoaded = true;
  firePoll();
  assert.equal(keysLine.textContent, "Keys: 2");
  assert.equal(metalLine.textContent, "Metal: 0.00 ref");
  assert.equal(statusLine.textContent, "");
});

test("'Total pure' shows load progress against the game tab's asset_count when Steam has no fully-loaded flag", () => {
  const assets = { 1: { description: { market_hash_name: "Refined Metal" } } };
  const { keysLine, metalLine, statusLine, firePoll } = setUpLoadingInventory({
    context: { asset_count: 2, inventory: { m_rgAssets: assets } },
  });

  assert.equal(statusLine.textContent, `Loading ${(1).toLocaleString()} / ${(2).toLocaleString()} items…`);
  assert.equal(keysLine.textContent, "Keys: …");

  assets[2] = { description: { market_hash_name: "Refined Metal" } };
  firePoll();
  assert.equal(metalLine.textContent, "Metal: 2.00 ref");
  assert.equal(statusLine.textContent, "");
});

// Confirmed live (Steam in Hungarian): the page's own descriptions are
// translated, so no effect was recognized on any tile. On a non-English page
// the tiles wait for the inventory's English descriptions, then are marked
// from those.
test("on a non-English page, tiles are marked from the inventory's English descriptions once they've loaded", async () => {
  const inventoriesEl = new FakeElement("div", "inventories");
  const steamId = "76561198000000000";
  const tf2InventoryEl = new FakeElement("div", `inventory_${steamId}_440_2`);
  const itemEl = new FakeElement("div", "440_2_999");
  itemEl.classList.add("item");
  tf2InventoryEl.appendChild(itemEl);
  const urls = [];

  const { entry, DEPS, sandbox } = loadInventoryPage({
    userSteamId: steamId,
    byId: { inventories: inventoriesEl, [tf2InventoryEl.id]: tf2InventoryEl },
    lang: "hu",
    fetch: async (url) => {
      urls.push(url);
      return {
        ok: true,
        json: async () => ({
          assets: [{ assetid: "999", classid: "1", instanceid: "2" }],
          descriptions: [
            {
              classid: "1",
              instanceid: "2",
              name_color: "8650AC",
              market_hash_name: "Unusual Team Captain",
              descriptions: [{ value: "★ Unusual Effect: Burning Flames", color: "ffd700" }],
            },
          ],
        }),
      };
    },
  });
  sandbox.window.__tf2teUnusualEffectsMap__["Burning Flames"] = 13;
  sandbox.window.g_rgAppContextData = {
    440: {
      rgContexts: {
        2: {
          inventory: {
            m_rgAssets: {
              999: { description: { name_color: "8650AC", descriptions: [{ value: "★ Rendkívüli effekt: Égő lángok", color: "ffd700" }] } },
            },
          },
        },
      },
    },
  };

  entry.fn(DEPS);
  FakeMutationObserver.instances[0].cb();
  // Not marked from the translated text - a tile is only ever marked once.
  assert.equal(itemEl.hasAttribute("data-checked"), false);

  for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(urls, [`https://steamcommunity.com/inventory/${steamId}/440/2?l=english&count=2000`]);
  assert.equal(itemEl.getAttribute("data-effect"), "13");
});
