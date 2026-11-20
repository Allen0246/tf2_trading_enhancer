/*
@description: Tells the MAIN-world trade-offer bundle (shared.js and pages/)
the extension's own base URL, which it can't look up itself (no chrome.*
API in the page context). shared.js's getEffectURL needs it to point grid
tiles at the effect images bundled with the extension. Runs at
document_start, before that bundle (document_end), and writes it onto <html>
as data-tf2te-extension-url.
*/
(function () {
  "use strict";
  document.documentElement.dataset.tf2teExtensionUrl = chrome.runtime.getURL("");
})();
