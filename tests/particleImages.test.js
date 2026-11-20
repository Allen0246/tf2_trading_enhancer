import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readdirSync, readFileSync } from "node:fs";
import { PARTICLE_HOST_URL, bundledParticleUrl, hostedParticleUrl } from "../utils/particleImages.js";
import { UNUSUAL_EFFECT_IDS } from "../utils/unusualEffectIds.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// Runs a classic (non-module) script the way the browser would, returning its window.
function runClassicScript(path, globals = {}) {
  const sandbox = { window: {}, ...globals };
  vm.createContext(sandbox);
  vm.runInContext(read(path), sandbox);
  return sandbox;
}

function bundledIds() {
  return [...runClassicScript("steamcommunity.com/tradeOffer/bundledParticleIds.js").window.__tf2teBundledParticleIds__];
}

test("hostedParticleUrl and bundledParticleUrl build the host's and the extension's image addresses", () => {
  globalThis.chrome = { runtime: { getURL: (path) => `moz-extension://test/${path}` } };
  assert.equal(hostedParticleUrl(13, 380), `${PARTICLE_HOST_URL}/380/13.png`);
  assert.equal(bundledParticleUrl(13), "moz-extension://test/images/particles/94/13.png");
});

test("shared.js's own copy of the host address matches utils/particleImages.js", () => {
  const match = /particleHostUrl:\s*'([^']+)'/.exec(read("steamcommunity.com/tradeOffer/shared.js"));
  assert.ok(match, "shared.js no longer defines particleHostUrl");
  assert.equal(match[1], PARTICLE_HOST_URL);
});

test("every bundled id has its image in images/particles/94/, and every image there is listed", () => {
  const files = readdirSync(new URL("../images/particles/94/", import.meta.url));
  assert.deepEqual(
    files.map((f) => Number(f.replace(/\.png$/, ""))).sort((a, b) => a - b),
    bundledIds()
  );
});

test("every bundled id is a known Unusual effect", () => {
  const known = new Set(Object.values(UNUSUAL_EFFECT_IDS));
  assert.deepEqual(bundledIds().filter((id) => !known.has(id)), []);
});

test("extensionUrlBridge.js writes the extension's base URL onto <html> for the MAIN-world bundle", () => {
  const documentElement = { dataset: {} };
  runClassicScript("steamcommunity.com/tradeOffer/extensionUrlBridge.js", {
    document: { documentElement },
    chrome: { runtime: { getURL: (path) => `moz-extension://test/${path}` } },
  });
  assert.equal(documentElement.dataset.tf2teExtensionUrl, "moz-extension://test/");
});

test("manifest: the bridge runs at document_start where the MAIN bundle runs, and the id list loads before shared.js", () => {
  const manifest = JSON.parse(read("manifest.json"));
  const bundle = manifest.content_scripts.find((cs) => cs.js.includes("steamcommunity.com/tradeOffer/shared.js"));
  const bridge = manifest.content_scripts.find((cs) => cs.js.includes("steamcommunity.com/tradeOffer/extensionUrlBridge.js"));

  assert.equal(bridge.run_at, "document_start");
  assert.equal(bridge.world, undefined); // isolated: needs chrome.runtime
  assert.deepEqual([...bridge.matches].sort(), [...bundle.matches].sort());

  const ids = bundle.js.indexOf("steamcommunity.com/tradeOffer/bundledParticleIds.js");
  assert.ok(ids >= 0 && ids < bundle.js.indexOf("steamcommunity.com/tradeOffer/shared.js"));
});

test("manifest: the bundled images are loadable by every page the MAIN bundle runs on", () => {
  const manifest = JSON.parse(read("manifest.json"));
  const bundle = manifest.content_scripts.find((cs) => cs.js.includes("steamcommunity.com/tradeOffer/shared.js"));
  const images = manifest.web_accessible_resources.find((r) => r.resources.includes("images/particles/**"));
  assert.ok(images);
  assert.deepEqual([...images.matches].sort(), [...bundle.matches].sort());
});
