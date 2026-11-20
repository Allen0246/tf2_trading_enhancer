/*
@description: Adds Killstreak-tier nav buttons (No Kit / Normal / Specialized
/ Professional) to backpack.tf's old-UI /stats and /classifieds pages, so a
user can jump straight to another tier's page instead of hand-editing the URL
or search filters. Dispatched from backpack.tf/content.js (see
createKSButtons), which only loads this on those two old-UI page types.
*/

/*
@description: The 4 Killstreak-tier options shown as nav buttons, in display
order. `statsNamePrefix` is the literal name-segment prefix backpack.tf's
/stats page path uses (e.g. "Professional Killstreak "); `tierValue` is the
"killstreak_tier" query value the /classifieds page uses instead - the two
pages encode the same tier completely differently, so both are kept here
per-option rather than derived from one another.
*/
const KS_TIER_OPTIONS = [
  {
    label: "No Kit",
    tierValue: "0",
    statsNamePrefix: "",
    color: "#000000",
  },
  {
    label: "Normal KS",
    tierValue: "1",
    statsNamePrefix: "Killstreak ", // trailing space so it joins the item name with %20
    color: "#5B6060",
  },
  {
    label: "Specialized KS",
    tierValue: "2",
    statsNamePrefix: "Specialized Killstreak ",
    color: "#68765C",
  },
  {
    label: "Professional KS",
    tierValue: "3",
    statsNamePrefix: "Professional Killstreak ",
    color: "#B15820",
  },
];

/*
@description: Verifies which old-UI page was loaded and dispatches to the
right button-builder. The new UI (next.backpack.tf) has no equivalent nav, so
the router (backpack.tf/content.js) never calls this there.
@parameter url -> the current tab's URL
*/
export function createKSButtons(locationURL) {
  const url = new URL(locationURL);

  if (url.pathname.includes("stats")) {
    createButtonsStats(url);
  } else if (isClassifiedsSearchPage(url)) {
    createButtonsClassifieds(url);
  }
}

// The classifieds search page only (/classifieds?item=...). Its sub-pages,
// like /classifieds/sell/{assetid} (the create-listing form), have no search
// whose tier the nav could switch.
function isClassifiedsSearchPage(url) {
  return /^\/classifieds\/?$/.test(url.pathname);
}

/*
@description: Builds one Killstreak-tier nav <a> button with the styling
both pages share (label, per-tier color, active state). The href and
active-state check are genuinely different per page (stats rewrites a URL
path segment via addKsURL, classifieds rewrites a query param), so those stay
in each page's own function below and get passed in here.
*/
function buildKsButtonEl({ label, color, active, href, className }) {
  const link = document.createElement("a");
  link.textContent = label;
  link.className = className;
  if (active) link.classList.add("active");
  link.style.color = color;
  link.href = href;
  return link;
}

/*
@description: Builds the Killstreak-tier nav for the /stats page - a button
per tier that rewrites the item name's path segment (via addKsURL) to add or
remove the "Killstreak "/"Specialized Killstreak "/"Professional Killstreak "
name prefix.
@parameter url -> the current tab's URL
*/
function createButtonsStats(url) {
  // Idempotency guard: the content script can run more than once on the
  // same page, and a second bar would be left stuck in the header, since
  // ../statsPageQuickLinks/content.js's relocateKillstreakTabs only moves
  // the first match. Checked document-wide, not within parentHead, because
  // the existing bar may already have been relocated out of parentHead.
  if (document.querySelector(".stats-killstreak-list")) return;

  const headerControls = document.getElementsByClassName("stats-header-controls");
  const parentHead = headerControls[0];
  if (!parentHead) return; // page markup changed / controls not present - nothing to attach to

  const firstDiv = parentHead.querySelector("div"); // Quality div
  const parts = url.pathname.split("/"); // url pathname, split on "/"
  const itemSeg = decodeURIComponent(parts[3] || "");

  const currentPrefix =
    KS_TIER_OPTIONS.map((ks) => ks.statsNamePrefix).find((prefix) => prefix && itemSeg.startsWith(prefix)) || "";

  const divButtons = document.createElement("div");
  divButtons.classList.add("btn-group", "btn-group-sm", "stats-killstreak-list");

  KS_TIER_OPTIONS.forEach((ks) => {
    const link = buildKsButtonEl({
      label: ks.label,
      color: ks.color,
      active: ks.statsNamePrefix === currentPrefix,
      href: addKsURL(url, ks.statsNamePrefix),
      className: "btn btn-variety",
    });
    divButtons.appendChild(link);
  });

  if (firstDiv && firstDiv.nextSibling) {
    // Captured once, before either insertBefore call - firstDiv.nextSibling
    // is a live property, so re-reading it after the first insertBefore
    // would return the just-inserted divButtons itself, putting the <br>
    // before divButtons instead of after it.
    const insertBeforeNode = firstDiv.nextSibling;
    parentHead.insertBefore(divButtons, insertBeforeNode);
    parentHead.insertBefore(document.createElement("br"), insertBeforeNode);
  } else {
    // No sibling to insert after - just append at the end.
    parentHead.appendChild(divButtons);
  }
}

/*
@description: Builds the Killstreak-tier nav for the /classifieds page - a
button per tier that keeps all existing search filters and just sets the
"killstreak_tier" query param.
@parameter url -> the current tab's URL
*/
function createButtonsClassifieds(url) {
  const panelBody = document.querySelector(".panel.panel-main .panel-body");
  if (!panelBody) return;

  // Avoid inserting a duplicate nav if this ever runs twice on the same page.
  if (document.getElementById("ks-tier-nav")) return;

  const currentParams = new URLSearchParams(url.search);
  const currentTier = currentParams.get("killstreak_tier") || "0";

  const navWrap = document.createElement("div");
  navWrap.id = "ks-tier-nav";
  navWrap.classList.add("btn-group", "btn-group-sm");
  navWrap.style.padding = "8px 0px";

  KS_TIER_OPTIONS.forEach((ks, i) => {
    const params = new URLSearchParams(url.search);
    params.set("killstreak_tier", ks.tierValue);

    const link = buildKsButtonEl({
      label: ks.label,
      color: ks.color,
      active: currentTier === ks.tierValue,
      href: url.pathname + "?" + params.toString(),
      className: "btn btn-default",
    });

    // Rounded outer corners, since these sit in one continuous button group.
    if (i === 0) link.style.borderRadius = "5px 0 0 5px";
    if (i === KS_TIER_OPTIONS.length - 1) link.style.borderRadius = "0 5px 5px 0";

    navWrap.appendChild(link);
  });

  const crumbs = panelBody.querySelector("#search-crumbs");
  if (crumbs) {
    crumbs.insertAdjacentElement("afterend", navWrap);
  } else {
    panelBody.prepend(navWrap);
  }
}

/*
@description: Inserts or replaces the Killstreak name-segment prefix after
/stats/{Quality}/, e.g. /stats/Unique/Rocket Launcher/... ->
/stats/Unique/Professional Killstreak Rocket Launcher/...
@param {URL|string} inputUrl
@param {string} ksSegment - e.g. "Killstreak ", "Specialized Killstreak ", "Professional Killstreak ", or "" for no tier
@returns {URL}
*/
function addKsURL(inputUrl, ksSegment) {
  // Always clone: createButtonsStats passes the SAME url object once per
  // tier option, and `newUrl.pathname = ...` below must not mutate it.
  const newUrl = new URL(inputUrl instanceof URL ? inputUrl.href : inputUrl, location.origin);
  const segsUrl = newUrl.pathname
    .split("/")
    .filter(Boolean)
    .map(decodeURIComponent); // ['stats','Quality','Item','Tradable','Craftable']

  // Only rewrite when this is actually a /stats/{Quality}/{Item}/... path.
  if (segsUrl[0] === "stats" && segsUrl[2]) {
    // Strip any existing KS prefix from the item name (case-insensitive).
    const itemName = segsUrl[2].replace(/^(?:Professional|Specialized)?\s*Killstreak\s+/i, "");

    let prefix = ksSegment || ""; // "" is valid (No Kit)
    if (prefix && !prefix.endsWith(" ")) {
      prefix += " "; // ensure trailing space before the item name
    }

    segsUrl[2] = prefix + itemName;
    newUrl.pathname = "/" + segsUrl.map(encodeURIComponent).join("/");
  }

  return newUrl;
}
