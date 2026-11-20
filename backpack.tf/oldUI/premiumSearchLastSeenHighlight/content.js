/*
@description: Recolors each result row on classic backpack.tf's Premium
Search (backpack.tf/premium/search - finds who currently/previously owns a
specific item) with TWO independent signals, layered together (different CSS
properties, no conflict - see each apply* call below), a legend panel
explaining both, and a combined tooltip on every result carrying the exact
per-row numbers:

  1. A colored BORDER - how live a candidate the CURRENT owner actually is:
  green if online on Steam right now, yellow/orange/gray as backpack.tf's
  own "Last seen with" scan gets staler. See
  ../../shared/lastSeenHighlight.js's own header note. 2. A solid, dark
  BACKGROUND fill - how recently this exact item variant actually SOLD
  (ownership changed hands), as a proxy for whether the going price is still
  fresh - useful for price-suggesting, a DIFFERENT question from #1. Read
  off the "Previously seen with" owner's own timestamp, not the current
  owner's - see ../../shared/saleRecencyHighlight.js's own header note on
  why, and on its thresholds.

The legend panel/tooltip content is shared by both UIs - see
../../shared/colorLegendContent.js.

Confirmed live (real page HTML, backpack.tf/premium/search): each result is
a `<div class="result">` inside `.premium-search-results`, holding a
`.description > .owners` block with one or two `.owner` divs - the FIRST
labeled "Last seen with" is the item's CURRENT owner (signal #1); a second,
OPTIONAL "Previously seen with" owner (signal #2) no longer has the item at
all. Both matched by their own label TEXT rather than position (first/second
`.owner`) - cheap insurance against backpack.tf ever reordering these two
blocks, and this codebase's own
established convention for reading labeled DOM text (see
steamcommunity.com/shared/priceWidgets.js's own findLabeledValue) rather than
trusting position alone.

Signal #1 reads `a.user-link[data-online]` (Steam online status - direct, no
icon-title guessing) and its own `<abbr>`'s ALREADY-RENDERED relative-time
text ("3 hours ago") - see lastSeenHighlight.js's own header on why rendered
text, not an absolute timestamp. Signal #2 needs the OPPOSITE - an absolute
timestamp precise enough to hit exact 60/90/120-day boundaries - read off
that same `<abbr>`'s own title (or data-original-title, once Bootstrap's
tooltip JS has moved it there - confirmed live, both shapes occur) - see
saleRecencyHighlight.js's own daysSince note on why the resulting few-hours
timezone slop is harmless here specifically.

The legend panel is inserted as a THIRD `.premium-search-form` sidebar panel
(reusing that native class for its own white/purple-accent panel chrome
rather than re-deriving it - confirmed live via a real screenshot, both the
"Premium Search" and "Filters" panels already use it), right after the one
whose own `<h2 class="title">` reads "Premium Search" - lands it between
that panel and "Filters".
*/
import { resolveHighlightBucket, applyBorderHighlight, clearHighlight, describeLiveness } from "../../shared/lastSeenHighlight.js";
import {
  classifyDaysSinceSale,
  daysSince,
  describeSaleRecency,
  ALL_SALE_RECENCY_CLASSES,
  SALE_RECENCY_BACKGROUND_COLORS,
  injectStylesOnce,
} from "../../shared/saleRecencyHighlight.js";
import { buildLegendEl, LEGEND_CLASSES } from "../../shared/colorLegendContent.js";

const RESULTS_CONTAINER_SELECTOR = ".premium-search-results";
const LAST_SEEN_LABEL_PATTERN = /^\s*Last seen with\b/i;
const PREVIOUSLY_SEEN_LABEL_PATTERN = /^\s*Previously seen with\b/i;

const SALE_RECENCY_STYLE_ID = "tf2te-sale-recency-styles";
// Solid (not translucent) fills, dark enough for this UI's own light/white
// text to stay legible on top - see saleRecencyHighlight.js's own
// SALE_RECENCY_BACKGROUND_COLORS note, confirmed live, #149.
const SALE_RECENCY_CSS = ALL_SALE_RECENCY_CLASSES.map(
  (cls) => `.${cls} { background-color: ${SALE_RECENCY_BACKGROUND_COLORS[cls]} !important; }`
).join("\n");

// Confirmed live: classic UI's Premium Search sidebar is
// `<div class="col-md-4">` holding two `<div class="premium-search-form">`
// panels - the first has `<h2 class="title">Premium Search</h2>`, the
// second `<h6>Filters (N results)</h6>`. Matched by the FIRST panel's own
// heading text (not position/a fixed selector count) so this still finds
// the right insertion point even if backpack.tf ever adds another panel
// ahead of it.
const LEGEND_STYLE_ID = "tf2te-legend-classic-styles";
const LEGEND_PANEL_CLASS = "premium-search-form";
const PREMIUM_SEARCH_TITLE_PATTERN = /^\s*Premium Search\s*$/i;

const LEGEND_CSS = `
  .${LEGEND_CLASSES.root} { display: flex; flex-direction: column; gap: 10px; }
  .${LEGEND_CLASSES.group} + .${LEGEND_CLASSES.group} { margin-top: 2px; padding-top: 10px; border-top: 1px solid #eceef1; }
  .${LEGEND_CLASSES.heading} { font-size: 11.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; color: #333; margin-bottom: 6px; }
  .${LEGEND_CLASSES.swatches} { display: flex; flex-direction: column; gap: 5px; }
  .${LEGEND_CLASSES.swatch} { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: #666; }
  .${LEGEND_CLASSES.chip} { flex: none; border-radius: 2px; }
  .${LEGEND_CLASSES.chipStripe} { width: 4px; height: 16px; }
  .${LEGEND_CLASSES.chipFill} { width: 20px; height: 12px; }
`;

function findOwnerBlockByLabel(result, pattern) {
  const ownersContainer = result.querySelector(".owners");
  if (!ownersContainer) return null;

  for (const owner of ownersContainer.querySelectorAll(".owner")) {
    if (pattern.test(owner.textContent || "")) return owner;
  }

  return null;
}

function resolveLivenessSignals(result) {
  const ownerBlock = findOwnerBlockByLabel(result, LAST_SEEN_LABEL_PATTERN);
  if (!ownerBlock) return null;

  const userLink = ownerBlock.querySelector(".user-link");
  const isOnline = userLink?.getAttribute("data-online") === "1";

  const abbr = ownerBlock.querySelector("abbr");
  const relativeAgeText = abbr?.textContent || "";

  return { isOnline, relativeAgeText };
}

function resolveSaleDays(result) {
  const previousOwnerBlock = findOwnerBlockByLabel(result, PREVIOUSLY_SEEN_LABEL_PATTERN);
  if (!previousOwnerBlock) return null;

  const abbr = previousOwnerBlock.querySelector("abbr");
  const absoluteTimeText = abbr?.getAttribute("data-original-title") || abbr?.getAttribute("title");
  if (!absoluteTimeText) return null;

  const parsedMs = Date.parse(absoluteTimeText);
  if (Number.isNaN(parsedMs)) return null;

  return daysSince(parsedMs / 1000);
}

function scanResult(result) {
  const livenessSignals = resolveLivenessSignals(result);
  if (livenessSignals) {
    applyBorderHighlight(result, resolveHighlightBucket(livenessSignals));
  } else {
    clearHighlight(result);
  }

  result.classList.remove(...ALL_SALE_RECENCY_CLASSES);
  const saleDays = resolveSaleDays(result);
  const saleBucketClass = classifyDaysSinceSale(saleDays);
  if (saleBucketClass) result.classList.add(saleBucketClass);

  // Combined tooltip - the legend panel explains the colors once, this
  // carries the exact numbers behind THIS result's own colors.
  const livenessText = livenessSignals ? describeLiveness(livenessSignals) : null;
  result.setAttribute("title", [livenessText, describeSaleRecency(saleDays)].filter(Boolean).join(" · "));
}

function scan(root) {
  const container = root.querySelector?.(RESULTS_CONTAINER_SELECTOR);
  if (!container) return;

  container.querySelectorAll(".result").forEach(scanResult);
}

function insertLegendPanel() {
  if (document.querySelector(`.${LEGEND_CLASSES.root}`)) return; // already inserted

  const panel = Array.from(document.querySelectorAll(`.${LEGEND_PANEL_CLASS}`)).find((candidate) => {
    const titleEl = candidate.querySelector("h2.title");
    return titleEl && PREMIUM_SEARCH_TITLE_PATTERN.test(titleEl.textContent || "");
  });
  if (!panel) return; // sidebar not rendered yet - retried on the next scan (see the observer below)

  const legend = buildLegendEl(document, [LEGEND_PANEL_CLASS]);
  panel.insertAdjacentElement("afterend", legend);
}

export function premiumSearchLastSeenHighlight() {
  injectStylesOnce(SALE_RECENCY_STYLE_ID, SALE_RECENCY_CSS);
  injectStylesOnce(LEGEND_STYLE_ID, LEGEND_CSS);

  insertLegendPanel();
  scan(document);

  // Premium Search's own results (and its sidebar panels too) are fetched/
  // rendered client-side - a MutationObserver is the only way to keep
  // catching both. Safe to re-run unconditionally on every mutation: every
  // style change here (border property, className) is an attribute-level
  // change, never a childList one, so none of it can re-trigger this same
  // observer - same reasoning ../spellHighlight/content.js's own header
  // note already established for its border-bottom property. insertLegendPanel
  // is idempotent (bails immediately once the legend already exists), so
  // calling it on every mutation costs one cheap querySelector, not a
  // re-insert.
  const observer = new MutationObserver(() => {
    insertLegendPanel();
    scan(document);
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
