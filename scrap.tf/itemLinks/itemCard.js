/*
@description: Builds and drives the small floating "item card" (bottom-left
of the page) that shows a hovered item's resolved identity and outbound
links. createItemCard() injects its CSS/DOM once and returns an
update(name, itemEl) function, called by itemLinks/content.js on every
middle-click of a hovered item.
*/
import {
  resolveItemDetails,
  insertPricedbLink,
  insertPricedbPlaceholder,
  insertPricedbRateLimited,
  insertPostsTfResult,
  insertPostsTfPlaceholder,
} from "./resolveItemDetails.js";
import { applyApiKeyHint, applyLoadingState, startRetryCountdown, stopRetryCountdown } from "../../utils/linkButtonStates.js";

const ITEM_CARD_STYLE = `
  #tf2te-item-card{
    position:fixed;
    left:12px;
    bottom:12px;
    z-index:2147483647;
    padding:10px 12px;
    border-radius:10px;
    background: #201c1a;
    color:#fff;
    border:1px solid #2a2a2a;
    box-shadow:0 8px 20px rgba(0,0,0,.35);
    font:12px/1.4 system-ui,Segoe UI,Roboto,Helvetica,Arial;
    max-width:275px;
    display:block;
  }
  #tf2te-item-card .tf2te-item-card-name{ font-weight:700; margin-bottom:8px; cursor:pointer; display:inline-block; }
  #tf2te-item-card .tf2te-item-card-name:hover{ opacity:0.8; }
  #tf2te-item-card .tf2te-item-card-name.tf2te-copy-item-name-success{ background-color: rgba(0, 150, 0, 0.3); }
  #tf2te-item-card .tf2te-item-card-name.tf2te-copy-item-name-error{ background-color: rgba(150, 0, 0, 0.3); }
  #tf2te-item-card .tf2te-item-card-loading{ color:#9a9a9a; font-style:italic; margin-bottom:8px; }
  #tf2te-item-card .tf2te-item-card-level{ color:#9a9a9a; margin-bottom:8px; }
  #tf2te-item-card .tf2te-item-card-festivized{ color:#ffd700; margin-bottom:8px; }
  #tf2te-item-card .tf2te-item-card-paint{ color:#7fb8e0; margin-bottom:8px; }
  #tf2te-item-card .tf2te-item-card-effect{ color:#fff; margin-bottom:8px; }
  #tf2te-item-card .tf2te-item-card-spell{ color:#a569bd; margin-bottom:8px; }
  #tf2te-item-card .tf2te-item-card-killstreak-tier{ color:#E74C3C; margin-bottom:8px; }
  #tf2te-item-card .tf2te-item-card-sheen{ color:#E74C3C; margin-bottom:8px; }
  #tf2te-item-card .tf2te-item-card-killstreaker{ color:#E74C3C; margin-bottom:8px; }
  #tf2te-item-card .tf2te-item-card-skin{ color:#5e98d9; margin-bottom:8px; }
  #tf2te-item-card .tf2te-item-card-uncraft{ color:#E74C3C; margin-bottom:8px; }
  #tf2te-item-card .tf2te-item-card-btns{ display:flex; gap:8px; flex-wrap:wrap; }
  #tf2te-item-card .btn{
    border:1px solid #2e2e2e;
    background: #352f2c;
    color:#eaeaea;
    padding:5px 8px;
    border-radius:6px;
    text-decoration:none;
    font-size:12px;
  }
  #tf2te-item-card .btn:hover{ background: #201c1a; }
  #tf2te-item-card .tf2te-item-card-history-btn{ display:inline-flex; align-items:center; justify-content:center; }
  #tf2te-item-card .tf2te-item-card-btn-loading{ opacity:0.55; cursor:default; }
  #tf2te-item-card .tf2te-item-card-btn-loading:hover{ background: #352f2c; }
`;

// Same history icon as steamcommunity.com (priceWidgets.js, tradeoffer.js);
// a bold-stroke list shape stays legible at 12px. A local copy because
// scrap.tf scripts cannot import steamcommunity.com/ files.
const HISTORY_ICON_SVG =
  '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><circle cx="4.5" cy="6" r="1.3" fill="currentColor" stroke="none"/><line x1="9" y1="6" x2="20" y2="6"/><circle cx="4.5" cy="12" r="1.3" fill="currentColor" stroke="none"/><line x1="9" y1="12" x2="20" y2="12"/><circle cx="4.5" cy="18" r="1.3" fill="currentColor" stroke="none"/><line x1="9" y1="18" x2="16" y2="18"/></svg>';

function injectStyle() {
  const style = document.createElement("style");
  style.textContent = ITEM_CARD_STYLE;
  document.head.appendChild(style);
}

// Same click-to-copy flash classes as backpack.tf's copyItemName features.
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    console.warn("[TF2 Trading Enhancer] scrap.tf item card: clipboard write failed", e);
    return false;
  }
}

/*
@description: Makes the name line copy the current display name on click.
Wired once (not in update()), since the same node is reused and a
per-update listener would stack duplicates.
*/
function wireUpCopyableName(nameEl) {
  nameEl.title = "Click to copy item name";
  nameEl.addEventListener("click", async () => {
    const name = nameEl.textContent.trim();
    if (!name) return;

    const success = await copyToClipboard(name);
    const cls = success ? "tf2te-copy-item-name-success" : "tf2te-copy-item-name-error";
    nameEl.classList.add(cls);
    setTimeout(() => nameEl.classList.remove(cls), 400);
  });
}

function createItemCardElement() {
  const card = document.createElement("div");
  card.id = "tf2te-item-card";
  card.innerHTML = `
    <div class="tf2te-item-card-name">Middle-click an item…</div>
    <div class="tf2te-item-card-loading" hidden>Resolving item info…</div>
    <div class="tf2te-item-card-skin" hidden></div>
    <div class="tf2te-item-card-effect" hidden></div>
    <div class="tf2te-item-card-level" hidden></div>
    <div class="tf2te-item-card-paint" hidden></div>
    <div class="tf2te-item-card-spell" hidden></div>
    <div class="tf2te-item-card-killstreak-tier" hidden></div>
    <div class="tf2te-item-card-sheen" hidden></div>
    <div class="tf2te-item-card-killstreaker" hidden></div>
    <div class="tf2te-item-card-festivized" hidden></div>
    <div class="tf2te-item-card-uncraft" hidden></div>
    <div class="tf2te-item-card-btns"></div>
  `;
  return card;
}

/*
@description: Injects the item card's CSS and DOM once, and returns an
`update(name, itemEl)` function that resolves the given hovered item's
details and repaints the card with them.

updateToken is bumped on every call so a slower-resolving lookup for a
previously hovered item can't overwrite the card after a newer item was
already selected.
*/
export function createItemCard() {
  injectStyle();
  const card = createItemCardElement();
  document.documentElement.appendChild(card);
  wireUpCopyableName(card.querySelector(".tf2te-item-card-name"));

  let updateToken = 0;

  // Buttons currently running a rate-limit countdown. Stopped whenever the
  // row is redrawn or another item is selected, so a replaced button's timer
  // can't fire a stale retry.
  let countdownButtons = [];
  function stopCountdowns() {
    countdownButtons.forEach(stopRetryCountdown);
    countdownButtons = [];
  }

  async function update(name, itemEl) {
    const token = ++updateToken;

    const nameEl = card.querySelector(".tf2te-item-card-name");
    const loadingEl = card.querySelector(".tf2te-item-card-loading");
    const skinEl = card.querySelector(".tf2te-item-card-skin");
    const effectEl = card.querySelector(".tf2te-item-card-effect");
    const levelEl = card.querySelector(".tf2te-item-card-level");
    const paintEl = card.querySelector(".tf2te-item-card-paint");
    const spellEl = card.querySelector(".tf2te-item-card-spell");
    const killstreakTierEl = card.querySelector(".tf2te-item-card-killstreak-tier");
    const sheenEl = card.querySelector(".tf2te-item-card-sheen");
    const killstreakerEl = card.querySelector(".tf2te-item-card-killstreaker");
    const festivizedEl = card.querySelector(".tf2te-item-card-festivized");
    const uncraftEl = card.querySelector(".tf2te-item-card-uncraft");
    const btnsEl = card.querySelector(".tf2te-item-card-btns");

    nameEl.textContent = name; // instant feedback; replaced with the full descriptive name below

    // resolveItemDetails can take a noticeable moment on a cold cache (a
    // schema fetch), so show a loading line and clear the previous item's
    // details right away.
    loadingEl.hidden = false;
    skinEl.hidden = true;
    effectEl.hidden = true;
    levelEl.hidden = true;
    paintEl.hidden = true;
    spellEl.hidden = true;
    killstreakTierEl.hidden = true;
    sheenEl.hidden = true;
    killstreakerEl.hidden = true;
    festivizedEl.hidden = true;
    uncraftEl.hidden = true;
    stopCountdowns();
    btnsEl.innerHTML = "";

    const {
      displayName, qualityColor, level, isFestivized, killstreakTierName, paintName, paintColor, effectName, spellName, sheenName, killstreakerName, skinLabel, isUncraft, links,
      pricedbPromise, lookupPricedb, postsTfPromise, postsTfApplies, statsUnresolved, classifiedsHref, nextClassifiedsHref,
    } = await resolveItemDetails(name, itemEl);

    if (token !== updateToken) return; // a newer item was selected while this resolved

    loadingEl.hidden = true;
    nameEl.textContent = displayName;
    nameEl.style.color = qualityColor || "";

    skinEl.textContent = skinLabel ? `Skin: ${skinLabel}` : "";
    skinEl.hidden = !skinLabel;

    effectEl.textContent = effectName ? `Effect: ${effectName}` : "";
    effectEl.hidden = !effectName;

    levelEl.textContent = level ? `Level ${level}` : "";
    levelEl.hidden = !level;

    paintEl.textContent = paintName ? `Painted: ${paintName}` : "";
    paintEl.hidden = !paintName;
    paintEl.style.color = paintColor || "";

    spellEl.textContent = spellName ? `Halloween Spell: ${spellName}` : "";
    spellEl.hidden = !spellName;

    killstreakTierEl.textContent = killstreakTierName || "";
    killstreakTierEl.hidden = !killstreakTierName;

    sheenEl.textContent = sheenName ? `Sheen: ${sheenName}` : "";
    sheenEl.hidden = !sheenName;

    killstreakerEl.textContent = killstreakerName ? `Killstreaker: ${killstreakerName}` : "";
    killstreakerEl.hidden = !killstreakerName;

    festivizedEl.textContent = isFestivized ? "Festivized" : "";
    festivizedEl.hidden = !isFestivized;

    // Always the last info line, matching scrap.tf's own tooltip.
    uncraftEl.textContent = isUncraft ? "Uncraftable" : "";
    uncraftEl.hidden = !isUncraft;

    // Pair a classifieds-search shortcut icon with each respective stats
    // button, instead of giving them their own separately-spaced buttons.
    const classifiedsHrefByLabel = {
      "backpack.tf stats": classifiedsHref,
      "next.backpack.tf stats": nextClassifiedsHref,
    };

    // This exact asset's history page on each site (/item/{assetid}); the
    // hovered element carries the Steam asset id as data-id.
    const assetid = itemEl.getAttribute('data-id');
    const historyHrefByLabel = assetid
      ? {
          "backpack.tf stats": `https://backpack.tf/item/${assetid}`,
          "next.backpack.tf stats": `https://next.backpack.tf/item/${assetid}`,
        }
      : {};

    // A null href renders as a non-clickable <span>: an <a> with href=null
    // would navigate to the string "null". Three null-href entries get
    // utils/linkButtonStates.js states instead: a lookup still running
    // (loading: label + spinner), a missing Steam Web API key (needsKey: key
    // icon, click opens the key settings) and a pricedb.io rate limit
    // (rateLimitedUntil: countdown, then retryPricedb). The countdown counts
    // to a fixed time, so a redraw mid-countdown carries on rather than
    // restarting.
    function createLinkButton({ label, href, title, needsKey, rateLimitedUntil, loading }) {
      if (loading) {
        const btn = document.createElement("span");
        btn.className = "btn";
        applyLoadingState(btn, label);
        return btn;
      }
      if (needsKey) {
        const btn = document.createElement("a");
        btn.className = "btn";
        applyApiKeyHint(btn, { label, title });
        return btn;
      }
      if (rateLimitedUntil) {
        const btn = document.createElement("span");
        btn.className = "btn";
        startRetryCountdown(btn, {
          label,
          retryAfterMs: rateLimitedUntil - Date.now(),
          onRetry: (isConnected) => {
            if (isConnected) retryPricedb();
          },
        });
        countdownButtons.push(btn);
        return btn;
      }
      const btn = document.createElement(href ? "a" : "span");
      btn.className = href ? "btn" : "btn tf2te-item-card-btn-loading";
      btn.textContent = label;
      if (href) {
        btn.href = href;
        btn.target = "_blank";
      }
      if (title) btn.title = title;
      return btn;
    }

    function renderButtons(currentLinks) {
      stopCountdowns();
      btnsEl.innerHTML = "";
      for (let i = 0; i < currentLinks.length; i++) {
        const { label } = currentLinks[i];
        const btn = createLinkButton(currentLinks[i]);

        const pairedClassifiedsHref = classifiedsHrefByLabel[label];
        const pairedHistoryHref = historyHrefByLabel[label];
        // stntrading.eu and Steam Market (already always adjacent in
        // resolveItemDetails.js's own links array, right before Steam
        // Market) are grouped into one flex item here, same mechanism as the
        // classifieds/history icon pairing just above, so the two always
        // wrap together as a single unit onto the same row. See #134.
        const nextLink = currentLinks[i + 1];
        const pairedSteamMarket = label === "stntrading.eu" && nextLink?.label === "Steam Market";

        if (pairedClassifiedsHref || pairedHistoryHref || pairedSteamMarket) {
          const group = document.createElement("div");
          group.style.display = "flex";
          group.style.gap = "8px";
          group.appendChild(btn);

          if (pairedClassifiedsHref) {
            const classifiedsBtn = document.createElement("a");
            classifiedsBtn.className = "btn";
            classifiedsBtn.textContent = "📰";
            classifiedsBtn.title = "Browse classifieds listings";
            classifiedsBtn.href = pairedClassifiedsHref;
            classifiedsBtn.target = "_blank";
            group.appendChild(classifiedsBtn);
          }

          if (pairedHistoryHref) {
            const historyBtn = document.createElement("a");
            historyBtn.className = "btn tf2te-item-card-history-btn";
            historyBtn.title = "View this exact item's history";
            historyBtn.innerHTML = HISTORY_ICON_SVG;
            historyBtn.href = pairedHistoryHref;
            historyBtn.target = "_blank";
            group.appendChild(historyBtn);
          }

          if (pairedSteamMarket) {
            group.appendChild(createLinkButton(nextLink));
            i++; // already rendered as part of this group - skip its own turn
          }

          btnsEl.appendChild(group);
          continue;
        }

        btnsEl.appendChild(btn);
      }
    }

    // pricedb.io's search and posts.tf's defindex lookup are started by
    // resolveItemDetails without being awaited and spliced in when they
    // settle. rebuildRow always starts from the original `links` and
    // re-applies both slots' current state, so either promise can settle
    // first. posts.tf is inserted before pricedb.io (see
    // afterGladiatorIndex in resolveItemDetails.js for why). See #132. See #19.
    let pricedbResult; // undefined = still pending (show the placeholder)
    let postsTfResult; // undefined = still pending (show the placeholder, only if postsTfApplies)

    function rebuildRow() {
      let currentLinks = links;

      if (postsTfApplies) {
        currentLinks =
          postsTfResult === undefined ? insertPostsTfPlaceholder(currentLinks) : insertPostsTfResult(currentLinks, postsTfResult, statsUnresolved);
      }

      currentLinks =
        pricedbResult === undefined
          ? insertPricedbPlaceholder(currentLinks)
          : pricedbResult.href
            ? insertPricedbLink(currentLinks, pricedbResult.href)
            : pricedbResult.rateLimited
              ? insertPricedbRateLimited(currentLinks, pricedbResult.retryAt)
              : currentLinks;

      renderButtons(currentLinks);
    }

    // The rate-limit countdown ran out: look pricedb.io up again (the
    // placeholder shows meanwhile). A 429 again just starts a new countdown.
    function retryPricedb() {
      if (token !== updateToken) return;
      pricedbResult = undefined;
      rebuildRow();
      lookupPricedb().then((result) => {
        if (token !== updateToken) return;
        pricedbResult = result;
        rebuildRow();
      });
    }

    rebuildRow(); // initial paint - both slots still pending

    // Re-checks the token first in both callbacks (a newer item may have
    // been selected while either was still resolving, in which case
    // rebuilding now would show a stale button on the WRONG item's card).
    pricedbPromise.then((result) => {
      if (token !== updateToken) return;
      pricedbResult = result;
      rebuildRow();
    });

    postsTfPromise.then((result) => {
      if (token !== updateToken) return;
      postsTfResult = result;
      rebuildRow();
    });
  }

  return { update };
}
