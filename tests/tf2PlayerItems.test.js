import { test } from "node:test";
import assert from "node:assert/strict";
import { getPlayerItemsById } from "../utils/tf2PlayerItems.js";
// The key lookup tf2PlayerItems.js reads through.
import { hasSteamApiKey } from "../utils/tf2Schema.js";

// Fakes chrome.storage.local.get(["steamApiKey"]) and
// chrome.runtime.sendMessage's FETCH_JSON relay (see the module's own
// fetchJson comment on why a content script can't just fetch() this itself).
function setupFakes({ apiKey, sendMessage }) {
  globalThis.chrome = {
    storage: { local: { get: async () => (apiKey ? { steamApiKey: apiKey } : {}) } },
    runtime: { sendMessage: sendMessage || (async () => ({ ok: false, error: "not configured" })) },
  };
}

test("hasSteamApiKey resolves true when a key is configured", async () => {
  setupFakes({ apiKey: "KEY123" });
  assert.equal(await hasSteamApiKey(), true);
});

test("hasSteamApiKey resolves false when no key is configured", async () => {
  setupFakes({ apiKey: null });
  assert.equal(await hasSteamApiKey(), false);
});

test("getPlayerItemsById returns null and never calls sendMessage when no key is configured", async () => {
  let sendMessageCalls = 0;
  setupFakes({ apiKey: null, sendMessage: async () => { sendMessageCalls++; return { ok: true, data: {} }; } });

  const result = await getPlayerItemsById("id-no-key");
  assert.equal(result, null);
  assert.equal(sendMessageCalls, 0);
});

test("getPlayerItemsById builds a Map keyed by String(item.id), skipping items with a null id or defindex", async () => {
  setupFakes({
    apiKey: "KEY123",
    sendMessage: async () => ({
      ok: true,
      data: {
        result: {
          items: [
            { id: 111, defindex: 205, quality: 6, style: 1 },
            { id: null, defindex: 42 },
            { id: 222, defindex: null },
            { id: 333, defindex: 30, quality: 6 },
          ],
        },
      },
    }),
  });

  const byAssetId = await getPlayerItemsById("id-good");
  assert.equal(byAssetId.size, 2);
  assert.deepEqual(byAssetId.get("111"), { defindex: 205, quality: 6, style: 1 });
  assert.deepEqual(byAssetId.get("333"), { defindex: 30, quality: 6, style: undefined });
});

test("getPlayerItemsById dedupes concurrent/sequential calls for the same steamId64, calling sendMessage only once", async () => {
  let sendMessageCalls = 0;
  setupFakes({
    apiKey: "KEY123",
    sendMessage: async () => {
      sendMessageCalls++;
      return { ok: true, data: { result: { items: [{ id: 1, defindex: 2, quality: 6 }] } } };
    },
  });

  const steamId = "id-dedupe";
  const [first, second] = await Promise.all([getPlayerItemsById(steamId), getPlayerItemsById(steamId)]);

  assert.equal(sendMessageCalls, 1);
  assert.equal(first, second);
});

test("getPlayerItemsById returns null when result.items isn't an array", async () => {
  setupFakes({
    apiKey: "KEY123",
    sendMessage: async () => ({ ok: true, data: { result: {} } }), // no items field at all
  });

  assert.equal(await getPlayerItemsById("id-malformed"), null);
});

test("getPlayerItemsById returns null and warns when the fetch throws", async () => {
  const originalWarn = console.warn;
  console.warn = () => {};
  setupFakes({
    apiKey: "KEY123",
    sendMessage: async () => {
      throw new Error("network down");
    },
  });

  try {
    assert.equal(await getPlayerItemsById("id-throws"), null);
  } finally {
    console.warn = originalWarn;
  }
});

// REGRESSION for a live bug report: a real GetPlayerItems call failed with a
// transient 503, and (before fetchJsonRelay existed) that failed the WHOLE
// lookup on the very first attempt - steamcommunity.com/itemQuickLinks/
// content.js's own resolveRealItemName then silently fell back to the
// item's on-page RENAMED title for every quick-link button, with no visible
// sign anything had gone wrong. Now a transient 503 is retried automatically
// (via utils/fetchJsonRelay.js) WITHIN this single getPlayerItemsById call,
// rather than needing a second, separate call the way the "does not memoize"
// test above (a non-transient failure, no status field) does.
test("automatically retries a transient (503) GetPlayerItems failure within a single call, rather than failing outright", async () => {
  let sendMessageCalls = 0;
  setupFakes({
    apiKey: "KEY123",
    sendMessage: async () => {
      sendMessageCalls++;
      if (sendMessageCalls < 3) return { ok: false, status: 503, error: "Request failed (503)" };
      return { ok: true, data: { result: { items: [{ id: 9, defindex: 10, quality: 6 }] } } };
    },
  });

  const result = await getPlayerItemsById("id-transient-503");
  assert.equal(result.size, 1);
  assert.equal(sendMessageCalls, 3);
});

test("getPlayerItemsById does not memoize a failed/null result, so a later call retries", async () => {
  let sendMessageCalls = 0;
  const steamId = "id-retry";
  globalThis.chrome = {
    storage: { local: { get: async () => ({ steamApiKey: "KEY123" }) } },
    runtime: {
      sendMessage: async () => {
        sendMessageCalls++;
        if (sendMessageCalls === 1) return { ok: false, error: "transient failure" };
        return { ok: true, data: { result: { items: [{ id: 9, defindex: 10, quality: 6 }] } } };
      },
    },
  };

  const firstResult = await getPlayerItemsById(steamId);
  assert.equal(firstResult, null);

  const secondResult = await getPlayerItemsById(steamId);
  assert.equal(secondResult.size, 1);
  assert.equal(sendMessageCalls, 2);
});
