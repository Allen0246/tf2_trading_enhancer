import { test } from "node:test";
import assert from "node:assert/strict";

// resolveItemDetails.js ties the REAL itemShape.js/links.js together (both
// already fully covered by tests/itemShape.test.js/tests/itemLinksLinks.test.js
// on their own) - this file's own tests focus on the gluing logic that's
// unique to resolveItemDetails.js itself: the displayName rebuild for a
// Decorated Weapon, the Unusual-title-word stripping, the
// classifieds-shortcut pairing map, and the isPlainWeaponsPage Steam Market
// button suppression (the one bit of behavior that reads window.location
// directly). Same "fake chrome once at file scope" approach those two files'
// own tests use.
// Whether a Steam Web API key is "saved" (posts.tf's needsKey reads it).
let savedSteamApiKey = null;
globalThis.chrome = {
  storage: {
    local: {
      get: async () => ({
        ...(savedSteamApiKey ? { steamApiKey: savedSteamApiKey } : {}),
        tf2SchemaCache: {
          itemNameToDefindex: { "Rocket Launcher": 205 },
          defindexToItemName: { 205: "Black Box" },
          effectNameToId: { "Fountain of Delight": 22 },
          fetchedAt: Date.now(),
          schemaShapeVersion: 4,
        },
      }),
      set: async () => {},
    },
  },
  runtime: {
    sendMessage: async () => ({ ok: false, error: "no live fetch expected in this test file" }),
    getURL: (path) => path,
  },
};
globalThis.fetch = async () => ({ json: async () => [] });

const { resolveItemDetails, insertPricedbLink, insertPricedbRateLimited, insertPostsTfResult } = await import(
  "../scrap.tf/itemLinks/resolveItemDetails.js"
);
const { __resetPricedbCacheForTests } = await import("../utils/pricedb.js");

function fakeItemEl({ classes = [], defindex = null, dataContent = null } = {}) {
  return {
    classList: { contains: (name) => classes.includes(name) },
    getAttribute: (name) => {
      if (name === "data-defindex") return defindex;
      if (name === "data-content") return dataContent;
      return null;
    },
  };
}

test.beforeEach(() => {
  global.window = { location: { pathname: "/buy/hats" } };
  // Reset in case a previous test overrode this (see the gladiator.tf/
  // pricedb.io/mannco.store tests below) - keeps tests order-independent.
  globalThis.chrome.runtime.sendMessage = async () => ({ ok: false, error: "no live fetch expected in this test file" });
  // utils/pricedb.js's own in-memory cache is keyed per item name, not per
  // test - several tests below reuse "Rocket Launcher" with a different
  // sendMessage fixture than an earlier test used for the same name.
  __resetPricedbCacheForTests();
});

test("resolves a plain Unique item's full ItemDetails shape", async () => {
  const details = await resolveItemDetails("Rocket Launcher", fakeItemEl());

  assert.equal(details.displayName, "Rocket Launcher");
  assert.equal(details.qualityColor, null);
  assert.equal(details.isFestivized, false);
  assert.equal(details.effectName, null);
  assert.equal(details.isUncraft, false);
  assert.ok(details.links.some((l) => l.label === "backpack.tf stats"));
  assert.ok(details.links.some((l) => l.label === "Steam Market"));
  assert.ok(details.links.some((l) => l.label === "marketplace.tf"));
  assert.match(details.classifiedsHref, /^https:\/\/backpack\.tf\/classifieds\?/);
  assert.match(details.nextClassifiedsHref, /^https:\/\/next\.backpack\.tf\/classifieds\?/);
});

// --- stntrading.eu -----------------------------------------------------------

test("includes an stntrading.eu link, positioned right before Steam Market, built from the same steamMarketName as the Steam Market button itself", async () => {
  const details = await resolveItemDetails("Strange War Pig", fakeItemEl({ classes: ["quality11"] }));

  const labels = details.links.map((l) => l.label);
  const stnIndex = labels.indexOf("stntrading.eu");
  const steamMarketIndex = labels.indexOf("Steam Market");
  assert.ok(stnIndex >= 0);
  assert.equal(steamMarketIndex, stnIndex + 1);
  assert.equal(details.links[stnIndex].href, "https://stntrading.eu/item/tf2/Strange+War+Pig");
});

test("still includes the stntrading.eu link on the /buy/weapons page, even though Steam Market itself is skipped there", async () => {
  global.window = { location: { pathname: "/buy/weapons" } };
  const details = await resolveItemDetails("Rocket Launcher", fakeItemEl());

  assert.equal(details.links.some((l) => l.label === "Steam Market"), false);
  assert.ok(details.links.some((l) => l.label === "stntrading.eu"));
});

// An Unusual's own stntrading.eu link is a THIRD, distinct naming
// convention - see buildStnTradingHref's own header note. Confirmed live:
// https://stntrading.eu/item/tf2/Unusual+Cuban+Smoke+Throttlehead
test("an Unusual's stntrading.eu link keeps the literal 'Unusual' word AND inserts the effect name, unlike steamMarketName (no effect) or searchDisplayName (no 'Unusual')", async () => {
  const itemEl = fakeItemEl({ classes: ["quality5"], dataContent: "Effect: Cuban Smoke" });
  const details = await resolveItemDetails("Throttlehead", itemEl);

  const stn = details.links.find((l) => l.label === "stntrading.eu");
  assert.equal(stn.href, "https://stntrading.eu/item/tf2/Unusual+Cuban+Smoke+Throttlehead");
});

test("isUncraft is true for an item carrying scrap.tf's own 'uncraft' CSS class", async () => {
  const details = await resolveItemDetails("Rocket Launcher", fakeItemEl({ classes: ["uncraft"] }));
  assert.equal(details.isUncraft, true);
});

// --- gladiator.tf / pricedb.io / mannco.store -------------------------------

test("always includes a gladiator.tf link, built from the full resolved item name", async () => {
  // Quality is read off the CSS class (quality11 = Strange - see
  // utils/tf2Quality.js), not the raw text - same "quality11" fixture the
  // rest of this file already uses for a Strange item.
  const details = await resolveItemDetails("Strange Rocket Launcher", fakeItemEl({ classes: ["quality11"] }));

  const gladiatorLink = details.links.find((l) => l.label === "gladiator.tf");
  assert.ok(gladiatorLink);
  const url = new URL(gladiatorLink.href);
  assert.equal(url.origin + url.pathname, "https://gladiator.tf/sales");
  assert.equal(url.searchParams.get("item"), "Strange Rocket Launcher");
});

test("always includes a mannco.store link, built from the resolved shape", async () => {
  const details = await resolveItemDetails("Strange Rocket Launcher", fakeItemEl({ classes: ["quality11"] }));

  const mannLink = details.links.find((l) => l.label === "mannco.store");
  assert.ok(mannLink);
  const params = new URL(mannLink.href).searchParams;
  assert.equal(params.get("search"), "Rocket Launcher");
  assert.equal(params.get("quality"), "Strange");
});

// Pricedb.io's own search is no longer awaited before resolveItemDetails
// returns at all (it used to be, making the WHOLE item card wait on this one
// slow, per-item network call) - it now resolves separately via the returned
// pricedbPromise, which the caller (itemCard.js) awaits AFTER already
// rendering everything else, splicing the result into `links` itself via
// insertPricedbLink. Never present in `links` directly anymore - these tests
// await pricedbPromise first.
test("includes a pricedb.io link when the search resolves a sku, omits it when it doesn't", async () => {
  globalThis.chrome.runtime.sendMessage = async () => ({
    ok: true,
    data: { success: true, data: { results: [{ sku: "18;6" }] } },
  });
  const withMatch = await resolveItemDetails("Rocket Launcher", fakeItemEl());
  assert.equal(withMatch.links.some((l) => l.label === "pricedb.io"), false);
  const { href: pricedbHref } = await withMatch.pricedbPromise;
  const pricedbLink = insertPricedbLink(withMatch.links, pricedbHref).find((l) => l.label === "pricedb.io");
  assert.ok(pricedbLink);
  assert.equal(pricedbLink.href, "https://pricedb.io/item/18%3B6");

  // Same item name, deliberately looked up again - utils/pricedb.js's own
  // in-memory cache is keyed on it, so the second call needs a reset to
  // actually re-run the search under the new (failing) fixture below rather
  // than replaying the first call's own cached "18;6" result.
  __resetPricedbCacheForTests();
  globalThis.chrome.runtime.sendMessage = async () => ({ ok: false, error: "no match" });
  const withoutMatch = await resolveItemDetails("Rocket Launcher", fakeItemEl());
  const { href: withoutMatchHref } = await withoutMatch.pricedbPromise;
  assert.equal(withoutMatchHref, null);
  assert.equal(insertPricedbLink(withoutMatch.links, withoutMatchHref).some((l) => l.label === "pricedb.io"), false);
});

// A rate-limited lookup used to look IDENTICAL to "this item genuinely has
// no pricedb.io listing" here too - both just a null href. pricedbPromise
// now resolves { href, rateLimited } instead of a plain href, so a caller
// (itemCard.js) can tell the two apart via insertPricedbRateLimited instead
// of insertPricedbLink silently no-op'ing.
test("REGRESSION: pricedbPromise reports rateLimited: true on a real 429, distinct from a genuine no-match", async () => {
  __resetPricedbCacheForTests();
  globalThis.chrome.runtime.sendMessage = async () => ({ ok: false, status: 429, error: "Rate limited (429)" });
  const details = await resolveItemDetails("Rocket Launcher", fakeItemEl());
  const before = Date.now();
  const { href, rateLimited, retryAt } = await details.pricedbPromise;
  assert.equal(href, null);
  assert.equal(rateLimited, true);
  // No Retry-After header: the default 30s from now.
  assert.ok(retryAt >= before + 30000 && retryAt <= Date.now() + 30000);

  const linksWithPlaceholder = insertPricedbRateLimited(details.links, retryAt);
  const placeholder = linksWithPlaceholder.find((l) => l.rateLimitedUntil);
  assert.ok(placeholder);
  assert.equal(placeholder.label, "pricedb.io");
  assert.equal(placeholder.href, null);
  assert.equal(placeholder.rateLimitedUntil, retryAt);
});

test("lookupPricedb runs the same pricedb.io search again (for the countdown's retry)", async () => {
  __resetPricedbCacheForTests();
  globalThis.chrome.runtime.sendMessage = async () => ({ ok: false, status: 429, error: "Rate limited (429)", retryAfterMs: 5000 });
  const details = await resolveItemDetails("Rocket Launcher", fakeItemEl());
  assert.equal((await details.pricedbPromise).rateLimited, true);

  globalThis.chrome.runtime.sendMessage = async (msg) => {
    const q = new URL(msg.url).searchParams.get("q");
    return { ok: true, data: { success: true, data: { results: [{ name: q, sku: "205;6" }] } } };
  };
  const retried = await details.lookupPricedb();
  assert.deepEqual(retried, { href: "https://pricedb.io/item/205%3B6", rateLimited: false, retryAt: null });
});

// Gladiator.tf/pricedb.io are community trading-price sites, not Steam
// itself - they follow the trading community's own "{Effect} {Item}" Unusual
// naming convention (e.g. "Purple Energy Team Captain"), not Steam's raw
// market_hash_name (which keeps the literal word "Unusual").
test("REGRESSION: substitutes the resolved Unusual effect name for the literal 'Unusual' word when searching gladiator.tf/pricedb.io", async () => {
  let searchedQuery = null;
  globalThis.chrome.runtime.sendMessage = async (message) => {
    searchedQuery = new URL(message.url).searchParams.get("q");
    return { ok: false, error: "no live fetch expected" };
  };

  const itemEl = fakeItemEl({ classes: ["quality5"], dataContent: "Effect: Fountain of Delight" });
  const details = await resolveItemDetails("Team Captain", itemEl);

  const gladiatorLink = details.links.find((l) => l.label === "gladiator.tf");
  assert.equal(new URL(gladiatorLink.href).searchParams.get("item"), "Fountain of Delight Team Captain");
  assert.equal(searchedQuery, "Fountain of Delight Team Captain");
});

test("falls back to the literal 'Unusual ' word for gladiator.tf/pricedb.io when the effect itself couldn't be resolved (no data-content Effect line at all)", async () => {
  const itemEl = fakeItemEl({ classes: ["quality5"] }); // Unusual quality, but no Effect line to read a name from
  const details = await resolveItemDetails("Team Captain", itemEl);

  const gladiatorLink = details.links.find((l) => l.label === "gladiator.tf");
  assert.equal(new URL(gladiatorLink.href).searchParams.get("item"), "Unusual Team Captain");
});

test("strips the literal 'Unusual' word from the display title (still conveyed via qualityColor/effect line instead)", async () => {
  const itemEl = fakeItemEl({ classes: ["quality5"], dataContent: "Effect: Fountain of Delight" });
  const details = await resolveItemDetails("Team Captain", itemEl);

  assert.equal(details.displayName, "Team Captain");
  assert.equal(details.effectName, "Fountain of Delight");
  assert.notEqual(details.qualityColor, null);
});

test("omits the Steam Market button on the /buy/weapons page (plain weapons have no Steam Market listing)", async () => {
  global.window = { location: { pathname: "/buy/weapons" } };
  const details = await resolveItemDetails("Rocket Launcher", fakeItemEl());

  assert.equal(details.links.some((l) => l.label === "Steam Market"), false);
  assert.ok(details.links.some((l) => l.label === "marketplace.tf"));
});

test("includes the Steam Market button on a non-weapons /buy/ page", async () => {
  global.window = { location: { pathname: "/buy/hats" } };
  const details = await resolveItemDetails("Rocket Launcher", fakeItemEl());

  assert.ok(details.links.some((l) => l.label === "Steam Market"));
});

test("pairs the two stats buttons with their own classifieds shortcut hrefs", async () => {
  const details = await resolveItemDetails("Rocket Launcher", fakeItemEl());

  assert.match(details.classifiedsHref, /^https:\/\/backpack\.tf\/classifieds\?/);
  assert.match(details.nextClassifiedsHref, /^https:\/\/next\.backpack\.tf\/classifieds\?/);
  // Both are independently buildable from the same resolved shape - not
  // coupled to any particular link's own href.
  assert.notEqual(details.classifiedsHref, details.nextClassifiedsHref);
});

// Regression test for a live bug report: itemShape.js's own detectItemShape
// computed fabricatorKitTier internally but never included it in the shape
// object it returned - links.js's deriveClassifiedsFilters (which every
// classifieds-shortcut href goes through) silently fell back to the hovered
// tool's own ksTier (always 0, since a Fabricator isn't itself a killstreak
// weapon) instead, so a Specialized and a Professional Fabricator's
// classifieds links both ended up with the same (missing) killstreakTier.
// Goes through the REAL detectItemShape (not a hand-built shape, unlike
// tests/itemLinksLinks.test.js's own classifieds tests) so this actually
// exercises the field itemShape.js was silently dropping.
test("a Fabricator's classifieds shortcut hrefs carry the correct killstreakTier - 2 for Specialized, 3 for Professional", async () => {
  const specialized = await resolveItemDetails("Specialized Rocket Launcher Kit Fabricator", fakeItemEl());
  assert.equal(new URL(specialized.nextClassifiedsHref).searchParams.get("killstreakTier"), "2");
  assert.equal(new URL(specialized.classifiedsHref).searchParams.get("killstreak_tier"), "2");

  const professional = await resolveItemDetails("Professional Rocket Launcher Kit Fabricator", fakeItemEl());
  assert.equal(new URL(professional.nextClassifiedsHref).searchParams.get("killstreakTier"), "3");
  assert.equal(new URL(professional.classifiedsHref).searchParams.get("killstreak_tier"), "3");
});

// A Killstreak Kit/Fabricator must get a mannco.store button (links.js's
// buildMannStoreHref once returned null for both). Goes through the REAL
// detectItemShape (via resolveItemDetails), same reasoning as the
// killstreakTier regression test above.
test("a Killstreak Kit's mannco.store link bare-searches its own full reconstructed name, including its fixed Sheen/Killstreaker", async () => {
  const itemEl = fakeItemEl({ dataContent: "Sheen: Team Shine<br>Killstreaker: Cerebral Discharge" });
  const details = await resolveItemDetails("Professional Rocket Launcher Kit", itemEl);
  const mannLink = details.links.find((l) => l.label === "mannco.store");
  assert.ok(mannLink);
  const params = new URL(mannLink.href).searchParams;
  assert.equal(params.get("search"), "Professional Killstreak Rocket Launcher Kit");
  assert.equal(params.get("sheen"), "Team Shine");
  assert.equal(params.get("killstreaker"), "Cerebral Discharge");
});

test("a Kit Fabricator's mannco.store link bare-searches its own full reconstructed name", async () => {
  const details = await resolveItemDetails("Specialized Conniver's Kunai Kit Fabricator", fakeItemEl());
  const mannLink = details.links.find((l) => l.label === "mannco.store");
  assert.ok(mannLink);
  assert.equal(new URL(mannLink.href).searchParams.get("search"), "Specialized Killstreak Conniver's Kunai Kit Fabricator");
});

// REGRESSION for a live bug report ("Professor Speks Strangifier Chemistry
// Set Series #2"): goes through the REAL detectItemShape (via
// resolveItemDetails), same reasoning as the killstreakTier regression test
// above - "Professor Speks" isn't in this file's own schema fixture, so
// statsUnresolved is expected here (irrelevant to what this test checks: the
// classifieds link's own item-name/targetItem params). Confirmed live:
// https://next.backpack.tf/classifieds?itemName=Chemistry%20Set&quality=6&
// targetItem=Professor%20Speks
test("a Strangifier Chemistry Set's classifieds link searches 'Chemistry Set' (not 'Strangifier'), filtered by targetItem", async () => {
  const details = await resolveItemDetails("Professor Speks Strangifier Chemistry Set Series #2", fakeItemEl());
  const nextUrl = new URL(details.nextClassifiedsHref);
  assert.equal(nextUrl.searchParams.get("itemName"), "Chemistry Set");
  assert.equal(nextUrl.searchParams.get("targetItem"), "Professor Speks");

  const classicUrl = new URL(details.classifiedsHref);
  assert.equal(classicUrl.searchParams.get("item"), "Chemistry Set");
});

// Regression test for a second, related live bug report: the Steam Market
// button's own name-building (buildSteamMarketName) had no Fabricator branch
// at all, so it searched for e.g. "Specialized Conniver's Kunai Kit
// Fabricator" - missing the word "Killstreak" Steam's real market_hash_name
// needs ("Specialized Killstreak Conniver's Kunai Kit Fabricator"). Uses the
// real detectItemShape (via resolveItemDetails), same reasoning as the
// killstreakTier regression test above - "Conniver's Kunai" isn't in this
// file's own schema fixture, so statsUnresolved is expected here (irrelevant
// to what this test checks: the Steam Market link's own item-name segment).
test("a Fabricator's Steam Market link includes 'Killstreak' and the correct tier word - not the bare raw name", async () => {
  const details = await resolveItemDetails("Specialized Conniver's Kunai Kit Fabricator", fakeItemEl());
  const steamMarketLink = details.links.find((l) => l.label === "Steam Market");
  assert.ok(steamMarketLink);
  assert.match(
    decodeURIComponent(steamMarketLink.href),
    /^https:\/\/steamcommunity\.com\/market\/listings\/440\/Specialized Killstreak Conniver's Kunai Kit Fabricator/
  );
});

test("resolves paintColor from the shape's own paintEntry (not a single fixed color)", async () => {
  const itemEl = fakeItemEl({ dataContent: "Painted Australium Gold" });
  const details = await resolveItemDetails("Team Captain", itemEl);

  assert.equal(details.paintName, "Australium Gold");
  assert.ok(details.paintColor); // a real hex color, not null
});

test("paintColor is null when the item has no paint", async () => {
  const details = await resolveItemDetails("Rocket Launcher", fakeItemEl());
  assert.equal(details.paintColor, null);
});

test("skinLabel is only set for a Decorated Weapon", async () => {
  const details = await resolveItemDetails("Rocket Launcher", fakeItemEl());
  assert.equal(details.skinLabel, null);
});

test("rebuilds the full in-game display name for a Decorated Weapon, and sets skinLabel", async () => {
  const itemEl = fakeItemEl({ classes: ["quality11"], defindex: "205" });
  const details = await resolveItemDetails("Strange Necromanced Black Box (Factory New)", itemEl);

  assert.equal(details.displayName, "Strange Necromanced Black Box (Factory New)");
  assert.equal(details.skinLabel, "Necromanced (Factory New)");
});

// The displayed title used to keep "Strange " AND the "★Unusual " marker
// stuck on literally, showed the wrong (Strange, orange) qualityColor, and
// never showed an Effect line at all - fixed at the skinDetection.js level
// (see tests/skinDetection.test.js's own coverage), verified here
// end-to-end through the actual display fields a user sees on the card.
test("a Strange-tracking War Paint tool with its own Unusual effect gets a clean title, Unusual's qualityColor, and its effect name", async () => {
  const itemEl = fakeItemEl({ classes: ["quality11"], dataContent: "Level 1<br>Effect: Hot" });
  const details = await resolveItemDetails("Strange ★Unusual Beachy Boy War Paint (Minimal Wear)", itemEl);

  assert.equal(details.displayName, "Beachy Boy War Paint (Minimal Wear)");
  assert.equal(details.qualityColor, "#8650ac");
  assert.equal(details.effectName, "Hot");
});

test("carries killstreak tier name through from the shape", async () => {
  const itemEl = fakeItemEl({ classes: ["killstreak2"] });
  const details = await resolveItemDetails("Rocket Launcher", itemEl);
  assert.equal(details.killstreakTierName, "Specialized Killstreak");
});

// New feature: Sheen/Killstreaker filtering is user-toggleable via a General
// settings checkbox, default on - utils/sheenKillstreakerFilterSetting.js's own
// isSheenKillstreakerFilterEnabled. When off, every LINK builder (classic/next
// classifieds, marketplace.tf, mannco.store) drops sheen/killstreaker - but the
// card's own DISPLAY fields (sheenName/killstreakerName/killstreakTierName) must
// keep showing the item's real attributes regardless, since those aren't search
// filters, and Killstreak TIER itself (detectOwnKillstreakTier's own CSS-class
// read) is a separate, always-on signal untouched by this toggle either way.
test("omits sheen/killstreaker from every link builder when the filter setting is off, without touching the card's own display fields or Killstreak tier", async () => {
  const originalGet = globalThis.chrome.storage.local.get;
  globalThis.chrome.storage.local.get = async () => ({
    tf2SchemaCache: {
      itemNameToDefindex: { "Rocket Launcher": 205 },
      defindexToItemName: { 205: "Black Box" },
      effectNameToId: {},
      fetchedAt: Date.now(),
      schemaShapeVersion: 4,
    },
    sheenKillstreakerFilterEnabled: false,
  });

  try {
    const itemEl = fakeItemEl({
      classes: ["killstreak3"],
      dataContent: "Level 10<br>Sheen: Agonizing Emerald<br>Killstreaker: Fire Horns",
    });
    const details = await resolveItemDetails("Rocket Launcher", itemEl);

    assert.equal(details.sheenName, "Agonizing Emerald");
    assert.equal(details.killstreakerName, "Fire Horns");
    assert.equal(details.killstreakTierName, "Professional Killstreak");

    assert.equal(new URL(details.classifiedsHref).searchParams.get("sheen"), null);
    assert.equal(new URL(details.nextClassifiedsHref).searchParams.get("sheen"), null);
    assert.equal(new URL(details.nextClassifiedsHref).searchParams.get("killstreaker"), null);

    const marketplaceLink = details.links.find((l) => l.label === "marketplace.tf");
    assert.ok(marketplaceLink);
    assert.equal(new URL(marketplaceLink.href).searchParams.get("sks[]"), null);
    assert.equal(new URL(marketplaceLink.href).searchParams.get("ske[]"), null);

    const mannLink = details.links.find((l) => l.label === "mannco.store");
    assert.ok(mannLink);
    assert.equal(new URL(mannLink.href).searchParams.get("sheen"), null);
    assert.equal(new URL(mannLink.href).searchParams.get("killstreaker"), null);
  } finally {
    globalThis.chrome.storage.local.get = originalGet;
  }
});

// --- posts.tf ---------------------------------------------------------------

// itemNameToDefindex's own "Rocket Launcher": 205 fixture entry (top of this
// file) doubles as posts.tf's schema lookup here - no separate fixture
// needed, same shared schema cache every other schema-backed link in this
// file already reads.
test("includes a posts.tf link, positioned right after pricedb.io once inserted, matching the row order every other port of this feature uses", async () => {
  globalThis.chrome.runtime.sendMessage = async () => ({
    ok: true,
    data: { success: true, data: { results: [{ sku: "205;6" }] } },
  });
  const details = await resolveItemDetails("Rocket Launcher", fakeItemEl());
  const { href: pricedbHref } = await details.pricedbPromise;
  const postsTfResult = await details.postsTfPromise;
  // posts.tf spliced in BEFORE pricedb.io - see afterGladiatorIndex's own
  // note in resolveItemDetails.js on why that ordering produces the correct
  // final row (gladiator.tf, pricedb.io, posts.tf, ...) regardless of which
  // of the two promises settles first.
  let links = insertPostsTfResult(details.links, postsTfResult, details.statsUnresolved);
  links = insertPricedbLink(links, pricedbHref);

  const labels = links.map((l) => l.label);
  const pricedbIndex = labels.indexOf("pricedb.io");
  const postsTfIndex = labels.indexOf("posts.tf");
  assert.ok(pricedbIndex >= 0);
  assert.equal(postsTfIndex, pricedbIndex + 1);

  const b64 = new URL(links[postsTfIndex].href).searchParams.get("q");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const query = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  assert.deepEqual(query.u[0], { defindex: 205, quality: 6, craftable: true });
});

// posts.tf's own defindex resolution (getItemDefindex) is entirely
// independent of pricedb.io's own /api/search call - one shouldn't gate the
// other just because they happen to sit in the same row.
test("still includes a posts.tf link when pricedb.io's own search doesn't resolve a sku", async () => {
  const details = await resolveItemDetails("Rocket Launcher", fakeItemEl());
  assert.equal((await details.pricedbPromise).href, null);
  const postsTfResult = await details.postsTfPromise;
  assert.ok(postsTfResult.href);
  assert.equal(postsTfResult.needsKey, false);
  const links = insertPostsTfResult(details.links, postsTfResult, details.statsUnresolved);
  assert.ok(links.some((l) => l.label === "posts.tf"));
});

test("omits the posts.tf link when the item's schema defindex can't be resolved at all", async () => {
  const details = await resolveItemDetails("Specialized Conniver's Kunai Kit Fabricator", fakeItemEl());
  // Fabricators aren't covered by posts.tf at all, regardless of any key -
  // postsTfApplies tells the caller not to even reserve a slot/placeholder.
  assert.equal(details.postsTfApplies, false);
  const postsTfResult = await details.postsTfPromise;
  // Also no key hint - posts.tf isn't built for Fabricators at all
  // regardless of any key (see postsTfCoversItemType), so prompting for one
  // here would be misleading.
  assert.deepEqual(postsTfResult, { href: null, needsKey: false });
  const links = insertPostsTfResult(details.links, postsTfResult, details.statsUnresolved);
  assert.equal(links.some((l) => l.label === "posts.tf"), false);
});

// Regression: buildPostsTfLink needs the schema for every item type, unlike
// backpack.tf's own name-based stats links, which need none for a generic
// item - so shape.statsUnresolved stays false even when posts.tf alone can't
// resolve. See insertPostsTfResult's own note on the resulting
// redundant-prompt guard.
test("shows posts.tf's compact key hint when only posts.tf fails to resolve and no key is saved, even though stats/classifieds/everything else worked fine", async () => {
  savedSteamApiKey = null;
  const details = await resolveItemDetails("Second Banana", fakeItemEl());

  // Confirms the premise: nothing else is broken here.
  assert.equal(details.links.some((l) => l.label.includes("Set Steam API key for stats")), false);
  assert.ok(details.links.some((l) => l.href?.includes("next.backpack.tf")));

  const postsTfResult = await details.postsTfPromise;
  assert.deepEqual(postsTfResult, { href: null, needsKey: true });
  const links = insertPostsTfResult(details.links, postsTfResult, details.statsUnresolved);

  const hint = links.find((l) => l.label === "posts.tf");
  assert.ok(hint, "expected the posts.tf key hint");
  assert.equal(hint.href, null);
  assert.equal(hint.needsKey, true);
  assert.match(hint.title, /Steam Web API key/);
});

test("REGRESSION: with a key already saved, an unresolved posts.tf shows no key prompt (it used to ask for a key you already had)", async () => {
  savedSteamApiKey = "ABC123";
  try {
    const details = await resolveItemDetails("Second Banana", fakeItemEl());
    const postsTfResult = await details.postsTfPromise;
    assert.deepEqual(postsTfResult, { href: null, needsKey: false });
    const links = insertPostsTfResult(details.links, postsTfResult, details.statsUnresolved);
    assert.equal(links.some((l) => l.label === "posts.tf" || /Steam API key/.test(l.label)), false);
  } finally {
    savedSteamApiKey = null;
  }
});

// REGRESSION guard: unlike next.backpack.tf's own tooltip TITLE text (which
// strips "Taunt: " for display - see
// backpack.tf/nextUI/addPricedbButton/content.js's own header note),
// scrap.tf's own baseName (stripNamePrefix - utils/tf2ItemName.js) never
// strips "Taunt: " in the first place, so pricedb.io's search here already
// gets the correct query without needing that same reconstruction fix.
test("pricedb.io's own search query for a Taunt already keeps 'Taunt: ' intact - no separate reconstruction fix needed on scrap.tf", async () => {
  let searchedQuery = null;
  globalThis.chrome.runtime.sendMessage = async (message) => {
    searchedQuery = new URL(message.url).searchParams.get("q");
    return { ok: false, error: "no live fetch expected" };
  };

  await resolveItemDetails("Taunt: Conga", fakeItemEl());
  assert.equal(searchedQuery, "Taunt: Conga");
});
