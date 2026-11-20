import { test } from "node:test";
import assert from "node:assert/strict";
import { buildListingParams, publishListing, LISTING_ENDPOINT } from "../backpack.tf/oldUI/listingQueue/publishRequest.js";

test("buildListingParams builds the full confirmed param shape", () => {
  const params = buildListingParams({
    assetId: "12345",
    keys: 2,
    metal: 5.5,
    details: "Add me for a quick trade!",
    tradeOfferUrl: "https://steamcommunity.com/tradeoffer/new/?partner=1&token=abc",
    userId: "999",
  });

  assert.deepEqual(params, {
    intent: "sell",
    "currencies[metal]": "5.5",
    "currencies[keys]": "2",
    promoted: "0",
    buyout: "0",
    offers: "1",
    trade_offer_url: "https://steamcommunity.com/tradeoffer/new/?partner=1&token=abc",
    details: "Add me for a quick trade!",
    id: "12345",
    "user-id": "999",
  });
});

test("buildListingParams defaults keys/metal/details/tradeOfferUrl/userId to safe empty values, never undefined", () => {
  const params = buildListingParams({ assetId: "1" });

  assert.equal(params["currencies[keys]"], "0");
  assert.equal(params["currencies[metal]"], "0");
  assert.equal(params.details, "");
  assert.equal(params.trade_offer_url, "");
  assert.equal(params["user-id"], "");
  assert.equal(params.id, "1");
});

test("LISTING_ENDPOINT is backpack.tf's own classifieds listing endpoint (same-origin from a backpack.tf content script)", () => {
  assert.equal(LISTING_ENDPOINT, "https://backpack.tf/classifieds/listing");
});

test("publishListing posts form-encoded params with credentials included, and resolves with the parsed JSON body on success", async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, json: async () => ({ result: { id: "abc" } }) };
  };

  const result = await publishListing({ id: "1", intent: "sell" });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, LISTING_ENDPOINT);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.credentials, "include");
  assert.equal(calls[0].init.headers["Content-Type"], "application/x-www-form-urlencoded");
  assert.equal(calls[0].init.body, "id=1&intent=sell");
  assert.deepEqual(result, { result: { id: "abc" } });
});

test("publishListing throws the server's own JSON error message on a non-ok response", async () => {
  globalThis.fetch = async () => ({
    ok: false,
    status: 400,
    json: async () => ({ message: "You already have a listing for this item." }),
  });

  await assert.rejects(() => publishListing({ id: "1" }), /You already have a listing for this item\./);
});

// An HTML error/block page must not surface as a JSON SyntaxError - the real
// HTTP failure has to come through instead.
test("publishListing falls back to a plain 'HTTP {status}' message when the error body isn't JSON at all", async () => {
  globalThis.fetch = async () => ({
    ok: false,
    status: 502,
    json: async () => {
      throw new SyntaxError("Unexpected token < in JSON");
    },
  });

  await assert.rejects(() => publishListing({ id: "1" }), /^Error: HTTP 502$/);
});

test("publishListing resolves to an empty object (not a rejection) when a successful response has no JSON body at all", async () => {
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => {
      throw new SyntaxError("Unexpected end of input");
    },
  });

  const result = await publishListing({ id: "1" });
  assert.deepEqual(result, {});
});
