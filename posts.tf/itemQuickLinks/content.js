/*
@description: Adds the same outbound quick-link row this codebase already
builds everywhere else (next.backpack.tf, gladiator.tf, pricedb.io,
stntrading.eu, marketplace.tf, mannco.store, Steam Market) onto posts.tf's
own item-detail modal - the popup shown when clicking an item icon inside
any trade post on posts.tf's own board (confirmed live: a Vue
"vue-js-modal" instance, `<div class="vm--modal">...<div
class="post-item-modal">...</div></div>`, appended somewhere under
document.body, not tied to any one specific pathname - posts.tf's board,
individual post pages, etc. all show it the same way).

Deliberately does NOT include posts.tf itself - this page IS posts.tf, same
reasoning every other "don't link to the site you're already on" port in this
codebase already follows (mannco.store/marketplace.tf's own item pages). Also
deliberately does NOT include a classic "backpack.tf" button, posts.tf's own
native action row already has one of its own (see ACTION_ROW_SELECTOR's own
note) - and unlike every other "single next.backpack.tf button" port in this
codebase (which links to that site's STATS page), this one links to its
CLASSIFIEDS search instead.

Identity is read straight off the modal's own confirmed-live markup:
- The item's raw display name: `<h5 ...>Winning Spirit Taunt: Soldier's
  Requiem</h5>` (quality word NOT baked in - unlike Steam's own
  market_hash_name, this is display text only. A Taunt's own "Taunt: "
  prefix already IS part of it, same as everywhere else in this codebase).
- Quality, as its own separate labeled row: `<strong>Quality</strong><span
  style="color: rgb(134, 80, 172);">Unusual</span>` (a `<strong>`/`<span>`
  pair, not the "Label: value" single-text-node convention every OTHER site
  in this codebase happens to use for the same kind of row - needs its own
  reader).
- An Unusual's own numeric particle/effect id, straight off the modal's own
  background-image URL for the item's effect preview: `background:
  url("https://posts.tf/api/schema/image/effect/3142")` - no TF2 schema
  lookup (and so no Steam Web API key) needed at all to get the EXACT id,
  unlike every other site in this codebase, which can only ever recover an
  Unusual's plain effect NAME from the page and needs the schema to resolve
  the id from it.

Scope for now, per this codebase's own established "ship what's confirmed,
expand later" convention: Sheen and Killstreaker are read off their own
labeled rows (see findLabeledRowValue), but no live example of a Paint or
Halloween Spell row has been seen, so knownSpellName/knownPaintName are never
resolved here and a painted/spelled item's classifieds/marketplace.tf/
mannco.store links aren't filtered by those (same "unknown -> omitted"
graceful degradation every other port of this feature already has for its
own unconfirmed attributes). Decorated
Weapons/War Paint tools/Killstreak Kits/Fabricators/Strangifiers also aren't
specifically handled yet - no confirmed-live example of any of those on this
page. Craftability isn't read either - no confirmed-live Non-Craftable
example was seen (the one confirmed item, a Taunt, has no visible craft
indicator anywhere in the modal), so every item is currently treated as
Craftable regardless of its real craftability - a known gap, not a guess.

findEffectId's own numeric id alone is NOT enough for a fully correct link
everywhere - confirmed live twice (a real "Smoking Gentleman's Ushanka",
particle id 35, and a real "Arachne's Web Mean Captain", particle id 305 -
the second one's own raw <h5> title BAKES the effect name directly into it,
with no delimiter separating it from the base item name at all, e.g.
"Arachne's Web" + "Mean Captain" - there's no way to tell from the text alone
where that split falls, only a reference list of known effect names can
confirm it): gladiator.tf's own search, pricedb.io's own /api/search, AND
Steam Market's own market_hash_name all need the plain effect NAME text, not
just the id (pricedb.io's own search silently returns zero results for a
query that still has the literal "Unusual" word in it - same confirmed-live
gap stntrading.eu/link2Backpack/content.js's own note already documents
there; Steam Market's own name needs the effect name specifically STRIPPED
back out of a title like "Arachne's Web Mean Captain", which is impossible
without first knowing what that name is). bp.tf/next.bp.tf's own
stats/classifieds links are the only ones that work from the id alone.

So the id is reverse-resolved to its name via a two-tier lookup, tried in
order, BEFORE calling resolveStatsAndClassifieds: 1.
utils/unusualEffectIds.js's own getUnusualEffectNameById - a plain static
table lookup (the SAME data steamcommunity.com/tradeOffer/unusualEffects.js
already bundles for a different page, duplicated here as a plain ES module
export), NOT a TF2-schema fetch, so this needs no Steam Web API key at all
and resolves instantly for any effect it covers - matching this whole
feature's own "no key needed" design goal for the common case. 2.
utils/tf2Schema.js's own getEffectNameById, tried ONLY when step 1 comes back
null. The static table is only refreshed when
scripts/updateUnusualEffects.js is re-run, so effects added by a newer TF2
update are missing from it until then. Needs a configured Steam Web API key to
work at all (same cost/gap every other schema-backed lookup in this codebase
has), so this second tier only ever helps a user who HAS one - a user
without a key still gets the static-table coverage.

Reactivity: NOT confirmed live whether vue-js-modal tears this modal down and
rebuilds a fresh DOM tree every time it's shown (like classic backpack.tf's
own Bootstrap popover) or reuses/patches a single persistent instance across
successive opens (like next.backpack.tf's own tooltip) - chosen to be safe
either way via a content-signature dataset marker on the modal root (same
mechanism next.backpack.tf's own buttons already use for exactly this
uncertainty), rather than a plain boolean flag that could get stuck showing a
PREVIOUS item's buttons if the DOM node turns out to be reused.
*/

import {
  resolveStatsAndClassifieds,
  createSteamMarketLink,
  isUnusualEffectIdUnresolved,
  buildTargetToolFullName,
  attributeNameForId,
  SHEEN_IDS,
  KILLSTREAKER_IDS,
  buildStnTradingHref,
  buildGladiatorHref,
} from "../../utils/tf2StatsLinks/index.js";
import { searchPricedbSkuStatus } from "../../utils/pricedb.js";
import { getUnusualEffectNameById } from "../../utils/unusualEffectIds.js";
import { getEffectNameById, hasSteamApiKey } from "../../utils/tf2Schema.js";
import { applyApiKeyHint, applyLoadingState, fillPricedbSlot } from "../../utils/linkButtonStates.js";

const ROW_CLASS = "tf2te-posts-tf-quick-links-row";
const STYLE_ID = "tf2te-posts-tf-quick-links-style";
const BUTTON_CLASS = "tf2te-posts-tf-quick-link-button";

// Confirmed live: "<div class="post-item-modal text-light text-center
// p-3">...</div>" - the inner content div vue-js-modal's own outer
// ".vm--modal" wrapper carries. Scanning for THIS (not ".vm--modal" itself)
// means a modal for a non-TF2 game (if posts.tf ever supports one) simply
// won't match should its own inner markup differ - not confirmed either way,
// but a safer default than assuming every ".vm--modal" on the page is ours.
const MODAL_SELECTOR = ".post-item-modal";
// Confirmed live: the item's own name heading, always the modal's first
// <h5> - no more specific class of its own to key off.
const TITLE_SELECTOR = "h5";
// Confirmed live: "<div class="mt-3 d-flex justify-content-center
// align-items-center">" - the modal's own native action-button row (backpack.tf/
// Steam Market/Steam Inventory/backpack.tf item history icons), the last
// child of ".post-item-modal". Our own row is appended right after it.
const ACTION_ROW_SELECTOR = ".mt-3.d-flex.justify-content-center.align-items-center";
// Confirmed live: "background: url(&quot;https://posts.tf/api/schema/image/
// effect/3142&quot;) center center no-repeat;" - only present for an Unusual.
const EFFECT_IMAGE_ID_PATTERN = /\/api\/schema\/image\/effect\/(\d+)/;

function ensureStyleInjected() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .${ROW_CLASS} {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 6px;
      margin-top: 14px;
      padding-top: 14px;
      /* Sitting directly under the modal's own native
         circular icon-button row with only 10px of margin read as two
         unrelated UI fragments stacked together, not one coherent block -
         same divider trick mannco.store's own itemQuickLinks row already
         uses for the identical "separate this from the native page's own
         content above it" purpose. */
      border-top: 1px solid rgba(255, 255, 255, 0.1);
    }
    .${BUTTON_CLASS} {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 5px 10px;
      border-radius: 6px;
      text-decoration: none;
      /* Noticeably lighter than the modal's near-black background, with a
         visible border, so it reads as clickable like the native icon
         buttons above (which use a lighter grey fill) while still fitting
         the page's dark theme. */
      background: #35302d;
      color: #ffffff;
      font-weight: 600;
      font-size: 11px;
      border: 1px solid rgba(255, 255, 255, 0.22);
      transition: 0.15s ease;
    }
    .${BUTTON_CLASS}:hover {
      filter: brightness(1.25);
    }
  `;
  document.head.appendChild(style);
}

/*
@description: Reads the item's raw display name off the modal's own <h5> -
null if not found (markup changed, don't guess).
*/
function findItemName(modal) {
  const text = modal.querySelector(TITLE_SELECTOR)?.textContent;
  return text ? text.replace(/\s+/g, " ").trim() : null;
}

/*
@description: Reads the "Quality" row - confirmed live a `<strong>Quality</strong>`
sibling of a `<span>` holding the plain quality name text, NOT the "Label:
value" single-text-node shape every other site's own labeled-value reader in
this codebase expects (steamcommunity.com's own findLabeledValue among them),
so this needs its own reader rather than reusing one of those.
@returns the quality name (e.g. "Unusual"), or null if the row isn't found.
*/
function findQualityName(modal) {
  return findLabeledRowValue(modal, "Quality");
}

// One "<strong>{label}</strong><span>{value}</span>" row's value, or null.
// The same shape holds the Sheen and Killstreaker rows (confirmed live:
// "<strong>Sheen</strong><span>Agonizing Emerald</span>",
// "<strong>Killstreaker</strong><span>Incinerator</span>").
function findLabeledRowValue(modal, label) {
  for (const strong of modal.querySelectorAll("strong")) {
    if (strong.textContent.trim() !== label) continue;
    const span = strong.parentElement?.querySelector("span");
    const text = span?.textContent?.trim();
    if (text) return text;
  }
  return null;
}

/*
@description: Reads an Unusual's own EXACT numeric particle/effect id
straight off the modal's own effect-preview background-image URL - see this
file's own header note on why this needs no TF2 schema lookup (and so no
Steam Web API key) at all, unlike every other site in this codebase.
@returns the numeric id, or null if this item has no effect preview at all
(every non-Unusual item).
*/
function findEffectId(modal) {
  for (const el of modal.querySelectorAll('[style*="background"]')) {
    const match = EFFECT_IMAGE_ID_PATTERN.exec(el.getAttribute("style") || "");
    if (match) return Number(match[1]);
  }
  return null;
}

// Prepends the quality word unless it's the unmarked default ("Unique"),
// same exclusion utils/tf2StatsLinks/index.js's own buildSteamMarketName already
// applies for the same reason.
//
// This checks the raw title itself before prepending the quality word,
// rather than assuming the modal's own <h5> title never bakes it in, which
// would double the quality word (seen for Strange items).
//
// For a dual-quality item (Strange-tracking underneath an Unusual - the
// SAME "elevatedQuality" mechanic first surfaced by "Arachne's Web Mean
// Captain"), a stray "Strange " word baked into the <h5> title is dropped
// entirely rather than treated as part of the name, and never used to
// filter/search by Strange-tracking status at all (this codebase
// deliberately doesn't model that dual-quality aspect - see this file's own
// header note). See #6. See #7.
const STRANGE_PREFIX_PATTERN = /^strange\s+/i;

function stripBakedInStrangePrefix(name, qualityName) {
  return qualityName === "Unusual" && STRANGE_PREFIX_PATTERN.test(name) ? name.replace(STRANGE_PREFIX_PATTERN, "") : name;
}

function buildItemNameRaw(rawName, qualityName) {
  if (!qualityName || qualityName === "Unique") return rawName;
  const name = stripBakedInStrangePrefix(rawName, qualityName);
  const alreadyPrefixed = name.toLowerCase().startsWith(`${qualityName.toLowerCase()} `);
  return alreadyPrefixed ? name : `${qualityName} ${name}`;
}

// The name gladiator.tf is searched by. An Unusual uses "{Effect} {Item}"
// when the effect name is known, or just the already-"Unusual"-stripped
// filters.itemName when it isn't (which, for an item whose raw title
// already bakes the effect name in - like "Arachne's Web Mean Captain" -
// naturally still keeps it, since nothing had to be resolved to know it was
// there). Falls back to the untouched itemNameRaw only for a non-Unusual
// item, where there's no confirmed evidence either way that dropping the
// quality word would help (quality words aren't assumed to be safely
// droppable in general). See #38.
function gladiatorSearchName(itemNameRaw, filters) {
  if (filters?.quality !== "Unusual") return itemNameRaw;
  return filters.effectName ? `${filters.effectName} ${filters.itemName}` : filters.itemName;
}

// Same param table every other mannco.store button port in this codebase
// confirmed live.
const MANNSTORE_KILLSTREAK_PARAM_BY_TIER = {
  0: "No",
  1: "Killstreak",
  2: "Specialized Killstreak",
  3: "Professional Killstreak",
};

function buildMannStoreParams(filters, { knownEffectName, knownSheenName, knownKillstreakerName, knownPaintName } = {}) {
  const decorated = filters.decoratedWeapon;
  const itemName = decorated ? decorated.weaponName : filters.itemName;
  const qualityName = decorated ? (decorated.isUnusual ? "Unusual" : decorated.isStrange ? "Strange" : "Unique") : filters.quality;
  const killstreakTier = (decorated ? decorated.killstreakTier : filters.killstreakTier) ?? 0;
  const isFestivized = decorated ? false : !!filters.isFestivized;
  const isAustralium = decorated ? false : !!filters.isAustralium;
  const knownSkinName = decorated ? decorated.skinName : null;

  const params = new URLSearchParams();
  params.set("search", !knownSkinName && isAustralium ? `Australium ${itemName}` : itemName);
  if (qualityName) params.set("quality", qualityName);
  params.set("festivized", isFestivized ? "Festivized" : "No festivized");
  params.set("killstreak", MANNSTORE_KILLSTREAK_PARAM_BY_TIER[killstreakTier] ?? "No");
  params.set("warpaints", knownSkinName || "No WarPaints");
  if (knownSheenName) params.set("sheen", knownSheenName);
  if (knownKillstreakerName) params.set("killstreaker", knownKillstreakerName);
  // Never applied for an Unusual.
  if (knownPaintName && qualityName !== "Unusual") params.set("paint", knownPaintName);
  if (knownEffectName) params.set("effect", knownEffectName);

  return params;
}

// A target-item tool (a Strangifier, or a Strangifier Chemistry Set)
// searches mannco.store with just a bare "search" param - see
// buildTargetToolFullName.
function buildTargetToolMannStoreHref(filters) {
  const params = new URLSearchParams({ search: buildTargetToolFullName(filters.itemName, filters.targetItemName) });
  return `https://mannco.store/tf2?${params.toString()}`;
}

// null for the item-type shapes this hasn't been built for yet
// (fabricatorKit/killstreakKit/warPaintTool - no confirmed-live example of
// any of them on this page) - same scope gap every other port of this
// button in this codebase already documents for its own unconfirmed types.
function buildMannStoreHref(filters, knownSignals) {
  if (!filters || filters.fabricatorKit || filters.killstreakKit || filters.warPaintTool) return null;
  if (filters.targetItemName) return buildTargetToolMannStoreHref(filters);
  return `https://mannco.store/tf2?${buildMannStoreParams(filters, knownSignals).toString()}`;
}

function buildQuickLinkButton(label, href) {
  const link = document.createElement("a");
  link.href = href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.className = `${BUTTON_CLASS}`;
  link.textContent = label;
  return link;
}

/*
@description: The compact key button (utils/linkButtonStates.js) shown first
in the row when an Unusual's effect couldn't be identified for lack of a
Steam Web API key (see addQuickLinksRow's effectNameUnresolved note) -
without it, an item like "Strange Floral Growth Witch Doctor" quietly built
imprecise links with no indication why. Not a <span class="disabled">, whose
pointer-events: none would block the hover text and the click.
*/
const EFFECT_KEY_HINT_TITLE =
  "This item's effect couldn't be identified without a Steam Web API key, so next.backpack.tf is hidden and some links may be less precise. Click to add one (one-time setup).";

function buildEffectKeyHintButton() {
  const span = document.createElement("span");
  span.className = BUTTON_CLASS;
  applyApiKeyHint(span, { label: "Add Steam Web API key", title: EFFECT_KEY_HINT_TITLE });
  return span;
}

/*
@description: Resolves and (re)builds the quick-links row for whichever
item's modal is currently open. Signature is the modal's own raw name +
quality + effect id (not the current page URL - this modal isn't tied to
navigation at all, see this file's own header note) - re-checked after the
await below, same "a fast re-open of a different item shouldn't let a slower
earlier resolve land after a newer one" race-guard every other quick-links
feature in this codebase already uses.

pricedb.io's own lookup is fired off separately, AFTER the rest of the row
is already built and inserted, with its own slot in the shared loading
state (label + spinner) in the meantime, settled by utils/linkButtonStates.js's
fillPricedbSlot - the same non-blocking slot every other site's pricedb.io
button uses.
See #120.
*/
async function addQuickLinksRow(modal) {
  const itemName = findItemName(modal);
  if (!itemName) return;

  const qualityName = findQualityName(modal);
  if (!qualityName) return; // no confirmed identity signal - don't guess

  const effectId = findEffectId(modal);
  const knownSheenName = findLabeledRowValue(modal, "Sheen");
  const knownKillstreakerName = findLabeledRowValue(modal, "Killstreaker");

  // Sheen/Killstreaker included: two otherwise identical items can differ
  // only in those.
  const signature = [itemName, qualityName, effectId, knownSheenName, knownKillstreakerName].join("|");
  if (modal.dataset.tf2teQuickLinksSignature === signature && modal.querySelector(`.${ROW_CLASS}`)) return;
  modal.dataset.tf2teQuickLinksSignature = signature;

  const itemNameRaw = buildItemNameRaw(itemName, qualityName);

  // Two-tier reverse id->name lookup (see this file's own header note on
  // why the id alone isn't enough for gladiator.tf/pricedb.io/Steam Market,
  // and why BOTH tiers are needed - the static table alone has confirmed
  // gaps): the free, synchronous static table first, falling back to the
  // schema-backed (Steam Web API key needed) lookup only when the static
  // table doesn't have this specific id.
  let effectName = effectId != null ? getUnusualEffectNameById(effectId) : null;
  if (effectId != null && !effectName) {
    effectName = await getEffectNameById(effectId);
    if (modal.dataset.tf2teQuickLinksSignature !== signature || !modal.isConnected) return;
  }

  // The resolver drops Sheen/Killstreaker itself when the user switched that
  // filtering off in the popup.
  const resolved = await resolveStatsAndClassifieds(itemNameRaw, {
    knownEffectId: effectId,
    knownEffectName: effectName,
    knownSheenName,
    knownKillstreakerName,
  });
  const hasKey = await hasSteamApiKey();
  if (modal.dataset.tf2teQuickLinksSignature !== signature || !modal.isConnected) return;

  ensureStyleInjected();
  modal.querySelectorAll(`.${ROW_CLASS}`).forEach((el) => el.remove());

  const unusualEffectIdUnresolved = isUnusualEffectIdUnresolved(resolved.classifiedsFilters);

  // No classic "backpack.tf" button - posts.tf's own native action row
  // already has one (the bare, icon-only "post-action-bptf" button, first
  // among its 4 native icons), so ours would just be a redundant
  // duplicate. next.backpack.tf has no native equivalent, so it stays.
  //
  // Links to next.backpack.tf's own CLASSIFIEDS search (nextClassifiedsHref)
  // rather than its stats page (nextBpStatsHref) - a deliberate
  // deviation from every other "single next.backpack.tf button" port in this
  // codebase (Steam inventory, mannco.store, stntrading.eu all link to stats
  // there instead).
  const buttons = [];
  if (resolved.nextClassifiedsHref && !unusualEffectIdUnresolved) buttons.push(["next.backpack.tf", resolved.nextClassifiedsHref]);
  buttons.push(["gladiator.tf", buildGladiatorHref(gladiatorSearchName(itemNameRaw, resolved.classifiedsFilters))]);
  buttons.push(["stntrading.eu", buildStnTradingHref(itemNameRaw, resolved.classifiedsFilters)]);
  if (resolved.marketplaceHref) buttons.push(["marketplace.tf", resolved.marketplaceHref]);
  // Sheen/Killstreaker names from the resolved ids, which are null when
  // that filtering is switched off.
  const mannStoreHref = buildMannStoreHref(resolved.classifiedsFilters, {
    knownEffectName: resolved.classifiedsFilters?.effectName,
    knownSheenName: attributeNameForId(SHEEN_IDS, resolved.classifiedsFilters?.sheenId),
    knownKillstreakerName: attributeNameForId(KILLSTREAKER_IDS, resolved.classifiedsFilters?.killstreakerId),
  });
  if (mannStoreHref) buttons.push(["mannco.store", mannStoreHref]);
  if (resolved.classifiedsFilters) buttons.push(["Steam Market", createSteamMarketLink(itemNameRaw, resolved.classifiedsFilters)]);

  const row = document.createElement("div");
  row.className = ROW_CLASS;

  // pricedb.io's own slot goes right after gladiator.tf, matching this
  // row's original button order - built as a loading placeholder up front,
  // resolved in place afterward.
  const gladiatorIndex = buttons.findIndex(([label]) => label === "gladiator.tf");
  buttons.slice(0, gladiatorIndex + 1).forEach(([label, href]) => row.appendChild(buildQuickLinkButton(label, href)));
  // The shared loading state (label + spinner), same as every other site's
  // pricedb.io slot; not the "disabled" class, which would block its hover
  // text.
  const pricedbSlot = document.createElement("span");
  pricedbSlot.className = BUTTON_CLASS;
  applyLoadingState(pricedbSlot);
  row.appendChild(pricedbSlot);
  buttons.slice(gladiatorIndex + 1).forEach(([label, href]) => row.appendChild(buildQuickLinkButton(label, href)));

  // The modal may have been re-rendered while the above was in flight -
  // re-find the action row fresh rather than trusting a reference captured
  // before the first await.
  const actionRow = modal.querySelector(ACTION_ROW_SELECTOR);
  if (actionRow) {
    actionRow.insertAdjacentElement("afterend", row);
  } else {
    modal.appendChild(row); // no confirmed anchor - append at the end rather than dropping the row entirely
  }

  // Observed ("Strange Floral Growth Witch Doctor" with no Steam Web
  // API key configured): an Unusual whose effect name couldn't be resolved
  // by either lookup tier still silently built imprecise links with no
  // indication why. The key button goes first, where next.backpack.tf
  // (hidden for it) would be. Only without a saved key - with one, adding a
  // key wouldn't help.
  const effectNameUnresolved = qualityName === "Unusual" && effectId != null && !effectName;
  if (!hasKey && (effectNameUnresolved || unusualEffectIdUnresolved)) {
    row.prepend(buildEffectKeyHintButton());
  }

  // Falls back to classifiedsFilters' own already-"Unusual"-stripped bare
  // itemName (rather than the raw "Unusual {item}" text, which still has
  // pricedb.io's own broken word in it), only falling all the way back to
  // itemNameRaw when classifiedsFilters itself is unavailable (a genuine
  // resolve failure, not just a missing effect name) - see
  // resolveUnusualEffect's own baseName note for why that bare name is
  // always available regardless of whether the effect itself resolved. See #121.
  const filters = resolved.classifiedsFilters;
  const pricedbQueryName = filters?.effectName
    ? `${filters.effectName} ${filters.itemName}`
    : filters?.quality === "Unusual" && filters.itemName
      ? filters.itemName
      : itemNameRaw;
  fillPricedbSlot(pricedbSlot, {
    lookup: () => searchPricedbSkuStatus(pricedbQueryName),
    buildLink: (href) => buildQuickLinkButton("pricedb.io", href),
    // The item may have changed (a newer open) or the row been rebuilt.
    isCurrent: () => modal.dataset.tf2teQuickLinksSignature === signature,
  });
}

function scan() {
  document.querySelectorAll(MODAL_SELECTOR).forEach((modal) => addQuickLinksRow(modal));
}

export function itemQuickLinks() {
  scan();

  const observer = new MutationObserver(() => scan());
  observer.observe(document.body, { childList: true, subtree: true });

  // A key saved in the popup re-resolves an open modal's row without a
  // reopen (the key button goes away, the effect-based links sharpen).
  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area !== "local" || !("steamApiKey" in changes)) return;
    document.querySelectorAll(MODAL_SELECTOR).forEach((modal) => delete modal.dataset.tf2teQuickLinksSignature);
    scan();
  });
}
