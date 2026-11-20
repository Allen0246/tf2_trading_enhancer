import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HIGHLIGHT_BUCKETS,
  classifyRelativeAge,
  resolveHighlightBucket,
  applyBorderHighlight,
  applyStripeHighlight,
  clearHighlight,
} from "../backpack.tf/shared/lastSeenHighlight.js";

// backpack.tf/shared/lastSeenHighlight.js's own pure classification/coloring
// logic, shared by both the classic and next.backpack.tf Premium Search
// last-seen highlighters - each UI's own content.js only extracts the DOM
// signals (isOnline/relativeAgeText) and hands them off here, so this file
// covers every bucket boundary once rather than per UI.

test("classifyRelativeAge: seconds/minutes/hours ago are all FRESH", () => {
  assert.equal(classifyRelativeAge("30 seconds ago"), HIGHLIGHT_BUCKETS.FRESH);
  assert.equal(classifyRelativeAge("5 minutes ago"), HIGHLIGHT_BUCKETS.FRESH);
  assert.equal(classifyRelativeAge("3 hours ago"), HIGHLIGHT_BUCKETS.FRESH);
  assert.equal(classifyRelativeAge("just now"), HIGHLIGHT_BUCKETS.FRESH);
  assert.equal(classifyRelativeAge("a few seconds ago"), HIGHLIGHT_BUCKETS.FRESH);
});

test("classifyRelativeAge: singular units ('1 hour ago') are matched too, not just plural", () => {
  assert.equal(classifyRelativeAge("1 hour ago"), HIGHLIGHT_BUCKETS.FRESH);
  assert.equal(classifyRelativeAge("1 day ago"), HIGHLIGHT_BUCKETS.RECENT);
});

// moment.js-style wording - the same formatter that produces "a few seconds
// ago" (handled above) writes a single unit as "a"/"an", not "1".
test("classifyRelativeAge: 'a minute'/'an hour'/'a day' (no digit) are read as 1 of that unit", () => {
  assert.equal(classifyRelativeAge("a minute ago"), HIGHLIGHT_BUCKETS.FRESH);
  assert.equal(classifyRelativeAge("an hour ago"), HIGHLIGHT_BUCKETS.FRESH);
  assert.equal(classifyRelativeAge("a day ago"), HIGHLIGHT_BUCKETS.RECENT);
  assert.equal(classifyRelativeAge("a month ago"), HIGHLIGHT_BUCKETS.STALE);
});

test("classifyRelativeAge: under 7 days is RECENT", () => {
  assert.equal(classifyRelativeAge("1 day ago"), HIGHLIGHT_BUCKETS.RECENT);
  assert.equal(classifyRelativeAge("6 days ago"), HIGHLIGHT_BUCKETS.RECENT);
});

test("classifyRelativeAge: 7+ days is STALE", () => {
  assert.equal(classifyRelativeAge("7 days ago"), HIGHLIGHT_BUCKETS.STALE);
  assert.equal(classifyRelativeAge("14 days ago"), HIGHLIGHT_BUCKETS.STALE);
});

// REGRESSION-style coverage: the two UIs render the SAME underlying age
// using different units (classic UI's own "weeks" phrasing vs.
// next.backpack.tf's own plain "days" count past a certain point, confirmed
// live) - both must still land in the same bucket.
test("classifyRelativeAge: weeks/months/years ago are all STALE, matching a same-age 'X days ago' from the other UI", () => {
  assert.equal(classifyRelativeAge("1 week ago"), HIGHLIGHT_BUCKETS.STALE);
  assert.equal(classifyRelativeAge("4 weeks ago"), HIGHLIGHT_BUCKETS.STALE);
  assert.equal(classifyRelativeAge("3 months ago"), HIGHLIGHT_BUCKETS.STALE);
  assert.equal(classifyRelativeAge("2 years ago"), HIGHLIGHT_BUCKETS.STALE);
});

test("classifyRelativeAge: empty/unparseable text is STALE (unknown, not assumed fresh)", () => {
  assert.equal(classifyRelativeAge(""), HIGHLIGHT_BUCKETS.STALE);
  assert.equal(classifyRelativeAge(null), HIGHLIGHT_BUCKETS.STALE);
  assert.equal(classifyRelativeAge("some gibberish"), HIGHLIGHT_BUCKETS.STALE);
});

test("resolveHighlightBucket: online status wins outright, regardless of how stale the last-seen text is", () => {
  assert.equal(
    resolveHighlightBucket({ isOnline: true, relativeAgeText: "4 years ago" }),
    HIGHLIGHT_BUCKETS.ONLINE
  );
});

test("resolveHighlightBucket: falls back to classifyRelativeAge when not online", () => {
  assert.equal(
    resolveHighlightBucket({ isOnline: false, relativeAgeText: "3 hours ago" }),
    HIGHLIGHT_BUCKETS.FRESH
  );
});

function fakeStyledElement() {
  const props = {};
  return {
    style: {
      setProperty: (name, value, priority) => {
        props[name] = { value, priority };
      },
      removeProperty: (name) => {
        delete props[name];
      },
    },
    _props: props,
  };
}

test("applyBorderHighlight only ever sets 'border' (via setProperty, 'important'), never any other style", () => {
  const el = fakeStyledElement();
  applyBorderHighlight(el, HIGHLIGHT_BUCKETS.ONLINE);
  assert.deepEqual(Object.keys(el._props), ["border"]);
  assert.equal(el._props["border"].priority, "important");
  assert.match(el._props["border"].value, /^3px solid #/);
});

test("applyStripeHighlight only ever sets 'border-left' (via setProperty, 'important'), never any other style", () => {
  const el = fakeStyledElement();
  applyStripeHighlight(el, HIGHLIGHT_BUCKETS.FRESH);
  assert.deepEqual(Object.keys(el._props), ["border-left"]);
  assert.equal(el._props["border-left"].priority, "important");
  assert.match(el._props["border-left"].value, /^4px solid #/);
});

test("clearHighlight removes a previously-applied border and border-left alike", () => {
  const bordered = fakeStyledElement();
  applyBorderHighlight(bordered, HIGHLIGHT_BUCKETS.STALE);
  clearHighlight(bordered);
  assert.equal(bordered._props["border"], undefined);

  const striped = fakeStyledElement();
  applyStripeHighlight(striped, HIGHLIGHT_BUCKETS.STALE);
  clearHighlight(striped);
  assert.equal(striped._props["border-left"], undefined);
});

test("every bucket resolves to a distinct color, for both border styles", () => {
  const borderEl = fakeStyledElement();
  const borderColors = new Set();
  const stripeEl = fakeStyledElement();
  const stripeColors = new Set();
  for (const bucket of Object.values(HIGHLIGHT_BUCKETS)) {
    applyBorderHighlight(borderEl, bucket);
    borderColors.add(borderEl._props["border"].value);
    applyStripeHighlight(stripeEl, bucket);
    stripeColors.add(stripeEl._props["border-left"].value);
  }
  assert.equal(borderColors.size, Object.values(HIGHLIGHT_BUCKETS).length);
  assert.equal(stripeColors.size, Object.values(HIGHLIGHT_BUCKETS).length);
});
