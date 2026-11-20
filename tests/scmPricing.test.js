import { test } from "node:test";
import assert from "node:assert/strict";
import { getScmLowestPriceText } from "../utils/scmPricing.js";

// Fakes the subset of chrome.storage.local the rate limiter this module
// imports reads/writes (its own request timestamp history).
function fakeStorageLocal(initial = {}) {
  const store = { ...initial };
  return {
    async get(keys) {
      const result = {};
      for (const k of keys) if (k in store) result[k] = store[k];
      return result;
    },
    async set(obj) {
      Object.assign(store, obj);
    },
  };
}

// Fakes the priceoverview Response object - ok/status/headers.get()/json().
function fakeResponse({ status = 200, body = {}, retryAfter = null }) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => (name === "Retry-After" ? retryAfter : null) },
    json: async () => body,
  };
}

function setupChrome(initial = {}) {
  globalThis.chrome = { storage: { local: fakeStorageLocal(initial) } };
}

function quietWarnings(fn) {
  return async () => {
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
      await fn();
    } finally {
      console.warn = originalWarn;
    }
  };
}

test("getScmLowestPriceText asks priceoverview for the item in the given wallet currency and returns Steam's own lowest_price text", async () => {
  setupChrome();
  let requested = null;
  globalThis.fetch = async (url) => {
    requested = new URL(url);
    return fakeResponse({ body: { success: true, lowest_price: "0,30€", median_price: "0,35€" } });
  };

  assert.equal(await getScmLowestPriceText("Specialized Killstreak Rocket Launcher Kit", 3), "0,30€");
  assert.equal(requested.searchParams.get("appid"), "440");
  assert.equal(requested.searchParams.get("currency"), "3");
  assert.equal(requested.searchParams.get("market_hash_name"), "Specialized Killstreak Rocket Launcher Kit");
});

test("getScmLowestPriceText returns null when there is no lowest_price (no listings)", async () => {
  setupChrome();
  globalThis.fetch = async () => fakeResponse({ body: { success: true, median_price: "0,35€" } });

  assert.equal(await getScmLowestPriceText("Some Kit", 3), null);
});

test(
  "getScmLowestPriceText returns null (never throws) on a failed request, a non-ok response, or success: false",
  quietWarnings(async () => {
    setupChrome();
    globalThis.fetch = async () => {
      throw new Error("network down");
    };
    assert.equal(await getScmLowestPriceText("Some Kit", 3), null);

    globalThis.fetch = async () => fakeResponse({ status: 500 });
    assert.equal(await getScmLowestPriceText("Some Kit", 3), null);

    globalThis.fetch = async () => fakeResponse({ body: { success: false } });
    assert.equal(await getScmLowestPriceText("Some Kit", 3), null);
  })
);

test("getScmLowestPriceText retries once after a 429 and returns the successful result", async () => {
  let fetchCalls = 0;
  setupChrome();
  globalThis.fetch = async () => {
    fetchCalls++;
    // Retry-After: "0" keeps retryWithRateLimit's post-429 wait real but
    // effectively instant, so this test stays fast without faking timers.
    if (fetchCalls === 1) return fakeResponse({ status: 429, retryAfter: "0" });
    return fakeResponse({ body: { success: true, lowest_price: "2,50€" } });
  };

  assert.equal(await getScmLowestPriceText("Some Kit", 3), "2,50€");
  assert.equal(fetchCalls, 2);
});

test(
  "getScmLowestPriceText gives up with null after a second 429",
  quietWarnings(async () => {
    let fetchCalls = 0;
    setupChrome();
    globalThis.fetch = async () => {
      fetchCalls++;
      return fakeResponse({ status: 429, retryAfter: "0" });
    };

    assert.equal(await getScmLowestPriceText("Some Kit", 3), null);
    assert.equal(fetchCalls, 2);
  })
);

// Retry-After may also be an HTTP-date; Number("Wed, ...") is NaN, which used
// to fall through to the full 60s window (and log "waiting NaNs").
test("REGRESSION: getScmLowestPriceText honors an HTTP-date Retry-After header", async () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalDateNow = Date.now;
  const start = Date.parse("2026-10-08T12:00:00Z");
  let now = start;
  Date.now = () => now;
  globalThis.setTimeout = (fn, delay) => {
    now += delay;
    fn();
  };

  let fetchCalls = 0;
  setupChrome();
  globalThis.fetch = async () => {
    fetchCalls++;
    if (fetchCalls === 1) return fakeResponse({ status: 429, retryAfter: new Date(start + 10_000).toUTCString() });
    return fakeResponse({ body: { success: true, lowest_price: "3,00€" } });
  };

  try {
    assert.equal(await getScmLowestPriceText("Some Kit", 3), "3,00€");
    // ~10s Retry-After (+ the limiter's 250ms buffer), not the 60s window.
    assert.ok(now - start < 20_000, `waited ${now - start}ms`);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    Date.now = originalDateNow;
  }
});
