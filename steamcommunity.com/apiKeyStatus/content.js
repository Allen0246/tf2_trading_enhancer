/*
@description: Shows whether TF2 Trading Enhancer currently has a working
Steam Web API key, next to Steam's own "Revoke My Steam Web API Key" form,
and warns when the key on the page is not the one the extension saved.
*/
async function routeApiKeyStatus() {
  const { createScriptRegistry } = await import(chrome.runtime.getURL("utils/scriptRouter.js"));
  const { SCHEMA_STORAGE_KEY } = await import(chrome.runtime.getURL("utils/tf2Schema.js"));

  const registry = createScriptRegistry();
  registry.listen();

  function findRevokeForm() {
    // #editForm is the "Revoke My Steam Web API Key" form - a stable id,
    // unlike the revoke control itself (an <input type="submit">, so its
    // value/label isn't reliably queryable the way button text would be).
    return document.getElementById("editForm");
  }

  /*
  @description: The key Steam shows on this page ("Key: <32 hex chars>"), or
  null when the account has none or the page layout isn't recognized.
  */
  function readPageKey() {
    const container = document.getElementById("bodyContents_ex") || document.body;
    const match = (container?.textContent || "").match(/\bKey:\s*([0-9A-F]{32})\b/i);
    return match ? match[1].toUpperCase() : null;
  }

  /*
  @description: Picks the note to show. The page's key is compared with the
  saved one because of the API key scam: a scammer who registers a key on a
  victim's account can watch and swap their trade offers, so this page must
  never vouch for a key the extension isn't actually using.
  */
  function describeKeyStatus(pageKey, savedKey, cache) {
    const savedMatchesPage = Boolean(pageKey && savedKey && savedKey.trim().toUpperCase() === pageKey);

    if (pageKey && savedKey && !savedMatchesPage) {
      return {
        message:
          "Warning: this is NOT the key saved in TF2 Trading Enhancer. If you didn't register this key yourself, " +
          "revoke it now: scammers use an API key on your account to watch and swap your trade offers.",
        color: "#ff5c5c",
      };
    }

    if (!savedKey) {
      const revokeHint = pageKey ? " If you didn't register this key yourself, revoke it now." : "";
      return {
        message: `TF2 Trading Enhancer: no key saved yet. Paste this key into the extension's popup settings to enable Strangifier/Unusual links.${revokeHint}`,
        color: "#c96260",
      };
    }

    // Saved key matches the page, or the page shows no key to compare with
    // (then the note talks about "a saved key", never "this key").
    const subject = savedMatchesPage ? "this key" : "a saved key";

    if (cache?.fetchedAt) {
      const itemCount = Object.keys(cache.itemNameToDefindex || {}).length;
      return {
        message: `TF2 Trading Enhancer is using ${subject} (item schema loaded, ${itemCount.toLocaleString()} items).`,
        color: "#4caf82",
      };
    }

    return {
      message: `TF2 Trading Enhancer has ${savedMatchesPage ? "this key saved" : "a key saved"}. Its item schema will load the next time it's needed.`,
      color: "#d0a04a",
    };
  }

  async function showApiKeyStatus() {
    const stored = await chrome.storage.local.get(["steamApiKey", SCHEMA_STORAGE_KEY]);
    const { message, color } = describeKeyStatus(readPageKey(), stored.steamApiKey, stored[SCHEMA_STORAGE_KEY]);

    const note = document.createElement("p");
    note.textContent = message;
    note.style.cssText = `color: ${color}; font-weight: bold; margin-top: 8px;`;

    const revokeForm = findRevokeForm();
    if (revokeForm) {
      revokeForm.insertAdjacentElement("afterend", note);
    } else {
      // Couldn't find the form (page markup changed?) - fall back to a
      // floating corner banner so the status is still visible somewhere.
      note.style.cssText += `
        position: fixed;
        left: 12px;
        bottom: 12px;
        z-index: 2147483647;
        max-width: 320px;
        padding: 10px 12px;
        border-radius: 10px;
        background: #201c1a;
        border: 1px solid #2a2a2a;
        box-shadow: 0 8px 20px rgba(0,0,0,.35);
        font: 12px/1.4 system-ui, Segoe UI, Roboto, Helvetica, Arial;
      `;
      document.documentElement.appendChild(note);
    }
  }

  showApiKeyStatus();
  registry.label("Steam API key status");
  registry.settle();
}
routeApiKeyStatus();

/*
@description: Test-only hook for tests/apiKeyStatus.test.js. A globalThis
assignment rather than `export`, because this file is loaded as a classic
content script, where `export` is a SyntaxError. Lets the tests re-run the
router against fresh fakes without re-importing (see utils/tf2Schema.js's
__resetSchemaCacheForTests for why).
*/
globalThis.__apiKeyStatusTestHooks = { run: routeApiKeyStatus };
