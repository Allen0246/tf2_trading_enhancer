import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getUnusualEffectName,
  getSpellName,
  getLevel,
  getPaintName,
  getSheenName,
  getKillstreakerName,
  isFestivized,
  isMarkedUncraftableInTooltip,
} from "../scrap.tf/itemLinks/tooltipData.js";

// Fakes the subset of the item element these extractors actually read.
function fakeItemEl(dataContent) {
  return { getAttribute: (name) => (name === "data-content" ? dataContent : null) };
}

const fullFixture = fakeItemEl(
  "Level 17<br>Effect: Fountain of Delight<br>Sheen: Villainous Violet<br>Killstreaker: Incinerator<br>Festivized<br>Halloween Spell: Exorcism<br>Painted A Distinctive Lack of Hue"
);

test("getUnusualEffectName extracts the Effect line", () => {
  assert.equal(getUnusualEffectName(fullFixture), "Fountain of Delight");
});

test("getUnusualEffectName returns null when there is no Effect line", () => {
  assert.equal(getUnusualEffectName(fakeItemEl("Level 17<br>Sheen: Villainous Violet")), null);
});

test("getSpellName extracts the Halloween Spell line", () => {
  assert.equal(getSpellName(fullFixture), "Exorcism");
});

test("getSpellName returns null when there is no Halloween Spell line", () => {
  assert.equal(getSpellName(fakeItemEl("Level 17")), null);
});

test("getLevel extracts the numeric level from the Level line", () => {
  assert.equal(getLevel(fullFixture), "17");
});

test("getLevel returns null when there is no Level line", () => {
  assert.equal(getLevel(fakeItemEl("Sheen: Villainous Violet")), null);
});

test("getPaintName extracts the Painted line", () => {
  assert.equal(getPaintName(fullFixture), "A Distinctive Lack of Hue");
});

test("getPaintName returns null when there is no Painted line", () => {
  assert.equal(getPaintName(fakeItemEl("Level 17")), null);
});

test("getSheenName extracts the Sheen line", () => {
  assert.equal(getSheenName(fullFixture), "Villainous Violet");
});

test("getSheenName returns null when there is no Sheen line", () => {
  assert.equal(getSheenName(fakeItemEl("Level 17")), null);
});

test("getKillstreakerName extracts the Killstreaker line", () => {
  assert.equal(getKillstreakerName(fullFixture), "Incinerator");
});

test("getKillstreakerName returns null when there is no Killstreaker line", () => {
  assert.equal(getKillstreakerName(fakeItemEl("Level 17")), null);
});

test("isFestivized is true when a standalone Festivized line is present", () => {
  assert.equal(isFestivized(fullFixture), true);
});

test("isFestivized is false when there is no Festivized line", () => {
  assert.equal(isFestivized(fakeItemEl("Level 17")), false);
});

// Scrap.tf's own "uncraft" CSS class was NOT present on the item element even
// though its own tooltip clearly read "Uncraftable" as a standalone line -
// this text-based check is the second, independent signal that catches that
// case.
test("isMarkedUncraftableInTooltip is true for a standalone 'Uncraftable' line", () => {
  assert.equal(isMarkedUncraftableInTooltip(fakeItemEl("Level 5<br>Uncraftable<br>Costs 1 key, 48 refined")), true);
});

test("isMarkedUncraftableInTooltip is true for a standalone 'Non-Craftable' line too", () => {
  assert.equal(isMarkedUncraftableInTooltip(fakeItemEl("Level 5<br>Non-Craftable")), true);
});

test("isMarkedUncraftableInTooltip is false when there is no such line", () => {
  assert.equal(isMarkedUncraftableInTooltip(fullFixture), false);
});

test("isMarkedUncraftableInTooltip is false when the word appears only as part of another line", () => {
  const el = fakeItemEl("Not Usable in Crafting sometimes<br>Level 5");
  assert.equal(isMarkedUncraftableInTooltip(el), false);
});

test("extractors are anchored per-line and don't match the keyword mid-line", () => {
  // "Sheen: Villainous Violet" appearing only as a substring of another line
  // (not its own "^Sheen: ...$" line) must not match - the m-flag anchors
  // matter, not just presence anywhere in the string.
  const el = fakeItemEl("Some text mentioning Sheen: Villainous Violet inline, not on its own line");
  assert.equal(getSheenName(el), null);
});

test("isFestivized is false when Festivized appears only as part of another line", () => {
  const el = fakeItemEl("Not Festivized really<br>Level 5");
  assert.equal(isFestivized(el), false);
});

test("extractors return null when the item element has no data-content attribute", () => {
  const el = { getAttribute: () => null };
  assert.equal(getUnusualEffectName(el), null);
  assert.equal(getSpellName(el), null);
  assert.equal(getLevel(el), null);
  assert.equal(getPaintName(el), null);
  assert.equal(getSheenName(el), null);
  assert.equal(getKillstreakerName(el), null);
  assert.equal(isFestivized(el), false);
  assert.equal(isMarkedUncraftableInTooltip(el), false);
});
