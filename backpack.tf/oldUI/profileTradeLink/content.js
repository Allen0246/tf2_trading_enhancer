/*
@description: On a classic backpack.tf profile page, adds a "Send Trade
Offer" button even when the profile has no items currently listed on
backpack.tf - backpack.tf's own trade-offer button, where one exists at all,
is only ever attached to a specific listing, so there's otherwise no way to
start a trade from a bare profile visit.

Reads the trade offer partner/token straight off the profile's own
.user-link element's data-offers-params attribute - confirmed live
elsewhere in this extension in the exact same shape
(steamcommunity.com/tradeHistoryDuplicates's own observed markup includes
`data-offers-params="?partner=X&token=Y"`), already query-string-shaped for
appending directly onto steamcommunity.com/tradeoffer/new/.

Self-scoping (not page-restricted) off both .user-link and a "Profile
Information" heading being present, rather than a pathname check - harmless
no-op wherever either isn't found. NOT independently confirmed against a
real backpack.tf profile page's own markup (unlike the data-offers-params
shape above) - in particular, document.querySelector(".user-link") grabs
the FIRST such element on the page, which needs to actually be the profile
owner's own link (not some other user-link elsewhere on the page, e.g. a
friends list) for this to point at the right person.
*/

const BUTTON_CLASS = "tf2te-profile-trade-link";

function hasProfileInformationHeading() {
  return Array.from(document.querySelectorAll("span")).some((el) => el.textContent.includes("Profile Information"));
}

function insertLink() {
  if (document.querySelector(`.${BUTTON_CLASS}`)) return; // already inserted

  const buttonsRow = document.querySelector(".profile .information .buttons");
  if (!buttonsRow) return;

  const offersParams = document.querySelector(".user-link")?.getAttribute("data-offers-params");
  if (!offersParams) return;

  if (!hasProfileInformationHeading()) return;

  const link = document.createElement("a");
  link.className = `btn btn-primary btn-xs ${BUTTON_CLASS}`;
  link.href = `https://steamcommunity.com/tradeoffer/new/${offersParams}`;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "Send Trade Offer";
  buttonsRow.appendChild(link);
}

export function profileTradeLink() {
  insertLink();

  const observer = new MutationObserver(() => insertLink());
  observer.observe(document.body, { childList: true, subtree: true });
}
