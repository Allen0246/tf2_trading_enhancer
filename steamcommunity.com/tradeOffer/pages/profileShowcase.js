/**
 * steamcommunity.com profile pages - adds icon overlays to showcase items.
 * Registers into the shared script registry built by ../shared.js; executed by ../bootstrap.js.
 */
(function () {
'use strict';

window.__tf2te__.scripts.push(
    {
        includes: [
            /^https?:\/\/steamcommunity\.com\/(?:id|profiles)\/[^\/]+(\/$|\?|$)/
        ],
        styles: `
            ${window.__tf2te__.sharedStyles.itemOverlay}

            /* This page's own .strange:before adds pointer-events: none on
               top of the shared block above - unlike every other page
               sharing that block, which leaves pointer-events unset there.
               Kept page-local (not folded into the shared block itself)
               since nothing confirms the other pages need it - this rule's
               later source position wins the cascade for just this one
               property, without needing !important. */
            .strange:before {
                pointer-events: none;
            }

            .item_showcase_item {
                line-height: inherit !important;
            }
        `,
        fn: function main({ addAttributesToHoverItems }) {
            const itemsList = document.getElementsByClassName('item_showcase_item');
            
            // add attributes to images - so easy!
            addAttributesToHoverItems(itemsList);
        }
    },

);

}());
