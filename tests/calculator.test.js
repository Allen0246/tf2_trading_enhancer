import { test } from "node:test";
import assert from "node:assert/strict";
import {
  REF_PER_REC,
  REF_PER_SCRAP,
  ownedToRefined,
  breakdownRefined,
  totalKeys,
  totalMoney,
  formatKeysTotal,
  formatMoney,
  parseAmountInput,
  roundClean,
  multiply,
  divide,
  add,
  subtract,
} from "../utils/calculator.js";

const ALL_INCLUDED = { key: true, ref: true, rec: true, scrap: true };

test("ownedToRefined - sums key/ref/rec/scrap at the given key price", () => {
  const refined = ownedToRefined({ key: 1, ref: 2, rec: 1, scrap: 4 }, 58);
  assert.equal(refined, 58 + 2 + 1 * REF_PER_REC + 4 * REF_PER_SCRAP);
});

test("ownedToRefined - missing fields default to 0", () => {
  assert.equal(ownedToRefined({}, 58), 0);
  assert.equal(ownedToRefined(undefined, 58), 0);
});

test("ownedToRefined - owned keys contribute 0 when there's no key price yet", () => {
  assert.equal(ownedToRefined({ key: 3, ref: 5 }, null), 5);
  assert.equal(ownedToRefined({ key: 3, ref: 5 }, 0), 5);
});

test("breakdownRefined - all denominations included, standard cascade", () => {
  // 1 key (58 ref) + 2 ref + 1 rec (0.33) + 2 scrap (0.22) - a canonical
  // owned mix (rec/scrap counts that don't themselves add up to a whole ref)
  // round-trips back through the breakdown unchanged.
  const totalRefined = ownedToRefined({ key: 1, ref: 2, rec: 1, scrap: 2 }, 58);
  const result = breakdownRefined(totalRefined, ALL_INCLUDED, 58);

  assert.equal(result.key, 1);
  assert.equal(result.ref, 2);
  assert.equal(result.rec, 1);
  assert.equal(result.scrap, 2);
});

test("breakdownRefined - a non-canonical owned mix (metal that adds up past 1 ref) carries over", () => {
  // 2 rec + 4 scrap = 0.6666 + 0.4444 = 1.1111 ref - carries 1 whole ref out
  // of the metal and leaves the rest as rec/scrap.
  const totalRefined = ownedToRefined({ key: 1, ref: 2, rec: 2, scrap: 4 }, 58);
  const result = breakdownRefined(totalRefined, ALL_INCLUDED, 58);

  assert.equal(result.key, 1);
  assert.equal(result.ref, 3);
  assert.equal(result.rec, 0);
  assert.equal(result.scrap, 1);
});

test("breakdownRefined - excess ref-equivalent value floors down through rec into scrap exactly", () => {
  // 100 ref straight, no keys owned
  const result = breakdownRefined(100, ALL_INCLUDED, 58);
  assert.equal(result.key, 1); // 58
  assert.equal(result.ref, 42); // 100 - 58
  assert.equal(result.rec, 0);
  assert.equal(result.scrap, 0);
});

test("breakdownRefined - turning off key folds its value into ref instead", () => {
  const totalRefined = ownedToRefined({ key: 1 }, 58);
  const result = breakdownRefined(totalRefined, { key: false, ref: true, rec: true, scrap: true }, 58);

  assert.equal(result.key, 0);
  assert.equal(result.ref, 58);
  assert.equal(result.rec, 0);
  assert.equal(result.scrap, 0);
});

test("breakdownRefined - key is excluded automatically when there's no key price, even if included.key is true", () => {
  // No keyPriceRefined at all - 10 ref total should land entirely on ref.
  const result = breakdownRefined(10, ALL_INCLUDED, null);
  assert.equal(result.key, 0);
  assert.equal(result.ref, 10);
});

test("breakdownRefined - unchecked ref skips straight from key to rec", () => {
  const totalRefined = ownedToRefined({ key: 1, rec: 2 }, 58); // 58 + 0.6666...
  const result = breakdownRefined(totalRefined, { key: true, ref: false, rec: true, scrap: true }, 58);

  assert.equal(result.key, 1);
  assert.equal(result.ref, 0);
  assert.equal(result.rec, 2);
  assert.equal(result.scrap, 0);
});

test("breakdownRefined - smallest included denomination absorbs the exact remainder, not floored", () => {
  // scrap excluded - whatever's left after ref/rec should land on rec as a
  // fraction rather than being dropped.
  const result = breakdownRefined(1 + REF_PER_SCRAP, { key: false, ref: true, rec: true, scrap: false }, 58);
  assert.equal(result.ref, 1);
  assert.ok(Math.abs(result.rec - REF_PER_SCRAP / REF_PER_REC) < 1e-6);
  assert.equal(result.scrap, 0);
});

test("breakdownRefined - only ref included absorbs the whole total as ref, even fractionally", () => {
  const result = breakdownRefined(12.34, { key: false, ref: true, rec: false, scrap: false }, 58);
  assert.equal(result.ref, 12.34);
  assert.equal(result.key, 0);
  assert.equal(result.rec, 0);
  assert.equal(result.scrap, 0);
});

test("breakdownRefined - nothing included returns all zeros without throwing", () => {
  const result = breakdownRefined(100, { key: false, ref: false, rec: false, scrap: false }, 58);
  assert.deepEqual(result, { key: 0, ref: 0, rec: 0, scrap: 0 });
});

test("breakdownRefined - missing `included` entirely returns all zeros", () => {
  const result = breakdownRefined(100, undefined, 58);
  assert.deepEqual(result, { key: 0, ref: 0, rec: 0, scrap: 0 });
});

test("totalKeys - converts a refined total into a key-denominated float", () => {
  assert.ok(Math.abs(totalKeys(150, 58) - 150 / 58) < 1e-9);
});

test("totalKeys - null when there's no key price", () => {
  assert.equal(totalKeys(150, null), null);
  assert.equal(totalKeys(150, 0), null);
});

test("totalMoney - multiplies keys total by the currency value of 1 key", () => {
  assert.ok(Math.abs(totalMoney(2.5, 1.8) - 4.5) < 1e-9);
});

test("totalMoney - null propagates from either missing input", () => {
  assert.equal(totalMoney(null, 1.8), null);
  assert.equal(totalMoney(2.5, null), null);
  assert.equal(totalMoney(2.5, 0), null);
});

test("formatKeysTotal - USD uses a period decimal", () => {
  assert.equal(formatKeysTotal(2.5678, "USD"), "2.57");
});

test("formatKeysTotal - EUR uses a comma decimal", () => {
  assert.equal(formatKeysTotal(2.5678, "EUR"), "2,57");
});

test("formatKeysTotal - null/undefined/NaN all pass through as null", () => {
  assert.equal(formatKeysTotal(null, "USD"), null);
  assert.equal(formatKeysTotal(undefined, "USD"), null);
  assert.equal(formatKeysTotal(NaN, "USD"), null);
});

test("formatMoney - USD is $-prefixed with a period decimal", () => {
  assert.equal(formatMoney(4.5, "USD"), "$4.50");
});

test("formatMoney - EUR is €-suffixed with a comma decimal", () => {
  assert.equal(formatMoney(4.5, "EUR"), "4,50 €");
});

test("formatMoney - null passes through as null", () => {
  assert.equal(formatMoney(null, "USD"), null);
});

test("parseAmountInput - comma and period decimals parse identically", () => {
  assert.equal(parseAmountInput("4,2"), 4.2);
  assert.equal(parseAmountInput("4.2"), 4.2);
});

test("parseAmountInput - plain integers and whitespace", () => {
  assert.equal(parseAmountInput("58"), 58);
  assert.equal(parseAmountInput("  12  "), 12);
});

test("parseAmountInput - empty, null, undefined, and garbage all fall back to 0", () => {
  assert.equal(parseAmountInput(""), 0);
  assert.equal(parseAmountInput(null), 0);
  assert.equal(parseAmountInput(undefined), 0);
  assert.equal(parseAmountInput("abc"), 0);
});

test("parseAmountInput - negative numbers fall back to 0", () => {
  assert.equal(parseAmountInput("-5"), 0);
  assert.equal(parseAmountInput("-5,5"), 0);
});

test("parseAmountInput - a plain number (not just a string) is accepted too", () => {
  assert.equal(parseAmountInput(4.2), 4.2);
  assert.equal(parseAmountInput(0), 0);
});

test("roundClean - collapses binary-float noise to a clean value", () => {
  assert.equal(roundClean(0.1 + 0.2), 0.3); // famously 0.30000000000000004 unrounded
  assert.equal(roundClean(2.0000000000000147), 2);
  assert.equal(roundClean(0.9999999999999645), 1);
});

test("roundClean - a genuine fractional value within its own 6-decimal precision is untouched", () => {
  assert.equal(roundClean(3.333333), 3.333333);
});

// Multiply/divide exist specifically so a caller never has to deal with
// plain JS float noise from a×b/a÷b itself.
test("multiply - doubling 3.52 returns exactly 7.04", () => {
  assert.equal(multiply(3.52, 2), 7.04);
});

test("multiply - a case that WOULD show binary-float noise without roundClean", () => {
  assert.equal(0.1 * 3, 0.30000000000000004); // confirms the raw JS behavior this guards against
  assert.equal(multiply(0.1, 3), 0.3);
});

test("multiply - zero on either side returns 0", () => {
  assert.equal(multiply(0, 5), 0);
  assert.equal(multiply(5, 0), 0);
});

test("divide - halving 7.04 returns exactly 3.52", () => {
  assert.equal(divide(7.04, 2), 3.52);
});

test("divide - by zero returns 0, not Infinity/NaN", () => {
  assert.equal(divide(10, 0), 0);
  assert.equal(divide(0, 0), 0);
});

test("divide - a repeating decimal is still shown to roundClean's own 6-decimal precision, not silently truncated", () => {
  assert.equal(divide(10, 3), 3.333333);
});

test("add - a case that would show binary-float noise without roundClean", () => {
  assert.equal(0.1 + 0.2, 0.30000000000000004); // confirms the raw JS behavior this guards against
  assert.equal(add(0.1, 0.2), 0.3);
});

test("add - plain whole numbers", () => {
  assert.equal(add(3, 4), 7);
});

test("subtract - a case that would show binary-float noise without roundClean", () => {
  assert.equal(0.3 - 0.1, 0.19999999999999998); // confirms the raw JS behavior this guards against
  assert.equal(subtract(0.3, 0.1), 0.2);
});

// Deliberately NOT clamped to 0 the way parseAmountInput clamps a typed-in
// field - a negative RESULT (e.g. "how much cheaper is B than A") is a
// legitimate answer here.
test("subtract - a negative result is returned as-is, not clamped to 0", () => {
  assert.equal(subtract(3, 5), -2);
});
