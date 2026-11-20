/*
@description: Shared data + DOM builder for the "what do these colors mean"
legend both UIs' own premiumSearchLastSeenHighlight/content.js insert once
per page - see each content.js's own header note on WHERE it lands (a third
sidebar panel for classic UI, a strip above the table for next.backpack.tf -
genuinely different page chrome, so each UI still builds its own container
and injects its own CSS; only the copy/colors and the swatch-row DOM shape
are shared here, so the two legends can never drift out of sync with each
other or with the actual bucket colors in ./lastSeenHighlight.js/
./saleRecencyHighlight.js).

Two groups,
"Seller status" (the liveness border/stripe) and "Last sold" (the sale-recency
fill), each shown once, never per-row - per-row detail is what the title
attribute content.js sets on each result/row is for (see each file's own
describeLiveness/describeSaleRecency calls).
*/
import { HIGHLIGHT_BUCKETS, BUCKET_COLOR } from "./lastSeenHighlight.js";
import { SALE_RECENCY_CLASSES, SALE_RECENCY_BACKGROUND_COLORS } from "./saleRecencyHighlight.js";

const LIVENESS_LEGEND = {
  heading: "Seller status",
  entries: [
    { color: BUCKET_COLOR[HIGHLIGHT_BUCKETS.ONLINE], label: "Online now" },
    { color: BUCKET_COLOR[HIGHLIGHT_BUCKETS.FRESH], label: "Seen < 24h" },
    { color: BUCKET_COLOR[HIGHLIGHT_BUCKETS.RECENT], label: "Seen < 7 days" },
    { color: BUCKET_COLOR[HIGHLIGHT_BUCKETS.STALE], label: "Seen 7+ days" },
  ],
};

const SALE_LEGEND = {
  heading: "Last sold",
  entries: [
    { color: SALE_RECENCY_BACKGROUND_COLORS[SALE_RECENCY_CLASSES.RECENT], label: "Sold ≤ 60 days" },
    { color: SALE_RECENCY_BACKGROUND_COLORS[SALE_RECENCY_CLASSES.MODERATE], label: "Sold ≤ 90 days" },
    { color: SALE_RECENCY_BACKGROUND_COLORS[SALE_RECENCY_CLASSES.OLD], label: "Sold ≤ 120 days" },
    { color: null, label: "Older / no sale on record" },
  ],
};

// Class names left unprefixed by UI-specific concerns on purpose (no
// "oldui"/"nextui" in the name) - both UIs share this exact DOM shape and
// only differ in the CSS rules they each attach to it.
export const LEGEND_CLASSES = {
  root: "tf2te-color-legend",
  group: "tf2te-legend-group",
  heading: "tf2te-legend-heading",
  swatches: "tf2te-legend-swatches",
  swatch: "tf2te-legend-swatch",
  chip: "tf2te-legend-chip",
  chipStripe: "tf2te-legend-chip-stripe",
  chipFill: "tf2te-legend-chip-fill",
};

function buildGroupEl(doc, { heading, entries, swatchShape }) {
  const group = doc.createElement("div");
  group.className = LEGEND_CLASSES.group;

  const headingEl = doc.createElement("div");
  headingEl.className = LEGEND_CLASSES.heading;
  headingEl.textContent = heading;
  group.appendChild(headingEl);

  const swatchesEl = doc.createElement("div");
  swatchesEl.className = LEGEND_CLASSES.swatches;

  for (const entry of entries) {
    const swatchEl = doc.createElement("span");
    swatchEl.className = LEGEND_CLASSES.swatch;

    const chipEl = doc.createElement("span");
    chipEl.className = `${LEGEND_CLASSES.chip} ${swatchShape === "stripe" ? LEGEND_CLASSES.chipStripe : LEGEND_CLASSES.chipFill}`;
    if (entry.color) chipEl.style.setProperty("background-color", entry.color);
    else chipEl.style.setProperty("border", "1px dashed currentColor");

    // A <span> with .textContent, not doc.createTextNode - both render
    // identically, but createTextNode isn't implemented by this codebase's
    // own hand-rolled fake DOM (tests/helpers/fakeDom.js), which every
    // other element-building helper here already sidesteps the same way.
    const labelEl = doc.createElement("span");
    labelEl.textContent = entry.label;

    swatchEl.appendChild(chipEl);
    swatchEl.appendChild(labelEl);
    swatchesEl.appendChild(swatchEl);
  }

  group.appendChild(swatchesEl);
  return group;
}

/*
@description: Builds the full two-group legend element (Seller status +
Last sold), unstyled beyond the swatch colors themselves - the caller adds
its own class(es) for layout/panel chrome and injects the matching CSS via
./saleRecencyHighlight.js's own injectStylesOnce.
@param {Document} doc
@param {string[]} [extraClasses] - additional class names to add to the root
element (e.g. a UI's own panel/strip class).
@returns the root legend element, not yet inserted anywhere.
*/
export function buildLegendEl(doc, extraClasses = []) {
  const legend = doc.createElement("div");
  legend.className = [LEGEND_CLASSES.root, ...extraClasses].join(" ");
  legend.appendChild(buildGroupEl(doc, { ...LIVENESS_LEGEND, swatchShape: "stripe" }));
  legend.appendChild(buildGroupEl(doc, { ...SALE_LEGEND, swatchShape: "fill" }));
  return legend;
}
