/*
@description: Adds a "Hide War Paint items" / "Show War Paint items" toggle
button next to next.backpack.tf classifieds' own "Refresh" button (inside its
PrimeVue paginator's .p-paginator-left-content, alongside
../spellFilterToggle/content.js's own button), driving the site's own real
"War Paints" filter UI - NOT a DOM class hide/show hack.

Same funnel/trait-filter MultiSelect mechanism as ../spellFilterToggle/content.js
(../shared/traitFilterPanel.js) - confirmed live: "War Paints" is just one
more entry in the same "Add filters" funnel's own category list, and its own
value panel has a "No War Paint" option (each value option an
<li role="option"> with an ".item-trait__name" div, same shape "No Spells"
already established) - checking it filters the page down to listings with no
weapon skin, exactly the "No Spells" mechanism, so (unlike
../strangeFilterToggle/content.js's own "Elevated Qualities" case, which has
no such "None" value) this can drive the real filter instead of a client-side
scan.

Unlike ../spellFilterToggle/content.js, this module tracks its own "active"
state locally (a module-level boolean, flipped from the real checkbox's own
post-click aria-selected state) rather than reading a URL query param back -
../spellFilterToggle/content.js's own header note documents relying on a
confirmed ?spell=none param, but there's no equivalent confirmed for War
Paints here, and guessing a param name risks a button label that silently
drifts from the real filter state. Reading the clicked <li>'s own
aria-selected right after the click (not just blindly flipping a boolean) is
self-correcting instead - the same "trust the real DOM's own resulting state"
reasoning already used to click the option in the first place. This does mean
manually toggling the native panel directly (bypassing this button) would
leave the button's own label stale until the next click - same acknowledged
limitation ../strangeFilterToggle/content.js's own local `hidden` state has.

Called site-wide with its own pathname self-check on every scan - same
"router runs once, Vue SPA can navigate without a reload" fix
../spellFilterToggle/content.js's own header note documents.
*/

import { openTraitFilterPanel, findTraitValueOption, isChecked, closeOpenPanel, runPanelAutomation } from "../shared/traitFilterPanel.js";

const LEFT_CONTENT_SELECTOR = ".p-paginator-left-content";
const BUTTON_CLASS = "tf2te-warpaint-filter-toggle";
const CATEGORY_LABEL = "War Paints";
const VALUE_LABEL = "No War Paint";

// Module-level - see this file's own header note on why this (not a URL
// param) is the source of truth for the button's own label.
let active = false;

/*
@description: Test-only reset hook (see utils/tf2Schema.js's own
__resetSchemaCacheForTests for the full writeup of why this repo resets
module-level state between tests via an exported function).
*/
export function __resetWarPaintFilterToggleForTests() {
  active = false;
}

function buttonLabel() {
  return active ? "Show War Paint items" : "Hide War Paint items";
}

function trace(...args) {
  console.log("[TF2 Trading Enhancer] warPaintFilterToggle:", ...args);
}

async function toggleWarPaintFilter() {
  trace("button clicked");
  await runPanelAutomation(async () => {
    const panel = await openTraitFilterPanel({ categoryLabel: CATEGORY_LABEL, markerValue: VALUE_LABEL });
    trace("War Paints panel found/opened:", Boolean(panel));
    if (!panel) return; // couldn't find/add the War Paints filter - don't guess further

    const noWarPaint = findTraitValueOption(panel, VALUE_LABEL);
    noWarPaint?.click();
    // Read the real DOM's own resulting state, not a blind flip - see this
    // file's own header note on why.
    active = isChecked(noWarPaint);
    trace("clicked 'No War Paint', now active:", active);

    await closeOpenPanel(panel);
  });
}

function buildButton(referenceButton) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `${referenceButton.className} ${BUTTON_CLASS}`;
  button.style.marginLeft = "8px";
  // Updates the label directly here, right after the toggle resolves,
  // rather than waiting for the next scan tick to pick up the new `active`
  // value - unlike ../spellFilterToggle/content.js (whose label happens to
  // get refreshed by its own click's incidental DOM mutations retriggering
  // its body-wide MutationObserver), there's no URL param here to re-derive
  // state from later, so the click itself has to be the one source of truth
  // for when the label updates.
  button.addEventListener("click", async () => {
    await toggleWarPaintFilter();
    button.textContent = buttonLabel();
  });
  return button;
}

// Same "router runs once, self-check pathname on every scan instead" fix
// ../spellFilterToggle/content.js's own header note documents.
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

  // Guarded, not an unconditional assignment - see
  // ../spellFilterToggle/content.js's own ensureButton note on why an
  // unconditional textContent reassignment here can freeze the tab (a
  // childList-mutation feedback loop with this module's own observer).
  const label = buttonLabel();
  if (button.textContent !== label) button.textContent = label;
}

function scan(root) {
  root.querySelectorAll?.(LEFT_CONTENT_SELECTOR).forEach(ensureButton);
}

export function warPaintFilterToggle() {
  scan(document);

  const observer = new MutationObserver(() => scan(document));
  observer.observe(document.body, { childList: true, subtree: true });
}
