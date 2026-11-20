/*
@description: Background service worker. Relays cross-origin JSON fetches for
content scripts, and polls Steam for pending trade offers (toolbar badge +
alert chime).

Why the fetch relay exists: Firefox blocks a content script from reading a
cross-origin fetch() response even when host_permissions covers the target
(confirmed against api.steampowered.com: the request succeeds with a 200, but
the content script cannot read it). The background worker is exempt, so
utils/tf2Schema.js routes its Steam Web API calls through here. It also works
around steamcommunity.com's strict CSP, which blocks a content script's own
cross-origin fetch() outright (host_permissions bypasses CORS, not the page's
CSP), which is why utils/pricedb.js and utils/repTfInfo.js route their requests
here too.

Loaded as a module (manifest background "type": "module") and its modules
imported statically: on Chrome this file is a service worker, where import()
is not allowed at all (confirmed live: the trade offer check failed with
"import() is disallowed on ServiceWorkerGlobalScope"), and neither is a
top-level await in any imported module.
*/
import {
  ALERT_CUSTOM_SOUND_KEY,
  ALERT_MUTED_KEY,
  ALERT_SOUND_ID_KEY,
  ALERT_VOLUME_KEY,
  resolveAlertSound,
} from "./utils/notificationSound.js";
import { parseRetryAfterMs } from "./utils/retryAfter.js";
import { fetchTradeOfferSummary } from "./utils/steamTradeOffers.js";

/*
@description: Performs the relayed fetch and normalizes success, a plain
failure, and a 429 rate-limit response into a structured-cloneable result,
including a failure thrown synchronously by fetch() itself (e.g. a malformed
URL), so callers always get the real error message.

429 is its own shape (status + retryAfterMs + parsed body) because
utils/pricedb.js needs to tell "slow down, retry after N ms" apart from
every other failure.

method defaults to "GET"; utils/repTfInfo.js's rep.tf lookups are the one
caller that needs POST.
*/
async function fetchJson(url, method = "GET") {
  try {
    const response = await fetch(url, {
      method,
      // Without "omit", a request to a domain the user is logged into (e.g.
      // backpack.tf) would silently authenticate via their session cookie
      // instead of the URL's own key/token param, so the popup's credential
      // checks would "pass" even for a garbage token. Deliberately not
      // configurable per call: Firefox's Total Cookie Protection stops a
      // background script from attaching site cookies anyway.
      credentials: "omit",
      // Confirmed against pricedb.io's /api/search: without "no-store", a
      // repeated identical request triggers an HTTP-cache revalidation whose
      // raw 304 leaks through as response.status === 304 (not resolved to the
      // cached 200 body), which the `!response.ok` branch below then reports
      // as a failure.
      cache: "no-store",
    });

    if (response.status === 429) {
      const retryAfterHeader = response.headers.get("Retry-After");
      // backpack.tf's 429 body reports the per-account limit it is actually
      // enforcing, e.g. { "limits": { "default": 6, "premium": 60 } }, so the
      // body is passed through too. Best-effort: a 429 body is not guaranteed
      // to be JSON, and a parse failure must never mask the 429 itself.
      let data = null;
      try {
        data = await response.json();
      } catch {
        // not JSON (or empty body): data stays null.
      }
      return {
        ok: false,
        status: 429,
        retryAfterMs: parseRetryAfterMs(retryAfterHeader),
        error: "Rate limited (429)",
        data,
      };
    }

    // status is returned separately so utils/fetchJsonRelay.js can retry a
    // transient 5xx (e.g. GetPlayerItems returning a 503) without parsing
    // error text.
    if (!response.ok) return { ok: false, status: response.status, error: `Request failed (${response.status})` };
    return { ok: true, data: await response.json() };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

const RELAY_METHODS = new Set(["GET", "POST"]);

function hostPatternMatches(pattern, url) {
  // Manifest match patterns used here look like "https://host/*" or
  // "https://*.host/*".
  const match = /^https:\/\/(\*\.)?([^/]+)\//.exec(pattern);
  if (!match) return false;
  const [, anySubdomain, host] = match;
  return url.hostname === host || (Boolean(anySubdomain) && url.hostname.endsWith(`.${host}`));
}

/*
@description: Whether the FETCH_JSON relay may fetch `url` with `method`.
Only https URLs on a host the manifest's own host_permissions grants (so this
list can never drift from what the extension is actually allowed to read),
and only GET/POST. Every current caller already uses a fixed host; this
keeps a future bug that passes a page-controlled URL from turning the relay
into a general-purpose fetcher.
*/
function isRelayRequestAllowed(rawUrl, method = "GET") {
  if (!RELAY_METHODS.has(String(method).toUpperCase())) return false;

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;

  const patterns = chrome.runtime.getManifest().host_permissions || [];
  return patterns.some((pattern) => hostPatternMatches(pattern, url));
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "FETCH_JSON") {
    if (!isRelayRequestAllowed(message.url, message.method)) {
      // A new feature calling a new site needs that host in manifest.json's
      // host_permissions; this warning is what says so.
      console.warn(
        `[TF2 Trading Enhancer] Fetch relay refused ${message.method || "GET"} ${message.url}: host not in manifest host_permissions.`
      );
      sendResponse({ ok: false, error: "Host not allowed by the fetch relay" });
      return;
    }

    fetchJson(message.url, message.method).then(sendResponse);
    return true; // keep the message channel open for the async sendResponse
  }

  if (message?.type === "OPEN_STEAM_API_KEY_SETTINGS") {
    // From a "needs a Steam Web API key" link button (utils/linkButtonStates.js):
    // the settings page, whose #steam-key hash shows why it opened and focuses
    // the key field (settings/apiKeySettings.js).
    chrome.tabs.create({ url: chrome.runtime.getURL("options/options.html#steam-key") });
  }

  if (message?.type === "REFRESH_TRADEOFFER_BADGE") {
    // Two callers: steamcommunity.com/tradeOfferActions/content.js right after
    // an offer was acted on (no maxAgeMs, always re-polls), and the popup on
    // open (maxAgeMs, so reopening it repeatedly can't hammer Steam). Answers
    // once the badge is up to date, so the popup can re-read it.
    refreshTradeOffersIfOlderThan(message.maxAgeMs).then(() => sendResponse({ ok: true }));
    return true; // keep the message channel open for the async sendResponse
  }

});

const OFFSCREEN_DOCUMENT_URL = "offscreen/offscreen.html";
// pollTradeOffers can run twice close together (alarm tick plus a
// REFRESH_TRADEOFFER_BADGE message), and chrome.offscreen allows only one
// document, so a second createDocument() while the first is in flight
// throws. Sharing the in-flight promise makes the second caller wait instead.
let ensureOffscreenDocumentPromise = null;
async function ensureOffscreenDocument() {
  if (await chrome.offscreen.hasDocument()) return;

  if (!ensureOffscreenDocumentPromise) {
    ensureOffscreenDocumentPromise = chrome.offscreen
      .createDocument({
        url: chrome.runtime.getURL(OFFSCREEN_DOCUMENT_URL),
        reasons: ["AUDIO_PLAYBACK"],
        justification: "Plays a short chime when a new trade offer is received.",
      })
      .finally(() => {
        ensureOffscreenDocumentPromise = null;
      });
  }

  return ensureOffscreenDocumentPromise;
}

/*
@description: Plays the "new trade offer" chime. A real audio cue rather than
a chrome.notifications system notification, because many users mute the
browser's own notification sound.

Chrome's MV3 service worker has no Audio/DOM access, so it plays through an
offscreen document (offscreen/offscreen.js), kept open once created. Firefox
runs this file as an event page with DOM access and has no chrome.offscreen,
which is what the feature-detect below branches on.

The sound, volume and mute come from the popup's "Trade offer sound"
settings. The offscreen document can't read chrome.storage, so the resolved
sound and volume travel in the message.
*/
async function playTradeOfferAlertSound() {
  try {
    const stored = await chrome.storage.local.get([ALERT_MUTED_KEY, ALERT_VOLUME_KEY, ALERT_SOUND_ID_KEY, ALERT_CUSTOM_SOUND_KEY]);
    const sound = resolveAlertSound(stored, chrome.runtime.getURL);
    if (!sound) return;

    if (chrome.offscreen) {
      await ensureOffscreenDocument();
      await chrome.runtime.sendMessage({ type: "PLAY_TRADEOFFER_ALERT_SOUND", src: sound.src, volume: sound.volume });
    } else {
      const audio = new Audio(sound.src);
      audio.volume = sound.volume;
      await audio.play();
    }
  } catch (e) {
    console.warn("[TF2 Trading Enhancer] Failed to play trade offer alert sound:", e);
  }
}

const TRADEOFFER_POLL_ALARM = "tradeoffer-poll";
const TRADEOFFER_BADGE_COLOR = "#c0392b"; // matches Steam's own red notification-count badge
// Persisted so the "is this a new offer" comparison survives the service
// worker being unloaded between ticks, and so the first poll after install
// never chimes for offers that were already pending (see pollTradeOffers).
const LAST_TRADEOFFER_COUNT_KEY = "lastKnownPendingTradeOfferCount";

// When the last poll finished, and the poll in flight (if any). In memory
// only: after the background is unloaded the next request simply polls.
let lastTradeOfferPollAt = 0;
let tradeOfferPollInFlight = null;

/*
@description: Runs pollTradeOffers unless one finished within the last
maxAgeMs. With maxAgeMs a poll already in flight is shared instead of starting
a second Steam request. Without it (just after an offer was acted on) a poll
in flight may predate that action, so it is awaited and then polled again.
*/
async function refreshTradeOffersIfOlderThan(maxAgeMs) {
  if (typeof maxAgeMs !== "number") {
    if (tradeOfferPollInFlight) await tradeOfferPollInFlight;
    return pollTradeOffers();
  }
  if (tradeOfferPollInFlight) return tradeOfferPollInFlight;
  const ageMs = Date.now() - lastTradeOfferPollAt;
  if (ageMs < maxAgeMs) {
    console.debug(`[TF2 Trading Enhancer] Trade offer check skipped: the last one was ${Math.round(ageMs / 1000)}s ago.`);
    return;
  }
  return pollTradeOffers();
}

// Every poll goes through here, so at most one Steam request runs at a time.
async function pollTradeOffers() {
  if (tradeOfferPollInFlight) return tradeOfferPollInFlight;
  tradeOfferPollInFlight = pollTradeOffersOnce().finally(() => {
    lastTradeOfferPollAt = Date.now();
    tradeOfferPollInFlight = null;
  });
  return tradeOfferPollInFlight;
}

/*
@description: Updates the toolbar badge with the pending received trade offer
count, and plays the alert chime only when that count increases since the
last poll (not on every tick while an old offer sits unanswered). Reads
steamApiKey fresh each tick, so saving/clearing it in the popup takes effect
on the next poll; with no key, the badge is cleared instead.
*/
async function pollTradeOffersOnce() {
  const { steamApiKey } = await chrome.storage.local.get(["steamApiKey"]);
  if (!steamApiKey) {
    await chrome.action.setBadgeText({ text: "" });
    return;
  }

  try {
    const summary = await fetchTradeOfferSummary(steamApiKey);
    const count = summary?.pending_received_count || 0;
    console.debug(`[TF2 Trading Enhancer] Trade offer check: ${count} pending.`);

    await chrome.action.setBadgeText({ text: count > 0 ? String(count) : "" });
    await chrome.action.setBadgeBackgroundColor({ color: TRADEOFFER_BADGE_COLOR });

    const { [LAST_TRADEOFFER_COUNT_KEY]: lastCount } = await chrome.storage.local.get([LAST_TRADEOFFER_COUNT_KEY]);
    // typeof check, not falsy: 0 is a real "nothing pending" baseline, unlike
    // undefined (never polled before).
    if (typeof lastCount === "number" && count > lastCount) {
      playTradeOfferAlertSound();
    }
    await chrome.storage.local.set({ [LAST_TRADEOFFER_COUNT_KEY]: count });
  } catch (e) {
    console.warn("[TF2 Trading Enhancer] Trade offer poll failed:", e);
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === TRADEOFFER_POLL_ALARM) {
    pollTradeOffers();
  }
});

/*
@description: Creates a repeating alarm unless one with the same name and
period already exists. chrome.alarms.create() cancels and replaces an
existing alarm of the same name, and this top-level code runs on every
service-worker wake (not just on install), so creating unconditionally would
restart the countdown on every wake and could keep pushing the alarm back
indefinitely.
*/
async function ensureRepeatingAlarm(name, periodInMinutes) {
  const existing = await chrome.alarms.get(name);
  if (existing?.periodInMinutes === periodInMinutes) return;
  chrome.alarms.create(name, { periodInMinutes });
}

// 2 minutes feels timely for "you have a new trade offer" without leaning on
// Steam's per-key rate limit.
ensureRepeatingAlarm(TRADEOFFER_POLL_ALARM, 2);
pollTradeOffers(); // don't make the badge wait a full interval after a fresh install/reload
