import { test } from "node:test";
import assert from "node:assert/strict";

// See tests/tf2StatsLinksTargetTool.test.js's own header comment for why
// this fixture is installed once, module-scope, before import.
globalThis.chrome = {
  storage: {
    local: {
      async get() {
        return {
          tf2SchemaCache: {
            itemNameToDefindex: { Machina: 200, "Big Kill": 205 },
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

const { matchKillstreakKit, createBpStatsLinkKillstreakKit, buildKillstreakKitClassifiedsLink } = await import(
  "../utils/tf2StatsLinks/killstreakKit.js"
);

test("matchKillstreakKit parses a Professional Killstreak Kit", () => {
  assert.deepEqual(matchKillstreakKit("Specialized Killstreak Machina Kit"), {
    targetName: "Machina",
    tier: 2,
    isNonCraftable: false,
  });
});

test("matchKillstreakKit defaults to tier 1 (Basic) with no tier word", () => {
  assert.deepEqual(matchKillstreakKit("Killstreak Machina Kit"), {
    targetName: "Machina",
    tier: 1,
    isNonCraftable: false,
  });
});

test("matchKillstreakKit returns null for a name with no Killstreak Kit shape", () => {
  assert.equal(matchKillstreakKit("Machina"), null);
  // A Fabricator's own name ends in "Kit Fabricator", not "Kit" - the $ anchor
  // on matchKillstreakKit's own regex must not accidentally match this too.
  assert.equal(matchKillstreakKit("Professional Killstreak Machina Kit Fabricator"), null);
});

test("createBpStatsLinkKillstreakKit builds the classic backpack.tf tier-prefixed Kit URL with a {tier}-{defindex} priceindex", async () => {
  const match = matchKillstreakKit("Professional Killstreak Machina Kit");
  const url = await createBpStatsLinkKillstreakKit(match, false);
  assert.equal(url, "https://backpack.tf/stats/Unique/Professional%20Killstreak%20Kit/Tradable/Non-Craftable/3-200");
});

test("createBpStatsLinkKillstreakKit uses no tier prefix at all on classic backpack.tf for a Basic-tier Kit", async () => {
  const match = matchKillstreakKit("Killstreak Big Kill Kit");
  const url = await createBpStatsLinkKillstreakKit(match, false);
  assert.equal(url, "https://backpack.tf/stats/Unique/Killstreak%20Kit/Tradable/Non-Craftable/1-205");
});

test("createBpStatsLinkKillstreakKit builds the next.backpack.tf query-string form", async () => {
  const match = matchKillstreakKit("Specialized Killstreak Machina Kit");
  const url = new URL(await createBpStatsLinkKillstreakKit(match, true));
  assert.equal(url.origin + url.pathname, "https://next.backpack.tf/stats");
  assert.equal(url.searchParams.get("item"), "Kit");
  assert.equal(url.searchParams.get("killstreakTier"), "2");
  assert.equal(url.searchParams.get("craftable"), "false");
  assert.equal(url.searchParams.get("priceindex"), "2-200");
});

test("createBpStatsLinkKillstreakKit returns null when the target's defindex can't be resolved", async () => {
  const match = matchKillstreakKit("Killstreak Unknown Weapon Kit");
  assert.equal(await createBpStatsLinkKillstreakKit(match, false), null);
});

test("buildKillstreakKitClassifiedsLink searches by the TARGET weapon, always non-craftable, regardless of the page's own state", () => {
  const classicUrl = new URL(
    buildKillstreakKitClassifiedsLink({ targetName: "Machina", tier: 3, sheenId: 6, killstreakerId: 2007 }, false)
  );
  assert.equal(classicUrl.searchParams.get("item"), "Machina");
  assert.equal(classicUrl.searchParams.get("craftable"), "-1");
  assert.equal(classicUrl.searchParams.get("sheen"), "6");
  assert.equal(classicUrl.searchParams.get("killstreaker"), "2007");

  const nextUrl = new URL(buildKillstreakKitClassifiedsLink({ targetName: "Machina", tier: 3 }, true));
  assert.equal(nextUrl.origin + nextUrl.pathname, "https://next.backpack.tf/classifieds");
  assert.equal(nextUrl.searchParams.get("itemName"), "Kit");
  assert.equal(nextUrl.searchParams.get("targetItem"), "Machina");
});
