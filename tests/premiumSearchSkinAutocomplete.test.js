import { test } from "node:test";
import assert from "node:assert/strict";
import { premiumSearchSkinAutocomplete } from "../backpack.tf/oldUI/premiumSearchSkinAutocomplete/content.js";
import { __resetWarpaintsCacheForTests } from "../utils/warpaints.js";

// Minimal hand-rolled fakes (see tests/helpers/fakeDom.js's own header on why
// this repo hand-rolls rather than pulling in jsdom). Shapes mirror real
// markup confirmed live against backpack.tf's Premium "Build a Search"
// modal's own Texture Name field - see content.js's own header note.

// warpaintsPromise is cached at module scope in utils/warpaints.js for this
// file's own lifetime (see tests/warpaints.test.js's own comment on why) -
// reset between tests so each gets its own fixture.
test.beforeEach(() => {
  __resetWarpaintsCacheForTests();
});

globalThis.chrome = { runtime: { getURL: (path) => path } };
const FIXTURE = [
  { name: "Coffin Nail", defindex: 1 },
  { name: "Cool", defindex: 2 },
  { name: "Corsair", defindex: 3 },
];
globalThis.fetch = async () => ({ json: async () => FIXTURE });

function fakeInput() {
  const listeners = {};
  const el = {
    value: "",
    insertAdjacentElement: (position, el2) => el2,
    addEventListener: (eventName, cb) => {
      listeners[eventName] = cb;
    },
    async _keydown(key) {
      const event = { key, prevented: false, preventDefault: () => (event.prevented = true) };
      await listeners.keydown?.(event);
      return event;
    },
    async _keyup(key) {
      const event = { key, preventDefault: () => {} };
      await listeners.keyup?.(event);
    },
  };
  return el;
}

// Every document.createElement() call in content.js is either "div" (the
// hint element, or the injected <style>) - a plain id property works for
// both, since real getElementById lookups here are backed by the SAME
// idRegistry a real document's own id-to-element mapping would be.
function fakeGenericElement(idRegistry) {
  const el = {
    id: "",
    textContent: "",
  };
  Object.defineProperty(el, "id", {
    get() {
      return el._id || "";
    },
    set(value) {
      el._id = value;
      idRegistry[value] = el;
    },
  });
  return el;
}

function setupDom({ input = null } = {}) {
  const idRegistry = {};

  global.document = {
    body: { nodeType: 1 },
    querySelector: (selector) => (selector === 'input.filter-text[data-key="texture_name"]' ? input : null),
    getElementById: (id) => idRegistry[id] ?? null,
    createElement: () => fakeGenericElement(idRegistry),
    head: { appendChild() {} },
  };
  global.MutationObserver = class {
    observe() {}
  };

  return { idRegistry };
}

test("does nothing when the Texture Name input isn't present", () => {
  setupDom({ input: null });
  assert.doesNotThrow(() => premiumSearchSkinAutocomplete());
});

test("inserts exactly one hint element, even across repeated calls (idempotent)", () => {
  const input = fakeInput();
  const { idRegistry } = setupDom({ input });

  premiumSearchSkinAutocomplete();
  premiumSearchSkinAutocomplete();

  assert.ok(idRegistry["tf2te-skin-autocomplete-hint"]);
  assert.equal(Object.keys(idRegistry).filter((id) => id === "tf2te-skin-autocomplete-hint").length, 1);
});

test("Tab is prevented from changing focus while there's a suggestion to autocomplete", async () => {
  const input = fakeInput();
  setupDom({ input });

  premiumSearchSkinAutocomplete();
  input.value = "co";
  await input._keyup("o");
  const event = await input._keydown("Tab");

  assert.equal(event.prevented, true);
});

// Blocking Tab unconditionally trapped keyboard focus in this field - with
// nothing to autocomplete, Tab must move focus on as normal.
test("Tab moves focus normally when there's nothing to autocomplete", async () => {
  const input = fakeInput();
  setupDom({ input });

  premiumSearchSkinAutocomplete();
  const emptyEvent = await input._keydown("Tab");
  input.value = "zzz";
  await input._keyup("z");
  const noMatchEvent = await input._keydown("Tab");

  assert.equal(emptyEvent.prevented, false);
  assert.equal(noMatchEvent.prevented, false);
});

test("typing shows the first matching skin name as a hint, case-insensitively", async () => {
  const input = fakeInput();
  const { idRegistry } = setupDom({ input });

  premiumSearchSkinAutocomplete();
  input.value = "co";
  await input._keyup("o");

  assert.equal(idRegistry["tf2te-skin-autocomplete-hint"].textContent, "Coffin Nail - Press Tab to autocomplete, press again for alternative suggestions");
});

test("clears the hint when nothing matches", async () => {
  const input = fakeInput();
  const { idRegistry } = setupDom({ input });

  premiumSearchSkinAutocomplete();
  input.value = "co";
  await input._keyup("o");
  input.value = "zzz";
  await input._keyup("z");

  assert.equal(idRegistry["tf2te-skin-autocomplete-hint"].textContent, "");
});

test("pressing Tab fills the input with the first match and clears the hint", async () => {
  const input = fakeInput();
  const { idRegistry } = setupDom({ input });

  premiumSearchSkinAutocomplete();
  input.value = "co";
  await input._keyup("o");
  await input._keyup("Tab");

  assert.equal(input.value, "Coffin Nail");
  assert.equal(idRegistry["tf2te-skin-autocomplete-hint"].textContent, "");
});

test("pressing Tab again (without retyping) cycles to the next alternative match", async () => {
  const input = fakeInput();
  setupDom({ input });

  premiumSearchSkinAutocomplete();
  input.value = "co";
  await input._keyup("o"); // matches: Coffin Nail, Cool, Corsair

  await input._keyup("Tab");
  assert.equal(input.value, "Coffin Nail");

  await input._keyup("Tab");
  assert.equal(input.value, "Cool");

  await input._keyup("Tab");
  assert.equal(input.value, "Corsair");

  await input._keyup("Tab"); // wraps back around
  assert.equal(input.value, "Coffin Nail");
});

test("pressing Tab with no current matches does nothing", async () => {
  const input = fakeInput();
  setupDom({ input });

  premiumSearchSkinAutocomplete();
  await input._keyup("Tab");

  assert.equal(input.value, "");
});
