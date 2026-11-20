/*
@description: On a Steam profile's /tradehistory/ page, collapses repeated
identical items shown in a trade row - both sides - down to a single entry
with an "×N" badge right after its name, e.g. 22 separate Refined Metal
icons become one icon + "Refined Metal ×22". Confirmed live against real
markup, two item shapes exist and both are handled:
  - Received ("+") items: `.tradehistory_items_withimages
    .tradehistory_items_group > a.history_item`, each an
    <img class="tradehistory_received_item_img"> + a
    <span class="history_item_name">.
  - Given ("-") items: `.tradehistory_items_noimages
    .tradehistory_items_group > span.history_item`, NO image at all - just a
    <span class="history_item_name"> - so grouped by name text alone.
Both are comma-text-node-separated in the raw DOM.

Badge styling is inline (display:inline-block right after the name span, not
absolutely positioned over an icon), so it reads as text following the item
name.
*/

const GROUP_SELECTOR = ".tradehistory_items_group";
const BADGE_CLASS = "tf2te-tradehistory-badge";

function injectStyles() {
  if (document.getElementById("tf2te-tradehistory-duplicates-styles")) return;

  const style = document.createElement("style");
  style.id = "tf2te-tradehistory-duplicates-styles";
  style.textContent = `
    .${BADGE_CLASS} {
      /* !important throughout - confirmed live that align-self alone had NO
         effect at all (so the stretch isn't flex align-items, whatever it
         actually is), and the received item's own <a> apparently forces a
         height on its children some other way. Pinning height/line-height
         directly, rather than trying to identify and counter the exact
         mechanism, guarantees this stays compact regardless of what it is. */
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
@description: Reads one item's grouping key + name element - name is always
required, img is optional (present for received items, absent for given
ones) so the SAME key derivation covers both shapes rather than needing two
separate code paths. Returns null for a shape this doesn't recognize (name
missing entirely) - callers must not guess at what that item is.
*/
function readItem(el) {
  const name = el.querySelector(".history_item_name");
  if (!name) return null;
  const img = el.querySelector("img");
  const key = img ? `${img.src}|${name.textContent}` : name.textContent;
  return { el, name, key };
}

/*
@description: Collapses one group's items in place - rebuilds the group's
own children entirely (rather than trying to selectively hide specific
duplicate elements and their neighboring comma text nodes) so the remaining
comma-separated list is guaranteed correct either way, not dependent on
getting comma-node bookkeeping right by hand. A no-op (group left completely
untouched) whenever any item's own shape doesn't match what this expects -
don't guess at what an unrecognized item should count as, and don't
partially rebuild a group only some of whose items were understood.
Naturally idempotent: re-running against an already-collapsed group finds no
duplicates left to collapse and returns before mutating anything, so a
MutationObserver re-triggering this after its own rebuild can't loop.
*/
function dedupeGroup(group) {
  const items = Array.from(group.children).filter((el) => el.classList?.contains("history_item"));
  if (items.length < 2) return;

  const parsed = items.map(readItem);
  if (parsed.some((p) => p === null)) return;

  const order = [];
  const byKey = new Map();
  for (const { el, name, key } of parsed) {
    let entry = byKey.get(key);
    if (!entry) {
      entry = { el, name, count: 0 };
      byKey.set(key, entry);
      order.push(entry);
    }
    entry.count++;
  }

  if (order.length === items.length) return; // nothing duplicated - nothing to rebuild

  group.innerHTML = "";
  order.forEach((entry, i) => {
    if (entry.count > 1) {
      const badge = document.createElement("span");
      badge.className = BADGE_CLASS;
      badge.textContent = `×${entry.count}`;
      // Appended onto the item element itself (not the name span) - in both
      // real shapes the name span is already the LAST child (after the img,
      // when there is one), so this naturally lands right after the name.
      entry.el.appendChild(badge);
    }
    group.appendChild(entry.el);
    if (i < order.length - 1) group.appendChild(document.createTextNode(", "));
  });
}

function scan(root) {
  root.querySelectorAll?.(GROUP_SELECTOR).forEach(dedupeGroup);
}

export function tradeHistoryDuplicates() {
  injectStyles();
  scan(document);

  // Steam paginates trade history via full page loads (confirmed by the
  // page's own </>-style pager, not infinite scroll), so a one-time scan
  // would normally be enough - the observer is defensive in case that's ever
  // wrong, and dedupeGroup's own idempotence (see its header note) means it
  // can't cause a self-triggering loop.
  const observer = new MutationObserver(() => scan(document));
  observer.observe(document.body, { childList: true, subtree: true });
}
