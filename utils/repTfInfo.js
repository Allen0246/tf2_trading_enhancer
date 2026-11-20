/*
@description: rep.tf reputation lookup. Aggregates ban/scammer flags from
multiple TF2 trading communities (SteamRep, backpack.tf, Marketplace.tf, etc.)
in one request, needs no user token, and does not spend backpack.tf's own
heavily rate-limited API quota.

rep.tf has no official public API or documentation. The endpoint below
(https://rep.tf/api/bans) is reverse-engineered: a POST with the steamid64 as
the "str" query param and no auth.

Confirmed response shape (from a real banned account): top-level
`{ success, message, <site>Bans: {...}, ... }`, one `<site>Bans` key per
community. Each is either `null` (not checked) or
`{ banned: "good"|"bad"|"", message, icons }`. "good" does not reliably mean
clean (a real etf2lBans entry read `banned: "good"` with message "Failed to
get data or player does not exist in ETF2L"), so only "bad" is treated as a
signal (see getBannedSiteLabels). `message`/`icons` are rep.tf's raw,
untrusted third-party HTML: never render them via innerHTML.
*/

import { createFailureBackoff } from "./failureBackoff.js";

const BANS_URL = "https://rep.tf/api/bans";

// No cache here, so this fires on every trade-offer/profile view. The
// cooldown is much shorter than marketplace.tf's 24h because this is a
// scam-protection signal: a full day of silence over one brief blip would be
// a real regression, not just a missed price readout.
const repTfFailureBackoff = createFailureBackoff({
  storageKey: "repTfFailureBackoff",
  maxConsecutiveFailures: 3,
  cooldownMs: 3 * 60 * 60 * 1000,
});

/*
@description: Looks up a Steam user's known bans/scammer flags across the
communities rep.tf aggregates (see file header for the response shape). Goes
through the background relay (background.js's fetchJson) because Steam's
CSP blocks the request from its pages (see background.js), and because
rep.tf only accepts POST.
@param {string} steamid64
@returns {Promise<Object|null>} the raw response, or null on failure.
*/
export async function getRepTfBans(steamid64) {
  const url = new URL(BANS_URL);
  url.searchParams.set("str", steamid64);

  try {
    return await repTfFailureBackoff.attempt(async () => {
      const response = await chrome.runtime.sendMessage({
        type: "FETCH_JSON",
        url: url.toString(),
        method: "POST",
      });

      if (!response?.ok) throw new Error(response?.error || "rep.tf request failed");
      return response.data;
    });
  } catch (e) {
    console.warn("[TF2 Trading Enhancer] rep.tf bans request failed:", e.message);
    return null;
  }
}

// Known /api/bans keys -> human-readable site label. Each key's own
// message/icon text names its site, except mpBans: "Marketplace.tf" there is
// an inference from the key name, not confirmed from response text.
const SITE_LABEL_BY_KEY = {
  steamBans: "Steam",
  srBans: "SteamRep (archived)",
  stfBans: "Scrap.TF",
  bptfBans: "backpack.tf",
  mpBans: "Marketplace.tf",
  hgBans: "Harpoon Gaming",
  nhsBans: "Neon Heights",
  etf2lBans: "ETF2L",
  rglBans: "RGL",
  stnBans: "STN.Trading",
};

/*
@description: Falls back to a label derived from the key itself (e.g.
"ppmBans" -> "ppm") for keys not in SITE_LABEL_BY_KEY. Some real responses
include keys (ppmBans, stBans, fogBans, fpBans) whose site cannot be
identified from the response, and a real "bad" flag should still be shown
under a rough label rather than dropped.
*/
function labelForBansKey(key) {
  return SITE_LABEL_BY_KEY[key] || key.replace(/Bans$/, "");
}

/*
@description: Extracts the list of site labels a user is flagged as "bad" at,
from getRepTfBans' raw response. Only "bad" counts as a flag; "good", ""
(no data) and null (not checked) are all "no signal", not a positive "clean"
result (see file header on why rep.tf's "good" does not mean that).
@param {Object|null} bansResponse - getRepTfBans' raw response.
@returns {string[]} site labels, e.g. ["backpack.tf", "Scrap.TF"].
*/
export function getBannedSiteLabels(bansResponse) {
  if (!bansResponse) return [];

  return Object.keys(bansResponse)
    .filter((key) => key.endsWith("Bans") && bansResponse[key]?.banned === "bad")
    .map(labelForBansKey);
}
