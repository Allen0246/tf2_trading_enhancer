import { test } from "node:test";
import assert from "node:assert/strict";

// tradeOfferActions/content.js is a plain top-level side-effect script (no
// exports) - it registers a document listener for "tf2te-tradeoffer-acted-on"
// the moment it's imported, then (after a 3s delay) asks background.js to
// refresh the trade-offer badge. Same "fake globals, import once for side
// effects, drive the captured listener" pattern as tests/background.test.js.
const listeners = {};
globalThis.document = {
  addEventListener: (type, cb) => {
    (listeners[type] ||= []).push(cb);
  },
};

const realSetTimeout = globalThis.setTimeout;
const timeoutCalls = [];
globalThis.setTimeout = (fn, delay) => {
  timeoutCalls.push({ fn, delay });
  return timeoutCalls.length;
};

const sendMessageCalls = [];
let sendMessageImpl = async (msg) => {
  sendMessageCalls.push(msg);
};
globalThis.chrome = {
  runtime: {
    sendMessage: (msg) => sendMessageImpl(msg),
  },
};

await import("../steamcommunity.com/tradeOfferActions/content.js");

test("registers exactly one listener for tf2te-tradeoffer-acted-on on import", () => {
  assert.equal(listeners["tf2te-tradeoffer-acted-on"].length, 1);
});

test("firing the event schedules a 3000ms delayed refresh, not an immediate one", () => {
  timeoutCalls.length = 0;
  sendMessageCalls.length = 0;

  listeners["tf2te-tradeoffer-acted-on"][0]();

  assert.equal(timeoutCalls.length, 1);
  assert.equal(timeoutCalls[0].delay, 3000);
  assert.equal(sendMessageCalls.length, 0); // not sent yet - only scheduled
});

test("once the delay fires, sends REFRESH_TRADEOFFER_BADGE to background.js", () => {
  timeoutCalls.length = 0;
  sendMessageCalls.length = 0;

  listeners["tf2te-tradeoffer-acted-on"][0]();
  timeoutCalls[0].fn();

  assert.equal(sendMessageCalls.length, 1);
  assert.deepEqual(sendMessageCalls[0], { type: "REFRESH_TRADEOFFER_BADGE" });
});

test("a rejected sendMessage is swallowed (.catch(() => {})) and never throws out of the timeout callback", async () => {
  timeoutCalls.length = 0;
  sendMessageImpl = async () => {
    throw new Error("no background page");
  };

  listeners["tf2te-tradeoffer-acted-on"][0]();
  // Should not throw - the module's own .catch(() => {}) handles it.
  assert.doesNotThrow(() => timeoutCalls[0].fn());

  // Let the rejected promise's own .catch microtask settle before the test
  // ends, so an unhandled rejection can't leak into a later test. Uses the
  // real setTimeout (captured above), not the fake one this file installs.
  await new Promise((resolve) => realSetTimeout(resolve, 0));
});
