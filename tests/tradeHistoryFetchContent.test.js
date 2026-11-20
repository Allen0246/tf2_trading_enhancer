import { test } from "node:test";
import assert from "node:assert/strict";
import { createFakeDocument, FakeMutationObserver } from "./helpers/fakeDom.js";

// tradeHistoryFetch/content.js is a thin router to duplicateBadges.js on the
// Inventory History page. This confirms the router actually reaches and runs
// that real feature module against a real history row fixture, not just that
// it was imported.

function fakeGetURL(path) {
  return new URL(`../${path}`, import.meta.url).href;
}

globalThis.chrome = {
  runtime: {
    getURL: fakeGetURL,
    onMessage: { addListener: () => {} },
  },
};
globalThis.window = { location: { hostname: "steamcommunity.com", pathname: "/id/someone/inventoryhistory/" } };

const doc = createFakeDocument();
// Two identical given items in one trade, the same shape
// tests/tradeHistoryDuplicateBadges.test.js's own fixtures use.
doc.body.innerHTML =
  '<div class="tradehistoryrow"><div class="tradehistory_date">3 Sep, 2026<div class="tradehistory_timestamp">7:42pm</div></div><div class="tradehistory_content"><div class="tradehistory_event_description">You traded with <a href="https://steamcommunity.com/profiles/1">X</a>.</div>' +
  '<div class="tradehistory_items tradehistory_items_withimages"><div class="tradehistory_items_plusminus">-</div><div class="tradehistory_items_group">' +
  '<span class="history_item" data-appid="440" data-classid="1" data-instanceid="0" data-contextid="2" data-amount="1"><span class="history_item_name" style="color: #7D6D00">Refined Metal</span></span>, ' +
  '<span class="history_item" data-appid="440" data-classid="1" data-instanceid="0" data-contextid="2" data-amount="1"><span class="history_item_name" style="color: #7D6D00">Refined Metal</span></span>' +
  "</div></div></div></div>";
doc.querySelector = (s) => doc.body.querySelector(s);
doc.querySelectorAll = (s) => doc.body.querySelectorAll(s);
globalThis.document = doc;
globalThis.MutationObserver = FakeMutationObserver;

await import("../steamcommunity.com/tradeHistoryFetch/content.js");
const hooks = globalThis.__tradeHistoryFetchTestHooks;
await hooks.routerPromise;

test("routeTradeHistoryFetch runs the duplicate-badges feature against a real history row on the Inventory History page", () => {
  const badge = doc.querySelector(".tf2te-thx-dup-badge");
  assert.ok(badge, "a duplicate-badge should appear for two identical given items");
  assert.equal(badge.textContent, "×2");
});
