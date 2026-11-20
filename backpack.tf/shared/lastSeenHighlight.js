/*
@description: Shared classification/coloring logic for the "Premium Search"
last-seen highlighter (backpack.tf/oldUI/premiumSearchLastSeenHighlight and
backpack.tf/nextUI/premiumSearchLastSeenHighlight) - Premium Search finds who
currently (and previously) owns a specific item, so the whole point is
judging how LIVE a listed candidate actually is before spending time on it.
Two independent signals, both already rendered on the page by backpack.tf
itself, confirmed live on both UIs:
  1. Whether the CURRENT owner is online on Steam right now (best case - a
     trade could happen immediately).
  2. How long ago backpack.tf's own bot last confirmed the item is still in
     that owner's inventory (the "Last seen"/"Last seen with" timestamp) -
     the item may well have already been traded away since then, and the
     longer ago that scan was, the less likely this listing is still real.
This file only turns those two signals into one bucket + a color - reading
them off the DOM is each UI's own job (its own real markup, not shared - see
each content.js's own header), same division of labor
steamcommunity.com/shared/priceWidgets.js already uses for logic vs. DOM.

Deliberately keyed off the ALREADY-RENDERED relative-time text ("3 hours
ago", "14 days ago", "2 years ago" - confirmed live in both UIs, though the
exact unit boundaries differ between them, see classifyRelativeAge's own
note) rather than parsing either UI's own absolute timestamp
(title/data-original-title on classic's <abbr>, the `content` attribute on
next.backpack.tf's own timestamp div) and computing elapsed time itself -
the two absolute formats differ ("2026-09-10 05:28:11" vs "Sep 10, 2026,
07:28:11 am") and neither states a timezone, so re-deriving "how long ago"
from either one would mean guessing a timezone rather than trusting
backpack.tf's own already-computed answer, which is right there as text
either way.
*/

export const HIGHLIGHT_BUCKETS = {
  ONLINE: "online",
  FRESH: "fresh", // last seen < 24 hours ago
  RECENT: "recent", // last seen < 7 days ago
  STALE: "stale", // last seen 7+ days ago, or unparseable/unknown
};

// Solid border/stripe colors, not a translucent background tint: a tint
// blended against backpack.tf's own dark, textured page background comes out
// as a muddy, low-contrast wash and fights the listing's own text for
// readability, while a solid border/stripe never blends with anything
// underneath it. Ordered green/yellow/orange/gray (best to worst). Exported
// (not module-private) so ./colorLegendContent.js can build its own legend
// swatches from this same canonical source instead of re-declaring these
// hex values a second time.
export const BUCKET_COLOR = {
  [HIGHLIGHT_BUCKETS.ONLINE]: "#2ecc71",
  [HIGHLIGHT_BUCKETS.FRESH]: "#f1c40f",
  [HIGHLIGHT_BUCKETS.RECENT]: "#e67e22",
  [HIGHLIGHT_BUCKETS.STALE]: "#7f8c8d",
};

/*
@description: Classifies an already-rendered relative-time string ("3 hours
ago", "14 days ago", ...) into a bucket. NOT confirmed live whether either UI
ever actually renders an hour count of 24 or more (both appear to switch to
"day" phrasing at that boundary instead), so any second/minute/hour match is
treated as FRESH unconditionally rather than trying to guess a cutoff that
can't be reached anyway.
@returns one of HIGHLIGHT_BUCKETS.FRESH/RECENT/STALE - never ONLINE, which
only ever comes from the caller's own online-status signal (see
resolveHighlightBucket).
*/
export function classifyRelativeAge(text) {
  const trimmed = (text || "").trim().toLowerCase();
  if (!trimmed) return HIGHLIGHT_BUCKETS.STALE;
  if (/^(just now|a few seconds ago)$/.test(trimmed)) return HIGHLIGHT_BUCKETS.FRESH;

  // "a"/"an" stands for 1 - moment.js-style wording (the same formatter that
  // produces "a few seconds ago" above) writes "an hour ago"/"a day ago",
  // not "1 hour ago", which a digits-only match read as unparseable/STALE.
  const match = /(\d+|an?)\s+(second|minute|hour|day|week|month|year)s?\s+ago/.exec(trimmed);
  if (!match) return HIGHLIGHT_BUCKETS.STALE;

  const amount = /^\d/.test(match[1]) ? Number(match[1]) : 1;
  const unit = match[2];

  if (unit === "second" || unit === "minute" || unit === "hour") return HIGHLIGHT_BUCKETS.FRESH;
  if (unit === "day") return amount < 7 ? HIGHLIGHT_BUCKETS.RECENT : HIGHLIGHT_BUCKETS.STALE;
  // "week"/"month"/"year" are all 7+ days by definition - e.g. classic UI's
  // own "4 weeks ago" for the exact same underlying age next.backpack.tf
  // renders as "14 days ago" for a DIFFERENT listing (confirmed live, both
  // UIs' own relative-time phrasing switches units at different points) -
  // both still land STALE either way, so the two UIs agree on the bucket
  // even though their own display text disagrees on units.
  return HIGHLIGHT_BUCKETS.STALE;
}

/*
@description: The one entry point both UIs' content.js call - online status
always wins outright (a seller online right now beats any last-seen
freshness), otherwise falls back to classifyRelativeAge.
@param {{isOnline: boolean, relativeAgeText: string}} signals
*/
export function resolveHighlightBucket({ isOnline, relativeAgeText }) {
  if (isOnline) return HIGHLIGHT_BUCKETS.ONLINE;
  return classifyRelativeAge(relativeAgeText);
}

/*
@description: Tooltip-ready sentence for this signal alone - each UI's own
content.js combines this with ./saleRecencyHighlight.js's own
describeSaleRecency into one title attribute per row/card (the legend
explains the colors; hovering a row gives the exact numbers).
@param {{isOnline: boolean, relativeAgeText: string}} signals - same shape
resolveHighlightBucket takes.
*/
export function describeLiveness({ isOnline, relativeAgeText }) {
  if (isOnline) return "Seller online now";
  return relativeAgeText ? `Seller offline, last seen ${relativeAgeText}` : "Seller offline";
}

/*
@description: Recolors el's ENTIRE border (all four sides, via the shorthand
"border" property, not just "border-color") to bucket's own solid color -
used by the classic UI, where each result is its own bordered card (its
existing thin native border is what's being "recolored" here).
style.setProperty rather than a full style/className
overwrite - same reasoning ../oldUI/spellHighlight/content.js's own header
note already established for border-bottom: a real listing already carries
its own inline background/border styling elsewhere, so only ever touching
this ONE property leaves the rest untouched. The shorthand also resets
width/style, not just color - the native border is thin enough (1px) that a
plain color swap alone would be easy to miss while scanning down a page of
results.
*/
export function applyBorderHighlight(el, bucket) {
  const color = BUCKET_COLOR[bucket] || BUCKET_COLOR[HIGHLIGHT_BUCKETS.STALE];
  el.style.setProperty("border", `3px solid ${color}`, "important");
}

/*
@description: Same idea as applyBorderHighlight, but only the LEFT edge -
used by next.backpack.tf's own table rows, where a `<tr>`-level border is
unreliable (per CSS, a table row's own border only renders at all under the
`border-collapse: collapse` model - most tables, this one included, use the
default `separate` model instead, so a `<tr>` border would just silently not
show). A `<td>`'s own border always renders regardless of that model, so
this is applied to the ROW'S FIRST CELL instead (its own left edge lines up
with the row's), giving the same "colored stripe down the left of the row"
result the border-left half of applyBorderHighlight's box outline already
gives classic UI's cards.
*/
export function applyStripeHighlight(el, bucket) {
  const color = BUCKET_COLOR[bucket] || BUCKET_COLOR[HIGHLIGHT_BUCKETS.STALE];
  el.style.setProperty("border-left", `4px solid ${color}`, "important");
}

/*
@description: Actively clears whichever of the two properties above was
PREVIOUSLY applied to el (harmless to clear the one that was never set) -
not a no-op stand-in. next.backpack.tf recycles table row DOM nodes as
search results re-render (confirmed live for
../nextUI/spellHighlight/content.js's own item tiles, same rendering
approach), so an element that no longer resolves both signals (e.g.
mid-re-render) must have any stale styling from whatever listing previously
occupied that same node removed, not left in place.
*/
export function clearHighlight(el) {
  el.style.removeProperty("border");
  el.style.removeProperty("border-left");
}
