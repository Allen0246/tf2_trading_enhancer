import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createButtonLink,
  createDisabledButtonLink,
  buildButtonRow,
  buildMannStoreHref,
} from "../steamcommunity.com/shared/quickLinkButtons.js";

// This module is already exercised end-to-end via
// tests/itemQuickLinks.test.js/tests/marketListingLinks.test.js/
// tests/marketListingModal.test.js (its 3 real callers), but a couple of its
// own branches (createButtonLink's hover feedback, buildMannStoreHref's
// unsupported-item-shape null return) aren't reachable through any of those
// callers' own test scenarios - covered directly here instead.

class FakeElement {
  constructor(tag) {
    this.tagName = tag;
    this.style = {};
    this._textContent = "";
    this.children = [];
    this._listeners = {};
  }
  get textContent() {
    return this._textContent;
  }
  set textContent(v) {
    this._textContent = v;
  }
  addEventListener(type, cb) {
    (this._listeners[type] ||= []).push(cb);
  }
  dispatchEvent(evt) {
    return Promise.all((this._listeners[evt.type] || []).map((cb) => cb(evt)));
  }
  appendChild(child) {
    this.children.push(child);
    return child;
  }
}

test.beforeEach(() => {
  global.document = { createElement: (tag) => new FakeElement(tag) };
});

test("createButtonLink returns null for a falsy href instead of building an empty link", () => {
  assert.equal(createButtonLink("gladiator.tf", null), null);
  assert.equal(createButtonLink("gladiator.tf", ""), null);
});

test("createButtonLink builds a styled <a> with the given label/href", () => {
  const link = createButtonLink("gladiator.tf", "https://gladiator.tf/sales?item=Rocket+Launcher");
  assert.equal(link.tagName, "a");
  assert.equal(link.textContent, "gladiator.tf");
  assert.equal(link.href, "https://gladiator.tf/sales?item=Rocket+Launcher");
  assert.equal(link.target, "_blank");
  assert.equal(link.style.display, "inline-flex");
});

// Used for pricedb.io's own rate-limited state (a real, confirmed-live 429)
// across all 3 steamcommunity.com callers - see utils/pricedb.js's own
// searchPricedbSkuStatus note.
test("createDisabledButtonLink builds a non-clickable, dimmed <span> - never a dead <a> with no href", () => {
  const placeholder = createDisabledButtonLink("pricedb.io (rate limited)");
  assert.equal(placeholder.tagName, "span");
  assert.equal(placeholder.textContent, "pricedb.io (rate limited)");
  assert.equal(placeholder.href, undefined);
  assert.equal(placeholder.style.opacity, "0.55");
  assert.equal(placeholder.style.cursor, "default");
});

test("createButtonLink brightens on hover and reverts on unhover", async () => {
  const link = createButtonLink("gladiator.tf", "https://gladiator.tf/sales");

  await link.dispatchEvent({ type: "mouseenter" });
  assert.equal(link.style.filter, "brightness(1.15)");

  await link.dispatchEvent({ type: "mouseleave" });
  assert.equal(link.style.filter, "none");
});

test("buildButtonRow appends every given button and applies marginTop only when given", () => {
  const a = createButtonLink("a", "https://a");
  const b = createButtonLink("b", "https://b");

  const row = buildButtonRow([a, b]);
  assert.deepEqual(row.children, [a, b]);
  assert.equal(row.style.marginTop, undefined);

  const rowWithMargin = buildButtonRow([a], "8px");
  assert.equal(rowWithMargin.style.marginTop, "8px");
});

test("buildMannStoreHref returns null for a falsy filters object", () => {
  assert.equal(buildMannStoreHref(null), null);
  assert.equal(buildMannStoreHref(undefined), null);
});

test("buildMannStoreHref returns null for item shapes it hasn't been built for yet (warPaintTool)", () => {
  assert.equal(buildMannStoreHref({ itemName: "War Paint Tool", warPaintTool: {} }), null);
});

// A "Professional Killstreak Minigun Kit Fabricator" showed every OTHER quick-link button except
// mannco.store - fabricatorKit used to be grouped with the genuinely-not-built-yet shapes above,
// but mannco.store DOES support searching for a Kit Fabricator too, via the exact same bare
// "search" param a target tool uses, just keyed off the item's own raw full name (there's no
// shorter canonical name to reconstruct it from the way a Strangifier's targetItemName+ itemName
// split allows): https://mannco.store/tf2?search=Professional+Killstreak+Minigun+Kit+Fabricator
test("buildMannStoreHref searches the item's own raw full name (bare search param only) for a Kit Fabricator", () => {
  const href = buildMannStoreHref({ fabricatorKit: {} }, {}, "Professional Killstreak Minigun Kit Fabricator");
  const url = new URL(href);
  assert.equal(url.origin + url.pathname, "https://mannco.store/tf2");
  assert.equal(url.searchParams.get("search"), "Professional Killstreak Minigun Kit Fabricator");
  assert.equal(url.searchParams.has("quality"), false);
  assert.equal(url.searchParams.has("killstreak"), false);
});

test("buildMannStoreHref returns null for a Kit Fabricator when no raw item name was provided", () => {
  assert.equal(buildMannStoreHref({ fabricatorKit: {} }, {}), null);
});

// A "Professional Killstreak Conniver's Kunai Kit" (a standalone Killstreak Kit item, not a
// Fabricator) was also missing its mannco.store button. Confirmed live working URL includes the
// Kit's own Sheen/Killstreaker as real filters, not just a bare name search:
// https://mannco.store/tf2?search=Professional+Killstreak+Conniver%27s+Kunai+Kit&sheen=Hot+Rod&killstreaker=Incinerator
test("buildMannStoreHref searches the item's own raw full name plus its known Sheen/Killstreaker for a Killstreak Kit", () => {
  const href = buildMannStoreHref(
    { killstreakKit: {} },
    { knownSheenName: "Hot Rod", knownKillstreakerName: "Incinerator" },
    "Professional Killstreak Conniver's Kunai Kit"
  );
  const url = new URL(href);
  assert.equal(url.origin + url.pathname, "https://mannco.store/tf2");
  assert.equal(url.searchParams.get("search"), "Professional Killstreak Conniver's Kunai Kit");
  assert.equal(url.searchParams.get("sheen"), "Hot Rod");
  assert.equal(url.searchParams.get("killstreaker"), "Incinerator");
  assert.equal(url.searchParams.has("quality"), false);
  assert.equal(url.searchParams.has("killstreak"), false);
});

test("buildMannStoreHref omits sheen/killstreaker for a Killstreak Kit when neither is known (a Basic-tier Kit)", () => {
  const href = buildMannStoreHref({ killstreakKit: {} }, {}, "Killstreak Wrench Kit");
  const url = new URL(href);
  assert.equal(url.searchParams.get("search"), "Killstreak Wrench Kit");
  assert.equal(url.searchParams.has("sheen"), false);
  assert.equal(url.searchParams.has("killstreaker"), false);
});

test("buildMannStoreHref returns null for a Killstreak Kit when no raw item name was provided", () => {
  assert.equal(buildMannStoreHref({ killstreakKit: {} }, {}), null);
});

// Target-item tools used to return null here too (grouped with the
// genuinely-not-built-yet shapes above) - confirmed live now that mannco.store
// DOES support searching for them, just with a much simpler bare "search"
// param, no quality/killstreak/festivized/warpaints structure at all:
// https://mannco.store/tf2?search=Righteous+Bison+Strangifier
test("buildMannStoreHref searches '{target} Strangifier' (bare search param only) for a plain Strangifier", () => {
  const href = buildMannStoreHref({ itemName: "Strangifier", targetItemName: "Righteous Bison" });
  const url = new URL(href);
  assert.equal(url.origin + url.pathname, "https://mannco.store/tf2");
  assert.equal(url.searchParams.get("search"), "Righteous Bison Strangifier");
  assert.equal(url.searchParams.has("quality"), false);
  assert.equal(url.searchParams.has("killstreak"), false);
  assert.equal(url.searchParams.has("festivized"), false);
  assert.equal(url.searchParams.has("warpaints"), false);
});

// REGRESSION for a live bug report ("Professor Speks Strangifier Chemistry
// Set Series #2"): confirmed live -
// https://mannco.store/tf2?search=Professor+Speks+Strangifier+Chemistry+Set -
// no "Series #2" suffix, and "Chemistry Set" is appended after "Strangifier"
// (filters.itemName here, unlike the plain-Strangifier case above where
// "Strangifier" already IS the entire filters.itemName value).
test("buildMannStoreHref searches '{target} Strangifier {itemName}' for a Strangifier Chemistry Set, with no 'Series #n' suffix", () => {
  const href = buildMannStoreHref({ itemName: "Chemistry Set", targetItemName: "Professor Speks" });
  const url = new URL(href);
  assert.equal(url.searchParams.get("search"), "Professor Speks Strangifier Chemistry Set");
});

test("buildMannStoreHref builds a filtered mannco.store search URL for a plain generic item", () => {
  const href = buildMannStoreHref({ itemName: "Rocket Launcher", quality: "Unique", killstreakTier: 0 });
  const url = new URL(href);
  assert.equal(url.origin + url.pathname, "https://mannco.store/tf2");
  assert.equal(url.searchParams.get("search"), "Rocket Launcher");
  assert.equal(url.searchParams.get("quality"), "Unique");
  assert.equal(url.searchParams.get("festivized"), "No festivized");
  assert.equal(url.searchParams.get("killstreak"), "No");
  assert.equal(url.searchParams.get("warpaints"), "No WarPaints");
});

test("buildMannStoreHref prefixes 'Australium' onto the search name for an Australium item with no skin", () => {
  const href = buildMannStoreHref({ itemName: "Rocket Launcher", isAustralium: true });
  assert.equal(new URL(href).searchParams.get("search"), "Australium Rocket Launcher");
});

test("buildMannStoreHref includes known effect/sheen/killstreaker/paint signals when given, but never a paint for an Unusual", () => {
  const href = buildMannStoreHref(
    { itemName: "Team Captain", quality: "Unusual", killstreakTier: 0 },
    { knownEffectName: "Burning Flames", knownSheenName: "Team Shine", knownKillstreakerName: "Fire Horns", knownPaintName: "Australium Gold" }
  );
  const params = new URL(href).searchParams;
  assert.equal(params.get("effect"), "Burning Flames");
  assert.equal(params.get("sheen"), "Team Shine");
  assert.equal(params.get("killstreaker"), "Fire Horns");
  assert.equal(params.has("paint"), false, "paint must never apply to an Unusual");
});

test("buildMannStoreHref for a Decorated Weapon uses its own isStrange/killstreakTier/skinName fields instead of the generic top-level ones", () => {
  const href = buildMannStoreHref({
    itemName: "Rocket Launcher", // ignored - decoratedWeapon.weaponName takes over
    decoratedWeapon: { weaponName: "Rocket Launcher", isStrange: true, killstreakTier: 3, skinName: "Warhawk" },
    isFestivized: true, // must be ignored for a decorated weapon
    isAustralium: true, // must be ignored for a decorated weapon
  });
  const params = new URL(href).searchParams;
  assert.equal(params.get("search"), "Rocket Launcher");
  assert.equal(params.get("quality"), "Strange");
  assert.equal(params.get("killstreak"), "Professional Killstreak");
  assert.equal(params.get("warpaints"), "Warhawk");
  assert.equal(params.get("festivized"), "No festivized");
});

// REGRESSION for a live bug report: this used to assume a Decorated Weapon
// is only ever Unique or Strange (checking isStrange alone), confirmed live
// wrong via "Strange Unusual Professional Killstreak Star Crossed Iron
// Bomber" - genuinely Unusual, with Strange just an add-on tracking
// descriptor, same pattern matchDecoratedWeapon's own isUnusual note
// documents for the classifieds/stats builders. isUnusual now takes
// priority, same as those. Paint is also correctly excluded as a side
// effect, once qualityName correctly reads "Unusual".
test("buildMannStoreHref for an Unusual Decorated Weapon uses Unusual's quality, even when isStrange is also true, and excludes paint", () => {
  const href = buildMannStoreHref(
    {
      decoratedWeapon: { weaponName: "Iron Bomber", isStrange: true, isUnusual: true, killstreakTier: 3, skinName: "Star Crossed" },
    },
    { knownPaintName: "Australium Gold" }
  );
  const params = new URL(href).searchParams;
  assert.equal(params.get("quality"), "Unusual");
  assert.equal(params.has("paint"), false);
});
