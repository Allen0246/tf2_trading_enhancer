import { test } from "node:test";
import assert from "node:assert/strict";
import { inventoryGroupBy } from "../backpack.tf/oldUI/inventoryGroupBy/content.js";

// Minimal hand-rolled fakes (see tests/helpers/fakeDom.js's own header on why
// this repo hand-rolls rather than pulling in jsdom). Shapes mirror real
// markup confirmed live against backpack.tf's own inventory viewer page,
// cross-checked against a known-working reference implementation of this
// same grouping feature - see content.js's own header note.

const CUSTOM_MODE_ATTR = "data-tf2te-mode";
const GROUP_WRAPPER_ATTR = "data-tf2te-group-wrapper";

function fakeItem(extraAttrs = {}) {
  const attrs = { "data-defindex": "61", ...extraAttrs };
  return {
    _isItem: true,
    getAttribute: (name) => attrs[name] ?? null,
    parentElement: null,
  };
}

function fakeLevelItem(level) {
  return fakeItem(level != null ? { "data-level": String(level) } : {});
}

// A generic element used for every document.createElement() call in
// content.js (div/span/ul/li/a/i alike). appendChild mirrors real DOM move
// semantics (relocating an already-attached node out of its current
// parent's own children list first). querySelectorAll here only ever needs
// to find nested fake items (see fakeItem's own _isItem marker) within this
// element's own subtree, which is all content.js's own wrapper.
// querySelectorAll(ITEM_SELECTOR) call needs.
function fakeElement() {
  const children = [];
  const attrs = {};
  const listeners = {};
  const el = {
    id: "",
    className: "",
    textContent: "",
    parentElement: null,
    setAttribute: (name, value) => {
      attrs[name] = value;
    },
    getAttribute: (name) => attrs[name] ?? null,
    addEventListener: (eventName, cb) => {
      listeners[eventName] = cb;
    },
    appendChild: (child) => {
      const currentParent = child.parentElement;
      if (currentParent?._children) {
        const idx = currentParent._children.indexOf(child);
        if (idx !== -1) currentParent._children.splice(idx, 1);
      }
      children.push(child);
      child.parentElement = el;
      return child;
    },
    remove: () => {
      if (el.parentElement?._children) {
        const idx = el.parentElement._children.indexOf(el);
        if (idx !== -1) el.parentElement._children.splice(idx, 1);
      }
    },
    querySelectorAll: (selector) => {
      if (selector !== "li.item[data-defindex]") return [];
      const found = [];
      const walk = (node) => {
        node._children?.forEach((child) => {
          if (child._isItem) found.push(child);
          walk(child);
        });
      };
      walk(el);
      return found;
    },
    _click: () => listeners.click?.(),
    _children: children,
  };
  return el;
}

// The dropdown's own <ul class="dropdown-menu"> - querySelector/
// querySelectorAll here only ever need to support content.js's own two
// lookups (an already-inserted custom <li>, and every native
// <li data-value] not carrying data-tf2te-mode).
function fakeDropdownMenu(nativeLis) {
  const children = [...nativeLis];
  return {
    querySelector: (selector) => {
      if (selector === `[${CUSTOM_MODE_ATTR}]`) return children.find((c) => c.getAttribute(CUSTOM_MODE_ATTR) != null) || null;
      return null;
    },
    querySelectorAll: (selector) => {
      if (selector === `li[data-value]:not([${CUSTOM_MODE_ATTR}])`) {
        return children.filter((c) => c.getAttribute("data-value") != null && c.getAttribute(CUSTOM_MODE_ATTR) == null);
      }
      return [];
    },
    appendChild: (child) => {
      children.push(child);
      return child;
    },
    _children: children,
  };
}

function fakeNativeLi(dataValue) {
  const el = fakeElement();
  el.setAttribute("data-value", dataValue);
  return el;
}

// A native <div class="backpack-page"> already on the page (real per-page
// markup, not built by content.js) - just needs to behave like any other
// fakeElement for this file's own purposes (removable, holds items findable
// via querySelectorAll).
function fakeNativePage(items) {
  const page = fakeElement();
  const itemList = fakeElement();
  page.appendChild(itemList);
  items.forEach((item) => itemList.appendChild(item));
  return page;
}

// The top-level #backpack container every .backpack-page div (native or
// custom) lives in - appendChild mirrors real DOM move semantics, matching
// content.js's own applyMode/clearCustomGrouping, which move items and
// wrapper divs already present elsewhere in this same fake document.
function fakeBackpackContainer(initialChildren) {
  const container = {
    _children: [...initialChildren],
    get children() {
      return container._children;
    },
    appendChild: (child) => {
      const currentParent = child.parentElement;
      if (currentParent?._children) {
        const idx = currentParent._children.indexOf(child);
        if (idx !== -1) currentParent._children.splice(idx, 1);
      }
      container._children.push(child);
      child.parentElement = container;
      return child;
    },
  };
  initialChildren.forEach((child) => {
    child.parentElement = container;
  });
  return container;
}

function setupDom({ backpackChildren = [], items = [], menu = null } = {}) {
  const backpackContainer = fakeBackpackContainer(backpackChildren);

  global.document = {
    querySelector: (selector) => {
      if (selector === "#inventory-sort-menu .dropdown-menu") return menu;
      return null;
    },
    querySelectorAll: (selector) => {
      if (selector === "li.item[data-defindex]") return items;
      if (selector === `[${GROUP_WRAPPER_ATTR}]`) return backpackContainer._children.filter((el) => el.getAttribute?.(GROUP_WRAPPER_ATTR) != null);
      return [];
    },
    getElementById: (id) => (id === "backpack" ? backpackContainer : null),
    createElement: () => fakeElement(),
    createTextNode: (text) => ({ textContent: text }),
    head: { appendChild() {} },
  };

  return { backpackContainer };
}

test("does nothing when #inventory-sort-menu's own dropdown menu isn't present", () => {
  setupDom({ menu: null });
  assert.doesNotThrow(() => inventoryGroupBy());
});

test("does nothing when a custom mode <li> is already present (idempotent across repeated calls)", () => {
  const existing = fakeNativeLi(null);
  existing.setAttribute(CUSTOM_MODE_ATTR, "level");
  const menu = fakeDropdownMenu([existing]);
  setupDom({ menu });

  const before = menu._children.length;
  inventoryGroupBy();

  assert.equal(menu._children.length, before);
});

test("appends one <li> per mode to the native dropdown menu, in that order", () => {
  const nativeLi = fakeNativeLi("bpslot");
  const menu = fakeDropdownMenu([nativeLi]);
  setupDom({ menu });

  inventoryGroupBy();

  assert.equal(menu._children.length, 10); // 1 native + 9 custom
  const added = menu._children.slice(1);
  assert.deepEqual(
    added.map((li) => li.getAttribute(CUSTOM_MODE_ATTR)),
    ["level", "paint", "effect", "spell", "scm", "classifieds", "killstreak", "killstreak_effect", "killstreak_sheen"]
  );
  assert.deepEqual(
    added.map((li) => li._children[0].textContent),
    [
      "Group by level",
      "Group by paint",
      "Group by effect",
      "Group by spell",
      "Group by scm",
      "Group by classifieds",
      "Group by killstreak",
      "Group by killstreaker",
      "Group by sheen",
    ]
  );
});

test("clicking 'Group by level' wraps each level into its own .backpack-page > .page-number + ul.item-list, ascending, unrecognized items trailing in 'Unknown Level'", () => {
  const item5 = fakeLevelItem(5);
  const item1 = fakeLevelItem(1);
  const item5b = fakeLevelItem(5);
  const itemNoLevel = fakeLevelItem(null);
  const nativePage = fakeNativePage([item5, item1, item5b, itemNoLevel]); // one native page holding everything, like a real fresh page load
  const nativeLi = fakeNativeLi("bpslot");
  const menu = fakeDropdownMenu([nativeLi]);
  const { backpackContainer } = setupDom({ backpackChildren: [nativePage], items: [item5, item1, item5b, itemNoLevel], menu });

  inventoryGroupBy();
  const groupLi = menu._children[1];
  groupLi._children[0]._click(); // the <a> inside the custom <li>

  // the stale native page is gone, replaced by 3 group wrappers (1, 5, Unknown).
  assert.equal(backpackContainer._children.length, 3);
  assert.equal(backpackContainer._children.includes(nativePage), false);

  const [wrap1, wrap5, wrapUnknown] = backpackContainer._children;

  assert.equal(wrap1.className, "backpack-page");
  assert.equal(wrap1.getAttribute(GROUP_WRAPPER_ATTR), "true");
  const [header1, itemList1] = wrap1._children;
  assert.equal(header1.className, "page-number");
  const [anchor1, label1, selectBtn1] = header1._children;
  assert.equal(anchor1.className, "page-anchor");
  assert.ok(anchor1.id.length > 0);
  assert.equal(label1.className, "label label-default");
  assert.equal(label1.textContent, "Level 1");
  assert.equal(label1.getAttribute("href"), `#${anchor1.id}`);
  assert.equal(selectBtn1.className, "btn btn-primary btn-xs pull-right select-page");
  assert.equal(itemList1.className, "item-list");
  assert.deepEqual(itemList1._children, [item1]);

  const [, itemList5] = wrap5._children;
  assert.deepEqual(itemList5._children, [item5, item5b]);

  const [headerUnknown, itemListUnknown] = wrapUnknown._children;
  assert.equal(headerUnknown._children[1].textContent, "Unknown Level");
  assert.deepEqual(itemListUnknown._children, [itemNoLevel]);

  // every group's anchor id is unique.
  const anchorIds = [wrap1, wrap5, wrapUnknown].map((w) => w._children[0]._children[0].id);
  assert.equal(new Set(anchorIds).size, 3);
});

test("clicking a NATIVE sort option un-wraps every custom group back to flat items under the backpack container, without deleting any item", () => {
  const item5 = fakeLevelItem(5);
  const nativePage = fakeNativePage([item5]);
  const nativeLi = fakeNativeLi("bpslot");
  const menu = fakeDropdownMenu([nativeLi]);
  const { backpackContainer } = setupDom({ backpackChildren: [nativePage], items: [item5], menu });

  inventoryGroupBy();
  const groupLi = menu._children[1];
  groupLi._children[0]._click();
  assert.equal(backpackContainer._children.some((el) => el.getAttribute?.(GROUP_WRAPPER_ATTR) === "true"), true);

  nativeLi._click();

  assert.equal(backpackContainer._children.some((el) => el.getAttribute?.(GROUP_WRAPPER_ATTR) === "true"), false);
  assert.equal(backpackContainer._children.includes(item5), true); // un-wrapped, not deleted
});

test("clicking 'Group by level' a second time rebuilds groups instead of stacking duplicate wrappers", () => {
  const item5 = fakeLevelItem(5);
  const item1 = fakeLevelItem(1);
  const nativePage = fakeNativePage([item5, item1]);
  const nativeLi = fakeNativeLi("bpslot");
  const menu = fakeDropdownMenu([nativeLi]);
  const { backpackContainer } = setupDom({ backpackChildren: [nativePage], items: [item5, item1], menu });

  inventoryGroupBy();
  const groupLi = menu._children[1];
  groupLi._children[0]._click();
  groupLi._children[0]._click();

  assert.equal(backpackContainer._children.length, 2); // Level 1 and Level 5 wrappers - not 4
});

// Reads each group wrapper's own label text + the items it ended up
// holding, in DOM order - shared by every mode test below so each one only
// has to assert on the actual grouping result, not re-derive this from
// content.js's own internal wrapper/header/item-list shape every time.
function readGroups(backpackContainer) {
  return backpackContainer._children.map((wrapper) => {
    const [header, itemList] = wrapper._children;
    const label = header._children[1].textContent;
    return { label, items: [...itemList._children] };
  });
}

function setupAndClickMode(modeIndex, items) {
  const nativePage = fakeNativePage(items);
  const menu = fakeDropdownMenu([fakeNativeLi("bpslot")]);
  const { backpackContainer } = setupDom({ backpackChildren: [nativePage], items, menu });

  inventoryGroupBy();
  const link = menu._children[1 + modeIndex]._children[0];
  link._click();

  return { backpackContainer, link };
}

test("Group by paint groups items by data-paint_name, unpainted items land in 'Not Painted'", () => {
  const indianRed = fakeItem({ "data-paint_name": "Indian Red" });
  const auAu = fakeItem({ "data-paint_name": "A Deep Commitment to Purple" });
  const unpainted = fakeItem({});
  const { backpackContainer } = setupAndClickMode(1, [indianRed, auAu, unpainted]);

  const groups = readGroups(backpackContainer);
  assert.deepEqual(
    groups.map((g) => g.label),
    ["A Deep Commitment to Purple", "Indian Red", "Not Painted"] // alphabetical, unpainted last
  );
  assert.deepEqual(groups[2].items, [unpainted]);
});

test("Group by effect groups items by data-effect_name, non-Unusual items land in 'Not Unusual'", () => {
  const silverCyclone = fakeItem({ "data-effect_name": "Silver Cyclone" });
  const burningFlames = fakeItem({ "data-effect_name": "Burning Flames" });
  const plain = fakeItem({});
  const { backpackContainer } = setupAndClickMode(2, [silverCyclone, burningFlames, plain]);

  const groups = readGroups(backpackContainer);
  assert.deepEqual(
    groups.map((g) => g.label),
    ["Burning Flames", "Silver Cyclone", "Not Unusual"] // alphabetical, non-Unusual last
  );
  assert.deepEqual(groups[2].items, [plain]);
});

test("Group by spell combines a double-spelled item's own two spells into one shared group regardless of attribute slot order", () => {
  const single = fakeItem({ "data-spell_1": "Halloween Fire" });
  const doubleAB = fakeItem({ "data-spell_1": "Exorcism", "data-spell_2": "Team Spirit Footprints" });
  const doubleBA = fakeItem({ "data-spell_1": "Team Spirit Footprints", "data-spell_2": "Exorcism" }); // same pair, opposite slots
  const none = fakeItem({});
  const { backpackContainer } = setupAndClickMode(3, [single, doubleAB, doubleBA, none]);

  const groups = readGroups(backpackContainer);
  const combined = groups.find((g) => g.label === "Exorcism and Team Spirit Footprints");
  assert.ok(combined, "expected one shared group for both double-spell orderings");
  assert.deepEqual(combined.items, [doubleAB, doubleBA]);
  assert.deepEqual(
    groups.find((g) => g.label === "Halloween Fire").items,
    [single]
  );
  assert.deepEqual(groups.find((g) => g.label === "No Spell").items, [none]);
});

test("Group by scm splits items into 'Has SCM Price' / 'No SCM Price' by data-p_scm presence", () => {
  const withScm = fakeItem({ "data-p_scm": "$0.14" });
  const withoutScm = fakeItem({});
  const { backpackContainer } = setupAndClickMode(4, [withScm, withoutScm]);

  const groups = readGroups(backpackContainer);
  assert.deepEqual(groups.find((g) => g.label === "Has SCM Price").items, [withScm]);
  assert.deepEqual(groups.find((g) => g.label === "No SCM Price").items, [withoutScm]);
});

test("Group by classifieds splits items into 'Listed on Classifieds' / 'Not Listed' by data-listing_price presence", () => {
  const listed = fakeItem({ "data-listing_price": "2 keys" });
  const unlisted = fakeItem({});
  const { backpackContainer } = setupAndClickMode(5, [listed, unlisted]);

  const groups = readGroups(backpackContainer);
  assert.deepEqual(groups.find((g) => g.label === "Listed on Classifieds").items, [listed]);
  assert.deepEqual(groups.find((g) => g.label === "Not Listed").items, [unlisted]);
});

test("Group by killstreak is a simple binary split - 'Standard Killstreak' (any tier) vs 'No Killstreak' - not broken down by tier/effect/sheen", () => {
  const professional = fakeItem({ "data-killstreaker": "Cerebral Discharge", "data-sheen": "Team Shine", "data-ks_tier": "3" });
  const specialized = fakeItem({ "data-sheen": "Hot Rod", "data-ks_tier": "2" });
  const basic = fakeItem({ "data-ks_tier": "1" });
  const plain = fakeItem({});
  const { backpackContainer } = setupAndClickMode(6, [professional, specialized, basic, plain]);

  const groups = readGroups(backpackContainer);
  assert.deepEqual(
    groups.map((g) => g.label),
    ["Standard Killstreak", "No Killstreak"]
  );
  assert.deepEqual(groups.find((g) => g.label === "Standard Killstreak").items, [professional, specialized, basic]);
  assert.deepEqual(groups.find((g) => g.label === "No Killstreak").items, [plain]);
});

test("Group by killstreaker groups by effect - Basic (tier 1, no killstreaker) kits fold into 'No Killstreaker' with plain items, no separate 'Killstreak' bucket", () => {
  const professional = fakeItem({ "data-killstreaker": "Cerebral Discharge", "data-sheen": "Team Shine", "data-ks_tier": "3" });
  const specialized = fakeItem({ "data-sheen": "Hot Rod", "data-ks_tier": "2" });
  const basic = fakeItem({ "data-ks_tier": "1" });
  const plain = fakeItem({});
  const { backpackContainer } = setupAndClickMode(7, [professional, specialized, basic, plain]);

  const groups = readGroups(backpackContainer);
  assert.deepEqual(groups.find((g) => g.label === "Cerebral Discharge").items, [professional]);
  assert.equal(groups.some((g) => g.label === "Killstreak"), false);
  assert.deepEqual(groups.find((g) => g.label === "No Killstreaker").items, [specialized, basic, plain]);
});

test("Group by sheen groups by sheen instead, as its own separately-clickable mode (not a second click on the effect one) - Basic (tier 1, no sheen) kits fold into 'No Sheen' with plain items, no separate 'Killstreak' bucket", () => {
  const professional = fakeItem({ "data-killstreaker": "Cerebral Discharge", "data-sheen": "Team Shine", "data-ks_tier": "3" });
  const specialized = fakeItem({ "data-sheen": "Hot Rod", "data-ks_tier": "2" });
  const basic = fakeItem({ "data-ks_tier": "1" });
  const plain = fakeItem({});
  const { backpackContainer } = setupAndClickMode(8, [professional, specialized, basic, plain]);

  const groups = readGroups(backpackContainer);
  assert.deepEqual(groups.find((g) => g.label === "Team Shine").items, [professional]);
  assert.deepEqual(groups.find((g) => g.label === "Hot Rod").items, [specialized]);
  assert.equal(groups.some((g) => g.label === "Killstreak"), false);
  assert.deepEqual(groups.find((g) => g.label === "No Sheen").items, [basic, plain]);
});
