import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

// The settings classes (settings/*.js) find their elements by id, and the
// popup and the settings page each carry those ids. The other tests run the
// classes against fake pages, so a renamed or forgotten id in the real HTML
// would pass them all while the setting silently did nothing. These read the
// real files instead.

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function htmlIds(path) {
  return [...read(path).matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
}

// Ids a source file looks up: el("…") / getElementById("…"), the id fields
// of apiKeySettings.js' tables, and any section's ELEMENT_IDS table.
function referencedIds(source) {
  const ids = new Set();
  for (const m of source.matchAll(/\b(?:el|getElementById)\("([^"]+)"\)/g)) ids.add(m[1]);
  for (const m of source.matchAll(/\b(?:inputId|buttonId|statusId):\s*"([^"]+)"/g)) ids.add(m[1]);
  const elementIds = /const ELEMENT_IDS = \{([\s\S]*?)\};/.exec(source);
  if (elementIds) for (const m of elementIds[1].matchAll(/:\s*"([^"]+)"/g)) ids.add(m[1]);
  return ids;
}

const settingsIds = new Set(
  readdirSync(new URL("../settings/", import.meta.url))
    .filter((name) => name.endsWith(".js"))
    .flatMap((name) => [...referencedIds(read(`settings/${name}`))]),
);

// Ids the settings classes use on one page only, by design.
const POPUP_ONLY = [
  "settings-save", // one Save for every key
  "settings-status",
  "steam-settings-details", // the Steam <details>
  "alert-sound-key-add", // opens that <details>; the settings page links to its key section
];
const OPTIONS_ONLY = [
  "steam-save", // a Save per card
  "steam-save-status",
  "alert-sound-custom-name", // the popup shows the file in the dropdown only
  "steam-key-intro", // #steam-key opens the settings page
  "steam-key-intro-heading",
  "steam-key-intro-text",
];

const pages = {
  "popup/popup.html": { ids: htmlIds("popup/popup.html"), script: "popup/popup.js", otherPageOnly: OPTIONS_ONLY },
  "options/options.html": { ids: htmlIds("options/options.html"), script: "options/options.js", otherPageOnly: POPUP_ONLY },
};

// The Discord invite is written into both pages by hand (no build step), so a
// placeholder or a copy that fell behind would ship unnoticed.
test("the popup and the settings page link to the same Discord invite, in a new tab", () => {
  const discordLinks = (path) => [...read(path).matchAll(/<a\b[^>]*href="(https:\/\/discord\.[^"]*)"[^>]*>/g)];
  const popup = discordLinks("popup/popup.html");
  const options = discordLinks("options/options.html");
  assert.equal(popup.length, 1);
  assert.equal(options.length, 2); // header pill and the About list

  const [invite] = popup[0].slice(1);
  assert.match(invite, /^https:\/\/discord\.gg\/[A-Za-z0-9]{6,}$/);
  assert.notEqual(invite, "https://discord.gg/INVITE");
  for (const [tag, href] of [...popup, ...options]) {
    assert.equal(href, invite);
    assert.match(tag, /target="_blank"/);
    assert.match(tag, /rel="noopener noreferrer"/);
  }
});

test("the settings classes' ids were found (the extraction itself works)", () => {
  for (const id of ["alert-sound-select", "steam-api-key", "steam-save", "steam-key-intro", "mute-tradeoffer-alert"]) {
    assert.ok(settingsIds.has(id), id);
  }
});

for (const [page, { ids, otherPageOnly }] of Object.entries(pages)) {
  test(`${page} has every id the settings classes look up (except the other page's own)`, () => {
    const missing = [...settingsIds].filter((id) => !otherPageOnly.includes(id) && !ids.includes(id));
    assert.deepEqual(missing, []);
  });
}

for (const [page, { ids, script }] of Object.entries(pages)) {
  test(`${page} has every id its own ${script} looks up`, () => {
    const missing = [...referencedIds(read(script))].filter((id) => !ids.includes(id));
    assert.deepEqual(missing, []);
  });

  test(`${page} has no duplicate ids`, () => {
    const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
    assert.deepEqual(duplicates, []);
  });
}

// Only the ones the classes look up: the same file runs on the free branch,
// which has no backpack.tf settings at all.
test("each one-page id the settings classes use is on its own page", () => {
  for (const id of POPUP_ONLY.filter((id) => settingsIds.has(id))) assert.ok(pages["popup/popup.html"].ids.includes(id), id);
  for (const id of OPTIONS_ONLY.filter((id) => settingsIds.has(id))) assert.ok(pages["options/options.html"].ids.includes(id), id);
});

test("every settings page menu link points at a section that exists", () => {
  const html = read("options/options.html");
  const links = [...html.matchAll(/<a href="#([^"]+)" class="side-nav__link" data-section="([^"]+)"/g)];
  assert.ok(links.length >= 4);
  for (const [, href, section] of links) {
    assert.equal(href, section);
    assert.ok(pages["options/options.html"].ids.includes(section), section);
  }
});

test("the manifest's settings page is options/options.html, opened in a tab", () => {
  const manifest = JSON.parse(read("manifest.json"));
  assert.deepEqual(manifest.options_ui, { page: "options/options.html", open_in_tab: true });
});
