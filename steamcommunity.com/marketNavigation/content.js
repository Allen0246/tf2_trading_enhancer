/*
@description: Steam's Market is a single-page app: opening an item from the
Market search (or from another listing) changes the address without loading
a new page (confirmed live). Every Market listing feature starts at page
load instead: the router (../content.js) is only injected on a listing page's
own load, marketListingLinks reads the item from the address once and keeps
putting that same block back, and the page-context tile code
(../tradeOffer/pages/marketListing.js) picks its page script once. So a
listing reached in-app showed no effects or links until a manual reload.

Rather than teach each of those to tear down and start over, this reloads
the page once whenever in-app navigation lands on a different TF2 listing,
so it starts exactly like a reload by hand. Pages other than TF2 listings
are left alone.
*/

const TF2_LISTING_PATH_RE = /^\/market\/listings\/440\//;

// The last reload ({path, at}). A page that is that reload, less than
// RELOAD_GUARD_MS ago, never reloads again, so a page whose address Steam
// rewrites into some other form right after load can't reload in a loop.
const LAST_RELOAD_KEY = "tf2te-market-last-reload";
const RELOAD_GUARD_MS = 10 * 1000;

function samePath(a, b) {
  const decode = (path) => {
    try {
      return decodeURIComponent(path);
    } catch {
      return path;
    }
  };
  return decode(a) === decode(b);
}

/*
@description: Whether arriving at currentPath (in-app, from loadedPath where
the page last really loaded) needs a reload: a TF2 listing that isn't the
loaded one, unless this page is a reload done moments ago (lastReload, see
LAST_RELOAD_KEY).
*/
export function needsReload(loadedPath, currentPath, lastReload, now = Date.now()) {
  if (!TF2_LISTING_PATH_RE.test(currentPath)) return false;
  if (samePath(currentPath, loadedPath)) return false;
  const isFreshReload = lastReload && samePath(loadedPath, lastReload.path) && now - lastReload.at < RELOAD_GUARD_MS;
  return !isFreshReload;
}

function readLastReload() {
  try {
    return JSON.parse(window.sessionStorage.getItem(LAST_RELOAD_KEY));
  } catch {
    return null;
  }
}

export function watchMarketNavigation() {
  const loadedPath = window.location.pathname;
  let reloading = false;

  function check() {
    if (reloading) return;
    const currentPath = window.location.pathname;
    if (!needsReload(loadedPath, currentPath, readLastReload())) return;
    reloading = true;
    try {
      window.sessionStorage.setItem(LAST_RELOAD_KEY, JSON.stringify({ path: currentPath, at: Date.now() }));
    } catch {
      // Without storage the loop guard is off; samePath still covers the
      // normal case.
    }
    window.location.reload();
  }

  // The address changes from the page's own script, which this isolated
  // script can't hook; the page's DOM changes with it, so check then.
  new MutationObserver(check).observe(document.body, { childList: true, subtree: true });
  window.addEventListener("popstate", check);
}
