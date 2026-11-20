import { test } from "node:test";
import assert from "node:assert/strict";
import {
  showFabricatorMultiBuy,
  parseMultiBuyTotalHtml,
  extractValidNamesFromSearchHtml,
  showMultiBuyVerifyReminder,
  estimateSellerReceivesMinorUnits,
} from "../steamcommunity.com/fabricatorMultiBuy/content.js";

// fabricatorMultiBuy/content.js adds a "Buy Parts" button under a
// Fabricator's/Chemistry Set's own "The following are the inputs that must
// be fulfilled." list, linking to Steam's own native market/multibuy page.
// Same lightweight hand-rolled FakeElement approach tests/
// inventoryMarketActions.test.js already established for this exact page
// (pickContainer/getActiveInventoryAppId are reused, real, unmocked - only
// document/fetch are faked).

class FakeElement {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    this.attributes = {};
    this._classes = new Set();
    this.classList = {
      add: (...names) => names.forEach((n) => this._classes.add(n)),
      contains: (name) => this._classes.has(name),
    };
    this._textContent = "";
    this._id = "";
    this.style = {};
    this.title = "";
    this._listeners = {};
  }
  addEventListener(type, cb) {
    (this._listeners[type] ||= []).push(cb);
  }
  get textContent() {
    // Real DOM textContent aggregates through descendants - needed for
    // assertions against buildManualInputsNote's own nested text+link lines.
    if (this.children.length > 0) return this.children.map((c) => c.textContent || "").join("");
    return this._textContent;
  }
  set textContent(v) {
    this._textContent = v;
    this.children = [];
  }
  get className() {
    return [...this._classes].join(" ");
  }
  set className(v) {
    this._classes = new Set(String(v).split(/\s+/).filter(Boolean));
  }
  get id() {
    return this._id;
  }
  set id(v) {
    this._id = v;
  }
  setAttribute(name, value) {
    this.attributes[name] = value;
  }
  getAttribute(name) {
    return this.attributes[name] ?? null;
  }
  appendChild(child) {
    // A real DOM auto-wraps a raw string arg (e.g. `el.append("text", link)`)
    // into a genuine Text node whose own .textContent is that string - wrap
    // it the same way here, matching tests/itemQuickLinks.test.js's own
    // FakeElement.
    if (typeof child === "string") child = { textContent: child };
    this.children.push(child);
    if (child && typeof child === "object") child.parentElement = this;
    return child;
  }
  append(...items) {
    for (const item of items) this.appendChild(item);
  }
  insertAdjacentElement(position, el) {
    if (!this.parentElement) {
      this.appendChild(el);
      return el;
    }
    const idx = this.parentElement.children.indexOf(this);
    const insertAt = position === "afterend" ? idx + 1 : idx;
    this.parentElement.children.splice(insertAt, 0, el);
    el.parentElement = this.parentElement;
    return el;
  }
  remove() {
    if (!this.parentElement) return;
    const i = this.parentElement.children.indexOf(this);
    if (i !== -1) this.parentElement.children.splice(i, 1);
    this.parentElement = null;
  }
  matchesSelectorPart(part) {
    if (part.startsWith(".")) return this._classes.has(part.slice(1));
    return this.tagName === part;
  }
  closest(selector) {
    let el = this;
    while (el) {
      if (el.matchesSelectorPart(selector)) return el;
      el = el.parentElement;
    }
    return null;
  }
  querySelectorAll(selector) {
    const parts = selector.split(",").map((s) => s.trim());
    const results = [];
    const visit = (node) => {
      for (const child of node.children || []) {
        if (child && typeof child === "object") {
          if (parts.some((p) => child.matchesSelectorPart?.(p))) results.push(child);
          visit(child);
        }
      }
    };
    visit(this);
    return results;
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
}

function leaf(tag, text) {
  const el = new FakeElement(tag);
  el.textContent = text;
  return el;
}

// Defaults to a QUALIFYING title (see KIT_FABRICATOR_TITLE_PATTERN) so every
// existing test keeps exercising the input-scanning/multibuy logic; the
// scope-gating tests below pass a non-qualifying title explicitly.
function buildPanel(lines, { title: titleText = "Specialized Killstreak Test Weapon Kit Fabricator" } = {}) {
  const container = new FakeElement("div");
  const title = new FakeElement("h1");
  title.textContent = titleText;
  container.appendChild(title);
  for (const text of lines) container.appendChild(leaf("div", text));
  return container;
}

// Both default to the SAME id ("my own inventory") so every existing test
// keeps exercising the main logic without caring about ownership; the
// dedicated ownership-gate tests below pass mismatched/missing ids to
// simulate a friend's/stranger's inventory instead.
const DEFAULT_STEAM_ID = "76561198000000001";

function installGlobals({
  c0 = null,
  hash = "#440",
  fetchImpl,
  viewedSteamId64 = DEFAULT_STEAM_ID,
  loggedInSteamId64 = DEFAULT_STEAM_ID,
} = {}) {
  const inventoryMarker = viewedSteamId64 ? new FakeElement("div") : null;
  if (inventoryMarker) inventoryMarker.id = `inventory_${viewedSteamId64}_440_2`;

  const steamIdScript = new FakeElement("script");
  if (loggedInSteamId64) steamIdScript.textContent = `g_steamID = "${loggedInSteamId64}";`;

  globalThis.window = { location: { hash } };
  globalThis.document = {
    querySelector: (sel) => {
      if (sel === "#iteminfo0") return c0;
      if (sel === "#iteminfo1") return null;
      if (sel === ".item.activeInfo") return null;
      return null;
    },
    querySelectorAll: (sel) => {
      if (sel === '[id^="inventory_"]') return inventoryMarker ? [inventoryMarker] : [];
      if (sel === "script") return [steamIdScript];
      return [];
    },
    createElement: (tag) => new FakeElement(tag),
  };
  globalThis.fetch = fetchImpl || (async () => ({ ok: true, text: async () => "" }));
}

const realSetTimeout = setTimeout;
async function flush(ticks = 8) {
  for (let i = 0; i < ticks; i++) await new Promise((resolve) => realSetTimeout(resolve, 0));
}

function findBlock(container) {
  return container.querySelectorAll(".tf2te-fabricator-multibuy")[0] || null;
}

// --- gating --------------------------------------------------------------

test("does nothing on a non-TF2 inventory tab", async () => {
  const container = buildPanel(["The following are the inputs that must be fulfilled.", "Reclaimed Metal x2"]);
  installGlobals({ c0: container, hash: "#730" }); // CS2, not TF2

  await showFabricatorMultiBuy();

  assert.equal(findBlock(container), null);
});

// --- ownership gating: the visitor's own inventory only ------------------
// - buying parts to satisfy someone ELSE's Fabricator recipe makes no
// practical sense, since the parts you'd buy land in YOUR OWN inventory
// either way.

test("does not show when viewing someone else's inventory (viewed id differs from the logged-in visitor's own)", async () => {
  const container = buildPanel(["The following are the inputs that must be fulfilled.", "Reclaimed Metal x2"]);
  installGlobals({ c0: container, viewedSteamId64: "76561198000000002", loggedInSteamId64: "76561198000000001" });

  await showFabricatorMultiBuy();

  assert.equal(findBlock(container), null);
});

test("does not show when the visitor's own logged-in id can't be resolved at all (fails closed, not open)", async () => {
  const container = buildPanel(["The following are the inputs that must be fulfilled.", "Reclaimed Metal x2"]);
  installGlobals({ c0: container, loggedInSteamId64: null });

  await showFabricatorMultiBuy();

  assert.equal(findBlock(container), null);
});

test("shows normally when the viewed inventory matches the logged-in visitor's own id", async () => {
  const container = buildPanel(["The following are the inputs that must be fulfilled.", "Reclaimed Metal x2"]);
  installGlobals({ c0: container, viewedSteamId64: "76561198000000009", loggedInSteamId64: "76561198000000009" });

  await showFabricatorMultiBuy();
  await flush();

  assert.ok(findBlock(container));
});

test("does nothing (no throw) for a plain item with no required-inputs list", async () => {
  const container = buildPanel(["Killstreaks Active", "Sheen: Team Shine"]);
  installGlobals({ c0: container });

  await showFabricatorMultiBuy();

  assert.equal(findBlock(container), null);
});

test("removes a stale block when the panel no longer has a fulfillment heading", async () => {
  const container = buildPanel(["Killstreaks Active"]);
  const stale = new FakeElement("div");
  stale.className = "tf2te-fabricator-multibuy";
  container.appendChild(stale);
  installGlobals({ c0: container });

  await showFabricatorMultiBuy();

  assert.equal(findBlock(container), null);
});

// --- generic input scanning (works for both Fabricators and Chemistry Sets) -

test("builds a multibuy button for a Fabricator's robot-part inputs", async () => {
  const container = buildPanel([
    "The following are the inputs that must be fulfilled.",
    "Battle-Worn Robot Money Furnace x2",
    "Battle-Worn Robot KB-808 x1",
  ]);
  installGlobals({ c0: container, fetchImpl: async () => ({ ok: true, text: async () => "" }) });

  await showFabricatorMultiBuy();
  await flush();

  const block = findBlock(container);
  assert.ok(block);
  const link = block.children[0];
  assert.match(link.href, /market\/multibuy\?/);
  assert.match(link.href, /appid=440/);
  assert.match(link.href, /items%5B%5D=Battle-Worn\+Robot\+Money\+Furnace/);
  assert.match(link.href, /qty%5B%5D=2/);
});

// Steam's own multibuy page tooltips each price field with "We have
// prefilled the price with the cheapest listing currently available." -
// i.e. every price shown (not just an auto-resolved generic one) is a live
// snapshot that can change before the user finishes checkout. A persistent
// disclaimer should say so.
test("shows a price disclaimer under the Buy Parts button, for every recipe (not just generic ones)", async () => {
  const container = buildPanel(["The following are the inputs that must be fulfilled.", "Reclaimed Metal x2"]);
  installGlobals({ c0: container });

  await showFabricatorMultiBuy();
  await flush();

  const block = findBlock(container);
  const disclaimer = block.querySelectorAll(".tf2te-fabricator-price-disclaimer")[0];
  assert.ok(disclaimer);
  assert.match(disclaimer.textContent, /may change/i);
});

// The input-scanning logic itself stays generic (a plain weapon name under
// the heading, no hardcoded part-name list needed) - proven here via a
// qualifying title, even though a real Chemistry Set never reaches this
// code path any more (see the scope-gating tests below).
test("the generic input scan also handles a plain weapon-name line, not just robot-part names", async () => {
  const container = buildPanel(["The following are the inputs that must be fulfilled.", "Rocket Launcher x3"]);
  installGlobals({ c0: container });

  await showFabricatorMultiBuy();
  await flush();

  const block = findBlock(container);
  assert.ok(block);
  assert.match(block.children[0].href, /items%5B%5D=Rocket\+Launcher.*qty%5B%5D=3/);
});

// --- scope gating: Specialized/Professional Killstreak Kit Fabricators only -
// This feature must NOT show for every item that happens to use the same
// "inputs that must be fulfilled" mechanic - only for a
// Specialized/Professional Killstreak Kit Fabricator specifically.

test("does not show for a Strangifier Chemistry Set, even though it has the exact same fulfillment heading", async () => {
  const container = buildPanel(["The following are the inputs that must be fulfilled.", "Rocket Launcher x3"], {
    title: "Professor Speks Strangifier Chemistry Set Series #2",
  });
  installGlobals({ c0: container });

  await showFabricatorMultiBuy();
  await flush();

  assert.equal(findBlock(container), null);
});

test("does not show for a Basic-tier Killstreak Kit Fabricator (no Specialized/Professional prefix)", async () => {
  const container = buildPanel(["The following are the inputs that must be fulfilled.", "Reclaimed Metal x2"], {
    title: "Killstreak Wrench Kit Fabricator",
  });
  installGlobals({ c0: container });

  await showFabricatorMultiBuy();
  await flush();

  assert.equal(findBlock(container), null);
});

test("shows for both a Specialized and a Professional Killstreak Kit Fabricator", async () => {
  for (const prefix of ["Specialized", "Professional"]) {
    const container = buildPanel(["The following are the inputs that must be fulfilled.", "Reclaimed Metal x2"], {
      title: `${prefix} Killstreak Wrench Kit Fabricator`,
    });
    installGlobals({ c0: container });

    await showFabricatorMultiBuy();
    await flush();

    assert.ok(findBlock(container), `expected a button for a ${prefix} Killstreak Kit Fabricator`);
  }
});

test("removes a stale block when re-selecting a non-qualifying item after a qualifying one", async () => {
  const container = buildPanel(["The following are the inputs that must be fulfilled.", "Reclaimed Metal x2"]);
  installGlobals({ c0: container });
  await showFabricatorMultiBuy();
  await flush();
  assert.ok(findBlock(container));

  // Simulate Steam re-rendering the same container for a non-qualifying item.
  container.children = container.children.filter((c) => c.tagName === "h1");
  container.children[0].textContent = "Professor Speks Strangifier Chemistry Set Series #2";
  container.appendChild(leaf("div", "The following are the inputs that must be fulfilled."));
  container.appendChild(leaf("div", "Rocket Launcher x3"));

  await showFabricatorMultiBuy();
  await flush();

  assert.equal(findBlock(container), null);
});

test("stops at the first non-matching line, not just anywhere in the panel", async () => {
  const container = buildPanel([
    "The following are the inputs that must be fulfilled.",
    "Reclaimed Metal x2",
    "Some unrelated notice line",
    "Scrap Metal x5", // must NOT be picked up - the run already broke above
  ]);
  installGlobals({ c0: container });

  await showFabricatorMultiBuy();
  await flush();

  const href = findBlock(container).children[0].href;
  assert.match(href, /Reclaimed\+Metal/);
  assert.doesNotMatch(href, /Scrap\+Metal/);
});

// --- generic ("Unique Killstreak Item") input handling ---------------------
// REGRESSION guard for a real live bug: a Kit Fabricator's own input list
// (confirmed live via a real "Specialized Killstreak Vita-Saw Kit
// Fabricator") can include "Unique Killstreak Item x 1" - a generic
// crafting-component CATEGORY (any Unique-quality Killstreak weapon, any
// class), not one specific tradable item. Passing that literal text into
// Steam's own multibuy URL broke the total for the WHOLE request, not just
// that one line. This is now resolved automatically to the cheapest
// currently-listed match and folded into the same purchase, falling back to a
// manual "search it yourself" note only if that resolve attempt fails.
//
// This went through THREE resolution approaches before landing here (see
// extractCheapestValidNameFromSearchHtml's own note in content.js for the
// full history) - the current one reads the search page's own confirmed-live
// current markup: real result rows are plain "<span>ItemName</span>" text
// with no href at all, styled via unstable, auto-generated hashed CSS class
// names this deliberately does NOT key off of.

function searchResultHtml(names) {
  // Each name becomes its own leaf span, same shape as a real result row's
  // own name span (confirmed live via a pasted DOM snippet) - other
  // surrounding page furniture (a price, a "Level X" line, a page heading)
  // is deliberately NOT modeled here; looksLikeAValidKillstreakWeaponMatch
  // is what actually has to tell those apart on the real page, and that's
  // covered by its own dedicated tests below.
  return names.map((name) => `<span class="h9k0m4mdzeY-">${name}</span>`).join("");
}

function fetchImplFor({ searchHtml = "", multibuyHtml = "" } = {}) {
  return async (url) => {
    if (url.includes("/market/search")) return { ok: true, text: async () => searchHtml };
    return { ok: true, text: async () => multibuyHtml };
  };
}

// Same tier-specific patterns content.js's own GENERIC_INPUT_CONFIGS uses -
// "Unique Killstreak Item" (a Specialized-tier Kit's own ingredient) needs a
// Basic-tier match; "Unique Specialized Killstreak Item" (a Professional-tier
// Kit's own ingredient - added) needs a Specialized-tier one - each is
// deliberately tier-SPECIFIC, not a shared "any Killstreak tier" check, so a
// wrong-tier substitution can never slip through.
const BASIC_TIER_PATTERN = /^(?:Non-Craftable )?Killstreak\b/i;
const SPECIALIZED_TIER_PATTERN = /^(?:Non-Craftable )?Specialized Killstreak\b/i;

// extractValidNamesFromSearchHtml - pure, no fetch/DOM needed. Most of these
// only need the single cheapest match, so they ask for count=1 and unwrap it.
function pickCheapest(html, namePattern) {
  return extractValidNamesFromSearchHtml(html, namePattern, 1)[0] ?? null;
}

test("extractValidNamesFromSearchHtml picks the first valid span text, ignoring surrounding page text", () => {
  const html = `<span class="x">Level 1 Bonesaw</span><span class="y">Killstreak Bonesaw</span><span class="z">From €0.46</span>`;
  assert.equal(pickCheapest(html, BASIC_TIER_PATTERN), "Killstreak Bonesaw");
});

test("each tier's own pattern accepts only that exact tier, rejecting the other two", () => {
  const names = ["Killstreak Wrench", "Specialized Killstreak Wrench", "Professional Killstreak Wrench"];
  const html = searchResultHtml(names);

  assert.equal(pickCheapest(html, BASIC_TIER_PATTERN), "Killstreak Wrench");
  assert.equal(pickCheapest(html, SPECIALIZED_TIER_PATTERN), "Specialized Killstreak Wrench");
  // No config exists yet for a Professional-tier generic category, but the
  // pattern shape itself should still discriminate correctly if one is ever
  // added.
  assert.equal(pickCheapest(html, /^(?:Non-Craftable )?Professional Killstreak\b/i), "Professional Killstreak Wrench");
});

// REGRESSION guard for a real live bug: a resolve attempt returned the
// CURRENTLY-SELECTED Fabricator's own name ("Specialized Killstreak
// Scotsman's Skullcutter Kit Fabricator") instead of a real weapon - the
// multibuy URL ended up trying to buy the Fabricator itself.
test("never picks a Fabricator/Kit/tool name, even if it sorts before a real weapon result", () => {
  const html = searchResultHtml(["Specialized Killstreak Scotsman's Skullcutter Kit Fabricator", "Killstreak Wrench"]);
  assert.equal(pickCheapest(html, BASIC_TIER_PATTERN), "Killstreak Wrench");
});

test("rejects a standalone Killstreak Kit result too, not just Fabricators", () => {
  const html = searchResultHtml(["Professional Killstreak Kit", "Killstreak Shovel"]);
  assert.equal(pickCheapest(html, BASIC_TIER_PATTERN), "Killstreak Shovel");
});

// REGRESSION guard: a bare ".includes('killstreak')" check would have
// wrongly accepted unrelated page text merely mentioning the search term
// (a heading, "results for..." text) - the real check anchors on the START
// of the candidate's own name instead.
test("rejects text that only mentions 'killstreak' in passing, rather than being a weapon's own name", () => {
  const html = searchResultHtml(["Results for 'killstreak'", "Killstreak Shovel"]);
  assert.equal(pickCheapest(html, BASIC_TIER_PATTERN), "Killstreak Shovel");
});

test("returns an empty array when nothing on the page validates", () => {
  assert.deepEqual(extractValidNamesFromSearchHtml(searchResultHtml(["Some Random Weapon"]), BASIC_TIER_PATTERN, 1), []);
  assert.deepEqual(extractValidNamesFromSearchHtml("", BASIC_TIER_PATTERN, 1), []);
  // A Basic-tier result must not satisfy the Specialized-tier category.
  assert.deepEqual(extractValidNamesFromSearchHtml(searchResultHtml(["Killstreak Wrench"]), SPECIALIZED_TIER_PATTERN, 1), []);
});

// REGRESSION guard for the multi-unit pricing concern: a second unit of the
// SAME item consumes that item's own next-cheapest listing (likely pricier,
// not a repeat of the first price) - resolving to count DISTINCT items
// instead avoids ever needing to know that price at all. Also confirms
// deduplication (the same name never appears twice, even if it showed up
// twice in the raw page text).
test("extractValidNamesFromSearchHtml returns up to `count` DISTINCT names, cheapest-first, not repeats of one", () => {
  const html = searchResultHtml(["Killstreak Wrench", "Killstreak Wrench", "Killstreak Bonesaw", "Killstreak Shovel"]);
  assert.deepEqual(extractValidNamesFromSearchHtml(html, BASIC_TIER_PATTERN, 2), ["Killstreak Wrench", "Killstreak Bonesaw"]);
});

test("extractValidNamesFromSearchHtml returns fewer than `count` when the page doesn't have enough distinct valid results", () => {
  const html = searchResultHtml(["Killstreak Wrench"]);
  assert.deepEqual(extractValidNamesFromSearchHtml(html, BASIC_TIER_PATTERN, 3), ["Killstreak Wrench"]);
});

test("resolves a generic 'Unique Killstreak Item' input to the cheapest listed match and includes it in the multibuy URL", async () => {
  const container = buildPanel([
    "The following are the inputs that must be fulfilled.",
    "Unique Killstreak Item x 1",
    "Battle-Worn Robot Taunt Processor x 16",
  ]);
  const searchUrls = [];
  installGlobals({
    c0: container,
    fetchImpl: async (url) => {
      if (url.includes("/market/search")) searchUrls.push(url);
      return fetchImplFor({ searchHtml: searchResultHtml(["Killstreak Wrench"]) })(url);
    },
  });

  await showFabricatorMultiBuy();
  await flush();

  const block = findBlock(container);
  const link = block.children[0];
  assert.doesNotMatch(link.href, /Unique\+Killstreak\+Item/);
  assert.match(link.href, /Killstreak\+Wrench/);
  assert.match(link.href, /Battle-Worn\+Robot\+Taunt\+Processor/);
  // The search itself must be sorted cheapest-first and scoped to all 3
  // weapon slots - confirmed live that melee-only missed a primary/
  // secondary Kit Fabricator's own needed match.
  assert.equal(searchUrls.length, 1);
  assert.match(searchUrls[0], /category_Quality=Unique/);
  assert.match(searchUrls[0], /category_Type=melee/);
  assert.match(searchUrls[0], /category_Type=primary/);
  assert.match(searchUrls[0], /category_Type=secondary/);
  assert.match(searchUrls[0], /q=killstreak/);
  assert.match(searchUrls[0], /sort=3&dir=1/);
  // Forced English regardless of the account's own display language - see
  // resolveCheapestGenericItem's own note on why a localized page would
  // otherwise silently match nothing at all.
  assert.match(searchUrls[0], /[?&]l=english\b/);
  // Flagged (name + its own search href) for showMultiBuyVerifyReminder's
  // own attention once the user actually lands on this URL - a named (real,
  // literal) input never needs this, only the auto-substituted one.
  const flaggedValue = new URL(link.href).searchParams.get("tf2te_verify");
  const [flaggedName, flaggedHref] = flaggedValue.split("::");
  assert.equal(flaggedName, "Killstreak Wrench");
  assert.match(flaggedHref, /category_Quality=Unique/);
  assert.match(flaggedHref, /q=killstreak/);
});

// A Professional Killstreak Kit Fabricator's own recipe needs a
// Specialized-tier weapon as its generic ingredient instead - same
// progression logic Specialized->Basic already has.
test("resolves a generic 'Unique Specialized Killstreak Item' input to the cheapest SPECIALIZED-tier match", async () => {
  const container = buildPanel(
    ["The following are the inputs that must be fulfilled.", "Unique Specialized Killstreak Item x 1", "Reclaimed Metal x2"],
    { title: "Professional Killstreak Test Weapon Kit Fabricator" }
  );
  const searchUrls = [];
  installGlobals({
    c0: container,
    fetchImpl: async (url) => {
      if (url.includes("/market/search")) searchUrls.push(url);
      return fetchImplFor({ searchHtml: searchResultHtml(["Specialized Killstreak Wrench"]) })(url);
    },
  });

  await showFabricatorMultiBuy();
  await flush();

  const link = findBlock(container).children[0];
  assert.doesNotMatch(link.href, /Unique\+Specialized\+Killstreak\+Item/);
  assert.match(link.href, /Specialized\+Killstreak\+Wrench/);
  assert.equal(searchUrls.length, 1);
  assert.match(searchUrls[0], /q=specialized\+killstreak/);
  assert.match(searchUrls[0], /category_Type=melee/);
  assert.match(searchUrls[0], /category_Type=primary/);
  assert.match(searchUrls[0], /category_Type=secondary/);
});

// Full-pipeline version of the "N distinct items instead of one item x N"
// fix - a real Fabricator could plausibly need 2+ units of a generic
// category, and the resulting multibuy URL must reflect 2 DIFFERENT items
// at quantity=1 each, not one item repeated at quantity=2.
test("needing 2 units of a generic input resolves to 2 DISTINCT items in the multibuy URL, not 1 item x2", async () => {
  const container = buildPanel(["The following are the inputs that must be fulfilled.", "Unique Killstreak Item x 2"]);
  installGlobals({
    c0: container,
    fetchImpl: fetchImplFor({ searchHtml: searchResultHtml(["Killstreak Wrench", "Killstreak Bonesaw", "Killstreak Shovel"]) }),
  });

  await showFabricatorMultiBuy();
  await flush();

  const link = findBlock(container).children[0];
  assert.match(link.href, /items%5B%5D=Killstreak\+Wrench&qty%5B%5D=1/);
  assert.match(link.href, /items%5B%5D=Killstreak\+Bonesaw&qty%5B%5D=1/);
  assert.doesNotMatch(link.href, /qty%5B%5D=2/);
});

// If the search doesn't have enough distinct valid results to cover the
// needed quantity, the shortfall is piled onto the cheapest one found
// (best effort) rather than left unresolved.
test("falls back to topping up the cheapest item's quantity when not enough distinct results exist", async () => {
  const container = buildPanel(["The following are the inputs that must be fulfilled.", "Unique Killstreak Item x 3"]);
  installGlobals({ c0: container, fetchImpl: fetchImplFor({ searchHtml: searchResultHtml(["Killstreak Wrench"]) }) });

  await showFabricatorMultiBuy();
  await flush();

  const link = findBlock(container).children[0];
  assert.match(link.href, /items%5B%5D=Killstreak\+Wrench&qty%5B%5D=3/);
});

// REGRESSION guard: the Specialized-tier category must never accept a
// Basic-tier result even if one happens to be the cheapest thing the search
// returns - each generic category's own tier match has to stay strict.
test("does not accept a Basic-tier result for the Specialized-tier generic category", async () => {
  const container = buildPanel(
    ["The following are the inputs that must be fulfilled.", "Unique Specialized Killstreak Item x 1"],
    { title: "Professional Killstreak Test Weapon Kit Fabricator" }
  );
  installGlobals({ c0: container, fetchImpl: fetchImplFor({ searchHtml: searchResultHtml(["Killstreak Wrench"]) }) });

  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    await showFabricatorMultiBuy();
    await flush();
  } finally {
    console.warn = originalWarn;
  }

  const block = findBlock(container);
  assert.equal(block.children.length, 1); // manual note only - the Basic-tier result was correctly rejected
  assert.ok(block.querySelectorAll(".tf2te-fabricator-manual-inputs")[0]);
});

// REGRESSION guard for a real live bug: the resolve fetch succeeded but
// found zero valid candidates (confirmed live via the extension's own
// console.warn) - most likely because the page rendered in a non-English
// display language, which looksLikeAValidKillstreakWeaponMatch's hardcoded
// English text could never match. This locks in the diagnostic error
// message (span/char counts) added so a NEXT such failure is debuggable
// from the console alone, without another live round-trip just to ask
// "was anything even found on the page at all?".
test("a resolve failure's own thrown message includes diagnostic counts, not just a generic 'not found'", async () => {
  const container = buildPanel(["The following are the inputs that must be fulfilled.", "Unique Killstreak Item x 1"]);
  const nonMatchingHtml = searchResultHtml(["Some Non-English Or Unrelated Text"]);
  installGlobals({ c0: container, fetchImpl: fetchImplFor({ searchHtml: nonMatchingHtml }) });

  const warnCalls = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnCalls.push(args);
  try {
    await showFabricatorMultiBuy();
    await flush();
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(warnCalls.length, 1);
  const loggedError = warnCalls[0].find((arg) => arg instanceof Error);
  assert.ok(loggedError);
  assert.match(loggedError.message, /1 plain-text spans/);
  assert.match(loggedError.message, new RegExp(`${nonMatchingHtml.length} chars total`));
});

test("shows a note explaining the auto-substitution, with a link to verify on Steam Market", async () => {
  const container = buildPanel(["The following are the inputs that must be fulfilled.", "Unique Killstreak Item x 1", "Reclaimed Metal x2"]);
  installGlobals({ c0: container, fetchImpl: fetchImplFor({ searchHtml: searchResultHtml(["Killstreak Wrench"]) }) });

  await showFabricatorMultiBuy();
  await flush();

  const block = findBlock(container);
  const note = block.querySelectorAll(".tf2te-fabricator-manual-inputs")[0];
  assert.ok(note);
  assert.match(note.textContent, /Unique Killstreak Item/);
  assert.match(note.textContent, /Killstreak Wrench/);
  const searchLink = note.querySelectorAll("a")[0];
  assert.match(searchLink.href, /category_Quality=Unique/);
  assert.match(searchLink.href, /category_Type=melee/);
  assert.match(searchLink.href, /category_Type=primary/);
  assert.match(searchLink.href, /category_Type=secondary/);
  assert.match(searchLink.href, /q=killstreak/);
});

test("falls back to a manual 'search it yourself' note when no listings are found for the generic input", async () => {
  const container = buildPanel(["The following are the inputs that must be fulfilled.", "Unique Killstreak Item x 1"]);
  installGlobals({ c0: container, fetchImpl: fetchImplFor() }); // default: no listings found

  const warnCalls = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnCalls.push(args);
  try {
    await showFabricatorMultiBuy();
    await flush();
  } finally {
    console.warn = originalWarn;
  }

  const block = findBlock(container);
  assert.ok(block);
  assert.equal(block.children.length, 1); // the manual note only, no button - nothing else was purchasable
  const note = block.querySelectorAll(".tf2te-fabricator-manual-inputs")[0];
  assert.ok(note);
  assert.match(note.textContent, /Couldn't automatically resolve/);
  assert.equal(warnCalls.length, 1);
});

test("still builds a button from the real parts alone when the generic input can't be resolved", async () => {
  const container = buildPanel([
    "The following are the inputs that must be fulfilled.",
    "Unique Killstreak Item x 1",
    "Reclaimed Metal x2",
  ]);
  installGlobals({ c0: container, fetchImpl: fetchImplFor() }); // no listings found for the generic search

  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    await showFabricatorMultiBuy();
    await flush();
  } finally {
    console.warn = originalWarn;
  }

  const block = findBlock(container);
  const link = block.children[0];
  assert.match(link.href, /Reclaimed\+Metal/);
  assert.doesNotMatch(link.href, /Unique\+Killstreak\+Item/);
});

// --- rebuild/dedup behavior -----------------------------------------------

test("does not rebuild for the same exact input set on a repeat call", async () => {
  const container = buildPanel(["The following are the inputs that must be fulfilled.", "Reclaimed Metal x2"]);
  let fetchCalls = 0;
  installGlobals({
    c0: container,
    fetchImpl: async () => {
      fetchCalls++;
      return { ok: true, text: async () => "" };
    },
  });

  await showFabricatorMultiBuy();
  await flush();
  await showFabricatorMultiBuy();
  await flush();

  // 2, not 1 - one call for the multibuy page's own total, one for the
  // finished Kit's own order-book lookup (see fetchEstimatedKitValue) - both
  // fire once on the FIRST call and must not double on the repeat call.
  assert.equal(fetchCalls, 2);
});

test("rebuilds when the required inputs change (a different fabricator selected)", async () => {
  const container = buildPanel(["The following are the inputs that must be fulfilled.", "Reclaimed Metal x2"]);
  installGlobals({ c0: container });
  await showFabricatorMultiBuy();
  await flush();
  const firstHref = findBlock(container).children[0].href;

  // Simulate Steam re-rendering the same container for a different item -
  // wipes everything but the title, same as a real re-render replacing the
  // whole panel's own inner content.
  container.children = container.children.filter((c) => c.tagName === "h1");
  container.appendChild(leaf("div", "The following are the inputs that must be fulfilled."));
  container.appendChild(leaf("div", "Scrap Metal x9"));

  await showFabricatorMultiBuy();
  await flush();
  const secondHref = findBlock(container).children[0].href;

  assert.notEqual(firstHref, secondHref);
  assert.match(secondHref, /Scrap\+Metal/);
});

test("REGRESSION: rebuilds for a different Fabricator that needs the exact same inputs", async () => {
  const container = buildPanel(["The following are the inputs that must be fulfilled.", "Reclaimed Metal x2"], {
    title: "Specialized Killstreak Rocket Launcher Kit Fabricator",
  });
  const fetchedUrls = [];
  installGlobals({
    c0: container,
    fetchImpl: async (url) => {
      fetchedUrls.push(String(url));
      return { ok: true, text: async () => "" };
    },
  });
  await showFabricatorMultiBuy();
  await flush();

  // Same inputs, different Fabricator: the value card must be for the new Kit.
  container.children[0].textContent = "Specialized Killstreak Scattergun Kit Fabricator";
  await showFabricatorMultiBuy();
  await flush();

  assert.ok(fetchedUrls.some((u) => u.includes(encodeURIComponent("Specialized Killstreak Scattergun Kit"))), fetchedUrls.join(", "));
});

// --- live total ------------------------------------------------------------

test("fills in the live total once the multibuy page fetch resolves", async () => {
  const container = buildPanel(["The following are the inputs that must be fulfilled.", "Reclaimed Metal x2"]);
  const html = `<input class="market_multi_price" data-nameid="55" value="$0.05">
    <input id="buy_55_qty" value="2">`;
  installGlobals({ c0: container, fetchImpl: async () => ({ ok: true, text: async () => html }) });

  await showFabricatorMultiBuy();
  await flush();

  assert.equal(findBlock(container).children[0].textContent, "Buy Parts ($0.10)");
});

test("shows 'price unavailable' when the multibuy fetch fails", async () => {
  const container = buildPanel(["The following are the inputs that must be fulfilled.", "Reclaimed Metal x2"]);
  installGlobals({ c0: container, fetchImpl: async () => ({ ok: false, status: 403, text: async () => "" }) });

  const warnCalls = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnCalls.push(args);
  try {
    await showFabricatorMultiBuy();
    await flush();
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(findBlock(container).children[0].textContent, "Buy Parts (price unavailable)");
  // 2, not 1 - the SAME failing fetchImpl also serves the finished Kit's own
  // order-book lookup (see fetchEstimatedKitValue), which warns separately.
  assert.equal(warnCalls.length, 2);
});

// Steam's fees (5% Steam + 10% game, each rounded down with a 1-cent
// minimum) are charged on top of what the seller receives, so a 1.15 buyer
// total leaves the seller 1.00 - not 1.15 * 0.85 = 0.98.
test("estimateSellerReceivesMinorUnits matches Steam's own fee rule", () => {
  assert.equal(estimateSellerReceivesMinorUnits(115), 100);
  assert.equal(estimateSellerReceivesMinorUnits(1150), 1000);
  assert.equal(estimateSellerReceivesMinorUnits(10000), 8697); // 8697 + 434 + 869 = 10000
  assert.equal(estimateSellerReceivesMinorUnits(3), 1); // the Market minimum: 1 + 1 + 1
  assert.equal(estimateSellerReceivesMinorUnits(2), 0); // can't even cover the minimum fees
});

// --- Estimated Kit Value on SCM (the finished Kit's own order book)
// -------/discussion: not labeled "Instant Sell" (the name of this
// extension's own unrelated inventoryMarketActions/content.js feature) - the
// Fabricator's finished Kit
// doesn't exist yet, so clicking through only opens its Steam Market listing
// to review, it can never actually list/sell anything the way Instant Sell
// does for an item you already own.

// Defaults multiBuyHtml to a VALID readable-price page (not "") - keeps the
// "Buy Parts" total resolving successfully in every test below, so only the
// thing each test is actually checking (the Kit's own order-book lookup)
// contributes to warnCalls/text assertions, not an unrelated Buy Parts
// failure too.
const VALID_MULTIBUY_HTML = `<input class="market_multi_price" data-nameid="1" value="$0.10">
  <input id="buy_1_qty" value="2">`;

// The finished Kit's own value lookup reads BOTH sides straight off the
// listing page's own rendered TEXT - no separate API call at all (confirmed
// live via the real page DOM, twice: the "Place an order" widget's
// own buy-order count/price, and a result card's own price immediately
// followed by a "Buy" button - see fetchKitOrderBook's own note on the two
// earlier, both confirmed-live-WRONG API-based approaches this replaced).
// buildListingHtml below mirrors the real shapes pasted live, trimmed to
// just what BUY_ORDER_TEXT_PATTERN/CHEAPEST_LISTING_PRICE_PATTERN need.
function buildListingHtml({ buyOrderText, cheapestPriceText } = {}) {
  return (
    "<html><body>" +
    (buyOrderText ? `<div><span class="h9k0m4mdzeY-">${buyOrderText}&nbsp;</span></div>` : "") +
    (cheapestPriceText
      ? `<span class="IokSIloSPlA-">${cheapestPriceText}</span><button type="button" data-accent-color="green">Buy</button>`
      : "") +
    "</body></html>"
  );
}

function fetchImplWithListingPage({ multiBuyHtml = VALID_MULTIBUY_HTML, listingHtml } = {}) {
  return async (url) => {
    const u = String(url);
    if (u.includes("/market/listings/")) return { ok: true, text: async () => listingHtml };
    return { ok: true, text: async () => multiBuyHtml };
  };
}

// After comparing an Artifact mockup: the old design put a second, same-styled BUTTON
// ("Estimated Kit Value on SCM") right next to Buy Parts, forcing the user to
// subtract two numbers themselves to answer the one question this feature exists for.
// Replaced with a single value card under Buy Parts: a profit/loss headline (see the
// dedicated "profit/loss headline" tests further below), the raw Buy Order/Sell
// Listing breakdown, and a plain "View listing" link (not a button, since clicking it
// doesn't submit anything the way Buy Parts does). valueCard.children = [headlineEl,
// breakdown, footer]; breakdown.children = [buyHalf, sellHalf]; footer.children =
// [estimateEl, viewLink].

test("shows the finished Kit's own estimated value, its raw order book, and a listing link - all inside the value card, separate from the Buy Parts button", async () => {
  const container = buildPanel(["The following are the inputs that must be fulfilled.", "Reclaimed Metal x2"]);
  installGlobals({
    c0: container,
    fetchImpl: fetchImplWithListingPage({
      listingHtml: buildListingHtml({ buyOrderText: "28 requests to buy at <!-- -->€1,27 or lower", cheapestPriceText: "€1.57" }),
    }),
  });

  await showFabricatorMultiBuy();
  await flush();

  const buttonRow = findBlock(container).children[0];
  assert.equal(buttonRow.tagName, "a"); // Buy Parts alone, no longer a row containing a second button

  const valueCard = findBlock(container).children[1];
  const [, breakdown, footer] = valueCard.children;
  const [buyHalf, sellHalf] = breakdown.children;
  assert.equal(buyHalf.children[1].textContent, "€1.27");
  assert.equal(sellHalf.children[1].textContent, "€1.57");

  const [estimateEl, viewLink] = footer.children;
  // €1,27 (comma-decimal, as actually rendered live) highest buy order.
  // The seller receives 111: 111 + 5 (5% Steam fee) + 11 (10% game fee) =
  // 127 -> "€1.11".
  assert.equal(estimateEl.textContent, "Estimated Kit Value on SCM (after Steam fees): €1.11");
  assert.equal(estimateEl.title, "Highest buy order €1.27, minus Steam's ~15% marketplace fee");
  assert.equal(viewLink.href, "https://steamcommunity.com/market/listings/440/Specialized%20Killstreak%20Test%20Weapon%20Kit");
});

// Steam's current Market UI renders the dynamic price value with an empty
// HTML comment immediately before it (a framework hydration-boundary marker)
// - BUY_ORDER_TEXT_PATTERN's own non-greedy "any character" capture swallowed
// it right along with the real price text.
test("strips a literal HTML comment Steam's own framework inserts right before the dynamic price text", async () => {
  const container = buildPanel(["The following are the inputs that must be fulfilled.", "Reclaimed Metal x2"]);
  installGlobals({
    c0: container,
    fetchImpl: fetchImplWithListingPage({
      listingHtml: buildListingHtml({
        buyOrderText: "45 requests to buy at <!-- -->€1,33 or lower",
        cheapestPriceText: "<!-- -->€1.56",
      }),
    }),
  });

  await showFabricatorMultiBuy();
  await flush();

  const [, breakdown, footer] = findBlock(container).children[1].children;
  const [buyHalf, sellHalf] = breakdown.children;
  assert.equal(buyHalf.children[1].textContent, "€1.33");
  assert.equal(sellHalf.children[1].textContent, "€1.56");
  assert.equal(footer.children[0].textContent, "Estimated Kit Value on SCM (after Steam fees): €1.17");
});

// Confirmed live: only the FIRST "requests to buy"/"price + Buy button"
// pairing in document order is read - a second, later occurrence elsewhere
// on the page (e.g. from a DIFFERENT, more expensive result card further
// down the sorted-cheapest-first grid) must not override it.
test("only reads the FIRST buy-order line and the FIRST price+Buy pairing in document order, not a later one", async () => {
  const container = buildPanel(["The following are the inputs that must be fulfilled.", "Reclaimed Metal x2"]);
  const listingHtml =
    buildListingHtml({ buyOrderText: "5 requests to buy at <!-- -->€1.00 or lower", cheapestPriceText: "€1.50" }) +
    buildListingHtml({ buyOrderText: "1 requests to buy at <!-- -->€0.50 or lower", cheapestPriceText: "€9.99" });
  installGlobals({ c0: container, fetchImpl: fetchImplWithListingPage({ listingHtml }) });

  await showFabricatorMultiBuy();
  await flush();

  const [, breakdown] = findBlock(container).children[1].children;
  const [buyHalf, sellHalf] = breakdown.children;
  assert.equal(buyHalf.children[1].textContent, "€1.00");
  assert.equal(sellHalf.children[1].textContent, "€1.50");
});

// The Kit's listing page comes back in the account's own Market sort
// (confirmed live), so with another sort the cheapest listing isn't on it.
// The card then shows Steam's own lowest price (priceoverview, in the wallet
// currency), with where it came from on hover; the buy side is unaffected.
function installOtherSortKitPage(container, priceOverview) {
  const listingHtml =
    buildListingHtml({ buyOrderText: "5 requests to buy at <!-- -->€1,32 or lower", cheapestPriceText: "€2.25" }) +
    buildListingHtml({ cheapestPriceText: "€1.80" });
  const requested = [];
  installGlobals({
    c0: container,
    fetchImpl: async (url) => {
      const u = String(url);
      if (u.includes("/market/priceoverview/")) {
        requested.push(new URL(u));
        return priceOverview;
      }
      if (u.includes("/market/listings/")) return { ok: true, text: async () => listingHtml };
      return { ok: true, text: async () => VALID_MULTIBUY_HTML };
    },
  });
  window.wrappedJSObject = { g_rgWalletInfo: { wallet_currency: 3 } };
  const store = {};
  globalThis.chrome = {
    storage: {
      local: {
        get: async (keys) => Object.fromEntries([].concat(keys).filter((k) => k in store).map((k) => [k, store[k]])),
        set: async (items) => Object.assign(store, items),
      },
    },
  };
  return requested;
}

test("REGRESSION: with the Market sorted another way, the Sell Listing is Steam's own lowest price, marked as such", async () => {
  const container = buildPanel(["The following are the inputs that must be fulfilled.", "Reclaimed Metal x2"]);
  const requested = installOtherSortKitPage(container, { ok: true, status: 200, json: async () => ({ success: true, lowest_price: "0,30€" }) });

  await showFabricatorMultiBuy();
  await flush();

  const [, breakdown] = findBlock(container).children[1].children;
  const [buyHalf, sellHalf] = breakdown.children;
  assert.equal(buyHalf.children[1].textContent, "€1.32");
  assert.equal(sellHalf.children[1].textContent, "0.30€ ⓘ");
  assert.match(sellHalf.children[1].title, /^Steam's own lowest price for this Kit/);
  assert.equal(requested.length, 1);
  assert.equal(requested[0].searchParams.get("currency"), "3"); // the wallet's own currency
  assert.equal(requested[0].searchParams.get("market_hash_name"), "Specialized Killstreak Test Weapon Kit");
});

test("with the Market sorted another way and Steam's own price unavailable, the Sell Listing is 'Unknown' with the reason on hover", async () => {
  const container = buildPanel(["The following are the inputs that must be fulfilled.", "Reclaimed Metal x2"]);
  installOtherSortKitPage(container, { ok: false, status: 500, json: async () => ({}) });

  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    await showFabricatorMultiBuy();
    await flush();
  } finally {
    console.warn = originalWarn;
  }

  const [, breakdown] = findBlock(container).children[1].children;
  const [, sellHalf] = breakdown.children;
  assert.equal(sellHalf.children[1].textContent, "Unknown ⓘ");
  assert.match(sellHalf.children[1].title, /isn't Price \(low to high\).*Set the sort back to Price \(low to high\)/);
});

test("shows 'no buy orders yet' (not a generic error) when the finished Kit has none, but still shows a real sell listing if one exists", async () => {
  const container = buildPanel(["The following are the inputs that must be fulfilled.", "Reclaimed Metal x2"]);
  installGlobals({
    c0: container,
    fetchImpl: fetchImplWithListingPage({ listingHtml: buildListingHtml({ cheapestPriceText: "€1.57" }) }),
  });

  const warnCalls = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnCalls.push(args);
  try {
    await showFabricatorMultiBuy();
    await flush();
  } finally {
    console.warn = originalWarn;
  }

  const [, breakdown, footer] = findBlock(container).children[1].children;
  assert.equal(footer.children[0].textContent, "Estimated Kit Value on SCM (after Steam fees): no buy orders yet");
  assert.equal(warnCalls.length, 0);

  const [buyHalf, sellHalf] = breakdown.children;
  assert.equal(buyHalf.children[1].textContent, "None");
  assert.equal(sellHalf.children[1].textContent, "€1.57");
});

test("shows 'no buy orders yet' and 'None' for the sell side too when the finished Kit's listing page has neither text at all", async () => {
  const container = buildPanel(["The following are the inputs that must be fulfilled.", "Reclaimed Metal x2"]);
  installGlobals({ c0: container, fetchImpl: fetchImplWithListingPage({ listingHtml: buildListingHtml({}) }) });

  await showFabricatorMultiBuy();
  await flush();

  const [, breakdown, footer] = findBlock(container).children[1].children;
  assert.equal(footer.children[0].textContent, "Estimated Kit Value on SCM (after Steam fees): no buy orders yet");

  const [buyHalf, sellHalf] = breakdown.children;
  assert.equal(buyHalf.children[1].textContent, "None");
  assert.equal(sellHalf.children[1].textContent, "None");
});

test("shows 'unavailable' on both halves and warns once on a genuine HTTP failure fetching the Kit's own listing page", async () => {
  const container = buildPanel(["The following are the inputs that must be fulfilled.", "Reclaimed Metal x2"]);
  installGlobals({
    c0: container,
    fetchImpl: async (url) => {
      const u = String(url);
      if (u.includes("/market/listings/")) return { ok: false, status: 500 };
      return { ok: true, text: async () => VALID_MULTIBUY_HTML };
    },
  });

  const warnCalls = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnCalls.push(args);
  try {
    await showFabricatorMultiBuy();
    await flush();
  } finally {
    console.warn = originalWarn;
  }

  const [, breakdown, footer] = findBlock(container).children[1].children;
  assert.equal(footer.children[0].textContent, "Estimated Kit Value on SCM (after Steam fees): unavailable");
  assert.equal(warnCalls.length, 1);

  const [buyHalf, sellHalf] = breakdown.children;
  assert.equal(buyHalf.children[1].textContent, "unavailable");
  assert.equal(sellHalf.children[1].textContent, "unavailable");
});

// --- profit/loss headline (the actual question this feature answers) ------

test("headline shows a red loss when Buy Parts costs more than the estimated Kit value", async () => {
  const container = buildPanel(["The following are the inputs that must be fulfilled.", "Reclaimed Metal x2"]);
  installGlobals({
    c0: container,
    fetchImpl: fetchImplWithListingPage({
      multiBuyHtml: `<input class="market_multi_price" data-nameid="1" value="€1.81"><input id="buy_1_qty" value="1">`,
      listingHtml: buildListingHtml({ buyOrderText: "28 requests to buy at <!-- -->€1.33 or lower", cheapestPriceText: "€1.57" }),
    }),
  });

  await showFabricatorMultiBuy();
  await flush();

  const headlineEl = findBlock(container).children[1].children[0];
  // Kit value: a 133 buyer total leaves the seller 117 (117 + 5 + 11 =
  // 133) -> €1.17. Parts cost €1.81. Loss = 1.81 - 1.17 = 0.64.
  assert.equal(headlineEl.textContent, "▼ Crafting this would lose ~€0.64 (after Steam fees)");
  assert.equal(headlineEl.title, "Kit value after Steam fees €1.17 minus Buy Parts total €1.81");
});

test("headline shows a green profit when the estimated Kit value exceeds the Buy Parts cost", async () => {
  const container = buildPanel(["The following are the inputs that must be fulfilled.", "Reclaimed Metal x2"]);
  installGlobals({
    c0: container,
    fetchImpl: fetchImplWithListingPage({
      multiBuyHtml: `<input class="market_multi_price" data-nameid="1" value="€1.00"><input id="buy_1_qty" value="1">`,
      listingHtml: buildListingHtml({ buyOrderText: "10 requests to buy at <!-- -->€2.00 or lower", cheapestPriceText: "€2.50" }),
    }),
  });

  await showFabricatorMultiBuy();
  await flush();

  const headlineEl = findBlock(container).children[1].children[0];
  // Kit value: a 200 buyer total leaves the seller 175 (175 + 8 + 17 =
  // 200) -> €1.75. Parts cost €1.00. Profit = 1.75 - 1.00 = 0.75.
  assert.equal(headlineEl.textContent, "▲ Crafting this would profit ~€0.75 (after Steam fees)");
});

test("headline shows a neutral message (not a profit/loss guess) when either side couldn't be resolved", async () => {
  const container = buildPanel(["The following are the inputs that must be fulfilled.", "Reclaimed Metal x2"]);
  installGlobals({
    c0: container,
    fetchImpl: async (url) => {
      const u = String(url);
      if (u.includes("/market/listings/")) return { ok: false, status: 500 };
      return { ok: false, status: 500 };
    },
  });

  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    await showFabricatorMultiBuy();
    await flush();
  } finally {
    console.warn = originalWarn;
  }

  const headlineEl = findBlock(container).children[1].children[0];
  assert.equal(headlineEl.textContent, "Not enough data to estimate profit");
});

test("derives the finished Kit's own name by stripping just the trailing ' Fabricator' word - Steam's own title already includes 'Killstreak', unlike scrap.tf's raw text", async () => {
  const container = buildPanel(["The following are the inputs that must be fulfilled.", "Reclaimed Metal x2"], {
    title: "Professional Killstreak Minigun Kit Fabricator",
  });
  installGlobals({
    c0: container,
    fetchImpl: fetchImplWithListingPage({ listingHtml: buildListingHtml({}) }),
  });

  await showFabricatorMultiBuy();
  await flush();

  const footer = findBlock(container).children[1].children[2];
  const viewLink = footer.children[1];
  assert.equal(viewLink.href, "https://steamcommunity.com/market/listings/440/Professional%20Killstreak%20Minigun%20Kit");
});

// --- parseMultiBuyTotalHtml (pure, no fetch/DOM) ---------------------------

test("parseMultiBuyTotalHtml sums price x quantity across multiple rows, keeping the page's own currency notation", () => {
  const html = `
    <input class="market_multi_price" data-nameid="1" value="$0.05">
    <input id="buy_1_qty" value="2">
    <input class="market_multi_price" data-nameid="2" value="$1.25">
    <input id="buy_2_qty" value="1">
  `;
  assert.equal(parseMultiBuyTotalHtml(html), "$1.35");
});

test("parseMultiBuyTotalHtml handles a comma-decimal European-style price", () => {
  const html = `
    <input class="market_multi_price" data-nameid="1" value="1,25€">
    <input id="buy_1_qty" value="4">
  `;
  assert.equal(parseMultiBuyTotalHtml(html), "5.00€");
});

test("parseMultiBuyTotalHtml skips a row whose quantity input is missing or zero", () => {
  const html = `
    <input class="market_multi_price" data-nameid="1" value="$0.05">
    <input id="buy_1_qty" value="0">
    <input class="market_multi_price" data-nameid="2" value="$2.00">
    <input id="buy_2_qty" value="3">
  `;
  assert.equal(parseMultiBuyTotalHtml(html), "$6.00");
});

test("parseMultiBuyTotalHtml returns null when no price fields are present at all", () => {
  assert.equal(parseMultiBuyTotalHtml("<html><body>Sign in required</body></html>"), null);
});

// --- showMultiBuyVerifyReminder (runs on Steam's own market/multibuy PAGE,
// not the inventory item panel) --------------------------------------------
// - once the user lands on the actual checkout page, any row that was
// auto-substituted for a generic crafting requirement gets flagged right
// there, not just back on the originating inventory panel. Row markup below
// mirrors the real page DOM from a real multibuy page (both a
// Specialized- and a Basic-tier Killstreak row).

function buildMultiBuyRow(name) {
  const row = new FakeElement("tr");
  row.appendChild(new FakeElement("td")); // qty cell - not touched by this feature
  const nameCell = new FakeElement("td");
  const wrapperDiv = new FakeElement("div");
  const nameLink = new FakeElement("a");
  nameLink.className = "market_listing_item_name_link";
  nameLink.textContent = name;
  wrapperDiv.appendChild(nameLink);
  nameCell.appendChild(wrapperDiv);
  row.appendChild(nameCell);
  return row;
}

function buildMultiBuyPage(names) {
  const tbody = new FakeElement("tbody");
  for (const name of names) tbody.appendChild(buildMultiBuyRow(name));
  return tbody;
}

function installMultiBuyPageGlobals(search, page) {
  globalThis.window = { location: { search } };
  globalThis.document = {
    querySelectorAll: (sel) => page.querySelectorAll(sel),
    createElement: (tag) => new FakeElement(tag),
  };
}

function findNotice(row) {
  return row.querySelectorAll("div").find((d) => d.textContent.includes("Auto-selected"));
}

test("does nothing when the URL has no tf2te_verify param at all", () => {
  const page = buildMultiBuyPage(["Killstreak Wrench", "Reclaimed Metal"]);
  installMultiBuyPageGlobals("?appid=440&items%5B%5D=Killstreak+Wrench&qty%5B%5D=1", page);

  assert.doesNotThrow(() => showMultiBuyVerifyReminder());

  for (const row of page.children) assert.equal(findNotice(row), undefined);
});

test("flags exactly the row(s) named in tf2te_verify, leaving other rows untouched", () => {
  const page = buildMultiBuyPage(["Battle-Worn Robot Money Furnace", "Killstreak Wrench"]);
  installMultiBuyPageGlobals("?tf2te_verify=" + encodeURIComponent("Killstreak Wrench::https://steamcommunity.com/market/search?q=killstreak"), page);

  showMultiBuyVerifyReminder();

  const [partRow, weaponRow] = page.children;
  assert.equal(findNotice(partRow), undefined);
  const notice = findNotice(weaponRow);
  assert.ok(notice);
  assert.match(notice.textContent, /before completing checkout/i);
  assert.equal(weaponRow.style.outline, "2px solid #e4b74e");

  // The filtered search link this item was originally resolved from rides
  // along too, so the user can compare other listings without rebuilding it.
  const searchLink = notice.querySelectorAll("a")[0];
  assert.ok(searchLink);
  assert.match(searchLink.href, /q=killstreak/);
});

test("flags multiple distinct rows when tf2te_verify lists more than one name", () => {
  const page = buildMultiBuyPage(["Specialized Killstreak Wrench", "Killstreak Bonesaw", "Reclaimed Metal"]);
  const flagged = [
    "Specialized Killstreak Wrench::https://steamcommunity.com/market/search?q=specialized+killstreak",
    "Killstreak Bonesaw::https://steamcommunity.com/market/search?q=killstreak",
  ].join("|");
  installMultiBuyPageGlobals("?tf2te_verify=" + encodeURIComponent(flagged), page);

  showMultiBuyVerifyReminder();

  const [row1, row2, row3] = page.children;
  assert.ok(findNotice(row1));
  assert.ok(findNotice(row2));
  assert.equal(findNotice(row3), undefined);
});

test("is idempotent - running twice on the same page doesn't double-flag a row", () => {
  const page = buildMultiBuyPage(["Killstreak Wrench"]);
  installMultiBuyPageGlobals("?tf2te_verify=" + encodeURIComponent("Killstreak Wrench::https://steamcommunity.com/market/search?q=killstreak"), page);

  showMultiBuyVerifyReminder();
  showMultiBuyVerifyReminder();

  const row = page.children[0];
  const notices = row.querySelectorAll("div").filter((d) => d.textContent.includes("Auto-selected"));
  assert.equal(notices.length, 1);
});

// Confirmed live: a multibuy row shows the cheapest listing's own custom
// (Name Tag) name, not its market name, so the flagged "Killstreak Bottle"
// row read ''Aye, me bottle o' scrumpy!'' and was never flagged.
function buildNameTaggedRow(displayName, marketName) {
  const row = buildMultiBuyRow(displayName);
  const nameLink = row.querySelectorAll(".market_listing_item_name_link")[0];
  if (marketName) nameLink.setAttribute("href", `https://steamcommunity.com/market/listings/440/${encodeURIComponent(marketName)}`);
  return row;
}

const BOTTLE_VERIFY = "?tf2te_verify=" + encodeURIComponent("Killstreak Bottle::https://steamcommunity.com/market/search?q=killstreak");

test("REGRESSION: flags a name-tagged row by its listing link when the visible text is the custom name", () => {
  const page = new FakeElement("tbody");
  page.appendChild(buildMultiBuyRow("Battle-Worn Robot Taunt Processor"));
  page.appendChild(buildNameTaggedRow("''Aye, me bottle o' scrumpy!''", "Killstreak Bottle"));
  installMultiBuyPageGlobals(BOTTLE_VERIFY, page);

  showMultiBuyVerifyReminder();

  const [partRow, bottleRow] = page.children;
  assert.equal(findNotice(partRow), undefined);
  assert.ok(findNotice(bottleRow));
});

test("REGRESSION: falls back to the row's position in items[] when the link carries no listing URL", () => {
  const page = new FakeElement("tbody");
  page.appendChild(buildMultiBuyRow("Battle-Worn Robot Taunt Processor"));
  page.appendChild(buildNameTaggedRow("''Aye, me bottle o' scrumpy!''", null));
  const search =
    BOTTLE_VERIFY +
    "&items%5B%5D=" + encodeURIComponent("Battle-Worn Robot Taunt Processor") +
    "&items%5B%5D=" + encodeURIComponent("Killstreak Bottle");
  installMultiBuyPageGlobals(search, page);

  showMultiBuyVerifyReminder();

  const [partRow, bottleRow] = page.children;
  assert.equal(findNotice(partRow), undefined);
  assert.ok(findNotice(bottleRow));
});

test("does not guess by position when the row count doesn't match items[], and warns instead", (t) => {
  const page = new FakeElement("tbody");
  page.appendChild(buildNameTaggedRow("''Aye, me bottle o' scrumpy!''", null));
  const search =
    BOTTLE_VERIFY +
    "&items%5B%5D=" + encodeURIComponent("Battle-Worn Robot Taunt Processor") +
    "&items%5B%5D=" + encodeURIComponent("Killstreak Bottle");
  installMultiBuyPageGlobals(search, page);
  const warn = t.mock.method(console, "warn", () => {});

  showMultiBuyVerifyReminder();

  assert.equal(findNotice(page.children[0]), undefined);
  assert.equal(warn.mock.callCount(), 1);
  assert.match(warn.mock.calls[0].arguments[0], /killstreak bottle/);
});
