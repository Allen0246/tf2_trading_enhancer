// Stand-ins for every scrap.tf/*/content.js feature module scrap.tf/content.js
// (the router) can dynamically import, used ONLY by tests/scrapTfContent.test.js.
// That file's whole job is testing the ROUTER's own dispatch decisions (which
// URL loads which feature, and which registry.label() gets recorded) - each
// real feature module already has its own dedicated, much deeper test file
// (tests/itemLinksContent.test.js, tests/auctionBidHelper.test.js,
// tests/scrapItemsTableLinks.test.js, tests/sellDuplicates.test.js), so
// re-running their real DOM-building/timer logic here would just be
// retesting already-covered behavior while adding real setTimeout/
// MutationObserver side effects that have nothing to do with the router's
// own branching. Each stub below just records that it was called.
export const calls = [];

export function itemLinks() {
  calls.push("itemLinks");
}
export function scrapItemsTableLinks() {
  calls.push("scrapItemsTableLinks");
}
export function auctionBidHelper() {
  calls.push("auctionBidHelper");
}
export function sellDuplicates() {
  calls.push("sellDuplicates");
}
