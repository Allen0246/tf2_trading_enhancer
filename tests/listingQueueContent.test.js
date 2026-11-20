import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { FakeElement, createFakeDocument, resetFakeDom } from "./helpers/fakeDom.js";

// Settings come from chrome.storage.local, faked below (empty unless a test
// sets them). estimateStartingPrice gets no key value here, so a price hint
// is pure metal (see tests/listingQueuePriceHint.test.js's own coverage of
// that fallback).
let storedSettings = {};
globalThis.chrome = {
  storage: {
    local: {
      async get() {
        return storedSettings;
      },
      async set(patch) {
        Object.assign(storedSettings, patch);
      },
    },
  },
  runtime: {
    getURL: (path) => path,
    sendMessage: async () => ({ ok: false, error: "no live fetch expected in this test file" }),
  },
};
globalThis.fetch = async () => ({ json: async () => [] });

// The default listing notes come from a real backpack.tf sell page (see
// defaultNotes.js, tested on its own). Stubbed here so the fetch stubs below
// only ever see publish requests, as these tests count them.
let defaultNotesForTests = "";
mock.module("../backpack.tf/oldUI/listingQueue/defaultNotes.js", {
  namedExports: { fetchDefaultListingNotes: async () => defaultNotesForTests },
});

const { listingQueue, __resetListingQueueForTests } = await import("../backpack.tf/oldUI/listingQueue/content.js");

const realSetTimeout = setTimeout;

// Timers the code under test schedules (publishAll's 1.4s success-row removal
// and its delay between requests) outlive the test that started them. One
// firing during a LATER test runs the old queue's handlers against the
// module's shared `drawer`, which by then is that later test's drawer: it
// deleted the new test's rows or patched a row with the same asset id, failing
// tests intermittently, depending only on machine speed (seen on CI).
// installPage cancels them so every test starts clean. The tests' own waits
// use realSetTimeout and are not tracked.
const pendingModuleTimers = new Set();
globalThis.setTimeout = (fn, ms, ...args) => {
  const id = realSetTimeout(() => {
    pendingModuleTimers.delete(id);
    fn(...args);
  }, ms);
  pendingModuleTimers.add(id);
  return id;
};
function cancelLeftoverModuleTimers() {
  for (const id of pendingModuleTimers) clearTimeout(id);
  pendingModuleTimers.clear();
}

async function flush(ticks = 8) {
  for (let i = 0; i < ticks; i++) await new Promise((resolve) => realSetTimeout(resolve, 0));
}

// Confirmed live shape: #backpack > li.item[data-defindex][data-id]
// [data-name][class~="q-440-{qualityId}"], an Unusual also carrying
// data-effect_name, every tile carrying data-price (see
// ../../../backpack.tf/oldUI/listingQueue/priceHint.js's own header note).
function buildItemEl({
  assetId = "1001",
  defindex = "205",
  baseName = "Rocket Launcher",
  qualityId = 6,
  effectName = null,
  priceRefined = null,
  iconUrl = null,
} = {}) {
  const el = new FakeElement("li");
  el.className = `item q-440-${qualityId}`;
  el.setAttribute("data-defindex", defindex);
  el.setAttribute("data-id", assetId);
  el.setAttribute("data-name", baseName);
  if (effectName) el.setAttribute("data-effect_name", effectName);
  if (priceRefined != null) el.setAttribute("data-price", String(priceRefined));
  if (iconUrl) {
    // Confirmed live shape: the icon sits on a CHILD ".item-icon" div, not
    // on the tile itself.
    const iconEl = new FakeElement("div");
    iconEl.className = "item-icon";
    iconEl.setAttribute("style", `background-image:url(${iconUrl})`);
    el.appendChild(iconEl);
  }
  return el;
}

// pathname's steamid matches the navbar's own default logged-in steamid
// (999) by default - i.e. every test that doesn't override one or the
// other is simulating viewing your OWN backpack, the only case
// listingQueue now does anything at all in (see isViewingOwnBackpack in
// content.js). This is a DIFFERENT id than the logout link's own "999"
// below - confirmed live those are two unrelated values on the real page
// (an opaque internal account id vs. a real steamid64) that only happen to
// share the same placeholder digits here for readability.
function installPage({ pathname = "/profiles/999", items = [], withUserLink = true, promptResult = null, loggedInSteamId = "999" } = {}) {
  cancelLeftoverModuleTimers();
  defaultNotesForTests = "";
  resetFakeDom();
  storedSettings = {};
  const doc = createFakeDocument();
  doc.querySelector = (sel) => doc.documentElement.querySelector(sel);
  doc.querySelectorAll = (sel) => doc.documentElement.querySelectorAll(sel);
  global.document = doc;

  const logoutLink = new FakeElement("a");
  logoutLink.setAttribute("href", "/logout?user-id=999");
  doc.body.appendChild(logoutLink);

  // Navbar's own username link - confirmed live (real pasted navbar HTML)
  // this always carries the LOGGED-IN account's steamid64, regardless of
  // whose backpack page is currently being viewed. See
  // resolveLoggedInSteamId64's own note for why this (not the logout link
  // above) is what isViewingOwnBackpack actually compares against.
  if (loggedInSteamId) {
    const navbarUserBlock = new FakeElement("li");
    navbarUserBlock.className = "navbar-user-block";
    const usernameLink = new FakeElement("a");
    usernameLink.setAttribute("href", `/profiles/${loggedInSteamId}`);
    navbarUserBlock.appendChild(usernameLink);
    doc.body.appendChild(navbarUserBlock);
  }

  if (withUserLink) {
    const userLink = new FakeElement("a");
    userLink.className = "user-link";
    userLink.setAttribute("data-offers-params", "?partner=1&token=abc");
    doc.body.appendChild(userLink);
  }

  const backpack = new FakeElement("div");
  backpack.id = "backpack";
  doc.body.appendChild(backpack);

  const itemEls = items.map((item) => {
    const el = buildItemEl(item);
    backpack.appendChild(el);
    return el;
  });

  global.window = {
    location: { pathname, href: `https://backpack.tf${pathname}` },
    prompt: () => promptResult,
  };

  __resetListingQueueForTests();
  return { doc, backpack, itemEls };
}

function ctrlClick(target) {
  const event = { type: "click", ctrlKey: true, target, defaultPrevented: false, preventDefault() {}, stopPropagation() {} };
  return target.parentNode.dispatchEvent(event);
}

function plainClick(target) {
  const event = { type: "click", ctrlKey: false, target, preventDefault() {}, stopPropagation() {} };
  return target.parentNode.dispatchEvent(event);
}

function getDrawer() {
  return document.body.children.find((c) => c.classList.contains("tf2te-listing-queue-drawer"));
}
function getRows() {
  const drawer = getDrawer();
  if (!drawer) return [];
  const list = drawer.querySelector(".tf2te-lq-list");
  return list ? list.children : [];
}
function getPublishButton() {
  const drawer = getDrawer();
  return Array.from(drawer.children)
    .find((c) => c.className.includes("tf2te-lq-foot"))
    .children.find((c) => c.className.includes("tf2te-lq-foot-buttons"))
    .children.find((c) => c.textContent === "Publish all");
}
function getClearButton() {
  const drawer = getDrawer();
  return Array.from(drawer.children)
    .find((c) => c.className.includes("tf2te-lq-foot"))
    .children.find((c) => c.className.includes("tf2te-lq-foot-buttons"))
    .children.find((c) => c.textContent === "Clear");
}

// REGRESSION for a live bug report ("we should display to the user to use
// the ctrl click to select the items"): the drawer (and its own "Hold Ctrl
// and click an item..." hint) used to only appear AFTER the first item was
// queued - the one place explaining the feature was itself hidden behind
// already knowing about it. It now builds immediately, expanded by default,
// with no click needed at all.
test("the drawer (with its own Ctrl+click hint) appears immediately on page load, expanded, with nothing queued", () => {
  installPage({ items: [] });

  listingQueue();

  const drawer = getDrawer();
  assert.ok(drawer, "expected the drawer to be built without any click at all");
  assert.equal(drawer.classList.contains("tf2te-listing-queue-drawer--collapsed"), false);
  const empty = drawer.querySelector(".tf2te-lq-empty");
  assert.match(empty.textContent, /Hold Ctrl and click an item/);
  assert.equal(empty.style.display, "flex");
});

test("collapsing the drawer persists the choice, so it defaults collapsed on the NEXT page load", async () => {
  installPage({ items: [] });
  listingQueue();
  await flush();

  getDrawer().querySelector(".tf2te-lq-collapse").dispatchEvent({ type: "click" });
  assert.equal(storedSettings.listingQueueCollapsed, true);

  // A fresh page load (same browser profile, same stored preference).
  installPage({ items: [] });
  storedSettings.listingQueueCollapsed = true; // installPage() itself resets storedSettings to {}
  listingQueue();
  await flush();

  assert.equal(getDrawer().classList.contains("tf2te-listing-queue-drawer--collapsed"), true);
});

test("Ctrl+click on an item tile queues it, builds the drawer, and renders one row with the right name/price hint", async () => {
  const { backpack, itemEls } = installPage({
    items: [{ assetId: "1001", baseName: "Rocket Launcher", qualityId: 6, priceRefined: 0.33 }],
  });

  const queue = listingQueue();
  ctrlClick(itemEls[0]);
  await flush();

  assert.equal(queue.size, 1);
  const entry = queue.get("1001");
  assert.equal(entry.baseName, "Rocket Launcher");
  assert.equal(entry.keys, 0);
  assert.equal(entry.metal, 0.33); // no live key value configured - see this file's own header note

  assert.ok(getDrawer());
  assert.equal(getRows().length, 1);
});

test("a plain click (no Ctrl) does nothing to the queue (the drawer itself is built eagerly regardless - see the discoverability test below)", async () => {
  const { itemEls } = installPage({
    items: [{ assetId: "1001" }],
  });

  const queue = listingQueue();
  plainClick(itemEls[0]);
  await flush();

  assert.equal(queue.size, 0);
  assert.equal(getRows().length, 0);
});

test("Ctrl+clicking an already-queued item a second time is a no-op (no duplicate row)", async () => {
  const { itemEls } = installPage({
    items: [{ assetId: "1001" }],
  });

  const queue = listingQueue();
  ctrlClick(itemEls[0]);
  await flush();
  ctrlClick(itemEls[0]);
  await flush();

  assert.equal(queue.size, 1);
  assert.equal(getRows().length, 1);
});

test("Ctrl+clicking a tile with no data-defindex/data-id (an empty slot) does nothing", async () => {
  const { backpack } = installPage({ items: [] });
  const emptySlot = new FakeElement("li");
  emptySlot.className = "item spacer";
  backpack.appendChild(emptySlot);

  const queue = listingQueue();
  ctrlClick(emptySlot);
  await flush();

  assert.equal(queue.size, 0);
});

test("the remove button removes the queue entry and its own row only", async () => {
  const { itemEls } = installPage({
    items: [{ assetId: "1001", baseName: "Rocket Launcher" }, { assetId: "1002", baseName: "Medi Gun", defindex: "211" }],
  });

  const queue = listingQueue();
  ctrlClick(itemEls[0]);
  await flush();
  ctrlClick(itemEls[1]);
  await flush();
  assert.equal(getRows().length, 2);

  const firstRow = getRows().find((r) => r.dataset.assetId === "1001");
  const removeBtn = firstRow.querySelector(".tf2te-lq-remove");
  removeBtn.dispatchEvent({ type: "click" });

  assert.equal(queue.size, 1);
  assert.equal(queue.has("1001"), false);
  assert.equal(getRows().length, 1);
  assert.equal(getRows()[0].dataset.assetId, "1002");
});

test("the Clear button empties the whole queue and every row", async () => {
  const { itemEls } = installPage({
    items: [{ assetId: "1001" }, { assetId: "1002", defindex: "211" }],
  });

  const queue = listingQueue();
  ctrlClick(itemEls[0]);
  await flush();
  ctrlClick(itemEls[1]);
  await flush();

  getClearButton().dispatchEvent({ type: "click" });

  assert.equal(queue.size, 0);
  assert.equal(getRows().length, 0);
});

test("an Unusual's queued row shows its effect name, a non-Unusual non-Unique row shows its quality name", async () => {
  const { itemEls } = installPage({
    items: [
      { assetId: "1001", baseName: "Team Captain", qualityId: 5, effectName: "Green Black Hole" },
      { assetId: "1002", baseName: "Blutsauger", qualityId: 3, defindex: "36" },
    ],
  });

  const queue = listingQueue();
  ctrlClick(itemEls[0]);
  await flush();
  ctrlClick(itemEls[1]);
  await flush();

  const unusualRow = getRows().find((r) => r.dataset.assetId === "1001");
  assert.match(unusualRow.querySelector(".tf2te-lq-effect").textContent, /Green Black Hole/);

  const vintageRow = getRows().find((r) => r.dataset.assetId === "1002");
  assert.equal(vintageRow.querySelector(".tf2te-lq-effect").textContent, "Vintage");
});

// REGRESSION for a live bug report ("cant we get the item picture?"): the
// icon sits on the source tile's own CHILD ".item-icon" div (see
// resolveIconUrl's own note), not the ".item" tile itself - reused directly
// as the row's own thumbnail background instead of a plain placeholder.
test("reuses the tile's own real item icon as the row's thumbnail background", async () => {
  const { itemEls } = installPage({
    items: [{ assetId: "1001", iconUrl: "https://steamcdn-a.akamaihd.net/apps/440/icons/c_leechgun.png" }],
  });

  const queue = listingQueue();
  ctrlClick(itemEls[0]);
  await flush();

  assert.equal(queue.get("1001").iconUrl, "https://steamcdn-a.akamaihd.net/apps/440/icons/c_leechgun.png");
  const thumb = getRows()[0].querySelector(".tf2te-lq-thumb");
  assert.equal(thumb.style.backgroundImage, 'url("https://steamcdn-a.akamaihd.net/apps/440/icons/c_leechgun.png")');
});

test("falls back to no inline background-image (the plain CSS placeholder) when the tile has no .item-icon at all", async () => {
  const { itemEls } = installPage({ items: [{ assetId: "1001" }] });

  const queue = listingQueue();
  ctrlClick(itemEls[0]);
  await flush();

  assert.equal(queue.get("1001").iconUrl, null);
  const thumb = getRows()[0].querySelector(".tf2te-lq-thumb");
  assert.equal(thumb.style.backgroundImage, undefined);
});

// REGRESSION for a live bug report ("its a bit falling apart" - a Unique
// item's own row read as having no left accent border at all): the
// previous fallback color, Steam's own pale "#b0c3d9", was too low-contrast
// against the drawer's dark row background to read as a border at all.
test("a Unique item (no distinct Valve quality color) gets a visible neutral fallback accent color, not Steam's own low-contrast pale one", async () => {
  const { itemEls } = installPage({ items: [{ assetId: "1001", qualityId: 6 }] }); // 6 = Unique

  listingQueue();
  ctrlClick(itemEls[0]);
  await flush();

  const row = getRows()[0];
  assert.equal(row.style.getPropertyValue("--tf2te-lq-q"), "#5c6570");
  assert.notEqual(row.style.getPropertyValue("--tf2te-lq-q"), "#b0c3d9");
});

// B8 on the manual test pass: a queued row starts with the notes backpack.tf
// pre-fills when listing by hand, still editable per row.
test("a newly queued item's comment starts with the account's default listing notes", async () => {
  const { itemEls } = installPage({ items: [{ assetId: "1001" }] });
  defaultNotesForTests = "👤𝗛𝘂𝗺𝗮𝗻 𝘁𝗿𝗮𝗱𝗲𝗿 [⇄]. ⚡I am reacting to offers fast as possible.⚡";

  const queue = listingQueue();
  ctrlClick(itemEls[0]);
  await flush();

  const comment = getRows()[0].querySelector(".tf2te-lq-comment");
  assert.equal(comment.value, defaultNotesForTests);
  assert.equal(queue.get("1001").details, defaultNotesForTests);

  // A two-line, full-row box capped at backpack.tf's own 200-character limit.
  assert.equal(comment.tagName.toLowerCase(), "textarea");
  assert.equal(comment.rows, 2);
  assert.equal(comment.maxLength, 200);
});

test("editing the keys/metal/comment fields updates the SAME queue entry directly, without rebuilding the row", async () => {
  const { itemEls } = installPage({
    items: [{ assetId: "1001" }],
  });

  const queue = listingQueue();
  ctrlClick(itemEls[0]);
  await flush();

  const row = getRows()[0];
  const keysInput = row.querySelector(".tf2te-lq-pricefield.keys").querySelector("input");
  const metalInput = row.querySelector(".tf2te-lq-pricefield.metal").querySelector("input");
  const comment = row.querySelector(".tf2te-lq-comment");

  keysInput.value = "3";
  keysInput.dispatchEvent({ type: "input" });
  metalInput.value = "12.5";
  metalInput.dispatchEvent({ type: "input" });
  comment.value = "Add me!";
  comment.dispatchEvent({ type: "input" });

  const entry = queue.get("1001");
  assert.equal(entry.keys, 3);
  assert.equal(entry.metal, 12.5);
  assert.equal(entry.details, "Add me!");

  // Same row element, not replaced.
  assert.equal(getRows()[0], row);
});

test("REGRESSION: editing a row's keys/metal updates the footer total right away", async () => {
  const { itemEls } = installPage({
    items: [{ assetId: "1001" }],
  });

  listingQueue();
  ctrlClick(itemEls[0]);
  await flush();

  const row = getRows()[0];
  const keysInput = row.querySelector(".tf2te-lq-pricefield.keys").querySelector("input");
  const metalInput = row.querySelector(".tf2te-lq-pricefield.metal").querySelector("input");
  keysInput.value = "2";
  keysInput.dispatchEvent({ type: "input" });
  metalInput.value = "1.33";
  metalInput.dispatchEvent({ type: "input" });

  const footTotal = Array.from(getDrawer().children)
    .find((c) => c.className.includes("tf2te-lq-foot"))
    .children.find((c) => c.className.includes("tf2te-lq-foot-total"))
    .children.find((c) => c.tagName === "B");
  assert.equal(footTotal.textContent, "~2 keys, 1.33 ref");
});

test("Publish all posts the correct params for each queued entry, moves each row through pending -> success, then removes it", async () => {
  const { itemEls } = installPage({
    items: [{ assetId: "1001", baseName: "Rocket Launcher", priceRefined: 0.33 }],
  });

  const calls = [];
  // publishRequest.js's own named export is a read-only ESM live binding
  // from here - can't be reassigned. Stub the underlying fetch() instead,
  // which is what publishListing itself actually calls.
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, json: async () => ({ result: { id: "999" } }) };
  };

  const queue = listingQueue();
  ctrlClick(itemEls[0]);
  await flush();
  queue.update("1001", { keys: 1, metal: 2.5, details: "GLHF" });

  await getPublishButton().dispatchEvent({ type: "click" });
  await flush(20);

  assert.equal(calls.length, 1);
  const sentBody = new URLSearchParams(calls[0].init.body);
  assert.equal(sentBody.get("id"), "1001");
  assert.equal(sentBody.get("currencies[keys]"), "1");
  assert.equal(sentBody.get("currencies[metal]"), "2.5");
  assert.equal(sentBody.get("details"), "GLHF");
  assert.equal(sentBody.get("user-id"), "999");
  assert.equal(sentBody.get("trade_offer_url"), "https://steamcommunity.com/tradeoffer/new/?partner=1&token=abc");

  // Row eventually clears itself out after a successful publish.
  await new Promise((resolve) => realSetTimeout(resolve, 1500));
  assert.equal(queue.size, 0);
  assert.equal(getRows().length, 0);
});

test("clicking Publish all again while a just-listed row is still showing its success state does not publish it twice", async () => {
  const { itemEls } = installPage({ items: [{ assetId: "1001" }] });

  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, json: async () => ({}) };
  };

  const queue = listingQueue();
  ctrlClick(itemEls[0]);
  await flush();

  await getPublishButton().dispatchEvent({ type: "click" });
  await flush(20);
  assert.equal(queue.get("1001")?.status, "success");

  // Still inside the row's success-removal delay.
  await getPublishButton().dispatchEvent({ type: "click" });
  await flush(20);

  assert.equal(calls.length, 1);
});

// publishAll works through a snapshot of the queue taken at click time, one
// request at a time - an entry removed (✕ or Clear) while an earlier one is
// still publishing must not be published anyway.
test("an entry removed from the queue while Publish all is still running is NOT published", async () => {
  const { itemEls } = installPage({ items: [{ assetId: "1001" }, { assetId: "1002" }] });

  const publishedIds = [];
  globalThis.fetch = async (url, init) => {
    publishedIds.push(new URLSearchParams(init.body).get("id"));
    await new Promise((resolve) => realSetTimeout(resolve, 60));
    return { ok: true, json: async () => ({}) };
  };

  const queue = listingQueue();
  ctrlClick(itemEls[0]);
  ctrlClick(itemEls[1]);
  await flush();

  const clickPromise = getPublishButton().dispatchEvent({ type: "click" });
  await new Promise((resolve) => realSetTimeout(resolve, 10)); // first request in flight
  queue.remove("1002");

  await clickPromise;
  await new Promise((resolve) => realSetTimeout(resolve, 800)); // past the inter-request delay

  assert.deepEqual(publishedIds, ["1001"]);
});

test("shows a per-row 'pending' status while its own publish request is still in flight", async () => {
  const { itemEls } = installPage({ items: [{ assetId: "1001" }] });

  // A real HTTP round trip isn't instant - delayed here specifically so the
  // still-in-flight status can be observed before the request resolves.
  globalThis.fetch = async () => {
    await new Promise((resolve) => realSetTimeout(resolve, 60));
    return { ok: true, json: async () => ({}) };
  };

  const queue = listingQueue();
  ctrlClick(itemEls[0]);
  await flush();

  const clickPromise = getPublishButton().dispatchEvent({ type: "click" });
  await new Promise((resolve) => realSetTimeout(resolve, 10)); // after the request starts, well before it resolves

  const row = getRows()[0];
  assert.equal(row.querySelector(".tf2te-lq-status").dataset.status, "pending");
  assert.equal(getPublishButton().disabled, true);

  await clickPromise;
  await new Promise((resolve) => realSetTimeout(resolve, 1500));
  assert.equal(queue.size, 0);
});

test("a failed publish shows a fail status with the server's own message, and does NOT remove the row", async () => {
  const { itemEls } = installPage({
    items: [{ assetId: "1001" }],
  });

  globalThis.fetch = async () => ({
    ok: false,
    status: 400,
    json: async () => ({ message: "You already have a listing for this item." }),
  });

  const queue = listingQueue();
  ctrlClick(itemEls[0]);
  await flush();

  await getPublishButton().dispatchEvent({ type: "click" });
  await flush(20);

  assert.equal(queue.size, 1);
  const row = getRows()[0];
  const status = row.querySelector(".tf2te-lq-status");
  assert.equal(status.dataset.status, "fail");
  assert.match(status.textContent, /already have a listing/);
});

// REGRESSION for a live bug report ("the publish all button dont do
// anything at all"): the earlier window.prompt()-based fallback (native,
// blocking, no try/catch around it anywhere) risked exactly this failure
// mode. Replaced with a plain, non-blocking input row instead - see
// content.js's own header note.
test("shows a manual trade-offer-URL input row when no .user-link[data-offers-params] is present, and publish picks up whatever's typed there", async () => {
  const { itemEls } = installPage({
    items: [{ assetId: "1001" }],
    withUserLink: false,
  });

  globalThis.fetch = async (url, init) => {
    globalThis.__lastBody = init.body;
    return { ok: true, json: async () => ({}) };
  };

  const queue = listingQueue();
  await flush();

  const tradeUrlRow = getDrawer().querySelector(".tf2te-lq-tradeurl");
  assert.equal(tradeUrlRow.style.display, "flex"); // shown - nothing resolvable yet
  const input = tradeUrlRow.querySelector("input");
  input.value = "https://steamcommunity.com/tradeoffer/new/?partner=42&token=xyz";
  input.dispatchEvent({ type: "input" });
  assert.equal(storedSettings.listingQueueTradeOfferUrl, "https://steamcommunity.com/tradeoffer/new/?partner=42&token=xyz");

  ctrlClick(itemEls[0]);
  await flush();
  await getPublishButton().dispatchEvent({ type: "click" });
  await flush(20);

  const sentBody = new URLSearchParams(globalThis.__lastBody);
  assert.equal(sentBody.get("trade_offer_url"), "https://steamcommunity.com/tradeoffer/new/?partner=42&token=xyz");
});

test("keeps the manual trade-offer-URL input row hidden when .user-link[data-offers-params] already resolves one", async () => {
  installPage({ items: [] });

  listingQueue();
  await flush();

  const tradeUrlRow = getDrawer().querySelector(".tf2te-lq-tradeurl");
  assert.equal(tradeUrlRow.style.display, "none");
});

// REGRESSION for the same bug report: publishAll used to have no
// try/catch around identity resolution at all - a failure there left the
// button permanently disabled with nothing else visibly happening. Even
// with no trade offer URL resolvable, publish now still completes (an
// empty trade_offer_url isn't fatal - see this file's own header note) and
// re-enables the button either way.
test("publish still completes (button re-enabled, row updated) even when no trade offer URL could be resolved at all", async () => {
  const { itemEls } = installPage({ items: [{ assetId: "1001" }], withUserLink: false });

  globalThis.fetch = async (url, init) => {
    globalThis.__lastBody = init.body;
    return { ok: true, json: async () => ({}) };
  };

  const queue = listingQueue();
  ctrlClick(itemEls[0]);
  await flush();

  const publishBtn = getPublishButton();
  await publishBtn.dispatchEvent({ type: "click" });
  await flush(20);

  const sentBody = new URLSearchParams(globalThis.__lastBody);
  assert.equal(sentBody.get("trade_offer_url"), "");
  assert.equal(publishBtn.disabled, false);
});

test("does nothing outside /profiles/, even with a real #backpack present", () => {
  const { backpack } = installPage({ pathname: "/stats/Unique/Rocket%20Launcher/Tradable/Craftable", items: [] });
  const result = listingQueue();
  assert.equal(result, undefined);
  assert.equal(backpack._listeners?.click, undefined);
});

// REGRESSION for a live bug report (screenshot: the drawer showed up while
// browsing someone ELSE's backpack) - the page's own /profiles/{id} (765)
// doesn't match the navbar's own logged-in steamid64 (999, the default
// installPage sets up - see resolveLoggedInSteamId64), so this must now do
// nothing at all, not just skip queuing.
test("does nothing when viewing someone ELSE's backpack (page id doesn't match the logged-in account's own id)", () => {
  const { backpack } = installPage({ pathname: "/profiles/765", items: [{}] });
  const result = listingQueue();
  assert.equal(result, undefined);
  assert.equal(backpack._listeners?.click, undefined);
  assert.equal(getDrawer(), undefined);
});

// Same failure mode, but with no navbar identity elements on the page at
// all (e.g. a logged-out visitor, or the selectors not matching for some
// other reason) - resolveLoggedInSteamId64 returns null, and
// isViewingOwnBackpack must treat that as "can't confirm, so don't show
// it" rather than defaulting open.
test("does nothing when the logged-in account's own steamid can't be resolved at all (no navbar identity elements on the page)", () => {
  resetFakeDom();
  const doc = createFakeDocument();
  doc.querySelector = (sel) => doc.documentElement.querySelector(sel);
  doc.querySelectorAll = (sel) => doc.documentElement.querySelectorAll(sel);
  global.document = doc;

  const backpack = new FakeElement("div");
  backpack.id = "backpack";
  doc.body.appendChild(backpack);

  global.window = { location: { pathname: "/profiles/999", href: "https://backpack.tf/profiles/999" }, prompt: () => null };
  __resetListingQueueForTests();

  const result = listingQueue();
  assert.equal(result, undefined);
  assert.equal(getDrawer(), undefined);
});

test("does nothing when the page has no #backpack at all", () => {
  resetFakeDom();
  const doc = createFakeDocument();
  doc.querySelector = (sel) => doc.documentElement.querySelector(sel);
  doc.querySelectorAll = (sel) => doc.documentElement.querySelectorAll(sel);
  global.document = doc;
  global.window = { location: { pathname: "/profiles/765", href: "https://backpack.tf/profiles/765" }, prompt: () => null };
  __resetListingQueueForTests();

  const result = listingQueue();
  assert.equal(result, undefined);
});
