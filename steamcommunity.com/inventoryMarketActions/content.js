/*
@description: Adds Quick Sell / Instant Sell buttons (and a Bulk Sell button)
next to Steam's own native "Sell" button on a steamcommunity.com inventory
item panel - Quick Sell lists at 1 cent under the current lowest listing,
Instant Sell lists at the current highest buy order (so it matches
immediately). Confirmed-live mechanics (see this file's own function-level
notes for how each piece was pinned down): the item's Market listing page
for the two prices (shared/marketListingOrderBook.js), market/sellitem/ to
actually submit, and Steam's own in-page
GetItemPriceFromTotal (bridged in from mainWorld.js - see that file's own
header) to convert a buyer-facing total into the pre-fee amount
market/sellitem/ itself expects, rather than re-deriving Valve's fee
rounding rules independently.

Deliberately its own feature, separate from steamcommunity.com/itemQuickLinks
(which only links out, never submits anything) - reuses that module's own
DOM/identity helpers (pickContainer, findActiveAssetId, resolveRealItemName)
rather than re-deriving the same "what item is this, really" logic a second
time, but everything about actually building/
submitting a listing here is its own, since it's a fundamentally different
(and much higher-stakes - this places a real listing for real money) kind of
action than a plain link.

If another inventory extension that adds its own Quick Sell/Instant
Sell/Bulk Sell buttons is also installed, those are hidden (see
hideOtherExtensionButtons) rather than ours being skipped - always building
our own row keeps its order and spacing fully under our control instead of
depending on wherever the other extension happens to insert its buttons.

Runs on ANY steamcommunity.com inventory tab, not just TF2's - the other
extension's buttons are hidden the same way there too, so the two never
show side by side regardless of which game's items are selected. TF2 (appid
440) still gets its own dedicated item-identity pipeline (resolveRealItemName
+ resolveTf2MarketHashName, both schema/GetPlayerItems-backed - see
resolveTf2MarketHashName's own note) since a renamed TF2 item's on-page title
can't be trusted as-is; every OTHER game instead uses
itemQuickLinks/content.js's own findMarketListingLinkName directly - Steam's
own already-decoded market_hash_name straight off the item panel's customName
link, which is correct (rename included) with no per-game schema of its own
needed.
*/
import {
  pickContainer,
  findActiveAssetId,
  findActiveContextId,
  findMarketListingLinkName,
  resolveRealItemName,
  getActiveInventoryAppId,
  readVisibleTitleText,
} from "../itemQuickLinks/content.js";
import { resolveStatsAndClassifieds, createSteamMarketLink } from "../../utils/tf2StatsLinks/index.js";
import { hasSteamApiKey } from "../../utils/tf2Schema.js";
import { fetchListingOrderBook, formatMinorUnitsLike, parseMarketPriceText } from "../shared/marketListingOrderBook.js";

// Only TF2 needs (and gets) the schema/GetPlayerItems-backed item-identity
// pipeline (resolveRealItemName/resolveTf2MarketHashName) - see this file's
// own header note.
const TF2_APP_ID = 440;

const ACTIONS_CLASS = "tf2te-market-actions";
const NOTICE_CLASS = "tf2te-market-actions-notice";
const LOADING_CLASS = "tf2te-market-actions-loading";
const QUICK_SELL_CLASS = "tf2te-quick-sell-button";
const INSTANT_SELL_CLASS = "tf2te-instant-sell-button";
const MULTI_SELL_CLASS = "tf2te-bulk-sell-button";
const STATUS_CLASS = "tf2te-market-action-status";

// Matches the OTHER extension's own class names on ITS buttons (confirmed
// live, from the real page DOM) - used to HIDE its buttons (see
// hideOtherExtensionButtons below) so ours are the only ones shown, giving
// full control over order/spacing instead of splicing ours in around
// whatever it already inserted.
const OTHER_EXT_QUICK_SELL_SELECTOR = ".marketActionQuickSell";
const OTHER_EXT_INSTANT_SELL_SELECTOR = ".marketActionInstantSell";
const OTHER_EXT_MULTI_SELL_SELECTOR = ".multiSellLink";

// Event names for the mainWorld.js round-trip - see that file's own header
// for why this bridge exists at all (Steam's own fee-calculation function
// isn't reachable from this isolated-world script directly).
const PRICE_REQUEST_EVENT = "tf2te-resolve-seller-price-request";
const PRICE_RESPONSE_EVENT = "tf2te-resolve-seller-price-response";

/*
@description: Reads the "sessionid" cookie Steam itself sets on
steamcommunity.com. Read straight off the cookie jar rather than via the
more roundabout route of injecting a script to read the page's own
g_sessionID global - that cookie isn't HttpOnly, so there's nothing to work
around. Required by market/sellitem/'s own CSRF check.
@returns: the session id, or null if not signed in.
*/
function readSteamSessionId() {
  const match = document.cookie.match(/(?:^|;\s*)sessionid=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

/*
@description: Resolves Steam's own GetItemPriceFromTotal result (see
mainWorld.js's own header for why that function specifically, not a
hand-rolled fee formula) two different ways depending on the browser:

Firefox: reached directly via window.wrappedJSObject, a Firefox-only escape
hatch that lets a content script call/read the REAL page's own unwrapped JS
objects - confirmed live this is actually necessary there, not just an
alternative: mainWorld.js's own "world": "MAIN" content script entry either
isn't supported or isn't being injected on the user's Firefox version (it
never showed up at all in the page's own DevTools Sources list), so the
CustomEvent round-trip below never had anything listening to answer it,
timing out every time. wrappedJSObject is undefined in Chrome, so this is
skipped there with no effect.

Chrome (or any browser where wrappedJSObject isn't available):
mainWorld.js/CustomEvent round-trip. Its own "detail" is sent as a JSON
STRING, not a live object - confirmed live (Firefox): a plain object built by this
(isolated-world) script is an Xray-wrapped foreign object to mainWorld.js's
own (page-realm) listener, and reading a property directly off it threw
"Permission denied to access property ..." there rather than just working
the way it does in Chrome. A string is a primitive, copied by value across
that boundary with no such restriction either way - see mainWorld.js's own
matching JSON.stringify/parse on its side of this same bridge.
@param {number} buyerTotalCents
@returns {Promise<number>} the seller-input price, in cents.
*/
function resolveSellerPriceCents(buyerTotalCents) {
  const pageWindow = window.wrappedJSObject;
  if (typeof pageWindow?.GetItemPriceFromTotal === "function" && pageWindow?.g_rgWalletInfo) {
    try {
      const sellerPriceCents = pageWindow.GetItemPriceFromTotal(buyerTotalCents, pageWindow.g_rgWalletInfo);
      if (sellerPriceCents != null) return Promise.resolve(sellerPriceCents);
    } catch {
      // Falls through to the CustomEvent bridge below.
    }
  }

  return new Promise((resolve, reject) => {
    const requestId = `${Date.now()}-${Math.random()}`;

    const timeoutId = setTimeout(() => {
      document.removeEventListener(PRICE_RESPONSE_EVENT, onResponse);
      reject(new Error("Timed out waiting for Steam's own fee calculation"));
    }, 8000);

    function onResponse(event) {
      const detail = typeof event.detail === "string" ? JSON.parse(event.detail) : event.detail;
      const { requestId: respondingTo, sellerPriceCents } = detail || {};
      if (respondingTo !== requestId) return;

      clearTimeout(timeoutId);
      document.removeEventListener(PRICE_RESPONSE_EVENT, onResponse);

      if (sellerPriceCents == null) reject(new Error("Steam's own fee calculation isn't available on this page"));
      else resolve(sellerPriceCents);
    }

    document.addEventListener(PRICE_RESPONSE_EVENT, onResponse);
    document.dispatchEvent(new CustomEvent(PRICE_REQUEST_EVENT, { detail: JSON.stringify({ requestId, buyerTotalCents }) }));
  });
}

/*
@description: The item's order book, read off its Steam Market listing page
(shared/marketListingOrderBook.js) - not market/orderbook?q=Load, which
failed live with "No order book data for this item".

One page load serves both buttons and the hover info: the result is reused
for ORDER_BOOK_REUSE_MS, so hovering and then clicking costs one request,
not three. The confirm dialog shows the price before anything is listed.
*/
const ORDER_BOOK_REUSE_MS = 30 * 1000;

function createOrderBookLoader(appId, marketHashName) {
  const listingUrl = `https://steamcommunity.com/market/listings/${appId}/${encodeURIComponent(marketHashName)}`;
  let cached = null;
  return () => {
    if (!cached || Date.now() - cached.at > ORDER_BOOK_REUSE_MS) {
      const entry = { at: Date.now(), promise: fetchListingOrderBook(listingUrl) };
      // A failed load isn't kept - the next hover/click retries.
      entry.promise.catch(() => {
        if (cached === entry) cached = null;
      });
      cached = entry;
    }
    return cached.promise;
  };
}

// 1 cent under the cheapest listing, never below Steam's 3 cent minimum.
function quickSellTotalCents(lowestListingCents) {
  return lowestListingCents > 3 ? lowestListingCents - 1 : 3;
}

/*
@description: Steam's own "Starting at: 0,30€" line in the item panel's
market box (confirmed live, shown above the Sell button row): the cheapest
listing in the wallet currency, whatever the Market sort, though it can lag a
few minutes behind the Market. Read only from that box, the Sell button
row's parent, never from the rest of the panel: an item's description is
free text that someone else may have written, and could imitate the line.
@returns {?{minorUnits, formatted}} null until Steam has shown it.
*/
function readSteamStartingAt(sellButton) {
  const marketBox = sellButton.parentElement?.parentElement;
  if (!marketBox) return null;
  // The innermost element whose text starts with the label (an ancestor's
  // text starts the same way, and comes first in document order).
  const lines = Array.from(marketBox.querySelectorAll("div, span, p")).filter((el) =>
    el.textContent?.trim().startsWith("Starting at:")
  );
  const text = lines.at(-1)?.textContent.trim();
  const match = text && /^Starting at:\s*(.+?)(?:\s*Volume:[\s\S]*)?$/.exec(text);
  return match ? parseMarketPriceText(match[1]) : null;
}

const SORT_UNKNOWN_MESSAGE =
  "Can't tell the cheapest listing: your Market sort isn't cheapest-first and Steam hasn't shown its \"Starting at\" price yet. Try again in a moment.";

/*
@description: Each button's price plan from the order book: what it lists
at, how to format it, and the "Right now" hover line. null when there's
nothing to sell at.

The listing page comes back in the account's own Market sort, so when it
isn't cheapest-first (orderBook.listingsNotCheapestFirst), Quick Sell uses
Steam's own "Starting at" price from the panel instead (steamStartingAt, see
readSteamStartingAt), and says so.
@throws when neither tells the cheapest listing.
*/
function quickSellPlan(orderBook, steamStartingAt = null) {
  const fromSteamPanel = !orderBook.lowestSellOrder && orderBook.listingsNotCheapestFirst;
  const lowest = fromSteamPanel ? steamStartingAt : orderBook.lowestSellOrder;
  if (!lowest) {
    if (fromSteamPanel) throw new Error(SORT_UNKNOWN_MESSAGE);
    return null;
  }
  const buyerTotalCents = quickSellTotalCents(lowest.minorUnits);
  const format = (cents) => formatMinorUnitsLike(lowest, cents);
  // At Steam's minimum it can't go under the cheapest listing, only match it.
  const undercuts = buyerTotalCents === lowest.minorUnits - 1;
  const source = fromSteamPanel ? ", Steam's own \"Starting at\" price, since your Market sort isn't cheapest-first" : "";
  return {
    buyerTotalCents,
    format,
    summary: undercuts
      ? `Lists at ${format(buyerTotalCents)}, 0.01 under the cheapest listing (${lowest.formatted}${source}).`
      : `Lists at ${format(buyerTotalCents)}, Steam's minimum price (the cheapest listing is ${lowest.formatted}${source}).`,
  };
}

function instantSellPlan(orderBook) {
  const highest = orderBook.highestBuyOrder;
  if (!highest) return null;
  const format = (cents) => formatMinorUnitsLike(highest, cents);
  const count = orderBook.buyOrderCount;
  const countText = count ? ` (${count} ${count === 1 ? "request" : "requests"} to buy at this price or lower)` : "";
  return {
    buyerTotalCents: highest.minorUnits,
    format,
    summary: `Sells to the highest buy order, ${highest.formatted}${countText}.`,
  };
}

/*
@description: Submits the actual market listing - confirmed live: POST with
sessionid/appid/contextid/amount/assetid/price (the pre-fee amount, see
resolveSellerPriceCents), credentials included for the session cookie.
@throws if Steam's own response reports failure (e.g. "success": false).
*/
async function submitMarketListing(appId, contextId, assetId, sellerPriceCents) {
  const sessionId = readSteamSessionId();
  if (!sessionId) throw new Error("Not signed in (no sessionid cookie)");

  const body = new URLSearchParams({
    sessionid: sessionId,
    appid: String(appId),
    contextid: String(contextId),
    amount: "1",
    assetid: String(assetId),
    price: String(sellerPriceCents),
  });

  const response = await fetch("https://steamcommunity.com/market/sellitem/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
    credentials: "include",
    body: body.toString(),
  });

  const json = await response.json().catch(() => null);
  if (!response.ok || !json?.success) {
    throw new Error(json?.message || `Listing failed (HTTP ${response.status})`);
  }
}

/*
@description: Resolves a TF2 item's real market_hash_name - reuses
resolveStatsAndClassifieds/createSteamMarketLink's own already-correct name
building (same one steamcommunity.com/itemQuickLinks's own "Steam Market"
button uses) rather than re-deriving it, just pulling the bare name back out
of the URL those already build instead of the full href. TF2-only (Unusual
effect/Killstreak/paint filtering, the TF2 schema) - see this file's own
header note on why every other game instead uses
itemQuickLinks/content.js's own findMarketListingLinkName directly.
@param {string} itemName - the REAL (unrenamed) item identity from
resolveRealItemName, not the on-page display title.
@returns {Promise<?string>}
*/
async function resolveTf2MarketHashName(itemName) {
  const resolved = await resolveStatsAndClassifieds(itemName);
  if (!resolved.classifiedsFilters) return null;

  const steamMarketHref = createSteamMarketLink(itemName, resolved.classifiedsFilters);
  const encodedName = new URL(steamMarketHref).pathname.split("/").pop();
  return decodeURIComponent(encodedName);
}

/*
@description: Finds Steam's own native "Sell" button - the one this
feature's own buttons get inserted next to. Confirmed live: its own text is
always the bare word "Sell", with none of the surrounding markup (nested
spans etc.) resolveRealItemName's own readVisibleTitleText had to work around
for the title - matched on that text, not just on
button[data-accent-color="green"] in isolation (see below on why the color
alone isn't unique enough).
@returns: the button element, or null if none found (item not marketable,
not the owner's own inventory, etc.).

Matched on the actual "Sell" text/label, not just the color attribute in
isolation - a Steam Community Item/Trading Card's own item panel has a
"Turn into Gems..." button that ALSO carries data-accent-color="green" and sits BEFORE
the real "Sell" button in document order. The class-based exclusions below
are kept anyway (belt and braces - a clone's own label always differs from
"Sell" regardless, but this avoids relying on that alone).
See #118.
*/
function findNativeSellButton(container) {
  for (const button of container.querySelectorAll('button[data-accent-color="green"]')) {
    if (button.classList.contains(QUICK_SELL_CLASS)) continue;
    if (button.classList.contains(INSTANT_SELL_CLASS)) continue;
    // Own Bulk Sell clone - excluded explicitly like Quick/Instant Sell's,
    // rather than relying on Steam's real Sell button always coming first
    // in document order (our clones are inserted "afterend" of it, see
    // buildActionsBlock).
    if (button.classList.contains(MULTI_SELL_CLASS)) continue;
    if (button.classList.contains("marketActionQuickSell")) continue;
    if (button.classList.contains("marketActionInstantSell")) continue;
    // The other extension's own Bulk Sell button (see OTHER_EXT_MULTI_SELL_SELECTOR) -
    // same reasoning as the two checks above it: hideOtherExtensionButtons
    // only sets display:none on it, which doesn't stop querySelectorAll from
    // still matching it here.
    if (button.classList.contains("multiSellLink")) continue;
    if (button.textContent?.trim() !== "Sell") continue;
    return button;
  }

  return null;
}

// Hover text. Both create a Market listing (as Steam's own Sell does), so
// both say what happens and that the mobile confirmation is still needed.
const QUICK_SELL_TITLE =
  "Quick Sell: lists this item 0.01 below the cheapest listing on the Steam Market, so it's the next one a buyer gets. It sells when someone buys it, not immediately. Confirm the listing in the Steam Mobile App.";
const INSTANT_SELL_TITLE =
  "Instant Sell: sells this item right away to the highest buy order. It's listed at exactly that buy order's price, so the two match as soon as you confirm it in the Steam Mobile App. Usually less than Quick Sell.";

function createActionButton(label, title, originalSellButton) {
  const button = originalSellButton.cloneNode(true);
  button.textContent = label;
  button.title = title;
  return button;
}

// Shared by both buttons' own success text below - neither one is actually
// an instant, guaranteed sale (both submit a market LISTING via
// market/sellitem/, Instant Sell's own "highest buy order" price included -
// see attachSellHandler's own caller notes), and Steam won't actually
// activate either listing until it's approved from the Confirmations
// section of the Steam Mobile App, the same as listing manually through
// Steam's own native "Sell" dialog would require.
const LISTED_MESSAGE = "Listed! Confirm it in the Steam Mobile App's Confirmations section to finish.";

/*
@description: Shared click handler for both buttons - loads the order book,
confirms with the user (showing the price AND what they'd receive after
Steam's fee, not a blind yes/no), then submits.
@param {() => Promise<object>} loadOrderBook - see createOrderBookLoader.
@param {(orderBook) => ?{buyerTotalCents, format}} planFor - see quickSellPlan;
null means there's nothing to sell at.
*/
function attachSellHandler(button, statusEl, appId, contextId, assetId, confirmLabel, noPriceMessage, loadOrderBook, planFor) {
  button.addEventListener("click", async () => {
    button.disabled = true;
    statusEl.textContent = "Checking current price…";

    try {
      const plan = planFor(await loadOrderBook());
      if (!plan) {
        statusEl.textContent = noPriceMessage;
        return;
      }

      const sellerPriceCents = await resolveSellerPriceCents(plan.buyerTotalCents);
      const confirmText = `${confirmLabel} for ${plan.format(plan.buyerTotalCents)}? You receive ${plan.format(sellerPriceCents)} after Steam's fee.`;
      const confirmed = window.confirm(confirmText);
      if (!confirmed) {
        statusEl.textContent = "";
        return;
      }

      statusEl.textContent = "Listing…";
      await submitMarketListing(appId, contextId, assetId, sellerPriceCents);
      statusEl.textContent = LISTED_MESSAGE;
    } catch (e) {
      statusEl.textContent = `Failed: ${e.message}`;
    } finally {
      button.disabled = false;
    }
  });
}

/*
@description: Adds the live numbers to a button's hover text when it's
hovered ("Right now: lists at €1.26 ..., you receive €1.10"). The static
explanation is there from the start; this only appends to it.
*/
function attachLivePriceHover(button, baseTitle, noPriceLine, loadOrderBook, planFor) {
  button.addEventListener("mouseenter", async () => {
    try {
      const plan = planFor(await loadOrderBook());
      if (!plan) {
        button.title = `${baseTitle}\n\nRight now: ${noPriceLine}`;
        return;
      }
      const sellerPriceCents = await resolveSellerPriceCents(plan.buyerTotalCents);
      button.title = `${baseTitle}\n\nRight now: ${plan.summary} You receive ${plan.format(sellerPriceCents)} after Steam's fee.`;
    } catch {
      // The static explanation stays; a click reports the actual error.
    }
  });
}

function buildActionsBlock(originalSellButton, appId, contextId, assetId, marketHashName) {
  // Outer wrapper: column direction, holding just two items - buttonsRow and
  // statusEl (appended further below) - kept in FULLY separate flex
  // containers rather than one shared wrapping row: confirmed live, sharing
  // one row meant statusEl gaining real text (e.g. "Checking current
  // price…") changed the space/height available to that same row's flex-wrap
  // computation, which pushed the BUTTONS themselves into wrapping too, even
  // though they hadn't changed size at all - purely a side effect of
  // statusEl's own content state. Nesting buttonsRow as its own independent
  // flex container means its wrap decisions can never be influenced by
  // statusEl's content one way or the other.
  const wrapper = document.createElement("span");
  wrapper.className = ACTIONS_CLASS;
  wrapper.style.display = "inline-flex";
  wrapper.style.flexDirection = "column";
  wrapper.style.gap = "4px";
  // flex-start, not the default stretch - stretch would force buttonsRow to
  // match whatever width wrapper computes from its WIDEST child, which
  // (without statusEl's own maxWidth cap below) could be statusEl's own long
  // status text, indirectly squeezing buttonsRow narrower than its buttons
  // actually need and reintroducing the same wrapping bug this whole
  // structure was meant to fix. flex-start lets each child size to its own
  // content instead.
  wrapper.style.alignItems = "flex-start";
  // originalSellButton is OUTSIDE this wrapper (a sibling, not a child,
  // since it's Steam's own pre-existing button) - without this, the space
  // between "Sell" and the first button here would follow whatever Steam's
  // own outer row uses instead, which doesn't necessarily match.
  wrapper.style.marginLeft = "5px";

  const buttonsRow = document.createElement("span");
  // Explicit flex container, not left as a plain (layout-transparent) span -
  // confirmed live: without this, the buttons inside just flowed inline
  // alongside Steam's own native "Sell" button based on raw available
  // width (like wrapping text), splitting them across rows arbitrarily
  // (e.g. Bulk Sell staying on Sell's own row while Quick Sell/Instant Sell
  // wrapped to a second one) instead of behaving as one grouped unit.
  buttonsRow.style.display = "inline-flex";
  buttonsRow.style.flexWrap = "wrap";
  buttonsRow.style.alignItems = "center";
  buttonsRow.style.gap = "5px";

  const statusEl = document.createElement("div");
  statusEl.className = STATUS_CLASS;
  statusEl.style.fontSize = "12px";
  statusEl.style.color = "#8f98a0";
  // Capped rather than left to size to its own (possibly very long, e.g.
  // "Failed: Timed out waiting for Steam's own fee calculation") text - see
  // wrapper's own alignItems note above for why an unbounded width here
  // could still indirectly squeeze buttonsRow even with flex-start set. Long
  // text wraps onto its own second line within this cap instead.
  statusEl.style.maxWidth = "300px";
  // Pulled left by the Sell button's own measured width (+ wrapper's own
  // marginLeft gap) so this starts flush under Sell's own left edge instead
  // of under buttonsRow's first button (wrapper itself starts to the RIGHT
  // of Sell, offset by marginLeft above).
  statusEl.style.marginLeft = `${-(originalSellButton.offsetWidth + 5)}px`;

  const loadOrderBook = createOrderBookLoader(appId, marketHashName);

  const quickSellButton = createActionButton("Quick Sell", QUICK_SELL_TITLE, originalSellButton);
  quickSellButton.classList.add(QUICK_SELL_CLASS);
  // Read when used, not now: Steam fills in "Starting at" after the panel.
  const quickSellPlanNow = (orderBook) => quickSellPlan(orderBook, readSteamStartingAt(originalSellButton));
  attachSellHandler(quickSellButton, statusEl, appId, contextId, assetId, "Quick Sell this item", "No other listings to undercut.", loadOrderBook, quickSellPlanNow);
  attachLivePriceHover(quickSellButton, QUICK_SELL_TITLE, "no other listings to undercut.", loadOrderBook, quickSellPlanNow);

  const instantSellButton = createActionButton("Instant Sell", INSTANT_SELL_TITLE, originalSellButton);
  instantSellButton.classList.add(INSTANT_SELL_CLASS);
  attachSellHandler(instantSellButton, statusEl, appId, contextId, assetId, "Instant Sell this item", "No buy orders to sell to.", loadOrderBook, instantSellPlan);
  attachLivePriceHover(instantSellButton, INSTANT_SELL_TITLE, "no buy orders to sell to.", loadOrderBook, instantSellPlan);

  // qty[]=250 only pre-fills Steam's own Sell Multiple page's quantity field -
  // that page lets the user freely edit it (down or up) before confirming
  // anything, so this is just a large enough starting value to save typing
  // for a big stack; not a meaningful cap or a number Steam itself requires.
  const bulkSellHref = `https://steamcommunity.com/market/multisell?appid=${appId}&contextid=${contextId}&items%5B%5D=${encodeURIComponent(
    marketHashName
  )}&qty%5B%5D=250`;

  // A button, not a link - matches Quick Sell/Instant Sell's own look (both
  // are clones of Steam's native Sell button too) - navigation still happens
  // via window.open on click rather than an <a href>, since originalSellButton
  // is a <button>, not an <a>.
  const bulkSellButton = createActionButton("Bulk Sell", "Open Steam's Sell Multiple page for this item", originalSellButton);
  bulkSellButton.classList.add(MULTI_SELL_CLASS);
  bulkSellButton.addEventListener("click", () => {
    window.open(bulkSellHref, "_blank", "noopener,noreferrer");
  });

  buttonsRow.append(quickSellButton, instantSellButton, bulkSellButton);
  wrapper.append(buttonsRow, statusEl);

  return wrapper;
}

/*
@description: Hides the other extension's own Quick Sell/Instant Sell/Bulk
Sell buttons (see OTHER_EXT_*_SELECTOR above) rather than skipping creation
of ours - lets our row be the only one shown, with order/spacing fully under
our control. Called on every insertMarketActions run, not just when
(re)building our own block, since the other extension inserts its buttons on
its own timing and can do so after ours already exists. Called for every
game's inventory tab, not just TF2's - see this file's own header note.
*/
function hideOtherExtensionButtons(container) {
  container
    .querySelectorAll(`${OTHER_EXT_QUICK_SELL_SELECTOR}, ${OTHER_EXT_INSTANT_SELL_SELECTOR}, ${OTHER_EXT_MULTI_SELL_SELECTOR}`)
    .forEach((el) => {
      el.style.display = "none";
    });
}

/*
@description: Shown INSTEAD OF the actual buttons only when
resolveRealItemName's own `unresolved` flag comes back true - a renamed item
whose real identity couldn't be recovered from EITHER the DOM (market link/
rename notice/Collection marker) OR the Steam Web API. Every action here
submits a REAL market listing, so building one off this item's fake renamed
title would risk listing the WRONG item at the wrong price - same reasoning
steamcommunity.com/itemQuickLinks/content.js's own buildUnresolvedWarning
already established for its own (link-only, lower-stakes) buttons.

resolveRealItemName's own case 1 (the item panel's "customName" market link,
present for essentially every item that reaches this feature at all, since
findNativeSellButton already only ever finds a native Sell button on a
marketable one) resolves the real identity straight from the DOM with NO
Steam Web API call whatsoever. The API is only reached - and only required -
for the rare renamed item where DOM alone couldn't recover anything either
(resolveRealItemName's own case 6, the same case that sets unresolved: true).

Phrased differently depending on whether a key is even configured, same
remedy-specific reasoning buildUnresolvedWarning's own note documents: no key
at all needs one before this can ever work; a key that IS configured but
still failed (a transient GetPlayerItems error) instead needs a page reload,
since a manual Retry button isn't worth this feature's own extra state for
what's expected to be a rare case.
See #119.
*/
async function buildUnresolvedNotice() {
  const notice = document.createElement("span");
  notice.className = NOTICE_CLASS;
  notice.style.marginLeft = "5px";
  notice.style.fontSize = "12px";
  notice.style.color = "#8f98a0";

  notice.textContent = (await hasSteamApiKey())
    ? "This item has been renamed, and its real identity couldn't be verified (a Steam Web API request failed) - reload the page to retry. Quick Sell / Instant Sell / Bulk Sell are hidden until then, since they'd otherwise be built from its renamed title, not the real item."
    : "This item has been renamed, and verifying its real identity needs a Steam Web API key - set one in the extension popup (toolbar icon → API Credentials → Steam Web API settings) to enable Quick Sell / Instant Sell / Bulk Sell for it.";

  return notice;
}

/*
@description: Shown right away, before resolveRealItemName/
resolveTf2MarketHashName resolve (a real GetPlayerItems fetch plus, for an
Unusual/Kit/Fabricator/Strangifier, a cold schema lookup - can take a few
seconds), so that stretch reads as "still loading" rather than as the
feature not working.
*/
function buildLoadingNotice() {
  const notice = document.createElement("span");
  notice.className = LOADING_CLASS;
  notice.style.marginLeft = "5px";
  notice.style.fontSize = "12px";
  notice.style.color = "#8f98a0";
  notice.textContent = "Loading Quick Sell / Instant Sell / Bulk Sell…";
  return notice;
}

// Shared by every place that clears this feature's own UI before showing
// something else (the real buttons, the API key notice, the loading notice,
// or nothing at all) - kept as one helper so LOADING_CLASS can't be
// forgotten in any one of those call sites the way a plain repeated
// querySelectorAll(".${ACTIONS_CLASS}, .${NOTICE_CLASS}") list would risk.
function removeExistingActionsUi(container) {
  container.querySelectorAll(`.${ACTIONS_CLASS}, .${NOTICE_CLASS}, .${LOADING_CLASS}`).forEach((n) => n.remove());
}

/*
@description: Builds and inserts the actions block for whichever item is
currently shown - same request-key + in-flight-guard + "is it still there"
self-healing pattern as
steamcommunity.com/itemQuickLinks/content.js's own insertQuickLinks (see
that function's own header for the full reasoning); duplicated rather than
shared since the two otherwise have nothing else in common.
*/
async function insertMarketActions() {
  const picked = pickContainer();
  if (!picked) return;

  const { container, title } = picked;

  // Bail out only when NO game's inventory tab is actually active at all
  // (see itemQuickLinks/content.js's own note on getActiveInventoryAppId) -
  // every game's tab is handled below, not just TF2's.
  const appId = getActiveInventoryAppId();
  if (!appId) {
    removeExistingActionsUi(container);
    return;
  }

  hideOtherExtensionButtons(container);

  // See itemQuickLinks/content.js's own readVisibleTitleText for why plain
  // title.textContent isn't safe here (sums a hidden duplicate node).
  const displayName = readVisibleTitleText(title);
  if (!displayName) return;

  const assetId = findActiveAssetId();
  const contextId = findActiveContextId();
  // appId included (not just displayName/assetId) - a real Steam asset id is
  // unique account-wide regardless of game, so this is mostly belt-and-
  // braces, but it keeps a request built for one game's tab from ever being
  // mistaken for a stale/in-flight one from another.
  const requestKey = `${appId}|${displayName}|${assetId ?? ""}`;

  if (container.dataset.tf2teMarketActionsBuildingKey === requestKey) return;

  // An item whose market_hash_name couldn't be resolved (or whose build threw)
  // is attempted once per selection. Those bails leave no DOM marker behind,
  // and removing the loading notice is itself a mutation that re-runs this via
  // content.js's observer - without this guard, that rebuilt and removed the
  // notice over and over. Selecting a different item clears it, so coming
  // back retries.
  if (container.dataset.tf2teMarketActionsRequestKey !== requestKey) {
    delete container.dataset.tf2teMarketActionsFailedKey;
  } else if (container.dataset.tf2teMarketActionsFailedKey === requestKey) {
    return;
  }

  if (
    container.dataset.tf2teMarketActionsRequestKey === requestKey &&
    container.querySelector(`.${ACTIONS_CLASS}, .${NOTICE_CLASS}`)
  ) {
    return;
  }

  container.dataset.tf2teMarketActionsBuildingKey = requestKey;
  container.dataset.tf2teMarketActionsRequestKey = requestKey;

  // Logged at every bail-out point below (all no-ops otherwise) - confirmed
  // live this feature can silently stop rebuilding after specific page
  // events (e.g. right after a listing succeeds) with nothing else in the
  // console to explain why, and re-diagnosing that blind via manual
  // console commands each time it happens has been the main cost of every
  // bug like it so far. A prefix makes these easy to filter for.
  const LOG_PREFIX = "[TF2 Trading Enhancer] inventoryMarketActions:";

  try {
    const originalSellButton = findNativeSellButton(container);
    if (!originalSellButton || !assetId || !contextId) {
      // Logged once per item selection, not on every call - this branch
      // never inserts any DOM marker (unlike the notice/actions branches
      // below), so without this the requestKey guard above never engages
      // and every unrelated mutation elsewhere on the page (subtree: true,
      // see steamcommunity.com/content.js's own observer) re-triggered this
      // same bail and re-logged it, confirmed live to flood the console
      // with dozens of copies from a single item click on a non-marketable
      // item (nothing here ever becomes true for such an item, so it never
      // settles on its own).
      if (container.dataset.tf2teMarketActionsMissingKey !== requestKey) {
        container.dataset.tf2teMarketActionsMissingKey = requestKey;
        console.debug(LOG_PREFIX, "bailing - missing", { hasSellButton: !!originalSellButton, assetId, contextId });
      }
      return;
    }

    // Shown right away, before the potentially-slow lookups below - see
    // buildLoadingNotice's own note on why (nothing on screen for that whole
    // stretch read as broken rather than still loading). No upfront
    // hasSteamApiKey() gate - see buildUnresolvedNotice's own note.
    removeExistingActionsUi(container);
    originalSellButton.insertAdjacentElement("afterend", buildLoadingNotice());

    // Item-identity resolution forks on the active game - see this file's
    // own header note. Only TF2 gets resolveRealItemName's schema/
    // GetPlayerItems-backed reconstruction (needed because a renamed TF2
    // item's on-page title can't be trusted as-is); every other game instead
    // uses findMarketListingLinkName directly, straight off the item panel's
    // own customName link - Steam's own already-decoded market_hash_name,
    // correct even for a renamed item, with no per-game schema of its own to
    // maintain.
    let marketHashName;
    if (appId === TF2_APP_ID) {
      // resolveRealItemName's own unresolved flag is surfaced here - see
      // buildUnresolvedNotice's own note: every action
      // this feature builds submits a REAL market listing, so a renamed item
      // whose real identity couldn't be verified from EITHER the DOM or the
      // API gets the same "no buttons, just an explanatory notice" treatment
      // itemQuickLinks/content.js's own unresolved branch already
      // established, rather than silently building off its fake renamed
      // title.
      //
      // resolveRealItemName returns null (not unresolved) for a NON-renamed
      // item on purpose (its own DOM-first design - the on-page title is
      // already correct there, nothing to resolve) - falling back to
      // displayName in that case is exactly as valid a market_hash_name
      // basis as resolveRealItemName's own reconstruction would have
      // produced, since Steam's own title already IS accurate for a
      // non-renamed item.
      const { name: realName, unresolved } = await resolveRealItemName(container);

      if (container.dataset.tf2teMarketActionsRequestKey !== requestKey) {
        console.debug(LOG_PREFIX, "bailing after resolveRealItemName - requestKey superseded", requestKey);
        return;
      }

      if (unresolved) {
        // Built before the re-check: building it awaits a storage read, and a
        // newer item selected meanwhile must not get this stale notice.
        const notice = await buildUnresolvedNotice();
        if (container.dataset.tf2teMarketActionsRequestKey !== requestKey) return;
        removeExistingActionsUi(container);
        originalSellButton.insertAdjacentElement("afterend", notice);
        return;
      }

      const itemName = realName || displayName;
      marketHashName = await resolveTf2MarketHashName(itemName);
    } else {
      marketHashName = findMarketListingLinkName(container);
    }

    if (!marketHashName) {
      console.debug(LOG_PREFIX, "bailing - no market_hash_name resolved", { appId, displayName });
      if (container.dataset.tf2teMarketActionsRequestKey === requestKey) {
        container.dataset.tf2teMarketActionsFailedKey = requestKey;
        removeExistingActionsUi(container);
      }
      return;
    }

    if (container.dataset.tf2teMarketActionsRequestKey !== requestKey) {
      console.debug(LOG_PREFIX, "bailing after resolving market_hash_name - requestKey superseded", requestKey);
      return;
    }

    removeExistingActionsUi(container);

    const block = buildActionsBlock(originalSellButton, appId, contextId, assetId, marketHashName);
    originalSellButton.insertAdjacentElement("afterend", block);
  } catch (e) {
    // Unlike the bail-outs above (expected, already-logged null results),
    // this catches a genuinely unexpected failure (e.g. a network error from
    // resolveTf2MarketHashName's own resolveStatsAndClassifieds call, TF2
    // only). insertMarketActions is always called fire-and-forget (see
    // showInventoryMarketActions and steamcommunity.com/content.js's own
    // MutationObserver callback), so without this it would be an unhandled
    // rejection that leaves the "Loading…" notice stuck on screen - same as
    // steamcommunity.com/itemQuickLinks/content.js's own insertQuickLinks.
    console.warn(LOG_PREFIX, "unexpected error", e);
    if (container.dataset.tf2teMarketActionsRequestKey === requestKey) {
      container.dataset.tf2teMarketActionsFailedKey = requestKey;
      removeExistingActionsUi(container);
    }
  } finally {
    if (container.dataset.tf2teMarketActionsBuildingKey === requestKey) {
      delete container.dataset.tf2teMarketActionsBuildingKey;
    }
  }
}

export function showInventoryMarketActions() {
  insertMarketActions();
}
