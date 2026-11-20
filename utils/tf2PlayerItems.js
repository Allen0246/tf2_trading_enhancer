/*
@description: Fetches a Steam player's structured TF2 inventory via Valve's
GetPlayerItems Web API, which (unlike anything steamcommunity.com renders for
a Name-Tagged item, including its "Original name: X" notice) is immune to
custom renames. Australium-ness is not recoverable from the defindex (an
Australium weapon shares its stock version's defindex); it shows up only in
the per-item `style` field, which is returned too. Goes through
fetchJsonRelay, which retries a transient 5xx.
See #43.
*/

import { fetchJsonRelay } from "./fetchJsonRelay.js";
import { getSteamApiKey } from "./tf2Schema.js";

const PLAYER_ITEMS_URL = "https://api.steampowered.com/IEconItems_440/GetPlayerItems/v0001/";

// In-memory dedupe only, keyed per steamId64, for this page load - unlike
// utils/tf2Schema.js's own 1-week persisted schema cache, a player's owned
// items change on every trade, and steamcommunity.com's inventory page can
// show a DIFFERENT profile's items without a full page reload (following a
// link to a friend's inventory), so persisting this across page loads risks
// serving stale or (worse) some other player's items under the wrong key.
const playerItemsPromiseById = {};

/*
@description: Fetches (and in-memory dedupes) the given player's own TF2
inventory. Works for ANY player's inventory, not just whoever owns the
extension's own configured Steam Web API key - the "key" param just
authenticates the CALLER (same as every other Web API call this codebase
makes), "steamid" is whichever profile is actually being viewed. Confirmed
live: this succeeds for another player's inventory the same way viewing
their steamcommunity.com inventory PAGE does - both have the same underlying
requirement (their inventory being set to public), so anything already
visible on the page itself is fetchable here too.
@param {string} steamId64
@returns {Promise<Map<string, {defindex: number, quality: number, style: ?number}> | null>}
keyed by GetPlayerItems' own "id" field (as a string) - which lines up with
the asset id steamcommunity.com's own inventory DOM uses (see
findActiveAssetId in steamcommunity.com/itemQuickLinks/content.js). null if
no Steam Web API key is configured or the request failed.
*/
export async function getPlayerItemsById(steamId64) {
  if (playerItemsPromiseById[steamId64]) return playerItemsPromiseById[steamId64];

  const promise = (async () => {
    const apiKey = await getSteamApiKey();
    if (!apiKey) return null;

    const url = new URL(PLAYER_ITEMS_URL);
    url.searchParams.set("key", apiKey);
    url.searchParams.set("steamid", steamId64);

    try {
      const json = await fetchJsonRelay(url.toString());
      const items = json?.result?.items;
      if (!Array.isArray(items)) return null;

      const byAssetId = new Map();
      for (const item of items) {
        if (item.id == null || item.defindex == null) continue;
        // style: confirmed live, an Australium weapon (Rocket Launcher/
        // Minigun/Flame Thrower) reports the exact same defindex as its
        // stock version - Australium-ness is conveyed entirely via this
        // field instead (see steamcommunity.com/itemQuickLinks/content.js's
        // own AUSTRALIUM_STYLE_INDEX/resolveAustraliumPrefix, the only
        // caller that reads it). undefined for an item with no style
        // variants at all.
        byAssetId.set(String(item.id), { defindex: item.defindex, quality: item.quality, style: item.style });
      }
      return byAssetId;
    } catch (e) {
      console.warn("[TF2 Trading Enhancer] Failed to fetch player items:", e);
      return null;
    }
  })();

  playerItemsPromiseById[steamId64] = promise;

  const result = await promise;
  // Don't memoize a failure (no key configured yet, or a transient fetch
  // error) - same reasoning as tf2Schema.js's own getSchemaMaps: setting up
  // a key in the popup should take effect on the very next lookup, not need
  // a page reload.
  if (!result) delete playerItemsPromiseById[steamId64];

  return result;
}
