/*
@description: Shared readers for classic backpack.tf's item hover popover,
used by every link button that lives in it (./addGladiatorButton,
./addPricedbButton, ./addPostsTfButton, ./addStnButton,
./addMarketplaceButton, ./addMannStoreButton). Each button still builds its
own link; this file only owns what they all read off the same popover:

- the classifieds anchor's own query params (item/quality/craftable/
  australium/killstreak_tier/particle), confirmed live as
  <a href="/classifieds?item=Captain Space Mann&quality=5&tradable=1&
  craftable=1&australium=-1&particle=94&killstreak_tier=0">;
- the "Label: value" Item Details lines (Effect/Sheen/Killstreaker/Spell)
  and the nested paint label;
- the popover's own title, which carries a target-item tool's full name;
- the raw display-name reconstruction from those params.

Classic's popover is a plain Bootstrap popover: a fresh ".popover-content"
tree is appended for each hover and torn down when it closes (confirmed
live), so a plain "does this popover already have our button" check is
enough (no content-signature dedupe like next.backpack.tf's Vue tooltip).
*/

import { QUALITY_NAME_BY_ID } from "../../utils/tf2Quality.js";
import { TARGET_TOOL_BASE_NAMES } from "../../utils/tf2StatsLinks/targetTool.js";

const POPOVER_CONTENT_SELECTOR = ".popover-content";
const ADDITIONAL_LINKS_SELECTOR = "#popover-additional-links";
// Confirmed live: <dd class="popover-btns" id="popover-search-links"><a
// href="/classifieds?item=...&quality=...&tradable=1&craftable=1&
// australium=-1&particle=94&killstreak_tier=0" ...>Classifieds</a>...</dd>
const CLASSIFIEDS_LINK_SELECTOR = 'a[href*="/classifieds?item="]';

// Keyed by the classifieds href's own plain 0-3 killstreak_tier param.
export const KILLSTREAK_TIER_PREFIXES = { 3: "Professional Killstreak ", 2: "Specialized Killstreak ", 1: "Killstreak ", 0: "" };

/*
@description: The popover content root a "#popover-additional-links" row
belongs to, or its parent as a fallback.
*/
export function findPopoverRoot(additionalLinksEl) {
  return additionalLinksEl.closest?.(POPOVER_CONTENT_SELECTOR) ?? additionalLinksEl.parentElement;
}

/*
@description: Reads one of the popover's "Item Details" plain-text labels
(e.g. "Effect: Electric Hat Protector", confirmed live) by scanning every
<dd> under the popover root. Same "label: value" convention as
steamcommunity.com/shared/priceWidgets.js's findLabeledValue, kept as a
separate copy because that module is only web-accessible on
steamcommunity.com.
*/
function findLabeledDetailText(root, labelPattern) {
  const dds = root.querySelectorAll?.("dd") ?? [];
  for (const dd of dds) {
    const text = (dd.textContent || "").replace(/\s+/g, " ").trim();
    const match = labelPattern.exec(text);
    if (match) return match[1].trim();
  }
  return null;
}

export function findKnownEffectName(root) {
  return findLabeledDetailText(root, /^Effect:\s*(.+)$/i);
}

export function findKnownSheenName(root) {
  return findLabeledDetailText(root, /^Sheen:\s*(.+)$/i);
}

export function findKnownKillstreakerName(root) {
  return findLabeledDetailText(root, /^Killstreaker:\s*(.+)$/i);
}

/*
@description: Reads a Halloween Spell off its own "Spells" <dt> group
(findLabeledDetailText scans every <dd> regardless of group). The label word
varies by spell type (confirmed live: "Footsteps Spell: Violent Violet
Footprints"), so this matches any "... Spell:" label rather than one literal.
*/
export function findKnownSpellName(root) {
  return findLabeledDetailText(root, /Spell:\s*(.+)$/i);
}

/*
@description: Reads a cosmetic's Paint name. Confirmed live as a different
shape from the other labels: <dd>Paint: <span class="label label-paint">An
Extraordinary Abundance of Tinge</span> ~1.95-2.2 keys</dd>. The <dd>'s
whole text would also capture the trailing price estimate, so the nested
span's own text is read instead.
*/
export function findKnownPaintName(root) {
  const paintSpan = root.querySelector?.(".label-paint");
  if (!paintSpan) return null;
  const text = (paintSpan.textContent || "").replace(/\s+/g, " ").trim();
  return text || null;
}

/*
@description: The popover's own title text (confirmed live: <h3
class="popover-title">Third Degree Strangifier</h3>). It is a sibling of
".popover-content" under the outer ".popover" container, not a descendant,
so it is found via that outer container.
*/
function findPopoverTitleText(root) {
  const popover = root.closest?.(".popover");
  const text = popover?.querySelector?.(".popover-title")?.textContent?.replace(/\s+/g, " ").trim();
  return text || null;
}

// A target-item tool's (Strangifier/Chemistry Set) classifieds "item" param
// never carries its full name: it is either the bare tool name
// ("Strangifier") or, as reported live, the target weapon alone ("Pretty
// Boy's Pocket Pistol" for a "Pretty Boy's Pocket Pistol Strangifier"). The
// popover title has the full name either way, so a target tool is recognized
// by EITHER signal (see #33): the bare tool name (TARGET_TOOL_BASE_NAMES) or
// the title.
const TARGET_TOOL_TITLE_PATTERN = /\bStrangifier\b|\bChemistry Set\b/i;

/*
@description: Detects a target-item tool popover (see TARGET_TOOL_TITLE_PATTERN's
note) and returns its full display name from the popover title.
@returns {{isTargetTool: boolean, fullName: ?string}} fullName is null when
the popover is not a target tool, or when it is but has no title to read.
*/
export function findTargetToolFullName(root, itemName) {
  const title = findPopoverTitleText(root);
  const isTargetTool = TARGET_TOOL_BASE_NAMES.has(itemName) || TARGET_TOOL_TITLE_PATTERN.test(title || "");
  return { isTargetTool, fullName: isTargetTool ? title : null };
}

/*
@description: Reads the item identity off the popover's classifieds anchor.
craftable/australium use classic's own "1"/"-1" convention. The "particle"
param is backpack.tf's own resolved numeric effect id, so it is passed on as
knownEffectId and no schema (or Steam Web API key) is needed to resolve an
Unusual's effect.
@returns null when the anchor or its "item" param is missing.
*/
export function readClassifiedsLinkParams(root) {
  const classifiedsAnchor = root.querySelector?.(CLASSIFIEDS_LINK_SELECTOR);
  if (!classifiedsAnchor) return null;

  const url = new URL(classifiedsAnchor.getAttribute("href"), window.location.href);
  const itemName = url.searchParams.get("item");
  if (!itemName) return null;

  const particleParam = url.searchParams.get("particle");
  return {
    itemName,
    qualityId: Number(url.searchParams.get("quality")),
    killstreakTier: Number(url.searchParams.get("killstreak_tier") || 0),
    isAustralium: url.searchParams.get("australium") === "1",
    isNonCraftable: url.searchParams.get("craftable") === "-1",
    knownEffectId: particleParam && particleParam !== "0" ? Number(particleParam) : null,
  };
}

/*
@description: Rebuilds the quality-prefixed display name (e.g. "Strange
Professional Killstreak Australium Rocket Launcher") from the classifieds
params, in the word order utils/tf2StatsLinks/index.js's
resolveClassifiedsFilters strips them back apart in (craftability, quality,
killstreak tier, australium). Classic's href has no Festivized signal at all
(confirmed live), so that prefix is never added.

knownEffectName (optional): for an Unusual, replaces the literal "Unusual"
quality word with the effect name, giving the community "{Effect} {Item}"
display name gladiator.tf/pricedb.io search by. Callers that feed
resolveStatsAndClassifieds must NOT pass it: that resolver needs the literal
"Unusual" word to dispatch into its Unusual branch.
*/
export function buildItemNameRaw(itemName, qualityId, { isNonCraftable, killstreakTier, isAustralium, knownEffectName } = {}) {
  const qualityName = QUALITY_NAME_BY_ID[qualityId];
  const craftPrefix = isNonCraftable ? "Non-Craftable " : "";
  let qualityPrefix = "";
  if (qualityName === "Unusual") qualityPrefix = knownEffectName ? `${knownEffectName} ` : "Unusual ";
  else if (qualityName && qualityName !== "Unique") qualityPrefix = `${qualityName} `;
  const killstreakPrefix = KILLSTREAK_TIER_PREFIXES[killstreakTier] ?? "";
  const australiumPrefix = isAustralium ? "Australium " : "";
  return `${craftPrefix}${qualityPrefix}${killstreakPrefix}${australiumPrefix}${itemName}`;
}

// Confirmed live: a Decorated Weapon's "item" param joins skin and weapon
// with a literal " | ", e.g. "Secretly Serviced | Powerjack (Battle Scarred)".
// A standalone War Paint tool uses the same shape with the literal word
// "War Paint" as the weapon half, e.g. "Ocean Mapped | War Paint
// (Field-Tested)".
const SKINNED_WEAPON_PATTERN = /^(.+?)\s*\|\s*(.+)$/;
const WAR_PAINT_TOOL_PATTERN = /^War Paint\b/i;

function splitSkinnedWeapon(itemName, qualityId) {
  const match = SKINNED_WEAPON_PATTERN.exec(itemName);
  if (!match) return null;
  const [, skinName, weaponAndWear] = match;
  // "Strange " only for the Strange-tracking variant: the plain Decorated
  // Weapon quality (id 15) never has a text quality prefix of its own.
  const strangePrefix = QUALITY_NAME_BY_ID[qualityId] === "Strange" ? "Strange " : "";
  return { strangePrefix, skinName: skinName.trim(), weaponAndWear: weaponAndWear.trim() };
}

/*
@description: A Decorated Weapon's (or War Paint tool's) readable display
name, skin and weapon joined by one space (e.g. "Secretly Serviced Powerjack
(Battle Scarred)"), for buttons that only need display text. Returns null
when "item" has no " | " at all, so the caller falls back to
buildItemNameRaw.
*/
export function buildReadableDecoratedWeaponName(itemName, qualityId) {
  const parts = splitSkinnedWeapon(itemName, qualityId);
  if (!parts) return null;
  return `${parts.strangePrefix}${parts.skinName} ${parts.weaponAndWear}`;
}

/*
@description: The raw name utils/tf2StatsLinks/ expects for a Decorated
Weapon or War Paint tool, for buttons that go through
resolveStatsAndClassifieds. decoratedWeapon.js's matchDecoratedWeapon wants
skin and weapon concatenated with NO separator ("{skin}{weapon} (wear)"),
while warPaintTool.js's matchWarPaintTool needs a space before "War Paint"
("(.+) War Paint (...)"). Embedding killstreak tier/sheen in the text would
break matchDecoratedWeapon's skin-name prefix search, so callers pass those
as separate known* options instead. Returns null when "item" has no " | ".
*/
export function buildSchemaDecoratedWeaponName(itemName, qualityId) {
  const parts = splitSkinnedWeapon(itemName, qualityId);
  if (!parts) return null;
  const separator = WAR_PAINT_TOOL_PATTERN.test(parts.weaponAndWear) ? " " : "";
  return `${parts.strangePrefix}${parts.skinName}${separator}${parts.weaponAndWear}`;
}

/*
@description: Runs addButtonTo(row) for every "#popover-additional-links"
row on the page now, and for every one a later hover adds.
*/
export function watchAdditionalLinksRows(addButtonTo) {
  const scan = (root) => {
    root.querySelectorAll?.(ADDITIONAL_LINKS_SELECTOR).forEach((el) => addButtonTo(el));
  };

  scan(document);

  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType !== Node.ELEMENT_NODE) return;

        if (node.matches?.(ADDITIONAL_LINKS_SELECTOR)) {
          addButtonTo(node);
        } else {
          scan(node);
        }
      });
    });
  });

  observer.observe(document.body, { childList: true, subtree: true });
}
