/*
@description: Shared row + fixed-order insertion helper for classic
backpack.tf's item hover popover - gladiator.tf, pricedb.io, and posts.tf live
together in their own "primary" row, and
stntrading.eu/marketplace.tf/mannco.store live together in their own
"secondary" row right after it (both new sibling "<dd>"s inserted right after
the native "#popover-additional-links" row) - not mixed into that native row
the way each used to independently append into it before, and split into two
rows (not one shared by all six) to match next.backpack.tf's own tooltip
layout, which also puts gladiator.tf/pricedb.io/posts.tf in one row and
stntrading.eu/marketplace.tf/mannco.store in another.

Genuinely shared, not duplicated per file the way every other small helper in
this folder is (see e.g. ./addGladiatorButton/content.js's own header note on
why that convention exists elsewhere) - these features are explicitly
coordinating on which of two rows their contents belong in and what order
within that row, which can't be done independently: whichever feature
resolves first has to be the one that creates its own row, and every feature
has to insert itself at the correct position regardless of which others have
already resolved (each button's own resolution timing differs - gladiator.tf/
mannco.store are synchronous, pricedb.io/marketplace.tf/posts.tf are each
behind their own async lookup) - so insertion position always has to be
computed fresh off whatever's actually in the DOM right now, never assumed
from a fixed offset.

Row-level ordering (primary before secondary) has the exact same "insert
before whichever later-group row already exists, else after
#popover-additional-links" problem individual buttons already had within one
row, solved the same way - see findOrCreateRowForGroup's own note. This
doesn't just insert every row "afterend" of #popover-additional-links
unconditionally: since insertAdjacentElement("afterend", x) always places x
truly immediately next (displacing whatever was previously there further
down), doing that naively for whichever row happens to resolve SECOND would
put it BEFORE the row that resolved first, regardless of which group it
belongs to - reversing the intended order whenever the secondary group
happens to resolve before the primary one.
*/

// Each row's own marker class, and the fixed button order within it, in the
// order the rows themselves should appear (primary's row comes before
// secondary's). Not exported - only used within this file.
const ROW_GROUPS = [
  {
    rowClass: "tf2te-link-buttons-row-primary",
    buttonOrder: ["tf2te-gladiator-tf-button", "tf2te-pricedb-button", "tf2te-posts-tf-button"],
  },
  {
    // stntrading.eu added right before marketplace.tf - see
    // ./addStnButton/content.js's own header note.
    rowClass: "tf2te-link-buttons-row-secondary",
    buttonOrder: ["tf2te-stn-button", "tf2te-marketplace-tf-button", "tf2te-mannco-store-button"],
  },
];

function findGroupIndexForClass(ownClass) {
  return ROW_GROUPS.findIndex((group) => group.buttonOrder.includes(ownClass));
}

function findRowForGroup(popoverRoot, groupIndex) {
  return popoverRoot.querySelector?.(`.${ROW_GROUPS[groupIndex].rowClass}`) ?? null;
}

/*
@description: Finds this class's own already-inserted button, if the row it
belongs in already exists and already has one - same "does this popover
already have our button" idempotency check every feature already needs
(fresh DOM tree per hover, no content-signature dedupe required - see
./addMarketplaceButton/content.js's own header note), just scoped to
whichever of the two shared rows this class's own group uses.
*/
export function findExistingLinkButton(popoverRoot, ownClass) {
  const groupIndex = findGroupIndexForClass(ownClass);
  if (groupIndex === -1) return null;
  return findRowForGroup(popoverRoot, groupIndex)?.querySelector?.(`.${ownClass}`) ?? null;
}

/*
@description: Finds (or creates) the row for a given group index, inserting
a newly-created one at the correct position relative to any OTHER group's
row that already exists - before the first later-group row that exists,
else right after #popover-additional-links (which also correctly displaces
an already-existing LATER-group row further down, since
insertAdjacentElement("afterend", x) on the same anchor always places x
truly immediately next). This has to be resolved fresh on every call (not
assumed from creation order) since which group's row gets created first
depends purely on which one of its member buttons happens to resolve first,
not anything fixed.
*/
function findOrCreateRowForGroup(popoverRoot, additionalLinksEl, groupIndex) {
  const existing = findRowForGroup(popoverRoot, groupIndex);
  if (existing) return existing;

  const row = document.createElement("dd");
  row.className = ROW_GROUPS[groupIndex].rowClass;

  let insertionAnchor = additionalLinksEl;
  for (let i = 0; i < groupIndex; i++) {
    const earlierRow = findRowForGroup(popoverRoot, i);
    if (earlierRow) insertionAnchor = earlierRow;
  }
  insertionAnchor.insertAdjacentElement("afterend", row);
  return row;
}

/*
@description: Inserts a feature's own button into whichever of the two
shared rows its class belongs to (creating that row first if needed) at the
correct position per that row's own buttonOrder - before the first existing
sibling that sorts LATER than ownClass, or appended at the end if every
existing sibling sorts earlier (or none exist yet).
*/
export function insertLinkButton(popoverRoot, additionalLinksEl, button, ownClass) {
  const groupIndex = findGroupIndexForClass(ownClass);
  if (groupIndex === -1) return; // unknown class - nothing to do, don't guess a row
  const { buttonOrder } = ROW_GROUPS[groupIndex];
  const row = findOrCreateRowForGroup(popoverRoot, additionalLinksEl, groupIndex);

  const ownIndex = buttonOrder.indexOf(ownClass);
  const siblings = Array.from(row.children);
  const nextSibling = siblings.find((child) => {
    const siblingClass = buttonOrder.find((c) => child.classList.contains(c));
    const siblingIndex = siblingClass ? buttonOrder.indexOf(siblingClass) : -1;
    return siblingIndex > ownIndex;
  });

  if (nextSibling) {
    row.insertBefore(button, nextSibling);
  } else {
    row.appendChild(button);
  }

  applyButtonSpacing(row);
}

/*
@description: Applies a small visual gap between adjacent buttons in the row
- seen as missing (every button rendering flush against its neighbor, no
space at all). Recomputed across the WHOLE row on every insertion, not just
set once on the newly-added button, since which button ends up first can
shift depending on resolution order.
*/
function applyButtonSpacing(row) {
  Array.from(row.children).forEach((child, index) => {
    child.style.marginLeft = index === 0 ? "" : "3px";
    child.style.marginTop = "3px";
    child.style.marginBottom = "3px";
  });
}
