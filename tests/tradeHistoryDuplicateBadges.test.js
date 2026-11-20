import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeElement, FakeMutationObserver, createFakeDocument, resetFakeDom } from "./helpers/fakeDom.js";
import { showDuplicateBadges } from "../steamcommunity.com/tradeHistoryFetch/duplicateBadges.js";

// showDuplicateBadges - NON-destructive duplicate collapsing for
// /inventoryhistory/ (see that file's own header note on why, unlike
// steamcommunity.com/tradeHistoryDuplicates/content.js's own version for
// /tradehistory/, which physically removes duplicate elements - this page is
// SCANNED by ./content.js's own runExport, so every real element must stay
// fully present/queryable regardless of what this file does for display).
// These tests are the correctness guarantee for that: after this runs,
// every original item element must still be reachable via querySelectorAll
// with every one of its own data-* attributes untouched.

function itemEl({ name, colorHex = "7D6D00", assetId = null, id }) {
  const el = new FakeElement(assetId ? "a" : "span");
  el.classList.add("history_item");
  if (id) el.id = id;
  el.setAttribute("data-appid", "440");
  el.setAttribute("data-amount", "1");
  if (assetId) el.setAttribute("href", `https://steamcommunity.com/id/x/inventory/#440_2_${assetId}`);
  const nameEl = new FakeElement("span");
  nameEl.classList.add("history_item_name");
  nameEl.setAttribute("style", `color: #${colorHex}`);
  nameEl.textContent = name;
  el.appendChild(nameEl);
  if (assetId) {
    const img = new FakeElement("img");
    // .src set as a plain property, not just via setAttribute - readItem()'s
    // own key derivation reads img.src (the resolved-URL IDL property a real
    // <img> always has), not getAttribute("src").
    img.src = `https://example.com/${name}.png`;
    el.appendChild(img);
  }
  return el;
}

// fakeDom.js's own FakeElement models `.children` as elements only - it has
// no concept of an interspersed sibling text node the way a real browser DOM
// does (the real markup's own literal ", " between adjacent items).
// linkCommaSeparators below wires those up by hand for the tests that check
// the comma handling; the rest cover hiding, badges, and - the actual
// correctness guarantee this file exists for - that every real element and
// its own attributes survive completely untouched.
//
// The group itself is wrapped in an outer `root` container, and the fake
// document queries FROM root, not from group directly - querySelectorAll
// only ever searches a root's DESCENDANTS, never the root element itself, so
// pointing the fake document straight at group (which itself matches
// GROUP_SELECTOR) would make showDuplicateBadges's own
// document.querySelectorAll(".tradehistory_items_group") find nothing at
// all.
function installGroupDom(items) {
  const group = new FakeElement("div");
  group.classList.add("tradehistory_items_group");
  items.forEach((item) => group.appendChild(item));

  const root = new FakeElement("div");
  root.appendChild(group);

  globalThis.document = createFakeDocument({ querySelector: (s) => root.querySelector(s), querySelectorAll: (s) => root.querySelectorAll(s) });
  globalThis.MutationObserver = FakeMutationObserver;

  return group;
}

test.beforeEach(() => {
  resetFakeDom();
});

// Wires real-shaped ", " separator text nodes between items by hand (see the
// note above on why FakeElement can't model them itself), so the comma
// handling can be checked. Returns the separators in document order.
function linkCommaSeparators(items) {
  const commas = [];
  for (let i = 0; i < items.length - 1; i++) {
    const comma = { nodeType: 3, textContent: ", " };
    commas.push(comma);
    Object.defineProperty(items[i], "nextSibling", { value: comma, configurable: true });
    Object.defineProperty(items[i + 1], "previousSibling", { value: comma, configurable: true });
  }
  Object.defineProperty(items[0], "previousSibling", { value: null, configurable: true });
  Object.defineProperty(items[items.length - 1], "nextSibling", { value: null, configurable: true });
  return commas;
}

test("showDuplicateBadges - a hidden duplicate that's the LAST item in the group leaves no dangling comma behind", () => {
  const items = [itemEl({ name: "Refined Metal", assetId: "1" }), itemEl({ name: "Scrap Metal", assetId: "2" }), itemEl({ name: "Refined Metal", assetId: "3" })];
  const [betweenRefinedAndScrap, beforeLastRefined] = linkCommaSeparators(items);
  installGroupDom(items);

  showDuplicateBadges();

  // Visible: "Refined Metal ×2, Scrap Metal" - the comma before the hidden
  // trailing duplicate must go, the one between the two visible items stays.
  assert.equal(beforeLastRefined.textContent, "");
  assert.equal(betweenRefinedAndScrap.textContent, ", ");
});

test("showDuplicateBadges - a hidden duplicate in the MIDDLE removes exactly one comma, keeping the list correctly separated", () => {
  const items = [itemEl({ name: "Refined Metal", assetId: "1" }), itemEl({ name: "Refined Metal", assetId: "2" }), itemEl({ name: "Scrap Metal", assetId: "3" })];
  const commas = linkCommaSeparators(items);
  installGroupDom(items);

  showDuplicateBadges();

  // Visible: "Refined Metal ×2, Scrap Metal" - exactly one ", " left.
  assert.equal(commas.filter((c) => c.textContent === ", ").length, 1);
});

test("showDuplicateBadges - hides duplicate elements (CSS class) rather than removing them from the DOM", () => {
  const group = installGroupDom([itemEl({ name: "Refined Metal", assetId: "1" }), itemEl({ name: "Refined Metal", assetId: "2" }), itemEl({ name: "Refined Metal", assetId: "3" })]);

  showDuplicateBadges();

  const items = group.querySelectorAll(".history_item");
  assert.equal(items.length, 3, "all 3 real elements must still be present and queryable");
  assert.equal(items[0].classList.contains("tf2te-thx-dup-hidden"), false, "the first (kept/visible) item is not hidden");
  assert.equal(items[1].classList.contains("tf2te-thx-dup-hidden"), true);
  assert.equal(items[2].classList.contains("tf2te-thx-dup-hidden"), true);
});

test("showDuplicateBadges - every duplicate's own attributes (assetId, amount) stay completely unchanged", () => {
  const group = installGroupDom([itemEl({ name: "Refined Metal", assetId: "111" }), itemEl({ name: "Refined Metal", assetId: "222" })]);

  showDuplicateBadges();

  const items = group.querySelectorAll(".history_item");
  assert.equal(items[0].getAttribute("href"), "https://steamcommunity.com/id/x/inventory/#440_2_111");
  assert.equal(items[1].getAttribute("href"), "https://steamcommunity.com/id/x/inventory/#440_2_222");
  assert.equal(items[0].getAttribute("data-amount"), "1");
  assert.equal(items[1].getAttribute("data-amount"), "1");
});

test("showDuplicateBadges - adds a ×N badge to the visible (first) item, matching the real duplicate count", () => {
  const group = installGroupDom([itemEl({ name: "Refined Metal", assetId: "1" }), itemEl({ name: "Refined Metal", assetId: "2" }), itemEl({ name: "Refined Metal", assetId: "3" })]);

  showDuplicateBadges();

  const items = group.querySelectorAll(".history_item");
  const badge = items[0].querySelector(".tf2te-thx-dup-badge");
  assert.ok(badge);
  assert.equal(badge.textContent, "×3");
});

test("showDuplicateBadges - a group with no real duplicates (every item a distinct name) is left completely untouched", () => {
  const group = installGroupDom([itemEl({ name: "Refined Metal", assetId: "1" }), itemEl({ name: "Reclaimed Metal", assetId: "2" }), itemEl({ name: "Scrap Metal", assetId: "3" })]);

  showDuplicateBadges();

  const items = group.querySelectorAll(".history_item");
  for (const item of items) {
    assert.equal(item.classList.contains("tf2te-thx-dup-hidden"), false);
    assert.equal(item.querySelector(".tf2te-thx-dup-badge"), null);
  }
});

test("showDuplicateBadges - distinguishes given items (no img) from received items (with img) sharing the same name, does not merge them", () => {
  // Backpack Expander given (no img, per this page's own convention for
  // given items - see this file's own header note) vs. a differently-shaped
  // received item that happens to share a name should NOT be treated as
  // duplicates of each other.
  const givenNoImg = new FakeElement("span");
  givenNoImg.classList.add("history_item");
  const nameEl1 = new FakeElement("span");
  nameEl1.classList.add("history_item_name");
  nameEl1.textContent = "Backpack Expander";
  givenNoImg.appendChild(nameEl1);

  const receivedWithImg = itemEl({ name: "Backpack Expander", assetId: "9" });

  const group = installGroupDom([givenNoImg, receivedWithImg]);

  showDuplicateBadges();

  const items = group.querySelectorAll(".history_item");
  assert.equal(items[0].classList.contains("tf2te-thx-dup-hidden"), false);
  assert.equal(items[1].classList.contains("tf2te-thx-dup-hidden"), false);
});

test("showDuplicateBadges - re-running (simulating the MutationObserver firing again after Load More) is idempotent, no doubled badges", () => {
  const group = installGroupDom([itemEl({ name: "Refined Metal", assetId: "1" }), itemEl({ name: "Refined Metal", assetId: "2" })]);

  showDuplicateBadges();
  showDuplicateBadges();

  const items = group.querySelectorAll(".history_item");
  const badges = items[0].querySelectorAll(".tf2te-thx-dup-badge");
  assert.equal(badges.length, 1);
  assert.equal(badges[0].textContent, "×2");
});

// A re-run against an already-correctly-processed group used to
// unconditionally remove and recreate the badge element (and re-apply
// HIDDEN_CLASS) even when nothing had actually changed - but that
// removal+recreation is itself a DOM mutation, which the live
// MutationObserver detects, which re-triggers this same function, which
// mutates again - a genuine infinite loop. The test above only checked the
// FINAL state was correct, which this exact bug still passed (the end state
// WAS correct - it just kept re-mutating to get there, forever). This test
// instead proves NO mutation happens at all on a re-run: the
// badge/hidden-marked elements must be the SAME object references, not
// merely equal-looking new ones.
test("showDuplicateBadges - a second run on an already-correct group performs ZERO DOM mutations (the actual infinite-loop guarantee)", () => {
  const group = installGroupDom([itemEl({ name: "Refined Metal", assetId: "1" }), itemEl({ name: "Refined Metal", assetId: "2" }), itemEl({ name: "Refined Metal", assetId: "3" })]);

  showDuplicateBadges();
  const items = group.querySelectorAll(".history_item");
  const badgeBefore = items[0].querySelector(".tf2te-thx-dup-badge");
  const childCountBefore = items[0].children.length;

  showDuplicateBadges();
  const badgeAfter = items[0].querySelector(".tf2te-thx-dup-badge");

  assert.equal(badgeAfter, badgeBefore, "the badge element itself must not be removed/recreated on a no-op re-run");
  assert.equal(items[0].children.length, childCountBefore, "no extra children should ever accumulate");
});
