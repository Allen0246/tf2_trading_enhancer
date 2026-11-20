/*
@description: Adds Tab-to-autocomplete to classic backpack.tf's own
"Build a Search"/filter modal Texture Name field (input.filter-text[data-key=
"texture_name"], confirmed live inside #panel-texture on BOTH
https://backpack.tf/premium/search and https://backpack.tf/classifieds,
which share this exact same field markup byte-for-byte) - that field
requires an EXACT skin name (its own placeholder says so) but offers no
suggestions of its own.

As the user types, the best (first) matching known skin name is shown as
plain gray hint text right after the input (a deliberate simplification -
overlaying the hint ON TOP of the input using hardcoded pixel offsets would
be fragile to keep lined up on this site). Pressing Tab fills the
input with that match (its default focus-changing behavior is suppressed
only while there's a match to fill in) and, if more than one skin name matched, cycles to
the next alternative on each subsequent Tab press without retyping anything,
reusing this codebase's own bundled utils/warpaints.js skin data (a real
sourced dataset) rather than a separately hand-typed list.

Retries via a MutationObserver, not a single one-shot call - the sibling
Particle Effect panel on this same modal was confirmed live to render
asynchronously after initial page load (built by the page's own JS from a
fetched dataset, so a one-shot call on a fresh load found nothing), so the
same caution applies here defensively even though this specific field wasn't
independently confirmed to have the identical timing issue.
*/

import { findSkinNamesByPrefix } from "../../../utils/warpaints.js";

const INPUT_SELECTOR = 'input.filter-text[data-key="texture_name"]';
const HINT_ID = "tf2te-skin-autocomplete-hint";

function injectStyles() {
  if (document.getElementById("tf2te-skin-autocomplete-styles")) return;

  const style = document.createElement("style");
  style.id = "tf2te-skin-autocomplete-styles";
  style.textContent = `
    #${HINT_ID} { color: gray; font-size: 12px; margin-top: 4px; }
  `;
  document.head.appendChild(style);
}

function tryInsert() {
  const input = document.querySelector(INPUT_SELECTOR);
  if (!input) return;
  if (document.getElementById(HINT_ID)) return; // already inserted

  injectStyles();

  const hint = document.createElement("div");
  hint.id = HINT_ID;
  input.insertAdjacentElement("afterend", hint);

  // Closure-scoped, not module-level - there's only ever one of these
  // inputs on the page, but this keeps the state tied to this one
  // insertion rather than a bare shared variable.
  let currentMatches = [];

  // Tab only takes over (instead of moving focus) while there's actually a
  // suggestion to fill in - blocking it unconditionally trapped keyboard
  // focus in this field with no way to Tab out.
  input.addEventListener("keydown", (event) => {
    if (event.key === "Tab" && currentMatches.length > 0) event.preventDefault();
  });

  input.addEventListener("keyup", async (event) => {
    if (event.key === "Tab") {
      if (currentMatches.length === 0) return;
      input.value = currentMatches[0];
      currentMatches.push(currentMatches.shift()); // rotate - the next Tab press cycles to the next alternative
      hint.textContent = "";
      return;
    }

    currentMatches = await findSkinNamesByPrefix(input.value);
    hint.textContent =
      currentMatches.length > 0 ? `${currentMatches[0]} - Press Tab to autocomplete, press again for alternative suggestions` : "";
  });
}

export function premiumSearchSkinAutocomplete() {
  tryInsert();

  const observer = new MutationObserver(() => tryInsert());
  observer.observe(document.body, { childList: true, subtree: true });
}
