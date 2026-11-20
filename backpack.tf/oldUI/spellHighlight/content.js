/*
@description: On classic backpack.tf, adds a colored dotted bottom border to
any item element that has a spell attached - green for one spell
(data-spell_1 present, data-spell_2 absent), red for two (both present).
These are the exact same data-spell_1/data-spell_2 attributes
../spellFilterToggle/content.js already reads on classifieds listings -
this just runs everywhere that attribute shows up (self-scoping, not
page-restricted) instead of being tied to one specific page.

Only the border-bottom property is set (via style.setProperty), never the
whole style attribute: a listing item already carries an inline
border-color/background-color (its quality coloring) that overwriting the
attribute would wipe out.
*/

const GREEN = "#10ff00";
const RED = "#ff2121";

function markSpell(el) {
  const hasSecondSpell = Boolean(el.getAttribute("data-spell_2"));
  el.style.setProperty("border-bottom", `6px dotted ${hasSecondSpell ? RED : GREEN}`, "important");
}

function scan(root) {
  root.querySelectorAll?.("[data-spell_1]").forEach(markSpell);
}

export function spellHighlight() {
  scan(document);

  // Re-running this on every mutation is safe even without an "already
  // marked" guard - style.setProperty is an attribute-level change, not a
  // childList one, so it can never re-trigger this observer itself (see
  // ../spellFilterToggle/content.js's own header note on the unrelated bug
  // that DOES apply to unconditional textContent reassignment specifically).
  const observer = new MutationObserver(() => scan(document));
  observer.observe(document.body, { childList: true, subtree: true });
}
