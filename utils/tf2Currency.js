/*
@description: Fixed TF2 currency conventions (not live prices).
steamcommunity.com/tradeOffer/pages/tradeoffer.js keeps its own copy of this
value because it runs as a classic MAIN-world script and cannot import ES
modules.
*/

/*
@description: Trading-community value of one plain, Unique-quality,
Craftable weapon: a flat 0.05 ref (roughly half a Scrap). The exact recipe
value (2 weapons = 1 Scrap, so 1/18 ref) would display as "0.06 ref" once
rounded to 2 decimals, which is not the figure traders use.
*/
export const CRAFT_WEAPON_VALUE_REFINED = 0.05;
