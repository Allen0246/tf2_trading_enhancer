import { test } from "node:test";
import assert from "node:assert/strict";
import { createKSButtons } from "../backpack.tf/oldUI/addKSButtons/content.js";

// Minimal fake DOM element - just enough surface (style, classList, href/
// textContent, appendChild/insertBefore/querySelector/insertAdjacentElement/
// prepend, nextSibling) for createKSButtons' own DOM-orchestration to run
// against, following the same hand-rolled-fake-DOM pattern as
// tests/sellDuplicates.test.js (no jsdom in this repo).
class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.style = {};
    this.children = [];
    this.nextSibling = null;
    this._id = "";
    this._textContent = "";
    this.classList = {
      _set: new Set(),
      contains(name) {
        return this._set.has(name);
      },
      add(...names) {
        for (const name of names) this._set.add(name);
      },
    };
    this._querySelectorResult = null; // set per-instance by the test fixture
  }
  get id() {
    return this._id;
  }
  set id(v) {
    this._id = v;
  }
  get textContent() {
    return this._textContent;
  }
  set textContent(v) {
    this._textContent = v;
  }
  get href() {
    return this._href;
  }
  set href(v) {
    // Mirrors a real <a>'s href IDL attribute (a DOMString), which coerces
    // whatever's assigned via ToString() - addKsURL returns a URL instance
    // (not a string), same as a real anchor's href would silently stringify
    // it rather than storing the object as-is.
    this._href = String(v);
  }
  appendChild(child) {
    this.children.push(child);
    child.parentEl = this;
    return child;
  }
  insertBefore(newNode, referenceNode) {
    const idx = referenceNode ? this.children.indexOf(referenceNode) : this.children.length;
    this.children.splice(idx === -1 ? this.children.length : idx, 0, newNode);
    return newNode;
  }
  prepend(node) {
    this.children.unshift(node);
  }
  insertAdjacentElement(_position, node) {
    // "afterend" is the only position content.js ever uses - approximated as
    // appending to this element's own parent's children, right after self.
    if (this.parentEl) {
      const idx = this.parentEl.children.indexOf(this);
      this.parentEl.children.splice(idx + 1, 0, node);
    }
    return node;
  }
  querySelector(selector) {
    if (this._querySelectors && selector in this._querySelectors) return this._querySelectors[selector];
    return this._querySelectorResult;
  }
}

function installDom({ headerControls = null, panelBody = null, ksTierNavExists = false, existingKillstreakList = null } = {}) {
  global.location = { origin: "https://backpack.tf" };
  global.document = {
    getElementsByClassName: (name) => (name === "stats-header-controls" && headerControls ? [headerControls] : []),
    querySelector: (selector) => {
      if (selector === ".panel.panel-main .panel-body") return panelBody;
      if (selector === ".stats-killstreak-list") return existingKillstreakList;
      return null;
    },
    getElementById: (id) => (id === "ks-tier-nav" && ksTierNavExists ? new FakeElement("div") : null),
    createElement: (tag) => new FakeElement(tag),
  };
}

test("createKSButtons does nothing for a URL that's neither /stats nor /classifieds", () => {
  installDom();
  // No throw, and (implicitly) neither branch's own DOM queries ran, since
  // both would themselves no-op safely anyway with nothing installed.
  createKSButtons("https://backpack.tf/");
});

test("createKSButtons adds nothing on a /classifieds sub-page like the create-listing form", () => {
  const panelBody = new FakeElement("div");
  installDom({ panelBody });

  createKSButtons("https://backpack.tf/classifieds/sell/17599841419");

  assert.equal(panelBody.children.length, 0);
});

// --- /stats page --------------------------------------------------------

test("createKSButtons on /stats does nothing when the page's own header controls aren't present", () => {
  installDom({ headerControls: null });
  createKSButtons("https://backpack.tf/stats/Unique/Rocket%20Launcher/Tradable/Craftable");
  // No throw is the only assertion possible here - nothing to inspect.
});

test("createKSButtons on /stats builds 4 tier buttons and marks the currently-active one via the item name's own KS prefix", () => {
  const headerControls = new FakeElement("div");
  const qualityDiv = new FakeElement("div");
  headerControls._querySelectorResult = qualityDiv; // querySelector("div") -> Quality div
  headerControls.appendChild(qualityDiv);
  installDom({ headerControls });

  createKSButtons("https://backpack.tf/stats/Unique/Professional%20Killstreak%20Rocket%20Launcher/Tradable/Craftable");

  // divButtons was inserted right before qualityDiv.nextSibling (null here,
  // so both the <br> and divButtons ended up appended at the end, after the
  // quality div itself, per the insertBefore(node, null) -> append semantics
  // this fake mirrors).
  const divButtons = headerControls.children.find((c) => c.classList.contains("stats-killstreak-list"));
  assert.ok(divButtons, "expected a .stats-killstreak-list div to have been inserted");
  assert.equal(divButtons.children.length, 4);

  const labels = divButtons.children.map((btn) => btn.textContent);
  assert.deepEqual(labels, ["No Kit", "Normal KS", "Specialized KS", "Professional KS"]);

  const activeLabels = divButtons.children.filter((btn) => btn.classList.contains("active")).map((btn) => btn.textContent);
  assert.deepEqual(activeLabels, ["Professional KS"]);

  // Professional KS's own href rewrites the item name segment back to itself
  // (round-trip), decoded and re-encoded. addKsURL returns a real URL
  // instance (not a pre-stringified href) - a real <a>.href setter coerces
  // that via its own toString(), which this fake doesn't, so String() it.
  const proBtn = divButtons.children.find((btn) => btn.textContent === "Professional KS");
  assert.match(String(proBtn.href), /\/stats\/Unique\/Professional%20Killstreak%20Rocket%20Launcher\//);

  // No Kit's own href strips the KS prefix entirely.
  const noKitBtn = divButtons.children.find((btn) => btn.textContent === "No Kit");
  assert.match(String(noKitBtn.href), /\/stats\/Unique\/Rocket%20Launcher\//);
});

// Confirmed live DUPLICATE BUG regression: if createButtonsStats ever runs
// twice on the same page (see content.js's own new header note on
// createButtonsStats for the confirmed-live scenario - the content script
// itself executing more than once), the second call must be a no-op rather
// than building a second ".stats-killstreak-list" bar - a global check
// (document.querySelector, not scoped to headerControls), since by the time
// a second call happens the real one may already have been relocated
// elsewhere by ../statsPageQuickLinks/content.js's own relocateKillstreakTabs.
test("createKSButtons on /stats never inserts a second tier-nav bar when one already exists anywhere on the page", () => {
  const headerControls = new FakeElement("div");
  const qualityDiv = new FakeElement("div");
  headerControls._querySelectorResult = qualityDiv;
  headerControls.appendChild(qualityDiv);
  const existingKillstreakList = new FakeElement("div");
  installDom({ headerControls, existingKillstreakList });

  createKSButtons("https://backpack.tf/stats/Unique/Rocket%20Launcher/Tradable/Craftable");

  assert.equal(headerControls.children.length, 1); // just the quality div, nothing appended
});

test("createKSButtons on /stats inserts before the quality div's own next sibling when one exists, keeping relative order", () => {
  const headerControls = new FakeElement("div");
  const qualityDiv = new FakeElement("div");
  const trailingBr = new FakeElement("br");
  headerControls._querySelectorResult = qualityDiv;
  headerControls.appendChild(qualityDiv);
  headerControls.appendChild(trailingBr);
  qualityDiv.nextSibling = trailingBr;
  installDom({ headerControls });

  createKSButtons("https://backpack.tf/stats/Unique/Rocket%20Launcher/Tradable/Craftable");

  // divButtons and a fresh <br> both got inserted right before trailingBr -
  // final order: qualityDiv, divButtons, newBr, trailingBr.
  assert.equal(headerControls.children[0], qualityDiv);
  assert.ok(headerControls.children[1].classList.contains("stats-killstreak-list"));
  assert.equal(headerControls.children[3], trailingBr);
});

// --- /classifieds page ---------------------------------------------------

test("createKSButtons on /classifieds does nothing when the page's own panel body isn't present", () => {
  installDom({ panelBody: null });
  createKSButtons("https://backpack.tf/classifieds?item=Rocket+Launcher");
});

test("createKSButtons on /classifieds does not insert a duplicate nav if #ks-tier-nav is already present", () => {
  const panelBody = new FakeElement("div");
  installDom({ panelBody, ksTierNavExists: true });

  createKSButtons("https://backpack.tf/classifieds?item=Rocket+Launcher");

  assert.equal(panelBody.children.length, 0);
});

test("createKSButtons on /classifieds builds 4 tier buttons, marks killstreak_tier's own current value active, and rounds the outer corners", () => {
  const panelBody = new FakeElement("div");
  installDom({ panelBody });

  createKSButtons("https://backpack.tf/classifieds?item=Rocket+Launcher&killstreak_tier=3");

  const navWrap = panelBody.children.find((c) => c.id === "ks-tier-nav");
  assert.ok(navWrap, "expected a #ks-tier-nav div to have been prepended");
  assert.equal(navWrap.children.length, 4);

  const activeLabels = navWrap.children.filter((btn) => btn.classList.contains("active")).map((btn) => btn.textContent);
  assert.deepEqual(activeLabels, ["Professional KS"]);

  assert.equal(navWrap.children[0].style.borderRadius, "5px 0 0 5px");
  assert.equal(navWrap.children[3].style.borderRadius, "0 5px 5px 0");
  assert.equal(navWrap.children[1].style.borderRadius, undefined);

  // Every button's own href carries the OTHER existing filter (item=...)
  // through unchanged, alongside its own tierValue.
  const normalBtn = navWrap.children.find((btn) => btn.textContent === "Normal KS");
  const url = new URL(normalBtn.href, "https://backpack.tf/classifieds");
  assert.equal(url.searchParams.get("item"), "Rocket Launcher");
  assert.equal(url.searchParams.get("killstreak_tier"), "1");
});

test("createKSButtons on /classifieds prepends the nav directly when there's no #search-crumbs to insert after", () => {
  const panelBody = new FakeElement("div");
  installDom({ panelBody });

  createKSButtons("https://backpack.tf/classifieds?item=Rocket+Launcher");

  assert.equal(panelBody.children[0].id, "ks-tier-nav");
});

test("createKSButtons on /classifieds inserts the nav right after #search-crumbs when present", () => {
  const panelBody = new FakeElement("div");
  const crumbs = new FakeElement("div");
  crumbs.id = "search-crumbs";
  panelBody._querySelectors = { "#search-crumbs": crumbs };
  panelBody.appendChild(crumbs);
  installDom({ panelBody });

  createKSButtons("https://backpack.tf/classifieds?item=Rocket+Launcher");

  assert.equal(panelBody.children[0], crumbs);
  assert.equal(panelBody.children[1].id, "ks-tier-nav");
});

// --- default (no-tier) href round-trip on /stats, defensive edge case ----

test("createKSButtons on /stats leaves an item name with no KS prefix at all untouched by the No Kit button's own href", () => {
  const headerControls = new FakeElement("div");
  const qualityDiv = new FakeElement("div");
  headerControls._querySelectorResult = qualityDiv;
  headerControls.appendChild(qualityDiv);
  installDom({ headerControls });

  createKSButtons("https://backpack.tf/stats/Strange/Voodoo%20Juju/Tradable/Craftable");

  const divButtons = headerControls.children.find((c) => c.classList.contains("stats-killstreak-list"));
  const activeLabels = divButtons.children.filter((btn) => btn.classList.contains("active")).map((btn) => btn.textContent);
  assert.deepEqual(activeLabels, ["No Kit"]);
});
