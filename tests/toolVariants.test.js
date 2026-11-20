import { test } from "node:test";
import assert from "node:assert/strict";
import { detectToolVariants } from "../scrap.tf/itemLinks/toolVariants.js";

test("detectToolVariants detects a Professional Killstreak Kit and keeps the tier word verbatim", () => {
  const result = detectToolVariants("Professional Rocket Launcher Kit");
  assert.equal(result.isKillstreakKit, true);
  assert.equal(result.killstreakKitTargetName, "Rocket Launcher");
  assert.equal(result.killstreakKitTier, 3);
  assert.equal(result.killstreakKitTierWord, "Professional ");
});

test("detectToolVariants detects a Specialized Killstreak Kit and keeps the tier word verbatim", () => {
  const result = detectToolVariants("Specialized Rocket Launcher Kit");
  assert.equal(result.isKillstreakKit, true);
  assert.equal(result.killstreakKitTargetName, "Rocket Launcher");
  assert.equal(result.killstreakKitTier, 2);
  assert.equal(result.killstreakKitTierWord, "Specialized ");
});

test("detectToolVariants detects a Basic Killstreak Kit but discards its tier word to empty string", () => {
  // Basic IS a literal "Basic " prefix in scrap.tf's raw name (confirmed live
  // via "Basic Big Kill Kit"), but Steam's market_hash_name for a Basic Kit
  // omits the word entirely, unlike Professional/Specialized - so
  // killstreakKitTierWord must be "" here, not "Basic ".
  const result = detectToolVariants("Basic Big Kill Kit");
  assert.equal(result.isKillstreakKit, true);
  assert.equal(result.killstreakKitTargetName, "Big Kill");
  assert.equal(result.killstreakKitTier, 1);
  assert.equal(result.killstreakKitTierWord, "");
});

test("detectToolVariants detects a no-tier-word Kit and defaults its tier to 1 (Basic)", () => {
  const result = detectToolVariants("Rocket Launcher Kit");
  assert.equal(result.isKillstreakKit, true);
  assert.equal(result.killstreakKitTargetName, "Rocket Launcher");
  assert.equal(result.killstreakKitTier, 1);
  assert.equal(result.killstreakKitTierWord, "");
});

test("detectToolVariants leaves Killstreak Kit fields null for a non-Kit name", () => {
  const result = detectToolVariants("Rocket Launcher");
  assert.equal(result.isKillstreakKit, false);
  assert.equal(result.killstreakKitTargetName, null);
  assert.equal(result.killstreakKitTier, null);
  assert.equal(result.killstreakKitTierWord, null);
});

test("detectToolVariants detects a target-item tool (Strangifier) and its target weapon", () => {
  const result = detectToolVariants("Righteous Bison Strangifier");
  assert.equal(result.isTargetTool, true);
  assert.equal(result.targetToolTargetName, "Righteous Bison");
  assert.equal(result.targetToolBaseItemName, "Strangifier");
});

test("detectToolVariants leaves target-tool fields null for a non-Strangifier name", () => {
  const result = detectToolVariants("Righteous Bison");
  assert.equal(result.isTargetTool, false);
  assert.equal(result.targetToolTargetName, null);
});

// REGRESSION for a live bug report: a Strangifier Chemistry Set's own raw
// name ("Professor Speks Strangifier Chemistry Set Series #2") doesn't end
// in the plain " Strangifier" suffix at all - "Strangifier" sits in the
// MIDDLE, followed by a variable "Chemistry Set Series #{n}" tag - so this
// used to leave isTargetTool false for it entirely. Confirmed live:
// https://next.backpack.tf/classifieds?itemName=Chemistry%20Set&quality=6&
// targetItem=Professor%20Speks - backpack.tf's own canonical item name for
// it is "Chemistry Set", not "Strangifier".
test("detectToolVariants detects a Strangifier Chemistry Set and its target item, with 'Chemistry Set' as the base item name (not 'Strangifier')", () => {
  const result = detectToolVariants("Professor Speks Strangifier Chemistry Set Series #2");
  assert.equal(result.isTargetTool, true);
  assert.equal(result.targetToolTargetName, "Professor Speks");
  assert.equal(result.targetToolBaseItemName, "Chemistry Set");
});

test("detectToolVariants detects a Professional Killstreak Kit Fabricator without also matching a plain Kit", () => {
  const result = detectToolVariants("Professional Rocket Launcher Kit Fabricator");
  assert.equal(result.isFabricatorKit, true);
  assert.equal(result.fabricatorKitTargetName, "Rocket Launcher");
  assert.equal(result.fabricatorKitTier, 3);
  assert.equal(result.fabricatorKitTierWord, "Professional ");
  // The " Kit Fabricator" name must not also satisfy the plain "... Kit$"
  // regex, since that would falsely flag a Fabricator as a Kit too.
  assert.equal(result.isKillstreakKit, false);
});

test("detectToolVariants keeps the tier word verbatim for a Specialized Killstreak Kit Fabricator", () => {
  // Regression test for a live bug: buildSteamMarketName's Fabricator branch
  // needs fabricatorKitTierWord to reinsert "Killstreak" into Steam's real
  // market_hash_name ("Specialized Killstreak Conniver's Kunai Kit
  // Fabricator") - scrap.tf's own raw name omits that word entirely.
  const result = detectToolVariants("Specialized Conniver's Kunai Kit Fabricator");
  assert.equal(result.isFabricatorKit, true);
  assert.equal(result.fabricatorKitTargetName, "Conniver's Kunai");
  assert.equal(result.fabricatorKitTier, 2);
  assert.equal(result.fabricatorKitTierWord, "Specialized ");
});

test("detectToolVariants detects a Basic Killstreak Kit Fabricator with the same Basic prefix rule as Kits (tier word discarded to empty string)", () => {
  const result = detectToolVariants("Basic Rocket Launcher Kit Fabricator");
  assert.equal(result.isFabricatorKit, true);
  assert.equal(result.fabricatorKitTargetName, "Rocket Launcher");
  assert.equal(result.fabricatorKitTier, 1);
  assert.equal(result.fabricatorKitTierWord, "");
});

test("detectToolVariants does not flag a plain Killstreak Kit as a Fabricator", () => {
  const result = detectToolVariants("Professional Rocket Launcher Kit");
  assert.equal(result.isFabricatorKit, false);
  assert.equal(result.fabricatorKitTargetName, null);
  assert.equal(result.fabricatorKitTier, null);
  assert.equal(result.fabricatorKitTierWord, null);
});

test("detectToolVariants leaves every variant field falsy for a name matching none of the patterns", () => {
  const result = detectToolVariants("Mann Co. Supply Crate Key");
  assert.equal(result.isKillstreakKit, false);
  assert.equal(result.isTargetTool, false);
  assert.equal(result.isFabricatorKit, false);
});
