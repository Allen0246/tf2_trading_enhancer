/*
@description: Adds the same outbound quick-link row this codebase already
builds everywhere else (backpack.tf, next.backpack.tf, gladiator.tf,
pricedb.io, posts.tf, stntrading.eu, marketplace.tf, Steam Market) onto
mannco.store's own item detail page (/item/{appid}-{slug}), appended right
after the page's own "Description" line inside its existing "Item Details"
card, settled after a design discussion: appending into the existing card
rather than building a new one, same reasoning already settled on for
../../marketplace.tf/itemQuickLinks/content.js's own placement (secondary
"check elsewhere" navigation belongs grouped with "everything about this
item", not competing for attention with the page's own primary purchase CTA
in the separate "Lowest price"/"Add to cart" card, and a brand-new card
risks not matching mannco.store's own card chrome without ever having
confirmed it live).

Deliberately does NOT include mannco.store itself - this page IS
mannco.store, same reasoning ../../marketplace.tf/itemQuickLinks/content.js's
own header note documents for that site.

Identity is read straight off the card's own labeled Quality/Craftable rows
(confirmed live:
`<dl class="description-list"><dt class="description-list__label">Quality</dt>
<dd class="description-list__value ...">Unique</dd></dl>`, same shape for
Craftable/SKU/Type/Total available) and its own ".item-details__title" (usually
the bare item name, "Max's Severed Head" - no quality/craft prefix baked in,
though a Haunted item's title does start with "Haunted", see buildItemNameRaw;
unlike ../../marketplace.tf/itemQuickLinks/content.js's own .item-title,
which needed a native link's own query params to recover the bare name
instead) - the cleanest identity source of any port of this feature so far,
no scraping/reconstruction needed at all.

Buttons styled with mannco.store's own native ".btn.btn-secondary.btn-sm"
Bootstrap classes (confirmed live on the page's own "Inspect in game"
button) rather than this codebase's usual dark custom look, same "blend
into the native page" approach ../../marketplace.tf/itemQuickLinks/content.js's
own header note documents.

Scope for now, per this codebase's own established "ship what's confirmed,
expand later" convention: Killstreak tier/Unusual effect/Paint/Spell aren't
read here - no live example of any of those attribute rows was seen (the
one confirmed example is a plain Unique cosmetic with none of them), so
knownEffectName/knownKillstreakTier are never passed to
resolveStatsAndClassifieds. Decorated Weapons/War Paint tools/Killstreak
Kits/Fabricators/target-item tools also aren't specifically handled - the
plain-item shape this was built and tested against covers the common case.
*/

import {
  resolveStatsAndClassifieds,
  createSteamMarketLink,
  isUnusualEffectIdUnresolved,
  isPostsTfUnresolved,
  stripStarMarker,
  buildStnTradingHref,
  buildPricedbSearchName,
  buildGladiatorHref,
} from "../../utils/tf2StatsLinks/index.js";
import { searchPricedbSkuStatus } from "../../utils/pricedb.js";
import { hasSteamApiKey } from "../../utils/tf2Schema.js";
import {
  applyApiKeyHint,
  applyLoadingState,
  fillPricedbSlot,
  POSTS_TF_KEY_HINT_TITLE,
  STATS_KEY_HINT_LABEL,
  STATS_KEY_HINT_TITLE,
} from "../../utils/linkButtonStates.js";

const ROW_CLASS = "tf2te-mannco-quick-links-row";
const STYLE_ID = "tf2te-mannco-quick-links-style";
const BUTTON_CLASS = "tf2te-mannco-quick-link-button";
const PAIR_CLASS = "tf2te-mannco-quick-link-pair";
const CLASSIFIEDS_ICON_CLASS = "tf2te-mannco-quick-link-classifieds";
const CARD_SELECTOR = ".item-details";
const TITLE_SELECTOR = ".item-details__title";
const DESCRIPTION_SELECTOR = ".item-details__description";
const DESCRIPTION_LIST_SELECTOR = ".description-list";
const LABEL_SELECTOR = ".description-list__label";
const VALUE_SELECTOR = ".description-list__value";

function ensureStyleInjected() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .${ROW_CLASS} {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 12px;
      padding: 12px;
      border-top: 1px solid rgba(255, 255, 255, 0.1);
    }
    /* mannco.store's own "btn-secondary" (kept for the native button shape)
       renders as faint grey text on a near-transparent ground on this page -
       reported live as barely readable. Explicit colors here instead; two
       classes so this outranks Bootstrap's single-class rules. The key-hint
       and countdown states (utils/linkButtonStates.js) dim themselves
       inline on top of this. */
    .${ROW_CLASS} .${BUTTON_CLASS} {
      color: #e6edf3;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.2);
      font-weight: 600;
    }
    .${ROW_CLASS} .${BUTTON_CLASS}:hover {
      color: #ffffff;
      background: rgba(255, 255, 255, 0.1);
      border-color: rgba(255, 255, 255, 0.35);
    }
    /* A stats button and its 📰 classifieds button drawn as one split
       button: the inner corners are squared and the
       two share a single, softer divider. */
    .${ROW_CLASS} .${PAIR_CLASS} {
      display: inline-flex;
    }
    .${ROW_CLASS} .${PAIR_CLASS} > .${BUTTON_CLASS}:first-child {
      border-top-right-radius: 0;
      border-bottom-right-radius: 0;
    }
    .${ROW_CLASS} .${PAIR_CLASS} > .${CLASSIFIEDS_ICON_CLASS} {
      margin-left: -1px;
      padding-left: 9px;
      padding-right: 9px;
      border-top-left-radius: 0;
      border-bottom-left-radius: 0;
      border-left-color: rgba(255, 255, 255, 0.12);
    }
  `;
  document.head.appendChild(style);
}

/*
@description: Finds the "Label" / "Value" description-list row this card's
own Quality/Craftable/SKU/Type/Total-available rows all share, returning the
value text for the given label - null if that label isn't present at all
(markup changed, or this item type doesn't carry it - don't guess).
*/
function findLabeledValue(card, labelText) {
  const rows = card.querySelectorAll(DESCRIPTION_LIST_SELECTOR);
  for (const dl of rows) {
    const label = (dl.querySelector(LABEL_SELECTOR)?.textContent || "").trim();
    if (label === labelText) {
      return (dl.querySelector(VALUE_SELECTOR)?.textContent || "").trim();
    }
  }
  return null;
}

/*
@description: Reads the item's identity straight off the card's own labeled
rows and title - see this file's own header note on why this needs no
scraping/reconstruction the way every other port of this feature does.
Returns null when the title or Quality row aren't found - markup changed,
don't guess.
*/
function resolveIdentity(card) {
  const itemName = card.querySelector(TITLE_SELECTOR)?.textContent?.trim();
  if (!itemName) return null;

  const qualityName = findLabeledValue(card, "Quality");
  if (!qualityName) return null;

  const isNonCraftable = findLabeledValue(card, "Craftable") === "No";

  return { itemName, qualityName, isNonCraftable };
}

function startsWithWord(text, word) {
  return text.toLowerCase().startsWith(`${word.toLowerCase()} `);
}

// Same reconstruction every other port of this feature in this codebase
// documents - qualityName is already real display text here (not a numeric
// id needing a lookup table, unlike every other port), so it's used
// directly. Some titles already carry the quality (seen live: "Haunted
// Voodoo-Cursed Engineer Soul" for a Haunted item), so a prefix the title
// already starts with isn't added again.
function buildItemNameRaw(itemName, qualityName, isNonCraftable) {
  const craftPrefix = isNonCraftable && !startsWithWord(itemName, "Non-Craftable") ? "Non-Craftable " : "";
  const hasQualityPrefix = qualityName && qualityName !== "Unique" && !startsWithWord(itemName, qualityName);
  const qualityPrefix = hasQualityPrefix ? `${qualityName} ` : "";
  return `${craftPrefix}${qualityPrefix}${itemName}`;
}

function buildQuickLinkButton(label, href) {
  const link = document.createElement("a");
  link.href = href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.className = `btn btn-secondary btn-sm ${BUTTON_CLASS}`;
  link.textContent = label;
  return link;
}

/*
@description: A stats button joined to its site's classifieds search, as one
split button: "{site}" opens stats, the 📰 half opens classifieds (the same
📰 the Steam inventory, stntrading.eu and scrap.tf use for classifieds).
*/
function buildStatsClassifiedsPair(label, statsHref, classifiedsHref) {
  const pair = document.createElement("span");
  pair.className = PAIR_CLASS;
  pair.appendChild(buildQuickLinkButton(label, statsHref));

  const classifieds = buildQuickLinkButton("📰", classifiedsHref);
  classifieds.classList.add(CLASSIFIEDS_ICON_CLASS);
  classifieds.title = `${label} classifieds`;
  classifieds.setAttribute("aria-label", `${label} classifieds`);
  pair.appendChild(classifieds);
  return pair;
}

/*
@description: One row entry as an element: a real link, a stats + classifieds
split button, or a non-link state from utils/linkButtonStates.js - the key
hint (keyHintTitle) or pricedb.io's loading slot (loading), which
fillPricedbSlot settles later. A plain span without Bootstrap's "disabled"
class, whose pointer-events: none would also block the hover text and the
key hint's click.
*/
function buildRowButton({ label, href, classifiedsHref, keyHintTitle, loading }) {
  if (href && classifiedsHref) return buildStatsClassifiedsPair(label, href, classifiedsHref);
  if (href) return buildQuickLinkButton(label, href);
  const span = document.createElement("span");
  span.className = `btn btn-secondary btn-sm ${BUTTON_CLASS}`;
  if (keyHintTitle) {
    applyApiKeyHint(span, { label, title: keyHintTitle });
  } else if (loading) {
    applyLoadingState(span, label);
  } else {
    span.textContent = label;
  }
  return span;
}

/*
@description: Resolves and (re)builds the quick-links row for the current
item. Signature is the current page URL - re-checked after each await
below, same "a fast in-app navigation shouldn't let a slower earlier
resolve land after a newer one" race-guard every other quick-links feature
in this codebase already uses.
*/
async function addQuickLinksRow() {
  // Checked here on every scan, not once by the router: mannco.store opens
  // items in-app (no real page load), so a router check frozen at the first
  // page left the row missing until a refresh (seen live).
  if (!isTf2ItemPage(window.location.href)) {
    document.querySelectorAll(`.${ROW_CLASS}`).forEach((el) => el.remove());
    return;
  }

  const card = document.querySelector(CARD_SELECTOR);
  if (!card) return;

  const descriptionEl = card.querySelector(DESCRIPTION_SELECTOR);
  if (!descriptionEl) return; // no confirmed insertion point - don't guess one

  const signature = window.location.href;
  // Critically, this ALSO requires the row to still actually be present in
  // the DOM, not just the signature to match - mannco.store's own Vue app
  // re-renders this card's inner content on its own without touching the
  // outer ".item-details" node itself, so the dataset marker survives that
  // wipe even though the row it refers to is gone. Comparing the marker
  // ALONE would then permanently skip rebuilding it - same fix
  // steamcommunity.com/itemQuickLinks/content.js's own header note
  // documents for the identical "buttons sometimes just don't show up" bug
  // there.
  if (card.dataset.tf2teQuickLinksSignature === signature && document.querySelector(`.${ROW_CLASS}`)) return;
  card.dataset.tf2teQuickLinksSignature = signature;

  const identity = resolveIdentity(card);
  if (!identity) return;

  const { itemName, qualityName, isNonCraftable } = identity;
  // An Unusual's card title is "{Effect} ★ Unusual {Item}" (seen live), so
  // the star (and the then-doubled "Unusual") is cleaned out here too, for
  // the buttons built from this name directly (gladiator.tf, Steam Market).
  const itemNameRaw = stripStarMarker(buildItemNameRaw(itemName, qualityName, isNonCraftable));

  const resolved = await resolveStatsAndClassifieds(itemNameRaw);
  if (window.location.href !== signature) return;

  // pricedb.io names an Unusual "{Effect} {Item}" (see buildPricedbSearchName).
  const pricedbQueryName = buildPricedbSearchName(itemNameRaw, resolved.classifiedsFilters);
  const hasKey = await hasSteamApiKey();
  if (window.location.href !== signature) return;

  ensureStyleInjected();
  document.querySelectorAll(`.${ROW_CLASS}`).forEach((el) => el.remove());

  const unusualEffectIdUnresolved = isUnusualEffectIdUnresolved(resolved.classifiedsFilters);

  // Links that only a missing Steam Web API key blocks get the key hint
  // (utils/linkButtonStates.js); the stats prompt also covers posts.tf, so
  // posts.tf gets no hint of its own then. With a key saved, an unresolved
  // link is just left out, since a key wouldn't help.
  const statsNeedKey = (resolved.statsUnresolved || unusualEffectIdUnresolved) && !hasKey;

  const buttons = [];
  if (statsNeedKey) buttons.push({ label: STATS_KEY_HINT_LABEL, keyHintTitle: STATS_KEY_HINT_TITLE });
  if (resolved.bpStatsHref && !unusualEffectIdUnresolved) {
    buttons.push({ label: "backpack.tf", href: resolved.bpStatsHref, classifiedsHref: resolved.classifiedsHref });
  }
  if (resolved.nextBpStatsHref && !unusualEffectIdUnresolved) {
    buttons.push({ label: "next.backpack.tf", href: resolved.nextBpStatsHref, classifiedsHref: resolved.nextClassifiedsHref });
  }
  buttons.push({ label: "gladiator.tf", href: buildGladiatorHref(itemNameRaw) });
  // pricedb.io's own lookup (up to a few requests) doesn't hold the whole
  // row back: its slot shows a loading state and settles once it answers.
  buttons.push({ label: "pricedb.io", loading: true });
  if (resolved.postsTfHref) {
    buttons.push({ label: "posts.tf", href: resolved.postsTfHref });
  } else if (!hasKey && !statsNeedKey && isPostsTfUnresolved(resolved.classifiedsFilters, resolved.postsTfHref)) {
    buttons.push({ label: "posts.tf", keyHintTitle: POSTS_TF_KEY_HINT_TITLE });
  }
  buttons.push({ label: "stntrading.eu", href: buildStnTradingHref(itemNameRaw, resolved.classifiedsFilters) });
  if (resolved.marketplaceHref) buttons.push({ label: "marketplace.tf", href: resolved.marketplaceHref });
  if (resolved.classifiedsFilters) buttons.push({ label: "Steam Market", href: createSteamMarketLink(itemNameRaw, resolved.classifiedsFilters) });
  if (buttons.length === 0) return;

  const row = document.createElement("div");
  row.className = ROW_CLASS;
  let pricedbSlot = null;
  buttons.forEach((entry) => {
    const el = buildRowButton(entry);
    if (entry.loading) pricedbSlot = el;
    row.appendChild(el);
  });

  // The card/description element may have been re-rendered while the above
  // was in flight - re-find them fresh rather than trusting the references
  // captured before the first await.
  const freshDescriptionEl = document.querySelector(CARD_SELECTOR)?.querySelector(DESCRIPTION_SELECTOR) || descriptionEl;
  freshDescriptionEl.insertAdjacentElement("afterend", row);

  fillPricedbSlot(pricedbSlot, {
    lookup: () => searchPricedbSkuStatus(pricedbQueryName),
    buildLink: (href) => buildQuickLinkButton("pricedb.io", href),
    isCurrent: () => window.location.href === signature && row.isConnected,
  });
}

// An item detail page's path is "/item/{appid}-{slug}" (confirmed live, e.g.
// "/item/440-maxs-severed-head"); 440 keeps it to TF2 items.
export function isTf2ItemPage(href) {
  return /^\/item\/440-/.test(new URL(href).pathname);
}

// Forgets the current item's signature so addQuickLinksRow resolves afresh.
function rebuildRow() {
  const card = document.querySelector(CARD_SELECTOR);
  if (card) delete card.dataset.tf2teQuickLinksSignature;
  addQuickLinksRow();
}

export function itemQuickLinks() {
  addQuickLinksRow();

  const observer = new MutationObserver(() => addQuickLinksRow());
  observer.observe(document.body, { childList: true, subtree: true });

  // A key saved in the popup turns key-hint buttons into real links without
  // a reload (the schema download happens inside the rebuild's resolve).
  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area === "local" && "steamApiKey" in changes) rebuildRow();
  });
}
