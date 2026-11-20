/**
 * steamcommunity.com profile inventory pages - adds unusual/strange/spell/part/killstreak icon overlays to TF2 items.
 * Registers into the shared script registry built by ../shared.js; executed by ../bootstrap.js.
 */
(function () {
'use strict';

window.__tf2te__.scripts.push(
    {
        includes: [
            // Confirmed live: the trailing slash comes BEFORE the hash on
            // an item link (".../inventory/#440_2_<assetid>", e.g. from a
            // profile's item showcase) - the old "inventory#...?/?" order
            // never matched those, so nothing on this page ran at all.
            /^https?:\/\/steamcommunity\.com\/(?:id|profiles)\/[^\/]+\/inventory\/?(?:#.*)?$/
        ],
        styles: window.__tf2te__.sharedStyles.itemOverlay,
        fn: function main({ WINDOW, shared }) {
            const dom = {
                inventory: document.getElementById('inventories'),
                get: {
                    tf2Inventory: () => {
                        const userSteamId = WINDOW.UserYou.strSteamId;
                        const app440InventoryId = `inventory_${userSteamId}_440_2`;

                        return document.getElementById(app440InventoryId);
                    },
                    items: () => {
                        const inventory = dom.get.tf2Inventory();

                        if (!inventory) {
                            return [];
                        }

                        return Array.from(inventory.querySelectorAll('.item:not(.pendingItem)'));
                    },
                    // The "TEAM FORTRESS 2" logo banner at the very top of
                    // the page - a stable id, and (unlike the filter bar
                    // right below it) not a spot any other extension has
                    // any obvious reason to also target.
                    logoBanner: () => document.getElementById('inventory_logos')
                }
            };

            // Same Keys/Metal tally as the trade offer page's own
            // "Total pure" row (steamcommunity.com/tradeOffer/pages/
            // tradeoffer.js) - built and inserted lazily (once, on first
            // call), then just updated in place on every later
            // onTF2InventoryChange (sorting/filtering/infinite-scroll all
            // mutate the same childList without a full page reload).
            //
            // Placed inside the logo banner (absolutely positioned into its
            // own empty right-hand side), NOT the "Search within listings"
            // filter bar right below it, which was this feature's original
            // location. The logo banner has empty space by design (it's
            // just a background image plus one small logo graphic) and
            // nothing else was seen touching it. A separate, unrelated
            // inventory-enhancing extension claimed that same filter-bar
            // slot first. See #41.
            let pureTotalsEls = null;

            function ensurePureTotalsRow() {
                // Re-checks isConnected (not just "have we built one
                // before") on every call - confirmed live, the row was
                // built and inserted successfully (no error, and this same
                // function's own icon-overlay sibling logic keeps running
                // fine on every later call), yet it was gone from the live
                // DOM. The likely cause: some other script sharing this
                // page - confirmed live to include another inventory
                // extension that heavily restructures this same page (its
                // own toolbar, grouping, sorting) - replaces or rebuilds
                // #inventory_logos at some point after our first insert,
                // taking our row down with the node it was attached to.
                // Once memoized permanently, this function would never look
                // again. Same self-healing approach steamcommunity.com/
                // itemQuickLinks/content.js already uses for its own
                // "Steam's later re-render wiped my insert" case.
                if (pureTotalsEls && pureTotalsEls.row.isConnected) {
                    return pureTotalsEls;
                }

                const logoBanner = dom.get.logoBanner();

                if (!logoBanner) {
                    return null;
                }

                // The banner's own stylesheet position isn't guaranteed -
                // an absolutely-positioned child anchors to the nearest
                // *positioned* ancestor, so without this our row could end
                // up anchored to some unrelated, much larger ancestor
                // instead (and therefore land somewhere else on the page).
                if (getComputedStyle(logoBanner).position === 'static') {
                    logoBanner.style.position = 'relative';
                }

                // A single horizontal line, vertically centered via top:50%/
                // translateY rather than stacked into 3 lines with a fixed
                // top offset - the banner itself is short (confirmed live,
                // ~69px tall) with overflow:hidden, and a 3-line stack plus
                // padding ran taller than that, silently clipped away
                // instead of showing anything at all. A single line fits
                // comfortably regardless of the banner's exact height.
                const row = document.createElement('div');
                row.style.cssText = `
                    position: absolute;
                    top: 50%;
                    right: 16px;
                    transform: translateY(-50%);
                    z-index: 1;
                    display: flex;
                    align-items: baseline;
                    gap: 8px;
                    padding: 4px 10px;
                    border-radius: 4px;
                    border: 1px solid rgba(255, 255, 255, 0.15);
                    background: rgba(0, 0, 0, 0.45);
                    font-size: 12px;
                    color: rgba(255, 255, 255, 0.9);
                    white-space: nowrap;
                `;

                const title = document.createElement('span');
                title.textContent = 'Total pure:';
                title.style.cssText = 'color: #fff; font-weight: bold;';

                const keysLine = document.createElement('span');
                keysLine.textContent = 'Keys: …';

                const metalLine = document.createElement('span');
                metalLine.textContent = 'Metal: … ref';

                const statusLine = document.createElement('span');
                statusLine.style.cssText = 'color: rgba(255, 255, 255, 0.6); font-style: italic;';

                row.append(title, keysLine, metalLine, statusLine);
                logoBanner.appendChild(row);

                pureTotalsEls = { row, keysLine, metalLine, statusLine };

                if (!visibilityObserver) {
                    // Steam hides an inactive game's inventory container
                    // via its style when switching games.
                    visibilityObserver = new MutationObserver(syncPureTotalsVisibility);
                    visibilityObserver.observe(dom.inventory, {
                        childList: true,
                        subtree: true,
                        attributes: true,
                        attributeFilter: ['style']
                    });
                }

                return pureTotalsEls;
            }

            let visibilityObserver = null;

            // Only while TF2's own inventory is the one showing - the logo
            // banner this sits in is shared by every game's inventory, and
            // Steam keeps each one it has loaded in #inventories, just
            // hiding the inactive ones. Which game Steam opens first (the
            // last one viewed) doesn't matter this way.
            function syncPureTotalsVisibility() {
                if (!pureTotalsEls) {
                    return;
                }

                const tf2Inventory = dom.get.tf2Inventory();
                const tf2Shown = Boolean(tf2Inventory && tf2Inventory.style.display !== 'none');

                pureTotalsEls.row.style.display = tf2Shown ? 'flex' : 'none';
            }

            function updatePureTotals(assets) {
                const els = ensurePureTotalsRow();

                if (!els) {
                    return;
                }

                const { METAL_SCRAP_VALUES } = shared.offers;
                let keys = 0;
                let scrap = 0;

                for (const assetid in assets) {
                    const item = assets[assetid].description;

                    if (!item) {
                        continue;
                    }

                    const name = item.market_hash_name;
                    // Keys/metal aren't stackable in a TF2 inventory (each
                    // is its own asset), but reading `amount` instead of
                    // assuming 1 costs nothing and keeps this correct if
                    // that ever changes.
                    const count = parseInt(assets[assetid].amount, 10) || 1;

                    if (name === 'Mann Co. Supply Crate Key') {
                        keys += count;
                    } else if (Object.prototype.hasOwnProperty.call(METAL_SCRAP_VALUES, name)) {
                        scrap += METAL_SCRAP_VALUES[name] * count;
                    }
                }

                // Confirmed live: a large backpack loads in chunks, so a
                // running tally read as a real (wrong) total - 75 keys
                // that later became 1174. Totals only once loading is done.
                const { loaded, total, done } = getTF2LoadProgress();

                if (!loadSettled && done !== true) {
                    els.keysLine.textContent = 'Keys: …';
                    els.metalLine.textContent = 'Metal: … ref';
                    els.statusLine.textContent = total
                        ? `Loading ${loaded.toLocaleString()} / ${total.toLocaleString()} items…`
                        : 'Loading…';
                } else {
                    els.keysLine.textContent = `Keys: ${keys}`;
                    els.metalLine.textContent = `Metal: ${(scrap / 9).toFixed(2)} ref`;
                    els.statusLine.textContent = '';
                }

                syncPureTotalsVisibility();
            }

            // Steam's own TF2 inventory context entry (null if TF2 isn't
            // in this account's contexts at all).
            function getTF2Context() {
                return (
                    WINDOW.g_rgAppContextData &&
                    WINDOW.g_rgAppContextData[440] &&
                    WINDOW.g_rgAppContextData[440].rgContexts &&
                    WINDOW.g_rgAppContextData[440].rgContexts[2]
                ) || null;
            }

            // Reads the raw TF2 inventory object straight from Steam's own
            // data model (null if it isn't there).
            function getTF2InventoryData() {
                const context = getTF2Context();

                return (context && context.inventory) || null;
            }

            // Whether Steam has finished loading the TF2 inventory, from
            // whichever signal its data model exposes: the inventory's own
            // m_bFullyLoaded flag, else the context's asset_count (the
            // count on the game's tab) against the assets loaded so far.
            // done is null when neither is available - pollInventoryLoading
            // then falls back to "the count stopped changing".
            function getTF2LoadProgress() {
                const context = getTF2Context();
                const inventory = context && context.inventory;
                const loaded = inventory && inventory.m_rgAssets ? Object.keys(inventory.m_rgAssets).length : 0;
                const total = (context && Number(context.asset_count)) || null;
                let done = null;

                if (inventory && typeof inventory.m_bFullyLoaded === 'boolean') {
                    done = inventory.m_bFullyLoaded;
                } else if (total) {
                    done = loaded >= total;
                }

                return { loaded, total, done };
            }

            // Set once pollInventoryLoading has given up waiting, or
            // decided loading is over without a signal from Steam.
            let loadSettled = false;

            // On a non-English page the tiles are marked from the inventory's
            // English descriptions (see shared.english - the page's own are
            // translated, so no effect/killstreak/spell is recognized).
            // undefined until they've loaded; null on an English page, or if
            // Steam didn't answer (the page's own descriptions are used then).
            let englishDescriptions = shared.english.isEnglishPage() ? null : undefined;
            let englishRequested = false;

            function loadEnglishDescriptions() {
                if (englishRequested) return;
                englishRequested = true;
                shared.english.getInventoryDescriptions(WINDOW.UserYou.strSteamId, 440, 2).then((byAsset) => {
                    englishDescriptions = byAsset;
                    onTF2InventoryChange();
                });
            }

            // tf2 inventory has changed
            function onTF2InventoryChange() {
                function getAssetId(itemEl) {
                    const [ , , assetid] = itemEl.id.split('_');

                    return assetid;
                }

                // tf2 assets
                const inventory = getTF2InventoryData();

                // no tf2 inventory in contexts
                if (!inventory) {
                    // stop
                    return;
                }

                const {
                    addAttributes
                } = shared.offers.identifiers;
                const assets = inventory.m_rgAssets;

                // A tile is only ever marked once (addAttributesToElement's
                // data-checked guard), so none are marked until the English
                // descriptions are in.
                if (englishDescriptions === undefined) {
                    loadEnglishDescriptions();
                } else {
                    dom.get.items().forEach((itemEl) => {
                        const assetid = getAssetId(itemEl);
                        // item is stored in description of asset - its English
                        // one when there is (an item newer than that fetch
                        // just keeps the page's own)
                        const item = (englishDescriptions && englishDescriptions.get(assetid)) || assets[assetid].description;

                        // add the attributes to this item
                        addAttributes(item, itemEl);
                    });
                }

                updatePureTotals(assets);
            }
            
            // A large TF2 backpack loads progressively (Steam's own
            // pagination) - the "Total pure" count came out lower than the
            // trade offer page's own count for the same account, i.e. this
            // only ever saw whatever had loaded by the time the mutation
            // observer below first fired, not the whole inventory. Rather
            // than rely on a DOM mutation firing for every later page that
            // lands, this re-checks the asset count directly
            // against Steam's own data model on a short timer until Steam
            // reports it fully loaded (see getTF2LoadProgress) - or, with
            // no such signal, until two consecutive checks agree - or a
            // fixed number of attempts is used up. Each check is cheap
            // (onTF2InventoryChange's own addAttributes is a no-op past its
            // first pass via the data-checked guard, and updatePureTotals
            // is a plain object scan).
            function pollInventoryLoading(attempt, previousCount) {
                const POLL_MS = 1000;
                const MAX_ATTEMPTS = 120;
                const { loaded, done } = getTF2LoadProgress();
                const settled = Boolean(
                    done === true ||
                    (done === null && loaded === previousCount) ||
                    attempt >= MAX_ATTEMPTS
                );

                if (settled) {
                    loadSettled = true;
                }

                onTF2InventoryChange();

                if (settled) {
                    return;
                }

                setTimeout(() => pollInventoryLoading(attempt + 1, loaded), POLL_MS);
            }

            // a tf2 inventory was loaded on the page
            function onTF2Inventory(tf2Inventory) {
                const observer = new MutationObserver(onTF2InventoryChange);

                // observe changes to the tf2 inventory - subtree included
                // since a later-loaded page of items isn't guaranteed to
                // land as a direct child of this container.
                observer.observe(tf2Inventory, {
                    childList: true,
                    subtree: true
                });

                onTF2InventoryChange();
                pollInventoryLoading(0, -1);
            }
            
            // observe changes to dom
            {
                const inventoryEl = dom.inventory;
                // wait for the tf2 inventory to be loaded
                const observer = new MutationObserver(() => {
                    const tf2Inventory = dom.get.tf2Inventory();
                    const tf2InventoryVisible = Boolean(
                        tf2Inventory &&
                        tf2Inventory.style.display !== 'none'
                    );
                    const itemsList = dom.get.items();
                    
                    // make sure the inventory is visible and it contains visible items
                    if (tf2InventoryVisible && itemsList.length > 0) {
                        // disconnect the observer
                        observer.disconnect();
                        onTF2Inventory(tf2Inventory);
                    }
                });
                
                observer.observe(inventoryEl, {
                    childList: true,
                    subtree: true
                });
            }
        }
    },

);

}());
