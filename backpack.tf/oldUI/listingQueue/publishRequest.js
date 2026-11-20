/*
@description: Builds the form-encoded body for, and issues, the POST that
creates one backpack.tf classifieds listing.

Param shape (intent/currencies[metal]/currencies[keys]/promoted/buyout/
offers/trade_offer_url/details/id/user-id) is undocumented: it mirrors how
existing clients use this endpoint and is not confirmed against any
backpack.tf documentation. Kept isolated in its own small function so
this is the one place to fix if the contract turns out wrong (a 4xx, a
differently-named field, a missing CSRF requirement, etc.).

Posted with a plain same-origin fetch() (credentials: "include"), not
routed through background.js's own fetch relay (utils/fetchJsonRelay.js) -
that relay exists for CROSS-origin requests, where Firefox blocks reading
the response and/or the target site's CSP blocks the request outright (see
background.js's own header note); neither applies here, since this content
script runs ON backpack.tf and posts back to backpack.tf itself. Same
same-origin-fetch precedent steamcommunity.com/inventoryMarketActions/
content.js's own submitMarketListing already establishes for Steam's own
market/sellitem/ endpoint.
*/

export const LISTING_ENDPOINT = "https://backpack.tf/classifieds/listing";

export function buildListingParams({ assetId, keys, metal, details, tradeOfferUrl, userId }) {
  return {
    intent: "sell",
    "currencies[metal]": String(metal || 0),
    "currencies[keys]": String(keys || 0),
    promoted: "0",
    buyout: "0",
    offers: "1",
    trade_offer_url: tradeOfferUrl || "",
    details: details || "",
    id: assetId,
    "user-id": userId || "",
  };
}

/*
@description: Throws with the server's own message when available (its JSON
error body), falling back to a plain "HTTP {status}" when the error body
isn't JSON at all (a proxy/WAF block page, a plain 500 with an HTML body),
rather than letting a body-parsing SyntaxError hide the real failure.
*/
export async function publishListing(params) {
  const response = await fetch(LISTING_ENDPOINT, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });

  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const data = await response.json();
      if (data?.message) message = data.message;
    } catch {
      // Not a JSON body - the plain HTTP status above is all there is to report.
    }
    throw new Error(message);
  }

  return response.json().catch(() => ({}));
}
