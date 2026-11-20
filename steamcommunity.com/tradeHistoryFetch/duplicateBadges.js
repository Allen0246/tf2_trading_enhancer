/*
@description: Visually collapses repeated identical items within one trade's
own item group on /inventoryhistory/ (e.g. 16 separate "Refined Metal" icons
show as one icon + a "×16" badge) - the same idea as
steamcommunity.com/tradeHistoryDuplicates/content.js does for /tradehistory/,
but NON-DESTRUCTIVELY: that file's own dedupeGroup rebuilds each group's DOM
entirely, discarding the duplicate elements outright, while this file only
HIDES a duplicate (a CSS class, display:none). Every real element - and its
own data-appid/classid/instanceid/amount/href - stays present and queryable
for any other script reading this page's markup.
*/

const GROUP_SELECTOR = ".tradehistory_items_group";
const BADGE_CLASS = "tf2te-thx-dup-badge";
const HIDDEN_CLASS = "tf2te-thx-dup-hidden";

function injectStyles() {
  if (document.getElementById("tf2te-thx-dup-styles")) return;

  const style = document.createElement("style");
  style.id = "tf2te-thx-dup-styles";
  style.textContent = `
    .${HIDDEN_CLASS} { display: none !important; }
    .${BADGE_CLASS} {
      /* !important throughout - steamcommunity.com/tradeHistoryDuplicates/
         content.js's own badge confirmed live that align-self alone had no
         effect on this page's own item layout; pinning height/line-height
         directly guarantees this stays compact regardless of the exact
         mechanism forcing height elsewhere. */
      display: inline-block !important;
      height: auto !important;
      line-height: normal !important;
      align-self: center !important;
      margin-left: 4px;
      padding: 1px 4px;
      color: #FFFFFF;
      border-radius: 4px;
      background-color: #209DE6;
      font-size: 11px;
      font-weight: bold;
      vertical-align: middle;
    }
  `;
  document.head.appendChild(style);
}

/*
@description: Reads one item's grouping key - name is always required, img is
optional (confirmed live: present for BOTH given and received items on this
page - a given item is still a `<span>` rather than the received side's
`<a>`, per ./content.js's own header note, but unlike /tradehistory/'s own
given side, it still carries an `<img>`) so the same key derivation covers
either shape. Returns null for a shape this doesn't recognize (name missing
entirely).
*/
function readItem(el) {
  const name = el.querySelector(".history_item_name");
  if (!name) return null;
  const img = el.querySelector("img");
  const key = img ? `${img.src}|${name.textContent}` : name.textContent;
  return { el, key };
}

/*
@description: Non-destructively collapses one group's duplicate items in
place.

A group is re-scanned every time the MutationObserver below fires, which
happens on ANY DOM change under document.body, including ones this very
function itself makes - so mutating unconditionally would retrigger the
observer forever. Every branch below compares against the CURRENT state
first and only touches the DOM when something is actually wrong - a re-run
against an already-correct group performs ZERO mutations, so the loop
terminates.
See #142.
*/
function dedupeGroup(group) {
  const items = Array.from(group.children).filter((el) => el.classList?.contains("history_item"));
  if (items.length < 2) return;

  const parsed = items.map(readItem);
  if (parsed.some((p) => p === null)) return;

  const totals = new Map();
  for (const { key } of parsed) totals.set(key, (totals.get(key) || 0) + 1);

  const seen = new Set();
  for (const { el, key } of parsed) {
    const total = totals.get(key);
    if (total < 2) continue; // not a duplicate at all - left completely alone

    if (!seen.has(key)) {
      // First occurrence - stays visible, gets/refreshes the badge, but
      // only if something's actually stale (see this function's own note).
      seen.add(key);
      if (el.classList.contains(HIDDEN_CLASS)) el.classList.remove(HIDDEN_CLASS);

      const expectedText = `×${total}`;
      const existingBadge = el.querySelector(`.${BADGE_CLASS}`);
      if (!existingBadge) {
        const badge = document.createElement("span");
        badge.className = BADGE_CLASS;
        badge.textContent = expectedText;
        el.appendChild(badge);
      } else if (existingBadge.textContent !== expectedText) {
        existingBadge.textContent = expectedText;
      }
    } else if (!el.classList.contains(HIDDEN_CLASS)) {
      // A later duplicate, not yet hidden - hidden now, not removed (see
      // this file's own header note). The ", " text node BEFORE it (the
      // real markup's comma separator between adjacent items) is blanked
      // too. The one before, not after: a later duplicate is never the
      // first item, so it always has one, while the last item has none
      // after it - blanking the following comma left "A ×2, B," whenever the
      // hidden duplicate came last. Guarded the same way, only touched if
      // not already blank.
      el.classList.add(HIDDEN_CLASS);
      const prev = el.previousSibling;
      if (prev && prev.nodeType === 3 && prev.textContent !== "") prev.textContent = "";
    }
  }
}

function scan(root) {
  root.querySelectorAll?.(GROUP_SELECTOR).forEach(dedupeGroup);
}

export function showDuplicateBadges() {
  injectStyles();
  scan(document);

  // Steam can append further history rows ("Load More") - re-scan on every
  // DOM change to catch them, same as tradeHistoryDuplicates/content.js's
  // own observer.
  const observer = new MutationObserver(() => scan(document));
  observer.observe(document.body, { childList: true, subtree: true });
}
