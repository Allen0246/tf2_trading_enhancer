import { test } from "node:test";
import assert from "node:assert/strict";

// backpack.tf/nextUI/premiumSearchLastSeenHighlight/mainWorld.js is a
// MAIN-world bridge script (see its own header) - gated once at import time
// on window.location.hostname including "next.backpack.tf", then patches
// window.fetch AND XMLHttpRequest to observe (read-only) responses from the
// page's own "/cors/_item/search" endpoint, broadcasting a
// {currentId: previousOwnerTimestamp} map via a CustomEvent. Same
// "installDocument + listeners object" fixture pattern
// tests/inventoryMarketActionsMainWorld.test.js's own header note already
// establishes for the analogous steamcommunity.com bridge.
class FakeCustomEvent {
  constructor(type, { detail } = {}) {
    this.type = type;
    this.detail = detail;
  }
}
globalThis.CustomEvent = FakeCustomEvent;

// mainWorld.js checks `request instanceof Request` as a BARE global
// reference (same convention as `document`/`CustomEvent` above, not
// `window.Request`) - in a real browser `window` IS the global object, so
// this is one and the same there; this fixture's own fake `window` is a
// separate plain object, so Request needs to be defined here at the
// top level too, not nested inside it.
class FakeRequest {
  constructor(url) {
    this.url = url;
  }
}
globalThis.Request = FakeRequest;

const dispatchedEvents = [];
const listeners = {};
function installDocument() {
  dispatchedEvents.length = 0;
  for (const key of Object.keys(listeners)) delete listeners[key];
  globalThis.document = {
    addEventListener: (type, cb) => {
      (listeners[type] ||= []).push(cb);
    },
    dispatchEvent: (evt) => {
      dispatchedEvents.push(evt);
    },
  };
}

const BROADCAST_EVENT = "tf2te-premium-search-sale-timestamps";

function latestBroadcastPayload() {
  const evt = dispatchedEvents.find((e) => e.type === BROADCAST_EVENT);
  return evt ? JSON.parse(evt.detail) : undefined;
}

// A minimal fake Response - only .clone()/.json() are ever called on it.
function fakeResponse(body) {
  return {
    clone() {
      return this;
    },
    json: async () => body,
  };
}

// mainWorld.js gates itself once per call based on window.location.hostname,
// and can't gain an `export` (classic MAIN-world content script - see
// manifest.json), so it exposes
// globalThis.__premiumSearchLastSeenHighlightMainWorldTestHooks.run for
// tests to call repeatedly - same reasoning
// tests/inventoryMarketActionsMainWorld.test.js's own note documents in
// full for not using a fresh cache-busting dynamic import per test.
async function importFresh({ hostname = "next.backpack.tf", fetchImpl, XHRClass = makeFakeXHRClass() } = {}) {
  installDocument();
  globalThis.window = {
    location: { hostname },
    fetch: fetchImpl,
    XMLHttpRequest: XHRClass,
  };
  await globalThis.__premiumSearchLastSeenHighlightMainWorldTestHooks.run();
}

// A minimal fake XMLHttpRequest constructor - .open/.send are patched by
// mainWorld.js itself; this fake only needs to support being subclassed via
// .prototype patching and firing its own "load" listener.
function makeFakeXHRClass() {
  class FakeXHR {
    constructor() {
      this._listeners = {};
    }
    open(method, url) {
      this._method = method;
      this._url = url;
    }
    send() {
      // Real send() is async; tests call ._respond() manually below.
    }
    addEventListener(type, cb) {
      (this._listeners[type] ||= []).push(cb);
    }
    _respond(responseText) {
      this.responseText = responseText;
      (this._listeners.load || []).forEach((cb) => cb.call(this));
    }
  }
  return FakeXHR;
}

// Installs a placeholder window so mainWorld.js's own top-level
// initPremiumSearchLastSeenHighlightMainWorld() call (see that file's own
// note) has something to read on this ONE-TIME import.
installDocument();
globalThis.window = { location: { hostname: "next.backpack.tf" }, fetch: async () => fakeResponse({}), XMLHttpRequest: makeFakeXHRClass() };
await import("../backpack.tf/nextUI/premiumSearchLastSeenHighlight/mainWorld.js");

test("does nothing when the current page isn't next.backpack.tf - fetch/XHR are left untouched", async () => {
  const originalFetch = async () => fakeResponse({});
  const OriginalXHR = makeFakeXHRClass();
  await importFresh({ hostname: "backpack.tf", fetchImpl: originalFetch, XHRClass: OriginalXHR });

  assert.equal(globalThis.window.fetch, originalFetch);
  assert.equal(globalThis.window.XMLHttpRequest, OriginalXHR);
});

test("patches window.fetch, and a search response broadcasts the previous-owner timestamp keyed by Current ID", async () => {
  const searchResponse = fakeResponse({
    results: [
      {
        history: {
          entries: [
            { id: 1001, steamid: "current-owner", timestamp: 1700000000 },
            { id: 999, steamid: "current-owner", timestamp: 1699000000 }, // repeat scan, same owner
            { id: 998, steamid: "previous-owner", timestamp: 1690000000 }, // actual previous owner
          ],
        },
      },
    ],
  });
  await importFresh({ fetchImpl: async () => searchResponse });

  await globalThis.window.fetch("https://next.backpack.tf/cors/_item/search?itemName=Foo");
  // The interceptor reads the response asynchronously (response.clone().json().then(...)).
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(latestBroadcastPayload(), { "1001": 1690000000 });
});

test("still returns the real response from the patched fetch, unmodified", async () => {
  const searchResponse = fakeResponse({ results: [] });
  await importFresh({ fetchImpl: async () => searchResponse });

  const result = await globalThis.window.fetch("https://next.backpack.tf/cors/_item/search");
  assert.equal(result, searchResponse);
});

test("ignores a fetch response from an unrelated URL - no broadcast", async () => {
  const otherResponse = fakeResponse({ results: [{ history: { entries: [{ id: 1, steamid: "a", timestamp: 1 }, { id: 2, steamid: "b", timestamp: 2 }] } }] });
  await importFresh({ fetchImpl: async () => otherResponse });

  await globalThis.window.fetch("https://next.backpack.tf/cors/_item/unrelated");
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(latestBroadcastPayload(), undefined);
});

test("does not broadcast when every item has no known previous owner (all entries share the current owner's steamid)", async () => {
  const searchResponse = fakeResponse({
    results: [{ history: { entries: [{ id: 1001, steamid: "same", timestamp: 5 }, { id: 999, steamid: "same", timestamp: 4 }] } }],
  });
  await importFresh({ fetchImpl: async () => searchResponse });

  await globalThis.window.fetch("https://next.backpack.tf/cors/_item/search");
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(latestBroadcastPayload(), undefined);
});

test("swallows a malformed/non-JSON fetch response instead of throwing", async () => {
  const badResponse = {
    clone() {
      return this;
    },
    json: async () => {
      throw new Error("not JSON");
    },
  };
  await importFresh({ fetchImpl: async () => badResponse });

  await assert.doesNotReject(async () => {
    await globalThis.window.fetch("https://next.backpack.tf/cors/_item/search");
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});

test("patches XMLHttpRequest.prototype.open/send, and a matching request's load event broadcasts the timestamp map", async () => {
  const FakeXHR = makeFakeXHRClass();
  await importFresh({ XHRClass: FakeXHR });

  const xhr = new globalThis.window.XMLHttpRequest();
  xhr.open("GET", "https://next.backpack.tf/cors/_item/search?itemName=Foo");
  xhr.send();
  xhr._respond(
    JSON.stringify({
      results: [{ history: { entries: [{ id: 2002, steamid: "current", timestamp: 200 }, { id: 1, steamid: "previous", timestamp: 100 }] } }],
    })
  );

  assert.deepEqual(latestBroadcastPayload(), { "2002": 100 });
});

test("XHR path: a request to an unrelated URL never gets a load listener attached - no broadcast even if it responds", async () => {
  const FakeXHR = makeFakeXHRClass();
  await importFresh({ XHRClass: FakeXHR });

  const xhr = new globalThis.window.XMLHttpRequest();
  xhr.open("GET", "https://next.backpack.tf/cors/_item/unrelated");
  xhr.send();
  // Even if something else fires a "load"-shaped call, no listener was ever
  // registered for this URL, so _respond would be a no-op here - proven by
  // there simply being no listeners array populated at all.
  assert.equal(xhr._listeners.load, undefined);
});

test("XHR path: swallows a malformed response body instead of throwing", async () => {
  const FakeXHR = makeFakeXHRClass();
  await importFresh({ XHRClass: FakeXHR });

  const xhr = new globalThis.window.XMLHttpRequest();
  xhr.open("GET", "https://next.backpack.tf/cors/_item/search");
  xhr.send();

  assert.doesNotThrow(() => xhr._respond("not json"));
  assert.equal(latestBroadcastPayload(), undefined);
});
