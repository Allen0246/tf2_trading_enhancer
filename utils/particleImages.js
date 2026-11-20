/*
@description: Where Unusual effect (particle) images come from. They are
backpack.tf's renders (credited in the popup and README), hosted on our own
Cloudflare static site at backpack.tf's request, in
94, 188 and 380 px. The 94 px set also ships with the extension
(images/particles/94/), so grid tiles need no requests.

steamcommunity.com/tradeOffer/shared.js (MAIN world, can't import this) keeps
its own copy of PARTICLE_HOST_URL; a test keeps the two equal.
*/

export const PARTICLE_HOST_URL = "https://tf2te-assets.allen0246.workers.dev/particles";
export const PARTICLE_SIZES = [94, 188, 380];

export function hostedParticleUrl(effectId, size) {
  return `${PARTICLE_HOST_URL}/${size}/${effectId}.png`;
}

// The 94 px image shipped with the extension. Only exists for effects known
// at release time (steamcommunity.com/tradeOffer/bundledParticleIds.js).
export function bundledParticleUrl(effectId) {
  return chrome.runtime.getURL(`images/particles/94/${effectId}.png`);
}
