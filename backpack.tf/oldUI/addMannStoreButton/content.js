/*
@description: Adds a "mannco.store" button into classic backpack.tf's item
hover popover, inserted into the shared "secondary" link-buttons row
../linkButtonsRow.js manages (stntrading.eu, marketplace.tf, mannco.store, in
that fixed order - see that file's own header note) - same placement/architecture
as this feature's own sibling buttons (../addGladiatorButton/content.js,
../addPricedbButton/content.js) in this folder.

Unlike those two, this file needs mannco.store's own STRUCTURED filter params
(search/quality/killstreak/sheen/killstreaker/paint/warpaints/effect), not one
joined display-name string - same param shapes
../../nextUI/addMannStoreButton/content.js's own header note documents
(confirmed live against several real mannco.store/tf2 search URLs), built here
from this popover's own classifieds href + "Label: value" Item Details lines
instead of next.backpack.tf's Vue tooltip - same DOM-reading helpers
../popoverItemDetails.js provides.

Two confirmed differences from the next.backpack.tf version, both flagged
rather than silently guessed at:
- Festivized: classic's own classifieds href has NO Festivized signal at all
  (confirmed live - see ../addMarketplaceButton/content.js's own header note),
  so the "festivized" param is omitted entirely here (mannco treats an absent
  param as "don't care", same as its own "unique"/"unusual" filter examples
  that never touched that dropdown) rather than guessed as "No festivized",
  which next.backpack.tf's version CAN state with certainty.
- Australium: unlike next.backpack.tf's tooltip title text (which embeds
  "Australium" as a literal word in itemName - see
  ../../nextUI/addPricedbButton/content.js's own header note), classic's own
  "item" param is structurally clean of it (a separate australium=1/-1 param
  instead) - manually prepended into the search text here to match, following
  the word ordering confirmed live from mannco's own item-PAGE slug examples
  (NOT independently confirmed for the filtered-search "search" param
  specifically - an assumption, not a confirmed-live fact).
*/

import { QUALITY_NAME_BY_ID, QUALITY_ID_BY_NAME } from "../../../utils/tf2Quality.js";
import { findExistingLinkButton, insertLinkButton } from "../linkButtonsRow.js";
import { isSheenKillstreakerFilterEnabled } from "../../../utils/sheenKillstreakerFilterSetting.js";
import {
  findPopoverRoot,
  findKnownEffectName,
  findKnownSheenName,
  findKnownKillstreakerName,
  findKnownPaintName,
  findTargetToolFullName,
  readClassifiedsLinkParams,
  watchAdditionalLinksRows,
} from "../popoverItemDetails.js";

// Cached rather than read fresh (async) on every button build - this file's
// own addMannStoreButtonTo/buildMannStoreParams are both fully synchronous
// (no network/schema call needed at all, see this file's own header note),
// and buildMannStoreHref is also called directly by
// ../statsPageQuickLinks/content.js, which likewise expects a synchronous
// return. Started by addMannStoreButton() at feature start-up (see its own
// note), and lazily by buildMannStoreParams below as a fallback for a
// direct buildMannStoreHref caller - never at module load, which keeps a
// plain import of this file side-effect-free (no top-level chrome.* call).
// Kept live afterward via chrome.storage.onChanged, same "read once, react to
// changes" pattern used elsewhere in this extension - a toggle flip mid-session is picked up on the NEXT popover/tab render, not
// instantly, same latency this feature's every other DOM-scraped signal
// already has.
let sheenKillstreakerFilterEnabled = true;
let sheenKillstreakerFilterWatcherStarted = false;
function ensureSheenKillstreakerFilterWatcher() {
  if (sheenKillstreakerFilterWatcherStarted) return;
  sheenKillstreakerFilterWatcherStarted = true;
  isSheenKillstreakerFilterEnabled().then((enabled) => {
    sheenKillstreakerFilterEnabled = enabled;
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.sheenKillstreakerFilterEnabled) {
      sheenKillstreakerFilterEnabled = changes.sheenKillstreakerFilterEnabled.newValue !== false;
    }
  });
}

const MANNSTORE_BUTTON_CLASS = "tf2te-mannco-store-button";

// Confirmed live, same " | (wear)"-joined shape
// ../popoverItemDetails.js's own SKINNED_WEAPON_PATTERN documents, extended to also capture the trailing "(Wear Tier)" - mannco.store's own
// search/warpaints params want the BARE weapon name and skin name kept
// separate (unlike gladiator.tf/pricedb.io's own single joined display-name
// string), so wear has to be split off here too, not just skin from weapon.
const SKINNED_WEAPON_PATTERN = /^(.+?)\s*\|\s*(.+?)\s*\([^)]+\)\s*$/;

function splitDecoratedWeapon(itemName) {
  const match = SKINNED_WEAPON_PATTERN.exec(itemName);
  if (!match) return null;
  const [, skinName, weaponName] = match;
  return { skinName: skinName.trim(), weaponName: weaponName.trim() };
}

// Confirmed live against several real mannco.store/tf2 search URLs - same table
// ../../nextUI/addMannStoreButton/content.js's own KILLSTREAK_PARAM_BY_TIER
// documents.
const KILLSTREAK_PARAM_BY_TIER = {
  0: "No",
  1: "Killstreak",
  2: "Specialized Killstreak",
  3: "Professional Killstreak",
};

/*
@description: Builds mannco.store's own filtered-search query string - same
param shapes ../../nextUI/addMannStoreButton/content.js's own
buildMannStoreParams documents, adapted for this popover's own signals (see
this file's own header note on the two confirmed differences: no festivized
param, and a manually-prepended Australium word).
*/
function buildMannStoreParams({
  itemName,
  qualityId,
  knownEffectName,
  knownSkinName,
  knownSheenName,
  knownKillstreakerName,
  knownPaintName,
  killstreakTier,
  isAustralium,
  targetToolFullName,
}) {
  ensureSheenKillstreakerFilterWatcher();

  // A target-item tool (see ../popoverItemDetails.js's
  // findTargetToolFullName) short-circuits everything below - the
  // confirmed-live shape is a bare "search" param alone, no quality/
  // killstreak/warpaints structure at all (same shape
  // ../../nextUI/addMannStoreButton/content.js's own twin documents).
  if (targetToolFullName) {
    return new URLSearchParams({ search: targetToolFullName });
  }

  const params = new URLSearchParams();
  const search = !knownSkinName && isAustralium ? `Australium ${itemName}` : itemName;
  params.set("search", search);

  const qualityName = QUALITY_NAME_BY_ID[qualityId];
  if (qualityName) params.set("quality", qualityName);

  params.set("killstreak", KILLSTREAK_PARAM_BY_TIER[killstreakTier] ?? "No");
  params.set("warpaints", knownSkinName || "No WarPaints");

  if (sheenKillstreakerFilterEnabled && knownSheenName) params.set("sheen", knownSheenName);
  if (sheenKillstreakerFilterEnabled && knownKillstreakerName) params.set("killstreaker", knownKillstreakerName);
  // Never applied for an Unusual - what makes an Unusual worth finding is its
  // effect, not whichever paint (if any) happens to be applied, and filtering
  // by both together risks eliminating results a user actually wants. Same
  // exclusion rule utils/tf2StatsLinks/index.js's own
  // resolveClassifiedsFilters already enforces for marketplace.tf's own
  // spaint[] filter (see its classicPaintId note).
  if (knownPaintName && qualityId !== QUALITY_ID_BY_NAME.Unusual) params.set("paint", knownPaintName);
  if (knownEffectName) params.set("effect", knownEffectName);

  return params;
}

// Exported - ../statsPageQuickLinks/content.js reuses this exact builder
// for the classic /stats page's own quick-links row, same reasoning that
// file's own next.backpack.tf counterpart documents.
export function buildMannStoreHref(attrs) {
  const params = buildMannStoreParams(attrs);
  return `https://mannco.store/tf2?${params.toString()}`;
}

// Same "clone a real sibling's own classes, no icon" approach
// ../addGladiatorButton/content.js's own buildGladiatorButtonEl documents.
function buildMannStoreButtonEl(referenceButton, href) {
  const button = document.createElement("a");
  button.className = referenceButton.className || "btn btn-default btn-xs";
  button.classList.add(MANNSTORE_BUTTON_CLASS);
  button.setAttribute("href", href);
  button.setAttribute("target", "_blank");
  button.setAttribute("rel", "noopener noreferrer");

  const label = document.createElement("span");
  label.textContent = "mannco.store";
  button.appendChild(label);

  return button;
}

/*
@description: Resolves and appends the mannco.store button for one
"#popover-additional-links" row. Fully synchronous, same as
../addGladiatorButton/content.js's own version - no network call needed at
all.
*/
function addMannStoreButtonTo(additionalLinksEl) {
  const root = findPopoverRoot(additionalLinksEl);
  if (!root) return;
  if (findExistingLinkButton(root, MANNSTORE_BUTTON_CLASS)) return;

  const params = readClassifiedsLinkParams(root);
  if (!params) return;
  const { itemName: rawItemName, qualityId, killstreakTier, isAustralium } = params;

  // The popover title is the confirmed-live bare-search value for a target-item
  // tool (see buildMannStoreParams' targetToolFullName note). See #2.
  const targetToolFullName = findTargetToolFullName(root, rawItemName).fullName;

  const decorated = targetToolFullName ? null : splitDecoratedWeapon(rawItemName);
  const itemName = decorated ? decorated.weaponName : rawItemName;
  const knownSkinName = decorated ? decorated.skinName : null;

  const knownEffectName = findKnownEffectName(root);
  const knownSheenName = findKnownSheenName(root);
  const knownKillstreakerName = findKnownKillstreakerName(root);
  const knownPaintName = findKnownPaintName(root);

  const referenceButton = additionalLinksEl.children?.[0];
  if (!referenceButton) return; // markup changed - don't guess where/how to build it

  const href = buildMannStoreHref({
    itemName,
    qualityId,
    knownEffectName,
    knownSkinName,
    knownSheenName,
    knownKillstreakerName,
    knownPaintName,
    killstreakTier,
    isAustralium,
    targetToolFullName,
  });

  insertLinkButton(root, additionalLinksEl, buildMannStoreButtonEl(referenceButton, href), MANNSTORE_BUTTON_CLASS);
}

export function addMannStoreButton() {
  // Started here, at feature start-up, not only lazily on the first button
  // build: the setting read is async, so a watcher first started BY a build
  // can't affect that same build - the first popover hovered on every page
  // load would otherwise ignore a Sheen/Killstreaker filter turned off.
  ensureSheenKillstreakerFilterWatcher();
  watchAdditionalLinksRows(addMannStoreButtonTo);
}
