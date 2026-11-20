import { test } from "node:test";
import assert from "node:assert/strict";

// apiKeyStatus/content.js is a one-shot router (routeApiKeyStatus) whose
// whole DOM-insertion decision (which of 3 messages, and whether it lands
// next to Steam's own "Revoke My Steam Web API Key" form or falls back to a
// floating banner) happens once per call, with showApiKeyStatus() fired off
// fire-and-forget (not awaited) before registry.label/settle run.
//
// content.js can't gain an `export` (it's loaded as a classic content
// script, not a module - see manifest.json), so it exposes
// globalThis.__apiKeyStatusTestHooks.run (== routeApiKeyStatus) purely for
// tests to call repeatedly. This module is therefore imported ONCE below,
// not via a fresh cache-busting dynamic import per test - the fresh-import
// approach was used here previously, but it defeats Node's
// --experimental-test-coverage reporting for this file (node's coverage
// reporter keeps only the last-loaded script instance's coverage per file
// path, not a merge across instances - see utils/tf2Schema.js's own
// __resetSchemaCacheForTests for the full writeup of that bug).
function fakeGetURL(path) {
  return new URL(`../${path}`, import.meta.url).href;
}

function createFakeElement(tag) {
  return {
    tagName: tag,
    style: {},
    _textContent: "",
    get textContent() {
      return this._textContent;
    },
    set textContent(v) {
      this._textContent = v;
    },
    insertedSiblings: [],
    insertAdjacentElement(position, el) {
      this.insertedSiblings.push({ position, el });
    },
    children: [],
    appendChild(el) {
      this.children.push(el);
      return el;
    },
  };
}

function fakeStorageLocal(data) {
  return {
    get: async (keys) => {
      const result = {};
      for (const k of keys) if (k in data) result[k] = data[k];
      return result;
    },
  };
}

// pageText: the text of Steam's #bodyContents_ex, where /dev/apikey shows
// "Key: <32 hex chars>" for a registered key. Omitted = no key on the page.
function installGlobals({ storageData = {}, revokeForm = undefined, pageText = null } = {}) {
  const documentElement = createFakeElement("html");
  const resolvedRevokeForm = revokeForm === undefined ? createFakeElement("form") : revokeForm;

  globalThis.chrome = {
    runtime: {
      getURL: fakeGetURL,
      onMessage: { addListener: () => {} },
    },
    storage: { local: fakeStorageLocal(storageData) },
  };
  globalThis.document = {
    getElementById: (id) => {
      if (id === "editForm") return resolvedRevokeForm;
      if (id === "bodyContents_ex" && pageText !== null) return { textContent: pageText };
      return null;
    },
    createElement: (tag) => createFakeElement(tag),
    documentElement,
  };
  // createScriptRegistry (utils/scriptRouter.js) reads window.location.hostname
  // synchronously when the registry is created.
  globalThis.window = { location: { hostname: "steamcommunity.com" } };

  return { documentElement, revokeForm: resolvedRevokeForm };
}

async function flushMicrotasks() {
  // showApiKeyStatus() is called fire-and-forget inside routeApiKeyStatus
  // (not awaited before registry.label/settle run) - flush a couple of
  // microtask/macrotask turns so its own chrome.storage.local.get await (and
  // the DOM insertion after it) has actually completed before moving on.
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

// Installs a placeholder document/chrome so content.js's own top-level
// routeApiKeyStatus() call (see that file's own note) has something to read
// on this ONE-TIME import - and flushes its fire-and-forget
// showApiKeyStatus() to completion before any test swaps in its own
// document/chrome, so that stale in-flight call can't resume later and
// insert into a test's own DOM fixture.
installGlobals();
await import("../steamcommunity.com/apiKeyStatus/content.js");
await flushMicrotasks();

async function runRoute() {
  await globalThis.__apiKeyStatusTestHooks.run();
  await flushMicrotasks();
}

test("shows the 'schema loaded' message with item count when a cache with fetchedAt is present, inserted after the revoke form", async () => {
  const { revokeForm } = installGlobals({
    storageData: {
      steamApiKey: "KEY123",
      tf2SchemaCache: { fetchedAt: Date.now(), schemaShapeVersion: 4, itemNameToDefindex: { a: 1, b: 2, c: 3 } },
    },
  });

  await runRoute();

  assert.equal(revokeForm.insertedSiblings.length, 1);
  const { position, el: note } = revokeForm.insertedSiblings[0];
  assert.equal(position, "afterend");
  assert.match(note.textContent, /item schema loaded, 3 items/);
  assert.match(note.style.cssText, /#4caf82/);
});

test("shows the 'key saved, schema will load later' message when a key is saved but no cache exists yet", async () => {
  const { revokeForm } = installGlobals({ storageData: { steamApiKey: "KEY123" } });

  await runRoute();

  const note = revokeForm.insertedSiblings[0].el;
  assert.match(note.textContent, /has a key saved/);
  assert.match(note.style.cssText, /#d0a04a/);
});

test("shows the 'no key saved' message when neither a key nor a cache exists", async () => {
  const { revokeForm } = installGlobals({ storageData: {} });

  await runRoute();

  const note = revokeForm.insertedSiblings[0].el;
  assert.match(note.textContent, /no key saved yet/);
  assert.match(note.style.cssText, /#c96260/);
});

test("falls back to a floating corner banner appended to document.documentElement when the revoke form isn't found", async () => {
  const { documentElement } = installGlobals({ storageData: { steamApiKey: "KEY123" }, revokeForm: null });

  await runRoute();

  assert.equal(documentElement.children.length, 1);
  const note = documentElement.children[0];
  assert.match(note.textContent, /has a key saved/);
  // Fallback path appends the extra floating-banner CSS on top of the base
  // color/font-weight/margin-top styling, rather than replacing it.
  assert.match(note.style.cssText, /position: fixed/);
  assert.match(note.style.cssText, /#d0a04a/);
});

// --- comparing the key Steam shows with the saved one (API key scam: a key
// a scammer registered must never be vouched for) ---

const PAGE_KEY = "0123456789ABCDEF0123456789ABCDEF";
const PAGE_TEXT = `Your Steam Web API Key
Key: ${PAGE_KEY}
Domain Name: localhost`;

test("says 'using this key' only when the key on the page is the saved one (case-insensitive)", async () => {
  const { revokeForm } = installGlobals({
    pageText: PAGE_TEXT,
    storageData: {
      steamApiKey: PAGE_KEY.toLowerCase(),
      tf2SchemaCache: { fetchedAt: Date.now(), schemaShapeVersion: 4, itemNameToDefindex: { a: 1 } },
    },
  });

  await runRoute();

  const note = revokeForm.insertedSiblings[0].el;
  assert.match(note.textContent, /is using this key \(item schema loaded, 1 items\)/);
  assert.match(note.style.cssText, /#4caf82/);
});

test("says 'has this key saved' when the page key matches but the schema isn't loaded yet", async () => {
  const { revokeForm } = installGlobals({ pageText: PAGE_TEXT, storageData: { steamApiKey: PAGE_KEY } });

  await runRoute();

  assert.match(revokeForm.insertedSiblings[0].el.textContent, /has this key saved/);
});

test("warns to revoke when the key on the page is NOT the saved one, even with the schema loaded", async () => {
  const { revokeForm } = installGlobals({
    pageText: PAGE_TEXT,
    storageData: {
      steamApiKey: "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF",
      tf2SchemaCache: { fetchedAt: Date.now(), schemaShapeVersion: 4, itemNameToDefindex: { a: 1 } },
    },
  });

  await runRoute();

  const note = revokeForm.insertedSiblings[0].el;
  assert.match(note.textContent, /NOT the key saved in TF2 Trading Enhancer/);
  assert.match(note.textContent, /revoke it now/);
  assert.doesNotMatch(note.textContent, /is using/);
  assert.match(note.style.cssText, /#ff5c5c/);
});

test("with no key saved, a key on the page gets a 'revoke it if it isn't yours' hint", async () => {
  const { revokeForm } = installGlobals({ pageText: PAGE_TEXT, storageData: {} });

  await runRoute();

  const note = revokeForm.insertedSiblings[0].el;
  assert.match(note.textContent, /no key saved yet/);
  assert.match(note.textContent, /If you didn't register this key yourself, revoke it now/);
});
