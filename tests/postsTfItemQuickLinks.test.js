import { test, mock } from "node:test";
import assert from "node:assert/strict";

// Same "pre-seeded schema cache installed before import" pattern
// tests/manncoStoreItemQuickLinks.test.js's own header comment documents in
// full - utils/tf2Schema.js memoizes its result at module scope for this
// file's whole lifetime. Kept mostly empty: this feature's own confirmed-live
// effect id comes straight off the modal's own DOM (findEffectId), needing
// no schema lookup at all - see content.js's own header note.
globalThis.chrome = {
  storage: {
    local: {
      async get() {
        return {
          ...(savedSteamApiKey ? { steamApiKey: savedSteamApiKey } : {}),
          ...(sheenKillstreakerFilterOff ? { sheenKillstreakerFilterEnabled: false } : {}),
          tf2SchemaCache: {
            itemNameToDefindex: {},
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
    getURL: (path) => path,
    // Routes pricedb.io's own /api/search - the only network call this
    // feature ever makes (no Steam Web API key needed for any of the rest,
    // per content.js's own header note).
    async sendMessage(msg) {
      const url = new URL(msg.url);
      if (!url.hostname.includes("pricedb.io")) {
        throw new Error(`unexpected sendMessage: ${msg.url}`);
      }
      if (pricedbDelayMs) await new Promise((resolve) => setTimeout(resolve, pricedbDelayMs));
      if (pricedbRateLimited) return { ok: false, status: 429, error: "Rate limited (429)", retryAfterMs: pricedbRetryAfterMs };
      const q = url.searchParams.get("q");
      lastPricedbQuery = q;
      return {
        ok: true,
        data: { success: true, data: { query: q, results: pricedbSku ? [{ name: q, sku: pricedbSku }] : [], total: pricedbSku ? 1 : 0 } },
      };
    },
  },
};
globalThis.fetch = async () => ({ json: async () => [] });

let lastPricedbQuery = null;
let pricedbDelayMs = 0;
let pricedbSku = "205;6";
let pricedbRateLimited = false;
let pricedbRetryAfterMs;
// Whether a Steam Web API key is "saved" (the effect key button reads it).
let savedSteamApiKey = null;
// The popup's Sheen/Killstreaker filtering toggle, switched off.
let sheenKillstreakerFilterOff = false;

const { itemQuickLinks } = await import("../posts.tf/itemQuickLinks/content.js");
const { __resetPricedbCacheForTests } = await import("../utils/pricedb.js");
const { __resetSchemaCacheForTests } = await import("../utils/tf2Schema.js");

// Same hand-rolled fake DOM every other quick-links test file in this repo
// already uses, extended with a `[attr*="value"]` attribute-substring
// matcher (needed for this file's own `[style*="background"]` effect-image
// selector) - same extension tests/addMarketplaceButton.test.js's own copy
// already has for a different selector.
function parseCompound(selector) {
  const attrSubMatch = /\[([\w-]+)\*="([^"]*)"\]/.exec(selector);
  // Bare attribute-existence selector (e.g. "[data-tf2te-pricedb-slot]", no
  // "*=value") - only checked when attrSubMatch itself didn't already match,
  // since both regexes can otherwise match the same bracketed text.
  const attrExistsMatch = !attrSubMatch && /\[([\w-]+)\]/.exec(selector);
  const rest = selector.replace(/\[[^\]]*\]/g, "");
  const classes = [...rest.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
  const tagMatch = /^[a-zA-Z][\w-]*/.exec(rest);
  return {
    tag: tagMatch ? tagMatch[0].toLowerCase() : null,
    classes,
    attrSub: attrSubMatch ? { name: attrSubMatch[1], value: attrSubMatch[2] } : null,
    attrExists: attrExistsMatch ? attrExistsMatch[1] : null,
  };
}

function matchesCompound(el, parsed) {
  if (!el || el.nodeType !== 1) return false;
  if (parsed.tag && el.tagName.toLowerCase() !== parsed.tag) return false;
  if (!parsed.classes.every((c) => el.classList.contains(c))) return false;
  if (parsed.attrSub) {
    const v = el.getAttribute(parsed.attrSub.name);
    if (!v || !v.includes(parsed.attrSub.value)) return false;
  }
  if (parsed.attrExists && el.getAttribute(parsed.attrExists) == null) return false;
  return true;
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.nodeType = 1;
    this.parentElement = null;
    this.children = [];
    this._attrs = {};
    this.dataset = {};
    this._textContent = "";
    this._className = "";
    this.style = {};
    this.isConnected = true;
    const classSet = new Set();
    this.classList = {
      contains: (c) => classSet.has(c),
      add: (...cs) => cs.forEach((c) => classSet.add(c)),
      remove: (...cs) => cs.forEach((c) => classSet.delete(c)),
    };
  }
  get textContent() {
    if (this.children.length > 0) return this.children.map((c) => c.textContent || "").join("");
    return this._textContent;
  }
  set textContent(v) {
    this._textContent = v;
  }
  get className() {
    return this._className;
  }
  set className(v) {
    this._className = v;
    (v || "").split(/\s+/).filter(Boolean).forEach((c) => this.classList.add(c));
  }
  getAttribute(name) {
    return name in this._attrs ? this._attrs[name] : null;
  }
  setAttribute(name, value) {
    this._attrs[name] = value;
  }
  // Standard DOM methods the link-state buttons (utils/linkButtonStates.js)
  // rely on: the key hint and the pricedb.io countdown.
  removeAttribute(name) {
    delete this._attrs[name];
  }
  addEventListener(type, cb) {
    ((this._listeners ||= {})[type] ||= []).push(cb);
  }
  dispatchEvent(evt) {
    for (const cb of this._listeners?.[evt.type] || []) cb({ currentTarget: this, preventDefault() {}, stopPropagation() {}, ...evt });
    return true;
  }
  prepend(el) {
    this.children.unshift(el);
    el.parentElement = this;
  }
  appendChild(child) {
    this.children.push(child);
    child.parentElement = this;
    return child;
  }
  // Real DOM's Element.append() accepts a mix of strings (wrapped as text
  // nodes) and elements - needed for buildApiKeyWarning's own
  // warning.append("text", link, "more text") call.
  append(...nodes) {
    nodes.forEach((n) => {
      if (typeof n === "string") {
        this.children.push({ nodeType: 3, textContent: n, children: [], parentElement: this });
      } else {
        this.appendChild(n);
      }
    });
  }
  insertAdjacentElement(position, el) {
    if (position !== "afterend") throw new Error(`unsupported position: ${position}`);
    if (!this.parentElement) throw new Error("insertAdjacentElement: no parentElement");
    const siblings = this.parentElement.children;
    const idx = siblings.indexOf(this);
    siblings.splice(idx + 1, 0, el);
    el.parentElement = this.parentElement;
    return el;
  }
  replaceWith(el) {
    if (!this.parentElement) throw new Error("replaceWith: no parentElement");
    const siblings = this.parentElement.children;
    const idx = siblings.indexOf(this);
    siblings.splice(idx, 1, el);
    el.parentElement = this.parentElement;
    this.parentElement = null;
    return el;
  }
  remove() {
    if (!this.parentElement) return;
    const siblings = this.parentElement.children;
    const idx = siblings.indexOf(this);
    if (idx !== -1) siblings.splice(idx, 1);
    this.parentElement = null;
  }
  querySelectorAll(selector) {
    const parsed = parseCompound(selector);
    const out = [];
    const walk = (el) => {
      for (const child of el.children) {
        if (matchesCompound(child, parsed)) out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
}

function makeDocument(rootChildren = []) {
  const body = new FakeElement("body");
  const head = new FakeElement("head");
  for (const c of rootChildren) body.appendChild(c);
  return {
    body,
    head,
    createElement: (tag) => new FakeElement(tag),
    createElementNS: (_ns, tag) => new FakeElement(tag),
    getElementById: (id) => body.querySelectorAll(`#${id}`)[0] || head.querySelectorAll(`#${id}`)[0] || null,
    querySelectorAll: (selector) => body.querySelectorAll(selector),
    querySelector: (selector) => body.querySelector(selector),
  };
}

class FakeMutationObserver {
  constructor(cb) {
    this.cb = cb;
    FakeMutationObserver.instances.push(this);
  }
  observe(target, opts) {
    this.target = target;
    this.opts = opts;
  }
  disconnect() {}
}
FakeMutationObserver.instances = [];

const realSetTimeout = setTimeout;
async function flush(ticks = 8) {
  for (let i = 0; i < ticks; i++) await new Promise((resolve) => realSetTimeout(resolve, 0));
}

function installGlobals({ sku = "205;6", rateLimited = false, delayMs = 0 } = {}) {
  global.window = { location: { href: "https://posts.tf/" } };
  global.Node = { ELEMENT_NODE: 1 };
  global.MutationObserver = FakeMutationObserver;
  FakeMutationObserver.instances = [];
  lastPricedbQuery = null;
  pricedbSku = sku;
  pricedbRateLimited = rateLimited;
  pricedbDelayMs = delayMs;
  __resetPricedbCacheForTests();
}

// Confirmed live shape (see content.js's own header note): ".post-item-modal"
// holding an <h5> title, an optional effect-preview div (Unusual only), a
// "Quality" <strong>/<span> pair, and the native action-button row our own
// row is inserted right after.
function buildModal({ itemName = "Rocket Launcher", qualityName = "Unique", effectId = null, withActionRow = true, sheenName = null, killstreakerName = null } = {}) {
  const modal = new FakeElement("div");
  modal.className = "post-item-modal";

  const title = new FakeElement("h5");
  title.textContent = ` ${itemName} `;
  modal.appendChild(title);

  if (effectId != null) {
    const effectWrap = new FakeElement("div");
    effectWrap.setAttribute("style", `background: url("https://posts.tf/api/schema/image/effect/${effectId}") center center no-repeat;`);
    modal.appendChild(effectWrap);
  }

  const qualityRow = new FakeElement("div");
  const strong = new FakeElement("strong");
  strong.textContent = "Quality";
  const span = new FakeElement("span");
  span.textContent = qualityName;
  qualityRow.appendChild(strong);
  qualityRow.appendChild(span);
  modal.appendChild(qualityRow);

  // Same <strong>/<span> row shape (confirmed live).
  for (const [label, value] of [["Sheen", sheenName], ["Killstreaker", killstreakerName]]) {
    if (!value) continue;
    const row = new FakeElement("div");
    const rowStrong = new FakeElement("strong");
    rowStrong.textContent = label;
    const rowSpan = new FakeElement("span");
    rowSpan.textContent = value;
    row.appendChild(rowStrong);
    row.appendChild(rowSpan);
    modal.appendChild(row);
  }

  let actionRow = null;
  if (withActionRow) {
    actionRow = new FakeElement("div");
    actionRow.className = "mt-3 d-flex justify-content-center align-items-center";
    modal.appendChild(actionRow);
  }

  return { modal, actionRow };
}

function getRow() {
  return document.querySelectorAll(".tf2te-posts-tf-quick-links-row")[0] || null;
}

function getQuickLinks() {
  return getRow()?.querySelectorAll(".tf2te-posts-tf-quick-link-button") ?? [];
}

function getQuickLink(label) {
  return getQuickLinks().find((link) => link.textContent === label) || null;
}

// The key-hint and countdown buttons (utils/linkButtonStates.js) set their
// label as text and then append an icon; this file's fake reads only the
// children's text once any exist, so the label is read off _textContent.
function findStateButton(label, { needsKey = false } = {}) {
  return getQuickLinks().find((el) => el._textContent === label && (needsKey ? el.dataset.tf2teNeedsKey === "1" : /Retrying automatically/.test(el.title || ""))) || null;
}

test("adds next.backpack.tf/gladiator.tf/pricedb.io/stntrading.eu/marketplace.tf/mannco.store/Steam Market buttons for a plain item, reading identity off the modal's own title + Quality row", async () => {
  installGlobals();
  const { modal } = buildModal({ itemName: "Rocket Launcher", qualityName: "Unique" });
  global.document = makeDocument([modal]);

  itemQuickLinks();
  await flush();

  // No classic "backpack.tf" button, posts.tf's own native action row
  // already has one of its own.
  assert.equal(getQuickLink("backpack.tf"), null);
  // Links to next.backpack.tf's CLASSIFIEDS search, not its stats page,
  // a deliberate deviation from every other "single next.backpack.tf
  // button" port in this codebase.
  const nextBpLink = getQuickLink("next.backpack.tf");
  assert.ok(nextBpLink);
  assert.equal(new URL(nextBpLink.href).pathname, "/classifieds");
  assert.equal(getQuickLink("gladiator.tf")?.href, "https://gladiator.tf/sales?item=Rocket+Launcher");
  assert.equal(getQuickLink("pricedb.io")?.href, "https://pricedb.io/item/205%3B6");
  assert.equal(getQuickLink("stntrading.eu")?.href, "https://stntrading.eu/item/tf2/Rocket+Launcher");
  assert.ok(getQuickLink("marketplace.tf"));
  assert.ok(getQuickLink("mannco.store"));
  assert.ok(getQuickLink("Steam Market"));
  assert.equal(lastPricedbQuery, "Rocket Launcher");
  // Never a posts.tf button - this page IS posts.tf.
  const labels = getQuickLinks().map((l) => l.textContent);
  assert.equal(labels.some((l) => l.includes("posts.tf")), false);
});

// The row used to wait on pricedb.io's own lookup before showing ANYTHING
// at all, so a slow (or rate-limited) pricedb.io request delayed every
// other button too, even though none of them actually depend on it.
// pricedb.io's own slot now shows the shared loading state (label + spinner,
// aria-busy) immediately and resolves independently, in place, once it comes
// back.
test("shows every other button immediately, with a loading pricedb.io slot, instead of waiting on pricedb.io's own (slower) lookup", async () => {
  installGlobals({ delayMs: 40 });
  const { modal } = buildModal({ itemName: "Rocket Launcher", qualityName: "Unique" });
  global.document = makeDocument([modal]);

  itemQuickLinks();
  // A short wait - long enough for resolveStatsAndClassifieds (synchronous
  // schema-free resolution) to settle, well short of pricedb.io's own 40ms
  // artificial delay above.
  await new Promise((resolve) => realSetTimeout(resolve, 5));

  assert.ok(getQuickLink("gladiator.tf"), "gladiator.tf should already be there");
  assert.ok(getQuickLink("Steam Market"), "Steam Market should already be there");
  assert.equal(getQuickLink("pricedb.io"), null, "the real pricedb.io link shouldn't be ready yet");
  const loadingSlot = getQuickLinks().find((l) => l.getAttribute("aria-busy") === "true");
  assert.ok(loadingSlot, "expected the loading pricedb.io slot in the meantime");
  assert.equal(loadingSlot.tagName.toLowerCase(), "span");
  assert.match(loadingSlot.title, /Looking up this item on pricedb\.io/);

  // Now let the delayed pricedb.io lookup actually resolve.
  await new Promise((resolve) => realSetTimeout(resolve, 60));

  assert.equal(getQuickLink("pricedb.io")?.href, "https://pricedb.io/item/205%3B6");
  assert.equal(getQuickLinks().some((l) => l.getAttribute("aria-busy") === "true"), false);
});

test("prefixes a non-Unique quality name onto the item name (a Taunt's own 'Taunt: ' text stays intact, it's already part of the title)", async () => {
  installGlobals();
  const { modal } = buildModal({ itemName: "Taunt: Soldier's Requiem", qualityName: "Strange" });
  global.document = makeDocument([modal]);

  itemQuickLinks();
  await flush();

  assert.equal(lastPricedbQuery, "Strange Taunt: Soldier's Requiem");
});

// REGRESSION for a live bug report ("Strange Strange Flame Thrower", doubled,
// in the Steam Market/gladiator.tf/next.backpack.tf links): unlike the
// Unusual examples this feature was originally built against, a Strange
// item's own modal title ALREADY includes its quality word in full
// ("Strange Flame Thrower", not just "Flame Thrower") - prepending it again
// used to double it.
test("doesn't double the quality word when the modal's own title already includes it (Strange, confirmed live)", async () => {
  installGlobals();
  const { modal } = buildModal({ itemName: "Strange Flame Thrower", qualityName: "Strange" });
  global.document = makeDocument([modal]);

  itemQuickLinks();
  await flush();

  assert.equal(getQuickLink("gladiator.tf")?.href, "https://gladiator.tf/sales?item=Strange+Flame+Thrower");
  assert.equal(lastPricedbQuery, "Strange Flame Thrower");
});

// Confirmed live via the real pasted modal for "Winning Spirit Taunt:
// Soldier's Requiem" (Unusual, effect image url ".../effect/3142"): the
// numeric effect id is read straight off the DOM, and its name ("Winning
// Spirit") reverse-resolves from utils/unusualEffectIds.js's own static
// table - no schema/API key needed for either, so the resulting
// classifieds link ends up correctly filtered by particle id AND with the
// effect name stripped back out of the item name (same "Taunt: Soldier's
// Requiem" + "Winning Spirit" split every other confirmed Unusual example
// in this file already gets).
test("resolves an Unusual's exact effect id and name straight off the DOM/static table, no schema/API key needed", async () => {
  installGlobals();
  const { modal } = buildModal({ itemName: "Winning Spirit Taunt: Soldier's Requiem", qualityName: "Unusual", effectId: 3142 });
  global.document = makeDocument([modal]);

  itemQuickLinks();
  await flush();

  const bpLink = getQuickLink("next.backpack.tf");
  assert.ok(bpLink);
  const params = new URL(bpLink.href).searchParams;
  assert.equal(params.get("itemName"), "Taunt: Soldier's Requiem");
  assert.equal(params.get("quality"), "5");
  assert.equal(params.get("particle"), "3142");
});

// REGRESSION for a live bug report, with 4 real confirmed-working URLs for
// "Smoking Gentleman's Ushanka" (particle id 35): findEffectId's own numeric
// id alone used to be all that was ever threaded through, which isn't enough
// for gladiator.tf's own (more precise) "{Effect} {Item}" search or for
// pricedb.io's own search (which returns zero results for a query that still
// has the literal "Unusual" word in it) - both need the plain effect NAME,
// reverse-resolved here from the id via utils/unusualEffectIds.js's own
// static table (no schema/API key mocking needed at all - a real fix over
// this test's own earlier version, which needed a schema fixture to prove
// the same thing only worked WITH a configured key).
test("reverse-resolves the effect NAME from its id (via the static table, no API key needed) for gladiator.tf's and pricedb.io's own name-dependent searches", async () => {
  installGlobals();
  const { modal } = buildModal({ itemName: "Gentleman's Ushanka", qualityName: "Unusual", effectId: 35 });
  global.document = makeDocument([modal]);

  itemQuickLinks();
  await flush();

  // Confirmed live: https://gladiator.tf/sales?item=Smoking+Gentleman%27s+Ushanka
  assert.equal(getQuickLink("gladiator.tf")?.href, "https://gladiator.tf/sales?item=Smoking+Gentleman%27s+Ushanka");
  assert.equal(lastPricedbQuery, "Smoking Gentleman's Ushanka");
});

// REGRESSION for a live bug report ("Arachne's Web Mean Captain", particle id
// 305 - a case where the effect name is baked directly into the modal's own
// title with no delimiter, "Arachne's Web" + "Mean Captain"): this is the
// item that proved gladiator.tf/pricedb.io needed the effect name resolved
// (not just tolerated its absence) AND that Steam Market's own
// market_hash_name genuinely can't be built correctly without it at all -
// "Unusual Arachne's Web Mean Captain" is wrong, "Unusual Mean Captain" (the
// effect name STRIPPED back out) is the confirmed-correct listing name.
// Resolved via utils/unusualEffectIds.js's own static table - works
// correctly with NO Steam Web API key configured (this file's own default
// globals, matching the user's own real setup when this was first reported).
test("correctly splits an effect name that's baked directly into the title (no delimiter) via the static table - fixes gladiator.tf, pricedb.io, AND Steam Market", async () => {
  installGlobals();
  const { modal } = buildModal({ itemName: "Arachne's Web Mean Captain", qualityName: "Unusual", effectId: 305 });
  global.document = makeDocument([modal]);

  itemQuickLinks();
  await flush();

  assert.equal(lastPricedbQuery, "Arachne's Web Mean Captain");
  assert.equal(getQuickLink("gladiator.tf")?.href, "https://gladiator.tf/sales?item=Arachne%27s+Web+Mean+Captain");
  // Confirmed live: https://steamcommunity.com/market/listings/440/Unusual%20Mean%20Captain
  // ("Unusual Mean Captain" - the effect name stripped back OUT, the exact
  // opposite direction from gladiator.tf/pricedb.io above, and the one that
  // genuinely needed the real name resolved, not just a tolerant fallback).
  const steamMarketLink = getQuickLink("Steam Market");
  assert.ok(steamMarketLink);
  assert.equal(decodeURIComponent(new URL(steamMarketLink.href).pathname), "/market/listings/440/Unusual Mean Captain");
});

// REGRESSION for a live bug report: "Blissful Butterflies" (particle 413)
// and "Witch Doctor" (particle 410) were both confirmed live to be genuinely
// ABSENT from utils/unusualEffectIds.js's own static table at the time (not
// an extraction bug - the source file itself lacked them), which is exactly
// what motivated writing scripts/updateUnusualEffects.js and adding the
// schema-backed fallback tier in the first place - see that script's own
// header note and utils/unusualEffectIds.js's own header comment. The table
// has since been regenerated and now includes both of those, so this test
// uses a synthetic effect id instead (guaranteed to never be absorbed into a
// future regeneration, unlike a real particle id) to keep exercising the
// fallback tier itself rather than a gap that may or may not exist anymore
// (installGlobals' own default, used everywhere else in this file, has NO
// Steam Web API key configured at all, matching the "static table alone"
// case already covered above).
test("falls back to the schema-backed lookup when the static table doesn't have this specific effect id", async () => {
  installGlobals();
  const originalGet = globalThis.chrome.storage.local.get;
  globalThis.chrome.storage.local.get = async () => ({
    tf2SchemaCache: {
      itemNameToDefindex: {},
      defindexToItemName: {},
      effectNameToId: { "Synthetic Test Effect": 424242 },
      fetchedAt: Date.now(),
      schemaShapeVersion: 4,
    },
  });
  __resetSchemaCacheForTests();

  const { modal } = buildModal({ itemName: "Synthetic Test Effect Fleet Commander", qualityName: "Unusual", effectId: 424242 });
  global.document = makeDocument([modal]);

  itemQuickLinks();
  await flush();

  const nextBpLink = getQuickLink("next.backpack.tf");
  assert.ok(nextBpLink);
  const params = new URL(nextBpLink.href).searchParams;
  assert.equal(params.get("itemName"), "Fleet Commander");
  assert.equal(params.get("particle"), "424242");
  // Never sent for an Unusual at all - see the paint=none test below.
  assert.equal(params.has("paint"), false);

  globalThis.chrome.storage.local.get = originalGet;
  __resetSchemaCacheForTests();
});

// REGRESSION for a live bug report, with a real confirmed-working URL that
// has NO "paint" param at all for an Unusual: the shared classifieds builder
// (utils/tf2StatsLinks/index.js) used to send an explicit "paint=none" for
// EVERY Unusual on next.backpack.tf's own side (the ternary's own fallback
// firing, since an Unusual never has a resolved paint id to begin with) -
// actively wrong, since that excludes any Unusual that also happens to carry
// a paint. A plain (non-Unusual) item's own paint filtering is unaffected -
// see the "adds .../gladiator.tf/pricedb.io/..." test's own item ("Rocket
// Launcher", Unique) for that side, which still gets paint=none by design.
test("never sends a 'paint' param at all for an Unusual, even with no effect name resolved", async () => {
  installGlobals();
  const { modal } = buildModal({ itemName: "Gentleman's Ushanka", qualityName: "Unusual", effectId: 999999 }); // an id nothing resolves
  global.document = makeDocument([modal]);

  itemQuickLinks();
  await flush();

  const nextBpLink = getQuickLink("next.backpack.tf");
  assert.ok(nextBpLink);
  assert.equal(new URL(nextBpLink.href).searchParams.has("paint"), false);
});

// REGRESSION for a live bug report, with a real screenshot: "Strange Floral
// Growth Witch Doctor" - a dual-quality item (Strange-tracking underneath an
// Unusual, same "elevatedQuality" mechanic as "Arachne's Web Mean Captain")
// whose own <h5> title bakes in a literal "Strange " word even though its
// reported Quality row is "Unusual", not "Strange" - our own pipeline had no
// concept of that stray word before this fix and it rode along untouched
// into every link (confirmed live: "itemName=Strange Floral Growth Witch
// Doctor" instead of the confirmed-correct "itemName=Witch Doctor"). Dropped
// entirely for an Unusual - covers both the "effect name resolves" case (via
// a schema fixture, simulating a user WITH a configured key) and the
// "nothing resolves at all" graceful-degradation case (see the next two
// tests below, which use a synthetic effect id to keep that premise true
// regardless of future static-table regenerations).
test("strips a literal 'Strange ' word baked into a dual-quality item's own title, even though it's not the reported Quality", async () => {
  installGlobals();
  const originalGet = globalThis.chrome.storage.local.get;
  globalThis.chrome.storage.local.get = async () => ({
    tf2SchemaCache: {
      itemNameToDefindex: {},
      defindexToItemName: {},
      effectNameToId: { "Floral Growth": 410 },
      fetchedAt: Date.now(),
      schemaShapeVersion: 4,
    },
  });
  __resetSchemaCacheForTests();

  const { modal } = buildModal({ itemName: "Strange Floral Growth Witch Doctor", qualityName: "Unusual", effectId: 410 });
  global.document = makeDocument([modal]);

  itemQuickLinks();
  await flush();

  // Confirmed live: https://next.backpack.tf/classifieds?itemName=Witch%20Doctor&quality=5&...&particle=410&...
  const nextBpLink = getQuickLink("next.backpack.tf");
  assert.ok(nextBpLink);
  const params = new URL(nextBpLink.href).searchParams;
  assert.equal(params.get("itemName"), "Witch Doctor");
  assert.equal(params.get("particle"), "410");
  assert.equal(params.get("quality"), "5");

  globalThis.chrome.storage.local.get = originalGet;
  __resetSchemaCacheForTests();
});

test("still drops the baked-in 'Strange ' word even when nothing resolves the effect name at all (graceful degradation, no crash)", async () => {
  installGlobals();
  // A synthetic effect id (never in the static table, and this file's own
  // default globals have no Steam Web API key configured for the schema
  // fallback either) guarantees the effect name genuinely can't resolve,
  // regardless of any future static-table regeneration.
  const { modal } = buildModal({ itemName: "Strange Floral Growth Witch Doctor", qualityName: "Unusual", effectId: 999999 });
  global.document = makeDocument([modal]);

  itemQuickLinks();
  await flush();

  // "Strange " is gone even though "Floral Growth" couldn't be resolved and
  // separated out - not a perfect result, but no longer polluted by the
  // stray "Strange " word either.
  assert.equal(lastPricedbQuery, "Floral Growth Witch Doctor");
});

// REGRESSION for a live bug report: with no Steam Web API key configured
// (this file's own default globals), an Unusual whose effect name couldn't
// be resolved by either lookup tier used to silently build imprecise links
// with no indication why - reads as the extension being broken rather than
// needing a one-time setup step.
test("shows the 'Add Steam Web API key' button first in the row when an Unusual's effect name couldn't be resolved at all (no key, not in the static table)", async () => {
  installGlobals();
  savedSteamApiKey = null;
  // Synthetic id - see the previous test's own header note on why.
  const { modal } = buildModal({ itemName: "Strange Floral Growth Witch Doctor", qualityName: "Unusual", effectId: 999999 });
  global.document = makeDocument([modal]);

  itemQuickLinks();
  await flush();

  const keyButton = findStateButton("Add Steam Web API key", { needsKey: true });
  assert.ok(keyButton, "expected the key button");
  assert.equal(getQuickLinks()[0], keyButton, "first in the row, where next.backpack.tf would be");
  assert.match(keyButton.title, /effect couldn't be identified/i);
});

test("with a key saved, an unresolvable effect gets no key button (a key wouldn't help)", async () => {
  installGlobals();
  savedSteamApiKey = "abc123";
  try {
    const { modal } = buildModal({ itemName: "Strange Floral Growth Witch Doctor", qualityName: "Unusual", effectId: 999999 });
    global.document = makeDocument([modal]);

    itemQuickLinks();
    await flush();

    assert.equal(findStateButton("Add Steam Web API key", { needsKey: true }), null);
  } finally {
    savedSteamApiKey = null;
  }
});

test("does NOT show the key button once the effect name resolves (static table hit)", async () => {
  installGlobals();
  const { modal } = buildModal({ itemName: "Gentleman's Ushanka", qualityName: "Unusual", effectId: 35 }); // "Smoking" - in the static table
  global.document = makeDocument([modal]);

  itemQuickLinks();
  await flush();

  assert.equal(findStateButton("Add Steam Web API key", { needsKey: true }), null);
});

test("does NOT show the key button for a non-Unusual item, even with no effect id at all", async () => {
  installGlobals();
  const { modal } = buildModal({ itemName: "Rocket Launcher", qualityName: "Unique" });
  global.document = makeDocument([modal]);

  itemQuickLinks();
  await flush();

  assert.equal(findStateButton("Add Steam Web API key", { needsKey: true }), null);
});

test("does nothing (and doesn't throw) when there's no post-item-modal on the page at all", async () => {
  installGlobals();
  global.document = makeDocument([]);

  itemQuickLinks();
  await flush();

  assert.equal(getRow(), null);
});

test("does nothing when the Quality row isn't found - no confirmed identity signal, don't guess", async () => {
  installGlobals();
  const modal = new FakeElement("div");
  modal.className = "post-item-modal";
  const title = new FakeElement("h5");
  title.textContent = "Rocket Launcher";
  modal.appendChild(title);
  global.document = makeDocument([modal]);

  itemQuickLinks();
  await flush();

  assert.equal(getRow(), null);
});

test("appends the row after the native action-button row when present, otherwise falls back to appending onto the modal itself", async () => {
  installGlobals();
  const { modal } = buildModal({ withActionRow: false });
  global.document = makeDocument([modal]);

  itemQuickLinks();
  await flush();

  assert.ok(getRow());
  assert.equal(modal.children[modal.children.length - 1], getRow());
});

test("a real 429 turns pricedb.io's slot into a countdown, which then retries the slot in place", async () => {
  mock.timers.enable({ apis: ["setInterval"] });
  try {
    installGlobals({ rateLimited: true });
    pricedbRetryAfterMs = 2000;
    const { modal } = buildModal();
    global.document = makeDocument([modal]);

    itemQuickLinks();
    await flush();

    assert.equal(getQuickLink("pricedb.io"), null);
    const countdown = findStateButton("pricedb.io");
    assert.ok(countdown, "expected the countdown");
    assert.equal(countdown.tagName.toLowerCase(), "span");
    assert.equal(countdown.classList.contains("disabled"), false, "the disabled class would block its hover text");

    pricedbRateLimited = false;
    mock.timers.tick(2000);
    await flush();

    assert.ok(getQuickLink("pricedb.io"), "expected the real pricedb.io link after the retry");
  } finally {
    pricedbRetryAfterMs = undefined;
    mock.timers.reset();
  }
});

test("re-scanning for the SAME item doesn't duplicate the row (signature dedupe)", async () => {
  installGlobals();
  const { modal } = buildModal();
  global.document = makeDocument([modal]);

  itemQuickLinks();
  await flush();
  assert.equal(document.querySelectorAll(".tf2te-posts-tf-quick-links-row").length, 1);

  FakeMutationObserver.instances[0].cb();
  await flush();
  assert.equal(document.querySelectorAll(".tf2te-posts-tf-quick-links-row").length, 1);
});

// Guards against the exact class of bug seen on mannco.store's own
// itemQuickLinks (see tests/manncoStoreItemQuickLinks.test.js's own
// REGRESSION note) - a framework that reactively wipes the row out without
// touching the signature-bearing root shouldn't get permanently stuck
// thinking the row is already there.
test("rebuilds the row if it's wiped out (e.g. by a reactive re-render) even for the same item", async () => {
  installGlobals();
  const { modal } = buildModal();
  global.document = makeDocument([modal]);

  itemQuickLinks();
  await flush();
  assert.ok(getRow());

  getRow().remove();
  assert.equal(getRow(), null);

  FakeMutationObserver.instances[0].cb();
  await flush();

  assert.ok(getRow());
});

test("itemQuickLinks sets up a subtree MutationObserver on document.body", () => {
  installGlobals();
  global.document = makeDocument([]);

  itemQuickLinks();

  assert.equal(FakeMutationObserver.instances.length, 1);
  assert.equal(FakeMutationObserver.instances[0].target, document.body);
  assert.deepEqual(FakeMutationObserver.instances[0].opts, { childList: true, subtree: true });
});

// Confirmed live: the modal shows a Killstreak item's Sheen/Killstreaker as
// their own <strong>/<span> rows (here an Agonizing Emerald / Incinerator
// Strange Professional Killstreak Australium Black Box). They were never
// read, so no link filtered by them.
test("REGRESSION: the modal's Sheen/Killstreaker rows filter the next.backpack.tf, marketplace.tf, mannco.store and Steam Market links", async () => {
  installGlobals();
  const { modal } = buildModal({
    itemName: "Strange Professional Killstreak Australium Black Box",
    qualityName: "Strange",
    sheenName: "Agonizing Emerald",
    killstreakerName: "Incinerator",
  });
  global.document = makeDocument([modal]);

  itemQuickLinks();
  await flush();

  assert.match(getQuickLink("next.backpack.tf")?.href ?? "", /&sheen=5&killstreaker=2007&/); // Agonizing Emerald, Incinerator
  assert.match(getQuickLink("marketplace.tf")?.href ?? "", /&sks%5B%5D=5&ske%5B%5D=2007&/);
  assert.equal(
    getQuickLink("mannco.store")?.href,
    "https://mannco.store/tf2?search=Australium+Black+Box&quality=Strange&festivized=No+festivized&killstreak=Professional+Killstreak&warpaints=No+WarPaints&sheen=Agonizing+Emerald&killstreaker=Incinerator"
  );
  assert.equal(
    getQuickLink("Steam Market")?.href,
    "https://steamcommunity.com/market/listings/440/Strange%20Professional%20Killstreak%20Australium%20Black%20Box?appid=440&q=Incinerator%2CAgonizing+Emerald"
  );
});

test("with Sheen/Killstreaker filtering switched off in the popup, the modal's Sheen/Killstreaker rows are ignored (tier only)", async () => {
  installGlobals();
  sheenKillstreakerFilterOff = true;
  try {
    const { modal } = buildModal({
      itemName: "Strange Professional Killstreak Australium Black Box",
      qualityName: "Strange",
      sheenName: "Agonizing Emerald",
      killstreakerName: "Incinerator",
    });
    global.document = makeDocument([modal]);

    itemQuickLinks();
    await flush();

    for (const label of ["next.backpack.tf", "marketplace.tf", "mannco.store", "Steam Market"]) {
      assert.doesNotMatch(getQuickLink(label)?.href ?? "", /sheen|killstreaker=|sks|ske|Incinerator|Emerald/, label);
    }
    assert.match(getQuickLink("mannco.store")?.href ?? "", /killstreak=Professional\+Killstreak/);
  } finally {
    sheenKillstreakerFilterOff = false;
  }
});
