/**
 * steamcommunity.com single trade offer pages (/tradeoffer/*) - the core trade offer enhancer (item summaries, keep/exchange highlighting, etc.).
 * Notable features on top of the base composer:
 *  - adding a given amount of items by market hash name (search "NAME" mode / addItemsByName /
 *    refreshNameSuggestions) - the base "Add" controls only add by raw grid position or exact asset ID, with no
 *    way to say "add 3 of this item" for identically-named items that aren't Steam-stackable (most TF2 duplicates).
 *  - "Add More Listed Items" (search addListingItem) - a one-click shortcut over the above for a listing link's own
 *    ?for_item=<appid>_<contextid>_<assetid> item specifically, for buying more than the one instance a backpack.tf
 *    listing link pre-adds when the seller has multiples. Also understands an optional ?for_item_name=<name> param -
 *    not something backpack.tf itself sends, but something backpack.tf/nextUI/fixTradeOfferLinks/content.js smuggles
 *    in when patching the link on the listing page itself, so this still works by name even once for_item's own
 *    asset has been sold/traded away and is no longer in the seller's live inventory to look up at all. For a BUY
 *    listing link (fulfilling someone else's buy order, so no specific for_item asset exists at all - see that same
 *    file's note), ?for_item_name is the ONLY signal, and both this button and the automatic pre-add below target
 *    YOUR OWN inventory instead of theirs, since you're the one selling in that case.
 *  - "Add Listing" renamed to "Add requested pure" (search btn_addlisting) - it only ever added the listing's
 *    keys/metal price (addListingPrice), never the listed item itself, which read as ambiguous next to the new
 *    "Add More Listed Items" button above.
 * Registers into the shared script registry built by ../shared.js; executed by ../bootstrap.js.
 */
(function () {
'use strict';

window.__tf2te__.scripts.push(
    {
        includes: [
            /^https?:\/\/steamcommunity\.com\/tradeoffer.*/
        ],
        styles: `
            #tradeoffer_items_summary {
                font-size: 12px;
                color: #FFFFFF;
            }
            
            #add_btns .btn_small > span,
            #clear_btns .btn_small > span {
                padding: 0 12px;
            }

            /* keeps a consistent gap between rows/wrapped lines in both
               button groups - #clear_btns holds two visibly
               different-length pairs of buttons (Clear my/their items, Add
               requested pure/Add More Listed Items) sharing one row. */
            #add_btns,
            #clear_btns {
                display: flex;
                flex-wrap: wrap;
                align-items: center;
                gap: 8px;
            }

            #add_btns .btn_small,
            #clear_btns .btn_small {
                text-align: center;
            }

            /* Add requested pure/Add More Listed Items share this min-width
               so they read as one consistent size. Add Keys/Add Metal/Add
               Recent get their own, smaller one just below (plus their
               span's own tighter padding) so all three fit on one line. */
            #clear_btns #btn_addlisting,
            #clear_btns #btn_addlistingitem {
                min-width: 110px;
            }

            #add_btns #btn_addkeys,
            #add_btns #btn_addmetal,
            #add_btns #btn_addrecent {
                min-width: 70px;
            }

            #btn_addkeys > span,
            #btn_addmetal > span,
            #btn_addrecent > span {
                padding: 0 8px;
            }

            .btn_green {
                background-color: #709D3C;
            }

            .btn_silver {
                background-color: #676767;
            }

            .btn_blue {
                background-color: #2E4766;
            }

            .btn_small {
                user-select: none;
            }

            /* Add Keys' own amount field - typed by hand, not via the native
               up/down steppers, so those are hidden. metal_amount_control
               needs no such rule - it's a plain type="text" field (see its
               own note on why), which never has spin buttons to begin with. */
            #keys_amount_control::-webkit-outer-spin-button,
            #keys_amount_control::-webkit-inner-spin-button {
                -webkit-appearance: none;
                margin: 0;
            }

            #keys_amount_control {
                -moz-appearance: textfield;
                appearance: textfield;
            }

            /* index_control/amount_control/name_amount_control's own +/-
               "ghost stepper" (see the "-" and "+"
               buttons flanking each field in the template below) -
               replaces the browser's native number-input spin arrows
               (tiny, inconsistent across browsers, and Chrome silently
               changes the value if the page happens to be scrolled while
               the cursor sits over the field). Typing a number directly
               into the field still works. The template
               below puts Steam's own filter_search_box class directly on
               this wrapper (not just the input) so the box's grey
               matches every other field on this page (name_control,
               keys_amount_control, etc.) exactly, rather than a
               hand-picked color guessed at here. filter_search_box
               itself turned out to carry no border of its own (confirmed
               live - the background matched but the box's outline
               disappeared once background-color/border were dropped from
               here), so the border is kept here, just the background
               isn't - using the same slate grey (#3C454C) this file's
               own modal boxes already border with elsewhere, rather than
               a stark black line that stood out too much against the
               page's dark background. */
            .tf2te-stepper {
                display: flex;
                align-items: center;
                border: 1px solid #3C454C;
                border-radius: 2px;
            }

            .tf2te-stepper-input {
                flex: 1;
                min-width: 0;
                width: 100%;
                border: none;
                background: transparent;
                color: #fff;
                font-size: 13px;
                text-align: center;
                padding: 5px 2px;
                -moz-appearance: textfield;
                appearance: textfield;
            }

            .tf2te-stepper-input:focus {
                outline: none;
            }

            .tf2te-stepper-input::-webkit-outer-spin-button,
            .tf2te-stepper-input::-webkit-inner-spin-button {
                -webkit-appearance: none;
                margin: 0;
            }

            .tf2te-stepper-btn {
                flex: 0 0 18px;
                padding: 5px 0;
                text-align: center;
                color: #8F98A0;
                font-size: 14px;
                line-height: 1;
                cursor: pointer;
                user-select: none;
            }

            .tf2te-stepper-btn:hover {
                color: #209DE6;
            }

            .tf2te-stepper-btn:active {
                color: #1a7eb8;
            }

            /* index_control/amount_control's own persistent label -
               unlike a placeholder, this doesn't disappear once a real
               value is typed in, so it's still clear which field is which. Same
               dim grey already used for secondary text elsewhere on this
               page (the remove-quantity modal's own hint text, the idle
               stepper button color above). */
            .tf2te-stepper-label {
                font-size: 11px;
                color: #8F98A0;
            }

            /* Clear my items/Clear their items wipe everything currently
               staged on that side, so they're set apart from the neutral
               btn_black actions around them (Add by position, Add Metal,
               etc.) to make a misclick less likely. Outlined red
               (reuses .tf2te-slot-decrement's own #E05C5C/#C74848 pair, the
               page's existing destructive-action color) signals "careful"
               without being as loud as a filled red button, which would
               out-compete Add requested pure for attention. */
            #clear_btns #btn_clearmyitems,
            #clear_btns #btn_cleartheiritems {
                background-color: transparent;
                border: 1px solid #E05C5C;
                color: #E05C5C;
            }

            #clear_btns #btn_clearmyitems:hover,
            #clear_btns #btn_cleartheiritems:hover {
                background-color: #E05C5C;
                color: #fff;
            }

            /* "Add by position"/"Add by name"'s own explainer sentence,
               collapsed into a small hover/focus "i" marker so it doesn't
               cost two lines each in an already-dense sidebar. */
            .tf2te-info-dot {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 14px;
                height: 14px;
                border-radius: 50%;
                /* Lighter than the #3C454C box borders: enough contrast
                   against the sidebar's near-black background. */
                background-color: #4A5560;
                color: #C6D4DF;
                font-size: 10px;
                font-style: italic;
                font-family: Georgia, serif;
                cursor: default;
                position: relative;
                flex: none;
            }

            .tf2te-info-tip {
                position: absolute;
                left: 50%;
                top: 20px;
                transform: translateX(-50%);
                width: 230px;
                background-color: #1c2226;
                border: 1px solid #3C454C;
                color: #C6D4DF;
                font-size: 11px;
                font-style: normal;
                font-family: Arial, Helvetica, sans-serif;
                line-height: 1.5;
                padding: 8px 10px;
                border-radius: 4px;
                opacity: 0;
                pointer-events: none;
                transition: opacity 0.12s ease;
                z-index: 5;
                text-align: left;
            }

            .tf2te-info-dot:hover .tf2te-info-tip,
            .tf2te-info-dot:focus .tf2te-info-tip,
            .tf2te-info-dot:focus-within .tf2te-info-tip,
            .tf2te-info-dot.tf2te-info-open .tf2te-info-tip {
                opacity: 1;
            }

            /* Partner header as a left-hand column beside the trade area
               (see enablePartnerSideColumn), so the ban check, partner
               warnings and pure totals stay visible while picking items.
               Only where Steam's fixed-width (~940px) #mainContent plus
               a column of at least 320px and its 16px gap fit - below
               that, the stock top layout. The column grows with the
               window up to 460px, wide enough for Steam's widest line
               (the 400px limited-account note) to stay on one row,
               rather than a fixed 460px that would need a ~1440px
               window before the column showed at all. The column
               floats into #mainContent's own extra left padding
               rather than shifting #mainContent with
               position/transform, which would move the containing block
               of Steam's absolutely-positioned #hover item tooltip.
               The column is Steam's own wrapper div around the header,
               found via :has() rather than tagged from JS - Steam's
               responsive script can move the header between wrappers
               after this script has already run. */
            @media (min-width: 1320px) {
                /* 100vw minus #mainContent, the gap, the scrollbar and
                   some outer margin. */
                html.tf2te-side-layout {
                    --tf2te-partner-column: clamp(320px, calc(100vw - 1000px), 460px);
                }

                html.tf2te-side-layout #mainContent:has(> div > .trade_partner_header) {
                    box-sizing: content-box;
                    padding-left: calc(var(--tf2te-partner-column) + 16px);
                }

                html.tf2te-side-layout #mainContent > div:has(> .trade_partner_header) {
                    float: left;
                    width: var(--tf2te-partner-column);
                    margin-left: calc(-1 * (var(--tf2te-partner-column) + 16px));
                }

                /* Steam's own clear:left divs inside the trade area would
                   otherwise also clear the column, dropping the whole
                   trade area below it. */
                html.tf2te-side-layout #mainContent:has(> div > .trade_partner_header) > .trade_area {
                    display: flow-root;
                }

                /* Steam floats these into one row - stacked instead. */
                html.tf2te-side-layout #mainContent > div > .trade_partner_header .trade_partner_info_block {
                    float: none;
                    width: auto;
                    margin: 0 0 6px 0;
                }

                /* Confirmed live: Steam gives some of these text lines a
                   fixed width sized for its own wide top layout (the
                   limited-account note is 400px), so they ran out past
                   a narrower column - sized to the column and wrapped
                   instead, which a full-width column only still needs
                   for longer translated Steam text. flow-root keeps a
                   wrapped line beside the floated "!" icon instead of
                   running underneath it. */
                html.tf2te-side-layout #mainContent > div > .trade_partner_header .trade_partner_info_text {
                    display: flow-root;
                    width: auto;
                    min-width: 0;
                    max-width: none;
                    white-space: normal;
                    overflow-wrap: break-word;
                }
            }

            /* Sticky only when the window is tall enough for the whole
               column - in a shorter one a sticky column taller than the
               viewport would keep its own bottom rows out of reach. */
            @media (min-width: 1320px) and (min-height: 700px) {
                html.tf2te-side-layout #mainContent > div:has(> .trade_partner_header) {
                    position: sticky;
                    top: 12px;
                }
            }

            .summary_item {
                display: inline-block;
                position: relative;
                width: 64px;
                height: 64px;
                padding: 3px;
                margin: 0 2px 2px 0;
                border: 1px solid;
                background-color: #3C352E;
                background-position: center;
                background-size: 64px 64px, 100% 100%;
                background-repeat: no-repeat;
            }
            
            /* Sized to match .tf2te-slot-badge below - the equivalent "xN"
               badge shown on a collapsed trade slot itself - rather than
               its own slightly different size, so the same multiplier
               reads as the same visual element in both places. */
            .summary_badge {
                padding: 1px 4px;
                border-radius: 4px;
                background-color: #209DE6;
                color: #fff;
                font-size: 11px;
                font-weight: bold;
                line-height: 1.4;
            }

            /* Row collapseDuplicateSlots adds onto a trade slot representing
               N visually-identical items collapsed into it - holds the "xN"
               badge and the "-" removal trigger side by side. Relies on the
               slot element itself already being position: relative, same as
               Steam's own .slot_applogo/.slot_actionmenu_button overlays in
               that same slot. */
            .tf2te-slot-overlay-row {
                position: absolute;
                top: 2px;
                left: 2px;
                display: flex;
                align-items: center;
                gap: 3px;
                /* Confirmed live: the item element itself sits at z-index: 3
                   (inline style) - content below that renders underneath it/
                   other overlay siblings and is effectively invisible. Only
                   needs to clear that (comfortable margin, not an
                   aggressive one) - a much higher value would also cover
                   Steam's own item-hover description popup. */
                z-index: 10;
            }

            .tf2te-slot-badge {
                padding: 1px 4px;
                border-radius: 4px;
                background-color: #209DE6;
                color: #fff;
                font-size: 11px;
                font-weight: bold;
                line-height: 1.4;
                /* pointer-events: none so it never blocks hovering/clicking
                   the real item underneath it. */
                pointer-events: none;
            }

            /* Own click handler (not Steam's), so pointer-events is left at
               its default (auto), unlike the badge next to it. */
            .tf2te-slot-decrement {
                flex-shrink: 0;
                width: 16px;
                height: 16px;
                border-radius: 3px;
                background-color: #E05C5C;
                color: #fff;
                font-size: 13px;
                font-weight: bold;
                line-height: 16px;
                text-align: center;
                cursor: pointer;
            }

            .tf2te-slot-decrement:hover {
                background-color: #C74848;
            }

            /* Top-right link icon addItemHistoryLinks adds to every itemful
               trade slot (not just collapsed-stack representatives),
               opening that exact item's own next.backpack.tf page. Relies
               on the slot element itself already being position: relative,
               same as the badge/decrement overlay on the opposite corner. */
            .tf2te-item-history-link {
                position: absolute;
                top: 2px;
                right: 2px;
                display: flex;
                align-items: center;
                justify-content: center;
                width: 16px;
                height: 16px;
                border-radius: 3px;
                background-color: rgba(0, 0, 0, 0.65);
                color: #fff;
                text-decoration: none;
                /* See .tf2te-slot-overlay-row's own note above - only needs
                   to clear the item's own z-index: 3, not stay above
                   everything on the page (which would also cover Steam's
                   own item-hover description popup). */
                z-index: 10;
            }

            .tf2te-item-history-link:hover {
                background-color: #209DE6;
            }

            /* Modal promptRemoveItems shows when removing from a
               collapsed stack, asking how many (or which) items to take
               out instead of always removing just the one representative
               item. */
            .tf2te-remove-qty-overlay {
                position: fixed;
                inset: 0;
                display: flex;
                align-items: center;
                justify-content: center;
                background-color: rgba(0, 0, 0, 0.6);
                z-index: 100000;
            }

            .tf2te-remove-qty-box {
                min-width: 240px;
                padding: 16px 20px;
                border-radius: 3px;
                background-color: #262626;
                border: 1px solid #444;
                box-shadow: 0 0 20px rgba(0, 0, 0, 0.8);
                color: #fff;
                font-family: inherit;
            }

            .tf2te-remove-qty-title {
                margin-bottom: 10px;
                font-size: 14px;
            }

            .tf2te-remove-qty-slider {
                box-sizing: border-box;
                width: 100%;
                margin-bottom: 10px;
                accent-color: #209DE6;
            }

            /* Reuses the exact same "ghost stepper" classes (.tf2te-stepper/
               -input/-btn) "Add by position" uses (see that feature's own
               note) - same size, same filter_search_box background, same
               border - rather than a parallel look-alike class, so this
               modal's stepper matches that one exactly instead of
               drifting from it over time. filter_search_box
               is a global Steam class, not scoped to the #controls sidebar,
               so it applies here too even though this is a floating modal.
               Width is set inline (see promptRemoveItems itself) to
               match the 68px "Add by position" uses. */
            .tf2te-stepper.tf2te-remove-qty-invalid {
                border-color: #E05C5C;
            }

            .tf2te-remove-qty-hint {
                margin-bottom: 12px;
                color: #8F98A0;
                font-size: 11px;
                text-align: center;
            }

            .tf2te-remove-qty-buttons {
                display: flex;
                justify-content: flex-end;
                gap: 8px;
            }

            .tf2te-remove-qty-buttons button {
                padding: 6px 14px;
                border: none;
                border-radius: 2px;
                font-size: 13px;
                cursor: pointer;
            }

            .tf2te-remove-qty-cancel {
                background-color: #3C454C;
                color: #fff;
            }

            .tf2te-remove-qty-confirm {
                background-color: #209DE6;
                color: #fff;
                font-weight: bold;
            }

            /* promptSelectHistoryItem's own list of rows, and
               promptRemoveItems' own checklist-mode rows (see
               .tf2te-remove-pick-row below) - both shown inside the same
               .tf2te-remove-qty-overlay/-box shell, one row per real item in
               a collapsed stack. */
            .tf2te-history-pick-list {
                display: flex;
                flex-direction: column;
                gap: 6px;
                max-height: 260px;
                overflow-y: auto;
                margin-bottom: 12px;
            }

            .tf2te-history-pick-row {
                padding: 8px 10px;
                border-radius: 2px;
                background-color: #1c1c1c;
                border: 1px solid #444;
                color: #fff;
                font-size: 13px;
                text-decoration: none;
            }

            .tf2te-history-pick-row:hover {
                background-color: rgba(32, 157, 230, 0.35);
                border-color: #209DE6;
            }

            /* promptRemoveItems' own checklist-mode row - a <label> wrapping
               a checkbox, not a link. Applied ALONGSIDE
               .tf2te-history-pick-row (same background/border/hover box
               look), this just adds the flex layout + pointer cursor a
               <label> needs that an <a> already gets for free. */
            .tf2te-remove-pick-row {
                display: flex;
                align-items: center;
                gap: 8px;
                cursor: pointer;
            }

            .tf2te-remove-pick-checkbox {
                accent-color: #209DE6;
                flex-shrink: 0;
            }

            /* promptRemoveItems' own "how many" <-> "specific item(s)" mode
               toggle link - same pill look buildPartnerProfileLinksRow's own
               next.bp.tf/bp.tf/posts.tf/rep.tf sidebar links use (rounded
               translucent-white background, no underline). display:table
               (not block) so the pill hugs the text width instead of
               stretching full-width, while margin:auto still centers it the
               same way
               .tf2te-stepper's own centering does. */
            .tf2te-remove-mode-toggle {
                display: table;
                margin: 12px auto;
                padding: 4px 10px;
                border-radius: 4px;
                background: rgba(255, 255, 255, 0.08);
                color: #fff;
                font-size: 11px;
                text-decoration: none;
                white-space: nowrap;
                cursor: pointer;
            }

            /* name_control's own autocomplete dropdown (closeNameDropdown/
               renderNameDropdown/positionNameDropdown). Re-parented to a
               direct child of <body> (see its own setup call below) - the
               same place the already-reliable .tf2te-remove-qty-overlay
               pickers live - with fixed positioning computed fresh from the
               input's own getBoundingClientRect() every time it opens
               (positionNameDropdown), so it has no dependency on any
               ancestor's CSS at all. top/left/width are set inline in JS,
               not here - only the visual chrome lives in this rule now. See #49. */
            .tf2te-name-dropdown {
                position: fixed;
                z-index: 100000;
                max-height: 220px;
                overflow-y: auto;
                background-color: #1c1c1c;
                border: 1px solid #444;
                border-radius: 3px;
                box-shadow: 0 4px 10px rgba(0, 0, 0, 0.5);
            }

            /* Explicit, rather than relying on the native [hidden] attribute's
               own UA-stylesheet display:none alone - seen as NOT actually
               hiding this element (an empty bordered/shadowed strip stayed
               visible with the hidden attribute present), most likely some
               other rule on the page setting display with equal or higher
               specificity than that UA default. !important forces
               this to win regardless of what that turns out to be. */
            .tf2te-name-dropdown[hidden] {
                display: none !important;
            }

            .tf2te-name-dropdown-row {
                padding: 6px 10px;
                font-size: 12px;
                color: #fff;
                cursor: pointer;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }

            .tf2te-name-dropdown-row:hover,
            .tf2te-name-dropdown-row.tf2te-name-dropdown-row-active {
                background-color: rgba(32, 157, 230, 0.35);
            }

            /* showAlert - a modern in-page replacement for the browser's
               native alert() dialog (unstylable, prefixed with
               "steamcommunity.com says"), used for all of this file's
               one-line status/error messages (e.g. "Could not find N
               keys"). Same dark overlay + centered box visual language as
               promptRemoveItems' own modal above, just with a message
               and a single "OK" dismiss action instead of an input - a
               true neutral dark grey box/border (a navy tint read as
               distractingly "blue" against the page, confirmed live), so
               the two modals stay visually consistent with each other and
               with the rest of this page's dark/grey theme. */
            .tf2te-alert-overlay {
                position: fixed;
                inset: 0;
                display: flex;
                align-items: center;
                justify-content: center;
                background-color: rgba(0, 0, 0, 0.6);
                z-index: 100000;
            }

            .tf2te-alert-box {
                min-width: 240px;
                max-width: 360px;
                padding: 16px 20px;
                border-radius: 3px;
                background-color: #262626;
                border: 1px solid #444;
                box-shadow: 0 0 20px rgba(0, 0, 0, 0.8);
                color: #fff;
                font-family: inherit;
            }

            .tf2te-alert-message {
                margin-bottom: 14px;
                font-size: 13px;
                line-height: 1.4;
            }

            .tf2te-alert-buttons {
                display: flex;
                justify-content: flex-end;
            }

            .tf2te-alert-ok {
                padding: 6px 14px;
                border: none;
                border-radius: 2px;
                font-size: 13px;
                font-weight: bold;
                cursor: pointer;
                background-color: #3a3a3a;
                color: #fff;
            }

            .tf2te-alert-ok:hover {
                background-color: rgba(32, 157, 230, 0.35);
            }

            /* Suppress the browser's own default focus ring (shows up as
               a blue/white outline in most browsers) - confirmed live as
               clashing with this now fully neutral-grey popup. okBtn.focus()
               is still called for keyboard accessibility (Enter/Space
               still activate it), just without the default outline. */
            .tf2te-alert-ok:focus {
                outline: none;
            }

            .items_summary {
                margin-top: 8px
            }

            .summary_header {
                margin-bottom: 4px;
            }

            .filter_full {
                width: 200px;
            }
            
            .filter_number {
                width: 110px;
            }
            
            .control_fields {
                margin-top: 8px
            }
            
            .warning {
                color: #FF4422;
            }
            
            .trade_area .item.unusual.hover {
                background-position: center;
                background-color: #474747 !important;
            }
            
            ${window.__tf2te__.sharedStyles.itemOverlay}
        `,
        fn: function main({ WINDOW, $, Utils, shared, getStored, setStored }) {
            const urlParams = Utils.getURLParams();
            // these are never re-assigned in steam's source code
            // only updated
            const { UserYou, UserThem } = WINDOW;
            const STEAMID = UserYou.strSteamId;
            const PARTNER_STEAMID = UserThem.strSteamId;
            const INVENTORY = WINDOW.g_rgAppContextData;
            const PARTNER_INVENTORY = WINDOW.g_rgPartnerAppContextData;
            const TRADE_STATUS = WINDOW.g_rgCurrentTradeStatus;
            const page = {
                $document: $(document),
                $yourSlots: $('#your_slots'),
                $theirSlots: $('#their_slots'),
                $inventories: $('#inventories'),
                $inventorySelectYour: $('#inventory_select_your_inventory'),
                $inventorySelectTheir: $('#inventory_select_their_inventory'),
                $tradeBoxContents: $('#inventory_box div.trade_box_contents'),
                $appSelectOption: $('.appselect_options .option'),
                // get jquery elements which are constantly changing based on page state
                get: {
                    $inventory: () => $('.inventory_ctn:visible'),
                    $activeInventoryTab: () => $('.inventory_user_tab.active'),
                    $modifyTradeOffer: () => $('div.modify_trade_offer:visible'),
                    $appSelectImg: () => $('#appselect_activeapp img'),
                    $deadItem: () => $('a[href$="_undefined"]'),
                    $changeOfferButton: () => $('#modify_trade_offer_opts div.content')
                }
            };
            // keys for stored values
            const stored = {
                id_visible: 'getTradeOfferWindow.id_visible'
            };
            /**
             * Interact with trade offer.
             */
            const tradeOfferWindow = (function() {
                /**
                 * Get summary HTML.
                 * @param {string} type - Name of user e.g. "Your" or "Their".
                 * @param {NodeList} itemsList - List of item elements.
                 * @param {boolean} isYou - Are these your items?
                 * @param {Object} User - User object from Steam's JS that the items belong to.
                 * @returns {string} Summary HTML.
                 */
                function dumpSummary(type, itemsList, isYou, User) {
                    /**
                     * Summary of items in trade offer.
                     * @typedef {Object} Summary
                     * @property {number} total - Total number of items in summary.
                     * @property {Object<string, string[]>} apps - Asset IDs by app ID.
                     * @property {Object<string, number>} items - Number of each item. The key is a serialized string of item properties.
                     */
                    
                    /**
                     * Get summary of items.
                     * @param {NodeList} itemsList - List of item elements.
                     * @param {boolean} isYou - Are these your items?
                     * @returns {(Summary|null)} Summary of items, null if inventory is not properly loaded.
                     */
                    function evaluateItems(itemsList, isYou) {
                        const inventory = isYou ? INVENTORY : PARTNER_INVENTORY;
                        const apps = {};
                        const items = {};
                        const total = itemsList.length;
                        
                        for (let i = 0; i < total; i++) {
                            const itemEl = itemsList[i];

                            // Wrapped per-item (not just the inventory lookup
                            // below) - a malformed/still-loading item (e.g. a
                            // missing id, confirmed live as a real
                            // possibility under heavy/fast item-adding load)
                            // must not throw out of the middle of this loop,
                            // which would silently abandon every item still
                            // left in itemsList after it too, not just this
                            // one. Treated the same as "not properly loaded"
                            // below - this whole side's summary is already
                            // designed to render as empty rather than an
                            // undercounted partial one whenever any item
                            // isn't ready yet (see the "not properly loaded"
                            // test), so a genuine error here reuses that
                            // exact same, already-expected behavior.
                            try {
                                // array containing item identifiers e.g. ['440', '2', '123']
                                const split = itemEl.getAttribute('id').replace(/^item/, '').split('_');
                                const [appid, contextid, assetid] = split;
                                // get the icon image - NOT one of the .parts/.ks/
                                // .spell marker icons rendered below (see
                                // getItemIconSrc's own note)
                                const img = getItemIconSrc(itemEl);
                                const borderColor = itemEl.style.borderColor;
                                const effect = itemEl.getAttribute('data-effect');
                                const uncraft = itemEl.classList.contains('uncraft');
                                const strange = itemEl.classList.contains('strange');
                                const markers = getTradeCustomizationMarkers(itemEl);
                                // Guards EVERY level, not just inventory[appid] -
                                // an appid can be present while its own
                                // rgContexts[contextid] still isn't (confirmed
                                // live as a real throw point under heavy/fast
                                // item-adding load - resolveItemName already
                                // guards this exact same chain via a try/catch,
                                // this just does it inline instead since a
                                // missing item here is an expected, common
                                // "not loaded yet" case, not a rare error).
                                const item = (
                                    inventory[appid] &&
                                    inventory[appid].rgContexts[contextid] &&
                                    inventory[appid].rgContexts[contextid].inventory.rgInventory[assetid]
                                );

                                if (!item) {
                                    // not properly loaded
                                    return null;
                                }

                                // create the key from the item properties - see
                                // hasUniqueTradeCustomization's own note on why
                                // a Strange Part/Killstreak Kit/Spell forces
                                // this item's own assetid into the key instead
                                // of letting it share a count with any other
                                // visually-identical item.
                                const key = attributesToString({
                                    img,
                                    borderColor,
                                    effect,
                                    uncraft,
                                    strange,
                                    uniqueKey: hasUniqueTradeCustomization(itemEl) ? assetid : undefined,
                                    parts: markers.parts,
                                    killstreak: markers.killstreak,
                                    spell: markers.spell
                                });

                                items[key] = (items[key] || 0) + 1;

                                if (apps[appid] === undefined) {
                                    apps[appid] = [];
                                }

                                apps[appid].push(assetid);
                            } catch (e) {
                                console.error('[TF2 Trading Enhancer] Failed to evaluate a trade slot item for the summary:', e);
                                return null;
                            }
                        }
                        
                        return {
                            total,
                            apps,
                            items
                        };
                    }
                    
                    /**
                     * Attributes.
                     * @typedef {Object} Attributes
                     * @property {(string|undefined)} img - Image URL.
                     * @property {(string|undefined)} borderColor - Border color.
                     * @property {(string|undefined)} effect - Effect.
                     * @property {boolean} uncraft - Is uncraftable?
                     * @property {boolean} strange - Is strange?
                     * @property {(string|undefined)} uniqueKey - This item's
                     * own assetid, if it must never be grouped with another
                     * item regardless of matching the other attributes (see
                     * hasUniqueTradeCustomization) - otherwise undefined.
                     * @property {boolean} [parts] - Has a Strange Part attached?
                     * @property {number} [killstreak] - Killstreak tier (1-3), 0 for none.
                     * @property {boolean} [spell] - Has a Spell attached?
                     */

                    /**
                     * Serialize attributes to string.
                     * @param {Attributes} attributes - Attributes.
                     * @returns {string} Serialized attributes.
                     */
                    function attributesToString({
                        img,
                        borderColor,
                        effect,
                        uncraft,
                        strange,
                        uniqueKey,
                        parts,
                        killstreak,
                        spell
                    }) {
                        return `${img || ''}\n${borderColor || ''}\n${effect || ''}\n${uncraft ? '1' : ''}\n${strange ? '1' : ''}\n${uniqueKey || ''}\n${parts ? '1' : ''}\n${killstreak || ''}\n${spell ? '1' : ''}`;
                    }

                    /**
                     * Deserialize attributes from string.
                     * @param {string} str - Serialized attributes.
                     * @returns {Attributes} Deserialized attributes.
                     */
                    function attributesFromString(str) {
                        const segments = str.split('\n');

                        return {
                            img: segments[0] || undefined,
                            borderColor: segments[1] || undefined,
                            effect: segments[2] || undefined,
                            uncraft: segments[3] === '1',
                            strange: segments[4] === '1',
                            parts: segments[6] === '1',
                            killstreak: Number(segments[7]) || 0,
                            spell: segments[8] === '1'
                        };
                    }
                    
                    /**
                     * Gets the summary of items.
                     * @param {Object<string, number>} items - Number of each item. The key is a serialized string of item properties.
                     * @param {Object<string, string[]>} apps - Asset IDs by app ID.
                     * @param {string} steamid - SteamID of user.
                     * @returns {string} HTML string.
                     */
                    function getSummary(items, apps, steamid) {
                        // helper for getting effect url
                        const { getEffectURL } = shared.offers.unusual;
                        const { getIconURL, getKillstreakIconURL } = shared.offers.identifiers;
                        const ids = apps['440'];
                        let html = '';
                        
                        if (ids) {
                            // Wraps the whole summary icon grid in a link to
                            // this side's backpack.tf inventory, deep-linked
                            // to exactly the items in THIS trade (not their
                            // whole inventory) via backpack.tf's own
                            // ?select=<comma-separated asset ids> convention -
                            // `steamid` is whichever side this summary
                            // belongs to (see dumpSummary's own `User` param:
                            // UserYou.strSteamId for "My summary",
                            // UserThem.strSteamId for "Their summary"), and
                            // `ids` is that same side's asset ids collected
                            // above from apps['440'] (evaluateItems' own
                            // per-item apps[appid].push(id)) - so clicking
                            // "Their summary" opens THEIR inventory with
                            // THEIR offered items highlighted, letting you
                            // eyeball prices/duplicates on backpack.tf
                            // without hunting for the items yourself.
                            //
                            // MUST stay on classic backpack.tf, not
                            // next.backpack.tf - confirmed live that
                            // next's inventory page is a completely
                            // different SPA that doesn't support ?select= (or
                            // any URL-driven item filtering) at all; the
                            // param is silently ignored there. Classic is the
                            // only one of the two that actually honors it.
                            const url = `https://backpack.tf/profiles/${steamid}?select=${ids.join(',')}`;

                            html += `<a title="Open on backpack.tf" href="${url}" target="_blank">`;
                        }
                        
                        for (let key in items) {
                            // generate the html for this item
                            const {
                                img,
                                borderColor,
                                effect,
                                uncraft,
                                strange,
                                parts,
                                killstreak,
                                spell
                            } = attributesFromString(key);
                            const count = items[key];
                            let backgroundImages = `url(${img})`;
                            let classes = 'summary_item';

                            if (effect !== undefined && effect !== 'none') {
                                backgroundImages += `, url('${getEffectURL(effect)}')`;
                            }

                            if (uncraft) {
                                classes += ' uncraft';
                            }

                            if (strange) {
                                classes += ' strange';
                            }

                            const styles = `background-image: ${backgroundImages}; border-color: ${borderColor};`;
                            const badge = count > 1 ? `<span class="summary_badge">×${count}</span>` : '&nbsp;';

                            // Same bottom-left ".icons" marker overlay (and
                            // exact icon URLs/classes) shared.js's own
                            // addAttributesToElement already renders onto
                            // the real trade slot item - the CSS for it
                            // (window.__tf2te__.sharedStyles.itemOverlay) is
                            // already loaded on this page, so it lines up
                            // identically here without needing its own copy.
                            let iconsHtml = '';
                            if (spell) iconsHtml += `<img src="${getIconURL('spell.svg')}" class="spell"/>`;
                            if (parts) iconsHtml += `<img src="${getIconURL('strange-parts.svg')}" class="parts"/>`;
                            if (killstreak) iconsHtml += `<img src="${getKillstreakIconURL(killstreak)}" class="ks" data-tier="${killstreak}"/>`;
                            if (iconsHtml) iconsHtml = `<div class="icons">${iconsHtml}</div>`;

                            // add the html for this item
                            html += `<span class="${classes}" style="${styles}">${badge}${iconsHtml}</span>`;
                        }
                        
                        if (ids) {
                            // close the link
                            html += '</a>';
                        }
                        
                        return html;
                    }
                    
                    /**
                     * Get header for summary.
                     * @param {string} type - The name of trader e.g. "My" or "Them".
                     * @param {number} total - Total number of items in offer.
                     * @returns {string} HTML string.
                     */
                    function getHeader(type, total) {
                        const itemsStr = total === 1 ? 'item' : 'items';

                        return `<div class="summary_header">${type} summary (${total} ${itemsStr})</div>`;
                    }
                    
                    const summary = evaluateItems(itemsList, isYou);
                    
                    // no summary or no items
                    if (summary === null || summary.total === 0) {
                        return '';
                    }
                    
                    // unpack summary...
                    const { total, apps, items } = summary;
                    const steamid = User.strSteamId;
                    
                    // return the header and summary
                    const html = getHeader(type, total) + getSummary(items, apps, steamid);
                    
                    return html;
                }
                
                // CSS classes for the overlay elements collapseDuplicateSlots
                // injects onto a representative slot - also used to find/
                // remove stale ones on the next pass.
                const COLLAPSED_SLOT_BADGE_CLASS = 'tf2te-slot-badge';
                const COLLAPSED_SLOT_DECREMENT_CLASS = 'tf2te-slot-decrement';
                const COLLAPSED_SLOT_OVERLAY_ROW_CLASS = 'tf2te-slot-overlay-row';
                const ITEM_HISTORY_LINK_CLASS = 'tf2te-item-history-link';

                // Bulleted-list icon (stroke-based, currentColor) for
                // ITEM_HISTORY_LINK_CLASS - a bold-stroke shape holds up at
                // this tiny size, unlike a filled icon with fine curved
                // details (which looks pixelated). Shared between
                // both addItemHistoryLinks branches (direct link / group
                // picker button) so there's one definition to update.
                const ITEM_HISTORY_ICON_SVG = '<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><circle cx="4.5" cy="6" r="1.3" fill="currentColor" stroke="none"/><line x1="9" y1="6" x2="20" y2="6"/><circle cx="4.5" cy="12" r="1.3" fill="currentColor" stroke="none"/><line x1="9" y1="12" x2="20" y2="12"/><circle cx="4.5" cy="18" r="1.3" fill="currentColor" stroke="none"/><line x1="9" y1="18" x2="16" y2="18"/></svg>';

                // Which of shared.js's .parts/.ks/.spell marker icons a slot
                // item carries (see hasUniqueTradeCustomization below).
                // killstreak is the tier (1-3) from the .ks icon's data-tier,
                // 0 for none.
                function getTradeCustomizationMarkers(itemEl) {
                    const ksEl = itemEl.querySelector('.ks');

                    return {
                        parts: Boolean(itemEl.querySelector('.parts')),
                        killstreak: ksEl ? Number(ksEl.getAttribute('data-tier')) || 1 : 0,
                        spell: Boolean(itemEl.querySelector('.spell'))
                    };
                }

                /**
                 * Whether a slot item carries a Strange Part, Killstreak
                 * Kit, or Spell - per-item customization shared.js's own
                 * addAttributesToElement renders as a small icon
                 * (.parts/.ks/.spell respectively) but that never shows up
                 * in the plain img-src/border-color/data-effect/uncraft/
                 * strange fingerprint getItemVisualSignature and
                 * dumpSummary's own evaluateItems otherwise build: two
                 * Strange Rocket Launchers with two completely different
                 * Strange Parts attached render with the exact same icon,
                 * border, and quality color. Confirmed live: without this
                 * check, they got silently collapsed into the same "×N"
                 * duplicate stack in the trade slots (collapseDuplicateSlots)
                 * AND summed into the same count in the item summary
                 * (dumpSummary) even though they're NOT interchangeable
                 * items. Rather than fingerprinting the exact parts/sheen/
                 * spell (would need the full description text, not just
                 * this DOM marker), any item carrying one of these markers
                 * is simply excluded from duplicate-detection entirely -
                 * both callers key it by its own assetid instead, which is
                 * always unique.
                 * @param {HTMLElement} itemEl - A slot's real .item element.
                 * @returns {boolean}
                 */
                function hasUniqueTradeCustomization(itemEl) {
                    const markers = getTradeCustomizationMarkers(itemEl);

                    return Boolean(markers.parts || markers.killstreak || markers.spell);
                }

                /**
                 * Finds an item's own real icon <img> - i.e. NOT one of the
                 * .parts/.ks/.spell marker icons shared.js's own
                 * addAttributesToElement nests inside a ".icons" wrapper div
                 * appended onto the item element (see getTradeCustomizationMarkers
                 * above). A plain `itemEl.querySelector('img')` returns
                 * whichever <img> comes first in the DOM, which for a
                 * customized item can be a marker icon instead of the
                 * item's own icon (confirmed live). Walking up via
                 * closest('.icons') to exclude marker icons is robust
                 * regardless of where in the DOM order the real icon
                 * happens to sit.
                 * @param {HTMLElement} itemEl - A slot's real .item element.
                 * @returns {string|null} Icon URL, or null if none found.
                 */
                function getItemIconSrc(itemEl) {
                    const imgs = itemEl.querySelectorAll('img');

                    for (let i = 0; i < imgs.length; i++) {
                        if (!imgs[i].closest('.icons')) {
                            return imgs[i].getAttribute('src');
                        }
                    }

                    return null;
                }

                /**
                 * Computes the same duplicate-detection signature dumpSummary's
                 * own evaluateItems/attributesToString uses internally (img src
                 * + border color + data-effect + uncraft/strange classes, or -
                 * see hasUniqueTradeCustomization above - the item's own
                 * assetid if it has a Strange Part/Killstreak Kit/Spell
                 * attached) - an independent copy rather than reaching into
                 * dumpSummary's own private closure, but MUST stay in sync
                 * with it: two items collapse into one badged slot here
                 * exactly when they'd also be counted together in the item
                 * summary below the slots.
                 * @param {HTMLElement} itemEl - A slot's real .item element.
                 * @returns {string} Signature string - equal for two visually
                 * identical items.
                 */
                function getItemVisualSignature(itemEl) {
                    if (hasUniqueTradeCustomization(itemEl)) {
                        return `unique:${itemEl.getAttribute('id')}`;
                    }

                    const img = getItemIconSrc(itemEl);
                    const borderColor = itemEl.style.borderColor;
                    const effect = itemEl.getAttribute('data-effect');
                    const uncraft = itemEl.classList.contains('uncraft');
                    const strange = itemEl.classList.contains('strange');

                    return `${img || ''}\n${borderColor || ''}\n${effect || ''}\n${uncraft ? '1' : ''}\n${strange ? '1' : ''}`;
                }

                /**
                 * Resolves a slot item's display name - same id-parsing/
                 * lookup evaluateItems above already does per-item for the
                 * summary, kept independent since this only ever needs one
                 * name at a time for the "remove how many?" modal's title,
                 * and a failed lookup (inventory not loaded yet) should
                 * fall back to a generic label rather than block anything.
                 * @param {HTMLElement} itemEl
                 * @param {boolean} isYou - Whose inventory to resolve from.
                 * @returns {string|null}
                 */
                function resolveItemName(itemEl, isYou) {
                    const inventory = isYou ? INVENTORY : PARTNER_INVENTORY;

                    try {
                        const [appid, contextid, assetid] = itemEl.getAttribute('id').replace(/^item/, '').split('_');
                        const item = inventory[appid].rgContexts[contextid].inventory.rgInventory[assetid];

                        return item.market_hash_name;
                    } catch (e) {
                        return null;
                    }
                }

                /**
                 * Resolves a slot item's own "type" subtitle text (e.g.
                 * "Level 47 Rocket Launcher", or "Strange Rocket Launcher -
                 * Kills: 128" for a Strange-tracking one) - the same
                 * per-asset field shared.js's own getItemAttributes already
                 * reads (via this same inventory shape) to detect Strange
                 * tracking. Used by promptSelectHistoryItem to distinguish
                 * between otherwise visually-identical duplicates: two items
                 * with the exact same collapseDuplicateSlots signature
                 * (same icon/border/effect/uncraft/strange-boolean) can
                 * still have completely different Level numbers or Strange
                 * kill counts, neither of which factors into that signature
                 * at all - a Strange Part/Killstreak/Spell/Paint difference,
                 * by contrast, can never actually appear within an
                 * already-collapsed group in the first place (each already
                 * forces its own distinct signature/exclusion - see
                 * getItemVisualSignature/hasUniqueTradeCustomization), so
                 * there's nothing to add for those specifically.
                 * @param {HTMLElement} itemEl
                 * @param {boolean} isYou - Whose inventory to resolve from.
                 * @returns {string|null} Trimmed type text, or null if
                 * unresolvable (inventory not loaded yet) or empty.
                 */
                function resolveItemTypeText(itemEl, isYou) {
                    const inventory = isYou ? INVENTORY : PARTNER_INVENTORY;

                    try {
                        const [appid, contextid, assetid] = itemEl.getAttribute('id').replace(/^item/, '').split('_');
                        const item = inventory[appid].rgContexts[contextid].inventory.rgInventory[assetid];

                        return (item.type || '').trim() || null;
                    } catch (e) {
                        return null;
                    }
                }

                /**
                 * Shows a modal for removing some of a collapsed stack - two
                 * modes, toggled via a link: "how many" (a slider/stepper,
                 * removing that many from the front of the stack in
                 * trade-window order), or a per-item checklist letting the user pick
                 * EXACTLY which real item(s) to remove. The checklist mode
                 * exists because collapseDuplicateSlots only groups on
                 * visual signature
                 * (icon/border/effect/uncraft/strange-boolean) - two grouped
                 * items can still have a genuinely different Level or
                 * Strange kill count (see resolveItemTypeText's own note),
                 * which "how many" has no way to target specifically.
                 * @param {HTMLElement[]} items - Real .item elements, in
                 * trade-window order (collapseDuplicateSlots' own
                 * groupItems).
                 * @param {string} itemLabel - Item name shown in the title.
                 * @param {boolean} isYou - Whose inventory to resolve each
                 * checklist row's own type text (see resolveItemTypeText)
                 * from.
                 * @returns {Promise<HTMLElement[]|null>} The real items to
                 * remove, or null if the user cancelled.
                 */
                function promptRemoveItems(items, itemLabel, isYou) {
                    const maxCount = items.length;

                    return new Promise((resolve) => {
                        const overlay = document.createElement('div');
                        overlay.classList.add('tf2te-remove-qty-overlay');

                        const box = document.createElement('div');
                        box.classList.add('tf2te-remove-qty-box');

                        const title = document.createElement('div');
                        title.classList.add('tf2te-remove-qty-title');
                        title.textContent = `Remove how many ${itemLabel}?`;

                        // ---- "How many" mode (original behavior) ----
                        const quantityView = document.createElement('div');

                        const slider = document.createElement('input');
                        slider.type = 'range';
                        slider.min = '1';
                        slider.max = String(maxCount);
                        slider.value = '1';
                        slider.classList.add('tf2te-remove-qty-slider');

                        // filter_search_box + tf2te-stepper, 68px wide -
                        // same classes and size "Add by position" uses (see
                        // the CSS's own note on why), not a look-alike.
                        const stepper = document.createElement('div');
                        stepper.classList.add('filter_search_box', 'tf2te-stepper');
                        stepper.style.width = '68px';
                        // Centers this fixed-width box within the modal
                        // (which is much wider) - box's own children are a
                        // plain block stack, not a flex row, so margin:auto
                        // is what centers it, same as .tf2te-remove-qty-hint's
                        // own text-align:center handles the text below it.
                        stepper.style.margin = '0 auto 4px';

                        const decBtn = document.createElement('span');
                        decBtn.classList.add('tf2te-stepper-btn');
                        decBtn.textContent = '−';

                        const input = document.createElement('input');
                        input.type = 'number';
                        input.min = '1';
                        input.max = String(maxCount);
                        input.value = '1';
                        input.classList.add('tf2te-stepper-input');

                        const incBtn = document.createElement('span');
                        incBtn.classList.add('tf2te-stepper-btn');
                        incBtn.textContent = '+';

                        const hint = document.createElement('div');
                        hint.classList.add('tf2te-remove-qty-hint');
                        hint.textContent = `1 - ${maxCount} currently in the trade`;

                        const toSpecificLink = document.createElement('a');
                        toSpecificLink.href = '#';
                        // Both links share .tf2te-remove-mode-toggle for
                        // styling, but each ALSO gets its own distinct class
                        // - neither is ever removed from the DOM (only
                        // .hidden toggles), so a bare .tf2te-remove-mode-
                        // toggle selector would be ambiguous between them
                        // (harmless for a real user, who can only click
                        // whichever is actually visible, but not for code -
                        // including a test - that queries by class alone).
                        toSpecificLink.classList.add('tf2te-remove-mode-toggle', 'tf2te-remove-mode-toggle-to-specific');
                        toSpecificLink.textContent = 'Pick specific item(s) instead';

                        stepper.appendChild(decBtn);
                        stepper.appendChild(input);
                        stepper.appendChild(incBtn);
                        quantityView.appendChild(slider);
                        quantityView.appendChild(stepper);
                        quantityView.appendChild(hint);
                        quantityView.appendChild(toSpecificLink);

                        // ---- Checklist mode ----
                        const checklistView = document.createElement('div');
                        checklistView.hidden = true;

                        const list = document.createElement('div');
                        // Same list styling promptSelectHistoryItem's own
                        // rows use - this is a checkbox <label> list, not a
                        // link list, so it gets its own row class below
                        // rather than reusing .tf2te-history-pick-row.
                        list.classList.add('tf2te-history-pick-list');

                        const checkboxes = items.map((itemEl, index) => {
                            const row = document.createElement('label');
                            row.classList.add('tf2te-history-pick-row', 'tf2te-remove-pick-row');

                            const checkbox = document.createElement('input');
                            checkbox.type = 'checkbox';
                            checkbox.classList.add('tf2te-remove-pick-checkbox');

                            const typeText = resolveItemTypeText(itemEl, isYou);
                            const text = document.createElement('span');
                            text.textContent = typeText
                                ? `Item ${index + 1} of ${items.length}: ${typeText}`
                                : `Item ${index + 1} of ${items.length}`;

                            row.appendChild(checkbox);
                            row.appendChild(text);
                            list.appendChild(row);

                            checkbox.addEventListener('change', () => updateChecklistConfirmState());
                            return checkbox;
                        });

                        const toQuantityLink = document.createElement('a');
                        toQuantityLink.href = '#';
                        toQuantityLink.classList.add('tf2te-remove-mode-toggle', 'tf2te-remove-mode-toggle-to-quantity');
                        toQuantityLink.textContent = '← Back to quantity';

                        checklistView.appendChild(list);
                        checklistView.appendChild(toQuantityLink);

                        // ---- Shared shell ----
                        const buttonRow = document.createElement('div');
                        buttonRow.classList.add('tf2te-remove-qty-buttons');

                        const cancelBtn = document.createElement('button');
                        cancelBtn.type = 'button';
                        cancelBtn.textContent = 'Cancel';
                        cancelBtn.classList.add('tf2te-remove-qty-cancel');

                        const confirmBtn = document.createElement('button');
                        confirmBtn.type = 'button';
                        confirmBtn.textContent = 'Remove';
                        confirmBtn.classList.add('tf2te-remove-qty-confirm');

                        let mode = 'quantity';

                        function close(result) {
                            document.removeEventListener('keydown', onKeyDown);
                            overlay.parentNode && overlay.parentNode.removeChild(overlay);
                            resolve(result);
                        }

                        function confirmQuantity() {
                            const parsed = parseInt(input.value, 10);

                            if (!Number.isInteger(parsed) || parsed < 1 || parsed > maxCount) {
                                stepper.classList.add('tf2te-remove-qty-invalid');
                                return;
                            }

                            close(items.slice(0, parsed));
                        }

                        function confirmChecklist() {
                            const selected = items.filter((_, index) => checkboxes[index].checked);
                            if (selected.length === 0) return;
                            close(selected);
                        }

                        function updateChecklistConfirmState() {
                            const selectedCount = checkboxes.filter((cb) => cb.checked).length;
                            confirmBtn.textContent = `Remove (${selectedCount} selected)`;
                            confirmBtn.disabled = selectedCount === 0;
                        }

                        function switchMode(nextMode) {
                            mode = nextMode;
                            const isQuantity = mode === 'quantity';
                            quantityView.hidden = !isQuantity;
                            checklistView.hidden = isQuantity;
                            title.textContent = isQuantity
                                ? `Remove how many ${itemLabel}?`
                                : `Which ${itemLabel}(s) do you want to remove?`;

                            if (isQuantity) {
                                confirmBtn.disabled = false;
                                confirmBtn.textContent = 'Remove';
                            } else {
                                updateChecklistConfirmState();
                            }
                        }

                        function onKeyDown(e) {
                            if (e.key === 'Escape') close(null);
                            else if (e.key === 'Enter' && mode === 'quantity') confirmQuantity();
                        }

                        // Shared by the stepper buttons and (indirectly, via
                        // its own 'input' listener below) typing directly -
                        // keeps input/slider and the invalid state all in
                        // sync from one place, same as
                        // stepAmountField's own reasoning for the "Add by
                        // position" fields.
                        function setQty(value) {
                            const clamped = Math.max(1, Math.min(maxCount, value));

                            input.value = String(clamped);
                            slider.value = String(clamped);
                            stepper.classList.remove('tf2te-remove-qty-invalid');
                        }

                        cancelBtn.addEventListener('click', () => close(null));
                        confirmBtn.addEventListener('click', () => {
                            if (mode === 'quantity') confirmQuantity();
                            else confirmChecklist();
                        });
                        decBtn.addEventListener('click', () => setQty((parseInt(input.value, 10) || 0) - 1));
                        incBtn.addEventListener('click', () => setQty((parseInt(input.value, 10) || 0) + 1));
                        slider.addEventListener('input', () => {
                            input.value = slider.value;
                            stepper.classList.remove('tf2te-remove-qty-invalid');
                        });
                        input.addEventListener('input', () => {
                            stepper.classList.remove('tf2te-remove-qty-invalid');

                            const parsed = parseInt(input.value, 10);
                            if (Number.isInteger(parsed) && parsed >= 1 && parsed <= maxCount) {
                                slider.value = String(parsed);
                            }
                        });
                        toSpecificLink.addEventListener('click', (e) => {
                            e.preventDefault();
                            switchMode('specific');
                        });
                        toQuantityLink.addEventListener('click', (e) => {
                            e.preventDefault();
                            switchMode('quantity');
                        });
                        overlay.addEventListener('click', (e) => {
                            if (e.target === overlay) close(null);
                        });
                        document.addEventListener('keydown', onKeyDown);

                        buttonRow.appendChild(cancelBtn);
                        buttonRow.appendChild(confirmBtn);
                        box.appendChild(title);
                        box.appendChild(quantityView);
                        box.appendChild(checklistView);
                        box.appendChild(buttonRow);
                        overlay.appendChild(box);
                        document.body.appendChild(overlay);

                        // No .select() - confirmed live that auto-
                        // highlighting the "1" read as unwanted/distracting
                        // rather than helpful, unlike a typical "replace
                        // this whole value" text field.
                        input.focus();
                    });
                }

                /**
                 * Shows a small modal listing each of a collapsed stack's
                 * real (distinct-assetid) items as its own row, in the same
                 * order they actually sit in the trade window - needed
                 * because a collapsed slot's own visible item is only ONE of
                 * several real items hiding behind it, and next.backpack.tf's
                 * per-item history page can only ever show one asset at a
                 * time, so the user has to pick which.
                 * @param {HTMLElement[]} items - Real .item elements, in
                 * trade-window order (collapseDuplicateSlots' own
                 * groupItems, already in that order since it's built from
                 * Array.from($slots.get(0).children)).
                 * @param {string} itemLabel - Item name shown in the title.
                 * @param {boolean} isYou - Whose inventory to resolve each
                 * row's own type text (see resolveItemTypeText) from.
                 */
                function promptSelectHistoryItem(items, itemLabel, isYou) {
                    const overlay = document.createElement('div');
                    overlay.classList.add('tf2te-remove-qty-overlay');

                    const box = document.createElement('div');
                    box.classList.add('tf2te-remove-qty-box');

                    const title = document.createElement('div');
                    title.classList.add('tf2te-remove-qty-title');
                    title.textContent = `Which ${itemLabel} do you want to check the history for?`;

                    const list = document.createElement('div');
                    list.classList.add('tf2te-history-pick-list');

                    // Same Cancel button promptRemoveItems already uses
                    // (reused classes, not a look-alike), for the same "go
                    // back to the trade offer without picking one" purpose. See #50.
                    const cancelBtn = document.createElement('button');
                    cancelBtn.type = 'button';
                    cancelBtn.textContent = 'Cancel';
                    cancelBtn.classList.add('tf2te-remove-qty-cancel');

                    const buttonRow = document.createElement('div');
                    buttonRow.classList.add('tf2te-remove-qty-buttons');
                    buttonRow.appendChild(cancelBtn);

                    function close() {
                        document.removeEventListener('keydown', onKeyDown);
                        overlay.parentNode && overlay.parentNode.removeChild(overlay);
                    }

                    function onKeyDown(e) {
                        if (e.key === 'Escape') close();
                    }

                    cancelBtn.addEventListener('click', close);

                    items.forEach((itemEl, index) => {
                        const assetid = itemEl.getAttribute('id').replace(/^item/, '').split('_')[2];
                        const row = document.createElement('a');
                        row.classList.add('tf2te-history-pick-row');
                        row.href = `https://next.backpack.tf/item/${assetid}`;
                        row.target = '_blank';
                        row.rel = 'noopener noreferrer';
                        // resolveItemTypeText's own note - a Strange
                        // Part/Killstreak/Spell/Paint difference can never
                        // actually reach this picker in the first place.
                        // Appended when resolvable; falls back to the plain
                        // position-only label otherwise (inventory not
                        // loaded yet, or this item's own type text is
                        // genuinely empty). See #51.
                        const typeText = resolveItemTypeText(itemEl, isYou);
                        row.textContent = typeText
                            ? `Item ${index + 1} of ${items.length}: ${typeText}`
                            : `Item ${index + 1} of ${items.length}`;
                        // Native <a> navigation still happens (not
                        // prevented) - this just also closes the picker on
                        // the same click.
                        row.addEventListener('click', close);
                        list.appendChild(row);
                    });

                    overlay.addEventListener('click', (e) => {
                        if (e.target === overlay) close();
                    });
                    document.addEventListener('keydown', onKeyDown);

                    box.appendChild(title);
                    box.appendChild(list);
                    box.appendChild(buttonRow);
                    overlay.appendChild(box);
                    document.body.appendChild(overlay);
                }

                /**
                 * Visually collapses duplicate-looking items sitting in trade
                 * slots down to one representative slot with a "xN" count
                 * badge plus a small "-" button - purely a
                 * display layer, exactly like dumpSummary's own item summary
                 * below the slots, so it never touches TRADE_STATUS or any
                 * of Steam's own slot bookkeeping directly (the "-" button
                 * goes through WINDOW.__tf2te__.removeItemsFromTrade, same
                 * underlying removal tradeSlotOverrides.js's own
                 * GTradeStateManager.RemoveItemsFromTrade patch does - see
                 * that file's own note on why it's called this way instead).
                 * A hidden slot stays a
                 * full, functional DOM element (its real item, action-menu
                 * button, everything) - just display:none - so
                 * EnsureSufficientTradeSlots' own positional child-indexing
                 * (see tradeSlotOverrides.js) is completely unaffected, and
                 * removing items lets Steam's own removal path re-render the
                 * slots exactly as it always does; this function's own caller
                 * (observeSlots' mutation-observer hook) just recomputes the
                 * grouping fresh on every slot change, so there's no manual
                 * "decrement" bookkeeping here at all - removing some
                 * instances naturally leaves the rest in the next pass.
                 * @param {boolean} isYou - Whose slots to collapse.
                 */
                function collapseDuplicateSlots(isYou) {
                    const $slots = isYou ? page.$yourSlots : page.$theirSlots;
                    const slotEls = Array.from($slots.get(0).children);

                    // Reset every slot to its default (visible, unbadged)
                    // state first - a duplicate group from the last pass may
                    // have shrunk, merged into a different group, or
                    // disappeared entirely since then, and a stale hidden
                    // slot or leftover badge/button must never survive that.
                    slotEls.forEach((slotEl) => {
                        slotEl.style.display = '';
                        const existingRow = slotEl.querySelector(`.${COLLAPSED_SLOT_OVERLAY_ROW_CLASS}`);
                        if (existingRow) slotEl.removeChild(existingRow);
                        delete slotEl.tf2teGroupItems;
                    });

                    const groups = new Map();

                    slotEls.forEach((slotEl) => {
                        const itemEl = slotEl.querySelector('div.item');
                        if (!itemEl) return; // empty slot

                        // A slot carrying Steam's own "nextTarget" class is
                        // never skipped - it can carry `has_item` too, so
                        // it always counts toward its group's badge (see
                        // #8). It is never HIDDEN, though: the groups.forEach
                        // loop below always keeps it as the group's visible
                        // representative, since display:none on a
                        // "nextTarget" slot is confirmed live to glitch the
                        // layout.
                        //
                        // A slot that fails below (e.g. a malformed/still-
                        // loading item) is simply left out of grouping this
                        // pass, rather than aborting this forEach entirely -
                        // which would otherwise silently skip every OTHER
                        // slot still left to process too, not just this one
                        // (confirmed live as a real risk under heavy/fast
                        // item-adding load, same reasoning as
                        // evaluateItems/addItemHistoryLinks' own per-item
                        // try/catch).
                        try {
                            const key = getItemVisualSignature(itemEl);
                            if (!groups.has(key)) groups.set(key, []);
                            groups.get(key).push(slotEl);
                        } catch (e) {
                            console.error('[TF2 Trading Enhancer] Failed to compute a trade slot item\'s duplicate signature:', e);
                        }
                    });

                    // Always fully collapse each duplicate group down to 1
                    // representative tile + badge, even for a small trade
                    // (keeping a minimum number of tiles visible would leave
                    // e.g. 5 duplicates in Steam's 8-slot minimum
                    // uncollapsed, with no badge). The trade box getting more
                    // compact as more of one item is added is an accepted
                    // side effect.
                    groups.forEach((groupSlotEls) => {
                        if (groupSlotEls.length < 2) return;

                        // Whichever slot carries Steam's own "nextTarget"
                        // class (if any) is always kept as the
                        // representative - see this function's own note
                        // above on why display:none on THAT specific slot
                        // is confirmed live to glitch the layout, unlike any
                        // other duplicate here. At most one member is ever
                        // expected to carry it at once; findIndex naturally
                        // falls through to the plain "first in DOM order"
                        // representative when none do.
                        const nextTargetIndex = groupSlotEls.findIndex((slotEl) => slotEl.classList.contains('nextTarget'));
                        const orderedSlotEls = nextTargetIndex > 0
                            ? [groupSlotEls[nextTargetIndex], ...groupSlotEls.slice(0, nextTargetIndex), ...groupSlotEls.slice(nextTargetIndex + 1)]
                            : groupSlotEls;

                        const [representativeEl, ...duplicateEls] = orderedSlotEls;

                        duplicateEls.forEach((slotEl) => {
                            slotEl.style.display = 'none';
                        });

                        const badge = document.createElement('div');
                        badge.classList.add(COLLAPSED_SLOT_BADGE_CLASS);
                        badge.textContent = `×${groupSlotEls.length}`;

                        // Stashed on the representative slot itself (rather
                        // than a separate closure-level map) so it's always
                        // in sync with whatever's currently badged, and
                        // automatically stale-proofed by the reset loop
                        // above deleting it every pass before groups are
                        // recomputed. The "-" button below reads this to
                        // know which real items a partial removal should
                        // target.
                        const groupItems = groupSlotEls
                            .map((slotEl) => slotEl.querySelector('div.item'))
                            .filter(Boolean);
                        representativeEl.tf2teGroupItems = groupItems;

                        // A dedicated, always-visible trigger for removing a
                        // custom amount, rather than intercepting Steam's own
                        // action-menu click (that would mean hijacking a
                        // native Steam menu in the capture phase, risking
                        // swallowing whatever else that menu offers beyond
                        // "Remove"). Purely this feature's own UI, sitting
                        // right next to the badge.
                        const decrementBtn = document.createElement('div');
                        decrementBtn.classList.add(COLLAPSED_SLOT_DECREMENT_CLASS);
                        decrementBtn.textContent = '-';
                        decrementBtn.title = 'Remove some of this stack';
                        decrementBtn.addEventListener('click', (event) => {
                            event.stopPropagation();
                            event.preventDefault();

                            const itemEl = representativeEl.querySelector('div.item');
                            const itemLabel = (itemEl && resolveItemName(itemEl, isYou)) || 'items';

                            promptRemoveItems(groupItems, itemLabel, isYou).then((itemsToRemove) => {
                                if (!itemsToRemove || itemsToRemove.length === 0) return;
                                WINDOW.__tf2te__.removeItemsFromTrade(itemsToRemove);
                            });
                        });

                        const overlayRow = document.createElement('div');
                        overlayRow.classList.add(COLLAPSED_SLOT_OVERLAY_ROW_CLASS);
                        overlayRow.appendChild(badge);
                        overlayRow.appendChild(decrementBtn);
                        representativeEl.appendChild(overlayRow);
                    });
                }

                /**
                 * Adds a small top-right link icon to EVERY trade slot that
                 * currently holds an item (not just collapsed-stack
                 * representatives, unlike the badge/"-" button above) -
                 * opens that exact item's own next.backpack.tf page
                 * (https://next.backpack.tf/item/{assetid} - a per-asset
                 * history/listing page next.backpack.tf itself links to,
                 * confirmed live) in a new tab.
                 *
                 * A slot that's a collapsed-stack representative (has
                 * collapseDuplicateSlots' own tf2teGroupItems, length > 1) is
                 * a special case: its own visible .item is only ONE of
                 * several real, distinct-assetid items hiding behind it, so
                 * a single direct link would silently pick one arbitrarily
                 * and hide the rest - the icon opens promptSelectHistoryItem
                 * instead, letting the user pick which one by its position
                 * in the trade window (the only thing distinguishing
                 * otherwise-identical items).
                 *
                 * Rebuilds the link from scratch every pass rather than
                 * patching an existing one in place - simpler than trying to
                 * toggle between "plain link" and "picker button" behavior
                 * on a reused element (group membership can change from one
                 * pass to the next as items are added/removed), and matches
                 * collapseDuplicateSlots' own reset-then-rebuild pattern for
                 * its badge/"-" button. Also naturally keeps this correct
                 * across Steam reusing the same slot element positionally
                 * for a different item over time (see EnsureSufficientTradeSlots
                 * in tradeSlotOverrides.js) - there's no stale state to leak
                 * across a swap when nothing is reused.
                 * @param {boolean} isYou - Whose slots to add links to.
                 */
                function addItemHistoryLinks(isYou) {
                    const $slots = isYou ? page.$yourSlots : page.$theirSlots;
                    const slotEls = Array.from($slots.get(0).children);

                    slotEls.forEach((slotEl) => {
                        // A slot that fails here (e.g. a malformed/still-
                        // loading item) is simply left without a history
                        // link this pass, rather than aborting this forEach
                        // entirely - which would otherwise silently skip
                        // every OTHER slot still left to process too, not
                        // just this one. Confirmed live: this is what made
                        // the history icon "randomly" missing on some items
                        // under heavy/fast item-adding load - one bad item
                        // partway through the slot list, and everything
                        // after it in the same pass never got its icon
                        // either (see observeSlots' own summarize() note for
                        // the other half of this).
                        try {
                            const existingLink = slotEl.querySelector(`.${ITEM_HISTORY_LINK_CLASS}`);
                            if (existingLink) slotEl.removeChild(existingLink);

                            // A "nextTarget"-marked slot is NOT skipped here:
                            // unlike collapseDuplicateSlots (which hides
                            // slots), this only APPENDS a small link and
                            // never touches visibility/position, so that
                            // slot's layout glitch doesn't apply. Steam keeps
                            // the class on the same slot persistently, so
                            // skipping it would leave that item without a
                            // history icon for good.
                            const itemEl = slotEl.querySelector('div.item');
                            if (!itemEl) return; // empty slot

                            const assetid = itemEl.getAttribute('id').replace(/^item/, '').split('_')[2];
                            if (!assetid) return;

                            const link = document.createElement('a');
                            link.classList.add(ITEM_HISTORY_LINK_CLASS);
                            link.title = 'View item history on backpack.tf';
                            link.innerHTML = ITEM_HISTORY_ICON_SVG;

                            // Set by collapseDuplicateSlots (runs first in the
                            // same pass - see observeSlots), only on a
                            // representative slot with 2+ collapsed items.
                            const groupItems = slotEl.tf2teGroupItems;

                            if (groupItems && groupItems.length > 1) {
                                link.href = 'javascript:void(0)';
                                link.addEventListener('click', (event) => {
                                    event.stopPropagation();
                                    event.preventDefault();

                                    const itemLabel = resolveItemName(itemEl, isYou) || 'items';
                                    promptSelectHistoryItem(groupItems, itemLabel, isYou);
                                });
                            } else {
                                link.href = `https://next.backpack.tf/item/${assetid}`;
                                link.target = '_blank';
                                link.rel = 'noopener noreferrer';
                                // Only needs to keep the click from also reaching
                                // Steam's own slot click handling (item
                                // selection/drag) - the actual navigation is
                                // native <a> behavior, not something this
                                // handler does, so middle-click/ctrl-click still
                                // work.
                                link.addEventListener('click', (event) => {
                                    event.stopPropagation();
                                });
                            }

                            slotEl.appendChild(link);
                        } catch (e) {
                            console.error('[TF2 Trading Enhancer] Failed to add a history link to a trade slot item:', e);
                        }
                    });
                }

                /**
                 * Summarize a user's items in trade offer.
                 * @param {boolean} isYou - Is this your summary?
                 */
                function summarize(isYou) {
                    const name = isYou ? 'My' : 'Their';
                    const user = isYou ? UserYou : UserThem;
                    const $slots = isYou ? page.$yourSlots : page.$theirSlots;
                    const $container = isYou ? page.$yourSummary : page.$theirSummary;
                    const itemsList = $slots.get(0).querySelectorAll('div.item');
                    const html = dumpSummary(name, itemsList, isYou, user);

                    $container.html(html);
                }

                // Mirrors utils/tf2Quality.js's QUALITY_ID_BY_NAME,
                // utils/tf2StatsLinks/index.js's ITEMS_QUALITY/ITEMS_CRAFTABILITY,
                // and utils/tf2ItemName.js's stripNamePrefix - duplicated
                // here rather than imported, since this whole file runs as a
                // classic (non-module) MAIN-world script (see this file's own
                // header) and can't use import/export at all. Keep in sync
                // with those if quality ids or prefix words ever change.
                const QUALITY_ID_BY_NAME = {
                    Normal: 0,
                    Genuine: 1,
                    Vintage: 3,
                    Unusual: 5,
                    Unique: 6,
                    'Self Made': 9,
                    Strange: 11,
                    Haunted: 13,
                    'Collector\'s': 14,
                    'Decorated Weapon': 15
                };
                const ITEMS_QUALITY = ['Unique', 'Strange', 'Vintage', 'Haunted', 'Unusual', 'Genuine', 'Self Made', 'Collector\'s'];
                const NAME_PREFIX_PATTERN = /^(Killstreak |Specialized Killstreak |Professional Killstreak |Strange |Vintage |Collector's |Haunted |Unusual |Genuine |Self Made )/i;
                // Matches only the killstreak-tier words (not quality) - used to
                // recover the tier text separately, since it has to be re-added
                // to bareName below instead of being discarded like a quality
                // prefix (see resolvePricingTarget's own note).
                const KILLSTREAK_TIER_PATTERN = /(Killstreak |Specialized Killstreak |Professional Killstreak )/i;
                // Unique-quality items whose real name starts with "Strange" -
                // same set as utils/tf2ItemName.js's LITERAL_STRANGE_NAME_PATTERN.
                const LITERAL_STRANGE_NAME_PATTERN =
                    /^(?:Strange Part:|Strange Cosmetic Part:|Strange Filter:|Strange Count Transfer Tool$|Strange Bacon Grease$)/i;

                function stripNamePrefix(name) {
                    // Checks whether the NAME ITSELF is one of the known
                    // Unique-quality items whose real name happens to start
                    // with the word "Strange" (e.g. "Strange Part: Kills
                    // While Übercharged", "Strange Count Transfer Tool" -
                    // see utils/tf2ItemName.js's own copy of this same fix
                    // for the confirmed-live report) - NOT whether some other
                    // item merely has one or more Strange Parts ATTACHED to
                    // it, a completely unrelated concept (a different item's
                    // own descriptive attribute, see this file's own
                    // shared.js sibling's isStrangePartAttached) that has
                    // nothing to do with quality-word stripping at all.
                    if (LITERAL_STRANGE_NAME_PATTERN.test(name)) return name;

                    let stripped = name;
                    let match;
                    while ((match = NAME_PREFIX_PATTERN.exec(stripped))) {
                        stripped = stripped.slice(match[0].length);
                    }
                    return stripped;
                }

                /** 
                 * Clears items that were added to the offer.
                 */
                function clearItemsInOffer($addedItems) {
                    const items = $addedItems.find('div.item').get();

                    // remove all at once - see tradeSlotOverrides.js's own
                    // note on why this goes through window.__tf2te__ rather
                    // than WINDOW.GTradeStateManager.RemoveItemsFromTrade
                    // directly.
                    WINDOW.__tf2te__.removeItemsFromTrade(items.reverse());
                }
                
                /**
                 * Add items to trade.
                 * @param {HTMLElement[]} itemsList - List of items to add.
                 */
                function addItemsByElements(itemsList) {
                    if (WINDOW.Economy_UseResponsiveLayout() && WINDOW.ResponsiveTrade_SwitchMode) {
                        WINDOW.ResponsiveTrade_SwitchMode(0);
                    }
                    
                    const slotsCache = {};
                    
                    for (let i = 0; i < itemsList.length; i++) {
                        const elItem = itemsList[i];
                        
                        if (WINDOW.BIsInTradeSlot(elItem)) {
                            // already in trade
                            continue;
                        }
                        
                        const item = elItem.rgItem;
                        
                        // we don't want to touch it
                        if (item.is_stackable) {
                            continue;
                        }
                        
                        const xferAmount = 1;
                        const is_currency = false;
                        const { g_rgCurrentTradeStatus } = WINDOW;
                        const userslots = item.is_their_item ? g_rgCurrentTradeStatus.them : g_rgCurrentTradeStatus.me;
                        const slots = is_currency ? userslots.currency : userslots.assets;
                        let bChanged = false;
                        
                        const slotsCacheKey = item.is_their_item ? 'them' : 'me';
                        const slotsCacheCurrencyKey = is_currency ? 'currency' : 'asset';
                        
                        if (!slotsCache[slotsCacheKey]) {
                            slotsCache[slotsCacheKey] = {};
                        }
                        
                        if (!slotsCache[slotsCacheKey][slotsCacheCurrencyKey]) {
                            // caching existing slots for faster lookup
                            slotsCache[slotsCacheKey][slotsCacheCurrencyKey] = slots
                                .reduce((accum, slot, i) => {
                                    accum[slot.appid + '_' + slot.contextid + '_' + slot.id] = i;
                                    return accum;
                                }, {});
                        }
                        
                        // find existing element
                        const key = item.appid + '_' + item.contextid + '_' + item.id;
                        const iExistingElement = slotsCache[slotsCacheKey][slotsCacheCurrencyKey][key];
                        
                        if (iExistingElement !== undefined) {
                            if (slots[iExistingElement].amount !== xferAmount) {
                                slots[iExistingElement].amount = xferAmount;
                                bChanged = true;
                            }
                        } else {
                            const oSlot = {
                                appid: item.appid,
                                contextid: item.contextid,
                                amount: xferAmount
                            };
                            
                            if (is_currency) {
                                oSlot.currencyid = item.id;
                            } else {
                                oSlot.assetid = item.id;
                            }
                            
                            slots.push(oSlot);
                            // update the cache
                            // maybe not entirely necessary
                            slotsCache[slotsCacheKey][slotsCacheCurrencyKey][key] = slots.length - 1;
                            bChanged = true;
                        }
                        
                        if (!bChanged) {
                            continue;
                        }
                        
                        WINDOW.GTradeStateManager.m_bChangesMade = true;
                    }
                    
                    // update the trade status
                    WINDOW.g_rgCurrentTradeStatus.version++;
                    WINDOW.RefreshTradeStatus(WINDOW.g_rgCurrentTradeStatus);
                }
                
                /**
                 * Clear items in offer.
                 * @param {Object} $addedItems - JQuery object of items to remove.
                 */
                function clear($addedItems) {
                    clearItemsInOffer($addedItems);
                }
                
                /**
                 * Update display of buttons.
                 * @param {boolean} isYou - Is your inventory selected?
                 * @param {(string|number)} appid - App ID of inventory selected.
                 */
                function updateDisplay(isYou, appid) {
                    // update the state of the button
                    const updateState = ($btn, show) => {
                        if (show) {
                            $btn.show();
                        } else {
                            $btn.hide();
                        }
                    };
                    const isTF2 = appid == 440;
                    const isCSGO = appid == 730;
                    const listingIntent = urlParams.listing_intent;
                    // show keys button for tf2 and csgo
                    const showKeys = isTF2 || isCSGO;
                    const showMetal = isTF2;
                    // 0 = buy order
                    // 1 = sell order
                    // we are buying, add items from our inventory
                    const isBuying = Boolean(
                        isYou &&
                        listingIntent == 1
                    );
                    const isSelling = Boolean(
                        !isYou &&
                        listingIntent == 0
                    );
                    const showListingButton = Boolean(
                        isTF2 &&
                        (
                            isBuying ||
                            isSelling
                        )
                    );
                    // Sell listing (for_item set): the item to add more of is
                    // a specific asset in THEIR inventory (see addListingItem)
                    // - only makes sense while looking at their inventory tab.
                    // Buy listing (for_item unset, for_item_name set instead -
                    // see backpack.tf/{oldUI,nextUI}/fixTradeOfferLinks/content.js on why there's no
                    // specific asset for those): fulfilling it means adding a
                    // matching item from YOUR OWN inventory instead, so the
                    // button shows on the opposite tab for that case.
                    const showListingItemButton = Boolean(
                        (!isYou && urlParams.for_item !== undefined) ||
                        (isYou && listingIntent == 0 && urlParams.for_item_name !== undefined)
                    );

                    updateState(page.btns.$items, true);
                    updateState(page.btns.$keys, showKeys);
                    updateState(page.btns.$metal, showMetal);
                    updateState(page.btns.$listing, showListingButton);
                    updateState(page.btns.$listingItem, showListingItemButton);

                    // The whole Add Keys/Add Metals/Add Recent row and the
                    // "Your/Their total pure" panel only mean anything for
                    // TF2 - hide both while a different app's inventory is
                    // the one currently visible (on EITHER side/tab, not
                    // just "yours" - appid here already reflects whichever
                    // one that is, per this function's own callers:
                    // appChanged/userChanged). Clear my items/Clear their
                    // items ($clearMy/$clearTheir) are deliberately NOT
                    // included here - unlike the rest of this cluster they
                    // aren't currency-specific at all (they clear whatever's
                    // already added, any game), so they stay visible
                    // regardless of which app is showing.
                    updateState(page.btns.$addBtnsRow, isTF2);
                    // Not built yet the very first time updateDisplay runs
                    // for a page with no .trade_partner_header at all (see
                    // this file's own "warn about a trade partner" block,
                    // the only place page.pureTotalsRow is ever set) -
                    // guarded rather than assumed present.
                    if (page.pureTotalsRow) {
                        page.pureTotalsRow.style.display = isTF2 ? 'inline-flex' : 'none';
                    }
                }
                
                /**
                 * Call when a different user's inventory is selected.
                 * @param {Object} $inventoryTab - JQuery element of inventory tab selected.
                 */
                function userChanged($inventoryTab) {
                    // fallback option for getting appid
                    function appIdFallback() {
                        // fallback to appid from image
                        const src = page.get.$appSelectImg().attr('src') || '';
                        const match = src.match(/public\/images\/apps\/(\d+)/);
                        
                        return match && match[1];
                    }
                    
                    const $inventory = page.get.$inventory();
                    const isYou = $inventoryTab.attr('id') === 'inventory_select_your_inventory';
                    // Confirmed live: $inventory can be an empty selection
                    // (no ".inventory_ctn:visible" element yet) when this
                    // runs before the trade partner's own inventory has
                    // finished loading (still mid-flight on its own
                    // foreigninventory XHR at page-load time) - .attr('id')
                    // on an empty jQuery selection is undefined, and calling
                    // .match() directly on that threw uncaught, aborting the
                    // rest of main()'s own synchronous setup (most
                    // importantly, the installTradeSlotOverrides call at the
                    // very end - see tradeSlotOverrides.js's own note on why
                    // that matters). The "|| ''" mirrors appIdFallback's own
                    // existing guard just above for the exact same reason:
                    // fall through to it gracefully instead of crashing:
                    // whichever inventory loads next re-runs updateDisplay
                    // via the "observe inventory changes" block below anyway.
                    const inventoryId = $inventory.attr('id') || '';
                    const match = inventoryId.match(/(\d+)_(\d+)$/);
                    const appid = (match && match[1]) || appIdFallback();
                    
                    // now update the display
                    updateDisplay(isYou, appid);
                }
                
                return {
                    summarize,
                    collapseDuplicateSlots,
                    addItemHistoryLinks,
                    addItemsByElements,
                    clear,
                    updateDisplay,
                    userChanged
                };
            }());

            /**
             * Shows a small modal displaying a message, in place of the
             * browser's own native alert() dialog (unstylable, blocks the
             * whole page, and gets prefixed with "steamcommunity.com
             * says"). Dismissible via the OK button, Escape, Enter, or
             * clicking outside the box. Fire-and-forget (no return value,
             * doesn't block) - fine since every call site in this file
             * already does nothing but `alert(...); return;`, with nothing
             * depending on the user having dismissed it first. Declared
             * here at the top level (not inside tradeOfferWindow's own
             * closure above, nor any of the later bare blocks) since
             * callers are spread across several of those mutually-
             * invisible blocks (addItemsByName/addKeys/addMetal/
             * addByPosition/addListingPrice/addListingItem in "binds
             * events to elements", plus the buy/sell auto-add closures in
             * "register inventory events").
             * @param {string} message - Message to display.
             */
            function showAlert(message) {
                const overlay = document.createElement('div');
                overlay.classList.add('tf2te-alert-overlay');

                const box = document.createElement('div');
                box.classList.add('tf2te-alert-box');

                const messageEl = document.createElement('div');
                messageEl.classList.add('tf2te-alert-message');
                messageEl.textContent = message;

                const buttonRow = document.createElement('div');
                buttonRow.classList.add('tf2te-alert-buttons');

                const okBtn = document.createElement('button');
                okBtn.type = 'button';
                okBtn.textContent = 'OK';
                okBtn.classList.add('tf2te-alert-ok');

                function close() {
                    document.removeEventListener('keydown', onKeyDown);
                    overlay.parentNode && overlay.parentNode.removeChild(overlay);
                }

                function onKeyDown(e) {
                    if (e.key === 'Escape' || e.key === 'Enter') close();
                }

                okBtn.addEventListener('click', close);
                overlay.addEventListener('click', (e) => {
                    if (e.target === overlay) close();
                });
                document.addEventListener('keydown', onKeyDown);

                buttonRow.appendChild(okBtn);
                box.appendChild(messageEl);
                box.appendChild(buttonRow);
                overlay.appendChild(box);
                document.body.appendChild(overlay);

                okBtn.focus();
            }

            /**
             * Manage inventory load events.
             * @namespace inventoryManager
             */
            const inventoryManager = (function() {
                const inventories = {};
                const users = {};
                
                users[STEAMID] = [];
                users[PARTNER_STEAMID] = [];
                inventories[STEAMID] = {};
                inventories[PARTNER_STEAMID] = {};
                
                /**
                 * An inventory has loaded, call all events according to parameters.
                 * @param {string} steamid - Steamid of user.
                 * @param {string} appid - Appid of inventory loaded.
                 * @param {string} contextid - Contextid of inventory loaded.
                 */
                function call(steamid, appid, contextid) {
                    // Only the two trade parties are tracked; anything else
                    // (an #inventories child whose id isn't
                    // inventory_{steamid}_{appid}_{contextid}) is ignored
                    // rather than throwing on the spread below.
                    if (!users[steamid]) {
                        return;
                    }

                    const actions = [
                        ...users[steamid],
                        ...((inventories[steamid][appid] && inventories[steamid][appid][contextid]) || [])
                    ];
                    
                    // clear only this contextid's callbacks, not the whole appid bucket
                    users[steamid] = [];
                    if (inventories[steamid][appid]) {
                        delete inventories[steamid][appid][contextid];
                    }
                    // call all functions
                    actions.forEach(fn => fn(steamid, appid, contextid));
                }
                
                /**
                 * Registers an event.
                 * @param {string} steamid - Steamid for user.
                 * @param {string)} appid - Appid of event, or app-agnostic function to be called.
                 * @param {string)} [contextid] - Contextid of app.
                 * @param {function} [fn] - Function to call when inventory is loaded.
                 */
                function register(steamid, appid, contextid, fn) {
                    if (!fn) {
                        fn = appid;
                        users[steamid].push(fn);
                    } else {
                        if (!inventories[steamid][appid]) {
                            inventories[steamid][appid] = {};
                        }
                        
                        if (!inventories[steamid][appid][contextid]) {
                            inventories[steamid][appid][contextid] = [];
                        }
                        
                        inventories[steamid][appid][contextid].push(fn);
                    }
                }
                
                return {
                    register,
                    call
                };
            }());
                
            /**
             * Result of getItems.
             * @typedef {Object} GetItemsResult
             * @property {HTMLElement[]} items - Items found.
             * @property {boolean} satisfied - Was the amount satisfied?
             */
            
            /**
             * Collect items based on conditions.
             * @param {string} mode - Mode e.g. 'ITEMS' to add items, 'KEYS' to add keys.
             * @param {number} amount - Amount of items to add.
             * @param {number} index - Index to start adding at.
             * @param {boolean} isYou - Are we adding from your inventory?
             * @returns {GetItemsResult} The items and whether the amount was satisfied.
             */
            const collectItems = (function() {
                // Mirrors utils/tf2Currency.js's own CRAFT_WEAPON_VALUE_REFINED
                // - duplicated here rather than imported, same reasoning
                // this file's own QUALITY_ID_BY_NAME/etc. already document
                // (a classic, non-module MAIN-world script can't use
                // import/export at all). Keep in sync if that value ever
                // changes. Used by getItemsForMetal's own craft-weapon
                // fallback, below.
                const CRAFT_WEAPON_VALUE_REFINED = 0.05;

                // used for identifying items
                const identifiers = {
                    // item is key
                    isKey(item) {
                        switch (parseInt(item.appid)) {
                            case 440:
                                return item.market_hash_name === 'Mann Co. Supply Crate Key';
                            case 730:
                                return identifiers.hasTag(item, 'Type', 'Key');
                        }
                        
                        return null;
                    },
                    // item has tag
                    hasTag(item, tagName, tagValue) {
                        if (!item.tags) return null;
                        
                        const tags = item.tags;
                        
                        for (let i = 0, n = tags.length; i < n; i++) {
                            const tag = tags[i];
                            const hasTag = Boolean(
                                tag.category === tagName &&
                                tagValue === tag.name
                            );
                            
                            if (hasTag) {
                                return true;
                            }
                        }
                        
                        return null;
                    }
                };
                // used for finding items
                const finders = {
                    metal(isYou, amount, index, name) {
                        return pickItems(isYou, amount, index, (item) => {
                            return Boolean(
                                // the item is from tf2
                                item.appid == 440 &&
                                // the market hash name is the same as the name
                                item.market_hash_name === name
                            );
                        });
                    },
                    // return items by array of id's
                    id(ids) {
                        const filter = (item) => {
                            return ids.indexOf(item.id) !== -1;
                        };
                        const items = pickItems(null, ids.length, 0, filter).sort((a, b) => {
                            return ids.indexOf(a.id) - ids.indexOf(b.id);
                        });

                        return items;
                    },
                    // return items matching a market hash name, regardless of app -
                    // added so identically-named but individually-tracked items
                    // (e.g. 3 separate Strange Shovels - not Steam "stackable"
                    // items, just items sharing a name) can be added by name +
                    // amount instead of one at a time or by raw index position
                    name(isYou, amount, index, name) {
                        return pickItems(isYou, amount, index, (item) => {
                            // Also matches with a "Taunt: " prefix stripped off the
                            // item's own market_hash_name - confirmed live that
                            // backpack.tf's listing rows display a Taunt's bare name
                            // (e.g. "Rocket Jockey") without the "Taunt: " prefix
                            // Steam's own market_hash_name always carries, so
                            // fixTradeOfferLinks' for_item_name/cachedListingItemName
                            // for a Taunt buy listing never matches on an exact
                            // comparison alone.
                            return (
                                item.market_hash_name === name ||
                                item.market_hash_name.replace(/^Taunt:\s*/i, '') === name
                            );
                        });
                    }
                };
                
                /**
                 * Pick items from inventory.
                 * @param {(boolean|null)} isYou - Pick items from your inventory? null for both.
                 * @param {number} amount - Amount of items to pick.
                 * @param {number} index - Index to start picking items at.
                 * @param {function(Object): boolean} filter - Filter method. Returns true to pick the item.
                 * @returns {Object[]} Array of picked items from inventory. These are *not* elements.
                 */
                function pickItems(isYou, amount, index, filter) {
                    function getItems(isYou) {
                        const $items = (isYou ? page.$yourSlots : page.$theirSlots).find('.item');
                        const inventory = getInventory(appid, contextid, isYou);
                        // get ids of items in trade offer matching app
                        const addedIDs = $items.toArray().reduce((arr, el) => {
                            const item = el.rgItem;
                            const assetid = item.id;
                            
                            // appids could be string or number
                            if (item.appid == appid) {
                                arr.push(assetid);
                            }
                            
                            return arr;
                        }, []);
                        const ids = Object.keys(inventory);
                        const total = [];
                        let items = [];
                        let currentIndex = 0;
                        
                        if (index < 0) {
                            // select in reverse
                            // since -1 is the starting position we add 1 to it before inverting it
                            index = (index + 1) * -1;
                            ids.reverse();
                        }
                        
                        // items will always be sorted from front-to-back by default
                        for (let i = 0; i < ids.length; i++) {
                            const id = ids[i];
                            const item = inventory[id];
                            
                            if (addedIDs.indexOf(id) !== -1) {
                                // id of item is already in trade offer
                                if (index !== 0 && filter(item)) {
                                    currentIndex++; // increment if item matches
                                }
                                
                                continue;
                            } else if (items.length >= amount) {
                                // break when amount has been reached
                                break;
                            } else if (filter(item)) {
                                if (currentIndex >= index) {
                                    items.push(item);
                                }
                                
                                // add items to total in case amount is not met
                                total.push(item);
                                currentIndex++;
                            }
                        }
                        
                        // Amount not met from `index` onward: pad out from
                        // `total`, which also holds matching items that came
                        // before `index`.
                        if (items.length < amount) {
                            items = total.splice(offsetIndex(index, amount, total.length), amount);
                        }
                        
                        return items;
                    }
                    
                    const { appid, contextid } = getInventoryContext();

                    // No inventory visible yet (e.g. still loading): nothing
                    // can be picked. An empty list, not undefined, so callers
                    // report "none available" instead of throwing on it.
                    if (!appid) {
                        return [];
                    }
                    
                    if (isYou === null) {
                        // get items for both users
                        return Utils.flatten([
                            true,
                            false
                        ].map(getItems));
                    }
                    
                    // get items for user based on whether 'isYou' is truthy or falsy
                    return getItems(isYou);
                }
                
                /**
                 * Offset index to pick items at based on amount and number of items available.
                 * @param {number} index - Index.
                 * @param {number} amount - Amount of items to pick.
                 * @param {number} length - The total number of items available.
                 * @returns {number} Modified index.
                 */
                function offsetIndex(index, amount, length) {
                    if (index < 0) {
                        // pick from back if index is negative
                        return Math.max(0, length - (amount + index + 1));
                    }
                    
                    if (index + amount >= length) {
                        // offset if index + amount is greater than the number of items we can pick
                        return Math.max(0, length - amount);
                    }
                    
                    // no offset needed
                    return index; 
                }
                
                /**
                 * Asset object.
                 * @typedef {Object} Item
                 * @property {string} appid - AppID of item.
                 * @property {string} contextid - ContextID of item.
                 * @property {string} id - ID of item.
                 */
                
                /**
                 * Get elements for items.
                 * @param {Item[]} items - Items to get elements for.
                 * @returns {HTMLElement[]} Elements for items.
                 */
                function getElementsForItems(items) {
                    return items
                        .map((item) => {
                            // get element id for each item
                            const id = `item${item.appid}_${item.contextid}_${item.id}`;
                            
                            return document.getElementById(id);
                        })
                        .filter(el => el !== null);
                }
                
                /**
                 * Pick metal (and, if that alone can't reach the target,
                 * craftable weapons - see below) from items based on value
                 * in refined metal.
                 *
                 * Builds a small, fixed set of candidates (at most 2 choices -
                 * floor and floor+1, wherever the extra unit is actually
                 * available - at each of Refined, Reclaimed, and Scrap, at
                 * most 8 total combinations), tops each one off with whatever
                 * craft weapons (craftWeaponNames - see this file's own
                 * broadcast-listener note) best cover its own remaining gap,
                 * and keeps whichever FULL combination lands closest to the
                 * true amount - never a per-denomination decision made in
                 * isolation (greedily flooring each denomination in turn
                 * can't reconsider an earlier choice).
                 * @param {(boolean|null)} isYou - Pick items from your inventory? null for both.
                 * @param {number} amount - Value to make in metal (e.g. 13.33).
                 * @param {number} index - Index to add at.
                 * @returns {GetItemsResult} The items and whether the amount was satisfied.
                 * See #5.
                 */
                function getItemsForMetal(isYou, amount, index) {
                    // Floating-point ref arithmetic needs a tolerance
                    // rather than exact equality throughout - doubly so
                    // here, since a craft weapon's own 0.05 ref value
                    // doesn't evenly divide 1 Scrap's own 1/9 ref (0.05 * 9
                    // = 0.45, not a whole number), so metal and weapons
                    // never share a common clean integer unit.
                    const EPSILON = 1e-6;

                    // Each candidate is { total, items } - a specific,
                    // fully-resolved combination of real items and the ref
                    // value they add up to. Starts as a single "nothing
                    // picked yet" candidate; each metal denomination below
                    // AT MOST doubles the list (only when the "+1" unit is
                    // actually available to pick at all) rather than
                    // replacing it, so every viable combination survives to
                    // the final comparison instead of an earlier step
                    // locking in a choice the later ones can't reconsider.
                    let candidates = [{ total: 0, items: [] }];

                    [
                        { type: 'Refined Metal', value: 1 },
                        { type: 'Reclaimed Metal', value: 1 / 3 },
                        { type: 'Scrap Metal', value: 1 / 9 }
                    ].forEach(({ type, value }) => {
                        const next = [];

                        candidates.forEach((candidate) => {
                            const remaining = Math.max(0, amount - candidate.total);
                            const floorCount = Math.floor((remaining + EPSILON) / value);
                            // Queried once for floorCount + 1 - however many
                            // actually come back also tells us for free
                            // whether the "+1" candidate below is even
                            // possible, no second query needed.
                            const found = finders.metal(isYou, floorCount + 1, index, type);

                            const floorItems = found.slice(0, floorCount);
                            next.push({ total: candidate.total + floorItems.length * value, items: candidate.items.concat(floorItems) });

                            if (found.length > floorCount) {
                                const extraItems = found.slice(0, floorCount + 1);
                                next.push({ total: candidate.total + extraItems.length * value, items: candidate.items.concat(extraItems) });
                            }
                        });

                        candidates = next;
                    });

                    // Craft weapons close out whatever's left of EACH
                    // surviving metal candidate - same nearest-count
                    // reasoning every candidate gets independently, not just
                    // one "greedy" combination. Rounds to the NEAREST
                    // weapon count (not always up) - deliberately allows a
                    // candidate to land marginally under the target when
                    // that's genuinely closer than the next weapon up would
                    // overshoot by; see the final satisfied calculation
                    // below for why that's safe.
                    const weaponNameSet = new Set(craftWeaponNames);
                    candidates = candidates.map((candidate) => {
                        const gap = amount - candidate.total;
                        const weaponsNeeded = gap > EPSILON && craftWeaponNames.length > 0 ? Math.round(gap / CRAFT_WEAPON_VALUE_REFINED) : 0;

                        if (weaponsNeeded <= 0) {
                            return candidate;
                        }

                        const weaponItems = pickItems(isYou, weaponsNeeded, index, (item) => item.appid == 440 && weaponNameSet.has(item.market_hash_name));

                        return {
                            total: candidate.total + weaponItems.length * CRAFT_WEAPON_VALUE_REFINED,
                            items: candidate.items.concat(weaponItems)
                        };
                    });

                    // Picks whichever fully-resolved candidate lands closest
                    // to the true amount - ties (within a margin, not exact
                    // float equality) go to whichever uses FEWER items,
                    // matching this same feature's own established "fewest
                    // items, highest denominations first" preference (see
                    // the "Add Metal picks the fewest metal items" test)
                    // rather than an arbitrary one among near-equally-close
                    // options.
                    //
                    // A full craft weapon's own value - large enough to
                    // treat "close enough that no one would notice or care"
                    // as tied and defer to item count, while every confirmed
                    // worked example (the "1.44 ref" and "0.5 ref" cases -
                    // see this function's own header note) stays outside this
                    // margin. A tighter margin picks a worse, more-items
                    // combination over a near-identically-precise
                    // fewer-items one. See #22.
                    const TIE_MARGIN = CRAFT_WEAPON_VALUE_REFINED;
                    const best = candidates.reduce((current, candidate) => {
                        const distanceDiff = Math.abs(candidate.total - amount) - Math.abs(current.total - amount);
                        if (distanceDiff < -TIE_MARGIN) return candidate; // meaningfully closer
                        if (distanceDiff > TIE_MARGIN) return current; // meaningfully closer already
                        return candidate.items.length < current.items.length ? candidate : current; // near-tie - prefer fewer items
                    });

                    const total = best.total;
                    const items = getElementsForItems(best.items);
                    // A weapon-involving candidate can land marginally UNDER
                    // amount (see this function's own header note on why
                    // that's intentional, not a bug) - tolerating that is
                    // only safe bounded by half a weapon's own value, and
                    // only once weapons were genuinely available to be
                    // considered at all. With no craft-weapon names known,
                    // this reduces to the exact same strict "reached or
                    // exceeded" check this function always used.
                    const tolerance = craftWeaponNames.length > 0 ? CRAFT_WEAPON_VALUE_REFINED / 2 + EPSILON : EPSILON;
                    const satisfied = amount - total <= tolerance;

                    return {
                        items,
                        satisfied,
                        // Total value actually achievable from what's
                        // available - lets a caller report "you asked for X
                        // ref but only Y is achievable" without a separate
                        // re-scan.
                        achievedRefined: total
                    };
                }
                
                /**
                 * Gets all visible items in the currently active inventory, in
                 * display order (or reversed - front-to-back becomes
                 * back-to-front - when `index` is negative, same "select from
                 * the end" convention `offsetIndex` and `pickItems` use
                 * elsewhere). Shared by the 'RECENT' and 'ITEMS' cases
                 * below.
                 * @param {number} index - Index to select at (negative selects from the end).
                 * @returns {{found: HTMLElement[], index: number}} Visible items in
                 * the chosen order, and `index` adjusted to a non-negative
                 * position if it was negative (unchanged otherwise).
                 */
                function getVisibleInventoryItems(index) {
                    // check if an item is visible on page
                    // the item itself will not contain the display property, but its parent does
                    function isVisible(_i, el) {
                        return el.parentNode.style.display !== 'none';
                    }

                    // select all visible items from active inventory
                    let found = page.get.$inventory().find('div.item').filter(isVisible).toArray();

                    // select in reverse
                    if (index < 0) {
                        index = (index + 1) * -1;
                        found = found.reverse();
                    }

                    return { found, index };
                }

                /**
                 * Collect items based on conditions.
                 * @param {string} mode - Mode e.g. 'ITEMS' to add items, 'KEYS' to add keys.
                 * @param {number} amount - Amount of items to add.
                 * @param {number} index - Index to start adding at.
                 * @param {(boolean|null)} isYou - Pick items from your inventory? null for both.
                 * @returns {GetItemsResult} The items and whether the amount was satisfied.
                 * @throws {Error} Unknown mode.
                 */
                function getItems(mode, amount, index, isYou) {
                    switch (mode) {
                        // get keys
                        case 'KEYS': {
                            const found = pickItems(isYou, amount, index, identifiers.isKey);
                            const items = getElementsForItems(found);
                            const satisfied = amount === items.length;
                            
                            return {
                                items,
                                satisfied
                            };
                        }
                        // get amount of metal (keys, ref, scrap);
                        case 'METAL': {
                            const {
                                items,
                                satisfied,
                                achievedRefined
                            } = getItemsForMetal(isYou, amount, index);

                            return {
                                items,
                                satisfied,
                                achievedRefined
                            };
                        }
                        // get items by id
                        case 'ID': {
                            // list of id's is passed through index
                            const ids = index;
                            const found = finders.id(ids);
                            const items = getElementsForItems(found);
                            const satisfied = ids.length === items.length;

                            return {
                                items,
                                satisfied
                            };
                        }
                        // get items matching a market hash name
                        case 'NAME': {
                            // item name is passed through index, same repurposing
                            // the 'ID' case above already does for its own ids array
                            const name = index;
                            const found = finders.name(isYou, amount, 0, name);
                            const items = getElementsForItems(found);
                            const satisfied = amount === items.length;

                            return {
                                items,
                                satisfied
                            };
                        }
                        // get items by whether they were recently obtained
                        case 'RECENT': {
                            // gets nearest numbers to a given number within range of gap
                            const getNearNumbers = (nums, near, gap) => {
                                if (nums.length === 0) {
                                    return [];
                                }
                                
                                const getDistance = (num) => Math.abs(num - near);
                                const sorted = nums
                                    // add distance from "near" for each num
                                    .map((num) => {
                                        return {
                                            num,
                                            distance: getDistance(num)
                                        };
                                    })
                                    .sort((a, b) => {
                                        return a.distance - b.distance;
                                    });
                                
                                // check if the nearest value is within the gap value
                                if (sorted[0].distance > gap) {
                                    return [];
                                }
                                
                                // add the initial
                                const values = [sorted[0].num];
                                
                                // loop through sorted values
                                for (let i = 1; i < sorted.length; i++) {
                                    const current = sorted[i];
                                    const prev = sorted[i - 1];
                                    const difference = Math.abs(prev.distance - current.distance);
                                    
                                    // gap is too big
                                    if (difference > gap) {
                                        // stop bleeding
                                        return values;
                                    }
                                    
                                    values.push(current.num);
                                }
                                
                                return values;
                            };
                            // this case doesn't use the adjusted index afterward (only
                            // 'ITEMS' below does, for offsetIndex), so it's discarded here
                            const { found } = getVisibleInventoryItems(index);
                            const $items = (isYou ? page.$yourSlots : page.$theirSlots).find('.item');
                            const getItemIdFromElement = (el) => el.id.split('_')[2];
                            // creates filter for whether the id is the given list
                            // setting "mustInclude" to true will filter so that "ids" must include the id
                            // setting "mustInclude" to false will filter so that "ids" must not include the id
                            const filterIds = (mustInclude, ids, processor) => {
                                const map = ids
                                    .reduce((map, id) => {
                                        map[id] = true;
                                        
                                        return map;
                                    }, {});
                                
                                return function(value) {
                                    // if a processor was provided it will process the value to convert it into an id
                                    // e.g. getting the id from an html element
                                    const id = processor ? processor(value) : value;
                                    const hasId = Boolean(map[id]);
                                    
                                    // check whether this has or does not have the id
                                    return mustInclude === hasId;
                                };
                            };
                            // note: getInventoryContext always reads from the
                            // currently-visible inventory panel, it does not
                            // accept a side selector
                            const { appid } = getInventoryContext();
                            // get ids of items in trade offer matching app
                            const addedIDs = $items.toArray()
                                .reduce((arr, el) => {
                                    const rgItem = el.rgItem;
                                    const assetid = rgItem.id;
                                    
                                    // appids could be string or number
                                    if (rgItem.appid == appid) {
                                        arr.push(assetid);
                                    }
                                    
                                    return arr;
                                }, []);
                            const ids = found
                                // get ids as integers
                                .map((el) => parseInt(getItemIdFromElement(el)))
                                // filter out ids that are already added in the offer
                                .filter(filterIds(false, addedIDs));
                            const highestId = Math.max(0, ...ids);
                            const nearIds = getNearNumbers(ids, highestId, 100)
                                .map(id => id.toString());
                            const items = found
                                // filter elements to only this set of ids
                                .filter(filterIds(true, nearIds, getItemIdFromElement));
                            const satisfied = nearIds.length === items.length;
                            
                            return {
                                items,
                                satisfied
                            };
                        }
                        // get items displayed in the inventory
                        case 'ITEMS': {
                            const visible = getVisibleInventoryItems(index);
                            const found = visible.found;

                            // offsetIndex needs the adjusted (non-negative) index
                            index = visible.index;

                            const offset = offsetIndex(index, amount, found.length);
                            const items = found.splice(offset, amount);
                            const satisfied = amount === items.length;
                            
                            return {
                                items,
                                satisfied
                            };
                        }
                        default:
                            throw new Error(`Unknown mode: ${mode}`);
                    }
                }
                
                return getItems;
            }());
            
            /**
             * Gets the inventory for selected app and context of user.
             * @param {string} appid - AppID of inventory.
             * @param {string} contextid - ContextID of inventory.
             * @param {(boolean|null)} isYou - Is this your inventory?
             * @returns {Object} Inventory object.
             */
            function getInventory(appid, contextid, isYou) {
                const user = isYou ? UserYou : UserThem;

                // Both rgAppInfo[appid] and rgContexts[contextid] inside it
                // are guarded, degrading to the "|| {}" empty inventory this
                // whole expression is shaped to return rather than throwing.
                // Same chain, same class of crash dumpSummary's own
                // evaluateItems already guards level-by-level after a
                // confirmed-live throw - made consistent here. See #46.
                const context = user.rgAppInfo[appid] && user.rgAppInfo[appid].rgContexts[contextid];

                return (context && context.inventory && context.inventory.rgInventory) || {};
            }
            
            /**
             * Whether YOUR inventory (not the trade partner's) is the
             * currently selected/visible tab. Centralizes the
             * proven-correct selector - `.inventory_user_tab.active`
             * (page.get.$activeInventoryTab) - which getIDs and the initial
             * "configure state" setup already used, into one shared helper.
             * @returns {boolean}
             * See #42.
             */
            function isYourInventorySelected() {
                return page.get.$activeInventoryTab().attr('id') === 'inventory_select_your_inventory';
            }

            /**
             * An inventory context.
             * @typedef {Object} InventoryContext
             * @property {string} [appid] - AppID of inventory.
             * @property {string} [contextid] - ContextID of inventory.
             */

            /**
             * Gets the app of the currently visible inventory.
             * @returns {InventoryContext} AppID and ContextID of inventory.
             */
            function getInventoryContext() {
                const $inventory = page.get.$inventory();
                const match = ($inventory.attr('id') || '').match(/(\d+)_(\d+)$/);
                const [ , appid, contextid] = (match || []);
                
                return {
                    appid,
                    contextid
                };
            }
            
            /**
             * Adds display attributes (particles, strange border, etc.) to items.
             */
            function customizeItems(inventory) {
                const { addAttributes } = shared.offers.identifiers;

                for (let assetid in inventory) {
                    const item = inventory[assetid];

                    if (item.element) {
                        // add the attributes to this element
                        addAttributes(item, item.element);
                    }
                }
            }

            // Backs findMatchingNames below - refreshNameSuggestions' own
            // computed result, kept in memory instead of a <datalist> (see
            // that function's own note on why). Declared at this top level
            // (not nested inside one of the blocks below) for the same
            // reason refreshNameSuggestions itself is - both the "binds
            // events" block (Tab-autocomplete keyup) and the function that
            // fills it need to share it, and a 'use strict' function/let
            // declaration inside a bare block is scoped to that block only.
            let availableNames = [];

            // Every item name Valve's schema classifies as a craftable
            // weapon - backs getItemsForMetal's own craft-weapon fallback
            // (see that function's own note on why it needs this at all).
            // Broadcast from steamcommunity.com/tradeOfferSettingsBridge/
            // content.js (world: ISOLATED, the only side with chrome.storage
            // access to the schema - see that file's own header note) via
            // the tf2te-craft-weapon-names-broadcast listener below, NOT
            // fetched here directly (this file can't - no chrome.* APIs in
            // world: MAIN). Starts empty and stays empty until that
            // broadcast arrives (or forever, if no Steam Web API key is
            // configured at all) - getItemsForMetal already degrades
            // gracefully for an empty list, same as every other schema-
            // backed feature in this extension does when the schema itself
            // isn't available. Declared at this same top level so
            // getItemsForMetal (nested inside the collectItems IIFE,
            // defined earlier in this file) can close over it - safe
            // regardless of that textual ordering, since getItemsForMetal
            // is only ever CALLED later, by which point every top-level
            // declaration in this scope has already run.
            let craftWeaponNames = [];

            // Gates the AUTOMATIC currency pre-fill below (see the
            // inventoryManager.register call further down that drives it) -
            // the manual "Add requested pure" button (page.btns.$listing's
            // own click handler, calling addListingPrice directly) is never
            // affected by this, only whether that same logic also fires on
            // its own the moment a listing link's trade offer page loads.
            // Defaults true (preserves this extension's original always-on
            // behavior) until the popup's own broadcast (see
            // tf2te-auto-add-listing-currency-setting-broadcast's listener
            // below) arrives with whatever the user actually saved - same
            // "safe default until told otherwise" reasoning craftWeaponNames
            // above uses for its own empty-array default.
            let autoAddListingCurrencyEnabled = true;

            // Whether this page's URL is a listing link the user actually
            // opened on backpack.tf (see utils/tradeLinkTrust.js). The
            // automatic pre-fills below put the user's OWN keys/metal or
            // items into the offer from listing_* / for_item_name, which
            // are plain URL text anyone can put on a trade link they send
            // someone, so they only run once this is true. Set by
            // tradeOfferSettingsBridge/content.js's broadcast, which never
            // comes for an untrusted link, so queued pre-fills then never
            // run at all. The manual buttons are not affected.
            let listingLinkTrusted = false;
            const actionsAwaitingListingLinkTrust = [];
            const whenListingLinkTrusted = (action) => {
                if (listingLinkTrusted) {
                    action();
                } else {
                    actionsAwaitingListingLinkTrust.push(action);
                }
            };

            /**
             * Recomputes availableNames from whichever inventory/side is
             * currently selected. Called on inventory loads and side/app
             * switches (see this function's own callers), AND fresh on
             * every "Add by name" keystroke (see the keyup handler below).
             * Relying only on load/switch events left this matching against
             * a stale, incomplete inventory snapshot. Recomputing here is
             * cheap enough (iterating a few hundred already-in-memory
             * object keys) to also do on every keystroke.
             *
             * Matches are found with this file's OWN code (findMatchingNames)
             * against this in-memory array, rather than a native <datalist>
             * (input list="...") - same reasoning
             * backpack.tf/oldUI/premiumSearchSkinAutocomplete/content.js
             * already applied for its own Tab-to-autocomplete field. A native
             * datalist silently drops real matches once the suggestion list
             * gets large enough.
             * See #10.
             * See #11.
             */
            function refreshNameSuggestions() {
                const { appid, contextid } = getInventoryContext();

                if (!appid) {
                    availableNames = [];
                    return;
                }

                const isYou = isYourInventorySelected();
                const inventory = getInventory(appid, contextid, isYou);
                const names = new Set();

                for (let assetid in inventory) {
                    const item = inventory[assetid];

                    if (item && item.market_hash_name) {
                        names.add(item.market_hash_name);
                    }
                }

                // Sorted once here (not left in Steam's own arbitrary asset
                // order) so findMatchingNames' own two match groups (prefix,
                // then substring) are each internally predictable/alphabetical
                // too, not just the combined list as a whole.
                availableNames = Array.from(names).sort((a, b) => a.localeCompare(b));
            }

            /**
             * Finds every known item name CONTAINING `query` (case-
             * insensitive, anywhere in the name) - the matching half of the
             * same Tab-to-autocomplete UX backpack.tf/oldUI/
             * premiumSearchSkinAutocomplete/content.js's own
             * findSkinNamesByPrefix provides for a static skin database,
             * applied here to availableNames (the CURRENT inventory/side's
             * own item names) instead.
             *
             * A plain substring search (String#includes), with prefix
             * matches still sorted first - typing "g3" still ranks "G3SG1
             * | ..." names ahead of some unrelated item that merely
             * happens to contain "g3" mid-name, preserving the exact
             * ranking every existing prefix-only match already had (a
             * query that only matches by substring never had a competing
             * prefix match to begin with).
             * @param {string} query
             * @returns {string[]} Matching names - prefix matches first,
             * then substring matches, each group in availableNames' own
             * alphabetical order.
             * See #47.
             */
            function findMatchingNames(query) {
                if (!query) {
                    return [];
                }

                const lowerQuery = query.toLowerCase();
                const prefixMatches = [];
                const containsMatches = [];

                for (const name of availableNames) {
                    const lowerName = name.toLowerCase();

                    if (lowerName.startsWith(lowerQuery)) {
                        prefixMatches.push(name);
                    } else if (lowerName.includes(lowerQuery)) {
                        containsMatches.push(name);
                    }
                }

                return prefixMatches.concat(containsMatches);
            }

            // name_control's own dropdown state - a clickable list of every
            // current match (not one at a time via repeated Tab presses): a
            // better fit than
            // backpack.tf/oldUI/premiumSearchSkinAutocomplete/content.js's
            // own Tab-cycle pattern for THIS field specifically, since that
            // one suits a small/simple static skin-name field better than it
            // suits a large (195-310 unique name), dynamic personal
            // inventory where the exact wording of an item isn't always
            // remembered. Declared at this top level (not nested inside the
            // "binds events" block below) so addItemsByName's own success
            // path (elsewhere in this same top-level scope) can close the
            // dropdown too, same reasoning
            // availableNames/refreshNameSuggestions/findMatchingNames
            // already document for needing to live here.
            let dropdownMatches = [];
            let dropdownHighlightIndex = -1;

            /**
             * Hides, empties, and DETACHES the dropdown from <body> (not
             * just hidden - genuinely removed, same lifecycle every other
             * overlay in this file already uses), resetting its own
             * selection state - called on blur, Escape, a row click/
             * Enter-accept, and a successful "Add by name" (so the next
             * search starts clean).
             *
             * Detaching (not just hiding) keeps <body> free of a hidden
             * leftover element: tests/tradeOfferPage.test.js finds the
             * modals (promptRemoveItems, promptSelectHistoryItem,
             * showAlert) via `document.body.children[0]`, and a dropdown
             * left parented under <body> would take that position. Only
             * living in <body> while genuinely open avoids that.
             */
            function closeNameDropdown() {
                page.fields.$nameDropdown.empty();
                page.fields.$nameDropdown.attr('hidden', 'hidden');
                dropdownMatches = [];
                dropdownHighlightIndex = -1;

                const dropdownEl = page.fields.$nameDropdown.get(0);
                if (dropdownEl.parentNode) {
                    dropdownEl.parentNode.removeChild(dropdownEl);
                }
            }

            /**
             * Pins the dropdown's own fixed-position coordinates to
             * whatever the input's OWN current on-screen box actually is,
             * fresh via getBoundingClientRect() - see this file's own
             * .tf2te-name-dropdown CSS note for why this replaced a plain
             * CSS position:absolute anchored to an ancestor. Called every
             * time the dropdown is about to become visible, not just once -
             * the input's own screen position isn't fixed (the page can
             * scroll while the field itself doesn't move), and this has no
             * way to be notified of that other than recomputing whenever
             * it's shown.
             */
            function positionNameDropdown() {
                const inputEl = page.controls.$name.get(0);
                const rect = inputEl.getBoundingClientRect();
                const dropdownEl = page.fields.$nameDropdown.get(0);

                dropdownEl.style.top = `${rect.bottom}px`;
                dropdownEl.style.left = `${rect.left}px`;
                dropdownEl.style.width = `${rect.width}px`;
            }

            /**
             * (Re)builds the dropdown's own row elements from
             * dropdownMatches/dropdownHighlightIndex - called after either
             * changes (a fresh keystroke's own new match list, or an arrow
             * key moving the highlight within the same list).
             */
            function renderNameDropdown() {
                if (dropdownMatches.length === 0) {
                    // Reuses closeNameDropdown's own detach - a "no matches"
                    // result must fully vacate <body> too, not just hide,
                    // for the reason that function's own note documents.
                    closeNameDropdown();
                    return;
                }

                // Attaches (or re-attaches - appendChild on an element
                // already in the document just moves it, harmlessly) fresh
                // each time there's something to actually show, rather than
                // once up front - see closeNameDropdown's own note on why
                // staying permanently parented under <body> isn't safe.
                document.body.appendChild(page.fields.$nameDropdown.get(0));
                page.fields.$nameDropdown.empty();
                positionNameDropdown();

                let activeRow = null;

                dropdownMatches.forEach((name, index) => {
                    const row = document.createElement('div');
                    row.classList.add('tf2te-name-dropdown-row');
                    if (index === dropdownHighlightIndex) {
                        row.classList.add('tf2te-name-dropdown-row-active');
                        activeRow = row;
                    }
                    row.textContent = name;
                    row.addEventListener('click', () => {
                        page.controls.$name.val(name);
                        closeNameDropdown();
                        page.controls.$name.trigger('focus');
                    });
                    page.fields.$nameDropdown.append(row);
                });

                // Must run AFTER the row above is actually appended to the
                // document - scrollIntoView() on a still-detached element is
                // a no-op. block:'nearest' scrolls only as far as needed
                // (and only within the dropdown's own overflow-y:auto box,
                // its nearest scrollable ancestor - never the whole page). See #48.
                if (activeRow) {
                    activeRow.scrollIntoView({ block: 'nearest' });
                }

                page.fields.$nameDropdown.removeAttr('hidden');
            }

            // perform actions
            // add elements to page
            {
                const $tradeBox = page.$tradeBoxContents;
                // clearfix to add after inventories to fix height bug in firefox
                const $clear = $('<div style="clear: both"/>');
                
                // add summary and control HTML to the trade box
                $tradeBox.append(`
                    <div id="controls">
                        <div class="trade_rule selectableNone"></div>
                        <div class="selectableNone" style="font-size: 11px; margin-bottom: 4px; display: flex; align-items: center; gap: 6px;">
                            <span style="color: #dcdcdc;">Add by position</span>
                            <span class="tf2te-info-dot" tabindex="0">i<span class="tf2te-info-tip">Grabs "amount" tiles starting at "index", in your inventory's current sort order - not by name; 0 = first visible item, negative counts back from the last.</span></span>
                        </div>
                        <div class="filter_ctn" style="display: flex; align-items: center; gap: 4px;">
                            <div class="filter_control_ctn" style="display: flex; align-items: center; gap: 6px; width: auto; flex: none;">
                                <span class="tf2te-stepper-label">index</span>
                                <span class="filter_search_box tf2te-stepper" style="width: 68px;">
                                    <span id="index_control_dec" class="tf2te-stepper-btn">−</span>
                                    <input id="index_control" class="tf2te-stepper-input" type="number" min="0"/>
                                    <span id="index_control_inc" class="tf2te-stepper-btn">+</span>
                                </span>
                                <span class="tf2te-stepper-label">amount</span>
                                <span class="filter_search_box tf2te-stepper" style="width: 68px;">
                                    <span id="amount_control_dec" class="tf2te-stepper-btn">−</span>
                                    <input id="amount_control" class="tf2te-stepper-input" type="number" min="0" step="1"/>
                                    <span id="amount_control_inc" class="tf2te-stepper-btn">+</span>
                                </span>
                            </div>
                            <div class="filter_tag_button_ctn filter_right_controls" style="position: static; float: none; margin-left: 0;">
                                <div id="btn_additems" class="btn_black btn_small">
                                    <span>Add by position</span>
                                </div>
                            </div>
                        </div>
                        <div id="name_fields" class="control_fields">
                            <div class="selectableNone" style="font-size: 11px; margin-bottom: 4px; display: flex; align-items: center; gap: 6px;">
                                <span style="color: #dcdcdc;">Add by name</span>
                                <span class="tf2te-info-dot" tabindex="0">i<span class="tf2te-info-tip">Own ×N multiplier below - not the "amount" field above.</span></span>
                            </div>
                            <div class="filter_ctn">
                                <!-- A dropdown of every match, fully
                                rendered/matched by this file's own code (see
                                name_suggestion_dropdown's own wiring below -
                                it's declared here but re-parented to a direct
                                child of <body> at setup time, so this is only
                                its INITIAL placeholder position, not where it
                                actually renders), not dependent on the
                                browser's own datalist rendering at all. -->
                                <div class="filter_control_ctn" style="display: flex; align-items: center;">
                                    <input id="name_control" class="filter_search_box" style="flex: 1; display: inline-block;" type="text" placeholder="item name (e.g. Strange Shovel)" autocomplete="off"/>
                                    <div id="name_suggestion_dropdown" class="tf2te-name-dropdown" hidden></div>
                                </div>
                                <div class="filter_tag_button_ctn filter_right_controls" style="display: flex; align-items: center; gap: 6px;">
                                    <span class="filter_search_box tf2te-stepper" style="width: 80px;">
                                        <span id="name_amount_control_dec" class="tf2te-stepper-btn">−</span>
                                        <input id="name_amount_control" class="tf2te-stepper-input" type="number" min="1" step="1" placeholder="×1" value="1"/>
                                        <span id="name_amount_control_inc" class="tf2te-stepper-btn">+</span>
                                    </span>
                                    <div id="btn_addname" type="button" class="btn_black btn_small">
                                        <span>Add by name</span>
                                    </div>
                                </div>
                                <div style="clear:both;"></div>
                            </div>
                        </div>
                        <div class="trade_rule selectableNone"></div>
                        <div id="add_btns" class="control_fields">
                            <input id="keys_amount_control" class="filter_search_box" style="width: 50px; display: inline-block; vertical-align: middle; margin: 0 8px 0 0;" type="number" min="1" step="1" placeholder="3 keys"/>
                            <div id="btn_addkeys" class="btn_green btn_black btn_small">
                                <span>Add Keys</span>
                            </div>
                            <input id="metal_amount_control" class="filter_search_box" style="width: 60px; display: inline-block; vertical-align: middle; margin: 0 8px 0 8px;" type="text" inputmode="decimal" placeholder="14,22 refs"/>
                            <div id="btn_addmetal" class="btn_green btn_black btn_small">
                                <span>Add Metals</span>
                            </div>
                            <div id="btn_addrecent" class="btn_silver btn_black btn_small">
                                <span>Add Recent</span>
                            </div>
                        </div>
                        <div id="clear_btns" class="control_fields">
                            <div id="btn_clearmyitems" type="button" class="btn_black btn_small">
                                <span>Clear my items</span>
                            </div>
                            <div id="btn_cleartheiritems" type="button" class="btn_black btn_small">
                                <span>Clear their items</span>
                            </div>
                            <div id="btn_addlisting" class="btn_blue btn_black btn_small">
                                <span>Add requested pure</span>
                            </div>
                            <div id="btn_addlistingitem" class="btn_blue btn_black btn_small" style="display: none;">
                                <span>Add More Listed Items</span>
                            </div>
                        </div>
                        <div id="id_fields" class="control_fields" style="display: none;">
                            <div class="filter_ctn">
                                <div class="filter_control_ctn">
                                    <input id="ids_control" class="filter_search_box filter_full" type="text" placeholder="ids" autocomplete="off"/>
                                </div>
                                <div class="filter_tag_button_ctn filter_right_controls">
                                    <div id="btn_addids" type="button" class="btn_black btn_small">
                                        <span>Add</span>
                                    </div>
                                    <div id="btn_getids" type="button" class="btn_black btn_small">
                                        <span>Get</span>
                                    </div>
                                </div>
                                <div style="clear:both;"></div>
                            </div>
                        </div>
                    </div>
                    <div id="tradeoffer_items_summary">
                        <div class="items_summary" id="your_summary"></div>
                        <div class="items_summary" id="their_summary"></div>
                    </div>
                `);
                
                // add the clear after inventories
                $clear.insertAfter(page.$inventories);
                
                // add newly created elements to page object
                page.$yourSummary = $('#your_summary');
                page.$theirSummary = $('#their_summary');
                page.controls = {
                    $amount: $('#amount_control'),
                    $index: $('#index_control'),
                    $ids: $('#ids_control'),
                    $name: $('#name_control'),
                    $nameAmount: $('#name_amount_control'),
                    $keysAmount: $('#keys_amount_control'),
                    $metalAmount: $('#metal_amount_control')
                };
                page.fields = {
                    $ids: $('#id_fields'),
                    // Starts in its HTML template position (inside
                    // .filter_control_ctn) - renderNameDropdown re-parents
                    // it to a direct child of <body> only once there's
                    // actually something to show (see that function's own
                    // note on why NOT doing this once, up front, matters).
                    // This reference stays valid regardless of later
                    // reparenting - only removing an element and creating a
                    // fresh one would invalidate it, not moving it.
                    $nameDropdown: $('#name_suggestion_dropdown')
                };
                page.btns = {
                    // The whole Add Keys/Add Metals/Add Recent row, toggled
                    // as one unit by updateDisplay below (unlike
                    // $keys/$metal, which stay individually toggled for
                    // their own per-app reasons) - see updateDisplay's own
                    // note on why $recent joins them here despite RECENT
                    // mode itself being app-agnostic.
                    $addBtnsRow: $('#add_btns'),
                    $clearMy: $('#btn_clearmyitems'),
                    $clearTheir: $('#btn_cleartheiritems'),
                    $items: $('#btn_additems'),
                    $keys: $('#btn_addkeys'),
                    $metal: $('#btn_addmetal'),
                    $recent: $('#btn_addrecent'),
                    $listing: $('#btn_addlisting'),
                    $listingItem: $('#btn_addlistingitem'),
                    $addIDs: $('#btn_addids'),
                    $getIDs: $('#btn_getids'),
                    $addName: $('#btn_addname'),
                    $indexDec: $('#index_control_dec'),
                    $indexInc: $('#index_control_inc'),
                    $amountDec: $('#amount_control_dec'),
                    $amountInc: $('#amount_control_inc'),
                    $nameAmountDec: $('#name_amount_control_dec'),
                    $nameAmountInc: $('#name_amount_control_inc')
                };
            }

            // .tf2te-info-dot tooltips (Add by position/Add by name, and
            // the pure-totals row below) rely on :hover/:focus - fine with
            // a mouse or keyboard, but there's no hover on a touchscreen,
            // and tap-to-focus on a bare <span> (not a real form control) is
            // inconsistent across mobile browsers. A delegated click
            // listener makes tapping one reliably open/close its tooltip
            // everywhere, on top of (not instead of) the CSS-only hover/
            // focus behavior - registered once here since it's on
            // document, so it covers every .tf2te-info-dot regardless of
            // which later block in this file creates it.
            {
                document.addEventListener('click', (e) => {
                    const dot = e.target.closest && e.target.closest('.tf2te-info-dot');

                    document.querySelectorAll('.tf2te-info-dot.tf2te-info-open').forEach((openDot) => {
                        if (openDot !== dot) openDot.classList.remove('tf2te-info-open');
                    });

                    if (dot) dot.classList.toggle('tf2te-info-open');
                });
            }

            // warn about a trade partner flagged as banned/scammer on rep.tf
            {
                const REP_CHECK_REQUEST_EVENT = 'tf2te-resolve-rep-check-request';
                const REP_CHECK_RESPONSE_EVENT = 'tf2te-resolve-rep-check-response';

                /**
                 * Asks tradeOfferRepCheck/content.js whether the trade
                 * partner is flagged as "bad" (banned/scammer) on any site
                 * rep.tf aggregates - see that file's own header for why
                 * this needs a bridge at all.
                 *
                 * Re-dispatches the request every 500ms until answered.
                 * This is called immediately at page load, with no guaranteed
                 * ordering against tradeOfferRepCheck/content.js's own
                 * separate injection timing, so a CustomEvent with no
                 * listener present yet is simply lost, not queued.
                 * @param {string} steamid64
                 * @returns {Promise<Object>} { bannedSites: string[] } or { error }.
                 * See #23.
                 */
                function resolveRepCheck(steamid64) {
                    return new Promise((resolve, reject) => {
                        const requestId = `${Date.now()}-${Math.random()}`;

                        const dispatch = () => {
                            document.dispatchEvent(new CustomEvent(REP_CHECK_REQUEST_EVENT, { detail: JSON.stringify({ requestId, steamid64 }) }));
                        };

                        const timeoutId = setTimeout(() => {
                            clearInterval(retryId);
                            document.removeEventListener(REP_CHECK_RESPONSE_EVENT, onResponse);
                            reject(new Error('Timed out waiting for rep check'));
                        }, 15000);

                        function onResponse(event) {
                            const detail = typeof event.detail === 'string' ? JSON.parse(event.detail) : event.detail;
                            if (!detail || detail.requestId !== requestId) return;

                            clearTimeout(timeoutId);
                            clearInterval(retryId);
                            document.removeEventListener(REP_CHECK_RESPONSE_EVENT, onResponse);
                            resolve(detail);
                        }

                        document.addEventListener(REP_CHECK_RESPONSE_EVENT, onResponse);
                        dispatch();
                        const retryId = setInterval(dispatch, 500);
                    });
                }

                // Neutral while the check runs or when it couldn't be
                // done - only an actual rep.tf answer gets red or green.
                const REP_CHECK_BANNER_COLORS = {
                    neutral: { border: 'rgba(255, 255, 255, 0.25)', background: 'rgba(255, 255, 255, 0.05)' },
                    banned: { border: '#e74c3c', background: 'rgba(231, 76, 60, 0.15)' },
                    clean: { border: '#2ecc71', background: 'rgba(46, 204, 113, 0.1)' },
                };

                /**
                 * Builds the banner element itself, in its neutral
                 * "Checking bans…" state - shown right away and updated in
                 * place by setRepCheckBanner once rep.tf answers, so the
                 * page doesn't shift when the result lands.
                 */
                function buildRepCheckBanner() {
                    const banner = document.createElement('div');
                    banner.appendChild(document.createElement('strong'));
                    banner.appendChild(document.createElement('div'));
                    setRepCheckBanner(banner, 'neutral', 'Checking bans…', 'Looking this account up on Rep.TF.');

                    return banner;
                }

                /**
                 * Puts the banner into one of REP_CHECK_BANNER_COLORS'
                 * states. titleText/detailText are always inserted as plain
                 * text, never HTML - rep.tf's own data is untrusted
                 * third-party content (see utils/repTfInfo.js's own note on
                 * why), and bannedSites (the only piece of that data used
                 * here) flows straight into detailText.
                 */
                function setRepCheckBanner(banner, state, titleText, detailText) {
                    const { border, background } = REP_CHECK_BANNER_COLORS[state];

                    // contain: inline-size - the banner's own text never
                    // widens the shared box it sits in (see where that box
                    // is built), it just fills whatever width the other
                    // rows give it.
                    banner.style.cssText = `
                        contain: inline-size;
                        margin-top: 8px;
                        padding: 8px 12px;
                        border-radius: 4px;
                        border: 1px solid ${border};
                        background: ${background};
                        color: #fff;
                        font-size: 12px;
                        line-height: 1.4;
                    `;

                    const [title, detail] = banner.children;
                    title.textContent = titleText;
                    detail.textContent = detailText;
                }

                // Same outbound profile links steamcommunity.com/steamLinks/
                // content.js shows on a Steam profile page - duplicated here
                // (not imported) since this whole file runs as a classic
                // (non-module) MAIN-world script and can't use import/export
                // at all (see this file's own header, same reason
                // QUALITY_ID_BY_NAME/ITEMS_QUALITY/etc. are duplicated
                // higher up). steamdb.info is deliberately left out here.
                // Keep in sync with steamLinks/content.js's own linksInfo and
                // tradeOffersList.js's buttons if that list ever changes.
                const PARTNER_PROFILE_LINKS = [
                    { label: 'next.bp.tf', href: (id) => `https://next.backpack.tf/profiles/${id}` },
                    { label: 'bp.tf', href: (id) => `https://backpack.tf/profiles/${id}` },
                    { label: 'posts.tf', href: (id) => `https://posts.tf/users/${id}` },
                    { label: 'rep.tf', href: (id) => `https://rep.tf/${id}` },
                ];

                /**
                 * Builds a row of small outbound-link buttons to the trade
                 * partner's profile on each of PARTNER_PROFILE_LINKS - styled
                 * inline rather than via Steam's own .btn_profile_action/
                 * .btn_medium classes (used for the same buttons on a
                 * profile page), since those classes' styles come from the
                 * profile page's own stylesheet, not something guaranteed
                 * loaded here on the trade offer page.
                 */
                function buildPartnerProfileLinksRow(steamid64) {
                    const row = document.createElement('div');
                    row.style.cssText = `
                        display: flex;
                        flex-wrap: wrap;
                        gap: 6px;
                        margin-top: 8px;
                    `;

                    PARTNER_PROFILE_LINKS.forEach(({ label, href }) => {
                        const link = document.createElement('a');
                        link.href = href(steamid64);
                        link.target = '_blank';
                        link.rel = 'noopener noreferrer';
                        link.textContent = label;
                        link.style.cssText = `
                            padding: 4px 10px;
                            border-radius: 4px;
                            background: rgba(255, 255, 255, 0.08);
                            color: #fff;
                            font-size: 11px;
                            text-decoration: none;
                            white-space: nowrap;
                        `;
                        row.appendChild(link);
                    });

                    return row;
                }

                /**
                 * Tallies keys and Refined Metal (converted to refined
                 * units) held across a side's WHOLE TF2 inventory (appid
                 * 440/context 2) - not just what's currently sitting in the
                 * trade slots - straight from the same raw rgInventory data
                 * collectItems' own private identifiers/finders read from
                 * when picking items to add (not reachable from here - see
                 * that closure's own `return getItems` further up). Only
                 * TF2's own key/metal market_hash_names are checked, unlike
                 * identifiers.isKey's CS:GO tag-based branch, since this is
                 * TF2-only - a side with no TF2 context (or one that just
                 * hasn't loaded yet) returns {} from getInventory's own
                 * "|| {}" fallback, so this correctly comes back
                 * { keys: 0, metal: 0 } for it (see schedulePureColumnUpdate
                 * for how callers eventually settle on that being final).
                 * @param {boolean} isYou
                 * @returns {{keys: number, metal: number}} metal in refined-metal units.
                 */
                function getPureTotals(isYou) {
                    const inventory = getInventory('440', '2', isYou);
                    const { METAL_SCRAP_VALUES } = shared.offers;
                    let keys = 0;
                    let scrap = 0;

                    for (const assetid in inventory) {
                        const name = inventory[assetid].market_hash_name;

                        if (name === 'Mann Co. Supply Crate Key') {
                            keys++;
                        } else if (Object.prototype.hasOwnProperty.call(METAL_SCRAP_VALUES, name)) {
                            scrap += METAL_SCRAP_VALUES[name];
                        }
                    }

                    return { keys, metal: scrap / 9 };
                }

                /**
                 * Builds one "Your total pure:"/"Their total pure:" column -
                 * title plus a Keys/Metal line each, seeded with "…"
                 * placeholders so the row (see buildPureTotalsRow) has its
                 * final two-line height from the moment it's inserted,
                 * rather than growing once each side's inventory finishes
                 * loading and updatePureColumn fills in the real numbers.
                 * @param {string} label
                 */
                function buildPureColumn(label) {
                    const column = document.createElement('div');
                    column.style.cssText = 'min-width: 110px;';

                    const title = document.createElement('div');
                    title.style.cssText = 'display: flex; align-items: center; gap: 5px; color: #fff; font-weight: bold; margin-bottom: 3px;';

                    const titleText = document.createElement('span');
                    titleText.textContent = label;
                    title.appendChild(titleText);

                    // "Total pure" reads ambiguously next to a trade box -
                    // easy to assume it means what's currently staged in
                    // THIS trade, when getPureTotals above actually counts
                    // this side's whole TF2 inventory regardless of what's
                    // been added yet (see that function's own note on why).
                    const infoDot = document.createElement('span');
                    infoDot.className = 'tf2te-info-dot';
                    infoDot.tabIndex = 0;
                    infoDot.textContent = 'i';
                    const tip = document.createElement('span');
                    tip.className = 'tf2te-info-tip';
                    tip.textContent = "Counts this side's whole TF2 inventory, not just what's currently added to this trade.";
                    infoDot.appendChild(tip);
                    title.appendChild(infoDot);

                    const keysLine = document.createElement('div');
                    keysLine.textContent = 'Keys: …';

                    const metalLine = document.createElement('div');
                    metalLine.textContent = 'Metals: … ref';

                    column.append(title, keysLine, metalLine);

                    return { column, keysLine, metalLine };
                }

                /**
                 * Fills in a column built by buildPureColumn with this
                 * side's real totals, once its inventory has finished
                 * loading (see this file's two inventoryManager.register
                 * calls further down).
                 * @param {{keysLine: HTMLElement, metalLine: HTMLElement}} column
                 * @param {boolean} isYou
                 */
                function updatePureColumn({ keysLine, metalLine }, isYou) {
                    const { keys, metal } = getPureTotals(isYou);
                    keysLine.textContent = `Keys: ${keys}`;
                    metalLine.textContent = `Metals: ${metal.toFixed(2)} ref`;
                }

                /**
                 * Builds the combined "Your total pure:" / "Their total
                 * pure:" row shown under the partner profile links row - a
                 * single boxed row with both sides side-by-side (not two
                 * separate rows) with a vertical divider between them,
                 * matching the boxed look of buildRepCheckBanner rather
                 * than the bare-text links row above it, since two bare
                 * columns with no container read as loose/misaligned next
                 * to that banner.
                 */
                function buildPureTotalsRow() {
                    const row = document.createElement('div');
                    row.style.cssText = `
                        display: inline-flex;
                        align-items: flex-start;
                        gap: 16px;
                        margin-top: 8px;
                        padding: 8px 12px;
                        border-radius: 4px;
                        border: 1px solid rgba(255, 255, 255, 0.1);
                        background: rgba(255, 255, 255, 0.05);
                        font-size: 11px;
                        color: rgba(255, 255, 255, 0.75);
                        line-height: 1.6;
                    `;

                    const yours = buildPureColumn('Your total pure:');
                    const theirs = buildPureColumn('Their total pure:');
                    const divider = document.createElement('div');
                    divider.style.cssText = 'align-self: stretch; width: 1px; background: rgba(255, 255, 255, 0.15);';

                    row.append(yours.column, divider, theirs.column);

                    return { row, yours, theirs };
                }

                /**
                 * Inserts the rep.tf banner straight away in its neutral
                 * "Checking bans…" state, then turns it red/green once that
                 * (up to 15s) check completes - deliberately the ONLY thing
                 * gated on resolveRepCheck. The links row and pure-totals
                 * row are both appended by this function's caller instead,
                 * synchronously/on-inventory-load rather than awaited here,
                 * so a slow or failed rep check can never hold either of
                 * them back. A failed check stays neutral ("unavailable"),
                 * never a green all-clear for a check that didn't happen.
                 * @param {HTMLElement} container - The header's own box of our rows.
                 * @param {HTMLElement} linksRow - Already appended to container; the banner is inserted before it.
                 */
                async function showRepCheckWarning(container, linksRow) {
                    const banner = buildRepCheckBanner();
                    container.insertBefore(banner, linksRow);

                    const showUnavailable = (reason) => {
                        console.warn('[TF2 Trading Enhancer] Rep check failed:', reason);
                        setRepCheckBanner(banner, 'neutral', 'Ban check unavailable', "Couldn't reach Rep.TF. Use the rep.tf button to check manually.");
                    };

                    let result;
                    try {
                        result = await resolveRepCheck(PARTNER_STEAMID);
                    } catch (e) {
                        showUnavailable(e.message);
                        return;
                    }

                    if (result.error) {
                        showUnavailable(result.error);
                        return;
                    }

                    const bannedSites = result.bannedSites || [];
                    if (bannedSites.length > 0) {
                        setRepCheckBanner(banner, 'banned', '⚠ Potential scammer', `Banned at the following sites: ${bannedSites.join(', ')}`);
                    } else {
                        setRepCheckBanner(banner, 'clean', '✓ No bans found', 'Not banned at any site according to Rep.TF.');
                    }
                }

                // Ceiling on how long a column waits on inventoryManager
                // before giving up and just showing whatever getPureTotals
                // already has (0/0.00 for a side with no TF2 items at all) -
                // same "don't hang forever on an event that might just never
                // fire" reasoning as resolveRepCheck's own 15s timeout above.
                // The row is always shown immediately with placeholders, and
                // every column resolves for real one way or another - not
                // gated on an early synchronous rgAppInfo['440'] check. See #52.
                const PURE_TOTALS_FALLBACK_MS = 8000;

                /*
                @description: Only the FALLBACK checks whether the real load
                already resolved (skipping a redundant/stale render) - the
                real inventoryManager callback is never blocked, and corrects
                a fallback-rendered 0 the moment TF2's own inventory actually
                finishes loading, however much later that turns out to be.
                See #53.
                */
                function schedulePureColumnUpdate(column, isYou) {
                    const steamid = isYou ? STEAMID : PARTNER_STEAMID;
                    let resolvedFromInventory = false;

                    inventoryManager.register(steamid, '440', '2', () => {
                        resolvedFromInventory = true;
                        updatePureColumn(column, isYou);
                    });

                    setTimeout(() => {
                        if (resolvedFromInventory) return;
                        updatePureColumn(column, isYou);
                    }, PURE_TOTALS_FALLBACK_MS);
                }

                /**
                 * Opts the partner header into the left-hand column layout
                 * (see html.tf2te-side-layout's own CSS) - the CSS alone
                 * finds the column and decides side vs. top, so this only
                 * toggles the <html> class. Off whenever something else
                 * (another extension) floats or positions the
                 * header itself - Steam never does - since two layouts
                 * fighting over the same element would break both; our
                 * rows then just render inside whatever layout that other
                 * code built.
                 * @param {HTMLElement} header
                 */
                function enablePartnerSideColumn(header) {
                    const root = document.documentElement;

                    const update = () => {
                        const { float, position } = getComputedStyle(header);
                        const ownedElsewhere = float !== 'none' || position === 'absolute' || position === 'fixed';

                        if (ownedElsewhere) {
                            root.classList.remove('tf2te-side-layout');
                        } else {
                            root.classList.add('tf2te-side-layout');
                        }
                    };

                    update();

                    // The other code can run after this does - its own
                    // styles arrive as a <style>/<link> in <head> or a
                    // class/style attribute change on one of these.
                    const observer = new MutationObserver(update);
                    const attributes = { attributes: true, attributeFilter: ['class', 'style'] };
                    observer.observe(header, attributes);
                    observer.observe(document.body, attributes);
                    observer.observe(document.head, { childList: true });
                }

                const header = document.querySelector('.trade_partner_header');

                if (header) {
                    // Our rows share one box sized to the widest of them
                    // (the pure-totals row), so the rep.tf banner matches
                    // the totals' width instead of spanning the whole
                    // header - in both the side column and the top layout.
                    // The banner itself opts out of that sizing (see
                    // buildRepCheckBanner), so a long banned-sites list
                    // wraps instead of widening the box. min-width is the
                    // totals row's own usual width, so the box keeps its
                    // width while that row is hidden for a non-TF2
                    // inventory (see updateDisplay) instead of shrinking
                    // to the links row - while still growing with
                    // unusually long totals.
                    const extras = document.createElement('div');
                    extras.style.cssText = `
                        display: grid;
                        width: fit-content;
                        min-width: 280px;
                        max-width: 100%;
                    `;
                    header.appendChild(extras);

                    const linksRow = buildPartnerProfileLinksRow(PARTNER_STEAMID);
                    extras.appendChild(linksRow);

                    const { row: pureTotalsRow, yours, theirs } = buildPureTotalsRow();
                    extras.appendChild(pureTotalsRow);
                    // Stored on `page` (not just this local const) so
                    // updateDisplay - a different top-level block entirely,
                    // inside tradeOfferWindow's own IIFE further up this
                    // file - can toggle it too, the same way it already
                    // toggles page.btns.$keys/$metal for TF2-only relevance.
                    page.pureTotalsRow = pureTotalsRow;

                    // Scheduled here (not inside showRepCheckWarning) so
                    // both columns fill in purely off their own side's
                    // inventory-loaded event (or the fallback timeout),
                    // with no dependency on that function's own rep.tf
                    // round trip at all.
                    schedulePureColumnUpdate(yours, true);
                    schedulePureColumnUpdate(theirs, false);

                    showRepCheckWarning(extras, linksRow);
                    enablePartnerSideColumn(header);
                }
            }

            // Seeded directly from for_item_name when present - an extra URL
            // param backpack.tf/nextUI/fixTradeOfferLinks/content.js smuggles
            // in from the listing page's own DOM (the item name is right
            // there next to the trade offer link at the moment that link is
            // built/patched, long before the specific asset could ever go
            // missing). Falls back to null for older links generated before
            // that param existed, or from anywhere else for_item_name isn't
            // set - in which case this is instead set the first time the
            // for_item asset is ever successfully resolved to a real item
            // client-side, either by addListingItem below, or proactively by
            // the "register inventory events" block's own dead-item check
            // (which runs as soon as their inventory finishes loading, see
            // its own note on why). Either way, lets addListingItem fall back
            // to an automatic "add by name" using the name we already know,
            // once the specific asset is gone, instead of forcing the user to
            // retype it into "Add by name" themselves - or, with
            // for_item_name present, even on the very FIRST check. Declared
            // here (not inside either of those two sibling blocks) since both
            // need to read/write the same value.
            let cachedListingItemName = urlParams.for_item_name || null;

            // Bridges addListingPrice (declared inside "binds events to
            // elements" below) to the "register inventory events" block
            // further down, which needs to call it once the paying side's
            // inventory has loaded - same cross-block reason as
            // cachedListingItemName above (a block-scoped function
            // declaration isn't reachable outside its own block under this
            // file's own 'use strict'). Set once addListingPrice itself is
            // declared, a few lines into that block.
            let runAddListingPrice = null;

            // binds events to elements
            {
                /**
                 * The user changed from one app to another
                 * @param {HTMLElement} appEl - App element.
                 */
                function appChanged(appEl) {
                    const id = appEl.getAttribute('id');
                    const match = id.match(/appselect_option_(you|them)_(\d+)_(\d+)/);
                    
                    if (!match) {
                        return;
                    }
                    
                    const isYou = match[1] === 'you';
                    const [ , , appid] = match;
                    
                    tradeOfferWindow.updateDisplay(isYou, appid);
                }
                
                // add the listing price
                async function addListingPrice() {
                    /**
                     * Add currencies to the trade.
                     * @param {(boolean|null)} isYou - Pick items from your inventory? null for both.
                     * @param {Object} currencies - Object containing currencies.
                     * @returns {Promise<string[]>} Array of reasons if value was not met for each currency.
                     */
                    async function addCurrencies(isYou, currencies) {
                        const names = Object.keys(currencies).filter((currency) => {
                            return currencies[currency] > 0;
                        });
                        const index = parseInt(page.controls.$index.val()) || 0;
                        const user = isYou ? UserYou : UserThem;

                        // A very large inventory (e.g. a high-volume 24/7 trading
                        // bot) can still be mid-fetch of its own further asset pages
                        // well after this side's own #inventory_* container has
                        // already appeared - the exact moment inventoryManager's own
                        // "call" trigger runs this (see that block's own note further
                        // down). collectItems only ever sees whatever asset data has
                        // arrived SO FAR, so a currency that's genuinely present,
                        // just not yet fetched, reads back indistinguishable from
                        // "not enough" - "not enough metal" for a listing whose bot
                        // plainly had plenty (confirmed by re-adding the same amount
                        // manually a moment later, successfully, once the rest of its
                        // inventory had finished loading - other, smaller-inventory
                        // listings never hit this at all). Retrying while
                        // BIsLoadingInventoryData() is still true for the side being
                        // drawn from (the same signal this file's own dead-item
                        // message already relies on - see addListingItem's own header
                        // note) gives that fetch a real chance to finish before this
                        // reports a false negative - bounded so a currency that's
                        // genuinely short doesn't hang around silently retrying
                        // forever.
                        const MAX_ATTEMPTS = 10;
                        const RETRY_DELAY_MS = 500;

                        let reasons = [];
                        let collectedItems = [];

                        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
                            reasons = [];
                            collectedItems = [];

                            // Collected (via collectItems) but NOT added to the trade
                            // yet - only committed below (via
                            // tradeOfferWindow.addItemsByElements) once every
                            // requested currency is confirmed fully satisfied, so
                            // e.g. 2 keys + 10 ref with only 8 ref available adds
                            // nothing instead of leaving a half-added offer.
                            for (let i = 0; i < names.length; i++) {
                                const currency = names[i];
                                const amount = currencies[currency];
                                const { items, satisfied } = collectItems(currency, amount, index, isYou);

                                if (!satisfied) {
                                    reasons.push(`not enough ${currency.toLowerCase()}`);
                                } else {
                                    collectedItems = collectedItems.concat(items);
                                }
                            }

                            if (reasons.length === 0) break;
                            if (typeof user.BIsLoadingInventoryData !== 'function' || !user.BIsLoadingInventoryData()) break;

                            await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
                        }

                        if (reasons.length === 0) {
                            tradeOfferWindow.addItemsByElements(collectedItems);
                        }

                        return reasons;
                    }
                    
                    // 0 = buy order
                    // 1 = sell order
                    const listingIntent = urlParams.listing_intent;
                    // we are buying, add items from our inventory
                    // listingIntent could be a string or number so == is used here
                    const isYou = listingIntent == 1;
                    const reasons = await addCurrencies(isYou, {
                        KEYS: parseInt(urlParams.listing_currencies_keys) || 0,
                        METAL: parseFloat(urlParams.listing_currencies_metal) || 0
                    });
                    
                    if (reasons.length > 0) {
                        // display message if any currencies were not met
                        showAlert(`Listing value could not be met: ${reasons.join(' and ')}`);
                    }
                }

                // See runAddListingPrice's own declaration (above "binds
                // events to elements") for why this bridge exists.
                runAddListingPrice = addListingPrice;

                /**
                 * Add items by list of IDs.
                 * @param {string} idsStr - Comma-separated list of IDs.
                 */
                function addIDs(idsStr) {
                    const ids = Utils.getIDsFromString(idsStr);

                    if (ids === null) {
                        return;
                    }

                    addItems('ID', 0, ids, null);
                }

                /**
                 * Add a given amount of items matching a market hash name - for
                 * identically-named but individually-tracked items (e.g. 3
                 * separate Strange Shovels), not Steam "stackable" items (those
                 * are deliberately skipped elsewhere - see addItemsByElements'
                 * own is_stackable check).
                 * @param {string} name - Market hash name to match.
                 */
                function addItemsByName(name) {
                    name = name.trim();

                    if (!name) {
                        return;
                    }

                    // Own dedicated qty field, not the general amount_control up
                    // in the main controls row - that one isn't visually
                    // connected to this section at all, so it goes unnoticed
                    // and the amount would silently default to 1.
                    const amount = parseInt(page.controls.$nameAmount.val()) || 1;
                    const isYou = isYourInventorySelected();

                    if (!addNamedItemsIfAvailable(name, amount, isYou, 'the available inventory')) {
                        return;
                    }

                    // Reset both fields (and close the autocomplete
                    // dropdown) back to their defaults so the next "Add by
                    // name" starts fresh (empty name, amount back to 1)
                    // instead of silently reusing whatever was just typed -
                    // only done on success (the early-return failure path
                    // above leaves everything as-is, so the user can
                    // see/adjust what they asked for without retyping it).
                    page.controls.$name.val('');
                    page.controls.$nameAmount.val(1);
                    closeNameDropdown();
                }

                /**
                 * Adds `amount` items named `name` only if that many are
                 * available, otherwise alerts how many are and adds nothing.
                 * Shared by "Add by name" and "Add More Listed Items".
                 * @param {string} name - Market hash name to match.
                 * @param {number} amount - How many to add.
                 * @param {boolean} isYou - Add from your inventory (true) or theirs.
                 * @param {string} inventoryLabel - Where to say the items were
                 * looked for in the alert, e.g. "your inventory".
                 * @returns {boolean} Whether the items were added.
                 */
                function addNamedItemsIfAvailable(name, amount, isYou, inventoryLabel) {
                    // Checked BEFORE calling addItems - collectItems/pickItems
                    // are pure reads (no mutation happens until addItems'
                    // own tradeOfferWindow.addItemsByElements call), so this
                    // can validate availability first and bail out with
                    // nothing added at all if the full amount isn't there.
                    // addItems calls addItemsByElements UNCONDITIONALLY, even
                    // when its own "satisfied" comes back false - confirmed
                    // live it silently added a partial, unrequested amount
                    // (pickItems' own fallback pads out to whatever it could
                    // find) while still reporting the request as failed, and
                    // an alert built from a check made AFTER that call saw
                    // those same items as already added to the offer - so
                    // "the seller has 2 keys" read back as "none available"
                    // (they'd just been consumed by this same failed call's
                    // own side effect). Checking first avoids both problems
                    // at once instead of trying to undo a partial add after
                    // the fact.
                    const { items: allAvailable } = collectItems('NAME', Infinity, name, isYou);
                    const available = allAvailable.length;

                    if (available < amount) {
                        const availabilityNote = available > 0 ? `only ${available} available` : 'none available';

                        showAlert(`Could not find ${amount} of "${name}" in ${inventoryLabel} (${availabilityNote}).`);
                        return false;
                    }

                    addItems('NAME', amount, name, isYou);
                    return true;
                }

                /**
                 * Adds more of whatever item this trade offer link concerns -
                 * for a sell listing, the "?for_item=440_2_<assetid>" URL
                 * param (already handled below to pre-add exactly that one
                 * asset on page load) names a specific item in THEIR
                 * inventory; for a buy listing, there's no specific asset
                 * (see backpack.tf/{oldUI,nextUI}/fixTradeOfferLinks/content.js), so this instead
                 * adds a matching item from YOUR OWN inventory by name, since
                 * fulfilling a buy order means you're the one selling. Either
                 * way it's a shortcut over manually reading the item's name
                 * and retyping it into "Add by name" yourself. Reuses "Add by
                 * name"'s own qty field (name_amount_control) rather than a
                 * separate one, for the same reason addItemsByName does - one
                 * multiplier field per name-based add, not a duplicate.
                 */
                function addListingItem() {
                    const amount = parseInt(page.controls.$nameAmount.val()) || 1;
                    // 0 = buy order, 1 = sell order (see this file's own
                    // header note). Driven by intent rather than merely
                    // "for_item is missing" - listing_intent is the more
                    // direct, explicit signal (backpack.tf/oldUI/
                    // fixTradeOfferLinks/content.js's own header note
                    // confirms live that classic backpack.tf's native link in
                    // fact never sends for_item at all for a buy listing, so
                    // both checks agree here in practice - listing_intent is
                    // just the one this file doesn't have to infer from an
                    // absence).
                    const isBuyListing = urlParams.listing_intent == 0;

                    if (urlParams.for_item === undefined || isBuyListing) {
                        // Buy listing: no specific asset to look up (see this
                        // file's own header note on for_item_name) - only a
                        // name, and it's YOUR OWN inventory (not theirs) that
                        // has a matching item to offer, since fulfilling a
                        // buy order means you're the one selling.
                        if (!cachedListingItemName) {
                            return;
                        }

                        addNamedItemsIfAvailable(cachedListingItemName, amount, true, 'your inventory');
                        return;
                    }

                    const [appid, contextid, assetid] = urlParams.for_item.split('_');
                    const item = getInventory(appid, contextid, false)[assetid];

                    if (!item) {
                        // Already know this listing's item name - either from
                        // for_item_name straight off the URL (see this file's
                        // own header), or resolved earlier (an earlier
                        // successful call here, or the "register inventory
                        // events" block's own dead-item check caught it as
                        // soon as their inventory finished loading) - fall
                        // back to it directly rather than failing outright,
                        // even though this exact asset is gone now.
                        if (cachedListingItemName) {
                            addNamedItemsIfAvailable(cachedListingItemName, amount, false, 'their inventory');
                            return;
                        }

                        // Steam's own "is this inventory still loading" flag - used
                        // to tell "try again in a moment" (loading) apart from
                        // "this exact asset is truly gone" (already sold/traded
                        // since the listing was made). Both cases look identical
                        // otherwise (item is undefined either way), but only one
                        // of them is worth retrying - for the other, retrying can
                        // never succeed, since for_item only carries an assetid,
                        // never the item's name, and once that specific asset is
                        // gone there's nothing left in the partner's inventory
                        // data to recover the name from.
                        const message = UserThem.BIsLoadingInventoryData()
                            ? 'The listed item hasn\'t finished loading from their inventory yet - try again in a moment.'
                            : 'This listed item is no longer in their inventory (probably already sold/traded since the listing was made) - use "Add by name" instead if you still want more of the same item.';

                        showAlert(message);
                        return;
                    }

                    cachedListingItemName = item.market_hash_name;

                    addNamedItemsIfAvailable(item.market_hash_name, amount, false, 'their inventory');
                }

                /**
                 * Parses a typed amount, accepting a comma OR a dot as the
                 * decimal separator (e.g. "14,66" and "14.66" both parse to
                 * the same value) - metal_amount_control is a plain text
                 * field specifically so a comma can be typed into it at all
                 * (a native type="number" input's own locale-specific
                 * validation silently rejects "," as a keystroke in an
                 * English-locale browser, before this parsing would ever
                 * even see it). Negative amounts don't make sense for any
                 * of the Add buttons (a type="number" min="0" only stops
                 * the spinner, not manual typing/pasting of a "-" value),
                 * so a negative result is normalized to NaN here - the
                 * same "invalid" value a blank field already parses to -
                 * letting getDefaultsForAddItems' own `|| 1` fallback
                 * treat it identically to a blank field instead of passing
                 * a negative count through to collectItems/addItems.
                 */
                function parseAmountInput(value) {
                    const amount = parseFloat(String(value).trim().replace(',', '.'));

                    return amount < 0 ? NaN : amount;
                }

                /**
                 * Nudges one of the "ghost stepper" fields (index_control/
                 * amount_control/name_amount_control - see the .tf2te-
                 * stepper CSS and the "-"/"+" buttons flanking each field
                 * in the template) by one whole unit, clamped to that
                 * field's own minimum. A replacement for the
                 * browser's native number-input spin arrows (tiny,
                 * inconsistent across browsers, and Chrome silently
                 * changes the value if the page happens to be scrolled
                 * while the cursor sits over the field) - typing a number
                 * directly into the field still works.
                 * Takes `min` as a plain parameter rather than reading the
                 * field's own "min" attribute, since that's already known
                 * per field at the call site and avoids a DOM round-trip.
                 * @param {jQuery} $field - Field to nudge.
                 * @param {number} delta - +1 or -1.
                 * @param {number} min - This field's own minimum value.
                 */
                function stepAmountField($field, delta, min) {
                    const current = parseFloat($field.val()) || 0;

                    $field.val(Math.max(min, current + delta));
                }

                /**
                 * Gets default values for adding items.
                 * @param {jQuery} [$amountEl] - Amount field to read from -
                 * defaults to the shared amount_control field (used by "Add"/
                 * "Add Recent"). Add Keys/Add Metal each pass their own
                 * dedicated field instead (keys_amount_control/
                 * metal_amount_control) - own dedicated qty fields, not the
                 * shared one, for the same reason name_amount_control has its
                 * own field rather than reusing amount_control: sharing one
                 * field across Keys/Metal/Items/Recent meant setting an
                 * amount for one silently changed what the next click of a
                 * DIFFERENT button would add too.
                 * @returns {[number, number, boolean]} Default values for adding items.
                 */
                function getDefaultsForAddItems($amountEl) {
                    return [
                        // amount - left blank by default (no pre-filled "1"),
                        // so this falls back to 1 whenever nothing's typed.
                        parseAmountInput(($amountEl || page.controls.$amount).val()) || 1,
                        // index
                        parseInt(page.controls.$index.val()) || 0,
                        // your inventory is selected
                        isYourInventorySelected()
                    ];
                }
                
                /**
                 * Toggles the visibility of the ID fields.
                 */
                function toggleIDFields() {
                    const $controls = page.fields.$ids.toggle();
                    const isVisible  = $controls.is(':visible') ? 1 : 0;
                    
                    setStored(stored.id_visible, isVisible);
                }
                
                /** 
                 * Gets list of ids of items in trade offer.
                 * @returns {string[]} List of IDs.
                 */
                function getIDs() {
                    const isYou = isYourInventorySelected();
                    const $slots = isYou ? page.$yourSlots : page.$theirSlots;
                    const $items = $slots.find('div.item');
                    
                    return $items.toArray().map((el) => {
                        const rgItem = el.rgItem;
                        const assetid = rgItem.id;
                        
                        return assetid;
                    });
                }
                
                /**
                 * Handles key press events.
                 * @param {Event} e - Key press event.
                 */
                function keyPressed(e) {
                    Utils.execHotKey(e, {
                        // P
                        112: toggleIDFields
                    });
                }
                
                /**
                 * Adds items to the trade offer.
                 * @param {string} mode - Mode e.g. 'ITEMS' to add items, 'KEYS' to add keys.
                 * @param {number} amount - Amount of items to add.
                 * @param {number} index - Index to start adding at.
                 * @param {boolean} isYou - Are we adding from your inventory?
                 * @returns {(boolean|null)} Whether the amount was satisfied. Null if the offer cannot be modified.
                 */
                function addItems(
                    mode = 'ITEMS',
                    amount = 1,
                    index = 0,
                    isYou = true
                ) {
                    const canModify = Boolean(
                        (
                            // an inventory is selected (its id encodes an app/context)
                            (/(\d+)_(\d+)$/.test(page.get.$inventory().attr('id'))) ||
                            // the offer cannot be modified
                            page.get.$modifyTradeOffer().length === 0
                        ) &&
                        // the "Change offer" button is not visible
                        !page.get.$changeOfferButton().is(':visible')
                    );
                    
                    // we can modify the items in the offer based on the current window state
                    if (canModify) {
                        const {
                            items,
                            satisfied
                        } = collectItems(
                            mode,
                            amount,
                            index,
                            isYou
                        );
                        
                        tradeOfferWindow.addItemsByElements(items);

                        return satisfied;
                    }

                    return null;
                }

                /**
                 * Handles a click of "Add by position" (ITEMS mode) - same
                 * check-before-add / how-many-available alert / reset-on-
                 * success treatment addKeys/addMetal use below. Like
                 * addMetal, a single non-Infinity collectItems call already
                 * reveals the true available count whenever the request
                 * isn't satisfied: the 'ITEMS' case in getItems splices
                 * from an offset that offsetIndex resets to 0 once
                 * index + amount overruns the visible inventory, so the
                 * splice returns everything there is (see offsetIndex) -
                 * no separate Infinity re-scan needed, unlike
                 * addKeys/addItemsByName's own pickItems-based path.
                 */
                function addByPosition() {
                    const [rawAmount, index, isYou] = getDefaultsForAddItems();
                    // amount is a position COUNT ("add N items"), never
                    // fractional - but step="1" doesn't stop a non-integer
                    // value being typed into amount_control. Without rounding
                    // here, the 'ITEMS' case's own strict
                    // `amount === items.length` check (getItems) could never
                    // be satisfied for a fractional amount (Array#splice
                    // truncates its deleteCount, the equality check doesn't),
                    // so a typed "2.5" would always report "not enough items".
                    const amount = Math.round(rawAmount);

                    const { items: found, satisfied } = collectItems('ITEMS', amount, index, isYou);
                    const available = found.length;

                    if (!satisfied) {
                        const availabilityNote = available > 0 ? `only ${available} available` : 'none available';
                        showAlert(`Could not find ${amount} item${amount === 1 ? '' : 's'} (${availabilityNote}).`);
                        return;
                    }

                    addItems('ITEMS', amount, index, isYou);
                    page.controls.$amount.val('');
                    page.controls.$index.val('');
                }

                /**
                 * Handles a click of "Add Keys" - own wrapper (like
                 * addItemsByName) so a request for more keys than available
                 * can be checked BEFORE calling addItems instead of after,
                 * avoiding addItems' own unconditional-addItemsByElements
                 * call silently adding a partial, unrequested amount (see
                 * addItemsByName's own note on why - same underlying
                 * collectItems/pickItems fallback applies here too, KEYS
                 * mode goes through the exact same pickItems path NAME
                 * mode does). A blank field defaults to 1 key, via
                 * getDefaultsForAddItems' own `|| 1` fallback. Resets the
                 * field back to blank (its own default - see that
                 * function's own note on why blank, not a literal "1") on
                 * success only.
                 * @returns {boolean} Whether the keys were added.
                 */
                function addKeys() {
                    const [amount, index, isYou] = getDefaultsForAddItems(page.controls.$keysAmount);

                    // Keys only come whole. Without this, a typed "2.5"
                    // passes the availability check below and pickItems
                    // keeps picking until it has at least 2.5, so 3 keys
                    // get added.
                    if (!Number.isInteger(amount)) {
                        showAlert(`Keys can only be added in whole numbers (got ${amount}).`);
                        return false;
                    }

                    const { items: allAvailable } = collectItems('KEYS', Infinity, 0, isYou);
                    const available = allAvailable.length;

                    if (available < amount) {
                        const availabilityNote = available > 0 ? `only ${available} available` : 'none available';
                        showAlert(`Could not find ${amount} Mann Co. Supply Crate Key${amount === 1 ? '' : 's'} (${availabilityNote}).`);
                        return false;
                    }

                    addItems('KEYS', amount, index, isYou);
                    page.controls.$keysAmount.val('');
                    return true;
                }

                /**
                 * Handles a click of "Add Metals" - same reasoning as
                 * addKeys above, adapted for METAL mode's own value-based
                 * (not count-based) matching: checks the achievable ref
                 * value BEFORE calling addItems, using
                 * getItemsForMetal's own achievedRefined (the true maximum
                 * achievable from what's available, not capped by the
                 * requested amount - see that function's own note on why).
                 * A single non-Infinity collectItems call already suffices
                 * here (unlike addKeys/addItemsByName's own count-based
                 * pickItems path), since getItemsForMetal always evaluates
                 * every candidate combination, so achievedRefined is the
                 * best achievable value. A blank field defaults to 1 ref, via
                 * getDefaultsForAddItems' own `|| 1` fallback.
                 */
                function addMetal() {
                    const [amount, index, isYou] = getDefaultsForAddItems(page.controls.$metalAmount);

                    const { satisfied, achievedRefined } = collectItems('METAL', amount, index, isYou);

                    if (!satisfied) {
                        const availabilityNote = achievedRefined > 0 ? `only ${achievedRefined.toFixed(2)} ref available` : 'none available';
                        showAlert(`Could not make ${amount.toFixed(2)} ref (${availabilityNote}).`);
                        return;
                    }

                    addItems('METAL', amount, index, isYou);
                    page.controls.$metalAmount.val('');
                }

                // app was changed
                page.$appSelectOption.on('click', (e) => {
                    appChanged(e.target);
                    refreshNameSuggestions();
                });
                // user inventory was changed to your inventory
                page.$inventorySelectYour.on('click', () => {
                    tradeOfferWindow.userChanged(page.$inventorySelectYour);
                    refreshNameSuggestions();
                });
                // user inventory was changed to their inventory
                page.$inventorySelectTheir.on('click', () => {
                    tradeOfferWindow.userChanged(page.$inventorySelectTheir);
                    refreshNameSuggestions();
                });
                page.btns.$clearMy.on('click', () => {
                    tradeOfferWindow.clear(page.$yourSlots);
                });
                page.btns.$clearTheir.on('click', () => {
                    tradeOfferWindow.clear(page.$theirSlots);
                });
                page.btns.$items.on('click', () => {
                    addByPosition();
                });
                page.btns.$indexDec.on('click', () => {
                    stepAmountField(page.controls.$index, -1, 0);
                });
                page.btns.$indexInc.on('click', () => {
                    stepAmountField(page.controls.$index, 1, 0);
                });
                page.btns.$amountDec.on('click', () => {
                    stepAmountField(page.controls.$amount, -1, 0);
                });
                page.btns.$amountInc.on('click', () => {
                    stepAmountField(page.controls.$amount, 1, 0);
                });
                page.btns.$nameAmountDec.on('click', () => {
                    stepAmountField(page.controls.$nameAmount, -1, 1);
                });
                page.btns.$nameAmountInc.on('click', () => {
                    stepAmountField(page.controls.$nameAmount, 1, 1);
                });
                page.btns.$keys.on('click', () => {
                    addKeys();
                });
                // Keys only come whole, so the field takes digits only.
                // step="1" doesn't stop typing "2.5" (and Firefox lets any
                // character into a number field), so non-digit keystrokes
                // and non-digit pastes are refused here. Shortcuts (Ctrl/Cmd)
                // and editing keys (Backspace, arrows, Tab: e.key longer
                // than one character) still work. addKeys keeps its own
                // whole-number alert for anything that gets past this
                // (e.g. drag-and-drop).
                page.controls.$keysAmount.on('keydown', (e) => {
                    if (e.key && e.key.length === 1 && !/\d/.test(e.key) && !e.ctrlKey && !e.metaKey) {
                        e.preventDefault();
                    }
                });
                page.controls.$keysAmount.on('paste', (e) => {
                    const pasted = (e.originalEvent || e).clipboardData?.getData('text') ?? '';
                    if (!/^\d+$/.test(pasted.trim())) {
                        e.preventDefault();
                    }
                });
                page.btns.$metal.on('click', () => {
                    addMetal();
                });

                // Craft-weapon fallback data for getItemsForMetal (see that
                // function's own note, and craftWeaponNames' own declaration
                // above) - broadcast (not requested) by
                // tradeOfferSettingsBridge/content.js once the schema's own
                // weapon-name list is ready,
                // and again whenever a Steam Web API key gets saved/changed
                // later in the same session (that file's own listener
                // handles the "when" - this side just always takes whatever
                // it's given).
                document.addEventListener('tf2te-craft-weapon-names-broadcast', (event) => {
                    const { names } = typeof event.detail === 'string' ? JSON.parse(event.detail) : event.detail;
                    craftWeaponNames = names || [];
                });
                // General settings toggle, same broadcast pattern as
                // craft-weapon names just above - see
                // autoAddListingCurrencyEnabled's own declaration for what
                // this gates. Broadcast (not requested) by
                // tradeOfferSettingsBridge/content.js, which owns reading the
                // popup's own saved setting from chrome.storage.
                document.addEventListener('tf2te-auto-add-listing-currency-setting-broadcast', (event) => {
                    const { enabled } = typeof event.detail === 'string' ? JSON.parse(event.detail) : event.detail;
                    autoAddListingCurrencyEnabled = enabled !== false;
                });
                // See listingLinkTrusted's own declaration. Runs whatever
                // pre-fill already waited for it (inventory loaded first).
                document.addEventListener('tf2te-listing-link-trust-broadcast', (event) => {
                    const { trusted } = typeof event.detail === 'string' ? JSON.parse(event.detail) : event.detail;
                    if (trusted !== true || listingLinkTrusted) return;

                    listingLinkTrusted = true;
                    actionsAwaitingListingLinkTrust.splice(0).forEach((action) => action());
                });
                page.btns.$recent.on('click', () => {
                    addItems('RECENT', ...getDefaultsForAddItems());
                });
                page.btns.$listing.on('click', () => {
                    addListingPrice();
                });
                page.btns.$listingItem.on('click', () => {
                    addListingItem();
                });
                page.btns.$addIDs.on('click', () => {
                    addIDs(page.controls.$ids.val());
                });
                page.btns.$getIDs.on('click', () => {
                    page.controls.$ids.val(getIDs().join(','));
                });
                page.btns.$addName.on('click', () => {
                    addItemsByName(page.controls.$name.val());
                });
                // Set right before closeNameDropdown() runs as part of
                // accepting a highlighted suggestion via Enter (see the
                // keydown handler below) - checked (and always reset) by
                // the keypress handler just below it so that SAME Enter
                // press accepts the suggestion into the field WITHOUT also
                // submitting "Add by name" immediately - a second, distinct
                // Enter press (the dropdown now closed) is what actually
                // submits. Not relying on e.preventDefault() in keydown to
                // suppress the subsequent keypress event instead - whether
                // that actually happens for Enter specifically isn't
                // consistent enough across engines to depend on.
                let justAcceptedDropdownSuggestion = false;

                page.controls.$name.on('keypress', (e) => {
                    if (e.which === 13) {
                        if (justAcceptedDropdownSuggestion) {
                            justAcceptedDropdownSuggestion = false;
                            return;
                        }

                        // Enter - same as clicking "Add by name"
                        addItemsByName(page.controls.$name.val());
                    }
                });

                // Dropdown-based autocomplete for name_control (see
                // refreshNameSuggestions/findMatchingNames/closeNameDropdown/
                // renderNameDropdown's own notes): a clickable list showing
                // every match at once (arrow keys + Enter, or a click - the
                // standard type-ahead search convention), rather than a native
                // <datalist> or a Tab-cycle through one match at a time, suits
                // this field's own large, dynamic match set better.
                page.controls.$name.on('keydown', (e) => {
                    if (e.key === 'ArrowDown') {
                        if (dropdownMatches.length === 0) {
                            return;
                        }
                        e.preventDefault();
                        dropdownHighlightIndex = (dropdownHighlightIndex + 1) % dropdownMatches.length;
                        renderNameDropdown();
                    } else if (e.key === 'ArrowUp') {
                        if (dropdownMatches.length === 0) {
                            return;
                        }
                        e.preventDefault();
                        dropdownHighlightIndex = (dropdownHighlightIndex - 1 + dropdownMatches.length) % dropdownMatches.length;
                        renderNameDropdown();
                    } else if (e.key === 'Enter') {
                        if (dropdownHighlightIndex === -1 || dropdownMatches.length === 0) {
                            return; // no suggestion highlighted - let the keypress handler above submit normally
                        }
                        e.preventDefault();
                        page.controls.$name.val(dropdownMatches[dropdownHighlightIndex]);
                        closeNameDropdown();
                        justAcceptedDropdownSuggestion = true;
                    } else if (e.key === 'Escape') {
                        closeNameDropdown();
                    }
                });
                page.controls.$name.on('keyup', (e) => {
                    if (['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(e.key)) {
                        return; // already fully handled in keydown above
                    }

                    // availableNames is recomputed fresh on every keystroke,
                    // not just on a tab/app switch or a side's first
                    // inventory registration (see refreshNameSuggestions' own
                    // note). Recomputing fresh right here means whatever Steam
                    // has ACTUALLY finished loading by the moment the user
                    // is really searching is what gets matched against -
                    // cheap enough (iterating a few hundred
                    // already-in-memory object keys) to do on every
                    // keystroke rather than only on those specific events.
                    refreshNameSuggestions();
                    dropdownMatches = findMatchingNames(page.controls.$name.val().trim());
                    dropdownHighlightIndex = dropdownMatches.length > 0 ? 0 : -1;
                    renderNameDropdown();
                });
                page.controls.$name.on('blur', () => {
                    closeNameDropdown();
                });
                // The standard fix for blur firing (and, per the handler
                // above, closing the dropdown) BEFORE a row's own click
                // event would otherwise get a chance to run at all -
                // suppresses the mousedown's own default focus-stealing
                // behavior, so the input never actually blurs from a click
                // inside the dropdown in the first place.
                page.fields.$nameDropdown.on('mousedown', (e) => {
                    e.preventDefault();
                });

                page.$document.on('keypress', (e) => {
                    keyPressed(e);
                });
            }
            
            // register inventory events
            {
                // this will force an inventory to load
                function forceInventory(appid, contextid) {
                    TRADE_STATUS.them.assets.push({
                        appid: appid,
                        contextid: contextid,
                        assetid: '0',
                        amount: 1
                    });
                    
                    try {
                        WINDOW.RefreshTradeStatus(TRADE_STATUS, true);
                    } catch (e) {
                        // ignore the error
                    }
                    
                    TRADE_STATUS.them.assets = [];
                    
                    try {
                        WINDOW.RefreshTradeStatus(TRADE_STATUS, true);
                    } catch (e) {
                        // ignore the error
                    }
                }
                
                /**
                 * Switches to "their" inventory tab, synchronously - just
                 * enough to make its own item tiles exist in the DOM (Steam
                 * only ever renders/keeps the currently-active tab's grid
                 * around), then switches back to whichever tab was active
                 * before. Used by customizeElements below, where the only
                 * goal is decorating whatever tiles already exist by the time
                 * this returns (a best-effort visual touch-up, not something
                 * a caller depends on afterward) - see withTheirInventoryVisible
                 * (below) for the OTHER "their" tab use (auto-adding the
                 * listing's own price), which needs a stronger guarantee than
                 * this gives and switches back only once its own work is done,
                 * not immediately like this.
                 * @returns {undefined}
                 */
                function forceVisibility() {
                    const $activeTab = page.get.$activeInventoryTab();
                    const $theirs = page.$inventorySelectTheir;

                    $theirs.trigger('click');
                    $activeTab.trigger('click');
                }

                // customizes the elements in the inventory
                function customizeElements(steamid, appid, contextid) {
                    const isYou = steamid === STEAMID;
                    const inventory = isYou ? INVENTORY : PARTNER_INVENTORY;
                    const contextInventory = inventory[appid].rgContexts[contextid].inventory.rgInventory;

                    if (!isYou) {
                        // force the items in their inventory to be displayed so we can add images
                        // if their inventory has not been displayed
                        forceVisibility();
                    }

                    customizeItems(contextInventory);
                    // re-summarize
                    tradeOfferWindow.summarize(isYou);
                    refreshNameSuggestions();
                }

                /**
                 * Switches to "their" inventory tab, runs fn, and only THEN
                 * switches back to whatever tab was active before - unlike
                 * forceVisibility above (which switches back immediately,
                 * fine for a fire-and-forget visual touch-up), fn here needs
                 * "their" tab to still genuinely be the active/visible one
                 * for its own DOM-element lookups (getElementsForItems inside
                 * addListingPrice's own collectItems) to find anything at
                 * all - Steam only ever renders/keeps the currently-active
                 * tab's own item tiles in the DOM. Confirmed live: switching
                 * back before fn runs leaves fn finding no tiles at all, so a
                 * buy listing's keys/metal price (the only case that needs
                 * "their" tab forced - see this function's own call site)
                 * silently never gets added. A single extra tick
                 * (setTimeout 0) before fn runs, not just the reorder alone,
                 * since a large inventory rendered for the very first time
                 * (this tab was never actually visited before) isn't
                 * guaranteed to finish synchronously within trigger('click')
                 * itself either.
                 * @param {function(): (Promise<void>|void)} fn
                 * @returns {Promise<void>}
                 */
                async function withTheirInventoryVisible(fn) {
                    const $activeTab = page.get.$activeInventoryTab();
                    const $theirs = page.$inventorySelectTheir;

                    $theirs.trigger('click');
                    await new Promise((resolve) => setTimeout(resolve, 0));

                    try {
                        await fn();
                    } finally {
                        $activeTab.trigger('click');
                    }
                }
                

                // 0 = buy order, 1 = sell order (see this file's own header
                // note) - listing_intent==0 means WE'RE the one selling (the
                // listing itself is someone else's buy order). Shared below
                // by both the forceInventory call and the for_item/buy-
                // listing branch further down, rather than each recomputing
                // its own copy of the same boolean.
                const isBuyListing = urlParams.listing_intent == 0;

                if (urlParams.listing_intent !== undefined) {
                    page.btns.$listing.addClass(isBuyListing ? 'selling' : 'buying');

                    // force their inventory to load if we are selling
                    if (isBuyListing) {
                        forceInventory('440', '2');
                    }
                }

                // Auto-adds the listing's own keys/metal price the moment
                // the paying side's inventory has finished loading - same
                // "pre-fill the trade to match the listing" treatment the
                // item itself already gets (both the sell-listing for_item
                // push below and the buy-listing name-match block further
                // down), just for currency instead of leaving "Add
                // requested pure" as something the user has to click
                // themselves every time. Mirrors addListingPrice's own
                // `isYou = listing_intent == 1` (sell listing: the price is
                // what YOU pay, from your own inventory; buy listing: it's
                // what THEY pay, from theirs) to pick which side's
                // inventory-loaded event to wait for. addListingPrice's own
                // showAlert call already covers "not enough keys/metal" -
                // nothing extra needed here for that. Only for a link opened
                // on backpack.tf (see listingLinkTrusted's own declaration).
                if (
                    urlParams.listing_intent !== undefined &&
                    (urlParams.listing_currencies_keys !== undefined || urlParams.listing_currencies_metal !== undefined)
                ) {
                    const isSellListing = urlParams.listing_intent == 1;
                    const priceFromSteamId = isSellListing ? STEAMID : PARTNER_STEAMID;

                    inventoryManager.register(priceFromSteamId, '440', '2', () => {
                        whenListingLinkTrusted(() => {
                            // Checked HERE, at the moment the pre-fill
                            // actually runs, not by wrapping the
                            // inventoryManager.register() call above - that
                            // can be much later, and this always sees
                            // whatever the user most recently chose. See #54.
                            if (!autoAddListingCurrencyEnabled) return;

                            // getElementsForItems (inside addListingPrice's own
                            // collectItems -> getItemsForMetal/getItems('KEYS'))
                            // resolves picked items via document.getElementById,
                            // which only exists once that side's inventory GRID
                            // has actually been rendered into the DOM at least
                            // once - NOT the same thing as forceInventory above
                            // having loaded the underlying rgInventory DATA.
                            // Your OWN inventory (the sell-listing case) doesn't
                            // need this - it's the default active tab already. See #55.
                            if (!isSellListing) {
                                withTheirInventoryVisible(runAddListingPrice);
                            } else {
                                runAddListingPrice();
                            }
                        });
                    });
                }

                // Excludes a buy listing even when for_item is present -
                // classic backpack.tf's own native link sends for_item
                // unconditionally, but for a buy listing it never refers to a
                // real asset in EITHER inventory (a buy order has none to
                // begin with - see addListingItem's own note), so blindly
                // pushing it here would only ever produce the "no longer
                // available" dead-item alert below for every single buy-
                // listing link. The buy-listing block further down handles
                // that case instead, from your own inventory.
                if (urlParams.for_item !== undefined && !isBuyListing) {
                    // "Add More Listed Items" button visibility itself is
                    // handled in updateDisplay (shown only while "Their
                    // inventory" is the active tab, since for_item always
                    // refers to an item on their side) - nothing to do here.

                    const [appid, contextid, assetid] = urlParams.for_item.split('_');
                    const item = {
                        appid,
                        contextid,
                        assetid,
                        amount: 1
                    };

                    TRADE_STATUS.them.assets.push(item);

                    // Same try/catch forceInventory above already uses for
                    // this exact call - confirmed live that Steam's own
                    // RefreshTradeStatus can throw here ("can't access
                    // property 'OnUserAddedItemsToTrade', Tutorial is null"),
                    // and since nothing downstream of this block catches it,
                    // an uncaught throw here aborted ALL of this script's
                    // remaining synchronous setup - including the "observe
                    // changes to dom" block further down that registers the
                    // summarize() MutationObservers, silently leaving the
                    // item summary permanently blank
                    // for the rest of the page's lifetime.
                    try {
                        WINDOW.RefreshTradeStatus(TRADE_STATUS, true);
                    } catch (e) {
                        // ignore the error
                    }

                    // check for a dead item when this inventory is loaded
                    inventoryManager.register(PARTNER_STEAMID, appid, contextid, () => {
                        // Cache the listing's item name as soon as it's known -
                        // covers the race where this asset is still there right
                        // now (so its name can be read off it) but gets
                        // sold/traded to someone else before the user ever
                        // clicks "Add More Listed Items" themselves, which would
                        // otherwise never get its own chance to resolve+cache
                        // it (see addListingItem's own cachedListingItemName).
                        const loadedItem = getInventory(appid, contextid, false)[assetid];
                        if (loadedItem) {
                            cachedListingItemName = loadedItem.market_hash_name;
                        }

                        if (page.get.$deadItem().length === 0) {
                            return;
                        }

                        TRADE_STATUS.them.assets = [];

                        // Same reasoning as this block's own first
                        // RefreshTradeStatus call above - don't let a Steam-
                        // side throw here take down the rest of this script's
                        // setup by callback time (this runs once the
                        // partner's inventory has finished loading, well
                        // after "observe changes to dom" has already
                        // registered - lower-stakes than the first call, but
                        // still not something worth risking).
                        try {
                            WINDOW.RefreshTradeStatus(TRADE_STATUS, true);
                        } catch (e) {
                            // ignore the error
                        }

                        showAlert(
                            `Seems like the item you are looking to buy (ID: ${assetid}) is no longer available. ` +
                            'You should check other user\'s backpack and see if it\'s still there.'
                        );
                    });
                }

                // Buy listing (see the block above's own note on why it's
                // excluded from there even when for_item is present): the
                // mirror image of that block's automatic pre-add, but the
                // match is in YOUR OWN inventory (not theirs), since
                // fulfilling a buy order means you're the one selling.
                // Deliberately uses the same raw getInventory/TRADE_STATUS/
                // RefreshTradeStatus approach as the for_item block above
                // rather than calling addItems - this "register inventory
                // events" block is its own sibling block from the "binds
                // events to elements" block addItems/addListingItem live in
                // (both are bare blocks, and under this file's 'use strict',
                // a block-scoped function declaration isn't reachable outside
                // the block it's declared in - the SAME reason the for_item
                // block above never called addItems either). Only for a
                // link opened on backpack.tf (see listingLinkTrusted's own
                // declaration), since this puts one of YOUR items in the offer.
                if (isBuyListing && cachedListingItemName) {
                    inventoryManager.register(STEAMID, '440', '2', () => whenListingLinkTrusted(() => {
                        const inventory = getInventory('440', '2', true);
                        // Same "Taunt: " prefix fallback as finders.name above - this
                        // path bypasses collectItems entirely (it reads the inventory
                        // directly rather than going through addItems('NAME', ...)),
                        // so it needs its own copy of the same tolerant comparison.
                        const entry = Object.entries(inventory).find(
                            ([, invItem]) =>
                                invItem.market_hash_name === cachedListingItemName ||
                                invItem.market_hash_name.replace(/^Taunt:\s*/i, '') === cachedListingItemName
                        );

                        if (!entry) {
                            showAlert(
                                `Could not find "${cachedListingItemName}" in your inventory to fulfill this buy order - ` +
                                'use "Add by name" instead if you still want to offer a different matching item.'
                            );
                            return;
                        }

                        const [assetid] = entry;

                        TRADE_STATUS.me.assets.push({
                            appid: '440',
                            contextid: '2',
                            assetid,
                            amount: 1
                        });

                        try {
                            WINDOW.RefreshTradeStatus(TRADE_STATUS, true);
                        } catch (e) {
                            // ignore the error
                        }
                    }));
                }

                [STEAMID, PARTNER_STEAMID].forEach((steamid) => {
                    inventoryManager.register(steamid, '440', '2', customizeElements);
                });
            }
            
            // observe changes to dom
            {
                // observe changes to trade slots
                {
                    /**
                     * Observe changes to slots.
                     * @param {HTMLElement} slotsEl - Slots element.
                     * @param {boolean} isYou - Is this your inventory?
                     */
                    function observeSlots(slotsEl, isYou) {
                        const observerOptions = {
                            childList: true,
                            characterData: false,
                            subtree: true
                        };

                        // summarizes the trade offer
                        function summarize() {
                            // collapseDuplicateSlots (like this whole function
                            // is itself named) mutates this same observed
                            // subtree - adding/removing its own "xN" badge is
                            // a childList change, which subtree:true means
                            // this very observer would otherwise immediately
                            // see and react to, re-scheduling another pass
                            // forever - confirmed live as a runaway loop that
                            // kept re-running the summaries well under once a
                            // second, indefinitely. Disconnecting
                            // first, then reconnecting right after, means
                            // only a REAL slot change (an item actually
                            // added/removed) can ever trigger the next pass.
                            observer.disconnect();

                            // Each of these three independently walks the
                            // current slot list - run separately (not one
                            // shared try/catch) so a throw from one (e.g. an
                            // item whose inventory data hasn't fully loaded
                            // yet - a real, confirmed-live throw point under
                            // heavy/fast item-adding load, which is why
                            // evaluateItems/getInventory now guard every
                            // level of that inventory[appid].rgContexts[...]
                            // chain rather than just the first) doesn't also
                            // skip the other two for this same pass. Whatever
                            // happens, the observer below MUST
                            // still reconnect - leaving it disconnected would
                            // silently stop ALL of these features (summary,
                            // duplicate collapsing, history icons) for this
                            // side for the rest of the page's lifetime, which
                            // is what read live as history icons "randomly"
                            // missing and never recovering. A later, healthy
                            // pass (triggered by any further slot change)
                            // re-processes every slot from scratch, so
                            // whatever a failed pass missed self-heals then.
                            [
                                () => tradeOfferWindow.summarize(isYou),
                                () => tradeOfferWindow.collapseDuplicateSlots(isYou),
                                () => tradeOfferWindow.addItemHistoryLinks(isYou)
                            ].forEach((fn) => {
                                try {
                                    fn();
                                } catch (e) {
                                    console.error('[TF2 Trading Enhancer] Failed to refresh trade slots:', e);
                                }
                            });

                            observer.observe(slotsEl, observerOptions);
                            lastSummarized = new Date(); // add date
                        }

                        const observer = new MutationObserver(() => {
                            const canInstantSummarize = Boolean(
                                !lastSummarized ||
                                // compare with date when last summarized
                                new Date() - lastSummarized > 200  ||
                                // large summaries take longer to build and can hurt performance
                                slotsEl.children.length <= 204
                            );
                            const interval = canInstantSummarize ? 10 : 200;

                            // we use a timer so that if multiple dom insertions occur at the same time this will only run once
                            clearTimeout(timer);
                            timer = setTimeout(summarize, interval);
                        });
                        let lastSummarized = new Date();
                        let timer;

                        observer.observe(slotsEl, observerOptions);
                    }
                    
                    observeSlots(page.$yourSlots[0], true);
                    observeSlots(page.$theirSlots[0], false);
                }
                
                // observe inventory changes
                {
                    const handleInventoryNode = (inventory) => {
                        if (!inventory.id) return;

                        const split = inventory.id.replace('inventory_', '').split('_');
                        const [steamid, appid, contextid] = split;

                        inventoryManager.call(steamid, appid, contextid);

                        // Confirmed live: the "configure state" block's own
                        // userChanged call can run before any .inventory_ctn
                        // is visible, resolving no appid at all - which
                        // updateDisplay reads as "not TF2", hiding the pure-
                        // totals row and Add Keys/Metals row until a tab or
                        // app click re-ran it. Re-run it now that this side's
                        // container (whose id names its appid) exists - only
                        // for the side whose tab is actually showing, so a
                        // background load of the other side can't override it.
                        const isYou = steamid === STEAMID;
                        if ((isYou || steamid === PARTNER_STEAMID) && isYou === isYourInventorySelected()) {
                            tradeOfferWindow.updateDisplay(isYou, appid);
                        }
                    };

                    // An inventory's own #inventory_{steamid}_{appid}_{contextid}
                    // container can already be sitting in #inventories by the time
                    // this observer is attached - MutationObserver only ever reports
                    // FUTURE childList changes, never ones that already happened, so
                    // the containers already present are handled explicitly below.
                    // Without that, the auto-add-by-name feature (for_item_name=)
                    // would only work after a manual page refresh.
                    //
                    // Deferred via Promise.resolve().then(...) rather than called
                    // right here - a REAL MutationObserver callback is ALWAYS itself
                    // microtask-queued, even for a mutation that happens the instant
                    // .observe() is called, so the rest of main() - the "configure
                    // state" block and window.__tf2te__.installTradeSlotOverrides(...)
                    // at the very end, which patches the trade-manipulation functions
                    // the auto-add callbacks actually call - has ALWAYS already
                    // finished running by the time inventoryManager.call() fires for
                    // any inventory, live-caught or not. Calling it synchronously
                    // here instead would fire it mid-main(), before
                    // installTradeSlotOverrides had even run, so the auto-add
                    // callbacks would hit Steam's unpatched trade functions (e.g.
                    // GTradeStateManager.RemoveItemsFromTrade). Nothing else runs
                    // between observer.observe() below and this microtask, so no
                    // insertion can fall into a gap between the two. See #9.
                    Promise.resolve().then(() => {
                        Array.from(page.$inventories[0].children).forEach(handleInventoryNode);
                    });

                    const observer = new MutationObserver((mutations) => {
                        // both inventories can be inserted within the same batch, so
                        // every mutation and every added node must be inspected
                        mutations.forEach((mutation) => {
                            Array.from(mutation.addedNodes).forEach(handleInventoryNode);
                        });
                    });

                    observer.observe(page.$inventories[0], {
                        childList: true,
                        characterData: false,
                        subtree: false
                    });
                }
            }
            
            // configure state
            {
                tradeOfferWindow.userChanged(page.get.$activeInventoryTab());
                refreshNameSuggestions();

                if (getStored(stored.id_visible) == 1) {
                    page.fields.$ids.show();
                }
            }
            
            // override page functions - see pages/tradeSlotOverrides.js
            window.__tf2te__.installTradeSlotOverrides(page, TRADE_STATUS);
        }
    }

);

}());
