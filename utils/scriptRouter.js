/*
@description: Shared plumbing for each site's router content script (the
per-site content.js files, plus the standalone steamcommunity.com
apiKeyStatus/tradeHistoryFetch scripts). Each router dynamically imports and
calls one feature module per matching page, then reports which ones loaded
back to popup/popup.js so it can show an "active scripts on this page" list.
*/

// Every router registry on one window, grouped (see createScriptRegistry).
const registryGroupsByWindow = new WeakMap();

function registryGroupForWindow() {
  let group = registryGroupsByWindow.get(window);
  if (!group) {
    group = [];
    registryGroupsByWindow.set(window, group);
  }
  return group;
}

/*
@description: Creates the per-page script registry a router uses:
`label(name)` records that a feature loaded (shown in the popup's
active-scripts list, so use a human-readable name, not a function/variable
name), `settle()` marks that the router has finished deciding/loading every
feature it's going to for this page, and `listen()` wires up the
GET_LOADED_SCRIPTS responder the popup queries. Call `listen()` as soon as the
registry is created - the popup's request can arrive at any time, including
before the router has finished deciding which features to load; call
`settle()` last, once every `label()` call for this page has already
happened (each router's own file has an example).

`settled` (in the info object listen() responds with) exists so
popup/popup.js can tell "this page genuinely has no matching features" apart
from "features are still being dynamically imported" - both otherwise read
identically as an empty scripts array to a query that happens to land in that
window. A router path that never calls settle() at all (e.g. an early return
for an excluded subdomain) just leaves it permanently false, which is fine -
popup/popup.js only uses it for one bounded retry, not to wait indefinitely.

More than one router can run on the same page (steamcommunity.com/content.js
and tradeHistoryFetch/content.js both match /id/{name}/tradehistory and
/inventoryhistory), and the popup only ever receives the FIRST listener's
response. So every registry created for the same window joins one group, and
whichever listener answers reports the whole group: every router's labels,
and settled only once all of them have settled.
*/
export function createScriptRegistry() {
  const site = window.location.hostname;
  const group = registryGroupForWindow();
  const own = { scripts: [], settled: false };
  group.push(own);

  return {
    label(name) {
      own.scripts.push(name);
    },
    settle() {
      own.settled = true;
    },
    listen() {
      chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg.type === "GET_LOADED_SCRIPTS") {
          sendResponse({
            site,
            scripts: group.flatMap((registry) => registry.scripts),
            settled: group.every((registry) => registry.settled),
          });
          return true;
        }
      });
    },
  };
}
