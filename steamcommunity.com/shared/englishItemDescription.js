/*
@description: An inventory item's English description, for a Steam page shown
in another language. Confirmed live (Steam in Hungarian): every item
attribute line - Unusual effect, Sheen, Killstreaker, paint, spells, the
rename notice - is rendered as translated text, values included ("Brennende
Flammen", not "Burning Flames"), and Steam's own data carries no numeric
attribute ids either (each line is just {"value": "...", "name":
"attribute"}). Every reader in itemQuickLinks/content.js matches English
text, so on a non-English page they found nothing and built links for the
wrong item.

Rather than translating labels and values for every Steam language, this asks
Steam for the same item in English: the item-hover endpoint Steam's own hover
pop-ups use, one ~3 KB request per item (confirmed live: ~300 ms, vs ~2 MB for
a page of the whole inventory), cached for the rest of the page. Its
description has the same shape as the page's own, so
buildEnglishItemPanel can render it into a stand-in panel the existing
readers work on unchanged.
*/

const REQUEST_EVENT = "tf2te-asset-class-request";
const RESPONSE_EVENT = "tf2te-asset-class-response";
const BRIDGE_TIMEOUT_MS = 3000;

/*
@description: Whether Steam is showing this page in English - <html lang>,
confirmed live as "hu" on a Hungarian page. A missing lang is treated as
English, so nothing changes for a page this can't tell about.
*/
export function isEnglishSteamPage() {
  const lang = (document.documentElement?.lang || "").toLowerCase();
  return !lang || lang === "en" || lang.startsWith("en-");
}

/*
@description: The class/instance ids of one asset, from the page's own
inventory data (g_rgAppContextData - the same object the inventory page's
"Total pure" box reads). Not used by the page-world bridge itself
(inventoryMarketActions/mainWorld.js is a classic script and keeps its own
copy).
@returns {?{classid: string, instanceid: string}}
*/
export function readAssetClassIds(pageWindow, appid, contextid, assetid) {
  const description = pageWindow?.g_rgAppContextData?.[appid]?.rgContexts?.[contextid]?.inventory?.m_rgAssets?.[assetid]?.description;
  if (!description?.classid) return null;
  return { classid: String(description.classid), instanceid: String(description.instanceid ?? "0") };
}

/*
@description: readAssetClassIds for an isolated content script, which can't
see page globals - window.wrappedJSObject on Firefox, else the CustomEvent
bridge in inventoryMarketActions/mainWorld.js (same two routes as
./walletCurrency.js).
@returns {Promise<?{classid: string, instanceid: string}>} null when the
page doesn't have that asset (or the bridge didn't answer).
*/
export function getAssetClassIds(appid, contextid, assetid) {
  const fromPage = readAssetClassIds(window.wrappedJSObject, appid, contextid, assetid);
  if (fromPage) return Promise.resolve(fromPage);

  return new Promise((resolve) => {
    const requestId = `${Date.now()}-${Math.random()}`;
    const timeoutId = setTimeout(() => {
      document.removeEventListener(RESPONSE_EVENT, onResponse);
      resolve(null);
    }, BRIDGE_TIMEOUT_MS);

    function onResponse(event) {
      const detail = typeof event.detail === "string" ? JSON.parse(event.detail) : event.detail;
      if (detail?.requestId !== requestId) return;
      clearTimeout(timeoutId);
      document.removeEventListener(RESPONSE_EVENT, onResponse);
      resolve(detail.classid ? { classid: String(detail.classid), instanceid: String(detail.instanceid ?? "0") } : null);
    }

    document.addEventListener(RESPONSE_EVENT, onResponse);
    document.dispatchEvent(new CustomEvent(REQUEST_EVENT, { detail: JSON.stringify({ requestId, appid, contextid, assetid }) }));
  });
}

// Set on a Market page's item titles and pictures by
// ../tradeOffer/pages/marketListing.js (page world, where React's data is
// reachable) - "{appid}_{classid}_{instanceid}".
const CLASS_ID_ATTRIBUTE = "data-tf2te-class";
const CLASS_ID_WAIT_MS = 2000;

function parseStampedClassIds(el) {
  const match = /^(\d+)_(\d+)_(\d+)$/.exec(el?.getAttribute?.(CLASS_ID_ATTRIBUTE) || "");
  return match ? { appid: match[1], classid: match[2], instanceid: match[3] } : null;
}

/*
@description: A Market item title's or picture's class ids, waiting up to
CLASS_ID_WAIT_MS for the page script to stamp them (it scans shortly after
each render, so it can trail a script reading the same render).
@returns {Promise<?{appid: string, classid: string, instanceid: string}>}
*/
export function getStampedClassIds(el) {
  const stamped = parseStampedClassIds(el);
  if (stamped || !el) return Promise.resolve(stamped);

  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      const ids = parseStampedClassIds(el);
      if (!ids) return;
      observer.disconnect();
      clearTimeout(timeoutId);
      resolve(ids);
    });
    observer.observe(el, { attributes: true, attributeFilter: [CLASS_ID_ATTRIBUTE] });
    const timeoutId = setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, CLASS_ID_WAIT_MS);
  });
}

/*
@description: The English stand-in panel (see buildEnglishItemPanel) for the
first of `elements` - a Market item's title or picture - that has its class
ids stamped.
@returns {Promise<?Element>} null when none has, or Steam didn't answer.
*/
export async function loadEnglishPanelForMarketItem(...elements) {
  for (const el of elements.filter(Boolean)) {
    const ids = await getStampedClassIds(el);
    if (!ids) continue;
    const description = await fetchEnglishDescription(ids.appid, ids.classid, ids.instanceid);
    return description ? buildEnglishItemPanel(description) : null;
  }
  return null;
}

/*
@description: Pulls the item description out of an item-hover response -
confirmed live, the HTML is an empty template filled in by an inline
`BuildHover( 'economy_item_…', {…} );` call, whose second argument is the
description as a JSON object literal. Scans for the matching closing brace
(skipping braces inside strings) rather than a regex, since the object
nests.
@returns {?Object} the description, or null if the response has none.
*/
export function parseHoverDescription(html) {
  const callIndex = html.indexOf("BuildHover(");
  if (callIndex === -1) return null;
  const start = html.indexOf("{", callIndex);
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}" && --depth === 0) {
      try {
        return JSON.parse(html.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

// A class/instance pair always describes the same item (Steam gives a changed
// item a new instance id), so an entry never goes stale. Failed lookups
// aren't kept, so the next attempt retries.
const descriptionCache = new Map();

export function __resetEnglishDescriptionCacheForTests() {
  descriptionCache.clear();
}

/*
@returns {Promise<?Object>} the English description, or null if Steam
didn't return one.
*/
export function fetchEnglishDescription(appid, classid, instanceid) {
  const key = `${appid}_${classid}_${instanceid}`;
  if (!descriptionCache.has(key)) {
    const url = `https://steamcommunity.com/economy/itemclasshover/${appid}/${classid}/${instanceid}?content_only=1&l=english`;
    const request = fetch(url)
      .then((res) => (res.ok ? res.text() : null))
      .then((html) => (html ? parseHoverDescription(html) : null))
      .catch(() => null)
      .then((description) => {
        if (!description) descriptionCache.delete(key);
        return description;
      });
    descriptionCache.set(key, request);
  }
  return descriptionCache.get(key);
}

const HTML_ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };

// An "html"-type description line can carry markup (<br>, colored spans);
// the readers only ever want its text.
function lineText(line) {
  const value = String(line?.value ?? "");
  if (line?.type !== "html") return value;
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (entity) => HTML_ENTITIES[entity]);
}

function appendLine(panel, text) {
  const trimmed = text.trim();
  if (!trimmed) return;
  const line = document.createElement("div");
  line.textContent = trimmed;
  panel.appendChild(line);
}

/*
@description: Renders an English description into a detached element shaped
like the parts of Steam's item panel itemQuickLinks/content.js reads: the
<h1> title, the market listing link (always present on the real panel too,
marketable or not), the rename notice, one leaf <div> per description line,
and the hidden "Tags: …" line, with the Tradable/Marketable tokens built
from the description's own flags.
@returns {Element}
*/
export function buildEnglishItemPanel(description) {
  const panel = document.createElement("div");

  const title = document.createElement("h1");
  title.textContent = description.name || description.market_hash_name || "";
  panel.appendChild(title);

  if (description.market_hash_name) {
    const link = document.createElement("a");
    link.setAttribute("href", `https://steamcommunity.com/market/listings/${description.appid}/${encodeURIComponent(description.market_hash_name)}`);
    panel.appendChild(link);
  }

  for (const warning of description.fraudwarnings || []) appendLine(panel, String(warning));
  for (const line of description.descriptions || []) appendLine(panel, lineText(line));

  const tagNames = (description.tags || []).map((tag) => tag.localized_tag_name || tag.name).filter(Boolean);
  tagNames.push(Number(description.tradable) ? "Tradable" : "Not Tradable");
  tagNames.push(Number(description.marketable) ? "Marketable" : "Not Marketable");
  appendLine(panel, `Tags: ${tagNames.join(", ")}`);

  return panel;
}
