import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The real manifest, so the fetch relay's host allowlist (read from
// host_permissions) is tested against what actually ships.
const MANIFEST = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));

// background.js exports nothing: it registers its listeners and calls
// chrome.alarms.create()/pollTradeOffers() as top-level side effects the
// moment it's loaded. So - same "fake globalThis.chrome before importing" pattern
// tests/tf2Schema.test.js uses - a fake chrome/fetch is installed first, the
// module is imported once for its side effects, and the listener callbacks
// it registered (captured off the fake addListener calls below) are what
// each test actually drives.
//
// Its static imports load the real modules from utils/ - not re-mocked,
// since those have their own test files. chrome.runtime.getURL resolves to
// the real on-disk files too (the alert sound's URL).
function fakeGetURL(path) {
  return new URL(`../${path}`, import.meta.url).href;
}

function fakeStorageLocal(initial = {}) {
  const store = { ...initial };
  return {
    async get(keys) {
      const result = {};
      for (const k of keys) if (k in store) result[k] = store[k];
      return result;
    },
    async set(obj) {
      Object.assign(store, obj);
    },
    _store: store,
  };
}

const storage = fakeStorageLocal({}); // no steamApiKey yet - safe for the module's own import-time pollTradeOffers() call
const alarmListeners = [];
const alarmCreateCalls = [];
// Alarms that already exist when background.js starts (a worker wake, not a
// fresh install). Empty for the initial import below.
const existingAlarms = new Map();
const messageListeners = [];
const badgeCalls = [];
const sendMessageCalls = [];
const offscreenCalls = { hasDocument: false, createDocument: 0 };

// Routes both background.js's own fetchJson (FETCH_JSON relay) and the real
// utils/steamTradeOffers.js's fetchTradeOfferSummary (dynamically imported
// by background.js) through one fake, since both go through globalThis.fetch.
let nextSummaryCount = 0;
let summaryShouldFail = false;
let fetchOverride = null;

globalThis.fetch = async (url, options) => {
  if (fetchOverride) return fetchOverride(url, options);

  const u = String(url);
  if (u.includes("GetTradeOffersSummary")) {
    if (summaryShouldFail) return { ok: false, status: 500, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ response: { pending_received_count: nextSummaryCount } }) };
  }

  return { ok: true, status: 200, json: async () => ({}) };
};

globalThis.chrome = {
  runtime: {
    getURL: fakeGetURL,
    getManifest: () => MANIFEST,
    onMessage: { addListener: (cb) => messageListeners.push(cb) },
    sendMessage: async (msg) => {
      sendMessageCalls.push(msg);
    },
  },
  storage: {
    local: storage,
    onChanged: { addListener: () => {} },
  },
  alarms: {
    get: async (name) => existingAlarms.get(name),
    create: (name, opts) => alarmCreateCalls.push({ name, ...opts }),
    onAlarm: { addListener: (cb) => alarmListeners.push(cb) },
  },
  action: {
    setBadgeText: async (opts) => {
      badgeCalls.push({ type: "text", ...opts });
    },
    setBadgeBackgroundColor: async (opts) => {
      badgeCalls.push({ type: "color", ...opts });
    },
  },
  offscreen: {
    hasDocument: async () => offscreenCalls.hasDocument,
    createDocument: async () => {
      offscreenCalls.createDocument++;
      offscreenCalls.hasDocument = true;
    },
  },
};

await import("../background.js");

function lastBadgeText() {
  return [...badgeCalls].reverse().find((c) => c.type === "text")?.text;
}

async function triggerPoll() {
  // background.js's own pollTradeOffers is fire-and-forget from the alarm
  // listener's point of view (no returned promise to await), so give its
  // internal awaits a turn to settle before assertions run.
  alarmListeners[0]({ name: "tradeoffer-poll" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test("background.js registers exactly one alarm listener and one runtime message listener on load", () => {
  assert.equal(alarmListeners.length, 1);
  assert.equal(messageListeners.length, 1);
});

test("background.js creates the 2-minute trade-offer polling alarm", () => {
  assert.deepEqual(alarmCreateCalls, [{ name: "tradeoffer-poll", periodInMinutes: 2 }]);
});

test("FETCH_JSON message relays a successful fetch and resolves via sendResponse", async () => {
  fetchOverride = async () => ({ ok: true, status: 200, json: async () => ({ hello: "world" }) });

  const result = await new Promise((resolve) => {
    const keepChannelOpen = messageListeners[0]({ type: "FETCH_JSON", url: "https://api.steampowered.com/x" }, {}, resolve);
    assert.equal(keepChannelOpen, true);
  });

  assert.deepEqual(result, { ok: true, data: { hello: "world" } });
  fetchOverride = null;
});

test("FETCH_JSON message surfaces a 429 as a structured rate-limit result", async () => {
  fetchOverride = async () => ({
    ok: false,
    status: 429,
    headers: { get: (name) => (name === "Retry-After" ? "5" : null) },
    json: async () => ({}),
  });

  const result = await new Promise((resolve) => {
    messageListeners[0]({ type: "FETCH_JSON", url: "https://api.steampowered.com/x" }, {}, resolve);
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 429);
  assert.equal(result.retryAfterMs, 5000);
  fetchOverride = null;
});

// HTTP's Retry-After header is legal as EITHER a plain integer number of
// delta-seconds OR an HTTP-date string - the old `Number(header) * 1000` only
// handled the first shape, silently producing NaN for the second (which `??
// <default>` in a caller does NOT catch, since `??` only
// replaces null/undefined, not NaN) - NaN then reached setTimeout(fn, NaN),
// which fires essentially immediately instead of actually waiting, hammering
// the still-rate-limited server again right away.
test("FETCH_JSON message parses an HTTP-date Retry-After header (not just delta-seconds) into a positive ms duration", async () => {
  const futureDate = new Date(Date.now() + 8000);
  fetchOverride = async () => ({
    ok: false,
    status: 429,
    headers: { get: (name) => (name === "Retry-After" ? futureDate.toUTCString() : null) },
    json: async () => ({}),
  });

  const result = await new Promise((resolve) => {
    messageListeners[0]({ type: "FETCH_JSON", url: "https://api.steampowered.com/x" }, {}, resolve);
  });

  assert.equal(result.status, 429);
  assert.ok(Number.isFinite(result.retryAfterMs), "retryAfterMs must be a real number, not NaN");
  // Allow a little slack for real time elapsed during the test itself.
  assert.ok(result.retryAfterMs > 6000 && result.retryAfterMs <= 8000, `expected ~8000ms, got ${result.retryAfterMs}`);
  fetchOverride = null;
});

test("FETCH_JSON message falls back to null (never NaN) for a Retry-After header in neither recognized shape", async () => {
  fetchOverride = async () => ({
    ok: false,
    status: 429,
    headers: { get: (name) => (name === "Retry-After" ? "not a real value" : null) },
    json: async () => ({}),
  });

  const result = await new Promise((resolve) => {
    messageListeners[0]({ type: "FETCH_JSON", url: "https://api.steampowered.com/x" }, {}, resolve);
  });

  assert.equal(result.status, 429);
  assert.equal(result.retryAfterMs, null);
  fetchOverride = null;
});

test("FETCH_JSON message reports retryAfterMs: null (not NaN) when the Retry-After header is absent entirely", async () => {
  fetchOverride = async () => ({
    ok: false,
    status: 429,
    headers: { get: () => null },
    json: async () => ({}),
  });

  const result = await new Promise((resolve) => {
    messageListeners[0]({ type: "FETCH_JSON", url: "https://api.steampowered.com/x" }, {}, resolve);
  });

  assert.equal(result.retryAfterMs, null);
  fetchOverride = null;
});

// A 429's own body is what actually reports the real per-account limit
// backpack.tf is enforcing (e.g. { limits: { default: 6, premium: 60 } }) -
// previously discarded entirely (only the Retry-After header was read), so a
// caller getting rate-limited well short of the expected count had no way to
// see whether the SERVER itself thought this account was on the free or
// premium tier.
test("FETCH_JSON message also reads the 429 response body, not just the Retry-After header", async () => {
  fetchOverride = async () => ({
    ok: false,
    status: 429,
    headers: { get: () => null },
    json: async () => ({ limits: { default: 6, premium: 60 } }),
  });

  const result = await new Promise((resolve) => {
    messageListeners[0]({ type: "FETCH_JSON", url: "https://api.steampowered.com/x" }, {}, resolve);
  });

  assert.deepEqual(result.data, { limits: { default: 6, premium: 60 } });
  fetchOverride = null;
});

test("FETCH_JSON message's 429 handling survives a non-JSON body instead of throwing", async () => {
  fetchOverride = async () => ({
    ok: false,
    status: 429,
    headers: { get: (name) => (name === "Retry-After" ? "5" : null) },
    json: async () => {
      throw new SyntaxError("Unexpected end of input");
    },
  });

  const result = await new Promise((resolve) => {
    messageListeners[0]({ type: "FETCH_JSON", url: "https://api.steampowered.com/x" }, {}, resolve);
  });

  assert.equal(result.status, 429);
  assert.equal(result.retryAfterMs, 5000);
  assert.equal(result.data, null);
  fetchOverride = null;
});

test("FETCH_JSON message returns a plain error result for a non-ok, non-429 response", async () => {
  fetchOverride = async () => ({ ok: false, status: 503, json: async () => ({}) });

  const result = await new Promise((resolve) => {
    messageListeners[0]({ type: "FETCH_JSON", url: "https://api.steampowered.com/x" }, {}, resolve);
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /503/);
  // status is included alongside the message (not just folded into the error
  // text) - see utils/fetchJsonRelay.js's own retry-on-5xx logic, which reads
  // this field directly rather than parsing the error string.
  assert.equal(result.status, 503);
  fetchOverride = null;
});

// --- FETCH_JSON host allowlist (manifest host_permissions) ---

function relay(message) {
  return new Promise((resolve) => {
    const keepOpen = messageListeners[0]({ type: "FETCH_JSON", ...message }, {}, resolve);
    if (keepOpen !== true) return; // refused synchronously, resolve already called
  });
}

test("FETCH_JSON relays to every host the extension's own callers use", async () => {
  const fetched = [];
  fetchOverride = async (url) => {
    fetched.push(String(url));
    return { ok: true, status: 200, json: async () => ({}) };
  };

  const urls = [
    "https://backpack.tf/api/IGetPrices/v4?key=k",
    "https://api.steampowered.com/IEconItems_440/GetSchemaItems/v1/?key=k",
    "https://pricedb.io/api/search?q=x",
  ];
  for (const url of urls) assert.equal((await relay({ url })).ok, true, url);
  assert.equal((await relay({ url: "https://rep.tf/api/bans", method: "POST" })).ok, true);

  assert.equal(fetched.length, urls.length + 1);
  fetchOverride = null;
});

test("FETCH_JSON refuses hosts outside host_permissions, look-alike hosts, plain http and odd methods, without fetching", async () => {
  const fetched = [];
  fetchOverride = async (url) => {
    fetched.push(String(url));
    return { ok: true, status: 200, json: async () => ({}) };
  };

  const refused = [
    { url: "https://evil.example/steal" },
    { url: "https://backpack.tf.evil.example/x" },
    { url: "https://evilbackpack.tf/x" },
    { url: "https://next.backpack.tf/api/x" }, // a subdomain host_permissions doesn't grant
    { url: "https://api.backpack.tf/x" }, // not used by this edition, so not in host_permissions
    { url: "http://api.steampowered.com/x" },
    { url: "not a url" },
    { url: "https://api.steampowered.com/x", method: "DELETE" },
  ];
  for (const message of refused) {
    const result = await relay(message);
    assert.equal(result.ok, false, JSON.stringify(message));
    assert.match(result.error, /not allowed/);
  }

  assert.deepEqual(fetched, []);
  fetchOverride = null;
});

test("pollTradeOffers clears the badge and skips fetching when no steamApiKey is configured", async () => {
  delete storage._store.steamApiKey;
  badgeCalls.length = 0;

  await triggerPoll();

  assert.equal(lastBadgeText(), "");
});

test("pollTradeOffers sets the badge but does not play the alert sound on the first-ever tick", async () => {
  storage._store.steamApiKey = "KEY1";
  delete storage._store.lastKnownPendingTradeOfferCount;
  nextSummaryCount = 3;
  sendMessageCalls.length = 0;
  badgeCalls.length = 0;

  await triggerPoll();

  assert.equal(lastBadgeText(), "3");
  assert.equal(storage._store.lastKnownPendingTradeOfferCount, 3);
  // No prior baseline (typeof lastCount !== "number") - must not alert yet.
  assert.equal(sendMessageCalls.some((m) => m.type === "PLAY_TRADEOFFER_ALERT_SOUND"), false);
});

test("pollTradeOffers plays the alert sound (via the offscreen document) when the pending count increases", async () => {
  nextSummaryCount = 5; // up from 3
  sendMessageCalls.length = 0;
  offscreenCalls.createDocument = 0;
  offscreenCalls.hasDocument = false;

  await triggerPoll();

  assert.equal(lastBadgeText(), "5");
  assert.equal(offscreenCalls.createDocument, 1);
  // Nothing saved: the bundled chime at the default 22% (0.22 squared).
  const playMessage = sendMessageCalls.find((m) => m.type === "PLAY_TRADEOFFER_ALERT_SOUND");
  assert.match(playMessage.src, /public\/sounds\/level-up\.ogg$/);
  assert.equal(playMessage.volume, 0.22 ** 2);
});

test("pollTradeOffers does not replay the alert when the count stays the same on the next tick", async () => {
  // count stays at 5
  sendMessageCalls.length = 0;

  await triggerPoll();

  assert.equal(lastBadgeText(), "5");
  assert.equal(sendMessageCalls.some((m) => m.type === "PLAY_TRADEOFFER_ALERT_SOUND"), false);
});

test("pollTradeOffers clears the badge (empty text) when the count drops back to zero, without alerting", async () => {
  nextSummaryCount = 0;
  sendMessageCalls.length = 0;

  await triggerPoll();

  assert.equal(lastBadgeText(), "");
  assert.equal(sendMessageCalls.some((m) => m.type === "PLAY_TRADEOFFER_ALERT_SOUND"), false);
});

test("pollTradeOffers respects tradeOfferAlertMuted and skips the alert even when the count increases", async () => {
  storage._store.tradeOfferAlertMuted = true;
  nextSummaryCount = 9; // up from 0
  sendMessageCalls.length = 0;

  await triggerPoll();

  assert.equal(lastBadgeText(), "9");
  assert.equal(sendMessageCalls.some((m) => m.type === "PLAY_TRADEOFFER_ALERT_SOUND"), false);

  delete storage._store.tradeOfferAlertMuted;
});

test("pollTradeOffers leaves the badge untouched when the Steam fetch fails", async () => {
  nextSummaryCount = 20;
  summaryShouldFail = true;
  badgeCalls.length = 0;

  await triggerPoll();

  assert.equal(badgeCalls.length, 0);
  summaryShouldFail = false;
});

test("OPEN_STEAM_API_KEY_SETTINGS opens the popup page at the Steam key section in a new tab", () => {
  const created = [];
  const realTabs = globalThis.chrome.tabs;
  globalThis.chrome.tabs = { create: (opts) => created.push(opts) };
  try {
    const keepChannelOpen = messageListeners[0]({ type: "OPEN_STEAM_API_KEY_SETTINGS" }, {}, () => {});
    assert.notEqual(keepChannelOpen, true);
    assert.equal(created.length, 1);
    assert.equal(created[0].url, fakeGetURL("options/options.html#steam-key"));
  } finally {
    globalThis.chrome.tabs = realTabs;
  }
});

// --- REFRESH_TRADEOFFER_BADGE (after acting on an offer, and on popup open) ---

function sendRefresh(extra = {}) {
  let keepOpen;
  const response = new Promise((resolve) => {
    keepOpen = messageListeners[0]({ type: "REFRESH_TRADEOFFER_BADGE", ...extra }, {}, resolve);
  });
  return { keepOpen, response };
}

// Counts real GetTradeOffersSummary requests; `count` is what Steam reports.
function countSummaryFetches(count) {
  const counter = { n: 0 };
  fetchOverride = async (url) => {
    if (String(url).includes("GetTradeOffersSummary")) {
      counter.n++;
      return { ok: true, status: 200, json: async () => ({ response: { pending_received_count: count } }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };
  return counter;
}

test("REFRESH_TRADEOFFER_BADGE without maxAgeMs always polls and answers once the badge is updated", async () => {
  storage._store.steamApiKey = "KEY";
  const fetches = countSummaryFetches(42);

  const { keepOpen, response } = sendRefresh();
  assert.equal(keepOpen, true);
  assert.deepEqual(await response, { ok: true });

  assert.equal(fetches.n, 1);
  assert.equal(lastBadgeText(), "42");
  fetchOverride = null;
});

test("REFRESH_TRADEOFFER_BADGE with maxAgeMs skips Steam when the last poll is recent enough", async () => {
  storage._store.steamApiKey = "KEY";
  await sendRefresh().response; // a poll that just finished

  const fetches = countSummaryFetches(7);
  assert.deepEqual(await sendRefresh({ maxAgeMs: 60_000 }).response, { ok: true });
  assert.equal(fetches.n, 0, "a poll younger than maxAgeMs is reused");

  assert.deepEqual(await sendRefresh({ maxAgeMs: 0 }).response, { ok: true });
  assert.equal(fetches.n, 1, "an older poll triggers a fresh one");
  assert.equal(lastBadgeText(), "7");
  fetchOverride = null;
});

test("simultaneous popup refreshes share one Steam request", async () => {
  storage._store.steamApiKey = "KEY";
  const fetches = countSummaryFetches(3);

  await Promise.all([sendRefresh({ maxAgeMs: 0 }).response, sendRefresh({ maxAgeMs: 0 }).response]);

  assert.equal(fetches.n, 1);
  fetchOverride = null;
});

test("a forced refresh arriving during a poll waits for it, then polls again (the running one may predate the action)", async () => {
  storage._store.steamApiKey = "KEY";
  const fetches = countSummaryFetches(1);

  const first = sendRefresh({ maxAgeMs: 0 }).response;
  const forced = sendRefresh().response;
  await Promise.all([first, forced]);

  assert.equal(fetches.n, 2);
  fetchOverride = null;
});

test("pollTradeOffers plays the Firefox fallback Audio path (no chrome.offscreen) instead of messaging an offscreen document", async () => {
  const realOffscreen = globalThis.chrome.offscreen;
  globalThis.chrome.offscreen = undefined;

  const audioCalls = [];
  class FakeAudio {
    constructor(src) {
      this.src = src;
      audioCalls.push(this);
    }
    play() {
      return Promise.resolve();
    }
  }
  globalThis.Audio = FakeAudio;

  storage._store.steamApiKey = "KEY1";
  nextSummaryCount = 99; // up from 42
  sendMessageCalls.length = 0;

  await triggerPoll();

  assert.equal(audioCalls.length, 1);
  assert.match(audioCalls[0].src, /level-up\.ogg$/);
  assert.equal(audioCalls[0].volume, 0.22 ** 2);
  assert.equal(sendMessageCalls.some((m) => m.type === "PLAY_TRADEOFFER_ALERT_SOUND"), false);

  globalThis.chrome.offscreen = realOffscreen;
  delete globalThis.Audio;
});

test("pollTradeOffers sends the saved custom sound and volume to the offscreen document", async () => {
  storage._store.tradeOfferAlertVolume = 50;
  storage._store.tradeOfferAlertCustomSound = { name: "ding.mp3", seconds: 1, bytes: 3, dataUrl: "data:audio/mpeg;base64,AAAA" };
  nextSummaryCount = 120; // up from 99
  sendMessageCalls.length = 0;

  try {
    await triggerPoll();
    const playMessage = sendMessageCalls.find((m) => m.type === "PLAY_TRADEOFFER_ALERT_SOUND");
    assert.equal(playMessage.src, "data:audio/mpeg;base64,AAAA");
    assert.equal(playMessage.volume, 0.25);
  } finally {
    delete storage._store.tradeOfferAlertVolume;
    delete storage._store.tradeOfferAlertCustomSound;
  }
});

test("pollTradeOffers plays the selected bundled sound", async () => {
  storage._store.tradeOfferAlertSoundId = "ding";
  nextSummaryCount = 130; // up from 120
  sendMessageCalls.length = 0;

  try {
    await triggerPoll();
    const playMessage = sendMessageCalls.find((m) => m.type === "PLAY_TRADEOFFER_ALERT_SOUND");
    assert.match(playMessage.src, /public\/sounds\/ding\.ogg$/);
  } finally {
    delete storage._store.tradeOfferAlertSoundId;
  }
});

test("pollTradeOffers swallows an alert-sound failure - the badge still updates and nothing throws out of the alarm listener", async () => {
  const originalWarn = console.warn;
  console.warn = () => {};
  const originalSendMessage = globalThis.chrome.runtime.sendMessage;
  globalThis.chrome.runtime.sendMessage = async (msg) => {
    if (msg.type === "PLAY_TRADEOFFER_ALERT_SOUND") throw new Error("offscreen document gone");
    return originalSendMessage(msg);
  };

  nextSummaryCount = 150; // up from 130 (the previous test's ending count)
  badgeCalls.length = 0;

  try {
    await triggerPoll();
    assert.equal(lastBadgeText(), "150");
  } finally {
    console.warn = originalWarn;
    globalThis.chrome.runtime.sendMessage = originalSendMessage;
  }
});

test("a service-worker wake does not re-create (and so reset) alarms that already exist with the same period", async () => {
  // chrome.alarms.create() replaces an existing alarm of the same name, which
  // restarts its countdown. Simulate a wake by re-running background.js's
  // top-level code with the alarm already registered.
  existingAlarms.set("tradeoffer-poll", { name: "tradeoffer-poll", periodInMinutes: 2 });
  alarmCreateCalls.length = 0;

  await import("../background.js?wake");
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(alarmCreateCalls, []);
});

test("an existing alarm with a stale period is re-created with the current one", async () => {
  existingAlarms.set("tradeoffer-poll", { name: "tradeoffer-poll", periodInMinutes: 5 });
  alarmCreateCalls.length = 0;

  await import("../background.js?stalePeriod");
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(alarmCreateCalls, [{ name: "tradeoffer-poll", periodInMinutes: 2 }]);
});
