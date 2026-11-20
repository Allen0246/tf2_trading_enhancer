import { test } from "node:test";
import assert from "node:assert/strict";
import { needsReload, watchMarketNavigation } from "../steamcommunity.com/marketNavigation/content.js";

const UNUSUAL = "/market/listings/440/Unusual%20Taunt%3A%20The%20Trackman's%20Touchdown";
const OTHER = "/market/listings/440/Unusual%20Team%20Captain";

test("needsReload: only for a TF2 listing other than the one the page loaded on", () => {
  assert.equal(needsReload("/market/search", UNUSUAL, null), true); // opened from the Market search (confirmed live)
  assert.equal(needsReload(UNUSUAL, OTHER, null), true);
  assert.equal(needsReload(UNUSUAL, UNUSUAL, null), false);
  assert.equal(needsReload(UNUSUAL, "/market/search", null), false);
  assert.equal(needsReload("/market/search", "/market/listings/730/AK-47%20%7C%20Redline", null), false); // not TF2
  // Same listing, written differently (Steam's own encoding vs ours).
  assert.equal(needsReload("/market/listings/440/Unusual%20Taunt%3A%20The%20Trackman%27s%20Touchdown", UNUSUAL, null), false);
});

test("needsReload: a page that is a reload done moments ago never reloads again, an older one does", () => {
  const now = 1_000_000;
  const freshReload = { path: UNUSUAL, at: now - 2000 };
  // Steam rewriting the address right after the reload must not loop.
  assert.equal(needsReload(UNUSUAL, `${UNUSUAL}-rewritten`, freshReload, now), false);
  assert.equal(needsReload(UNUSUAL, OTHER, { path: UNUSUAL, at: now - 60_000 }, now), true);
  // A reload for another listing doesn't block this one.
  assert.equal(needsReload("/market/search", UNUSUAL, { path: OTHER, at: now - 2000 }, now), true);
});

function installPage(pathname, session = {}) {
  let onMutation;
  let reloads = 0;
  globalThis.document = { body: {} };
  globalThis.MutationObserver = class {
    constructor(cb) {
      onMutation = cb;
    }
    observe() {}
  };
  globalThis.window = {
    location: { pathname, reload: () => reloads++ },
    sessionStorage: {
      getItem: (key) => session[key] ?? null,
      setItem: (key, value) => (session[key] = value),
    },
    addEventListener() {},
  };
  return {
    navigate(path) {
      window.location.pathname = path;
      onMutation();
    },
    reloads: () => reloads,
    session,
  };
}

test("watchMarketNavigation reloads once when an in-app click lands on a TF2 listing", () => {
  const page = installPage("/market/search");
  watchMarketNavigation();

  page.navigate("/market/search?q=unusual"); // still searching
  assert.equal(page.reloads(), 0);

  page.navigate(UNUSUAL);
  page.navigate(UNUSUAL); // more DOM changes while the reload is underway
  assert.equal(page.reloads(), 1);
  assert.equal(JSON.parse(page.session["tf2te-market-last-reload"]).path, UNUSUAL);
});

test("watchMarketNavigation leaves the listing it loaded on alone", () => {
  const page = installPage(UNUSUAL);
  watchMarketNavigation();

  page.navigate(UNUSUAL);
  assert.equal(page.reloads(), 0);
});
