/*
@description: The Steam Web API key, with a live "Check" button, Save, the
amber missing-key dot and the Steam item schema status.

Save buttons: the popup's #settings-save and the settings page's
#steam-save. The field fills in live when the key is saved elsewhere, unless
it has unsaved typing of its own.
*/
import { SettingsSection } from "./settingsSection.js";

/*
@description: Relays a fetch() through background.js's FETCH_JSON handler
(see background.js for why cross-origin reads go through it) and returns its
raw { ok, data | error, status } envelope - unlike utils/fetchJsonRelay.js's
fetchJsonRelay, which unwraps data and throws on failure, the credential
checks here need the error text itself.
*/
export async function relayFetchJson(url) {
  try {
    return await chrome.runtime.sendMessage({ type: "FETCH_JSON", url });
  } catch (e) {
    // e.g. "Extension context invalidated" if the extension reloads while
    // the page is open; same shape as background.js's own failures.
    return { ok: false, error: e.message || "Extension messaging failed" };
  }
}

// Recovers the HTTP status from background.js's "Request failed (404)" error
// text, to tell a bad credential (401/403) apart from other failures.
function extractHttpStatus(errorMessage) {
  const match = /\((\d+)\)/.exec(errorMessage || "");
  return match ? Number(match[1]) : null;
}

// Firefox's MV3 does not auto-grant host_permissions on install, so the
// background fetch() fails with a bare NetworkError (no HTTP status) until
// the user grants site access in about:addons. There is no API to request a
// required host permission, so the hint names the fix instead.
const FIREFOX_HOST_PERMISSION_HINT =
  " (On Firefox, this usually means the extension's site permissions weren't granted - go to about:addons, open this extension, open its Permissions tab, and enable access, then check again.)";

/*
@description: Turns a failed credential check's error message into either a
specific "invalid key/token" message (when the underlying HTTP status is one
of the given auth-failure codes) or a generic "check failed" message that
carries the real error through - used by checkSteamApiKey below.
@param {string|undefined} errorMessage - res.error from relayFetchJson
@param {number[]} invalidStatusCodes - HTTP statuses that mean "bad credential"
@param {string} invalidMessage - shown when the status matches one of those
@returns {{status: "error", message: string}}
*/
function classifyCredentialError(errorMessage, invalidStatusCodes, invalidMessage) {
  const httpStatus = extractHttpStatus(errorMessage);
  if (invalidStatusCodes.includes(httpStatus)) {
    return { status: "error", message: invalidMessage };
  }

  const hint = httpStatus === null && /NetworkError/i.test(errorMessage || "") ? FIREFOX_HOST_PERMISSION_HINT : "";
  return { status: "error", message: `✗ Check failed: ${errorMessage || "unknown error"}${hint}` };
}

/*
@description: Pings GetSchemaOverview (the smallest real Steam Web API call
this extension makes) with the given key to confirm it's actually valid,
rather than just present - a bad/revoked key still fills the "no key" UI
state, so a cheap live call is the only way to tell them apart.
*/
async function checkSteamApiKey(key) {
  if (!key) return { status: "off", message: "No key entered." };

  const url = new URL("https://api.steampowered.com/IEconItems_440/GetSchemaOverview/v0001/");
  url.searchParams.set("key", key);
  url.searchParams.set("language", "en");

  const res = await relayFetchJson(url.toString());
  if (res?.ok) return { status: "ok", message: "✓ Key is valid." };

  return classifyCredentialError(res?.error, [403], "✗ Invalid key (rejected by Steam).");
}

/*
@description: Runs a credential check against a status line element, showing
a transient "Checking…" state while the request is in flight.
*/
async function runCheck(statusEl, checkFn, value) {
  if (!statusEl) return;

  statusEl.textContent = "Checking…";
  statusEl.dataset.status = "warn";

  const { status, message } = await checkFn(value);
  statusEl.textContent = message;
  statusEl.dataset.status = status;
}

// The credential fields, by storage key. `name`/`needed` word the
// backpack.tf heading's missing-field tooltip.
const FIELDS = {
  steamApiKey: { inputId: "steam-api-key" },
};

// Which fields each Save button saves, and the status line it reports in.
const SAVE_BUTTONS = [
  { buttonId: "settings-save", statusId: "settings-status", keys: Object.keys(FIELDS) },
  { buttonId: "steam-save", statusId: "steam-save-status", keys: ["steamApiKey"] },
];

export class ApiKeySettings extends SettingsSection {
  async init() {
    this.inputs = {};
    for (const [key, { inputId }] of Object.entries(FIELDS)) {
      const input = this.el(inputId);
      if (input) this.inputs[key] = input;
    }
    if (!this.inputs.steamApiKey) return;

    this.saved = await chrome.storage.local.get(Object.keys(FIELDS));
    // Fields with typing that hasn't been saved: a save made elsewhere
    // doesn't overwrite them.
    this.dirty = new Set();
    for (const [key, input] of Object.entries(this.inputs)) {
      if (this.saved[key]) input.value = this.saved[key];
      input.addEventListener("input", () => this.dirty.add(key));
    }

    this.showSteamKeyIntro();
    this.renderMissingDots();
    this.renderSteamSchemaStatus(Boolean(this.saved.steamApiKey));
    this.bindChecks();
    this.bindSaves();

    this.watchStorage(Object.keys(FIELDS), (changes) => {
      for (const key of Object.keys(FIELDS)) {
        if (!(key in changes)) continue;
        this.saved[key] = changes[key].newValue;
        const input = this.inputs[key];
        if (input && !this.dirty.has(key)) input.value = changes[key].newValue || "";
      }
      this.renderMissingDots();
      if ("steamApiKey" in changes) this.renderSteamSchemaStatus(Boolean(changes.steamApiKey.newValue));
    });
  }

  // Opened from a "needs a Steam Web API key" link button (background.js's
  // OPEN_STEAM_API_KEY_SETTINGS, the settings page at #steam-key): show the
  // intro saying why this tab opened, and land straight on the key field.
  showSteamKeyIntro() {
    const intro = this.el("steam-key-intro");
    this.openedForSteamKey = Boolean(intro) && globalThis.location?.hash === "#steam-key";
    if (!this.openedForSteamKey) return;
    intro.hidden = false;
    const steamDetails = this.el("steam-settings-details");
    if (steamDetails) steamDetails.open = true;
    intro.scrollIntoView?.({ block: "start" });
    this.inputs.steamApiKey?.focus?.({ preventScroll: true });
  }

  // The amber dot on the Steam heading while no key is saved.
  renderMissingDots() {
    const steamDot = this.el("steam-key-missing-dot");
    if (steamDot) steamDot.hidden = Boolean(this.saved.steamApiKey);
  }

  /*
  @description: Shows whether the Steam Web API key is actually working - i.e.
  whether the item schema it's used to fetch has ever successfully loaded -
  rather than just whether something's typed into the field.
  */
  async renderSteamSchemaStatus(hasKey) {
    const statusEl = this.el("steam-schema-status");
    if (!statusEl) return;

    // Imported dynamically (rather than duplicating the literal key/TTL here)
    // so this can never drift out of sync with the cache utils/tf2Schema.js
    // actually reads/writes.
    const { SCHEMA_STORAGE_KEY, SCHEMA_CACHE_TTL_MS } = await import(chrome.runtime.getURL("utils/tf2Schema.js"));

    const stored = await chrome.storage.local.get([SCHEMA_STORAGE_KEY]);
    const cache = stored[SCHEMA_STORAGE_KEY];

    if (cache?.fetchedAt) {
      const ageMs = Date.now() - cache.fetchedAt;
      const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));
      const itemCount = Object.keys(cache.itemNameToDefindex || {}).length;
      const isStale = ageMs > SCHEMA_CACHE_TTL_MS;
      const ageLabel = ageDays === 0 ? "today" : `${ageDays}d ago`;

      statusEl.textContent = isStale
        ? `Item schema loaded ${ageLabel} (${itemCount.toLocaleString()} items); stale, will refresh on next use`
        : `✓ Item schema loaded (${itemCount.toLocaleString()} items, ${ageLabel})`;
      statusEl.dataset.status = isStale ? "warn" : "ok";
    } else if (hasKey) {
      statusEl.textContent = "Key saved. Schema will load the next time a link needs it.";
      statusEl.dataset.status = "warn";
    } else {
      statusEl.textContent = "No key configured. Strangifier/Unusual links won't resolve.";
      statusEl.dataset.status = "off";
    }
  }

  // Checks whatever is currently typed into the fields, not the last-saved
  // value - lets a key/token be tested before hitting Save.
  bindChecks() {
    const steamCheckBtn = this.el("steam-check-btn");
    steamCheckBtn?.addEventListener("click", async () => {
      steamCheckBtn.disabled = true;
      try {
        await runCheck(this.el("steam-key-status"), checkSteamApiKey, this.inputs.steamApiKey?.value.trim());
      } finally {
        steamCheckBtn.disabled = false;
      }
    });
  }

  bindSaves() {
    for (const { buttonId, statusId, keys } of SAVE_BUTTONS) {
      const button = this.el(buttonId);
      if (!button) continue;
      button.addEventListener("click", () => this.save(keys.filter((key) => this.inputs[key]), this.el(statusId)));
    }
  }

  async save(keys, statusEl) {
    const values = Object.fromEntries(keys.map((key) => [key, this.inputs[key].value.trim()]));
    keys.forEach((key) => this.dirty.delete(key));
    await chrome.storage.local.set(values);

    if (statusEl) {
      statusEl.textContent = "Saved";
      setTimeout(() => {
        statusEl.textContent = "";
      }, 2000);
    }

    if (this.openedForSteamKey && values.steamApiKey) {
      // The page that sent the user here picks the key up on its own.
      const heading = this.el("steam-key-intro-heading");
      const text = this.el("steam-key-intro-text");
      if (heading) heading.textContent = "Key saved";
      if (text) text.textContent = "You can close this tab. The posts.tf links update on their own.";
    }
  }
}
