import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getTextureId,
  getSkinNameByTextureId,
  findSkinNamePrefix,
  findSkinNamesByPrefix,
  WEAR_TIER_IDS,
  WEAR_TIER_NAMES_BY_ID,
  __resetWarpaintsCacheForTests,
} from "../utils/warpaints.js";

// Fake for chrome.runtime.getURL - just needs to turn the bundled-file path
// into something fetch() can be called with; the fake fetch below ignores
// the actual URL value entirely.
globalThis.chrome = { runtime: { getURL: (path) => path } };

// warpaintsPromise is cached at module scope for the whole file (see
// warpaints.js's own comment on why), so every test in this file shares this
// one fixture rather than each getting a fresh fetch.
const FIXTURE = [
  { name: "Eyestalker", defindex: 265 },
  { name: "Necro", defindex: 100 },
  { name: "Necromanced", defindex: 101 },
];

globalThis.fetch = async () => ({ json: async () => FIXTURE });

test("getTextureId looks up a warpaint's backpack.tf texture id by exact name", async () => {
  assert.equal(await getTextureId("Eyestalker"), 265);
});

test("getTextureId returns null for a name with no matching warpaint", async () => {
  assert.equal(await getTextureId("Not A Real Skin"), null);
});

test("getSkinNameByTextureId looks up a warpaint's display name by its exact texture id (reverse of getTextureId)", async () => {
  assert.equal(await getSkinNameByTextureId(265), "Eyestalker");
});

test("getSkinNameByTextureId returns null for a texture id with no matching warpaint", async () => {
  assert.equal(await getSkinNameByTextureId(999999), null);
});

test("findSkinNamePrefix prefers the longest matching skin name prefix", () => {
  // "Necro" and "Necromanced" are both valid prefixes of this concatenated
  // (no-separator) Decorated Weapon name - the longer, more specific one
  // must win per the function's own doc comment.
  return findSkinNamePrefix("NecromancedBlackBox").then((name) => {
    assert.equal(name, "Necromanced");
  });
});

test("findSkinNamePrefix returns null when no known skin name prefixes the text", async () => {
  assert.equal(await findSkinNamePrefix("Rocket Launcher"), null);
});

test("findSkinNamesByPrefix returns every skin name (case-insensitively) starting with the given prefix", async () => {
  assert.deepEqual(await findSkinNamesByPrefix("necro"), ["Necro", "Necromanced"]);
  assert.deepEqual(await findSkinNamesByPrefix("EYE"), ["Eyestalker"]);
});

test("findSkinNamesByPrefix returns [] for a prefix with no matches", async () => {
  assert.deepEqual(await findSkinNamesByPrefix("Not A Real Skin"), []);
});

test("findSkinNamesByPrefix returns [] for an empty prefix, rather than every skin name", async () => {
  assert.deepEqual(await findSkinNamesByPrefix(""), []);
});

test("a failed fetch is swallowed, warns, and falls back to an empty list instead of rejecting", async () => {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  __resetWarpaintsCacheForTests();
  globalThis.fetch = async () => {
    throw new Error("network down");
  };
  console.warn = () => {};

  try {
    assert.equal(await getTextureId("Eyestalker"), null);
  } finally {
    console.warn = originalWarn;
    globalThis.fetch = originalFetch;
    __resetWarpaintsCacheForTests(); // don't leak the [] fallback into later tests
  }
});

test("WEAR_TIER_IDS matches next.backpack.tf's confirmed-live wear filter ids", () => {
  assert.deepEqual(WEAR_TIER_IDS, {
    "Factory New": 1,
    "Minimal Wear": 2,
    "Field-Tested": 3,
    "Well-Worn": 4,
    "Battle Scarred": 5,
  });
});

test("WEAR_TIER_NAMES_BY_ID is the exact reverse of WEAR_TIER_IDS", () => {
  assert.deepEqual(WEAR_TIER_NAMES_BY_ID, {
    1: "Factory New",
    2: "Minimal Wear",
    3: "Field-Tested",
    4: "Well-Worn",
    5: "Battle Scarred",
  });
});
