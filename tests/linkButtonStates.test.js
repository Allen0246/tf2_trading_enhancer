import { test, mock } from "node:test";
import assert from "node:assert/strict";

const sentMessages = [];
let savedSteamApiKey = null;
globalThis.chrome = {
  storage: {
    local: {
      async get() {
        return savedSteamApiKey ? { steamApiKey: savedSteamApiKey } : {};
      },
    },
  },
  runtime: {
    getURL: (path) => path,
    async sendMessage(message) {
      sentMessages.push(message);
    },
  },
};

const {
  postsTfNeedsApiKey,
  applyPostsTfKeyHint,
  clearPostsTfKeyHint,
  startRetryCountdown,
  clearRetryCountdown,
  applyLoadingState,
  fillPricedbSlot,
  POSTS_TF_KEY_HINT_TITLE,
} = await import("../utils/linkButtonStates.js");

// Just the surface the helpers touch.
class FakeElement {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this._attrs = {};
    this.dataset = {};
    this.style = {};
    this.listeners = {};
    this.isConnected = true;
  }
  get textContent() {
    return this.children.map((c) => c.textContent ?? "").join("");
  }
  set textContent(v) {
    this.children = v ? [{ textContent: String(v) }] : [];
  }
  appendChild(child) {
    this.children.push(child);
    return child;
  }
  append(...nodes) {
    for (const n of nodes) this.children.push(typeof n === "string" ? { textContent: n } : n);
  }
  setAttribute(name, value) {
    this._attrs[name] = value;
  }
  getAttribute(name) {
    return name in this._attrs ? this._attrs[name] : null;
  }
  removeAttribute(name) {
    delete this._attrs[name];
    if (name === "title") delete this.title;
  }
  addEventListener(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }
  replaceWith(el) {
    this.replacedWith = el;
    this.isConnected = false;
  }
  remove() {
    this.removed = true;
    this.isConnected = false;
  }
  fire(type, extra = {}) {
    let prevented = false;
    for (const fn of this.listeners[type] || []) {
      fn({ type, currentTarget: this, preventDefault: () => (prevented = true), stopPropagation() {}, ...extra });
    }
    return prevented;
  }
}
globalThis.document = { createElementNS: (_ns, tag) => new FakeElement(tag) };

test("postsTfNeedsApiKey: only for a covered item type with no link AND no saved key", async () => {
  const plainHat = { itemName: "Brotherhood of Arms", quality: "Unique" };
  savedSteamApiKey = null;
  assert.equal(await postsTfNeedsApiKey(plainHat, null), true);
  assert.equal(await postsTfNeedsApiKey(plainHat, "https://posts.tf/..."), false, "already linked");
  assert.equal(await postsTfNeedsApiKey({ ...plainHat, killstreakKit: true }, null), false, "type posts.tf doesn't cover");
  assert.equal(await postsTfNeedsApiKey(null, null), false);

  savedSteamApiKey = "ABC123";
  assert.equal(await postsTfNeedsApiKey(plainHat, null), false, "a key is saved - a key wouldn't help");
  savedSteamApiKey = null;
});

test("the key hint opens settings on click and on Enter/Space, but ignores other keys", () => {
  const button = new FakeElement("a");
  button.setAttribute("href", "https://posts.tf/old");
  applyPostsTfKeyHint(button);

  assert.equal(button.getAttribute("href"), null);
  assert.equal(button.title, POSTS_TF_KEY_HINT_TITLE);
  assert.equal(button.textContent, "posts.tf");

  sentMessages.length = 0;
  assert.equal(button.fire("click"), true);
  assert.equal(button.fire("keydown", { key: "Enter" }), true);
  assert.equal(button.fire("keydown", { key: " " }), true);
  assert.equal(button.fire("keydown", { key: "a" }), false);
  assert.equal(sentMessages.length, 3);
  assert.ok(sentMessages.every((m) => m.type === "OPEN_STEAM_API_KEY_SETTINGS"));
});

test("applying the key hint twice doesn't double-bind; clearing it makes clicks plain again", () => {
  const button = new FakeElement("a");
  applyPostsTfKeyHint(button);
  applyPostsTfKeyHint(button);
  assert.equal(button.listeners.click.length, 1);

  clearPostsTfKeyHint(button);
  sentMessages.length = 0;
  assert.equal(button.fire("click"), false, "a real link's click must not be intercepted");
  assert.equal(sentMessages.length, 0);
  assert.equal(button.dataset.tf2teNeedsKey, undefined);
});

test("the countdown rounds Retry-After up to whole seconds (min 1s) and reports whether the button is still on the page", () => {
  mock.timers.enable({ apis: ["setInterval"] });
  try {
    const button = new FakeElement("span");
    const retries = [];
    startRetryCountdown(button, { label: "pricedb.io", retryAfterMs: 1500, onRetry: (connected) => retries.push(connected) });
    assert.equal(button.textContent, "pricedb.io 2s");

    mock.timers.tick(1000);
    assert.equal(button.textContent, "pricedb.io 1s");
    button.isConnected = false;
    mock.timers.tick(1000);
    assert.deepEqual(retries, [false]);

    mock.timers.tick(5000);
    assert.deepEqual(retries, [false], "fires once only");

    const tiny = new FakeElement("span");
    startRetryCountdown(tiny, { label: "pricedb.io", retryAfterMs: 10, onRetry() {} });
    assert.equal(tiny.textContent, "pricedb.io 1s");
  } finally {
    mock.timers.reset();
  }
});

test("clearRetryCountdown stops the timer and restores the plain label", () => {
  mock.timers.enable({ apis: ["setInterval"] });
  try {
    const button = new FakeElement("a");
    let retried = false;
    startRetryCountdown(button, { label: "pricedb.io", retryAfterMs: 3000, onRetry: () => (retried = true) });
    clearRetryCountdown(button, "pricedb.io");

    mock.timers.tick(10000);
    assert.equal(retried, false);
    assert.equal(button.textContent, "pricedb.io");
    assert.equal(button.style.opacity, "");
    assert.equal(button.title, undefined);
  } finally {
    mock.timers.reset();
  }
});

test("applyLoadingState shows the label with a spinner, dimmed, busy, with an explaining title", () => {
  const button = new FakeElement("span");
  applyLoadingState(button);
  assert.equal(button.textContent, "pricedb.io");
  assert.equal(button.children.length, 2, "label text + spinner icon");
  assert.equal(button.getAttribute("aria-busy"), "true");
  assert.equal(button.style.cursor, "progress");
  assert.match(button.title, /Looking up this item on pricedb\.io/);
});

test("fillPricedbSlot swaps the loading slot for the real link when pricedb.io finds the item", async () => {
  const slot = new FakeElement("span");
  applyLoadingState(slot);
  await fillPricedbSlot(slot, {
    lookup: async () => ({ sku: "6522;6;td-773", rateLimited: false }),
    buildLink: (href) => ({ href }),
  });
  assert.deepEqual(slot.replacedWith, { href: "https://pricedb.io/item/6522%3B6%3Btd-773" });
});

test("fillPricedbSlot removes the slot for a genuine no-listing answer", async () => {
  const slot = new FakeElement("span");
  await fillPricedbSlot(slot, { lookup: async () => ({ sku: null, rateLimited: false }), buildLink: () => ({}) });
  assert.equal(slot.removed, true);
});

test("fillPricedbSlot ignores a stale answer (a different item is showing by now)", async () => {
  const slot = new FakeElement("span");
  await fillPricedbSlot(slot, { lookup: async () => ({ sku: "1;6" }), buildLink: () => ({}), isCurrent: () => false });
  assert.equal(slot.replacedWith, undefined);
  assert.equal(slot.removed, undefined);
});

test("fillPricedbSlot turns a 429 into the countdown, then loads again in place and resolves", async () => {
  mock.timers.enable({ apis: ["setInterval"] });
  try {
    const slot = new FakeElement("span");
    let calls = 0;
    const lookup = async () => (++calls === 1 ? { sku: null, rateLimited: true, retryAfterMs: 2000 } : { sku: "1;6", rateLimited: false });
    await fillPricedbSlot(slot, { lookup, buildLink: (href) => ({ href }) });
    assert.equal(slot.textContent, "pricedb.io 2s");
    assert.equal(slot.getAttribute("aria-busy"), null, "a countdown is not 'loading'");

    mock.timers.tick(2000);
    assert.equal(slot.getAttribute("aria-busy"), "true", "loading again while retrying");
    await new Promise((r) => setImmediate(r));
    assert.equal(calls, 2);
    assert.deepEqual(slot.replacedWith, { href: "https://pricedb.io/item/1%3B6" });
  } finally {
    mock.timers.reset();
  }
});
