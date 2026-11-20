import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

// tradeOffersList.js is a pages/*.js file - run shared.js's real source then
// this page's real source in the same sandbox - see tests/tradeOfferShared.test.js's
// own doc comment for the full rationale.
const sharedSrc = readFileSync(new URL("../steamcommunity.com/tradeOffer/shared.js", import.meta.url), "utf8");
const pageSrc = readFileSync(new URL("../steamcommunity.com/tradeOffer/pages/tradeOffersList.js", import.meta.url), "utf8");

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.id = "";
    this.style = {};
    this.children = [];
    this.parentNode = null;
    this._attrs = {};
    this._textContent = "";
    this._innerHTML = "";
    this._listeners = {};
    this.classList = {
      _set: new Set(),
      add: (...names) => names.forEach((n) => this.classList._set.add(n)),
      contains: (n) => this.classList._set.has(n),
    };
  }
  get textContent() { return this._textContent; }
  set textContent(v) { this._textContent = v; }
  get innerHTML() { return this._innerHTML; }
  set innerHTML(v) { this._innerHTML = v; if (v === "") this.children = []; }
  get nextSibling() {
    if (!this.parentNode) return null;
    const i = this.parentNode.children.indexOf(this);
    return this.parentNode.children[i + 1] || null;
  }
  setAttribute(name, value) { this._attrs[name] = String(value); }
  getAttribute(name) { return name in this._attrs ? this._attrs[name] : null; }
  hasAttribute(name) { return name in this._attrs; }
  appendChild(child) {
    // Real DOM semantics for a DocumentFragment: appending it moves its
    // children into the target and leaves the fragment itself empty - the
    // fragment node is never itself inserted as a child. tradeOffersList.js's
    // own summarizing logic relies on exactly this (it builds a fragment,
    // appends each summarized item + a clearfix div to it, then appends the
    // whole fragment into itemsEl in one go).
    if (child.tagName === "#fragment") {
      const kids = child.children.slice();
      child.children = [];
      kids.forEach((k) => this.appendChild(k));
      return child;
    }
    if (child.parentNode) {
      const i = child.parentNode.children.indexOf(child);
      if (i !== -1) child.parentNode.children.splice(i, 1);
    }
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  insertBefore(newNode, referenceNode) {
    if (newNode.parentNode) {
      const oldI = newNode.parentNode.children.indexOf(newNode);
      if (oldI !== -1) newNode.parentNode.children.splice(oldI, 1);
    }
    newNode.parentNode = this;
    const i = referenceNode ? this.children.indexOf(referenceNode) : -1;
    if (referenceNode === null || i === -1) {
      this.children.push(newNode);
    } else {
      this.children.splice(i, 0, newNode);
    }
    return newNode;
  }
  insertAdjacentHTML(position, html) {
    // Only 'beforebegin' is ever used in this file - record the raw HTML on
    // the parent so a test can inspect what would have been inserted,
    // without needing a real HTML parser.
    this._insertedBeforeBeginHTML = (this._insertedBeforeBeginHTML || []);
    this._insertedBeforeBeginHTML.push(html);
    if (this.parentNode) {
      this.parentNode._insertedBeforeBeginHTML = this.parentNode._insertedBeforeBeginHTML || [];
      this.parentNode._insertedBeforeBeginHTML.push(html);
    }
  }
  remove() {
    if (this.parentNode) {
      const i = this.parentNode.children.indexOf(this);
      if (i !== -1) this.parentNode.children.splice(i, 1);
      this.parentNode = null;
    }
  }
  addEventListener(type, cb) {
    (this._listeners[type] ||= []).push(cb);
  }
  dispatchEvent(evt) {
    (this._listeners[evt.type] || []).forEach((cb) => cb(evt));
    return true;
  }
  getElementsByClassName(name) {
    const out = [];
    const walk = (el) => {
      for (const child of el.children) {
        if (child.classList.contains(name)) out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
  }
  querySelector(selector) {
    const cls = selector.replace(/^\./, "");
    let found = null;
    const walk = (el) => {
      for (const child of el.children) {
        if (!found && child.classList.contains(cls)) found = child;
        if (!found) walk(child);
      }
    };
    walk(this);
    return found;
  }
}

function loadTradeoffersListPage({ tradeofferEls = [], newTradeOfferBtnEl, bodyEl } = {}) {
  const body = bodyEl || new FakeElement("body");
  const fakeDocument = {
    createElement: (tag) => new FakeElement(tag),
    createDocumentFragment: () => new FakeElement("#fragment"),
    getElementsByClassName: (name) => {
      if (name === "tradeoffer") return tradeofferEls;
      if (name === "trade_item") {
        const out = [];
        tradeofferEls.forEach((o) => out.push(...o.getElementsByClassName("trade_item")));
        return out;
      }
      return [];
    },
    querySelector: (selector) => (selector === ".new_trade_offer_btn" ? (newTradeOfferBtnEl || null) : null),
    body,
    addEventListener: () => {},
    dispatchEvent: () => true,
    execCommand: () => {},
  };
  const windowObj = {
    jQuery: undefined,
    location: { search: "" },
    __tf2teUnusualEffectsMap__: {},
    CDelayedAJAXData: class { RunWhenAJAXReady() {} },
    ShowConfirmDialog: undefined,
    ActOnTradeOffer: undefined,
  };
  windowObj.window = windowObj;

  const localStorageStore = {};
  const localStorage = {
    getItem: (k) => (k in localStorageStore ? localStorageStore[k] : null),
    setItem: (k, v) => { localStorageStore[k] = String(v); },
    removeItem: (k) => { delete localStorageStore[k]; },
    key: (i) => Object.keys(localStorageStore)[i],
    get length() { return Object.keys(localStorageStore).length; },
  };

  const sandbox = {
    window: windowObj,
    document: fakeDocument,
    localStorage,
    console,
    setTimeout: (fn) => { fn(); return 0; },
    clearTimeout: () => {},
    CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; Object.assign(this, init); } },
  };
  vm.createContext(sandbox);
  vm.runInContext(sharedSrc, sandbox);
  vm.runInContext(pageSrc, sandbox);

  const entry = sandbox.window.__tf2te__.scripts.find((s) => s.includes.some((p) => p.source.includes("tradeoffers")));
  return { sandbox, entry, DEPS: sandbox.window.__tf2te__.DEPS, body };
}

function makeReportButton({ steamid = "76561198000000001", personaname = "Some Guy" } = {}) {
  const btn = new FakeElement("a");
  btn.classList.add("btn_report");
  btn.setAttribute("onclick", `ReportTradeScam( '${steamid}', "${personaname}" )`);
  return btn;
}

function makeTradeItem({ classinfo, borderColor = "" }) {
  const el = new FakeElement("div");
  el.classList.add("trade_item");
  el.setAttribute("data-economy-item", classinfo);
  el.style.borderColor = borderColor;
  return el;
}

// --- registration / styles ------------------------------------------------

test("registers exactly one script matching .../tradeoffers URLs", () => {
  const { entry } = loadTradeoffersListPage();
  assert.ok(entry);
  assert.match("https://steamcommunity.com/id/someuser/tradeoffers", entry.includes[0]);
  assert.equal(entry.includes[0].test("https://steamcommunity.com/id/someuser/inventory"), false);
});

test("styles include the shared itemOverlay block plus this page's own decline-button/summary rules", () => {
  const { entry } = loadTradeoffersListPage();
  assert.match(entry.styles, /\.unusual \{/);
  assert.match(entry.styles, /\.decline_active_button \{/);
  // The profile buttons were once logos hotlinked from imgur.
  assert.doesNotMatch(entry.styles, /https?:\/\//);
});

// --- report-button replacement --------------------------------------------

test("fn() replaces a received offer's report button with next.backpack.tf/backpack.tf/posts.tf/rep.tf profile links, in left-to-right order", () => {
  const offerEl = new FakeElement("div");
  offerEl.classList.add("tradeoffer");
  const reportBtn = makeReportButton({ steamid: "76561198000000001", personaname: "Some Guy" });
  offerEl.appendChild(reportBtn);

  const { entry, DEPS } = loadTradeoffersListPage({ tradeofferEls: [offerEl] });
  entry.fn(DEPS);

  const html = offerEl._insertedBeforeBeginHTML.join("");
  const nextIdx = html.indexOf("next.backpack.tf");
  const bpIdx = html.indexOf("https://backpack.tf/profiles");
  const repIdx = html.indexOf("rep.tf");
  assert.ok(nextIdx !== -1 && bpIdx !== -1 && repIdx !== -1);
  // All three buttons use .btn_user_link, which floats right - so each
  // successive button in DOM/markup order docks to the LEFT of the previous
  // one, meaning DOM order ends up the reverse of final on-screen order.
  // The source's own "buttons" array is declared in the intended final
  // left-to-right visual order (next, backpack, rep) and then reversed
  // before being joined into markup (see its own "reverse to preserve
  // order" comment) specifically to compensate for that float:right
  // inversion - so the actual DOM/markup order here should be rep, then
  // backpack, then next.
  assert.ok(repIdx < bpIdx && bpIdx < nextIdx);
  // Text labels in Steam's own button markup, no images.
  for (const label of ["next.bp.tf", "bp.tf", "posts.tf", "rep.tf"]) assert.ok(html.includes(`<span>${label}</span>`), label);
  // Same link and place as the trade-offer page's partner buttons.
  const postsIdx = html.indexOf("https://posts.tf/users/76561198000000001");
  assert.ok(repIdx < postsIdx && postsIdx < bpIdx);
  assert.doesNotMatch(html, /<img|imgur/);
  // Each opens in a new tab, leaving the offers list where it was.
  assert.equal((html.match(/target="_blank" rel="noopener noreferrer"/g) || []).length, 4);
  assert.match(html, /76561198000000001/);
  assert.match(html, /Some Guy/);

  // the original report button itself is always removed, matched or not.
  assert.equal(offerEl.children.includes(reportBtn), false);
});

test("fn() HTML-escapes the trade partner's persona name, so a crafted name can't break out of the title attribute", () => {
  const offerEl = new FakeElement("div");
  offerEl.classList.add("tradeoffer");
  // What getAttribute('onclick') would hand back for a name containing
  // quotes - Steam's own JS-string escaping leaves a literal '"' behind.
  const reportBtn = makeReportButton({ personaname: '\\" onmouseover=alert(1) x=\\"<b>&$&' });
  offerEl.appendChild(reportBtn);

  const { entry, DEPS } = loadTradeoffersListPage({ tradeofferEls: [offerEl] });
  entry.fn(DEPS);

  const html = offerEl._insertedBeforeBeginHTML.join("");
  assert.doesNotMatch(html, /" onmouseover=/);
  assert.match(html, /&quot; onmouseover=alert\(1\) x=\\&quot;&lt;b&gt;&amp;\$&amp;/);
});

test("fn() removes the report button (no replacement links) when its onclick doesn't match the expected ReportTradeScam pattern", () => {
  const offerEl = new FakeElement("div");
  offerEl.classList.add("tradeoffer");
  const reportBtn = new FakeElement("a");
  reportBtn.classList.add("btn_report");
  reportBtn.setAttribute("onclick", "somethingElse()");
  offerEl.appendChild(reportBtn);

  const { entry, DEPS } = loadTradeoffersListPage({ tradeofferEls: [offerEl] });

  assert.doesNotThrow(() => entry.fn(DEPS));
  assert.equal(offerEl.children.includes(reportBtn), false);
  assert.equal(offerEl._insertedBeforeBeginHTML, undefined);
});

test("fn() leaves a sent offer (no report button at all) alone, without throwing", () => {
  const offerEl = new FakeElement("div");
  offerEl.classList.add("tradeoffer");

  const { entry, DEPS } = loadTradeoffersListPage({ tradeofferEls: [offerEl] });

  assert.doesNotThrow(() => entry.fn(DEPS));
});

// --- item-list summarizing (dedup + count badges) --------------------------

test("fn() leaves a trade_item_list with no duplicate items untouched", () => {
  const offerEl = new FakeElement("div");
  offerEl.classList.add("tradeoffer");
  const listEl = new FakeElement("div");
  listEl.classList.add("tradeoffer_item_list");
  const itemA = makeTradeItem({ classinfo: "classinfo/440/1/1" });
  const itemB = makeTradeItem({ classinfo: "classinfo/440/2/2" });
  listEl.appendChild(itemA);
  listEl.appendChild(itemB);
  offerEl.appendChild(listEl);

  const { entry, DEPS } = loadTradeoffersListPage({ tradeofferEls: [offerEl] });
  entry.fn(DEPS);

  // no dedup - the two distinct items are untouched, still direct children
  assert.equal(listEl.children.includes(itemA), true);
  assert.equal(listEl.children.includes(itemB), true);
});

test("fn() collapses duplicate items in a list into one element with a count badge, sorted unusual-first", () => {
  const offerEl = new FakeElement("div");
  offerEl.classList.add("tradeoffer");
  const listEl = new FakeElement("div");
  listEl.classList.add("tradeoffer_item_list");

  const uniqueDup1 = makeTradeItem({ classinfo: "classinfo/440/1/1", borderColor: "rgb(125, 109, 0)" }); // unique
  const uniqueDup2 = makeTradeItem({ classinfo: "classinfo/440/1/1", borderColor: "rgb(125, 109, 0)" });
  const unusualItem = makeTradeItem({ classinfo: "classinfo/440/2/2", borderColor: "rgb(134, 80, 172)" }); // unusual

  listEl.appendChild(uniqueDup1);
  listEl.appendChild(uniqueDup2);
  listEl.appendChild(unusualItem);
  offerEl.appendChild(listEl);

  const { entry, DEPS } = loadTradeoffersListPage({ tradeofferEls: [offerEl] });
  entry.fn(DEPS);

  // exactly 2 remaining item elements (the two duplicates collapsed into
  // one, kept alongside the singleton unusual item) plus 1 clearfix div.
  const remainingItemEls = listEl.children.filter((c) => c.classList.contains("trade_item"));
  assert.equal(remainingItemEls.length, 2);

  // the collapsed unique item got a count badge of 2.
  const keptUnique = remainingItemEls.find((el) => el.getAttribute("data-economy-item") === "classinfo/440/1/1");
  assert.ok(keptUnique);
  const badge = keptUnique.children.find((c) => c.classList.contains("summary_badge"));
  assert.ok(badge);
  assert.equal(badge.textContent, 2);

  // unusual items sort before unique items (color sort order).
  assert.equal(remainingItemEls[0], unusualItem);
  assert.equal(remainingItemEls[1], keptUnique);

  // the singleton unusual item never got a badge.
  assert.equal(unusualItem.children.some((c) => c.classList.contains("summary_badge")), false);
});

// --- decline-all button -----------------------------------------------

test("fn() adds no decline-all button when there is no .new_trade_offer_btn on the page", () => {
  const offerEl = new FakeElement("div");
  offerEl.classList.add("tradeoffer");

  const { entry, DEPS, body } = loadTradeoffersListPage({ tradeofferEls: [offerEl] }); // no newTradeOfferBtnEl
  entry.fn(DEPS);

  assert.equal(body.getElementsByClassName("decline_active_button").length, 0);
});

test("fn() adds no decline-all button when there are no active (non-inactive) trade offers", () => {
  const offerEl = new FakeElement("div");
  offerEl.classList.add("tradeoffer");
  const inactiveMarker = new FakeElement("div");
  inactiveMarker.classList.add("inactive");
  offerEl.appendChild(inactiveMarker); // makes isActive() false for this offer

  const btnEl = new FakeElement("a");
  btnEl.classList.add("new_trade_offer_btn");
  const parent = new FakeElement("div");
  parent.appendChild(btnEl);

  const { entry, DEPS } = loadTradeoffersListPage({ tradeofferEls: [offerEl], newTradeOfferBtnEl: btnEl });
  entry.fn(DEPS);

  assert.equal(parent.getElementsByClassName("decline_active_button").length, 0);
});

test("fn() inserts a decline-all button right after .new_trade_offer_btn when there's at least one active offer, and it declines every active offer's id on confirm", () => {
  const offerEl = new FakeElement("div");
  offerEl.id = "tradeofferid_555";
  offerEl.classList.add("tradeoffer"); // no .inactive child - active

  const btnEl = new FakeElement("a");
  btnEl.classList.add("new_trade_offer_btn");
  const siblingAfter = new FakeElement("div");
  const parent = new FakeElement("div");
  parent.appendChild(btnEl);
  parent.appendChild(siblingAfter);

  const { entry, DEPS, sandbox } = loadTradeoffersListPage({ tradeofferEls: [offerEl], newTradeOfferBtnEl: btnEl });

  const declinedIds = [];
  sandbox.window.ActOnTradeOffer = (id) => declinedIds.push(id);
  let confirmArgs = null;
  let doneCallback = null;
  sandbox.window.ShowConfirmDialog = (...args) => {
    confirmArgs = args;
    return { done: (cb) => { doneCallback = cb; } };
  };

  entry.fn(DEPS);

  // inserted directly between the button and its original next sibling
  const declineBtn = parent.children.find((c) => c.classList.contains("decline_active_button"));
  assert.ok(declineBtn);
  assert.deepEqual(parent.children, [btnEl, declineBtn, siblingAfter]);

  // clicking it shows the confirm dialog
  declineBtn.dispatchEvent({ type: "click" });
  assert.ok(confirmArgs);
  assert.equal(confirmArgs[0], "Decline Active");

  // confirming with 'OK' declines every active offer and removes the button
  doneCallback("OK");
  assert.deepEqual(declinedIds, ["555"]);
  assert.equal(parent.children.includes(declineBtn), false);
});

test("Decline All uses whichever ActOnTradeOffer exists when it's clicked, even one defined after the page script ran", () => {
  const offerEl = new FakeElement("div");
  offerEl.id = "tradeofferid_888";
  offerEl.classList.add("tradeoffer");

  const btnEl = new FakeElement("a");
  btnEl.classList.add("new_trade_offer_btn");
  const parent = new FakeElement("div");
  parent.appendChild(btnEl);

  const { entry, DEPS, sandbox } = loadTradeoffersListPage({ tradeofferEls: [offerEl], newTradeOfferBtnEl: btnEl });

  let doneCallback = null;
  sandbox.window.ShowConfirmDialog = () => ({ done: (cb) => { doneCallback = cb; } });

  entry.fn(DEPS);

  const declinedIds = [];
  sandbox.window.ActOnTradeOffer = (id) => declinedIds.push(id);

  const declineBtn = parent.children.find((c) => c.classList.contains("decline_active_button"));
  declineBtn.dispatchEvent({ type: "click" });
  doneCallback("OK");

  assert.deepEqual(declinedIds, ["888"]);
});

test("declining is skipped (button stays) when the confirm dialog resolves with anything other than 'OK'", () => {
  const offerEl = new FakeElement("div");
  offerEl.id = "tradeofferid_777";
  offerEl.classList.add("tradeoffer");

  const btnEl = new FakeElement("a");
  btnEl.classList.add("new_trade_offer_btn");
  const parent = new FakeElement("div");
  parent.appendChild(btnEl);

  const { entry, DEPS, sandbox } = loadTradeoffersListPage({ tradeofferEls: [offerEl], newTradeOfferBtnEl: btnEl });

  const declinedIds = [];
  sandbox.window.ActOnTradeOffer = (id) => declinedIds.push(id);
  let doneCallback = null;
  sandbox.window.ShowConfirmDialog = () => ({ done: (cb) => { doneCallback = cb; } });

  entry.fn(DEPS);
  const declineBtn = parent.children.find((c) => c.classList.contains("decline_active_button"));
  declineBtn.dispatchEvent({ type: "click" });
  doneCallback("Cancel");

  assert.deepEqual(declinedIds, []);
  assert.equal(parent.children.includes(declineBtn), true);
});
