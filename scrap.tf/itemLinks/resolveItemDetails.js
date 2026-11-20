/*
@description: Top-level identity resolution for the itemLinks feature, called
by itemCard.js. Ties itemShape.js's resolved identity to links.js's URL
builders and produces the plain ItemDetails shape the item card renders, so
itemCard.js never needs to know how a shape becomes a name or a link.
*/
import { QUALITY_COLOR_BY_NAME } from "../../utils/tf2Quality.js";
import { detectItemShape } from "./itemShape.js";
import { searchPricedbSkuStatus } from "../../utils/pricedb.js";
import { isSheenKillstreakerFilterEnabled } from "../../utils/sheenKillstreakerFilterSetting.js";
import { hasSteamApiKey } from "../../utils/tf2Schema.js";
import { POSTS_TF_KEY_HINT_TITLE, retryAtFromNow } from "../../utils/linkButtonStates.js";
import {
  buildStatsLinks,
  buildClassifiedsHref,
  buildNextClassifiedsHref,
  buildSteamMarketName,
  buildSteamMarketHref,
  buildMarketplaceHref,
  buildStnTradingHref,
  buildMannStoreHref,
  buildPostsTfLink,
  postsTfCoversItemType,
} from "./links.js";
import { buildGladiatorHref } from "../../utils/tf2StatsLinks/index.js";

/*
@typedef {object} ItemDetails
@property {string} displayName - resolved item name shown as the card title
@property {?string} qualityColor - title/quality-line text color, or null for the default color
@property {?string} effectName - Unusual effect name, or null
@property {?string} spellName - Halloween Spell name, or null
@property {?string} sheenName - Killstreak Sheen name, or null
@property {?string} killstreakerName - Killstreaker name, or null
@property {?string} killstreakTierName - "Killstreak"/"Specialized Killstreak"/"Professional Killstreak", or null
@property {?string} skinLabel - "{Skin Name} ({Wear})" for a Decorated Weapon, or null
@property {?string} level - item level, or null
@property {boolean} isFestivized - whether the item is Festivized
@property {?string} paintName - Paint name, or null
@property {?string} paintColor - the paint's own hex color, or null
@property {boolean} isUncraft - whether the item is Non-Craftable
@property {Array<{label: string, href: string}>} links - main action buttons (stats/gladiator.tf/marketplace.tf/mannco.store/stntrading.eu/Steam Market) - neither pricedb.io nor posts.tf is included yet, see pricedbPromise/postsTfPromise below
@property {Promise<{href: ?string, rateLimited: boolean, retryAt: ?number}>} pricedbPromise - resolves to the pricedb.io href (or null) plus whether a null href means "rate limited" rather than "no listing", and when a rate-limited lookup may retry - splice in via insertPricedbLink/insertPricedbRateLimited/insertPricedbPlaceholder
@property {function(): Promise<{href: ?string, rateLimited: boolean, retryAt: ?number}>} lookupPricedb - runs the same pricedb.io lookup again, for the rate-limit countdown's retry
@property {Promise<{href: ?string, needsKey: boolean}>} postsTfPromise - resolves to the posts.tf href (or null) plus whether a null href is only because no Steam Web API key is saved - splice in via insertPostsTfResult/insertPostsTfPlaceholder
@property {boolean} postsTfApplies - whether posts.tf covers this item type at all (postsTfCoversItemType) - only reserve/splice a slot for it when true
@property {boolean} statsUnresolved - shape.statsUnresolved, passed through for insertPostsTfResult's own redundant-prompt check
@property {string} classifiedsHref - classic backpack.tf classifieds search URL
@property {string} nextClassifiedsHref - next.backpack.tf classifieds search URL
*/

/*
@description: Resolves an item's full identity and builds every outbound
link/URL the item card shows, from its hovered DOM element and tooltip name.
@args:
  - name: raw tooltip name of the item
  - itemEl: the hovered .item.hoverable element (source of quality/killstreak/
    craftability CSS classes and the data-content tooltip attribute)
@returns {Promise<ItemDetails>}
*/
export async function resolveItemDetails(name, itemEl) {
  const shape = await detectItemShape(name, itemEl);

  // Sheen/Killstreaker filtering is user-toggleable: linkShape (fed to the
  // link builders) drops them when disabled, while `shape` keeps them for the
  // card's display lines. Killstreak tier is unaffected.
  const sheenKillstreakerFilterEnabled = await isSheenKillstreakerFilterEnabled();
  const linkShape = sheenKillstreakerFilterEnabled
    ? shape
    : { ...shape, sheenId: null, killstreakerId: null, sheenName: null, killstreakerName: null };

  // Builders that never read sheen/killstreaker use the unfiltered shape.
  const steamMarketName = buildSteamMarketName(shape);
  const steamMarketHref = buildSteamMarketHref(linkShape, steamMarketName);
  const stnTradingHref = buildStnTradingHref(shape, steamMarketName);

  // steamMarketName is the full quality+festive+killstreak+item name, so it
  // doubles as the display name. Decorated Weapons rebuild the full in-game
  // name instead:
  // "{quality }{★Unusual }{skin} {weapon} ({wear})" - confirmed live: "Strange
  // ★Unusual Candy Coated Tomislav (Factory New)". Falls back to the raw
  // hovered name if the weapon defindex lookup failed (weaponName/skinName/
  // wearName all come from that same resolution).
  const decoratedWeaponDisplayName =
    shape.weaponName && shape.skinName && shape.wearName
      ? `${shape.skinQualityName ? `${shape.skinQualityName} ` : ""}${shape.skinHasUnusualEffect ? "★Unusual " : ""}${shape.skinName} ${shape.weaponName} (${shape.wearName})`
      : null;
  // A Taunt Unusualifier keeps its plain "Unusual Unusualifier" here, so
  // gladiator.tf/pricedb.io search for every Unusualifier (neither can
  // filter by target); the title adds the taunt below.
  const fullDisplayName =
    shape.isDecoratedWeapon && decoratedWeaponDisplayName
      ? decoratedWeaponDisplayName
      : shape.isUnusualifier
      ? `${shape.qualityName} ${shape.baseName}`
      : steamMarketName;

  // gladiator.tf/pricedb.io use the trading community's "{Effect} {Item}"
  // Unusual naming (e.g. "Purple Energy Team Captain") rather than Steam's
  // "Unusual {Item}". Keeps "Unusual " when the effect is unknown.
  const searchDisplayName =
    shape.qualityName === "Unusual" && shape.unusualEffectName
      ? fullDisplayName.replace(/^Unusual\s+/, `${shape.unusualEffectName} `)
      : fullDisplayName;

  const gladiatorHref = buildGladiatorHref(searchDisplayName);
  // buildPostsTfLink needs a schema defindex lookup, so it is started here
  // without being awaited; itemCard.js shows a placeholder and splices in
  // the result (or a "set up your key" prompt) when it settles. See #132.
  const postsTfApplies = postsTfCoversItemType(shape);
  const postsTfPromise = (postsTfApplies ? buildPostsTfLink(shape) : Promise.resolve(null)).then(async (href) => ({
    href,
    // Only a missing key is worth a hint; with a key saved, an unresolved
    // item (e.g. brand-new) wouldn't be fixed by adding one.
    needsKey: !href && postsTfApplies && !(await hasSteamApiKey()),
  }));
  const mannStoreHref = buildMannStoreHref(linkShape);

  // pricedb.io's /api/search is a per-item network round trip, likewise
  // started without being awaited. searchDisplayName keeps a Taunt's
  // "Taunt: " prefix (stripNamePrefix only strips quality/killstreak words).
  // The result carries rateLimited so a 429 can be shown differently from a
  // genuine "no listing". See #19. See #20.
  const lookupPricedb = () =>
    searchPricedbSkuStatus(searchDisplayName).then(({ sku, rateLimited, retryAfterMs }) => ({
      href: sku ? `https://pricedb.io/item/${encodeURIComponent(sku)}` : null,
      rateLimited,
      retryAt: rateLimited ? retryAtFromNow(retryAfterMs) : null,
    }));
  const pricedbPromise = lookupPricedb();

  // Plain (no Strange/Killstreak/etc) weapons have no Steam Market listing of
  // their own - the /buy/weapons page is exactly that case, so skip the
  // button there.
  const isPlainWeaponsPage = window.location.pathname.startsWith("/buy/weapons");
  const links = [
    ...buildStatsLinks(shape),
    // Same row order as steamcommunity.com/itemQuickLinks. pricedb.io and
    // posts.tf are spliced in after gladiator.tf later (insertPricedbLink/
    // insertPostsTfResult). mannco.store is only added when it resolved.
    { label: "gladiator.tf", href: gladiatorHref },
    { label: "marketplace.tf", href: buildMarketplaceHref(linkShape) },
    ...(mannStoreHref ? [{ label: "mannco.store", href: mannStoreHref }] : []),
    // Right before Steam Market, and kept on /buy/weapons too: only Steam
    // Market lacks plain-weapon listings.
    { label: "stntrading.eu", href: stnTradingHref },
    ...(isPlainWeaponsPage ? [] : [{ label: "Steam Market", href: steamMarketHref }]),
  ];

  // The title drops "Unusual " (the purple color and the Effect line already
  // say it); steamMarketName keeps it, as Steam's market_hash_name requires.
  const titleName = shape.qualityName === "Unusual" ? fullDisplayName.replace(/^Unusual\s+/, "") : fullDisplayName;
  const displayName = shape.isUnusualifier ? `${titleName} (${shape.unusualifierTargetName})` : titleName;
  const skinLabel = shape.isDecoratedWeapon && shape.skinName && shape.wearName ? `${shape.skinName} (${shape.wearName})` : null;
  // Unusual outranks every other quality color for the title - a Strange
  // Decorated Weapon whose skin carries an Unusual effect is shown in
  // Unusual's purple, not Strange's orange, matching how the game itself
  // treats an Unusual effect as the more significant attribute.
  // skinDetection.js already promotes qualityName to "Unusual" for that case;
  // the explicit skinHasUnusualEffect check just keeps the rule visible here.
  const qualityColor = shape.skinHasUnusualEffect ? QUALITY_COLOR_BY_NAME.Unusual : QUALITY_COLOR_BY_NAME[shape.qualityName] || null;

  return {
    displayName,
    qualityColor,
    effectName: shape.unusualEffectName,
    spellName: shape.spellName,
    sheenName: shape.sheenName,
    killstreakerName: shape.killstreakerName,
    killstreakTierName: shape.killstreakTierName,
    skinLabel,
    level: shape.level,
    isFestivized: shape.isFestivized,
    paintName: shape.paintName,
    // The actual paint's own hex color (from PAINT_IDS, already resolved by
    // itemShape.js) - real TF2 tooltips show the "Painted: X" line in the
    // paint's own color, not one fixed color for every paint.
    paintColor: shape.paintEntry?.color ?? null,
    isUncraft: shape.isUncraft,
    links,
    pricedbPromise,
    lookupPricedb,
    postsTfPromise,
    postsTfApplies,
    statsUnresolved: shape.statsUnresolved,
    classifiedsHref: buildClassifiedsHref(linkShape),
    nextClassifiedsHref: buildNextClassifiedsHref(linkShape),
  };
}

// The insertion point for pricedb.io and posts.tf: right after gladiator.tf.
// itemCard.js's rebuildRow inserts posts.tf first and pricedb.io second at
// this same index, which yields gladiator.tf, pricedb.io, posts.tf,
// marketplace.tf, ... whichever promise settles first.
function afterGladiatorIndex(links) {
  const gladiatorIndex = links.findIndex((l) => l.label === "gladiator.tf");
  return gladiatorIndex === -1 ? 0 : gladiatorIndex + 1;
}

/*
@description: Splices the pricedb.io {label, href} entry into an already-
built links array (see pricedbPromise's own note above) once it resolves to a
real href - see afterGladiatorIndex's own note on the resulting position.
Returns the original array unchanged (not a copy) when pricedbHref is null (no
match found) - nothing to insert.
*/
export function insertPricedbLink(links, pricedbHref) {
  if (!pricedbHref) return links;

  const insertAt = afterGladiatorIndex(links);
  return [...links.slice(0, insertAt), { label: "pricedb.io", href: pricedbHref }, ...links.slice(insertAt)];
}

/*
@description: Splices a loading pricedb.io entry (href: null, loading: true;
itemCard.js renders it as utils/linkButtonStates.js's label + spinner state)
where insertPricedbLink would put the real button, so the row layout is
stable from the first paint.
See #133.
*/
export function insertPricedbPlaceholder(links) {
  const insertAt = afterGladiatorIndex(links);
  return [...links.slice(0, insertAt), { label: "pricedb.io", href: null, loading: true }, ...links.slice(insertAt)];
}

/*
@description: Splices a rate-limited pricedb.io entry into the links array at
the same position insertPricedbLink would put the real button, when
pricedbPromise settles with rateLimited: true, instead of dropping the slot
the way a genuine miss does. itemCard.js renders it as a countdown to
retryAt (utils/linkButtonStates.js), then retries the lookup.
*/
export function insertPricedbRateLimited(links, retryAt) {
  const insertAt = afterGladiatorIndex(links);
  return [...links.slice(0, insertAt), { label: "pricedb.io", href: null, rateLimitedUntil: retryAt }, ...links.slice(insertAt)];
}

/*
@description: Splices a loading posts.tf entry into the links array, like
insertPricedbPlaceholder. Only used when postsTfApplies is true.
*/
export function insertPostsTfPlaceholder(links) {
  const insertAt = afterGladiatorIndex(links);
  return [...links.slice(0, insertAt), { label: "posts.tf", href: null, loading: true }, ...links.slice(insertAt)];
}

/*
@description: Splices posts.tf's resolved result into the links array: the
real link, the compact "posts.tf + key" hint when only a missing Steam Web
API key is in the way, or nothing. The hint is skipped when statsUnresolved
is true, because the stats prompt already asks for the key (and covers
posts.tf too).
@param postsTfResult -> postsTfPromise's {href, needsKey}
@param statsUnresolved -> resolveItemDetails.js's own exposed shape.statsUnresolved
*/
export function insertPostsTfResult(links, { href, needsKey }, statsUnresolved) {
  const insertAt = afterGladiatorIndex(links);
  if (href) {
    return [...links.slice(0, insertAt), { label: "posts.tf", href }, ...links.slice(insertAt)];
  }
  if (needsKey && !statsUnresolved) {
    return [
      ...links.slice(0, insertAt),
      { label: "posts.tf", href: null, needsKey: true, title: POSTS_TF_KEY_HINT_TITLE },
      ...links.slice(insertAt),
    ];
  }
  return links;
}
