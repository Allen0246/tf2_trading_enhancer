import { test } from "node:test";
import assert from "node:assert/strict";

// utils/tf2Schema.js's getItemDefindex is what createBpStatsLinkTargetTool
// calls - fake just enough of chrome for it to resolve from its own 7-day
// storage cache instead of ever attempting a real fetch. Installed before
// importing anything that transitively imports tf2Schema.js, since that
// module reads chrome.storage.local lazily (not at import time), but this
// keeps every test in this file working off one consistent schema fixture -
// tf2Schema.js memoizes its in-flight fetch at module scope for the lifetime
// of the loaded module, and Node's test runner gives each test file its own
// process/module registry, so one fixture per file is the right shape here.
globalThis.chrome = {
  storage: {
    local: {
      async get() {
        return {
          tf2SchemaCache: {
            itemNameToDefindex: { "Ghastlier Gibus": 30666, "Righteous Bison": 40 },
            defindexToItemName: {},
            effectNameToId: {},
            fetchedAt: Date.now(),
            schemaShapeVersion: 4,
          },
        };
      },
      async set() {},
    },
  },
  runtime: {
    async sendMessage() {
      throw new Error("should not need a real fetch - schema cache is pre-seeded and fresh");
    },
  },
};

const { matchTargetItemTool, createBpStatsLinkTargetTool } = await import("../utils/tf2StatsLinks/targetTool.js");

test("matchTargetItemTool splits a target + Strangifier suffix", () => {
  assert.deepEqual(matchTargetItemTool("Ghastlier Gibus Strangifier"), {
    targetName: "Ghastlier Gibus",
    baseItemName: "Strangifier",
    isNonCraftable: false,
  });
});

test("matchTargetItemTool strips craftability/article before matching", () => {
  assert.deepEqual(matchTargetItemTool("Non-Craftable The Righteous Bison Strangifier"), {
    targetName: "Righteous Bison",
    baseItemName: "Strangifier",
    isNonCraftable: true,
  });
});

test("matchTargetItemTool returns null for a name with no matching suffix", () => {
  assert.equal(matchTargetItemTool("Rocket Launcher"), null);
});

test("matchTargetItemTool returns null when the suffix would leave an empty target name", () => {
  assert.equal(matchTargetItemTool("Strangifier"), null);
});

// REGRESSION for a live bug report: a Strangifier Chemistry Set's own raw
// name ("Professor Speks Strangifier Chemistry Set Series #2") doesn't end in
// the plain " Strangifier" suffix at all - "Strangifier" sits in the MIDDLE,
// followed by "Chemistry Set Series #{n}" - so this used to return null,
// falling through to a bogus plain-item search for the entire raw string with
// no targetItem filter at all. Confirmed live:
// https://next.backpack.tf/classifieds?itemName=Chemistry%20Set&quality=6&
// targetItem=Professor%20Speks - backpack.tf's own canonical item name is
// just "Chemistry Set", not "Strangifier".
test("matchTargetItemTool splits a target from a Strangifier Chemistry Set's own 'Series #n' name shape", () => {
  assert.deepEqual(matchTargetItemTool("Professor Speks Strangifier Chemistry Set Series #2"), {
    targetName: "Professor Speks",
    baseItemName: "Chemistry Set",
    isNonCraftable: false,
  });
});

test("matchTargetItemTool strips craftability from a Strangifier Chemistry Set too", () => {
  assert.deepEqual(matchTargetItemTool("Non-Craftable Professor Speks Strangifier Chemistry Set Series #2"), {
    targetName: "Professor Speks",
    baseItemName: "Chemistry Set",
    isNonCraftable: true,
  });
});

test("matchTargetItemTool prefers the Chemistry Set match over the plain Strangifier suffix when both could apply", () => {
  // Doesn't actually end in " Strangifier" (it ends in "Series #2"), so the
  // plain-suffix loop below would never match this anyway - but the
  // Chemistry Set check runs FIRST regardless, guarding against a future
  // suffix-table entry that might otherwise shadow it.
  const match = matchTargetItemTool("Convict Cotton Strangifier Chemistry Set Series #1");
  assert.equal(match.baseItemName, "Chemistry Set");
  assert.equal(match.targetName, "Convict Cotton");
});

test("createBpStatsLinkTargetTool resolves the target's defindex as a URL path suffix", async () => {
  const match = matchTargetItemTool("Ghastlier Gibus Strangifier");
  const classic = await createBpStatsLinkTargetTool(match, false);
  assert.equal(classic, "https://backpack.tf/stats/Unique/Strangifier/Tradable/Craftable/30666");

  const next = await createBpStatsLinkTargetTool(match, true);
  assert.equal(next, "https://next.backpack.tf/stats/Unique/Strangifier/Tradable/Craftable/30666");
});

test("createBpStatsLinkTargetTool marks a non-craftable tool correctly", async () => {
  const match = matchTargetItemTool("Non-Craftable Righteous Bison Strangifier");
  const url = await createBpStatsLinkTargetTool(match, false);
  assert.equal(url, "https://backpack.tf/stats/Unique/Strangifier/Tradable/Non-Craftable/40");
});

test("createBpStatsLinkTargetTool returns null when the target's defindex can't be resolved", async () => {
  const match = matchTargetItemTool("Some Unknown Weapon Strangifier");
  assert.equal(await createBpStatsLinkTargetTool(match, false), null);
});
