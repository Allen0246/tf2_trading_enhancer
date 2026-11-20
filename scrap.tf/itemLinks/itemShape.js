/*
@description: Central identity-resolution step for the hover item card: turns
a hovered item's raw tooltip name + DOM element into one resolved "shape"
(quality, skin, killstreak tier, festivized, tool targets, every id link
building needs). skinDetection.js/toolVariants.js/tooltipData.js each
resolve one slice; links.js turns the finished shape into URLs.
*/
import { getEffectId, getItemDefindex, getItemNameByDefindex, getCanonicalItemName, getTauntNameByIcon, iconNameFromUrl } from "../../utils/tf2Schema.js";
import { getQualityNameFromClassList } from "../../utils/tf2Quality.js";
import { stripNamePrefix } from "../../utils/tf2ItemName.js";
import { FABRICATOR_PRICEINDEX_PREFIX_BY_TIER } from "../../utils/tf2StatsLinks/fabricatorKit.js";
import { SHEEN_IDS, KILLSTREAKER_IDS, SPELL_IDS, PAINT_IDS } from "../../utils/tf2AttributeIds.js";
import { getKillstreakTier } from "../shared/getKillstreakTier.js";
import { detectSkin } from "./skinDetection.js";
import { detectToolVariants } from "./toolVariants.js";
import {
  getUnusualEffectName,
  getSpellName,
  getLevel,
  getPaintName,
  getSheenName,
  getKillstreakerName,
  isFestivized,
  isMarkedUncraftableInTooltip,
} from "./tooltipData.js";

// Matches a Name Tag'd item's tooltip title: Steam shows `<Quality> "<custom
// name>"` instead of the item's real name (confirmed live: a Strange
// Wandering Wraith renamed to "FALL." has a tooltip title of
// `Strange "FALL."`, with the real item only identifiable via its own
// data-defindex). Captures whatever precedes the quote (the quality/prefix
// words, if any) separately from the quoted custom text itself. Some pages
// (seen live on a raffle) quote with two apostrophes instead:
// `Strange ''Thriller - Michael Jackson''`. A real item name never contains
// two apostrophes in a row, so that can't misfire.
const CUSTOM_NAME_PATTERN = /^(.*?)(?:"|'')(.+)(?:"|'')\s*$/;

/*
@description: Resolves a Name Tag'd item's tooltip title back to its real
item name via data-defindex/schema lookup (same technique as
skinDetection.js's own weaponName resolution), since every other piece of
this feature - quality/killstreak/kit/skin/spell detection, and every stats/
classifieds/Steam Market link built from any of it - depends on `name`
actually being the item's real name, not a player-chosen custom one. Returns
the raw name unchanged when it doesn't look Name Tag'd, or when the schema
lookup cannot resolve it (best effort, like skinDetection.js).
*/
async function resolveCustomNamedItem(name, itemEl) {
  const match = CUSTOM_NAME_PATTERN.exec(name);
  if (!match) return name;

  const defindexAttr = itemEl.getAttribute("data-defindex");
  const defindex = defindexAttr ? Number(defindexAttr) : null;
  const realName = defindex ? await getItemNameByDefindex(defindex) : null;

  return realName ? match[1] + realName : name;
}

const KILLSTREAK_PREFIX_BY_TIER = ["", "Killstreak ", "Specialized Killstreak ", "Professional Killstreak "];

/*
@description: Killstreak tier the item ITSELF carries via its own killstreakN
CSS class - distinct from a Killstreak Kit/Fabricator's own target tier (see
toolVariants.js), which is parsed from the tooltip NAME instead, not a class.
*/
function detectOwnKillstreakTier(itemEl) {
  const ksTier = getKillstreakTier(itemEl.classList);
  return { ksPrefix: KILLSTREAK_PREFIX_BY_TIER[ksTier], ksTier };
}

/*
@description: Resolves every schema/id-table-backed lookup detectItemShape
needs (Unusual effect id, Kit/Fabricator/Strangifier target weapon defindex,
Sheen/Killstreaker/Spell/Paint ids): every input is already-parsed name
data, every output is an id or null, kept apart from detectItemShape's
synchronous name parsing for readability.
@returns: exactly the id-related fields detectItemShape's own return object
needs (see call site) - not a separate public shape of its own.
*/
async function resolveShapeIds({
  unusualEffectName,
  isKillstreakKit,
  killstreakKitTargetName,
  isTargetTool,
  targetToolTargetName,
  isFabricatorKit,
  fabricatorKitTargetName,
  fabricatorKitTier,
  skin,
  sheenName,
  killstreakerName,
  spellName,
  paintName,
}) {
  // backpack.tf's and next.backpack.tf's stats pages share the same URL scheme
  // for normal items (only the domain differs), and for Unusuals both need the
  // effect's numeric particle id as an extra path segment (.../Unusual/Name/
  // Tradable/Craftable/{effectId}) - without it the link 404s/redirects to a
  // search page instead of the actual item. Rather than link either one
  // somewhere wrong (or show two identical "set up your key" buttons), fall
  // back to one combined prompt pointing at the Steam key signup page when the
  // effect can't be resolved.
  let effectId = null;
  let effectUnresolved = false;
  if (unusualEffectName) {
    effectId = await getEffectId(unusualEffectName);
    effectUnresolved = !effectId;
  }

  // Killstreak Kits target a weapon's separate "Upgradeable" schema entry, not
  // its normal drop defindex - confirmed live via Valve's schema: stock
  // weapons have two entries sharing the same item_name (e.g. both named
  // "Rocket Launcher"), a plain one ("TF_WEAPON_ROCKETLAUNCHER", defindex 18)
  // and an "Upgradeable " one ("Upgradeable TF_WEAPON_ROCKETLAUNCHER",
  // defindex 205) - Kits/Strangifiers/etc. target the latter. getItemDefindex
  // (tf2Schema.js) already prefers the Upgradeable variant when both exist.
  let kitTargetDefindex = null;
  let kitDefindexUnresolved = false;
  if (isKillstreakKit) {
    kitTargetDefindex = await getItemDefindex(killstreakKitTargetName);
    kitDefindexUnresolved = !kitTargetDefindex;
  }

  let targetToolDefindex = null;
  let targetToolDefindexUnresolved = false;
  if (isTargetTool) {
    targetToolDefindex = await getItemDefindex(targetToolTargetName);
    targetToolDefindexUnresolved = !targetToolDefindex;
  }

  const fabricatorTargetDefindex = isFabricatorKit ? await getItemDefindex(fabricatorKitTargetName) : null;

  // No confirmed Basic-tier priceindex prefix (see
  // FABRICATOR_PRICEINDEX_PREFIX_BY_TIER in utils/tf2StatsLinks/fabricatorKit.js), so
  // fabricatorPriceindex stays null for that tier (folded into
  // statsUnresolved below) rather than guessed. An unresolved target
  // defindex leaves it null too, so fabricatorUnresolved covers both cases.
  const fabricatorPriceindexPrefix = isFabricatorKit ? FABRICATOR_PRICEINDEX_PREFIX_BY_TIER[fabricatorKitTier] : null;
  const fabricatorPriceindex =
    fabricatorPriceindexPrefix && fabricatorTargetDefindex ? `${fabricatorPriceindexPrefix}-${fabricatorTargetDefindex}` : null;
  const fabricatorUnresolved = isFabricatorKit && !fabricatorPriceindex;

  const statsUnresolved =
    effectUnresolved ||
    kitDefindexUnresolved ||
    targetToolDefindexUnresolved ||
    fabricatorUnresolved ||
    (skin.isDecoratedWeapon && skin.skinWeaponUnresolved);

  // Confirmed live: classic backpack.tf's own Sheen filter checkbox uses the
  // exact same value (e.g. value="7" for Hot Rod, data-key="sheen") as
  // next.backpack.tf's dropdown - Killstreaker uses the same "killstreaker"
  // data-key too, so one id table (utils/tf2AttributeIds.js) serves both sites.
  const sheenId = sheenName ? SHEEN_IDS[sheenName] : null;
  const killstreakerId = killstreakerName ? KILLSTREAKER_IDS[killstreakerName] : null;
  // Confirmed live only on next.backpack.tf's classifieds - classic
  // backpack.tf's equivalent isn't confirmed yet.
  const spellId = spellName ? SPELL_IDS[spellName] : null;
  const paintEntry = paintName ? PAINT_IDS[paintName] : null;

  return {
    effectId,
    kitTargetDefindex,
    targetToolDefindex,
    fabricatorPriceindex,
    statsUnresolved,
    sheenId,
    killstreakerId,
    spellId,
    paintEntry,
  };
}

/*
@description: Resolves an item's full identity (quality, skin/weapon,
killstreak tier, festivized, kit/fabricator/strangifier target, every id
needed to build a link, etc.) from its hovered DOM element and tooltip name.
This is the only async/schema-dependent step - everything in links.js that
consumes the returned shape is plain, synchronous string/URL building. Skin/
War Paint identity is delegated to skinDetection.js, and Kit/Fabricator/
Strangifier name matching to toolVariants.js - this function is the
orchestrator that resolves the rest and ties every piece together.
@args:
  - rawName: raw tooltip name of the item, possibly a Name Tag'd custom name
    rather than the item's real name (see resolveCustomNamedItem above)
  - itemEl: the hovered .item.hoverable element (source of quality/killstreak/
    craftability CSS classes and the data-content tooltip attribute)
@returns {ItemShape} - see the property comments below for what each field means.
*/
export async function detectItemShape(rawName, itemEl) {
  // --- CUSTOM NAME (Name Tag) RESOLUTION ---
  // Must happen before anything else below reads the name - a Name Tag
  // corrupts quality/skin/tool-variant detection just as much as it corrupts
  // the final display name if left unresolved.
  const nameTagResolved = await resolveCustomNamedItem(rawName, itemEl);

  // scrap.tf's data-title text can be mis-spelled even for a genuine item
  // (see getCanonicalItemName). A no-op for quality-prefixed names, which
  // never match a schema key; it helps bare Unique-quality names. See #151.
  const name = await getCanonicalItemName(nameTagResolved);

  // --- QUALITY DETECTION ---
  const classQualityName = getQualityNameFromClassList(itemEl.classList);
  // Reassigned below (inside detectSkin) if this turns out to be a Decorated
  // Weapon whose SKIN carries an Unusual effect independent of the base
  // item's own quality (e.g. a Strange-quality weapon with an Unusual-effect
  // skin) - see skinHasUnusualEffect.
  const initialUnusualEffectName = classQualityName === "Unusual" ? getUnusualEffectName(itemEl) : null;

  // --- WAR PAINT / DECORATED WEAPON (SKIN) DETECTION ---
  const skin = await detectSkin(name, itemEl, classQualityName, initialUnusualEffectName);
  const { qualityName, unusualEffectName } = skin;

  // --- KILLSTREAK DETECTION ---
  const { ksPrefix, ksTier } = detectOwnKillstreakTier(itemEl);
  // ksPrefix trimmed for display as its own modal line (e.g. "Professional
  // Killstreak") - it already reads naturally on its own for every tier
  // (including tier 1, which is just "Killstreak"), so no extra "Tier: "
  // label is needed the way Sheen/Killstreaker get one.
  const killstreakTierName = ksTier ? ksPrefix.trim() : null;

  // --- CRAFTABILITY DETECTION ---
  // The "uncraft" class is not always present (e.g. a Waterlogged Lab Coat
  // whose tooltip reads "Uncraftable"), so the tooltip text counts too.
  const isUncraft = itemEl.classList.contains("uncraft") || isMarkedUncraftableInTooltip(itemEl);
  const craftPathSegment = isUncraft ? "Non-Craftable" : "Craftable";

  // --- SHEEN / KILLSTREAKER / LEVEL / PAINT / SPELL DETECTION (tooltip data) ---
  const sheenName = getSheenName(itemEl);
  const killstreakerName = getKillstreakerName(itemEl);
  const level = getLevel(itemEl);
  const paintName = getPaintName(itemEl);
  const spellName = getSpellName(itemEl);

  // --- FESTIVIZED DETECTION ---
  // Like killstreak tier, "Festivized" isn't a CSS class or literal text in the
  // tooltip title - only visible in data-content (and a festive.svg mini-icon).
  // Confirmed live: it comes BEFORE the killstreak tier, and uses the full word
  // "Festivized" when combined with one, vs. the shorter "Festive" standalone
  // (e.g. "Strange Festivized Specialized Killstreak Australium Knife" vs.
  // "Festive Knife").
  const itemIsFestivized = isFestivized(itemEl);
  const festivePrefix = itemIsFestivized ? (ksPrefix ? "Festivized " : "Festive ") : "";

  // --- CLEAN NAME LOGIC ---
  // Strips whichever quality/killstreak prefix scrap.tf's raw name already
  // has (utils/tf2ItemName.js also handles the "Strange Part: ..."/"Strange
  // Count Transfer Tool" safeguards), so the canonical prefixes computed
  // above (qualityPrefix/festivePrefix/ksPrefix) can be re-added by links.js
  // without duplicating one. qualityName (the real, CSS-class-derived
  // quality) lets stripNamePrefix keep "Strange" in a literal item name it
  // does not hardcode.
  const baseName = stripNamePrefix(name, qualityName);

  // Name used for Stats: include Festive/KS prefixes if any.
  const statsName = festivePrefix + ksPrefix + baseName;
  const encodedStatsName = encodeURIComponent(statsName);

  // --- BOTKILLER DETECTION ---
  // A Botkiller weapon is a distinct, permanently-Strange weapon variant
  // ("{Grade} Botkiller {Weapon} Mk.{Tier}") - confirmed live via
  // marketplace.tf's own sbotkiller filter, which takes the grade word and
  // roman-numeral mark tier straight from the item's own name, no id table
  // needed: "Strange Carbonado Botkiller Wrench Mk.I" -> sbotkiller=
  // Carbonado_I. Matched against baseName (already quality-stripped) since
  // the grade word directly follows the quality word in the raw name.
  const botkillerMatch = /^(\w+) Botkiller (.+) Mk\.(I{1,3}|IV)$/i.exec(baseName);
  const isBotkiller = !!botkillerMatch;
  const botkillerGrade = botkillerMatch ? botkillerMatch[1] : null;
  const botkillerWeaponName = botkillerMatch ? botkillerMatch[2].trim() : null;
  const botkillerTier = botkillerMatch ? botkillerMatch[3].toUpperCase() : null;
  const botkillerSlug = isBotkiller ? `${botkillerGrade}_${botkillerTier}` : null;

  // --- TAUNT UNUSUALIFIER DETECTION ---
  // The title is just "Unusualifier" and its defindex (9258) is shared by
  // every target, but scrap.tf draws the tile with the target taunt's own
  // icon (seen live: background-image .../icons/taunt_the_bunnyhopper....png).
  // Only treated as one once both the taunt and its defindex resolve;
  // otherwise the links stay the plain "Unusualifier" ones.
  const unusualifierTargetName =
    baseName === "Unusualifier" ? await getTauntNameByIcon(iconNameFromUrl(itemEl.getAttribute("style"))) : null;
  const unusualifierTargetDefindex = unusualifierTargetName ? await getItemDefindex(unusualifierTargetName) : null;
  const isUnusualifier = !!unusualifierTargetDefindex;

  // --- KILLSTREAK KIT / KIT FABRICATOR / TARGET-ITEM TOOL (Strangifier) DETECTION ---
  const toolVariants = detectToolVariants(name);
  const {
    isKillstreakKit,
    killstreakKitTargetName,
    killstreakKitTier,
    killstreakKitTierWord,
    isTargetTool,
    targetToolTargetName,
    targetToolBaseItemName,
    isFabricatorKit,
    fabricatorKitTargetName,
    fabricatorKitTier,
    fabricatorKitTierWord,
  } = toolVariants;

  const {
    effectId,
    kitTargetDefindex,
    targetToolDefindex,
    fabricatorPriceindex,
    statsUnresolved,
    sheenId,
    killstreakerId,
    spellId,
    paintEntry,
  } = await resolveShapeIds({
    unusualEffectName,
    isKillstreakKit,
    killstreakKitTargetName,
    isTargetTool,
    targetToolTargetName,
    isFabricatorKit,
    fabricatorKitTargetName,
    fabricatorKitTier,
    skin,
    sheenName,
    killstreakerName,
    spellName,
    paintName,
  });

  return {
    // --- base identity ---
    qualityName,
    isUncraft,
    craftPathSegment,
    baseName,
    encodedStatsName,

    // --- Botkiller weapon variant ---
    isBotkiller,
    botkillerGrade,
    botkillerWeaponName,
    botkillerTier,
    botkillerSlug,

    // --- killstreak tier on the item itself (not a Kit/Fabricator) ---
    ksPrefix,
    ksTier,
    killstreakTierName,

    // --- festivized ---
    isFestivized: itemIsFestivized,
    festivePrefix,

    // --- unusual effect ---
    unusualEffectName,
    effectId,

    // --- display-only attributes (data-content derived) ---
    sheenName,
    sheenId,
    killstreakerName,
    killstreakerId,
    level,
    paintName,
    paintEntry,
    spellName,
    spellId,

    // --- Decorated Weapon (skin already applied to a weapon) ---
    isDecoratedWeapon: skin.isDecoratedWeapon,
    skinName: skin.skinName,
    wearName: skin.wearName,
    weaponName: skin.weaponName,
    skinQualityName: skin.skinQualityName,
    skinHasUnusualEffect: skin.skinHasUnusualEffect,
    textureId: skin.textureId,
    wearTierId: skin.wearTierId,

    // --- standalone War Paint tool ---
    isWarPaintTool: skin.isWarPaintTool,
    warPaintToolSkinName: skin.warPaintToolSkinName,
    warPaintToolWearName: skin.warPaintToolWearName,
    warPaintToolQuality: skin.warPaintToolQuality,
    warPaintToolQualityId: skin.warPaintToolQualityId,
    warPaintToolTextureId: skin.warPaintToolTextureId,
    // Whether Strange-tracking is attached, independent of qualityName -
    // see detectSkin's own hasStrangeTracking note (used by links.js's
    // marketplace.tf "sstrange" param for either skin branch).
    hasStrangeTracking: skin.hasStrangeTracking,

    // --- Killstreak Kit (crafting tool) ---
    isKillstreakKit,
    killstreakKitTargetName,
    killstreakKitTier,
    killstreakKitTierWord,
    kitTargetDefindex,

    // --- Killstreak Kit Fabricator ---
    isFabricatorKit,
    fabricatorKitTargetName,
    fabricatorKitTier,
    fabricatorKitTierWord,
    fabricatorPriceindex,

    // --- target-item tool (Strangifier, or a Strangifier Chemistry Set) ---
    isTargetTool,
    targetToolTargetName,
    targetToolBaseItemName,
    targetToolDefindex,

    // --- Taunt Unusualifier, with its target taunt resolved ---
    isUnusualifier,
    unusualifierTargetName: isUnusualifier ? unusualifierTargetName : null,
    unusualifierTargetDefindex,

    // whether any stats-page link couldn't be reliably resolved - if so,
    // links.js shows a "set up your Steam API key" prompt instead of a
    // potentially-broken stats link.
    statsUnresolved,
  };
}
