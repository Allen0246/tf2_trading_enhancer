import { test } from "node:test";
import assert from "node:assert/strict";

// tradeOfferRepCheck/content.js is a MAIN-world-adjacent bridge script: it
// gates itself on window.location.pathname including "/tradeoffer" (checked
// once, at import time - see this file's own note below on why that branch
// isn't separately exercised here), then listens on `document` for a
// CustomEvent request and answers with rep.tf ban data via the real
// utils/repTfInfo.js (only its own chrome.runtime.sendMessage FETCH_JSON
// relay is faked, same fixture shape as tests/repTfInfo.test.js - this file
// only needs to prove the bridge wires into that module correctly, not
// re-test repTfInfo.js's own internals).
function fakeGetURL(path) {
  return new URL(`../${path}`, import.meta.url).href;
}

class FakeCustomEvent {
  constructor(type, { detail } = {}) {
    this.type = type;
    this.detail = detail;
  }
}
globalThis.CustomEvent = FakeCustomEvent;

const dispatchedEvents = [];
const listeners = {};
globalThis.document = {
  addEventListener: (type, cb) => {
    (listeners[type] ||= []).push(cb);
  },
  dispatchEvent: (evt) => {
    dispatchedEvents.push(evt);
  },
};

const sendMessageCalls = [];
let sendMessageImpl = async () => ({ ok: false, error: "no fixture installed" });
const storageStore = {};
globalThis.chrome = {
  runtime: {
    getURL: fakeGetURL,
    sendMessage: async (msg) => {
      sendMessageCalls.push(msg);
      return sendMessageImpl(msg);
    },
  },
  // Backs utils/repTfInfo.js's own failure-backoff tracking (see
  // utils/failureBackoff.js) - this file only needs a working store so it
  // doesn't throw, not to exercise backoff behavior itself (see
  // tests/repTfInfo.test.js for that).
  storage: {
    local: {
      async get(keys) {
        const result = {};
        for (const k of keys) if (k in storageStore) result[k] = storageStore[k];
        return result;
      },
      async set(obj) {
        Object.assign(storageStore, obj);
      },
    },
  },
};

// Gate is read once, synchronously, at module load - pathname has to
// include "/tradeoffer" for the listener to ever get registered at all.
globalThis.window = { location: { pathname: "/tradeoffer/new/76561198000000000_0_0" } };

await import("../steamcommunity.com/tradeOfferRepCheck/content.js");

// content.js's own top-level body is an async IIFE that isn't awaited by
// the module itself - awaiting the import above only guarantees that IIFE's
// synchronous portion (up to its first internal await, the dynamic
// utils/repTfInfo.js import) has run, NOT that document.addEventListener
// further down inside it has executed yet. Without this, "registers
// exactly one listener..." below ran before that listener existed at all
// (listeners[REQUEST_EVENT] still undefined) - confirmed flaky-turned-
// deterministic on Node 22, where the extra microtask hop wasn't enough by
// the time this file's very first synchronous test ran, even though later
// tests (which get a few more microtask ticks for free from their own
// preceding awaits) never hit it.
await new Promise((resolve) => setTimeout(resolve, 0));
await new Promise((resolve) => setTimeout(resolve, 0));

const REQUEST_EVENT = "tf2te-resolve-rep-check-request";
const RESPONSE_EVENT = "tf2te-resolve-rep-check-response";

function fireRequest(detail) {
  listeners[REQUEST_EVENT][0]({ detail: JSON.stringify(detail) });
}

async function flush() {
  // Lets the async listener's own awaits (getRepTfBans' fetch relay) settle.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test("registers exactly one listener for the rep-check request event on import", () => {
  assert.equal(listeners[REQUEST_EVENT].length, 1);
});

test("a flagged profile responds with bannedSites derived via getBannedSiteLabels", async () => {
  sendMessageImpl = async () => ({
    ok: true,
    data: { success: true, bptfBans: { banned: "bad" }, steamBans: { banned: "good" } },
  });
  dispatchedEvents.length = 0;

  fireRequest({ requestId: "req-1", steamid64: "76561198000000000" });
  await flush();

  assert.equal(dispatchedEvents.length, 1);
  assert.equal(dispatchedEvents[0].type, RESPONSE_EVENT);
  const payload = JSON.parse(dispatchedEvents[0].detail);
  assert.equal(payload.requestId, "req-1");
  assert.deepEqual(payload.bannedSites, ["backpack.tf"]);
});

test("a clean profile (no 'bad' flags) responds with an empty bannedSites array", async () => {
  sendMessageImpl = async () => ({ ok: true, data: { success: true, steamBans: { banned: "good" } } });
  dispatchedEvents.length = 0;

  fireRequest({ requestId: "req-2", steamid64: "76561198000000001" });
  await flush();

  const payload = JSON.parse(dispatchedEvents[0].detail);
  assert.deepEqual(payload.bannedSites, []);
});

// A failed lookup must not read as "no bans" - tradeoffer.js shows no banner
// for an error response, rather than a green all-clear for a check that
// never happened.
test("a failed relay (ok: false) responds with an error, not an empty bannedSites array", async () => {
  sendMessageImpl = async () => ({ ok: false, error: "boom" });
  dispatchedEvents.length = 0;
  const originalWarn = console.warn;
  console.warn = () => {};

  try {
    fireRequest({ requestId: "req-3", steamid64: "76561198000000002" });
    await flush();
  } finally {
    console.warn = originalWarn;
  }

  const payload = JSON.parse(dispatchedEvents[0].detail);
  assert.equal(payload.bannedSites, undefined);
  assert.equal(payload.error, "rep.tf lookup failed");
});

test("a request with requestId == null is ignored - no relay call, no response", async () => {
  sendMessageCalls.length = 0;
  dispatchedEvents.length = 0;

  fireRequest({ requestId: null, steamid64: "76561198000000003" });
  await flush();

  assert.equal(sendMessageCalls.length, 0);
  assert.equal(dispatchedEvents.length, 0);
});

test("handledRequestIds dedupes a repeated requestId - the relay is only ever called once for it", async () => {
  sendMessageImpl = async () => ({ ok: true, data: { success: true } });
  sendMessageCalls.length = 0;
  dispatchedEvents.length = 0;

  const detail = { requestId: "req-dedupe", steamid64: "76561198000000004" };
  fireRequest(detail);
  fireRequest(detail); // re-dispatched, same requestId - mirrors tradeoffer.js's own 500ms retry loop
  await flush();

  assert.equal(sendMessageCalls.length, 1);
  assert.equal(dispatchedEvents.length, 1);
});

test("accepts a plain object detail (not just a JSON string)", async () => {
  sendMessageImpl = async () => ({ ok: true, data: { success: true, bptfBans: { banned: "bad" } } });
  dispatchedEvents.length = 0;

  listeners[REQUEST_EVENT][0]({ detail: { requestId: "req-object", steamid64: "76561198000000005" } });
  await flush();

  const payload = JSON.parse(dispatchedEvents[0].detail);
  assert.equal(payload.requestId, "req-object");
  assert.deepEqual(payload.bannedSites, ["backpack.tf"]);
});
