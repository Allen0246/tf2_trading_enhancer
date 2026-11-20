import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { resetFakeDom, createFakeDocument } from "./helpers/fakeDom.js";
import { __resetPricedbCacheForTests } from "../utils/pricedb.js";
import { __resetSchemaCacheForTests } from "../utils/tf2Schema.js";

// Real setTimeout, not a faked one - needed to actually drain the pricedb.io
// splice's own pending microtask/macrotask work between test steps below
// (same pattern tests/itemQuickLinks.test.js's own flush() already uses for
// the identical steamcommunity.com-side splice).
function flush(ticks = 6) {
  return (async () => {
    for (let i = 0; i < ticks; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  })();
}

// A button in utils/linkButtonStates.js's loading state (label + spinner)
// for the given service.
function isLoadingSlot(el, label) {
  return el.dataset?.tf2teLoading === "1" && el.textContent.startsWith(label);
}

// itemCard.js's own update() calls the REAL resolveItemDetails.js -> itemShape.js
// chain (already fully covered by tests/itemShape.test.js/tests/
// itemLinksLinks.test.js) - same "fake chrome once at file scope" approach
// those files use, since neither module touches chrome/window at import
// time, only inside the async functions this file's own tests call into.
globalThis.chrome = {
  storage: {
    local: {
      get: async () => ({
        tf2SchemaCache: {
          itemNameToDefindex: {},
          defindexToItemName: {},
          effectNameToId: { "Fountain of Delight": 22 },
          fetchedAt: Date.now(),
          schemaShapeVersion: 4,
        },
      }),
      set: async () => {},
    },
  },
  runtime: {
    sendMessage: async () => ({ ok: false, error: "no live fetch expected in this test file" }),
    getURL: (path) => path,
  },
};
globalThis.fetch = async () => ({ json: async () => [] });
global.window = { location: { pathname: "/buy/hats" } };

const { createItemCard } = await import("../scrap.tf/itemLinks/itemCard.js");

function fakeItemEl({ classes = [], defindex = null, dataContent = null, dataId = null, style = null } = {}) {
  return {
    classList: { contains: (name) => classes.includes(name) },
    getAttribute: (name) => {
      if (name === "data-defindex") return defindex;
      if (name === "data-content") return dataContent;
      if (name === "data-id") return dataId;
      if (name === "style") return style;
      return null;
    },
  };
}

test.beforeEach(() => {
  resetFakeDom();
  global.document = createFakeDocument();
  globalThis.chrome.runtime.sendMessage = async () => ({ ok: false, error: "no live fetch expected in this test file" });
  // utils/pricedb.js's own in-memory cache is keyed per item name, not per
  // test - several tests below reuse "Rocket Launcher" with a different
  // sendMessage fixture than an earlier test used for that same name.
  __resetPricedbCacheForTests();
});

// Same fixture pattern tests/nextUiCopyItemName.test.js/
// tests/oldUiCopyItemName.test.js already use for their own click-to-copy
// coverage.
function installFakeClipboard(writeTextImpl) {
  Object.defineProperty(global, "navigator", {
    value: { clipboard: { writeText: writeTextImpl } },
    configurable: true,
  });
}

test("createItemCard injects its stylesheet once and appends the item card to documentElement with its initial placeholder text", () => {
  createItemCard();

  const styleEls = document.head.children.filter((c) => c.tagName === "STYLE");
  assert.equal(styleEls.length, 1);

  const cardEl = document.documentElement.querySelector("#tf2te-item-card");
  assert.ok(cardEl);
  assert.equal(cardEl.querySelector(".tf2te-item-card-name").textContent, "Middle-click an item…");
});

test("update() resolves a plain Unique item and shows its name with no optional lines", async () => {
  const { update } = createItemCard();
  await update("Rocket Launcher", fakeItemEl());

  const cardEl = document.documentElement.querySelector("#tf2te-item-card");
  assert.equal(cardEl.querySelector(".tf2te-item-card-name").textContent, "Rocket Launcher");
  assert.equal(cardEl.querySelector(".tf2te-item-card-skin").hidden, true);
  assert.equal(cardEl.querySelector(".tf2te-item-card-effect").hidden, true);
  assert.equal(cardEl.querySelector(".tf2te-item-card-level").hidden, true);
  assert.equal(cardEl.querySelector(".tf2te-item-card-festivized").hidden, true);
  assert.equal(cardEl.querySelector(".tf2te-item-card-uncraft").hidden, true);
});

// Positioned last among the info lines (in both the template and update()'s
// own render order) - it should read as the final line under whichever other
// attributes happen to be shown for a given item, matching scrap.tf's own
// native tooltip (which shows "Uncraftable" after every other attribute,
// right above the price line).
test("update() shows an 'Uncraftable' line for a Non-Craftable item, off the itemEl's own 'uncraft' class", async () => {
  const { update } = createItemCard();
  await update("Rocket Launcher", fakeItemEl({ classes: ["uncraft"] }));

  const cardEl = document.documentElement.querySelector("#tf2te-item-card");
  const uncraftEl = cardEl.querySelector(".tf2te-item-card-uncraft");
  assert.equal(uncraftEl.hidden, false);
  assert.equal(uncraftEl.textContent, "Uncraftable");
});

test("update() shows no 'Uncraftable' line at all for a craftable item", async () => {
  const { update } = createItemCard();
  await update("Rocket Launcher", fakeItemEl());

  const cardEl = document.documentElement.querySelector("#tf2te-item-card");
  assert.equal(cardEl.querySelector(".tf2te-item-card-uncraft").hidden, true);
});

// REQUESTED live: on a cold cache (a real Steam Web API schema fetch, e.g.
// for an Unusual's own effect name), resolveItemDetails can take a real,
// noticeable moment - the card needs to actively say so instead of just
// sitting there showing the raw name with no other feedback.
test("update() shows a 'Resolving item info…' loading line immediately (before resolveItemDetails settles), and hides it once resolved", async () => {
  const { update } = createItemCard();
  const cardEl = document.documentElement.querySelector("#tf2te-item-card");
  const loadingEl = cardEl.querySelector(".tf2te-item-card-loading");
  // No "starts hidden" sanity check here - the fake DOM's own innerHTML
  // parsing (see tests/helpers/fakeDom.js) doesn't interpret a bare `hidden`
  // attribute from an HTML string into the real .hidden boolean the way an
  // actual browser does; a real one would, this is a fixture limitation, not
  // something update()'s own logic is responsible for.

  const updatePromise = update("Rocket Launcher", fakeItemEl());
  // Checked synchronously, before awaiting - update() is an async function,
  // so everything up to its own first `await resolveItemDetails(...)` has
  // already run by the time this line executes.
  assert.equal(loadingEl.hidden, false);

  await updatePromise;
  assert.equal(loadingEl.hidden, true);
});

test("update() clears a previous item's own stale detail lines/buttons the instant a new one starts resolving", async () => {
  const { update } = createItemCard();
  const itemEl = fakeItemEl({ classes: ["quality5"], dataContent: "Effect: Fountain of Delight" });
  await update("Rocket Launcher", itemEl); // first item: has an effect line + buttons

  const cardEl = document.documentElement.querySelector("#tf2te-item-card");
  assert.equal(cardEl.querySelector(".tf2te-item-card-effect").hidden, false, "sanity check: first item's effect line is showing");

  const updatePromise = update("Scattergun", fakeItemEl()); // second item: plain, no effect
  // Checked synchronously, before the second update() call's own await
  // settles - the stale effect line/buttons from "Rocket Launcher" must
  // already be gone, not left showing until the new resolution finishes.
  assert.equal(cardEl.querySelector(".tf2te-item-card-effect").hidden, true);
  assert.equal(cardEl.querySelector(".tf2te-item-card-btns").innerHTML, "");

  await updatePromise;
});

test("update() shows the effect line and purple-ish quality color for an Unusual", async () => {
  const { update } = createItemCard();
  const itemEl = fakeItemEl({ classes: ["quality5"], dataContent: "Effect: Fountain of Delight" });
  await update("Rocket Launcher", itemEl);

  const cardEl = document.documentElement.querySelector("#tf2te-item-card");
  const nameEl = cardEl.querySelector(".tf2te-item-card-name");
  const effectEl = cardEl.querySelector(".tf2te-item-card-effect");
  // Unusual's own quality name is stripped from the title text (see
  // resolveItemDetails.js's own note), so only the effect line conveys it.
  assert.equal(nameEl.textContent, "Rocket Launcher");
  assert.notEqual(nameEl.style.color, "");
  assert.equal(effectEl.hidden, false);
  assert.equal(effectEl.textContent, "Effect: Fountain of Delight");
});

test("update() renders the main action buttons, pairing a classifieds shortcut icon with each stats button", async () => {
  const { update } = createItemCard();
  await update("Rocket Launcher", fakeItemEl());
  // posts.tf's own resolution is deferred (not awaited inside update()
  // anymore - see resolveItemDetails.js's own postsTfPromise note), so its
  // slot still shows its loading state (label + spinner) right after
  // update() resolves; flush() lets that quick (no real network delay in
  // this test's own schema fixture) promise settle before asserting on the
  // final rendered row.
  await flush();

  const cardEl = document.documentElement.querySelector("#tf2te-item-card");
  const btnsEl = cardEl.querySelector(".tf2te-item-card-btns");
  // Two stats buttons (next.backpack.tf/backpack.tf), each paired with its
  // own classifieds icon inside a little group div; stntrading.eu/Steam
  // Market form a THIRD group (see the dedicated grouping test below), plus
  // gladiator.tf, posts.tf's compact key hint (this file's own schema
  // fixture has no key configured, so posts.tf's own defindex lookup can't
  // resolve - see resolveItemDetails.js's postsTfPromise needsKey note),
  // marketplace.tf, and mannco.store as their own standalone buttons
  // (pricedb.io is skipped here - this test file's own chrome.runtime
  // fixture returns {ok: false} for every fetch, so its search resolves to
  // no sku/href, same as a genuine "no match found" case).
  const groups = btnsEl.children.filter((c) => c.tagName === "DIV");
  assert.equal(groups.length, 3);
  const standaloneLinks = btnsEl.children.filter((c) => c.tagName === "A");
  assert.equal(standaloneLinks.length, 4);
  assert.deepEqual(standaloneLinks.map((a) => a.textContent), ["gladiator.tf", "posts.tf", "marketplace.tf", "mannco.store"]);
  const postsTfHint = standaloneLinks[1];
  assert.equal(postsTfHint.dataset.tf2teNeedsKey, "1");
  assert.equal(postsTfHint.getAttribute("href"), null);
  assert.match(postsTfHint.title, /Steam Web API key/);
});

// Stntrading.eu and Steam Market are always adjacent in resolveItemDetails.js's
// own links array, but .tf2te-item-card-btns is a plain flex-wrap container
// where each button's width depends on its own label text - which OTHER labels
// happen to precede this pair (mannco.store is conditional) shifts where the
// wrap falls, so the two could land on different visual rows depending on the
// item. Now grouped into one flex div (same mechanism as the classifieds/history
// icon pairing), guaranteeing they always wrap together onto the same row.
test("update() groups stntrading.eu and Steam Market into one flex row together, same as a stats button with its classifieds icon", async () => {
  const { update } = createItemCard();
  await update("Rocket Launcher", fakeItemEl());
  await flush();

  const cardEl = document.documentElement.querySelector("#tf2te-item-card");
  const btnsEl = cardEl.querySelector(".tf2te-item-card-btns");
  const groups = btnsEl.children.filter((c) => c.tagName === "DIV");
  const stnGroup = groups.find((g) => g.children.some((c) => c.textContent === "stntrading.eu"));
  assert.ok(stnGroup, "expected a group div containing the stntrading.eu button");
  assert.equal(stnGroup.children.length, 2);
  assert.deepEqual(
    stnGroup.children.map((c) => c.textContent),
    ["stntrading.eu", "Steam Market"]
  );
});

// Pricedb.io's own /api/search used to be awaited (inside
// resolveItemDetails) before update() rendered ANYTHING at all - every text
// line and every OTHER button waited on this one slow, per-item network
// call, making the whole item card visibly slow to appear. Fixing that by
// simply not waiting introduced its OWN visual bug: the pricedb.io button
// popped in later once its search resolved, shifting every button after it
// sideways - jarring to watch. Now a non-clickable loading slot (label +
// spinner, utils/linkButtonStates.js) reserves pricedb.io's own slot
// immediately, then gets swapped for the real
// button (or removed, if no match is found) once the search settles - never
// a layout shift either way.
test("REGRESSION: update() shows a non-clickable loading slot in pricedb.io's own slot immediately, then swaps it for the real button once resolved - no layout shift", async () => {
  let releaseGate;
  const gate = new Promise((resolve) => {
    releaseGate = resolve;
  });
  globalThis.chrome.runtime.sendMessage = async () => {
    await gate;
    return { ok: true, data: { success: true, data: { results: [{ sku: "18;6" }] } } };
  };

  const { update } = createItemCard();
  const updatePromise = update("Rocket Launcher", fakeItemEl());

  // The gate is still closed - update()'s own promise must still resolve
  // (rendering every OTHER button) without waiting for it.
  await updatePromise;

  const cardEl = document.documentElement.querySelector("#tf2te-item-card");
  const btnsEl = cardEl.querySelector(".tf2te-item-card-btns");
  assert.equal(
    btnsEl.children.filter((c) => c.tagName === "A").some((a) => a.textContent === "pricedb.io"),
    false
  );
  assert.ok(btnsEl.children.filter((c) => c.tagName === "A").some((a) => a.textContent === "gladiator.tf"));

  // The placeholder itself is already showing, in pricedb.io's own slot -
  // right after gladiator.tf - as a non-clickable <span>, not a broken <a>.
  const placeholder = btnsEl.children.find((c) => isLoadingSlot(c, "pricedb.io"));
  assert.ok(placeholder);
  assert.equal(placeholder.tagName, "SPAN");
  assert.equal(placeholder.getAttribute("aria-busy"), "true");
  assert.match(placeholder.title, /Looking up this item on pricedb\.io/);
  const gladiatorPos = btnsEl.children.findIndex((c) => c.textContent === "gladiator.tf");
  const placeholderPos = btnsEl.children.indexOf(placeholder);
  assert.equal(placeholderPos, gladiatorPos + 1);

  // Now let pricedb.io's own search settle and give the splice a chance to run.
  releaseGate();
  await flush();

  assert.equal(btnsEl.children.some((c) => isLoadingSlot(c, "pricedb.io")), false);
  const pricedbLink = btnsEl.children.filter((c) => c.tagName === "A").find((a) => a.textContent === "pricedb.io");
  assert.ok(pricedbLink);
  assert.equal(pricedbLink.href, "https://pricedb.io/item/18%3B6");
  // Still in the SAME slot the placeholder reserved - no shift for anything
  // after it (posts.tf/marketplace.tf/mannco.store/Steam Market).
  assert.equal(btnsEl.children.indexOf(pricedbLink), gladiatorPos + 1);
});

test("REGRESSION: the pricedb.io loading slot is removed outright (not left stuck) when pricedb.io's own search finds no match", async () => {
  globalThis.chrome.runtime.sendMessage = async () => ({ ok: false, error: "no match" });

  const { update } = createItemCard();
  await update("Rocket Launcher", fakeItemEl());
  await flush();

  const cardEl = document.documentElement.querySelector("#tf2te-item-card");
  const btnsEl = cardEl.querySelector(".tf2te-item-card-btns");
  assert.equal(btnsEl.children.some((c) => isLoadingSlot(c, "pricedb.io")), false);
  assert.equal(
    btnsEl.children.filter((c) => c.tagName === "A").some((a) => a.textContent === "pricedb.io"),
    false
  );
});

// A rate-limited lookup used to look IDENTICAL to "this item genuinely has
// no pricedb.io listing" here too - the "Loading…" placeholder just quietly
// disappeared either way. searchPricedbSkuStatus surfaces the real 429 (see
// utils/pricedb.js's own note) so this can show something instead, in the
// same slot the "Loading…" placeholder reserved.
test("REGRESSION: swaps the pricedb.io loading slot for a 'pricedb.io Ns' countdown in the same slot instead of removing it, on a real 429", async () => {
  mock.timers.enable({ apis: ["setInterval"] });
  try {
    globalThis.chrome.runtime.sendMessage = async () => ({ ok: false, status: 429, error: "Rate limited (429)", retryAfterMs: 9000 });

    const { update } = createItemCard();
    await update("Rocket Launcher", fakeItemEl());
    await flush();

    const cardEl = document.documentElement.querySelector("#tf2te-item-card");
    const btnsEl = cardEl.querySelector(".tf2te-item-card-btns");
    assert.equal(btnsEl.children.some((c) => isLoadingSlot(c, "pricedb.io")), false);
    const countdown = btnsEl.children.find((c) => c.textContent.startsWith("pricedb.io") && c.textContent.endsWith("s"));
    assert.ok(countdown, "expected the countdown in pricedb.io's slot");
    assert.equal(countdown.tagName, "SPAN");
    assert.match(countdown.textContent, /^pricedb\.io (9|8)s$/);
  } finally {
    mock.timers.reset();
  }
});

test("when the countdown ends, the card retries pricedb.io by itself and shows the real link", async () => {
  mock.timers.enable({ apis: ["setInterval"] });
  try {
    globalThis.chrome.runtime.sendMessage = async () => ({ ok: false, status: 429, error: "Rate limited (429)", retryAfterMs: 2000 });

    const { update } = createItemCard();
    await update("Rocket Launcher", fakeItemEl());
    await flush();

    globalThis.chrome.runtime.sendMessage = async (msg) => {
      const q = new URL(msg.url).searchParams.get("q");
      return { ok: true, data: { success: true, data: { results: [{ name: q, sku: "205;6" }] } } };
    };
    mock.timers.tick(2000);
    await flush();

    const btnsEl = document.documentElement.querySelector("#tf2te-item-card").querySelector(".tf2te-item-card-btns");
    const pricedb = btnsEl.children.find((c) => c.textContent === "pricedb.io");
    assert.ok(pricedb, "expected the real pricedb.io link after the retry");
    assert.equal(pricedb.tagName, "A");
    assert.equal(pricedb.href, "https://pricedb.io/item/205%3B6");
  } finally {
    mock.timers.reset();
  }
});

test("a redraw mid-countdown keeps counting toward the same retry time, and only one retry fires", async () => {
  mock.timers.enable({ apis: ["setInterval", "Date"] });
  // Holds posts.tf back (its "is a key saved?" check) so it settles in the
  // middle of pricedb.io's countdown, forcing the row to redraw then.
  const realGet = globalThis.chrome.storage.local.get;
  let releasePostsTf;
  const postsTfGate = new Promise((resolve) => (releasePostsTf = resolve));
  globalThis.chrome.storage.local.get = async (keys) => {
    if ([].concat(keys).includes("steamApiKey")) await postsTfGate;
    return realGet(keys);
  };
  try {
    let pricedbLookups = 0;
    globalThis.chrome.runtime.sendMessage = async () => {
      pricedbLookups++;
      return { ok: false, status: 429, error: "Rate limited (429)", retryAfterMs: 10000 };
    };

    const { update } = createItemCard();
    await update("Rocket Launcher", fakeItemEl());
    await flush();
    const btnsEl = () => document.documentElement.querySelector("#tf2te-item-card").querySelector(".tf2te-item-card-btns");
    const countdownText = () => btnsEl().children.find((c) => /^pricedb\.io \d+s$/.test(c.textContent))?.textContent;
    assert.equal(countdownText(), "pricedb.io 10s");
    assert.equal(btnsEl().children.some((c) => isLoadingSlot(c, "posts.tf")), true);

    mock.timers.tick(4000);
    assert.equal(countdownText(), "pricedb.io 6s");

    releasePostsTf(); // posts.tf settles -> the row redraws
    await flush();
    assert.equal(btnsEl().children.some((c) => isLoadingSlot(c, "posts.tf")), false);
    assert.equal(countdownText(), "pricedb.io 6s", "the redrawn countdown must not restart from 10s");

    const lookupsBefore = pricedbLookups;
    mock.timers.tick(6000);
    await flush();
    assert.equal(pricedbLookups - lookupsBefore, 1, "exactly one retry, not one per redraw");
  } finally {
    globalThis.chrome.storage.local.get = realGet;
    mock.timers.reset();
  }
});

test("update() adds a per-item history icon to each stats button's group when the hovered item has a data-id", async () => {
  const { update } = createItemCard();
  await update("Rocket Launcher", fakeItemEl({ dataId: "17342991567" }));

  const cardEl = document.documentElement.querySelector("#tf2te-item-card");
  const btnsEl = cardEl.querySelector(".tf2te-item-card-btns");
  const groups = btnsEl.children.filter((c) => c.tagName === "DIV");
  // 2 stats groups (own history icon each) + the stntrading.eu/Steam Market
  // group (see the dedicated grouping test above) - neither of the latter's
  // two buttons is a stats button, so it carries no history icon of its own.
  assert.equal(groups.length, 3);

  const historyLinks = btnsEl.querySelectorAll(".tf2te-item-card-history-btn");
  assert.equal(historyLinks.length, 2);

  const hrefs = historyLinks.map((a) => a.href).sort();
  assert.deepEqual(hrefs, ["https://backpack.tf/item/17342991567", "https://next.backpack.tf/item/17342991567"]);
});

test("update() adds no history icon at all when the hovered item has no data-id", async () => {
  const { update } = createItemCard();
  await update("Rocket Launcher", fakeItemEl());

  const cardEl = document.documentElement.querySelector("#tf2te-item-card");
  const btnsEl = cardEl.querySelector(".tf2te-item-card-btns");
  assert.equal(btnsEl.querySelectorAll(".tf2te-item-card-history-btn").length, 0);

  // Each stats group still only holds its main button + classifieds icon.
  const groups = btnsEl.children.filter((c) => c.tagName === "DIV");
  groups.forEach((group) => assert.equal(group.children.length, 2));
});

test("a second update() call replaces the item card's previous content rather than appending to it", async () => {
  const { update } = createItemCard();
  await update("Rocket Launcher", fakeItemEl());
  await update("Scattergun", fakeItemEl());

  const cardEl = document.documentElement.querySelector("#tf2te-item-card");
  assert.equal(cardEl.querySelector(".tf2te-item-card-name").textContent, "Scattergun");
});

// --- click-to-copy on the name line ---------------------------------------

test("the name line is marked clickable-to-copy as soon as the item card is created", () => {
  createItemCard();

  const nameEl = document.documentElement.querySelector("#tf2te-item-card").querySelector(".tf2te-item-card-name");
  assert.equal(nameEl.title, "Click to copy item name");
});

test("clicking the name line copies the currently-resolved display name and flashes success", async () => {
  const { update } = createItemCard();
  await update("Rocket Launcher", fakeItemEl());

  const written = [];
  installFakeClipboard(async (text) => written.push(text));

  const nameEl = document.documentElement.querySelector("#tf2te-item-card").querySelector(".tf2te-item-card-name");
  await nameEl.dispatchEvent({ type: "click" });

  assert.deepEqual(written, ["Rocket Launcher"]);
  assert.equal(nameEl.classList.contains("tf2te-copy-item-name-success"), true);
});

test("clicking the name line flashes error (not success) when the clipboard write rejects", async () => {
  const { update } = createItemCard();
  await update("Rocket Launcher", fakeItemEl());
  installFakeClipboard(async () => {
    throw new Error("denied");
  });

  const nameEl = document.documentElement.querySelector("#tf2te-item-card").querySelector(".tf2te-item-card-name");
  await nameEl.dispatchEvent({ type: "click" });

  assert.equal(nameEl.classList.contains("tf2te-copy-item-name-error"), true);
  assert.equal(nameEl.classList.contains("tf2te-copy-item-name-success"), false);
});

// The click handler is wired up ONCE at item card creation, not inside
// update() (which re-runs on every hover) - a per-update listener would
// stack a new duplicate handler on every hover, copying the name (and
// writing to the clipboard) once per PAST hover on a single click instead of
// just once.
test("REGRESSION: repeated update() calls do not stack duplicate click listeners on the name line", async () => {
  const { update } = createItemCard();
  await update("Rocket Launcher", fakeItemEl());
  await update("Scattergun", fakeItemEl());
  await update("Minigun", fakeItemEl());

  const written = [];
  installFakeClipboard(async (text) => written.push(text));

  const nameEl = document.documentElement.querySelector("#tf2te-item-card").querySelector(".tf2te-item-card-name");
  await nameEl.dispatchEvent({ type: "click" });

  assert.deepEqual(written, ["Minigun"]);
});

test("update() ignores a stale (superseded) resolution - only the most recently started call's result is ever painted", async () => {
  const { update } = createItemCard();

  // Two updates fired back-to-back without awaiting the first - the second
  // (newer) one must win even though nothing here artificially delays the
  // first's own resolution, exercising the updateToken guard itself.
  const firstPromise = update("Rocket Launcher", fakeItemEl());
  const secondPromise = update("Scattergun", fakeItemEl());
  await Promise.all([firstPromise, secondPromise]);

  const cardEl = document.documentElement.querySelector("#tf2te-item-card");
  assert.equal(cardEl.querySelector(".tf2te-item-card-name").textContent, "Scattergun");
});

// Seen live: a Taunt Unusualifier's tile title is just "Unusualifier", with the
// target taunt's icon as the tile picture.
test("update() titles a Taunt Unusualifier with its target taunt, while gladiator.tf keeps the plain search", async () => {
  const originalGet = globalThis.chrome.storage.local.get;
  globalThis.chrome.storage.local.get = async () => ({
    tf2SchemaCache: {
      itemNameToDefindex: { "Taunt: The Bunnyhopper": 30920 },
      defindexToItemName: {},
      effectNameToId: {},
      tauntIconToItemName: { taunt_the_bunnyhopper: "Taunt: The Bunnyhopper" },
      fetchedAt: Date.now(),
      schemaShapeVersion: 4,
    },
  });
  __resetSchemaCacheForTests();
  try {
    const { update } = createItemCard();
    await update(
      "Unusualifier",
      fakeItemEl({
        classes: ["quality5", "uncraft"],
        defindex: "9258",
        style: "opacity:1;background-image:url(https://steamcdn-a.akamaihd.net/apps/440/icons/taunt_the_bunnyhopper.dfb3285b.png);",
      })
    );
    await flush();

    const cardEl = document.documentElement.querySelector("#tf2te-item-card");
    assert.equal(cardEl.querySelector(".tf2te-item-card-name").textContent, "Unusualifier (Taunt: The Bunnyhopper)");
    const links = cardEl.querySelector(".tf2te-item-card-btns").querySelectorAll("a");
    const gladiator = links.find((a) => a.textContent === "gladiator.tf");
    assert.equal(gladiator.href, "https://gladiator.tf/sales?item=Unusual+Unusualifier");
  } finally {
    globalThis.chrome.storage.local.get = originalGet;
    __resetSchemaCacheForTests();
  }
});
