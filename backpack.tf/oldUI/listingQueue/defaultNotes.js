/*
@description: The user's default listing notes, as backpack.tf pre-fills them
when listing an item by hand, so queued listings start with the same text.

backpack.tf keeps the default in the user's account and renders it straight
into the create-listing page's HTML (confirmed live: /classifieds/sell/{id}
has <textarea id="listing-comments">…default…</textarea>), not into local
storage or a separate request. So the default is read from one sell page and
reused for every item queued during this page visit. The text can contain
Unicode "bold letters" and emoji; it is copied exactly.
*/

const NOTES_TEXTAREA_PATTERN = /<textarea\b[^>]*\bid=["']listing-comments["'][^>]*>([\s\S]*?)<\/textarea>/i;

const NAMED_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeHtmlEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : entity;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? entity;
  });
}

/*
@description: The default notes text from a sell page's HTML, or "" when the
page has no notes box (not logged in, an unexpected page) or the box is empty.
A plain pattern rather than DOMParser keeps this testable without a DOM.
*/
export function parseDefaultListingNotes(html) {
  const match = NOTES_TEXTAREA_PATTERN.exec(String(html || ""));
  return match ? decodeHtmlEntities(match[1]).trim() : "";
}

// Shared by every item queued during this page visit; reset after a failure
// so the next queued item tries again.
let notesPromise = null;

export function fetchDefaultListingNotes(assetId) {
  if (!notesPromise) {
    notesPromise = fetch(`https://backpack.tf/classifieds/sell/${encodeURIComponent(assetId)}`, { credentials: "include" })
      .then((response) => (response.ok ? response.text() : Promise.reject(new Error(`HTTP ${response.status}`))))
      .then(parseDefaultListingNotes)
      .catch((e) => {
        console.warn("[TF2 Trading Enhancer] Couldn't read the default listing notes:", e);
        notesPromise = null;
        return "";
      });
  }
  return notesPromise;
}

// Test-only: forget the cached notes between tests.
export function __resetDefaultListingNotesForTests() {
  notesPromise = null;
}
