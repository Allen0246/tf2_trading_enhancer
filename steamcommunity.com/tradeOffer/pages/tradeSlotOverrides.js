/**
 * steamcommunity.com single trade offer pages (/tradeoffer/*) - Steam's own
 * trade-slot rendering functions (UpdateSlots/PutItemInSlot/
 * EnsureSufficientTradeSlots/GTradeStateManager.RemoveItemsFromTrade),
 * reimplemented/overridden the same way pages/tradeoffer.js's own header
 * describes for the rest of that file. Split out of pages/tradeoffer.js
 * purely for file size.
 *
 * Exposes window.__tf2te__.installTradeSlotOverrides(page, TRADE_STATUS)
 * rather than running at this file's own top level, since (unlike
 * unusualEffects.js's plain data table) this block is nested inside
 * pages/tradeoffer.js's own main() closure and depends on two of its local
 * variables that don't exist anywhere on window: `page` (this page's own
 * cached jQuery selectors, used here for page.$yourSlots/page.$theirSlots)
 * and `TRADE_STATUS` (main()'s own const TRADE_STATUS = WINDOW.g_rgCurrentTradeStatus
 * snapshot, used here for TRADE_STATUS.me/.them). pages/tradeoffer.js calls
 * this at the end of main(), passing both through explicitly.
 *
 * WINDOW/Utils are re-derived below as one-line equivalents of
 * pages/tradeoffer.js's own main({ WINDOW, Utils, ... }) destructuring
 * (WINDOW is just window itself; Utils is shared.js's own DEPS.Utils,
 * already reachable globally by the time this ever runs) - everything else
 * this block references (UserYou/UserThem/g_rgAppContextData/
 * g_dateEscrowEnd/g_bTradeOffer/HandleTradeActionMenu/Node, etc.) is either a
 * real Steam page global or a web-platform built-in, shared automatically via
 * this bundle's own "world": "MAIN" content script (see manifest.json) - no
 * passing needed for any of those.
 *
 * Steam's own trade offer page loads Prototype.js, whose non-standard
 * extensions to native objects this block relies on throughout without
 * re-stating it at each call site: Element#remove() (returns the removed
 * element itself, unlike the standard DOM Node#remove()'s undefined, used
 * here to remove-and-reattach in one expression - see e.g. elCurItem.rgItem.
 * homeElement.appendChild(elCurItem.remove()) below), Element#down()/#show()
 * (jQuery-like element traversal/visibility helpers), and Array#invoke()
 * (calls a named method on every array element, e.g.
 * rgElementsToRemove.invoke('remove')). None of these exist on plain
 * arrays/elements otherwise - a future reader unfamiliar with Prototype.js
 * could easily mistake one of these for a typo.
 */
(function () {
'use strict';

window.__tf2te__.installTradeSlotOverrides = function (page, TRADE_STATUS) {
    const WINDOW = window;
    const Utils = window.__tf2te__.DEPS.Utils;

    // hides an element
    function hideElement(el) {
        el.style.display = 'none';
    }
    
    // shows an element
    function showElement(el) {
        el.style.display = '';
    }
    
    // Steam's own UpdateSlots, kept logically the same but with cheaper DOM
    // access (cached child lists, querySelector instead of per-slot Prototype
    // lookups), since the original gets very slow with many items.
    WINDOW.UpdateSlots = function( rgSlotItems, rgCurrency, bYourSlots, user, version ) {
        const { $ } = WINDOW;
        const slotContainerEl = bYourSlots ? document.getElementById('your_slots') : document.getElementById('their_slots');
        const elCurrencySlotContainer = bYourSlots ? $('your_slots_currency') : $('their_slots_currency');
        
        // see what the last slot with an item is
        let cMaxSlotId = 0;
        
        if ( rgSlotItems instanceof Array ) {
            cMaxSlotId = rgSlotItems.length;
        } else {
            for ( let slotid in rgSlotItems ) {
                let iSlot = parseInt( slotid );
                
                if ( iSlot && !isNaN( iSlot ) ) {
                    cMaxSlotId = Math.max( iSlot, cMaxSlotId );
                }
            }
            
            cMaxSlotId++;
        }
        
        let cCurrenciesInTrade = 0;
        
        for ( let iCurrency = 0; iCurrency < rgCurrency.length; iCurrency++ ) {
            const currencyUpdate = rgCurrency[iCurrency];
            // just skip pending inventories, the currency will be drawn after the inventory arrival
            const inventory = user.getInventory( currencyUpdate.appid, currencyUpdate.contextid );
            
            if ( !inventory || inventory.BIsPendingInventory() ) {
                continue;
            }
            
            cCurrenciesInTrade++;
            
            const currency = user.FindCurrency( currencyUpdate.appid, currencyUpdate.contextid, currencyUpdate.currencyid );
            const stack = WINDOW.GetTradeItemStack( user, currency );
            
            if ( ( parseInt( stack.amount ) + parseInt( stack.fee ) ) != currencyUpdate.amount ) {
                WINDOW.UpdateTradeItemStackDisplay( currency, stack, currencyUpdate.amount );
                
                if ( !bYourSlots && !WINDOW.g_bTradeOffer ) {
                    WINDOW.HighlightNewlyAddedItem( stack.element );
                }
            }
            
            stack.version = version;
        }
        
        // A static copy: .children is live, so removing a slot inside the
        // loop below would shift the next one into the current index and
        // skip it.
        const rgCurrencySlots = Array.from( elCurrencySlotContainer.children );
        
        if ( cCurrenciesInTrade < rgCurrencySlots.length ) {
            // there's an extra slot in the trade, remove it
            for ( let iCurrencySlot = 0; iCurrencySlot < rgCurrencySlots.length; iCurrencySlot++ ) {
                const elSlot = rgCurrencySlots[iCurrencySlot];
                const stack = elSlot.stack;
                
                if ( stack.version < version ) {
                    elSlot.remove();
                    
                    const origCurrency = user.FindCurrency( stack.appid, stack.contextid, stack.id );
                    
                    origCurrency.amount = origCurrency.original_amount;
                    origCurrency.trade_stack = null;
                    
                    if ( bYourSlots ) {
                        WINDOW.UpdateCurrencyDisplay( origCurrency );
                    }
                }
            }
        }
        
        WINDOW.EnsureSufficientTradeSlots( bYourSlots, cMaxSlotId, cCurrenciesInTrade );
        
        let nNumBadItems = 0;
        let firstBadItem = null;
        let nNumExpiringItems = 0;
        let firstExpiringItem = null;
        let nFullInventoryAppId = false;
        
        const slotsList = slotContainerEl.children;
        
        // this is where the majority of the time is spent
        for ( let slot = 0; slot < slotsList.length; slot++ ) {
            // simply taking from an array rather than querying each slot cuts the time by about 1/3
            const elSlot = slotsList[slot];
            // elCurItem.rgItem is available using querySelector
            const elCurItem = elSlot.querySelector('.item');
            let elNewItem = null;
            let bRemoveCurItem = elCurItem != null;
            // lets us know if we need to indicate this item was added
            let bItemIsNewToTrade = false; 
            // if a stackable item's amount has changed, we also treat that like new
            let bStackAmountChanged = false;
            
            if ( rgSlotItems[slot] ) {
                const {
                    appid,
                    contextid,
                    assetid,
                    amount
                } = rgSlotItems[slot];
                
                // check that we are allowed to receive this item
                if ( !bYourSlots ) {
                    if ( !UserYou.BAllowedToRecieveItems( appid, contextid ) ) {
                        if ( !nFullInventoryAppId && UserYou.BInventoryIsFull( appid, contextid ) ) {
                            nFullInventoryAppId = appid;
                        }
                        
                        if ( nNumBadItems == 0 ) {
                            firstBadItem = rgSlotItems[slot];
                        }
                        
                        nNumBadItems++;
                    }
                }
                
                // this doesn't do any DOM querying
                const elItem = user.findAssetElement( appid, contextid, assetid );
                
                if (
                    g_dateEscrowEnd != null &&
                    elItem.rgItem &&
                    typeof elItem.rgItem.item_expiration == 'string'
                ) {
                    const dateExpiration = new Date( elItem.rgItem.item_expiration );
                    
                    if ( g_dateEscrowEnd >= dateExpiration ) {
                        if ( nNumExpiringItems == 0 ) {
                            firstExpiringItem = rgSlotItems[slot];
                        }
                        
                        nNumExpiringItems++;
                    }
                }
                
                if (
                    elCurItem &&
                    elCurItem.rgItem &&
                    elCurItem.rgItem.appid == appid &&
                    elCurItem.rgItem.contextid == contextid &&
                    elCurItem.rgItem.id == assetid &&
                    !elCurItem.rgItem.unknown
                ) {
                    // it's already there
                    bRemoveCurItem = false;
                    
                    if ( elCurItem.rgItem.is_stackable ) {
                        const stack = elCurItem.rgItem;
                        
                        bStackAmountChanged = ( amount != stack.amount );
                        WINDOW.UpdateTradeItemStackDisplay( stack.parent_item, stack, amount );
                    }
                } else {
                    // it's new to the trade
                    elNewItem = elItem;
                    
                    const item = elNewItem.rgItem;
                    
                    if ( !item.unknown ) {
                        bItemIsNewToTrade = true;
                    }
                    
                    if ( item.is_stackable ) {
                        const stack = WINDOW.GetTradeItemStack( user, item );
                        
                        bStackAmountChanged = ( amount != stack.amount );
                        WINDOW.UpdateTradeItemStackDisplay( item, stack, amount );
                        
                        elNewItem = stack.element;
                    }
                    
                    if ( elNewItem && elNewItem.parentNode ) {
                        const slotActionMenuButtonEl = elNewItem.parentNode.querySelector('.slot_actionmenu_button');
                        
                        if ( slotActionMenuButtonEl ) {
                            // hide the button
                            // on steam's end this would normally be called with .hide()
                            // but that's not available with vanilla methods
                            hideElement(slotActionMenuButtonEl);
                        }
                        
                        if ( WINDOW.BIsInTradeSlot( elNewItem ) ) {
                            // this is called when a slot is cleared
                            // all subsequent slots are also cleared to move items up 
                            WINDOW.CleanupSlot( elNewItem.parentNode.parentNode );
                            bItemIsNewToTrade = false;
                        }
                        
                        // remove element from its current location
                        elNewItem.remove();
                    }
                }
            }
            
            if ( elCurItem && bRemoveCurItem ) {
                if ( elCurItem.rgItem && elCurItem.rgItem.is_stackable ) {
                    const stack = elCurItem.rgItem;
                    
                    WINDOW.UpdateTradeItemStackDisplay( stack.parent_item, stack, 0 );
                    elCurItem.remove();
                } else if ( elCurItem.rgItem && elCurItem.rgItem.homeElement ) {
                    elCurItem.rgItem.homeElement.appendChild( elCurItem.remove() );
                } else {
                    elCurItem.remove();
                }
                
                WINDOW.CleanupSlot( elSlot );
            }
            
            if ( elNewItem ) {
                // this is called when an item is added to a slot
                WINDOW.PutItemInSlot( elNewItem, elSlot );
                
                if ( bItemIsNewToTrade && !bYourSlots && !WINDOW.g_bTradeOffer ) {
                    WINDOW.HighlightNewlyAddedItem( elNewItem );
                }
            } else if ( bStackAmountChanged && !bYourSlots && !WINDOW.g_bTradeOffer ) {
                WINDOW.HighlightNewlyAddedItem( elCurItem );
            }
        }
        
        if (
            !bYourSlots &&
            nNumBadItems != g_nItemsFromContextWithNoPermissionToReceive &&
            !UserThem.BIsLoadingInventoryData()
        )  {
            g_nItemsFromContextWithNoPermissionToReceive = nNumBadItems;
            
            if ( nNumBadItems > 0 ) {
                let strEvent = "";
                const item = user.findAsset( firstBadItem.appid, firstBadItem.contextid, firstBadItem.assetid );
                
                if ( item ) {
                    // escapeHTML is Prototype.js's String extension, so it is
                    // feature-checked rather than assumed present
                    const name = item.name.escapeHTML ? item.name.escapeHTML() : item.name;
                    
                    if ( nNumBadItems == 1 ) {
                        strEvent = 'You are not allowed to receive the item "%1$s."'
                            .replace( '%1$s', name );
                    } else {
                        strEvent = 'You are not allowed to receive %1$s of the items being offered including "%2$s."'
                            .replace( '%1$s', nNumBadItems )
                            .replace( '%2$s', name );
                    }
                } else {
                    if ( nNumBadItems == 1 ) {
                        strEvent = 'You are not allowed to receive one of the items being offered.';
                    } else {
                        strEvent = 'You are not allowed to receive %1$s of the items being offered.'
                            .replace( '%1$s', nNumBadItems );
                    }
                }
                
                if ( nFullInventoryAppId ) {
                    // rgAppData must be declared (and looked up from
                    // g_rgAppContextData) before it's read on the line below -
                    // reading it first throws "Cannot access 'rgAppData' before
                    // initialization" (TDZ) whenever the receiving user's
                    // inventory for nFullInventoryAppId is full, breaking the rest
                    // of this WINDOW.UpdateSlots override for that update.
                    const rgAppData = g_rgAppContextData[nFullInventoryAppId];
                    const name = rgAppData.name.escapeHTML ? rgAppData.name.escapeHTML() : rgAppData.name;
                    const strEventAppend = 'Your inventory for %1$s is full.'
                        .replace( '%1$s', name );
                    
                    strEvent = strEvent + ' ' + strEventAppend;
                }
                
                const elEvent = new WINDOW.Element( 'div', {'class': 'logevent' } );
                elEvent.update( strEvent );
                $('log').appendChild( elEvent );
            }
        }
        
        if ( nNumExpiringItems != WINDOW.g_rgnItemsExpiringBeforeEscrow[bYourSlots ? 0 : 1] ) {
            WINDOW.g_rgnItemsExpiringBeforeEscrow[bYourSlots ? 0 : 1] = nNumExpiringItems;
            
            if ( nNumExpiringItems > 0 ) {
                let strEvent = "";
                const item = user.findAsset( firstExpiringItem.appid, firstExpiringItem.contextid, firstExpiringItem.assetid );
                
                if ( item ) {
                    const name = item.name.escapeHTML ? item.name.escapeHTML() : item.name;
                    
                    if ( nNumExpiringItems == 1 ) {
                        strEvent = 'The item "%1$s" cannot be included in this trade because it will expire before the trade hold period is over.'
                            .replace( '%1$s', name );
                    } else {
                        strEvent = 'Some items, including "%1$s," cannot be included in this trade because they will expire before the trade hold period is over.'
                            .replace( '%1$s', name );
                    }
                } else {
                    if ( nNumExpiringItems == 1 ) {
                        strEvent = 'One item cannot be included in this trade because it will expire before the trade hold period is over.';
                    } else {
                        strEvent = 'Some items cannot be included in this trade because they will expire before the trade hold period is over.';
                    }
                }
                
                const elEvent = new WINDOW.Element( 'div', {'class': 'logevent' } );
                elEvent.update( strEvent );
                $('log').appendChild( elEvent );
            }
        }
    };
    
    // One of the hottest functions in UpdateSlots - reimplemented here with
    // cheaper DOM queries than Steam's own version.
    WINDOW.PutItemInSlot = function( elItem, elSlot ) {
        const item = elItem.rgItem;
        
        if (
            elItem.parentNode &&
            elItem.parentNode.nodeType != Node.DOCUMENT_FRAGMENT_NODE /* IE cruft */
        ) {
            hideElement(elItem.parentNode.querySelector('.slot_actionmenu_button'));
            elItem.remove();
        }
        
        elSlot.querySelector('.slot_inner').appendChild( elItem );
        
        if ( item && item.appid && WINDOW.g_rgAppContextData[item.appid] ) {
            const rgAppData = WINDOW.g_rgAppContextData[item.appid];
            const slotAppLogo = elSlot.querySelector('.slot_applogo');
            
            slotAppLogo.querySelector('img').src = rgAppData.icon;
            showElement(slotAppLogo);
            
            if (
                typeof(WINDOW.g_rgPlayedApps) != 'undefined' &&
                WINDOW.g_rgPlayedApps !== false &&
                !WINDOW.g_rgPlayedApps[item.appid]
            )  {
                const strWarning = 'You\'ve never played the game this item is from.';
                
                if ( !item.fraudwarnings ) {
                    item.fraudwarnings = [ strWarning ];
                } else {
                    // Don't push the NoPlaytime warning over and over.
                    if ( item.fraudwarnings.indexOf( strWarning ) == -1 ) {
                        item.fraudwarnings.push( strWarning );
                    }
                }
            }
            
            if ( item.id && item.fraudwarnings ) {
                showElement(elSlot.querySelector('.slot_app_fraudwarning'));
            } else  {
                hideElement(elSlot.querySelector('.slot_app_fraudwarning'));
            }
        } else {
            hideElement(elSlot.querySelector('.slot_applogo'));
            hideElement(elSlot.querySelector('.slot_app_fraudwarning'));
        }
        
        const elActionMenuButton = elSlot.querySelector('.slot_actionmenu_button');
        
        showElement(elActionMenuButton);

        // Slot elements are reused for whichever item lands in them next, so
        // the handler from this button's previous item is removed first.
        // Otherwise every item that ever sat in this slot keeps its own
        // listener, and one click opens the action menu once per stale item.
        if ( elActionMenuButton.tf2teActionMenuHandler ) {
            elActionMenuButton.removeEventListener('click', elActionMenuButton.tf2teActionMenuHandler);
        }

        const actionMenuHandler = () => {
            HandleTradeActionMenu( elActionMenuButton, item, item.is_their_item ? UserThem : UserYou );
        };

        elActionMenuButton.tf2teActionMenuHandler = actionMenuHandler;
        elActionMenuButton.addEventListener('click', actionMenuHandler);
        
        elSlot.classList.add('has_item');
        elSlot.hasItem = true;
    };
    
    // basically removes animation due to bugginess
    // also it's a bit faster
    WINDOW.EnsureSufficientTradeSlots = function(bYourSlots, cSlotsInUse, cCurrencySlotsInUse) {
        // stand-alone function to create a slot element
        function createTradeSlotElement(bIsYourSlot, iSlot) {
            const id = bIsYourSlot ? 'your_slot_' + iSlot : 'their_slot_' + iSlot;
            const elSlot = WINDOW.CreateSlotElement( id );
            
            elSlot.iSlot = iSlot;
            
            return elSlot;
        }
        
        const getDesiredSlots = () => {
            const useResponsiveLayout = WINDOW.Economy_UseResponsiveLayout();
            const cTotalSlotsInUse = cSlotsInUse + cCurrencySlotsInUse;
            
            if (useResponsiveLayout) {
                return cTotalSlotsInUse + 1;
            }
            
            return Math.max(Math.floor((cTotalSlotsInUse + 5) / 4) * 4, 8);
        };
        const $slots = bYourSlots ? page.$yourSlots : page.$theirSlots;
        const elSlotContainer = $slots[0];
        const cDesiredSlots = getDesiredSlots();
        const cDesiredItemSlots = cDesiredSlots - cCurrencySlotsInUse;
        const cCurrentItemSlots = elSlotContainer.childElementCount;
        const cCurrentSlots = cCurrentItemSlots + cCurrencySlotsInUse;
        const bElementsChanged = cDesiredSlots !== cCurrentSlots;
        const rgElementsToRemove = [];
        
        if (cDesiredSlots > cCurrentSlots) {
            // Adding the elements to a fragment before appending to the DOM is much faster
            const fragment = document.createDocumentFragment();
            
            for (let i = cCurrentItemSlots; i < cDesiredItemSlots; i++) {
                fragment.appendChild(createTradeSlotElement(bYourSlots, i));
            }
            
            elSlotContainer.appendChild(fragment);
        } else if (cDesiredSlots < cCurrentSlots) {
            // going to compact
            const prefix = bYourSlots ? 'your_slot_' : 'their_slot_';
            const $parent = $slots.parent();
            
            for (let i = cDesiredItemSlots; i < cCurrentItemSlots; i++) {
                const element = $slots.find('#' + prefix + i)[0];
                
                element.id = '';
                $parent.append(element.remove());
                rgElementsToRemove.push(element);
            }
        }
        
        if (bElementsChanged && rgElementsToRemove.length > 0) {
            rgElementsToRemove.invoke('remove');
        }
    };
    
    // remove multiple items from a trade offer at once
    // pretty much removes all items INSTANTLY
    function removeItemsFromTrade(items) {
        function checkItems(items, isYou) {
            if (items.length === 0) {
                return false;
            }
            
            function getGroups(rgItems) {
                const groupBy = Utils.groupBy;
                const grouped = groupBy(rgItems, 'appid');
                
                for (let appid in grouped) {
                    grouped[appid] = groupBy(grouped[appid], 'contextid');
                    
                    for (let contextid in grouped[appid]) {
                        grouped[appid][contextid] = groupBy(grouped[appid][contextid], 'id');
                    }
                }
                
                return grouped;
            }
            
            // iterate over dom elements and collect rgItems from items
            function iterItems(items) {
                let rgItems = [];
                const revertItem = WINDOW.RevertItem;
                const isInTradeSlot = WINDOW.BIsInTradeSlot;
                const cleanSlot = WINDOW.CleanupSlot;
                const setStackItemInTrade = WINDOW.SetStackableItemInTrade;
                
                // this is done in reverse
                for (let i = items.length - 1; i >= 0; i--) {
                    const elItem = items[i];
                    const item = elItem.rgItem;
                    
                    if (isInTradeSlot(elItem)) {
                        cleanSlot(elItem.parentNode.parentNode);
                    }
                    
                    if (item.is_stackable) {
                        // stackable items are fully removed by this call
                        setStackItemInTrade(item, 0);
                        continue;
                    }
                    
                    revertItem(item);
                    item.homeElement.down('.slot_actionmenu_button').show();
                    rgItems.push(item);
                }
                
                return rgItems;
            }
            
            // iterate assets in slots
            function iterAssets(rgItems) {
                if (rgItems.length === 0) {
                    return false;
                }
                
                const getItem = ({ appid, contextid, assetid }) => {
                    return (
                        groups[appid] &&
                        groups[appid][contextid] &&
                        groups[appid][contextid][assetid]
                    );
                };
                const slots = isYou ? TRADE_STATUS.me : TRADE_STATUS.them;
                const groups = getGroups(rgItems);
                let assets = slots.assets;
                let bChanged;
                
                for (let i = assets.length - 1; i >= 0; i--) {
                    const asset = assets[i];
                    const item = getItem(asset);
                    
                    if (item) {
                        bChanged = true;
                        assets.splice(i, 1);
                    }
                }
                
                return bChanged;
            }
            
            // return true if any assets were removed from trade
            return iterAssets(iterItems(items));
        }
        
        const manager = WINDOW.GTradeStateManager;
        const [yours, theirs] = Utils.partition(items, (elItem) => {
            return !elItem.rgItem.is_their_item;
        });
        const hasChanged = [
            checkItems(yours, true),
            checkItems(theirs, false)
        ].some(Boolean);
        
        if (hasChanged) {
            manager.m_bChangesMade = true;
            manager.UpdateTradeStatus();
        }
    }

    // Exposed on window.__tf2te__ (this extension's own namespace, which
    // Steam never touches) rather than relied on as a patched
    // GTradeStateManager.RemoveItemsFromTrade: a one-time assignment onto
    // that Steam-owned object was confirmed live to stop working some time
    // after page load ("...is not a function" from "Clear my items"), and
    // it cannot be re-patched via an accessor because Steam declares it as a
    // non-configurable top-level global. pages/tradeoffer.js's callers
    // (clearItemsInOffer, the stack "-" button) call this directly. It
    // reads WINDOW.GTradeStateManager at call time, so a replaced object is
    // still handled.
    WINDOW.__tf2te__.removeItemsFromTrade = removeItemsFromTrade;

    // Also patch GTradeStateManager directly, best-effort - if some other,
    // native Steam UI path happens to call GTradeStateManager.RemoveItemsFromTrade
    // itself (unconfirmed either way), this gives it the same instant
    // behavior too, when the property allows it. Wrapped since it may throw
    // for the non-configurable-global reason above, and that must never
    // block the (already reliable) window.__tf2te__ path above it.
    try {
        WINDOW.GTradeStateManager.RemoveItemsFromTrade = removeItemsFromTrade;
    } catch (e) {
        // ignore - see comment above
    }
};

}());
