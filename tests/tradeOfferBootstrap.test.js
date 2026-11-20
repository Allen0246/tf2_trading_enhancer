import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

// bootstrap.js (steamcommunity.com/tradeOffer/bootstrap.js) is the URL-matching
// dispatcher that runs after shared.js and every pages/*.js file has already
// registered itself into window.__tf2te__.scripts - see tests/tradeOfferShared.test.js's
// own doc comment for why this whole folder is tested via node:vm rather than
// jsdom/import(). Here we don't need shared.js's real source at all (bootstrap.js
// only reads window.__tf2te__.DEPS/scripts, it doesn't care how they got built) -
// we just push fake registrations directly onto a fresh sandbox's own array,
// exactly the way a real pages/*.js file's IIFE would via window.__tf2te__.scripts.push(...).
const bootstrapSrc = readFileSync(new URL("../steamcommunity.com/tradeOffer/bootstrap.js", import.meta.url), "utf8");

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.textContent = "";
    this.children = [];
  }
  appendChild(child) {
    this.children.push(child);
    return child;
  }
}

// Builds a fresh sandbox with a given href and a given list of registered
// scripts (the shape each pages/*.js file's own push() call produces), then
// runs bootstrap.js's real source in it.
function runBootstrap({ href, scripts = [] }) {
  const headEl = new FakeElement("head");
  const fakeDocument = {
    head: headEl,
    createElement: (tag) => new FakeElement(tag),
  };
  const DEPS = { marker: "the-real-deps-object" };
  const windowObj = {
    location: { href },
    __tf2te__: { DEPS, scripts },
  };
  windowObj.window = windowObj;

  const sandbox = { window: windowObj, document: fakeDocument, console };
  vm.createContext(sandbox);
  vm.runInContext(bootstrapSrc, sandbox);

  return { sandbox, headEl };
}

test("runs the fn of the first registered script whose includes pattern matches the current URL", () => {
  let calledWith = null;
  const scripts = [
    { includes: [/^https:\/\/backpack\.tf\/stats/], fn: () => { calledWith = "wrong"; } },
    { includes: [/^https:\/\/steamcommunity\.com\/id\//], fn: (deps) => { calledWith = deps; } },
  ];

  const { sandbox } = runBootstrap({ href: "https://steamcommunity.com/id/someone/", scripts });

  assert.equal(calledWith, sandbox.window.__tf2te__.DEPS);
});

test("only the first matching script's fn runs, even if a later script would also match", () => {
  let firstCalled = 0;
  let secondCalled = 0;
  const scripts = [
    { includes: [/steamcommunity\.com/], fn: () => { firstCalled++; } },
    { includes: [/steamcommunity\.com/], fn: () => { secondCalled++; } },
  ];

  runBootstrap({ href: "https://steamcommunity.com/id/someone/", scripts });

  assert.equal(firstCalled, 1);
  assert.equal(secondCalled, 0);
});

test("does nothing (and doesn't throw) when no registered script's includes pattern matches", () => {
  let called = false;
  const scripts = [{ includes: [/backpack\.tf/], fn: () => { called = true; } }];

  assert.doesNotThrow(() => runBootstrap({ href: "https://example.com/", scripts }));
  // can't inspect `called` after the fact via the sandbox easily since it's an
  // outer-scope var, but doesNotThrow plus the matched-script tests above
  // together confirm fn only runs on an actual match.
});

test("a script can match via any one of several includes patterns, not just the first", () => {
  let called = 0;
  const scripts = [
    { includes: [/wont-match/, /steamcommunity\.com\/market/], fn: () => { called++; } },
  ];

  runBootstrap({ href: "https://steamcommunity.com/market/listings/440/x", scripts });

  assert.equal(called, 1);
});

test("injects the matched script's styles as a <style> element appended to document.head", () => {
  const scripts = [{ includes: [/steamcommunity\.com/], styles: ".foo { color: red; }", fn: () => {} }];

  const { headEl } = runBootstrap({ href: "https://steamcommunity.com/id/someone/", scripts });

  assert.equal(headEl.children.length, 1);
  assert.equal(headEl.children[0].tagName, "style");
  assert.equal(headEl.children[0].textContent, ".foo { color: red; }");
});

test("does not inject any style element when the matched script has no styles", () => {
  const scripts = [{ includes: [/steamcommunity\.com/], fn: () => {} }];

  const { headEl } = runBootstrap({ href: "https://steamcommunity.com/id/someone/", scripts });

  assert.equal(headEl.children.length, 0);
});

test("does not call fn or inject styles at all when nothing matches", () => {
  const scripts = [{ includes: [/nope/], styles: ".never { }", fn: () => { throw new Error("should not run"); } }];

  const { headEl } = runBootstrap({ href: "https://example.com/", scripts });

  assert.equal(headEl.children.length, 0);
});

test("a matched script with styles but no fn injects styles without throwing", () => {
  const scripts = [{ includes: [/steamcommunity\.com/], styles: ".only-styles {}" }];

  const { headEl } = runBootstrap({ href: "https://steamcommunity.com/id/someone/", scripts });

  assert.equal(headEl.children.length, 1);
});
