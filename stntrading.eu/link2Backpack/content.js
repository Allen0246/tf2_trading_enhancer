/*
@description: Augments an stntrading.eu item detail page (dispatched from
stntrading.eu/content.js on any /item/.../tf2/... page) with outbound link
buttons to the item's backpack.tf/next.backpack.tf stats+classifieds pages,
gladiator.tf, pricedb.io, posts.tf, marketplace.tf, mannco.store, and Steam
Market. Everything is inserted into the existing page rather than navigating
anywhere.
*/
import { QUALITY_ID_BY_NAME } from "../../utils/tf2Quality.js";
import { getCanonicalItemName, hasSteamApiKey } from "../../utils/tf2Schema.js";
import { searchPricedbSkuStatus } from "../../utils/pricedb.js";
import {
  applyApiKeyHint,
  applyLoadingState,
  fillPricedbSlot,
  POSTS_TF_KEY_HINT_TITLE,
  STATS_KEY_HINT_LABEL,
  STATS_KEY_HINT_TITLE,
} from "../../utils/linkButtonStates.js";
import {
  resolveStatsAndClassifieds,
  createSteamMarketLink,
  ITEMS_CRAFTABILITY,
  isUnusualEffectIdUnresolved,
  isPostsTfUnresolved,
  buildTargetToolFullName,
  buildPricedbSearchName,
  buildGladiatorHref,
} from "../../utils/tf2StatsLinks/index.js";

// Reactivity state (see link2Backpack's own note near where these are used
// below) - module-scoped rather than per-call, since the whole point is to
// survive across the single storage.onChanged listener's lifetime, which
// itself outlives any one call.
let currentWrapper = null;
let currentReactivityListener = null;

/**
 * Entry point: reads the item name off the page, builds the stats/
 * classifieds/marketplace/Steam Market button rows (see resolveStatsAndClassifieds)
 * and inserts them into the page - see insertLinks for where they land.
 */
export async function link2Backpack() {
  // The page renders a second, visually-hidden <h1> for mobile layouts before this one,
  // so querySelector("h1") alone would grab the wrong (invisible) element on desktop.
  const itemNameEl =
    document.querySelector(".d-none.d-sm-block h1") || document.querySelector("h1");

  if (!itemNameEl) {
    // page markup changed, or the router's URL check false-positived on a
    // page with no item title - bail instead of throwing
    return;
  }

  // textContent, not innerHTML - a title with nested markup (e.g. a
  // Decorated Weapon's styled quality span or skin icon) would otherwise put
  // literal HTML tags into this string and break every exact-text match
  // downstream (the stats/classifieds links, everything that parses
  // itemName as plain text).
  const rawItemName = itemNameEl.textContent.trim();
  wireUpCopyableName(itemNameEl, rawItemName);

  // stntrading.eu's own raw title text can capitalize a weapon's name wrong
  // (e.g. "Force-A-Nature" instead of the real "Force-a-Nature"), silently
  // 404ing every exact-case-sensitive link built from it (next.backpack.tf's
  // classifieds page specifically: ?itemName=Force-A-Nature 404s,
  // ?itemName=Force-a-Nature resolves).
  //
  // correctKnownItemNameCasing runs FIRST and unconditionally - it's a tiny
  // hardcoded table (these particular names never change) rather than the
  // Steam Web API key-gated schema lookup correctAustraliumCasing falls back
  // to, so a user with no key configured at all still gets the confirmed
  // case fixed. correctAustraliumCasing then still runs on top for any OTHER
  // Australium item not in that table, for a user who does have a key -
  // strictly additive, never undoes what the hardcoded pass already fixed.
  //
  // Corrected ONCE here, before anything downstream (stats/classifieds/
  // marketplace.tf/mannco.store/gladiator.tf/pricedb.io/Steam Market/Price
  // Scan) reads itemName, rather than patching each of those individually -
  // they all still just read a plain display-name string, so fixing it
  // here fixes all of them at once. The copy-to-clipboard name above
  // deliberately keeps the RAW text instead (wireUpCopyableName already ran)
  // - that copies exactly what's shown on the page, not a corrected variant. See #24.
  const itemName = await correctAustraliumCasing(correctKnownItemNameCasing(rawItemName));

  // Explicit rows rather than one flex-wrap group: next.backpack.tf on its
  // own top row, backpack.tf below it, gladiator.tf/pricedb.io/posts.tf
  // sharing a row below that, marketplace.tf/mannco.store sharing the row
  // below THAT, and Steam Market alone on its own final row - same row
  // grouping scrap.tf's own item card (scrap.tf/itemLinks/itemCard.js) and
  // steamcommunity.com/itemQuickLinks/content.js's own buildLinksBlock both
  // already establish for these same 6 buttons. A fixed layout instead of
  // leaving wrapping to whatever happens to fit.
  const linkGroup = document.createDocumentFragment();
  const nextRow = createButtonRow();
  const bpRow = createButtonRow();
  const communityRow = createButtonRow({ compact: true });
  const marketRow = createButtonRow({ compact: true });
  const steamMarketRow = createButtonRow();

  // The wrapper is inserted right away (empty at first) so a loading notice
  // can go up immediately while resolveStatsAndClassifieds resolves - for an
  // Unusual/Kit/Fabricator/Strangifier that's a real schema lookup (a cold
  // fetch, no cached copy less than a week old, walks every paginated
  // GetSchemaItems page plus one GetSchemaOverview call, which can take a
  // few seconds), and leaving the page blank that whole time looks identical
  // to the extension being broken. Shown unconditionally rather than only
  // for item types that need a schema lookup - resolveStatsAndClassifieds
  // dispatches on item type internally (see its own note on why each
  // type needs its own URL shape), so this file has no cheap way to predict
  // which branch it'll take without duplicating that dispatch; a plain item
  // or War Paint tool/Decorated Weapon just clears the notice a tick later.
  const wrapper = insertLinks(itemNameEl);
  wrapper.appendChild(createLoadingNotice());
  currentWrapper = wrapper;

  // Live reactivity - same "no reload needed" treatment
  // scrap.tf/itemLinks/content.js's own item card already establishes.
  // steamApiKey unlocks resolveStatsAndClassifieds' schema lookups generally
  // (Kits/Strangifiers/etc, not just Unusuals) and the exact effect id
  // bp.tf/next.bp.tf need (see unusualEffectIdUnresolved below). Simplest
  // correct option given how much of this function's own output can change
  // from that key (the pricedb.io query, the resolved effect id) is to just
  // remove the previous wrapper and re-run the whole function fresh, rather
  // than trying to surgically patch just the affected piece.
  //
  // The listener itself is re-registered (old one removed first) on every
  // call rather than installed once behind a module-level guard - this page
  // only ever calls link2Backpack() once per real page load in production,
  // so the distinction barely matters there, but a once-only guard would
  // leave every test after the first one in a suite unable to exercise this
  // at all (the module stays loaded for the whole test file, so a guard's
  // "already installed" state would silently persist across otherwise
  // independent test cases, each with their own fresh chrome.storage mock).
  if (currentReactivityListener) {
    chrome.storage.onChanged.removeListener(currentReactivityListener);
  }
  currentReactivityListener = (changes, areaName) => {
    if (areaName !== "local") return;
    if (!changes.steamApiKey) return;
    currentWrapper?.remove();
    link2Backpack();
  };
  chrome.storage.onChanged.addListener(currentReactivityListener);

  // stntrading.eu's own item page prints the effect name explicitly for an
  // Unusual ("★ Unusual Effect: Otherworldly Weather", confirmed live) -
  // passed through as knownEffectName so resolveUnusualEffect (via
  // resolveStatsAndClassifieds) doesn't need the Steam Web API schema just to
  // KNOW the name, only to look up its numeric id (see that function's own
  // note on the no-key fallback). Most Unusual-dependent buttons here
  // (marketplace.tf, mannco.store, pricedb.io) only need the name, so they
  // work without a Steam Web API key. null for a non-Unusual item (or if the label
  // isn't found for some reason) - resolveStatsAndClassifieds already treats a
  // null knownEffectName as "nothing known", same as omitting it entirely.
  const knownEffectName = findKnownUnusualEffectName();
  const statsResult = await resolveStatsAndClassifieds(itemName, { knownEffectName });
  const {
    bpStatsHref,
    nextBpStatsHref,
    classifiedsHref,
    nextClassifiedsHref,
    statsUnresolved,
    classifiedsFilters,
    marketplaceHref,
    postsTfHref,
  } = statsResult;

  // "{Effect Name} {Item Name}" for an Unusual, no "Unusual" word (see
  // buildPricedbSearchName). Has to run after
  // resolveStatsAndClassifieds, since an Unusual's query isn't known before
  // its effect name is resolved. See #56.
  const pricedbQueryName = buildPricedbSearchName(itemName, classifiedsFilters);
  const hasKey = await hasSteamApiKey();

  // bp.tf/next.bp.tf's own stats AND classifieds links both need the exact
  // numeric effect id to point at the SPECIFIC effect this item actually
  // has - see isUnusualEffectIdUnresolved's own note (utils/tf2StatsLinks/
  // index.js) for the full reasoning; shared with
  // steamcommunity.com/itemQuickLinks/content.js's own identical check.
  const unusualEffectIdUnresolved = isUnusualEffectIdUnresolved(classifiedsFilters);

  // Links that only a missing Steam Web API key blocks get the key hint
  // (utils/linkButtonStates.js): one stats/classifieds prompt where the
  // stats rows would be (it also covers posts.tf), or posts.tf's own. With
  // a key saved, an unresolved link is just left out, since a key wouldn't
  // help.
  const statsNeedKey = (statsUnresolved || unusualEffectIdUnresolved) && !hasKey;
  if (statsNeedKey) nextRow.appendChild(createKeyHintButton(STATS_KEY_HINT_LABEL, STATS_KEY_HINT_TITLE));

  // createStatsButtonGroup handles a missing statsHref on its own (renders
  // a standalone "classifieds" button instead of a paired icon) - no item
  // type currently resolves classifieds without stats, but the fallback
  // keeps such a case from rendering a bare, unlabeled icon.
  if ((nextBpStatsHref || nextClassifiedsHref) && !unusualEffectIdUnresolved) {
    nextRow.appendChild(createStatsButtonGroup("next.bp.tf", nextBpStatsHref, nextClassifiedsHref));
  }

  if ((bpStatsHref || classifiedsHref) && !unusualEffectIdUnresolved) {
    bpRow.appendChild(createStatsButtonGroup("bp.tf", bpStatsHref, classifiedsHref));
  }

  // gladiator.tf/pricedb.io/posts.tf, in their own row - gladiator.tf always
  // resolves (buildGladiatorHref is synchronous, given only a name),
  // pricedb.io/posts.tf are only appended when they actually resolved to
  // something (no "broken link" placeholder), same as every other optional
  // entry here. gladiator.tf names an Unusual "{Effect} {Item}" like
  // pricedb.io, so it searches the same pricedbQueryName, not stntrading.eu's
  // "Unusual {Effect} {Item}" title.
  const linkGladiator = createLinkButton("gladiator.tf", { compact: true });
  linkGladiator.href = buildGladiatorHref(pricedbQueryName);
  communityRow.appendChild(linkGladiator);

  // pricedb.io's own lookup (up to a few requests) doesn't hold every
  // button back: its slot shows a loading state and settles once it answers
  // (the link, the rate-limit countdown, or nothing) - see fillPricedbSlot
  // below, after the buttons are on the page.
  const pricedbSlot = createStateButton();
  applyLoadingState(pricedbSlot);
  communityRow.appendChild(pricedbSlot);

  // See isPostsTfUnresolved's own note (utils/tf2StatsLinks/index.js) for the
  // full reasoning - shared with steamcommunity.com/itemQuickLinks/content.js's
  // own identical check now.
  const postsTfUnresolved = isPostsTfUnresolved(classifiedsFilters, postsTfHref);
  if (postsTfHref) {
    const linkPostsTf = createLinkButton("posts.tf", { compact: true });
    linkPostsTf.href = postsTfHref;
    communityRow.appendChild(linkPostsTf);
  } else if (postsTfUnresolved && !hasKey && !statsNeedKey) {
    communityRow.appendChild(createKeyHintButton("posts.tf", POSTS_TF_KEY_HINT_TITLE));
  }

  // marketplace.tf/mannco.store share the row below that.
  if (marketplaceHref) {
    const linkMarketplace = createLinkButton("marketplace.tf", { compact: true });
    linkMarketplace.href = marketplaceHref;
    marketRow.appendChild(linkMarketplace);
  }

  const mannStoreHref = buildMannStoreHref(classifiedsFilters, { knownEffectName: classifiedsFilters?.effectName });
  if (mannStoreHref) {
    const linkMannStore = createLinkButton("mannco.store", { compact: true });
    linkMannStore.href = mannStoreHref;
    marketRow.appendChild(linkMannStore);
  }

  // Steam Market alone on its own final row.
  const linkSteamMarket = createLinkButton("Steam Market");
  linkSteamMarket.href = createSteamMarketLink(itemName, classifiedsFilters);
  steamMarketRow.appendChild(linkSteamMarket);

  if (nextRow.childElementCount > 0) linkGroup.appendChild(nextRow);
  if (bpRow.childElementCount > 0) linkGroup.appendChild(bpRow);
  if (communityRow.childElementCount > 0) linkGroup.appendChild(communityRow);
  if (marketRow.childElementCount > 0) linkGroup.appendChild(marketRow);
  if (steamMarketRow.childElementCount > 0) linkGroup.appendChild(steamMarketRow);

  wrapper.replaceChildren(linkGroup);

  fillPricedbSlot(pricedbSlot, {
    lookup: () => searchPricedbSkuStatus(pricedbQueryName),
    buildLink: (href) => {
      const link = createLinkButton("pricedb.io", { compact: true });
      link.href = href;
      return link;
    },
    // A saved key re-runs this whole function with a fresh wrapper.
    isCurrent: () => currentWrapper === wrapper,
  });
}

/**
 * A small, fixed set of real TF2 weapon names that carry a deliberately
 * lowercase letter inside a hyphenated compound name - confirmed live that
 * stntrading.eu's own raw page title capitalizes at least one of these wrong
 * ("Force-A-Nature" instead of the real "Force-a-Nature"), regardless of
 * quality/Australium/Killstreak prefix. These never change (they're fixed
 * Valve item names), so this table needs no schema/API key at all, unlike
 * correctAustraliumCasing below - a user with no Steam Web API key
 * configured would otherwise never get this fix applied. The rest (Ap-Sap,
 * Loch-n-Load, Half-Zatoichi) share the exact same "hyphen + lowercase
 * connecting word" shape as the confirmed one, so they're included
 * preemptively even though only Force-a-Nature has been confirmed live so
 * far - low risk either way, since a name that was never mis-cased to begin
 * with just doesn't match the pattern below and passes through untouched.
 */
const KNOWN_ITEM_NAME_CASINGS = ["Force-a-Nature", "Ap-Sap", "Loch-n-Load", "Half-Zatoichi"];

/**
 * Splices each known-quirky name (see KNOWN_ITEM_NAME_CASINGS) back into the
 * raw item name with its correct casing, wherever it occurs - matched
 * case-insensitively so it fires regardless of what precedes it (a quality
 * word, "Australium ", a Killstreak tier word, or nothing at all). A no-op
 * for every name that doesn't contain one of these substrings at all (the
 * vast majority), and for one that's already correctly cased.
 *
 * @param {string} itemNameRaw
 * @returns {string}
 */
function correctKnownItemNameCasing(itemNameRaw) {
  let corrected = itemNameRaw;
  for (const canonicalName of KNOWN_ITEM_NAME_CASINGS) {
    const pattern = new RegExp(canonicalName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    corrected = corrected.replace(pattern, canonicalName);
  }
  return corrected;
}

/**
 * Corrects a mis-cased Australium weapon name to its schema casing (see
 * getCanonicalItemName). Only the weapon part after "Australium " is looked
 * up: an Australium weapon has no schema entry of its own, it shares its
 * stock weapon's ("Force-a-Nature", not "Australium Force-a-Nature"). The
 * corrected weapon name is spliced back in, leaving everything before it
 * untouched.
 *
 * No-op for non-Australium items, and when the schema cannot resolve a
 * match (no Steam Web API key) or the name is already correct.
 *
 * @param {string} itemNameRaw
 * @returns {Promise<string>}
 */
async function correctAustraliumCasing(itemNameRaw) {
  const match = /Australium\s+(.+)$/i.exec(itemNameRaw);
  if (!match) return itemNameRaw;

  const rawWeaponName = match[1];
  const canonicalWeaponName = await getCanonicalItemName(rawWeaponName);
  if (canonicalWeaponName === rawWeaponName) return itemNameRaw; // already correct, or unresolved

  const weaponStart = match.index + match[0].length - rawWeaponName.length;
  return itemNameRaw.slice(0, weaponStart) + canonicalWeaponName;
}

/**
 * Same click-to-copy behavior backpack.tf's own copyItemName features and
 * scrap.tf's item card (scrap.tf/itemLinks/itemCard.js) already establish
 * - duplicated here rather than imported, same "each feature stays
 * self-contained" convention every other small helper in this codebase
 * follows. No injected stylesheet (unlike those two, which added CSS
 * :hover/flash rules) - this page's own title has no button class of its own
 * to piggyback hover feedback on, so hover/flash are both driven directly via
 * inline style assignments instead.
 */
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    console.warn("[TF2 Trading Enhancer] stntrading.eu item title: clipboard write failed", e);
    return false;
  }
}

/**
 * Makes the item title clickable to copy its plain text (name, the same
 * already-trimmed itemName link2Backpack's own caller resolves - re-reading
 * itemNameEl.textContent here would risk a stale/differently-cased read if
 * the page's own markup ever changes it after this runs).
 *
 * Wires the title only once: link2Backpack re-runs on every relevant key save
 * (see its reactivity note) against the same title element, and re-binding
 * each time would stack listeners, copying (and flashing) once per re-run.
 */
function wireUpCopyableName(itemNameEl, name) {
  if (itemNameEl.dataset.tf2teCopyWired) return;
  itemNameEl.dataset.tf2teCopyWired = "1";

  itemNameEl.style.cursor = "pointer";
  itemNameEl.title = "Click to copy item name";

  itemNameEl.addEventListener("mouseenter", () => {
    itemNameEl.style.opacity = "0.8";
  });
  itemNameEl.addEventListener("mouseleave", () => {
    itemNameEl.style.opacity = "";
  });

  itemNameEl.addEventListener("click", async () => {
    if (!name) return;

    const success = await copyToClipboard(name);
    itemNameEl.style.backgroundColor = success ? "rgba(0, 150, 0, 0.3)" : "rgba(150, 0, 0, 0.3)";
    setTimeout(() => {
      itemNameEl.style.backgroundColor = "";
    }, 400);
  });
}

/**
 * A single horizontal row within the link group - wrapper (see insertLinks)
 * stacks these vertically, each row wraps its own buttons independently.
 */
function createButtonRow({ compact = false } = {}) {
  const row = document.createElement("div");
  row.style.display = "flex";
  // Compact rows (gladiator.tf/pricedb.io/posts.tf,
  // marketplace.tf/mannco.store) rely on createLinkButton's btn-sm sizing to
  // fit on one line. They still wrap when they don't fit: STN's price row
  // has no gutter (.row.g-0), so a nowrap row wider than the Sell column
  // spills straight into the Buy column.
  row.style.flexWrap = "wrap";
  row.style.gap = compact ? "6px" : "8px";
  return row;
}

/**
 * Loading notice shown in the wrapper while a schema lookup (Unusual effect
 * id, or a Kit's/Strangifier's target weapon defindex) is in flight - see
 * link2Backpack, which replaces this with the real buttons (or their key
 * hints) once it resolves. Styled neutral (not amber) so it
 * reads as "in progress", not as a warning.
 */
function createLoadingNotice() {
  const notice = document.createElement("div");
  notice.style.maxWidth = "420px";
  notice.style.padding = "6px 10px";
  notice.style.borderRadius = "4px";
  notice.style.border = "1px solid #2e2e2e";
  notice.style.background = "rgba(255, 255, 255, 0.05)";
  notice.style.color = "#a8a196";
  notice.style.fontSize = "12px";
  notice.style.lineHeight = "1.4";
  notice.textContent = "⏳ Fetching item data from Steam (first load can take a few seconds)…";
  return notice;
}

/*
@description: A compact button for a utils/linkButtonStates.js state (key
hint, pricedb.io loading slot, rate-limit countdown): createDisabledLinkButton's
look, with pointer events back on so the hover text (and the key hint's
click) work.
*/
function createStateButton() {
  const button = createDisabledLinkButton("", { compact: true });
  button.style.pointerEvents = "";
  return button;
}

function createKeyHintButton(label, title) {
  const button = createStateButton();
  applyApiKeyHint(button, { label, title });
  return button;
}

// Same param table backpack.tf/nextUI/addMannStoreButton/content.js's own
// KILLSTREAK_PARAM_BY_TIER documents (confirmed live).
const MANNSTORE_KILLSTREAK_PARAM_BY_TIER = {
  0: "No",
  1: "Killstreak",
  2: "Specialized Killstreak",
  3: "Professional Killstreak",
};

/**
 * mannco.store's own filtered-search query params - same shapes
 * backpack.tf/nextUI/addMannStoreButton/content.js's own buildMannStoreParams
 * documents (confirmed live), sourced from resolveStatsAndClassifieds' own
 * resolved classifiedsFilters. Duplicated here (and in
 * steamcommunity.com/shared/quickLinkButtons.js's own near-identical twin)
 * rather than imported from one shared spot - web_accessible_resources scopes
 * steamcommunity.com/** to steamcommunity.com itself, so a stntrading.eu
 * content script can't reach it at all.
 *
 * Returns null for the item-type shapes this hasn't been built for yet
 * (killstreakKit/fabricatorKit/warPaintTool) - same scope gap every other
 * mannco.store button port in this codebase already has. A target-item tool
 * (filters.targetItemName set) gets its own much simpler bare-search shape
 * instead - see buildTargetToolFullName.
 */
function buildMannStoreHref(filters, { knownEffectName } = {}) {
  if (!filters || filters.killstreakKit || filters.fabricatorKit || filters.warPaintTool) {
    return null;
  }

  // A target tool searches by its full name alone (see #58).
  if (filters.targetItemName) {
    const params = new URLSearchParams({ search: buildTargetToolFullName(filters.itemName, filters.targetItemName) });
    return `https://mannco.store/tf2?${params.toString()}`;
  }

  const decorated = filters.decoratedWeapon;
  const itemName = decorated ? decorated.weaponName : filters.itemName;
  // Checks isUnusual first (a Decorated Weapon can genuinely be Unusual, with
  // Strange just an add-on tracking descriptor) - same fix applied to this
  // function's own twin in steamcommunity.com/shared/quickLinkButtons.js. See #59.
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
  if (knownEffectName) params.set("effect", knownEffectName);

  return `https://mannco.store/tf2?${params.toString()}`;
}

/**
 * Create a link styled to match the site's own buttons (square corners),
 * using the same gold/amber (btn-warning) already on the page - the
 * lightning-bolt quick-buy button and the "STN" logo's trading symbol - so
 * our added links read as part of the site instead of a generic Bootstrap
 * default (btn-info's light cyan clashed with everything else here).
 * Spacing between buttons comes from the containing row's own gap (see
 * createButtonRow) rather than a per-button margin, so this can be reused
 * standalone or inside createStatsButtonGroup.
 */
function createLinkButton(text, { compact = false } = {}) {
  const link = document.createElement("a");
  link.textContent = text;
  link.target = "_blank";
  link.classList.add("btn", "btn-warning", "rounded-0");
  // Bootstrap's own smaller-padding/font-size size modifier - used for the
  // gladiator.tf/pricedb.io/posts.tf and marketplace.tf/mannco.store rows
  // (see createButtonRow's own compact param), whose 2-3 labels together are
  // wide enough to wrap onto a second visual line at this column's own width
  // with the default (larger) Bootstrap button size.
  if (compact) link.classList.add("btn-sm");
  return link;
}

/*
 * Non-clickable twin of createLinkButton, same visual sizing/classes minus
 * the interactive/href parts - the base for createStateButton's key-hint/
 * loading/rate-limit states. A <span>, never an <a> with no href.
 */
function createDisabledLinkButton(text, { compact = false } = {}) {
  const span = document.createElement("span");
  span.textContent = text;
  span.classList.add("btn", "btn-warning", "rounded-0");
  if (compact) span.classList.add("btn-sm");
  span.style.opacity = "0.55";
  span.style.cursor = "default";
  span.style.pointerEvents = "none";
  return span;
}

/**
 * Pairs a "{site} stats" button with a compact classifieds-search icon
 * button, the same paired layout scrap.tf's own item card uses (see
 * scrap.tf/itemLinks/itemCard.js) instead of giving classifieds its own full labeled
 * button. classifiedsHref may be null (e.g. an Unusual whose effect couldn't
 * be resolved without a Steam Web API key) - in that case only the stats
 * button is included. statsHref may ALSO be null (nothing currently produces
 * that combination, but it's supported) - in that case classifieds gets its
 * own full "{site} classifieds" button instead of a bare icon, since
 * standalone it needs a label to make sense on its own.
 *
 * @param {string} site - e.g. "bp.tf" or "next.bp.tf"
 */
function createStatsButtonGroup(site, statsHref, classifiedsHref) {
  const group = document.createElement("div");
  group.style.display = "flex";
  group.style.gap = "6px";

  if (statsHref) {
    const statsBtn = createLinkButton(`${site} stats`);
    statsBtn.href = statsHref;
    group.appendChild(statsBtn);

    if (classifiedsHref) {
      const classifiedsBtn = createLinkButton("📰");
      classifiedsBtn.title = "Browse classifieds listings";
      classifiedsBtn.href = classifiedsHref;
      group.appendChild(classifiedsBtn);
    }
  } else if (classifiedsHref) {
    const classifiedsBtn = createLinkButton(`${site} classifieds`);
    classifiedsBtn.href = classifiedsHref;
    group.appendChild(classifiedsBtn);
  }

  return group;
}

/**
 * Creates an (initially empty) wrapper and inserts it into the "Sell it
 * for:" column (identified by its own text, not by class - "row g-0"/
 * "col-sm-6" are generic Bootstrap utility classes reused all over the
 * page), directly below that column's own Sell price/button, rather than
 * spanning the full row's width below both columns. That price row is core page
 * content, present immediately, unlike the Wishlist row used as a further
 * fallback below - the site's own script only adds that one after an async
 * login check, so if even that isn't there yet we wait for it with a
 * MutationObserver instead of falling back to a guessed position.
 *
 * Returns the wrapper (always - even before it's actually landed in the DOM,
 * for the MutationObserver/timeout fallback path) so the caller can fill it
 * with a loading notice right away and swap in the real content later
 * (wrapper.replaceChildren(...)) once everything resolves, without a second
 * insertion pass.
 *
 * @returns {HTMLDivElement}
 */
function insertLinks(itemNameEl) {
  const wrapper = document.createElement("div");
  wrapper.className = "px-3 px-sm-0 pt-2";
  wrapper.style.display = "flex";
  wrapper.style.flexDirection = "column";
  wrapper.style.gap = "8px";

  const priceRow = findPriceRow();
  if (priceRow) {
    // findSellColumn() is guaranteed non-null here, not just "usually" -
    // both it and findPriceRow look up the exact same "Sell it for:" <p>
    // (same querySelectorAll("p").find(...) text match, and nothing mutates
    // the DOM between the two calls), and priceRow's own .closest(".row.g-0")
    // match already proves that <p> has an ancestor - which means it has a
    // parentElement, the only thing findSellColumn itself reads off it.
    const sellColumn = findSellColumn();
    wrapper.style.marginTop = "12px";
    sellColumn.appendChild(wrapper);
    return wrapper;
  }

  const existingWishlistBtn = findWishlistBtn();
  if (existingWishlistBtn) {
    existingWishlistBtn.parentElement.appendChild(wrapper);
    return wrapper;
  }

  const observer = new MutationObserver(() => {
    const wishlistBtn = findWishlistBtn();
    if (wishlistBtn) {
      observer.disconnect();
      wishlistBtn.parentElement.appendChild(wrapper);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // Give up after 15s (e.g. user is logged out and the row will never appear)
  // and fall back to placing the links right after the title instead.
  setTimeout(() => {
    observer.disconnect();
    if (wrapper.isConnected) return; // already inserted by the observer
    itemNameEl.parentElement.insertBefore(wrapper, itemNameEl.nextSibling);
  }, 15000);

  return wrapper;
}

/**
 * Finds the "Sell it for:" / "Buy it for:" price row so insertLinks can drop
 * the buttons in right after it.
 */
function findPriceRow() {
  const sellLabel = Array.from(document.querySelectorAll("p")).find(
    (p) => p.textContent.trim() === "Sell it for:"
  );
  return sellLabel ? sellLabel.closest(".row.g-0") : null;
}

function findWishlistBtn() {
  // The navbar's account dropdown also has "My Wishlist" / other wishlist links,
  // so target the actual item-page button by its id instead of matching on text.
  return document.getElementById("wishlist_add");
}

/**
 * Reads stntrading.eu's own explicit "★ Unusual Effect: {name}" label
 * (confirmed live, printed right under the item title on an Unusual's own
 * page) - lets link2Backpack pass a knownEffectName into
 * resolveStatsAndClassifieds so an Unusual's effect NAME is known without
 * ever needing the Steam Web API schema (see resolveUnusualEffect's own
 * note on the graceful no-key fallback this enables). Matched by text
 * content on the smallest (leaf) element carrying it, not a specific class
 * name - same "match by what the text actually says" convention every
 * other DOM lookup in this file already uses (findPriceRow/findWishlistBtn
 * above), resilient to
 * stntrading.eu's own CSS churn.
 *
 * @returns {?string} the effect name (e.g. "Otherworldly Weather"), or null
 * for a non-Unusual item (no such label on the page at all) or if the
 * label's own text shape ever changes.
 */
function findKnownUnusualEffectName() {
  const candidates = Array.from(document.querySelectorAll("*")).filter((node) =>
    /Unusual Effect:/i.test(node.textContent || "")
  );

  // Innermost match, not a strict leaf (children.length === 0) - every
  // ancestor wrapping the real element also "contains" the same substring in
  // its own (deeper) textContent, so the correct target is whichever
  // candidate isn't itself nested inside another candidate. See #60.
  const el = candidates.find((node) => !candidates.some((other) => other !== node && node.contains(other)));
  if (!el) return null;

  const match = /Unusual Effect:\s*(.+)$/i.exec(el.textContent.trim());
  return match ? match[1].trim() : null;
}

/**
 * Finds the "Sell it for:" column (the "Sell it for:" label's own parent),
 * for insertLinks to append the next.bp.tf/bp.tf/marketplace.tf/Steam Market
 * button rows into.
 * @returns {HTMLElement|null}
 */
function findSellColumn() {
  const sellLabel = Array.from(document.querySelectorAll("p")).find((p) => p.textContent.trim() === "Sell it for:");
  return sellLabel?.parentElement ?? null;
}
