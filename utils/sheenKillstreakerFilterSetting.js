/*
@description: Shared on/off switch for the Sheen/Killstreaker filtering this
extension bakes into classic/next.backpack.tf classifieds, marketplace.tf,
mannco.store, and Steam Market outbound links (utils/tf2StatsLinks/index.js,
steamcommunity.com/shared/quickLinkButtons.js, backpack.tf/oldUI+nextUI's own
addMannStoreButton, scrap.tf/itemLinks): some users want the tier-only search
Valve's own classifieds already narrows to (Specialized/Professional
Killstreak) without ALSO pinning to one exact Sheen/Killstreaker combination,
which can eliminate results/undercut prices they'd otherwise want to see.
Default ON (matches every one of those features' existing behavior before this
toggle existed) - `stored[KEY] !== false`, same "absent/undefined reads as
enabled" convention popup/popup.js's own AUTO_ADD_LISTING_CURRENCY_KEY already
establishes, rather than `Boolean(...)` (which would default a never-set key
to OFF instead).

Deliberately does NOT touch Killstreak TIER detection/filtering anywhere -
that's a coarse, always-useful categorization (Basic/Specialized/Professional)
kept separate from this toggle, which only ever suppresses the two SPECIFIC
attribute values (which exact Sheen, which exact Killstreaker) layered on top
of it.

No top-level side effects - safe to import from any test file without a
chrome fake already in place, since isSheenKillstreakerFilterEnabled only
touches storage when actually called.
*/
export const SHEEN_KILLSTREAKER_FILTER_ENABLED_KEY = "sheenKillstreakerFilterEnabled";

export async function isSheenKillstreakerFilterEnabled() {
  const stored = await chrome.storage.local.get([SHEEN_KILLSTREAKER_FILTER_ENABLED_KEY]);
  return stored[SHEEN_KILLSTREAKER_FILTER_ENABLED_KEY] !== false;
}
