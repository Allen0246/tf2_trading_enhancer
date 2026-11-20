/*
@description: Pure URL-building layer for the itemLinks item card: every
function takes the resolved item shape from itemShape.js (or
resolveItemDetails.js's steamMarketName) and returns plain strings/hrefs,
with no DOM access. It mirrors utils/tf2StatsLinks/ for scrap.tf's own
DOM-derived shape; each builder documents its destination's confirmed URL
shape, which differs per item type and sometimes per site.
*/
import { STATS_KEY_HINT_LABEL, STATS_KEY_HINT_TITLE } from "../../utils/linkButtonStates.js";
import { WEAR_TIER_IDS } from "../../utils/warpaints.js";
import { QUALITY_ID_BY_NAME } from "../../utils/tf2Quality.js";
import { getItemDefindex } from "../../utils/tf2Schema.js";
import { MARKETPLACE_SPELL_SLUGS, findPaintEntry } from "../../utils/tf2AttributeIds.js";
import { hasLiteralAustraliumPrefix, base64EncodeUtf8 } from "../../utils/tf2StatsLinks/common.js";
import { buildTargetToolFullName } from "../../utils/tf2StatsLinks/targetTool.js";

/*
@description: A single labeled button prompting for a Steam Web API key.
`needsKey` makes itemCard.js render it with utils/linkButtonStates.js's key
hint (amber key icon; click opens the extension's own key settings, where
the key actually goes, rather than Steam's key page). No "reload" needed:
content.js re-renders the card when a key is saved. Used by buildStatsLinks;
it also covers posts.tf, whose own hint is skipped while this one shows.
*/
function buildApiKeyPromptLink(label) {
  return { label, href: null, needsKey: true, title: STATS_KEY_HINT_TITLE };
}

/*
@description: Whether buildPostsTfLink handles this item type at all (not
Kits/Fabricators/War Paint tools/Decorated Weapons/target-item tools), so
resolveItemDetails.js can tell "not supported" apart from "the defindex
lookup failed" (fixable with an API key).
*/
export function postsTfCoversItemType(shape) {
  return !shape.isKillstreakKit && !shape.isFabricatorKit && !shape.isWarPaintTool && !shape.isDecoratedWeapon && !shape.isTargetTool;
}

/*
@description: Builds the backpack.tf/next.backpack.tf stats links (or, if
anything needed to resolve them came back unresolved, a single fallback
prompt to set up a Steam API key) for the given resolved item shape (see
itemShape.js).
*/
export function buildStatsLinks(shape) {
  if (shape.statsUnresolved) {
    // Both backpack.tf/next.backpack.tf's stats AND classifieds links need
    // this.
    return [buildApiKeyPromptLink(STATS_KEY_HINT_LABEL)];
  }

  // Killstreak Kits use a completely different stats URL shape than normal
  // items, and the two sites differ from EACH OTHER too (confirmed live):
  // - backpack.tf (path-based): /stats/Unique/Professional Killstreak Kit/
  //   Tradable/Non-Craftable/3-205 - tier-prefixed "Killstreak Kit" name, plus
  //   a "{tier}-{targetDefindex}" path suffix.
  // - next.backpack.tf (query-string based): /stats?item=Kit&quality=Unique&
  //   killstreakTier=3&craftable=false&priceindex=3-205 - generic "Kit" name,
  //   tier as its own param, "craftable=false" as literal text, and
  //   "priceindex" instead of a path suffix.
  // Both always non-craftable: a Kit itself always is.
  const kitTierPrefix = { 3: "Professional ", 2: "Specialized " }[shape.killstreakKitTier] ?? "";
  const kitPriceindex = `${shape.killstreakKitTier}-${shape.kitTargetDefindex}`;

  const warPaintToolStatsName = shape.isWarPaintTool
    ? `${shape.warPaintToolSkinName} | War Paint (${shape.warPaintToolWearName})`
    : null;

  // Decorated Weapon (skin already applied to a weapon) classic stats shape -
  // confirmed live: /stats/Decorated Weapon/Necromanced | Black Box (Battle
  // Scarred)/Tradable/Craftable - same " | " insertion as a standalone War
  // Paint tool's own classic link, just with the resolved weapon name
  // instead of the literal word "War Paint".
  const decoratedWeaponStatsName =
    shape.isDecoratedWeapon && shape.weaponName ? `${shape.skinName} | ${shape.weaponName} (${shape.wearName})` : null;

  // Target-item tools always link their plain Unique stats page (same as
  // utils/tf2StatsLinks/targetTool.js). Every quality path segment is
  // percent-encoded: "Collector's" needs %27 and "Decorated Weapon" %20.
  // Target tools use targetToolBaseItemName, which is "Chemistry Set" for a
  // Strangifier Chemistry Set (see #94).
  const statsPath = shape.isKillstreakKit
    ? `Unique/${encodeURIComponent(`${kitTierPrefix}Killstreak Kit`)}/Tradable/Non-Craftable/${kitPriceindex}`
    : shape.isFabricatorKit
    ? `Unique/${encodeURIComponent("Fabricator")}/Tradable/${shape.craftPathSegment}/${shape.fabricatorPriceindex}`
    : shape.isWarPaintTool
    ? `${encodeURIComponent(shape.warPaintToolQuality)}/${encodeURIComponent(warPaintToolStatsName)}/Tradable/${shape.craftPathSegment}`
    : decoratedWeaponStatsName
    ? `${encodeURIComponent(shape.qualityName)}/${encodeURIComponent(decoratedWeaponStatsName)}/Tradable/${shape.craftPathSegment}`
    : shape.isTargetTool
    ? `Unique/${encodeURIComponent(shape.targetToolBaseItemName)}/Tradable/${shape.craftPathSegment}/${shape.targetToolDefindex}`
    : `${encodeURIComponent(shape.qualityName)}/${shape.encodedStatsName}/Tradable/${shape.craftPathSegment}` +
      (shape.effectId ? `/${shape.effectId}` : "");

  // Decorated Weapons (skins) use yet another next.backpack.tf stats scheme -
  // confirmed live: /stats?item=Black Box&quality=15&wearTier=Battle
  // Scarred&texture=Necromanced - resolved weapon name, wearTier/texture as
  // literal NAMES, but quality is the NUMERIC id (15, "Decorated Weapon"'s
  // id) for the default variant, NOT the literal text "Decorated Weapon" -
  // only the Strange-tracking variant uses literal "Strange" text (same as
  // utils/tf2StatsLinks/decoratedWeapon.js). killstreakTier is sent when the
  // skin has a tier (not confirmed to be part of this shape).
  let nextStatsHref;
  if (shape.isKillstreakKit) {
    nextStatsHref = `https://next.backpack.tf/stats?${new URLSearchParams({
      item: "Kit",
      quality: "Unique",
      killstreakTier: String(shape.killstreakKitTier),
      craftable: "false",
      priceindex: kitPriceindex,
    }).toString()}`;
  } else if (shape.isDecoratedWeapon && shape.weaponName) {
    // Both Unusual and Strange use literal quality text, only the plain default
    // variant uses the numeric id - same rule steamcommunity.com's own
    // createBpStatsLinkDecoratedWeapon (utils/tf2StatsLinks/decoratedWeapon.js)
    // already establishes for this exact item type. See #95.
    const skinStatsParams = new URLSearchParams({
      item: shape.weaponName,
      quality: shape.qualityName === "Strange" || shape.qualityName === "Unusual" ? shape.qualityName : String(QUALITY_ID_BY_NAME["Decorated Weapon"]),
      wearTier: shape.wearName,
      texture: shape.skinName,
    });
    if (shape.ksTier) {
      skinStatsParams.set("killstreakTier", String(shape.ksTier));
    }
    nextStatsHref = `https://next.backpack.tf/stats?${skinStatsParams.toString()}`;
  } else if (shape.isUnusualifier) {
    // Confirmed live: /stats?item=Unusualifier&quality=Unusual&craftable=
    // false&priceindex=30920 (the target taunt's defindex). Classic
    // backpack.tf keeps the plain path below.
    nextStatsHref = `https://next.backpack.tf/stats?${new URLSearchParams({
      item: shape.baseName,
      quality: shape.qualityName,
      craftable: shape.isUncraft ? "false" : "true",
      priceindex: String(shape.unusualifierTargetDefindex),
    }).toString()}`;
  } else if (shape.isWarPaintTool) {
    // Confirmed live: /stats?item=War Paint&quality=Decorated Weapon&
    // wearTier=Factory New&texture=Dragon Slayer - same shape as the
    // Decorated Weapon (skin) case above, but with the literal generic
    // "War Paint" item name instead of a resolved weapon name. quality is
    // "Strange" instead for the Strange-tracking variant.
    nextStatsHref = `https://next.backpack.tf/stats?${new URLSearchParams({
      item: "War Paint",
      quality: shape.warPaintToolQuality,
      wearTier: shape.warPaintToolWearName,
      texture: shape.warPaintToolSkinName,
    }).toString()}`;
  } else {
    nextStatsHref = `https://next.backpack.tf/stats/${statsPath}`;
  }

  return [
    { label: "next.backpack.tf stats", href: nextStatsHref },
    { label: "backpack.tf stats", href: `https://backpack.tf/stats/${statsPath}` },
  ];
}

/*
@description: Derives the classifieds search filter values shared by both
buildClassifiedsHref and buildNextClassifiedsHref, so the two don't
independently re-derive (and risk disagreeing on) the same values.

Classifieds splits "Australium"/killstreak tier out into their own filter
attributes instead of keeping them embedded in the item name the way the
stats page/Steam Market do - confirmed live: "item=Rocket Launcher&...
&australium=1&killstreak_tier=1", not "item=Killstreak Australium Rocket
Launcher". So the returned itemName gets neither prefix, unlike
baseName/statsName (stats link) which keep killstreak, and steamMarketName
which also keeps quality/festive.
*/
function deriveClassifiedsFilters(shape) {
  // Classic backpack.tf has no confirmed target filter for Strangifiers
  // (unlike Kits'/Fabricators' item_type=target), so this searches the
  // tool's canonical name ("Strangifier", or "Chemistry Set" for a
  // Strangifier Chemistry Set). Kits and Fabricators search by their target
  // weapon, and a Decorated Weapon by its resolved weapon name.
  const classifiedsBaseName =
    shape.killstreakKitTargetName ??
    shape.fabricatorKitTargetName ??
    (shape.isTargetTool ? shape.targetToolBaseItemName : shape.isDecoratedWeapon && shape.weaponName ? shape.weaponName : shape.baseName);
  const isAustralium = hasLiteralAustraliumPrefix(classifiedsBaseName);
  const itemName = isAustralium ? classifiedsBaseName.replace(/^Australium /i, "") : classifiedsBaseName;

  // A numbered Crate/Strongbox/etc. (e.g. "Mann Co. Supply Crate Series #26",
  // "Mann Co. Strongbox Series #81") carries its own series number as a
  // literal "Series #{n}" suffix, which classifieds filters take directly
  // (mirrors utils/tf2StatsLinks/index.js's resolveClassifiedsFilters).
  //
  // Deliberately does NOT strip this suffix off `itemName` itself - that
  // field is also consumed by marketplace.tf's own sterm below, which has no
  // confirmed crateSeries-equivalent filter (so it keeps the FULL name,
  // suffix included). crateBaseItemName is the stripped name, used by BOTH
  // buildNextClassifiedsHref (crateSeries={n}) and buildClassifiedsHref's own
  // confirmed equivalent (numeric=crate&value={n}&low={n} - a completely
  // different param shape, same underlying number).
  const crateSeriesMatch = /^(.+) Series #(\d+)$/i.exec(itemName);
  const crateSeries = crateSeriesMatch ? Number(crateSeriesMatch[2]) : null;
  const crateBaseItemName = crateSeriesMatch ? crateSeriesMatch[1].trim() : null;

  const killstreakTier = shape.killstreakKitTier ?? shape.fabricatorKitTier ?? shape.ksTier;
  const quality = String(QUALITY_ID_BY_NAME[shape.qualityName] ?? QUALITY_ID_BY_NAME.Unique);

  // For a Killstreak Kit OR Fabricator search, isUncraft reflects the
  // hovered item's own craftability (the Fabricator tool itself, or - for a
  // Kit - the tile it was hovered from), not the Kit being searched for -
  // the Kit itself is always non-craftable, so hardcode that instead of
  // using the hovered item's own value.
  const craftable = shape.isKillstreakKit || shape.isFabricatorKit ? "-1" : shape.isUncraft ? "-1" : "1";
  // Confirmed live: next.backpack.tf uses a 0/1 true/false convention for its
  // boolean-ish filters (also true of festivized), unlike classic
  // backpack.tf's -1/1 - so these need separate values, not one shared one.
  const nextCraftable = craftable === "-1" ? "0" : "1";
  const nextAustralium = isAustralium ? "1" : "0";
  const classicAustralium = isAustralium ? "1" : "-1";

  // Classic backpack.tf's "paint" param is the color's decimal RGB value,
  // not next.backpack.tf's own id - confirmed live: #141414 -> 1315860.
  //
  // Self-matches itemName against the same PAINT_IDS table (a Paint Can
  // itself, e.g. "Aged Moustache Grey", never has a "Painted X" tooltip line
  // the way shape.paintEntry normally resolves from - it's not a painted
  // item, it IS the paint); only tried when shape.paintEntry wasn't already
  // resolved, so this can never override an actually-painted item's own real
  // paint. See #77.
  const paintEntry = shape.paintEntry ?? findPaintEntry(itemName);
  const classicPaintId = paintEntry ? parseInt(paintEntry.color.slice(1), 16) : null;
  const paintId = paintEntry?.id ?? null;

  return { itemName, quality, craftable, nextCraftable, classicAustralium, nextAustralium, killstreakTier, classicPaintId, paintId, crateSeries, crateBaseItemName };
}

/*
@description: Builds the classic backpack.tf classifieds search URL.
*/
export function buildClassifiedsHref(shape) {
  if (shape.isWarPaintTool) {
    // Confirmed live: item=War Paint&quality=15&tradable=1&craftable=1&
    // texture_name=Dragon Slayer&wear=Factory New&australium=-1&
    // killstreak_tier=0 - literal texture/wear NAMES (opposite convention
    // from next.backpack.tf, which uses numeric ids for both). quality is 11
    // instead for the Strange-tracking variant (not independently confirmed
    // for classic, just assumed to match next's confirmed behavior).
    const params = new URLSearchParams({
      item: "War Paint",
      quality: shape.warPaintToolQualityId,
      tradable: "1",
      craftable: "1",
      texture_name: shape.warPaintToolSkinName,
      wear: shape.warPaintToolWearName,
      australium: "-1",
      killstreak_tier: "0",
    });
    // Same conditional (no "none" sentinel) convention the generic branch
    // already uses for classic (see skinDetection.js's own
    // warPaintToolHasUnusualEffect note). See #96.
    if (shape.effectId) {
      params.set("particle", String(shape.effectId));
    }
    return `https://backpack.tf/classifieds?${params.toString()}`;
  }

  const filters = deriveClassifiedsFilters(shape);
  const params = new URLSearchParams({
    // crateBaseItemName (the "Series #{n}" suffix stripped off) only for a
    // numbered Crate/Strongbox/etc. - see deriveClassifiedsFilters' own note.
    item: filters.crateSeries ? filters.crateBaseItemName : filters.itemName,
    quality: filters.quality,
    tradable: "1",
    craftable: filters.craftable,
    australium: filters.classicAustralium,
    killstreak_tier: String(filters.killstreakTier),
  });
  if (shape.effectId) {
    params.set("particle", String(shape.effectId));
  }
  // Confirmed live for a numbered Crate/Strongbox/etc. (both Mann Co. Supply
  // Crate Series #26 and Naughty Winter Crate 2014 Series #88): classic
  // backpack.tf's classifieds filters on it via a generic "numeric"
  // attribute-range system (numeric=crate&value={n}&low={n}) rather than a
  // dedicated crateSeries-style param - both value AND low take the SAME
  // printed series number (no confirmed example of an open-ended range),
  // matching next.backpack.tf's own single-value crateSeries filter.
  if (filters.crateSeries) {
    params.set("numeric", "crate");
    params.set("value", String(filters.crateSeries));
    params.set("low", String(filters.crateSeries));
  }
  if (shape.isKillstreakKit || shape.isFabricatorKit) {
    params.set("item_type", "target");
  }
  if (shape.isDecoratedWeapon) {
    if (shape.textureId) params.set("texture", String(shape.textureId));
    if (shape.wearTierId) params.set("wear", String(shape.wearTierId));
    if (shape.skinName) params.set("texture_name", shape.skinName);
    if (shape.wearTierId) params.set("wear_tier", String(shape.wearTierId));
  }
  if (shape.sheenId) {
    params.set("sheen", String(shape.sheenId));
  }
  if (shape.killstreakerId) {
    params.set("killstreaker", String(shape.killstreakerId));
  }
  // Confirmed live: classic backpack.tf uses the literal spell NAME here
  // (e.g. "Spectral Spectrum"), not next.backpack.tf's composite
  // "{type}-{spellId}" string.
  if (shape.spellName) {
    params.set("spell", shape.spellName);
  }
  // Skipped for an Unusual even when it also has a paint applied (TF2 does
  // allow a painted Unusual) - same reasoning as marketplace.tf's own
  // spaint[] below: filtering by the specific paint color on top of the
  // specific Unusual effect narrows the search far more than wanted, since
  // what makes an Unusual worth finding is the effect, not whichever paint
  // that one listing happens to have.
  if (filters.classicPaintId && !shape.unusualEffectName) {
    params.set("paint", String(filters.classicPaintId));
  }
  return `https://backpack.tf/classifieds?${params.toString()}`;
}

/*
@description: Builds the next.backpack.tf classifieds search URL. Diverges
from the classic one in several confirmed-live ways per item type - see the
inline notes in each branch.
*/
export function buildNextClassifiedsHref(shape) {
  const filters = deriveClassifiedsFilters(shape);

  // next.backpack.tf uses a completely different scheme for Killstreak Kit
  // target searches than classic backpack.tf - confirmed live:
  // "itemName=Kit&quality=6&targetItem=Rocket Launcher&killstreakTier=3",
  // not "itemName=<weapon>&item_type=target" like the classic site. itemName
  // is the literal generic "Kit" (no tier prefix - killstreakTier is its own
  // param), and the target weapon goes in "targetItem" instead. The confirmed
  // example also has no tradable/craftable/australium/festivized params at
  // all, so those are left off here too rather than guessed back in.
  let params;
  if (shape.isKillstreakKit) {
    params = new URLSearchParams({
      itemName: "Kit",
      quality: filters.quality,
      targetItem: filters.itemName,
      killstreakTier: String(filters.killstreakTier),
    });
  } else if (shape.isFabricatorKit) {
    // Same minimal shape as a Kit's own next.backpack.tf classifieds link
    // above (no tradable/craftable/australium/festivized), just itemName=
    // "Fabricator" instead of "Kit" (same as
    // utils/tf2StatsLinks/common.js's buildNextTargetClassifiedsLink).
    params = new URLSearchParams({
      itemName: "Fabricator",
      quality: filters.quality,
      targetItem: filters.itemName,
      killstreakTier: String(filters.killstreakTier),
    });
  } else if (shape.isWarPaintTool) {
    // Confirmed live: itemName=War Paint&quality=15&texture=390&wearTier=1 -
    // numeric texture/wearTier ids here, opposite of classic backpack.tf's
    // literal texture_name/wear above. No tradable/craftable/australium/
    // festivized in the confirmed example, so left off rather than guessed.
    // quality is 11 instead for the Strange-tracking variant (also confirmed
    // live).
    params = new URLSearchParams({
      itemName: "War Paint",
      quality: shape.warPaintToolQualityId,
    });
    if (shape.warPaintToolTextureId) {
      params.set("texture", String(shape.warPaintToolTextureId));
    }
    const warPaintToolWearTierId = WEAR_TIER_IDS[shape.warPaintToolWearName];
    if (warPaintToolWearTierId) {
      params.set("wearTier", String(warPaintToolWearTierId));
    }
    // The id or the literal "none" (not omitted), as in the generic branch
    // below: omitting it mixes in Unusual-effect results.
    params.set("particle", shape.effectId ? String(shape.effectId) : "none");
  } else {
    // Only next.backpack.tf's classifieds search supports filtering by
    // Festivized - the classic backpack.tf/classifieds has no equivalent param.
    // Sent explicitly as 1/0: like australium, omitting it means "don't
    // filter" rather than "false". For Decorated Weapons, itemName is the
    // resolved base weapon (e.g. "Soda Popper"); australium/killstreakTier/
    // festivized still apply to them.
    params = new URLSearchParams({
      itemName: shape.isDecoratedWeapon && shape.weaponName
        ? shape.weaponName
        : filters.crateSeries
        ? filters.crateBaseItemName
        : filters.itemName,
      quality: filters.quality,
      tradable: "1",
      craftable: filters.nextCraftable,
      australium: filters.nextAustralium,
      killstreakTier: String(filters.killstreakTier),
      festivized: shape.isFestivized ? "1" : "0",
    });
    // Same "particle" param name as classic backpack.tf, assumed (not
    // independently confirmed against a live next.backpack.tf Unusual link).
    // The id or "none", same reasoning as festivized: without them a plain
    // weapon search also returns Unusual/skinned listings.
    params.set("particle", shape.effectId ? String(shape.effectId) : "none");
    params.set("texture", shape.textureId ? String(shape.textureId) : "none");
    if (shape.wearTierId) {
      params.set("wearTier", String(shape.wearTierId));
    }
  }

  // sheenId/killstreakerId reused from the shared shape here too - applying
  // the same param names outside the Kit branch above (an actual
  // Professional/Specialized Killstreak weapon with a Sheen/Killstreaker
  // already on it) is assumed, not independently confirmed.
  if (shape.sheenId) {
    params.set("sheen", String(shape.sheenId));
  }
  if (shape.killstreakerId) {
    params.set("killstreaker", String(shape.killstreakerId));
  }
  // The id or "none": without it a spell-less search also returns spelled
  // listings.
  params.set("spell", shape.spellId || "none");
  // The id or "none" (an unpainted search otherwise returns painted
  // listings), but never sent for an Unusual: the effect is what matters
  // there, not the paint.
  if (!shape.unusualEffectName) {
    params.set("paint", filters.paintId ? String(filters.paintId) : "none");
  }
  // Target-item tools only - next.backpack.tf's classifieds search has a
  // dedicated targetItem param the stats link has no equivalent slot for.
  // e.g. itemName=Strangifier&...&targetItem=Righteous%20Bison.
  if (shape.isTargetTool) {
    params.set("targetItem", shape.targetToolTargetName);
  }
  // Same param for a Taunt Unusualifier (confirmed live:
  // itemName=Unusualifier&quality=5&...&targetItem=Taunt: The Bunnyhopper).
  if (shape.isUnusualifier) {
    params.set("targetItem", shape.unusualifierTargetName);
  }
  // Numbered Crate/Strongbox (see deriveClassifiedsFilters); only sent when
  // present. Classic backpack.tf uses numeric=crate&value=&low= instead
  // (buildClassifiedsHref).
  if (filters.crateSeries) {
    params.set("crateSeries", String(filters.crateSeries));
  }
  return `https://next.backpack.tf/classifieds?${params.toString()}`;
}

/*
@description: Builds the Steam Community Market item name for this item.

Unlike backpack.tf, Steam's market_hash_name keeps quality and killstreak
prefixes as part of the name instead of splitting them into their own URL
segments - rebuild the full name from the same quality/killstreak data
already resolved by itemShape.js, rather than trusting the raw tooltip text:
quality words like "Strange"/"Vintage" do appear literally in it, but
"Killstreak"/"Specialized Killstreak"/"Professional Killstreak"/"Unusual"
don't - those are only conveyed via the item's CSS class, so relying on the
raw text silently dropped them (e.g. "Strange Australium Knife" instead of
"Strange Specialized Killstreak Australium Knife").

"Unique" and "Decorated Weapon" are both excluded from the prefix: "Unique"
because it's TF2's baseline/default quality and never shown as a word on
Steam, and "Decorated Weapon" because - unlike every other entry in
QUALITY_ID_BY_NAME - it's backpack.tf's own internal label for that quality
slot (see utils/tf2Quality.js), not a word Steam (or the game) ever actually
displays; a plain (non-Strange) Decorated Weapon's real market_hash_name is
just "{Skin} {Weapon} ({Wear})", the same as its in-game name.

Branches on shape.isDecoratedWeapon and builds the name from
shape.skinName/weaponName/wearName (see skinDetection.js's own note on
resolving them from the skin-preview image URL, since scrap.tf's own raw
tooltip title isn't reliably parseable for skin/wear text at all) rather
than the generic baseName-based return, which for a Decorated Weapon is
just the bare weapon name, not "{skin} {weapon} ({wear})". Steam's real
market_hash_name here is NOT the "{weapon} | {skin} ({wear})" pipe format
CS:GO-style skins use - per this doc comment's own already-confirmed
convention, it's the same plain space-joined "{skin} {weapon} ({wear})"
shape as the item's in-game name (see resolveItemDetails.js's own
decoratedWeaponDisplayName).
See #97.
*/
export function buildSteamMarketName(shape) {
  if (shape.isKillstreakKit) {
    // Killstreak Kits need "Killstreak" reinserted here too, but unlike the
    // stats page (generic name + defindex suffix), Steam's market_hash_name
    // keeps the target weapon's name: "Professional Killstreak Rocket
    // Launcher Kit", confirmed live - not "Professional Rocket Launcher Kit".
    return `${shape.killstreakKitTierWord}Killstreak ${shape.killstreakKitTargetName} Kit`;
  }

  if (shape.isFabricatorKit) {
    // Same "Killstreak" reinsertion as the Kit case above, and for the same
    // reason (see toolVariants.js's own fabricatorKitTierWord note) -
    // confirmed live: scrap.tf's "Specialized Conniver's Kunai Kit
    // Fabricator" is Steam's "Specialized Killstreak Conniver's Kunai Kit
    // Fabricator".
    return `${shape.fabricatorKitTierWord}Killstreak ${shape.fabricatorKitTargetName} Kit Fabricator`;
  }

  const qualityPrefix = shape.qualityName !== "Unique" && shape.qualityName !== "Decorated Weapon" ? `${shape.qualityName} ` : "";

  // Confirmed live: "Unusual Taunt: The Bunnyhopper Unusualifier" (Steam
  // Market and stntrading.eu).
  if (shape.isUnusualifier) {
    return `${qualityPrefix}${shape.unusualifierTargetName} ${shape.baseName}`;
  }

  if (shape.isDecoratedWeapon && shape.skinName && shape.weaponName && shape.wearName) {
    return `${qualityPrefix}${shape.ksPrefix}${shape.skinName} ${shape.weaponName} (${shape.wearName})`;
  }

  return `${qualityPrefix}${shape.festivePrefix}${shape.ksPrefix}${shape.baseName}`;
}

/*
@description: Builds the Steam Community Market listing URL for this item,
pre-filtered to the item's own Unusual effect/Killstreaker/Sheen/Paint/
craftability when it has one, using the same names already extracted for the
modal's "Effect: .../Killstreaker: .../Sheen: .../Painted: ..." lines.
Confirmed live: killstreaker+sheen combine as a single comma-separated q
param, e.g. "q=Fire Horns,Hot Rod", and a non-craftable item adds the literal
filter text "Not Usable in Crafting" the same way - confirmed live for a
plain Strange Voodoo Juju (no Unusual/Killstreaker/Sheen) with just that one
term: q=Not Usable in Crafting.

Paint name (e.g. "Australium Gold") confirmed live too, for a painted
Strange hat with no Unusual/Killstreak attributes at all ("Strange Lazer
Gazers"): q=Australium Gold. Deliberately NOT added when the item is
Unusual, though - same reasoning as this file's own classic/next
backpack.tf classifieds "paint" params (see deriveClassifiedsFilters'
classicPaintId usage above): filtering by the specific paint color on top of
the specific Unusual effect narrows the search far more than wanted, since
what makes an Unusual worth finding is the effect, not whichever paint that
one listing happens to have. No separate "is this a hat" check needed either
- paintName only ever resolves at all for an actually-painted item (weapons
can't carry a Paint attribute in TF2), so gating on it being present already
excludes weapons on its own.
*/
export function buildSteamMarketHref(shape, steamMarketName) {
  // A Taunt Unusualifier's listing page is already that exact item (and every
  // Unusualifier is uncraftable), so it gets no filter - confirmed live.
  if (shape.isUnusualifier) {
    return `https://steamcommunity.com/market/listings/440/${encodeURIComponent(steamMarketName)}`;
  }

  const marketFilterTerms = [
    ...(shape.unusualEffectName
      ? [shape.unusualEffectName]
      : [shape.killstreakerName, shape.sheenName, shape.paintName].filter(Boolean)),
    ...(shape.isUncraft ? ["Not Usable in Crafting"] : []),
  ];

  let href = `https://steamcommunity.com/market/listings/440/${encodeURIComponent(steamMarketName)}`;
  if (marketFilterTerms.length) {
    const params = new URLSearchParams({ appid: "440", q: marketFilterTerms.join(",") });
    href += `?${params.toString()}`;
  }
  return href;
}

/*
@description: Builds stntrading.eu's own item page URL - confirmed live:
https://stntrading.eu/item/tf2/Strange+War+Pig for a plain Strange War Pig.
For the general case this is steamMarketName: stntrading.eu's own item
titles follow Steam's market_hash_name format (stntrading.eu/link2Backpack
builds working Steam Market links straight from them).

An Unusual is a third convention: it keeps the literal "Unusual" and inserts
the effect right after it (e.g.
https://stntrading.eu/item/tf2/Unusual+Cuban+Smoke+Throttlehead), unlike
Steam's "Unusual {Item}" or gladiator.tf's "{Effect} {Item}". Unusuals
combined with Festivized/Killstreak, and Decorated Weapons/Kits/
Fabricators/target tools, are inferred from the general case, not
confirmed.

A path segment, not a query string - joined with a literal "+" between words
to match the confirmed-live URL shape above (not percent-encoded %20), with
encodeURIComponent still applied per-word to safely handle any other special
characters (apostrophes, etc.) within an individual word.
*/
export function buildStnTradingHref(shape, steamMarketName) {
  const itemName =
    shape.qualityName === "Unusual" && shape.unusualEffectName
      ? steamMarketName.replace(/^Unusual\s+/, `Unusual ${shape.unusualEffectName} `)
      : steamMarketName;

  const encodedWords = itemName.split(" ").map(encodeURIComponent);
  return `https://stntrading.eu/item/tf2/${encodedWords.join("+")}`;
}

/*
@description: Builds a posts.tf item-search URL for this resolved item shape,
using the "q=base64({u,p,d,m})" scheme documented on
utils/tf2StatsLinks/index.js's buildPostsTfLink (this file's shape differs
from that file's filters, hence the twin). "Australium " is stripped from
baseName for the defindex lookup and sent as its own boolean.

Returns null for unsupported item types (postsTfCoversItemType) and when
the defindex lookup fails (no Steam Web API key, or a schema miss).

Paint is deliberately skipped whenever the item is also Unusual (TF2 does
allow a painted Unusual) - same reasoning as this file's own classic/next
backpack.tf classifieds "paint"/"spaint[]" exclusion above: filtering by the
specific paint color on top of the specific Unusual effect narrows the search
far more than wanted.
See #1.
*/
export async function buildPostsTfLink(shape) {
  if (!postsTfCoversItemType(shape)) {
    return null;
  }

  const isAustralium = hasLiteralAustraliumPrefix(shape.baseName);
  const bareWeaponName = isAustralium ? shape.baseName.replace(/^Australium\s+/i, "").trim() : shape.baseName;

  const defindex = await getItemDefindex(bareWeaponName);
  if (defindex == null) return null;

  const item = {
    defindex,
    quality: QUALITY_ID_BY_NAME[shape.qualityName] ?? QUALITY_ID_BY_NAME.Unique,
    craftable: !shape.isUncraft,
  };
  if (isAustralium) item.australium = true;
  if (shape.effectId) item.effect = shape.effectId;
  if (shape.ksTier) item.killstreak = shape.ksTier;
  if (shape.paintName && !shape.unusualEffectName) item.paint = shape.paintName;
  if (shape.spellName) item.spells = [shape.spellName];

  const payload = { u: [item], p: [], d: "", m: false };
  const base64 = base64EncodeUtf8(JSON.stringify(payload)).replace(/=+$/, "");
  return `https://posts.tf/posts/search/results?q=${encodeURIComponent(base64)}`;
}

/*
@description: Builds mannco.store's own filtered-search query params - same
shapes backpack.tf/nextUI/addMannStoreButton/content.js's own
buildMannStoreParams documents (confirmed live), sourced from this feature's
own already-resolved shape (itemShape.js) instead of re-scanning tooltip DOM
for them - every signal this needs (qualityName, killstreakTierName,
isFestivized, sheenName, killstreakerName, paintName, unusualEffectName) is
already plain display-name text on shape, not an id needing its own reverse
lookup (shape.killstreakTierName - null/"Killstreak"/"Specialized
Killstreak"/"Professional Killstreak" - is already the exact same text
mannco's own dropdown uses, so no separate tier-number table is needed here
the way the other ports needed one). Kits/Fabricators and target-item tools
get their own bare-search shapes (see the branches below); null only for a
standalone War Paint tool, which this hasn't been built for yet - same scope
gap every other mannco.store button port already has.
*/
export function buildMannStoreHref(shape) {
  // Bare-searches the item's own full reconstructed name (buildSteamMarketName
  // already rebuilds "{tier }Killstreak {target} Kit"/"...Kit Fabricator" from
  // the shape, same string the Steam Market button already searches with) plus
  // its own Sheen/Killstreaker as real filters when known -
  // shape.sheenName/killstreakerName are resolved generically off the hovered
  // item's own data-content tooltip (tooltipData.js's
  // getSheenName/getKillstreakerName), not scoped to any one item type, so a
  // Kit's own fixed Sheen/Killstreaker (or a Fabricator's own finished-Kit
  // output, if its tooltip states it the same plain "Sheen: X"/"Killstreaker:
  // Y" way - NOT independently confirmed live for a Fabricator specifically,
  // unlike the Kit case) already lands here with no extra plumbing needed.
  // Same "sheen"/"killstreaker" param names the generic branch below already
  // uses. See #39.
  if (shape.isKillstreakKit || shape.isFabricatorKit) {
    const params = new URLSearchParams({ search: buildSteamMarketName(shape) });
    if (shape.sheenName) params.set("sheen", shape.sheenName);
    if (shape.killstreakerName) params.set("killstreaker", shape.killstreakerName);
    return `https://mannco.store/tf2?${params.toString()}`;
  }
  // A bare "search" for the full target-tool name (see
  // buildTargetToolFullName). See #98.
  if (shape.isTargetTool) {
    const params = new URLSearchParams({ search: buildTargetToolFullName(shape.targetToolBaseItemName, shape.targetToolTargetName) });
    return `https://mannco.store/tf2?${params.toString()}`;
  }
  if (shape.isWarPaintTool) {
    return null;
  }

  const decorated = shape.isDecoratedWeapon && shape.weaponName ? shape : null;
  const itemName = decorated ? decorated.weaponName : shape.baseName;
  // A Decorated Weapon's own qualityName defaults to backpack.tf's internal
  // "Decorated Weapon" pseudo-quality label (see buildMarketplaceHref's own
  // "!== 'Decorated Weapon'" checks) - mannco has no such concept, a real
  // Decorated Weapon is only ever Unique or Strange in-game.
  const qualityName = decorated ? (shape.qualityName === "Strange" ? "Strange" : "Unique") : shape.qualityName;
  // Festivized isn't confirmed combined with a skin anywhere in this
  // codebase (same gap the Steam inventory page's own port flags) - omitted
  // for a Decorated Weapon rather than guessed.
  const isFestivized = decorated ? false : shape.isFestivized;
  const knownSkinName = decorated ? decorated.skinName : null;

  const params = new URLSearchParams();
  // A Taunt Unusualifier searches its full Steam name (confirmed live:
  // search=Unusual Taunt: The Bunnyhopper Unusualifier).
  params.set("search", shape.isUnusualifier ? buildSteamMarketName(shape) : itemName);
  if (qualityName) params.set("quality", qualityName);
  params.set("festivized", isFestivized ? "Festivized" : "No festivized");
  params.set("killstreak", shape.killstreakTierName || "No");
  params.set("warpaints", knownSkinName || "No WarPaints");
  if (shape.sheenName) params.set("sheen", shape.sheenName);
  if (shape.killstreakerName) params.set("killstreaker", shape.killstreakerName);
  // Never applied for an Unusual - same exclusion rule every other
  // mannco.store button port enforces.
  if (shape.paintName && shape.qualityName !== "Unusual") params.set("paint", shape.paintName);
  if (shape.unusualEffectName) params.set("effect", shape.unusualEffectName);

  return `https://mannco.store/tf2?${params.toString()}`;
}

/*
@description: Builds a marketplace.tf browse/search URL, pre-filtered to
this item's quality/craftable/killstreak/festivized/australium state.

Confirmed live for a basic Unique craftable hat with none of the other
attributes: https://marketplace.tf/browse/tf2?squality%5B%5D=6&sstrange=0&
scraftable=1&skillstreak=0&spaintkit=-2&seffect%5B%5D=-2&sbotkiller=none&
sfestivized=0&saustralium=0&sterm=Brothers+in+Blues - which confirms
squality[] takes the same Valve quality id used everywhere else in this
codebase, sfestivized/saustralium/skillstreak are plain 0/1(/tier) booleans
("off" = 0, unlike classic backpack.tf's own -1/1 convention - reused here
from deriveClassifiedsFilters' next.backpack.tf-flavored
nextAustralium/killstreakTier rather than re-derived), and spaintkit/
seffect[] use -2 as their "not filtering on this" sentinel.

scraftable IS sent, filtering to the hovered item's own craftable state - the
plain 0/1 convention confirmed live for the basic hat above (craftable=1),
reused from deriveClassifiedsFilters' nextCraftable. The non-craftable value
(0) is assumed from the general "off = 0" convention, not confirmed.

Also confirmed live, for both a Strange hat and a Strange weapon (no
killstreak): squality[]=11&sstrange=1 together - so sstrange IS a general "is
Strange" toggle sent alongside the Strange quality id, not only a
Decorated-Weapon-specific flag; set whenever the
item's own quality is Strange (covers a Strange-tracking Decorated
Weapon/War Paint tool too, since skinDetection.js already overrides
qualityName to "Strange" for those).

Also confirmed live, for a Strange painted hat: spaint[]=12073019 - decimal
12073019 is hex b8383b, PAINT_IDS' "Team Spirit" - so spaint[] takes the same
decimal-RGB paint id classic backpack.tf's own "paint" param uses (already
computed as classicPaintId), just array-bracketed like squality[]/seffect[].
Omitted entirely (like every other filter here) rather than sent as "0"/none
when the item isn't painted.

Deliberately NOT sent for an Unusual item even when it also has a paint
applied (TF2 does allow a painted Unusual) - filtering by the specific paint
color on top of the specific Unusual effect narrows the search far more than
wanted, since what makes an Unusual worth finding is the effect, not
whichever paint that one listing happens to have.

A standalone War Paint tool (not applied to a weapon) and a Decorated Weapon
(a skin already applied to a weapon) both use a completely different, more
skin-specific param set from the general case below - no squality[]/
seffect[]/spaintkit=-2 sentinel at all. Confirmed live for the War Paint tool
"Forest Fire Mk.II War Paint (Factory New)" (Unique, no other attributes):
https://marketplace.tf/browse/tf2?sstrange=0&skillstreak=0&swear=1&
sfestivized=0&saustralium=0&sterm=Forest+Fire+Mk.II+War+Paint+%28Factory+New%29
- and for a Decorated Weapon, a Specialized Killstreak "Macaw Masked" Grenade
Launcher (Factory New): https://marketplace.tf/browse/tf2?sstrange=0&
skillstreak=2&sks%5B%5D=1&swear=1&spaintkit=303&sbotkiller=none&sfestivized=0&
saustralium=0&sterm=Grenade+Launcher - together these confirm:
- swear is the plain numeric Wear Tier id, not a boolean toggle as first
  guessed - the same ids WEAR_TIER_IDS (utils/warpaints.js) already uses
  (Factory New=1 in both examples above), not embedded in sterm's text the
  way the War Paint tool's own example first suggested (that was a
  coincidence of Factory New's id also being 1, not a text-vs-id split).
- spaintkit, for an actual Decorated Weapon, takes the exact same texture/
  skin id utils/data/warpaints.json (and so shape.textureId, already
  resolved by skinDetection.js) already provides for other sites - defindex
  303 there is "Macaw Masked", matching the example - not a separate
  marketplace.tf-only id table.
- sks[] is a Kill Streak Sheen filter, using the exact same ids SHEEN_IDS
  (utils/tf2AttributeIds.js) already uses (1 = Team Shine ... 7 = Hot Rod) - so
  shape.sheenId is reused directly, same as everywhere else in this
  codebase.
- Both examples omit squality[] entirely - but confirmed live for an
  ★Unusual War Paint tool ("Die'n Dasher War Paint (Factory New)"):
  https://marketplace.tf/browse/tf2?squality%5B%5D=5&sstrange=0&
  skillstreak=0&swear=1&seffect%5B%5D=703&sfestivized=0&saustralium=0&
  sterm=Die%27n+Dasher+War+Paint - squality[] IS sent for this skin-specific
  form too, just only when the quality isn't the default. That default is
  "Decorated Weapon" (quality15) here, not "Unique" (a plain "Ocean Mapped
  War Paint (Minimal Wear)" must not get squality[]=15), so squality[] is
  sent only when shape.qualityName !== "Decorated Weapon".
- seffect[] IS also supported here (seffect[]=703 above) - reuses
  shape.effectId as-is, same as the general branch.
- That same ★Unusual example's sterm is just "Die'n Dasher War Paint" - no
  "(Factory New)" suffix, unlike the very first Forest Fire Mk.II example
  above, which did include it. Since those two disagree, sterm here is just
  "{skin} War Paint" (no wear suffix) going forward - simpler, and
  consistent with every other branch searching by a bare name and letting
  the id-based params (swear here) do the actual filtering.

Also confirmed live, for a Strange "Sideshow War Paint (Factory New)":
https://marketplace.tf/browse/tf2?squality%5B%5D=11&sstrange=1&skillstreak=0&
swear=1&spaintkit=440&sfestivized=0&saustralium=0&sterm=Sideshow+War+Paint -
spaintkit is supported for a standalone War Paint tool too (440 is
"Sideshow" in utils/data/warpaints.json); shape.warPaintToolTextureId is
sent whenever resolved, since it is more reliable than sterm alone.

Also confirmed live, for a "Sarsaparilla Sprayed War Paint (Well-Worn)":
https://marketplace.tf/browse/tf2?sstrange=0&skillstreak=0&swear=4&
spaintkit=284&seffect%5B%5D=-2&sfestivized=0&saustralium=0&sterm=War+Paint -
seffect[] is sent even with no effect (as "-2"), and once spaintkit is
resolved sterm is just the generic "War Paint", since spaintkit already pins
down the skin. sterm falls back to "{skin} War Paint" only when spaintkit
could not be resolved (e.g. a warpaints.json name mismatch).

Also confirmed live, for a Strange Specialized Killstreak weapon with the
Exorcism spell: skillstreak=2&sspell=effect_exorcism - which confirms
skillstreak's tier values are the plain 1/2/3 Valve killstreak tier numbers,
and that sspell takes a marketplace.tf-specific
slug, not either backpack.tf site's own spell id scheme - see
MARKETPLACE_SPELL_SLUGS in utils/tf2AttributeIds.js (confirmed for all 16
spells).

Also confirmed live, for a Strange Carbonado Botkiller Wrench Mk.I:
sbotkiller=Carbonado_I&sterm=Wrench - so sbotkiller is just "{grade}_{roman
numeral tier}" taken straight from the item's own name (see the Botkiller
detection in itemShape.js), not an opaque id needing its own lookup table,
and sterm searches by the bare target weapon name (like every other tool
variant here) rather than the Botkiller's own full name.

Also confirmed live, for a Specialized Killstreak Frontier Justice Kit:
stype=Killstreak+Kit alongside skillstreak=2&sterm=Frontier+Justice - a Kit
search without stype would just be "Frontier Justice" filtered by
skillstreak, which also matches the actual Killstreak Frontier Justice
weapon itself (and every other quality/craft variant of it), not just Kits
for it - stype narrows results to Kit listings specifically.

Also confirmed live, for a Professional Shotgun Kit Fabricator:
stype=Fabricator (skillstreak=3 here too, further confirming Professional=3)
- a Fabricator's own stype value is just "Fabricator", not "Killstreak Kit
Fabricator" or reusing the Kit's own "Killstreak Kit" value. Not
independently confirmed whether stype has other values for the Strangifier
branch too, so only sent for a Killstreak Kit/Fabricator for now.

Also confirmed live, for a Professional Killstreak Backburner Kit with Sheen
Team Shine and Killstreaker Fire Horns: sks%5B%5D=1&ske%5B%5D=2002 - sks[] is
the same Kill Streak Sheen filter already confirmed for a Decorated Weapon
(SHEEN_IDS, shape.sheenId), and ske[] is a new Killstreaker filter using the
same ids KILLSTREAKER_IDS (utils/tf2AttributeIds.js) already uses (2002 = Fire Horns) -
so shape.killstreakerId is reused directly. Both are general - not
Kit-specific - so applied here for every item in this branch (an actual
Killstreak weapon with its own Sheen/Killstreaker, not just a Kit for one).

Also confirmed live for a Decorated Weapon specifically, a Professional
Killstreak "Simple Spirits Family Business" with Sheen Deadly Daffodil and
Killstreaker Tornado: ske%5B%5D=2004 - so ske[] (like sks[]) applies to the
Decorated Weapon branch too.

NOT independently confirmed (no live example with the attribute actually
turned on), so left at their confirmed "off" value rather than guessed:
- sfestivized/saustralium's "true" value - assumed to follow the same plain
  0/1 convention as every other boolean param here.
- The squality[]-when-non-"Decorated Weapon" and seffect[] support confirmed
  above for the War Paint tool branch are applied to the Decorated Weapon
  branch too by extension (both are the same skin-specific form) - not
  independently confirmed for an actual Decorated Weapon.
- sspell for either skin branch - not independently confirmed, so left off
  entirely rather than assumed to work the same as the general branch's.

Also confirmed live, for an Unusual "Taunt: Unleashed Rage": stype=Special
Taunt&sterm=Unleashed+Rage (seffect[]=3224 alongside it, same Valve particle
id scheme as every other effect here) - a Taunt needs its own stype filter
value too, same idea as the Kit/Fabricator ones above, with the "Taunt: "
prefix split off sterm rather than searched as literal text.

Also confirmed live, for a plain Collector's Detonator: https://
marketplace.tf/browse/tf2?squality%5B%5D=14&skillstreak=0&sterm=Detonator -
Collector's gets its own much more minimal branch (see below), with no
sstrange/spaintkit/seffect[]/sbotkiller/sfestivized/saustralium at all, not
even their usual "off" sentinel values.
*/
export function buildMarketplaceHref(shape) {
  // Confirmed live: only sterm=Taunt: The Bunnyhopper Unusualifier finds a
  // Taunt Unusualifier; marketplace.tf has no target filter for it.
  if (shape.isUnusualifier) {
    const params = new URLSearchParams({ sterm: `${shape.unusualifierTargetName} ${shape.baseName}` });
    return `https://marketplace.tf/browse/tf2?${params.toString()}`;
  }

  if (shape.isWarPaintTool) {
    const params = new URLSearchParams();
    if (shape.qualityName !== "Decorated Weapon") {
      params.append("squality[]", String(QUALITY_ID_BY_NAME[shape.qualityName] ?? ""));
    }
    // sstrange means "has Strange-tracking" (detectSkin's
    // hasStrangeTracking), independent of the primary quality. See #99.
    params.set("sstrange", shape.hasStrangeTracking ? "1" : "0");
    params.set("skillstreak", "0");
    params.set("swear", String(WEAR_TIER_IDS[shape.warPaintToolWearName] ?? ""));
    if (shape.warPaintToolTextureId) params.set("spaintkit", String(shape.warPaintToolTextureId));
    params.append("seffect[]", shape.effectId ? String(shape.effectId) : "-2");
    params.set("sfestivized", shape.isFestivized ? "1" : "0");
    params.set("saustralium", "0");
    // See the function header on sterm vs spaintkit.
    params.set("sterm", shape.warPaintToolTextureId ? "War Paint" : `${shape.warPaintToolSkinName} War Paint`);
    return `https://marketplace.tf/browse/tf2?${params.toString()}`;
  }

  if (shape.isDecoratedWeapon) {
    const params = new URLSearchParams();
    if (shape.qualityName !== "Decorated Weapon") {
      params.append("squality[]", String(QUALITY_ID_BY_NAME[shape.qualityName] ?? ""));
    }
    // sstrange from hasStrangeTracking, as in the War Paint tool branch.
    params.set("sstrange", shape.hasStrangeTracking ? "1" : "0");
    params.set("skillstreak", String(shape.ksTier ?? 0));
    if (shape.sheenId) params.append("sks[]", String(shape.sheenId));
    if (shape.killstreakerId) params.append("ske[]", String(shape.killstreakerId));
    params.set("swear", String(shape.wearTierId ?? ""));
    params.set("spaintkit", String(shape.textureId ?? "-2"));
    if (shape.effectId) params.append("seffect[]", String(shape.effectId));
    params.set("sbotkiller", "none");
    params.set("sfestivized", shape.isFestivized ? "1" : "0");
    params.set("saustralium", "0");
    params.set("sterm", shape.weaponName || shape.baseName);
    return `https://marketplace.tf/browse/tf2?${params.toString()}`;
  }

  // Collector's uses a much more minimal param set than every quality above
  // - confirmed live for a plain Collector's Detonator: no sstrange/
  // spaintkit/seffect[]/sbotkiller/sfestivized/saustralium at all, not even
  // as their usual "off" sentinel - just squality[], skillstreak, and sterm.
  // Sheen/Killstreaker still apply the same as any other Killstreak item
  // (not independently confirmed for Collector's specifically, but no reason
  // to expect otherwise), so still sent here when present.
  if (shape.qualityName === "Collector's") {
    const params = new URLSearchParams();
    params.append("squality[]", String(QUALITY_ID_BY_NAME["Collector's"]));
    params.set("skillstreak", String(shape.ksTier ?? 0));
    if (shape.sheenId) params.append("sks[]", String(shape.sheenId));
    if (shape.killstreakerId) params.append("ske[]", String(shape.killstreakerId));
    params.set("sterm", shape.baseName);
    return `https://marketplace.tf/browse/tf2?${params.toString()}`;
  }

  const filters = deriveClassifiedsFilters(shape);

  // A Taunt's name keeps its "Taunt: " prefix; marketplace.tf wants
  // stype=Special Taunt plus the bare name ("Unleashed Rage") instead.
  const isTaunt = /^Taunt:\s*/i.test(filters.itemName);

  const params = new URLSearchParams();
  params.append("squality[]", filters.quality);
  if (shape.isKillstreakKit) params.set("stype", "Killstreak Kit");
  if (shape.isFabricatorKit) params.set("stype", "Fabricator");
  if (isTaunt) params.set("stype", "Special Taunt");
  params.set("sstrange", shape.qualityName === "Strange" ? "1" : "0");
  params.set("scraftable", filters.nextCraftable);
  params.set("skillstreak", String(filters.killstreakTier ?? 0));
  if (shape.sheenId) params.append("sks[]", String(shape.sheenId));
  if (shape.killstreakerId) params.append("ske[]", String(shape.killstreakerId));
  params.set("spaintkit", "-2");
  params.append("seffect[]", shape.effectId ? String(shape.effectId) : "-2");
  params.set("sbotkiller", shape.botkillerSlug ?? "none");
  const spellSlug = shape.spellName ? MARKETPLACE_SPELL_SLUGS[shape.spellName] : null;
  if (spellSlug) params.set("sspell", spellSlug);
  params.set("sfestivized", shape.isFestivized ? "1" : "0");
  if (filters.classicPaintId && !shape.unusualEffectName) {
    params.append("spaint[]", String(filters.classicPaintId));
  }
  params.set("saustralium", filters.nextAustralium);
  // A Botkiller weapon searches by its bare weapon name (e.g. "Wrench"), not
  // the full "{Grade} Botkiller {Weapon} Mk.{Tier}" baseName filters.itemName
  // would otherwise use - the sbotkiller filter above already conveys the
  // grade/tier, matching how every other tool variant here searches by its
  // bare target name instead of its own full tool name.
  //
  // A target tool searches its full combined name (buildTargetToolFullName),
  // since marketplace.tf has no target-item filter. See #82.
  params.set(
    "sterm",
    shape.isTargetTool
      ? buildTargetToolFullName(shape.targetToolBaseItemName, shape.targetToolTargetName)
      : shape.isBotkiller
        ? shape.botkillerWeaponName
        : isTaunt
          ? filters.itemName.replace(/^Taunt:\s*/i, "")
          : filters.itemName
  );

  return `https://marketplace.tf/browse/tf2?${params.toString()}`;
}
