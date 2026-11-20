/*
@description: Wraps Steam's IEconService/GetTradeOffersSummary Web API call -
a single lightweight endpoint that returns just counts (pending/new/historical
per direction), not the offers themselves. That's exactly what a toolbar
badge needs and nothing more, and unlike mobile confirmations this needs no
special secret at all - just the same Steam Web API key already saved for the
item schema (see utils/tf2Schema.js), since it's a normal, publicly documented
Web API call authenticated by that key alone.
*/
const SUMMARY_URL = "https://api.steampowered.com/IEconService/GetTradeOffersSummary/v1/";

/*
@description: Fetches the current trade offer counts for the account that
owns apiKey. Returns Steam's raw response.response object (fields like
pending_received_count, new_received_count, etc.) so the caller decides which
figure it actually wants rather than this module guessing.
*/
export async function fetchTradeOfferSummary(apiKey) {
  const url = new URL(SUMMARY_URL);
  url.searchParams.set("key", apiKey);

  // credentials: "omit" for the same reason background.js's own fetchJson
  // uses it - this call is authenticated purely by the key query param, and
  // omitting cookies keeps a garbage/revoked key from silently "working" via
  // a logged-in session backing it up instead.
  // no-store: a count answered from the browser's HTTP cache would bring back
  // an offer that was already accepted or declined.
  const response = await fetch(url.toString(), { credentials: "omit", cache: "no-store" });
  if (!response.ok) throw new Error(`GetTradeOffersSummary failed (${response.status})`);

  const json = await response.json();
  return json?.response || null;
}
