import { test } from "node:test";
import assert from "node:assert/strict";
import { keyPriceDisplay } from "../marketplace.tf/keyPriceDisplay/content.js";

// Minimal hand-rolled fakes (see tests/oldUiSpellFilterToggle.test.js's own
// header note on why this repo hand-rolls rather than pulling in jsdom).
// content.js imports ../../utils/marketplaceTfPricing.js as a REAL relative
// import (not mocked here) - so its own getMarketplaceLiveKeyPriceUsd runs
// for real against a fake chrome.storage.local + fake `document` (only ever
// queried for its own <script> tags, to find the CSRF token), same as
// tests/marketplaceTfPricing.test.js's own fixtures.

function fakeStorageLocal(initial = {}) {
  const store = { ...initial };
  return {
    async get(keys) {
      const result = {};
      for (const k of keys) if (k in store) result[k] = store[k];
      return result;
    },
    async set(obj) {
      Object.assign(store, obj);
    },
  };
}

function fakeResponse({ status = 200, body = {} } = {}) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function fakeDayStatsHtml(rows) {
  const trs = rows.map(([price, volume]) => `\t\t\t<tr>\n\t\t\t<td>$${price}</td>\n\t\t\t<td>${volume}</td>\n\t\t</tr>`).join("\n");
  return `<table>\n\t<thead>...</thead>\n\t<tbody>\n${trs}\n\t</tbody>\n</table>`;
}

// A price <span> - resolveItemPriceUsd reads either its own
// data-original-title/title ("Converted from $X.XX") or, absent that, a
// leading "$X.XX" in its own textContent.
function fakeSpan({ tooltip = null, text = "" } = {}) {
  return {
    getAttribute: (name) => (name === "data-original-title" || name === "title" ? tooltip : null),
    textContent: text,
  };
}

// A price container (.item-box-price or .current-bid-amount) - holds one
// price span plus whatever key-price labels get appended into it.
function fakeContainer(span) {
  const children = [];
  return {
    span,
    children,
    querySelector(selector) {
      if (selector === "span") return span;
      if (selector.startsWith(".")) return children.find((c) => c.className === selector.slice(1)) || null;
      return null;
    },
    appendChild(el) {
      children.push(el);
      return el;
    },
  };
}

class FakeMutationObserver {
  constructor(cb) {
    this.cb = cb;
    FakeMutationObserver.instances.push(this);
  }
  observe() {}
}
FakeMutationObserver.instances = [];

const CSRF_SCRIPT = [{ textContent: 'MPTF.csrfCode = "abc123";' }];

// A generic fake element with just enough real-DOM-like surface (tagName,
// className/classList, children, querySelector(All), insertBefore,
// appendChild) to support both the pre-built Item List table fixtures below
// AND whatever document.createElement produces (th/td/div) - a richer shape
// than the label-only div the earlier tests needed, but harmless for those
// (the extra methods just go unused there).
function fakeElement({ tag = "div", className = "", textContent = "", children = [] } = {}) {
  const el = {
    tagName: tag.toUpperCase(),
    className,
    textContent,
    style: {},
    children,
    get classList() {
      return { contains: (cls) => (el.className || "").split(/\s+/).includes(cls) };
    },
    querySelector(selector) {
      if (selector.startsWith(".")) {
        const cls = selector.slice(1);
        return el.children.find((c) => (c.className || "").split(/\s+/).includes(cls)) || null;
      }
      const tagUpper = selector.toUpperCase();
      return el.children.find((c) => c.tagName === tagUpper) || null;
    },
    querySelectorAll(selector) {
      const tagUpper = selector.toUpperCase();
      return el.children.filter((c) => c.tagName === tagUpper);
    },
    insertBefore(newNode, referenceNode) {
      const idx = referenceNode ? el.children.indexOf(referenceNode) : el.children.length;
      el.children.splice(idx === -1 ? el.children.length : idx, 0, newNode);
      return newNode;
    },
    appendChild(newNode) {
      el.children.push(newNode);
      return newNode;
    },
  };
  return el;
}

// A price <span> living inside an Item List table cell - same shape
// fakeSpan documents, but also carries tagName/classList so the generic
// fakeElement's own querySelector("span") lookup can find it.
function fakeTableSpan({ tooltip = null, text = "" } = {}) {
  return {
    tagName: "SPAN",
    className: "",
    textContent: text,
    classList: { contains: () => false },
    getAttribute: (name) => (name === "data-original-title" || name === "title" ? tooltip : null),
  };
}

// Confirmed-live shape: <table class="table-bordered"><thead><tr><th>Name</th>
// <th>Price</th><th>Actions</th></tr></thead><tbody><tr>...</tr>...</tbody></table>.
// rows: array of {tooltip} | {text} for each body row's own price span.
function fakeItemListTable(rows) {
  const headerRow = fakeElement({
    tag: "tr",
    children: [fakeElement({ tag: "th", textContent: "Name" }), fakeElement({ tag: "th", textContent: "Price" }), fakeElement({ tag: "th", textContent: "Actions" })],
  });
  const thead = fakeElement({ tag: "thead", children: [headerRow] });

  const bodyRows = rows.map((spanOpts) => {
    const priceCell = fakeElement({ tag: "td", children: [fakeTableSpan(spanOpts)] });
    return fakeElement({
      tag: "tr",
      children: [fakeElement({ tag: "td", textContent: "Some Item" }), priceCell, fakeElement({ tag: "td" })],
    });
  });
  const tbody = fakeElement({ tag: "tbody", children: bodyRows });

  return fakeElement({ tag: "table", className: "table-bordered", children: [thead, tbody] });
}

function setupDom({
  itemBoxContainers = [],
  bidAmountContainers = [],
  tables = [],
  keyPriceHtml = fakeDayStatsHtml([["1.88", "1723"]]),
} = {}) {
  FakeMutationObserver.instances = [];
  global.MutationObserver = FakeMutationObserver;
  globalThis.chrome = { storage: { local: fakeStorageLocal() } };
  globalThis.fetch = async () => fakeResponse({ body: { success: true, html: keyPriceHtml } });

  global.document = {
    querySelectorAll: (selector) => {
      if (selector === ".item-box-price") return itemBoxContainers;
      if (selector === ".current-bid-amount") return bidAmountContainers;
      if (selector === ".table-bordered") return tables;
      if (selector === "script") return CSRF_SCRIPT;
      return [];
    },
    createElement: (tag) => fakeElement({ tag }),
    body: {},
  };
}

// keyPriceDisplay()'s own scan() is async (awaits the key price) - flushes a
// couple of microtask/macrotask ticks so the fire-and-forget scan() call in
// keyPriceDisplay() (and MutationObserver callbacks below) actually
// completes before assertions run.
async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test("adds a '≈X.XX keys' label under an item-box-price span with a Converted-from tooltip", async () => {
  const span = fakeSpan({ tooltip: "Converted from $0.04" });
  const container = fakeContainer(span);
  setupDom({ itemBoxContainers: [container] });

  keyPriceDisplay();
  await flush();

  assert.equal(container.children.length, 1);
  assert.equal(container.children[0].className, "tf2te-mptf-key-price");
  // 0.04 / 1.88 = 0.02127... -> "0.02"
  assert.equal(container.children[0].textContent, "≈0.02 keys");
});

test("adds a label under a current-bid-amount span with a Converted-from tooltip", async () => {
  const span = fakeSpan({ tooltip: "Converted from $111.10" });
  const container = fakeContainer(span);
  setupDom({ bidAmountContainers: [container] });

  keyPriceDisplay();
  await flush();

  // 111.10 / 1.88 = 59.09...
  assert.equal(container.children[0].textContent, "≈59.10 keys");
});

test("reads a plain USD price directly from the span's own text when there's no Converted-from tooltip", async () => {
  const span = fakeSpan({ text: "$1.88 each" });
  const container = fakeContainer(span);
  setupDom({ itemBoxContainers: [container] });

  keyPriceDisplay();
  await flush();

  assert.equal(container.children[0].textContent, "≈1.00 keys");
});

test("skips a price span shown in a non-USD currency with no Converted-from tooltip - can't resolve, doesn't guess", async () => {
  const span = fakeSpan({ text: "€95.74" }); // no tooltip at all
  const container = fakeContainer(span);
  setupDom({ itemBoxContainers: [container] });

  keyPriceDisplay();
  await flush();

  assert.equal(container.children.length, 0);
});

test("never inserts a duplicate label on a later MutationObserver tick", async () => {
  const span = fakeSpan({ tooltip: "Converted from $1.88" });
  const container = fakeContainer(span);
  setupDom({ itemBoxContainers: [container] });

  keyPriceDisplay();
  await flush();
  assert.equal(container.children.length, 1);

  FakeMutationObserver.instances[0].cb();
  await flush();

  assert.equal(container.children.length, 1);
});

test("annotates every matching container on the page", async () => {
  const spanA = fakeSpan({ tooltip: "Converted from $1.88" });
  const spanB = fakeSpan({ tooltip: "Converted from $9.40" });
  const containerA = fakeContainer(spanA);
  const containerB = fakeContainer(spanB);
  setupDom({ itemBoxContainers: [containerA, containerB] });

  keyPriceDisplay();
  await flush();

  assert.equal(containerA.children[0].textContent, "≈1.00 keys");
  assert.equal(containerB.children[0].textContent, "≈5.00 keys");
});

test("does nothing (no throw) when there are no price containers on the page at all", async () => {
  setupDom({});
  assert.doesNotThrow(() => keyPriceDisplay());
  await flush();
});

test("skips annotating entirely when the key price itself can't be resolved (e.g. logged out, no cache)", async () => {
  const span = fakeSpan({ tooltip: "Converted from $1.88" });
  const container = fakeContainer(span);
  setupDom({ itemBoxContainers: [container] });
  // Logged-out doc - no MPTF.csrfCode script, and nothing cached.
  global.document.querySelectorAll = (selector) => {
    if (selector === ".item-box-price") return [container];
    if (selector === "script") return [{ textContent: 'MPTF.CurrentPage = "items";' }]; // no csrfCode
    return [];
  };

  keyPriceDisplay();
  await flush();

  assert.equal(container.children.length, 0);
});

// --- Item List table: keys under each row's price ---------------------------
// Used to be its own "Keys" column; moved into the Price cell to free that
// column's width for the per-row classifieds buttons.

const keyLabelOf = (cell) => cell.children.find((c) => c.className === "tf2te-mptf-key-price") ?? null;

test("adds a '≈X.XX keys' label inside each row's Price cell, under the price, without adding a column", async () => {
  const table = fakeItemListTable([{ tooltip: "Converted from $4.99" }, { tooltip: "Converted from $9.98" }]);
  setupDom({ tables: [table] });

  keyPriceDisplay();
  await flush();

  const [thead, tbody] = table.children;
  const [headerRow] = thead.children;
  assert.deepEqual(
    headerRow.children.map((th) => th.textContent),
    ["Name", "Price", "Actions"],
  );

  const [row1, row2] = tbody.children;
  assert.equal(row1.children.length, 3);
  // 4.99 / 1.88 = 2.6543... ; 9.98 / 1.88 = 5.3085...
  assert.equal(keyLabelOf(row1.children[1])?.textContent, "≈2.65 keys");
  assert.equal(keyLabelOf(row2.children[1])?.textContent, "≈5.31 keys");
  assert.equal(row1.children[0].textContent, "Some Item");
});

test("never inserts a duplicate key label in a row on a later scan", async () => {
  const table = fakeItemListTable([{ tooltip: "Converted from $4.99" }]);
  setupDom({ tables: [table] });

  keyPriceDisplay();
  await flush();
  FakeMutationObserver.instances[0].cb();
  await flush();

  const priceCell = table.children[1].children[0].children[1];
  assert.equal(priceCell.children.filter((c) => c.className === "tf2te-mptf-key-price").length, 1);
});

test("skips a table with no 'Price' header at all - doesn't guess a column position", async () => {
  const headerRow = fakeElement({ tag: "tr", children: [fakeElement({ tag: "th", textContent: "Name" })] });
  const thead = fakeElement({ tag: "thead", children: [headerRow] });
  const tbody = fakeElement({ tag: "tbody", children: [] });
  const table = fakeElement({ tag: "table", className: "table-bordered", children: [thead, tbody] });
  setupDom({ tables: [table] });

  keyPriceDisplay();
  await flush();

  assert.equal(headerRow.children.length, 1); // untouched
});

test("skips just the one row whose price span has no resolvable USD value, leaving the rest of the table intact", async () => {
  const table = fakeItemListTable([{ tooltip: "Converted from $4.99" }, { text: "€8.62" }]); // second row: no tooltip at all
  setupDom({ tables: [table] });

  keyPriceDisplay();
  await flush();

  const [, tbody] = table.children;
  const [row1, row2] = tbody.children;
  assert.equal(keyLabelOf(row1.children[1])?.textContent, "≈2.65 keys");
  assert.equal(keyLabelOf(row2.children[1]), null); // couldn't resolve
  assert.equal(row2.children.length, 3);
});

