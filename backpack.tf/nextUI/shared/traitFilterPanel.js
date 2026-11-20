/*
@description: Drives next.backpack.tf classifieds' own real filter UI, shared
by ../spellFilterToggle, ../warPaintFilterToggle and ../killstreakTierFilter.

A filter like "Spells" is not always a visible column: it has to be added
first via the funnel button (labelled "Add filters" with none added yet,
"Add more filters" once at least one is - both matched), whose own panel
lists every filter CATEGORY ("War Paints", "Spells", "Killstreak Tiers",
...) as plain <span> options. Re-clicking an already-added category there
REMOVES its column (confirmed live), so it is only clicked when confirmed
not already added. Once visible, the column is a PrimeVue MultiSelect
(.trait-filter) whose panel lists the VALUES ("No Spells", "Exorcism", ...),
each an <li role="option"> with an ".item-trait__name" div - which the
funnel panel's options never have, the one reliable way to tell the two
near-identical panels apart. A checked option has aria-selected="true"
(confirmed live) and is toggled by a real .click() on the <li>. Every panel
has its own ".p-multiselect-close" button, used to close it again.
*/

const ADD_FILTERS_BUTTON_SELECTOR = 'button[content="Add filters"], button[content="Add more filters"]';
const TRAIT_FILTER_SELECTOR = ".trait-filter";
const PANEL_SELECTOR = ".p-multiselect-panel";
const PANEL_CLOSE_SELECTOR = ".p-multiselect-close";

async function waitFor(conditionFn, { timeoutMs = 1500, pollMs = 50 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = conditionFn();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return null;
}

/*
@description: Closes the given panel and waits for it to actually leave the
DOM. PrimeVue's close likely runs an exit transition, so the panel can still
be present (and populated) for a moment after the close click; opening the
next dropdown right away risked document.querySelector(PANEL_SELECTOR)
grabbing that stale, still-closing panel instead of the new one.
*/
export async function closeOpenPanel(panel) {
  panel?.querySelector(PANEL_CLOSE_SELECTOR)?.click();
  await waitFor(() => !document.querySelector(PANEL_SELECTOR));
}

// A trait-filter panel's VALUE option vs. the funnel panel's CATEGORY option
// (see this file's own header note).
export function findTraitValueOption(panel, label) {
  const li = panel?.querySelector(`li[aria-label="${label}"]`);
  return li?.querySelector(".item-trait__name") ? li : null;
}

function findCategoryOption(panel, label) {
  const li = panel?.querySelector(`li[aria-label="${label}"]`);
  return li && !li.querySelector(".item-trait__name") ? li : null;
}

export function isChecked(li) {
  return li?.getAttribute("aria-selected") === "true";
}

/*
@description: Waits for a panel that has ALSO populated its option list.
Confirmed live: PrimeVue renders the panel shell first and fills in its <li>
options a moment later, so checking the bare container could wrongly
conclude an option doesn't exist.
*/
function waitForPopulatedPanel() {
  return waitFor(() => {
    const panel = document.querySelector(PANEL_SELECTOR);
    return panel?.querySelector('li[role="option"]') ? panel : null;
  });
}

/*
@description: Opens one already-visible .trait-filter dropdown and returns its
panel if it is the wanted one (contains markerValue as a value option);
otherwise closes it again and returns null, so scanning several unrelated
columns never leaves more than one panel open or mistakes one for another.
*/
async function openIfTrait(trait, markerValue, trace) {
  const trigger = trait.querySelector(".p-multiselect-trigger") || trait;
  trace("opening trait-filter, trigger found:", trigger !== trait);
  trigger.click();

  const panel = await waitForPopulatedPanel();
  trace("panel appeared:", Boolean(panel));
  if (!panel) return null;

  const isWanted = Boolean(findTraitValueOption(panel, markerValue));
  trace(`panel has "${markerValue}":`, isWanted);
  if (isWanted) return panel;

  await closeOpenPanel(panel);
  return null;
}

async function findOpenTraitPanel(markerValue, trace) {
  for (const trait of document.querySelectorAll(TRAIT_FILTER_SELECTOR)) {
    const panel = await openIfTrait(trait, markerValue, trace);
    if (panel) return panel;
  }
  return null;
}

/*
@description: Finds and OPENS the trait-filter panel for categoryLabel,
adding that column first (via the funnel picker) if it isn't visible yet.
markerValue is a value option only that category's panel has (e.g. "No
Spells"). Returns null (having closed whatever it opened) if the expected
markup isn't found anywhere along the way, rather than guessing.
@param {{categoryLabel: string, markerValue: string, trace?: Function}} options
*/
export async function openTraitFilterPanel({ categoryLabel, markerValue, trace = () => {} }) {
  const existing = await findOpenTraitPanel(markerValue, trace);
  if (existing) return existing;

  const addFiltersButton = document.querySelector(ADD_FILTERS_BUTTON_SELECTOR);
  trace("Add filters button found:", Boolean(addFiltersButton));
  if (!addFiltersButton) return null;
  addFiltersButton.click();

  const addPanel = await waitForPopulatedPanel();
  const categoryOption = findCategoryOption(addPanel, categoryLabel);
  trace(`"${categoryLabel}" category option found:`, Boolean(categoryOption), "already checked:", isChecked(categoryOption));
  if (!categoryOption) {
    await closeOpenPanel(addPanel);
    return null;
  }

  // Only clicked when NOT already added: re-clicking removes the column.
  if (!isChecked(categoryOption)) categoryOption.click();
  await closeOpenPanel(addPanel);

  return findOpenTraitPanel(markerValue, trace);
}

// Hides every open PrimeVue panel (opacity only, not display/visibility, so
// they stay laid out and fully interactive to a real .click(), which doesn't
// consult CSS hit-testing) while an automated run opens/closes several
// dropdowns, so the user doesn't watch each one flicker.
const HIDE_PANELS_STYLE_ID = "tf2te-trait-filter-hide-panels";

function hidePanels() {
  if (document.getElementById(HIDE_PANELS_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = HIDE_PANELS_STYLE_ID;
  style.textContent = `${PANEL_SELECTOR} { opacity: 0 !important; }`;
  document.head.appendChild(style);
}

function showPanels() {
  document.getElementById(HIDE_PANELS_STYLE_ID)?.remove();
}

// One automated run at a time, across every feature using this module: the
// panels are hidden while a run is going, so a second click looks like
// nothing is happening yet, and a second interleaved run would open/close
// the same dropdowns concurrently (and could click an option twice, undoing
// the first run's toggle).
let automationInFlight = false;

/*
@description: Runs fn() with the panels hidden, unless another run is
already in progress, in which case it returns false without calling fn.
@returns {Promise<boolean>} whether fn ran.
*/
export async function runPanelAutomation(fn) {
  if (automationInFlight) return false;
  automationInFlight = true;
  hidePanels();
  try {
    await fn();
    return true;
  } finally {
    showPanels();
    automationInFlight = false;
  }
}
