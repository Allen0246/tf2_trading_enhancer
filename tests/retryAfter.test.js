import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRetryAfterMs } from "../utils/retryAfter.js";

test("parseRetryAfterMs reads integer delta-seconds as milliseconds", () => {
  assert.equal(parseRetryAfterMs("42"), 42000);
  assert.equal(parseRetryAfterMs("0"), 0);
});

test("parseRetryAfterMs reads an HTTP-date as the time left until it", () => {
  const inTenSeconds = new Date(Date.now() + 10_000).toUTCString();
  const ms = parseRetryAfterMs(inTenSeconds);
  assert.ok(ms > 8000 && ms <= 10_000, `got ${ms}`);
});

test("parseRetryAfterMs never returns a negative wait for a date in the past", () => {
  assert.equal(parseRetryAfterMs(new Date(Date.now() - 60_000).toUTCString()), 0);
});

test("parseRetryAfterMs returns null (not NaN) for a missing or unreadable header", () => {
  assert.equal(parseRetryAfterMs(null), null);
  assert.equal(parseRetryAfterMs(undefined), null);
  assert.equal(parseRetryAfterMs(""), null);
  assert.equal(parseRetryAfterMs("not a real value"), null);
});
