import { test } from "node:test";
import assert from "node:assert/strict";

let stored = {};
globalThis.chrome = {
  storage: {
    local: {
      async get(keys) {
        const result = {};
        for (const key of keys) if (key in stored) result[key] = stored[key];
        return result;
      },
    },
  },
};

const { isSheenKillstreakerFilterEnabled, SHEEN_KILLSTREAKER_FILTER_ENABLED_KEY } = await import(
  "../utils/sheenKillstreakerFilterSetting.js"
);

test("isSheenKillstreakerFilterEnabled defaults to true when the key was never set (absent reads as enabled)", async () => {
  stored = {};
  assert.equal(await isSheenKillstreakerFilterEnabled(), true);
});

test("isSheenKillstreakerFilterEnabled returns false only when the stored value is explicitly false", async () => {
  stored = { [SHEEN_KILLSTREAKER_FILTER_ENABLED_KEY]: false };
  assert.equal(await isSheenKillstreakerFilterEnabled(), false);
});

test("isSheenKillstreakerFilterEnabled returns true when the stored value is explicitly true", async () => {
  stored = { [SHEEN_KILLSTREAKER_FILTER_ENABLED_KEY]: true };
  assert.equal(await isSheenKillstreakerFilterEnabled(), true);
});
