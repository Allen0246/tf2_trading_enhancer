import { test } from "node:test";
import assert from "node:assert/strict";
import { createFakeDocument, resetFakeDom, FakeMutationObserver } from "./helpers/fakeDom.js";
import { premiumSearchLastSeenHighlight, __resetSaleTimestampsForTests } from "../backpack.tf/nextUI/premiumSearchLastSeenHighlight/content.js";
import { SALE_RECENCY_CLASSES } from "../backpack.tf/shared/saleRecencyHighlight.js";

// The module-scope saleTimestampsByCurrentId Map is deliberately never
// cleared in production (real "Current ID"s are globally unique) - see
// content.js's own __resetSaleTimestampsForTests note on why this file
// needs to reset it between tests anyway (several tests below reuse
// placeholder ids like "1001").
test.beforeEach(() => {
  __resetSaleTimestampsForTests();
});

// Real (trimmed) markup shape confirmed live on next.backpack.tf/almanac/search
// - see backpack.tf/nextUI/premiumSearchLastSeenHighlight/content.js's own
// header note. The current owner's ".username" div is always first in the
// row (before any "Previous Owner" one), carries an "online" class token
// when that Steam account is online right now, and ".item-timestamp" holds
// the already-rendered "Last Seen" column text.
function buildTableHtml(rowsHtml, { withLastSeenColumn = true } = {}) {
  const headerHtml = withLastSeenColumn
    ? `<th><div class="p-column-header-content"><span class="p-column-title">Item</span></div></th>
       <th><div class="p-column-header-content"><span class="p-column-title">User</span></div></th>
       <th><div class="p-column-header-content"><span class="p-column-title">Last Seen</span></div></th>`
    : `<th><div class="p-column-header-content"><span class="p-column-title">Item</span></div></th>
       <th><div class="p-column-header-content"><span class="p-column-title">User</span></div></th>`;

  // Wrapped in the same ".p-datatable > .p-datatable-wrapper > table" shape
  // real page HTML has - needed so insertLegendStrip's own
  // table.closest(".p-datatable") has something real to find.
  return `
    <div class="p-datatable-sm p-datatable p-component p-datatable-responsive-scroll">
      <div class="p-datatable-wrapper">
        <table class="p-datatable-table">
          <thead class="p-datatable-thead"><tr role="row">${headerHtml}</tr></thead>
          <tbody class="p-datatable-tbody">${rowsHtml}</tbody>
        </table>
      </div>
    </div>`;
}

function buildRowHtml({ online, relativeAge, hasPreviousOwner = false, currentId = "1001" }) {
  const currentOwnerHtml = `
    <div class="d-flex align-items-center">
      <a href="/profiles/1/user"><div class="username d-inline-flex align-items-center default dark${online ? " online" : ""}">
        <div class="username__name truncate">Some Seller</div>
      </div></a>
    </div>`;
  const previousOwnerHtml = hasPreviousOwner
    ? `
    <div class="d-flex align-items-center">
      <span><a href="/profiles/2/user"><div class="username d-inline-flex align-items-center default dark online">
        <div class="username__name truncate">Some Other Person</div>
      </div></a></span>
    </div>`
    : "";

  return `
    <tr role="row">
      <td><div>item</div></td>
      <td><div>${currentOwnerHtml}${previousOwnerHtml}</div></td>
      <td><div><div content="Original ID">9999</div><div content="Current ID">${currentId}</div></div></td>
      <td><div class="item-timestamp truncate d-inline-flex" content="whatever">${relativeAge}</div></td>
    </tr>`;
}

// mainWorld.js's own broadcast (see backpack.tf/nextUI/
// premiumSearchLastSeenHighlight/mainWorld.js) arrives as a CustomEvent on
// `document` - createFakeDocument's own object has no addEventListener/
// dispatchEvent of its own (most of this repo's DOM-scan-only features
// never need them), so this adds a minimal version, same
// listeners-object-keyed-by-type pattern
// tests/inventoryMarketActionsMainWorld.test.js's own installDocument
// already establishes for the analogous steamcommunity.com bridge.
function installEventBridge(doc) {
  const listeners = {};
  doc.addEventListener = (type, cb) => {
    (listeners[type] ||= []).push(cb);
  };
  doc.dispatchEvent = (evt) => {
    (listeners[evt.type] || []).forEach((cb) => cb(evt));
  };
  return listeners;
}

class FakeCustomEvent {
  constructor(type, { detail } = {}) {
    this.type = type;
    this.detail = detail;
  }
}

function dispatchSaleTimestamps(doc, timestampsByCurrentId) {
  doc.dispatchEvent(new FakeCustomEvent("tf2te-premium-search-sale-timestamps", { detail: JSON.stringify(timestampsByCurrentId) }));
}

// The filter box (".item-filter") is what the legend strip anchors on now -
// see content.js's own insertLegendStrip note: it used to anchor on
// the results table, which doesn't exist at all in the page's own
// pre-search state. Included by default so existing table-focused tests
// don't have to know about it; omit via includeFilterBox: false for the
// tests that specifically cover its ABSENCE (the pre-search state itself).
const FILTER_BOX_HTML = `
  <div class="col" style="top:70px;">
    <div class="p-2 item-filter pb-1 px-2 rounded">
      <div class="d-flex flex-wrap align-items-stretch">filter controls</div>
    </div>
  </div>`;

function setupPage(tableHtml, { pathname = "/almanac/search", includeFilterBox = true } = {}) {
  resetFakeDom();
  const doc = createFakeDocument();
  doc.querySelector = (sel) => doc.documentElement.querySelector(sel);
  doc.querySelectorAll = (sel) => doc.documentElement.querySelectorAll(sel);
  installEventBridge(doc);
  global.document = doc;
  global.MutationObserver = FakeMutationObserver;
  global.window = { location: { pathname } };

  const wrapper = doc.createElement("div");
  wrapper.className = "p-datatable-wrapper";
  wrapper.innerHTML = (includeFilterBox ? FILTER_BOX_HTML : "") + tableHtml;
  doc.body.appendChild(wrapper);

  return { doc, wrapper, table: wrapper.querySelector(".p-datatable-table") };
}

// The stripe lands on the ROW's first <td> (see
// backpack.tf/nextUI/premiumSearchLastSeenHighlight/content.js's own header
// note on why not the <tr> itself: a <tr>-level border is unreliable under
// this table's border-collapse model).
function stripeOf(row) {
  const firstCell = row?.querySelector("td");
  return firstCell?.style.getPropertyValue("border-left") || undefined;
}

test("does nothing (no throw) when there's no p-datatable-table on the page at all", () => {
  resetFakeDom();
  const doc = createFakeDocument();
  doc.querySelector = (sel) => doc.documentElement.querySelector(sel);
  doc.querySelectorAll = (sel) => doc.documentElement.querySelectorAll(sel);
  installEventBridge(doc);
  global.document = doc;
  global.MutationObserver = FakeMutationObserver;
  global.window = { location: { pathname: "/almanac/search" } };

  assert.doesNotThrow(() => premiumSearchLastSeenHighlight());
});

// A PrimeVue datatable is a generic, reused component (the /items catalog,
// classifieds) - only a table with an actual "Last Seen" column is this
// feature's concern.
test("ignores a p-datatable-table that has no 'Last Seen' column at all", () => {
  const { table } = setupPage(buildTableHtml(buildRowHtml({ online: true, relativeAge: "1 hour ago" }), { withLastSeenColumn: false }));

  premiumSearchLastSeenHighlight();

  const row = table.querySelectorAll("tr").find((tr) => tr.querySelector(".item-timestamp") || tr.querySelector(".username"));
  assert.equal(stripeOf(row), undefined);
});

test("colors a row green when the current owner is online", () => {
  const { table } = setupPage(buildTableHtml(buildRowHtml({ online: true, relativeAge: "4 years ago" })));

  premiumSearchLastSeenHighlight();

  const dataRow = table.querySelector("tbody").querySelectorAll("tr")[0];
  assert.match(stripeOf(dataRow), /#2ecc71/);
});

test("colors a row yellow (FRESH) when offline and last seen under 24 hours ago", () => {
  const { table } = setupPage(buildTableHtml(buildRowHtml({ online: false, relativeAge: "3 hours ago" })));
  premiumSearchLastSeenHighlight();
  const dataRow = table.querySelector("tbody").querySelectorAll("tr")[0];
  assert.match(stripeOf(dataRow), /#f1c40f/);
});

test("colors a row gray (STALE) when offline and last seen 14 days ago (next.backpack.tf's own plain-days phrasing)", () => {
  const { table } = setupPage(buildTableHtml(buildRowHtml({ online: false, relativeAge: "14 days ago" })));
  premiumSearchLastSeenHighlight();
  const dataRow = table.querySelector("tbody").querySelectorAll("tr")[0];
  assert.match(stripeOf(dataRow), /#7f8c8d/);
});

// REGRESSION-style: the current owner's own ".username" is always first in
// the row - a "Previous Owner" block, when present, must never be mistaken
// for it.
test("uses the CURRENT owner's online status, not a 'Previous Owner' one, even when the previous owner is online and the current owner isn't", () => {
  const { table } = setupPage(buildTableHtml(buildRowHtml({ online: false, relativeAge: "1 hour ago", hasPreviousOwner: true })));

  premiumSearchLastSeenHighlight();

  const dataRow = table.querySelector("tbody").querySelectorAll("tr")[0];
  assert.match(stripeOf(dataRow), /#f1c40f/); // yellow, not green
});

test("colors every row independently", () => {
  const rows = buildRowHtml({ online: true, relativeAge: "1 hour ago" }) + buildRowHtml({ online: false, relativeAge: "1 year ago" });
  const { table } = setupPage(buildTableHtml(rows));

  premiumSearchLastSeenHighlight();

  const [first, second] = table.querySelector("tbody").querySelectorAll("tr");
  assert.match(stripeOf(first), /#2ecc71/);
  assert.match(stripeOf(second), /#7f8c8d/);
});

test("re-scans on a DOM mutation and colors newly-added rows too", () => {
  const { doc, table } = setupPage(buildTableHtml(buildRowHtml({ online: true, relativeAge: "1 hour ago" })));

  premiumSearchLastSeenHighlight();
  const tbody = table.querySelector("tbody");
  assert.equal(tbody.querySelectorAll("tr").length, 1);

  const wrapper = doc.createElement("tbody");
  wrapper.innerHTML = buildRowHtml({ online: false, relativeAge: "2 weeks ago" });
  tbody.appendChild(wrapper.children[0]);

  const observer = FakeMutationObserver.instances[0];
  observer.cb();

  const [, second] = tbody.querySelectorAll("tr");
  assert.match(stripeOf(second), /#7f8c8d/);
});

// --- sale-recency background (signal #2, bridged from mainWorld.js) -------

function saleClassesOf(row) {
  return Object.values(SALE_RECENCY_CLASSES).filter((cls) => row.classList.contains(cls));
}

function daysAgoEpochSeconds(days) {
  return Math.round(Date.now() / 1000 - days * 24 * 60 * 60);
}

test("applies the RECENT sale class once mainWorld.js's own broadcast supplies a <= 60 day previous-owner timestamp for this row's Current ID", () => {
  const { doc, table } = setupPage(buildTableHtml(buildRowHtml({ online: false, relativeAge: "1 hour ago", currentId: "1001" })));

  premiumSearchLastSeenHighlight();
  dispatchSaleTimestamps(doc, { 1001: daysAgoEpochSeconds(30) });

  const dataRow = table.querySelector("tbody").querySelectorAll("tr")[0];
  assert.deepEqual(saleClassesOf(dataRow), [SALE_RECENCY_CLASSES.RECENT]);
});

test("applies the MODERATE sale class for a 61-90 day previous-owner timestamp", () => {
  const { doc, table } = setupPage(buildTableHtml(buildRowHtml({ online: false, relativeAge: "1 hour ago", currentId: "1001" })));

  premiumSearchLastSeenHighlight();
  dispatchSaleTimestamps(doc, { 1001: daysAgoEpochSeconds(75) });

  const dataRow = table.querySelector("tbody").querySelectorAll("tr")[0];
  assert.deepEqual(saleClassesOf(dataRow), [SALE_RECENCY_CLASSES.MODERATE]);
});

test("applies the OLD sale class for a 91-120 day previous-owner timestamp", () => {
  const { doc, table } = setupPage(buildTableHtml(buildRowHtml({ online: false, relativeAge: "1 hour ago", currentId: "1001" })));

  premiumSearchLastSeenHighlight();
  dispatchSaleTimestamps(doc, { 1001: daysAgoEpochSeconds(110) });

  const dataRow = table.querySelector("tbody").querySelectorAll("tr")[0];
  assert.deepEqual(saleClassesOf(dataRow), [SALE_RECENCY_CLASSES.OLD]);
});

test("applies no sale class past 120 days - not a 4th bucket", () => {
  const { doc, table } = setupPage(buildTableHtml(buildRowHtml({ online: false, relativeAge: "1 hour ago", currentId: "1001" })));

  premiumSearchLastSeenHighlight();
  dispatchSaleTimestamps(doc, { 1001: daysAgoEpochSeconds(400) });

  const dataRow = table.querySelector("tbody").querySelectorAll("tr")[0];
  assert.deepEqual(saleClassesOf(dataRow), []);
});

test("applies no sale class at all when no broadcast has arrived yet (unknown previous-owner date)", () => {
  const { table } = setupPage(buildTableHtml(buildRowHtml({ online: false, relativeAge: "1 hour ago", currentId: "1001" })));

  premiumSearchLastSeenHighlight();

  const dataRow = table.querySelector("tbody").querySelectorAll("tr")[0];
  assert.deepEqual(saleClassesOf(dataRow), []);
});

test("matches a row to its OWN Current ID, not some other row's timestamp", () => {
  const rows = buildRowHtml({ online: false, relativeAge: "1 hour ago", currentId: "1001" }) + buildRowHtml({ online: false, relativeAge: "1 hour ago", currentId: "2002" });
  const { doc, table } = setupPage(buildTableHtml(rows));

  premiumSearchLastSeenHighlight();
  dispatchSaleTimestamps(doc, { 1001: daysAgoEpochSeconds(30), 2002: daysAgoEpochSeconds(110) });

  const [first, second] = table.querySelector("tbody").querySelectorAll("tr");
  assert.deepEqual(saleClassesOf(first), [SALE_RECENCY_CLASSES.RECENT]);
  assert.deepEqual(saleClassesOf(second), [SALE_RECENCY_CLASSES.OLD]);
});

// The stripe (signal #1) and the sale-recency background (signal #2) must
// compose independently on the same row.
test("the liveness stripe and the sale-recency background apply together on the same row, independently", () => {
  const { doc, table } = setupPage(buildTableHtml(buildRowHtml({ online: true, relativeAge: "1 hour ago", currentId: "1001" })));

  premiumSearchLastSeenHighlight();
  dispatchSaleTimestamps(doc, { 1001: daysAgoEpochSeconds(110) });

  const dataRow = table.querySelector("tbody").querySelectorAll("tr")[0];
  assert.match(stripeOf(dataRow), /#2ecc71/); // online -> green stripe
  assert.deepEqual(saleClassesOf(dataRow), [SALE_RECENCY_CLASSES.OLD]);
});

test("a broadcast that arrives AFTER rows are already rendered still colors them (re-scans on receipt, not just on the next mutation)", () => {
  const { doc, table } = setupPage(buildTableHtml(buildRowHtml({ online: false, relativeAge: "1 hour ago", currentId: "1001" })));

  premiumSearchLastSeenHighlight();
  const dataRow = table.querySelector("tbody").querySelectorAll("tr")[0];
  assert.deepEqual(saleClassesOf(dataRow), []);

  dispatchSaleTimestamps(doc, { 1001: daysAgoEpochSeconds(30) });

  assert.deepEqual(saleClassesOf(dataRow), [SALE_RECENCY_CLASSES.RECENT]);
});

test("accumulates timestamps across multiple broadcasts rather than the latest one wiping out earlier entries", () => {
  const rows = buildRowHtml({ online: false, relativeAge: "1 hour ago", currentId: "1001" }) + buildRowHtml({ online: false, relativeAge: "1 hour ago", currentId: "2002" });
  const { doc, table } = setupPage(buildTableHtml(rows));

  premiumSearchLastSeenHighlight();
  dispatchSaleTimestamps(doc, { 1001: daysAgoEpochSeconds(30) });
  dispatchSaleTimestamps(doc, { 2002: daysAgoEpochSeconds(110) }); // a later, smaller broadcast

  const [first, second] = table.querySelector("tbody").querySelectorAll("tr");
  assert.deepEqual(saleClassesOf(first), [SALE_RECENCY_CLASSES.RECENT]); // still colored from the FIRST broadcast
  assert.deepEqual(saleClassesOf(second), [SALE_RECENCY_CLASSES.OLD]);
});

// --- legend strip + combined tooltip -----------------------------------

test("inserts the legend strip once, directly after the filter box's own parent", () => {
  const { wrapper } = setupPage(buildTableHtml(buildRowHtml({ online: true, relativeAge: "1 hour ago" })));

  premiumSearchLastSeenHighlight();

  const filterBoxParent = wrapper.querySelector(".item-filter").parentNode;
  const legend = wrapper.querySelector(".tf2te-color-legend");
  assert.ok(legend);
  assert.equal(filterBoxParent.nextElementSibling, legend);
});

// Regression: this used to anchor on the results table itself, which
// doesn't exist at all in the page's own pre-search state ("Type an item
// name..." placeholder, no table anywhere) - the legend never appeared
// until a search actually returned something. Anchored on the filter
// box's own parent instead, which is present either way.
test("inserts the legend strip even with no results table on the page at all (the pre-search state)", () => {
  const { wrapper } = setupPage("", { includeFilterBox: true });

  premiumSearchLastSeenHighlight();

  assert.ok(wrapper.querySelector(".tf2te-color-legend"));
});

test("does not insert a legend strip at all when the filter box hasn't rendered yet either", () => {
  const { wrapper } = setupPage(buildTableHtml(buildRowHtml({ online: true, relativeAge: "1 hour ago" })), {
    includeFilterBox: false,
  });

  premiumSearchLastSeenHighlight();

  assert.equal(wrapper.querySelectorAll(".tf2te-color-legend").length, 0);
});

// ".item-filter" isn't confirmed unique to this page - only insert (or keep
// an already-inserted one) while actually on /almanac/search.
test("does not insert a legend strip on an unrelated next.backpack.tf page, even with a matching filter box present", () => {
  const { wrapper } = setupPage("", { pathname: "/items", includeFilterBox: true });

  premiumSearchLastSeenHighlight();

  assert.equal(wrapper.querySelectorAll(".tf2te-color-legend").length, 0);
});

test("removes a previously-inserted legend strip once SPA navigation moves off /almanac/search", () => {
  const { wrapper } = setupPage(buildTableHtml(buildRowHtml({ online: true, relativeAge: "1 hour ago" })));

  premiumSearchLastSeenHighlight();
  assert.ok(wrapper.querySelector(".tf2te-color-legend"));

  global.window = { location: { pathname: "/items" } }; // simulates SPA navigation off this page
  const observer = FakeMutationObserver.instances[0];
  observer.cb();

  assert.equal(wrapper.querySelectorAll(".tf2te-color-legend").length, 0);
});

test("legend strip has both group headings and every swatch label", () => {
  const { wrapper } = setupPage(buildTableHtml(buildRowHtml({ online: true, relativeAge: "1 hour ago" })));

  premiumSearchLastSeenHighlight();

  const legend = wrapper.querySelector(".tf2te-color-legend");
  const text = legend.textContent;
  assert.match(text, /Seller status/);
  assert.match(text, /Online now/);
  assert.match(text, /Seen < 24h/);
  assert.match(text, /Seen < 7 days/);
  assert.match(text, /Seen 7\+ days/);
  assert.match(text, /Last sold/);
  assert.match(text, /Sold ≤ 60 days/);
  assert.match(text, /Sold ≤ 90 days/);
  assert.match(text, /Sold ≤ 120 days/);
  assert.match(text, /Older \/ no sale on record/);
});

test("does not insert a duplicate legend strip on a second scan", () => {
  const { wrapper } = setupPage(buildTableHtml(buildRowHtml({ online: true, relativeAge: "1 hour ago" })));

  premiumSearchLastSeenHighlight();
  const observer = FakeMutationObserver.instances[0];
  observer.cb();
  observer.cb();

  assert.equal(wrapper.querySelectorAll(".tf2te-color-legend").length, 1);
});

// REGRESSION-style: legend insertion is independent of the table/its
// columns now (see the pre-search-state test above) - a table that merely
// lacks a "Last Seen" column (some other, unrelated Almanac view) still
// gets the legend, it just never gets any row coloring (isLastSeenTable
// still gates that separately, see the stripe/tooltip tests elsewhere in
// this file).
test("still inserts the legend strip even when the table on the page has no 'Last Seen' column", () => {
  const { wrapper } = setupPage(buildTableHtml(buildRowHtml({ online: true, relativeAge: "1 hour ago" }), { withLastSeenColumn: false }));

  premiumSearchLastSeenHighlight();

  assert.ok(wrapper.querySelector(".tf2te-color-legend"));
});

test("sets a combined tooltip on the row: online + no sale on record", () => {
  const { table } = setupPage(buildTableHtml(buildRowHtml({ online: true, relativeAge: "1 hour ago", currentId: "1001" })));

  premiumSearchLastSeenHighlight();

  const dataRow = table.querySelector("tbody").querySelectorAll("tr")[0];
  assert.equal(dataRow.getAttribute("title"), "Seller online now · No sale on record");
});

test("sets a combined tooltip on the row: offline + sold N days ago", () => {
  const { doc, table } = setupPage(buildTableHtml(buildRowHtml({ online: false, relativeAge: "3 hours ago", currentId: "1001" })));

  premiumSearchLastSeenHighlight();
  dispatchSaleTimestamps(doc, { 1001: daysAgoEpochSeconds(30) });

  const dataRow = table.querySelector("tbody").querySelectorAll("tr")[0];
  assert.equal(dataRow.getAttribute("title"), "Seller offline, last seen 3 hours ago · Sold 30 days ago");
});
