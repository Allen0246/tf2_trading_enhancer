/*
@description: Adds a "Hide spelled items" / "Show spelled items" toggle
button next to next.backpack.tf classifieds' own "Refresh" button (inside its
PrimeVue paginator's .p-paginator-left-content), driving the site's own real
"Spells" filter UI - NOT a URL/query-string hack.

Called site-wide (not gated on the URL's own pathname) by
backpack.tf/content.js's own router - ensureButton itself checks
window.location.pathname on every scan instead (see its own note), so the
button correctly appears/disappears as next.backpack.tf's Vue SPA navigates
between /classifieds and anywhere else WITHOUT a full page reload, unlike a
one-time router-level pathname check.

Clicks the real DOM the site's own filter UI exposes rather than setting
?spell=none via a hard navigation - see ../shared/traitFilterPanel.js for how
the "Add filters" funnel and the Spells MultiSelect panel are driven.

Untested live: whether toggling via this real UI path also updates the URL's
own ?spell= param in place (no reload) - the button's own label (see
isSpellFilterActive) still reads that same URL param as its source of truth
for what to show at rest, since re-opening/inspecting the Spells panel just to
compute a label would be far more visibly intrusive than reading the URL.
See #26.
See #28.
*/

import { openTraitFilterPanel, findTraitValueOption, isChecked, closeOpenPanel, runPanelAutomation } from "../shared/traitFilterPanel.js";

const LEFT_CONTENT_SELECTOR = ".p-paginator-left-content";
const BUTTON_CLASS = "tf2te-spell-filter-toggle";
const SPELL_PARAM = "spell";
const SPELL_NONE_VALUE = "none";

function isSpellFilterActive(url) {
  return url.searchParams.get(SPELL_PARAM) === SPELL_NONE_VALUE;
}

// "Hide"/"Show", not "Remove"/"Readd" - "Remove" reads as if the listing
// itself gets deleted, when this only ever toggles the site's own real
// filter/view.
function buttonLabel(active) {
  return active ? "Show spelled items" : "Hide spelled items";
}

// Step-by-step trace logging: a click that silently does nothing has no
// error to read, so this is the only way to see from a user's console which
// step of the automated filter search failed live.
function trace(...args) {
  console.log("[TF2 Trading Enhancer] spellFilterToggle:", ...args);
}

async function toggleSpellFilter() {
  trace("button clicked");
  await runPanelAutomation(async () => {
    const panel = await openTraitFilterPanel({ categoryLabel: "Spells", markerValue: "No Spells", trace });
    trace("Spells panel found/opened:", Boolean(panel));
    if (!panel) return; // couldn't find/add the Spells filter - don't guess further

    const noSpells = findTraitValueOption(panel, "No Spells");
    trace("'No Spells' option found:", Boolean(noSpells), "was checked:", isChecked(noSpells));
    noSpells?.click();
    trace("clicked 'No Spells', now checked:", isChecked(noSpells));
    await closeOpenPanel(panel);
  });
}

function buildButton(referenceButton) {
  const button = document.createElement("button");
  button.type = "button";
  // Cloned from the native Refresh button's own classes (not hardcoded here)
  // so this stays visually identical even if next.backpack.tf's own button
  // styling changes.
  button.className = `${referenceButton.className} ${BUTTON_CLASS}`;
  // .p-paginator-left-content has no gap of its own between children -
  // confirmed live this button otherwise sits flush against Refresh.
  button.style.marginLeft = "8px";
  button.addEventListener("click", toggleSpellFilter);
  return button;
}

// Checking pathname HERE, on every scan tick (this function's own caller
// already reruns via a body-wide MutationObserver), means the button
// self-corrects as the SPA navigates - added when the user arrives at
// /classifieds without a reload, removed again if they navigate away the
// same way, matching the "self-scope off what's currently on the page"
// pattern every other next-UI feature in backpack.tf/content.js's own
// router already uses instead of a one-time router-level pathname gate.
const CLASSIFIEDS_PATHNAME_SUBSTRING = "classifieds";

function ensureButton(leftContent) {
  const existing = leftContent.querySelector(`.${BUTTON_CLASS}`);

  if (!window.location.pathname.includes(CLASSIFIEDS_PATHNAME_SUBSTRING)) {
    existing?.remove();
    return;
  }

  const referenceButton = leftContent.querySelector("button");
  if (!referenceButton) return; // markup changed - nothing to clone style from

  let button = existing;
  if (!button) {
    button = buildButton(referenceButton);
    leftContent.appendChild(button);
  }

  // Guarded, not an unconditional assignment - Node.textContent = value
  // always tears down and rebuilds the child text node internally, even when
  // value is unchanged (it doesn't diff), which counts as a childList
  // mutation. This module's own MutationObserver watches childList mutations
  // on document.body's subtree to catch Vue rebuilding/patching the
  // paginator, so comparing first means a no-op update produces no mutation
  // at all. See #27.
  const label = buttonLabel(isSpellFilterActive(new URL(window.location.href)));
  if (button.textContent !== label) button.textContent = label;
}

function scan(root) {
  root.querySelectorAll?.(LEFT_CONTENT_SELECTOR).forEach(ensureButton);
}

export function spellFilterToggle() {
  scan(document);

  const observer = new MutationObserver(() => scan(document));
  observer.observe(document.body, { childList: true, subtree: true });
}
