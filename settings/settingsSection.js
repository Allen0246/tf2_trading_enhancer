/*
@description: Base class of the settings sections shared by the toolbar
popup (popup/popup.js) and the settings page (options/options.js). Each
section finds its elements by id, so either page shows it by carrying the
same ids, and sections whose element is missing simply skip that part.

chrome.storage.local is the single source of truth: a section saves there,
and it also re-renders from storage changes, so a change made in the popup
shows up on an open settings page (and the other way round) without either
page knowing about the other.
*/

// Written by openSettingsPage, read by options/options.js: which section
// the settings page should scroll to. A storage key rather than a URL hash,
// because chrome.runtime.openOptionsPage() takes no URL and reuses an open
// settings tab (which then hears the change).
export const SETTINGS_FOCUS_KEY = "settingsPageFocus";

/** Opens (or focuses) the settings page, scrolled to `section`. */
export async function openSettingsPage(section) {
  if (section) await chrome.storage.local.set({ [SETTINGS_FOCUS_KEY]: { section, at: Date.now() } });
  await chrome.runtime.openOptionsPage();
}

export class SettingsSection {
  /** @param {{ page?: "popup" | "options" }} options which page this section lives on */
  constructor({ page = "popup" } = {}) {
    this.page = page;
  }

  el(id) {
    return document.getElementById(id);
  }

  /**
   * Calls `onChange(changes)` for chrome.storage.local changes touching any
   * of `keys` (a list of keys, or a predicate over one key). Returns
   * onChange's result, so tests can await a re-render.
   */
  watchStorage(keys, onChange) {
    const matches = typeof keys === "function" ? keys : (key) => keys.includes(key);
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && Object.keys(changes).some(matches)) return onChange(changes);
    });
  }

  /**
   * A checkbox saved to `key` as soon as it changes, and kept in step with
   * changes made elsewhere. `defaultOn`: a never-saved key reads as checked.
   */
  bindCheckbox(input, key, stored, { defaultOn = false } = {}) {
    if (!input) return;
    const isOn = (value) => (defaultOn ? value !== false : Boolean(value));
    input.checked = isOn(stored[key]);
    input.addEventListener("change", () => {
      chrome.storage.local.set({ [key]: input.checked });
    });
    this.watchStorage([key], (changes) => {
      input.checked = isOn(changes[key].newValue);
    });
  }
}
