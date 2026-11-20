import { test } from "node:test";
import assert from "node:assert/strict";
import { profileTradeLink } from "../backpack.tf/oldUI/profileTradeLink/content.js";

// Minimal hand-rolled fakes (see tests/helpers/fakeDom.js's own header on why
// this repo hand-rolls rather than pulling in jsdom).

function fakeSpan(text) {
  return { textContent: text };
}

function fakeUserLink(offersParams) {
  return { getAttribute: (name) => (name === "data-offers-params" ? offersParams : null) };
}

function fakeButtonsRow() {
  const appended = [];
  return {
    appendChild: (el) => {
      appended.push(el);
      return el;
    },
    _appended: appended,
  };
}

function setupDom({ buttonsRow = null, userLink = null, spans = [], existingButton = null } = {}) {
  global.document = {
    querySelector: (selector) => {
      if (selector === `.${"tf2te-profile-trade-link"}`) return existingButton;
      if (selector === ".profile .information .buttons") return buttonsRow;
      if (selector === ".user-link") return userLink;
      return null;
    },
    querySelectorAll: (selector) => (selector === "span" ? spans : []),
    createElement: () => ({ className: "", href: "", target: "", rel: "", textContent: "" }),
  };
  global.MutationObserver = class {
    observe() {}
  };
}

test("inserts a 'Send Trade Offer' link pointing at the profile's own trade-offer URL", () => {
  const buttonsRow = fakeButtonsRow();
  setupDom({
    buttonsRow,
    userLink: fakeUserLink("?partner=12345678&token=AbCd1234"),
    spans: [fakeSpan("Profile Information")],
  });

  profileTradeLink();

  assert.equal(buttonsRow._appended.length, 1);
  const link = buttonsRow._appended[0];
  assert.equal(link.href, "https://steamcommunity.com/tradeoffer/new/?partner=12345678&token=AbCd1234");
  assert.equal(link.textContent, "Send Trade Offer");
  assert.equal(link.target, "_blank");
  assert.equal(link.rel, "noopener noreferrer");
});

test("does nothing when the buttons row isn't present", () => {
  setupDom({
    buttonsRow: null,
    userLink: fakeUserLink("?partner=1&token=abc"),
    spans: [fakeSpan("Profile Information")],
  });

  assert.doesNotThrow(() => profileTradeLink());
});

test("does nothing when there's no user-link/offers-params to build a URL from", () => {
  const buttonsRow = fakeButtonsRow();
  setupDom({ buttonsRow, userLink: null, spans: [fakeSpan("Profile Information")] });

  profileTradeLink();

  assert.deepEqual(buttonsRow._appended, []);
});

test("does nothing when the 'Profile Information' heading isn't present (not actually a profile page)", () => {
  const buttonsRow = fakeButtonsRow();
  setupDom({ buttonsRow, userLink: fakeUserLink("?partner=1&token=abc"), spans: [] });

  profileTradeLink();

  assert.deepEqual(buttonsRow._appended, []);
});

test("never inserts a duplicate link when already present", () => {
  const buttonsRow = fakeButtonsRow();
  setupDom({
    buttonsRow,
    userLink: fakeUserLink("?partner=1&token=abc"),
    spans: [fakeSpan("Profile Information")],
    existingButton: { textContent: "Send Trade Offer" },
  });

  profileTradeLink();

  assert.deepEqual(buttonsRow._appended, []);
});
