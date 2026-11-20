/*
@description: The signed-in account's Steam wallet currency, as Steam's own
numeric id (g_rgWalletInfo.wallet_currency, e.g. 3 for EUR), for a
priceoverview lookup in the same currency the page shows. g_rgWalletInfo is a
page global, out of an isolated content script's reach, so this reaches it
the same two ways inventoryMarketActions/content.js's resolveSellerPriceCents
reaches Steam's fee function: window.wrappedJSObject on Firefox, else the
CustomEvent bridge in inventoryMarketActions/mainWorld.js (inventory pages
only, where that runs). Steam's current Market page has no g_rgWalletInfo
at all (confirmed live); there the currency its listings are shown in is
read instead, which ../tradeOffer/pages/marketListing.js puts on <html>.
*/

// Set by ../tradeOffer/pages/marketListing.js on a Market listing page.
export function getStampedWalletCurrencyId() {
  return validCurrency(Number(document.documentElement?.dataset?.tf2teWalletCurrency));
}

const REQUEST_EVENT = "tf2te-wallet-currency-request";
const RESPONSE_EVENT = "tf2te-wallet-currency-response";
const BRIDGE_TIMEOUT_MS = 3000;

// A wallet currency id is a small positive integer; anything else is null.
function validCurrency(value) {
  return Number.isInteger(value) && value > 0 ? value : null;
}

/*
@returns {Promise<?number>} the currency id, or null when the page doesn't
say (not signed in, or the bridge didn't answer).
*/
export function getWalletCurrencyId() {
  const fromPage = validCurrency(window.wrappedJSObject?.g_rgWalletInfo?.wallet_currency) ?? getStampedWalletCurrencyId();
  if (fromPage) return Promise.resolve(fromPage);

  return new Promise((resolve) => {
    const requestId = `${Date.now()}-${Math.random()}`;
    const timeoutId = setTimeout(() => {
      document.removeEventListener(RESPONSE_EVENT, onResponse);
      resolve(null);
    }, BRIDGE_TIMEOUT_MS);

    function onResponse(event) {
      const detail = typeof event.detail === "string" ? JSON.parse(event.detail) : event.detail;
      if (detail?.requestId !== requestId) return;
      clearTimeout(timeoutId);
      document.removeEventListener(RESPONSE_EVENT, onResponse);
      resolve(validCurrency(detail.currency));
    }

    document.addEventListener(RESPONSE_EVENT, onResponse);
    document.dispatchEvent(new CustomEvent(REQUEST_EVENT, { detail: JSON.stringify({ requestId }) }));
  });
}
