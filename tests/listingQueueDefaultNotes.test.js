import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseDefaultListingNotes,
  fetchDefaultListingNotes,
  __resetDefaultListingNotesForTests,
} from "../backpack.tf/oldUI/listingQueue/defaultNotes.js";

// Confirmed live: classic backpack.tf's /classifieds/sell/{id} page renders
// the account's default listing notes straight into this textarea.
const SELL_PAGE = `
  <h6>Listing notes</h6>
  <div class="form-group">
      <textarea class="form-control" id="listing-comments" maxlength="200"
                placeholder="(Optional) Add extra information for this listing.">👤𝗛𝘂𝗺𝗮𝗻 𝘁𝗿𝗮𝗱𝗲𝗿 [⇄]. ⚡I am reacting to offers fast as possible.⚡</textarea>
  </div>`;

test("parseDefaultListingNotes reads the notes textarea exactly, Unicode bold letters and emoji included", () => {
  assert.equal(parseDefaultListingNotes(SELL_PAGE), "👤𝗛𝘂𝗺𝗮𝗻 𝘁𝗿𝗮𝗱𝗲𝗿 [⇄]. ⚡I am reacting to offers fast as possible.⚡");
});

test("parseDefaultListingNotes decodes HTML entities the page escapes", () => {
  const html = '<textarea id="listing-comments">Keys &amp; metal &lt;3 &quot;fast&quot; &#39;ok&#39; &#x26A1;</textarea>';
  assert.equal(parseDefaultListingNotes(html), `Keys & metal <3 "fast" 'ok' ⚡`);
});

test("parseDefaultListingNotes returns an empty string for an empty box or a page without one", () => {
  assert.equal(parseDefaultListingNotes('<textarea id="listing-comments"></textarea>'), "");
  assert.equal(parseDefaultListingNotes("<html><body>Please log in</body></html>"), "");
  assert.equal(parseDefaultListingNotes(undefined), "");
});

test("fetchDefaultListingNotes reads the item's sell page once and reuses the result for later items", async () => {
  __resetDefaultListingNotesForTests();
  const urls = [];
  globalThis.fetch = async (url, init) => {
    urls.push({ url, credentials: init?.credentials });
    return { ok: true, text: async () => SELL_PAGE };
  };

  assert.match(await fetchDefaultListingNotes("17599841419"), /reacting to offers/);
  assert.match(await fetchDefaultListingNotes("123"), /reacting to offers/);

  assert.deepEqual(urls, [{ url: "https://backpack.tf/classifieds/sell/17599841419", credentials: "include" }]);
});

test("fetchDefaultListingNotes falls back to an empty note on failure, and tries again for the next item", async () => {
  __resetDefaultListingNotesForTests();
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return calls === 1 ? { ok: false, status: 503 } : { ok: true, text: async () => SELL_PAGE };
  };
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(await fetchDefaultListingNotes("1"), "");
    assert.match(await fetchDefaultListingNotes("2"), /reacting to offers/);
    assert.equal(calls, 2);
  } finally {
    console.warn = originalWarn;
  }
});
