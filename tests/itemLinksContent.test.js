import { test } from "node:test";
import assert from "node:assert/strict";

// itemLinks/content.js wires up document-level mouseover/mouseout/mousedown
// listeners that drive the REAL createItemCard()/update() (itemCard.js -> real
// resolveItemDetails.js -> real itemShape.js/links.js, same chain
// tests/itemCard.test.js/tests/resolveItemDetails.test.js already exercise) -
// same "fake chrome once at file scope" approach those two files use, since
// none of these modules touch chrome/document at import time.
let storageChangeListeners = [];
globalThis.chrome = {
  storage: {
    local: {
      get: async () => ({
        tf2SchemaCache: { itemNameToDefindex: {}, defindexToItemName: {}, effectNameToId: {}, fetchedAt: Date.now(), schemaShapeVersion: 4 },
      }),
      set: async () => {},
    },
    onChanged: {
      addListener: (cb) => storageChangeListeners.push(cb),
      removeListener: (cb) => { storageChangeListeners = storageChangeListeners.filter((l) => l !== cb); },
    },
  },
  runtime: {
    sendMessage: async () => ({ ok: false, error: "no live fetch expected in this test file" }),
    getURL: (path) => path,
  },
};

async function fireStorageChange(changes, areaName = "local") {
  await Promise.all(storageChangeListeners.map((cb) => cb(changes, areaName)));
}
globalThis.fetch = async () => ({ json: async () => [] });
global.window = { location: { pathname: "/buy/hats" } };

import { itemLinks } from "../scrap.tf/itemLinks/content.js";

// Minimal fake element supporting only what content.js's own event handlers
// read off `e.target` (closest) / off the hovered tile itself (getAttribute
// "data-title") - itemCard.js's own createItemCard() needs a real document
// (see below), but the hovered tile itself is simple enough not to need the
// full parser-backed FakeElement from tests/helpers/fakeDom.js. dataTitle
// mirrors scrap.tf's own real attribute (can carry quality-span HTML, e.g.
// "<span class='quality'>Strange</span> Commando") - content.js's own
// stripTags parses it with DOMParser (see that function's own note), faked
// below with FakeDOMParser since Node has no DOMParser.
function fakeTile({ dataTitle = "Rocket Launcher" } = {}) {
  const tile = {
    getAttribute: (name) => (name === "data-title" ? dataTitle : null),
    classList: { contains: () => false },
  };
  tile.closest = (selector) => (selector === ".item.hoverable" ? tile : null);
  return tile;
}

import { resetFakeDom, createFakeDocument, FakeElement, FakeDOMParser } from "./helpers/fakeDom.js";

globalThis.DOMParser = FakeDOMParser;

// content.js's own initial setup only checks THAT ".hover-over" exists (as a
// "is scrap.tf's own hover-tooltip feature present on this page at all"
// signal) - it no longer reads anything off it (see content.js's own note on
// why the item card's name now comes from the hovered tile's own "data-title"
// attribute instead), so this fake needs no title/display shape of its own.
function fakeHoverOverEl() {
  return new FakeElement("div");
}

let listeners;

function installDocumentWithListeners({ hoverEl } = {}) {
  resetFakeDom();
  listeners = {};
  storageChangeListeners = [];
  const fakeDoc = createFakeDocument();
  fakeDoc.querySelector = (selector) => (selector === ".hover-over" ? hoverEl : null);
  fakeDoc.addEventListener = (type, cb, capture) => {
    (listeners[type] ||= []).push({ cb, capture });
  };
  global.document = fakeDoc;
  return fakeDoc;
}

test("itemLinks logs a warning and wires nothing up when the page has no .hover-over element", () => {
  installDocumentWithListeners({ hoverEl: null });
  const originalWarn = console.warn;
  const warnCalls = [];
  console.warn = (...args) => warnCalls.push(args);

  try {
    itemLinks();
    assert.equal(warnCalls.length, 1);
    assert.equal(listeners.mouseover, undefined);
  } finally {
    console.warn = originalWarn;
  }
});

test("itemLinks registers mouseover/mouseout/mousedown listeners when .hover-over exists", () => {
  const hoverEl = fakeHoverOverEl();
  installDocumentWithListeners({ hoverEl });

  itemLinks();

  assert.equal(listeners.mouseover.length, 1);
  assert.equal(listeners.mouseout.length, 1);
  assert.equal(listeners.mousedown.length, 1);
  assert.equal(listeners.mousedown[0].capture, true); // registered with useCapture=true
});

test("a middle-click (button 1) on a hovered item updates the item card with its resolved name", async () => {
  const hoverEl = fakeHoverOverEl();
  installDocumentWithListeners({ hoverEl });
  itemLinks();

  const item = fakeTile({ dataTitle: "Rocket Launcher" });
  listeners.mouseover[0].cb({ target: item });

  const preventDefaultCalls = [];
  await listeners.mousedown[0].cb({ button: 1, ctrlKey: false, metaKey: false, preventDefault: () => preventDefaultCalls.push(1) });

  const cardEl = document.documentElement.querySelector("#tf2te-item-card");
  assert.ok(cardEl);
  assert.equal(cardEl.querySelector(".tf2te-item-card-name").textContent, "Rocket Launcher");
  assert.equal(preventDefaultCalls.length, 1);
});

// A CLONED scrap.tf item tile has a real data-title attribute (cloneNode(true)
// copies attributes fine) but never gets scrap.tf's own hover-tooltip-trigger
// listeners (cloneNode never copies JS-attached event listeners), so its native
// ".hover-over" tooltip never shows/updates - reading the name off data-title
// instead (rather than off that tooltip's own title text, the old approach) is
// what makes hover+wheel-click work for a clone at all. hoverEl here is given
// no title info of its own at all - modeling a native tooltip that never
// populated - to prove the item card resolves correctly regardless of that
// tooltip's state.
test("REGRESSION: reads the item name off the hovered tile's own data-title attribute, not scrap.tf's native tooltip - this is what makes hover+wheel-click work on a New Items clone tile", async () => {
  const hoverEl = fakeHoverOverEl();
  installDocumentWithListeners({ hoverEl });
  itemLinks();

  const item = fakeTile({ dataTitle: "Diamond Botkiller Sniper Rifle Mk.I" });
  listeners.mouseover[0].cb({ target: item });

  await listeners.mousedown[0].cb({ button: 1, ctrlKey: false, metaKey: false, preventDefault: () => {} });

  const cardEl = document.documentElement.querySelector("#tf2te-item-card");
  assert.equal(cardEl.querySelector(".tf2te-item-card-name").textContent, "Diamond Botkiller Sniper Rifle Mk.I");
});

test("strips quality-span markup from data-title via DOMParser", async () => {
  const hoverEl = fakeHoverOverEl();
  installDocumentWithListeners({ hoverEl });
  itemLinks();

  const dataTitle = "<span class='quality'>Strange</span> Rocket Launcher";
  listeners.mouseover[0].cb({ target: fakeTile({ dataTitle }) });
  FakeDOMParser.calls = [];

  await listeners.mousedown[0].cb({ button: 1, ctrlKey: false, metaKey: false, preventDefault: () => {} });

  // The raw title must go through DOMParser (an inert document), never
  // through innerHTML on an element from the page's own document.
  assert.deepEqual(FakeDOMParser.calls, [{ html: dataTitle, mimeType: "text/html" }]);
  const cardEl = document.documentElement.querySelector("#tf2te-item-card");
  const name = cardEl.querySelector(".tf2te-item-card-name").textContent;
  assert.ok(!name.includes("<"), `card name should be plain text, got: ${name}`);
  assert.ok(name.includes("Rocket Launcher"));
});

test("a plain left-click (button 0, no modifier) does not activate the item card update", async () => {
  const hoverEl = fakeHoverOverEl();
  installDocumentWithListeners({ hoverEl });
  itemLinks();

  const item = fakeTile({ dataTitle: "Rocket Launcher" });
  listeners.mouseover[0].cb({ target: item });

  const preventDefaultCalls = [];
  await listeners.mousedown[0].cb({ button: 0, ctrlKey: false, metaKey: false, preventDefault: () => preventDefaultCalls.push(1) });

  assert.equal(preventDefaultCalls.length, 0);
});

// Ctrl/Cmd+click used to be a second activation trigger here, alongside
// middle-click - dropped because scrap.tf's own bulk Sell/Bank pages already
// use Ctrl+click as their native multi-select gesture (add this item to the
// current selection without deselecting the others), so every attempt to
// Ctrl+click-select an item there ALSO popped the item card. Only middle-click
// activates it now (see content.js's own mousedown handler note).
test("Ctrl+left-click (button 0 + ctrlKey) does NOT activate the item card update - reserved for scrap.tf's own multi-select gesture", async () => {
  const hoverEl = fakeHoverOverEl();
  installDocumentWithListeners({ hoverEl });
  itemLinks();

  listeners.mouseover[0].cb({ target: fakeTile({ dataTitle: "Scattergun" }) });
  const preventDefaultCalls = [];
  await listeners.mousedown[0].cb({ button: 0, ctrlKey: true, metaKey: false, preventDefault: () => preventDefaultCalls.push(1) });

  // The item card element itself is created eagerly (see createItemCard's
  // own note) - what matters here is that its name line never left the
  // initial placeholder, i.e. update() was never called.
  const cardEl = document.documentElement.querySelector("#tf2te-item-card");
  assert.equal(cardEl.querySelector(".tf2te-item-card-name").textContent, "Middle-click an item…");
  assert.equal(preventDefaultCalls.length, 0);
});

test("Cmd+left-click (button 0 + metaKey) also does NOT activate the item card update", async () => {
  const hoverEl = fakeHoverOverEl();
  installDocumentWithListeners({ hoverEl });
  itemLinks();

  listeners.mouseover[0].cb({ target: fakeTile({ dataTitle: "Scattergun" }) });
  const preventDefaultCalls = [];
  await listeners.mousedown[0].cb({ button: 0, ctrlKey: false, metaKey: true, preventDefault: () => preventDefaultCalls.push(1) });

  const cardEl = document.documentElement.querySelector("#tf2te-item-card");
  assert.equal(cardEl.querySelector(".tf2te-item-card-name").textContent, "Middle-click an item…");
  assert.equal(preventDefaultCalls.length, 0);
});

test("mousedown does nothing when there's no pending hovered item", async () => {
  const hoverEl = fakeHoverOverEl();
  installDocumentWithListeners({ hoverEl });
  itemLinks();

  const preventDefaultCalls = [];
  await listeners.mousedown[0].cb({ button: 1, preventDefault: () => preventDefaultCalls.push(1) });

  assert.equal(preventDefaultCalls.length, 0);
});

test("mouseout clears the pending hovered item so a later mousedown does nothing", async () => {
  const hoverEl = fakeHoverOverEl();
  installDocumentWithListeners({ hoverEl });
  itemLinks();

  const item = fakeTile();
  listeners.mouseover[0].cb({ target: item });
  listeners.mouseout[0].cb({ target: item });

  const preventDefaultCalls = [];
  await listeners.mousedown[0].cb({ button: 1, preventDefault: () => preventDefaultCalls.push(1) });

  assert.equal(preventDefaultCalls.length, 0);
});

test("mousedown does nothing when the hovered tile has no data-title attribute", async () => {
  const hoverEl = fakeHoverOverEl();
  installDocumentWithListeners({ hoverEl });
  itemLinks();

  listeners.mouseover[0].cb({ target: fakeTile({ dataTitle: null }) });
  const preventDefaultCalls = [];
  await listeners.mousedown[0].cb({ button: 1, preventDefault: () => preventDefaultCalls.push(1) });

  assert.equal(preventDefaultCalls.length, 0);
});

test("saving a Steam API key re-resolves whatever the item card is currently showing, without needing a fresh middle-click", async () => {
  const hoverEl = fakeHoverOverEl();
  installDocumentWithListeners({ hoverEl });
  itemLinks();

  listeners.mouseover[0].cb({ target: fakeTile() });
  await listeners.mousedown[0].cb({ button: 1, preventDefault: () => {} });

  const cardEl = document.documentElement.querySelector("#tf2te-item-card");
  assert.equal(cardEl.querySelector(".tf2te-item-card-name").textContent, "Rocket Launcher");

  // Clear the name to prove the listener below actually re-ran update() -
  // if it didn't, this would stay blank instead of resolving back.
  cardEl.querySelector(".tf2te-item-card-name").textContent = "";

  await fireStorageChange({ steamApiKey: { newValue: "freshly-saved-key", oldValue: undefined } });

  assert.equal(cardEl.querySelector(".tf2te-item-card-name").textContent, "Rocket Launcher");
});

test("changing the popup's sheen/killstreaker filter setting re-resolves the item card that's showing", async () => {
  const hoverEl = fakeHoverOverEl();
  installDocumentWithListeners({ hoverEl });
  itemLinks();

  listeners.mouseover[0].cb({ target: fakeTile() });
  await listeners.mousedown[0].cb({ button: 1, preventDefault: () => {} });

  const cardEl = document.documentElement.querySelector("#tf2te-item-card");
  cardEl.querySelector(".tf2te-item-card-name").textContent = "";

  await fireStorageChange({ sheenKillstreakerFilterEnabled: { newValue: false, oldValue: true } });

  assert.equal(cardEl.querySelector(".tf2te-item-card-name").textContent, "Rocket Launcher");
});

test("a storage change unrelated to steamApiKey does not trigger a re-resolve", async () => {
  const hoverEl = fakeHoverOverEl();
  installDocumentWithListeners({ hoverEl });
  itemLinks();

  listeners.mouseover[0].cb({ target: fakeTile() });
  await listeners.mousedown[0].cb({ button: 1, preventDefault: () => {} });

  const cardEl = document.documentElement.querySelector("#tf2te-item-card");
  cardEl.querySelector(".tf2te-item-card-name").textContent = "";

  await fireStorageChange({ someUnrelatedKey: { newValue: 1, oldValue: 0 } });

  assert.equal(cardEl.querySelector(".tf2te-item-card-name").textContent, "");
});

test("a steamApiKey storage change before the item card has ever shown anything does nothing (no lastShownArgs yet)", async () => {
  const hoverEl = fakeHoverOverEl();
  installDocumentWithListeners({ hoverEl });
  itemLinks();

  // Must not throw even though update() was never called yet.
  await assert.doesNotReject(fireStorageChange({ steamApiKey: { newValue: "key", oldValue: undefined } }));
});

test("mouseover ignores a mouseover target that isn't inside a hoverable item", () => {
  const hoverEl = fakeHoverOverEl();
  installDocumentWithListeners({ hoverEl });
  itemLinks();

  const nonItem = { closest: () => null };
  // Must not throw, and must leave pendingItemEl unset (implicitly verified
  // by the "no pending item" mousedown test above already covering that path).
  assert.doesNotThrow(() => listeners.mouseover[0].cb({ target: nonItem }));
});
