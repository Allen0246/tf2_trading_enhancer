/*
@description: Shared readers for next.backpack.tf's item-preview tooltip,
used by the link buttons that resolve an item from it (../addMarketplaceButton,
../addStnButton, ../addMannStoreButton, ../addPostsTfButton). Each button
still builds and places its own link; this file only owns what they all read
off the same tooltip.

The tooltip is a Vue/Tippy component (confirmed live: `id="tippy-NN"`,
`class="tippy-popper"`). It is a single shared component whose props update
reactively as different items are hovered, with Vue patching the SAME DOM
nodes in place, which is why every caller dedupes on a content signature
rather than a plain "already handled" flag.

The Classifieds button's own href (confirmed live:
"/classifieds?itemName=Diamond%20Botkiller%20Sniper%20Rifle%20Mk.I&quality=11")
carries itemName/quality cleanly separated, with "australium=1",
"targetItem" and "particle" as their own params. Two confirmed exceptions:
a Killstreak Kit's itemName is just "Kit" and a Fabricator's just
"Fabricator", with no target weapon anywhere in the href; for those the
tooltip's title heading is the only place the full name appears (see
isKillstreakToolName).
*/

import { SHEEN_IDS, KILLSTREAKER_IDS, SPELL_IDS, PAINT_IDS } from "../../../utils/tf2StatsLinks/index.js";
import { QUALITY_NAME_BY_ID } from "../../../utils/tf2Quality.js";
import { WEAR_TIER_IDS } from "../../../utils/warpaints.js";

// Confirmed live against the tooltip's own Classifieds button:
// <a href="/classifieds?itemName=...&quality=11" class="btn btn-outline-brand btn-item-tooltip">
export const CLASSIFIEDS_BUTTON_SELECTOR = 'a.btn-item-tooltip[href*="/classifieds?itemName="]';
// The tooltip's own Unusual-effect row, confirmed live:
// <a href="/effects/Green%20Black%20Hole" class="special-attribute ..."><img .../> <div class="special-attribute__name">Green Black Hole</div></a>
// Keyed off the href prefix, since the "special-attribute__name" class is
// shared by every attribute row.
const EFFECT_LINK_SELECTOR = 'a[href^="/effects/"]';
// A Decorated Weapon's skin row, confirmed live, same shape as the effect
// row: <a href="/war-paints/Brain%20Candy" ...><div class="special-attribute__name">Brain Candy</div></a>.
const SKIN_LINK_SELECTOR = 'a[href^="/war-paints/"]';
// Confirmed live: <div class="item-tooltip__header__title">Professional
// Killstreak Eyelander Kit</div>.
const TITLE_SELECTOR = ".item-tooltip__header__title";

/*
@description: The tooltip wrapper an element belongs to, or the whole
document if that wrapper isn't found (markup changed). Scoping to the
wrapper keeps a second, unrelated tooltip elsewhere in the DOM from leaking
its values into this one.
*/
export function findTooltipRoot(el) {
  return el.closest?.(".tippy-popper") ?? document;
}

function readText(el) {
  if (!el) return null;
  const text = el.textContent.replace(/\s+/g, " ").trim();
  return text || null;
}

/*
@description: Reads the Classifieds anchor's own query params. The "particle"
param is the exact numeric effect id (confirmed live: "...&particle=3072" on
an Unusual Taunt, whose tooltip has no "/effects/" row at all), or "none"
when there is no effect.
*/
export function readClassifiedsAnchorParams(classifiedsAnchor) {
  const url = new URL(classifiedsAnchor.getAttribute("href"), window.location.href);
  const particleParam = url.searchParams.get("particle");
  return {
    itemName: url.searchParams.get("itemName"),
    qualityId: Number(url.searchParams.get("quality")),
    targetItem: url.searchParams.get("targetItem"),
    // Confirmed live: "australium=1" on the anchor's own href; itemName never
    // carries the word itself.
    isAustralium: url.searchParams.get("australium") === "1",
    knownEffectId: particleParam && particleParam !== "none" ? Number(particleParam) : null,
  };
}

export function findKnownEffectName(classifiedsAnchor) {
  return readText(findTooltipRoot(classifiedsAnchor).querySelector?.(EFFECT_LINK_SELECTOR));
}

/*
@description: A Decorated Weapon's exact skin name, off its "/war-paints/"
row. Since it is exact, buildDecoratedWeaponNameRaw can build the
"{skin}{weapon}" shape matchDecoratedWeapon prefix-searches, and that search
trivially succeeds.
*/
export function findKnownSkinName(classifiedsAnchor) {
  return readText(findTooltipRoot(classifiedsAnchor).querySelector?.(SKIN_LINK_SELECTOR));
}

export function findTooltipTitle(classifiedsAnchor) {
  return readText(findTooltipRoot(classifiedsAnchor).querySelector?.(TITLE_SELECTOR));
}

// Confirmed live: a weapon's Sheen ("Manndarin"), Killstreaker ("Cerebral
// Discharge"), a Halloween Spell ("Exorcism"), a Decorated Weapon's wear tier
// ("Field-Tested"), a cosmetic's Paint ("A Deep Commitment to Purple"),
// "Festivized", and a Basic Killstreak weapon's "Standard" each render as
// <div class="special-attribute ..."><svg .../><div class="special-attribute__name">NAME</div></div>,
// with no label text or type-specific attribute to tell them apart (the
// icon's class encodes the SHEEN's name even on other rows). Table membership
// is unambiguous instead, since a name never appears in more than one table.
const SPECIAL_ATTRIBUTE_NAME_SELECTOR = ".special-attribute__name";
const FESTIVIZED_ATTRIBUTE_TEXT = "festivized";
const BASIC_KILLSTREAK_ATTRIBUTE_TEXT = "standard";

function matchKnownNameInTable(text, table) {
  return Object.keys(table).find((name) => name.toLowerCase() === text.toLowerCase()) ?? null;
}

/*
@description: Classifies every special-attribute row in the tooltip by exact
(case-insensitive) name against SHEEN_IDS/KILLSTREAKER_IDS/SPELL_IDS/
WEAR_TIER_IDS/PAINT_IDS, plus literal matches for Festivized and Basic
Killstreak. The effect and skin rows share the same name class but never
match a table, so scanning them is a harmless no-op. Only the first spell is
kept: the sites this feeds each take a single spell value. Paint is read
unconditionally; the "never filter an Unusual by paint" rule is enforced
centrally in resolveClassifiedsFilters.
*/
export function findKnownAttributes(classifiedsAnchor) {
  const nameEls = findTooltipRoot(classifiedsAnchor).querySelectorAll?.(SPECIAL_ATTRIBUTE_NAME_SELECTOR) ?? [];

  const found = {
    knownSheenName: null,
    knownKillstreakerName: null,
    knownSpellName: null,
    knownWearTier: null,
    knownPaintName: null,
    isFestivized: false,
    isBasicKillstreak: false,
  };
  nameEls.forEach((el) => {
    const text = el.textContent.replace(/\s+/g, " ").trim();
    found.knownSheenName ??= matchKnownNameInTable(text, SHEEN_IDS);
    found.knownKillstreakerName ??= matchKnownNameInTable(text, KILLSTREAKER_IDS);
    found.knownSpellName ??= matchKnownNameInTable(text, SPELL_IDS);
    found.knownWearTier ??= matchKnownNameInTable(text, WEAR_TIER_IDS);
    found.knownPaintName ??= matchKnownNameInTable(text, PAINT_IDS);
    if (text.toLowerCase() === FESTIVIZED_ATTRIBUTE_TEXT) found.isFestivized = true;
    if (text.toLowerCase() === BASIC_KILLSTREAK_ATTRIBUTE_TEXT) found.isBasicKillstreak = true;
  });
  return found;
}

/*
@description: The Classifieds itemName strips the Killstreak tier word and
there is no tier param, so the tier is rebuilt from Valve's fixed rules:
ONLY a Professional Killstreak weapon carries a Killstreaker, ONLY
Specialized/Professional carry a Sheen, and Basic gets its own
confirmed-live "Standard" row with neither.
*/
export function killstreakTierFromAttributes(knownSheenName, knownKillstreakerName, isBasicKillstreak) {
  if (knownKillstreakerName) return 3;
  if (knownSheenName) return 2;
  if (isBasicKillstreak) return 1;
  return 0;
}

export const KILLSTREAK_TIER_PREFIXES = { 3: "Professional Killstreak ", 2: "Specialized Killstreak ", 1: "Killstreak ", 0: "" };

/*
@description: Rebuilds the quality-prefixed display name (e.g. "Strange
Festivized Professional Killstreak Australium Rocket Launcher")
resolveStatsAndClassifieds expects, in the confirmed-live word order
resolveClassifiedsFilters strips back apart (quality, Festivized,
Killstreak, Australium). Unique, or an unrecognized quality id, gets no
quality prefix. "Australium" is re-embedded as a literal word because the
anchor only carries it as its own param (see #144).
*/
export function buildItemNameRaw(itemName, qualityId, { isFestivized = false, killstreakPrefix = "", isAustralium = false } = {}) {
  const qualityName = QUALITY_NAME_BY_ID[qualityId];
  const prefixed = `${isFestivized ? "Festivized " : ""}${killstreakPrefix}${isAustralium ? "Australium " : ""}${itemName}`;
  if (!qualityName || qualityName === "Unique") return prefixed;
  return `${qualityName} ${prefixed}`;
}

/*
@description: The raw name utils/tf2StatsLinks/decoratedWeapon.js's
matchDecoratedWeapon expects: "{Strange |Unusual }?{skinName}{weaponName}
(WearTier)", skin and weapon concatenated with NO separator. A leading
quality word is the one thing matchDecoratedWeapon strips off the front (and
reads as isStrange/isUnusual), so a Strange or Unusual quality id is carried
that way. Effect/Killstreak words are deliberately not embedded
(matchDecoratedWeapon cannot strip them out of the middle, so its skin-name
prefix match would fail); callers pass them as resolveStatsAndClassifieds'
known* options instead.
*/
export function buildDecoratedWeaponNameRaw(skinName, itemName, qualityId, wearTier) {
  const qualityName = QUALITY_NAME_BY_ID[qualityId];
  const qualityPrefix = qualityName === "Strange" || qualityName === "Unusual" ? `${qualityName} ` : "";
  return `${qualityPrefix}${skinName}${itemName} (${wearTier})`;
}

// A Kit's (or Fabricator's) tier is baked into its catalog NAME, not an
// attribute, and its itemName param is just "Kit"/"Fabricator" - so its
// title heading, already the complete raw name matchKillstreakKit/
// matchFabricatorKit expect, is used as-is. The two suffixes never overlap
// (" Kit" vs " Kit Fabricator"), so one regex covers both. See #30.
const KILLSTREAK_TOOL_NAME_PATTERN = /^(Professional |Specialized )?Killstreak .+ Kit( Fabricator)?$/i;

export function isKillstreakToolName(name) {
  return KILLSTREAK_TOOL_NAME_PATTERN.test((name || "").trim());
}
