/*
@description: Reads an item element's Killstreak tier (0 = none, 1-3 =
Killstreak/Specialized/Professional) off its scrap.tf "killstreakN" CSS
class - a scrap.tf-specific rendering convention (unlike Valve's own quality
ids/names, which utils/tf2Quality.js centralizes as those are shared across
every site this extension touches), so this lives here instead of utils/.

Used by scrap.tf/sellDuplicates and scrap.tf/itemLinks/itemShape.js.
*/
export function getKillstreakTier(classList) {
  if (classList.contains("killstreak3")) return 3;
  if (classList.contains("killstreak2")) return 2;
  if (classList.contains("killstreak1")) return 1;
  return 0;
}
