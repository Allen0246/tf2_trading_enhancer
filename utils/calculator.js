/*
@description: Pure currency math for the popup's "Calculator" panel
(popup/popup.js owns the DOM and storage). Metal converts at a fixed ratio
(9 Scrap = 3 Reclaimed = 1 Refined); a key's ref value floats with the
market, so every function takes it as a parameter.
*/

export const REF_PER_REC = 1 / 3;
export const REF_PER_SCRAP = 1 / 9;

// Largest to smallest - the order breakdownRefined below extracts in.
const DENOMINATION_IDS = ["key", "ref", "rec", "scrap"];

// Collapses float noise (e.g. 2.0000000000000147) to a clean value. 6
// decimals is far finer than the 2 the calculator displays.
export function roundClean(value) {
  return Math.round(value * 1e6) / 1e6;
}

/*
@description: Parses a number typed by hand, treating "," and "." as the same
decimal separator (e.g. "4,2" and "4.2" both read as 4.2) - popup.js's own
calculator fields are plain type="text" inputs specifically so this can see
what was actually typed, rather than type="number", whose OWN locale-specific
validation silently rejects a "," keystroke (in an English-locale browser)
before any JS-level parsing would ever get a chance to normalize it away.
Negative/unparseable input clamps to 0 rather than surfacing NaN - every
caller in this calculator treats "invalid" and "empty" the same way anyway
(nothing owned/priced), so there's no meaningful distinction for a caller to
lose here.
*/
export function parseAmountInput(value) {
  const normalized = String(value ?? "").trim().replace(",", ".");
  const parsed = parseFloat(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function unitRefined(id, keyPriceRefined) {
  if (id === "key") return keyPriceRefined || null;
  if (id === "ref") return 1;
  if (id === "rec") return REF_PER_REC;
  if (id === "scrap") return REF_PER_SCRAP;
  return null;
}

/*
@description: Converts a { key, ref, rec, scrap } owned-amounts object into a
single total denominated in refined metal. keyPriceRefined is the current
ref-value of 1 key - if it's missing (not yet entered/fetched), any owned
keys contribute 0 rather than blocking the rest of the total, since ref/rec/
scrap are still meaningful on their own.
*/
export function ownedToRefined({ key = 0, ref = 0, rec = 0, scrap = 0 } = {}, keyPriceRefined) {
  const keyRefined = keyPriceRefined ? key * keyPriceRefined : 0;
  return keyRefined + ref + rec * REF_PER_REC + scrap * REF_PER_SCRAP;
}

/*
@description: Re-expresses a refined-metal total as a { key, ref, rec, scrap }
breakdown, using only the denominations marked true in `included` - a
denomination that's turned off is skipped entirely (its own field comes back
0) and its share folds into the next-smaller INCLUDED denomination instead,
cascading down. The smallest included denomination absorbs whatever's left
over exactly (not floored), since there's nothing smaller left to push a
remainder into - e.g. turning "key" off with 1 owned key and everything else
included folds that key's whole value into `ref` instead of discarding it.
"key" is silently excluded from consideration when keyPriceRefined isn't set
(there's no rate to convert it with), even if `included.key` is true.
@param {number} totalRefined
@param {{key?: boolean, ref?: boolean, rec?: boolean, scrap?: boolean}} included
@param {number|null} keyPriceRefined
@returns {{key: number, ref: number, rec: number, scrap: number}}
*/
export function breakdownRefined(totalRefined, included = {}, keyPriceRefined) {
  const result = { key: 0, ref: 0, rec: 0, scrap: 0 };

  const active = DENOMINATION_IDS.filter((id) => included[id] && unitRefined(id, keyPriceRefined));
  let remaining = totalRefined;

  active.forEach((id, i) => {
    const unit = unitRefined(id, keyPriceRefined);
    const isLast = i === active.length - 1;

    if (isLast) {
      result[id] = roundClean(remaining / unit);
    } else {
      // Epsilon guard - floating-point division (e.g. 9 * (1/9)) can land a
      // hair under the next whole unit and floor down one short otherwise.
      const count = Math.floor(remaining / unit + 1e-9);
      result[id] = count;
      remaining -= count * unit;
      // Clamp away float noise (e.g. -2.1e-14 instead of an exact 0) so it
      // can't surface as a bogus fractional sliver on whichever denomination
      // absorbs the remainder next.
      if (Math.abs(remaining) < 1e-9) remaining = 0;
    }
  });

  return result;
}

/*
@description: Expresses a refined-metal total purely in keys (e.g. 150 ref at
a 58 ref key becomes ~2.59) - null (not 0) when there's no key price to
convert with, so a caller can tell "unpriced" apart from "genuinely worth
nothing".
*/
export function totalKeys(totalRefined, keyPriceRefined) {
  if (!keyPriceRefined) return null;
  return totalRefined / keyPriceRefined;
}

/*
@description: Converts a keys total into real money, given the user-entered
currency value of 1 key. Null propagates (same reasoning as totalKeys).
*/
export function totalMoney(totalKeysValue, keyPriceCurrency) {
  if (totalKeysValue === null || totalKeysValue === undefined || !keyPriceCurrency) return null;
  return totalKeysValue * keyPriceCurrency;
}

/*
@description: Plain a×b/a÷b/a+b/a−b for the calculator panel's "Quick Math"
rows, with roundClean float-noise cleanup. divide(a, 0) returns 0 (these rows
have nowhere to show an error, same convention as parseAmountInput).
subtract is not clamped to 0: a negative result is a legitimate answer.
*/
export function multiply(a, b) {
  return roundClean(a * b);
}

export function divide(a, b) {
  if (!b) return 0;
  return roundClean(a / b);
}

export function add(a, b) {
  return roundClean(a + b);
}

export function subtract(a, b) {
  return roundClean(a - b);
}

/*
@description: Formats a keys total to 2 decimals - comma as the decimal
separator when displaying EUR (matching the convention most EUR-region
users already read prices in), period for USD.
*/
export function formatKeysTotal(value, currency) {
  if (value === null || value === undefined || Number.isNaN(value)) return null;

  const fixed = value.toFixed(2);
  return currency === "EUR" ? fixed.replace(".", ",") : fixed;
}

/*
@description: Formats a money total with its currency's own usual symbol
placement - "$" prefixed for USD, "€" suffixed (after a comma decimal) for
EUR.
*/
export function formatMoney(value, currency) {
  if (value === null || value === undefined || Number.isNaN(value)) return null;

  const fixed = value.toFixed(2);
  return currency === "EUR" ? `${fixed.replace(".", ",")} €` : `$${fixed}`;
}
