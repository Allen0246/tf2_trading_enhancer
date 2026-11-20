/*
@description: The "needs a Steam Web API key" state for a next.backpack.tf
filter dropdown that can't work without one (the effect-page Class filter,
the /effects "Unusual type" filter, the /items Class filter). Without it
these filters would simply not appear, which looks like the feature is
broken.

Shown in the dropdown's own spot, shaped like the dropdown (the caller's
reference element's classes and Vue scoped-style attributes), with
utils/linkButtonStates.js's key-hint state on it: the label plus the amber
key icon, an explanatory title, and click/Enter/Space opens the key settings.
Same treatment as the posts.tf key button elsewhere.
*/
import { applyApiKeyHint } from "../../../utils/linkButtonStates.js";
import { copyScopedStyleAttrs } from "./vueScopedStyle.js";

const FILTER_KEY_HINT_CLASS = "tf2te-filter-key-hint";
const STYLE_ID = "tf2te-filter-key-hint-styles";

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  // The label sits directly in the pill (applyApiKeyHint sets it as text),
  // so the pill gets the label's own 0.75rem padding the filters use.
  // !important on hover: applyApiKeyHint dims it with an inline opacity.
  style.textContent = `
    .${FILTER_KEY_HINT_CLASS} {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 0 0.75rem;
      white-space: nowrap;
      cursor: pointer;
    }
    .${FILTER_KEY_HINT_CLASS}:hover,
    .${FILTER_KEY_HINT_CLASS}:focus-visible {
      opacity: 1 !important;
    }
  `;
  document.head.appendChild(style);
}

/*
@param {string} className - the classes the real dropdown would get, so the
pill matches its size and border.
@param {Element} scopedAttrsSource - the element whose data-v-* attributes
the real dropdown copies.
@param {string} markerClass - identifies which filter this hint stands in for.
*/
export function buildFilterKeyHint({ className, scopedAttrsSource, markerClass, label, title }) {
  injectStyles();
  const pill = document.createElement("div");
  pill.className = `${className} ${FILTER_KEY_HINT_CLASS} ${markerClass}`;
  copyScopedStyleAttrs(scopedAttrsSource, pill);
  applyApiKeyHint(pill, { label, title });
  return pill;
}

export function removeFilterKeyHints(root, markerClass) {
  root.querySelectorAll(`.${markerClass}`).forEach((el) => el.remove());
}
