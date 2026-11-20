/*
@description: Reads an item's Steam Market order book (highest buy order,
cheapest listing) straight off its listing page's rendered text. Steam's
current Market UI has no separate order-book request behind that page (see
BUY_ORDER_TEXT_PATTERN's note below), so the page text is the source.

Shared by steamcommunity.com/fabricatorMultiBuy (the finished Kit's value
card) and steamcommunity.com/inventoryMarketActions (Quick Sell / Instant
Sell - the market/orderbook endpoint failed live there with "No order book
data for this item").
*/

// Lives in utils/ (utils/scmPricing.js needs it too, and runs outside
// steamcommunity.com); re-exported for this folder's existing importers.
import { parsePriceParts } from "../../utils/priceText.js";

export { parsePriceParts };

// Confirmed live: Steam's rendered text can carry punctuation as an HTML
// entity ("&#x27;" for an apostrophe) rather than the real character -
// decoded defensively for a span's own text content too, not just the href
// text it was first confirmed against.
export function decodeHtmlEntities(text) {
  return text
    .replace(/&#x27;|&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}


/*
@description: Extracts an item's buy-order count/price and lowest
sell-listing price DIRECTLY off its Steam Market listing page's rendered
text - confirmed live via the real page DOM (both the "Place an
order" widget and a result card). Steam's CURRENT Market UI renders both as
plain, styled text through auto-generated, hashed CSS class names
("BPTxiJF58z0-", "h9k0m4mdzeY-", etc. - far too unstable to key extraction
off of), with NO separate itemordershistogram/orderbook API call backing
either one at all - confirmed live via the browser Network tab: a direct
browser navigation to the listing page shows exactly ONE request, the
document itself, nothing else. Same "read the rendered text, not a JSON API"
situation fabricatorMultiBuy's own extractValidNamesFromSearchHtml already
established for the /market/search page.

Not market/orderbook (scoped to an item you own/are selling) and not
item_nameid + itemordershistogram (this page no longer exposes item_nameid);
both were tried and confirmed wrong live.
*/
// Steam renders the order book in two layouts (both confirmed live against
// real listing pages):
//   - Individual listings (Strange weapons, Fabricators - fewer listings):
//     "1 256 requests to buy at <!-- -->€1,70 or lower", one span, and each
//     listing below as a price span + its own "Buy" button.
//   - Grouped (Keys, crates - high volume): "<span>464,669</span> requests to
//     buy at <span>€1,90</span> or lower" and "<span>45,539</span> for sale
//     starting at <span>€1,91</span>" - each number in its own span, and NO
//     per-listing Buy buttons at all (Quick/Instant Sell both found nothing
//     on a Key, reported live).
// So both sentences are matched on the page's TEXT (see listingPageText),
// which reads the same in either layout. The count's thousands separator
// varies ("464,669", "1\u00a0256"), so it's allowed but never a line break.
//
// SECURITY: in both layouts the price starts right after an element or
// comment boundary (its own <span>, or React's "<!-- -->" marker), so a line
// break is required there. Anyone listing an item can write these sentences
// into a Description Tag or custom name, but that text is escaped and can
// never contain a tag or comment, so it can't fake the price Quick Sell or
// Instant Sell would list at.
const BUY_ORDER_TEXT_PATTERN = /(\d[\d,. \u00a0\u202f]*)\s*requests?\s+to\s+buy\s+at[ \u00a0]*\n\s*([^\n]+?)\s+or\s+lower/i;
const FOR_SALE_STARTING_AT_TEXT_PATTERN = /for\s+sale\s+starting\s+at[ \u00a0]*\n\s*([^\n]+?)\s*(?:\n|$)/i;

// Steam's error page for a listing it couldn't load (seen live) - not "no
// orders", so it must not read as an empty order book.
const LOAD_ERROR_TEXT = "There was a problem loading this content";

// Script and style contents are page data, not rendered text (a listing's
// description can sit in a JSON blob there), so they're never read.
function withoutScriptsAndStyles(listingHtml) {
  return listingHtml.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
}

// The rendered text, with every tag and comment turned into a line break.
// Line breaks already in the text become spaces first, so a line break here
// always means a real element or comment boundary.
function listingPageText(listingHtml) {
  return listingHtml
    .replace(/[\r\n]+/g, " ")
    .replace(/<!--[\s\S]*?-->/g, "\n")
    .replace(/<[^>]+>/g, "\n");
}

// Individual-listings layout only (see BUY_ORDER_TEXT_PATTERN): matches each
// "<price span></span> ... <Buy button>" pairing in document order -
// confirmed live via the real page DOM for one result card (a price-styled
// <span>, e.g. "€1.57", immediately followed by a green "Buy" <button>).
// The page lists them in the account's own chosen Market sort, which Steam
// remembers (confirmed live, Oct 2026: with another sort chosen, the first
// listing was €2.25 while the cheapest was €0.30). So the first one is the
// cheapest only when the page's prices run cheapest-first (see
// parseListingOrderBookHtml); the page holds one page of listings, so with
// another sort the cheapest may not be on it at all. Tolerates an optional empty HTML
// comment right after the opening <span> - confirmed live (see
// buildPriceResult's own note): Steam's current front-end inserts one as a
// hydration-boundary marker immediately before the dynamic price value, and
// unlike BUY_ORDER_TEXT_PATTERN's generic capture, this one requires the
// price to start RIGHT where the comment would otherwise sit, so it has to
// be explicitly skipped here rather than merely stripped afterward.
const LISTING_PRICE_PATTERN =
  /<span[^>]*>\s*(?:<!--[\s\S]*?-->)?\s*([€$£¥]?\s?\d(?:[\d.,]|[ \u00a0\u202f](?=\d))*\s?[€$£¥]?)\s*<\/span>\s*<button[^>]*>\s*Buy\s*</gi;

/*
@description: Parses a matched price string (e.g. "€1,27") into this module's
own {minorUnits, formatted} shape, reusing parsePriceParts (already handles
both "."- and ","-decimal notations - confirmed live necessary here too:
the buy-order text and a result card's own price used DIFFERENT separators
in the same live session) rather than duplicating that logic. Normalizes to
exactly 2 decimal places in the formatted output regardless of the source
text's own precision - correct for every wallet currency confirmed live in
this codebase so far.

Steam's current Market UI renders the dynamic price value inside its
surrounding sentence with an empty HTML comment immediately before it (a
framework hydration-boundary marker, not a display glitch) - e.g. "buy at
<!-- -->€1,27 or lower". Stripped here rather than tightened in
BUY_ORDER_TEXT_PATTERN's own generic non-greedy capture group - robust
regardless of whether the comment lands before, after, or (in some other
locale/layout) around the price text.
@returns {?{minorUnits: number, formatted: string}} null if priceText itself
didn't contain a recognizable number at all.
See #113.
*/
function buildPriceResult(priceText) {
  const cleanedText = decodeHtmlEntities(priceText)
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim();
  const parsed = parsePriceParts(cleanedText);
  if (!parsed) return null;
  return {
    minorUnits: Math.round(parsed.value * 100),
    formatted: `${parsed.prefix}${parsed.value.toFixed(2)}${parsed.suffix}`,
  };
}

// A price Steam shows elsewhere (e.g. the inventory panel's "Starting at:
// 0,30€") in the same {minorUnits, formatted} shape, or null.
export function parseMarketPriceText(priceText) {
  return buildPriceResult(String(priceText || ""));
}

export function formatMinorUnits(minorUnits, prefix, suffix) {
  return `${prefix}${(minorUnits / 100).toFixed(2)}${suffix}`;
}

/*
@description: The currency text around an already-parsed price result's
number (e.g. prefix "€", or suffix "pуб."), read back off its formatted
string (buildPriceResult always writes "{prefix}{value}{suffix}").
@returns {{prefix: string, suffix: string}}
*/
export function currencyAffixesOf(priceResult) {
  return {
    prefix: priceResult.formatted.match(/^\D*/)?.[0] ?? "",
    suffix: priceResult.formatted.match(/\D*$/)?.[0] ?? "",
  };
}

/*
@description: Formats minorUnits in the same currency notation as an
already-parsed price result (see currencyAffixesOf).
*/
export function formatMinorUnitsLike(priceResult, minorUnits) {
  const { prefix, suffix } = currencyAffixesOf(priceResult);
  return formatMinorUnits(minorUnits, prefix, suffix);
}

/*
@description: The order book out of a listing page's raw HTML - pure, so
it's testable without a fetch. Either side is null when the page has none.
The cheapest listing comes from the grouped layout's "for sale starting at"
line (the same whatever the sort), else the individual layout's first price
+ Buy button pairing, but only when the page's listings run cheapest-first
(see LISTING_PRICE_PATTERN). Otherwise lowestSellOrder is null and
listingsNotCheapestFirst says why, so a caller can use another source rather
than report "no listings".
@throws on Steam's own "problem loading this content" page.
*/
export function parseListingOrderBookHtml(listingHtml) {
  const renderedHtml = withoutScriptsAndStyles(listingHtml);
  const text = listingPageText(renderedHtml);
  if (text.includes(LOAD_ERROR_TEXT)) throw new Error("Steam couldn't load this item's Market page right now, try again shortly");

  const buyOrderMatch = BUY_ORDER_TEXT_PATTERN.exec(text);
  const startingAtMatch = FOR_SALE_STARTING_AT_TEXT_PATTERN.exec(text);
  const listingPrices = startingAtMatch
    ? []
    : Array.from(renderedHtml.matchAll(LISTING_PRICE_PATTERN), (match) => buildPriceResult(match[1])).filter(Boolean);
  const listingsNotCheapestFirst = listingPrices.some((price, i) => i > 0 && price.minorUnits < listingPrices[i - 1].minorUnits);
  let lowestSellOrder = listingsNotCheapestFirst ? null : listingPrices[0] ?? null;
  if (startingAtMatch) lowestSellOrder = buildPriceResult(startingAtMatch[1]);
  return {
    highestBuyOrder: buyOrderMatch ? buildPriceResult(buyOrderMatch[2]) : null,
    buyOrderCount: buyOrderMatch ? Number(buyOrderMatch[1].replace(/\D/g, "")) : null,
    lowestSellOrder,
    listingsNotCheapestFirst,
  };
}

/*
@description: Fetches an item's Steam Market listing page and reads both
sides of its order book straight off the rendered text - see
BUY_ORDER_TEXT_PATTERN/LISTING_PRICE_PATTERN's own notes. A single
same-origin request from steamcommunity.com - no relay needed.
@throws only on a real HTTP/response failure - a genuinely empty order book
(no current buy orders and/or no current sell listings) is NOT an error, it
just resolves with a null field for that side.
@returns {Promise<{highestBuyOrder: ?{minorUnits, formatted}, buyOrderCount: ?number, lowestSellOrder: ?{minorUnits, formatted}, listingsNotCheapestFirst: boolean}>}
*/
export async function fetchListingOrderBook(listingUrl) {
  // Forced English regardless of the account's own display language -
  // BUY_ORDER_TEXT_PATTERN's "requests to buy... or lower" wording is
  // English-specific.
  const listingFetchUrl = listingUrl + (listingUrl.includes("?") ? "&" : "?") + "l=english";
  const listingResponse = await fetch(listingFetchUrl, { credentials: "include" });
  if (!listingResponse.ok) throw new Error(`Could not load the item's Steam Market page (HTTP ${listingResponse.status})`);
  return parseListingOrderBookHtml(await listingResponse.text());
}
