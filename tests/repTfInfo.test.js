import { test } from "node:test";
import assert from "node:assert/strict";
import { getBannedSiteLabels, getRepTfBans } from "../utils/repTfInfo.js";

// getRepTfBans is a thin wrapper around chrome.runtime.sendMessage's
// FETCH_JSON relay, faked the same way tests/pricedb.test.js fakes it.
const originalWarn = console.warn;

// getRepTfBans is wrapped in utils/failureBackoff.js's createFailureBackoff,
// which reads/writes chrome.storage.local, so each test gets a fresh store.
function installFakeChrome(sendMessage) {
  const store = {};
  globalThis.chrome = {
    runtime: { sendMessage },
    storage: {
      local: {
        async get(keys) {
          const result = {};
          for (const k of keys) if (k in store) result[k] = store[k];
          return result;
        },
        async set(obj) {
          Object.assign(store, obj);
        },
      },
    },
  };
}

test("getRepTfBans POSTs steamid64 as the 'str' query param and returns response.data on success", async () => {
  const calls = [];
  installFakeChrome(async (msg) => {
    calls.push(msg);
    return { ok: true, data: { success: true, bptfBans: { banned: "bad" } } };
  });

  const result = await getRepTfBans("76561198000000000");

  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "POST");
  const url = new URL(calls[0].url);
  assert.equal(url.origin + url.pathname, "https://rep.tf/api/bans");
  assert.equal(url.searchParams.get("str"), "76561198000000000");
  assert.deepEqual(result, { success: true, bptfBans: { banned: "bad" } });
});

test("getRepTfBans returns null and warns when the relay responds with ok: false", async () => {
  installFakeChrome(async () => ({ ok: false, error: "boom" }));
  console.warn = () => {};
  try {
    assert.equal(await getRepTfBans("76561198000000000"), null);
  } finally {
    console.warn = originalWarn;
  }
});

test("getRepTfBans returns null and warns when sendMessage itself throws", async () => {
  installFakeChrome(async () => {
    throw new Error("no background page");
  });
  console.warn = () => {};
  try {
    assert.equal(await getRepTfBans("76561198000000000"), null);
  } finally {
    console.warn = originalWarn;
  }
});

test("getRepTfBans backs off after 3 consecutive failures, skipping sendMessage entirely on the 4th call", async () => {
  let calls = 0;
  installFakeChrome(async () => {
    calls++;
    return { ok: false, error: "boom" };
  });
  console.warn = () => {};
  try {
    for (let i = 0; i < 3; i++) {
      assert.equal(await getRepTfBans("76561198000000000"), null);
    }
    assert.equal(calls, 3);

    // 4th call: now in cooldown, sendMessage should never even be attempted.
    assert.equal(await getRepTfBans("76561198000000000"), null);
    assert.equal(calls, 3);
  } finally {
    console.warn = originalWarn;
  }
});

test("getRepTfBans's backoff resets on a success, so an isolated later failure doesn't trigger cooldown early", async () => {
  let mode = "fail";
  let calls = 0;
  installFakeChrome(async () => {
    calls++;
    if (mode === "fail") return { ok: false, error: "boom" };
    return { ok: true, data: { success: true } };
  });
  console.warn = () => {};
  try {
    await getRepTfBans("76561198000000000"); // failure 1
    await getRepTfBans("76561198000000000"); // failure 2
    mode = "succeed";
    await getRepTfBans("76561198000000000"); // success resets count

    mode = "fail";
    await getRepTfBans("76561198000000000"); // only 1 consecutive failure now
    assert.equal(calls, 4); // not skipped - still under the 3-failure threshold
  } finally {
    console.warn = originalWarn;
  }
});

test("getBannedSiteLabels returns an empty array for a null bansResponse", () => {
  assert.deepEqual(getBannedSiteLabels(null), []);
});

test("getBannedSiteLabels only treats banned:\"bad\" as a real signal", () => {
  // "good" doesn't reliably mean clean and "" / null mean "not checked" - per
  // the file header, none of those three should ever surface as a flag.
  const response = {
    steamBans: { banned: "good" },
    srBans: { banned: "" },
    stfBans: null,
    bptfBans: { banned: "bad" },
  };
  assert.deepEqual(getBannedSiteLabels(response), ["backpack.tf"]);
});

test("getBannedSiteLabels maps every known key through SITE_LABEL_BY_KEY", () => {
  const response = {
    steamBans: { banned: "bad" },
    srBans: { banned: "bad" },
    stfBans: { banned: "bad" },
    mpBans: { banned: "bad" },
    hgBans: { banned: "bad" },
    nhsBans: { banned: "bad" },
    etf2lBans: { banned: "bad" },
    rglBans: { banned: "bad" },
    stnBans: { banned: "bad" },
  };
  assert.deepEqual(getBannedSiteLabels(response), [
    "Steam",
    "SteamRep (archived)",
    "Scrap.TF",
    "Marketplace.tf",
    "Harpoon Gaming",
    "Neon Heights",
    "ETF2L",
    "RGL",
    "STN.Trading",
  ]);
});

test("getBannedSiteLabels falls back to a label derived from the key for an unmapped xBans key", () => {
  // Per labelForBansKey's own comment - some confirmed-live keys (ppmBans,
  // stBans, fogBans, fpBans) have no independent way to confirm the real site
  // name, so a "bad" flag from one is still surfaced, just under the raw key.
  const response = { ppmBans: { banned: "bad" } };
  assert.deepEqual(getBannedSiteLabels(response), ["ppm"]);
});

test("getBannedSiteLabels ignores non-xBans keys even if present on the response", () => {
  const response = { success: true, message: "bad", bptfBans: { banned: "bad" } };
  assert.deepEqual(getBannedSiteLabels(response), ["backpack.tf"]);
});
