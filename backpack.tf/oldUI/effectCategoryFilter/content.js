/*
@description: Groups classic backpack.tf's bare /effects list page (e.g.
https://backpack.tf/effects - the page that lists particle effects
themselves, not items) into three always-visible sections - "Hat effects" /
"Taunt effects" / "Weapon effects" - plus an All/Hat/Taunt/Weapon button row
that shows/hides whole sections at once. These three
categories can't be told apart from the page's own DOM (confirmed live: an
/effects list item like `<li data-effect_name="Nebula" data-effect_id="99"
...>` carries no category signal at all) or from Valve's item schema (which
only registers a particle effect's id/name, not which item types it's valid
on).

Category comes from utils/tf2Schema.js's own getEffectNameToCategoryMap,
which derives it from each particle's own internal system name (confirmed
live against real GetSchemaOverview entries: "unusual_..." -> hat,
"utaunt_..." -> taunt, "weapon_unusual_..." -> weapon - see
categorizeEffectSystem's own note) - requires a Steam Web API key to be
configured, same as ../../nextUI/effectClassFilter/content.js's own reasoning
for that dependency. Without a key the sections can't be built, so a single
"needs a key" button (utils/linkButtonStates.js's key-hint state) sits where
the button row would go, instead of nothing - the same treatment the
next.backpack.tf filters got (../../nextUI/shared/filterKeyHint.js).

Section header bars reuse the SAME classes (.page-number, .label
.label-default) the site's own /unusuals page already uses for its "Level XX"
grouping bars (confirmed live via a real `.page-number` sample: a wrapper div
containing a `.page-anchor` jump target, an `a.label.label-default` text
badge, and a "Select Page" button) - reused directly rather than
approximated, so the real backpack.tf stylesheet supplies the exact
background/padding/spacing this feature never has to guess at. The jump
anchor and "Select Page" button are both dropped - observed neither is needed
here (there is nothing to page through or select).

Runs on the bare /effects page only (an exact pathname check, the same as
the next.backpack.tf version): backpack.tf's single-item Unusual price list
(/unusual/{item}) uses the same effect-list markup, but there every effect
belongs to the one item's category, so grouping it is pointless.

Within that page it self-scopes off the SAME #unusual-pricelist-input-group container
../effectClassFilter/content.js inserts its own dropdown into on the
DIFFERENT (specific-effect) page - confirmed live that container's id is
reused verbatim on the bare /effects page too. The two features tell their
pages apart by the opposite DOM signal effectClassFilter already established:
this one requires items WITHOUT data-class (bare listing), where
effectClassFilter requires items WITH it (specific-effect page) - so both
naturally no-op on the other's page without needing a pathname check.
*/

import { getEffectNameToCategoryMap, hasSchemaAccess } from "../../../utils/tf2Schema.js";
import { applyApiKeyHint } from "../../../utils/linkButtonStates.js";

const CATEGORY_OPTIONS = ["All", "Hat", "Taunt", "Weapon"];
const CATEGORY_KEYS = { Hat: "hat", Taunt: "taunt", Weapon: "weapon" };
// Section build order, each keyed the same as tf2Schema.js's own
// categorizeEffectSystem return values - "other" is not a real schema
// category, it's this file's own bucket for an effect the schema couldn't
// resolve at all (stale cache, brand-new effect), so nothing on the page
// silently disappears just because it isn't categorized yet.
const SECTIONS = [
  { key: "hat", label: "Hat effects" },
  { key: "taunt", label: "Taunt effects" },
  { key: "weapon", label: "Weapon effects" },
  { key: "other", label: "Other effects" },
];
const SECTION_ATTR = "data-tf2te-section";
const FILTERED_OUT_CLASS = "tf2te-effect-category-filtered-out";
const BUTTON_GROUP_ID = "tf2te-effect-category-filter";
// The "needs a key" button standing in for the button row while no key is
// saved.
const KEY_HINT_ID = "tf2te-effect-category-filter-key-hint";
const KEY_HINT_TITLE = "The Hat/Taunt/Weapon filter needs a Steam Web API key to sort these effects. Click to add one (one-time setup).";

function injectStyles() {
  if (document.getElementById("tf2te-effect-category-filter-styles")) return;

  const style = document.createElement("style");
  style.id = "tf2te-effect-category-filter-styles";
  style.textContent = `
    .${FILTERED_OUT_CLASS} { display: none !important; }
    #${BUTTON_GROUP_ID}, #${KEY_HINT_ID} { display: block; padding-top: 8px; }
    /* applyApiKeyHint dims the button with an inline opacity. */
    #${KEY_HINT_ID} .btn:hover, #${KEY_HINT_ID} .btn:focus-visible { opacity: 1 !important; }
    /* Confirmed live: #${BUTTON_GROUP_ID} isn't actually adjacent to
       .panel-tray-link at all - it's nested inside .panel-body's own
       .padded child, while .panel-tray-link is a SIBLING of .padded
       (both direct children of .panel-body). Padding/margin on this
       element only grows .padded's own box, which had zero visible
       effect on .panel-tray-link's position at any size tried live -
       .panel-body's own "row-media" class name plus that total
       insensitivity to size strongly suggests .panel-tray-link uses
       margin-top: auto to pin itself to the flex container's bottom
       edge, decoupling its position from preceding content entirely.
       Overriding its margin directly (not the unrelated .padded child)
       is what actually moves it. */
    a.panel-tray-link[href="/unusuals"] { margin-top: 8px !important; }
    /* Scoped to [${SECTION_ATTR}] (this file's own header bars only) rather
       than a bare .page-number selector, so a real native .page-number bar
       elsewhere on the site is never affected by this. */
    .page-number[${SECTION_ATTR}] { margin-top: 16px; margin-bottom: 4px; }
  `;
  document.head.appendChild(style);
}

// Lowercased so lookups can match data-effect_name's own casing loosely,
// same "backpack.tf's own effect text doesn't always match the schema's
// exact casing" reasoning tf2Schema.js's own getEffectId documents.
function buildLowercaseCategoryIndex(nameToCategory) {
  const index = {};
  Object.entries(nameToCategory).forEach(([name, category]) => {
    index[name.toLowerCase()] = category;
  });
  return index;
}

function categoryForItem(item, lowercaseCategoryIndex) {
  const effectName = item.getAttribute("data-effect_name");
  const category = effectName ? lowercaseCategoryIndex[effectName.toLowerCase()] : null;
  return category && SECTIONS.some((s) => s.key === category) ? category : "other";
}

/*
@description: Reuses /unusuals' own .page-number / .label.label-default
grouping-bar classes (see this file's own header note on why) - a plain
<span>, not the real page's <a>, since there's no jump target or click
behavior to give it here.
*/
function buildSectionHeader(key, label) {
  const bar = document.createElement("div");
  bar.className = "page-number";
  bar.setAttribute(SECTION_ATTR, key);

  const badge = document.createElement("span");
  badge.className = "label label-default";
  badge.textContent = label;

  bar.appendChild(badge);
  return bar;
}

/*
@description: Moves every item into its category's group, in SECTIONS order,
inserting a header bar before each non-empty group - appendChild on an
already-attached node relocates it (removing it from its current position),
so this reorders the real list in place rather than cloning anything.
*/
function groupItemsIntoSections(list, items, lowercaseCategoryIndex) {
  const byCategory = { hat: [], taunt: [], weapon: [], other: [] };
  items.forEach((item) => {
    byCategory[categoryForItem(item, lowercaseCategoryIndex)].push(item);
  });

  SECTIONS.forEach(({ key, label }) => {
    const group = byCategory[key];
    if (group.length === 0) return; // no empty "Weapon effects" bar with nothing under it

    list.appendChild(buildSectionHeader(key, label));
    group.forEach((item) => {
      item.setAttribute(SECTION_ATTR, key);
      list.appendChild(item);
    });
  });
}

function applySectionFilter(selected) {
  document.querySelectorAll(`[${SECTION_ATTR}]`).forEach((el) => {
    const matches = selected === "All" || el.getAttribute(SECTION_ATTR) === CATEGORY_KEYS[selected];
    el.classList.toggle(FILTERED_OUT_CLASS, !matches);
  });
}

function buildButtonGroup() {
  const group = document.createElement("div");
  group.id = BUTTON_GROUP_ID;
  group.className = "btn-group";
  group.setAttribute("role", "group");

  const buttons = {};

  CATEGORY_OPTIONS.forEach((option) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-default";
    button.textContent = option;
    button.addEventListener("click", () => {
      Object.entries(buttons).forEach(([opt, btn]) => btn.classList.toggle("active", opt === option));
      applySectionFilter(option);
    });
    buttons[option] = button;
    group.appendChild(button);
  });

  buttons.All.classList.add("active");
  return group;
}

// A plain .btn-default (never Bootstrap's .disabled, whose pointer-events:
// none would block the hover text and the click).
function buildKeyHint() {
  const wrapper = document.createElement("div");
  wrapper.id = KEY_HINT_ID;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn btn-default";
  applyApiKeyHint(button, { label: "Hat / Taunt / Weapon filter", title: KEY_HINT_TITLE });
  wrapper.appendChild(button);
  return wrapper;
}

// The bare /effects list only. A single item's Unusual price list
// (/unusual/{item}) has the same effect-list markup, but every effect there
// fits that one item, so it would only ever get one section, and the other
// buttons would show an empty page.
function isBareEffectsPage() {
  return /^\/effects\/?$/.test(window.location.pathname);
}

async function tryInsert() {
  if (!isBareEffectsPage()) return;
  const inputGroup = document.getElementById("unusual-pricelist-input-group");
  if (!inputGroup) return;
  if (document.getElementById(BUTTON_GROUP_ID)) return;

  // Bare /effects list items carry data-effect_name but never data-class -
  // the opposite of ../effectClassFilter/content.js's own self-scoping
  // check, which is how these two features tell their two pages apart.
  const items = Array.from(document.querySelectorAll("li.item[data-effect_name]:not([data-class])"));
  if (items.length === 0) return;

  if (!(await hasSchemaAccess())) {
    // No key: nothing to categorize with, so show the key button instead.
    if (!document.getElementById(KEY_HINT_ID)) {
      injectStyles();
      inputGroup.insertAdjacentElement("afterend", buildKeyHint());
    }
    return;
  }

  const categoryMap = await getEffectNameToCategoryMap();
  // Re-checked after the LAST await: two quick steamApiKey changes run two
  // tryInsert calls concurrently, and both would otherwise regroup the list
  // and insert a second button row.
  if (document.getElementById(BUTTON_GROUP_ID)) return;
  const lowercaseCategoryIndex = buildLowercaseCategoryIndex(categoryMap);

  // The <ul> every item already lives in - reordering happens in place
  // inside it, rather than building a separate container, so the page's own
  // list/grid CSS keeps applying exactly as it already does.
  const list = items[0].parentElement;

  injectStyles();
  document.getElementById(KEY_HINT_ID)?.remove();
  groupItemsIntoSections(list, items, lowercaseCategoryIndex);
  // A sibling placed AFTER the whole input group (filter box + sort dropdown
  // row), not prepended inside it - observed that prepending inside
  // #unusual-pricelist-input-group crammed the buttons into that same flex
  // row, stuck flush against the filter input with no visual separation.
  inputGroup.insertAdjacentElement("afterend", buildButtonGroup());
}

export async function effectCategoryFilter() {
  await tryInsert();

  // Re-attempts the instant a Steam API key is saved/changed in the
  // extension popup - without this, a page already open when no key was
  // configured stayed without these sections/buttons forever
  // (hasSchemaAccess() failing once inside tryInsert is never retried on its
  // own - unlike the nextUI versions of this feature, this page isn't a SPA
  // so there's no MutationObserver here to incidentally retry it either),
  // requiring a manual reload to pick it up. Same pattern already
  // established for other Steam-API-key-gated features (e.g.
  // scrap.tf/itemLinks/content.js's own chrome.storage.onChanged listener).
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes.steamApiKey) return tryInsert();
  });
}
