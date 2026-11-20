import { test } from "node:test";
import assert from "node:assert/strict";

// posts.tf/content.js is the same router shape as mannco.store/content.js
// (see tests/manncoStoreContent.test.js's own header comment for the shared
// pattern/rationale) - an async function (routePostsTf) exposed via
// globalThis.__postsTfTestHooks.run for tests to call repeatedly, since it
// can't gain an `export` (loaded as a classic content script, not a module -
// see manifest.json). Unlike every other router in this codebase, this one
// isn't pathname-scoped at all (see content.js's own header note) - it
// always loads the one feature it has, regardless of URL.
function fakeGetURL(path) {
  return new URL(`../${path}`, import.meta.url).href;
}

async function waitUntil(conditionFn, { timeoutMs = 2000, intervalMs = 5 } = {}) {
  const start = Date.now();
  while (!conditionFn()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitUntil: condition never became true");
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

// itemQuickLinks() (dynamically imported and called for real) bails out
// immediately once its own document.querySelectorAll(".post-item-modal")
// finds nothing - kept deliberately empty since this file only cares about
// the ROUTER's dispatch decision, not itemQuickLinks' own full behavior
// (covered separately, in tests/postsTfItemQuickLinks.test.js).
function installSafeGlobals() {
  global.document = {
    body: { nodeType: 1 },
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    createElement: () => ({ style: {}, classList: { add() {}, contains: () => false }, appendChild() {}, append() {} }),
  };
  global.MutationObserver = class {
    observe() {}
  };
}

installSafeGlobals();
const primingListeners = [];
global.chrome = {
  runtime: { getURL: fakeGetURL, onMessage: { addListener: (cb) => primingListeners.push(cb) } },
};
global.window = { location: { href: "https://posts.tf/" } };
await import("../posts.tf/content.js");
await waitUntil(() => primingListeners.length > 0);

async function runRouterFor(href) {
  installSafeGlobals();
  const messageListeners = [];
  global.chrome = {
    runtime: { getURL: fakeGetURL, onMessage: { addListener: (cb) => messageListeners.push(cb) } },
  };
  global.window = { location: { href } };

  await globalThis.__postsTfTestHooks.run();
  await waitUntil(() => messageListeners.length > 0);

  let info;
  messageListeners[0]({ type: "GET_LOADED_SCRIPTS" }, {}, (response) => (info = response));
  await waitUntil(() => info && info.settled);
  return info;
}

test("posts.tf's own board page loads the 'Item Quick Links' feature", async () => {
  const info = await runRouterFor("https://posts.tf/");
  assert.deepEqual(info.scripts, ["Item Quick Links"]);
  assert.equal(info.settled, true);
});

test("an individual post page also loads the feature - not pathname-scoped at all", async () => {
  const info = await runRouterFor("https://posts.tf/posts/12345");
  assert.deepEqual(info.scripts, ["Item Quick Links"]);
  assert.equal(info.settled, true);
});
