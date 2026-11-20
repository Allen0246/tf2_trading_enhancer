import { test } from "node:test";
import assert from "node:assert/strict";
import { copyItemName } from "../backpack.tf/nextUI/copyItemName/content.js";

// Same fixture pattern as tests/oldUiCopyItemName.test.js - see that file's
// own header note.

function fakeElement(textContent) {
  // click listeners, split by phase (capture vs bubble) - same distinction
  // content.js's own header note documents (its own listener registers
  // with {capture: true} specifically so it can win a race against a
  // NATIVE bubble-phase listener already on the same element).
  const clickListeners = { capture: [], bubble: [] };
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
      if (eventName !== "click") return;
      clickListeners[options?.capture ? "capture" : "bubble"].push(cb);
    },
    // Fires every capture-phase listener first (registration order), then
    // every bubble-phase one, matching real DOM dispatch order for
    // listeners on the SAME element - unless a capture listener calls
    // stopImmediatePropagation(), which stops any bubble listener (a
    // stand-in for next.backpack.tf's own native click-to-navigate
    // handler) from running at all.
    async _click() {
      let stopped = false;
      const event = {
        preventDefault() {},
        stopPropagation() {
          stopped = true;
        },
        stopImmediatePropagation() {
          stopped = true;
        },
      };
      for (const cb of clickListeners.capture) {
        await cb(event);
        if (stopped) return;
      }
      for (const cb of clickListeners.bubble) {
        await cb(event);
        if (stopped) return;
      }
    },
  };
}

function setupDom(bySelector, { pathname = "/classifieds" } = {}) {
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
  global.window = { location: { pathname } };
}

function installFakeClipboard(writeTextImpl) {
  Object.defineProperty(global, "navigator", {
    value: { clipboard: { writeText: writeTextImpl } },
    configurable: true,
  });
}

test("makes a classifieds listing's own item name clickable and copies its cleaned text", async () => {
  const el = fakeElement("  Max's   Severed Head \n");
  setupDom({ ".listing__details__header": [el] });
  const written = [];
  installFakeClipboard(async (text) => {
    written.push(text);
  });

  copyItemName();
  await el._click();

  assert.deepEqual(written, ["Max's Severed Head"]);
  assert.equal(el.classList.contains("tf2te-copy-item-name-success"), true);
});

test("makes an item-preview hover tooltip's own title clickable too", async () => {
  const el = fakeElement("Professional Killstreak Eyelander Kit");
  setupDom({ ".listing__details__header": [], ".item-tooltip__header__title": [el] });
  const written = [];
  installFakeClipboard(async (text) => {
    written.push(text);
  });

  copyItemName();
  await el._click();

  assert.deepEqual(written, ["Professional Killstreak Eyelander Kit"]);
});

// REGRESSION for a live bug report: on a Classifieds Listing's own
// item-preview tooltip (which has its own native "On Click: View Listing"
// behavior baked directly into the same title element), copying silently
// didn't work - next.backpack.tf's own native click handler, attached to the
// page before this content script's MutationObserver ever ran, fired FIRST
// as a normal bubble-phase listener, so a plain stopPropagation() from a
// LATER bubble-phase listener (this feature's own, as it used to be) could
// never stop it. Registering in the capture phase - simulated here by a fake
// native bubble-phase listener registered on the SAME element - fixes this:
// it must fire before, and be able to fully suppress, that native handler.
test("wins a race against a native bubble-phase click handler already on the same element (e.g. a Classifieds Listing tooltip's own 'View Listing' click)", async () => {
  const el = fakeElement("Professional Killstreak Australium Medi Gun");
  setupDom({ ".listing__details__header": [], ".item-tooltip__header__title": [el] });
  const written = [];
  installFakeClipboard(async (text) => {
    written.push(text);
  });

  copyItemName();

  // A stand-in for next.backpack.tf's own native "View Listing" handler -
  // registered directly on the SAME element, in the ordinary bubble phase.
  let nativeHandlerFired = false;
  el.addEventListener("click", () => {
    nativeHandlerFired = true;
  });

  await el._click();

  assert.deepEqual(written, ["Professional Killstreak Australium Medi Gun"]);
  assert.equal(nativeHandlerFired, false);
});

test("shows error feedback (not success) when the clipboard write rejects", async () => {
  const el = fakeElement("Refined Metal");
  setupDom({ ".listing__details__header": [el] });
  installFakeClipboard(async () => {
    throw new Error("denied");
  });

  copyItemName();
  await el._click();

  assert.equal(el.classList.contains("tf2te-copy-item-name-error"), true);
  assert.equal(el.classList.contains("tf2te-copy-item-name-success"), false);
});

test("never wires up the same element twice (idempotent across repeated scans)", () => {
  const el = fakeElement("Refined Metal");
  let addEventListenerCalls = 0;
  const originalAdd = el.addEventListener.bind(el);
  el.addEventListener = (...args) => {
    addEventListenerCalls++;
    originalAdd(...args);
  };
  setupDom({ ".listing__details__header": [el] });
  installFakeClipboard(async () => {});

  copyItemName();
  copyItemName();

  assert.equal(addEventListenerCalls, 1);
});

test("does nothing when neither target selector matches anything on the page", () => {
  setupDom({});
  assert.doesNotThrow(() => copyItemName());
});

test("makes a /stats page's own item title clickable too", async () => {
  const el = fakeElement("  The Buff Banner \n");
  setupDom({ "h2.m-0.mb-2": [el] }, { pathname: "/stats" });
  const written = [];
  installFakeClipboard(async (text) => {
    written.push(text);
  });

  copyItemName();
  await el._click();

  assert.deepEqual(written, ["The Buff Banner"]);
});

test("does not query the /stats page's own title selector on any other page - too generic (plain Bootstrap utility classes) to risk site-wide", () => {
  const el = fakeElement("The Buff Banner");
  let queried = false;
  setupDom(
    {
      get "h2.m-0.mb-2"() {
        queried = true;
        return [el];
      },
    },
    { pathname: "/classifieds" }
  );

  copyItemName();

  assert.equal(queried, false);
});
