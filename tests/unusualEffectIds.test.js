import { test } from "node:test";
import assert from "node:assert/strict";
import { UNUSUAL_EFFECT_IDS, getUnusualEffectNameById } from "../utils/unusualEffectIds.js";

// Originally a one-off mechanical extraction from steamcommunity.com/
// tradeOffer/unusualEffects.js's own window.__tf2teUnusualEffectsMap__ - now
// independently regenerated via scripts/updateUnusualEffects.js from a live
// GetSchemaOverview fetch (see that script's own header note), so the two
// files are expected to drift apart over time as this one gets refreshed and
// that one doesn't - these checks aren't guarding "stays identical to that
// other file" anymore, just "the table itself still looks sane after a
// regeneration".
test("UNUSUAL_EFFECT_IDS has the full ~500+ entry table, including the confirmed-live 'Chiroptera Venenata' fix (75, not aliased to Spellbound's 74)", () => {
  assert.equal(Object.keys(UNUSUAL_EFFECT_IDS).length > 400, true);
  assert.equal(UNUSUAL_EFFECT_IDS["Burning Flames"], 13);
  assert.equal(UNUSUAL_EFFECT_IDS["Chiroptera Venenata"], 75);
  assert.equal(UNUSUAL_EFFECT_IDS["Morbidly Beast"], 3211);
  // "Blissful Butterflies"/413 and "Floral Growth"/410 were both the exact
  // live gaps that motivated writing scripts/updateUnusualEffects.js in the
  // first place (see posts.tf/itemQuickLinks/content.js's own header note) -
  // asserted here so a future regeneration can't silently lose them again.
  assert.equal(UNUSUAL_EFFECT_IDS["Blissful Butterflies"], 413);
  assert.equal(UNUSUAL_EFFECT_IDS["Floral Growth"], 410);
});

// Confirmed via posts.tf/itemQuickLinks/content.js's own
// real reported items - the actual reverse-lookup direction this table is
// used in (see this file's own header note).
test("getUnusualEffectNameById resolves real confirmed-live ids to their names", () => {
  assert.equal(getUnusualEffectNameById(35), "Smoking");
  assert.equal(getUnusualEffectNameById(305), "Arachne's Web");
  assert.equal(getUnusualEffectNameById(3142), "Winning Spirit");
  assert.equal(getUnusualEffectNameById(413), "Blissful Butterflies");
  assert.equal(getUnusualEffectNameById(410), "Floral Growth");
});

test("getUnusualEffectNameById returns null for an unrecognized id, not a guess", () => {
  assert.equal(getUnusualEffectNameById(999999), null);
});
