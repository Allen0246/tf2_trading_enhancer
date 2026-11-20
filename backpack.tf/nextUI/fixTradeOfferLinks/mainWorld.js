/*
@description: Runs in next.backpack.tf's own page JS realm (see manifest.json's
own "world": "MAIN" entry for this file, same pattern as
../premiumSearchLastSeenHighlight/mainWorld.js). Copies each classifieds
listing row's EXACT price out of Vue's own component data and onto the row
as a data-tf2te-currencies attribute, for ./content.js (isolated world) to
read when it rewrites the row's trade offer link.

Why this is needed: the row's visible price badge is ROUNDED to keys (e.g.
"250.45 keys"), and nothing else in the row's HTML carries the exact split -
confirmed live, the exact "250 keys, 28.77 ref" only reaches the DOM inside
the hover tooltip, which only exists while the item is hovered. Vue keeps the
full listing on each row's own component instance instead (Vue 2 exposes it
as element.__vue__), confirmed live as $props.listing with
{ id: "440_<steamid>_<hash>", currencies: { keys: 250, metal: 28.77 }, ... }.
The page realm is the only place that instance is readable, hence this file;
a DOM attribute is the bridge, since both worlds share the DOM.

The attribute also carries the listing's own id, so ./content.js can confirm
it belongs to the listing the row currently shows (Vue recycles row nodes for
different listings) before trusting it.
*/
function initNextUiExactListingCurrencies() {
  if (!window.location.hostname.includes("next.backpack.tf")) return;

  const ROW_SELECTOR = ".listing";
  const ATTRIBUTE = "data-tf2te-currencies";

  /*
  @description: Writes one row's exact currencies onto the row, only when the
  value actually changed - an unconditional write would be wasted work on
  every mutation tick (attribute writes don't retrigger the childList-only
  observer below, so there's no loop risk either way).
  */
  function syncRow(row) {
    let listing;
    try {
      listing = row.__vue__?.$props?.listing;
    } catch {
      return; // not a Vue-backed row, or a shape change - leave the badge-based fallback in charge
    }
    const currencies = listing?.currencies;
    if (!listing?.id || !currencies) return;

    const value = JSON.stringify({
      id: String(listing.id),
      keys: Number(currencies.keys) || 0,
      metal: Number(currencies.metal) || 0,
    });
    if (row.getAttribute(ATTRIBUTE) !== value) row.setAttribute(ATTRIBUTE, value);
  }

  function syncAll() {
    document.querySelectorAll(ROW_SELECTOR).forEach(syncRow);
  }

  syncAll();
  new MutationObserver(syncAll).observe(document.body, { childList: true, subtree: true });
}
initNextUiExactListingCurrencies();

/*
@description: Test-only hook, same convention
../premiumSearchLastSeenHighlight/mainWorld.js documents (classic MAIN-world
script, no `export` allowed).
*/
globalThis.__nextUiExactListingCurrenciesTestHooks = { run: initNextUiExactListingCurrencies };
