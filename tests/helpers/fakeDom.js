// Shared hand-rolled fake-DOM helper for the scrap.tf DOM-orchestration test
// files (itemLinks/itemCard.js, scrap.tf/content.js router, and others).
// NOT a new runtime dependency - this is test-only code, following the same
// "no jsdom" hand-rolled FakeElement approach tests/sellDuplicates.test.js
// established, just factored out once instead of re-derived per file since
// several of these files build/query real innerHTML-based markup (panel.js's
// own panel skeleton, itemCard.js's own item card skeleton) that a bare
// query-returns-a-canned-array fake (sellDuplicates.test.js's own style)
// can't support - those need an actual (tiny) HTML-to-element parser so the
// code's own later `panel.querySelector(".pgf-scan-btn")`-style calls find
// real elements, not just top-level document queries the test controls
// directly.
//
// Deliberately NOT a full HTML/CSS engine - just enough to parse the simple,
// well-formed, non-self-referential templates these two files actually
// write (nested div/span/button/select/option, quoted attributes, boolean
// attributes like `hidden`/`selected`), and to resolve the single-class/
// single-id selectors (".foo", "#foo") those same files query with. Compound
// or attribute-bracket selectors (e.g. dom.js's own
// ".item.hoverable[data-defindex]") are never resolved through this parser -
// every test that needs one of those instead overrides the top-level fake
// `document.querySelectorAll` directly to return a canned fixture array
// (same approach tests/sellDuplicates.test.js already
// uses), since the interesting logic there is what the CALLER does with the
// results, not genuine CSS selector matching.

let idsMap = new Map();

/*
@description: Resets the shared id registry (and FakeMutationObserver's
captured instances) - call from test.beforeEach so ids/observers from one
test can't leak into the next, same idea as sellDuplicates.test.js's own
per-test `attachedById = new Map()` reset.
*/
export function resetFakeDom() {
  idsMap = new Map();
  FakeMutationObserver.instances = [];
}

function camelCase(str) {
  return str.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

// Supports both direct property assignment (el.style.color = "red") and the
// setProperty/getPropertyValue method pair real CSSStyleDeclaration objects
// use for CUSTOM properties (--foo), which most code sets via
// style.setProperty("--foo", ...) rather than bracket assignment - added for
// backpack.tf/oldUI/listingQueue/content.js's own per-row quality-color
// custom property.
function makeStyle() {
  return {
    setProperty(name, value) {
      this[name] = value;
    },
    getPropertyValue(name) {
      return this[name] || "";
    },
  };
}

function makeClassList() {
  return {
    _set: new Set(),
    contains(name) {
      return this._set.has(name);
    },
    add(name) {
      this._set.add(name);
    },
    remove(name) {
      this._set.delete(name);
    },
    toggle(name, force) {
      const shouldHave = force === undefined ? !this._set.has(name) : force;
      if (shouldHave) this._set.add(name);
      else this._set.delete(name);
      return shouldHave;
    },
  };
}

function tokenizeSelector(selector) {
  return selector.match(/#[^.#\[]+|\.[^.#\[]+|\[[^\]]+\]/g) || [selector];
}

function elementMatchesToken(el, token) {
  if (token.startsWith("#")) return el.id === token.slice(1);
  if (token.startsWith(".")) return el.classList.contains(token.slice(1));
  const prefixMatch = /^\[id\^="([^"]+)"\]$/.exec(token);
  if (prefixMatch) return typeof el.id === "string" && el.id.startsWith(prefixMatch[1]);
  const exactAttr = /^\[([a-zA-Z0-9_-]+)="([^"]*)"\]$/.exec(token);
  if (exactAttr) return el.getAttribute(exactAttr[1]) === exactAttr[2];
  const presentAttr = /^\[([a-zA-Z0-9_-]+)\]$/.exec(token);
  if (presentAttr) return el.getAttribute(presentAttr[1]) !== null;
  // Bare tag name (e.g. "a", "div") - added for
  // steamcommunity.com/tradeHistoryFetch/content.js's own parsePartner,
  // which queries a plain "a" the same way real DOM code naturally would.
  if (/^[a-zA-Z][a-zA-Z0-9]*$/.test(token)) return el.tagName === token.toUpperCase();
  return false;
}

function elementMatchesSelector(el, selector) {
  const tokens = tokenizeSelector(selector);
  return tokens.every((t) => elementMatchesToken(el, t));
}

function walk(el, visit) {
  for (const child of el.children) {
    visit(child);
    walk(child, visit);
  }
}

export class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this._id = "";
    this._textContent = "";
    this._attributes = {};
    this.dataset = {};
    this.style = makeStyle();
    this.classList = makeClassList(this);
    this.children = [];
    this.parentNode = null;
    this._listeners = {};
    this.disabled = false;
    this.hidden = false;
  }

  get id() {
    return this._id;
  }
  set id(v) {
    this._id = v;
    if (v) idsMap.set(v, this);
  }

  // Added for backpack.tf/shared/colorLegendContent.js's own insertion
  // callers (nextUI/premiumSearchLastSeenHighlight/content.js's own
  // insertLegendStrip idempotency check reads previousElementSibling; its
  // own test reads nextElementSibling) - every child in this fake's own
  // .children array is already an element (no separate text-node tracking),
  // so this is just the immediate neighbor in that array, or null past
  // either end/with no parent.
  get nextElementSibling() {
    if (!this.parentNode) return null;
    const idx = this.parentNode.children.indexOf(this);
    return idx === -1 ? null : this.parentNode.children[idx + 1] || null;
  }
  // Like the real DOM: connected when an ancestor chain reaches the fake
  // document's <html> root (createFakeDocument's documentElement).
  get isConnected() {
    let el = this;
    while (el.parentNode) el = el.parentNode;
    return el.tagName === "HTML";
  }

  get previousElementSibling() {
    if (!this.parentNode) return null;
    const idx = this.parentNode.children.indexOf(this);
    return idx <= 0 ? null : this.parentNode.children[idx - 1] || null;
  }

  get textContent() {
    // Aggregates own text plus every child's own textContent, same as a
    // real DOM node - needed so an element whose content was set via
    // `.innerHTML = "plain text"` or `.innerHTML = "<span>...</span>"` (not
    // just via a direct `.textContent =` assignment) still reads back
    // correctly - dom.js's own stripTags relies on exactly this round-trip
    // (innerHTML in, textContent out) to strip tags/decode entities.
    return this._textContent + this.children.map((c) => c.textContent).join("");
  }
  set textContent(v) {
    this._textContent = v;
    this.children = [];
  }

  set innerHTML(html) {
    const { children, rootText } = parseHtml(html || "");
    this.children = children;
    for (const child of children) child.parentNode = this;
    this._textContent = rootText;
  }
  get innerHTML() {
    return "";
  }

  get className() {
    return Array.from(this.classList._set).join(" ");
  }
  set className(v) {
    this.setAttribute("class", v);
  }

  setAttribute(name, value) {
    const v = value === undefined ? "" : String(value);
    this._attributes[name] = v;
    if (name === "class") {
      this.classList._set.clear();
      for (const c of v.split(/\s+/).filter(Boolean)) this.classList._set.add(c);
    } else if (name === "id") {
      this.id = v;
    } else if (name.startsWith("data-")) {
      this.dataset[camelCase(name.slice(5))] = v;
    } else if (name === "disabled") {
      // Reflects the HTML attribute onto the IDL property, same as a real
      // button/input/select - needed for elements whose initial disabled
      // state is set via a hardcoded template attribute (e.g. panel.js's own
      // "Buyer profit" sort button, disabled by default since "suggested" is
      // the starting mode) rather than a later `.disabled = true` assignment.
      this.disabled = true;
    } else if (name === "value") {
      // Same reflection gap as "disabled" above, for <input value="...">
      // parsed straight out of a raw HTML template - without this,
      // `.value` stays undefined until something explicitly assigns it as a
      // property, even though `.checked`/getAttribute("value") look correct.
      this.value = v;
    }
  }
  getAttribute(name) {
    return name in this._attributes ? this._attributes[name] : null;
  }
  removeAttribute(name) {
    delete this._attributes[name];
    if (name === "class") this.classList._set.clear();
    else if (name.startsWith("data-")) delete this.dataset[camelCase(name.slice(5))];
  }
  hasAttribute(name) {
    return name in this._attributes;
  }

  appendChild(child) {
    this.children.push(child);
    child.parentNode = this;
    if (child.id) idsMap.set(child.id, child);
    return child;
  }
  // referenceNode === null/undefined appends at the end, matching real
  // Node.insertBefore semantics - needed by any feature that inserts its own
  // section ahead of an existing page element rather than appending.
  insertBefore(newNode, referenceNode) {
    const idx = referenceNode ? this.children.indexOf(referenceNode) : -1;
    if (idx === -1) this.children.push(newNode);
    else this.children.splice(idx, 0, newNode);
    newNode.parentNode = this;
    if (newNode.id) idsMap.set(newNode.id, newNode);
    return newNode;
  }
  append(...items) {
    for (const item of items) {
      if (item && typeof item === "object" && "tagName" in item) this.appendChild(item);
      // A string is a text node in the real DOM. Folded into this element's
      // own text, which textContent reads first - exact for the trailing
      // text these callers append (e.g. a countdown's " 12s" after an icon).
      else if (typeof item === "string") this._textContent += item;
    }
  }
  // This used to ignore `position` entirely and just append `el` to the end
  // of this.parentNode's own children regardless - harmless for every
  // earlier caller (each only ever called this on the LAST child of its own
  // parent, where "append to the end" and "insert right after this" happen
  // to land in the same spot), but
  // backpack.tf/nextUI/premiumSearchLastSeenHighlight/content.js's own
  // insertLegendStrip calls "beforebegin" on an element that ISN'T the last
  // child, which this silently misplaced - now handles all four real
  // insertAdjacentElement positions properly.
  insertAdjacentElement(position, el) {
    if (position === "afterbegin") {
      this.children.unshift(el);
      el.parentNode = this;
      if (el.id) idsMap.set(el.id, el);
      return el;
    }
    if (position === "beforeend") {
      this.children.push(el);
      el.parentNode = this;
      if (el.id) idsMap.set(el.id, el);
      return el;
    }

    if (!this.parentNode) return el; // no sibling context to insert "beforebegin"/"afterend" into

    const siblings = this.parentNode.children;
    const idx = siblings.indexOf(this);
    const insertAt = position === "beforebegin" ? idx : idx + 1; // default (incl. "afterend") inserts after this
    siblings.splice(insertAt, 0, el);
    el.parentNode = this.parentNode;
    if (el.id) idsMap.set(el.id, el);
    return el;
  }
  remove() {
    if (this.parentNode) {
      this.parentNode.children = this.parentNode.children.filter((c) => c !== this);
    }
    if (this._id) idsMap.delete(this._id);
  }

  // Shallow attrs/classList/text always copied; children only when deep is
  // true - matches real Node.cloneNode(deep) semantics, for any feature that
  // clones real page elements rather than building fresh ones.
  cloneNode(deep) {
    const clone = new FakeElement(this.tagName);
    clone._id = this._id;
    clone._textContent = this._textContent;
    clone._attributes = { ...this._attributes };
    clone.dataset = { ...this.dataset };
    clone.classList._set = new Set(this.classList._set);
    if (deep) {
      clone.children = this.children.map((child) => {
        const childClone = child.cloneNode(true);
        childClone.parentNode = clone;
        return childClone;
      });
    }
    return clone;
  }

  closest(selector) {
    let el = this;
    while (el) {
      if (elementMatchesSelector(el, selector)) return el;
      el = el.parentNode;
    }
    return null;
  }

  querySelector(selector) {
    let found = null;
    walk(this, (el) => {
      if (!found && elementMatchesSelector(el, selector)) found = el;
    });
    return found;
  }
  querySelectorAll(selector) {
    const results = [];
    walk(this, (el) => {
      if (elementMatchesSelector(el, selector)) results.push(el);
    });
    return results;
  }

  addEventListener(type, cb) {
    (this._listeners[type] ||= []).push(cb);
  }
  removeEventListener(type, cb) {
    if (!this._listeners[type]) return;
    this._listeners[type] = this._listeners[type].filter((l) => l !== cb);
  }
  dispatchEvent(evt) {
    const results = (this._listeners[evt.type] || []).map((cb) => cb(evt));
    return Promise.all(results);
  }

  // Real Element.click() synchronously fires a "click" listener - needed by
  // any feature that calls .click() directly on a real page element to drive
  // that site's own click handling rather than reimplementing it.
  click() {
    this.dispatchEvent({ type: "click" });
  }

  scrollIntoView() {}

  // Zero-size by default (this fake does no real layout) - a test that cares
  // about a specific measured size overrides this directly on the instance
  // (e.g. `el.getBoundingClientRect = () => ({width: 400, ...})`), same
  // pattern already used for simulateFullClick's own needs elsewhere.
  getBoundingClientRect() {
    return { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };
  }
}

// A very small recursive-descent-ish parser for the flat, well-formed
// templates panel.js/modal.js actually write (see file header) - matches one
// tag (open/close/self-closing) or a text run at a time, left to right.
function parseHtml(html) {
  const VOID_TAGS = new Set(["br", "input", "img", "hr"]);
  const tagRe = /<(\/)?([a-zA-Z][a-zA-Z0-9]*)([^<>]*)>/g;
  const attrRe = /([a-zA-Z0-9_-]+)(?:="([^"]*)")?/g;

  const rootChildren = [];
  const rootNode = { children: rootChildren, _textContent: "", isRoot: true };
  const stack = [rootNode];
  let lastIndex = 0;
  let m;

  function appendText(text) {
    if (!text.trim()) return;
    stack[stack.length - 1]._textContent += text;
  }

  while ((m = tagRe.exec(html))) {
    appendText(html.slice(lastIndex, m.index));
    lastIndex = tagRe.lastIndex;

    const [full, closing, tagName, rawAttrs] = m;

    if (closing) {
      if (stack.length > 1) stack.pop();
      continue;
    }

    const el = new FakeElement(tagName);
    let am;
    attrRe.lastIndex = 0;
    while ((am = attrRe.exec(rawAttrs))) {
      const [, name, value] = am;
      if (name === "/") continue;
      el.setAttribute(name, value === undefined ? "" : value);
    }

    const top = stack[stack.length - 1];
    (top.isRoot ? top.children : top.children).push(el);
    el.parentNode = top.isRoot ? null : top;

    const selfClosing = full.trim().endsWith("/>") || VOID_TAGS.has(tagName.toLowerCase());
    if (!selfClosing) stack.push(el);
  }
  appendText(html.slice(lastIndex));

  // Real <select> elements resolve their own .value from whichever <option>
  // carries the `selected` attribute (falling back to the first option) -
  // approximated here since nothing else in this parser simulates native
  // form-control behavior.
  const allEls = [];
  for (const c of rootChildren) {
    allEls.push(c);
    walk(c, (el) => allEls.push(el));
  }
  for (const el of allEls) {
    if (el.tagName !== "SELECT") continue;
    const options = el.children.filter((c) => c.tagName === "OPTION");
    const selected = options.find((o) => o.hasAttribute("selected")) || options[0];
    el.value = selected ? selected.getAttribute("value") : "";
  }

  return { children: rootChildren, rootText: rootNode._textContent };
}

export class FakeMutationObserver {
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

/*
@description: Builds a fresh document-like object with real head/
documentElement/body FakeElements (so `document.head.appendChild(...)`
etc. work exactly like the real DOM) and a working createElement/
getElementById - querySelector/querySelectorAll default to "nothing found"
and are meant to be overridden per test (same convention
tests/sellDuplicates.test.js already uses) since the
top-level page shape is whatever each test wants to fake, not something this
generic parser can usefully synthesize.
*/
/*
@description: Flattens an element's own text plus every descendant's text
(depth-first) into one string - needed because this parser keeps
`.textContent` independent of `.children` (same convention
tests/sellDuplicates.test.js's own FakeElement already uses), so a container
whose content was set via `.innerHTML = "<span>...</span><span>...</span>"`
(panel.js's own renderResults does this for its prices/key-values lines)
has an empty `.textContent` of its own - the real text lives on its parsed
child elements instead.
*/
export function textOf(el) {
  let text = el._textContent || "";
  for (const child of el.children) text += textOf(child);
  return text;
}

/*
@description: Stand-in for the browser's DOMParser (Node has none). Only
supports parseFromString(html, "text/html") -> { body }, with body built by
the same parser FakeElement's innerHTML setter uses. Each call is recorded in
FakeDOMParser.calls so tests can assert what was parsed.
*/
export class FakeDOMParser {
  static calls = [];

  parseFromString(html, mimeType) {
    FakeDOMParser.calls.push({ html, mimeType });
    const body = new FakeElement("body");
    body.innerHTML = html;
    return { body };
  }
}

export function createFakeDocument({ querySelector = () => null, querySelectorAll = () => [] } = {}) {
  const head = new FakeElement("head");
  const documentElement = new FakeElement("html");
  const body = new FakeElement("body");
  documentElement.appendChild(head);
  documentElement.appendChild(body);

  // Same minimal { type: [cb] } shape FakeElement's own addEventListener/
  // dispatchEvent already use - added for code that wires a document-level
  // "click anywhere closes this" listener (e.g. panel.js's own tab dropdown)
  // rather than a per-element one.
  const listeners = {};

  return {
    head,
    documentElement,
    body,
    createElement: (tag) => new FakeElement(tag),
    createElementNS: (_ns, tag) => new FakeElement(tag),
    getElementById: (id) => idsMap.get(id) || null,
    querySelector,
    querySelectorAll,
    addEventListener(type, cb) {
      (listeners[type] ||= []).push(cb);
    },
    removeEventListener(type, cb) {
      if (!listeners[type]) return;
      listeners[type] = listeners[type].filter((l) => l !== cb);
    },
    dispatchEvent(evt) {
      const results = (listeners[evt.type] || []).map((cb) => cb(evt));
      return Promise.all(results);
    },
  };
}
