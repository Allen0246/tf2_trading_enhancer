/*
@description: On scrap.tf's item banking table (/items), adds a small
"Links ▾" toggle per row that opens a dropdown with the same outbound links
the hover item card gives (see ../itemLinks/): next.backpack.tf and classic
backpack.tf classifieds, gladiator.tf, pricedb.io, posts.tf, marketplace.tf,
mannco.store, stntrading.eu ("STN") and Steam Market, in that order. Only one
panel is open at a time, and clicking outside closes it.

The table's rows are plain <td> text with no hoverable item element
(no data-defindex/data-content), so itemShape.js/links.js cannot be used.
Instead the cleaned-up name goes through utils/tf2StatsLinks/index.js's
resolveStatsAndClassifieds/createSteamMarketLink (the plain-name pipeline
steamcommunity.com/itemQuickLinks and stntrading.eu/link2Backpack use, which
also builds the gladiator.tf link), plus small local mannco.store/
stntrading.eu builders.

pricedb.io needs its own per-item search, so its slot shows the shared
loading state (label + spinner) until the lookup settles (withPricedbPlaceholder/withPricedbResult). A 429
shows utils/linkButtonStates.js's countdown, then retries - but only if that
row's panel is open when it runs out, else on the panel's next opening: every
row looks pricedb.io up at once on page load, so retrying them all together
would just hit the limit again. A posts.tf link missing only because no Steam
Web API key is saved shows the same key hint as the item card. Per-item
history icons are not offered: they need an owned asset id, which this
aggregate view lacks.
*/
import { resolveStatsAndClassifieds, createSteamMarketLink, buildStnTradingHref, buildGladiatorHref } from "../../utils/tf2StatsLinks/index.js";
import { searchPricedbSkuStatus } from "../../utils/pricedb.js";
import { getCanonicalItemName } from "../../utils/tf2Schema.js";
import {
  postsTfNeedsApiKey,
  applyPostsTfKeyHint,
  applyLoadingState,
  startRetryCountdown,
  stopRetryCountdown,
  retryAtFromNow,
} from "../../utils/linkButtonStates.js";

const STYLE_ID = "tf2te-items-links-dropdown-style";
// Same dark panel styling as ../itemLinks/itemCard.js's item card.
const DROPDOWN_STYLE = `
  .tf2te-items-links-dropdown{ position:relative; display:inline-block; margin-left:6px; }
  .tf2te-items-links-toggle{
    font: inherit; cursor:pointer; border:1px solid #2e2e2e; background:#352f2c; color:#eaeaea;
    border-radius:6px; padding:1px 6px; font-size:0.85em; line-height:1.4;
  }
  .tf2te-items-links-toggle:hover{ background:#201c1a; }
  .tf2te-items-links-toggle:disabled{ opacity:0.55; cursor:default; }
  .tf2te-items-links-panel{
    position:absolute; top:100%; left:0; z-index:2147483647; margin-top:4px;
    background:#201c1a; border:1px solid #2a2a2a; border-radius:8px;
    box-shadow:0 8px 20px rgba(0,0,0,.35); padding:6px; display:flex; flex-direction:column; gap:2px;
    min-width:120px; white-space:nowrap;
  }
  /* An unconditional "display:flex" on the rule above beats the browser's
     own default "[hidden]{display:none}" UA-stylesheet rule (an author
     stylesheet always wins over the UA one, regardless of selector
     specificity). This later rule wins the cascade instead. See #128. */
  .tf2te-items-links-panel[hidden]{ display:none; }
  .tf2te-items-links-panel a, .tf2te-items-links-panel span{
    display:block; padding:3px 8px; border-radius:4px; text-decoration:none; color:#eaeaea; font-size:0.9em;
  }
  .tf2te-items-links-panel a:hover{ background:#352f2c; }
  .tf2te-items-links-panel span{ opacity:0.55; }
`;

function injectStyleOnce() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = DROPDOWN_STYLE;
  document.head.appendChild(style);
}

function closeAllPanels() {
  document.querySelectorAll(".tf2te-items-links-panel").forEach((panel) => {
    panel.hidden = true;
  });
}

// Wired once for the whole page (not per row) - a per-row listener would
// pile up one document-level handler per item, all doing the same
// close-everything work.
let outsideClickWired = false;
function wireOutsideClickToCloseOnce() {
  if (outsideClickWired) return;
  outsideClickWired = true;
  document.addEventListener("click", closeAllPanels);
}

// The countdown currently running in each panel, stopped on every re-render.
const panelCountdowns = new WeakMap();

// Renders the link list; a `href: null` entry (a placeholder) becomes a
// dimmed, non-clickable <span> rather than a dead link. A needsKey entry gets
// the key hint and a rateLimitedUntil entry the countdown
// (utils/linkButtonStates.js), whose end calls onPricedbRetry.
function renderPanelLinks(panel, links, { onPricedbRetry } = {}) {
  const previousCountdown = panelCountdowns.get(panel);
  if (previousCountdown) stopRetryCountdown(previousCountdown);
  panelCountdowns.delete(panel);

  panel.innerHTML = "";
  if (links.length === 0) {
    const span = document.createElement("span");
    span.textContent = "No links found";
    panel.appendChild(span);
    return;
  }
  links.forEach(({ label, href, needsKey, rateLimitedUntil, loading }) => {
    if (loading) {
      const el = document.createElement("span");
      applyLoadingState(el, label);
      panel.appendChild(el);
      return;
    }
    if (needsKey) {
      const el = document.createElement("span");
      applyPostsTfKeyHint(el, label);
      panel.appendChild(el);
      return;
    }
    if (rateLimitedUntil) {
      const el = document.createElement("span");
      startRetryCountdown(el, {
        label,
        retryAfterMs: rateLimitedUntil - Date.now(),
        onRetry: (isConnected) => {
          if (isConnected) onPricedbRetry?.();
        },
      });
      panelCountdowns.set(panel, el);
      panel.appendChild(el);
      return;
    }
    const el = document.createElement(href ? "a" : "span");
    el.textContent = label;
    if (href) {
      el.href = href;
      el.target = "_blank";
    }
    panel.appendChild(el);
  });
}

export async function scrapItemsTableLinks() {
  const table = document.getElementById("itembanking-list");
  if (!table) return; // not on the item banking page

  injectStyleOnce();
  wireOutsideClickToCloseOnce();

  // 0-indexed: the table's 2nd column (index 1) holds the item name.
  const ITEM_NAME_COLUMN_INDEX = 1;

  const rows = Array.from(table.rows).filter((_, rowIndex) => rowIndex !== 0); // skip the header row

  rows.forEach((row) => {
    const cell = row.cells[ITEM_NAME_COLUMN_INDEX];
    if (!cell) return;

    // The link builders match on plain text, which markup (e.g. a
    // quality-color span) would corrupt.
    const itemName = cell.textContent.trim();

    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "tf2te-items-links-toggle";
    toggleBtn.textContent = "Links ▾";
    toggleBtn.disabled = true; // enabled once buildExtraLinks resolves below

    const panel = document.createElement("div");
    panel.className = "tf2te-items-links-panel";
    panel.hidden = true;

    toggleBtn.addEventListener("click", (e) => {
      // Stops the click from also reaching the document-level listener
      // above, which would immediately close the very panel this click is
      // meant to open.
      e.stopPropagation();
      const willOpen = panel.hidden;
      closeAllPanels();
      panel.hidden = !willOpen;
    });

    const wrapper = document.createElement("span");
    wrapper.className = "tf2te-items-links-dropdown";
    wrapper.appendChild(toggleBtn);
    wrapper.appendChild(panel);
    cell.appendChild(wrapper);

    buildExtraLinks(itemName)
      .then(({ links, pricedbPromise, lookupPricedb }) => {
        toggleBtn.disabled = false;

        // A countdown that runs out while the panel is closed waits for the
        // next opening (see this file's header on why rows don't all retry).
        let pricedbRetryPending = false;
        const render = (pricedbResult) =>
          renderPanelLinks(panel, pricedbResult ? withPricedbResult(links, pricedbResult) : withPricedbPlaceholder(links), {
            onPricedbRetry,
          });
        function retryPricedb() {
          pricedbRetryPending = false;
          render(null);
          lookupPricedb().then(render);
        }
        function onPricedbRetry() {
          if (panel.hidden) pricedbRetryPending = true;
          else retryPricedb();
        }
        // Registered after the open/close listener above, so it sees the
        // panel's new state.
        toggleBtn.addEventListener("click", () => {
          if (!panel.hidden && pricedbRetryPending) retryPricedb();
        });

        render(null);
        pricedbPromise.then(render);
      })
      .catch((e) => {
        console.warn("[TF2 Trading Enhancer] scrapItemsTableLinks: failed to resolve extra links for", itemName, e);
        wrapper.remove();
      });
  });
}

// Strips trailing junk scrap.tf's own banking-table cell text can carry (a
// footnote-style "#..." marker, or a "(Secondary)" slot label) before it's
// handed to the resolveStatsAndClassifieds-based pipeline below, which was
// never built to expect it.
function stripTrailingTableJunk(itemName) {
  if (itemName.includes("#")) {
    itemName = itemName.slice(0, itemName.indexOf("#") - 1);
  }
  if (itemName.includes("(Secondary)")) {
    itemName = itemName.slice(0, itemName.indexOf("(") - 1);
  }
  return itemName.trim();
}

// Prepends "Non-Craftable " for always-non-craftable store items (see
// NON_CRAFTABLE_ITEM_FRAGMENTS), whose table text never says so.
function withNonCraftablePrefix(itemName) {
  return needsNonCraftablePrefix(itemName) ? `Non-Craftable ${itemName}` : itemName;
}

/*
@description: Resolves the extra outbound-link set (see this file's own
header note) for one item, via the shared plain-name resolveStatsAndClassifieds
pipeline. Returns the fixed-order {label, href} array (next BP, classic BP,
Gladiator, posts.tf, MP, Mannco, STN, SCM) with unresolved links filtered
out, plus pricedbPromise, started but not awaited so the caller can render
immediately and splice pricedb.io in later (withPricedbPlaceholder/
withPricedbResult).
*/
async function buildExtraLinks(rawItemName) {
  // The table text can drop apostrophes ("Bills Hat"); getCanonicalItemName
  // fixes that before anything downstream reads the name. See #129.
  const itemName = await getCanonicalItemName(withNonCraftablePrefix(stripTrailingTableJunk(rawItemName)));
  const resolved = await resolveStatsAndClassifieds(itemName);

  const links = [
    { label: "next BP", href: resolved.nextClassifiedsHref },
    { label: "classic BP", href: resolved.classifiedsHref },
    { label: "Gladiator", href: buildGladiatorHref(itemName) },
    // Kept without an href when only a missing Steam Web API key is in the
    // way (rendered as the key hint), dropped otherwise like any other miss.
    { label: "posts.tf", href: resolved.postsTfHref, needsKey: await postsTfNeedsApiKey(resolved.classifiedsFilters, resolved.postsTfHref) },
    { label: "MP", href: resolved.marketplaceHref },
    { label: "Mannco", href: buildMannStoreHref(resolved.classifiedsFilters, itemName) },
    // Not gated on classifiedsFilters (see buildStnTradingHref).
    { label: "STN", href: buildStnTradingHref(itemName, resolved.classifiedsFilters) },
    { label: "SCM", href: resolved.classifiedsFilters ? createSteamMarketLink(itemName, resolved.classifiedsFilters) : null },
  ].filter((link) => link.href || link.needsKey);

  const lookupPricedb = () =>
    searchPricedbSkuStatus(itemName).then(({ sku, rateLimited, retryAfterMs }) => ({
      href: sku ? `https://pricedb.io/item/${encodeURIComponent(sku)}` : null,
      rateLimited,
      retryAt: rateLimited ? retryAtFromNow(retryAfterMs) : null,
    }));

  return { links, pricedbPromise: lookupPricedb(), lookupPricedb };
}

// pricedb.io goes right after "Gladiator" (see the file header's order).
function pricedbInsertIndex(links) {
  const gladiatorIndex = links.findIndex((l) => l.label === "Gladiator");
  return gladiatorIndex === -1 ? links.length : gladiatorIndex + 1;
}

function withPricedbPlaceholder(links) {
  const insertAt = pricedbInsertIndex(links);
  return [...links.slice(0, insertAt), { label: "pricedb.io", href: null, loading: true }, ...links.slice(insertAt)];
}

function withPricedbResult(links, { href, rateLimited, retryAt }) {
  const insertAt = pricedbInsertIndex(links);
  if (href) {
    return [...links.slice(0, insertAt), { label: "pricedb.io", href }, ...links.slice(insertAt)];
  }
  // A rate limit gets a countdown entry so it is not mistaken for "no
  // pricedb.io listing".
  if (rateLimited) {
    return [...links.slice(0, insertAt), { label: "pricedb.io", href: null, rateLimitedUntil: retryAt }, ...links.slice(insertAt)];
  }
  return links;
}

// A minimal mannco.store search: the item name plus (when resolved) its
// quality. ../itemLinks/links.js's buildMannStoreHref needs a full item shape
// this page cannot build.
function buildMannStoreHref(filters, itemName) {
  const params = new URLSearchParams();
  params.set("search", itemName);
  if (filters?.quality) params.set("quality", filters.quality);
  return `https://mannco.store/tf2?${params.toString()}`;
}

// Store-bought items that are always Non-Craftable (see
// withNonCraftablePrefix).
const NON_CRAFTABLE_ITEM_FRAGMENTS = [
  "Key",
  "Squad Surplus Voucher",
  "Civilian Grade Stat Clock",
  "Festivizer",
  "Duck Journal",
];

function needsNonCraftablePrefix(itemName) {
  return NON_CRAFTABLE_ITEM_FRAGMENTS.some((fragment) => itemName.includes(fragment));
}
