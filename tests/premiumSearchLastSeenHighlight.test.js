import { test } from "node:test";
import assert from "node:assert/strict";
import { createFakeDocument, resetFakeDom, FakeMutationObserver } from "./helpers/fakeDom.js";
import { premiumSearchLastSeenHighlight } from "../backpack.tf/oldUI/premiumSearchLastSeenHighlight/content.js";
import { SALE_RECENCY_CLASSES } from "../backpack.tf/shared/saleRecencyHighlight.js";

// Real (trimmed) markup shape confirmed live on backpack.tf/premium/search -
// see backpack.tf/oldUI/premiumSearchLastSeenHighlight/content.js's own
// header note. The CURRENT owner's own `abbr` text is the already-rendered
// relative-time string signal #1 (the liveness border) reads - its title/
// data-original-title attributes are irrelevant there (see
// backpack.tf/shared/lastSeenHighlight.js's own header on why). The
// PREVIOUS owner's own `abbr`, when present, is the opposite: signal #2
// (sale-recency background) reads ITS title/data-original-title (an
// absolute timestamp), not its rendered text - see
// previousOwnerAbsoluteDate below.
function buildResultHtml({
  online,
  relativeAge,
  hasPreviousOwner = false,
  currentOwnerFirst = true,
  previousOwnerAbsoluteDate = null,
  previousOwnerUsesDataOriginalTitle = false,
}) {
  const currentOwnerHtml = `
    <div class="owner">
      Last seen with <span class="user-handle"><a class="user-link" data-online="${online ? "1" : "0"}" href="/u/1">
        <i class="fa fa-circle online"></i> Some Seller
      </a></span>
      <abbr class="days-30">${relativeAge}</abbr>
    </div>`;
  const previousOwnerAbbrAttrs = previousOwnerAbsoluteDate
    ? previousOwnerUsesDataOriginalTitle
      ? `title="" data-original-title="${previousOwnerAbsoluteDate}"`
      : `title="${previousOwnerAbsoluteDate}"`
    : "";
  const previousOwnerHtml = hasPreviousOwner
    ? `
    <div class="owner">
      Previously seen with <span class="user-handle"><a class="user-link" data-online="1" href="/u/2">
        <i class="fa fa-circle online"></i> Some Other Person
      </a></span>
      <abbr class="days-90" ${previousOwnerAbbrAttrs}>2 years ago</abbr>
    </div>`
    : "";

  const ownersHtml = currentOwnerFirst ? currentOwnerHtml + previousOwnerHtml : previousOwnerHtml + currentOwnerHtml;

  return `
    <div class="result">
      <ul class="item-singular"><li>item</li></ul>
      <div class="description">
        <h5>Some Item</h5>
        <div class="owners">${ownersHtml}</div>
      </div>
    </div>`;
}

// Real (trimmed) markup shape confirmed live on backpack.tf/premium/search -
// see content.js's own header note: `.col-md-4` holds two
// `.premium-search-form` panels, the first titled "Premium Search"
// (`<h2 class="title">`), the second "Filters" (`<h6>`) - the legend panel
// is meant to land between them.
const SIDEBAR_HTML = `
  <div class="col-md-4">
    <div class="premium-search-form">
      <h2 class="title">Premium Search</h2>
      <a class="btn btn-premium btn-block btn-lg" id="build-premium-search">
        <i class="fa fa-search"></i> Build a Search
      </a>
      <p class="warning"><small class="text-muted">What you see here is for your eyes only.</small></p>
    </div>
    <div class="premium-search-form">
      <h6>Filters (76 results)</h6>
      <div class="list-group list-group-filters">
        <a class="list-group-item" href="?quality=5">Quality: Unusual</a>
      </div>
    </div>
  </div>`;

function setupPage(resultsHtml, { withSidebar = true } = {}) {
  resetFakeDom();
  const doc = createFakeDocument();
  doc.querySelector = (sel) => doc.documentElement.querySelector(sel);
  doc.querySelectorAll = (sel) => doc.documentElement.querySelectorAll(sel);
  global.document = doc;
  global.MutationObserver = FakeMutationObserver;

  const container = doc.createElement("div");
  container.className = "premium-search-results";
  container.innerHTML = resultsHtml;
  doc.body.appendChild(container);

  let sidebar = null;
  if (withSidebar) {
    sidebar = doc.createElement("div");
    sidebar.innerHTML = SIDEBAR_HTML;
    doc.body.appendChild(sidebar);
  }

  return { doc, container, sidebar };
}

function borderOf(el) {
  return el.style.getPropertyValue("border") || undefined;
}

test("does nothing (no throw, no results container) when not on a Premium Search page", () => {
  resetFakeDom();
  const doc = createFakeDocument();
  doc.querySelector = (sel) => doc.documentElement.querySelector(sel);
  doc.querySelectorAll = (sel) => doc.documentElement.querySelectorAll(sel);
  global.document = doc;
  global.MutationObserver = FakeMutationObserver;

  assert.doesNotThrow(() => premiumSearchLastSeenHighlight());
});

test("colors a result green when the current owner is online, regardless of how stale the last-seen text is", () => {
  const { container } = setupPage(buildResultHtml({ online: true, relativeAge: "4 years ago" }));

  premiumSearchLastSeenHighlight();

  const result = container.querySelector(".result");
  assert.match(borderOf(result), /#2ecc71/); // green = ONLINE bucket's own color
});

test("colors a result yellow (FRESH) when offline but last seen under 24 hours ago", () => {
  const { container } = setupPage(buildResultHtml({ online: false, relativeAge: "3 hours ago" }));
  premiumSearchLastSeenHighlight();
  assert.match(borderOf(container.querySelector(".result")), /#f1c40f/);
});

test("colors a result orange (RECENT) when offline and last seen under 7 days ago", () => {
  const { container } = setupPage(buildResultHtml({ online: false, relativeAge: "3 days ago" }));
  premiumSearchLastSeenHighlight();
  assert.match(borderOf(container.querySelector(".result")), /#e67e22/);
});

test("colors a result gray (STALE) when offline and last seen 7+ days ago", () => {
  const { container } = setupPage(buildResultHtml({ online: false, relativeAge: "2 weeks ago" }));
  premiumSearchLastSeenHighlight();
  assert.match(borderOf(container.querySelector(".result")), /#7f8c8d/);
});

// REGRESSION-style: the CURRENT owner ("Last seen with") must drive the
// color, never the "Previously seen with" one - that person no longer has
// the item, so their own online status/freshness is irrelevant to a live
// trade. Built with the previous-owner block FIRST in document order to
// prove this isn't just relying on position.
test("uses the CURRENT owner ('Last seen with'), never a 'Previously seen with' one, even when it isn't first in the markup", () => {
  const { container } = setupPage(
    buildResultHtml({ online: false, relativeAge: "4 weeks ago", hasPreviousOwner: true, currentOwnerFirst: false })
  );

  premiumSearchLastSeenHighlight();

  // Current owner (offline, "4 weeks ago") -> STALE (gray), NOT the
  // previous owner's own "2 years ago"/online:1, which would also be
  // STALE/ONLINE respectively - use a case where they'd disagree instead:
  assert.match(borderOf(container.querySelector(".result")), /#7f8c8d/);
});

test("distinguishes current-owner-offline-but-online-previous-owner correctly (current owner's status wins)", () => {
  // Previous owner is online, current owner (the one that matters) isn't -
  // if this wrongly picked the previous owner's block, the row would come
  // out green instead of yellow.
  const { container } = setupPage(buildResultHtml({ online: false, relativeAge: "1 hour ago", hasPreviousOwner: true }));
  premiumSearchLastSeenHighlight();
  assert.match(borderOf(container.querySelector(".result")), /#f1c40f/); // yellow, not green
});

test("colors every result independently across multiple rows", () => {
  const html = buildResultHtml({ online: true, relativeAge: "1 hour ago" }) + buildResultHtml({ online: false, relativeAge: "1 year ago" });
  const { container } = setupPage(html);

  premiumSearchLastSeenHighlight();

  const [first, second] = container.querySelectorAll(".result");
  assert.match(borderOf(first), /#2ecc71/); // green
  assert.match(borderOf(second), /#7f8c8d/); // gray
});

test("re-scans on a DOM mutation and colors newly-added results too", () => {
  const { doc, container } = setupPage(buildResultHtml({ online: true, relativeAge: "1 hour ago" }));

  premiumSearchLastSeenHighlight();
  assert.equal(container.querySelectorAll(".result").length, 1);

  const wrapper = doc.createElement("div");
  wrapper.innerHTML = buildResultHtml({ online: false, relativeAge: "2 weeks ago" });
  container.appendChild(wrapper.children[0]);

  const observer = FakeMutationObserver.instances[0];
  observer.cb();

  const [, second] = container.querySelectorAll(".result");
  assert.match(borderOf(second), /#7f8c8d/);
});

// --- sale-recency background (signal #2) ---

function daysAgoIso(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function saleClassesOf(result) {
  return Object.values(SALE_RECENCY_CLASSES).filter((cls) => result.classList.contains(cls));
}

test("applies the RECENT sale class when the previous owner's last-seen date is <= 60 days ago", () => {
  const { container } = setupPage(
    buildResultHtml({
      online: false,
      relativeAge: "1 month ago",
      hasPreviousOwner: true,
      previousOwnerAbsoluteDate: daysAgoIso(30),
    })
  );

  premiumSearchLastSeenHighlight();

  assert.deepEqual(saleClassesOf(container.querySelector(".result")), [SALE_RECENCY_CLASSES.RECENT]);
});

test("applies the MODERATE sale class between 61 and 90 days ago", () => {
  const { container } = setupPage(
    buildResultHtml({
      online: false,
      relativeAge: "2 months ago",
      hasPreviousOwner: true,
      previousOwnerAbsoluteDate: daysAgoIso(75),
    })
  );

  premiumSearchLastSeenHighlight();

  assert.deepEqual(saleClassesOf(container.querySelector(".result")), [SALE_RECENCY_CLASSES.MODERATE]);
});

test("applies the OLD sale class between 91 and 120 days ago", () => {
  const { container } = setupPage(
    buildResultHtml({
      online: false,
      relativeAge: "3 months ago",
      hasPreviousOwner: true,
      previousOwnerAbsoluteDate: daysAgoIso(110),
    })
  );

  premiumSearchLastSeenHighlight();

  assert.deepEqual(saleClassesOf(container.querySelector(".result")), [SALE_RECENCY_CLASSES.OLD]);
});

test("applies NO sale class past 120 days - not a 4th 'definitely old' bucket", () => {
  const { container } = setupPage(
    buildResultHtml({
      online: false,
      relativeAge: "1 year ago",
      hasPreviousOwner: true,
      previousOwnerAbsoluteDate: daysAgoIso(400),
    })
  );

  premiumSearchLastSeenHighlight();

  assert.deepEqual(saleClassesOf(container.querySelector(".result")), []);
});

test("applies no sale class at all when there's no previous owner (no known last-sale date)", () => {
  const { container } = setupPage(buildResultHtml({ online: true, relativeAge: "1 hour ago", hasPreviousOwner: false }));

  premiumSearchLastSeenHighlight();

  assert.deepEqual(saleClassesOf(container.querySelector(".result")), []);
});

// REGRESSION-style: the same title/data-original-title inconsistency
// lastSeenHighlight's own current-owner reading has to tolerate (Bootstrap's
// tooltip JS moves title -> data-original-title once initialized) applies
// here too, on the PREVIOUS owner's own abbr.
test("reads the previous owner's date from data-original-title when title has already been cleared by Bootstrap's tooltip JS", () => {
  const { container } = setupPage(
    buildResultHtml({
      online: false,
      relativeAge: "1 month ago",
      hasPreviousOwner: true,
      previousOwnerAbsoluteDate: daysAgoIso(30),
      previousOwnerUsesDataOriginalTitle: true,
    })
  );

  premiumSearchLastSeenHighlight();

  assert.deepEqual(saleClassesOf(container.querySelector(".result")), [SALE_RECENCY_CLASSES.RECENT]);
});

// The liveness border (signal #1) and the sale-recency background (signal
// #2) must compose independently on the SAME result - proving the "additive,
// not replacing" design actually holds, not just in theory.
test("the liveness border and the sale-recency background apply together on the same result, independently", () => {
  const { container } = setupPage(
    buildResultHtml({
      online: true, // -> green border (signal #1)
      relativeAge: "1 hour ago",
      hasPreviousOwner: true,
      previousOwnerAbsoluteDate: daysAgoIso(110), // -> OLD/red background (signal #2)
    })
  );

  premiumSearchLastSeenHighlight();

  const result = container.querySelector(".result");
  assert.match(borderOf(result), /#2ecc71/);
  assert.deepEqual(saleClassesOf(result), [SALE_RECENCY_CLASSES.OLD]);
});

test("clears a previously-applied sale class once the result no longer has a resolvable previous-owner date", () => {
  const { doc, container } = setupPage(
    buildResultHtml({
      online: false,
      relativeAge: "1 month ago",
      hasPreviousOwner: true,
      previousOwnerAbsoluteDate: daysAgoIso(30),
    })
  );

  premiumSearchLastSeenHighlight();
  const result = container.querySelector(".result");
  assert.deepEqual(saleClassesOf(result), [SALE_RECENCY_CLASSES.RECENT]);

  // Simulate the page re-rendering this same card without a previous owner
  // anymore (e.g. Premium Search's own results refreshed).
  const replacement = doc.createElement("div");
  replacement.innerHTML = buildResultHtml({ online: false, relativeAge: "1 month ago", hasPreviousOwner: false });
  const newResult = replacement.children[0];
  container.children[container.children.indexOf(result)] = newResult;
  newResult.parentNode = container;

  const observer = FakeMutationObserver.instances[0];
  observer.cb();

  assert.deepEqual(saleClassesOf(newResult), []);
});

// --- legend panel + combined tooltip -----------------------------------

test("inserts the legend panel once, between the 'Premium Search' panel and the 'Filters' one", () => {
  const { sidebar } = setupPage(buildResultHtml({ online: true, relativeAge: "1 hour ago" }));

  premiumSearchLastSeenHighlight();

  const panels = sidebar.querySelectorAll(".premium-search-form");
  assert.equal(panels.length, 3);
  assert.match(panels[0].textContent, /Premium Search/);
  assert.ok(panels[1].classList.contains("tf2te-color-legend"));
  assert.match(panels[2].textContent, /Filters/);
});

test("legend panel has both group headings and every swatch label", () => {
  const { sidebar } = setupPage(buildResultHtml({ online: true, relativeAge: "1 hour ago" }));

  premiumSearchLastSeenHighlight();

  const legend = sidebar.querySelector(".tf2te-color-legend");
  const text = legend.textContent;
  assert.match(text, /Seller status/);
  assert.match(text, /Online now/);
  assert.match(text, /Seen < 24h/);
  assert.match(text, /Seen < 7 days/);
  assert.match(text, /Seen 7\+ days/);
  assert.match(text, /Last sold/);
  assert.match(text, /Sold ≤ 60 days/);
  assert.match(text, /Sold ≤ 90 days/);
  assert.match(text, /Sold ≤ 120 days/);
  assert.match(text, /Older \/ no sale on record/);
});

test("does not insert a duplicate legend panel on a second scan", () => {
  const { sidebar } = setupPage(buildResultHtml({ online: true, relativeAge: "1 hour ago" }));

  premiumSearchLastSeenHighlight();
  const observer = FakeMutationObserver.instances[0];
  observer.cb();
  observer.cb();

  assert.equal(sidebar.querySelectorAll(".tf2te-color-legend").length, 1);
});

test("does nothing (no throw) when the sidebar hasn't rendered yet - no 'Premium Search' panel to anchor on", () => {
  const { container } = setupPage(buildResultHtml({ online: true, relativeAge: "1 hour ago" }), { withSidebar: false });

  assert.doesNotThrow(() => premiumSearchLastSeenHighlight());
  assert.equal(container.parentNode.querySelectorAll?.(".tf2te-color-legend").length ?? 0, 0);
});

test("sets a combined tooltip on the result: online + no sale on record", () => {
  const { container } = setupPage(buildResultHtml({ online: true, relativeAge: "1 hour ago", hasPreviousOwner: false }));

  premiumSearchLastSeenHighlight();

  const result = container.querySelector(".result");
  assert.equal(result.getAttribute("title"), "Seller online now · No sale on record");
});

test("sets a combined tooltip on the result: offline + sold N days ago", () => {
  const { container } = setupPage(
    buildResultHtml({
      online: false,
      relativeAge: "3 hours ago",
      hasPreviousOwner: true,
      previousOwnerAbsoluteDate: daysAgoIso(30),
    })
  );

  premiumSearchLastSeenHighlight();

  const result = container.querySelector(".result");
  assert.equal(result.getAttribute("title"), "Seller offline, last seen 3 hours ago · Sold 30 days ago");
});
