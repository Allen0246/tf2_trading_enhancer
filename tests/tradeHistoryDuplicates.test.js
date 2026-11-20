import { test } from "node:test";
import assert from "node:assert/strict";
import { tradeHistoryDuplicates } from "../steamcommunity.com/tradeHistoryDuplicates/content.js";

// Minimal hand-rolled fake DOM (see tests/helpers/fakeDom.js's own header on
// why this repo hand-rolls rather than pulling in jsdom). Item shapes mirror
// real markup confirmed live against steamcommunity.com/*/tradehistory/.

function fakeImg(src) {
  return { src };
}

function fakeNameSpan(text) {
  return { textContent: text };
}

// A single received <a class="history_item"> - querySelector only resolves
// "img" and ".history_item_name", same subset dedupeGroup itself reads.
function fakeHistoryItem({ src, name, tag = "A", hasImg = true, hasName = true }) {
  const img = hasImg ? fakeImg(src) : null;
  const nameEl = hasName ? fakeNameSpan(name) : null;
  const classSet = new Set(["history_item", "economy_item_hoverable"]);
  const children = [];
  return {
    tagName: tag,
    classList: { contains: (c) => classSet.has(c), add: (c) => classSet.add(c) },
    querySelector: (selector) => {
      if (selector === "img") return img;
      if (selector === ".history_item_name") return nameEl;
      return null;
    },
    appendChild(el) {
      children.push(el);
      return el;
    },
    get _badge() {
      return children.find((c) => c && c.className === "tf2te-tradehistory-badge") || null;
    },
  };
}

// A comma text node placeholder, distinguishable from a real item by not
// having a tagName of "A".
function fakeTextNode() {
  return { tagName: undefined };
}

function fakeGroup(children) {
  const appended = [];
  return {
    // dedupeGroup reads via `.children` directly (Array.from(group.children)...),
    // not querySelectorAll - real DOM's own .children live collection only
    // ever contains Elements (text nodes are excluded automatically), so
    // fakeTextNode() entries are deliberately left OUT of `children` here,
    // matching that same real behavior, and passed only via childNodes-style
    // reasoning in comments rather than actually included.
    children,
    set innerHTML(v) {
      if (v === "") {
        children.length = 0;
        appended.length = 0;
      }
    },
    appendChild(node) {
      appended.push(node);
      if (node.classList?.contains("history_item")) children.push(node);
      return node;
    },
    _appended: appended,
  };
}

function setupDom(groups) {
  global.document = {
    head: { appendChild() {} },
    getElementById: () => null,
    createElement: (tag) => (tag === "style" ? { textContent: "" } : { className: "", textContent: "", appendChild() {} }),
    createTextNode: (text) => ({ tagName: undefined, textContent: text }),
    querySelectorAll: (selector) => (selector === ".tradehistory_items_group" ? groups : []),
    body: {},
  };
  global.MutationObserver = class {
    observe() {}
  };
}

test("collapses 3 identical items into 1 representative + a ×3 badge", () => {
  const items = [
    fakeHistoryItem({ src: "img-a", name: "Refined Metal" }),
    fakeHistoryItem({ src: "img-a", name: "Refined Metal" }),
    fakeHistoryItem({ src: "img-a", name: "Refined Metal" }),
  ];
  const group = fakeGroup(items);
  setupDom([group]);

  tradeHistoryDuplicates();

  assert.equal(group.children.length, 1);
  assert.equal(group.children[0], items[0]); // first-seen kept as representative
  assert.equal(items[0]._badge.textContent, "×3");
});

test("leaves distinct items alone, with no badge on any of them", () => {
  const items = [
    fakeHistoryItem({ src: "img-a", name: "Refined Metal" }),
    fakeHistoryItem({ src: "img-b", name: "Reclaimed Metal" }),
    fakeHistoryItem({ src: "img-c", name: "Scrap Metal" }),
  ];
  const group = fakeGroup(items);
  setupDom([group]);

  tradeHistoryDuplicates();

  assert.equal(group.children.length, 3);
  items.forEach((item) => assert.equal(item._badge, null));
});

test("groups a mix of duplicates and uniques correctly, preserving first-seen order", () => {
  const refined1 = fakeHistoryItem({ src: "img-ref", name: "Refined Metal" });
  const key = fakeHistoryItem({ src: "img-key", name: "Mann Co. Supply Crate Key" });
  const refined2 = fakeHistoryItem({ src: "img-ref", name: "Refined Metal" });
  const scrap = fakeHistoryItem({ src: "img-scrap", name: "Scrap Metal" });
  const refined3 = fakeHistoryItem({ src: "img-ref", name: "Refined Metal" });
  const group = fakeGroup([refined1, key, refined2, scrap, refined3]);
  setupDom([group]);

  tradeHistoryDuplicates();

  assert.deepEqual(group.children, [refined1, key, scrap]);
  assert.equal(refined1._badge.textContent, "×3");
  assert.equal(key._badge, null);
  assert.equal(scrap._badge, null);
});

test("does nothing to a group with fewer than 2 items", () => {
  const item = fakeHistoryItem({ src: "img-a", name: "Refined Metal" });
  const group = fakeGroup([item]);
  setupDom([group]);

  tradeHistoryDuplicates();

  assert.equal(group.children.length, 1);
  assert.equal(item._badge, null);
});

test("leaves the WHOLE group untouched when any item has an unrecognized shape (missing img or name) - never guesses or partially rebuilds", () => {
  const normal = fakeHistoryItem({ src: "img-a", name: "Refined Metal" });
  const weird = fakeHistoryItem({ src: "img-a", name: "Refined Metal", hasImg: false }); // e.g. markup changed
  const group = fakeGroup([normal, weird]);
  setupDom([group]);

  tradeHistoryDuplicates();

  assert.equal(group.children.length, 2); // untouched - no rebuild happened
});

test("skips a stray non-history_item child entirely when reading a group's items", () => {
  const item1 = fakeHistoryItem({ src: "img-a", name: "Refined Metal" });
  const item2 = fakeHistoryItem({ src: "img-a", name: "Refined Metal" });
  const notAnItem = { tagName: "SPAN", classList: { contains: () => false } };
  const group = fakeGroup([item1, notAnItem, item2]);
  setupDom([group]);

  tradeHistoryDuplicates();

  assert.equal(group.children.length, 1);
  assert.equal(item1._badge.textContent, "×2");
});

test("REGRESSION: re-running against an already-collapsed group is a no-op (idempotent) - guards against a MutationObserver self-triggering loop the same way an unrelated earlier feature in this extension once did", () => {
  const items = [
    fakeHistoryItem({ src: "img-a", name: "Refined Metal" }),
    fakeHistoryItem({ src: "img-a", name: "Refined Metal" }),
  ];
  const group = fakeGroup(items);
  setupDom([group]);

  tradeHistoryDuplicates(); // first pass: collapses to 1 + badge
  assert.equal(group.children.length, 1);

  const before = group.children.slice();
  tradeHistoryDuplicates(); // second pass (simulating a re-triggered scan): must not touch it again
  assert.deepEqual(group.children, before);
});

test("does nothing when there are no tradehistory item groups on the page at all", () => {
  setupDom([]);
  assert.doesNotThrow(() => tradeHistoryDuplicates());
});

// "Given" (the "-" side) items have no image at all, confirmed live -
// <span class="history_item"><span class="history_item_name">Name</span></span>,
// grouped by name text alone since there's no img.src to include in the key.
test("collapses given (image-less) items too, grouped by name text alone", () => {
  const refined1 = fakeHistoryItem({ name: "Refined Metal", tag: "SPAN", hasImg: false });
  const refined2 = fakeHistoryItem({ name: "Refined Metal", tag: "SPAN", hasImg: false });
  const reclaimed = fakeHistoryItem({ name: "Reclaimed Metal", tag: "SPAN", hasImg: false });
  const group = fakeGroup([refined1, refined2, reclaimed]);
  setupDom([group]);

  tradeHistoryDuplicates();

  assert.equal(group.children.length, 2);
  assert.equal(refined1._badge.textContent, "×2");
  assert.equal(reclaimed._badge, null);
});

test("both received (with image) and given (without) groups on the same page are each collapsed independently", () => {
  const received = fakeGroup([
    fakeHistoryItem({ src: "img-a", name: "Refined Metal" }),
    fakeHistoryItem({ src: "img-a", name: "Refined Metal" }),
  ]);
  const given = fakeGroup([
    fakeHistoryItem({ name: "Taunt: The Russian Arms Race", tag: "SPAN", hasImg: false }),
    fakeHistoryItem({ name: "Taunt: The Russian Arms Race", tag: "SPAN", hasImg: false }),
    fakeHistoryItem({ name: "Taunt: The Russian Arms Race", tag: "SPAN", hasImg: false }),
  ]);
  setupDom([received, given]);

  tradeHistoryDuplicates();

  assert.equal(received.children.length, 1);
  assert.equal(received.children[0]._badge.textContent, "×2");
  assert.equal(given.children.length, 1);
  assert.equal(given.children[0]._badge.textContent, "×3");
});
