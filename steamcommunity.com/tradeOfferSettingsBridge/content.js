/*
@description: Feeds steamcommunity.com/tradeOffer/pages/tradeoffer.js (world:
"MAIN") the extension state it needs but can't read itself (a MAIN-world
script has no chrome.storage of its own). Each goes over a one-way document
CustomEvent (a plain object doesn't cross between the two worlds, an event
does):

- the popup's "Auto-add listing price" toggle, which gates tradeoffer.js's
  automatic currency pre-fill on a listing link;
- every schema-classified craft-weapon name, for getItemsForMetal's own
  craft-weapon fallback (used by Add Metal, addListingPrice and "Add by key
  value");
- whether this page's URL is a listing link the user opened on backpack.tf
  (utils/tradeLinkTrust.js), which tradeoffer.js requires before it pre-fills
  anything from the URL.

All of these are free features, so this runs for every user.
*/
import { getCraftWeaponNames } from "../../utils/tf2Schema.js";
import { TRADE_LINK_CLICKS_STORAGE_KEY, isRecentlyClickedTradeLink } from "../../utils/tradeLinkTrust.js";

const CRAFT_WEAPON_NAMES_BROADCAST_EVENT = "tf2te-craft-weapon-names-broadcast";
const AUTO_ADD_LISTING_CURRENCY_SETTING_KEY = "autoAddListingCurrencyEnabled";
const AUTO_ADD_LISTING_CURRENCY_BROADCAST_EVENT = "tf2te-auto-add-listing-currency-setting-broadcast";
const LISTING_LINK_TRUST_BROADCAST_EVENT = "tf2te-listing-link-trust-broadcast";

/*
@description: tradeoffer.js only builds #controls after its own setup runs,
not synchronously at document_end - waits for it via MutationObserver instead
of assuming it's already there.
*/
function waitForControls(callback) {
  const existing = document.getElementById("controls");

  if (existing) {
    callback(existing);
    return;
  }

  const observer = new MutationObserver(() => {
    const controlsEl = document.getElementById("controls");

    if (controlsEl) {
      observer.disconnect();
      callback(controlsEl);
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

/*
@description: Broadcasts every schema-classified craft-weapon name to
tradeoffer.js. A broadcast, not a request/response, since MAIN world needs
this available SYNCHRONOUSLY whenever addMetal runs (a plain button click,
among other callers). Harmless to call more than once - tradeoffer.js's own
listener just overwrites its cached value each time.
*/
async function broadcastCraftWeaponNames() {
  const names = await getCraftWeaponNames();

  document.dispatchEvent(
    new CustomEvent(CRAFT_WEAPON_NAMES_BROADCAST_EVENT, {
      detail: JSON.stringify({ names }),
    })
  );
}

/*
@description: Broadcasts the "Auto-add listing price on trade offer open"
setting (see settings/generalSettings.js). Unset (never saved yet) reads as
enabled, so auto-adding is on by default until the user turns it off.
*/
async function broadcastAutoAddListingCurrencySetting() {
  const stored = await chrome.storage.local.get([AUTO_ADD_LISTING_CURRENCY_SETTING_KEY]);
  const enabled = stored[AUTO_ADD_LISTING_CURRENCY_SETTING_KEY] !== false;

  document.dispatchEvent(
    new CustomEvent(AUTO_ADD_LISTING_CURRENCY_BROADCAST_EVENT, {
      detail: JSON.stringify({ enabled }),
    })
  );
}

/*
@description: Tells tradeoffer.js that this page's URL matches a listing link
the user opened on backpack.tf. Sent only when it does: tradeoffer.js treats
"never told" as untrusted, so an untrusted page needs no message at all.
*/
async function broadcastListingLinkTrust() {
  if (!(await isRecentlyClickedTradeLink(window.location.href))) return;

  document.dispatchEvent(
    new CustomEvent(LISTING_LINK_TRUST_BROADCAST_EVENT, {
      detail: JSON.stringify({ trusted: true }),
    })
  );
}

function broadcastAll() {
  broadcastCraftWeaponNames();
  broadcastAutoAddListingCurrencySetting();
  broadcastListingLinkTrust();
}

/*
@description: Broadcasts all three right away, again once #controls exists,
and again whenever one's source changes in chrome.storage. The second broadcast
is a safety net: two independently-injected content scripts (ISOLATED here,
MAIN there) have no guaranteed relative ordering, so the first one can fire
before tradeoffer.js's own listeners are registered - and a missed one-shot
broadcast would otherwise leave tradeoffer.js on its defaults for the rest of
the page's lifetime. #controls existing means tradeoffer.js has progressed
past registering them.
*/
export function tradeOfferSettingsBridge() {
  broadcastAll();

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (changes.steamApiKey) broadcastCraftWeaponNames();
    if (changes[AUTO_ADD_LISTING_CURRENCY_SETTING_KEY]) broadcastAutoAddListingCurrencySetting();
    // The click record is written as the link is opened, so on a fast load
    // it can land just after this page's first check.
    if (changes[TRADE_LINK_CLICKS_STORAGE_KEY]) broadcastListingLinkTrust();
  });

  waitForControls(() => broadcastAll());
}
