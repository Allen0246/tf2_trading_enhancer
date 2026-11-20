import { test } from "node:test";
import assert from "node:assert/strict";
import {
  matchWarPaintTool,
  createBpStatsLinkWarPaintTool,
  buildWarPaintToolClassifiedsLink,
} from "../utils/tf2StatsLinks/warPaintTool.js";

test("matchWarPaintTool parses the default (non-Strange) variant", () => {
  assert.deepEqual(matchWarPaintTool("Dragon Slayer War Paint (Factory New)"), {
    skinName: "Dragon Slayer",
    wearTier: "Factory New",
    isStrange: false,
    isNonCraftable: false,
  });
});

test("matchWarPaintTool parses the Strange-tracking variant", () => {
  assert.deepEqual(matchWarPaintTool("Strange Swashbuckled War Paint (Battle Scarred)"), {
    skinName: "Swashbuckled",
    wearTier: "Battle Scarred",
    isStrange: true,
    isNonCraftable: false,
  });
});

test("matchWarPaintTool returns null for a name with no War Paint tool shape", () => {
  assert.equal(matchWarPaintTool("Rocket Launcher"), null);
});

test("createBpStatsLinkWarPaintTool builds the classic ' | War Paint (wear)' name with an encoded quality path segment", async () => {
  const match = matchWarPaintTool("Dragon Slayer War Paint (Factory New)");
  const url = await createBpStatsLinkWarPaintTool(match, false);
  assert.equal(url, "https://backpack.tf/stats/Decorated%20Weapon/Dragon%20Slayer%20%7C%20War%20Paint%20(Factory%20New)/Tradable/Craftable");
});

test("createBpStatsLinkWarPaintTool uses Non-Craftable craftability for a non-craftable tool", async () => {
  const match = matchWarPaintTool("Non-Craftable Dragon Slayer War Paint (Factory New)");
  const url = await createBpStatsLinkWarPaintTool(match, false);
  assert.match(url, /\/Tradable\/Non-Craftable$/);
});

test("createBpStatsLinkWarPaintTool uses literal Strange quality text for the Strange-tracking variant", async () => {
  const match = matchWarPaintTool("Strange Swashbuckled War Paint (Battle Scarred)");
  const url = await createBpStatsLinkWarPaintTool(match, false);
  assert.match(url, /^https:\/\/backpack\.tf\/stats\/Strange\//);
});

test("createBpStatsLinkWarPaintTool builds the next.backpack.tf query-string form with literal texture/wearTier names", async () => {
  const match = matchWarPaintTool("Dragon Slayer War Paint (Factory New)");
  const url = new URL(await createBpStatsLinkWarPaintTool(match, true));
  assert.equal(url.origin + url.pathname, "https://next.backpack.tf/stats");
  assert.equal(url.searchParams.get("item"), "War Paint");
  assert.equal(url.searchParams.get("quality"), "Decorated Weapon");
  assert.equal(url.searchParams.get("wearTier"), "Factory New");
  assert.equal(url.searchParams.get("texture"), "Dragon Slayer");
});

test("buildWarPaintToolClassifiedsLink uses numeric quality/wear ids on next.backpack.tf, omitting texture when unresolved", () => {
  const url = new URL(
    buildWarPaintToolClassifiedsLink({ skinName: "Dragon Slayer", wearTier: "Factory New", isStrange: false, textureId: null }, true)
  );
  assert.equal(url.searchParams.get("itemName"), "War Paint");
  assert.equal(url.searchParams.get("quality"), "15");
  assert.equal(url.searchParams.get("wearTier"), "1");
  assert.equal(url.searchParams.has("texture"), false);
});

test("buildWarPaintToolClassifiedsLink on next.backpack.tf omits wearTier too when it's not a known wear name", () => {
  const url = new URL(
    buildWarPaintToolClassifiedsLink({ skinName: "Dragon Slayer", wearTier: "Unknown Wear", isStrange: false, textureId: 265 }, true)
  );
  assert.equal(url.searchParams.has("wearTier"), false);
});

test("buildWarPaintToolClassifiedsLink includes texture id when resolved, and quality 11 for Strange", () => {
  const url = new URL(
    buildWarPaintToolClassifiedsLink({ skinName: "Dragon Slayer", wearTier: "Factory New", isStrange: true, textureId: 265 }, true)
  );
  assert.equal(url.searchParams.get("quality"), "11");
  assert.equal(url.searchParams.get("texture"), "265");
});

test("buildWarPaintToolClassifiedsLink uses literal texture_name/wear on classic backpack.tf", () => {
  const url = new URL(
    buildWarPaintToolClassifiedsLink({ skinName: "Dragon Slayer", wearTier: "Factory New", isStrange: false, textureId: 265 }, false)
  );
  assert.equal(url.origin + url.pathname, "https://backpack.tf/classifieds");
  assert.equal(url.searchParams.get("texture_name"), "Dragon Slayer");
  assert.equal(url.searchParams.get("wear"), "Factory New");
  assert.equal(url.searchParams.get("australium"), "-1");
  assert.equal(url.searchParams.get("killstreak_tier"), "0");
});
