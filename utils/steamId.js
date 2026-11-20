/*
@description: Extracts the profile's steamid64 from the page's own rendered
HTML. Steam doesn't expose this as a simple DOM attribute on these pages, so
this scrapes it out of the profile data Steam's own inline JS embeds.
*/

// Steam's inline JSON carries the id as `"steamid":"<id>","personaname":...`.
// Matching that exact key pair, rather than the first place each word shows
// up, keeps a custom profile URL or other text containing "steamid" or
// "personaname" from being read as the id.
const PROFILE_STEAMID_PATTERN = /"steamid":"(\d+)","personaname"/;

// The steamid64, or "" when the page doesn't carry the profile data.
export function getSteamId64FromPage() {
  const profileContentHtml = document.getElementsByClassName(
    "responsive_page_template_content"
  )[0]?.innerHTML || "";

  return PROFILE_STEAMID_PATTERN.exec(profileContentHtml)?.[1] ?? "";
}
