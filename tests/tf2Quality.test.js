import { test } from "node:test";
import assert from "node:assert/strict";
import {
  QUALITY_ID_BY_NAME,
  QUALITY_NAME_BY_ID,
  QUALITY_NAME_BY_CLASS,
  QUALITY_COLOR_BY_NAME,
  getQualityNameFromClassList,
  getQualityIdFromClassList,
} from "../utils/tf2Quality.js";

// Fakes the subset of DOMTokenList.classList this module actually reads.
function fakeClassList(...classes) {
  return { contains: (name) => classes.includes(name) };
}

test("QUALITY_ID_BY_NAME and QUALITY_NAME_BY_ID are exact inverses", () => {
  for (const [name, id] of Object.entries(QUALITY_ID_BY_NAME)) {
    assert.equal(QUALITY_NAME_BY_ID[id], name);
  }
});

test("QUALITY_NAME_BY_CLASS keys every quality under its scrap.tf qualityN class", () => {
  assert.equal(QUALITY_NAME_BY_CLASS.quality11, "Strange");
  assert.equal(QUALITY_NAME_BY_CLASS.quality9, "Self Made");
});

test("QUALITY_COLOR_BY_NAME only has entries for qualities with a color", () => {
  assert.equal(QUALITY_COLOR_BY_NAME.Strange, "#cf6a32");
  assert.equal(QUALITY_COLOR_BY_NAME.Unique, undefined);
});

// These are Steam's confirmed-live inventory border colors (same
// STEAM_QUALITY_BORDER_COLORS table
// steamcommunity.com/itemQuickLinks/content.js's own reverse-lookup uses)
// - Unusual used to be backpack.tf's own (different) purple (#6b3294), and
// Haunted/Collector's had no color entry at all.
test("QUALITY_COLOR_BY_NAME matches Steam's own inventory-page quality colors, not backpack.tf's", () => {
  assert.equal(QUALITY_COLOR_BY_NAME.Unusual, "#8650ac");
  assert.equal(QUALITY_COLOR_BY_NAME.Haunted, "#38f3ab");
  assert.equal(QUALITY_COLOR_BY_NAME["Collector's"], "#aa0000");
});

test("getQualityNameFromClassList reads the matching qualityN class", () => {
  assert.equal(getQualityNameFromClassList(fakeClassList("item", "quality11")), "Strange");
});

test("getQualityNameFromClassList falls back to Unique with no quality class", () => {
  assert.equal(getQualityNameFromClassList(fakeClassList("item")), "Unique");
});

test("getQualityIdFromClassList reads the matching qualityN class", () => {
  assert.equal(getQualityIdFromClassList(fakeClassList("quality9")), 9);
});

test("getQualityIdFromClassList falls back to 6 (Unique) with no quality class", () => {
  assert.equal(getQualityIdFromClassList(fakeClassList("item")), 6);
});
