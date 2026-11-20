import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildItemNameRaw,
  buildReadableDecoratedWeaponName,
  buildSchemaDecoratedWeaponName,
  findTargetToolFullName,
  readClassifiedsLinkParams,
} from "../backpack.tf/oldUI/popoverItemDetails.js";

// Minimal fake popover: a content root whose closest(".popover") is an outer
// container holding an optional ".popover-title", plus an optional
// classifieds anchor.
function makeRoot({ title = null, classifiedsHref = null } = {}) {
  const titleEl = title === null ? null : { textContent: title };
  const popover = { querySelector: (sel) => (sel === ".popover-title" ? titleEl : null) };
  const anchor = classifiedsHref === null ? null : { getAttribute: (name) => (name === "href" ? classifiedsHref : null) };
  return {
    closest: (sel) => (sel === ".popover" ? popover : null),
    querySelector: () => anchor,
  };
}

test("buildItemNameRaw orders craftability, quality, killstreak tier and Australium", () => {
  assert.equal(
    buildItemNameRaw("Rocket Launcher", 11, { isNonCraftable: true, killstreakTier: 3, isAustralium: true }),
    "Non-Craftable Strange Professional Killstreak Australium Rocket Launcher"
  );
  assert.equal(buildItemNameRaw("Team Captain", 6), "Team Captain");
});

test("buildItemNameRaw keeps the literal 'Unusual' word unless an effect name is given", () => {
  assert.equal(buildItemNameRaw("Team Captain", 5, {}), "Unusual Team Captain");
  assert.equal(buildItemNameRaw("Team Captain", 5, { knownEffectName: "Purple Energy" }), "Purple Energy Team Captain");
  // The effect name only replaces the Unusual quality word, never another quality.
  assert.equal(buildItemNameRaw("Rocket Launcher", 11, { knownEffectName: "Hot" }), "Strange Rocket Launcher");
});

test("decorated weapon names: readable form joins with a space, schema form follows each matcher's own shape", () => {
  const powerjack = "Secretly Serviced | Powerjack (Battle Scarred)";
  assert.equal(buildReadableDecoratedWeaponName(powerjack, 15), "Secretly Serviced Powerjack (Battle Scarred)");
  assert.equal(buildSchemaDecoratedWeaponName(powerjack, 15), "Secretly ServicedPowerjack (Battle Scarred)");
  assert.equal(buildSchemaDecoratedWeaponName(powerjack, 11), "Strange Secretly ServicedPowerjack (Battle Scarred)");

  const warPaint = "Ocean Mapped | War Paint (Field-Tested)";
  assert.equal(buildSchemaDecoratedWeaponName(warPaint, 15), "Ocean Mapped War Paint (Field-Tested)");

  assert.equal(buildReadableDecoratedWeaponName("Rocket Launcher", 6), null);
  assert.equal(buildSchemaDecoratedWeaponName("Rocket Launcher", 6), null);
});

test("findTargetToolFullName recognizes a target tool by its bare item name or by its title", () => {
  assert.deepEqual(findTargetToolFullName(makeRoot({ title: "Third Degree Strangifier" }), "Strangifier"), {
    isTargetTool: true,
    fullName: "Third Degree Strangifier",
  });
  // item param is the target weapon alone - the title still identifies it.
  assert.deepEqual(findTargetToolFullName(makeRoot({ title: "Pretty Boy's Pocket Pistol Strangifier" }), "Pretty Boy's Pocket Pistol"), {
    isTargetTool: true,
    fullName: "Pretty Boy's Pocket Pistol Strangifier",
  });
  // A bare tool name with no title to read.
  assert.deepEqual(findTargetToolFullName(makeRoot(), "Strangifier"), { isTargetTool: true, fullName: null });
  // Not a target tool at all.
  assert.deepEqual(findTargetToolFullName(makeRoot({ title: "Team Captain" }), "Team Captain"), { isTargetTool: false, fullName: null });
});

test("readClassifiedsLinkParams reads the classifieds anchor's params, treating particle=0 as no effect", () => {
  global.window = { location: { href: "https://backpack.tf/classifieds" } };

  const unusual = readClassifiedsLinkParams(
    makeRoot({ classifiedsHref: "/classifieds?item=Team Captain&quality=5&tradable=1&craftable=-1&australium=1&particle=94&killstreak_tier=2" })
  );
  assert.deepEqual(unusual, {
    itemName: "Team Captain",
    qualityId: 5,
    killstreakTier: 2,
    isAustralium: true,
    isNonCraftable: true,
    knownEffectId: 94,
  });

  const plain = readClassifiedsLinkParams(makeRoot({ classifiedsHref: "/classifieds?item=Bonk Boy&quality=6&particle=0" }));
  assert.equal(plain.knownEffectId, null);
  assert.equal(plain.killstreakTier, 0);

  assert.equal(readClassifiedsLinkParams(makeRoot()), null);
  assert.equal(readClassifiedsLinkParams(makeRoot({ classifiedsHref: "/classifieds?quality=6" })), null);
});
