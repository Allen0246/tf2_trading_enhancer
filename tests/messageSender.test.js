import { test } from "node:test";
import assert from "node:assert/strict";
import { isExtensionPageSender } from "../utils/messageSender.js";

globalThis.chrome = { runtime: { getURL: (path) => `chrome-extension://abcdefgh/${path}` } };

test("a sender under the extension's own origin is an extension page, in a tab or not", () => {
  assert.equal(isExtensionPageSender({ url: "chrome-extension://abcdefgh/popup/popup.html" }), true);
  assert.equal(isExtensionPageSender({ tab: { id: 3 }, url: "chrome-extension://abcdefgh/options/options.html" }), true);
});

test("a content script (a website's url) is not an extension page", () => {
  assert.equal(isExtensionPageSender({ tab: { id: 3 }, url: "https://backpack.tf/classifieds" }), false);
  assert.equal(isExtensionPageSender({ url: "https://steamcommunity.com/market/" }), false);
});

test("another extension's page, or a look-alike origin, is not an extension page", () => {
  assert.equal(isExtensionPageSender({ url: "chrome-extension://zzzzzzzz/popup/popup.html" }), false);
  assert.equal(isExtensionPageSender({ url: "chrome-extension://abcdefghi/popup.html" }), false);
});

test("without a url, only a sender with no tab counts", () => {
  assert.equal(isExtensionPageSender({}), true);
  assert.equal(isExtensionPageSender(undefined), true);
  assert.equal(isExtensionPageSender({ tab: { id: 3 } }), false);
});
