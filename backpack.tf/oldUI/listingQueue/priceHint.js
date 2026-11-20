/*
@description: Best-effort starting price for a newly queued item, from the
tile's own "data-price" attribute - confirmed live as a plain refined-metal-
equivalent float baked directly into every inventory tile (e.g.
data-price="2.44" for a real "Vintage Blutsauger" whose own separately
confirmed data-p_bptf string, "2.33-2.55 ref", has that exact midpoint -
same attribute steamcommunity.com/tradeOffer/pages/backpackProfile.js's
own parseItem already reverse-engineers on this identical page, reused here
as the simpler of the two: data-price is already a single number, no range-
string parsing needed the way data-p_bptf's own "1-1.2 keys" shape would).

Never authoritative - purely a convenience starting point the row's own
price fields let the user overwrite before publishing.
*/

export function estimateStartingPrice(priceRefined, keyValueRefined) {
  const price = Number(priceRefined);
  if (!price || price <= 0) return { keys: 0, metal: 0 };

  const keyValue = Number(keyValueRefined);
  // No key value to convert with (content.js passes none) - express the
  // whole hint as metal rather than blocking the row on a missing value.
  if (!keyValue || keyValue <= 0) {
    return { keys: 0, metal: round2(price) };
  }

  // Epsilon guard, same as utils/calculator.js's breakdownRefined: an exact
  // multiple of the key value can divide to a hair under the whole number
  // (150.39 / 50.13 = 2.9999999999999996) and floor one key short. The
  // remainder is clamped, since it can then land a hair below 0.
  const keys = Math.floor(price / keyValue + 1e-9);
  const metal = round2(Math.max(0, price - keys * keyValue));
  return { keys, metal };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
