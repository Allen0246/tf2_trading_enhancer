import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchTradeOfferSummary } from "../utils/steamTradeOffers.js";

// Fakes the one global this module calls - fetch(url, options) returning a
// minimal Response-like object (ok/status/json()).
function fakeFetch(responder) {
  return async (url, options) => responder(url, options);
}

test("fetchTradeOfferSummary returns json.response on success", async () => {
  const summary = { pending_received_count: 2, new_received_count: 1 };
  globalThis.fetch = fakeFetch(async () => ({
    ok: true,
    json: async () => ({ response: summary }),
  }));

  const result = await fetchTradeOfferSummary("FAKE_KEY");
  assert.deepEqual(result, summary);
});

test("fetchTradeOfferSummary returns null when the response has no response field", async () => {
  globalThis.fetch = fakeFetch(async () => ({ ok: true, json: async () => ({}) }));
  assert.equal(await fetchTradeOfferSummary("FAKE_KEY"), null);
});

test("fetchTradeOfferSummary throws with the status code when the response isn't ok", async () => {
  globalThis.fetch = fakeFetch(async () => ({ ok: false, status: 403, json: async () => ({}) }));
  await assert.rejects(fetchTradeOfferSummary("FAKE_KEY"), /403/);
});

test("fetchTradeOfferSummary sends the api key as the key query param, omitting credentials", () => {
  let capturedUrl;
  let capturedOptions;
  globalThis.fetch = fakeFetch(async (url, options) => {
    capturedUrl = url;
    capturedOptions = options;
    return { ok: true, json: async () => ({ response: {} }) };
  });

  return fetchTradeOfferSummary("MY_SECRET_KEY").then(() => {
    const url = new URL(capturedUrl);
    assert.equal(url.origin + url.pathname, "https://api.steampowered.com/IEconService/GetTradeOffersSummary/v1/");
    assert.equal(url.searchParams.get("key"), "MY_SECRET_KEY");
    // omitting credentials keeps a bad/revoked key from silently "working"
    // via a logged-in session backing it up instead - see the module's own
    // comment on why.
    assert.equal(capturedOptions.credentials, "omit");
  });
});
