import { test } from "node:test";
import assert from "node:assert/strict";
import { searchPricedbSkuStatus, __resetPricedbCacheForTests } from "../utils/pricedb.js";

// Just the sku, for tests that only care which listing was matched.
async function searchSku(itemName) {
  return (await searchPricedbSkuStatus(itemName)).sku;
}

test.beforeEach(() => {
  __resetPricedbCacheForTests();
});

test("returns null without ever calling sendMessage when itemName is falsy", async () => {
  let called = false;
  global.chrome = { runtime: { sendMessage: async () => (called = true) } };

  const sku = await searchSku("");

  assert.equal(sku, null);
  assert.equal(called, false);
});

test("returns the exactly-named result's own sku field on a successful search", async () => {
  let requestedUrl = null;
  global.chrome = {
    runtime: {
      sendMessage: async (msg) => {
        requestedUrl = msg.url;
        return {
          ok: true,
          data: {
            success: true,
            data: {
              query: "backburner",
              results: [{ name: "Strange Professional Killstreak Backburner", sku: "40;11;kt-3" }],
              total: 1,
            },
          },
        };
      },
    },
  };

  const sku = await searchSku("Strange Professional Killstreak Backburner");

  assert.equal(sku, "40;11;kt-3");
  const url = new URL(requestedUrl);
  assert.equal(url.origin + url.pathname, "https://pricedb.io/api/search");
  assert.equal(url.searchParams.get("q"), "Strange Professional Killstreak Backburner");
  assert.equal(url.searchParams.get("limit"), "50");
});

// Real response shape, confirmed live: pricedb.io sorts search results
// alphabetically, so Unusual variants come before the plain item.
function pricedbPage(results, { hasMore = false, nextCursor = null } = {}) {
  return { ok: true, data: { success: true, data: { results, hasMore, nextCursor } } };
}

test("picks the exactly-named result, not the alphabetically-first Unusual variant", async () => {
  global.chrome = {
    runtime: {
      sendMessage: async () =>
        pricedbPage(
          [
            { name: "Aces High Brotherhood of Arms", sku: "30066;5;u59" },
            { name: "Blizzardy Storm Brotherhood of Arms", sku: "30066;5;u30" },
            { name: "Bonzo the All-Gnawing Brotherhood of Arms", sku: "30066;5;u81" },
            { name: "Brotherhood of Arms", sku: "30066;6" },
          ],
          { hasMore: true, nextCursor: "c1" }
        ),
    },
  };

  assert.equal(await searchSku("Brotherhood of Arms"), "30066;6");
});

test("matches the name case- and whitespace-insensitively", async () => {
  global.chrome = {
    runtime: {
      sendMessage: async () => pricedbPage([{ name: "Aces High Team Captain", sku: "378;5;u59" }, { name: "Team Captain", sku: "378;6" }], { hasMore: true, nextCursor: "c1" }),
    },
  };

  assert.equal(await searchSku("  team   captain "), "378;6");
});

test("follows the cursor to a later page when the exact name isn't on the first", async () => {
  const cursors = [];
  global.chrome = {
    runtime: {
      sendMessage: async (msg) => {
        const cursor = new URL(msg.url).searchParams.get("cursor");
        cursors.push(cursor);
        return cursor
          ? pricedbPage([{ name: "Team Captain", sku: "378;6" }])
          : pricedbPage([{ name: "Aces High Team Captain", sku: "378;5;u59" }], { hasMore: true, nextCursor: "page2" });
      },
    },
  };

  assert.equal(await searchSku("Team Captain"), "378;6");
  assert.deepEqual(cursors, [null, "page2"]);
});

test("gives up after a bounded number of pages and returns null rather than a wrong item", async () => {
  let calls = 0;
  global.chrome = {
    runtime: {
      sendMessage: async () => {
        calls++;
        return pricedbPage([{ name: `Effect ${calls} Team Captain`, sku: `378;5;u${calls}` }], { hasMore: true, nextCursor: `c${calls}` });
      },
    },
  };

  assert.equal(await searchSku("Team Captain"), null);
  assert.equal(calls, 3);
});

test("several results with none exactly named returns null instead of guessing the first", async () => {
  global.chrome = {
    runtime: {
      sendMessage: async () => pricedbPage([{ name: "Aces High Brotherhood of Arms", sku: "30066;5;u59" }, { name: "Bubbling Brotherhood of Arms", sku: "30066;5;u34" }]),
    },
  };

  assert.equal(await searchSku("Brotherhood of Arms"), null);
});

test("a rate limit on a later page reports rateLimited and isn't cached", async () => {
  let calls = 0;
  global.chrome = {
    runtime: {
      sendMessage: async () => {
        calls++;
        return calls === 1
          ? pricedbPage([{ name: "Aces High Team Captain", sku: "378;5;u59" }], { hasMore: true, nextCursor: "page2" })
          : { ok: false, status: 429, error: "Rate limited (429)", retryAfterMs: 5000 };
      },
    },
  };

  const status = await searchPricedbSkuStatus("Team Captain");
  assert.deepEqual(status, { sku: null, rateLimited: true, retryAfterMs: 5000 });
});

test("returns null when the search comes back with zero results", async () => {
  global.chrome = {
    runtime: {
      sendMessage: async () => ({
      ok: true,
      data: { success: true, data: { query: "nonsense item", results: [], total: 0 } },
    }),
    },
  };

  const sku = await searchSku("Nonsense Item That Doesn't Exist");

  assert.equal(sku, null);
});

test("returns null when the relayed fetch itself failed (network error / rate limited)", async () => {
  global.chrome = {
    runtime: {
      sendMessage: async () => ({ ok: false, error: "Rate limited (429)" }),
    },
  };

  const sku = await searchSku("Backburner");

  assert.equal(sku, null);
});

// REGRESSION for a live bug report: this search re-ran on every single item
// selection with no cache, adding a full network round trip to every one -
// including re-viewing an item already looked up earlier in the same page
// load.
test("caches a successful result per item name - a second lookup for the same name doesn't call sendMessage again", async () => {
  let callCount = 0;
  global.chrome = {
    runtime: {
      sendMessage: async () => {
        callCount++;
        return { ok: true, data: { success: true, data: { results: [{ sku: "40;11;kt-3" }] } } };
      },
    },
  };

  const first = await searchSku("Backburner");
  const second = await searchSku("Backburner");

  assert.equal(first, "40;11;kt-3");
  assert.equal(second, "40;11;kt-3");
  assert.equal(callCount, 1);
});

test("does NOT cache a failed lookup - a later call for the same name retries instead of staying stuck on null", async () => {
  let callCount = 0;
  global.chrome = {
    runtime: {
      sendMessage: async () => {
        callCount++;
        return callCount === 1
          ? { ok: false, error: "Rate limited (429)" }
          : { ok: true, data: { success: true, data: { results: [{ sku: "40;11;kt-3" }] } } };
      },
    },
  };

  const first = await searchSku("Backburner");
  const second = await searchSku("Backburner");

  assert.equal(first, null);
  assert.equal(second, "40;11;kt-3");
  assert.equal(callCount, 2);
});

// A rate-limited lookup used to look IDENTICAL to "this item genuinely has
// no pricedb.io listing" - both just returned null with no way for a caller
// to tell them apart. background.js's own fetchJson already reads the real
// HTTP 429 status (and Retry-After header) off the response -
// searchPricedbSkuStatus surfaces that instead of discarding it.
test("searchPricedbSkuStatus distinguishes a real 429 rate limit from a genuine 'no results' miss", async () => {
  global.chrome = {
    runtime: {
      sendMessage: async () => ({ ok: false, status: 429, error: "Rate limited (429)", retryAfterMs: 30000 }),
    },
  };

  const result = await searchPricedbSkuStatus("Backburner");

  assert.equal(result.sku, null);
  assert.equal(result.rateLimited, true);
  assert.equal(result.retryAfterMs, 30000);
});

test("searchPricedbSkuStatus reports rateLimited: false for a genuine zero-result search", async () => {
  global.chrome = {
    runtime: {
      sendMessage: async () => ({ ok: true, data: { success: true, data: { results: [], total: 0 } } }),
    },
  };

  const result = await searchPricedbSkuStatus("Nonsense Item That Doesn't Exist");

  assert.equal(result.sku, null);
  assert.equal(result.rateLimited, false);
});

test("searchPricedbSkuStatus reports rateLimited: false for a non-429 failure (e.g. a network error)", async () => {
  global.chrome = {
    runtime: {
      sendMessage: async () => ({ ok: false, error: "Failed to fetch" }),
    },
  };

  const result = await searchPricedbSkuStatus("Backburner");

  assert.equal(result.sku, null);
  assert.equal(result.rateLimited, false);
});

test("__resetPricedbCacheForTests clears a previously-cached result", async () => {
  global.chrome = {
    runtime: {
      sendMessage: async () => ({ ok: true, data: { success: true, data: { results: [{ sku: "18;6" }] } } }),
    },
  };
  await searchSku("Rocket Launcher");

  __resetPricedbCacheForTests();

  let calledAgain = false;
  global.chrome.runtime.sendMessage = async () => {
    calledAgain = true;
    return { ok: true, data: { success: true, data: { results: [{ sku: "18;6" }] } } };
  };
  await searchSku("Rocket Launcher");

  assert.equal(calledAgain, true);
});
