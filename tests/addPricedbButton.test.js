import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { addPricedbButton } from "../backpack.tf/nextUI/addPricedbButton/content.js";
import { __resetPricedbCacheForTests } from "../utils/pricedb.js";

// Minimal hand-rolled fake DOM (see tests/addMarketplaceButton.test.js's own
// header comment for why this repo hand-rolls this instead of pulling in
// jsdom) - same shape tests/addGladiatorButton.test.js already uses, since
// this file targets the exact same tooltip slice (Classifieds anchor +
// optional title heading + content-links row).

function parseCompound(selector) {
  const attrSubMatch = /\[([\w-]+)\*="([^"]*)"\]/.exec(selector);
  const rest = selector.replace(/\[[^\]]*\]/g, "");
  const classes = [...rest.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
  const tagMatch = /^[a-zA-Z][\w-]*/.exec(rest);
  return {
    tag: tagMatch ? tagMatch[0].toLowerCase() : null,
    classes,
    attrSub: attrSubMatch ? { name: attrSubMatch[1], value: attrSubMatch[2] } : null,
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
  return true;
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.nodeType = 1; // Node.ELEMENT_NODE
    this.parentElement = null;
    this.children = [];
    this._attrs = {};
    this.dataset = {};
    this._textContent = "";
    this._className = "";
    this.style = {};
    const classSet = new Set();
    this.classList = {
      contains: (c) => classSet.has(c),
      add: (...cs) => cs.forEach((c) => classSet.add(c)),
    };
  }
  get textContent() {
    if (this.children.length > 0) return this.children.map((c) => c.textContent || "").join("");
    return this._textContent;
  }
  set textContent(v) {
    // Like the real DOM: replaces every child with one text node, so a later
    // append (utils/linkButtonStates.js's clock icon/countdown) sits after it.
    this._textContent = v;
    this.children = v ? [fakeTextNode(v)] : [];
  }
  append(...nodes) {
    for (const node of nodes) {
      if (typeof node === "string") this.children.push(fakeTextNode(node));
      else this.appendChild(node);
    }
  }
  get isConnected() {
    let el = this;
    while (el.parentElement) el = el.parentElement;
    return el.tagName === "body";
  }
  get className() {
    return this._className;
  }
  set className(v) {
    this._className = v;
    (v || "").split(/\s+/).filter(Boolean).forEach((c) => this.classList.add(c));
  }
  get href() {
    return this._attrs.href || "";
  }
  set href(v) {
    this._attrs.href = v;
  }
  getAttribute(name) {
    return name in this._attrs ? this._attrs[name] : null;
  }
  setAttribute(name, value) {
    this._attrs[name] = value;
  }
  removeAttribute(name) {
    delete this._attrs[name];
  }
  getAttributeNames() {
    return Object.keys(this._attrs);
  }
  appendChild(child) {
    this.children.push(child);
    child.parentElement = this;
    return child;
  }
  remove() {
    if (!this.parentElement) return;
    const siblings = this.parentElement.children;
    const idx = siblings.indexOf(this);
    if (idx !== -1) siblings.splice(idx, 1);
    this.parentElement = null;
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
  matches(selector) {
    return matchesCompound(this, parseCompound(selector));
  }
  closest(selector) {
    const parsed = parseCompound(selector);
    let el = this;
    while (el) {
      if (matchesCompound(el, parsed)) return el;
      el = el.parentElement;
    }
    return null;
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

function fakeTextNode(text) {
  return { nodeType: 3, textContent: String(text), children: [] };
}

function makeDocument(rootChildren = []) {
  const body = new FakeElement("body");
  for (const c of rootChildren) body.appendChild(c);
  return {
    body,
    createElement: (tag) => new FakeElement(tag),
    createElementNS: (_ns, tag) => new FakeElement(tag),
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

// Exposed so a test can assert on exactly what query text was actually sent
// to pricedb.io's own /api/search - see buildPricedbSearchQuery's own note
// on why the raw tooltip title isn't always what should be searched.
let lastSearchQuery = null;

function installGlobals({ sku = "40;11;kt-3", rateLimited = false, retryAfterMs } = {}) {
  global.Node = { ELEMENT_NODE: 1 };
  global.MutationObserver = FakeMutationObserver;
  FakeMutationObserver.instances = [];
  lastSearchQuery = null;
  // utils/pricedb.js's own in-memory cache is keyed per item name, not per
  // test - several tests below deliberately reuse the same search query
  // (e.g. "Strange Professional Killstreak Backburner") expecting a fresh
  // sendMessage call each time (lastSearchQuery above would otherwise hold a
  // stale value from whichever earlier test last actually triggered one).
  __resetPricedbCacheForTests();
  global.chrome = {
    runtime: {
      sendMessage: async (msg) => {
        const url = new URL(msg.url);
        const q = url.searchParams.get("q");
        lastSearchQuery = q;
        // Same real HTTP 429 status/shape background.js's own fetchJson
        // already returns on pricedb.io's own dynamic per-IP rate limit -
        // see utils/pricedb.js's own searchPricedbSkuStatus note.
        if (rateLimited) return { ok: false, status: 429, error: "Rate limited (429)", retryAfterMs };
        return {
          ok: true,
          data: {
            success: true,
            data: { query: q, results: sku ? [{ name: q, sku }] : [], total: sku ? 1 : 0 },
          },
        };
      },
    },
  };
}

function getPricedbButton() {
  return document.querySelector(".tf2te-pricedb-button");
}

// Same shape confirmed live in next.backpack.tf's item-preview tooltip:
// <a href="/classifieds?itemName=...&quality=11" class="btn btn-outline-brand btn-item-tooltip">
function buildClassifiedsAnchor(itemName, qualityId, { scopedAttr = "data-v-b49f43c8" } = {}) {
  const anchor = new FakeElement("a");
  anchor.setAttribute("href", `/classifieds?itemName=${encodeURIComponent(itemName)}&quality=${qualityId}`);
  anchor.className = "btn btn-outline-brand btn-item-tooltip";
  if (scopedAttr) anchor.setAttribute(scopedAttr, "");
  return anchor;
}

function buildContentLinksRow(anchor) {
  const row = new FakeElement("div");
  row.className = "item-tooltip__content__links";
  row.appendChild(anchor);
  return row;
}

// Same shape backpack.tf/nextUI/shared/tooltipButtonRow.js's buildTooltipButtonRow
// builds - a standalone "item-tooltip__content__links mb-1" row containing
// just the gladiator.tf button, this file's own insertion point.
function buildGladiatorRow({ scopedAttr = "data-v-gladiator123" } = {}) {
  const button = new FakeElement("a");
  button.className = "btn btn-outline-brand btn-item-tooltip tf2te-gladiator-tf-button";
  if (scopedAttr) button.setAttribute(scopedAttr, "");
  button.textContent = "gladiator.tf";

  const row = new FakeElement("div");
  row.className = "item-tooltip__content__links mb-1";
  row.appendChild(button);
  return { row, button };
}

// Builds a ".tippy-popper" tooltip shell (confirmed live) with an optional
// title heading (confirmed live: <div class="item-tooltip__header__title">
// Name</div>), the Classifieds anchor, and (when withGladiator is true) a
// gladiator.tf button/row already in place - this file's own insertion
// point, so most tests need one present the same way a real page would
// already have ../addGladiatorButton/content.js's own observer run first.
function buildTooltip({ itemName, qualityId, titleText, withGladiator = false } = {}) {
  const popper = new FakeElement("div");
  popper.classList.add("tippy-popper");

  if (titleText) {
    const titleDiv = new FakeElement("div");
    titleDiv.classList.add("item-tooltip__header__title");
    titleDiv.textContent = `\n      ${titleText}\n    `;
    popper.appendChild(titleDiv);
  }

  const anchor = buildClassifiedsAnchor(itemName, qualityId);
  const linksWrap = buildContentLinksRow(anchor);
  popper.appendChild(linksWrap);

  let gladiatorButton = null;
  if (withGladiator) {
    const { row, button } = buildGladiatorRow();
    popper.appendChild(row);
    gladiatorButton = button;
  }

  return { popper, anchor, gladiatorButton };
}

test("builds the pricedb.io link from the SKU pricedb's own /api/search returns for the tooltip's own title text", async () => {
  installGlobals({ sku: "40;11;kt-3" });
  const { popper } = buildTooltip({
    itemName: "Backburner",
    qualityId: 11,
    titleText: "Strange Professional Killstreak Backburner",
    withGladiator: true,
  });
  global.document = makeDocument([popper]);

  addPricedbButton();
  await flush();

  const button = getPricedbButton();
  assert.equal(button.href, "https://pricedb.io/item/40%3B11%3Bkt-3");
});

test("does not insert a button when the search comes back with no results", async () => {
  installGlobals({ sku: null });
  const { popper } = buildTooltip({ itemName: "Nonsense", qualityId: 6, titleText: "Nonsense Item", withGladiator: true });
  global.document = makeDocument([popper]);

  addPricedbButton();
  await flush();

  assert.equal(getPricedbButton(), null);
});

// A rate-limited lookup used to look IDENTICAL to "this item genuinely has
// no pricedb.io listing" here too - both just silently omitted the button.
// searchPricedbSkuStatus surfaces the real 429 (see utils/pricedb.js's own
// note) so this can show something instead.
// Rate limit: utils/linkButtonStates.js's countdown. Only setInterval is
// faked, so flush()'s real setTimeout still drains promises.
function withFakeIntervals(fn) {
  return async () => {
    mock.timers.enable({ apis: ["setInterval"] });
    try {
      await fn();
    } finally {
      mock.timers.reset();
    }
  };
}

function resolvingSendMessage(onCall = () => {}) {
  return async (msg) => {
    onCall();
    const q = new URL(msg.url).searchParams.get("q");
    return { ok: true, data: { success: true, data: { results: [{ name: q, sku: "40;11;kt-3" }] } } };
  };
}

test(
  "REGRESSION: a real 429 shows a 'pricedb.io Ns' countdown (from pricedb's Retry-After) instead of silently omitting the button",
  withFakeIntervals(async () => {
    installGlobals({ rateLimited: true, retryAfterMs: 12000 });
    const { popper } = buildTooltip({
      itemName: "Backburner",
      qualityId: 11,
      titleText: "Strange Professional Killstreak Backburner",
      withGladiator: true,
    });
    global.document = makeDocument([popper]);

    addPricedbButton();
    await flush();

    const button = getPricedbButton();
    assert.ok(button);
    assert.equal(button.textContent, "pricedb.io 12s");
    assert.equal(button.href, "");
    assert.equal(button.style.cursor, "default");
    assert.match(button.title, /Retrying automatically in 12s/);

    mock.timers.tick(1000);
    assert.equal(button.textContent, "pricedb.io 11s");
  })
);

test(
  "the countdown defaults to 30s when the 429 carries no Retry-After",
  withFakeIntervals(async () => {
    installGlobals({ rateLimited: true });
    const { popper } = buildTooltip({ itemName: "Backburner", qualityId: 11, titleText: "Strange Professional Killstreak Backburner", withGladiator: true });
    global.document = makeDocument([popper]);

    addPricedbButton();
    await flush();

    assert.equal(getPricedbButton().textContent, "pricedb.io 30s");
  })
);

test(
  "at zero the countdown retries by itself and the button becomes the real link, with no re-hover",
  withFakeIntervals(async () => {
    installGlobals({ rateLimited: true, retryAfterMs: 2000 });
    const { popper } = buildTooltip({ itemName: "Backburner", qualityId: 11, titleText: "Strange Professional Killstreak Backburner", withGladiator: true });
    global.document = makeDocument([popper]);

    addPricedbButton();
    await flush();
    assert.equal(getPricedbButton().textContent, "pricedb.io 2s");

    // pricedb.io stops limiting before the retry fires.
    global.chrome.runtime.sendMessage = resolvingSendMessage();
    mock.timers.tick(2000);
    await flush();

    const button = getPricedbButton();
    assert.equal(button.textContent, "pricedb.io");
    assert.equal(button.href, "https://pricedb.io/item/40%3B11%3Bkt-3");
    assert.equal(button.style.cursor, "");
    assert.equal(button.getAttribute("title"), null);
    assert.equal(document.querySelectorAll(".tf2te-pricedb-button").length, 1);
  })
);

test(
  "if the tooltip was closed when the countdown ends, it doesn't retry then, but releases the item so the next hover does",
  withFakeIntervals(async () => {
    installGlobals({ rateLimited: true, retryAfterMs: 1000 });
    const { popper, anchor } = buildTooltip({ itemName: "Backburner", qualityId: 11, titleText: "Strange Professional Killstreak Backburner", withGladiator: true });
    global.document = makeDocument([popper]);

    addPricedbButton();
    await flush();
    let lookups = 0;
    global.chrome.runtime.sendMessage = resolvingSendMessage(() => lookups++);

    popper.remove(); // hover ended
    mock.timers.tick(1000);
    await flush();
    assert.equal(lookups, 0);
    assert.equal(anchor.dataset.tf2tePricedbSignature, undefined);

    global.document = makeDocument([popper]); // hovered again
    addPricedbButton();
    await flush();
    assert.equal(lookups, 1);
    assert.equal(getPricedbButton().href, "https://pricedb.io/item/40%3B11%3Bkt-3");
  })
);

test(
  "a rate-limited placeholder reused for a different item that resolves becomes that item's real link (countdown stopped)",
  withFakeIntervals(async () => {
    installGlobals({ rateLimited: true, retryAfterMs: 5000 });
    const { popper } = buildTooltip({ itemName: "Backburner", qualityId: 11, titleText: "Strange Professional Killstreak Backburner", withGladiator: true });
    global.document = makeDocument([popper]);

    addPricedbButton();
    await flush();
    assert.equal(getPricedbButton()?.textContent, "pricedb.io 5s");

    // Vue patches the SAME tooltip DOM in place across hovers, so a different
    // title reuses the same button element.
    __resetPricedbCacheForTests();
    global.chrome.runtime.sendMessage = resolvingSendMessage();
    const titleDiv = popper.querySelectorAll(".item-tooltip__header__title")[0];
    titleDiv.textContent = "Strange Professional Killstreak Backburner (Different)";

    addPricedbButton();
    await flush();

    const button = getPricedbButton();
    assert.equal(button.textContent, "pricedb.io");
    assert.equal(button.href, "https://pricedb.io/item/40%3B11%3Bkt-3");
    assert.equal(button.style.cursor, "");

    mock.timers.tick(10000); // the old countdown must not fire and overwrite it
    await flush();
    assert.equal(button.textContent, "pricedb.io");
  })
);

test("falls back to no title heading present without throwing (an item type with no title row at all)", async () => {
  installGlobals();
  const anchor = buildClassifiedsAnchor("Reclaimed Metal", 6);
  const wrap = buildContentLinksRow(anchor);
  global.document = makeDocument([wrap]);

  addPricedbButton();
  await flush();

  assert.equal(getPricedbButton(), null);
  assert.equal(wrap.children.length, 1); // untouched
});

test("does not insert a button when gladiator.tf's own button isn't there yet, but retries and succeeds once a later mutation adds it (doesn't permanently claim the title early)", async () => {
  installGlobals({ sku: "5021;6" });
  const { popper } = buildTooltip({ itemName: "Reclaimed Metal", qualityId: 6, titleText: "Reclaimed Metal" }); // no gladiator button yet
  global.document = makeDocument([popper]);

  addPricedbButton();
  await flush();
  assert.equal(getPricedbButton(), null);

  // gladiator.tf's own button shows up moments later (its own async/observer
  // timing) - this file's own observer sees that same insertion and retries.
  const { row, button: gladiatorButton } = buildGladiatorRow();
  popper.appendChild(row);
  FakeMutationObserver.instances[0].cb([{ addedNodes: [row] }]);
  await flush();

  const button = getPricedbButton();
  assert.ok(button);
  assert.equal(button.href, "https://pricedb.io/item/5021%3B6");
  assert.equal(button.parentElement, gladiatorButton.parentElement);
});

test("inserts the pricedb.io button as a sibling right after the gladiator.tf button (same row), cloning ITS classes/scoped-style attribute, not the Classifieds anchor's", async () => {
  installGlobals({ sku: "5021;6" });
  const { popper, gladiatorButton } = buildTooltip({ itemName: "Reclaimed Metal", qualityId: 6, titleText: "Reclaimed Metal", withGladiator: true });
  global.document = makeDocument([popper]);

  addPricedbButton();
  await flush();

  const gladiatorRow = gladiatorButton.parentElement;
  assert.equal(gladiatorRow.children.length, 2); // [gladiatorButton, pricedbButton]
  assert.equal(gladiatorRow.children[0], gladiatorButton);

  const button = getPricedbButton();
  assert.equal(button, gladiatorRow.children[1]);
  assert.equal(button.textContent, "pricedb.io");
  assert.ok(button.classList.contains("btn-item-tooltip"));
  assert.ok(button.classList.contains("tf2te-gladiator-tf-button") === false); // cloned classes, not the class itself
  assert.ok(button.classList.contains("tf2te-pricedb-button"));
  assert.equal(button.target, "_blank");
  assert.equal(button.rel, "noopener noreferrer");
  assert.equal(button.getAttribute("data-v-gladiator123"), ""); // copied from the gladiator.tf button, not the Classifieds anchor
});

test("does not insert a second button when the same unchanged tooltip is scanned twice (content-signature dedupe on the title text)", async () => {
  installGlobals({ sku: "5021;6" });
  const { popper, gladiatorButton } = buildTooltip({ itemName: "Reclaimed Metal", qualityId: 6, titleText: "Reclaimed Metal", withGladiator: true });
  global.document = makeDocument([popper]);

  addPricedbButton();
  await flush();
  assert.equal(gladiatorButton.parentElement.children.length, 2);

  addPricedbButton();
  await flush();

  assert.equal(gladiatorButton.parentElement.children.length, 2);
});

test("REGRESSION: when Vue recycles the same tooltip for a DIFFERENT item, the button's href updates to the new item's own SKU instead of staying stuck on the first one", async () => {
  installGlobals({ sku: "40;11;kt-3" });
  const { popper, anchor } = buildTooltip({
    itemName: "Backburner",
    qualityId: 11,
    titleText: "Strange Professional Killstreak Backburner",
    withGladiator: true,
  });
  global.document = makeDocument([popper]);

  addPricedbButton();
  await flush();
  assert.equal(getPricedbButton().href, "https://pricedb.io/item/40%3B11%3Bkt-3");

  // Vue patches the SAME title node's text in place for a different item -
  // the fake search endpoint now returns a different sku for the new query.
  global.chrome.runtime.sendMessage = async (msg) => {
    const url = new URL(msg.url);
    return {
      ok: true,
      data: {
        success: true,
        data: { query: url.searchParams.get("q"), results: [{ name: "Bonk! Atomic Punch", sku: "46;6" }], total: 1 },
      },
    };
  };
  const titleDiv = popper.children[0];
  titleDiv.textContent = "Bonk! Atomic Punch";
  anchor.setAttribute("href", "/classifieds?itemName=Bonk!%20Atomic%20Punch&quality=6");

  addPricedbButton();
  await flush();

  assert.equal(document.querySelectorAll(".tf2te-pricedb-button").length, 1);
  assert.equal(getPricedbButton().href, "https://pricedb.io/item/46%3B6");
});

// The early "no match - don't guess" bail-out must not leave the PREVIOUS
// item's button behind on a recycled tooltip - that showed a pricedb.io link
// to the wrong item.
test("REGRESSION: when a recycled tooltip's new item has no pricedb.io match, the previous item's button is removed rather than left linking to the wrong item", async () => {
  installGlobals({ sku: "40;11;kt-3" });
  const { popper, anchor } = buildTooltip({
    itemName: "Backburner",
    qualityId: 11,
    titleText: "Strange Professional Killstreak Backburner",
    withGladiator: true,
  });
  global.document = makeDocument([popper]);

  addPricedbButton();
  await flush();
  assert.ok(getPricedbButton());

  global.chrome.runtime.sendMessage = async (msg) => {
    const url = new URL(msg.url);
    return { ok: true, data: { success: true, data: { query: url.searchParams.get("q"), results: [], total: 0 } } };
  };
  const titleDiv = popper.children[0];
  titleDiv.textContent = "Some Unlisted Item";
  anchor.setAttribute("href", "/classifieds?itemName=Some%20Unlisted%20Item&quality=6");

  addPricedbButton();
  await flush();

  assert.equal(document.querySelectorAll(".tf2te-pricedb-button").length, 0);
});

// A Strangifier's tooltip title is just its target weapon's name, the same
// title the plain weapon's own tooltip shows - deduping on the title alone
// left the Strangifier's link on the plain weapon after a re-hover.
test("REGRESSION: a recycled tooltip with the same title but a different search (Strangifier -> plain weapon) re-resolves", async () => {
  installGlobals();
  global.chrome.runtime.sendMessage = async (msg) => {
    const q = new URL(msg.url).searchParams.get("q");
    const sku = q.endsWith("Strangifier") ? "6522;6;td-773" : "773;6";
    return { ok: true, data: { success: true, data: { query: q, results: [{ name: q, sku }], total: 1 } } };
  };
  const { popper } = buildTooltip({ itemName: "Strangifier", qualityId: 6, titleText: "Pretty Boy's Pocket Pistol", withGladiator: true });
  const anchor = popper.querySelectorAll("a.btn-item-tooltip")[0];
  anchor.setAttribute("href", `${anchor.getAttribute("href")}&targetItem=${encodeURIComponent("Pretty Boy's Pocket Pistol")}`);
  global.document = makeDocument([popper]);

  addPricedbButton();
  await flush();
  assert.equal(getPricedbButton().href, "https://pricedb.io/item/6522%3B6%3Btd-773");

  // Vue reuses the tooltip for the plain weapon: same title, no targetItem.
  anchor.setAttribute("href", `/classifieds?itemName=${encodeURIComponent("Pretty Boy's Pocket Pistol")}&quality=6`);
  addPricedbButton();
  await flush();

  assert.equal(document.querySelectorAll(".tf2te-pricedb-button").length, 1);
  assert.equal(getPricedbButton().href, "https://pricedb.io/item/773%3B6");
});

test("the observer inserts a button for a Classifieds anchor added later (tooltip shown after initial page load)", async () => {
  installGlobals({ sku: "5021;6" });
  global.document = makeDocument([]);
  addPricedbButton();
  await flush();

  const { popper } = buildTooltip({ itemName: "Rocket Launcher", qualityId: 6, titleText: "Rocket Launcher", withGladiator: true });
  document.body.appendChild(popper);

  FakeMutationObserver.instances[0].cb([{ addedNodes: [popper] }]);
  await flush();

  assert.equal(getPricedbButton()?.textContent, "pricedb.io");
});

test("addPricedbButton sets up a subtree MutationObserver on document.body", () => {
  installGlobals();
  global.document = makeDocument([]);

  addPricedbButton();

  assert.equal(FakeMutationObserver.instances.length, 1);
  assert.equal(FakeMutationObserver.instances[0].target, document.body);
  assert.deepEqual(FakeMutationObserver.instances[0].opts, { childList: true, subtree: true });
});

// Regression: an Unusual Taunt got no pricedb.io button at all.
// next.backpack.tf's own tooltip title omits "Taunt: " for display ("'72
// Conga"), but pricedb.io's own index keeps it ("'72 Taunt: Conga") -
// confirmed live via a direct GET to pricedb.io/api/search: searching the
// raw title text found nothing, searching "Taunt: Conga" (or even just
// "Conga") found it, correctly ranked first.

test("reinserts 'Taunt: ' before searching, splicing it in right after whatever effect-name prefix the title already has", async () => {
  installGlobals({ sku: "1118;5;u3004" });
  const { popper } = buildTooltip({
    itemName: "Taunt: Conga", // confirmed live: the Classifieds anchor's own itemName keeps the prefix
    qualityId: 5, // Unusual
    titleText: "'72 Conga", // confirmed live: the tooltip's own title strips it
    withGladiator: true,
  });
  global.document = makeDocument([popper]);

  addPricedbButton();
  await flush();

  assert.equal(lastSearchQuery, "'72 Taunt: Conga");
  assert.equal(getPricedbButton()?.href, "https://pricedb.io/item/1118%3B5%3Bu3004");
});

test("searches 'Taunt: {name}' (no effect prefix) for a plain, non-Unusual Taunt whose title already IS just the bare base name", async () => {
  installGlobals({ sku: "1118;6" });
  const { popper } = buildTooltip({
    itemName: "Taunt: Conga",
    qualityId: 6, // Unique
    titleText: "Conga", // no effect prefix to preserve
    withGladiator: true,
  });
  global.document = makeDocument([popper]);

  addPricedbButton();
  await flush();

  assert.equal(lastSearchQuery, "Taunt: Conga");
});

test("falls back to searching the raw title unchanged when it doesn't actually end with the Classifieds anchor's own base name (an assumption that failed - safer than guessing wrong)", async () => {
  installGlobals({ sku: "1118;5;u3004" });
  const { popper } = buildTooltip({
    itemName: "Taunt: Conga",
    qualityId: 5,
    titleText: "Something Unexpected", // doesn't end with "Conga"
    withGladiator: true,
  });
  global.document = makeDocument([popper]);

  addPricedbButton();
  await flush();

  assert.equal(lastSearchQuery, "Something Unexpected");
});

test("does not touch the search query at all for a non-Taunt item - the existing, already-working behavior", async () => {
  installGlobals({ sku: "40;11;kt-3" });
  const { popper } = buildTooltip({
    itemName: "Backburner",
    qualityId: 11,
    titleText: "Strange Professional Killstreak Backburner",
    withGladiator: true,
  });
  global.document = makeDocument([popper]);

  addPricedbButton();
  await flush();

  assert.equal(lastSearchQuery, "Strange Professional Killstreak Backburner");
});

// Seen live: a Strangifier's tooltip title didn't name the tool, so the
// search found the plain target weapon (773;6) instead of the Strangifier
// (6522;6;td-773). The anchor's itemName/targetItem pair has both parts.
test("REGRESSION: a Strangifier is searched by its full name, rebuilt from the anchor's itemName + targetItem, not the tooltip title", async () => {
  installGlobals({ sku: "6522;6;td-773" });
  const { popper } = buildTooltip({ itemName: "Strangifier", qualityId: 6, titleText: "Pretty Boy's Pocket Pistol", withGladiator: true });
  const anchor = popper.querySelectorAll("a.btn-item-tooltip")[0];
  anchor.setAttribute("href", `${anchor.getAttribute("href")}&targetItem=${encodeURIComponent("Pretty Boy's Pocket Pistol")}`);
  global.document = makeDocument([popper]);

  addPricedbButton();
  await flush();

  assert.equal(lastSearchQuery, "Pretty Boy's Pocket Pistol Strangifier");
  assert.equal(getPricedbButton().href, "https://pricedb.io/item/6522%3B6%3Btd-773");
});
