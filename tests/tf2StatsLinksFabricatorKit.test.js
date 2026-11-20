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
            itemNameToDefindex: { Machina: 200 },
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

const { matchFabricatorKit, createBpStatsLinkFabricatorKit, buildFabricatorClassifiedsLink } = await import(
  "../utils/tf2StatsLinks/fabricatorKit.js"
);

test("matchFabricatorKit parses a Kit Fabricator's own target/tier, distinct from a plain Kit", () => {
  assert.deepEqual(matchFabricatorKit("Professional Killstreak Machina Kit Fabricator"), {
    targetName: "Machina",
    tier: 3,
    isNonCraftable: false,
  });
});

test("matchFabricatorKit returns null for a plain Killstreak Kit name (no overlap with matchKillstreakKit)", () => {
  assert.equal(matchFabricatorKit("Professional Killstreak Machina Kit"), null);
});

test("matchFabricatorKit returns null for a name with no Fabricator shape", () => {
  assert.equal(matchFabricatorKit("Machina"), null);
});

test("createBpStatsLinkFabricatorKit uses the fixed per-tier priceindex prefix, not the tier number", async () => {
  const professional = matchFabricatorKit("Professional Killstreak Machina Kit Fabricator");
  assert.equal(
    await createBpStatsLinkFabricatorKit(professional, false),
    "https://backpack.tf/stats/Unique/Fabricator/Tradable/Craftable/6526-6-200"
  );

  const specialized = matchFabricatorKit("Specialized Killstreak Machina Kit Fabricator");
  assert.equal(
    await createBpStatsLinkFabricatorKit(specialized, false),
    "https://backpack.tf/stats/Unique/Fabricator/Tradable/Craftable/6523-6-200"
  );
});

test("createBpStatsLinkFabricatorKit keeps its own real craftable/non-craftable state (unlike a Kit, never forced)", async () => {
  const match = matchFabricatorKit("Non-Craftable Professional Killstreak Machina Kit Fabricator");
  const url = await createBpStatsLinkFabricatorKit(match, false);
  assert.match(url, /\/Tradable\/Non-Craftable\//);
});

test("createBpStatsLinkFabricatorKit returns null for Basic tier - no confirmed priceindex prefix exists", async () => {
  const match = matchFabricatorKit("Killstreak Machina Kit Fabricator");
  assert.equal(match.tier, 1);
  assert.equal(await createBpStatsLinkFabricatorKit(match, false), null);
});

test("createBpStatsLinkFabricatorKit returns null when the target's defindex can't be resolved", async () => {
  const match = matchFabricatorKit("Professional Killstreak Unknown Weapon Kit Fabricator");
  assert.equal(await createBpStatsLinkFabricatorKit(match, false), null);
});

test("buildFabricatorClassifiedsLink reflects the Fabricator's own craftable state (unlike a Kit, never forced non-craftable)", () => {
  const craftableUrl = new URL(
    buildFabricatorClassifiedsLink({ targetName: "Machina", tier: 3, isNonCraftable: false }, false)
  );
  assert.equal(craftableUrl.searchParams.get("craftable"), "1");

  const nonCraftableUrl = new URL(
    buildFabricatorClassifiedsLink({ targetName: "Machina", tier: 3, isNonCraftable: true }, false)
  );
  assert.equal(nonCraftableUrl.searchParams.get("craftable"), "-1");

  const nextUrl = new URL(buildFabricatorClassifiedsLink({ targetName: "Machina", tier: 3 }, true));
  assert.equal(nextUrl.searchParams.get("itemName"), "Fabricator");
  assert.equal(nextUrl.searchParams.get("targetItem"), "Machina");
});

// SheenId/killstreakerId used to be silently dropped here even once
// resolveClassifiedsFilters started resolving them onto the fabricatorKit
// object - this function only ever destructured {targetName, tier,
// isNonCraftable}. A Fabricator's own finished Kit has a fixed
// Sheen/Killstreaker shown on its own item panel ("Professional Killstreak
// Minigun Kit Fabricator" -> "Fire Horns"/"Mean Green"), so these are real,
// meaningful filters for it too.
test("buildFabricatorClassifiedsLink includes sheen/killstreaker (classic and next) when known", () => {
  const match = { targetName: "Minigun", tier: 3, isNonCraftable: false, sheenId: 4, killstreakerId: 2002 };

  const classicUrl = new URL(buildFabricatorClassifiedsLink(match, false));
  assert.equal(classicUrl.searchParams.get("sheen"), "4");
  assert.equal(classicUrl.searchParams.get("killstreaker"), "2002");

  const nextUrl = new URL(buildFabricatorClassifiedsLink(match, true));
  assert.equal(nextUrl.searchParams.get("sheen"), "4");
  assert.equal(nextUrl.searchParams.get("killstreaker"), "2002");
});

test("buildFabricatorClassifiedsLink omits sheen/killstreaker when neither is known", () => {
  const match = { targetName: "Minigun", tier: 3, isNonCraftable: false };

  const classicUrl = new URL(buildFabricatorClassifiedsLink(match, false));
  assert.equal(classicUrl.searchParams.has("sheen"), false);
  assert.equal(classicUrl.searchParams.has("killstreaker"), false);
});
