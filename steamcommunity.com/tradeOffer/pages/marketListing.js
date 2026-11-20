/**
 * steamcommunity.com Steam Community Market listing pages (/market/listings/440/*).
 * Registers into the shared script registry built by ../shared.js; executed by ../bootstrap.js.
 */
(function () {
'use strict';

// --- Steam's current (React) Market page ---
// It has neither #searchResultsRows nor g_rgAssets. Each listing tile's React
// element still carries its listing: a few component levels above the tile,
// props.listing is the object Steam's QueryListingsForItem returns (confirmed
// live), with the item's full description. An Unusual's effect is read from
// it and shown behind the tile's picture, the way the inventory tiles show it.
//
// A tile's picture is not an <img> but a <div> whose stylesheet draws a
// --bg-image CSS variable holding the item's /economy/image/ address
// (confirmed live). The listing modal's large picture is a real <img>,
// handled by ../../marketListingModal/content.js, so this never touches it.

// The grouped (order-book) layout Steam uses for commodities like Mann Co.
// Supply Crate Key has no listing tiles at all, just "N for sale starting at
// ..." (the line ../../shared/marketListingOrderBook.js tells the two layouts
// apart by, confirmed live). Such a page is left alone: its constant updates
// would only make the tile watcher scan for nothing. Matched on English text
// like that reader; in another language the watcher just finds no tiles.
// Not judged by item name: a Halloween spell can be on any item.
function isGroupedListingPage() {
    return /for\s+sale\s+starting\s+at/i.test((document.body && document.body.textContent) || '');
}

// How far up React's component tree to look for a picture's listing.
const LISTING_SEARCH_DEPTH = 20;
const TILE_PICTURE_SELECTOR = '[style*="--bg-image"]';

// The listing React rendered `el` for, or null.
function findReactListing(el) {
    const fiberKey = Object.keys(el).find((key) => key.startsWith('__reactFiber$'));
    let fiber = fiberKey ? el[fiberKey] : null;
    for (let depth = 0; fiber && depth < LISTING_SEARCH_DEPTH; depth++, fiber = fiber.return) {
        const listing = fiber.memoizedProps && fiber.memoizedProps.listing;
        if (listing && listing.description) return listing;
    }
    return null;
}

// The description's Unusual effect name ("Silver Cyclone"), or null.
function getListingEffectName(description) {
    for (const line of description.descriptions || []) {
        const match = /Unusual Effect:\s*(.+)$/.exec(line.value || '');
        if (match) return match[1].trim();
    }
    return null;
}

/*
@description: Puts the effect as a second background layer under the tile's
item picture (or removes it, for no effect). The item layer keeps Steam's own
size, position and repeat, read with ours removed. It is drawn as
var(--bg-image), so it still follows React if the picture changes.
*/
function setEffectLayer(picture, effectUrl) {
    picture.style.backgroundImage = '';
    picture.style.backgroundSize = '';
    picture.style.backgroundPosition = '';
    picture.style.backgroundRepeat = '';
    if (!effectUrl) return;

    const own = getComputedStyle(picture);
    const itemLayer = own.backgroundImage && own.backgroundImage !== 'none';
    picture.style.backgroundImage = itemLayer ? `var(--bg-image), url('${effectUrl}')` : `url('${effectUrl}')`;
    picture.style.backgroundSize = itemLayer ? `${own.backgroundSize}, contain` : 'contain';
    picture.style.backgroundPosition = itemLayer ? `${own.backgroundPosition}, center` : 'center';
    picture.style.backgroundRepeat = itemLayer ? `${own.backgroundRepeat}, no-repeat` : 'no-repeat';
}

/*
@description: The account's wallet currency, for ../../shared/walletCurrency.js
(read off <html>, so isolated scripts can see it). Steam's current Market page
has no g_rgWalletInfo (confirmed live), but each listing carries the currency
its price is shown in - confirmed live: eCurrency 3 with unPrice + unFee =
21507 on a tile showing "215,07 EUR".
*/
function stampWalletCurrency(listing) {
    const currency = Number(listing.eCurrency);
    const dataset = document.documentElement && document.documentElement.dataset;
    if (!dataset || !Number.isInteger(currency) || currency <= 0) return;
    if (dataset.tf2teWalletCurrency !== String(currency)) dataset.tf2teWalletCurrency = String(currency);
}

/*
@description: Shows each listing tile's Unusual effect behind its picture,
and keeps doing so as tiles appear or change (scrolling, the next page,
sorting). React reuses a tile's elements for another listing, so each picture
remembers which listing it was done for and is redone when that changes.
*/
function showListingTileDetails(shared) {
    const { getEffectValue, getEffectURL } = shared.offers.unusual;

    // On a non-English page the effect is read from each listing's English
    // description (see shared.english - the page's own is translated). By
    // "{classid}_{instanceid}": undefined while loading, null if Steam didn't
    // answer.
    const englishPage = shared.english.isEnglishPage();
    const englishDescriptions = new Map();

    // The description to read the effect from, or undefined while its English
    // one is still loading (rescanned once it arrives).
    function readableDescription(listing) {
        const pageDescription = listing.description;
        if (englishPage || !pageDescription.classid) return pageDescription;

        const instanceid = pageDescription.instanceid || '0';
        const key = `${pageDescription.classid}_${instanceid}`;
        if (!englishDescriptions.has(key)) {
            englishDescriptions.set(key, undefined);
            shared.english.getDescription(pageDescription.appid || 440, pageDescription.classid, instanceid).then((description) => {
                englishDescriptions.set(key, description);
                scheduleScan();
            });
        }
        const english = englishDescriptions.get(key);
        return english === undefined ? undefined : english || pageDescription;
    }

    function showDetails(picture) {
        if (!String(picture.getAttribute('style') || '').includes('/economy/image/')) return;
        const listing = findReactListing(picture);
        if (!listing) return;
        stampWalletCurrency(listing);
        const listingId = String(listing.listingid);
        if (picture.getAttribute('data-tf2te-listing') === listingId) return;
        const description = readableDescription(listing);
        if (description === undefined) return;
        picture.setAttribute('data-tf2te-listing', listingId);

        const effectName = getListingEffectName(description);
        const effectId = effectName && getEffectValue(effectName);
        setEffectLayer(picture, effectId ? getEffectURL(effectId) : null);
    }

    // Until a tile with a listing shows up, the page may still turn out to be
    // the grouped layout (if it rendered after this script ran).
    let layoutConfirmed = false;

    function scan() {
        scanScheduled = false;
        if (!layoutConfirmed) {
            if (isGroupedListingPage()) {
                observer.disconnect();
                return;
            }
            layoutConfirmed = Array.from(document.querySelectorAll(TILE_PICTURE_SELECTOR)).some((el) => findReactListing(el));
        }
        document.querySelectorAll(TILE_PICTURE_SELECTOR).forEach(showDetails);
    }

    // React updates in bursts, so one scan per burst.
    let scanScheduled = false;
    function scheduleScan() {
        if (scanScheduled) return;
        scanScheduled = true;
        setTimeout(scan, 100);
    }

    // characterData too: a reused tile may only change its text (price, level).
    const observer = new MutationObserver(scheduleScan);
    observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
    });
    scan();
}

// --- Item class ids, for the isolated scripts on a non-English page ---
// ../../marketListingLinks and ../../marketListingModal read an item's effect
// (and Sheen/Killstreaker) from its English description there, the page's
// own being translated - but React's data is out of an isolated script's
// reach. So each item title (<h2>) and picture gets its class ids as one
// attribute ("{appid}_{classid}_{instanceid}"), read by
// ../../shared/englishItemDescription.js. Confirmed live: the header
// picture's props carry `description` 8 levels up, its title's `value` 3.
const CLASS_ID_ATTRIBUTE = 'data-tf2te-class';
const CLASS_ID_SEARCH_DEPTH = 12;

function findReactClassIds(el) {
    const fiberKey = Object.keys(el).find((key) => key.startsWith('__reactFiber$'));
    let fiber = fiberKey ? el[fiberKey] : null;
    for (let depth = 0; fiber && depth < CLASS_ID_SEARCH_DEPTH; depth++, fiber = fiber.return) {
        const props = fiber.memoizedProps;
        if (!props || typeof props !== 'object') continue;
        for (const value of Object.values(props)) {
            const description = value && typeof value === 'object' && (value.classid ? value : value.description && value.description.classid ? value.description : null);
            if (description) return `${description.appid || 440}_${description.classid}_${description.instanceid || 0}`;
        }
    }
    return null;
}

function stampItemClassIds() {
    let scanScheduled = false;
    function scan() {
        scanScheduled = false;
        document.querySelectorAll('h2, img[src*="/economy/image/"]').forEach((el) => {
            const ids = findReactClassIds(el);
            if (ids && el.getAttribute(CLASS_ID_ATTRIBUTE) !== ids) el.setAttribute(CLASS_ID_ATTRIBUTE, ids);
        });
    }
    // An attribute change isn't a childList mutation, so this never wakes itself.
    new MutationObserver(() => {
        if (scanScheduled) return;
        scanScheduled = true;
        setTimeout(scan, 50);
    }).observe(document.body, { childList: true, subtree: true });
    scan();
}

window.__tf2te__.scripts.push(
    {
        includes: [
            /^https?:\/\/steamcommunity\.com\/market\/listings\/440\/.*/
        ],
        styles: window.__tf2te__.sharedStyles.itemOverlay,
        fn: function main({ WINDOW, shared }) {
            const dom = {
                resultsRows: document.getElementById('searchResultsRows')
            };

            if (!shared.english.isEnglishPage()) stampItemClassIds();

            // Steam's current Market page (see showListingTileDetails).
            if (!dom.resultsRows) {
                if (!isGroupedListingPage()) showListingTileDetails(shared);
                return;
            }

            // gets the appid, contextid and assetid from an element
            function getItem(rowEl) {
                const buyButtonLinkEl = rowEl.querySelector('div.market_listing_buy_button a');
                
                if (!buyButtonLinkEl) {
                    return null;
                }
                
                const href = buyButtonLinkEl.getAttribute('href');
                const params = href.replace('javascript:BuyMarketListing', '').replace(/[\,\(/) ]/g, '');
                const split = params.split(/'(.+?)'/g).filter(a => a);
                const [ , , appid, contextid, assetid] = split;
                
                return {
                    appid,
                    contextid,
                    assetid
                };
            }
            
            // gets an item's asset
            function getAsset({ appid, contextid, assetid }) {
                const assets = WINDOW.g_rgAssets;
                
                return (
                    assets[appid] &&
                    assets[appid][contextid] &&
                    assets[appid][contextid][assetid]
                );
            }
            
            function addAttributesToResults() {
                const rowsList = dom.resultsRows.getElementsByClassName('market_listing_row');
                const {
                    addAttributes
                } = shared.offers.identifiers;
                
                Array.from(rowsList).forEach((rowEl) => {
                    const item = getItem(rowEl);
                    const asset = (
                        item &&
                        getAsset(item)
                    );
                    
                    if (asset == null) {
                        return;
                    }
                    
                    const itemImgContainerEl = rowEl.querySelector('div.market_listing_item_img_container');
                    const itemImgEl = itemImgContainerEl && itemImgContainerEl.querySelector('img.market_listing_item_img');

                    // Already wrapped by an earlier pass (the wrap below
                    // strips this class off the img), or not an item row
                    if (!itemImgEl) {
                        return;
                    }
                    // we create another element to wrap the image element in for styling purposes
                    const itemEl = (function() {
                        const el = document.createElement('div');
                        const imgSrc = itemImgEl.getAttribute('src');
                        
                        el.classList.add('market_listing_item_img', 'economy_item_hoverable');
                        el.setAttribute('style', itemImgEl.getAttribute('style'));
                        el.style.position = 'relative';
                        el.style.backgroundImage = `url('${imgSrc}')`;
                        
                        return el;
                    }());
                    
                    // remove attributes from the image element
                    itemImgEl.classList.remove('market_listing_item_img');
                    itemImgEl.style.backgroundColor = 'transparent';
                    
                    // add it to our newly created item elment
                    itemEl.appendChild(itemImgEl);
                    
                    // then add it to the container - this effectively wraps the image in another element
                    itemImgContainerEl.appendChild(itemEl);
                    
                    // now add the attributes to this item
                    addAttributes(asset, itemEl);
                });
            }
            
            addAttributesToResults();
            
            {
                const observer = new MutationObserver(addAttributesToResults);
                
                observer.observe(dom.resultsRows, {
                    childList: true
                });
            }
        }
    },

);

}());
