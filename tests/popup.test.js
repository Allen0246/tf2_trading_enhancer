import { test } from "node:test";
import assert from "node:assert/strict";

// popup/popup.js is loaded as a classic (non-module) <script src> in
// popup.html (no type="module"), so - unlike this repo's real ES modules - it
// must never gain an `export` statement (that would break it in a real
// browser, which parses it as a classic script). It exposes a small set of
// test-only hooks via globalThis.__popupTestHooks instead (see that file's
// own note on why a plain globalThis assignment is safe there but `export`
// isn't) - renderVersionBadge/initPopup to re-run its setup against a fresh
// fake document/chrome per test, and reset() to clear the one piece of
// module-scope state (settingsDetailsEls) that would otherwise leak between
// runs. This module is therefore imported ONCE below, not via a fresh
// cache-busting dynamic import per test - the fresh-import approach was used
// here previously, but it defeats Node's --experimental-test-coverage
// reporting for this file (node's coverage reporter keeps only the
// last-loaded script instance's coverage per file path, not a merge across
// instances - see utils/tf2Schema.js's own __resetSchemaCacheForTests for the
// full writeup of that bug).

function fakeGetURL(path) {
  return new URL(`../${path}`, import.meta.url).href;
}

class FakeElement {
  constructor(tag = "div") {
    this.tag = tag;
    this.style = {};
    this.dataset = {};
    this.children = [];
    this.hidden = false;
    this.open = false; // <details>'s own open/closed state
    this.disabled = false;
    this.checked = false;
    this.value = "";
    this.className = "";
    this._textContent = "";
    this._innerHTML = "";
    this._listeners = {};
    this.classList = {
      _set: new Set(),
      add: (...names) => names.forEach((n) => this.classList._set.add(n)),
      remove: (...names) => names.forEach((n) => this.classList._set.delete(n)),
      toggle: (n, force) => {
        const shouldHave = force === undefined ? !this.classList._set.has(n) : Boolean(force);
        if (shouldHave) this.classList._set.add(n);
        else this.classList._set.delete(n);
        return shouldHave;
      },
      contains: (n) => this.classList._set.has(n),
    };
  }
  get textContent() {
    return this._textContent;
  }
  set textContent(v) {
    this._textContent = v;
  }
  get innerHTML() {
    return this._innerHTML;
  }
  set innerHTML(v) {
    this._innerHTML = v;
    this.children = []; // matches a real innerHTML="" clearing prior children
  }
  addEventListener(type, cb) {
    (this._listeners[type] ||= []).push(cb);
  }
  dispatchEvent(evt) {
    return Promise.all((this._listeners[evt.type] || []).map((cb) => cb(evt)));
  }
  appendChild(child) {
    this.children.push(child);
    return child;
  }
  // Real anchor elements have this - popup.js's own downloadCsv() (Trade
  // History Export) calls it on a document.createElement("a") to trigger the
  // browser's save dialog. A no-op here (this fake doesn't actually download
  // anything), but it must exist or that call throws.
  click() {}
  setAttribute(name, value) {
    (this.attributes ||= {})[name] = String(value);
  }
}

// All ids popup.js's own document.getElementById calls ever look up -
// pre-populated with a blank FakeElement per id so any given test doesn't
// have to know about every single one, only the ones its own scenario cares
// about; pass `missingIds` to simulate a given element not existing on the
// page at all (several call sites do their own `if (!el) return` guard for
// exactly that).
const ALL_IDS = [
  "version-badge", "steam-settings-details", "steam-settings-panel",
  "steam-api-key", "steam-key-missing-dot", "steam-key-intro", "steam-key-intro-heading", "steam-key-intro-text",
  "settings-save", "settings-status",
  "steam-check-btn", "steam-key-status",
  "steam-schema-status", "mute-tradeoffer-alert", "auto-add-listing-currency", "sheen-killstreaker-filter", "general-settings-details",
  "general-settings-panel", "tradeoffer-badge", "scripts-list", "status-badge", "app",
  "calculator-details", "calculator-panel", "calc-key-price-ref", "calc-key-price-ref-dec", "calc-key-price-ref-inc",
  "calc-currency", "calc-key-price-currency", "calc-key-price-currency-dec", "calc-key-price-currency-inc",
  "calc-owned-key", "calc-owned-ref", "calc-owned-rec", "calc-owned-scrap",
  "calc-include-key", "calc-include-ref", "calc-include-rec", "calc-include-scrap",
  "calc-result-key", "calc-result-ref", "calc-result-rec", "calc-result-scrap",
  "calc-total-keys", "calc-total-currency",
  "calc-mul-a", "calc-mul-b", "calc-mul-result", "calc-div-a", "calc-div-b", "calc-div-result",
  "calc-add-a", "calc-add-b", "calc-add-result", "calc-sub-a", "calc-sub-b", "calc-sub-result",
  "alert-sound", "alert-sound-play", "alert-sound-volume", "alert-sound-volume-value", "alert-sound-select",
  "alert-sound-choose", "alert-sound-remove", "alert-sound-file", "alert-sound-status",
  "alert-sound-key-warning", "alert-sound-key-add",
  "open-settings",
];

function makeDom({ missingIds = [], storage = {}, manifestVersion = "1.2.3" } = {}) {
  const byId = new Map();
  for (const id of ALL_IDS) {
    if (!missingIds.includes(id)) byId.set(id, new FakeElement());
  }
  // Both settings <details> default to closed (FakeElement's own .open
  // default, see its constructor) - matches popup.html's real markup, which
  // carries no `open` attribute on either by default.

  global.document = {
    getElementById: (id) => byId.get(id) || null,
    createElement: (tag) => new FakeElement(tag),
    // popup.js's own DOMContentLoaded registration only ever runs once, at
    // this module's single import below - every test instead re-invokes its
    // setup directly via globalThis.__popupTestHooks, so there's nothing for
    // this fake to actually track.
    addEventListener: () => {},
  };

  const store = { ...storage };
  const storageChangedListeners = [];
  global.chrome = {
    runtime: {
      getManifest: () => ({ version: manifestVersion }),
      getURL: fakeGetURL,
      sendMessage: async () => ({ ok: false, error: "no live fetch expected unless overridden per test" }),
      optionsPageOpened: 0,
      async openOptionsPage() {
        global.chrome.runtime.optionsPageOpened++;
      },
    },
    storage: {
      local: {
        async get(keys) {
          const result = {};
          for (const k of keys) if (k in store) result[k] = store[k];
          return result;
        },
        async set(obj) {
          // Fires storageChangedListeners itself now (real chrome.storage.
          // local.set() does the same, dispatching a real onChanged event) -
          // needed so a test driving the REAL Save button click (see
          // "saving a Steam Web API key...") exercises the actual end-to-end
          // path rather than requiring a manual storageChangedListeners[0]
          // call to simulate what set() should already do on its own.
          const changes = {};
          for (const key of Object.keys(obj)) {
            changes[key] = { oldValue: store[key], newValue: obj[key] };
          }
          Object.assign(store, obj);
          for (const listener of storageChangedListeners) {
            await listener(changes, "local");
          }
        },
        async remove(keys) {
          const changes = {};
          for (const key of [].concat(keys)) {
            if (!(key in store)) continue;
            changes[key] = { oldValue: store[key] };
            delete store[key];
          }
          for (const listener of storageChangedListeners) {
            await listener(changes, "local");
          }
        },
      },
      // The settings sections' storage listeners (settings/*.js) - captured
      // so a test can EITHER let a real set() call above trigger them naturally,
      // or simulate background.js writing a key directly via
      // storageChangedListeners[0](changes, "local") without going through
      // set() at all (e.g. background.js, not this popup, made the write).
      onChanged: {
        addListener: (fn) => storageChangedListeners.push(fn),
      },
    },
    tabs: {
      created: [],
      async create(options) {
        global.chrome.tabs.created.push(options);
      },
      query: async () => [{ id: 1 }],
      sendMessage: async () => ({ site: "example.com", scripts: ["Some Feature"], settled: true }),
    },
    action: {
      getBadgeText: async () => "",
    },
  };

  return { byId, store, storageChangedListeners };
}

// setActive builds a <details id="scripts-details"> whose children are
// [summary, ...one .script-item per active script] - see popup.js's own note
// on why the list is collapsed behind a disclosure instead of a flat list.
function scriptDetailsEl(dom) {
  return dom.byId.get("scripts-list").children[0];
}

function scriptItemCount(dom) {
  return scriptDetailsEl(dom).children.length - 1;
}

async function waitUntil(conditionFn, { timeoutMs = 2000, intervalMs = 5 } = {}) {
  const start = Date.now();
  while (!conditionFn()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitUntil: condition never became true");
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

// Installs a placeholder document/chrome so popup.js's own top-level
// renderVersionBadge() call (see that file's own note - it runs
// synchronously at parse time, same as any classic <script>) has something
// to read on this ONE-TIME import. Every test below installs its own
// document/chrome via makeDom() and re-invokes renderVersionBadge/initPopup
// itself through globalThis.__popupTestHooks, so the values used here don't
// matter beyond not throwing.
makeDom();
await import("../popup/popup.js");


// Timers a test leaves running (the calculator's 200 ms debounced save, the
// 2 s "Saved" reset) would fire during a later test and write through that
// test's chrome fake, changing its storage mid-test. Each test cancels the
// previous one's. Only these app-level delays are tracked: 0-5 ms waits
// (flushes, polling) are left alone.
const realSetTimeoutForIsolation = globalThis.setTimeout;
const leftoverTimers = new Set();
globalThis.setTimeout = (fn, delay, ...args) => {
  if (!(delay >= 100)) return realSetTimeoutForIsolation(fn, delay, ...args);
  const id = realSetTimeoutForIsolation(() => {
    leftoverTimers.delete(id);
    fn(...args);
  }, delay);
  leftoverTimers.add(id);
  return id;
};

test.beforeEach(() => {
  leftoverTimers.forEach((id) => clearTimeout(id));
  leftoverTimers.clear();
  globalThis.__popupTestHooks.reset();
});

async function loadPopup(dom) {
  globalThis.__popupTestHooks.renderVersionBadge();
  // popup.js's own initPopup is what does essentially everything else.
  await globalThis.__popupTestHooks.initPopup();
  // renderSteamSchemaStatus is deliberately fire-and-forget from initSettings'
  // own point of view (not awaited) - its own dynamic import(utils/tf2Schema.js)
  // is real disk I/O, so it can still be in flight after the handler above
  // has otherwise resolved. Wait for the status element to actually get some
  // text before a test inspects it, rather than assuming it's already there.
  const schemaStatusEl = dom.byId.get("steam-schema-status");
  if (schemaStatusEl) {
    await waitUntil(() => schemaStatusEl.textContent !== "");
  }
  return dom;
}

// --- version badge (top-level IIFE, runs at import time, no DOMContentLoaded needed) ---

test("shows the extension's own manifest version in the version badge", () => {
  const dom = makeDom({ manifestVersion: "9.9.9" });
  globalThis.__popupTestHooks.renderVersionBadge();
  assert.equal(dom.byId.get("version-badge").textContent, "v9.9.9");
});

test("does not throw when the version badge element is missing from the page", () => {
  makeDom({ missingIds: ["version-badge"] });
  assert.doesNotThrow(() => {
    globalThis.__popupTestHooks.renderVersionBadge();
  });
});

// --- Steam Web API key: missing-key dot + #steam-key deep link -----------

test("shows the amber missing-key dot on the Steam Web API heading only while no key is saved", async () => {
  const withoutKey = await loadPopup(makeDom());
  assert.equal(withoutKey.byId.get("steam-key-missing-dot").hidden, false);

  const withKey = await loadPopup(makeDom({ storage: { steamApiKey: "ABC123" } }));
  assert.equal(withKey.byId.get("steam-key-missing-dot").hidden, true);
});

test("saving a Steam Web API key hides the missing-key dot right away", async () => {
  const dom = await loadPopup(makeDom());
  dom.byId.get("steam-api-key").value = "ABC123";
  await dom.byId.get("settings-save").dispatchEvent({ type: "click" });

  assert.equal(dom.byId.get("steam-key-missing-dot").hidden, true);
});

// --- settings page and live sync -------------------------------------------

test("the header cog opens the settings page, without asking for a section", async () => {
  const dom = await loadPopup(makeDom());

  await dom.byId.get("open-settings").dispatchEvent({ type: "click" });

  assert.equal(global.chrome.runtime.optionsPageOpened, 1);
  assert.equal(dom.store.settingsPageFocus, undefined);
});

// Another page (the settings page) writing storage, as chrome.storage would
// report it here.
async function changedElsewhere(dom, values) {
  const changes = Object.fromEntries(Object.entries(values).map(([key, newValue]) => [key, { oldValue: dom.store[key], newValue }]));
  Object.assign(dom.store, values);
  for (const listener of dom.storageChangedListeners) await listener(changes, "local");
}

test("live sync: checkboxes follow a change made on the settings page", async () => {
  const dom = await loadPopup(makeDom());
  const mute = dom.byId.get("mute-tradeoffer-alert");
  const autoAdd = dom.byId.get("auto-add-listing-currency");
  assert.equal(mute.checked, false);
  assert.equal(autoAdd.checked, true);

  await changedElsewhere(dom, { tradeOfferAlertMuted: true, autoAddListingCurrencyEnabled: false });

  assert.equal(mute.checked, true);
  assert.equal(autoAdd.checked, false);
});

test("live sync: a key saved on the settings page fills the popup's field and clears its dot", async () => {
  const dom = await loadPopup(makeDom());

  await changedElsewhere(dom, { steamApiKey: "NEWKEY" });

  assert.equal(dom.byId.get("steam-api-key").value, "NEWKEY");
  assert.equal(dom.byId.get("steam-key-missing-dot").hidden, true);
});

test("live sync: a field with unsaved typing isn't overwritten by a save made elsewhere", async () => {
  const dom = await loadPopup(makeDom({ storage: { steamApiKey: "OLD" } }));
  const input = dom.byId.get("steam-api-key");
  input.value = "TYPING";
  await input.dispatchEvent({ type: "input" });

  await changedElsewhere(dom, { steamApiKey: "OTHER" });

  assert.equal(input.value, "TYPING");
});

test("live sync: the sound picked on the settings page shows up in the popup's dropdown", async () => {
  resetSoundFakes();
  const dom = await loadPopup(makeDom());

  await changedElsewhere(dom, { tradeOfferAlertSoundId: "ding", tradeOfferAlertVolume: 70 });

  assert.equal(dom.byId.get("alert-sound-select").value, "ding");
  assert.equal(dom.byId.get("alert-sound-volume").value, "70");
  assert.equal(dom.byId.get("alert-sound-volume-value").textContent, "70%");
});

// --- settings accordion ---------------------------------------------------
//
// The settings section is a native <details> element (see
// popup.html/popup.css) - a real click's own default action (toggling .open
// and firing "toggle") isn't something this fake DOM can reproduce for free,
// so these tests simulate it the way the browser would: set .open first,
// then dispatch "toggle" - popup.js's own registerSettingsToggle listens for
// that event, not "click", so this is an accurate stand-in for what a real
// summary click does.

test("restores whichever settings section was left open last time, and no others", async () => {
  const dom = await loadPopup(makeDom({ storage: { openSettingsPanel: "steam" } }));
  assert.equal(dom.byId.get("steam-settings-details").open, true);
});

test("does not restore any section when the persisted key doesn't match a known panel", async () => {
  const dom = await loadPopup(makeDom({ storage: { openSettingsPanel: "not-a-real-panel" } }));
  // It stays at its markup default (closed) - restoreOpenSettingsPanel
  // bails out via its own `if (match)` guard without touching .open.
  assert.equal(dom.byId.get("steam-settings-details").open, false);
});

// --- steam schema status ---------------------------------------------------

test("steam schema status shows the fresh-cache item count/age when a schema is cached and not stale", async () => {
  const dom = await loadPopup(
    makeDom({
      storage: {
        steamApiKey: "KEY",
        tf2SchemaCache: { itemNameToDefindex: { a: 1, b: 2 }, fetchedAt: Date.now(), schemaShapeVersion: 4 },
      },
    })
  );
  const statusEl = dom.byId.get("steam-schema-status");
  assert.match(statusEl.textContent, /✓ Item schema loaded \(2 items, today\)/);
  assert.equal(statusEl.dataset.status, "ok");
});

test("steam schema status shows a stale warning once the cache is older than the TTL", async () => {
  const { SCHEMA_CACHE_TTL_MS } = await import("../utils/tf2Schema.js");
  const dom = await loadPopup(
    makeDom({
      storage: {
        steamApiKey: "KEY",
        tf2SchemaCache: { itemNameToDefindex: { a: 1 }, fetchedAt: Date.now() - SCHEMA_CACHE_TTL_MS - 1000 },
      },
    })
  );
  const statusEl = dom.byId.get("steam-schema-status");
  assert.match(statusEl.textContent, /stale, will refresh on next use/);
  assert.equal(statusEl.dataset.status, "warn");
});

test("steam schema status shows a 'will load next time' message when a key is saved but nothing's cached yet", async () => {
  const dom = await loadPopup(makeDom({ storage: { steamApiKey: "KEY" } }));
  const statusEl = dom.byId.get("steam-schema-status");
  assert.match(statusEl.textContent, /Schema will load the next time/);
  assert.equal(statusEl.dataset.status, "warn");
});

test("steam schema status shows a 'no key configured' message with no key and nothing cached", async () => {
  const dom = await loadPopup(makeDom());
  const statusEl = dom.byId.get("steam-schema-status");
  assert.match(statusEl.textContent, /No key configured/);
  assert.equal(statusEl.dataset.status, "off");
});

// --- credential checks ------------------------------------------------------

test("a steam key check that 403s is classified as invalid", async () => {
  const dom = await loadPopup(makeDom());
  dom.byId.get("steam-api-key").value = "BADKEY";
  global.chrome.runtime.sendMessage = async () => ({ ok: false, error: "Request failed (403)" });

  await dom.byId.get("steam-check-btn").dispatchEvent({ type: "click" });

  assert.equal(dom.byId.get("steam-key-status").textContent, "✗ Invalid key (rejected by Steam).");
  assert.equal(dom.byId.get("steam-check-btn").disabled, false);
});

test("a successful steam key check shows the valid message", async () => {
  const dom = await loadPopup(makeDom());
  dom.byId.get("steam-api-key").value = "GOODKEY";
  global.chrome.runtime.sendMessage = async () => ({ ok: true });

  await dom.byId.get("steam-check-btn").dispatchEvent({ type: "click" });

  assert.equal(dom.byId.get("steam-key-status").textContent, "✓ Key is valid.");
});

test("chrome.runtime.sendMessage rejecting (e.g. extension context invalidated) is surfaced as a generic check-failed message, not thrown", async () => {
  const dom = await loadPopup(makeDom());
  dom.byId.get("steam-api-key").value = "AKEY";
  global.chrome.runtime.sendMessage = async () => {
    throw new Error("Extension context invalidated.");
  };

  await dom.byId.get("steam-check-btn").dispatchEvent({ type: "click" });

  assert.equal(dom.byId.get("steam-key-status").textContent, "✗ Check failed: Extension context invalidated.");
});

test("a NetworkError with no HTTP status (Firefox host_permissions not granted) gets the Firefox permissions hint appended", async () => {
  const dom = await loadPopup(makeDom());
  dom.byId.get("steam-api-key").value = "AKEY";
  global.chrome.runtime.sendMessage = async () => ({ ok: false, error: "NetworkError when attempting to fetch resource." });

  await dom.byId.get("steam-check-btn").dispatchEvent({ type: "click" });

  const text = dom.byId.get("steam-key-status").textContent;
  assert.match(text, /^✗ Check failed: NetworkError when attempting to fetch resource\./);
  assert.match(text, /about:addons/);
  assert.match(text, /Permissions/);
});

test("a plain HTTP failure (has a status code) does NOT get the Firefox permissions hint, even with an unrelated message", async () => {
  const dom = await loadPopup(makeDom());
  dom.byId.get("steam-api-key").value = "AKEY";
  global.chrome.runtime.sendMessage = async () => ({ ok: false, error: "Request failed (500)" });

  await dom.byId.get("steam-check-btn").dispatchEvent({ type: "click" });

  assert.equal(dom.byId.get("steam-key-status").textContent, "✗ Check failed: Request failed (500)");
});

// --- mute checkbox -----------------------------------------------------

test("mute checkbox reflects the saved mute state and persists a change", async () => {
  const dom = await loadPopup(makeDom({ storage: { tradeOfferAlertMuted: true } }));
  const muteInput = dom.byId.get("mute-tradeoffer-alert");
  assert.equal(muteInput.checked, true);

  muteInput.checked = false;
  await muteInput.dispatchEvent({ type: "change" });
  assert.equal(dom.store.tradeOfferAlertMuted, false);
});

test("does not throw when the mute checkbox element is missing from the page", async () => {
  await assert.doesNotReject(async () => {
    await loadPopup(makeDom({ missingIds: ["mute-tradeoffer-alert"] }));
  });
});

// --- trade offer sound (choice, volume, preview, custom file) -------------

// Stands in for HTMLAudioElement: records play/pause, and for the duration
// check (preload "metadata", then src) answers with FakeAudio.nextDuration,
// or an "error" event when that is "error".
class FakeAudio {
  constructor(src) {
    this._src = src;
    this.volume = 1;
    this.paused = true;
    this.listeners = {};
    FakeAudio.instances.push(this);
  }
  get src() {
    return this._src;
  }
  set src(value) {
    this._src = value;
    if (this.preload === "metadata") {
      queueMicrotask(() => {
        if (FakeAudio.nextDuration === "error") return this.fire("error");
        this.duration = FakeAudio.nextDuration;
        this.fire("loadedmetadata");
      });
    }
  }
  addEventListener(type, cb) {
    (this.listeners[type] ||= []).push(cb);
  }
  fire(type) {
    (this.listeners[type] || []).forEach((cb) => cb());
  }
  play() {
    this.paused = false;
    return FakeAudio.playResult();
  }
  pause() {
    this.paused = true;
  }
}

class FakeFileReader {
  readAsDataURL(file) {
    queueMicrotask(() => {
      this.result = file.dataUrl;
      this.onload();
    });
  }
}

function resetSoundFakes() {
  FakeAudio.instances = [];
  FakeAudio.nextDuration = 1.5;
  FakeAudio.playResult = () => Promise.resolve();
  globalThis.Audio = FakeAudio;
  globalThis.FileReader = FakeFileReader;
}

const soundFile = (overrides = {}) => ({
  name: "ding.mp3",
  type: "audio/mpeg",
  size: 20000,
  dataUrl: "data:audio/mpeg;base64,AAAA",
  ...overrides,
});

async function pickSoundFile(dom, file) {
  const input = dom.byId.get("alert-sound-file");
  input.files = [file];
  await input.dispatchEvent({ type: "change" });
}

const CUSTOM_SOUND = { name: "ding.mp3", seconds: 1.5, bytes: 20000, dataUrl: "data:audio/mpeg;base64,AAAA" };

// The dropdown's options as [value, label] pairs.
const soundOptions = (dom) => dom.byId.get("alert-sound-select").children.map((o) => [o.value, o.textContent]);

const BUNDLED_OPTIONS = [
  ["level-up", "✓ Level Up (default)"],
  ["glockenspiel", "Glockenspiel"],
  ["ding", "Ding"],
  ["button-chime", "Button Chime"],
  ["hint", "Hint"],
];

test("trade offer sound: nothing saved lists the bundled sounds with the default selected, at 22%", async () => {
  resetSoundFakes();
  const dom = await loadPopup(makeDom());

  assert.deepEqual(soundOptions(dom), BUNDLED_OPTIONS);
  assert.equal(dom.byId.get("alert-sound-select").value, "level-up");
  assert.equal(dom.byId.get("alert-sound-remove").hidden, true);
  assert.equal(dom.byId.get("alert-sound-volume").value, "22");
  assert.equal(dom.byId.get("alert-sound-volume-value").textContent, "22%");
  assert.equal(dom.byId.get("alert-sound-play").dataset.playing, "false");
  assert.equal(dom.byId.get("alert-sound-play").attributes["aria-label"], "Play");
  assert.match(dom.byId.get("alert-sound-file").accept, /\.mp3/);
});

test("trade offer sound: warns that alerts need a Steam Web API key only while none is saved", async () => {
  resetSoundFakes();
  const withKey = await loadPopup(makeDom({ storage: { steamApiKey: "ABC123" } }));
  assert.equal(withKey.byId.get("alert-sound-key-warning").hidden, true);

  const dom = await loadPopup(makeDom());
  assert.equal(dom.byId.get("alert-sound-key-warning").hidden, false);

  dom.byId.get("steam-api-key").value = "ABC123";
  await dom.byId.get("settings-save").dispatchEvent({ type: "click" });
  assert.equal(dom.byId.get("alert-sound-key-warning").hidden, true);
});

test("trade offer sound: the warning's \"Add your key\" opens the Steam Web API settings on the key field", async () => {
  resetSoundFakes();
  const dom = await loadPopup(makeDom());
  const keyInput = dom.byId.get("steam-api-key");
  let focused = 0;
  keyInput.focus = () => focused++;
  assert.equal(dom.byId.get("steam-settings-details").open, false);

  await dom.byId.get("alert-sound-key-add").dispatchEvent({ type: "click" });

  assert.equal(dom.byId.get("steam-settings-details").open, true);
  assert.equal(focused, 1);
});

test("trade offer sound: a saved volume and bundled sound are shown", async () => {
  resetSoundFakes();
  const dom = await loadPopup(makeDom({ storage: { tradeOfferAlertVolume: 64, tradeOfferAlertSoundId: "ding" } }));

  assert.equal(dom.byId.get("alert-sound-select").value, "ding");
  assert.equal(dom.byId.get("alert-sound-volume").value, "64");
  assert.equal(dom.byId.get("alert-sound-volume-value").textContent, "64%");
});

test("trade offer sound: a saved custom sound is listed last; selected, it shows the remove button", async () => {
  resetSoundFakes();
  const dom = await loadPopup(makeDom({ storage: { tradeOfferAlertSoundId: "custom", tradeOfferAlertCustomSound: CUSTOM_SOUND } }));

  assert.deepEqual(soundOptions(dom), [
    ["level-up", "Level Up (default)"],
    ...BUNDLED_OPTIONS.slice(1),
    ["custom", "✓ Custom: ding.mp3"],
  ]);
  assert.equal(dom.byId.get("alert-sound-select").value, "custom");
  assert.equal(dom.byId.get("alert-sound-remove").hidden, false);
});

test("trade offer sound: a custom sound saved before the dropdown existed stays selected", async () => {
  resetSoundFakes();
  const dom = await loadPopup(makeDom({ storage: { tradeOfferAlertCustomSound: CUSTOM_SOUND } }));

  assert.equal(dom.byId.get("alert-sound-select").value, "custom");
});

test("trade offer sound: with a bundled sound selected, the custom one is still listed but can't be removed from there", async () => {
  resetSoundFakes();
  const dom = await loadPopup(makeDom({ storage: { tradeOfferAlertSoundId: "hint", tradeOfferAlertCustomSound: CUSTOM_SOUND } }));

  assert.equal(soundOptions(dom).at(-1)[0], "custom");
  assert.equal(dom.byId.get("alert-sound-select").value, "hint");
  assert.equal(dom.byId.get("alert-sound-remove").hidden, true);
});

test("trade offer sound: picking a sound saves it and plays it right away, so arrowing through the list auditions each", async () => {
  resetSoundFakes();
  const dom = await loadPopup(makeDom());
  const select = dom.byId.get("alert-sound-select");

  select.value = "glockenspiel";
  await select.dispatchEvent({ type: "change" });
  assert.equal(dom.store.tradeOfferAlertSoundId, "glockenspiel");
  assert.match(FakeAudio.instances[0].src, /public\/sounds\/glockenspiel\.mp3$/);
  assert.equal(FakeAudio.instances[0].paused, false);
  assert.equal(dom.byId.get("alert-sound-play").dataset.playing, "true");

  // The next one cuts the previous one off.
  select.value = "ding";
  await select.dispatchEvent({ type: "change" });
  assert.equal(FakeAudio.instances[0].paused, true);
  assert.match(FakeAudio.instances[1].src, /public\/sounds\/ding\.ogg$/);
  assert.equal(FakeAudio.instances[1].paused, false);
  assert.equal(dom.store.tradeOfferAlertSoundId, "ding");
});

test("trade offer sound: the ✓ follows the selection, without rebuilding the options (the dropdown keeps its focus)", async () => {
  resetSoundFakes();
  const dom = await loadPopup(makeDom({ storage: { tradeOfferAlertSoundId: "hint", tradeOfferAlertCustomSound: CUSTOM_SOUND } }));
  const select = dom.byId.get("alert-sound-select");
  const optionsBefore = [...select.children];
  assert.deepEqual(soundOptions(dom).at(-2), ["hint", "✓ Hint"]);

  select.value = "custom";
  await select.dispatchEvent({ type: "change" });

  assert.deepEqual(soundOptions(dom), [
    ["level-up", "Level Up (default)"],
    ["glockenspiel", "Glockenspiel"],
    ["ding", "Ding"],
    ["button-chime", "Button Chime"],
    ["hint", "Hint"],
    ["custom", "✓ Custom: ding.mp3"],
  ]);
  assert.deepEqual([...select.children], optionsBefore);
  // Colored in the open list too (popup.css), on exactly the one in use.
  assert.deepEqual(
    select.children.map((o) => [o.value, o.dataset.current]),
    [
      ["level-up", "false"],
      ["glockenspiel", "false"],
      ["ding", "false"],
      ["button-chime", "false"],
      ["hint", "false"],
      ["custom", "true"],
    ],
  );
});

test("trade offer sound: dragging the slider updates the label, releasing it saves", async () => {
  resetSoundFakes();
  const dom = await loadPopup(makeDom());
  const slider = dom.byId.get("alert-sound-volume");

  slider.value = "70";
  await slider.dispatchEvent({ type: "input" });
  assert.equal(dom.byId.get("alert-sound-volume-value").textContent, "70%");
  assert.equal(dom.store.tradeOfferAlertVolume, undefined);

  await slider.dispatchEvent({ type: "change" });
  assert.equal(dom.store.tradeOfferAlertVolume, 70);
});

test("trade offer sound: Play previews the selected sound at the slider's volume and turns into Stop", async () => {
  resetSoundFakes();
  const dom = await loadPopup(makeDom());
  const playBtn = dom.byId.get("alert-sound-play");

  await playBtn.dispatchEvent({ type: "click" });

  assert.equal(FakeAudio.instances.length, 1);
  const audio = FakeAudio.instances[0];
  assert.match(audio.src, /public\/sounds\/level-up\.ogg$/);
  assert.equal(audio.volume, 0.22 ** 2);
  assert.equal(audio.paused, false);
  assert.equal(playBtn.dataset.playing, "true");
  assert.equal(playBtn.attributes["aria-label"], "Stop");

  // Moving the slider while it plays changes the playing sound's volume.
  dom.byId.get("alert-sound-volume").value = "50";
  await dom.byId.get("alert-sound-volume").dispatchEvent({ type: "input" });
  assert.equal(audio.volume, 0.25);

  await playBtn.dispatchEvent({ type: "click" });
  assert.equal(audio.paused, true);
  assert.equal(playBtn.dataset.playing, "false");
  assert.equal(FakeAudio.instances.length, 1);
});

test("trade offer sound: the button goes back to Play when the sound ends by itself", async () => {
  resetSoundFakes();
  const dom = await loadPopup(makeDom());
  const playBtn = dom.byId.get("alert-sound-play");

  await playBtn.dispatchEvent({ type: "click" });
  FakeAudio.instances[0].fire("ended");

  assert.equal(playBtn.dataset.playing, "false");
  await playBtn.dispatchEvent({ type: "click" });
  assert.equal(FakeAudio.instances.length, 2);
});

test("trade offer sound: Play previews the selected custom sound, even while muted", async () => {
  resetSoundFakes();
  const dom = await loadPopup(
    makeDom({ storage: { tradeOfferAlertMuted: true, tradeOfferAlertSoundId: "custom", tradeOfferAlertCustomSound: CUSTOM_SOUND } }),
  );

  await dom.byId.get("alert-sound-play").dispatchEvent({ type: "click" });

  assert.equal(FakeAudio.instances[0].src, CUSTOM_SOUND.dataUrl);
});

test("trade offer sound: a failed preview shows an error and resets the button", async () => {
  resetSoundFakes();
  FakeAudio.playResult = () => Promise.reject(new Error("NotAllowedError"));
  const dom = await loadPopup(makeDom());

  await dom.byId.get("alert-sound-play").dispatchEvent({ type: "click" });

  assert.equal(dom.byId.get("alert-sound-play").dataset.playing, "false");
  assert.equal(dom.byId.get("alert-sound-status").textContent, "Couldn't play the sound.");
  assert.equal(dom.byId.get("alert-sound-status").dataset.status, "error");
});

test("trade offer sound: Add your own… in the popup opens the settings page at the sound section (file pickers close the popup)", async () => {
  resetSoundFakes();
  const dom = await loadPopup(makeDom());
  let fileDialogOpened = false;
  dom.byId.get("alert-sound-file").click = () => (fileDialogOpened = true);

  await dom.byId.get("alert-sound-choose").dispatchEvent({ type: "click" });

  assert.equal(global.chrome.runtime.optionsPageOpened, 1);
  assert.equal(dom.store.settingsPageFocus.section, "alerts");
  assert.equal(fileDialogOpened, false);
});

test("trade offer sound: a valid file is checked, saved, added to the list and selected", async () => {
  resetSoundFakes();
  FakeAudio.nextDuration = 2.25;
  const dom = await loadPopup(makeDom({ storage: { tradeOfferAlertSoundId: "ding" } }));

  await pickSoundFile(dom, soundFile());

  assert.deepEqual(dom.store.tradeOfferAlertCustomSound, {
    name: "ding.mp3",
    seconds: 2.25,
    bytes: 20000,
    dataUrl: "data:audio/mpeg;base64,AAAA",
  });
  assert.equal(dom.store.tradeOfferAlertSoundId, "custom");
  assert.deepEqual(soundOptions(dom).at(-1), ["custom", "✓ Custom: ding.mp3"]);
  assert.deepEqual(soundOptions(dom)[2], ["ding", "Ding"]);
  assert.equal(dom.byId.get("alert-sound-select").value, "custom");
  assert.equal(dom.byId.get("alert-sound-remove").hidden, false);
  assert.equal(dom.byId.get("alert-sound-status").textContent, "Saved and selected.");
  assert.equal(dom.byId.get("alert-sound-status").dataset.status, "ok");
  // The duration was read from the decoded file itself.
  assert.equal(FakeAudio.instances.at(-1).src, "data:audio/mpeg;base64,AAAA");
});

test("trade offer sound: a new file replaces the previous custom sound instead of adding a second", async () => {
  resetSoundFakes();
  const dom = await loadPopup(makeDom({ storage: { tradeOfferAlertCustomSound: CUSTOM_SOUND } }));

  await pickSoundFile(dom, soundFile({ name: "bell.ogg", type: "audio/ogg", dataUrl: "data:audio/ogg;base64,BBBB" }));

  assert.deepEqual(soundOptions(dom).filter(([value]) => value === "custom"), [["custom", "✓ Custom: bell.ogg"]]);
  assert.equal(dom.store.tradeOfferAlertCustomSound.dataUrl, "data:audio/ogg;base64,BBBB");
});

test("trade offer sound: a file with no type is saved with an audio type from its extension", async () => {
  resetSoundFakes();
  const dom = await loadPopup(makeDom());

  await pickSoundFile(dom, soundFile({ name: "ding.wav", type: "", dataUrl: "data:application/octet-stream;base64,AAAA" }));

  assert.equal(dom.store.tradeOfferAlertCustomSound.dataUrl, "data:audio/wav;base64,AAAA");
});

test("trade offer sound: wrong format, too big, too long and undecodable files are refused, nothing saved", async () => {
  const cases = [
    [soundFile({ name: "song.flac", type: "audio/flac" }), 1.5, "Use an MP3, OGG or WAV file."],
    [soundFile({ size: 47 * 1024 * 1024 }), 1.5, "That file is 47.0 MB. Use one up to 1 MB."],
    [soundFile(), 169200, "That sound is 169200 seconds long. Use one up to 10 seconds."],
    [soundFile({ name: "fake.mp3" }), "error", "That file isn't a sound this browser can play."],
  ];
  for (const [file, duration, message] of cases) {
    resetSoundFakes();
    FakeAudio.nextDuration = duration;
    const dom = await loadPopup(makeDom());

    await pickSoundFile(dom, file);

    assert.equal(dom.byId.get("alert-sound-status").textContent, message);
    assert.equal(dom.byId.get("alert-sound-status").dataset.status, "error");
    assert.equal(dom.store.tradeOfferAlertCustomSound, undefined);
    assert.equal(dom.store.tradeOfferAlertSoundId, undefined);
    assert.deepEqual(soundOptions(dom), BUNDLED_OPTIONS);
    assert.equal(dom.byId.get("alert-sound-file").value, "");
  }
});

test("trade offer sound: picking a file stops a playing preview", async () => {
  resetSoundFakes();
  const dom = await loadPopup(makeDom());
  await dom.byId.get("alert-sound-play").dispatchEvent({ type: "click" });
  const preview = FakeAudio.instances[0];

  await pickSoundFile(dom, soundFile());

  assert.equal(preview.paused, true);
  assert.equal(dom.byId.get("alert-sound-play").dataset.playing, "false");
});

test("trade offer sound: removing the custom sound deletes it and selects the default", async () => {
  resetSoundFakes();
  const dom = await loadPopup(makeDom({ storage: { tradeOfferAlertSoundId: "custom", tradeOfferAlertCustomSound: CUSTOM_SOUND } }));

  await dom.byId.get("alert-sound-remove").dispatchEvent({ type: "click" });

  assert.equal("tradeOfferAlertCustomSound" in dom.store, false);
  assert.equal(dom.store.tradeOfferAlertSoundId, "level-up");
  assert.deepEqual(soundOptions(dom), BUNDLED_OPTIONS);
  assert.equal(dom.byId.get("alert-sound-select").value, "level-up");
  assert.equal(dom.byId.get("alert-sound-remove").hidden, true);
  assert.equal(dom.byId.get("alert-sound-status").textContent, "Removed your sound. Back to the default.");

  await dom.byId.get("alert-sound-play").dispatchEvent({ type: "click" });
  assert.match(FakeAudio.instances[0].src, /level-up\.ogg$/);
});

test("trade offer sound: missing elements don't break the popup", async () => {
  resetSoundFakes();
  await assert.doesNotReject(async () => {
    await loadPopup(makeDom({ missingIds: ["alert-sound-play", "alert-sound-volume", "alert-sound-select"] }));
  });
  await assert.doesNotReject(async () => {
    await loadPopup(makeDom({ missingIds: ["alert-sound-choose", "alert-sound-remove", "alert-sound-file", "alert-sound-status"] }));
  });
});

// --- auto-add listing currency checkbox ---------------------------------

test("auto-add listing currency checkbox defaults to checked (on) when never saved before", async () => {
  const dom = await loadPopup(makeDom());
  assert.equal(dom.byId.get("auto-add-listing-currency").checked, true);
});

test("auto-add listing currency checkbox reflects a saved off state and persists a change", async () => {
  const dom = await loadPopup(makeDom({ storage: { autoAddListingCurrencyEnabled: false } }));
  const input = dom.byId.get("auto-add-listing-currency");
  assert.equal(input.checked, false);

  input.checked = true;
  await input.dispatchEvent({ type: "change" });
  assert.equal(dom.store.autoAddListingCurrencyEnabled, true);

  input.checked = false;
  await input.dispatchEvent({ type: "change" });
  assert.equal(dom.store.autoAddListingCurrencyEnabled, false);
});

// --- Sheen/Killstreaker filter checkbox (new feature)
// ------------------------------------------

test("Sheen/Killstreaker filter checkbox defaults to checked (on) when never saved before", async () => {
  const dom = await loadPopup(makeDom());
  assert.equal(dom.byId.get("sheen-killstreaker-filter").checked, true);
});

test("Sheen/Killstreaker filter checkbox reflects a saved off state and persists a change immediately", async () => {
  const dom = await loadPopup(makeDom({ storage: { sheenKillstreakerFilterEnabled: false } }));
  const input = dom.byId.get("sheen-killstreaker-filter");
  assert.equal(input.checked, false);

  input.checked = true;
  await input.dispatchEvent({ type: "change" });
  assert.equal(dom.store.sheenKillstreakerFilterEnabled, true);

  input.checked = false;
  await input.dispatchEvent({ type: "change" });
  assert.equal(dom.store.sheenKillstreakerFilterEnabled, false);
});

// --- general settings: own open/closed state ----------------------------

test("general settings: its own open/closed state is independent of the settings accordion", async () => {
  const dom = await loadPopup(makeDom());
  const generalDetails = dom.byId.get("general-settings-details");

  generalDetails.open = true;
  await generalDetails.dispatchEvent({ type: "toggle" });
  assert.equal(dom.store.generalSettingsPanelOpen, true);

  const steamDetails = dom.byId.get("steam-settings-details");
  steamDetails.open = true;
  await steamDetails.dispatchEvent({ type: "toggle" });

  assert.equal(dom.store.generalSettingsPanelOpen, true, "opening a settings section must not close/affect the general settings panel");
  assert.equal(generalDetails.open, true);
});

test("general settings: restores its previously-open state on load", async () => {
  const dom = await loadPopup(makeDom({ storage: { generalSettingsPanelOpen: true } }));
  assert.equal(dom.byId.get("general-settings-details").open, true);
});

// --- trade offer badge mirror ------------------------------------------

test("mirrors a non-empty toolbar badge onto the trade-offer quick-link button", async () => {
  const dom = makeDom();
  global.chrome.action.getBadgeText = async () => "3";
  await loadPopup(dom);
  const badgeEl = dom.byId.get("tradeoffer-badge");
  assert.equal(badgeEl.textContent, "3");
  assert.equal(badgeEl.hidden, false);
});

test("hides the trade-offer badge mirror when the toolbar badge is empty", async () => {
  const dom = makeDom();
  global.chrome.action.getBadgeText = async () => "";
  await loadPopup(dom);
  const badgeEl = dom.byId.get("tradeoffer-badge");
  assert.equal(badgeEl.hidden, true);
});

// Opening the popup asks for a fresh count (at most 15s old), so an offer
// accepted elsewhere drops off without waiting for the 2-minute poll.
test("opening the popup refreshes the trade offer count and re-renders the badge with the answer", async () => {
  const dom = makeDom();
  let badge = "1";
  global.chrome.action.getBadgeText = async () => badge;
  const refreshRequests = [];
  global.chrome.runtime.sendMessage = async (msg) => {
    if (msg?.type === "REFRESH_TRADEOFFER_BADGE") {
      refreshRequests.push(msg);
      badge = ""; // the background poll found the offer gone
      return { ok: true };
    }
    return { ok: false };
  };

  await loadPopup(dom);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(refreshRequests, [{ type: "REFRESH_TRADEOFFER_BADGE", maxAgeMs: 15000 }]);
  assert.equal(dom.byId.get("tradeoffer-badge").hidden, true);
});

// With the popup left open (e.g. using the calculator), the 2-minute background
// check finding a new offer must show on the Trade offers button too, not only
// on the toolbar icon.
test("updates the Trade offers badge live when a background check stores a new count while the popup is open", async () => {
  const dom = makeDom();
  let badge = "";
  global.chrome.action.getBadgeText = async () => badge;

  await loadPopup(dom);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const badgeEl = dom.byId.get("tradeoffer-badge");
  assert.equal(badgeEl.hidden, true);

  // background.js sets the toolbar badge, then stores the count.
  badge = "1";
  for (const listener of dom.storageChangedListeners) {
    await listener({ lastKnownPendingTradeOfferCount: { oldValue: 0, newValue: 1 } }, "local");
  }
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(badgeEl.textContent, "1");
  assert.equal(badgeEl.hidden, false);
});

test("keeps the cached trade offer count when the background can't be reached", async () => {
  const dom = makeDom();
  global.chrome.action.getBadgeText = async () => "2";
  global.chrome.runtime.sendMessage = async () => {
    throw new Error("Could not establish connection");
  };

  await loadPopup(dom);
  await new Promise((resolve) => setTimeout(resolve, 0));

  const badgeEl = dom.byId.get("tradeoffer-badge");
  assert.equal(badgeEl.textContent, "2");
  assert.equal(badgeEl.hidden, false);
});

// --- active-scripts status ------------------------------------------------

test("shows the active state with a collapsed script-count summary and the full script list once expanded", async () => {
  const dom = makeDom();
  global.chrome.tabs.sendMessage = async () => ({ site: "scrap.tf", scripts: ["Item Links", "Auction Bid Helper"], settled: true });
  await loadPopup(dom);

  assert.equal(dom.byId.get("status-badge").textContent, "active");
  const summary = scriptDetailsEl(dom).children[0];
  assert.equal(summary.textContent, "2 active scripts");
  assert.equal(scriptItemCount(dom), 2);
});

test("summary text is singular for exactly one active script", async () => {
  const dom = makeDom();
  global.chrome.tabs.sendMessage = async () => ({ site: "scrap.tf", scripts: ["Item Links"], settled: true });
  await loadPopup(dom);

  const summary = scriptDetailsEl(dom).children[0];
  assert.equal(summary.textContent, "1 active script");
});

// No message/box for any inactive reason - the status badge's own dot +
// "inactive" text is the whole signal now (see popup.js's own setInactive
// note on why a separate panel repeating that was redundant). #scripts-list
// itself is collapsed to display:none, not just emptied - An
// empty-but-still-flex-laid-out container still reserved its own
// padding/min-height as a visible blank gap between the quick links and
// settings sections.

test("shows inactive with a collapsed (hidden, not just empty) scripts-list when chrome.tabs.query returns nothing", async () => {
  const dom = makeDom();
  global.chrome.tabs.query = async () => [];
  await loadPopup(dom);

  assert.equal(dom.byId.get("status-badge").textContent, "inactive");
  assert.equal(dom.byId.get("scripts-list").innerHTML, "");
  assert.equal(dom.byId.get("scripts-list").style.display, "none");
});

test("shows inactive with a collapsed scripts-list when chrome.tabs.sendMessage resolves to no response at all", async () => {
  const dom = makeDom();
  global.chrome.tabs.sendMessage = async () => undefined;
  await loadPopup(dom);

  assert.equal(dom.byId.get("status-badge").textContent, "inactive");
  assert.equal(dom.byId.get("scripts-list").innerHTML, "");
  assert.equal(dom.byId.get("scripts-list").style.display, "none");
});

test("shows inactive with a collapsed scripts-list when chrome.tabs.sendMessage throws", async () => {
  const dom = makeDom();
  global.chrome.tabs.sendMessage = async () => {
    throw new Error("Could not establish connection.");
  };
  await loadPopup(dom);

  assert.equal(dom.byId.get("status-badge").textContent, "inactive");
  assert.equal(dom.byId.get("scripts-list").innerHTML, "");
  assert.equal(dom.byId.get("scripts-list").style.display, "none");
});

test("shows inactive with a collapsed scripts-list when the response has an empty scripts array", async () => {
  const dom = makeDom();
  global.chrome.tabs.sendMessage = async () => ({ site: "example.com", scripts: [], settled: true });
  await loadPopup(dom);

  assert.equal(dom.byId.get("status-badge").textContent, "inactive");
  assert.equal(dom.byId.get("scripts-list").innerHTML, "");
  assert.equal(dom.byId.get("scripts-list").style.display, "none");
});

test("setActive resets the scripts-list's own display back to visible (not left collapsed)", async () => {
  const dom = makeDom();
  global.chrome.tabs.sendMessage = async () => ({ site: "scrap.tf", scripts: ["Item Links"], settled: true });
  await loadPopup(dom);

  assert.equal(dom.byId.get("status-badge").textContent, "active");
  assert.notEqual(dom.byId.get("scripts-list").style.display, "none");
});

test("retries once after 300ms when the first response is unsettled with no scripts yet, then shows the settled result", async () => {
  const dom = makeDom();
  const realSetTimeout = global.setTimeout;
  global.setTimeout = (fn) => fn(); // resolve the 300ms retry wait immediately
  try {
    let call = 0;
    global.chrome.tabs.sendMessage = async () => {
      call++;
      if (call === 1) return { site: "example.com", scripts: [], settled: false };
      return { site: "example.com", scripts: ["Feature"], settled: true };
    };
    await loadPopup(dom);

    assert.equal(call, 2);
    assert.equal(dom.byId.get("status-badge").textContent, "active");
    assert.equal(scriptItemCount(dom), 1);
  } finally {
    global.setTimeout = realSetTimeout;
  }
});

// --- scroll persistence -----------------------------------------------

test("restores a previously-saved scroll position onto #app after the scripts list has settled", async () => {
  const dom = await loadPopup(makeDom({ storage: { popupScrollTop: 250 } }));
  assert.equal(dom.byId.get("app").scrollTop, 250);
});

test("does not touch scrollTop when nothing was previously saved", async () => {
  const dom = await loadPopup(makeDom());
  assert.equal(dom.byId.get("app").scrollTop, undefined);
});

test("saves the scroll position (debounced) on scroll", async () => {
  const dom = await loadPopup(makeDom());
  const realSetTimeout = global.setTimeout;
  const realClearTimeout = global.clearTimeout;
  const timeoutCalls = [];
  global.setTimeout = (fn, delay) => {
    timeoutCalls.push({ fn, delay });
    return timeoutCalls.length;
  };
  global.clearTimeout = () => {};
  try {
    const appEl = dom.byId.get("app");
    appEl.scrollTop = 42;
    await appEl.dispatchEvent({ type: "scroll" });

    assert.equal(timeoutCalls.at(-1).delay, 150);
    timeoutCalls.at(-1).fn();
    assert.equal(dom.store.popupScrollTop, 42);
  } finally {
    global.setTimeout = realSetTimeout;
    global.clearTimeout = realClearTimeout;
  }
});

// --- calculator -------------------------------------------------------
//
// The actual breakdown/total math (utils/calculator.js) has its own
// dedicated, DOM-free test file (tests/calculator.test.js) - these only
// cover the DOM wiring: population from storage, auto-save, the refresh
// button's visibility/behavior, and that a field change actually reaches
// the pure module and back onto the page.

test("calculator: the key price is a plain hand-entered field, restored from storage", async () => {
  const dom = await loadPopup(makeDom({ storage: { calcKeyPriceRefined: 50 } }));
  assert.equal(dom.byId.get("calc-key-price-ref").value, 50);
  assert.notEqual(dom.byId.get("calc-key-price-ref").readOnly, true);
  assert.notEqual(dom.byId.get("calc-key-price-ref-dec").disabled, true);
});

test("calculator: pre-fills owned amounts, currency, key price, and include checkboxes from storage", async () => {
  const dom = await loadPopup(makeDom({
    storage: {
      calcOwnedKey: 2, calcOwnedRef: 5, calcOwnedRec: 1, calcOwnedScrap: 3,
      calcCurrency: "EUR", calcKeyPriceCurrency: 1.85,
      calcIncludeKey: false, calcKeyPriceRefined: 58,
    },
  }));

  assert.equal(dom.byId.get("calc-owned-key").value, 2);
  assert.equal(dom.byId.get("calc-owned-ref").value, 5);
  assert.equal(dom.byId.get("calc-owned-rec").value, 1);
  assert.equal(dom.byId.get("calc-owned-scrap").value, 3);
  assert.equal(dom.byId.get("calc-currency").value, "EUR");
  assert.equal(dom.byId.get("calc-key-price-currency").value, 1.85);
  assert.equal(dom.byId.get("calc-include-key").checked, false);
  assert.equal(dom.byId.get("calc-include-ref").checked, true);
  assert.equal(dom.byId.get("calc-key-price-ref").value, 58);
});

test("calculator: include checkboxes default to checked when never saved", async () => {
  const dom = await loadPopup(makeDom());
  assert.equal(dom.byId.get("calc-include-key").checked, true);
  assert.equal(dom.byId.get("calc-include-ref").checked, true);
  assert.equal(dom.byId.get("calc-include-rec").checked, true);
  assert.equal(dom.byId.get("calc-include-scrap").checked, true);
});

test("calculator: recomputes the breakdown and totals as owned amounts change", async () => {
  const dom = await loadPopup(makeDom({ storage: { calcKeyPriceRefined: 58, calcKeyPriceCurrency: 2 } }));

  dom.byId.get("calc-owned-key").value = "1";
  await dom.byId.get("calc-owned-key").dispatchEvent({ type: "input" });

  assert.equal(dom.byId.get("calc-result-key").textContent, "1");
  assert.equal(dom.byId.get("calc-result-ref").textContent, "0");
  assert.equal(dom.byId.get("calc-total-keys").textContent, "1.00 keys");
  assert.equal(dom.byId.get("calc-total-currency").textContent, "$2.00");
});

test("calculator: a comma decimal in an owned amount is treated the same as a period", async () => {
  // rec/scrap turned off so ref is the last active (fraction-absorbing)
  // denomination - isolates comma-parsing from breakdownRefined's own
  // cascade, which already has its own dedicated pure-function tests.
  const dom = await loadPopup(makeDom({
    storage: { calcKeyPriceRefined: 58, calcIncludeRec: false, calcIncludeScrap: false },
  }));

  dom.byId.get("calc-owned-ref").value = "4,2";
  await dom.byId.get("calc-owned-ref").dispatchEvent({ type: "input" });

  assert.equal(dom.byId.get("calc-result-ref").textContent, "4.20");
});

test("calculator: the key price ref stepper's +/- buttons nudge the value and recompute", async () => {
  const dom = await loadPopup(makeDom({ storage: { calcKeyPriceRefined: 58, calcOwnedKey: 1 } }));

  await dom.byId.get("calc-key-price-ref-inc").dispatchEvent({ type: "click" });
  assert.equal(dom.byId.get("calc-key-price-ref").value, 59);
  assert.equal(dom.byId.get("calc-result-key").textContent, "1");

  await dom.byId.get("calc-key-price-ref-dec").dispatchEvent({ type: "click" });
  await dom.byId.get("calc-key-price-ref-dec").dispatchEvent({ type: "click" });
  assert.equal(dom.byId.get("calc-key-price-ref").value, 57);
});

test("calculator: the key price ref stepper never goes below 0", async () => {
  const dom = await loadPopup(makeDom());
  await dom.byId.get("calc-key-price-ref-dec").dispatchEvent({ type: "click" });
  assert.equal(dom.byId.get("calc-key-price-ref").value, 0);
});

test("calculator: the key price currency stepper steps by 0.01", async () => {
  const dom = await loadPopup(makeDom({ storage: { calcKeyPriceCurrency: 1.85 } }));
  await dom.byId.get("calc-key-price-currency-inc").dispatchEvent({ type: "click" });
  assert.equal(dom.byId.get("calc-key-price-currency").value, 1.86);
});

test("calculator: unchecking a denomination live-folds its value into the next included one", async () => {
  const dom = await loadPopup(makeDom({ storage: { calcKeyPriceRefined: 58 } }));

  dom.byId.get("calc-owned-key").value = "1";
  await dom.byId.get("calc-owned-key").dispatchEvent({ type: "input" });
  assert.equal(dom.byId.get("calc-result-key").textContent, "1");

  dom.byId.get("calc-include-key").checked = false;
  await dom.byId.get("calc-include-key").dispatchEvent({ type: "change" });

  assert.equal(dom.byId.get("calc-result-key").textContent, "0");
  assert.equal(dom.byId.get("calc-result-ref").textContent, "58");
});

test("calculator: shows a placeholder total instead of $0.00/0.00 keys before any key price is entered", async () => {
  const dom = await loadPopup(makeDom());
  assert.equal(dom.byId.get("calc-total-keys").textContent, "N/A");
  assert.equal(dom.byId.get("calc-total-currency").textContent, "N/A");
});

test("calculator: auto-saves field changes to storage, debounced (no separate Save button)", async () => {
  const dom = await loadPopup(makeDom());
  const realSetTimeout = global.setTimeout;
  const timeoutCalls = [];
  global.setTimeout = (fn, delay) => {
    timeoutCalls.push({ fn, delay });
    return timeoutCalls.length;
  };
  try {
    dom.byId.get("calc-owned-ref").value = "9";
    await dom.byId.get("calc-owned-ref").dispatchEvent({ type: "input" });

    assert.equal(timeoutCalls.at(-1).delay, 200);
    assert.equal(dom.store.calcOwnedRef, undefined, "not written to storage until the debounce actually fires");

    timeoutCalls.at(-1).fn();
    assert.equal(dom.store.calcOwnedRef, 9);
  } finally {
    global.setTimeout = realSetTimeout;
  }
});

test("calculator: Quick Math pre-fills its 8 fields from storage", async () => {
  const dom = await loadPopup(makeDom({
    storage: {
      calcMulA: 3.52, calcMulB: 2, calcDivA: 7.04, calcDivB: 2,
      calcAddA: 3, calcAddB: 4, calcSubA: 10, calcSubB: 3,
    },
  }));

  assert.equal(dom.byId.get("calc-mul-a").value, 3.52);
  assert.equal(dom.byId.get("calc-mul-b").value, 2);
  assert.equal(dom.byId.get("calc-div-a").value, 7.04);
  assert.equal(dom.byId.get("calc-div-b").value, 2);
  assert.equal(dom.byId.get("calc-add-a").value, 3);
  assert.equal(dom.byId.get("calc-add-b").value, 4);
  assert.equal(dom.byId.get("calc-sub-a").value, 10);
  assert.equal(dom.byId.get("calc-sub-b").value, 3);
});

// The actual precision guarantee is covered by tests/calculator.test.js's
// own dedicated multiply/divide tests; these only cover that typing into the
// fields reaches that pure math and back onto the page correctly.
test("calculator: Quick Math multiply row recomputes live as either field changes", async () => {
  const dom = await loadPopup(makeDom());

  dom.byId.get("calc-mul-a").value = "3.52";
  await dom.byId.get("calc-mul-a").dispatchEvent({ type: "input" });
  dom.byId.get("calc-mul-b").value = "2";
  await dom.byId.get("calc-mul-b").dispatchEvent({ type: "input" });

  assert.equal(dom.byId.get("calc-mul-result").textContent, "7.04");
});

test("calculator: Quick Math divide row recomputes live as either field changes", async () => {
  const dom = await loadPopup(makeDom());

  dom.byId.get("calc-div-a").value = "7.04";
  await dom.byId.get("calc-div-a").dispatchEvent({ type: "input" });
  dom.byId.get("calc-div-b").value = "2";
  await dom.byId.get("calc-div-b").dispatchEvent({ type: "input" });

  assert.equal(dom.byId.get("calc-div-result").textContent, "3.52");
});

test("calculator: Quick Math divide by zero shows 0, not Infinity/NaN", async () => {
  const dom = await loadPopup(makeDom());

  dom.byId.get("calc-div-a").value = "10";
  await dom.byId.get("calc-div-a").dispatchEvent({ type: "input" });

  assert.equal(dom.byId.get("calc-div-result").textContent, "0");
});

test("calculator: Quick Math add row recomputes live as either field changes", async () => {
  const dom = await loadPopup(makeDom());

  dom.byId.get("calc-add-a").value = "3";
  await dom.byId.get("calc-add-a").dispatchEvent({ type: "input" });
  dom.byId.get("calc-add-b").value = "4";
  await dom.byId.get("calc-add-b").dispatchEvent({ type: "input" });

  assert.equal(dom.byId.get("calc-add-result").textContent, "7");
});

test("calculator: Quick Math subtract row recomputes live as either field changes, allowing a negative result", async () => {
  const dom = await loadPopup(makeDom());

  dom.byId.get("calc-sub-a").value = "3";
  await dom.byId.get("calc-sub-a").dispatchEvent({ type: "input" });
  dom.byId.get("calc-sub-b").value = "5";
  await dom.byId.get("calc-sub-b").dispatchEvent({ type: "input" });

  assert.equal(dom.byId.get("calc-sub-result").textContent, "-2");
});

test("calculator: Quick Math fields auto-save to storage, debounced, same as the rest of the panel", async () => {
  const dom = await loadPopup(makeDom());
  const realSetTimeout = global.setTimeout;
  const timeoutCalls = [];
  global.setTimeout = (fn, delay) => {
    timeoutCalls.push({ fn, delay });
    return timeoutCalls.length;
  };
  try {
    dom.byId.get("calc-mul-a").value = "3.52";
    await dom.byId.get("calc-mul-a").dispatchEvent({ type: "input" });

    assert.equal(dom.store.calcMulA, undefined, "not written to storage until the debounce actually fires");
    timeoutCalls.at(-1).fn();
    assert.equal(dom.store.calcMulA, 3.52);
  } finally {
    global.setTimeout = realSetTimeout;
  }
});

test("calculator: its own open/closed state is independent of the settings accordion", async () => {
  const dom = await loadPopup(makeDom());
  const calcDetails = dom.byId.get("calculator-details");

  calcDetails.open = true;
  await calcDetails.dispatchEvent({ type: "toggle" });
  assert.equal(dom.store.calcPanelOpen, true);

  const steamDetails = dom.byId.get("steam-settings-details");
  steamDetails.open = true;
  await steamDetails.dispatchEvent({ type: "toggle" });

  assert.equal(dom.store.calcPanelOpen, true, "opening a settings section must not close/affect the calculator panel");
  assert.equal(calcDetails.open, true);
});

test("calculator: restores its previously-open state on load", async () => {
  const dom = await loadPopup(makeDom({ storage: { calcPanelOpen: true } }));
  assert.equal(dom.byId.get("calculator-details").open, true);
});

test("does not throw when the calculator's own elements are missing from the page", async () => {
  const dom = makeDom({ missingIds: ["calculator-details"] });
  await assert.doesNotReject(async () => {
    await loadPopup(dom);
  });
});
