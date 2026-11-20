/*
@description: scrap.tf-specific lookup table for the itemLinks feature. Tables
shared with other sites live in utils/tf2AttributeIds.js and
utils/tf2StatsLinks/fabricatorKit.js.
*/

// Tier word as it appears in scrap.tf's raw name for a Killstreak Kit or Kit
// Fabricator ("Professional X Kit", "Specialized X Kit Fabricator", "Basic X
// Kit") -> Valve's killstreak tier number. "Basic" is a literal prefix
// word in scrap.tf's raw name (e.g. "Basic Big Kill Kit").
// utils/tf2StatsLinks/common.js has a same-named table without "Basic"
// (Steam/backpack.tf names never spell it out); both resolve to tier 1.
export const KILLSTREAK_TIER_BY_WORD = { Professional: 3, Specialized: 2, Basic: 1 };
