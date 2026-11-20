/*
@description: Shared classification logic for the "days since this exact
item variant last actually SOLD" highlighter (backpack.tf/oldUI/
premiumSearchLastSeenHighlight and backpack.tf/nextUI/
premiumSearchLastSeenHighlight, both on Premium Search/Almanac) - a
DIFFERENT question from ./lastSeenHighlight.js's own "is the
CURRENT owner reachable right now" signal (that one's still applied too, as
an independent border/stripe - see each content.js's own header note on why
these two compose rather than replace one another). This one is aimed at
price-suggesting: how recently did ownership of an item like this actually
CHANGE HANDS, as a proxy for "is the going price for this still fresh."

Thresholds: <=60 days -> RECENT (green), <=90 -> MODERATE (yellow), <=120 ->
OLD (red), 120+ (or no known previous-owner date at all) -> no color, not a
4th "gray"
bucket the way lastSeenHighlight.js's own STALE bucket is - a genuinely
UNKNOWN last-sale date is meaningfully different from "confirmed old" and
isn't worth a visual claim either way.

WHERE the previous-owner timestamp actually comes from differs per UI (each
content.js's own concern, not this file's) - classic UI reads it straight
off a second on-page `.owner` block's own `<abbr>`; next.backpack.tf's own
table never renders one at all (confirmed live against real page HTML), so
that UI's own content.js instead reads it out of the page's own search API
response directly, by intercepting fetch/XHR - see that file's own header
note.
*/

export const SALE_RECENCY_CLASSES = {
  RECENT: "tf2te-sale-recent", // <= 60 days since last sale
  MODERATE: "tf2te-sale-moderate", // <= 90 days
  OLD: "tf2te-sale-old", // <= 120 days
};

export const ALL_SALE_RECENCY_CLASSES = Object.values(SALE_RECENCY_CLASSES);

// Not Bootstrap 3's standard LIGHT-mode pastel row colors: those are meant
// for dark text on a white page and nearly erase the text on both of
// backpack.tf's dark-themed UIs. Dark, moderately saturated colors instead - same green/yellow/orange hue family
// lastSeenHighlight.js's own border/stripe signal already uses (visual
// consistency between the two signals), just dark enough that the site's
// own light text stays readable on top without needing to force a `color`
// override too (which would risk stripping other legitimate accent colors
// already in these cells - a pink/colored username, a badge's own color). See #149.
export const SALE_RECENCY_BACKGROUND_COLORS = {
  [SALE_RECENCY_CLASSES.RECENT]: "#1e4d2b",
  [SALE_RECENCY_CLASSES.MODERATE]: "#5c4813",
  [SALE_RECENCY_CLASSES.OLD]: "#5c1f1f",
};

/*
@description: Bucket for how many days ago the last sale happened.
@param {?number} days - null/NaN (unknown) is treated the same as "too old
to bother claiming anything" - both return null, no class.
@returns one of SALE_RECENCY_CLASSES, or null for 120+ days / unknown.
*/
export function classifyDaysSinceSale(days) {
  if (days == null || !Number.isFinite(days)) return null;
  if (days <= 60) return SALE_RECENCY_CLASSES.RECENT;
  if (days <= 90) return SALE_RECENCY_CLASSES.MODERATE;
  if (days <= 120) return SALE_RECENCY_CLASSES.OLD;
  return null;
}

/*
@description: Whole-day difference between epochSeconds and now, rounded
(absolute value, Math.round, not Math.floor/ceil). A few hours of timezone slop in
epochSeconds (see each content.js's own note on where it's parsed from) is
negligible against 60/90/120-day-wide buckets, unlike
lastSeenHighlight.js's own text-bucket classification, which deliberately
avoids needing an absolute timestamp AT ALL for exactly this reason - this
one has no such alternative available (page text is never precise enough to
hit an exact day boundary), so it takes on that small, harmless imprecision
instead.
@param {?number} epochSeconds
@param {number} [nowMs] - Date.now() by default; overridable for tests.
@returns {?number} whole days, or null if epochSeconds isn't a real number.
*/
export function daysSince(epochSeconds, nowMs = Date.now()) {
  if (epochSeconds == null || !Number.isFinite(epochSeconds)) return null;
  const oneDayMs = 24 * 60 * 60 * 1000;
  return Math.round(Math.abs(nowMs - epochSeconds * 1000) / oneDayMs);
}

/*
@description: Tooltip-ready sentence for this signal alone - see
./lastSeenHighlight.js's own describeLiveness, combined with this into one
title attribute per row/card by each UI's own content.js. Deliberately
distinguishes "no previous owner on record at all" from "sold too long ago
to color" - the same distinction classifyDaysSinceSale's own header note
already draws for why 120+ days isn't a 4th colored bucket.
@param {?number} days - null/unknown means no previous owner was found at
all; any other number (including 120+) means a sale date IS known, just
possibly too old to color.
*/
export function describeSaleRecency(days) {
  if (days == null || !Number.isFinite(days)) return "No sale on record";
  return `Sold ${days} day${days === 1 ? "" : "s"} ago`;
}

/*
@description: Injects style's own stylesheet once (id-guarded: a
getElementById check first) - a shared helper since both UIs' own content.js need this
exact pattern, just with different selectors/CSS (classic recolors a whole
`.result` card; next.backpack.tf recolors a `<tr>`'s own `<td>` cells - see
each content.js's own header note on why).
@param {string} id
@param {string} css
*/
export function injectStylesOnce(id, css) {
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = css;
  document.head.appendChild(style);
}
