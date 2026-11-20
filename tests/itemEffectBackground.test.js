import { test } from "node:test";
import assert from "node:assert/strict";
import { findItemPicture, findNearestItemPicture, sharpEffectSize, showEffectBehindPicture } from "../steamcommunity.com/shared/itemEffectBackground.js";
import { UNUSUAL_EFFECT_IDS } from "../utils/unusualEffectIds.js";
import { PARTICLE_HOST_URL } from "../utils/particleImages.js";

globalThis.chrome = { runtime: { getURL: (path) => `moz-extension://test/${path}` } };
const bundled = (id) => `url("moz-extension://test/images/particles/94/${id}.png")`;
const hosted = (id, size) => `url("${PARTICLE_HOST_URL}/${size}/${id}.png")`;

// Just enough DOM for the module: parentElement walking, querySelectorAll("img"),
// src, dataset and style.
class El {
  constructor(tag, src = "") {
    this.tagName = tag.toUpperCase();
    this.src = src;
    this.children = [];
    this.parentElement = null;
    this.dataset = {};
    this.style = {};
  }
  append(...kids) {
    for (const k of kids) {
      k.parentElement = this;
      this.children.push(k);
    }
    return this;
  }
  querySelectorAll(selector) {
    assert.equal(selector, "img");
    const out = [];
    const walk = (n) => n.children.forEach((c) => (c.tagName === "IMG" && out.push(c), walk(c)));
    walk(this);
    return out;
  }
}

const ITEM_SRC = "https://community.fastly.steamstatic.com/economy/image/abc/360fx360f";
const GAME_ICON_SRC = "https://shared.fastly.steamstatic.com/community_assets/images/apps/440/icon.jpg";

// The new Market page: the page's own large picture, and a modal whose picture
// sits beside (not inside) its info panel, which also holds a game icon.
function buildMarketPage() {
  const pagePicture = new El("img", ITEM_SRC);
  const modalPicture = new El("img", ITEM_SRC.replace("abc", "modal"));
  const infoPanel = new El("div").append(new El("img", GAME_ICON_SRC));
  const modal = new El("div").append(new El("div").append(modalPicture), infoPanel);
  const page = new El("div").append(new El("div").append(pagePicture), modal);
  return { page, pagePicture, modalPicture, infoPanel };
}

test("findItemPicture skips the game icon and finds the item picture by its /economy/image/ source", () => {
  const panel = new El("div").append(new El("img", GAME_ICON_SRC), new El("div").append(new El("img", ITEM_SRC)));
  assert.equal(findItemPicture(panel).src, ITEM_SRC);
  assert.equal(findItemPicture(new El("div").append(new El("img", GAME_ICON_SRC))), null);
});

test("findNearestItemPicture picks the modal's own picture, not the page's larger one behind the overlay", () => {
  const { modalPicture, infoPanel } = buildMarketPage();
  assert.equal(findNearestItemPicture(infoPanel), modalPicture);
});

// Image loading, controlled per test: URLs containing a `failing` entry fail to
// load, everything else loads; `hold` keeps loads pending until released.
function installFakeImage({ failing = [], hold = false } = {}) {
  const pending = [];
  globalThis.Image = class {
    set src(url) {
      const settle = () => (failing.some((f) => url.includes(f)) ? this.onerror?.() : this.onload?.());
      if (hold) pending.push(settle);
      else queueMicrotask(settle);
    }
  };
  return { releaseAll: () => pending.splice(0).forEach((settle) => settle()) };
}

const ORBITING_FIRE = UNUSUAL_EFFECT_IDS["Orbiting Fire"];

test("sharpEffectSize picks 188 px for a ~192 px picture and 380 px for larger ones or high-DPI screens", () => {
  assert.equal(sharpEffectSize(192), 188);
  assert.equal(sharpEffectSize(360), 380);
  assert.equal(sharpEffectSize(192, 2), 380);
  assert.equal(sharpEffectSize(0), 188);
});

test("shows the bundled 94 px effect at once, then the host's sharp one for the picture's size", async () => {
  const images = installFakeImage({ hold: true });
  const small = new El("img", "https://community.fastly.steamstatic.com/economy/image/abc/192fx192f");
  const large = new El("img", "https://community.fastly.steamstatic.com/economy/image/abc/360fx360f");

  const smallDone = showEffectBehindPicture(small, "Orbiting Fire");
  const largeDone = showEffectBehindPicture(large, "Orbiting Fire");
  assert.equal(small.style.backgroundImage, bundled(ORBITING_FIRE));
  assert.equal(small.style.backgroundSize, "contain");

  images.releaseAll();
  await Promise.all([smallDone, largeDone]);
  assert.equal(small.style.backgroundImage, hosted(ORBITING_FIRE, 188));
  assert.equal(large.style.backgroundImage, hosted(ORBITING_FIRE, 380));
});

test("a laid-out width wins over the size in the image address", async () => {
  installFakeImage();
  const img = new El("img", "https://community.fastly.steamstatic.com/economy/image/abc/360fx360f");
  img.width = 150;

  await showEffectBehindPicture(img, "Steaming");

  assert.equal(img.style.backgroundImage, hosted(UNUSUAL_EFFECT_IDS.Steaming, 188));
});

test("keeps the bundled image when the host's can't be loaded", async () => {
  installFakeImage({ failing: [PARTICLE_HOST_URL] });
  const { modalPicture } = buildMarketPage();

  await showEffectBehindPicture(modalPicture, "Orbiting Fire");

  assert.equal(modalPicture.style.backgroundImage, bundled(ORBITING_FIRE));
});

test("a sharp image that arrives after another item was selected is not applied", async () => {
  const images = installFakeImage({ hold: true });
  const { modalPicture } = buildMarketPage();

  const first = showEffectBehindPicture(modalPicture, "Orbiting Fire");
  await showEffectBehindPicture(modalPicture, null); // the user picked a non-Unusual meanwhile
  images.releaseAll();
  await first;

  assert.equal(modalPicture.style.backgroundImage, "");
});

test("swaps the effect for the next Unusual and clears it for a non-Unusual", async () => {
  installFakeImage();
  const { modalPicture } = buildMarketPage();

  await showEffectBehindPicture(modalPicture, "Orbiting Fire");
  await showEffectBehindPicture(modalPicture, "steaming"); // case-insensitive
  assert.equal(modalPicture.style.backgroundImage, hosted(UNUSUAL_EFFECT_IDS.Steaming, 380));

  await showEffectBehindPicture(modalPicture, null);
  assert.equal(modalPicture.style.backgroundImage, "");
});

// The effect name is page text. "constructor" and "toString" are properties
// every object inherits, not effects, so they must not resolve to an "id".
test("an effect name that is only an inherited object property shows no effect", async () => {
  installFakeImage();
  const { modalPicture } = buildMarketPage();

  for (const name of ["constructor", "toString"]) {
    await showEffectBehindPicture(modalPicture, name);
    assert.equal(modalPicture.style.backgroundImage ?? "", "", name);
    assert.equal(modalPicture.dataset.tf2teEffectId, undefined, name);
  }
});

test("does nothing when the right effect is already set, and ignores a missing picture", async () => {
  installFakeImage();
  const { modalPicture } = buildMarketPage();
  await showEffectBehindPicture(modalPicture, "Orbiting Fire");
  modalPicture.style.backgroundImage = "sentinel";

  await showEffectBehindPicture(modalPicture, "Orbiting Fire");
  assert.equal(modalPicture.style.backgroundImage, "sentinel");

  await assert.doesNotReject(showEffectBehindPicture(null, "Orbiting Fire"));
});
