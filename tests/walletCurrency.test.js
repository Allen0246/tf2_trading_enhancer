import { test } from "node:test";
import assert from "node:assert/strict";
import { getWalletCurrencyId, getStampedWalletCurrencyId } from "../steamcommunity.com/shared/walletCurrency.js";

globalThis.CustomEvent = class {
  constructor(type, { detail } = {}) {
    this.type = type;
    this.detail = detail;
  }
};

// A page whose MAIN-world bridge (inventoryMarketActions/mainWorld.js)
// answers with `currency`, or never answers when it's undefined.
function installPage({ wrappedWallet, bridgeCurrency } = {}) {
  const listeners = {};
  globalThis.window = { wrappedJSObject: wrappedWallet ? { g_rgWalletInfo: wrappedWallet } : undefined };
  globalThis.document = {
    addEventListener: (type, cb) => (listeners[type] ||= []).push(cb),
    removeEventListener: (type, cb) => (listeners[type] = (listeners[type] || []).filter((l) => l !== cb)),
    dispatchEvent: (event) => {
      if (event.type !== "tf2te-wallet-currency-request" || bridgeCurrency === undefined) return;
      const { requestId } = JSON.parse(event.detail);
      const response = { detail: JSON.stringify({ requestId, currency: bridgeCurrency }) };
      for (const cb of listeners["tf2te-wallet-currency-response"] || []) cb(response);
    },
  };
}

test("getWalletCurrencyId reads the page's wallet directly on Firefox", async () => {
  installPage({ wrappedWallet: { wallet_currency: 3 } });
  assert.equal(await getWalletCurrencyId(), 3);
});

test("getWalletCurrencyId asks the MAIN-world bridge elsewhere, and ignores a nonsense answer", async () => {
  installPage({ bridgeCurrency: 1 });
  assert.equal(await getWalletCurrencyId(), 1);

  installPage({ bridgeCurrency: "3; DROP" });
  assert.equal(await getWalletCurrencyId(), null);
});

// Confirmed live: Steam's current Market page has no g_rgWalletInfo; the
// page script puts the currency its listings are shown in on <html> instead.
test("getWalletCurrencyId falls back to the listings' currency the page script put on <html>", async () => {
  installPage({});
  globalThis.document.documentElement = { dataset: { tf2teWalletCurrency: "1" } };
  assert.equal(await getWalletCurrencyId(), 1);
  assert.equal(getStampedWalletCurrencyId(), 1);

  globalThis.document.documentElement = { dataset: { tf2teWalletCurrency: "nonsense" } };
  assert.equal(getStampedWalletCurrencyId(), null);
});
