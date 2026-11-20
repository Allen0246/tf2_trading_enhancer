/*
@description: Adds a "Buy Parts (total)" button right under a Specialized/
Professional Killstreak Kit Fabricator's own "The following are the inputs
that must be fulfilled." list on a Steam inventory item panel - one click
opens Steam's own native multi-item purchase page (steamcommunity.com/
market/multibuy), pre-filled with every required item and its exact
quantity, instead of buying each input one listing at a time.

Also shows a read-only estimate of what the finished Kit would sell for
(see buildFinishedKitMarketHashName/buildValueCard below). This is not the
same as inventoryMarketActions/content.js's Instant Sell: that needs an
owned item with a real assetid, and a Fabricator's Kit doesn't exist until
it's crafted. It's labeled "Estimated Kit Value on SCM" rather than "Instant
Sell" because clicking it only opens the Kit's Steam Market listing page; it
never lists or sells anything.

The required-inputs scan is generic (a plain "{name} x{qty}" scan under the
fixed heading text below) rather than a hardcoded 8-robot-part table, since a
Strangifier Chemistry Set uses the same "inputs that must be fulfilled"
mechanic with plain weapon names (confirmed live). The feature itself is
scoped to Specialized/Professional Killstreak Kit Fabricators (see
KIT_FABRICATOR_TITLE_PATTERN), so a Chemistry Set or Basic Killstreak Kit
Fabricator gets no button, even though the scan would handle them. It's also
limited to the visitor's OWN inventory, never someone else's they're browsing
(see findLoggedInSteamId64's own note in itemQuickLinks/content.js).

A Kit Fabricator's own input list can include a GENERIC crafting-component
category ("Unique Killstreak Item" for a Specialized-tier Kit, "Unique
Specialized Killstreak Item" for a Professional-tier one) rather than one
specific tradable item - see GENERIC_INPUT_CONFIGS' own note below. Such
inputs are resolved automatically first - a Steam Market search for that
specific category's own tier, sorted cheapest-first, whose top result(s) get
folded straight into the multibuy purchase in place of the generic name (see
extractValidNamesFromSearchHtml's own note on why the page's own plain text
is read) - falling back to a manual "source this yourself" note only
if that resolve attempt itself fails (no listings, a network error, or a
result that fails looksLikeAValidKillstreakWeaponMatch's own tier-specific
sanity check). When more than one unit is needed, this resolves to that many
DISTINCT items (one unit each) rather than one item at the full quantity -
see resolveGenericItems' own note on why. See
partitionInputs/resolveGenericItems.

This file exports TWO entry points for TWO different page contexts, not one -
showFabricatorMultiBuy for the inventory item panel (everything above), and
showMultiBuyVerifyReminder for Steam's own market/multibuy PAGE itself - see
that function's own note.
See #110.
*/
import { pickContainer, getActiveInventoryAppId, readVisibleTitleText, findSteamId64, findLoggedInSteamId64 } from "../itemQuickLinks/content.js";
import { createButtonLink } from "../shared/quickLinkButtons.js";
import { decodeHtmlEntities, parsePriceParts, formatMinorUnits, currencyAffixesOf, fetchListingOrderBook, parseMarketPriceText } from "../shared/marketListingOrderBook.js";
import { getWalletCurrencyId } from "../shared/walletCurrency.js";
import { getScmLowestPriceText } from "../../utils/scmPricing.js";

// Same TF2-only gate itemQuickLinks/content.js's own TF2_APP_ID applies -
// Fabricators/Chemistry Sets and their required-inputs lists only ever exist
// in TF2's own inventory tab.
const TF2_APP_ID = 440;

const BLOCK_CLASS = "tf2te-fabricator-multibuy";

// This feature is scoped to Specialized/Professional Killstreak Kit
// Fabricators only - NOT every item that happens to show the "inputs that
// must be fulfilled" fulfillment mechanic (a Chemistry Set or a Basic
// Killstreak Kit Fabricator also use that same generic mechanic, but are
// deliberately excluded here). Matched at the START of the item's own title
// text (e.g. "Specialized Killstreak Vita-Saw Kit Fabricator") - Kit
// Fabricators are always Unique quality with no other prefix that could
// precede this.
const KIT_FABRICATOR_TITLE_PATTERN = /^(?:Specialized|Professional) Killstreak\b/i;

// Steam's own fixed heading text above a crafting tool's required-inputs
// list - confirmed live via both a Fabricator and a Chemistry Set
// screenshot, same exact wording for both item types (this feature excludes
// the Chemistry Set case via KIT_FABRICATOR_TITLE_PATTERN above, not via this
// heading text itself).
const FULFILLMENT_HEADING_PATTERN = /The following are the inputs that must be fulfilled\.?/i;

// Matches a single required-input line, e.g. "Battle-Worn Robot Money
// Furnace x2" or "Reclaimed Metal x 3". Deliberately generic (no hardcoded
// item-name list) so this also picks up a Chemistry Set's plain weapon-name
// inputs. "×" is accepted alongside "x"/"X" - Steam renders either glyph
// depending on locale/font substitution.
const INPUT_LINE_PATTERN = /^(.+?)\s*[×xX]\s*(\d+)\s*$/;

/*
@description: Scans container's own leaf div/span elements (document order)
for Steam's "inputs that must be fulfilled" heading, then collects every
CONTIGUOUS "{name} x{qty}" line immediately following it - stopping at the
first line that doesn't match. Steam renders this list as one unbroken run
of sibling lines (confirmed live for both a Fabricator and a Chemistry Set),
so requiring contiguity (rather than scanning the whole panel for anything
shaped like "{text} x{number}") avoids ever picking up an unrelated line
elsewhere in the item's description that happens to end the same way.
@returns: {inputs: [{name, quantity}], lastElement} - lastElement is the DOM
node the button block gets inserted right after - or null if no heading (or
no matching lines under it) was found at all, meaning this simply isn't a
crafting tool with required inputs, not an error.
*/
function findRequiredInputs(container) {
  const leaves = [...container.querySelectorAll("div, span")].filter((el) => el.children.length === 0);

  let headingIndex = -1;
  for (let i = 0; i < leaves.length; i++) {
    if (FULFILLMENT_HEADING_PATTERN.test(leaves[i].textContent?.trim() || "")) {
      headingIndex = i;
      break;
    }
  }
  if (headingIndex === -1) return null;

  const inputs = [];
  let lastElement = null;
  for (let i = headingIndex + 1; i < leaves.length; i++) {
    const text = leaves[i].textContent?.trim();
    if (!text) continue; // a blank spacer line shouldn't break the run

    const match = INPUT_LINE_PATTERN.exec(text);
    if (!match) break;

    inputs.push({ name: match[1].trim(), quantity: parseInt(match[2], 10) });
    lastElement = leaves[i];
  }

  return inputs.length > 0 ? { inputs, lastElement } : null;
}

/*
@description: Builds Steam's own real native multi-item purchase URL - a
genuine endpoint, confirmed working rather than guessed at:
market/multibuy accepts repeated
items[]/qty[] pairs, one per distinct item, and opens one combined checkout
page for all of them at once.
@param {{name: string, quantity: number}[]} inputs
@param {{name: string, searchHref: string}[]} [flagEntries] - items (from
`inputs`) to mark for showMultiBuyVerifyReminder's own attention once the
user actually lands on the resulting multibuy page - see that function's own
note. Each entry's own searchHref rides along too, so that page can offer a
direct link to re-check other listings for that SAME generic category
(melee/primary/secondary/Unique/keyword/sort, already filtered) instead of
making the user rebuild that filtered search by hand. Carried as a plain
extra query param (tf2te_verify, "name::searchHref" pairs joined by "|") -
Steam's own multibuy page reads its items[]/qty[] pairs by their own fixed
param names and has no reason to choke on an unrecognized extra one, same as
any ordinary URL query string; "::"/"|" are safe delimiters here since
neither a TF2 item name nor one of this file's own generated search hrefs
ever contains either sequence.
*/
function buildMultiBuyUrl(inputs, flagEntries) {
  const params = new URLSearchParams();
  params.set("appid", String(TF2_APP_ID));
  for (const { name, quantity } of inputs) {
    params.append("items[]", name);
    params.append("qty[]", String(quantity));
  }
  if (flagEntries && flagEntries.length > 0) {
    params.set("tf2te_verify", flagEntries.map(({ name, searchHref }) => `${name}::${searchHref}`).join("|"));
  }
  return `https://steamcommunity.com/market/multibuy?${params.toString()}`;
}

/*
@description: A generic Unique-quality Steam Market search for the given
keyword, scoped to melee/primary/secondary weapon slots (repeated
category_Type params - Steam's own multi-select facet shape, confirmed live
from the Market's own filter panel), sorted cheapest-first (sort=3&dir=1).
The cheapest-first sort does double duty: it's both the link shown to the
user AND the exact page resolveGenericItems below fetches to find the top
(cheapest) result(s) automatically.

Includes melee+primary+secondary weapon-type filters - a Kit Fabricator's
own melee-specific example doesn't mean every one is melee-only;
primary/secondary weapon Kit Fabricators exist too and need their own
slot's weapon covered by the same generic category. NOT yet confirmed
whether PDA/building weapons ever need to be included too (no such Kit
Fabricator reported yet).
See #111.
*/
function buildGenericInputSearchHref(keyword) {
  const params = new URLSearchParams();
  params.set("category_Quality", "Unique");
  params.append("category_Type", "melee");
  params.append("category_Type", "primary");
  params.append("category_Type", "secondary");
  params.set("appid", String(TF2_APP_ID));
  params.set("q", keyword);
  params.set("sort", "3");
  params.set("dir", "1");
  return `https://steamcommunity.com/market/search?${params.toString()}`;
}

/*
@description: Confirmed live (a real Specialized Killstreak Vita-Saw Kit
Fabricator's own required-inputs list, plus its own resulting BUG - see this
file's own header note): "Unique Killstreak Item" is a GENERIC
crafting-component category, not one specific tradable item - a plain
market_hash_name can never satisfy it directly. A Professional Killstreak Kit
Fabricator's own recipe needs a DIFFERENT generic category instead - "Unique
Specialized Killstreak Item" - since crafting a Professional-tier item needs
a Specialized-tier one as its own ingredient, the same progression logic
Basic->Specialized already has (Specialized needs a plain Basic-tier "Unique
Killstreak Item"). Each entry's own namePattern is DELIBERATELY
tier-specific, not a shared "any Killstreak tier" check - a "Unique
Specialized Killstreak Item" input must never resolve to a Basic or
Professional-tier weapon, and vice versa, even though all three tiers
otherwise look superficially similar (see
looksLikeAValidKillstreakWeaponMatch's own note on why a wrong tier match
here has real-money consequences, same as the wrong-item bug this whole
mechanism was built to prevent).

Kept as its own small, explicit table (not a broader "looks generic"
heuristic) since these are the only two categories confirmed live so far -
easy to extend if another one (e.g. a Professional-specific category) is
ever reported, without guessing at wording that hasn't actually been seen on
the page.
*/
const GENERIC_INPUT_CONFIGS = new Map([
  ["unique killstreak item", { href: buildGenericInputSearchHref("killstreak"), namePattern: /^(?:Non-Craftable )?Killstreak\b/i }],
  [
    "unique specialized killstreak item",
    { href: buildGenericInputSearchHref("specialized killstreak"), namePattern: /^(?:Non-Craftable )?Specialized Killstreak\b/i },
  ],
]);

/*
@description: Splits findRequiredInputs' own resolved list into inputs
Steam's multibuy page can resolve directly (named - a real market_hash_name)
and generic-category inputs that need resolving first (generic) - see
GENERIC_INPUT_CONFIGS' own note. Keeping a generic name in the multibuy URL
as-is isn't just "that one item has no price" - confirmed live, it broke
fetchMultiBuyTotal's total for EVERY item in the request, not just the
unresolvable one, which is why these are pulled out before buildMultiBuyUrl
ever sees them, not just before showing the total.
*/
function partitionInputs(inputs) {
  const named = [];
  const generic = [];
  for (const input of inputs) {
    (GENERIC_INPUT_CONFIGS.has(input.name.trim().toLowerCase()) ? generic : named).push(input);
  }
  return { named, generic };
}

/*
@description: A real, purchasable substitute for a generic category (see
GENERIC_INPUT_CONFIGS) must itself be NAMED like the SPECIFIC Killstreak
tier that category calls for - namePattern is that category's own tier-
specific pattern (e.g. bare "Killstreak " for the Basic-tier category,
"Specialized Killstreak " for the Specialized one), never a shared "any
Killstreak tier" check - a "Unique Specialized Killstreak Item" input must
never resolve to a Basic or Professional-tier weapon, and vice versa, even
though all three tiers otherwise look superficially similar. A bare
".includes('killstreak')" check is NOT enough either way - confirmed live
(see extractValidNamesFromSearchHtml's own note): unrelated page text
(a heading, breadcrumb, "results for..." string) could also contain that
word without being an item name at all - anchoring on the START of the name
rejects anything that merely mentions the word in passing. Still separately
rejects a crafting TOOL whose own name happens to start the same way (a
"Killstreak Kit"/"...Kit Fabricator" starts with "Killstreak " too, but is
not a weapon) - this is the LAST line of defense before a name is ever
folded into a real purchase URL, given a wrong result here has real money on
the line.
*/
function looksLikeAValidKillstreakWeaponMatch(name, namePattern) {
  const trimmed = name.trim();
  if (!namePattern.test(trimmed)) return false;
  // "Kit"/"Kit Fabricator" and Strangifier/Chemistry Set are all crafting
  // TOOLS that themselves consume other items - none of them can satisfy
  // "an input item" no matter how their own name happens to start.
  if (/\b(fabricator|kit|strangifier|chemistry set)\b/i.test(trimmed)) return false;
  return true;
}

/*
@description: Extracts the cheapest VALID item name straight off the search
results page's own visible TEXT (not a URL/href at all) - Steam's Market UI
was confirmed live to no longer render result rows as real "<a href=.../
market/listings/...>" links the way an older UI convention assumed. A real
result tile instead pastes the item's full name as plain text inside a leaf
"<span>...</span>" (e.g. "Killstreak Bonesaw" - confirmed live via a pasted
DOM snippet), styled entirely through auto-generated, hashed CSS class names
("BPTxiJF58z0-", "_1WHxiF6PoO0-", etc.) that are FAR too unstable to key
extraction off (near-certain to change on Steam's next frontend deploy,
unlike a stable semantic class name) - so this reads every leaf span's plain
text instead of touching any class name at all, and relies entirely on
looksLikeAValidKillstreakWeaponMatch to tell a real result ("Killstreak
Bonesaw") apart from everything else on the page (a "Level 1 Bonesaw" type
line, a price, a quantity count, a page heading that happens to mention the
search term). Since the search itself is sorted cheapest-first (see
buildGenericInputSearchHref's own sort=3&dir=1), the FIRST validated span
text in document order is the cheapest genuine match.

Reads the search page's own server-rendered HTML response (no separate data
call backs it, confirmed live) - neither a "market_listing_row_link"-classed
href (absent from Steam's current Market UI) nor the market/search/render
JSON endpoint (never called for this page) is available to use instead.

Extracts up to `count` DISTINCT valid names, in cheapest-first document
order (deduplicated by name - defensive against the same name appearing
twice elsewhere on the page, e.g. a hover-card/"Copy Name" overlay repeating
it) - see resolveGenericItems' own note on why buying N units needs N
DISTINCT items rather than N units of a single one.
@returns {string[]} the decoded item names (possibly empty).
See #112.
*/
export function extractValidNamesFromSearchHtml(html, namePattern, count) {
  const text = String(html || "");
  const seen = new Set();
  const names = [];
  for (const match of text.matchAll(/<span\b[^>]*>([^<]+)<\/span>/gi)) {
    if (names.length >= count) break;
    const candidate = decodeHtmlEntities(match[1]).trim();
    if (!looksLikeAValidKillstreakWeaponMatch(candidate, namePattern)) continue;
    const key = candidate.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(candidate);
  }
  return names;
}

/*
@description: Fetches searchHref (same-origin, no relay needed - see
fetchMultiBuyTotal's own note) and resolves it to `quantityNeeded` units of
currently-listed items matching namePattern (see GENERIC_INPUT_CONFIGS' own
note on why this is tier-specific per generic category, not a shared check).

Picks `quantityNeeded` DISTINCT items (one unit each) rather than one item at
quantity=`quantityNeeded`: the "From $X" price shown for an item is only its
single lowest listing, and a SECOND unit of that same item would consume the
next-cheapest listing up its own order book (almost certainly pricier, not a
repeat of that first price) - Steam's own multibuy page has no way to preview
that per-unit escalation before checkout the way it can for a single unit, so
buying N distinct cheap items instead avoids the whole question and is
generally the cheaper choice anyway. If the search doesn't have enough
distinct valid results to cover quantityNeeded, the shortfall is piled onto
the single cheapest one found (best effort - still resolves SOMETHING
purchasable rather than failing the whole input) rather than left unresolved.
@returns: an array of {name, quantity} entries (quantity is 1 for every entry
except a possible shortfall top-up on the first/cheapest one).
@throws: on a non-OK HTTP response, or when nothing on the page validates at
all - caught by this file's own caller, which falls back to a manual
"search it yourself" note for that one generic input rather than failing
the whole button, or (crucially) trusting a wrong name.
*/
async function resolveGenericItems(searchHref, namePattern, quantityNeeded) {
  // Force English regardless of the account's own display language -
  // required for any page-text parsing here, for this reason:
  // namePattern is hardcoded to match English tier words ("Killstreak",
  // "Specialized"), which would silently match NOTHING on a page rendered
  // in any other display language - confirmed live as the actual cause of a
  // real "fetch succeeded, zero valid candidates" failure. Only this
  // background fetch is forced - the visible "search yourself"/"verify"
  // link the user actually clicks stays in their own language.
  const englishSearchHref = searchHref + (searchHref.includes("?") ? "&" : "?") + "l=english";
  const response = await fetch(englishSearchHref, { credentials: "include" });
  if (!response.ok) throw new Error(`Steam returned HTTP ${response.status}`);

  const html = await response.text();
  const distinctNames = extractValidNamesFromSearchHtml(html, namePattern, quantityNeeded);
  if (distinctNames.length === 0) {
    // Diagnostic counts included directly in the thrown message (surfaced
    // via this file's own console.warn at the call site) - tells apart "the
    // page had no plain-text spans at all" (a markup-shape problem) from
    // "it had some, none validated" (a naming/language/facet problem)
    // without needing another live round-trip just to ask which one it was.
    const spanCount = (html.match(/<span\b[^>]*>[^<]+<\/span>/gi) || []).length;
    throw new Error(`No valid current listing found for this generic search (page had ${spanCount} plain-text spans, ${html.length} chars total).`);
  }

  const resolved = distinctNames.map((name) => ({ name, quantity: 1 }));
  const shortfall = quantityNeeded - distinctNames.length;
  if (shortfall > 0) resolved[0].quantity += shortfall;
  return resolved;
}

/*
@description: Builds the note shown under the Buy Parts button for every
generic-category input (see partitionInputs) - one line per input, either
saying which specific item it got auto-substituted with (so the user knows
exactly what they're about to buy, and can double-check it) or, if
resolution failed, a "source it yourself" fallback with a search link.
*/
function buildGenericInputsNote(genericResults) {
  const note = document.createElement("div");
  note.className = "tf2te-fabricator-manual-inputs";
  note.style.marginTop = "6px";
  note.style.fontSize = "12px";
  note.style.color = "#8f98a0";

  for (const { genericName, resolvedItems, searchHref } of genericResults) {
    const line = document.createElement("div");
    const summary = resolvedItems?.map(({ name, quantity }) => (quantity > 1 ? `${name} ×${quantity}` : name)).join(", ");
    line.append(
      resolvedItems
        ? `"${genericName}" was substituted with the cheapest currently-listed match(es): ${summary}. Prices can change before checkout, so `
        : `Couldn't automatically resolve "${genericName}". `
    );

    const searchLink = document.createElement("a");
    searchLink.href = searchHref;
    searchLink.target = "_blank";
    searchLink.rel = "noopener noreferrer";
    searchLink.textContent = resolvedItems ? "verify on Steam Market" : "Search Steam Market";
    searchLink.style.color = "#7ab0d0";
    line.appendChild(searchLink);

    note.appendChild(line);
  }

  return note;
}

/*
@description: Reads one HTML attribute's raw value straight out of a single
already-isolated "<input ...>" tag string - a small helper for
parseMultiBuyTotalHtml below, not a general HTML parser (attribute order/
quoting beyond plain double quotes isn't handled, since Steam's own markup
here doesn't need it).
*/
function extractTagAttribute(tagHtml, attrName) {
  const match = new RegExp(`${attrName}="([^"]*)"`, "i").exec(tagHtml);
  return match ? match[1] : null;
}

/*
@description: Extracts every "<input ...>" tag whose class attribute
contains className, as raw tag-text strings (not DOM nodes) - deliberately a
plain regex scan over the raw HTML string rather than DOMParser, same
approach utils/marketplaceTfPricing.js's own parseHighestVolumePriceUsd
already uses and documents (its own header note: "so this stays testable in
a plain Node test environment (no DOMParser there) without a polyfill" - the
exact same reasoning applies here, and keeps this module's own parsing logic
unit-testable with plain HTML string fixtures).
*/
function extractTagsByClass(html, tagName, className) {
  const tags = html.match(new RegExp(`<${tagName}\\b[^>]*>`, "gi")) || [];
  const classPattern = new RegExp(`class="[^"]*\\b${className}\\b[^"]*"`, "i");
  return tags.filter((tag) => classPattern.test(tag));
}

function extractInputTagsByClass(html, className) {
  return extractTagsByClass(html, "input", className);
}

/*
@description: Sums up the per-item price × quantity Steam itself already
computed and rendered into its own multibuy page's form fields - the exact
same fields Steam's own client-side UpdateOrderTotal() reads:
".market_multi_price" inputs, each carrying a "data-nameid" that pairs it
with a "#buy_{nameid}_qty" quantity input.
@param {string} html - the multibuy page's raw HTML text.
@returns: the formatted total (e.g. "$12.50"), in whatever currency/notation
Steam's own page used, or null if no readable price field was found at all
(an expired/invalid session, or Steam changed its markup).
*/
export function parseMultiBuyTotalHtml(html) {
  const priceTags = extractInputTagsByClass(html, "market_multi_price");

  let total = 0;
  let prefix = "";
  let suffix = "";
  let matchedAny = false;

  for (const priceTag of priceTags) {
    const nameId = extractTagAttribute(priceTag, "data-nameid");
    const priceText = extractTagAttribute(priceTag, "value");
    if (!nameId || priceText == null) continue;

    const qtyTagMatch = new RegExp(`<input\\b[^>]*\\bid="buy_${nameId}_qty"[^>]*>`, "i").exec(html);
    const quantity = qtyTagMatch ? parseInt(extractTagAttribute(qtyTagMatch[0], "value"), 10) : NaN;
    if (!Number.isFinite(quantity) || quantity <= 0) continue;

    const parsed = parsePriceParts(priceText);
    if (!parsed) continue;

    if (!matchedAny) {
      prefix = parsed.prefix;
      suffix = parsed.suffix;
      matchedAny = true;
    }
    total += parsed.value * quantity;
  }

  if (!matchedAny) return null;

  // No inserted space either side - matches how Steam itself concatenates a
  // currency symbol against the number (e.g. "$1.35", "1,25€").
  return `${prefix}${total.toFixed(2)}${suffix}`;
}

/*
@description: Fetches Steam's OWN multibuy page - plain same-origin fetch,
no utils/fetchJsonRelay.js relay needed (that exists specifically for
CROSS-origin calls a content script can't read the response of directly -
see that file's own header note; this request stays on steamcommunity.com
throughout).
@throws: on a non-OK HTTP response, or when parseMultiBuyTotalHtml found no
readable price field at all - caught by this file's own caller, which shows
"price unavailable" rather than leaving the button stuck on its initial
"(…)" text forever.
@returns {Promise<{formatted: string, value: ?number}>} formatted is the same
string parseMultiBuyTotalHtml itself returns; value is that same amount as a
plain major-unit number (re-parsed via parsePriceParts, reusing its existing
"."/"," decimal handling rather than duplicating it) - null only if the
formatted string itself turns out unparseable, which shouldn't happen in
practice since parseMultiBuyTotalHtml always builds it from a real numeric
total. Needed by this file's own value-card headline (see
buildValueCard/applyProfitLossHeadline), which has to compare this total
against the finished Kit's own estimated value.
*/
async function fetchMultiBuyTotal(multiBuyUrl) {
  const response = await fetch(multiBuyUrl, { credentials: "include" });
  if (!response.ok) throw new Error(`Steam returned HTTP ${response.status}`);

  const html = await response.text();
  const formatted = parseMultiBuyTotalHtml(html);
  if (formatted == null) throw new Error("Steam multibuy page had no readable prices.");
  const parsed = parsePriceParts(formatted);
  return { formatted, value: parsed ? parsed.value : null };
}

function removeExistingBlock(container) {
  container.querySelectorAll(`.${BLOCK_CLASS}`).forEach((n) => n.remove());
}

// Confirmed live via the multibuy page's own markup: each price field
// carries Steam's own tooltip - data-tooltip-text="We have prefilled the
// price with the cheapest listing currently available." - i.e. Steam itself
// treats this as a live snapshot, not a locked-in price, for EVERY item in
// the multibuy (not just an auto-resolved generic one - see
// buildGenericInputsNote's own, narrower "price may change" wording for
// that specific case). If another buyer takes that exact listing between
// this page loading and the user finishing checkout, the real charged total
// can come out higher than what's shown here.
const BUY_PARTS_TOOLTIP =
  "Opens Steam's own multi-item purchase page, pre-filled with every required item and quantity. Steam prefills each price with its own currently-cheapest listing - like any live marketplace price, this can change slightly before you finish checkout.";

function createMultiBuyButton(url) {
  const button = createButtonLink("Buy Parts (…)", url);
  button.title = BUY_PARTS_TOOLTIP;
  return button;
}

function buildPriceDisclaimer() {
  const note = document.createElement("div");
  note.className = "tf2te-fabricator-price-disclaimer";
  note.style.marginTop = "4px";
  note.style.fontSize = "11px";
  note.style.color = "#6b7278";
  note.textContent = "Prices reflect Steam's current cheapest listings and may change slightly before you finish checkout.";
  return note;
}

// ============================================================
// ESTIMATED KIT VALUE (the finished Kit's own order book - highest buy
// order net of Steam's cut, plus the raw buy order/sell listing for
// reference)
// ============================================================

// TF2's Market fees: a 5% Steam fee plus a 10% game (publisher) fee, each
// charged ON TOP of what the seller receives, rounded down, and at least one
// minor unit (cent) each. So a sale the seller receives 1.00 for costs the
// buyer 1.15, and the seller's share of a buyer total is about total / 1.15
// (about 87%), not total * 0.85.
const STEAM_WALLET_FEE_RATE = 0.05;
const TF2_PUBLISHER_FEE_RATE = 0.1;
const MIN_FEE_MINOR_UNITS = 1;

/*
@description: What the buyer pays for a sale the seller receives
`sellerMinorUnits` for - Steam's own CalculateAmountToSendForDesiredReceivedAmount
rule (see the fee constants above).
*/
function buyerTotalForSellerAmount(sellerMinorUnits) {
  const steamFee = Math.floor(Math.max(sellerMinorUnits * STEAM_WALLET_FEE_RATE, MIN_FEE_MINOR_UNITS));
  const publisherFee = Math.floor(Math.max(sellerMinorUnits * TF2_PUBLISHER_FEE_RATE, MIN_FEE_MINOR_UNITS));
  return sellerMinorUnits + steamFee + publisherFee;
}

/*
@description: The most the seller receives from a sale whose buyer pays
`buyerTotalMinorUnits` - the largest seller amount whose buyer total still
fits, which is what Steam's own GetItemPriceFromTotal resolves to.
steamcommunity.com/inventoryMarketActions/content.js calls Steam's real
function for an actual listing; this preview never submits anything, so
the same rule is reproduced here as a pure function instead.
@returns {number} minor units (0 when the total can't even cover the minimum fees).
*/
export function estimateSellerReceivesMinorUnits(buyerTotalMinorUnits) {
  let sellerMinorUnits = Math.floor(buyerTotalMinorUnits / (1 + STEAM_WALLET_FEE_RATE + TF2_PUBLISHER_FEE_RATE));
  while (sellerMinorUnits > 0 && buyerTotalForSellerAmount(sellerMinorUnits) > buyerTotalMinorUnits) sellerMinorUnits--;
  while (buyerTotalForSellerAmount(sellerMinorUnits + 1) <= buyerTotalMinorUnits) sellerMinorUnits++;
  return Math.max(0, sellerMinorUnits);
}

/*
@description: Derives the finished Kit's own Steam market_hash_name from the
Fabricator's own (real, on-page) title - e.g. "Professional Killstreak
Minigun Kit Fabricator" -> "Professional Killstreak Minigun Kit". Unlike
scrap.tf/itemLinks' own equivalent reconstruction (buildSteamMarketName),
Steam's own title text here is already the FULL correct name (it already
says "Killstreak", not just "Professional Minigun Kit Fabricator" the way
scrap.tf's own raw text omits it) - so this only ever needs to strip the
trailing " Fabricator" word, never rebuild the name from separate tier/target
pieces. Only ever called after KIT_FABRICATOR_TITLE_PATTERN has already
matched fabricatorTitle, so the " Fabricator" suffix is always present.
@returns {string}
*/
function buildFinishedKitMarketHashName(fabricatorTitle) {
  return fabricatorTitle.replace(/\s+Fabricator\s*$/i, "").trim();
}

function buildKitMarketListingUrl(kitName) {
  return `https://steamcommunity.com/market/listings/${TF2_APP_ID}/${encodeURIComponent(kitName)}`;
}

/*
@description: Looks up the finished Kit's own order book and estimates the
net amount actually receivable after Steam's cut, from the highest buy order
side - see estimateSellerReceivesMinorUnits. Also returns the raw order book
as-is, for buildValueCard's own "Highest Buy Order"/"Lowest Sell Listing"
display.
@throws when there are currently no buy orders for this kit at all (distinct
from a genuine network/HTTP failure, so the caller can show a clearer
"no buy orders yet" message instead of a generic error) - a missing SELL
side, by contrast, isn't thrown for (that's shown as its own "None" in the
order book card, not treated as this whole lookup failing).
*/
async function fetchEstimatedKitValue(kitMarketUrl) {
  const orderBook = await fetchListingOrderBook(kitMarketUrl);
  if (!orderBook.highestBuyOrder) {
    const error = new Error("No buy orders for this kit yet.");
    error.noBuyOrders = true;
    // Carried along even on this "throw" path - the SELL side (and the
    // order book card's own display of it) is independent of whether a buy
    // order exists, so the caller can still show it instead of blanking
    // both halves just because one came back empty.
    error.orderBook = orderBook;
    throw error;
  }

  // buildPriceResult always normalizes to 2 decimals, so prefix/suffix alone
  // (pulled back off the already-formatted string) are enough to reformat
  // the estimated net figure in the same currency notation - no separate
  // decimals inference needed.
  const { prefix, suffix } = currencyAffixesOf(orderBook.highestBuyOrder);
  const estimatedNetMinorUnits = estimateSellerReceivesMinorUnits(orderBook.highestBuyOrder.minorUnits);

  return {
    orderBook,
    estimatedNetFormatted: formatMinorUnits(estimatedNetMinorUnits, prefix, suffix),
    // Exposed alongside the formatted string (not just derivable from it) so
    // the value card's own profit/loss headline can do real arithmetic
    // against the Buy Parts total, in the SAME currency notation, without
    // re-parsing a display string back into a number a second time.
    estimatedNetValue: estimatedNetMinorUnits / 100,
    currencyPrefix: prefix,
    currencySuffix: suffix,
  };
}

// The estimate is what the seller would receive (fee already deducted, see
// fetchEstimatedKitValue), so the label says so.
const KIT_VALUE_LABEL = "Estimated Kit Value on SCM (after Steam fees)";

const VALUE_CARD_TOOLTIP =
  "Estimates whether crafting this Fabricator and selling the resulting Kit at Steam's current highest buy order (after Steam's ~15% marketplace fee) would turn a profit, compared against this recipe's own Buy Parts total - a rough guide, not a guaranteed outcome. The listing link opens the Kit's own Steam Market page to review - you don't own this Kit yet (it hasn't been crafted), so it can't actually be listed or sold from here.";

/*
@description: Single card shown under the Buy Parts button, answering the
one question this feature exists for - is crafting this worth it? - without
making the user subtract two equally-weighted numbers. It leads with that answer
directly (a profit/loss headline, colored and arrowed - see
applyProfitLossHeadline), then the raw Buy Order/Sell Listing breakdown
underneath for anyone who wants to verify the math or judge liquidity, then a
plain text link (not another button - clicking it doesn't DO anything
comparable to Buy Parts, it just opens the Kit's own listing page to review)
to view the listing directly.
@returns: {card, headlineEl, buyValueEl, sellValueEl, estimateEl} - handed
back separately (built with "…"/neutral placeholders here) so the caller can
fill each in once its own async fetch resolves, same "show something before
the slow lookup" pattern this file's own buttons already use.
*/
function buildValueCard(kitMarketUrl) {
  const card = document.createElement("div");
  card.className = "tf2te-fabricator-kit-value-card";
  card.style.marginTop = "8px";
  card.style.border = "1px solid #3d4453";
  card.style.borderRadius = "6px";
  card.style.overflow = "hidden";
  card.title = VALUE_CARD_TOOLTIP;

  const headlineEl = document.createElement("div");
  headlineEl.style.display = "flex";
  headlineEl.style.alignItems = "center";
  headlineEl.style.justifyContent = "space-between";
  headlineEl.style.gap = "10px";
  headlineEl.style.padding = "8px 12px";
  headlineEl.style.fontSize = "13px";
  headlineEl.style.fontWeight = "700";
  headlineEl.style.color = "#8f98a0";
  headlineEl.textContent = "Estimating…";

  const breakdown = document.createElement("div");
  breakdown.style.display = "flex";
  breakdown.style.borderTop = "1px solid rgba(255,255,255,0.08)";

  function buildHalf(label, borderRight) {
    const half = document.createElement("div");
    half.style.flex = "1";
    half.style.padding = "7px 12px";
    half.style.minWidth = "0";
    if (borderRight) half.style.borderRight = "1px solid rgba(255,255,255,0.08)";

    const labelEl = document.createElement("div");
    labelEl.style.fontSize = "10px";
    labelEl.style.color = "#8f98a0";
    labelEl.textContent = label;

    const valueEl = document.createElement("div");
    valueEl.style.fontSize = "13px";
    valueEl.style.fontWeight = "600";
    valueEl.style.color = "#d6d7d8";
    valueEl.textContent = "…";

    half.append(labelEl, valueEl);
    return { half, valueEl };
  }

  const buy = buildHalf("Buy Order", true);
  const sell = buildHalf("Sell Listing", false);
  breakdown.append(buy.half, sell.half);

  const footer = document.createElement("div");
  footer.style.display = "flex";
  footer.style.alignItems = "center";
  footer.style.justifyContent = "space-between";
  footer.style.gap = "8px";
  footer.style.padding = "6px 12px 8px";
  footer.style.borderTop = "1px solid rgba(255,255,255,0.08)";
  footer.style.fontSize = "12px";

  const estimateEl = document.createElement("span");
  estimateEl.style.color = "#8f98a0";
  estimateEl.textContent = `${KIT_VALUE_LABEL}: …`;

  // A plain text link, not a button-styled one (unlike this file's own
  // createButtonLink-based Buy Parts button) - see this function's own
  // header note on why: clicking it doesn't submit anything, it just opens
  // the Kit's own listing page to review.
  const viewLink = document.createElement("a");
  viewLink.href = kitMarketUrl;
  viewLink.target = "_blank";
  viewLink.rel = "noopener noreferrer";
  viewLink.textContent = "View listing ↗";
  viewLink.style.color = "#67c1f5";
  viewLink.style.textDecoration = "none";
  viewLink.style.whiteSpace = "nowrap";

  footer.append(estimateEl, viewLink);

  card.append(headlineEl, breakdown, footer);

  return { card, headlineEl, buyValueEl: buy.valueEl, sellValueEl: sell.valueEl, estimateEl };
}

const SELL_LISTING_FROM_STEAM_TIP =
  "Steam's own lowest price for this Kit (the same number as its \"Starting at\"), since your Market sort isn't Price (low to high). Steam updates it every few minutes, so a listing posted just now may not be in it yet.";
const SELL_LISTING_UNKNOWN_TIP =
  "Steam lists Market listings in the sort you last picked on a listing page, and yours isn't Price (low to high), so the cheapest Kit listing isn't on the page this reads, and Steam's own lowest price couldn't be loaded either. Set the sort back to Price (low to high) on any listing page to see it here. The buy order and the estimated value don't depend on the sort.";

/*
@description: Fills the value card's "Sell Listing" cell. The Kit's listing
page comes back in the account's own Market sort (see
marketListingOrderBook.js), so when it isn't cheapest-first, the cheapest
listing comes from Steam's own priceoverview instead (sort-independent, in
the wallet currency, can lag a few minutes), and the hover text says so.
*/
async function showLowestSell(sellEl, orderBook, kitName, stillCurrent) {
  sellEl.title = "";
  if (orderBook.lowestSellOrder || !orderBook.listingsNotCheapestFirst) {
    sellEl.textContent = orderBook.lowestSellOrder?.formatted ?? "None";
    return;
  }

  sellEl.textContent = "Checking…";
  let steamLowest = null;
  try {
    const currency = await getWalletCurrencyId();
    steamLowest = currency ? parseMarketPriceText(await getScmLowestPriceText(kitName, currency)) : null;
  } catch {
    // Shown as unknown below, with the reason on hover.
  }
  if (!stillCurrent()) return;
  sellEl.textContent = steamLowest ? `${steamLowest.formatted} ⓘ` : "Unknown ⓘ";
  sellEl.title = steamLowest ? SELL_LISTING_FROM_STEAM_TIP : SELL_LISTING_UNKNOWN_TIP;
}

/*
@description: Colors/labels the value card's own headline once BOTH the
parts total and the Kit's own estimated value are known - the one thing this
whole feature is actually meant to answer ("is crafting this worth it?"),
shown directly rather than making the user subtract two separate numbers
themselves. Falls back to a neutral (non-comparative) message whenever
either side couldn't be resolved, rather than guessing/omitting silently.
@param {?number} partsTotalValue - major-unit Buy Parts cost, or null if that
fetch failed.
@param {?{estimatedNetValue: number, currencyPrefix: string, currencySuffix: string}} kitValueResult -
null if the Kit's own value couldn't be resolved at all (including "no buy
orders yet", which also can't support a profit/loss comparison).
*/
function applyProfitLossHeadline(headlineEl, partsTotalValue, kitValueResult) {
  if (partsTotalValue == null || kitValueResult == null) {
    headlineEl.style.background = "";
    headlineEl.style.color = "#8f98a0";
    headlineEl.textContent =
      partsTotalValue == null && kitValueResult == null
        ? "Not enough data to estimate profit"
        : partsTotalValue == null
          ? "Buy Parts total unavailable - can't estimate profit"
          : "No current Kit value to compare against";
    return;
  }

  const deltaMajorUnits = kitValueResult.estimatedNetValue - partsTotalValue;
  const isProfit = deltaMajorUnits >= 0;
  const formatAmount = (majorUnits) => `${kitValueResult.currencyPrefix}${majorUnits.toFixed(2)}${kitValueResult.currencySuffix}`;

  headlineEl.style.background = isProfit ? "#202b18" : "#3a2422";
  headlineEl.style.color = isProfit ? "#8bc53f" : "#e0574a";
  // Compared against the Kit's after-fee value (what selling it would
  // actually pay out), so the headline says so; the hover shows the math.
  headlineEl.textContent = `${isProfit ? "▲" : "▼"} Crafting this would ${isProfit ? "profit" : "lose"} ~${formatAmount(Math.abs(deltaMajorUnits))} (after Steam fees)`;
  headlineEl.title = `Kit value after Steam fees ${formatAmount(kitValueResult.estimatedNetValue)} minus Buy Parts total ${formatAmount(partsTotalValue)}`;
}

/*
@description: Runs on Steam's own market/multibuy PAGE itself (a completely
different page context from the rest of this file, which runs on the
inventory item panel that LINKS to this page), once the user actually lands
here to review/complete the purchase, any row this extension had to
auto-substitute for a generic crafting requirement (see buildMultiBuyUrl's
own tf2te_verify param) gets visibly flagged, right where the user is about
to click Purchase - not just back on the originating inventory panel, which
they may not scroll back up to re-read.

Row markup confirmed live (the real page DOM, both a Specialized-
and a Basic-tier Killstreak row): each row is a "<tr>" whose item name sits
in a "<a class="market_listing_item_name_link">". The link's visible text is
NOT reliable for matching: confirmed live, a row shows the cheapest
listing's own Name Tag name (''Aye, me bottle o' scrumpy!'' for a
"Killstreak Bottle"), not the item's market name. So a row is matched by
findFlaggedNameLink: visible text, then the link's own listing URL, then
the row's position in the URL's items[] list.

The flagged row's own notice also links straight back to the SAME
filtered Market search this item was originally resolved from
(melee/primary/secondary/Unique/keyword/sort - see
buildGenericInputSearchHref) - carried alongside each flagged name in
tf2te_verify (see buildMultiBuyUrl's own note) - so the user can compare
other current listings without rebuilding that filtered search by hand.
*/

// Each entry is "name::searchHref" - see buildMultiBuyUrl's own note on why
// "::"/"|" are safe delimiters here. Keyed by lowercased name.
function parseVerifyValue(verifyValue) {
  const flagMap = new Map();
  for (const entry of verifyValue.split("|")) {
    const separatorIndex = entry.indexOf("::");
    if (separatorIndex === -1) continue;
    const name = entry.slice(0, separatorIndex).trim().toLowerCase();
    const searchHref = entry.slice(separatorIndex + 2);
    if (name && searchHref) flagMap.set(name, searchHref);
  }
  return flagMap;
}

// The market name a row's link points at (".../market/listings/440/{name}"),
// lowercased, or null when the link has no such URL.
function listingNameFromHref(href) {
  const match = /\/market\/listings\/\d+\/([^?#]+)/.exec(href || "");
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]).trim().toLowerCase();
  } catch {
    return null;
  }
}

/*
@description: Finds the row link for one flagged market name (lowercased).
Tries, in order: the link's visible text, the market name in its listing URL,
and finally its position - Steam lists the rows in the same order as the
URL's items[] params, so the flagged name's index there picks its row, used
only when the page has exactly one row per items[] entry.
*/
function findFlaggedNameLink(nameLinks, name, requestedItems) {
  const byText = nameLinks.find((link) => link.textContent.trim().toLowerCase() === name);
  if (byText) return byText;

  const byHref = nameLinks.find((link) => listingNameFromHref(link.getAttribute("href")) === name);
  if (byHref) return byHref;

  if (nameLinks.length !== requestedItems.length) return null;
  const index = requestedItems.findIndex((item) => item.trim().toLowerCase() === name);
  return index === -1 ? null : nameLinks[index];
}

export function showMultiBuyVerifyReminder() {
  const params = new URLSearchParams(window.location.search);
  const flagged = params.get("tf2te_verify");
  if (!flagged) return;

  const flagMap = parseVerifyValue(flagged);
  if (flagMap.size === 0) return;

  const nameLinks = [...document.querySelectorAll(".market_listing_item_name_link")];
  const requestedItems = params.getAll("items[]");
  const notFound = [];

  for (const [name, searchHref] of flagMap) {
    const nameLink = findFlaggedNameLink(nameLinks, name, requestedItems);
    const row = nameLink?.closest("tr");
    const nameCell = nameLink?.closest("td");
    if (!row || !nameCell) {
      notFound.push(name);
      continue;
    }
    if (row.dataset.tf2teVerifyFlagged) continue;
    row.dataset.tf2teVerifyFlagged = "1";

    row.style.outline = "2px solid #e4b74e";
    row.style.outlineOffset = "-2px";

    const notice = document.createElement("div");
    notice.style.marginTop = "4px";
    notice.style.fontSize = "11px";
    notice.style.color = "#e4b74e";
    notice.append("⚠️ Auto-selected by TF2 Trading Enhancer as a cheap match for a generic crafting requirement. ");

    // Same filtered search this feature already resolved this item FROM -
    // lets the user re-check other current listings without rebuilding that
    // filtered Market search by hand.
    const searchLink = document.createElement("a");
    searchLink.href = searchHref;
    searchLink.target = "_blank";
    searchLink.rel = "noopener noreferrer";
    searchLink.textContent = "Compare other listings";
    searchLink.style.color = "#7ab0d0";
    notice.appendChild(searchLink);

    notice.append(" before completing checkout.");
    nameCell.appendChild(notice);
  }

  if (notFound.length > 0) {
    console.warn(
      `[TF2 Trading Enhancer] fabricatorMultiBuy: couldn't find the multibuy row to flag for: ${notFound.join(", ")} (${nameLinks.length} rows, ${requestedItems.length} items[] params)`
    );
  }
}

/*
@description: Runs on every DOM mutation (see this file's own caller in
steamcommunity.com/content.js, same MutationObserver pattern
showItemQuickLinks/showInventoryMarketActions already use) - re-scans
whichever item panel is currently showing, adding/updating/removing the "Buy
Parts" button as the user clicks through different inventory items.

Keyed by the exact resolved input list (name+quantity), not just "is this a
fabricator" - a genuinely different fabricator/Chemistry Set selected next
naturally gets its own rebuild. Something is always inserted synchronously
BEFORE any await (the real button when there's nothing generic to resolve,
a plain status placeholder otherwise) - so a second mutation firing while
resolution/pricing is still in flight already finds a matching key AND an
existing block, and bails immediately instead of double-building (no
separate "currently building" marker needed the way itemQuickLinks/
content.js's own insertQuickLinks requires).
*/
export async function showFabricatorMultiBuy() {
  const picked = pickContainer();
  if (!picked) return;

  const { container, title } = picked;

  if (getActiveInventoryAppId() !== TF2_APP_ID) {
    removeExistingBlock(container);
    return;
  }

  // Only the visitor's OWN inventory, never a friend's/stranger's
  // inventory they're just browsing while logged in as themselves - buying
  // parts to satisfy someone ELSE's Fabricator recipe makes no practical
  // sense, since the resulting items land in the visitor's own inventory
  // either way, not the profile being viewed's. findSteamId64 (this page's
  // OWNER) vs findLoggedInSteamId64 (the VISITOR) - both null (neither
  // resolved yet, e.g. still loading) fails this check too, same as a
  // genuine mismatch, rather than assuming "own" by default.
  const viewedSteamId64 = findSteamId64();
  const loggedInSteamId64 = findLoggedInSteamId64();
  if (!viewedSteamId64 || !loggedInSteamId64 || viewedSteamId64 !== loggedInSteamId64) {
    removeExistingBlock(container);
    return;
  }

  // Scoped to Specialized/Professional Killstreak Kit Fabricators only - see
  // KIT_FABRICATOR_TITLE_PATTERN's own note. Checked before even scanning
  // for the inputs list, so a Chemistry Set/Basic Kit Fabricator never gets
  // this button at all, regardless of what its own inputs look like.
  const fabricatorTitle = readVisibleTitleText(title);
  if (!KIT_FABRICATOR_TITLE_PATTERN.test(fabricatorTitle)) {
    removeExistingBlock(container);
    return;
  }

  // The finished Kit's own name/listing - derived from the Fabricator's OWN
  // title (already the full, correct Steam name), not from the inputs list
  // below.
  const kitName = buildFinishedKitMarketHashName(fabricatorTitle);
  const kitMarketUrl = buildKitMarketListingUrl(kitName);

  const found = findRequiredInputs(container);
  if (!found) {
    removeExistingBlock(container);
    return;
  }

  // The Kit name is part of the key: two different Fabricators can need the
  // exact same inputs, and the value card is specific to the finished Kit.
  const requestKey = `${kitName}|${found.inputs.map((i) => `${i.name}:${i.quantity}`).join("|")}`;
  if (container.dataset.tf2teFabricatorKey === requestKey && container.querySelector(`.${BLOCK_CLASS}`)) {
    return; // already built for this exact Kit and set of required inputs
  }
  container.dataset.tf2teFabricatorKey = requestKey;

  removeExistingBlock(container);

  const { named, generic } = partitionInputs(found.inputs);

  const block = document.createElement("div");
  block.className = BLOCK_CLASS;
  block.style.marginTop = "8px";

  let button = null;
  let multiBuyUrl = null;
  let statusPlaceholder = null;
  const { card: valueCard, headlineEl, buyValueEl: orderBookBuyEl, sellValueEl: orderBookSellEl, estimateEl } = buildValueCard(kitMarketUrl);

  if (generic.length === 0) {
    // The common case - no generic-category input to resolve first, so the
    // button is built synchronously.
    multiBuyUrl = buildMultiBuyUrl(named);
    button = createMultiBuyButton(multiBuyUrl);
    block.appendChild(button);
    block.appendChild(valueCard);
    block.appendChild(buildPriceDisclaimer());
  } else {
    statusPlaceholder = document.createElement("div");
    statusPlaceholder.style.fontSize = "12px";
    statusPlaceholder.style.color = "#8f98a0";
    statusPlaceholder.textContent = "Resolving the cheapest available part(s)…";
    block.appendChild(statusPlaceholder);
  }

  found.lastElement.insertAdjacentElement("afterend", block);

  const genericResults = [];
  if (generic.length > 0) {
    // Sequential, not Promise.all - in practice there's only ever one
    // generic input per recipe so far, and sequential keeps this simple;
    // nothing here is latency-sensitive enough to need parallelizing.
    const resolvedGenericInputs = [];
    for (const input of generic) {
      const { href: searchHref, namePattern } = GENERIC_INPUT_CONFIGS.get(input.name.trim().toLowerCase());
      try {
        const resolvedItems = await resolveGenericItems(searchHref, namePattern, input.quantity);
        if (container.dataset.tf2teFabricatorKey !== requestKey) return; // user moved on
        resolvedGenericInputs.push(...resolvedItems);
        genericResults.push({ genericName: input.name, resolvedItems, searchHref });
      } catch (e) {
        console.warn(`[TF2 Trading Enhancer] fabricatorMultiBuy: couldn't resolve the cheapest match for "${input.name}"`, e);
        if (container.dataset.tf2teFabricatorKey !== requestKey) return;
        genericResults.push({ genericName: input.name, resolvedItems: null, searchHref });
      }
    }

    if (!container.querySelector(`.${BLOCK_CLASS}`)) return; // block got wiped mid-resolve

    statusPlaceholder.remove();

    const finalInputs = [...named, ...resolvedGenericInputs];
    if (finalInputs.length > 0) {
      // Flag exactly the auto-substituted items, not every item - a named
      // (real, literal) input never needed resolving, so it doesn't need a
      // second look on the multibuy page the way a guessed substitution does.
      // Each one carries its own generic category's searchHref along (see
      // buildMultiBuyUrl's own note), not just its name.
      const flagEntries = genericResults
        .filter((r) => r.resolvedItems)
        .flatMap((r) => r.resolvedItems.map((item) => ({ name: item.name, searchHref: r.searchHref })));
      multiBuyUrl = buildMultiBuyUrl(finalInputs, flagEntries);
      button = createMultiBuyButton(multiBuyUrl);
      block.appendChild(button);
      block.appendChild(valueCard);
      block.appendChild(buildPriceDisclaimer());
    }
  }

  if (genericResults.length > 0) {
    block.appendChild(buildGenericInputsNote(genericResults));
  }

  if (!button) return; // every input was generic AND every resolve attempt failed

  // Both prices are independent lookups (parts cost vs. the finished Kit's
  // own current buy order) - run them concurrently rather than chaining
  // them. Each side's own OUTCOME is captured into a local var (rather than
  // updating the headline from within either .then/.catch directly) since
  // the profit/loss headline needs BOTH results together (see
  // applyProfitLossHeadline).
  const stillCurrent = () => container.dataset.tf2teFabricatorKey === requestKey && container.querySelector(`.${BLOCK_CLASS}`);

  let partsTotalValue = null;
  const partsTotalPromise = fetchMultiBuyTotal(multiBuyUrl)
    .then(({ formatted, value }) => {
      partsTotalValue = value;
      if (!stillCurrent()) return;
      button.textContent = `Buy Parts (${formatted})`;
    })
    .catch((e) => {
      console.warn("[TF2 Trading Enhancer] fabricatorMultiBuy: couldn't fetch the multibuy page's own total cost", e);
      if (!stillCurrent()) return;
      button.textContent = "Buy Parts (price unavailable)";
    });

  let kitValueResult = null;
  const kitValuePromise = fetchEstimatedKitValue(kitMarketUrl)
    .then((result) => {
      kitValueResult = result;
      if (!stillCurrent()) return;
      estimateEl.textContent = `${KIT_VALUE_LABEL}: ${result.estimatedNetFormatted}`;
      estimateEl.title = `Highest buy order ${result.orderBook.highestBuyOrder.formatted}, minus Steam's ~15% marketplace fee`;
      orderBookBuyEl.textContent = result.orderBook.highestBuyOrder.formatted;
      showLowestSell(orderBookSellEl, result.orderBook, kitName, stillCurrent);
    })
    .catch((e) => {
      // e.noBuyOrders doesn't warn - a real, legitimate empty order book
      // (fetchListingOrderBook only throws on a genuine HTTP/response
      // failure, never for "nothing found in the text" - see its own
      // note), not a parsing/fetch problem.
      if (!e.noBuyOrders) {
        console.warn("[TF2 Trading Enhancer] fabricatorMultiBuy: couldn't fetch the finished Kit's own order book", e);
      }
      if (!stillCurrent()) return;

      estimateEl.textContent = `${KIT_VALUE_LABEL}: ${e.noBuyOrders ? "no buy orders yet" : "unavailable"}`;
      // e.noBuyOrders carries the partial order book along (see
      // fetchEstimatedKitValue's own note) - the sell side is independent of
      // whether a buy order exists, so it can still be shown even here,
      // rather than blanking both halves just because the buy side was
      // empty. A genuine fetch failure (no e.orderBook at all) shows
      // "unavailable" on both instead - "None" would claim there are no buy
      // orders when the lookup simply failed.
      orderBookBuyEl.textContent = e.orderBook ? "None" : "unavailable";
      if (e.orderBook) showLowestSell(orderBookSellEl, e.orderBook, kitName, stillCurrent);
      else orderBookSellEl.textContent = "unavailable";
    });

  await Promise.allSettled([partsTotalPromise, kitValuePromise]);
  if (stillCurrent()) applyProfitLossHeadline(headlineEl, partsTotalValue, kitValueResult);
}
