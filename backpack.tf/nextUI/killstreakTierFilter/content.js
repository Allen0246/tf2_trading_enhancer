/*
@description: Adds four "None"/"Standard"/"Specialized"/"Professional"
Killstreak-tier filter buttons on next.backpack.tf's classifieds page,
driving the site's own real "Killstreak Tiers" filter UI - same "Add
filters" funnel + trait-filter MultiSelect mechanism as
../spellFilterToggle/content.js (../shared/traitFilterPanel.js; confirmed
live: it's the SAME funnel panel, "Killstreak Tiers" is just one more entry
in its own category list), adapted here for FOUR target values instead of
one on/off toggle.

Rendered as its own row, inserted right after the WHOLE PrimeVue paginator
bar (.p-paginator) rather than appended inside its own
.p-paginator-left-content next to Refresh/the Spell filter toggle, seen as
too crowded sharing one line with those. .p-paginator-left-content is just
the paginator's own first child (confirmed live), so the anchor here is
leftContent.closest(".p-paginator") - not leftContent itself - then
insertAdjacentElement("afterend", ...) on the WHOLE paginator, the same
"insert a standalone row after a native anchor, not inline in whatever row
it's part of" pattern already used elsewhere in this codebase (e.g.
backpack.tf/nextUI/shared/tooltipButtonRow.js).

Confirmed live values (the trait-filter's own value panel, once the
"Killstreak Tiers" column is added): "None", "Standard", "Specialized",
"Professional" - each an <li role="option"> with an ".item-trait__name"
div, same shape ../spellFilterToggle/content.js's own "No Spells" already
established. Clicking one of these buttons makes that tier the ONLY one
checked (unchecking any other tier value first) - a mutually-exclusive
single choice, matching how
backpack.tf/nextUI/statsPageQuickLinks/content.js's own Killstreak-tier
switcher already behaves on the /stats page - rather than leaving this as
independent checkboxes a user could stack into an OR filter, which isn't
what "switch to this tier" implies.

No active-tier highlighting on the buttons themselves (unlike the /stats
page's own switcher) - unlike that page's own killstreakTier URL param,
there's no confirmed-live signal for classifieds' own currently-applied
tier without opening the (normally closed) trait-filter panel just to
check, which would be far more visibly intrusive than the /stats page's own
plain URL read. Deferred rather than guessed.

Called site-wide with its own pathname self-check on every scan - same
"router runs once, Vue SPA can navigate without a reload" reasoning
../spellFilterToggle/content.js's own header note documents.
*/

import { openTraitFilterPanel, findTraitValueOption, isChecked, closeOpenPanel, runPanelAutomation } from "../shared/traitFilterPanel.js";

const LEFT_CONTENT_SELECTOR = ".p-paginator-left-content";
const PAGINATOR_SELECTOR = ".p-paginator";
const ROW_CLASS = "tf2te-ks-tier-filter-row";
const BUTTON_CLASS = "tf2te-ks-tier-filter-button";
const KS_TIER_CATEGORY_LABEL = "Killstreak Tiers";
// Confirmed live order matches the trait-filter's own value panel.
const KS_TIER_VALUES = ["None", "Standard", "Specialized", "Professional"];
// Used to confirm an opened trait-filter's panel is the Killstreak Tiers
// one specifically (not Spells/Sheens/Paints/...) -
// "Standard" alone is enough, and unlikely to collide with any other trait
// category's own value names (Sheens/Killstreakers/Paints are all named
// differently).
const KS_TIER_MARKER_VALUE = "Standard";

function trace(...args) {
  console.log("[TF2 Trading Enhancer] killstreakTierFilter:", ...args);
}

/*
@description: Makes targetLabel the ONLY checked Killstreak-tier value -
unchecks every other tier value that happens to already be checked, then
checks the target if it isn't already. Mutually exclusive by construction
(see this file's own header note on why), not just "toggle this one value"
the way ../spellFilterToggle/content.js's own toggleSpellFilter is (Spells
only ever has one meaningful value to toggle at all).
*/
async function selectKillstreakTier(targetLabel) {
  trace("button clicked:", targetLabel);
  await runPanelAutomation(async () => {
    const panel = await openTraitFilterPanel({ categoryLabel: KS_TIER_CATEGORY_LABEL, markerValue: KS_TIER_MARKER_VALUE });
    trace("Killstreak Tiers panel found/opened:", Boolean(panel));
    if (!panel) return; // couldn't find/add the filter - don't guess further

    for (const label of KS_TIER_VALUES) {
      const option = findTraitValueOption(panel, label);
      if (!option) continue;
      const checked = isChecked(option);
      if (label === targetLabel ? !checked : checked) option.click();
    }
    trace("applied tier:", targetLabel);

    await closeOpenPanel(panel);
  });
}

// Clears only the two corners that touch an adjacent button in the group,
// leaving the outermost corners (first button's own left side, last
// button's own right side) exactly as the cloned reference button's class
// already renders them - the standard "segmented control" technique classic
// backpack.tf's own .stats-killstreak-list/#ks-tier-nav btn-group already
// uses (see ../../oldUI/addKSButtons/content.js's own buildKsButtonEl), so
// the four buttons read as one joined strip rather than separate pills.
function applyGroupedCorners(button, index, total) {
  if (index > 0) {
    button.style.borderTopLeftRadius = "0";
    button.style.borderBottomLeftRadius = "0";
  }
  if (index < total - 1) {
    button.style.borderTopRightRadius = "0";
    button.style.borderBottomRightRadius = "0";
  }
}

function buildButtonRow(referenceButton) {
  const row = document.createElement("div");
  row.className = ROW_CLASS;
  row.style.display = "inline-flex";
  // No gap/wrap - a joined strip, not spaced-out pills (see
  // applyGroupedCorners's own note).
  row.style.flexWrap = "nowrap";
  // Its own standalone line (see this file's own header note) - a little
  // breathing room from the paginator bar right above it.
  row.style.marginTop = "8px";

  KS_TIER_VALUES.forEach((label, index) => {
    const button = document.createElement("button");
    button.type = "button";
    // Cloned from the native Refresh button's own classes (not hardcoded
    // here), same reasoning ../spellFilterToggle/content.js's own
    // buildButton documents.
    button.className = `${referenceButton.className} ${BUTTON_CLASS}`;
    button.textContent = label;
    applyGroupedCorners(button, index, KS_TIER_VALUES.length);
    // Overlaps the adjacent button's own border by 1px instead of sitting
    // flush against it - same standard button-group trick avoiding a
    // doubled-thickness seam where two 1px borders would otherwise stack.
    if (index > 0) button.style.marginLeft = "-1px";
    button.addEventListener("click", () => selectKillstreakTier(label));
    row.appendChild(button);
  });

  return row;
}

// Same "router runs once, self-check pathname on every scan instead" fix
// ../spellFilterToggle/content.js's own header note documents.
const CLASSIFIEDS_PATHNAME_SUBSTRING = "classifieds";

function ensureButtonRow(leftContent) {
  // .p-paginator-left-content is just the paginator's own first child
  // (confirmed live) - the new row is inserted as a SIBLING of the whole
  // paginator, not a descendant, so both the dedupe check and the insert
  // itself need the paginator's own parent, not leftContent.
  const paginator = leftContent.closest(PAGINATOR_SELECTOR);
  if (!paginator?.parentElement) return; // markup changed - nowhere safe to anchor on

  const container = paginator.parentElement;
  const existing = container.querySelector(`.${ROW_CLASS}`);

  if (!window.location.pathname.includes(CLASSIFIEDS_PATHNAME_SUBSTRING)) {
    existing?.remove();
    return;
  }

  if (existing) return; // nothing to keep in sync - these buttons have no label state of their own

  const referenceButton = leftContent.querySelector("button");
  if (!referenceButton) return; // markup changed - nothing to clone style from

  paginator.insertAdjacentElement("afterend", buildButtonRow(referenceButton));
}

function scan(root) {
  root.querySelectorAll?.(LEFT_CONTENT_SELECTOR).forEach(ensureButtonRow);
}

export function killstreakTierFilter() {
  scan(document);

  const observer = new MutationObserver(() => scan(document));
  observer.observe(document.body, { childList: true, subtree: true });
}
