import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getMarketplaceLiveKeyPriceUsd,
  parseHighestVolumePriceUsd,
  MARKETPLACE_KEY_PRICE_CACHE_TTL_MS,
} from "../utils/marketplaceTfPricing.js";

// Same hand-rolled fake style tests/scmPricing.test.js's own header note
// documents - fakes just the chrome.storage.local surface this module reads/
// writes, plus a minimal `document` standing in for the real page (only ever
// queried for its own <script> tags, to find the inline MPTF.csrfCode
// assignment - see content.js's own header note on why that needs no
// MAIN-world bridge).

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

function setupChrome(initial = {}) {
  globalThis.chrome = { storage: { local: fakeStorageLocal(initial) } };
}

function fakeDoc(scriptTexts = []) {
  return {
    querySelectorAll: (selector) => (selector === "script" ? scriptTexts.map((text) => ({ textContent: text })) : []),
  };
}

const LOGGED_IN_DOC = fakeDoc(['MPTF.csrfCode = "abc123";', 'MPTF.CurrentPage = "items";']);
const LOGGED_OUT_DOC = fakeDoc(['MPTF.CurrentPage = "items";']); // no csrfCode assignment at all

function fakeResponse({ status = 200, body = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

// Confirmed-live GetDayStats response shape (see this module's own header
// note): one <tr> per distinct price point that day.
function fakeDayStatsHtml(rows) {
  const trs = rows.map(([price, volume]) => `\t\t\t<tr>\n\t\t\t<td>$${price}</td>\n\t\t\t<td>${volume}</td>\n\t\t</tr>`).join("\n");
  return `<table>\n\t<thead>...</thead>\n\t<tbody>\n${trs}\n\t</tbody>\n</table>`;
}

test("parseHighestVolumePriceUsd picks the price with the highest volume", () => {
  const html = fakeDayStatsHtml([
    ["1.84", "383"],
    ["1.86", "4"],
    ["1.88", "1723"],
  ]);
  assert.equal(parseHighestVolumePriceUsd(html), 1.88);
});

test("parseHighestVolumePriceUsd returns null for an empty table (no rows)", () => {
  assert.equal(parseHighestVolumePriceUsd(fakeDayStatsHtml([])), null);
});

test("parseHighestVolumePriceUsd handles a single row", () => {
  assert.equal(parseHighestVolumePriceUsd(fakeDayStatsHtml([["2.50", "1"]])), 2.5);
});

test("parseHighestVolumePriceUsd strips thousands separators from the price", () => {
  const html = fakeDayStatsHtml([["1,234.56", "1"]]);
  assert.equal(parseHighestVolumePriceUsd(html), 1234.56);
});

test("getMarketplaceLiveKeyPriceUsd fetches fresh, sends the expected request shape, and caches the result", async () => {
  setupChrome();
  let capturedUrl;
  let capturedInit;
  globalThis.fetch = async (url, init) => {
    capturedUrl = url;
    capturedInit = init;
    return fakeResponse({ body: { success: true, html: fakeDayStatsHtml([["1.88", "1723"]]) } });
  };

  const value = await getMarketplaceLiveKeyPriceUsd({ doc: LOGGED_IN_DOC });

  assert.equal(value, 1.88);
  assert.equal(capturedUrl, "https://marketplace.tf/ajax/items/GetDayStats");
  assert.equal(capturedInit.method, "POST");
  assert.match(capturedInit.body, /sku=5021%3B6/);
  assert.match(capturedInit.body, /csrf=abc123/);
  assert.match(capturedInit.body, /timestamp=[A-Za-z]+%20\d+%2C%20\d{4}/); // urlencoded "Month Day, Year"

  const stored = await globalThis.chrome.storage.local.get(["mptfLiveKeyPriceUsd"]);
  assert.equal(stored.mptfLiveKeyPriceUsd.value, 1.88);
  assert.ok(Number.isFinite(stored.mptfLiveKeyPriceUsd.fetchedAt));
});

test("concurrent getMarketplaceLiveKeyPriceUsd calls with a stale cache share one GetDayStats request", async () => {
  setupChrome();
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls++;
    return fakeResponse({ body: { success: true, html: fakeDayStatsHtml([["1.88", "1723"]]) } });
  };

  const values = await Promise.all([
    getMarketplaceLiveKeyPriceUsd({ doc: LOGGED_IN_DOC }),
    getMarketplaceLiveKeyPriceUsd({ doc: LOGGED_IN_DOC }),
    getMarketplaceLiveKeyPriceUsd({ doc: LOGGED_IN_DOC }),
  ]);

  assert.deepEqual(values, [1.88, 1.88, 1.88]);
  assert.equal(fetchCalls, 1);
});

test("getMarketplaceLiveKeyPriceUsd skips refetching when the cache is within MARKETPLACE_KEY_PRICE_CACHE_TTL_MS", async () => {
  let fetchCalls = 0;
  setupChrome({ mptfLiveKeyPriceUsd: { value: 9.99, fetchedAt: Date.now() } });
  globalThis.fetch = async () => {
    fetchCalls++;
    return fakeResponse({ body: { success: true, html: fakeDayStatsHtml([["1.00", "1"]]) } });
  };

  const value = await getMarketplaceLiveKeyPriceUsd({ doc: LOGGED_IN_DOC });
  assert.equal(value, 9.99);
  assert.equal(fetchCalls, 0);
});

test("getMarketplaceLiveKeyPriceUsd's forceRefresh bypasses a still-fresh cache", async () => {
  let fetchCalls = 0;
  setupChrome({ mptfLiveKeyPriceUsd: { value: 9.99, fetchedAt: Date.now() } });
  globalThis.fetch = async () => {
    fetchCalls++;
    return fakeResponse({ body: { success: true, html: fakeDayStatsHtml([["1.23", "1"]]) } });
  };

  const value = await getMarketplaceLiveKeyPriceUsd({ forceRefresh: true, doc: LOGGED_IN_DOC });
  assert.equal(value, 1.23);
  assert.equal(fetchCalls, 1);
});

test("getMarketplaceLiveKeyPriceUsd refetches once the cache is older than the TTL", async () => {
  let fetchCalls = 0;
  setupChrome({ mptfLiveKeyPriceUsd: { value: 1.0, fetchedAt: Date.now() - MARKETPLACE_KEY_PRICE_CACHE_TTL_MS - 1 } });
  globalThis.fetch = async () => {
    fetchCalls++;
    return fakeResponse({ body: { success: true, html: fakeDayStatsHtml([["2.00", "1"]]) } });
  };

  const value = await getMarketplaceLiveKeyPriceUsd({ doc: LOGGED_IN_DOC });
  assert.equal(value, 2.0);
  assert.equal(fetchCalls, 1);
});

test("getMarketplaceLiveKeyPriceUsd falls back to the stale cache when no CSRF token can be found (logged out)", async () => {
  let fetchCalls = 0;
  setupChrome({ mptfLiveKeyPriceUsd: { value: 5.0, fetchedAt: Date.now() - MARKETPLACE_KEY_PRICE_CACHE_TTL_MS - 1 } });
  globalThis.fetch = async () => {
    fetchCalls++;
    return fakeResponse({ body: { success: true, html: fakeDayStatsHtml([["1.00", "1"]]) } });
  };

  const value = await getMarketplaceLiveKeyPriceUsd({ doc: LOGGED_OUT_DOC });
  assert.equal(value, 5.0);
  assert.equal(fetchCalls, 0); // never even attempted the request without a CSRF token
});

test("getMarketplaceLiveKeyPriceUsd returns null when nothing is cached and no CSRF token is found", async () => {
  setupChrome();
  globalThis.fetch = async () => fakeResponse({ body: { success: true, html: fakeDayStatsHtml([["1.00", "1"]]) } });

  assert.equal(await getMarketplaceLiveKeyPriceUsd({ doc: LOGGED_OUT_DOC }), null);
});

test("getMarketplaceLiveKeyPriceUsd falls back to the stale cache on a network error", async () => {
  setupChrome({ mptfLiveKeyPriceUsd: { value: 3.21, fetchedAt: Date.now() - MARKETPLACE_KEY_PRICE_CACHE_TTL_MS - 1 } });
  globalThis.fetch = async () => {
    throw new Error("network down");
  };

  assert.equal(await getMarketplaceLiveKeyPriceUsd({ doc: LOGGED_IN_DOC }), 3.21);
});

test("getMarketplaceLiveKeyPriceUsd falls back to the stale cache on a non-ok response", async () => {
  setupChrome({ mptfLiveKeyPriceUsd: { value: 4.44, fetchedAt: Date.now() - MARKETPLACE_KEY_PRICE_CACHE_TTL_MS - 1 } });
  globalThis.fetch = async () => fakeResponse({ status: 500 });

  assert.equal(await getMarketplaceLiveKeyPriceUsd({ doc: LOGGED_IN_DOC }), 4.44);
});

test("getMarketplaceLiveKeyPriceUsd falls back to the stale cache when the response reports success: false", async () => {
  setupChrome({ mptfLiveKeyPriceUsd: { value: 6.66, fetchedAt: Date.now() - MARKETPLACE_KEY_PRICE_CACHE_TTL_MS - 1 } });
  globalThis.fetch = async () => fakeResponse({ body: { success: false } });

  assert.equal(await getMarketplaceLiveKeyPriceUsd({ doc: LOGGED_IN_DOC }), 6.66);
});

test("getMarketplaceLiveKeyPriceUsd falls back to the stale cache when the returned table has no parseable rows", async () => {
  setupChrome({ mptfLiveKeyPriceUsd: { value: 7.77, fetchedAt: Date.now() - MARKETPLACE_KEY_PRICE_CACHE_TTL_MS - 1 } });
  globalThis.fetch = async () => fakeResponse({ body: { success: true, html: fakeDayStatsHtml([]) } });

  assert.equal(await getMarketplaceLiveKeyPriceUsd({ doc: LOGGED_IN_DOC }), 7.77);
});

test("getMarketplaceLiveKeyPriceUsd backs off after 3 consecutive failures, skipping the fetch entirely on the 4th call", async () => {
  let fetchCalls = 0;
  setupChrome({ mptfLiveKeyPriceUsd: { value: 8.88, fetchedAt: 0 } }); // always stale, forceRefresh not needed
  globalThis.fetch = async () => {
    fetchCalls++;
    throw new Error("network down");
  };

  for (let i = 0; i < 3; i++) {
    assert.equal(await getMarketplaceLiveKeyPriceUsd({ forceRefresh: true, doc: LOGGED_IN_DOC }), 8.88);
  }
  assert.equal(fetchCalls, 3);

  // 4th call: now in cooldown, fetch should never even be attempted.
  const value = await getMarketplaceLiveKeyPriceUsd({ forceRefresh: true, doc: LOGGED_IN_DOC });
  assert.equal(value, 8.88);
  assert.equal(fetchCalls, 3);
});

// marketplace.tf/keyPriceDisplay asks for the price on every page update, so
// during the 24h cooldown each of those calls is skipped on purpose. Warning
// about every skipped call filled the console with one line per page update;
// only real request failures are worth a warning.
test("getMarketplaceLiveKeyPriceUsd stays quiet about calls skipped during the failure cooldown", async () => {
  setupChrome({ mptfLiveKeyPriceUsd: { value: 8.88, fetchedAt: 0 } });
  globalThis.fetch = async () => {
    throw new Error("network down");
  };

  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args);
  try {
    for (let i = 0; i < 3; i++) await getMarketplaceLiveKeyPriceUsd({ doc: LOGGED_IN_DOC });
    assert.equal(warnings.length, 3, "each real failure is reported");

    for (let i = 0; i < 5; i++) {
      assert.equal(await getMarketplaceLiveKeyPriceUsd({ doc: LOGGED_IN_DOC }), 8.88);
    }
    assert.equal(warnings.length, 3, "skipped calls add no warnings");
  } finally {
    console.warn = originalWarn;
  }
});

// No token means no request, so it must not count toward the 24h cooldown:
// browsing logged out (every page update asks for the price) and then
// logging in would otherwise show no key price for a day.
test("getMarketplaceLiveKeyPriceUsd never starts the failure cooldown for a page with no CSRF token", async () => {
  let fetchCalls = 0;
  setupChrome({ mptfLiveKeyPriceUsd: { value: 1.0, fetchedAt: 0 } });
  globalThis.fetch = async () => {
    fetchCalls++;
    return fakeResponse({ body: { success: true, html: fakeDayStatsHtml([["2.00", "1"]]) } });
  };

  for (let i = 0; i < 5; i++) {
    assert.equal(await getMarketplaceLiveKeyPriceUsd({ doc: LOGGED_OUT_DOC }), 1.0);
  }
  assert.equal(fetchCalls, 0);

  assert.equal(await getMarketplaceLiveKeyPriceUsd({ doc: LOGGED_IN_DOC }), 2.0);
  assert.equal(fetchCalls, 1);
});

test("getMarketplaceLiveKeyPriceUsd's backoff resets on a success, so an isolated later failure doesn't trigger cooldown early", async () => {
  let mode = "fail";
  let fetchCalls = 0;
  setupChrome({ mptfLiveKeyPriceUsd: { value: 1.0, fetchedAt: 0 } });
  globalThis.fetch = async () => {
    fetchCalls++;
    if (mode === "fail") throw new Error("network down");
    return fakeResponse({ body: { success: true, html: fakeDayStatsHtml([["2.00", "1"]]) } });
  };

  await getMarketplaceLiveKeyPriceUsd({ forceRefresh: true, doc: LOGGED_IN_DOC }); // failure 1
  await getMarketplaceLiveKeyPriceUsd({ forceRefresh: true, doc: LOGGED_IN_DOC }); // failure 2
  mode = "succeed";
  const recovered = await getMarketplaceLiveKeyPriceUsd({ forceRefresh: true, doc: LOGGED_IN_DOC }); // success resets count
  assert.equal(recovered, 2.0);

  mode = "fail";
  await getMarketplaceLiveKeyPriceUsd({ forceRefresh: true, doc: LOGGED_IN_DOC }); // only 1 consecutive failure now
  assert.equal(fetchCalls, 4); // not skipped - still under the 3-failure threshold
});
