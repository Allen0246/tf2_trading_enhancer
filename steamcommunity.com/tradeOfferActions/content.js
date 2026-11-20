/*
@description: Bridges tradeOffer/shared.js's MAIN-world wrap around
window.ActOnTradeOffer to background.js - a MAIN-world content script has no
chrome.* API access of its own, so this ISOLATED-world listener is what actually asks
background.js to refresh the trade-offer badge the moment an offer is
accepted/declined/canceled, instead of waiting for the next scheduled poll.
*/
document.addEventListener("tf2te-tradeoffer-acted-on", () => {
  // Steam's own ActOnTradeOffer call resolves asynchronously server-side -
  // giving it a moment before asking for a fresh count avoids a race where
  // Steam's own summary endpoint still reflects the pre-action state.
  setTimeout(() => {
    chrome.runtime.sendMessage({ type: "REFRESH_TRADEOFFER_BADGE" }).catch(() => {});
  }, 3000);
});
