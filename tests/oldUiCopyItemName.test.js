import { test } from "node:test";
import assert from "node:assert/strict";
import { copyItemName } from "../backpack.tf/oldUI/copyItemName/content.js";

// Minimal hand-rolled fakes (see tests/helpers/fakeDom.js's own header on why
// this repo hand-rolls rather than pulling in jsdom).

function fakeElement(textContent) {
  const listeners = {};
  const listenerOptions = {};
  const classSet = new Set();
  return {
    textContent,
    title: "",
    classList: {
      contains: (c) => classSet.has(c),
      add: (c) => classSet.add(c),
      remove: (c) => classSet.delete(c),
    },
    addEventListener(eventName, cb, options) {
      listeners[eventName] = cb;
      listenerOptions[eventName] = options;
    },
    _listenerOptions(eventName) {
      return listenerOptions[eventName];
    },
    async _click() {
      const event = { preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} };
      return listeners.click?.(event);
    },
  };
}

function setupDom(bySelector) {
  global.document = {
    head: { appendChild() {} },
    getElementById: () => null,
    createElement: () => ({ textContent: "" }),
    querySelectorAll: (selector) => bySelector[selector] || [],
    body: {},
  };
  global.MutationObserver = class {
    observe() {}
  };
}

// Node's own built-in `navigator` global (Node 21+) is a read-only getter -
// a plain `global.navigator = ...` assignment throws, so this needs
// Object.defineProperty to actually override it for the duration of a test.
function installFakeClipboard(writeTextImpl) {
  Object.defineProperty(global, "navigator", {
    value: { clipboard: { writeText: writeTextImpl } },
    configurable: true,
  });
}

test("makes a listing title clickable and copies its cleaned text on click", async () => {
  const el = fakeElement("  Max's   Severed Head \n");
  setupDom({ ".listing-title h5": [el] });
  const written = [];
  installFakeClipboard(async (text) => {
    written.push(text);
  });

  copyItemName();
  await el._click();

  assert.deepEqual(written, ["Max's Severed Head"]);
  assert.equal(el.classList.contains("tf2te-copy-item-name-success"), true);
  // Registered in the capture phase - see ../../nextUI/copyItemName/content.js's
  // own matching fix for why (a defensive measure against a native
  // click-to-navigate handler that could otherwise fire first).
  assert.equal(el._listenerOptions("click")?.capture, true);
});

test("makes a /stats page title and a popover title clickable too", async () => {
  const statsTitle = fakeElement("Rocket Launcher");
  const popoverTitle = fakeElement("Scrap Metal");
  setupDom({
    ".listing-title h5": [],
    ".stats-header-title": [statsTitle],
    ".popover-title": [popoverTitle],
  });
  const written = [];
  installFakeClipboard(async (text) => {
    written.push(text);
  });

  copyItemName();
  await statsTitle._click();
  await popoverTitle._click();

  assert.deepEqual(written, ["Rocket Launcher", "Scrap Metal"]);
});

test("shows error feedback (not success) when the clipboard write rejects", async () => {
  const el = fakeElement("Refined Metal");
  setupDom({ ".listing-title h5": [el] });
  installFakeClipboard(async () => {
    throw new Error("denied");
  });

  copyItemName();
  await el._click();

  assert.equal(el.classList.contains("tf2te-copy-item-name-error"), true);
  assert.equal(el.classList.contains("tf2te-copy-item-name-success"), false);
});

test("does nothing (no clipboard call) when the element's text is empty/whitespace-only", async () => {
  const el = fakeElement("   ");
  setupDom({ ".listing-title h5": [el] });
  const written = [];
  installFakeClipboard(async (text) => {
    written.push(text);
  });

  copyItemName();
  await el._click();

  assert.deepEqual(written, []);
});

test("never wires up the same element twice (idempotent across repeated scans)", async () => {
  const el = fakeElement("Refined Metal");
  let addEventListenerCalls = 0;
  const originalAdd = el.addEventListener.bind(el);
  el.addEventListener = (...args) => {
    addEventListenerCalls++;
    originalAdd(...args);
  };
  setupDom({ ".listing-title h5": [el] });
  installFakeClipboard(async () => {});

  copyItemName();
  copyItemName(); // simulates a second scan (e.g. a re-triggered observer)

  assert.equal(addEventListenerCalls, 1);
});

test("does nothing when none of the target selectors match anything on the page", () => {
  setupDom({});
  assert.doesNotThrow(() => copyItemName());
});
