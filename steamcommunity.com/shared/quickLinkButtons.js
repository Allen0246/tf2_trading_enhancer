/*
@description: gladiator.tf/pricedb.io/mannco.store button-link builders,
shared by every steamcommunity.com feature that shows the same "extra sites"
row backpack.tf's own item hover tooltip/popover established (see each
builder's own note for its confirmed-live URL scheme): the inventory page
(steamcommunity.com/itemQuickLinks/content.js) and the Market listing page
(steamcommunity.com/marketListingLinks/content.js,
steamcommunity.com/marketListingModal/content.js).
*/
import { buildTargetToolFullName } from "../../utils/tf2StatsLinks/index.js";
import { applyLoadingState } from "../../utils/linkButtonStates.js";

/*
@description: Builds one dark, bordered button-styled link (not a plain
inline text link). Returns null for a missing href.
@param {boolean} [compact] - smaller padding/font, for
steamcommunity.com/itemQuickLinks/content.js's own inventory-page sidebar
(7 buttons across 2 rows don't comfortably fit at the default size).
*/
export function createButtonLink(label, href, { compact = false } = {}) {
  if (!href) return null;

  const link = document.createElement("a");
  link.href = href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = label;
  link.style.display = "inline-flex";
  link.style.alignItems = "center";
  link.style.justifyContent = "center";
  link.style.padding = compact ? "4px 8px" : "6px 12px";
  link.style.borderRadius = "6px";
  link.style.textDecoration = "none";
  link.style.background = "#201C1A";
  link.style.color = "#ffffff";
  link.style.fontWeight = "600";
  link.style.fontSize = compact ? "11px" : "12px";
  link.style.border = "1px solid rgba(255,255,255,0.15)";
  link.style.transition = "0.15s ease";

  link.addEventListener("mouseenter", () => {
    link.style.filter = "brightness(1.15)";
  });
  link.addEventListener("mouseleave", () => {
    link.style.filter = "none";
  });

  return link;
}

/*
@description: Non-clickable twin of createButtonLink, same visual shape
(dimmed via opacity) - for a placeholder button that has no link (yet): a
"needs a Steam Web API key" hint, or pricedb.io's loading slot (see
createPricedbLoadingSlot). A <span>, never an <a> with no href
(that would coerce to a literal "null"/relative-URL navigation if clicked) -
same reasoning scrap.tf/itemLinks/itemCard.js's own null-href entries follow.
*/
export function createDisabledButtonLink(label, { compact = false } = {}) {
  const span = document.createElement("span");
  span.textContent = label;
  span.style.display = "inline-flex";
  span.style.alignItems = "center";
  span.style.justifyContent = "center";
  span.style.padding = compact ? "4px 8px" : "6px 12px";
  span.style.borderRadius = "6px";
  span.style.textDecoration = "none";
  span.style.background = "#201C1A";
  span.style.color = "#ffffff";
  span.style.fontWeight = "600";
  span.style.fontSize = compact ? "11px" : "12px";
  span.style.border = "1px solid rgba(255,255,255,0.15)";
  span.style.opacity = "0.55";
  span.style.cursor = "default";
  return span;
}

/*
@description: pricedb.io's slot while its lookup is still running
(utils/linkButtonStates.js's loading state: label + spinner), so a row never
waits on pricedb.io. The caller settles it with fillPricedbSlot once the row
is on the page.
*/
export function createPricedbLoadingSlot({ compact = false } = {}) {
  const slot = createDisabledButtonLink("pricedb.io", { compact });
  applyLoadingState(slot);
  return slot;
}

export function buildButtonRow(buttons, marginTop, { compact = false } = {}) {
  const row = document.createElement("div");
  row.style.display = "flex";
  row.style.flexWrap = "wrap";
  row.style.gap = compact ? "5px" : "8px";
  if (marginTop) row.style.marginTop = marginTop;
  buttons.forEach((button) => row.appendChild(button));
  return row;
}

// Same param table backpack.tf/nextUI/addMannStoreButton/content.js's own
// KILLSTREAK_PARAM_BY_TIER documents (confirmed live).
const MANNSTORE_KILLSTREAK_PARAM_BY_TIER = {
  0: "No",
  1: "Killstreak",
  2: "Specialized Killstreak",
  3: "Professional Killstreak",
};

/*
@description: Builds mannco.store's own filtered-search query params - same
shapes backpack.tf/nextUI/addMannStoreButton/content.js's own
buildMannStoreParams documents (confirmed live), sourced from
resolveClassifiedsFilters' own resolved output instead of re-scanning
tooltip/popover DOM for them. The decoratedWeapon branch has no top-level
quality/killstreakTier/isFestivized/isAustralium fields of its own (see
resolveClassifiedsFilters' own decoratedWeapon note) - isUnusual/isStrange
stand in for quality (isUnusual takes priority, same pattern
matchDecoratedWeapon's own isUnusual note documents). Festivized/Australium
aren't applicable to it at all (no confirmed-live example of either combined
with a skin), and its own killstreakTier field is used instead of the generic
one. knownEffectName/knownSheenName/knownKillstreakerName/knownPaintName are
all optional - a caller with nothing more specific than the item name/type
alone (e.g. marketListingLinks' own page-level, no-effect-filter search) can
pass {} and just get a broader mannco.store search with those params omitted,
same "search without X filter" degradation every other link on that page
already has.
See #59.
*/
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
  // Never applied for an Unusual - same exclusion rule every other
  // mannco.store button port enforces (see
  // backpack.tf/nextUI/addMannStoreButton/content.js's own note).
  if (knownPaintName && qualityName !== "Unusual") params.set("paint", knownPaintName);
  if (knownEffectName) params.set("effect", knownEffectName);

  return params;
}

/*
@description: null for the item-type shapes this hasn't been built for yet
(warPaintTool) - same scope gap backpack.tf/oldUI/addMannStoreButton/
content.js's own DOM-parsing version has (it only ever handles the
generic-item and decoratedWeapon shapes). A target-item tool (filters.targetItemName set) gets its own much
simpler bare-search shape instead (see buildTargetToolFullName).

fabricatorKit (a Kit Fabricator) and killstreakKit (a standalone Killstreak Kit item) get a bare search off the item's own raw, full, on-page name (the caller's
own `itemName` param, NOT reconstructed from either filter's own {targetName, tier} fields the way
buildTargetToolFullName reconstructs a Strangifier's name - neither has an equivalent short
"canonical name + target" split to reconstruct from), plus the item's own known Sheen/Killstreaker
as real filters when known - confirmed live for both a Kit
("...search=Professional+Killstreak+Conniver%27s+Kunai+Kit&sheen=Hot+Rod&killstreaker=Incinerator")
and a Fabricator
("...search=Professional+Killstreak+Minigun+Kit+Fabricator&sheen=Mean+Green&killstreaker=Fire+Horns"
- a Fabricator's own finished-Kit output has a FIXED Sheen/Killstreaker shown right on its own item
panel) - same "sheen"/"killstreaker" param names
buildMannStoreParams already uses for the generic-item case, just without any of that branch's other
quality/festivized/warpaints structure (neither a Kit nor a Fabricator has those).

`itemName` is optional (every other caller/shape below doesn't need it) - a
fabricatorKit/killstreakKit item with no itemName provided still safely
returns null rather than searching for "undefined".
*/
export function buildMannStoreHref(filters, knownSignals, itemName) {
  if (!filters) return null;
  // A Kit Fabricator's own finished-Kit output has a fixed Sheen/Killstreaker
  // too, same as a plain Kit, so both share one branch. See #25.
  if (filters.fabricatorKit || filters.killstreakKit) {
    if (!itemName) return null;
    const params = new URLSearchParams({ search: itemName });
    if (knownSignals?.knownSheenName) params.set("sheen", knownSignals.knownSheenName);
    if (knownSignals?.knownKillstreakerName) params.set("killstreaker", knownSignals.knownKillstreakerName);
    return `https://mannco.store/tf2?${params.toString()}`;
  }
  if (filters.warPaintTool) {
    return null;
  }
  if (filters.targetItemName) {
    const params = new URLSearchParams({ search: buildTargetToolFullName(filters.itemName, filters.targetItemName) });
    return `https://mannco.store/tf2?${params.toString()}`;
  }
  return `https://mannco.store/tf2?${buildMannStoreParams(filters, knownSignals).toString()}`;
}
