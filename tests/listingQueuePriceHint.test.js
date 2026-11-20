import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateStartingPrice } from "../backpack.tf/oldUI/listingQueue/priceHint.js";

test("splits a ref price into whole keys + a metal remainder when a live key value is available", () => {
  // Confirmed live: "Vintage Blutsauger" - data-price="2.44" (ref), well
  // under a single key's own value.
  assert.deepEqual(estimateStartingPrice(2.44, 60), { keys: 0, metal: 2.44 });
});

test("floors to whole keys, carrying the exact remainder as metal", () => {
  // 2 keys @ 60 ref/key = 120 ref, + 5.5 ref left over.
  assert.deepEqual(estimateStartingPrice(125.5, 60), { keys: 2, metal: 5.5 });
});

test("an exact multiple of the key value comes back as pure keys, zero metal", () => {
  assert.deepEqual(estimateStartingPrice(180, 60), { keys: 3, metal: 0 });
});

// 150.39 / 50.13 is 2.9999999999999996 in floating point, which floored to 2
// keys plus a whole key's worth of metal (50.13 ref).
test("an exact multiple stays pure keys even when the division lands a hair under the whole number", () => {
  assert.deepEqual(estimateStartingPrice(150.39, 50.13), { keys: 3, metal: 0 });
  assert.deepEqual(estimateStartingPrice(250.45, 50.09), { keys: 5, metal: 0 });
});

test("rounds the metal remainder to 2 decimal places (floating-point safe)", () => {
  const result = estimateStartingPrice(100, 33.333);
  assert.equal(result.keys, 3);
  assert.equal(result.metal, Math.round((100 - 3 * 33.333) * 100) / 100);
});

test("falls back to expressing the whole hint as metal when no live key value is available", () => {
  assert.deepEqual(estimateStartingPrice(88, null), { keys: 0, metal: 88 });
  assert.deepEqual(estimateStartingPrice(88, 0), { keys: 0, metal: 88 });
  assert.deepEqual(estimateStartingPrice(88, undefined), { keys: 0, metal: 88 });
});

test("returns zero for a missing, zero, or negative price hint, regardless of key value", () => {
  assert.deepEqual(estimateStartingPrice(null, 60), { keys: 0, metal: 0 });
  assert.deepEqual(estimateStartingPrice(0, 60), { keys: 0, metal: 0 });
  assert.deepEqual(estimateStartingPrice(-5, 60), { keys: 0, metal: 0 });
  assert.deepEqual(estimateStartingPrice(undefined, 60), { keys: 0, metal: 0 });
});

test("accepts numeric-string inputs the same way (data-price/data-priceindex attributes are always strings off the DOM)", () => {
  assert.deepEqual(estimateStartingPrice("125.5", "60"), { keys: 2, metal: 5.5 });
});
