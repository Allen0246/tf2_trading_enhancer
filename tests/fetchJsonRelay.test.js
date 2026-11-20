import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchJsonRelay } from "../utils/fetchJsonRelay.js";

function installChrome(sendMessage) {
  globalThis.chrome = { runtime: { sendMessage } };
}

test("returns the response's data on a successful first attempt, with no retry", async () => {
  const calls = [];
  installChrome(async (msg) => {
    calls.push(msg.url);
    return { ok: true, data: { hello: "world" } };
  });

  const data = await fetchJsonRelay("https://example.com/x");
  assert.deepEqual(data, { hello: "world" });
  assert.equal(calls.length, 1);
});

// REGRESSION for a live bug report: a transient GetPlayerItems 503 used to
// fail on the very first attempt, with no retry at all - this is the fix.
test("retries a transient (5xx) failure and succeeds once a later attempt returns ok", async () => {
  let callCount = 0;
  installChrome(async () => {
    callCount++;
    if (callCount < 3) return { ok: false, status: 503, error: "Request failed (503)" };
    return { ok: true, data: { recovered: true } };
  });

  const data = await fetchJsonRelay("https://example.com/x", { retryDelayMs: 1 });
  assert.deepEqual(data, { recovered: true });
  assert.equal(callCount, 3);
});

test("gives up after retries are exhausted and throws the last failure's error", async () => {
  let callCount = 0;
  installChrome(async () => {
    callCount++;
    return { ok: false, status: 503, error: "Request failed (503)" };
  });

  await assert.rejects(() => fetchJsonRelay("https://example.com/x", { retries: 2, retryDelayMs: 1 }), /503/);
  // 1 initial attempt + 2 retries = 3 total calls.
  assert.equal(callCount, 3);
});

test("retries exactly `retries` times, not more, regardless of options.retries value", async () => {
  let callCount = 0;
  installChrome(async () => {
    callCount++;
    return { ok: false, status: 503, error: "Request failed (503)" };
  });

  await assert.rejects(() => fetchJsonRelay("https://example.com/x", { retries: 0, retryDelayMs: 1 }));
  assert.equal(callCount, 1, "retries: 0 should mean a single attempt, no retry at all");
});

// A 429 (rate limit) is a caller-visible failure mode with its own
// retryAfterMs field, not something to blindly hammer again the way a
// transient 5xx is - see this file's own header note.
test("does NOT retry a 429 (rate limit) - that's a different, caller-visible failure mode", async () => {
  let callCount = 0;
  installChrome(async () => {
    callCount++;
    return { ok: false, status: 429, retryAfterMs: 5000, error: "Rate limited (429)" };
  });

  await assert.rejects(() => fetchJsonRelay("https://example.com/x", { retryDelayMs: 1 }), /429/);
  assert.equal(callCount, 1);
});

test("does NOT retry a non-5xx, non-429 failure (a genuine, non-transient error)", async () => {
  let callCount = 0;
  installChrome(async () => {
    callCount++;
    return { ok: false, status: 400, error: "Request failed (400)" };
  });

  await assert.rejects(() => fetchJsonRelay("https://example.com/x", { retryDelayMs: 1 }), /400/);
  assert.equal(callCount, 1);
});

test("does NOT retry a failure with no status field at all (e.g. a malformed-URL throw)", async () => {
  let callCount = 0;
  installChrome(async () => {
    callCount++;
    return { ok: false, error: "TypeError: Invalid URL" };
  });

  await assert.rejects(() => fetchJsonRelay("https://example.com/x", { retryDelayMs: 1 }), /Invalid URL/);
  assert.equal(callCount, 1);
});

test("falls back to a generic error message when the final failure has none", async () => {
  installChrome(async () => ({ ok: false }));

  await assert.rejects(() => fetchJsonRelay("https://example.com/x", { retries: 0 }), /Background fetch failed/);
});

// background.js's own fetchJson always sends credentials: "omit" (see its own
// note on why that's no longer per-call configurable) - this relay's message
// carries nothing but the type and the url.
test("relays only { type, url } - no per-call credentials override", async () => {
  let capturedMessage;
  installChrome(async (msg) => {
    capturedMessage = msg;
    return { ok: true, data: {} };
  });

  await fetchJsonRelay("https://example.com/x");
  assert.deepEqual(capturedMessage, { type: "FETCH_JSON", url: "https://example.com/x" });
});
