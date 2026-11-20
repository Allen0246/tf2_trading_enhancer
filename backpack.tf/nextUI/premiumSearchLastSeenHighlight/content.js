/*
@description: next.backpack.tf's own equivalent of
../../oldUI/premiumSearchLastSeenHighlight/content.js - same TWO independent
signals, layered together (different CSS targets, no conflict), a legend
strip explaining both, and a combined tooltip on every row carrying the
exact per-row numbers:

  1. A colored left-edge STRIPE (on the row's first `<td>`) - how live a
  candidate the CURRENT owner actually is. See
  ../../shared/lastSeenHighlight.js's own header note. 2. A solid pastel
  BACKGROUND on the row's `<td>`s - how recently this exact item variant
  actually SOLD, read from the PREVIOUS owner's own timestamp - see
  ../../shared/saleRecencyHighlight.js's own header note. Unlike the classic
  UI, that timestamp is NEVER rendered anywhere in this page's own table
  (confirmed live - the "Last Seen" column only ever shows the CURRENT
  owner's date), so it's supplied by ./mainWorld.js instead, bridged in via a
  CustomEvent - see that file's own header note on why (and on the
  network-interception technique itself).

The legend strip/tooltip content is shared by both UIs - see
../../shared/colorLegendContent.js. It lands right after the filter
box's own parent, not the results table - see insertLegendStrip's own note
(confirmed live: the table doesn't exist in the DOM at all until a search
actually returns something, so anchoring on it would leave the legend
missing on the page's own pre-search state).

Confirmed live (real page HTML, next.backpack.tf/almanac/search - the
next-gen UI's own Premium Search/Almanac item-history page, same feature as
classic UI's /premium/search): each row is a `<tr>` inside a PrimeVue
`<table class="p-datatable-table">`, with a "User" column holding the
CURRENT owner's block FIRST (a "Current Owner"-titled briefcase icon, before
any "Previous Owner" one), an "ID" column holding a "Current ID" badge
(`[content="Current ID"]`, confirmed live - this is what ties a rendered row
back to mainWorld.js's own broadcast, keyed by that same id), and a
"Last Seen" column holding the already-rendered relative-time text ("3
hours ago", "14 days ago").

Current-owner online status is carried as an "online" CSS class token on
that owner's own `.username` div (confirmed live: present for a
currently-online owner, absent otherwise) - `.querySelector(".username")`
finds the FIRST such div in the row, which is always the current owner's
(the "Previous Owner" block, when present, only ever appears later in the
row's own markup). Scoped to tables that actually have a "Last Seen" column
(matched by its own `.p-column-title` header text) rather than every
`.p-datatable-table` on the site - PrimeVue's datatable component is
generic and reused elsewhere (the /items catalog, classifieds), which have
no such column and aren't this feature's concern at all.

Signal #1's color lands on the row's FIRST `<td>`, not the `<tr>` - see
../../shared/lastSeenHighlight.js's own applyStripeHighlight note on why a
`<tr>`-level border is unreliable (only rendered under the
`border-collapse: collapse` model, which this table doesn't use). Signal
#2's background is applied via a CSS CLASS on the `<tr>` itself, with an
injected stylesheet targeting that class's own `td` children
(`<tr>`-level classes still work fine for SELECTOR matching even though a
`<tr>`-level BORDER specifically doesn't render, since border and
background-color are governed by different table rendering rules).
*/
import {
  resolveHighlightBucket,
  applyStripeHighlight,
  clearHighlight,
  describeLiveness,
} from "../../shared/lastSeenHighlight.js";
import {
  classifyDaysSinceSale,
  daysSince,
  describeSaleRecency,
  ALL_SALE_RECENCY_CLASSES,
  SALE_RECENCY_BACKGROUND_COLORS,
  injectStylesOnce,
} from "../../shared/saleRecencyHighlight.js";
import { buildLegendEl, LEGEND_CLASSES } from "../../shared/colorLegendContent.js";

const TABLE_SELECTOR = ".p-datatable-table";
const LAST_SEEN_HEADER_TEXT = "Last Seen";
const CURRENT_ID_BADGE_SELECTOR = '[content="Current ID"]';
const SALE_TIMESTAMPS_EVENT = "tf2te-premium-search-sale-timestamps";

const SALE_RECENCY_STYLE_ID = "tf2te-nextui-sale-recency-styles";
// Targets the CLASS's own `td` children, not the `<tr>` itself (see this
// file's own header note). Same dark, legible-on-dark-theme colors as the
// classic-UI version - see saleRecencyHighlight.js's own
// SALE_RECENCY_BACKGROUND_COLORS note.
const SALE_RECENCY_CSS = ALL_SALE_RECENCY_CLASSES.map(
  (cls) => `tr.${cls} td { background-color: ${SALE_RECENCY_BACKGROUND_COLORS[cls]} !important; }`
).join("\n");

const LEGEND_STYLE_ID = "tf2te-nextui-legend-styles";
const LEGEND_STRIP_CLASS = "tf2te-nextui-legend-strip";
// Neutral, semi-transparent overlays rather than a hardcoded exact page
// background hex - this page's own dark background tone isn't independently
// confirmed to one exact value, and an overlay reads correctly against
// whatever shade it actually is.
const LEGEND_CSS = `
  .${LEGEND_STRIP_CLASS} {
    display: flex;
    flex-direction: row;
    align-items: center;
    flex-wrap: wrap;
    gap: 12px 28px;
    padding: 10px 14px;
    margin-bottom: 10px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 6px;
    font-size: 12.5px;
  }
  .${LEGEND_STRIP_CLASS} .${LEGEND_CLASSES.group} {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 10px;
  }
  .${LEGEND_STRIP_CLASS} .${LEGEND_CLASSES.group} + .${LEGEND_CLASSES.group} {
    padding-left: 20px;
    border-left: 1px solid rgba(255, 255, 255, 0.12);
  }
  .${LEGEND_STRIP_CLASS} .${LEGEND_CLASSES.heading} {
    font-size: 10.5px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    opacity: 0.65;
  }
  .${LEGEND_STRIP_CLASS} .${LEGEND_CLASSES.swatches} {
    display: flex;
    flex-wrap: wrap;
    gap: 5px 14px;
  }
  .${LEGEND_STRIP_CLASS} .${LEGEND_CLASSES.swatch} {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    opacity: 0.85;
  }
  .${LEGEND_STRIP_CLASS} .${LEGEND_CLASSES.chip} {
    flex: none;
    border-radius: 2px;
  }
  .${LEGEND_STRIP_CLASS} .${LEGEND_CLASSES.chipStripe} { width: 4px; height: 16px; }
  .${LEGEND_STRIP_CLASS} .${LEGEND_CLASSES.chipFill} { width: 18px; height: 11px; }
`;

// Populated by the CustomEvent listener registered in
// premiumSearchLastSeenHighlight below - keyed by the "Current ID" badge's
// own text, never cleared between broadcasts (see mainWorld.js's own
// broadcastSaleTimestamps note on why accumulating is safe here).
const saleTimestampsByCurrentId = new Map();

/*
@description: Test-only reset hook, same convention utils/tf2Schema.js's own
__resetSchemaCacheForTests already establishes for a module-scope cache -
without this, tests/nextUiPremiumSearchLastSeenHighlight.test.js's own
per-test broadcasts would accumulate into the SAME Map across every test in
that file (this module is imported once, not per test), since real "Current
ID"s are globally unique and this cache is deliberately never cleared in
production - a test using a reused placeholder id (e.g. "1001") across
multiple cases would otherwise leak an earlier test's own timestamp into a
later one.
*/
export function __resetSaleTimestampsForTests() {
  saleTimestampsByCurrentId.clear();
}

function isLastSeenTable(table) {
  for (const header of table.querySelectorAll(".p-column-title")) {
    if (header.textContent?.trim() === LAST_SEEN_HEADER_TEXT) return true;
  }
  return false;
}

function resolveLivenessSignals(row) {
  const usernameEl = row.querySelector(".username");
  const timestampEl = row.querySelector(".item-timestamp");
  if (!usernameEl || !timestampEl) return null;

  const isOnline = usernameEl.classList.contains("online");
  const relativeAgeText = timestampEl.textContent || "";

  return { isOnline, relativeAgeText };
}

function resolveSaleDays(row) {
  const idBadge = row.querySelector(CURRENT_ID_BADGE_SELECTOR);
  if (!idBadge) return null;

  const currentId = idBadge.textContent?.trim();
  const timestamp = currentId ? saleTimestampsByCurrentId.get(currentId) : undefined;
  if (timestamp === undefined) return null; // no known previous owner

  return daysSince(timestamp);
}

function scanRow(row) {
  const firstCell = row.querySelector("td");
  const livenessSignals = resolveLivenessSignals(row);

  if (livenessSignals && firstCell) {
    applyStripeHighlight(firstCell, resolveHighlightBucket(livenessSignals));
  } else if (firstCell) {
    clearHighlight(firstCell);
  }

  row.classList.remove(...ALL_SALE_RECENCY_CLASSES);
  const saleDays = resolveSaleDays(row);
  const saleBucketClass = classifyDaysSinceSale(saleDays);
  if (saleBucketClass) row.classList.add(saleBucketClass);

  // Combined tooltip - the legend strip explains the colors once, this
  // carries the exact numbers behind THIS row's own colors.
  const livenessText = livenessSignals ? describeLiveness(livenessSignals) : null;
  row.setAttribute("title", [livenessText, describeSaleRecency(saleDays)].filter(Boolean).join(" · "));
}

// The legend anchors on the filter box's own parent, confirmed present in
// BOTH the pre-search and post-search states (it's what you use to search in
// the first place), not on the results table's own PrimeVue datatable root,
// which doesn't exist in the DOM until a search returns results. See #148.
const FILTER_BOX_SELECTOR = ".item-filter";
// `.item-filter` isn't confirmed unique to this page (other next.backpack.tf
// pages likely have their own filter bars using the same generic component
// class) - a pathname check keeps this from inserting anywhere else, same
// reasoning ../../oldUI/unusualCategoryFilter/content.js's own header note already
// documents for a similar "DOM signal alone isn't reliable" case. Re-read on
// every call, not cached - next.backpack.tf is a Vue SPA that can navigate
// here without a full page reload.
function isAlmanacSearchPage() {
  return window.location.pathname.startsWith("/almanac/search");
}

/*
@description: Inserts the legend strip right after the filter box's own
parent (not the filter box itself, so it doesn't end up crammed inside that
element's own sticky-positioned wrapper) - idempotent (bails once already
present) and self-correcting for SPA navigation: actively REMOVES a
previously-inserted legend when the current page no longer matches, rather
than leaving a stale one behind on an unrelated page.
*/
function insertLegendStrip() {
  const existing = document.querySelector(`.${LEGEND_CLASSES.root}`);

  if (!isAlmanacSearchPage()) {
    existing?.remove();
    return;
  }
  if (existing) return;

  const anchor = document.querySelector(FILTER_BOX_SELECTOR)?.parentNode;
  if (!anchor) return; // filter bar not rendered yet - retried on the next scan

  const legend = buildLegendEl(document, [LEGEND_STRIP_CLASS]);
  anchor.insertAdjacentElement("afterend", legend);
}

function scan(root) {
  insertLegendStrip();

  root.querySelectorAll?.(TABLE_SELECTOR).forEach((table) => {
    if (!isLastSeenTable(table)) return;

    const tbody = table.querySelector("tbody");
    if (!tbody) return;

    tbody.querySelectorAll("tr").forEach(scanRow);
  });
}

export function premiumSearchLastSeenHighlight() {
  injectStylesOnce(SALE_RECENCY_STYLE_ID, SALE_RECENCY_CSS);
  injectStylesOnce(LEGEND_STYLE_ID, LEGEND_CSS);

  // mainWorld.js's own broadcast (see that file's own header note) can
  // arrive at any time relative to this scan - re-scanning immediately on
  // receipt means a search that already finished rendering its rows still
  // gets sale-recency colors applied retroactively once the data shows up,
  // not just on the NEXT unrelated DOM mutation.
  document.addEventListener(SALE_TIMESTAMPS_EVENT, (event) => {
    const detail = typeof event.detail === "string" ? JSON.parse(event.detail) : event.detail;
    if (!detail) return;

    for (const [currentId, timestamp] of Object.entries(detail)) {
      saleTimestampsByCurrentId.set(currentId, timestamp);
    }

    scan(document);
  });

  scan(document);

  // Vue re-renders (a new search, sorting by column, paging) recycle
  // existing <tr> DOM nodes rather than always creating fresh ones -
  // confirmed live for ../spellHighlight/content.js's own item tiles, same
  // rendering approach - so this must actively re-resolve and either
  // reapply or clear each signal on EVERY scan, never skip a row just
  // because it was already colored once.
  const observer = new MutationObserver(() => scan(document));
  observer.observe(document.body, { childList: true, subtree: true });
}
