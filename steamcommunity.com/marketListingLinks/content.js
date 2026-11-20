/**
 * Adds a "next.backpack.tf:"/"backpack.tf:"/gladiator.tf/pricedb.io/posts.tf/
 * marketplace.tf/mannco.store stack of links under the item's preview image,
 * as a block of its own (buildStandaloneBlock). Same link set steamcommunity.com/
 * itemQuickLinks (the inventory page) and stntrading.eu/link2Backpack build
 * for their own single item, reused here via utils/tf2StatsLinks/index.js's
 * resolveStatsAndClassifieds and shared/quickLinkButtons.js instead of
 * re-deriving the (considerable) per-item-type URL logic. No Steam Market
 * button, unlike the inventory page's version - this page IS Steam Market.
 *
 * Resolved once per page from the page-level item title/effect label, not
 * per listing card: every card is the same base item, so per-card links
 * would only repeat the same row.
 */
import { resolveStatsAndClassifieds, buildPricedbSearchName, buildGladiatorHref } from "../../utils/tf2StatsLinks/index.js";
import { searchPricedbSkuStatus } from "../../utils/pricedb.js";
import { fillPricedbSlot } from "../../utils/linkButtonStates.js";
import {
  createStatsRow,
  findImagePanel,
  waitForImagePanel,
  unlockImagePanelLayout,
  getMarketListingItemNameFromUrl,
  findLabeledValue,
  findMarketInfoPanels,
} from "../shared/priceWidgets.js";
import {
  createButtonLink,
  createPricedbLoadingSlot,
  buildButtonRow,
  buildMannStoreHref,
} from "../shared/quickLinkButtons.js";
import { findItemPicture, showEffectBehindPicture } from "../shared/itemEffectBackground.js";
import { isEnglishSteamPage, loadEnglishPanelForMarketItem } from "../shared/englishItemDescription.js";
// A Kit Fabricator's own fixed Sheen/Killstreaker has no bare "Sheen: X"
// line at all - see that function's own note (exported from itemQuickLinks
// specifically for this reuse).
import { findFabricatorOutputSheenAndKillstreaker } from "../itemQuickLinks/content.js";
import { isSheenKillstreakerFilterEnabled } from "../../utils/sheenKillstreakerFilterSetting.js";

// The info column's "★ Unusual Effect: X" line (findPageKnownSignals and
// showHeaderPictureEffect).
const UNUSUAL_EFFECT_LABEL = /^★?\s*Unusual Effect:\s*(.+)$/i;

/*
@description: Reads this page's own item info panel's "★ Unusual Effect:
X"/"Sheen: X"/"Killstreaker: X" labels, matching what
steamcommunity.com/itemQuickLinks/content.js already does for the inventory
page and steamcommunity.com/marketListingModal/content.js already does for
this same page's own per-listing modal. When the panel or a label can't be
read, buildStatsRowsBlock shows a caption saying the search is unfiltered.

Falls back to findFabricatorOutputSheenAndKillstreaker for Sheen/Killstreaker
specifically - a Kit Fabricator's own listing has no bare "Sheen: X" line at
all, only a parenthesized one inside its OUTPUT section (same DOM shape the
inventory page's own item panel renders, since it's the same underlying
description text) - same fallback order as itemQuickLinks/content.js.
@returns: {knownEffectName: ?string, knownSheenName: ?string, knownKillstreakerName: ?string} -
all null if the info panel itself couldn't be found at all.
*/
async function findPageKnownSignals(panel) {
  const infoPanel = isEnglishSteamPage() ? findMarketInfoPanels()[0] : await loadHeaderEnglishPanel(panel);
  if (!infoPanel) return { knownEffectName: null, knownSheenName: null, knownKillstreakerName: null };

  const fabricatorOutput = findFabricatorOutputSheenAndKillstreaker(infoPanel);
  return {
    knownEffectName: findLabeledValue(infoPanel, UNUSUAL_EFFECT_LABEL),
    knownSheenName: findLabeledValue(infoPanel, /^Sheen:\s*(.+)$/i) || fabricatorOutput.sheenName,
    knownKillstreakerName: findLabeledValue(infoPanel, /^Killstreaker:\s*(.+)$/i) || fabricatorOutput.killstreakerName,
  };
}

/*
@description: On a non-English page, the header item's English stand-in
panel (see ../shared/englishItemDescription.js) - confirmed live (Steam in
Hungarian), its effect line reads "★ Rendkívüli effekt: Mesés tollak", so
nothing English-labeled could be read off the page itself. Read through the
header picture, which the page script stamps with the item's class ids.
@returns {Promise<?Element>}
*/
function loadHeaderEnglishPanel(panel) {
  return loadEnglishPanelForMarketItem(findItemPicture(panel));
}

const ROW_ID = "tf2te_stats_links_row";

function createCaption(text) {
  const caption = document.createElement("div");
  caption.textContent = text;
  caption.style.fontSize = "11px";
  caption.style.color = "#6b7480";
  return caption;
}

/*
@description: Builds the next:/classic:/marketplace.tf stack from one
resolveStatsAndClassifieds result, with an explanatory caption above the
next:/classic: rows whenever this item IS an Unusual but its effect couldn't
be read off this page's own item panel (findPageKnownSignals' own
knownEffectName came back null - panel not found, or the label hasn't
rendered into it yet), and never shown for a non-Unusual item (a Strange/
Vintage/plain item was never effect-filterable in the first place, so the
caption would just be a non sequitur there). Same idea, second independent
caption, for a Specialized/Professional Killstreak weapon or Kit
(killstreakTier >= 2) whose Sheen/Killstreaker likewise couldn't be read.

The captions only show for what genuinely couldn't be read, not as a blanket
disclaimer. A Basic Killstreak item (tier 1) has neither attribute at all,
so it's excluded (tier >= 2 only). Both captions can show together for the (rare)
case of an Unusual Killstreak weapon.
@returns: the wrapper element, or null if nothing had anything to show
(mirrors createStatsRow's own null-when-empty behavior).
*/
function buildStatsRowsBlock(resolved, gladiatorHref, pricedbSlot, mannStoreHref, knownSignals, sheenKillstreakerFilterEnabled) {
  const wrapper = document.createElement("div");
  wrapper.style.display = "flex";
  wrapper.style.flexDirection = "column";
  wrapper.style.alignItems = "flex-start";
  wrapper.style.gap = "5px";

  const isUnusual = resolved.classifiedsFilters?.quality === "Unusual";
  if (isUnusual && !knownSignals.knownEffectName) {
    wrapper.appendChild(createCaption("Search without unusual effect filter"));
  }

  // Killstreak tier lives in a different spot per item type - the generic
  // (plain weapon) branch's own killstreakTier field for a normal Killstreak
  // weapon, killstreakKit.tier for a Kit, or fabricatorKit.tier for a
  // Fabricator (see utils/tf2StatsLinks/index.js's resolveClassifiedsFilters) - a
  // Fabricator's own finished Kit has a fixed Sheen/Killstreaker too (see
  // findFabricatorOutputSheenAndKillstreaker's own note), so it needs this
  // same caption fallback when neither could be read.
  const killstreakTier =
    resolved.classifiedsFilters?.killstreakTier ??
    resolved.classifiedsFilters?.killstreakKit?.tier ??
    resolved.classifiedsFilters?.fabricatorKit?.tier ??
    0;
  // Only shown while the toggle is actually on, once a user turns
  // Sheen/Killstreaker filtering off in General settings, the resulting
  // unfiltered search is expected behavior, not a fallback worth apologizing
  // for the way it is when the page's own labels just haven't rendered yet.
  if (sheenKillstreakerFilterEnabled && killstreakTier >= 2 && !knownSignals.knownSheenName && !knownSignals.knownKillstreakerName) {
    wrapper.appendChild(createCaption("Search without sheen and killstreaker filter"));
  }

  const nextRow = createStatsRow("next.backpack.tf", resolved.nextBpStatsHref, resolved.nextClassifiedsHref);
  if (nextRow) wrapper.appendChild(nextRow);

  const classicRow = createStatsRow("backpack.tf", resolved.bpStatsHref, resolved.classifiedsHref);
  if (classicRow) wrapper.appendChild(classicRow);

  // Same button-styled row pairing steamcommunity.com/itemQuickLinks/content.js
  // established (gladiator.tf+pricedb.io+posts.tf on their own row,
  // marketplace.tf+mannco.store on theirs) - no Steam Market button here,
  // unlike that page, since this page IS Steam Market. resolved.postsTfHref
  // comes for free off the same resolveStatsAndClassifieds call already made
  // above (see utils/tf2StatsLinks/index.js's own buildPostsTfLink) - no new
  // resolution logic needed.
  const gladiatorRowButtons = [
    createButtonLink("gladiator.tf", gladiatorHref),
    // Loading slot, settled once the block is on the page (fillPricedbSlot).
    pricedbSlot,
    createButtonLink("posts.tf", resolved.postsTfHref),
  ].filter(Boolean);
  if (gladiatorRowButtons.length) wrapper.appendChild(buildButtonRow(gladiatorRowButtons));

  const marketplaceRowButtons = [createButtonLink("marketplace.tf", resolved.marketplaceHref), createButtonLink("mannco.store", mannStoreHref)].filter(
    Boolean
  );
  if (marketplaceRowButtons.length) wrapper.appendChild(buildButtonRow(marketplaceRowButtons));

  // Checks for a real link having landed in wrapper, rather than just every
  // individual row being empty - the captions can end up as wrapper's only
  // children when nothing at all resolved, and that alone isn't "something
  // to show". In practice gladiator.tf is always buildable once itemName
  // resolves (see buildGladiatorHref), so this is almost always true.
  return wrapper.querySelector("a") ? wrapper : null;
}

/*
@description: Wraps buildStatsRowsBlock's own result in a standalone,
centered row under the image panel (flexBasis:"100%" puts it on its own line
below the image).
@returns: the wrapper element, always with at least one child - callers
only ever build this when statsRows itself resolved to something (see
marketListingLinks' own check).
*/
function buildStandaloneBlock(statsRows) {
  const wrapper = document.createElement("div");
  wrapper.id = ROW_ID;
  wrapper.style.flexBasis = "100%";
  wrapper.style.display = "flex";
  wrapper.style.flexDirection = "column";
  wrapper.style.alignItems = "center";
  wrapper.style.gap = "8px";
  wrapper.style.marginTop = "8px";

  if (statsRows) wrapper.appendChild(statsRows);

  return wrapper;
}

/*
@description: Shows the page header's Unusual effect behind its large picture,
the way the listing modal shows its own. The header's example item has its
"★ Unusual Effect: X" line in the info column beside the picture; the image
panel and that column share a parent row holding nothing else (confirmed
live), so the effect is read from that row, never from the listing tiles
below. Watches the row, since React may render the effect line or a new
picture after the panel itself (re-applying the same effect does nothing).
Only on an Unusual's page: no other item has an effect, and other pages (a
commodity like Keys, with its order-book layout) are left alone.
*/
export function showHeaderPictureEffect(panel) {
  const row = panel.parentElement;
  if (!row || panel.dataset.tf2teHeaderEffect) return;
  if (!/\bUnusual\b/.test(getMarketListingItemNameFromUrl() || "")) return;
  panel.dataset.tf2teHeaderEffect = "1";

  // On a non-English page the effect comes from the header item's English
  // description (see loadHeaderEnglishPanel) - cached, so re-applying on
  // every change costs nothing after the first.
  const apply = () => {
    if (isEnglishSteamPage()) {
      showEffectBehindPicture(findItemPicture(panel), findLabeledValue(row, UNUSUAL_EFFECT_LABEL));
      return;
    }
    loadHeaderEnglishPanel(panel).then((englishPanel) =>
      showEffectBehindPicture(findItemPicture(panel), findLabeledValue(englishPanel || row, UNUSUAL_EFFECT_LABEL))
    );
  };
  apply();
  new MutationObserver(apply).observe(row, { childList: true, subtree: true, characterData: true });
}

export function marketListingLinks() {
  waitForImagePanel(async (panel) => {
    showHeaderPictureEffect(panel);
    if (panel.dataset.tf2teLinksInserted) return;

    const itemName = getMarketListingItemNameFromUrl();
    if (!itemName) return;

    // Read straight off this page's own item info panel (see
    // findPageKnownSignals' own note): Steam labels the effect separately
    // from the title on this page, so resolveUnusualEffect's raw-text
    // substring search alone would never find it. Degrades to an unfiltered
    // search whenever the panel can't be found or a specific label hasn't
    // rendered into it yet (buildStatsRowsBlock's own captions say so).
    const knownSignals = await findPageKnownSignals(panel);
    // resolveStatsAndClassifieds/createSteamMarketLink already gate
    // themselves internally (see resolveClassifiedsFilters' own note) -
    // buildMannStoreHref reads knownSignals.knownSheenName/
    // knownKillstreakerName directly though (its fabricatorKit/killstreakKit
    // branch bypasses classifiedsFilters entirely), so that one call needs
    // its own gated copy here.
    const sheenKillstreakerFilterEnabled = await isSheenKillstreakerFilterEnabled();

    // pricedb.io is looked up after the block is shown (fillPricedbSlot
    // below), so its lookup never holds the other links back.
    const resolved = await resolveStatsAndClassifieds(itemName, knownSignals);

    // gladiator.tf names an Unusual "{Effect} {Item}", same as pricedb.io.
    const gladiatorHref = buildGladiatorHref(buildPricedbSearchName(itemName, resolved.classifiedsFilters));
    const pricedbSlot = createPricedbLoadingSlot();
    const mannStoreKnownSignals = sheenKillstreakerFilterEnabled
      ? knownSignals
      : { ...knownSignals, knownSheenName: null, knownKillstreakerName: null };
    const mannStoreHref = resolved.classifiedsFilters ? buildMannStoreHref(resolved.classifiedsFilters, mannStoreKnownSignals, itemName) : null;

    const statsRows = buildStatsRowsBlock(
      resolved,
      gladiatorHref,
      pricedbSlot,
      mannStoreHref,
      knownSignals,
      sheenKillstreakerFilterEnabled
    );
    if (!statsRows) return;
    panel.dataset.tf2teLinksInserted = "1";

    // See unlockImagePanelLayout's own note: lets the block land below the
    // image instead of squeezing beside it or getting clipped.
    unlockImagePanelLayout(panel);

    const standaloneBlock = buildStandaloneBlock(statsRows);
    panel.appendChild(standaloneBlock);

    // Steam's React app can wipe DOM it didn't render, including this block,
    // once its own data finishes loading: put the same block back into
    // whatever findImagePanel finds now.
    new MutationObserver(() => {
      if (document.getElementById(ROW_ID)) return; // still attached

      const freshPanel = findImagePanel();
      if (!freshPanel) return;

      unlockImagePanelLayout(freshPanel);
      freshPanel.appendChild(standaloneBlock);
    }).observe(document.body, { childList: true, subtree: true });

    fillPricedbSlot(pricedbSlot, {
      lookup: () => searchPricedbSkuStatus(buildPricedbSearchName(itemName, resolved.classifiedsFilters)),
      buildLink: (href) => createButtonLink("pricedb.io", href),
    });
  });
}
