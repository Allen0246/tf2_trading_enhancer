/*
@description: Lets the Steam trade-offer page tell a listing link the user
actually clicked on backpack.tf apart from a link that only looks like one.

steamcommunity.com/tradeOffer/pages/tradeoffer.js pre-fills a trade from the
listing_* and for_item_name params in its own URL: the user's own keys/metal,
or a matching item from the user's own inventory. Those params are plain URL
text, so anyone could put them on a trade link and send it to a victim. The
pre-fill therefore only runs for a link the backpack.tf content scripts saw
the user open: they record its fingerprint here, in extension storage, which
no web page can write to, and steamcommunity.com/tradeOfferSettingsBridge/
content.js checks its own URL against those records.
*/

export const TRADE_LINK_CLICKS_STORAGE_KEY = "trustedTradeLinkClicks";

// Covers a slow Steam page load or a Steam login detour in between, while
// keeping old records from piling up.
const TRUST_WINDOW_MS = 10 * 60 * 1000;

// Several listings are often opened in separate tabs at once.
const MAX_RECORDS = 20;

// Every param that decides what gets pre-filled and with whom. partner and
// token tie a record to that one trader, so a recorded link can't be reused
// against a different account.
const FINGERPRINT_PARAMS = [
  "partner",
  "token",
  "listing_intent",
  "listing_currencies_keys",
  "listing_currencies_metal",
  "for_item",
  "for_item_name",
];

/*
@description: A comparable string for a trade link, built from its decoded
FINGERPRINT_PARAMS values (so "+" and "%20" spellings of the same name
compare equal). Deliberately ignores the host and path: the backpack.tf side
only ever records anchors its own fixTradeOfferLinks vetted, and a listing's
trade button may point at Steam through a backpack.tf URL first, so only the
params that survive to the Steam page are compared. Null for an unparseable
URL.
@returns {string|null}
*/
export function tradeLinkFingerprint(href) {
  let url;
  try {
    url = new URL(href);
  } catch {
    return null;
  }

  return JSON.stringify(FINGERPRINT_PARAMS.map((name) => url.searchParams.get(name)));
}

async function readRecords() {
  const stored = await chrome.storage.local.get([TRADE_LINK_CLICKS_STORAGE_KEY]);
  const records = stored[TRADE_LINK_CLICKS_STORAGE_KEY];
  return Array.isArray(records) ? records : [];
}

function isFresh(record, now) {
  const age = now - record.at;
  return age >= 0 && age < TRUST_WINDOW_MS;
}

// Records that the user just opened `href` from a backpack.tf listing.
export async function recordTradeLinkClick(href, now = Date.now()) {
  const fingerprint = tradeLinkFingerprint(href);
  if (!fingerprint) return;

  const kept = (await readRecords()).filter((record) => isFresh(record, now) && record.fingerprint !== fingerprint);
  kept.push({ fingerprint, at: now });

  await chrome.storage.local.set({ [TRADE_LINK_CLICKS_STORAGE_KEY]: kept.slice(-MAX_RECORDS) });
}

// True if `href` matches a listing link the user opened on backpack.tf
// within the last TRUST_WINDOW_MS.
export async function isRecentlyClickedTradeLink(href, now = Date.now()) {
  const fingerprint = tradeLinkFingerprint(href);
  if (!fingerprint) return false;

  return (await readRecords()).some((record) => record.fingerprint === fingerprint && isFresh(record, now));
}

// mousedown covers left and middle clicks, plus the right click before "Open
// link in new tab" or "Copy link". click covers a link opened with the
// keyboard (Enter fires click with no mousedown). auxclick is a fallback for
// a middle click whose mousedown was swallowed by the page.
const OPEN_EVENTS = ["mousedown", "click", "auxclick"];

/*
@description: Records every trade link the user opens on this page, but only
links `isListingTradeLink(anchor)` vouches for (each UI's own fixTradeOfferLinks
passes "an anchor it patched itself, inside a real listing row"). Capture
phase, so a page handler that stops propagation can't hide the click.
*/
export function watchTradeLinkClicks(isListingTradeLink) {
  const onEvent = (event) => {
    const anchor = event.target?.closest?.("a[href]");
    if (!anchor || !isListingTradeLink(anchor)) return;

    recordTradeLinkClick(anchor.href).catch((e) => {
      console.warn("[TF2 Trading Enhancer] Failed to record a trade link click:", e);
    });
  };

  for (const type of OPEN_EVENTS) {
    document.addEventListener(type, onEvent, true);
  }
}
