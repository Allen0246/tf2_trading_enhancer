/*
@description: Name-only detection of scrap.tf's crafting-tool item types
(Killstreak Kit, Kit Fabricator, Strangifier) for the itemLinks item card -
see detectToolVariants below.
*/
import { KILLSTREAK_TIER_BY_WORD } from "./constants.js";

/*
@description: Synchronously detects, from an item's raw tooltip name alone,
whether it's a Killstreak Kit, a Killstreak Kit Fabricator, or a target-item
tool (Strangifier) - and if so, which weapon/tier it targets. Pure regex
matching against `name`; none of these need the hovered DOM element, unlike
quality/killstreak-tier/skin detection elsewhere in itemShape.js. The
resulting target names still need an async schema lookup for their defindex -
that's kept out of this module (done by detectItemShape instead) so this one
stays synchronous and independently testable. Mirrors
utils/tf2StatsLinks/'s matchTargetItemTool/matchKillstreakKit/
matchFabricatorKit, adapted to scrap.tf's raw names (which omit the word
"Killstreak"); building links from the full raw name would 404.
@args:
  - name: raw tooltip name of the item
@returns tool-variant identity fields - see the property comments below.
*/
export function detectToolVariants(name) {
  // --- KILLSTREAK KIT (crafting tool) DETECTION ---
  // A Killstreak Kit is a tool that crafts onto a weapon - it's not itself a
  // killstreak-tiered weapon (no killstreak1/2/3 class), and scrap.tf's own
  // display name is missing the word "Killstreak" that backpack.tf's real
  // name has ("Professional Rocket Launcher Kit" here vs. backpack.tf's
  // "Professional Killstreak Rocket Launcher Kit"). Confirmed live for
  // Professional and Basic tiers ("Basic Big Kill Kit"); Specialized is
  // assumed to follow the same pattern. "Basic " is a literal prefix too.
  const killstreakKitMatch = /^(Professional |Specialized |Basic )?(.+) Kit$/i.exec(name);
  const isKillstreakKit = !!killstreakKitMatch;
  const killstreakKitTargetName = killstreakKitMatch ? killstreakKitMatch[2].trim() : null;
  const killstreakKitTier = killstreakKitMatch ? KILLSTREAK_TIER_BY_WORD[killstreakKitMatch[1]?.trim()] ?? 1 : null;
  // Steam's market_hash_name for a Kit needs the tier word back with its
  // original trailing space for Professional/Specialized, but Basic's own
  // Steam name omits the word entirely ("Killstreak Rocket Launcher Kit", not
  // "Basic Killstreak Rocket Launcher Kit") despite scrap.tf's raw name
  // carrying it - so unlike Professional/Specialized, Basic's captured text
  // is deliberately discarded here rather than kept verbatim.
  const killstreakKitTierWord = killstreakKitMatch
    ? killstreakKitMatch[1]?.trim() === "Basic"
      ? ""
      : killstreakKitMatch[1] || ""
    : null;

  // --- TARGET-ITEM TOOL (Strangifier) DETECTION ---
  // backpack.tf's canonical item is the tool itself ("Strangifier"), with
  // the specific weapon it targets (e.g. "Righteous Bison") encoded as a
  // defindex path suffix, the same way Unusual effects append a particle id
  // - same pattern as Killstreak Kits above, just a single fixed tool name
  // instead of a tiered one.
  //
  // A Strangifier CHEMISTRY SET (a crafting tool that strangifies one
  // specific promotional/exclusive item, e.g. "Professor Speks Strangifier
  // Chemistry Set Series #2") doesn't end in the plain " Strangifier" suffix
  // at all - "Strangifier" sits in the MIDDLE, followed by a variable
  // "Chemistry Set Series #{n}" tag. backpack.tf's own canonical item name
  // for it is just "Chemistry Set", not "Strangifier", so
  // targetToolBaseItemName is threaded through separately (see links.js's
  // own callers) rather than hardcoding the literal word "Strangifier". See #36.
  const chemistrySetMatch = /^(.+) Strangifier Chemistry Set Series #\d+$/i.exec(name);
  const targetToolMatch = chemistrySetMatch || /^(.+) Strangifier$/i.exec(name);
  const isTargetTool = !!targetToolMatch;
  const targetToolTargetName = targetToolMatch ? targetToolMatch[1].trim() : null;
  const targetToolBaseItemName = chemistrySetMatch ? "Chemistry Set" : "Strangifier";

  // --- KILLSTREAK KIT FABRICATOR DETECTION ---
  // The crafting tool that PRODUCES a Kit, not the Kit itself - same tier/
  // target-weapon shape as killstreakKitMatch above (and the same "Killstreak"
  // word omitted from scrap.tf's raw name), just ending in " Kit Fabricator"
  // instead of " Kit". The literal "Basic " prefix is assumed by analogy
  // with Kits (not confirmed for a Basic Fabricator).
  const fabricatorKitMatch = /^(Professional |Specialized |Basic )?(.+) Kit Fabricator$/i.exec(name);
  const isFabricatorKit = !!fabricatorKitMatch;
  const fabricatorKitTargetName = fabricatorKitMatch ? fabricatorKitMatch[2].trim() : null;
  const fabricatorKitTier = fabricatorKitMatch ? KILLSTREAK_TIER_BY_WORD[fabricatorKitMatch[1]?.trim()] ?? 1 : null;
  // Same "Killstreak" reinsertion as killstreakKitTierWord above: scrap.tf's
  // "Specialized Conniver's Kunai Kit Fabricator" is Steam's "Specialized
  // Killstreak Conniver's Kunai Kit Fabricator" (see links.js's
  // buildSteamMarketName).
  const fabricatorKitTierWord = fabricatorKitMatch
    ? fabricatorKitMatch[1]?.trim() === "Basic"
      ? ""
      : fabricatorKitMatch[1] || ""
    : null;

  return {
    isKillstreakKit,
    killstreakKitTargetName,
    killstreakKitTier,
    killstreakKitTierWord,

    isTargetTool,
    targetToolTargetName,
    targetToolBaseItemName,

    isFabricatorKit,
    fabricatorKitTargetName,
    fabricatorKitTier,
    fabricatorKitTierWord,
  };
}
