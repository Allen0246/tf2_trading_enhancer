import { test } from "node:test";
import assert from "node:assert/strict";
import { steamLinks, isExcludedProfileSubpath } from "../steamcommunity.com/steamLinks/content.js";

// Fakes chrome.runtime.getURL to resolve to the real on-disk utils/repTfInfo.js
// (relative to this file, matching the real steamcommunity.com/steamLinks
// layout - same pattern tests/background.test.js established) so
// showRepCheckStatus's own dynamic import loads the actual production module,
// with only its own chrome.runtime.sendMessage FETCH_JSON relay faked (same
// fixture shape as tests/repTfInfo.test.js) - repTfInfo.js's own internals
// already have dedicated tests.
function fakeGetURL(path) {
  return new URL(`../${path}`, import.meta.url).href;
}

function createFakeElement(tag) {
  const classes = new Set();
  return {
    tagName: tag,
    style: {},
    _textContent: "",
    get textContent() {
      return this._textContent;
    },
    set textContent(v) {
      this._textContent = v;
    },
    classList: {
      add: (...names) => names.forEach((n) => classes.add(n)),
      _set: classes,
    },
    children: [],
    appendChild(el) {
      this.children.push(el);
      return el;
    },
  };
}

function installGlobals({ hostHtml = "", locationButtons = undefined, pathname = "/id/someuser" } = {}) {
  const buttonsEl = locationButtons === undefined ? createFakeElement("div") : locationButtons;

  globalThis.document = {
    getElementsByClassName: (className) => {
      if (className === "profile_header_actions") return buttonsEl ? [buttonsEl] : [];
      if (className === "responsive_page_template_content") return hostHtml ? [{ innerHTML: hostHtml }] : [];
      return [];
    },
    createElement: (tag) => createFakeElement(tag),
  };
  globalThis.window = { location: { href: `https://steamcommunity.com${pathname}` } };

  let sendMessageImpl = async () => ({ ok: true, data: { success: true } });
  const storageStore = {};
  globalThis.chrome = {
    runtime: {
      getURL: fakeGetURL,
      sendMessage: (msg) => sendMessageImpl(msg),
    },
    // Backs utils/repTfInfo.js's own failure-backoff tracking (see
    // utils/failureBackoff.js) - these tests don't exercise backoff
    // behavior directly, just need a working store so it doesn't throw.
    storage: {
      local: {
        async get(keys) {
          const result = {};
          for (const k of keys) if (k in storageStore) result[k] = storageStore[k];
          return result;
        },
        async set(obj) {
          Object.assign(storageStore, obj);
        },
      },
    },
  };

  return {
    buttonsEl,
    setSendMessageImpl: (fn) => {
      sendMessageImpl = fn;
    },
  };
}

const VALID_HOST_HTML = 'g_rgProfileData = {"steamid":"76561198000000000","personaname":"Someone"};';

async function flush() {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

// --- isExcludedProfileSubpath -----------------------------------------

test("isExcludedProfileSubpath matches a whole path segment, e.g. /id/x/inventory", () => {
  assert.equal(isExcludedProfileSubpath("/id/someuser/inventory"), true);
  assert.equal(isExcludedProfileSubpath("/profiles/123/tradeoffers"), true);
});

test("isExcludedProfileSubpath returns false for a plain profile root path", () => {
  assert.equal(isExcludedProfileSubpath("/id/someuser"), false);
  assert.equal(isExcludedProfileSubpath("/profiles/76561198000000000"), false);
});

test("isExcludedProfileSubpath does not mistake a vanity name merely containing an excluded word for the actual subpage", () => {
  // "/id/homerun_bot" - "homerun_bot" is a whole segment, not literally "home".
  assert.equal(isExcludedProfileSubpath("/id/homerun_bot"), false);
});

// Every path segment used to be checked, the vanity name included, so a
// profile whose vanity URL is exactly an excluded word ("/id/home",
// "/id/games/") got no links at all.
test("REGRESSION: isExcludedProfileSubpath never treats the vanity name itself as the excluded subpage", () => {
  assert.equal(isExcludedProfileSubpath("/id/home"), false);
  assert.equal(isExcludedProfileSubpath("/id/games/"), false);
  assert.equal(isExcludedProfileSubpath("/id/games/inventory"), true);
  assert.equal(isExcludedProfileSubpath("/id/home/home"), true);
});

// --- steamLinks() --------------------------------------------------------

test("steamLinks does nothing on an excluded profile subpath", () => {
  const { buttonsEl } = installGlobals({ hostHtml: VALID_HOST_HTML, pathname: "/id/someuser/inventory" });

  steamLinks();

  assert.equal(buttonsEl.children.length, 0);
});

test("steamLinks does nothing when .profile_header_actions isn't found on the page", () => {
  installGlobals({ hostHtml: VALID_HOST_HTML, locationButtons: null });

  // Should not throw even though there's nowhere to insert into.
  assert.doesNotThrow(() => steamLinks());
});

test("steamLinks does not insert dead links when the steamid64 can't be extracted from the page", () => {
  const { buttonsEl } = installGlobals({ hostHtml: "" }); // no steamid/personaname markers

  steamLinks();

  assert.equal(buttonsEl.children.length, 0);
});

test("steamLinks inserts a row-break plus one link per site, each with the correct href/label/classes", () => {
  const { buttonsEl } = installGlobals({ hostHtml: VALID_HOST_HTML });

  steamLinks();

  // rowBreak + 5 site links + the rep.tf banner (neutral until rep.tf answers).
  assert.equal(buttonsEl.children.length, 7);

  const rowBreak = buttonsEl.children[0];
  assert.match(rowBreak.style.cssText, /flex-basis: 100%/);

  const links = buttonsEl.children.slice(1, 6);
  const expected = [
    { label: "next.bp.tf", href: "https://next.backpack.tf/profiles/76561198000000000" },
    { label: "bp.tf", href: "https://backpack.tf/profiles/76561198000000000" },
    { label: "posts.tf", href: "https://posts.tf/users/76561198000000000" },
    { label: "rep.tf", href: "https://rep.tf/76561198000000000" },
    { label: "steamdb.info", href: "https://steamdb.info/calculator/76561198000000000" },
  ];

  links.forEach((link, i) => {
    assert.equal(link.href, expected[i].href);
    assert.equal(link.target, "_blank");
    assert.equal(link.rel, "noopener noreferrer");
    assert.equal(link.classList._set.has("btn_profile_action"), true);
    assert.equal(link.classList._set.has("btn_medium"), true);
    // label is wrapped in a child <span>, per createElement("span") + appendChild.
    assert.equal(link.children[0].textContent, expected[i].label);
  });
});

test("steamLinks appends a red rep-check banner when rep.tf flags the profile as banned", async () => {
  const { buttonsEl, setSendMessageImpl } = installGlobals({ hostHtml: VALID_HOST_HTML });
  setSendMessageImpl(async () => ({ ok: true, data: { success: true, bptfBans: { banned: "bad" } } }));

  steamLinks();
  await flush();

  // rowBreak + 5 links + 1 banner.
  assert.equal(buttonsEl.children.length, 7);
  const banner = buttonsEl.children[6];
  assert.match(banner.style.cssText, /#e74c3c/);
  assert.equal(banner.children[0].textContent, "⚠ Potential scammer");
  assert.match(banner.children[1].textContent, /backpack\.tf/);
});

test("steamLinks appends a green all-clear banner when rep.tf reports no bans", async () => {
  const { buttonsEl, setSendMessageImpl } = installGlobals({ hostHtml: VALID_HOST_HTML });
  setSendMessageImpl(async () => ({ ok: true, data: { success: true } }));

  steamLinks();
  await flush();

  const banner = buttonsEl.children[6];
  assert.match(banner.style.cssText, /#2ecc71/);
  assert.equal(banner.children[0].textContent, "✓ No bans found");
});

// A failed lookup must not read as "no bans": a neutral "unavailable" banner
// rather than a green all-clear for a check that never happened.
test("steamLinks leaves the rep.tf banner neutral ('unavailable', not green) and doesn't crash when the rep.tf relay itself fails", async () => {
  const { buttonsEl, setSendMessageImpl } = installGlobals({ hostHtml: VALID_HOST_HTML });
  setSendMessageImpl(async () => {
    throw new Error("network down");
  });
  const originalWarn = console.warn;
  console.warn = () => {};

  try {
    steamLinks();
    await flush();
  } finally {
    console.warn = originalWarn;
  }

  // rowBreak + 5 links + a neutral "unavailable" banner, never green.
  assert.equal(buttonsEl.children.length, 7);
  const banner = buttonsEl.children[6];
  assert.equal(banner.children[0].textContent, "Ban check unavailable");
  assert.doesNotMatch(banner.style.cssText, /#2ecc71/);
});

test("steamLinks shows a neutral 'Checking bans…' banner straight away, updated in place once rep.tf answers", async () => {
  const { buttonsEl, setSendMessageImpl } = installGlobals({ hostHtml: VALID_HOST_HTML });
  setSendMessageImpl(async () => ({ ok: true, data: { success: true } }));

  steamLinks();

  const banner = buttonsEl.children[6];
  assert.equal(banner.children[0].textContent, "Checking bans…");
  assert.ok(banner.style.cssText.includes("rgba(255, 255, 255, 0.25)"), "expected the neutral border");

  await flush();

  assert.equal(buttonsEl.children[6], banner, "updated in place, not replaced");
  assert.equal(banner.children[0].textContent, "✓ No bans found");
});
