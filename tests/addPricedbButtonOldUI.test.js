import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { addPricedbButton } from "../backpack.tf/oldUI/addPricedbButton/content.js";
import { __resetPricedbCacheForTests } from "../utils/pricedb.js";

// Same hand-rolled fake DOM as tests/addGladiatorButtonOldUI.test.js /
// tests/addMarketplaceButtonOldUI.test.js.

function parseCompound(selector) {
  const attrSubMatch = /\[([\w-]+)\*="([^"]*)"\]/.exec(selector);
  const rest = selector.replace(/\[[^\]]*\]/g, "");
  const idMatch = /#([\w-]+)/.exec(rest);
  const classes = [...rest.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
  const tagMatch = /^[a-zA-Z][\w-]*/.exec(rest);
  return {
    tag: tagMatch ? tagMatch[0].toLowerCase() : null,
    id: idMatch ? idMatch[1] : null,
    classes,
    attrSub: attrSubMatch ? { name: attrSubMatch[1], value: attrSubMatch[2] } : null,
  };
}

function matchesCompound(el, parsed) {
  if (!el || el.nodeType !== 1) return false;
  if (parsed.tag && el.tagName.toLowerCase() !== parsed.tag) return false;
  if (parsed.id && el.getAttribute("id") !== parsed.id) return false;
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
    this.isConnected = true;
    this.style = {};
    this.dataset = {};
    const classSet = new Set();
    this.classList = {
      contains: (c) => classSet.has(c),
      add: (...cs) => cs.forEach((c) => classSet.add(c)),
    };
  }
  get textContent() {
    if (this.children.length > 0) return this.children.map((c) => c.textContent || "").join("");
    return this._textContent || "";
  }
  set textContent(v) {
    // Like the real DOM: replaces every child with one text node.
    this._textContent = v;
    this.children = v ? [fakeTextNode(v)] : [];
  }
  append(...nodes) {
    for (const node of nodes) {
      if (typeof node === "string") this.children.push(fakeTextNode(node));
      else this.appendChild(node);
    }
  }
  removeAttribute(name) {
    delete this._attrs[name];
  }
  remove() {
    if (!this.parentElement) return;
    const siblings = this.parentElement.children;
    const idx = siblings.indexOf(this);
    if (idx !== -1) siblings.splice(idx, 1);
    this.parentElement = null;
  }
  get className() {
    return this._attrs.class || "";
  }
  set className(v) {
    this._attrs.class = v;
    (v || "").split(/\s+/).filter(Boolean).forEach((c) => this.classList.add(c));
  }
  getAttribute(name) {
    return name in this._attrs ? this._attrs[name] : null;
  }
  setAttribute(name, value) {
    this._attrs[name] = value;
    if (name === "class") (value || "").split(/\s+/).filter(Boolean).forEach((c) => this.classList.add(c));
  }
  appendChild(child) {
    this.children.push(child);
    child.parentElement = this;
    return child;
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
  insertBefore(newNode, referenceNode) {
    const idx = this.children.indexOf(referenceNode);
    this.children.splice(idx === -1 ? this.children.length : idx, 0, newNode);
    newNode.parentElement = this;
    return newNode;
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

function installGlobals({ sku = "40;11;kt-3", rateLimited = false, retryAfterMs } = {}) {
  global.window = { location: { href: "https://backpack.tf/classifieds" } };
  global.Node = { ELEMENT_NODE: 1 };
  global.MutationObserver = FakeMutationObserver;
  FakeMutationObserver.instances = [];
  // utils/pricedb.js's own in-memory cache is keyed per item name, not per
  // test - several tests below reuse buildPopover's own default "Reclaimed
  // Metal" item name with a DIFFERENT sku fixture, expecting a fresh
  // sendMessage call each time rather than a stale cached sku from whichever
  // earlier test looked it up first.
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

// The last pricedb.io search query sent (set by installGlobals' fake).
let lastSearchQuery = null;

function getPricedbButton(root) {
  return root.querySelector(".tf2te-pricedb-button");
}

function buildClassifiedsAnchor(itemName, { quality = 6, craftable = "1", australium = "-1", killstreakTier = 0 } = {}) {
  const anchor = new FakeElement("a");
  const params = new URLSearchParams({
    item: itemName,
    quality: String(quality),
    tradable: "1",
    craftable,
    australium,
    killstreak_tier: String(killstreakTier),
  });
  anchor.setAttribute("href", `/classifieds?${params.toString()}`);
  return anchor;
}

function buildItemDetailsDd(text) {
  const dd = new FakeElement("dd");
  dd.textContent = text;
  return dd;
}

function buildPopover({ itemName = "Reclaimed Metal", quality = 6, craftable = "1", australium = "-1", killstreakTier = 0, effectLine } = {}) {
  const content = new FakeElement("div");
  content.className = "popover-content";

  if (effectLine) content.appendChild(buildItemDetailsDd(`Effect: ${effectLine}`));

  const searchLinks = new FakeElement("dd");
  searchLinks.setAttribute("id", "popover-search-links");
  searchLinks.appendChild(buildClassifiedsAnchor(itemName, { quality, craftable, australium, killstreakTier }));
  content.appendChild(searchLinks);

  const additionalLinks = new FakeElement("dd");
  additionalLinks.setAttribute("id", "popover-additional-links");
  const statsButton = new FakeElement("a");
  statsButton.className = "btn btn-default btn-xs";
  statsButton.setAttribute("href", "/stats/Unique/Reclaimed%20Metal/Tradable/Craftable");
  additionalLinks.appendChild(statsButton);
  content.appendChild(additionalLinks);

  return { content, additionalLinks };
}

test("builds the pricedb.io link from the SKU pricedb's own /api/search returns for the reconstructed display name", async () => {
  installGlobals({ sku: "40;11;kt-3" });
  const { content, additionalLinks } = buildPopover({ itemName: "Backburner", quality: 11, killstreakTier: 3 });
  global.document = makeDocument([content]);

  addPricedbButton();
  await flush();

  const button = getPricedbButton(content);
  assert.ok(button);
  assert.equal(button.getAttribute("href"), "https://pricedb.io/item/40%3B11%3Bkt-3");
});

test("does not insert a button when the search comes back with no results", async () => {
  installGlobals({ sku: null });
  const { content, additionalLinks } = buildPopover({ itemName: "Nonsense" });
  global.document = makeDocument([content]);

  addPricedbButton();
  await flush();

  assert.equal(getPricedbButton(content), null);
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

test(
  "REGRESSION: a real 429 shows a non-clickable 'pricedb.io Ns' countdown span instead of silently omitting the button",
  withFakeIntervals(async () => {
    installGlobals({ rateLimited: true, retryAfterMs: 8000 });
    const { content } = buildPopover({ itemName: "Backburner", quality: 11, killstreakTier: 3 });
    global.document = makeDocument([content]);

    addPricedbButton();
    await flush();

    const button = getPricedbButton(content);
    assert.ok(button);
    assert.equal(button.tagName.toLowerCase(), "span"); // never a dead <a> with no href
    assert.equal(button.textContent, "pricedb.io 8s");
    assert.equal(button.getAttribute("href"), null);
    assert.match(button.title, /Retrying automatically in 8s/);
  })
);

test(
  "at zero the countdown swaps in a fresh lookup while the popover is open, becoming the real link",
  withFakeIntervals(async () => {
    installGlobals({ rateLimited: true, retryAfterMs: 2000 });
    const { content } = buildPopover({ itemName: "Backburner", quality: 11, killstreakTier: 3 });
    global.document = makeDocument([content]);

    addPricedbButton();
    await flush();

    global.chrome.runtime.sendMessage = async (msg) => {
      const q = new URL(msg.url).searchParams.get("q");
      return { ok: true, data: { success: true, data: { results: [{ name: q, sku: "40;11;kt-3" }] } } };
    };
    mock.timers.tick(2000);
    await flush();

    const button = getPricedbButton(content);
    assert.equal(button.tagName.toLowerCase(), "a");
    assert.equal(button.getAttribute("href"), "https://pricedb.io/item/40%3B11%3Bkt-3");
    assert.equal(content.querySelectorAll(".tf2te-pricedb-button").length, 1);
  })
);

test(
  "a closed popover's countdown ends without retrying (the next hover builds a fresh popover anyway)",
  withFakeIntervals(async () => {
    installGlobals({ rateLimited: true, retryAfterMs: 1000 });
    const { content } = buildPopover({ itemName: "Backburner", quality: 11, killstreakTier: 3 });
    global.document = makeDocument([content]);

    addPricedbButton();
    await flush();
    let lookups = 0;
    global.chrome.runtime.sendMessage = async () => {
      lookups++;
      return { ok: false, status: 429, error: "Rate limited (429)" };
    };

    getPricedbButton(content).isConnected = false; // popover closed
    mock.timers.tick(1000);
    await flush();

    assert.equal(lookups, 0);
  })
);

test("does not insert if the popover was closed (isConnected false) while resolving", async () => {
  installGlobals();
  const { content, additionalLinks } = buildPopover();
  global.document = makeDocument([content]);

  addPricedbButton();
  additionalLinks.isConnected = false;
  await flush();

  assert.equal(getPricedbButton(content), null);
});

test("does nothing when the row has no #popover-search-links classifieds anchor (markup changed)", async () => {
  installGlobals();
  const content = new FakeElement("div");
  content.className = "popover-content";
  const additionalLinks = new FakeElement("dd");
  additionalLinks.setAttribute("id", "popover-additional-links");
  content.appendChild(additionalLinks);
  global.document = makeDocument([content]);

  addPricedbButton();
  await flush();

  assert.equal(getPricedbButton(content), null);
});

test("is idempotent - running twice for the same popover doesn't duplicate the button", async () => {
  installGlobals();
  const { content, additionalLinks } = buildPopover();
  global.document = makeDocument([content]);

  addPricedbButton();
  await flush();
  addPricedbButton();
  await flush();

  assert.equal(content.querySelectorAll(".tf2te-pricedb-button").length, 1);
});

test("the MutationObserver picks up a #popover-additional-links row added later", async () => {
  installGlobals({ sku: "5021;6" });
  global.document = makeDocument([]);

  addPricedbButton();
  await flush();

  const { content, additionalLinks } = buildPopover({ itemName: "Reclaimed Metal", quality: 6 });
  document.body.appendChild(content);
  FakeMutationObserver.instances[0].cb([{ addedNodes: [content] }]);
  await flush();

  const button = getPricedbButton(content);
  assert.ok(button);
  assert.equal(button.getAttribute("href"), "https://pricedb.io/item/5021%3B6");
});

// A Strangifier's classic classifieds href says only item=Strangifier; its
// full name is the popover title. Searched as the bare tool name, pricedb.io's
// exact match was a meaningless generic "Strangifier" entry.
test("REGRESSION: a Strangifier is searched by the popover title's full name, not the bare 'Strangifier' item param", async () => {
  installGlobals({ sku: "6522;6;td-773" });
  const { content } = buildPopover({ itemName: "Strangifier", quality: 6 });
  const popover = new FakeElement("div");
  popover.className = "popover";
  const title = new FakeElement("h3");
  title.className = "popover-title";
  title.textContent = "Pretty Boy's Pocket Pistol Strangifier";
  popover.appendChild(title);
  popover.appendChild(content);
  global.document = makeDocument([popover]);

  addPricedbButton();
  await flush();

  assert.equal(lastSearchQuery, "Pretty Boy's Pocket Pistol Strangifier");
  assert.equal(getPricedbButton(content)?.getAttribute("href"), "https://pricedb.io/item/6522%3B6%3Btd-773");
});

test("a Strangifier popover with no title gets no pricedb.io button rather than a guessed one", async () => {
  installGlobals({ sku: "6522;255;td-25000" });
  const { content } = buildPopover({ itemName: "Strangifier", quality: 6 });
  global.document = makeDocument([content]);

  addPricedbButton();
  await flush();

  assert.equal(getPricedbButton(content), null);
});

function wrapInPopover(content, titleText) {
  const popover = new FakeElement("div");
  popover.className = "popover";
  const title = new FakeElement("h3");
  title.className = "popover-title";
  title.textContent = titleText;
  popover.appendChild(title);
  popover.appendChild(content);
  return popover;
}

// Reported live: the Strangifier popover's pricedb.io button found the plain
// target weapon (773;6) - its classifieds item param names the weapon, not the
// tool, so only the title says "Strangifier".
test("REGRESSION: a Strangifier whose classifieds link names only the target weapon is still searched by its full title", async () => {
  installGlobals({ sku: "6522;6;td-773" });
  const { content } = buildPopover({ itemName: "Pretty Boy's Pocket Pistol", quality: 6 });
  global.document = makeDocument([wrapInPopover(content, "Pretty Boy's Pocket Pistol Strangifier")]);

  addPricedbButton();
  await flush();

  assert.equal(lastSearchQuery, "Pretty Boy's Pocket Pistol Strangifier");
  assert.equal(getPricedbButton(content)?.getAttribute("href"), "https://pricedb.io/item/6522%3B6%3Btd-773");
});

test("the plain weapon itself (title without 'Strangifier') is still searched by its own name", async () => {
  installGlobals({ sku: "773;6" });
  const { content } = buildPopover({ itemName: "Pretty Boy's Pocket Pistol", quality: 6 });
  global.document = makeDocument([wrapInPopover(content, "Pretty Boy's Pocket Pistol")]);

  addPricedbButton();
  await flush();

  assert.equal(lastSearchQuery, "Pretty Boy's Pocket Pistol");
});
