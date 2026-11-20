import { test } from "node:test";
import assert from "node:assert/strict";
import { getSteamId64FromPage } from "../utils/steamId.js";

// Fakes the one DOM call this module makes - document.getElementsByClassName
// returning a list of elements with an innerHTML string, matching Steam's own
// "responsive_page_template_content" wrapper element.
function fakeDocument(innerHTML) {
  return {
    getElementsByClassName: (className) => {
      if (className !== "responsive_page_template_content") return [];
      return innerHTML == null ? [] : [{ innerHTML }];
    },
  };
}

test("getSteamId64FromPage extracts the id between Steam's own steamid/personaname markers", () => {
  globalThis.document = fakeDocument(
    'g_rgProfileData = {"steamid":"76561198000000000","personaname":"Some User","summary":""};'
  );
  assert.equal(getSteamId64FromPage(), "76561198000000000");
});

test("getSteamId64FromPage returns an empty string when the steamid marker is missing", () => {
  globalThis.document = fakeDocument('{"personaname":"Some User"}');
  assert.equal(getSteamId64FromPage(), "");
});

test("getSteamId64FromPage returns an empty string when the personaname marker is missing", () => {
  globalThis.document = fakeDocument('{"steamid":"76561198000000000"}');
  assert.equal(getSteamId64FromPage(), "");
});

test("getSteamId64FromPage returns an empty string when the wrapper element isn't present at all", () => {
  globalThis.document = fakeDocument(null);
  assert.equal(getSteamId64FromPage(), "");
});

// The words "steamid" and "personaname" can appear in the page before the
// profile data itself, e.g. in a custom profile URL. Reading from the first
// occurrence of each word returned a slice of unrelated markup, which every
// profile link (and the rep.tf lookup) was then built from.
test("getSteamId64FromPage ignores the word 'steamid' in a custom profile URL ahead of the profile data", () => {
  globalThis.document = fakeDocument(
    '<a href="https://steamcommunity.com/id/steamid_trader/">profile</a>' +
      'g_rgProfileData = {"url":"https:\\/\\/steamcommunity.com\\/id\\/steamid_trader\\/","steamid":"76561198000000000","personaname":"Some User","summary":""};'
  );
  assert.equal(getSteamId64FromPage(), "76561198000000000");
});

test("getSteamId64FromPage ignores the word 'personaname' ahead of the profile data", () => {
  globalThis.document = fakeDocument(
    '<a href="https://steamcommunity.com/id/personaname/">profile</a>' +
      'g_rgProfileData = {"url":"https:\\/\\/steamcommunity.com\\/id\\/personaname\\/","steamid":"76561198000000000","personaname":"Some User","summary":""};'
  );
  assert.equal(getSteamId64FromPage(), "76561198000000000");
});

test("getSteamId64FromPage returns an empty string when the steamid field isn't a number", () => {
  globalThis.document = fakeDocument('g_rgProfileData = {"steamid":"<b>oops</b>","personaname":"Some User"};');
  assert.equal(getSteamId64FromPage(), "");
});
