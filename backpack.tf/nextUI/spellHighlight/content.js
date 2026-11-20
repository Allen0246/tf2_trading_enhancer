/*
@description: On next.backpack.tf, adds a colored dotted bottom border to
any item tile that has a spell attached - green for one, red for two.
Same idea as ../../oldUI/spellHighlight/content.js, rebuilt against
next.backpack.tf's own real markup rather than assumed to carry an
equivalent to classic UI's data-spell_1/data-spell_2 (it doesn't - confirmed
live, an item tile has no plain spell attribute of its own at all).

Confirmed live: an item tile renders each of its special attributes (spells
among them) as an SVG inside its own `.item__icons` container, one icon per
attribute, each carrying a class of the exact shape `attribute__<slug>` -
e.g. a tile with Exorcism shows `<svg class="... attribute__exorcism-spell">`
there. The 16 slugs checked below are the exact confirmed-live set from
next.backpack.tf's own "Spells" filter panel (see
../spellFilterToggle/content.js's own header note on that panel - the same
icon divs there carry these same classes), not guessed. `.item__icons` can
hold icons for OTHER special attributes too (a Paint icon confirmed live as
`attribute__undefined`, sheens, killstreakers, etc.) - only classes in this
exact allowlist count as a spell, so those are never mistaken for one.

The tile's own href varies by page (`/item/<id>` on an item's own page,
`/classifieds/<appid>_<assetid>` on a classifieds listing, confirmed live for
both) - rather than enumerate every href shape this extension has or hasn't
seen yet, the selector below matches on the "item__quality-" class both
confirmed shapes share instead, which is tied to the tile itself, not
whatever page happens to be showing it.
*/

const SPELL_ATTRIBUTE_CLASSES = [
  "attribute__exorcism-spell",
  "attribute__voices-from-below-spell",
  "attribute__pumpkin-bombs-spell",
  "attribute__halloween-fire-spell",
  "attribute__team-spirit-fp",
  "attribute__headless-horseshoes-fp",
  "attribute__corpse-gray-fp",
  "attribute__violent-violet-fp",
  "attribute__bruised-purple-fp",
  "attribute__gangreen-fp",
  "attribute__rotten-orange-fp",
  "attribute__die-job",
  "attribute__chromatic-corruption",
  "attribute__putrescent-pigmentation",
  "attribute__spectral-spectrum",
  "attribute__sinister-staining",
];

const ITEM_SELECTOR = 'a.item[class*="item__quality-"]';
const GREEN = "#10ff00";
const RED = "#ff2121";

function countSpellIcons(itemEl) {
  let count = 0;
  itemEl.querySelectorAll(".item__icons svg").forEach((svg) => {
    if (SPELL_ATTRIBUTE_CLASSES.some((cls) => svg.classList.contains(cls))) count++;
  });
  return count;
}

function markSpell(itemEl) {
  const count = countSpellIcons(itemEl);
  if (count === 0) {
    // Actively clears any border a PREVIOUS scan may have set - not a no-op.
    // next.backpack.tf recycles the same DOM node for a different item as
    // search results re-render (confirmed live after using the "Hide spelled
    // items" toggle), so a tile with no spell - or only an unrelated Paint
    // icon - would otherwise keep the stale border of whatever spelled item
    // previously occupied that node.
    itemEl.style.removeProperty("border-bottom");
    return;
  }
  itemEl.style.setProperty("border-bottom", `6px dotted ${count >= 2 ? RED : GREEN}`, "important");
}

function scan(root) {
  root.querySelectorAll?.(ITEM_SELECTOR).forEach(markSpell);
}

export function spellHighlight() {
  scan(document);

  // Item tiles render/re-render client-side (search results, pagination) -
  // a MutationObserver is the only way to keep catching new ones. Safe to
  // re-run unconditionally on every mutation, same reasoning as the classic
  // UI version: style.setProperty is an attribute-level change, not a
  // childList one, so it can never re-trigger this observer itself.
  const observer = new MutationObserver(() => scan(document));
  observer.observe(document.body, { childList: true, subtree: true });
}
