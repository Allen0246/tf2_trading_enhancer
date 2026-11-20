/*
@description: next.backpack.tf's "Sell Orders"/"Buy Orders" trade-offer link
(the swap-arrows icon, class .listing__details__actions__action) only ever
carries ?partner=&token= - unlike classic backpack.tf, it's missing
listing_intent, for_item (on a sell listing, so the specific item gets
pre-added), and the listing_currencies_keys/listing_currencies_metal params
that pre-fill the requested payment - confirmed live against a real listing's
outerHTML, not assumed. This patches the anchor's href in place with those
params, computed from data already visible in the same row (price text, the
sell/buy indicator, and the item's own /classifieds/<appid>_<assetid> link).
The exact price itself comes from ./mainWorld.js when it can (see
readExactCurrencies below), since the row's visible text only carries a
rounded one.

Next.backpack.tf is a Vue SPA - listing rows render/re-render client-side
(pagination, live updates) well after this content script's initial run, so a
MutationObserver (not just a one-time querySelectorAll pass) is what actually
keeps every row patched.
*/

import { watchTradeLinkClicks } from "../../../utils/tradeLinkTrust.js";
import { parseListingPriceText } from "../../shared/listingPriceText.js";

// Confirmed live: a listing priced above ~1 key's worth displays its price
// (.item__price) as a single fractional keys figure (e.g. "1.16 keys"), not a
// "keys, ref" breakdown - steamcommunity.com/tradeOffer/pages/tradeoffer.js's
// own addListingPrice does `parseInt(urlParams.listing_currencies_keys)` (an
// integer key ITEM count is all that can actually be added to a trade), which
// silently drops the fractional part rather than converting it ("1.16" reads
// as 1) - the trade offer then only ever asks for the whole key, quietly short by
// the ref value the fractional remainder represented. patchAnchor's own
// exact-price paths below fix this exactly (Vue's own listing data via
// ./mainWorld.js, or backpack.tf's auto-generated listing comment). Without
// either, the visible (rounded) price is used as-is.

// Written onto each .listing row by ./mainWorld.js (page realm), see that
// file's header for why the exact price has to come from there.
const EXACT_CURRENCIES_ATTRIBUTE = "data-tf2te-currencies";

/*
@description: Reads the exact { keys, metal } price ./mainWorld.js copied out
of next.backpack.tf's own Vue data onto this anchor's .listing row. Trusted
only when the stored listing id matches the row's own /classifieds/<id> item
link (confirmed live, both sell and buy rows carry one), so an attribute left
over from a different listing Vue recycled this node for is never used. Returns
null when missing, stale, or unparseable, leaving the comment/badge paths in
charge.
*/
function readExactCurrencies(actionAnchor, itemLinkHref) {
  const raw = actionAnchor.closest(".listing")?.getAttribute(EXACT_CURRENCIES_ATTRIBUTE);
  if (!raw || !itemLinkHref) return null;

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed?.id || itemLinkHref !== `/classifieds/${parsed.id}`) return null;

  const keys = Number(parsed.keys) || 0;
  const metal = Number(parsed.metal) || 0;
  if (!keys && !metal) return null;

  return { keys, metal };
}

/*
@description: Patches one trade-offer anchor's href in place, if (and only
if) everything needed can actually be read from its row - a listing priced in
a currency this can't parse (e.g. a Marketplace.tf USD-mirrored listing with
no keys/ref at all) or with no recognizable sell/buy indicator is left
untouched rather than guessed at.
*/
/*
@description: Whether a price read from the listing's comment agrees with the
listing's shown price badge. The comment is free text its owner writes, so a
price there that disagrees with the badge (e.g. "Selling for 3 keys" on a
listing shown at 5 ref) must not be pre-filled into the trade. The badge
shows a pure-metal price as is, and anything worth a key or more as one
keys figure rounded to 2 decimals ("1.16 keys" for 1 key 10.44 ref, "2 keys"
for 1 key 64.88 ref), so the comment's whole keys must be the badge's whole
keys, or one fewer when the badge rounded up to a whole number.
@returns {boolean}
*/
function commentFitsBadge(comment, badge) {
  if (!badge.keys) return !comment.keys && Math.abs(comment.metal - badge.metal) < 0.01;
  return comment.keys >= Math.ceil(badge.keys) - 1 && comment.keys <= Math.floor(badge.keys);
}

function patchAnchor(actionAnchor) {
  // The row combines the item icon (with its price) and the listing details
  // (with this action anchor) as siblings - there's no single more specific
  // class name for the row itself in next.backpack.tf's markup, so this is
  // the closest reliably-shared ancestor (confirmed live against a real
  // listing row) - if row-scoping ever misfires, this selector is the first
  // thing to re-check against the current page's actual markup.
  const row = actionAnchor.closest(".d-flex.flex-row.flex-grow-1");
  if (!row) return;

  const priceEl = row.querySelector(".item__price");
  if (!priceEl) return;

  const { keys, metal } = parseListingPriceText(priceEl.textContent);
  if (!keys && !metal) return; // unparseable price - don't guess

  // .item__price (above) rounds any price worth more than ~1 key down to a
  // single fractional keys figure (e.g. "1.16 keys" for a true 1 key + 10.44
  // ref price) - confirmed live that .listing__details__comment instead
  // carries backpack.tf's own EXACT currency breakdown as plain text
  // ("Buying for 1 key 10.44 ref.") whenever the seller/buyer hasn't
  // overridden their listing's comment with custom text, since that's the
  // same auto-generated summary backpack.tf's own detail panel falls back to.
  // Gated on the "Buying for"/"Selling for" prefix (backpack.tf's own
  // auto-comment signature) rather than trusting any row with a parseable
  // number in its comment - a custom comment coincidentally containing a
  // number is far less likely to also start with that exact phrase. Preferred
  // over the badge whenever it parses to a non-zero price that fits the badge
  // (see commentFitsBadge).
  const commentEl = row.querySelector(".listing__details__comment");
  // .normalize("NFKD") first - confirmed live that sellers/bots commonly
  // write these comments in styled Unicode (mathematical bold, e.g. "𝟏 𝐤𝐞𝐲,
  // 𝟒𝟖.𝟔𝟔 𝐫𝐞𝐟") to stand out, which are entirely different code points from
  // plain "1 key, 48.66 ref" - neither pattern below (nor parseListingPriceText's
  // own \d-based ones) matches those glyphs at all without this.
  const commentText = commentEl ? commentEl.textContent.trim().normalize("NFKD") : "";
  // Matches backpack.tf's own auto-generated price phrase ANYWHERE in the
  // comment, not just at its very start. Confirmed live: a seller/bot
  // commonly keeps backpack.tf's own auto-summary embedded but adds branding
  // text around it - e.g. "⚡⇄ 24/7 Trading bot ⚡Auto-accept⚡Buying Taunt:
  // Peace! for 1 key 16.44 ref. Stock: 0/1⚡Send trade ⚡Item offer
  // welcome!!". Missing it would fall back to the live-key-price ESTIMATE
  // below, which can meaningfully differ from the real price (16.00 ref
  // estimated vs the seller's stated 16.44 ref for that listing).
  // "buying"/"selling" followed by "for <number> key(s)/ref" is a specific
  // enough anchor that an unrelated number elsewhere in a bot's own branding
  // text (e.g. "Stock: 0/1") can't be mistaken for the price - parseListingPriceText
  // below still only ever matches its own "keys?"/"ref" patterns against the
  // WHOLE comment, wherever the phrase starts.
  const isAutoGeneratedComment = /\b(?:buying|selling)\b.*?\bfor\s+[\d.]+\s*(?:keys?|ref)\b/i.test(commentText);

  // Second recognized shape, confirmed live: some bots use their OWN comment
  // template that states the exact price plainly up front instead of
  // backpack.tf's "Buying/Selling for X" phrasing above - e.g. "🔥 1 key,
  // 48.66 ref 📦 Stock : 0 / 1. 💬 Add me and send sell_Taunt_..." (real
  // listing, confirmed against next.backpack.tf's own tooltip price="1 key,
  // 48.66 ref" attribute). Anchored to the very START of the comment (only
  // leading whitespace/punctuation/symbols - emoji included, both fall under
  // \p{P}/\p{S} - stripped first) rather than matched anywhere, same
  // reasoning as the "for" anchor above: a genuinely custom comment that
  // happens to mention "N ref" deep inside unrelated text is far less likely
  // to ALSO open with a clean, bare price statement.
  const leadingCommentText = commentText.replace(/^[\s\p{S}\p{P}]+/u, "");
  const hasLeadingPriceStatement = /^\d+(?:\.\d+)?\s*(?:keys?|ref)\b/i.test(leadingCommentText);

  // Third recognized shape, confirmed live: "⚡COUNTER-OFFERS ENABLED⚡ 1 key
  // 22 ref. Stock: 0/1 [Send empty/overpay/underpay offers and I will
  // counter it with correct amount]❤️" - the price sits neither in a
  // "buying/selling for X" phrase NOR at the very start (branding text comes
  // first), so neither check above catches it either. Trusted whenever the
  // comment mentions BOTH a keys amount AND a ref amount anywhere at all -
  // deliberately NOT extended to a single lone currency mention (e.g. "need
  // 2 keys minimum, no lowballs" isn't a price statement at all, just a
  // number that happens to have "keys" next to it), but a comment stating
  // BOTH currencies together is a highly specific fingerprint of "this is
  // the actual price breakdown" that's implausible to appear by coincidence
  // in unrelated text - three different real bots have now used three
  // different phrasings for exactly this, every time genuinely the real
  // price (this one's own tooltip confirms "is buying for 1 key, 22 ref").
  const rawFromComment = parseListingPriceText(commentText);
  const hasBothCurrenciesMentioned = Boolean(rawFromComment.keys && rawFromComment.metal);

  const preciseFromComment = isAutoGeneratedComment
    ? rawFromComment
    : hasLeadingPriceStatement
      ? parseListingPriceText(leadingCommentText)
      : hasBothCurrenciesMentioned
        ? rawFromComment
        : null;
  const hasPreciseComment = Boolean(
    preciseFromComment && (preciseFromComment.keys || preciseFromComment.metal) && commentFitsBadge(preciseFromComment, { keys, metal })
  );

  const isSell = Boolean(row.querySelector(".text-sell"));
  const isBuy = Boolean(row.querySelector(".text-buy"));
  if (!isSell && !isBuy) return; // unknown listing type - don't guess intent

  const itemLinkHref = row.querySelector('a[href^="/classifieds/"]')?.getAttribute("href") || "";

  // Vue's own exact price wins over everything above: it's what backpack.tf
  // itself stores, so it works for any comment (custom ones included, where
  // the comment paths find nothing and only the rounded badge was left).
  const exact = readExactCurrencies(actionAnchor, itemLinkHref);
  const effectiveKeys = exact ? exact.keys : hasPreciseComment ? preciseFromComment.keys : keys;
  const effectiveMetal = exact ? exact.metal : hasPreciseComment ? preciseFromComment.metal : metal;

  // The listing's own item name, read straight off this same row's DOM
  // (.listing__details__header - the link text next to the sell/buy chevron
  // icon, e.g. "Mann Co. Supply Crate Key") - resolved here (rather than
  // just below, right before its own url.searchParams.set) so it can feed
  // into the content signature immediately below: it's one of the params
  // this function derives from the row and sets on the anchor (see
  // for_item_name below), same as isSell/keys/metal/itemLinkHref, so a
  // recycled row whose item NAME changed but whose price/intent/item link
  // happened not to (e.g. two same-priced buy orders, which have no
  // itemLinkHref of their own to tell them apart by) needs to be caught by
  // the signature too, not just silently left with a stale for_item_name.
  const headerEl = row.querySelector(".listing__details__header");
  const itemName = headerEl ? headerEl.textContent.replace(/\s+/g, " ").trim() : "";

  // Content signature, not a one-time boolean flag - next.backpack.tf's
  // classifieds grid is a Vue SPA, and if it ever recycles this same DOM node
  // for a DIFFERENT listing on sort/pagination (rather than replacing it
  // outright), a plain "already patched" flag would leave this anchor's href
  // silently stuck pointing at the previous listing's item/price/intent.
  // Re-derived and compared on every call instead, so a changed row re-patches.
  const signature = `${isSell ? "1" : "0"}|${effectiveKeys}|${effectiveMetal}|${itemLinkHref}|${itemName}`;
  if (actionAnchor.dataset.tf2teFixed === signature) return;
  actionAnchor.dataset.tf2teFixed = signature;

  const url = new URL(actionAnchor.href, window.location.href);
  // A recycled node can still carry THIS function's params from the previous
  // listing (Vue leaves href alone when the new listing's own href value is
  // the same, e.g. one trader's sell and buy orders), and the params below
  // are only set conditionally - so clear them first rather than letting a
  // previous listing's for_item or keys amount leak into this one.
  for (const param of ["listing_currencies_keys", "listing_currencies_metal", "for_item", "for_item_name"]) {
    url.searchParams.delete(param);
  }
  // Matches steamcommunity.com/tradeOffer/pages/tradeoffer.js's own
  // "0 = buy order, 1 = sell order" convention (addListingPrice/
  // addListingItem already rely on this exact meaning).
  url.searchParams.set("listing_intent", isSell ? "1" : "0");
  if (effectiveKeys) url.searchParams.set("listing_currencies_keys", String(effectiveKeys));
  if (effectiveMetal) url.searchParams.set("listing_currencies_metal", String(effectiveMetal));

  if (isSell) {
    // Only a sell listing names one specific item to pre-add - a buy order
    // has no particular asset tied to it (the other party would add
    // whichever of their own items fills it), same as classic backpack.tf's
    // own buyer-vs-seller link shapes.
    const match = itemLinkHref.match(/\/classifieds\/(\d+)_(\d+)/);

    if (match) {
      const [, appid, assetid] = match;
      // Context 2 is TF2's (and CS2's) inventory context - same assumption
      // steamcommunity.com/tradeOffer/pages/tradeoffer.js's showKeys/
      // showMetal already make for both appids.
      url.searchParams.set("for_item", `${appid}_2_${assetid}`);
    }
  }

  // itemName (resolved above, alongside the content signature) is set for
  // BOTH sell and buy listings, unlike for_item above. For a sell listing
  // it's smuggled through as a fallback so
  // steamcommunity.com/tradeOffer/pages/tradeoffer.js's addListingItem can
  // still add more of this item BY NAME even after this specific asset has
  // since been sold/traded away (for_item alone only ever carries an id,
  // never a name). For a BUY listing it's the only signal at all - there's
  // no specific asset to reference (see the isSell block above), so
  // tradeoffer.js instead uses this name to auto-add a matching item from
  // YOUR OWN inventory, since fulfilling a buy order means you're the one
  // selling.
  if (itemName) {
    url.searchParams.set("for_item_name", itemName);
  }

  actionAnchor.href = url.toString();
}

function patchAllVisible(root) {
  root.querySelectorAll(".listing__details__actions__action").forEach(patchAnchor);
}

// Only a listing row's own trade action that patchAnchor actually patched
// counts as a backpack.tf listing link (see utils/tradeLinkTrust.js).
// patchAnchor only marks an anchor once it found a real listing row around it.
function isListingTradeLink(anchor) {
  return Boolean(anchor.dataset.tf2teFixed && anchor.matches(".listing__details__actions__action"));
}

export function fixTradeOfferLinks() {
  patchAllVisible(document);
  watchTradeLinkClicks(isListingTradeLink);

  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      // ./mainWorld.js wrote or changed a row's exact price - re-patch that
      // row (the content signature skips it if nothing actually changed).
      if (mutation.type === "attributes") {
        patchAllVisible(mutation.target);
        return;
      }

      mutation.addedNodes.forEach((node) => {
        if (node.nodeType !== Node.ELEMENT_NODE) return;

        if (node.matches?.(".listing__details__actions__action")) {
          patchAnchor(node);
        } else {
          patchAllVisible(node);
        }
      });
    });
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [EXACT_CURRENCIES_ATTRIBUTE],
  });
}
