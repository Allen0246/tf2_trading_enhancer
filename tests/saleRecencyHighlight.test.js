import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SALE_RECENCY_CLASSES,
  classifyDaysSinceSale,
  daysSince,
  injectStylesOnce,
} from "../backpack.tf/shared/saleRecencyHighlight.js";

// backpack.tf/shared/saleRecencyHighlight.js's own pure "days since last
// sale" classification - 60/90/120-day cutoffs.

test("classifyDaysSinceSale: <= 60 days is RECENT", () => {
  assert.equal(classifyDaysSinceSale(0), SALE_RECENCY_CLASSES.RECENT);
  assert.equal(classifyDaysSinceSale(60), SALE_RECENCY_CLASSES.RECENT);
});

test("classifyDaysSinceSale: 61-90 days is MODERATE", () => {
  assert.equal(classifyDaysSinceSale(61), SALE_RECENCY_CLASSES.MODERATE);
  assert.equal(classifyDaysSinceSale(90), SALE_RECENCY_CLASSES.MODERATE);
});

test("classifyDaysSinceSale: 91-120 days is OLD", () => {
  assert.equal(classifyDaysSinceSale(91), SALE_RECENCY_CLASSES.OLD);
  assert.equal(classifyDaysSinceSale(120), SALE_RECENCY_CLASSES.OLD);
});

// REGRESSION-style: unlike lastSeenHighlight.js's own STALE bucket, there is
// NO 4th "old" class beyond 120 days - a too-old (or unknown) last-sale date
// is deliberately left uncolored rather than making a "definitely old"
// visual claim.
test("classifyDaysSinceSale: past 120 days is uncolored (null), not a 4th bucket", () => {
  assert.equal(classifyDaysSinceSale(121), null);
  assert.equal(classifyDaysSinceSale(400), null);
});

test("classifyDaysSinceSale: null/NaN (unknown) is also uncolored, not assumed recent or old", () => {
  assert.equal(classifyDaysSinceSale(null), null);
  assert.equal(classifyDaysSinceSale(NaN), null);
});

test("daysSince: computes whole rounded days between an epoch-seconds timestamp and now", () => {
  const now = Date.now();
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
  assert.equal(daysSince(thirtyDaysAgo / 1000, now), 30);
});

test("daysSince: rounds to the nearest whole day, not truncating", () => {
  const now = Date.now();
  // 30.6 days ago -> should round UP to 31, not down to 30.
  const almost31DaysAgo = now - 30.6 * 24 * 60 * 60 * 1000;
  assert.equal(daysSince(almost31DaysAgo / 1000, now), 31);
});

test("daysSince: returns null for a non-finite/missing timestamp", () => {
  assert.equal(daysSince(null), null);
  assert.equal(daysSince(NaN), null);
  assert.equal(daysSince(undefined), null);
});

function fakeDocument() {
  const created = [];
  const headAppended = [];
  return {
    _existingIds: new Set(),
    getElementById(id) {
      return this._existingIds.has(id) ? { id } : null;
    },
    createElement(tag) {
      const el = { tag, textContent: "", id: "" };
      created.push(el);
      return el;
    },
    head: { appendChild: (el) => headAppended.push(el) },
    _created: created,
    _headAppended: headAppended,
  };
}

test("injectStylesOnce creates and appends a <style> element with the given id/css the first time", () => {
  const doc = fakeDocument();
  global.document = doc;

  injectStylesOnce("test-style-id", ".foo { color: red; }");

  assert.equal(doc._headAppended.length, 1);
  assert.equal(doc._headAppended[0].id, "test-style-id");
  assert.equal(doc._headAppended[0].textContent, ".foo { color: red; }");
});

test("injectStylesOnce is a no-op if a style with that id already exists", () => {
  const doc = fakeDocument();
  doc._existingIds.add("already-there");
  global.document = doc;

  injectStylesOnce("already-there", ".foo { color: red; }");

  assert.equal(doc._headAppended.length, 0);
});
