/*
@description: Skin identity for the item card: Decorated Weapons (a War Paint
applied to a weapon) and standalone War Paint tools. See detectSkin.
*/
import { getItemNameByDefindex } from "../../utils/tf2Schema.js";
import { getTextureId, getSkinNameByTextureId, findSkinNamePrefix, WEAR_TIER_IDS, WEAR_TIER_NAMES_BY_ID } from "../../utils/warpaints.js";
import { QUALITY_ID_BY_NAME } from "../../utils/tf2Quality.js";
import { getUnusualEffectName } from "./tooltipData.js";

// Every Wear Tier name, used to build the "(Wear Tier)" name-suffix regex below.
const WEAR_SUFFIX_PATTERN = new RegExp(`^(.+?)\\s*\\((${Object.keys(WEAR_TIER_IDS).join("|")})\\)\\s*$`);
// A skin's own quality prefix word, e.g. "Strange" in "Strange Sideshow War
// Paint (Factory New)" or "Strange Candy Coated Tomislav (Factory New)" -
// shared by both the Decorated Weapon and standalone War Paint tool branches
// below, since either can carry one.
const SKIN_QUALITY_NAMES = ["Strange", "Vintage", "Genuine", "Haunted", "Collector's"];
const SKIN_QUALITY_PREFIX_PATTERN = new RegExp(`^(${SKIN_QUALITY_NAMES.join("|")})\\s+`);
// scrap.tf's own skin-preview image, embedded as an <img class='skin-preview'
// src='.../warpaint/{weaponDefindex}_{textureId}_{wearTierId}_{variant}.png'>
// in the item's data-content attribute (its separate attribute-list tooltip
// body, distinct from the hover-over TITLE the wear-suffix regex above
// reads) - confirmed live via a Name-Tagged Strange Festivized Killstreak
// Sniper Rifle: the Name Tag replaces the whole title ("Strange
// \"<custom name>\""), losing the "{Skin} {Weapon} ({Wear})" text the regex
// above needs entirely, but data-content (and this image within it) is
// untouched by it. textureId is the exact same numeric id as warpaints.json's
// own "defindex" field, and wearTierId already matches WEAR_TIER_IDS' own
// numbering (1=Factory New..5=Battle Scarred) - both confirmed live from that
// same sample (201_278_4_1.png -> defindex 201/Sniper Rifle, texture
// 278/Smissmas Spycrabs, wear 4/Well-Worn).
const SKIN_PREVIEW_IMAGE_PATTERN = /\/warpaint\/(\d+)_(\d+)_(\d+)_\d+\.png/;

/*
@description: Resolves everything about an item's skin identity: whether it's
a Decorated Weapon (a War Paint skin applied to a weapon) or a standalone War
Paint tool, and every id/name link-building needs for either - the skin name,
wear tier, resolved base weapon name, texture ids, and (for a Decorated
Weapon) the skin's own quality/Unusual-effect overrides. Returns qualityName/
unusualEffectName unchanged when neither override applies, so callers can
always use the returned values in place of what they passed in.
@args:
  - name: raw tooltip name of the item
  - itemEl: the hovered .item.hoverable element (source of data-defindex)
  - qualityName: quality name already read off itemEl's CSS class, used as-is
    for a standalone War Paint tool's own stats/classifieds quality
  - unusualEffectName: Unusual effect name already resolved for a base-Unusual
    item (if any) - overridden below when a Decorated Weapon's SKIN carries
    its own independent Unusual effect instead
@returns skin identity fields - see the property comments below.
*/
export async function detectSkin(name, itemEl, qualityName, unusualEffectName) {
  // Captured before qualityName can be promoted to "Unusual" below:
  // Strange-tracking is independent of the primary quality, and links.js's
  // marketplace.tf "sstrange" param needs it after the promotion.
  const hasStrangeTracking = qualityName === "Strange";

  // --- WAR PAINT / DECORATED WEAPON (SKIN) DETECTION ---
  // Decorated Weapons apply a war paint skin over a base weapon. quality15
  // ("Decorated Weapon") is only present in the DOM for a plain Unique skin -
  // confirmed live: a Strange Decorated weapon shows quality11 (Strange)
  // instead, with no quality15 class at all, since only one quality class is
  // ever applied. Detecting via the "(Wear Tier)" name suffix instead is
  // quality-independent and confirmed to still work in that case. The display
  // name is "{Skin Name} {Weapon Name} ({Wear})" with no separator between
  // skin and weapon name, so splitting it requires already knowing the real
  // weapon name rather than guessing from text - resolved via the item's own
  // data-defindex against the schema (same source already used for
  // Kit/Strangifier target lookups).
  const wearSuffixMatch = WEAR_SUFFIX_PATTERN.exec(name);
  // A standalone War Paint *tool* (e.g. "Dragon Slayer War Paint (Factory
  // New)") also matches the "(Wear Tier)" suffix, but it's a different item
  // entirely from a weapon wearing that skin - its own literal name is
  // already correct, and its data-defindex is a War Paint tool defindex
  // (15xxx-17xxx), not a weapon defindex, so running it through the
  // weapon-name resolution below would only ever fail. Confirmed live: ends
  // with the literal word "War Paint" before the wear suffix.
  const isWarPaintTool = !!wearSuffixMatch && /\bWar Paint$/i.test(wearSuffixMatch[1].trim());
  let isDecoratedWeapon = !!wearSuffixMatch && !isWarPaintTool;
  // The War Paint tool's skin name: the trailing "War Paint" and any leading
  // quality word (e.g. "Strange Sideshow War Paint (Factory New)") are
  // stripped. The quality is conveyed separately (warPaintToolQuality), and
  // warpaints.json names never carry it, so getTextureId would miss.
  const warPaintToolPreWearName = isWarPaintTool ? wearSuffixMatch[1].trim().replace(/\s+War Paint$/i, "") : null;
  const warPaintToolQualityMatch = warPaintToolPreWearName ? SKIN_QUALITY_PREFIX_PATTERN.exec(warPaintToolPreWearName) : null;
  const warPaintToolPreEffectName = warPaintToolQualityMatch
    ? warPaintToolPreWearName.slice(warPaintToolQualityMatch[0].length).trim()
    : warPaintToolPreWearName;
  // A standalone War Paint tool can ALSO carry a "★Unusual " marker of its
  // own, same as a Decorated Weapon's skin can (see skinHasUnusualEffect
  // below) - detected and stripped here, promoting qualityName to "Unusual"
  // (same "Unusual outranks Strange" rule the Decorated Weapon branch below
  // already establishes for this exact combination). See #130.
  const warPaintToolHasUnusualEffect = isWarPaintTool && /^★\s*(Unusual\s+)?/i.test(warPaintToolPreEffectName || "");
  const warPaintToolSkinName = warPaintToolPreEffectName
    ? warPaintToolPreEffectName.replace(/^★\s*(Unusual\s+)?/i, "").trim()
    : warPaintToolPreEffectName;
  if (warPaintToolHasUnusualEffect && !unusualEffectName) {
    unusualEffectName = getUnusualEffectName(itemEl);
  }
  if (warPaintToolHasUnusualEffect) {
    qualityName = "Unusual";
  }
  const warPaintToolWearName = isWarPaintTool ? wearSuffixMatch[2].trim() : null;
  let skinName = null;
  let wearName = null;
  let weaponName = null;
  let skinQualityName = null;
  let skinWeaponUnresolved = false;
  let skinHasUnusualEffect = false;
  if (isDecoratedWeapon) {
    let preWearName = wearSuffixMatch[1].trim();
    wearName = wearSuffixMatch[2].trim();

    // A Decorated Weapon's own quality (Strange, Vintage, etc.) is read from
    // the literal prefix word in the raw name, which is more reliable for
    // skins than the item element's quality class.
    const skinQualityMatch = SKIN_QUALITY_PREFIX_PATTERN.exec(preWearName);
    if (skinQualityMatch) {
      skinQualityName = skinQualityMatch[1];
      preWearName = preWearName.slice(skinQualityMatch[0].length).trim();
    }

    const defindexAttr = itemEl.getAttribute("data-defindex");
    const defindex = defindexAttr ? Number(defindexAttr) : null;
    weaponName = defindex ? await getItemNameByDefindex(defindex) : null;
    skinWeaponUnresolved = !weaponName;

    skinName =
      weaponName && preWearName.endsWith(weaponName)
        ? preWearName.slice(0, -weaponName.length).trim()
        : preWearName; // weapon name unresolved - fall back to the full pre-wear text

    // An Unusual-effect skin carries its own separate "★Unusual " marker in
    // the raw name (distinct from the leading Strange/Vintage/etc. quality
    // word already stripped above) - confirmed live: "Strange ★Unusual Candy
    // Coated Tomislav (Factory New)" - strip it so the skin line just shows
    // "Candy Coated (Factory New)".
    skinHasUnusualEffect = /^★\s*(Unusual\s+)?/i.test(skinName);
    skinName = skinName.replace(/^★\s*(Unusual\s+)?/i, "").trim();

    // The ★Unusual marker means this skin's effect is real regardless of the
    // base item's own quality (this example is Strange, not Unusual) - the
    // qualityName === "Unusual" gate in itemShape.js only catches a
    // base-Unusual item, so resolve it here too when that didn't already
    // happen.
    if (skinHasUnusualEffect && !unusualEffectName) {
      unusualEffectName = getUnusualEffectName(itemEl);
    }

    // Override the class-based qualityName passed in - affects the classifieds
    // "quality" param too, not just display. skinHasUnusualEffect takes
    // priority over skinQualityName here - Strange is just an add-on tracking
    // descriptor, not the item's actual quality, when the skin's ★Unusual
    // marker means its REAL, persisted quality is Unusual (5), same "Unusual
    // outranks Strange" rule utils/tf2StatsLinks/decoratedWeapon.js's own
    // isUnusual note already establishes for the steamcommunity.com side of
    // this codebase. See #131.
    if (skinHasUnusualEffect) {
      qualityName = "Unusual";
    } else if (skinQualityName) {
      qualityName = skinQualityName;
    }
  }

  // NAME-TAGGED DECORATED WEAPON FALLBACK: the title-text detection above
  // found no "(Wear Tier)" suffix, which happens whenever a Name Tag has
  // replaced the whole tooltip title with the custom name - the skin-preview
  // image (untouched by a Name Tag, see SKIN_PREVIEW_IMAGE_PATTERN above) is
  // the only remaining signal for those. Guarded by the same weapon defindex
  // the item's own data-defindex reports, so a stray/unrelated preview image
  // (there shouldn't be one, but this is otherwise the sole source of truth
  // here) is never trusted over a defindex mismatch.
  if (!isDecoratedWeapon) {
    const dataContent = itemEl.getAttribute("data-content") || "";
    const previewMatch = SKIN_PREVIEW_IMAGE_PATTERN.exec(dataContent);
    const defindexAttr = itemEl.getAttribute("data-defindex");
    const previewDefindex = previewMatch ? Number(previewMatch[1]) : null;
    if (previewMatch && defindexAttr && Number(defindexAttr) === previewDefindex) {
      weaponName = await getItemNameByDefindex(previewDefindex);
      skinWeaponUnresolved = !weaponName;
      skinName = await getSkinNameByTextureId(Number(previewMatch[2]));
      wearName = WEAR_TIER_NAMES_BY_ID[Number(previewMatch[3])] || null;

      // The skin's own quality prefix word (e.g. "Strange") has no text left
      // to parse it from here, but per this detection branch's own confirmed
      // live sample, a Strange Decorated Weapon already carries a plain
      // "quality11" class (not "quality15"), so the class-based qualityName
      // passed in already resolves correctly on its own - no override
      // needed, just recorded here as skinQualityName for display parity
      // with the text-based branch above.
      if (SKIN_QUALITY_NAMES.includes(qualityName)) {
        skinQualityName = qualityName;
      }

      // Whether the skin itself carries its own independent Unusual effect
      // (the "★Unusual " marker) isn't recoverable without title text either
      // - left false (best effort, same degrade-gracefully approach as the
      // rest of this function).
      isDecoratedWeapon = !!(skinName && wearName);
    }
  }

  // A standalone War Paint tool uses "Decorated Weapon" as its quality and a
  // literal " | " inserted before "War Paint" in its name on backpack.tf's
  // stats page - confirmed live: /stats/Decorated Weapon/Dragon Slayer | War
  // Paint (Factory New)/Tradable/Craftable, not the plain "Unique/Dragon
  // Slayer War Paint (Factory New)" the generic item path would produce.
  // It also comes in a Strange-tracking variant, whose quality is "Strange"
  // instead of "Decorated Weapon" on next.backpack.tf (same as
  // utils/tf2StatsLinks/warPaintTool.js). qualityName (read off the item's real CSS class, passed in from
  // itemShape.js) already distinguishes the two correctly here with no extra
  // detection needed - quality15 resolves to "Decorated Weapon" per
  // tf2Quality.js's table, quality11 to "Strange". Classic backpack.tf's
  // Strange-variant behavior is assumed to match next's. Unusual takes
  // priority when the tool carries its own "★Unusual " marker (not confirmed
  // for these params, but Unusual outranks Strange as a Valve quality, as
  // confirmed for Decorated Weapons).
  const warPaintToolQuality = qualityName === "Unusual" ? "Unusual" : qualityName === "Strange" ? "Strange" : "Decorated Weapon";
  const warPaintToolQualityId = String(QUALITY_ID_BY_NAME[warPaintToolQuality]);

  // Decorated Weapon (skin)/War Paint tool classifieds filtering - used by
  // both sites' classifieds links in links.js. Classic backpack.tf's shape
  // (same as utils/tf2StatsLinks/decoratedWeapon.js's
  // buildDecoratedWeaponClassifiedsLink) uses texture/wear as numeric ids AND
  // texture_name/wear_tier as a second, seemingly redundant pair
  // (texture_name is the literal skin name, wear_tier duplicates wear's
  // numeric value under a different key) - unusual, but that's what was
  // confirmed live, so replicated as-is. Some Decorated Weapons' own display
  // name duplicates part of the weapon name into what looks like the skin
  // descriptor (e.g. "Calavera Canvas Claidheamh Mor" baked into skinName,
  // even though the skin's own real name in warpaints.json is just "Calavera
  // Canvas"), which makes an exact-match getTextureId lookup on skinName
  // as-is silently fail. Falls back to findSkinNamePrefix (utils/warpaints.js
  // - built for this exact "skin name is a prefix of a longer string" case)
  // to recover the canonical name and retry, rather than leaving textureId
  // (and so marketplace.tf's spaintkit) unresolved. See #40.
  let textureId = isDecoratedWeapon && skinName ? await getTextureId(skinName) : null;
  if (isDecoratedWeapon && skinName && !textureId) {
    const canonicalSkinName = await findSkinNamePrefix(skinName);
    if (canonicalSkinName) textureId = await getTextureId(canonicalSkinName);
  }
  const wearTierId = isDecoratedWeapon && wearName ? WEAR_TIER_IDS[wearName] : null;
  // War Paint tool texture id, for next.backpack.tf; classic backpack.tf
  // uses the literal texture name (texture_name) instead.
  const warPaintToolTextureId = isWarPaintTool ? await getTextureId(warPaintToolSkinName) : null;

  return {
    qualityName,
    unusualEffectName,
    hasStrangeTracking,

    isWarPaintTool,
    warPaintToolSkinName,
    warPaintToolWearName,
    warPaintToolQuality,
    warPaintToolQualityId,
    warPaintToolTextureId,

    isDecoratedWeapon,
    skinName,
    wearName,
    weaponName,
    skinQualityName,
    skinWeaponUnresolved,
    skinHasUnusualEffect,
    textureId,
    wearTierId,
  };
}
