/*
@description: Reads a { keys, metal } amount out of a backpack.tf listing's
price text, shared by both UIs' fixTradeOfferLinks (classic's
data-listing_price attribute, next's price badge and listing comment).
*/

/*
@description: Extracts the keys and ref amounts from text like "60 ref",
"2.04 keys" or "1 key, 10.44 ref". Two independent patterns rather than one
combined one, since either currency can be absent on its own (a pure-metal
listing has no "key" text at all, and vice versa). A missing currency reads
as 0.
@returns {{keys: number, metal: number}}
*/
export function parseListingPriceText(text) {
  const keysMatch = (text || "").match(/([\d.]+)\s*keys?/i);
  const metalMatch = (text || "").match(/([\d.]+)\s*ref/i);

  return {
    keys: keysMatch ? parseFloat(keysMatch[1]) : 0,
    metal: metalMatch ? parseFloat(metalMatch[1]) : 0,
  };
}
