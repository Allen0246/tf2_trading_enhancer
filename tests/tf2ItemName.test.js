import { test } from "node:test";
import assert from "node:assert/strict";
import { stripNamePrefix } from "../utils/tf2ItemName.js";

test("stripNamePrefix strips a single quality prefix", () => {
  assert.equal(stripNamePrefix("Strange Australium Rocket Launcher"), "Australium Rocket Launcher");
});

test("stripNamePrefix strips a single killstreak-tier prefix", () => {
  assert.equal(stripNamePrefix("Professional Killstreak Rocket Launcher"), "Rocket Launcher");
});

test("stripNamePrefix strips a stacked quality + killstreak-tier prefix", () => {
  assert.equal(stripNamePrefix("Strange Professional Killstreak Rocket Launcher"), "Rocket Launcher");
});

test("stripNamePrefix strips every quality word in the shared list", () => {
  const cases = [
    ["Killstreak Rocket Launcher", "Rocket Launcher"],
    ["Specialized Killstreak Rocket Launcher", "Rocket Launcher"],
    ["Vintage Tyrolean", "Tyrolean"],
    ["Collector's Tyrolean", "Tyrolean"],
    ["Haunted Gibus", "Gibus"],
    ["Unusual Strikeout", "Strikeout"],
    ["Genuine Gibus", "Gibus"],
    ["Self Made Gibus", "Gibus"],
  ];

  for (const [input, expected] of cases) {
    assert.equal(stripNamePrefix(input), expected, `input: ${input}`);
  }
});

test("stripNamePrefix leaves a name with no prefix untouched", () => {
  assert.equal(stripNamePrefix("Rocket Launcher"), "Rocket Launcher");
});

test("stripNamePrefix leaves a Strange Part tool name untouched", () => {
  assert.equal(stripNamePrefix("Strange Part: Kills While Übercharged"), "Strange Part: Kills While Übercharged");
});

// The other two "Strange ...:" tool families are Unique-quality items too:
// Strange Cosmetic Parts and Strange Filters. Only "Strange Part:" was
// guarded, so these lost their "Strange" (a "Cosmetic Part: Kills" title and
// item identity).
test("stripNamePrefix leaves Strange Cosmetic Part and Strange Filter tool names untouched", () => {
  for (const name of ["Strange Cosmetic Part: Kills", "Strange Filter: Coldfront (Community)"]) {
    assert.equal(stripNamePrefix(name), name);
    assert.equal(stripNamePrefix(name, "Unique"), name);
  }
});

// "Strange Count Transfer Tool" is a real Unique-quality catalog item whose
// own name starts with "Strange" - same false-positive class as "Strange
// Part:" above. The card's title used to render as just "Count Transfer
// Tool" since the item's real Unique quality means no quality prefix ever
// gets re-added afterward to cover for the wrongly-stripped word.
test("stripNamePrefix leaves 'Strange Count Transfer Tool' untouched", () => {
  assert.equal(stripNamePrefix("Strange Count Transfer Tool"), "Strange Count Transfer Tool");
});

// "Strange Bacon Grease" is the third real Unique-quality item whose name
// starts with "Strange" (also in utils/tf2StatsLinks/common.js's
// LITERAL_NAME_QUALITY_EXCEPTIONS), so it is kept with or without a known
// quality.
test("stripNamePrefix leaves 'Strange Bacon Grease' untouched, with or without knownQualityName", () => {
  assert.equal(stripNamePrefix("Strange Bacon Grease"), "Strange Bacon Grease");
  assert.equal(stripNamePrefix("Strange Bacon Grease", "Unique"), "Strange Bacon Grease");
});

// A caller that knows the item's REAL quality (e.g. off scrap.tf's own CSS
// class, not guessed from text) can pass it as a second arg - when the raw
// name starts with "Strange " but the real quality is neither Strange nor
// absent, and no second quality word follows, "Strange" must be part of the
// item's own literal name. Uses a made-up name to prove the dynamic check
// covers an item none of the hardcoded entries name.
test("stripNamePrefix's knownQualityName param catches a not-yet-hardcoded 'Strange X' literal name too", () => {
  assert.equal(stripNamePrefix("Strange Example Hat", "Unique"), "Strange Example Hat");
});

// Without knownQualityName, text alone decides: a leading "Strange" on a name
// that isn't hardcoded is treated as the quality word.
test("stripNamePrefix without knownQualityName still strips 'Strange' from a name it isn't hardcoded for", () => {
  assert.equal(stripNamePrefix("Strange Example Hat"), "Example Hat");
});

// The genuine "Strange" ADD-ON descriptor case (confirmed live elsewhere,
// "Strange Vintage Camera Beard" - Vintage-quality with Strange-tracking
// attached) must still fully strip BOTH words even when a real quality is
// known and it's the INNER one (Vintage), not "Strange" itself - the second
// quality word right after "Strange" is what tells the two cases apart.
test("stripNamePrefix's knownQualityName param still strips a genuine 'Strange {quality}' add-on descriptor pair", () => {
  assert.equal(stripNamePrefix("Strange Vintage Camera Beard", "Vintage"), "Camera Beard");
});

// A "★Unusual " marker right after "Strange " is just as genuine a second
// signal as a plain quality word - it must NOT be mistaken for "Strange"
// being part of a literal item name, and the star marker itself must also
// actually get stripped (it isn't one of NAME_PREFIX_PATTERN's own
// plain-word alternatives).
test("stripNamePrefix strips both 'Strange ' and a '★Unusual ' marker together, recognizing the real (promoted) Unusual quality", () => {
  assert.equal(stripNamePrefix("Strange ★Unusual Beachy Boy War Paint (Minimal Wear)", "Unusual"), "Beachy Boy War Paint (Minimal Wear)");
});

// A genuinely Strange-quality item (knownQualityName === "Strange") is
// obviously still stripped normally - the dynamic check only ever WITHHOLDS
// stripping, never forces it to happen when it otherwise wouldn't.
test("stripNamePrefix's knownQualityName param doesn't interfere with a genuinely Strange-quality item", () => {
  assert.equal(stripNamePrefix("Strange Rocket Launcher", "Strange"), "Rocket Launcher");
});
