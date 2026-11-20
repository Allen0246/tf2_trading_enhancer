/*
@description: Tells a runtime message sent by one of the extension's own pages
(popup, settings page, background, offscreen document) apart from one sent by
a content script. A content script runs inside a website's process, so a
message handler that should only ever be driven by the extension's own UI
checks this first.

Pure logic with no top-level await or import(), so background.js (a service
worker on Chrome) can import it statically.
*/

/*
@description: Whether `sender` (a runtime.onMessage MessageSender) is one of
the extension's own pages.

The browser fills in sender.url itself: an extension page's is under the
extension's own origin, a content script's is the website's. The settings
page opens in a tab, so sender.tab alone can't tell the two apart. Without a
url, only a sender with no tab counts: a content script always has one.
*/
export function isExtensionPageSender(sender) {
  if (typeof sender?.url === "string") return sender.url.startsWith(chrome.runtime.getURL(""));
  return !sender?.tab;
}
