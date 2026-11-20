/*
@description: Wires up the extension's toolbar popup. Loaded as a classic
script (popup.html has no type="module"), so shared modules are loaded with
dynamic import(chrome.runtime.getURL(...)). Sections, each set up from
initPopup() at the bottom of this file:
  - which feature scripts are active on the current tab (queried from that
    tab's router via GET_LOADED_SCRIPTS, see utils/scriptRouter.js);
  - the settings, built from the same classes as the settings page
    (settings/*.js: general settings, the trade offer sound and the API
    keys), so the two never differ and stay in sync through chrome.storage;
  - the currency calculator (initCalculator) and the cog that opens the
    settings page.
Settings are read/written in chrome.storage.local under the same keys the
content scripts read.
*/
function renderVersionBadge() {
  const { version } = chrome.runtime.getManifest();
  const badge = document.getElementById("version-badge");
  if (badge) badge.textContent = `v${version}`;
}
renderVersionBadge();

// Accordion: opening one credential settings <details> closes the others.
// The open one is persisted (OPEN_SETTINGS_PANEL_KEY) because the popup
// closes whenever focus leaves it, e.g. to copy a token from another tab.
const settingsDetailsEls = [];
const OPEN_SETTINGS_PANEL_KEY = "openSettingsPanel";

/*
@description: Persists whichever settings <details> is currently open (or
null), re-derived from every element's live state. Closing a sibling to
enforce the accordion fires a second, later "toggle" event; persisting from
that one element's (closed) state would overwrite the correct entry with
null.
*/
function persistOpenSettingsPanel() {
  const openEntry = settingsDetailsEls.find(({ el }) => el.open);
  chrome.storage.local.set({ [OPEN_SETTINGS_PANEL_KEY]: openEntry ? openEntry.panelKey : null });
}

function registerSettingsToggle(detailsEl, panelKey) {
  settingsDetailsEls.push({ el: detailsEl, panelKey });
  detailsEl.addEventListener("toggle", () => {
    if (detailsEl.open) {
      settingsDetailsEls.forEach(({ el }) => {
        if (el !== detailsEl) el.open = false;
      });
    }
    persistOpenSettingsPanel();
  });
}

/*
@description: Re-expands the settings section left open last time. Called
after every registerSettingsToggle call.
*/
async function restoreOpenSettingsPanel() {
  const stored = await chrome.storage.local.get([OPEN_SETTINGS_PANEL_KEY]);
  const openPanelKey = stored[OPEN_SETTINGS_PANEL_KEY];
  if (!openPanelKey) return;

  const match = settingsDetailsEls.find(({ panelKey }) => panelKey === openPanelKey);
  if (match) match.el.open = true;
}

/*
@description: The popup-only parts of the settings: the Steam Web API
<details>' and the General settings panel's open states, persisted.
*/
const GENERAL_SETTINGS_OPEN_KEY = "generalSettingsPanelOpen";

async function initSettingsPanels() {
  const generalDetails = document.getElementById("general-settings-details");
  if (generalDetails) {
    const stored = await chrome.storage.local.get([GENERAL_SETTINGS_OPEN_KEY]);
    generalDetails.open = Boolean(stored[GENERAL_SETTINGS_OPEN_KEY]);
    generalDetails.addEventListener("toggle", () => {
      chrome.storage.local.set({ [GENERAL_SETTINGS_OPEN_KEY]: generalDetails.open });
    });
  }

  const steamDetails = document.getElementById("steam-settings-details");
  if (steamDetails) registerSettingsToggle(steamDetails, "steam");
  await restoreOpenSettingsPanel();
}

// The settings sections shared with the settings page (settings/*.js), in
// popup order.
const SETTINGS_SECTIONS = [
  ["settings/generalSettings.js", "GeneralSettings"],
  ["settings/alertSoundSettings.js", "AlertSoundSettings"],
  ["settings/apiKeySettings.js", "ApiKeySettings"],
];

async function initSettingsSection(path, className) {
  const module = await import(chrome.runtime.getURL(path));
  await new module[className]({ page: "popup" }).init();
}

/*
@description: The header's cog: opens the settings page (or focuses the one
already open) and closes the popup.
*/
async function initSettingsButton() {
  const button = document.getElementById("open-settings");
  if (!button) return;
  const { openSettingsPage } = await import(chrome.runtime.getURL("settings/settingsSection.js"));
  button.addEventListener("click", async () => {
    await openSettingsPage();
    globalThis.close?.();
  });
}

/*
@description: Wires up the "Calculator" panel: converts owned key/ref/rec/
scrap amounts into a keys-and-money total with a per-denomination
include/exclude breakdown (math in utils/calculator.js), plus standalone
"Quick Math" rows. Every field auto-saves on change (not a credential, so no
Save button) so the popup reopens where it was left. Its open state is
persisted on its own key, outside the credential accordion.
*/
const CALC_PANEL_OPEN_KEY = "calcPanelOpen";

async function initCalculator() {
  const details = document.getElementById("calculator-details");
  if (!details) return;

  const keyPriceRefInput = document.getElementById("calc-key-price-ref");
  const keyPriceRefDecBtn = document.getElementById("calc-key-price-ref-dec");
  const keyPriceRefIncBtn = document.getElementById("calc-key-price-ref-inc");
  const currencySelect = document.getElementById("calc-currency");
  const keyPriceCurrencyInput = document.getElementById("calc-key-price-currency");
  const keyPriceCurrencyDecBtn = document.getElementById("calc-key-price-currency-dec");
  const keyPriceCurrencyIncBtn = document.getElementById("calc-key-price-currency-inc");

  const ownedInputs = {
    key: document.getElementById("calc-owned-key"),
    ref: document.getElementById("calc-owned-ref"),
    rec: document.getElementById("calc-owned-rec"),
    scrap: document.getElementById("calc-owned-scrap"),
  };
  const includeInputs = {
    key: document.getElementById("calc-include-key"),
    ref: document.getElementById("calc-include-ref"),
    rec: document.getElementById("calc-include-rec"),
    scrap: document.getElementById("calc-include-scrap"),
  };
  const resultOutputs = {
    key: document.getElementById("calc-result-key"),
    ref: document.getElementById("calc-result-ref"),
    rec: document.getElementById("calc-result-rec"),
    scrap: document.getElementById("calc-result-scrap"),
  };
  const totalKeysOutput = document.getElementById("calc-total-keys");
  const totalCurrencyOutput = document.getElementById("calc-total-currency");

  // Standalone "Quick Math" rows (a×b, a÷b, a+b, a−b), one row per
  // operation, unrelated to the currency conversion above.
  const mulAInput = document.getElementById("calc-mul-a");
  const mulBInput = document.getElementById("calc-mul-b");
  const mulResultOutput = document.getElementById("calc-mul-result");
  const divAInput = document.getElementById("calc-div-a");
  const divBInput = document.getElementById("calc-div-b");
  const divResultOutput = document.getElementById("calc-div-result");
  const addAInput = document.getElementById("calc-add-a");
  const addBInput = document.getElementById("calc-add-b");
  const addResultOutput = document.getElementById("calc-add-result");
  const subAInput = document.getElementById("calc-sub-a");
  const subBInput = document.getElementById("calc-sub-b");
  const subResultOutput = document.getElementById("calc-sub-result");

  const calcModule = await import(chrome.runtime.getURL("utils/calculator.js"));

  const stored = await chrome.storage.local.get([
    "calcKeyPriceRefined", "calcCurrency", "calcKeyPriceCurrency",
    "calcOwnedKey", "calcOwnedRef", "calcOwnedRec", "calcOwnedScrap",
    "calcIncludeKey", "calcIncludeRef", "calcIncludeRec", "calcIncludeScrap",
    "calcMulA", "calcMulB", "calcDivA", "calcDivB", "calcAddA", "calcAddB", "calcSubA", "calcSubB",
    CALC_PANEL_OPEN_KEY,
  ]);

  details.open = Boolean(stored[CALC_PANEL_OPEN_KEY]);
  details.addEventListener("toggle", () => {
    chrome.storage.local.set({ [CALC_PANEL_OPEN_KEY]: details.open });
  });

  currencySelect.value = stored.calcCurrency || "USD";
  if (stored.calcKeyPriceCurrency) keyPriceCurrencyInput.value = stored.calcKeyPriceCurrency;

  ownedInputs.key.value = stored.calcOwnedKey || 0;
  ownedInputs.ref.value = stored.calcOwnedRef || 0;
  ownedInputs.rec.value = stored.calcOwnedRec || 0;
  ownedInputs.scrap.value = stored.calcOwnedScrap || 0;

  includeInputs.key.checked = stored.calcIncludeKey !== false;
  includeInputs.ref.checked = stored.calcIncludeRef !== false;
  includeInputs.rec.checked = stored.calcIncludeRec !== false;
  includeInputs.scrap.checked = stored.calcIncludeScrap !== false;

  if (stored.calcMulA) mulAInput.value = stored.calcMulA;
  if (stored.calcMulB) mulBInput.value = stored.calcMulB;
  if (stored.calcDivA) divAInput.value = stored.calcDivA;
  if (stored.calcDivB) divBInput.value = stored.calcDivB;
  if (stored.calcAddA) addAInput.value = stored.calcAddA;
  if (stored.calcAddB) addBInput.value = stored.calcAddB;
  if (stored.calcSubA) subAInput.value = stored.calcSubA;
  if (stored.calcSubB) subBInput.value = stored.calcSubB;

  if (stored.calcKeyPriceRefined) keyPriceRefInput.value = stored.calcKeyPriceRefined;

  // Whole numbers render without decimals (the common case - a plain key/ref
  // count), a fractional one (only possible for whichever denomination is
  // the smallest INCLUDED one, see breakdownRefined's own note) gets 2.
  function formatBreakdownValue(value) {
    return value.toFixed(value % 1 === 0 ? 0 : 2);
  }

  // String(), not toFixed(2): results are already roundClean'd, so this shows
  // the exact value without padding or truncating.
  function formatMathResult(value) {
    return String(value);
  }

  function recomputeMath() {
    mulResultOutput.textContent = formatMathResult(
      calcModule.multiply(calcModule.parseAmountInput(mulAInput.value), calcModule.parseAmountInput(mulBInput.value))
    );
    divResultOutput.textContent = formatMathResult(
      calcModule.divide(calcModule.parseAmountInput(divAInput.value), calcModule.parseAmountInput(divBInput.value))
    );
    addResultOutput.textContent = formatMathResult(
      calcModule.add(calcModule.parseAmountInput(addAInput.value), calcModule.parseAmountInput(addBInput.value))
    );
    subResultOutput.textContent = formatMathResult(
      calcModule.subtract(calcModule.parseAmountInput(subAInput.value), calcModule.parseAmountInput(subBInput.value))
    );
  }

  function recompute() {
    const keyPriceRefined = calcModule.parseAmountInput(keyPriceRefInput.value) || null;
    const keyPriceCurrency = calcModule.parseAmountInput(keyPriceCurrencyInput.value) || null;
    const currency = currencySelect.value;

    const owned = {
      key: calcModule.parseAmountInput(ownedInputs.key.value),
      ref: calcModule.parseAmountInput(ownedInputs.ref.value),
      rec: calcModule.parseAmountInput(ownedInputs.rec.value),
      scrap: calcModule.parseAmountInput(ownedInputs.scrap.value),
    };
    const included = {
      key: includeInputs.key.checked,
      ref: includeInputs.ref.checked,
      rec: includeInputs.rec.checked,
      scrap: includeInputs.scrap.checked,
    };

    const totalRefined = calcModule.ownedToRefined(owned, keyPriceRefined);
    const breakdown = calcModule.breakdownRefined(totalRefined, included, keyPriceRefined);

    resultOutputs.key.textContent = formatBreakdownValue(breakdown.key);
    resultOutputs.ref.textContent = formatBreakdownValue(breakdown.ref);
    resultOutputs.rec.textContent = formatBreakdownValue(breakdown.rec);
    resultOutputs.scrap.textContent = formatBreakdownValue(breakdown.scrap);

    const keysTotal = calcModule.totalKeys(totalRefined, keyPriceRefined);
    const moneyTotal = calcModule.totalMoney(keysTotal, keyPriceCurrency);

    const keysLabel = calcModule.formatKeysTotal(keysTotal, currency);
    totalKeysOutput.textContent = keysLabel === null ? "N/A" : `${keysLabel} keys`;

    const moneyLabel = calcModule.formatMoney(moneyTotal, currency);
    totalCurrencyOutput.textContent = moneyLabel === null ? "N/A" : moneyLabel;
  }

  // Debounced (not immediate) - a number input fires "input" on every
  // keystroke, and there's no reason to hit chrome.storage.local that often;
  // recompute() itself still runs immediately every time for a responsive
  // result while typing.
  let saveTimer = null;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      chrome.storage.local.set({
        calcKeyPriceRefined: calcModule.parseAmountInput(keyPriceRefInput.value) || null,
        calcCurrency: currencySelect.value,
        calcKeyPriceCurrency: calcModule.parseAmountInput(keyPriceCurrencyInput.value) || null,
        calcOwnedKey: calcModule.parseAmountInput(ownedInputs.key.value),
        calcOwnedRef: calcModule.parseAmountInput(ownedInputs.ref.value),
        calcOwnedRec: calcModule.parseAmountInput(ownedInputs.rec.value),
        calcOwnedScrap: calcModule.parseAmountInput(ownedInputs.scrap.value),
        calcIncludeKey: includeInputs.key.checked,
        calcIncludeRef: includeInputs.ref.checked,
        calcIncludeRec: includeInputs.rec.checked,
        calcIncludeScrap: includeInputs.scrap.checked,
        calcMulA: calcModule.parseAmountInput(mulAInput.value) || null,
        calcMulB: calcModule.parseAmountInput(mulBInput.value) || null,
        calcDivA: calcModule.parseAmountInput(divAInput.value) || null,
        calcDivB: calcModule.parseAmountInput(divBInput.value) || null,
        calcAddA: calcModule.parseAmountInput(addAInput.value) || null,
        calcAddB: calcModule.parseAmountInput(addBInput.value) || null,
        calcSubA: calcModule.parseAmountInput(subAInput.value) || null,
        calcSubB: calcModule.parseAmountInput(subBInput.value) || null,
      });
    }, 200);
  }

  function onFieldChange() {
    recompute();
    scheduleSave();
  }

  function onMathFieldChange() {
    recomputeMath();
    scheduleSave();
  }

  [keyPriceRefInput, keyPriceCurrencyInput, ownedInputs.key, ownedInputs.ref, ownedInputs.rec, ownedInputs.scrap].forEach((el) => {
    el.addEventListener("input", onFieldChange);
  });
  [currencySelect, includeInputs.key, includeInputs.ref, includeInputs.rec, includeInputs.scrap].forEach((el) => {
    el.addEventListener("change", onFieldChange);
  });
  [mulAInput, mulBInput, divAInput, divBInput, addAInput, addBInput, subAInput, subBInput].forEach((el) => {
    el.addEventListener("input", onMathFieldChange);
  });

  // "− [value] +" steppers for the two price fields (see popup.css's
  // .calc-stepper note). Each click nudges the value and reuses the normal
  // recompute/save path.
  function wireStepper(inputEl, decBtn, incBtn, { step = 1, min = 0 } = {}) {
    if (!decBtn || !incBtn) return;
    function applyStep(delta) {
      const current = calcModule.parseAmountInput(inputEl.value);
      inputEl.value = Math.max(min, Math.round((current + delta) * 100) / 100);
      onFieldChange();
    }
    decBtn.addEventListener("click", () => applyStep(-step));
    incBtn.addEventListener("click", () => applyStep(step));
  }
  wireStepper(keyPriceRefInput, keyPriceRefDecBtn, keyPriceRefIncBtn, { step: 1 });
  wireStepper(keyPriceCurrencyInput, keyPriceCurrencyDecBtn, keyPriceCurrencyIncBtn, { step: 0.01 });

  recompute();
  recomputeMath();
}

/*
@description: Mirrors the toolbar icon's own badge (set by background.js's
pollTradeOffers) onto the "Trade offers" quick-link button, via
chrome.action.getBadgeText rather than re-polling Steam ourselves - there's
only ever one source of truth for this count. Hidden whenever there's nothing
to show, same as the toolbar badge clearing itself back to empty at count 0.
*/
async function renderTradeOfferBadge() {
  const badgeEl = document.getElementById("tradeoffer-badge");
  if (!badgeEl) return;

  const text = await chrome.action.getBadgeText({});
  badgeEl.textContent = text;
  badgeEl.hidden = !text;
}

// The popup asks for a fresh trade offer count on open, unless the last
// check is younger than this, so reopening it quickly can't hammer Steam.
const TRADEOFFER_REFRESH_MAX_AGE_MS = 15 * 1000;

// Written by background.js after every trade offer check, right after it has
// updated the toolbar badge.
const LAST_TRADEOFFER_COUNT_KEY = "lastKnownPendingTradeOfferCount";

/*
@description: Keeps the popup's Trade offers badge live while the popup stays
open (e.g. while using the calculator): when the 2-minute background check
finds a new offer and chimes, this button shows it too instead of keeping the
count from when the popup opened.
*/
function watchTradeOfferBadge() {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && LAST_TRADEOFFER_COUNT_KEY in changes) renderTradeOfferBadge();
  });
}

/*
@description: Starts watchTradeOfferBadge, shows the cached count right away
(renderTradeOfferBadge), then asks background.js for a check no older than
TRADEOFFER_REFRESH_MAX_AGE_MS and re-reads the badge once it answers. An
offer accepted or declined elsewhere (e.g. the Steam mobile app) disappears
from the count without waiting for the next 2-minute poll.
*/
async function refreshTradeOfferBadge() {
  watchTradeOfferBadge();
  await renderTradeOfferBadge();
  try {
    await chrome.runtime.sendMessage({ type: "REFRESH_TRADEOFFER_BADGE", maxAgeMs: TRADEOFFER_REFRESH_MAX_AGE_MS });
  } catch {
    return; // background unreachable: the cached count stays
  }
  await renderTradeOfferBadge();
}

/*
@description: The popup document is recreated on every open, so the scroll
position is persisted and restored once the layout has settled. #app, not
body, is the scrolling element (see popup.css: body's overflow would be
propagated to the viewport).
*/
const POPUP_SCROLL_STORAGE_KEY = "popupScrollTop";

function initScrollPersistence() {
  const appEl = document.getElementById("app");
  let saveScrollTimer = null;
  appEl.addEventListener("scroll", () => {
    clearTimeout(saveScrollTimer);
    saveScrollTimer = setTimeout(() => {
      chrome.storage.local.set({ [POPUP_SCROLL_STORAGE_KEY]: appEl.scrollTop });
    }, 150);
  });
}

async function restoreScrollPosition() {
  const stored = await chrome.storage.local.get([POPUP_SCROLL_STORAGE_KEY]);
  if (stored[POPUP_SCROLL_STORAGE_KEY]) {
    document.getElementById("app").scrollTop = stored[POPUP_SCROLL_STORAGE_KEY];
  }
}

/*
@description: Runs one init* function and logs (rather than propagates) any
exception, so one failing section cannot stop the later ones in initPopup()
from initializing.
See #150.
*/
async function safeInit(label, fn) {
  try {
    await fn();
  } catch (e) {
    console.error(`[TF2 Trading Enhancer] popup: ${label} failed:`, e);
  }
}

async function initPopup() {
  initScrollPersistence();
  // Started first and awaited last: it only waits on the open tab, so it
  // shouldn't sit behind the settings panels' own setup. Until it answers, the
  // status badge stays invisible (popup.css .badge--pending).
  const activeScriptsShown = showActiveScripts();
  refreshTradeOfferBadge();

  // Awaited (unlike a plain fire-and-forget call) so the accordion panel
  // restore in initSettingsPanels has already run before scroll position is
  // restored - otherwise a saved scroll offset from an expanded panel could
  // exceed the page's still-collapsed scroll height and silently clamp to
  // the wrong spot.
  await safeInit("initSettingsButton", initSettingsButton);
  for (const [path, className] of SETTINGS_SECTIONS) {
    await safeInit(className, () => initSettingsSection(path, className));
  }
  await safeInit("initSettingsPanels", initSettingsPanels);
  await safeInit("initCalculator", initCalculator);
  await activeScriptsShown;

  // Forces one final reflow after web fonts load (the font swap changes the
  // layout). document.fonts does not exist in the test fake document. See #45.
  if (typeof document.fonts?.ready?.then === "function") {
    await document.fonts.ready;
    if (document.body) void document.body.offsetHeight;
  }

  // Restored last, once the content has its final height; restoring earlier
  // would clamp a deeper saved offset.
  await restoreScrollPosition();
}

/*
@description: Fills the "active / inactive" status and the list of features
the open tab's content scripts loaded (GET_LOADED_SCRIPTS, answered by
utils/scriptRouter.js).
*/
async function showActiveScripts() {
  const scriptListEl = document.getElementById("scripts-list");
  const statusBadge  = document.getElementById("status-badge");

  // The status badge alone says "inactive". The list is hidden, not just
  // emptied, because its padding/min-height would otherwise leave a gap.
  function setInactive() {
    statusBadge.textContent = "inactive";
    statusBadge.className   = "badge badge--inactive";
    scriptListEl.innerHTML = "";
    scriptListEl.style.display = "none";
  }

  // A closed <details> showing just the count: a page can have 8-10 active
  // features, which would otherwise dominate the popup.
  function setActive(scripts) {
    statusBadge.textContent = "active";
    statusBadge.className   = "badge badge--active";

    scriptListEl.style.display = "";
    scriptListEl.innerHTML = "";

    const details = document.createElement("details");
    details.id = "scripts-details";

    const summary = document.createElement("summary");
    summary.textContent = `${scripts.length} active script${scripts.length === 1 ? "" : "s"}`;
    details.appendChild(summary);

    scripts.forEach((name) => {
      const wrapper = document.createElement("div");
      wrapper.className = "script-item";

      const nameSpan = document.createElement("span");
      nameSpan.textContent = name;

      wrapper.appendChild(nameSpan);
      details.appendChild(wrapper);
    });

    scriptListEl.appendChild(details);
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    setInactive();
  } else {
    try {
      // chrome.tabs.sendMessage is promise-based here (no callback passed),
      // so a failure surfaces as a rejection into the catch below, not via
      // chrome.runtime.lastError (that's only set for the legacy callback API).
      let resp = await chrome.tabs.sendMessage(tab.id, { type: "GET_LOADED_SCRIPTS" });

      // A router's own feature modules load via dynamic import() before
      // registry.label() runs (see utils/scriptRouter.js), so a query that
      // lands before those imports resolve sees an empty, not-yet-`settled`
      // scripts array even on a page that's about to become active. One
      // bounded retry (not a poll loop) covers that window without hanging
      // forever on a page that's genuinely inactive/never settles.
      if (resp && !resp.settled && !resp.scripts?.length) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        resp = await chrome.tabs.sendMessage(tab.id, { type: "GET_LOADED_SCRIPTS" });
      }

      if (resp?.scripts?.length) setActive(resp.scripts);
      else setInactive();
    } catch {
      setInactive();
    }
  }
}

document.addEventListener("DOMContentLoaded", initPopup);

/*
@description: Test-only hooks for tests/popup.test.js. A globalThis
assignment rather than `export`, because popup.html loads this file as a
classic script where `export` is a SyntaxError. reset() clears module-scope
state so tests can re-run initPopup() against a fresh fake document without
re-importing (see utils/tf2Schema.js's __resetSchemaCacheForTests for why).
*/
globalThis.__popupTestHooks = {
  reset() {
    settingsDetailsEls.length = 0;
  },
  renderVersionBadge,
  initPopup,
};