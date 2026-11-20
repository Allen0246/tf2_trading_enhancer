import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const exists = (path) => existsSync(new URL(`../${path}`, import.meta.url));

// The popup and settings page once loaded their fonts from Google Fonts, so
// every opening told Google the user's IP. Their styles stay local.
test("the popup's and settings page's styles load nothing from the web", () => {
  for (const file of ["popup/popup.css", "options/options.css", "public/fonts/fonts.css"]) {
    assert.doesNotMatch(read(file), /url\(\s*['"]?(https?:)?\/\//, file);
  }
});

test("every font file fonts.css names is bundled", () => {
  const files = [...read("public/fonts/fonts.css").matchAll(/url\(([^)]+\.woff2)\)/g)].map((m) => m[1]);
  assert.ok(files.length > 0);
  for (const file of files) assert.ok(exists(`public/fonts/${file}`), file);
});

test("every marker icon the trade-offer bundle asks for is bundled", () => {
  const source = read("steamcommunity.com/tradeOffer/shared.js") + read("steamcommunity.com/tradeOffer/pages/tradeoffer.js");
  const icons = [...source.matchAll(/getIconURL\('([^']+)'\)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(icons)].sort(), ["killstreak-1.svg", "killstreak-2.svg", "killstreak-3.svg", "spell.svg", "strange-parts.svg"]);
  for (const icon of icons) assert.ok(exists(`images/icons/${icon}`), icon);
});
