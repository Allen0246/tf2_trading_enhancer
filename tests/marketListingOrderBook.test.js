import { test } from "node:test";
import assert from "node:assert/strict";
import { parseListingOrderBookHtml, parseMarketPriceText, parsePriceParts } from "../steamcommunity.com/shared/marketListingOrderBook.js";

// Trimmed from real listing pages fetched 2026-10-08 (style attributes kept
// as-is where they sit between the parts that matter).

// Grouped layout - Mann Co. Supply Crate Key. Reported live: Quick Sell and
// Instant Sell both found nothing here.
const KEY_PAGE =
  '<div><span class="E-F5JVsCXEo- IokSIloSPlA-" style="--text-color:var(--color-text-body-body)"><span class="IokSIloSPlA-" style="--text-color:var(--color-text-body-title)">45,539</span> for sale starting at <span class="IokSIloSPlA-" style="--text-color:var(--color-text-body-title)">€1,91</span></span><table class="APEAY0rnAbo-"><thead><tr><th><span class="E-F5JVsCXEo- IokSIloSPlA-">Price</span></th></tr></thead></table></div>' +
  '<div><span class="E-F5JVsCXEo- IokSIloSPlA-" style="--text-color:var(--color-text-body-body)"><span class="IokSIloSPlA-" style="--text-color:var(--color-text-body-title)">464,669</span> requests to buy at <span class="IokSIloSPlA-" style="--text-color:var(--color-text-body-title)">€1,90</span> or lower</span><table class="APEAY0rnAbo-"><thead><tr><th><span class="E-F5JVsCXEo- IokSIloSPlA-">Price</span></th></tr></thead></table></div>';

// Individual-listings layout - Strange Rocket Launcher: a non-breaking space
// as the count's thousands separator, and listings with their own Buy button.
const STRANGE_ROCKET_LAUNCHER_PAGE =
  '<svg><path d="M5.14541 6.89977L10.0063 12.2027" fill="currentColor"></path></svg><div class="Qhm6jOAQZog-"><span class="h9k0m4mdzeY- IokSIloSPlA-" style="--text-weight:var(--font-weight-medium);--text-color:var(--color-text-body-body)">1\u00a0256 requests to buy at <!-- -->€1,70 or lower<!-- -->\u00a0</span></div>' +
  '<div class="Psv8L3U3Y44- _0Yp9qPJ4rvQ- sI7wun-GD7g- Qhm6jOAQZog-" style="--justify:end;--align:center;--gap:var(--spacing-3)"><span class="IokSIloSPlA-" style="--text-color:var(--color-text-body-title)">€1.79</span><button type="button" data-accent-color="green" class="YAnzAmuUUnI- ob-nIzzquk8- fkz-MePtKwI- D8IENuW8Q7w-" style="--min-width:fit-content">Buy</button></div>' +
  '<div><span class="IokSIloSPlA-">€1.85</span><button type="button" data-accent-color="green">Buy</button></div>';

test("parseListingOrderBookHtml - grouped layout (Key): both sides read from the summary lines", () => {
  const book = parseListingOrderBookHtml(KEY_PAGE);
  assert.deepEqual(book.lowestSellOrder, { minorUnits: 191, formatted: "€1.91" });
  assert.deepEqual(book.highestBuyOrder, { minorUnits: 190, formatted: "€1.90" });
  assert.equal(book.buyOrderCount, 464669);
});

test("parseListingOrderBookHtml - individual listings (Strange Rocket Launcher): first listing + buy-order sentence", () => {
  const book = parseListingOrderBookHtml(STRANGE_ROCKET_LAUNCHER_PAGE);
  assert.deepEqual(book.lowestSellOrder, { minorUnits: 179, formatted: "€1.79" });
  assert.deepEqual(book.highestBuyOrder, { minorUnits: 170, formatted: "€1.70" });
  assert.equal(book.buyOrderCount, 1256); // not 256 - the separator is a non-breaking space
});

test("parseListingOrderBookHtml - a page with neither side is an empty order book, not an error", () => {
  assert.deepEqual(parseListingOrderBookHtml("<html><body><div>Market</div></body></html>"), { highestBuyOrder: null, buyOrderCount: null, lowestSellOrder: null, listingsNotCheapestFirst: false });
});

test("parseListingOrderBookHtml - Steam's 'problem loading' page throws instead of reading as no orders", () => {
  const errorPage = "<div><span>There was a problem loading this content</span><span>The requested item might not exist</span></div>";
  assert.throws(() => parseListingOrderBookHtml(errorPage), /couldn't load this item's Market page/);
});

// REGRESSION: a price of 1000+ grouped with a space/no-break space (the same
// separator this page uses for its counts, "1\u00a0256") read as just its
// first digit group, and a whole-unit currency's "1,234" read as 1.234 -
// both feed Quick Sell/Instant Sell's real listing price.
test("REGRESSION: parsePriceParts reads space/NBSP thousands groups and a whole-unit '1,234' as thousands", () => {
  assert.deepEqual(parsePriceParts("1\u00a0256,00 €"), { value: 1256, prefix: "", suffix: "€" });
  assert.deepEqual(parsePriceParts("1 234,56 pуб."), { value: 1234.56, prefix: "", suffix: "pуб." });
  assert.deepEqual(parsePriceParts("1\u202f234,56 zł"), { value: 1234.56, prefix: "", suffix: "zł" });
  assert.deepEqual(parsePriceParts("¥ 1,234"), { value: 1234, prefix: "¥", suffix: "" });
  assert.deepEqual(parsePriceParts("12.345₫"), { value: 12345, prefix: "", suffix: "₫" });
  // Unchanged cases.
  assert.deepEqual(parsePriceParts("$1,234.56"), { value: 1234.56, prefix: "$", suffix: "" });
  assert.deepEqual(parsePriceParts("1.234,56€"), { value: 1234.56, prefix: "", suffix: "€" });
  assert.deepEqual(parsePriceParts("1,25€"), { value: 1.25, prefix: "", suffix: "€" });
  assert.deepEqual(parsePriceParts("A$ 0.05"), { value: 0.05, prefix: "A$", suffix: "" });
  assert.deepEqual(parsePriceParts("2,--€"), { value: 2, prefix: "", suffix: "--€" });
});

test("REGRESSION: parseListingOrderBookHtml reads a 1000+ price grouped with a no-break space on both layouts", () => {
  const groupedPage =
    "<div><span>3</span> for sale starting at <span>€1\u00a0300,00</span></div>" +
    "<div><span>12</span> requests to buy at <span>€1\u00a0256,00</span> or lower</div>";
  const grouped = parseListingOrderBookHtml(groupedPage);
  assert.deepEqual(grouped.lowestSellOrder, { minorUnits: 130000, formatted: "€1300.00" });
  assert.deepEqual(grouped.highestBuyOrder, { minorUnits: 125600, formatted: "€1256.00" });

  const individualPage = '<div><span>€1\u00a0300,00</span><button type="button">Buy</button></div>';
  assert.deepEqual(parseListingOrderBookHtml(individualPage).lowestSellOrder, { minorUnits: 130000, formatted: "€1300.00" });
});

// SECURITY: a Description Tag or custom name is free text anyone can put on an
// item they list. Text like "for sale starting at €0,03" sitting in the page
// (as rendered text, or inside a <script> data blob) must not be read as the
// order book, or Quick Sell / Instant Sell would list the user's item at that
// price. Steam's own sentences always have an element or comment boundary
// right before the price (see the two real layouts above); escaped text can
// never contain one.
test("SECURITY: listing text that only imitates the order-book sentences is not read as prices", () => {
  const injectedText =
    '<div class="description">\'\'2 for sale starting at €0,03 and 9 requests to buy at €0,02 or lower\'\'</div>';
  const injectedScript =
    '<script>window.__data = {"description":"5 for sale starting at <span>€0,04</span>","note":"7 requests to buy at <!-- -->€0,05 or lower"};</script>' +
    '<script type="application/json">{"x":"<span>€0,06</span><button>Buy</button>"}</script>';

  for (const page of [injectedText + KEY_PAGE, injectedScript + KEY_PAGE]) {
    const book = parseListingOrderBookHtml(page);
    assert.deepEqual(book.lowestSellOrder, { minorUnits: 191, formatted: "€1.91" });
    assert.deepEqual(book.highestBuyOrder, { minorUnits: 190, formatted: "€1.90" });
  }
  for (const page of [injectedText + STRANGE_ROCKET_LAUNCHER_PAGE, injectedScript + STRANGE_ROCKET_LAUNCHER_PAGE]) {
    const book = parseListingOrderBookHtml(page);
    assert.deepEqual(book.lowestSellOrder, { minorUnits: 179, formatted: "€1.79" });
    assert.deepEqual(book.highestBuyOrder, { minorUnits: 170, formatted: "€1.70" });
  }
});

test("SECURITY: a raw line break inside listing text can't stand in for an element boundary", () => {
  const page = "<div>3 for sale starting at\n€0,03\nand 4 requests to buy at\n€0,02 or lower</div>";
  assert.deepEqual(parseListingOrderBookHtml(page), { highestBuyOrder: null, buyOrderCount: null, lowestSellOrder: null, listingsNotCheapestFirst: false });
});

// The page comes back in the account's own Market sort, which Steam remembers
// (confirmed live: another sort made the first listing €2.25 while the
// cheapest was €0.30). The first listing only counts when the page's listings
// run cheapest-first.
test("REGRESSION: a listing page in another sort gives no cheapest listing, and says why", () => {
  const listing = (price) => `<div><span class="p"><!-- -->${price}</span><button class="b">Buy</button></div>`;
  const buyOrders = "<div>12 requests to buy at <!-- -->€0,25 or lower</div>";

  const highToLow = parseListingOrderBookHtml(buyOrders + listing("€2,25") + listing("€1,10") + listing("€0,30"));
  assert.equal(highToLow.lowestSellOrder, null);
  assert.equal(highToLow.listingsNotCheapestFirst, true);
  assert.deepEqual(highToLow.highestBuyOrder, { minorUnits: 25, formatted: "€0.25" }); // buy side doesn't depend on the sort

  const cheapestFirst = parseListingOrderBookHtml(buyOrders + listing("€0,30") + listing("€0,30") + listing("€1,10"));
  assert.deepEqual(cheapestFirst.lowestSellOrder, { minorUnits: 30, formatted: "€0.30" });
  assert.equal(cheapestFirst.listingsNotCheapestFirst, false);

  // The grouped layout's "for sale starting at" line doesn't depend on it either.
  const grouped = parseListingOrderBookHtml(KEY_PAGE);
  assert.equal(grouped.listingsNotCheapestFirst, false);
});

test("parseMarketPriceText reads a price Steam shows elsewhere, like the inventory panel's \"Starting at\"", () => {
  assert.deepEqual(parseMarketPriceText("0,30€"), { minorUnits: 30, formatted: "0.30€" });
  assert.equal(parseMarketPriceText(""), null);
  assert.equal(parseMarketPriceText(null), null);
});
