import { test } from "node:test";
import assert from "node:assert/strict";

// The settings page (options/options.html + options.js). Its settings come
// from the same classes as the popup (settings/*.js, covered in depth by
// tests/popup.test.js); these tests cover what differs on this page (the
// page: "options" behavior, the per-card Save buttons, the #steam-key intro)
// and options.js itself (version, side menu dots, focus requests).

class FakeElement {
  constructor(tag = "div") {
    this.tag = tag;
    this.style = {};
    this.dataset = {};
    this.attributes = {};
    this.children = [];
    this.hidden = false;
    this.open = false;
    this.disabled = false;
    this.checked = false;
    this.value = "";
    this.textContent = "";
    this.title = "";
    this._innerHTML = "";
    this._listeners = {};
    this.scrolledInto = 0;
    const classes = new Set();
    this.classList = {
      add: (...names) => names.forEach((n) => classes.add(n)),
      remove: (...names) => names.forEach((n) => classes.delete(n)),
      toggle: (n, force) => {
        const on = force === undefined ? !classes.has(n) : Boolean(force);
        if (on) classes.add(n);
        else classes.delete(n);
        return on;
      },
      contains: (n) => classes.has(n),
    };
  }
  get innerHTML() {
    return this._innerHTML;
  }
  set innerHTML(v) {
    this._innerHTML = v;
    this.children = [];
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
  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }
  removeAttribute(name) {
    delete this.attributes[name];
  }
  scrollIntoView() {
    this.scrolledInto++;
  }
  // Where the element sits relative to the top of the window (set per test).
  getBoundingClientRect() {
    return { top: this.top ?? 0 };
  }
  click() {
    this.clicked = (this.clicked || 0) + 1;
  }
}

// Every id options.html carries.
const IDS = [
  "version-badge", "about-version", "nav-alerts-dot", "nav-api-dot",
  "general", "alerts", "api", "about",
  "auto-add-listing-currency", "sheen-killstreaker-filter", "mute-tradeoffer-alert",
  "alert-sound-key-warning", "alert-sound-select", "alert-sound-play", "alert-sound-volume", "alert-sound-volume-value",
  "alert-sound-custom-name", "alert-sound-choose", "alert-sound-remove", "alert-sound-file", "alert-sound-status",
  "steam-key-intro", "steam-key-intro-heading", "steam-key-intro-text",
  "steam-key-missing-dot", "steam-api-key", "steam-check-btn", "steam-save", "steam-key-status", "steam-schema-status", "steam-save-status",
];

function makeDom({ storage = {}, hash } = {}) {
  const byId = new Map(IDS.map((id) => [id, new FakeElement()]));
  // options.html ships these hidden.
  for (const id of ["steam-key-intro", "alert-sound-key-warning", "nav-alerts-dot", "nav-api-dot"]) {
    byId.get(id).hidden = true;
  }
  global.document = {
    getElementById: (id) => byId.get(id) || null,
    createElement: (tag) => new FakeElement(tag),
    documentElement: { scrollHeight: 0 },
  };
  global.window = { innerHeight: 0, scrollY: 0, addEventListener() {} };
  if (hash) globalThis.location = { hash };
  else delete globalThis.location;

  const store = { ...storage };
  const listeners = [];
  global.chrome = {
    runtime: {
      getManifest: () => ({ version: "2.3.4" }),
      getURL: (path) => new URL(`../${path}`, import.meta.url).href,
      sendMessage: async () => ({ ok: false, error: "no live fetch expected" }),
      optionsPageOpened: 0,
      async openOptionsPage() {
        global.chrome.runtime.optionsPageOpened++;
      },
    },
    storage: {
      local: {
        async get(keys) {
          return Object.fromEntries([].concat(keys).filter((k) => k in store).map((k) => [k, store[k]]));
        },
        async set(values) {
          const changes = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, { oldValue: store[k], newValue: v }]));
          Object.assign(store, values);
          for (const listener of listeners) await listener(changes, "local");
        },
        async remove(keys) {
          const changes = {};
          for (const key of [].concat(keys)) {
            if (!(key in store)) continue;
            changes[key] = { oldValue: store[key] };
            delete store[key];
          }
          for (const listener of listeners) await listener(changes, "local");
        },
      },
      onChanged: { addListener: (fn) => listeners.push(fn) },
    },
  };
  return { byId, store, listeners };
}

// options.js starts itself on import (a module script runs once the page is
// parsed); later tests re-run its exported initOptionsPage on a fresh DOM.
makeDom();
const { initOptionsPage } = await import("../options/options.js");

async function loadOptions(options) {
  const dom = makeDom(options);
  await initOptionsPage();
  return dom;
}

const CUSTOM_SOUND = { name: "ding.mp3", seconds: 1.5, bytes: 20000, dataUrl: "data:audio/mpeg;base64,AAAA" };

test("shows the extension's version in the header and the About section", async () => {
  const dom = await loadOptions();
  assert.equal(dom.byId.get("version-badge").textContent, "v2.3.4");
  assert.equal(dom.byId.get("about-version").textContent, "Version 2.3.4");
});

test("on this page, Choose a file… opens the file picker itself (no popup to lose it)", async () => {
  const dom = await loadOptions();

  await dom.byId.get("alert-sound-choose").dispatchEvent({ type: "click" });

  assert.equal(dom.byId.get("alert-sound-file").clicked, 1);
  assert.equal(global.chrome.runtime.optionsPageOpened, 0);
});

test("the own-sound row shows the file and Remove whenever there is one, even while a bundled sound plays", async () => {
  const dom = await loadOptions({ storage: { tradeOfferAlertSoundId: "hint", tradeOfferAlertCustomSound: CUSTOM_SOUND } });

  assert.equal(dom.byId.get("alert-sound-remove").hidden, false);
  assert.equal(dom.byId.get("alert-sound-custom-name").hidden, false);
  assert.equal(dom.byId.get("alert-sound-custom-name").textContent, "Your file: ding.mp3 (1.5 s)");
});

test("removing the file while a bundled sound is selected keeps that sound", async () => {
  const dom = await loadOptions({ storage: { tradeOfferAlertSoundId: "hint", tradeOfferAlertCustomSound: CUSTOM_SOUND } });

  await dom.byId.get("alert-sound-remove").dispatchEvent({ type: "click" });

  assert.equal("tradeOfferAlertCustomSound" in dom.store, false);
  assert.equal(dom.store.tradeOfferAlertSoundId, "hint");
  assert.equal(dom.byId.get("alert-sound-select").value, "hint");
  assert.equal(dom.byId.get("alert-sound-remove").hidden, true);
  assert.equal(dom.byId.get("alert-sound-custom-name").hidden, true);
  assert.equal(dom.byId.get("alert-sound-status").textContent, "Removed your sound.");
});

test("without a Steam Web API key, the alerts section warns and both menu entries get a dot", async () => {
  const dom = await loadOptions();

  assert.equal(dom.byId.get("alert-sound-key-warning").hidden, false);
  assert.equal(dom.byId.get("nav-alerts-dot").hidden, false);
  assert.equal(dom.byId.get("nav-api-dot").hidden, false);

  dom.byId.get("steam-api-key").value = "KEY";
  await dom.byId.get("steam-save").dispatchEvent({ type: "click" });

  assert.equal(dom.byId.get("alert-sound-key-warning").hidden, true);
  assert.equal(dom.byId.get("nav-alerts-dot").hidden, true);
  assert.equal(dom.byId.get("nav-api-dot").hidden, true);
});

test("a focus request from the popup scrolls to and highlights its section, once", async () => {
  const dom = await loadOptions({ storage: { settingsPageFocus: { section: "alerts", at: Date.now() } } });

  assert.equal(dom.byId.get("alerts").scrolledInto, 1);
  assert.equal(dom.byId.get("alerts").classList.contains("section--flash"), true);
  assert.equal("settingsPageFocus" in dom.store, false);
});

test("a focus request arriving while the page is open (the browser reused this tab) scrolls too", async () => {
  const dom = await loadOptions();

  await global.chrome.storage.local.set({ settingsPageFocus: { section: "api", at: Date.now() } });

  assert.equal(dom.byId.get("api").scrolledInto, 1);
  assert.equal("settingsPageFocus" in dom.store, false);
});

test("a stale focus request (from a page that never opened) is dropped without scrolling", async () => {
  const dom = await loadOptions({ storage: { settingsPageFocus: { section: "alerts", at: Date.now() - 60 * 1000 } } });

  assert.equal(dom.byId.get("alerts").scrolledInto, 0);
  assert.equal("settingsPageFocus" in dom.store, false);
});

// --- the side menu's current section ---

const NAV_SECTIONS = ["general", "alerts", "api", "about"];

// The menu links, section positions (px from the window's top) and a
// scrollable window, then the page started on it.
async function loadWithNav(tops, { atBottom = false } = {}) {
  const dom = makeDom();
  const links = NAV_SECTIONS.map((section) => {
    const link = new FakeElement("a");
    link.dataset.section = section;
    return link;
  });
  global.document.querySelectorAll = (selector) => (selector === ".side-nav__link" ? links : []);
  global.document.documentElement = { scrollHeight: 3000 };
  const scrollHandlers = [];
  global.window = { innerHeight: 800, scrollY: atBottom ? 2200 : 0, addEventListener: (type, fn) => type === "scroll" && scrollHandlers.push(fn) };
  NAV_SECTIONS.forEach((section, i) => (dom.byId.get(section).top = tops[i]));
  await initOptionsPage();

  const active = () => links.filter((link) => link.classList.contains("is-active")).map((link) => link.dataset.section);
  const current = () => links.filter((link) => link.attributes["aria-current"] === "true").map((link) => link.dataset.section);
  const scrollTo = (newTops, bottom = false) => {
    NAV_SECTIONS.forEach((section, i) => (dom.byId.get(section).top = newTops[i]));
    global.window.scrollY = bottom ? 2200 : 400;
    scrollHandlers.forEach((fn) => fn());
  };
  return { active, current, scrollTo, scrollHandlers };
}

test("side menu: at the top of the page, General is the current section", async () => {
  const nav = await loadWithNav([24, 600, 1100, 1700, 2400]);

  assert.deepEqual(nav.active(), ["general"]);
  assert.deepEqual(nav.current(), ["general"]);
  assert.equal(nav.scrollHandlers.length, 1);
});

test("side menu: scrolling marks the last section whose top has reached the top of the window", async () => {
  const nav = await loadWithNav([24, 600, 1100, 1700, 2400]);

  nav.scrollTo([-500, 60, 560, 1160, 1860]);
  assert.deepEqual(nav.active(), ["alerts"]);
  assert.deepEqual(nav.current(), ["alerts"]);

  // 140 px down still counts; a section further down doesn't yet.
  nav.scrollTo([-1000, -440, 140, 660, 1360]);
  assert.deepEqual(nav.active(), ["api"]);
  assert.deepEqual(nav.current(), ["api"]);
});

test("side menu: at the bottom, the last section is current even if its top never reaches the top", async () => {
  const nav = await loadWithNav([24, 600, 1100, 1700, 2400]);

  nav.scrollTo([-2000, -1500, -900, -300, 500], true);

  assert.deepEqual(nav.active(), ["about"]);
  assert.deepEqual(nav.current(), ["about"]);
});

// --- opened from a "needs a Steam Web API key" link button (#steam-key) ---

test("opened at #steam-key: intro shown and scrolled to, field focused", async () => {
  const dom = makeDom({ hash: "#steam-key" });
  const focusCalls = [];
  dom.byId.get("steam-api-key").focus = (opts) => focusCalls.push(opts);
  await initOptionsPage();
  delete globalThis.location;

  assert.equal(dom.byId.get("steam-key-intro").hidden, false);
  assert.equal(dom.byId.get("steam-key-intro").scrolledInto, 1);
  assert.deepEqual(focusCalls, [{ preventScroll: true }]);
});

test("at #steam-key, saving the key changes the intro to say the tab can be closed", async () => {
  const dom = makeDom({ hash: "#steam-key" });
  await initOptionsPage();
  delete globalThis.location;

  dom.byId.get("steam-api-key").value = "ABC123";
  await dom.byId.get("steam-save").dispatchEvent({ type: "click" });

  assert.equal(dom.byId.get("steam-key-intro-heading").textContent, "Key saved");
  assert.match(dom.byId.get("steam-key-intro-text").textContent, /close this tab/);
});

test("opened normally, the intro stays hidden and nothing steals focus", async () => {
  const dom = makeDom();
  const focusCalls = [];
  dom.byId.get("steam-api-key").focus = (opts) => focusCalls.push(opts);
  await initOptionsPage();

  assert.equal(dom.byId.get("steam-key-intro").hidden, true);
  assert.deepEqual(focusCalls, []);
});
