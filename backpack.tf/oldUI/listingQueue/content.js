/*
@description: Listing queue for classic backpack.tf's own inventory page
(/profiles/{id}); next.backpack.tf isn't covered.

Ctrl+click an item tile in your own backpack (#backpack li.item[data-defindex],
the same selector ../inventoryGroupBy/content.js already confirms live on
this exact page) to queue a sell listing for it. A docked drawer (styled to
match backpack.tf's chrome: black page, dark navy navbar, backpack.tf's
blue) lists everything queued, each row editable
(keys/metal/comment) before publishing, with its own per-row status instead
of one shared "publishing..." state for the whole batch.

Design points:
  1. publishAll waits PUBLISH_DELAY_MS between requests.
  2. ./queue.js is event-driven (add/remove/update), so editing one row never
     rebuilds the others and never loses focus in a field being typed in.
  3. ./publishRequest.js's publishListing tolerates non-JSON error bodies
     (an HTML error/block page) instead of failing with a parse error.

Identity is read straight off the tile's own data-* attributes - data-id
(the owned asset id), data-name (base item name), data-effect_name
(Unusual effect, confirmed live via ../inventoryGroupBy/content.js's own
header note), and data-price (a plain refined-metal-equivalent float,
confirmed live via steamcommunity.com/tradeOffer/pages/backpackProfile.js's
own parseItem - see ./priceHint.js's own note) for the starting price
suggestion. Quality is read off the tile's own "q-440-{id}" class (confirmed
live via real tiles, e.g. "item q-440-5-dark
p-440-5" for an Unusual) - NOT the same "qualityN" class
utils/tf2Quality.js's own getQualityIdFromClassList expects (that one's for
scrap.tf), so this file parses it directly instead. data-craftable/
data-tradable are NOT confirmed present on this specific page (only on
/stats and /suggestion/{id} - see ../suggestionsQuickLinks/content.js's own
header note on that same gap) - left unread here rather than guessed; they
aren't needed for the publish request anyway (see ./publishRequest.js's
own header note on what the endpoint actually needs).

The page owner's own trade offer URL (needed so a buyer's trade offer goes
to the right place) is read off ".user-link[data-offers-params]" when
present (the same data-offers-params attribute confirmed live elsewhere
on OTHER users' profile pages) - not independently confirmed
that YOUR OWN profile page renders one for yourself the same way, so this
falls back to a small input row in the drawer itself (persisted to
chrome.storage.local) when it doesn't.

That fallback is a plain, non-blocking input row (see
buildManualTradeOfferUrlRow below), not a native window.prompt() - this
codebase avoids native alert()/prompt()/confirm() from a content script (see
steamcommunity.com/tradeOffer's own showAlert). publishAll is wrapped in
try/catch/finally so ANY failure (not just a per-item publish error)
surfaces as a visible "fail" status instead of a silent stuck button.

The drawer (collapsed tab + empty state) is built eagerly, on page load, so
the empty-state hint text (how to use this feature at all) is visible from
the start. Defaults to EXPANDED (not collapsed) for the same reason - a
collapsed tab with no items in it is easy to miss entirely on a first
visit. The user's own collapsed/expanded choice is then remembered via
chrome.storage.local (COLLAPSED_STORAGE_KEY) so it only ever
defaults open once, not on every single page visit.
See #84.
See #85.
*/

import { QUALITY_NAME_BY_ID, QUALITY_COLOR_BY_NAME } from "../../../utils/tf2Quality.js";
import { createQueue } from "./queue.js";
import { fetchDefaultListingNotes } from "./defaultNotes.js";
import { estimateStartingPrice } from "./priceHint.js";
import { buildListingParams, publishListing } from "./publishRequest.js";

const BACKPACK_SELECTOR = "#backpack";
const ITEM_SELECTOR = "li.item[data-defindex]";
const QUALITY_CLASS_PATTERN = /\bq-440-(\d+)\b/;
const TRADE_OFFER_URL_STORAGE_KEY = "listingQueueTradeOfferUrl";
const COLLAPSED_STORAGE_KEY = "listingQueueCollapsed";
// A deliberate pause between each publish request, not a burst.
const PUBLISH_DELAY_MS = 600;
const SUCCESS_REMOVE_DELAY_MS = 1400;

const STYLE_ID = "tf2te-listing-queue-style";
const DRAWER_CLASS = "tf2te-listing-queue-drawer";
const DRAWER_COLLAPSED_CLASS = "tf2te-listing-queue-drawer--collapsed";
const TAB_CLASS = "tf2te-listing-queue-tab";
const ROW_CLASS = "tf2te-listing-queue-row";

// Classic backpack.tf's navbar is plain
// Bootstrap 3 (".navbar.navbar-fixed-top navbar-default"), so its actual
// rendered height is measured directly instead of guessed - a hardcoded px
// value would drift if the theme's own navbar height ever changes.
// NAVBAR_FALLBACK_HEIGHT_PX (Bootstrap 3's own stock .navbar-fixed-top
// height) only applies if the selector somehow matches nothing on a given
// page. See #86.
const NAVBAR_FALLBACK_HEIGHT_PX = 50;

function resolveNavbarHeightPx() {
  const navbar = document.querySelector(".navbar.navbar-fixed-top");
  const height = navbar ? navbar.getBoundingClientRect().height : 0;
  return height > 0 ? Math.round(height) : NAVBAR_FALLBACK_HEIGHT_PX;
}

function ensureStyleInjected() {
  if (document.getElementById(STYLE_ID)) return;
  const navbarHeightPx = resolveNavbarHeightPx();
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    /* Scoped to this drawer/tab's own descendants only (never a bare "*")
       so this can't leak onto backpack.tf's own page elements. See #87. */
    .${DRAWER_CLASS}, .${DRAWER_CLASS} *, .${TAB_CLASS}, .${TAB_CLASS} * {
      box-sizing: border-box;
    }
    /* See resolveNavbarHeightPx above: top:0 put the drawer flush with the
       very top of the viewport, overlapping backpack.tf's own fixed navbar
       instead of sitting below it. */
    .${DRAWER_CLASS} {
      position: fixed;
      top: ${navbarHeightPx}px;
      right: 0;
      bottom: 0;
      width: 320px;
      background: #14171b;
      border-left: 1px solid #2a343f;
      box-shadow: -14px 0 36px rgba(0, 0, 0, 0.5);
      display: flex;
      flex-direction: column;
      transform: translateX(0);
      transition: transform 0.26s cubic-bezier(0.32, 0.72, 0, 1);
      z-index: 10000;
      font-family: Arial, "Helvetica Neue", sans-serif;
      color: #e7e9eb;
    }
    .${DRAWER_CLASS}.${DRAWER_COLLAPSED_CLASS} { transform: translateX(280px); }
    .${TAB_CLASS} {
      position: absolute;
      top: 18px;
      left: -34px;
      width: 34px;
      height: 84px;
      background: #3f7cae;
      border-radius: 4px 0 0 4px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 6px;
      cursor: pointer;
      border: 1px solid #2a343f;
      border-right: none;
    }
    .${TAB_CLASS}:hover { background: #4a8cbf; }
    .${TAB_CLASS} .count {
      font-weight: 800;
      font-size: 14px;
      color: #fff;
      background: rgba(255, 255, 255, 0.18);
      width: 20px;
      height: 20px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .${TAB_CLASS} .label {
      writing-mode: vertical-rl;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      font-size: 9.5px;
      color: #fff;
    }
    .tf2te-lq-head {
      background: #1a222b;
      border-bottom: 1px solid #2a343f;
      padding: 12px 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex: none;
    }
    .tf2te-lq-head h3 { font-size: 13.5px; font-weight: 700; margin: 0; color: #fff; }
    .tf2te-lq-head .badge {
      background: #4a91d6;
      color: #fff;
      font-size: 11px;
      font-weight: 700;
      border-radius: 20px;
      padding: 1px 7px;
      margin-left: 6px;
    }
    .tf2te-lq-collapse {
      width: 24px; height: 24px;
      border-radius: 4px;
      border: 1px solid #2a343f;
      background: transparent;
      color: #9aa5b0;
      cursor: pointer;
      font-size: 13px;
      line-height: 1;
    }
    .tf2te-lq-collapse:hover { background: #242e39; color: #fff; }
    .tf2te-lq-tradeurl {
      flex-direction: column; gap: 5px; padding: 10px 14px;
      background: rgba(224, 176, 78, 0.08); border-bottom: 1px solid rgba(255, 255, 255, 0.09);
    }
    .tf2te-lq-tradeurl-label { font-size: 11px; color: #e0b04e; line-height: 1.4; }
    .tf2te-lq-tradeurl input {
      width: 100%; background: #0e1114; border: 1px solid rgba(255, 255, 255, 0.09); border-radius: 4px;
      color: #e7e9eb; font-size: 11px; padding: 5px 7px;
    }
    .tf2te-lq-list { flex: 1; overflow-y: auto; padding: 8px 10px; display: flex; flex-direction: column; gap: 6px; }
    .${ROW_CLASS} {
      background: #1c2126;
      border: 1px solid rgba(255, 255, 255, 0.09);
      border-left: 3px solid var(--tf2te-lq-q, #b0c3d9);
      border-radius: 5px;
      padding: 8px 9px;
      display: grid;
      grid-template-columns: 32px minmax(0, 1fr) auto;
      gap: 8px;
      align-items: start;
      /* Belt-and-suspenders against a child poking past the row's own
         rounded corner - nothing in this row is meant to extend past its
         own boundary by design. See #88. */
      overflow: hidden;
    }
    .${ROW_CLASS} .tf2te-lq-thumb {
      width: 32px; height: 32px; border-radius: 3px;
      background: linear-gradient(150deg, rgba(255, 255, 255, 0.16), rgba(255, 255, 255, 0.03));
      background-size: cover;
      background-position: center;
      background-repeat: no-repeat;
      border: 1px solid rgba(255, 255, 255, 0.09);
      flex: none;
    }
    .${ROW_CLASS} .tf2te-lq-name { font-size: 12.5px; font-weight: 600; color: #e7e9eb; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .${ROW_CLASS} .tf2te-lq-effect { font-size: 10.5px; color: #8650ac; margin-top: 1px; }
    .${ROW_CLASS} .tf2te-lq-priceline { display: flex; align-items: center; gap: 5px; margin-top: 6px; }
    .tf2te-lq-pricefield {
      display: flex; align-items: center; gap: 3px;
      background: #0e1114; border: 1px solid rgba(255, 255, 255, 0.09); border-radius: 4px; padding: 2px 6px;
    }
    .tf2te-lq-pricefield input {
      background: transparent; border: none; outline: none; color: #e7e9eb;
      font-size: 11.5px; font-weight: 600; width: 4ch; min-width: 28px; text-align: right;
    }
    /* Widened specifically for this field rather than for keys too (an
       integer count, rarely more than 2-3 digits) - metal values regularly
       need a decimal point plus two digits (e.g. "11.11"), which the shared
       4ch/28px width above is too narrow for. See #89. */
    .tf2te-lq-pricefield.metal input { width: 5.5ch; min-width: 40px; }
    .tf2te-lq-pricefield .unit { font-size: 10px; color: #666d74; }
    .tf2te-lq-pricefield.keys .unit { color: #e0b04e; }
    .tf2te-lq-pricefield.metal .unit { color: #8fc2d6; }
    /* Its own full-width line under the item (all three grid columns), two
       lines tall so a typical default note shows whole; can be dragged taller. */
    .tf2te-lq-comment {
      grid-column: 1 / -1; width: 100%; box-sizing: border-box; min-height: 40px; resize: vertical;
      background: #0e1114; border: 1px solid rgba(255, 255, 255, 0.09); border-radius: 4px;
      color: #e7e9eb; font-family: inherit; font-size: 11.5px; line-height: 1.4; padding: 5px 7px;
    }
    .tf2te-lq-comment:focus { outline: none; border-color: rgba(143, 194, 214, 0.55); }
    .${ROW_CLASS} .tf2te-lq-side { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
    .tf2te-lq-remove {
      width: 18px; height: 18px; border-radius: 4px; border: none; background: transparent;
      color: #666d74; cursor: pointer; font-size: 11px; line-height: 1;
    }
    .tf2te-lq-remove:hover { color: #dd7d70; background: rgba(221, 125, 112, 0.14); }
    .tf2te-lq-status {
      font-weight: 700; font-size: 9px; letter-spacing: 0.03em; text-transform: uppercase;
      border-radius: 20px; padding: 2px 6px; white-space: nowrap;
    }
    .tf2te-lq-status[data-status="idle"] { color: #666d74; background: #0e1114; border: 1px solid rgba(255, 255, 255, 0.09); }
    .tf2te-lq-status[data-status="pending"] { color: #e0b04e; background: rgba(224, 176, 78, 0.13); }
    .tf2te-lq-status[data-status="success"] { color: #7dc389; background: rgba(125, 195, 137, 0.14); }
    .tf2te-lq-status[data-status="fail"] { color: #dd7d70; background: rgba(221, 125, 112, 0.13); }
    .tf2te-lq-empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; color: #666d74; padding: 30px 20px; gap: 5px; font-size: 12px; }
    .tf2te-lq-foot { border-top: 1px solid rgba(255, 255, 255, 0.09); padding: 10px 12px 12px; display: flex; flex-direction: column; gap: 8px; flex: none; }
    .tf2te-lq-foot-total { display: flex; justify-content: space-between; font-size: 11.5px; color: #9aa1a8; }
    .tf2te-lq-foot-buttons { display: flex; gap: 7px; }
    .tf2te-lq-btn {
      font-family: inherit; font-size: 12px; font-weight: 700; border-radius: 4px; padding: 7px 12px;
      border: 1px solid rgba(255, 255, 255, 0.09); background: #1c2126; color: #9aa1a8; cursor: pointer;
    }
    .tf2te-lq-btn:hover { background: #242a30; color: #e7e9eb; }
    .tf2te-lq-btn.primary { flex: 1; background: #3f7cae; border-color: #3f7cae; color: #fff; }
    .tf2te-lq-btn.primary:hover { background: #4a8cbf; }
    .tf2te-lq-btn.primary:disabled { opacity: 0.5; cursor: default; }
  `;
  document.head.appendChild(style);
}

function getQualityIdFromClassName(className) {
  const match = QUALITY_CLASS_PATTERN.exec(className || "");
  return match ? Number(match[1]) : 6; // 6 = Unique, same fallback utils/tf2Quality.js's own helpers use
}

// Reads the logged-in account's own INTERNAL backpack.tf user id, via the
// navbar's "Sign Out" link (/logout?user-id=...) - confirmed live this is
// an opaque hex string (32 hex characters), NOT a
// steamid64, and NOT comparable against a /profiles/{steamid64} URL. Kept
// around only for buildListingParams' own "user-id" POST field below (see
// publishRequest.js's own header note on that contract) - see
// resolveLoggedInSteamId64 for the actual steamid, used for page-ownership
// comparisons instead.
function resolveLoggedInUserId() {
  const logoutLink = Array.from(document.querySelectorAll("a")).find((a) => (a.getAttribute("href") || "").startsWith("/logout"));
  if (!logoutLink) return null;
  return new URL(logoutLink.getAttribute("href"), window.location.href).searchParams.get("user-id");
}

// The real steamid64 lives on the navbar's OWN "My Backpack"/username links,
// not resolveLoggedInUserId's own value (an unrelated opaque hex id, not a
// steamid). Both ".username a" at the top and the dropdown's "My Backpack"
// item point to "/profiles/{your steamid64}", regardless of whose backpack
// page you're currently viewing. ".navbar-user-block .username a" is tried
// first (a single, unambiguous element); the dropdown's own first
// /profiles/link (confirmed live to be "My Backpack" - "My Profile" right
// below it links to /u/{id} instead, a different path prefix) is the
// fallback. See #90.
function resolveLoggedInSteamId64() {
  // Two-step scoped lookup (find the navbar container first, then its own
  // <a> children) rather than one combined descendant selector - matches
  // this codebase's own established convention elsewhere (see e.g.
  // backpack.tf/oldUI/premiumSearchLastSeenHighlight/content.js's own
  // insertLegendPanel) of avoiding descendant-combinator selector strings.
  const usernameBlock = document.querySelector(".navbar-user-block");
  const dropdown = document.querySelector(".navbar-user-dropdown");
  const candidates = [
    ...(usernameBlock ? usernameBlock.querySelectorAll("a") : []),
    ...(dropdown ? dropdown.querySelectorAll("a") : []),
  ];

  const profileLink = candidates.find((a) => (a.getAttribute("href") || "").startsWith("/profiles/"));
  if (!profileLink) return null;

  const match = /\/profiles\/(\d+)/.exec(profileLink.getAttribute("href") || "");
  return match ? match[1] : null;
}

/*
@description: Ctrl+click "queue a sell listing" only makes sense against
items you actually own. Compares the page's own /profiles/{id} segment
against resolveLoggedInSteamId64's own steamid64. Fails closed (false) when
either id can't be resolved at all, rather than defaulting to showing the
drawer - an unconfirmed match is treated the same as a confirmed mismatch.
See #91.
*/
function isViewingOwnBackpack() {
  const loggedInSteamId = resolveLoggedInSteamId64();
  if (!loggedInSteamId) return false;

  const pageMatch = /^\/profiles\/(\d+)/.exec(window.location.pathname);
  return Boolean(pageMatch && pageMatch[1] === loggedInSteamId);
}

/*
@description: See this file's own header note on why this needs a fallback
at all - and why that fallback is a plain input row in the drawer itself
(see buildManualTradeOfferUrlRow below), not window.prompt(). Returns null
(never throws, never blocks) when neither the DOM nor storage has one yet -
publishAll still proceeds with an empty trade_offer_url in that case rather
than blocking the whole batch on it.
*/
async function resolveTradeOfferUrl() {
  const userLink = document.querySelector(".user-link[data-offers-params]");
  if (userLink) {
    return `https://steamcommunity.com/tradeoffer/new/${userLink.getAttribute("data-offers-params")}`;
  }

  const stored = await chrome.storage.local.get([TRADE_OFFER_URL_STORAGE_KEY]);
  return stored[TRADE_OFFER_URL_STORAGE_KEY] || null;
}

// Confirmed live - the item icon itself sits on a CHILD ".item-icon" div
// (its own inline "background-image: url(...)" style), not on the ".item"
// tile element directly. Read via the raw "style" attribute string (not
// el.style.backgroundImage) so this works the same way against the hand-
// rolled test fake as it does in a real browser.
function resolveIconUrl(el) {
  const iconEl = el.querySelector(".item-icon");
  const styleAttr = iconEl?.getAttribute("style") || "";
  const match = /background-image:\s*url\((['"]?)(.*?)\1\)/.exec(styleAttr);
  return match ? match[2] : null;
}

function resolveItemFromElement(el) {
  const assetId = el.getAttribute("data-id");
  const defindex = el.getAttribute("data-defindex");
  if (!assetId || !defindex) return null;

  const qualityId = getQualityIdFromClassName(el.className);
  return {
    assetId,
    defindex,
    baseName: el.getAttribute("data-name") || "Unknown Item",
    qualityId,
    qualityName: QUALITY_NAME_BY_ID[qualityId] || "Unique",
    effectName: el.getAttribute("data-effect_name") || null,
    priceRefined: el.getAttribute("data-price") ? Number(el.getAttribute("data-price")) : null,
    iconUrl: resolveIconUrl(el),
  };
}

// ---------- drawer ----------

let drawer = null; // built eagerly on page load - see ensureDrawer's own callers

// Element.children is a real HTMLCollection in an actual browser, not a
// plain array - it has no .find() (or any other Array.prototype method) at
// all. Wrapped in Array.from() here (same fix the "remove" queue listener
// further down already uses for this exact same property) to work against
// both. See #92.
function findRow(assetId) {
  if (!drawer) return null;
  return Array.from(drawer.list.children).find((row) => row.dataset.assetId === assetId) ?? null;
}

function refreshCounts(queue) {
  const n = queue.size;
  drawer.badge.textContent = String(n);
  drawer.tabCount.textContent = String(n);
  drawer.list.style.display = n === 0 ? "none" : "flex";
  drawer.empty.style.display = n === 0 ? "flex" : "none";

  let totalKeys = 0;
  let totalMetal = 0;
  queue.list().forEach((entry) => {
    totalKeys += Number(entry.keys) || 0;
    totalMetal += Number(entry.metal) || 0;
  });
  drawer.footCount.textContent = `${n} listing${n === 1 ? "" : "s"} queued`;
  drawer.footTotal.textContent = `~${totalKeys} keys, ${totalMetal.toFixed(2)} ref`;
}

// QUALITY_COLOR_BY_NAME (utils/tf2Quality.js) deliberately has NO entry for
// Unique at all, matching Valve's own convention that Unique gets no
// distinct quality color. QUALITY_FALLBACK_COLOR is a plain neutral grey,
// chosen for contrast against the row's own dark background, not for
// matching any real Valve quality color. See #93.
const QUALITY_FALLBACK_COLOR = "#5c6570";

function buildRow(entry) {
  const row = document.createElement("div");
  row.className = ROW_CLASS;
  row.dataset.assetId = entry.assetId;
  row.style.setProperty("--tf2te-lq-q", QUALITY_COLOR_BY_NAME[entry.qualityName] || QUALITY_FALLBACK_COLOR);

  const thumb = document.createElement("div");
  thumb.className = "tf2te-lq-thumb";
  // Reuses the real item icon already resolved off the tile itself (see
  // resolveIconUrl's own note) - falls back to the plain gradient
  // placeholder (see this class's own CSS rule) when it couldn't be found.
  if (entry.iconUrl) {
    thumb.style.backgroundImage = `url("${entry.iconUrl}")`;
  }
  row.appendChild(thumb);

  const main = document.createElement("div");
  const name = document.createElement("div");
  name.className = "tf2te-lq-name";
  name.textContent = entry.baseName;
  main.appendChild(name);

  if (entry.effectName) {
    const effect = document.createElement("div");
    effect.className = "tf2te-lq-effect";
    effect.textContent = `✦ ${entry.effectName}`;
    main.appendChild(effect);
  } else if (entry.qualityName !== "Unique") {
    const qualityLine = document.createElement("div");
    qualityLine.className = "tf2te-lq-effect";
    qualityLine.style.color = QUALITY_COLOR_BY_NAME[entry.qualityName] || "#9aa1a8";
    qualityLine.textContent = entry.qualityName;
    main.appendChild(qualityLine);
  }

  const priceLine = document.createElement("div");
  priceLine.className = "tf2te-lq-priceline";

  const keysField = document.createElement("label");
  keysField.className = "tf2te-lq-pricefield keys";
  const keysInput = document.createElement("input");
  keysInput.inputMode = "numeric";
  keysInput.value = entry.keys || "";
  keysInput.placeholder = "0";
  keysField.appendChild(keysInput);
  const keysUnit = document.createElement("span");
  keysUnit.className = "unit";
  keysUnit.textContent = "keys";
  keysField.appendChild(keysUnit);

  const metalField = document.createElement("label");
  metalField.className = "tf2te-lq-pricefield metal";
  const metalInput = document.createElement("input");
  metalInput.inputMode = "decimal";
  metalInput.value = entry.metal || "";
  metalInput.placeholder = "0";
  metalField.appendChild(metalInput);
  const metalUnit = document.createElement("span");
  metalUnit.className = "unit";
  metalUnit.textContent = "ref";
  metalField.appendChild(metalUnit);

  priceLine.appendChild(keysField);
  priceLine.appendChild(metalField);
  main.appendChild(priceLine);

  // Mutates the SAME object the queue holds (queue.get/list return live
  // references, not copies) directly, with no queue.update()/re-render
  // round trip - typing must never risk losing focus/cursor position (see
  // this file's own header note, design point 2). refreshCounts only rewrites
  // the header/footer text, so it keeps the footer total in step with the
  // edit without touching this row.
  keysInput.addEventListener("input", () => {
    entry.keys = parseInt(keysInput.value, 10) || 0;
    if (drawer) refreshCounts(drawer.queue);
  });
  metalInput.addEventListener("input", () => {
    entry.metal = parseFloat(metalInput.value) || 0;
    if (drawer) refreshCounts(drawer.queue);
  });


  row.appendChild(main);

  const side = document.createElement("div");
  side.className = "tf2te-lq-side";

  const removeBtn = document.createElement("button");
  removeBtn.className = "tf2te-lq-remove";
  removeBtn.type = "button";
  removeBtn.title = "Remove";
  removeBtn.textContent = "✕";
  removeBtn.addEventListener("click", () => drawer.queue.remove(entry.assetId));
  side.appendChild(removeBtn);

  const status = document.createElement("span");
  status.className = "tf2te-lq-status";
  status.dataset.status = "idle";
  status.textContent = "Ready";
  side.appendChild(status);

  row.appendChild(side);

  // backpack.tf's own listing notes box allows 200 characters (maxlength on
  // its textarea), so a longer comment couldn't be published.
  const comment = document.createElement("textarea");
  comment.className = "tf2te-lq-comment";
  comment.rows = 2;
  comment.maxLength = 200;
  comment.placeholder = "Comment (optional)";
  comment.value = entry.details || "";
  comment.addEventListener("input", () => {
    entry.details = comment.value;
  });
  row.appendChild(comment);

  return row;
}

const STATUS_LABEL = { idle: "Ready", pending: "Publishing", success: "✓ Listed", fail: "Failed" };

function patchRowStatus(entry) {
  const row = findRow(entry.assetId);
  if (!row) return;
  const status = row.querySelector(".tf2te-lq-status");
  if (!status) return;
  status.dataset.status = entry.status || "idle";
  status.textContent = entry.status === "fail" && entry.error ? entry.error : STATUS_LABEL[entry.status] || "Ready";
}

/*
@description: The manual trade offer URL input - see this file's own header
note on why it's an input row, not window.prompt(). Hidden by default (ensureDrawer's own caller
shows it only once it's confirmed actually needed); saves straight to the
same TRADE_OFFER_URL_STORAGE_KEY resolveTradeOfferUrl already reads, on
every keystroke rather than only on blur/submit - cheap, and means a
publish mid-typing still picks up whatever's currently in the field.
*/
function buildManualTradeOfferUrlRow() {
  const row = document.createElement("div");
  row.className = "tf2te-lq-tradeurl";
  row.style.display = "none";

  const label = document.createElement("div");
  label.className = "tf2te-lq-tradeurl-label";
  label.textContent = "Your Steam trade offer URL (so buyers can send you an offer):";
  row.appendChild(label);

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "https://steamcommunity.com/tradeoffer/new/?partner=...&token=...";
  input.addEventListener("input", () => {
    chrome.storage.local.set({ [TRADE_OFFER_URL_STORAGE_KEY]: input.value.trim() });
  });
  row.appendChild(input);

  return row;
}

function ensureDrawer(queue) {
  if (drawer) return drawer;

  ensureStyleInjected();

  const el = document.createElement("div");
  el.className = DRAWER_CLASS;

  // Persists whichever way the user last left it - see this file's own
  // header note on why this can't just default to collapsed every time.
  function toggleCollapsed() {
    const collapsed = el.classList.toggle(DRAWER_COLLAPSED_CLASS);
    chrome.storage.local.set({ [COLLAPSED_STORAGE_KEY]: collapsed });
  }

  const tab = document.createElement("div");
  tab.className = TAB_CLASS;
  const tabCount = document.createElement("span");
  tabCount.className = "count";
  tabCount.textContent = "0";
  const tabLabel = document.createElement("span");
  tabLabel.className = "label";
  tabLabel.textContent = "Queue";
  tab.appendChild(tabCount);
  tab.appendChild(tabLabel);
  tab.addEventListener("click", toggleCollapsed);
  el.appendChild(tab);

  const head = document.createElement("div");
  head.className = "tf2te-lq-head";
  const heading = document.createElement("h3");
  heading.textContent = "Listing queue";
  const badge = document.createElement("span");
  badge.className = "badge";
  badge.textContent = "0";
  heading.appendChild(badge);
  const collapseBtn = document.createElement("button");
  collapseBtn.className = "tf2te-lq-collapse";
  collapseBtn.type = "button";
  collapseBtn.textContent = "›";
  collapseBtn.addEventListener("click", toggleCollapsed);
  head.appendChild(heading);
  head.appendChild(collapseBtn);
  el.appendChild(head);

  const tradeUrlRow = buildManualTradeOfferUrlRow();
  el.appendChild(tradeUrlRow);
  // Shown only when neither the DOM nor storage already has one - see this
  // file's own header note and resolveTradeOfferUrl's own note. Checked
  // async, after the drawer's own first paint, same tradeoff
  // refreshCounts/the collapsed-state restore above already accept.
  resolveTradeOfferUrl().then((url) => {
    if (!url) tradeUrlRow.style.display = "flex";
  });

  const list = document.createElement("div");
  list.className = "tf2te-lq-list";
  el.appendChild(list);

  const empty = document.createElement("div");
  empty.className = "tf2te-lq-empty";
  empty.innerHTML = "<b>Nothing queued yet</b><span>Hold Ctrl and click an item to add it here.</span>";
  el.appendChild(empty);

  const foot = document.createElement("div");
  foot.className = "tf2te-lq-foot";
  const footTotalRow = document.createElement("div");
  footTotalRow.className = "tf2te-lq-foot-total";
  const footCount = document.createElement("span");
  const footTotal = document.createElement("b");
  footTotalRow.appendChild(footCount);
  footTotalRow.appendChild(footTotal);
  const footButtons = document.createElement("div");
  footButtons.className = "tf2te-lq-foot-buttons";
  const clearBtn = document.createElement("button");
  clearBtn.className = "tf2te-lq-btn";
  clearBtn.type = "button";
  clearBtn.textContent = "Clear";
  clearBtn.addEventListener("click", () => queue.clear());
  const publishBtn = document.createElement("button");
  publishBtn.className = "tf2te-lq-btn primary";
  publishBtn.type = "button";
  publishBtn.textContent = "Publish all";
  publishBtn.addEventListener("click", () => publishAll(queue, publishBtn));
  footButtons.appendChild(clearBtn);
  footButtons.appendChild(publishBtn);
  foot.appendChild(footTotalRow);
  foot.appendChild(footButtons);
  el.appendChild(foot);

  document.body.appendChild(el);

  drawer = { el, tab, tabCount, badge, list, empty, footCount, footTotal, publishBtn, queue };
  refreshCounts(queue); // shows the empty-state hint immediately, before anything is queued

  // Applied async (a brief expanded flash is an acceptable tradeoff for
  // never needing to block the drawer's own first paint on a storage read)
  // - defaults to expanded (see this file's own header note) whenever
  // nothing was saved yet.
  chrome.storage.local.get([COLLAPSED_STORAGE_KEY]).then((stored) => {
    if (stored[COLLAPSED_STORAGE_KEY]) el.classList.add(DRAWER_COLLAPSED_CLASS);
  });

  return drawer;
}

// Wrapped in try/catch/finally so the button is ALWAYS re-enabled, and any
// failure (not just a per-item publish error, which already had its own
// try/catch) is surfaced on every still-pending row rather than swallowed.
async function publishAll(queue, publishBtn) {
  // A "success" entry stays queued for SUCCESS_REMOVE_DELAY_MS so its ✓ is
  // visible - it must not be published a second time by a click in that
  // window. Failed entries are retried.
  const entries = queue.list().filter((entry) => entry.status !== "pending" && entry.status !== "success");
  if (entries.length === 0) return;

  publishBtn.disabled = true;
  try {
    const { userId, tradeOfferUrl } = await resolvePublishIdentity();

    for (const entry of entries) {
      // entries is a snapshot from the click - skip anything removed (✕ or
      // Clear) while an earlier request was still in flight, rather than
      // publishing a listing the user just took out of the queue.
      if (!queue.has(entry.assetId)) continue;

      queue.update(entry.assetId, { status: "pending" });
      try {
        const params = buildListingParams({
          assetId: entry.assetId,
          keys: entry.keys,
          metal: entry.metal,
          details: entry.details,
          tradeOfferUrl,
          userId,
        });
        await publishListing(params);
        queue.update(entry.assetId, { status: "success" });
        setTimeout(() => queue.remove(entry.assetId), SUCCESS_REMOVE_DELAY_MS);
      } catch (e) {
        queue.update(entry.assetId, { status: "fail", error: e.message });
      }
      await new Promise((resolve) => setTimeout(resolve, PUBLISH_DELAY_MS));
    }
  } catch (e) {
    entries.forEach((entry) => {
      if (queue.get(entry.assetId)?.status !== "success") queue.update(entry.assetId, { status: "fail", error: e.message });
    });
  } finally {
    publishBtn.disabled = false;
  }
}

// Resolved once per publish batch (not once per page load) - cheap either
// way (resolveTradeOfferUrl's own DOM read/storage check are both fast),
// and avoids holding a stale value across a very long browsing session.
async function resolvePublishIdentity() {
  const [userId, tradeOfferUrl] = await Promise.all([resolveLoggedInUserId(), resolveTradeOfferUrl()]);
  return { userId, tradeOfferUrl };
}

// ---------- item detection ----------

async function addItemToQueue(el, queue) {
  const item = resolveItemFromElement(el);
  if (!item) return;
  if (queue.has(item.assetId)) return;

  // Starts each row with the notes backpack.tf would pre-fill by hand.
  const details = await fetchDefaultListingNotes(item.assetId);
  // The free edition has no live key value, so the starting price is in
  // metal (see estimateStartingPrice).
  const { keys, metal } = estimateStartingPrice(item.priceRefined, null);

  queue.add({ ...item, keys, metal, details, status: "idle" });
}

function handleBackpackClick(event, queue) {
  if (!event.ctrlKey) return;
  const item = event.target.closest?.(ITEM_SELECTOR);
  if (!item) return;

  event.preventDefault();
  event.stopPropagation();
  addItemToQueue(item, queue);
}

export function listingQueue() {
  if (!window.location.pathname.startsWith("/profiles/")) return;

  const backpack = document.querySelector(BACKPACK_SELECTOR);
  if (!backpack) return;

  if (!isViewingOwnBackpack()) return;

  const queue = createQueue();

  // Built eagerly (not lazily on the first queued item) - see this file's
  // own header note on why: the empty-state hint text is the one place
  // that explains Ctrl+click at all, so it needs to be visible from the
  // start, not hidden behind already knowing about the feature.
  ensureDrawer(queue);

  queue.on("add", (entry) => {
    const d = ensureDrawer(queue);
    d.list.appendChild(buildRow(entry));
    refreshCounts(queue);
  });
  queue.on("remove", () => {
    if (!drawer) return;
    // Drops every row whose asset is no longer queued, so a row that is
    // already gone (e.g. a fast double-remove) is simply not found here.
    Array.from(drawer.list.children).forEach((row) => {
      if (!queue.has(row.dataset.assetId)) row.remove();
    });
    refreshCounts(queue);
  });
  queue.on("update", (entry) => {
    patchRowStatus(entry);
    refreshCounts(queue);
  });
  queue.on("clear", () => {
    if (!drawer) return;
    drawer.list.innerHTML = "";
    refreshCounts(queue);
  });

  backpack.addEventListener("click", (event) => handleBackpackClick(event, queue));

  // Returned (harmless in production - nothing reads it there) so
  // tests/listingQueueContent.test.js can inspect queue state directly
  // instead of only through rendered DOM text.
  return queue;
}

/*
@description: Test-only reset for the module-scoped `drawer` reference
above - without this, a SECOND listingQueue() call within the same test
file (ES modules are singleton-cached, so every test in
tests/listingQueueContent.test.js imports this same module instance) would
keep reusing the FIRST test's own drawer element, which by then belongs to
a document that test already tore down.
*/
export function __resetListingQueueForTests() {
  drawer = null;
}
