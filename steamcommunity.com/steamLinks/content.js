/*
@description: Adds a row of outbound profile links (next.bp.tf, bp.tf,
posts.tf, rep.tf, steamdb.info) next to Steam's own profile action buttons
(Message/More.../Edit Profile) on a steamcommunity.com profile page, plus a
rep.tf ban-check banner underneath. Dispatched from
steamcommunity.com/content.js on /profiles/* and /id/* pages, skipped on the
handful of profile subpages listed in EXCLUDED_PROFILE_SUBPATHS where either
.profile_header_actions doesn't exist or already means something else.
*/
import { getSteamId64FromPage } from "../../utils/steamId.js";

const linksInfo = [
  {
    label: "next.bp.tf",
    href: (id) => `https://next.backpack.tf/profiles/${id}`,
    classes: ["btn_profile_action", "btn_medium"],
  },
  {
    label: "bp.tf",
    href: (id) => `https://backpack.tf/profiles/${id}`,
    classes: ["btn_profile_action", "btn_medium"],
  },
  {
    label: "posts.tf",
    href: (id) => `https://posts.tf/users/${id}`,
    classes: ["btn_profile_action", "btn_medium"],
  },
  {
    label: "rep.tf",
    href: (id) => `https://rep.tf/${id}`,
    classes: ["btn_profile_action", "btn_medium"],
  },
  {
    label: "steamdb.info",
    href: (id) => `https://steamdb.info/calculator/${id}`,
    classes: ["btn_profile_action", "btn_medium"],
  },
];

// Neutral while the check runs or when it couldn't be done - only an actual
// rep.tf answer gets red or green.
const REP_CHECK_BANNER_COLORS = {
  neutral: { border: "rgba(255, 255, 255, 0.25)", background: "rgba(255, 255, 255, 0.05)" },
  banned: { border: "#e74c3c", background: "rgba(231, 76, 60, 0.15)" },
  clean: { border: "#2ecc71", background: "rgba(46, 204, 113, 0.1)" },
};

/*
@description: Puts the banner into one of REP_CHECK_BANNER_COLORS' states.
Same colors/shape as steamcommunity.com/tradeOffer/pages/tradeoffer.js's own
setRepCheckBanner - duplicated here rather than shared, since that file runs
as a classic MAIN-world script (see its own header) with no import/export at
all, so there's no common module either side could actually import from.
titleText/detailText are always inserted as plain text, never HTML - rep.tf's
own data is untrusted third-party content (see utils/repTfInfo.js's own
note), and bannedSites (the only piece of that data used here) flows straight
into detailText.
*/
function setRepCheckBanner(banner, state, titleText, detailText) {
  const { border, background } = REP_CHECK_BANNER_COLORS[state];

  banner.style.cssText = `
    flex-basis: 100%;
    width: 100%;
    margin-top: 8px;
    padding: 8px 12px;
    border-radius: 4px;
    border: 1px solid ${border};
    background: ${background};
    color: #fff;
    font-size: 12px;
    line-height: 1.4;
    box-sizing: border-box;
    max-width: 480px;
  `;

  const [title, detail] = banner.children;
  title.textContent = titleText;
  detail.textContent = detailText;
}

/*
@description: Appends a rep.tf status banner into container straight away,
in a neutral "Checking bans…" state, then updates it in place (so the page
doesn't shift when the result lands) - a red caution banner if the profile is
flagged "bad" on any site rep.tf aggregates, a green all-clear otherwise. A
clean profile still gets a banner (a green tick is useful information, not
just an unflagged default); a failed lookup stays neutral ("unavailable"),
never a green "No bans found" for a check that didn't happen.
*/
async function showRepCheckStatus(container, steamid64) {
  const banner = document.createElement("div");
  banner.appendChild(document.createElement("strong"));
  banner.appendChild(document.createElement("div"));
  setRepCheckBanner(banner, "neutral", "Checking bans…", "Looking this account up on Rep.TF.");
  container.appendChild(banner);

  const showUnavailable = () => {
    setRepCheckBanner(banner, "neutral", "Ban check unavailable", "Couldn't reach Rep.TF. Use the rep.tf button to check manually.");
  };

  let bannedSites;
  try {
    const { getRepTfBans, getBannedSiteLabels } = await import(chrome.runtime.getURL("utils/repTfInfo.js"));
    const bans = await getRepTfBans(steamid64);
    // null means the lookup itself failed (or is in its failure cooldown).
    if (!bans) {
      showUnavailable();
      return;
    }
    bannedSites = getBannedSiteLabels(bans);
  } catch (e) {
    console.warn("[TF2 Trading Enhancer] Rep check failed:", e.message);
    showUnavailable();
    return;
  }

  if (bannedSites.length > 0) {
    setRepCheckBanner(banner, "banned", "⚠ Potential scammer", `Banned at the following sites: ${bannedSites.join(", ")}`);
  } else {
    setRepCheckBanner(banner, "clean", "✓ No bans found", "Not banned at any site according to Rep.TF.");
  }
}

// Profile subpages where the header markup this feature relies on
// (.profile_header_actions) either doesn't exist or already means something
// else, so the links are skipped there rather than risking a
// double-injection or inserting into the wrong element.
const EXCLUDED_PROFILE_SUBPATHS = [
  "friends",
  "tradeoffers",
  "tradehistory",
  "games",
  "groups",
  "badges",
  "inventory",
  "screenshots",
  "images",
  "videos",
  "myworkshopfiles", // workshop items, merchandising, collections and guides
  "home", // the profile's community/activity-feed page
  "edit", // the profile editor
];

/*
@description: Whether a profile pathname is one of the subpages steamLinks
should skip. Matches whole path segments (e.g. "/id/<vanity>/home") rather
than a plain substring search, so a vanity name that happens to contain one of
these words (e.g. "/id/homerun_bot") isn't mistaken for the excluded subpage.
Only the segments AFTER "/id/<vanity>" or "/profiles/<id>" count: a vanity
name that IS one of these words ("/id/home") is still the profile itself.
*/
export function isExcludedProfileSubpath(pathname) {
  const subpathSegments = pathname.split("/").filter(Boolean).slice(2);
  return subpathSegments.some((segment) => EXCLUDED_PROFILE_SUBPATHS.includes(segment));
}

/*
@description: Appends each of linksInfo directly into .profile_header_actions
- confirmed live that this same container exists on other people's profiles
too (wrapping their "Message"/"More..." buttons), not just your own (wrapping
"Edit Profile"), so there's no need to special-case "own vs. other profile"
at all - one insertion point, same visible inline-button styling, either way
(rather than burying them in another profile's "More..." dropdown).
*/
export function steamLinks() {
  const { pathname } = new URL(window.location.href);
  if (isExcludedProfileSubpath(pathname)) return;

  const locationButtons = document.getElementsByClassName("profile_header_actions")[0];
  if (!locationButtons) return;

  const steamid64 = getSteamId64FromPage();
  if (!steamid64) return; // couldn't extract the id from the page - don't insert dead links

  // Forces these links onto their own row below Steam's native buttons
  // (Message/More.../Edit Profile), regardless of whether
  // .profile_header_actions lays its children out as a flex row
  // (flex-basis: 100% triggers a wrap) or plain inline/block flow (a
  // block-level, full-width element always starts its own line) - covers
  // both without needing to know which one Steam's own CSS actually uses.
  const rowBreak = document.createElement("div");
  rowBreak.style.cssText = "flex-basis: 100%; width: 100%; height: 0; display: block;";
  locationButtons.appendChild(rowBreak);

  linksInfo.forEach(({ label, href, classes }) => {
    const link = document.createElement("a");
    link.href = href(steamid64);
    link.target = "_blank";
    link.rel = "noopener noreferrer"; // safety for new tabs
    link.classList.add(...classes);

    const span = document.createElement("span");
    span.textContent = label;

    link.appendChild(span);
    locationButtons.appendChild(link);
  });

  showRepCheckStatus(locationButtons, steamid64);
}