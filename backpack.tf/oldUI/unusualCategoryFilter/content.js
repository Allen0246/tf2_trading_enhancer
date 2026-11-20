/*
@description: Groups classic backpack.tf's /unusuals page into two
always-visible sections - "Hats" / "Taunts" - plus an All/Hats/Taunts button
row that shows/hides whole sections at once, the same section-grouping
pattern ../effectCategoryFilter/content.js already built for the bare
/effects list page, applied here to /unusuals' own item catalog instead of
the particle-effect catalog.

Category comes directly from the item's own data-slot attribute (confirmed
live: a real taunt item's own <li> carries data-slot="taunt", e.g. "Taunt:
The Final Score" defindex 31518; a real hat's own <li> carries
data-slot="misc", e.g. "Strikeout" defindex 31480) - more robust than
matching a "Taunt: " name prefix as text, since it's a clean structured
attribute already on every item rather than something to parse out of a
display name. Anything without data-slot="taunt" falls into "Hats" by
default (a binary split, not a third bucket) - /unusuals' own catalog is
effectively just hats and taunts in practice, unlike bare /effects' particle
list, which also has a genuine (if tiny) weapon-effect category.

Unlike effectCategoryFilter, this needs no Steam Web API key/schema lookup at
all - data-slot is read directly off each item's own markup, no external
data source involved.

/unusuals ALREADY groups its items by (randomized) item Level natively - a
".page-number" bar per level, each followed by that level's own items, with a
"Select Page" jump button per bar (confirmed: this structure exists and needs
to survive Hat/Taunt grouping, not just get flattened away). This file
preserves that nested structure: each of the two top-level Hat/Taunt sections
gets its OWN copy of whichever native level bars had at least one item in
that category, in original level order, with that level's items (filtered to
just that category) underneath. A level whose items split across both
categories needs two DISTINCT bar instances (one per section) since a single
DOM node can only ever live in one place - the second instance is a clone
with its own uniquely-suffixed jump-anchor id (cloning the id verbatim would
leave two elements sharing one id, which breaks id-based lookups generally).
NOT independently confirmed: exactly what the native "Select Page" button's
own click handler does under the hood, so cloning it is a best-effort
visual/structural preservation, not a guaranteed-still-fully-functional one.

Self-scopes via an explicit pathname check (window.location.pathname exactly
"/unusuals"), not a DOM-only signal - the obvious DOM candidate (#classmenu,
/unusuals' own native class-filter dropdown) isn't reliable here:
../effectClassFilter/content.js injects a SYNTHETIC dropdown reusing that
exact same id on a specific-effect page, so checking for #classmenu alone
can't tell a real /unusuals load apart from an /effect/<name> page this same
router may have already visited earlier in its own script pass.
*/

const CATEGORY_OPTIONS = ["All", "Hats", "Taunts"];
const CATEGORY_KEYS = { Hats: "hat", Taunts: "taunt" };
const SECTIONS = [
  { key: "hat", label: "Hats" },
  { key: "taunt", label: "Taunts" },
];
const SECTION_ATTR = "data-tf2te-unusual-section";
const FILTERED_OUT_CLASS = "tf2te-unusual-category-filtered-out";
const BUTTON_GROUP_ID = "tf2te-unusual-category-filter";

function isUnusualsPage() {
  const segments = window.location.pathname.split("/").filter(Boolean);
  return segments.length === 1 && segments[0] === "unusuals";
}

function injectStyles() {
  if (document.getElementById("tf2te-unusual-category-filter-styles")) return;

  const style = document.createElement("style");
  style.id = "tf2te-unusual-category-filter-styles";
  style.textContent = `
    .${FILTERED_OUT_CLASS} { display: none !important; }
    #${BUTTON_GROUP_ID} { display: block; padding-top: 8px; }
    /* Same fix ../effectCategoryFilter/content.js's own injectStyles needed
       for "Browse by item" on the bare /effects page - /unusuals has its
       own equivalent .panel-tray-link ("Browse by effect") that isn't a
       true flow-sibling of anything this file inserts either (confirmed
       live there: margin/padding on the preceding element had zero visible
       effect, consistent with .panel-tray-link using margin-top: auto to
       pin itself to a flex container's bottom edge) - not selector-scoped
       by href this time since it's only ever injected while isUnusualsPage()
       is true, so there's no risk of it matching the wrong page's tray link. */
    a.panel-tray-link { margin-top: 8px !important; }
    /* padding, not margin - confirmed live (same as
       ../effectCategoryFilter/content.js's own #${BUTTON_GROUP_ID} spacing
       fix) that margin on a .page-number bar here produces no visible gap
       at all, presumably the same flex/grid layout quirk. Scoped to
       [${SECTION_ATTR}] so a real native .page-number bar elsewhere is
       never affected by this. */
    .page-number[${SECTION_ATTR}] { padding-top: 16px; padding-bottom: 4px; }
  `;
  document.head.appendChild(style);
}

function categoryForItem(item) {
  return item.getAttribute("data-slot") === "taunt" ? "taunt" : "hat";
}

/*
@description: Splits the list's CURRENT children into level groups the same
way the native page already visually groups them - a run of items following
one native .page-number bar, up to the next one (or the end of the list).
Items before any level bar at all (shouldn't happen on a real page, but
handled defensively rather than assumed away) become their own levelBar-less
group.
*/
function readLevelGroups(list, items) {
  const itemSet = new Set(items);
  const groups = [];
  let current = null;

  Array.from(list.children).forEach((child) => {
    if (child.classList?.contains("page-number") && !child.hasAttribute(SECTION_ATTR)) {
      current = { levelBar: child, items: [] };
      groups.push(current);
    } else if (itemSet.has(child)) {
      if (!current) {
        current = { levelBar: null, items: [] };
        groups.push(current);
      }
      current.items.push(child);
    }
  });

  return groups;
}

// Gives the clone's own jump anchor a unique id (categoryKey-suffixed) and
// repoints its own label link at that same id - see this file's own header
// note on why a single native level bar can't just be reused verbatim in
// both sections.
function cloneLevelBar(levelBar, categoryKey) {
  const clone = levelBar.cloneNode(true);
  const anchor = clone.querySelector?.(".page-anchor");
  if (anchor?.id) {
    const uniqueId = `${anchor.id}-${categoryKey}`;
    anchor.id = uniqueId;
    const link = clone.querySelector?.('a[href^="#"]');
    if (link) link.setAttribute("href", `#${uniqueId}`);
  }
  return clone;
}

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

function groupItemsIntoSections(list, items) {
  const levelGroups = readLevelGroups(list, items);

  const byCategory = { hat: [], taunt: [] }; // each: [{ levelBar, items }] in original level order
  levelGroups.forEach(({ levelBar, items: levelItems }) => {
    const byKeyThisLevel = { hat: [], taunt: [] };
    levelItems.forEach((item) => byKeyThisLevel[categoryForItem(item)].push(item));
    SECTIONS.forEach(({ key }) => {
      if (byKeyThisLevel[key].length > 0) {
        byCategory[key].push({ levelBar, items: byKeyThisLevel[key] });
      }
    });
  });

  SECTIONS.forEach(({ key, label }) => {
    const levelSubGroups = byCategory[key];
    if (levelSubGroups.length === 0) return; // no empty "Taunts" section with nothing under it

    list.appendChild(buildSectionHeader(key, label));

    levelSubGroups.forEach(({ levelBar, items: subItems }) => {
      if (levelBar) {
        const barCopy = cloneLevelBar(levelBar, key);
        barCopy.setAttribute(SECTION_ATTR, key); // so the whole-section toggle also hides/shows this nested level bar
        list.appendChild(barCopy);
      }
      subItems.forEach((item) => {
        item.setAttribute(SECTION_ATTR, key);
        list.appendChild(item);
      });
    });
  });

  // Every native level bar is now redundant - all of its items were moved
  // into the category sections above, each with its own bar copy - so the
  // originals are removed rather than left behind as empty headers.
  levelGroups.forEach(({ levelBar }) => levelBar?.remove());
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

export function unusualCategoryFilter() {
  if (!isUnusualsPage()) return;
  if (document.getElementById(BUTTON_GROUP_ID)) return;

  const inputGroup = document.getElementById("unusual-pricelist-input-group");
  if (!inputGroup) return;

  const items = Array.from(document.querySelectorAll("li.item[data-slot]"));
  if (items.length === 0) return;

  const list = items[0].parentElement;

  injectStyles();
  groupItemsIntoSections(list, items);
  inputGroup.insertAdjacentElement("afterend", buildButtonGroup());
}
