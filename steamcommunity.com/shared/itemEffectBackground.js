/*
@description: Shows an Unusual's effect behind an item's large picture on
Steam's current (React) pages, the way the inventory grid tiles show it: as
the <img>'s own background, which shows through the picture's transparent
pixels, so the effect lines up with the item at the picture's own size.
Used by the inventory's selected-item panel and the Market listing modal.

These pages give the picture no id or stable class (generated class names
only), so it is found by source: Steam serves item pictures from
/economy/image/ (confirmed live), while the panels' other images (e.g. the
32x32 game icon) come from /community_assets/.

Image source: these pictures are 192-360 px, so the effect comes from our own
host's 188 or 380 px image (utils/particleImages.js). The 94 px copy bundled
with the extension shows right away while that loads, and stays if it fails.
*/
import { UNUSUAL_EFFECT_IDS } from "../../utils/unusualEffectIds.js";
import { bundledParticleUrl, hostedParticleUrl } from "../../utils/particleImages.js";

// The host's 188 px image up to this many device pixels wide, its 380 px one above.
const SHARP_188_MAX_PX = 200;

/*
@description: Which hosted size suits a picture `picturePx` wide on a screen
with `pixelRatio` device pixels per CSS pixel (2 on most high-DPI screens).
*/
export function sharpEffectSize(picturePx, pixelRatio = 1) {
  return picturePx * pixelRatio > SHARP_188_MAX_PX ? 380 : 188;
}

/*
@description: The picture's width in px: as laid out, or else the size Steam
puts in its image address ("/360fx360f"), or 0 when neither is known yet.
*/
function pictureWidthPx(img) {
  const laidOut = img.width || img.clientWidth || 0;
  if (laidOut) return laidOut;
  const fromSrc = /\/(\d+)fx\d+f/.exec(String(img.src || ""));
  return fromSrc ? Number(fromSrc[1]) : 0;
}

// Resolves true when `url` loads, false when it fails.
function imageLoads(url) {
  return new Promise((resolve) => {
    const probe = new Image();
    probe.onload = () => resolve(true);
    probe.onerror = () => resolve(false);
    probe.src = url;
  });
}

function resolveEffectIdByName(effectName) {
  if (!effectName) return null;
  // Own entries only: `in` would also match inherited names ("constructor").
  if (Object.prototype.hasOwnProperty.call(UNUSUAL_EFFECT_IDS, effectName)) return UNUSUAL_EFFECT_IDS[effectName];
  const lower = effectName.toLowerCase();
  const match = Object.keys(UNUSUAL_EFFECT_IDS).find((name) => name.toLowerCase() === lower);
  return match ? UNUSUAL_EFFECT_IDS[match] : null;
}

function isItemPicture(img) {
  return String(img.src || img.getAttribute?.("src") || "").includes("/economy/image/");
}

// The first item picture inside `root`, or null.
export function findItemPicture(root) {
  return Array.from(root.querySelectorAll("img")).find(isItemPicture) || null;
}

/*
@description: The item picture closest to `el`: the first one found while
walking up from `el` through its ancestors. For the Market listing modal,
whose picture sits beside (not inside) its info panel, this reaches the
modal's own picture before the page's larger one behind the overlay.
*/
export function findNearestItemPicture(el) {
  for (let node = el; node; node = node.parentElement) {
    const picture = findItemPicture(node);
    if (picture) return picture;
  }
  return null;
}

function setBackground(img, url) {
  Object.assign(img.style, {
    backgroundImage: `url("${url}")`,
    backgroundSize: "contain",
    backgroundRepeat: "no-repeat",
    backgroundPosition: "center",
  });
}

/*
@description: Sets (or clears, for no or an unknown effect) the effect
background on `img`. Steam reuses the same <img> for the next item, so a
non-Unusual clears it. Both callers run on every page mutation, so nothing
happens when the right effect is already set or loading. The bundled 94 px
image shows at once; the sharp one replaces it when it arrives, but only if
the picture still wants that effect (the user may have selected another item
meanwhile). Resolves once the sharp image is applied or has failed.
*/
export async function showEffectBehindPicture(img, effectName) {
  if (!img) return;

  const effectId = resolveEffectIdByName(effectName);
  const wanted = effectId == null ? "" : String(effectId);
  if ((img.dataset.tf2teEffectId || "") === wanted) return;

  if (effectId == null) {
    delete img.dataset.tf2teEffectId;
    img.style.backgroundImage = "";
    return;
  }

  img.dataset.tf2teEffectId = wanted;
  setBackground(img, bundledParticleUrl(effectId));

  const sharpUrl = hostedParticleUrl(effectId, sharpEffectSize(pictureWidthPx(img), globalThis.devicePixelRatio || 1));
  if (!(await imageLoads(sharpUrl))) return; // the bundled image stays
  if (img.dataset.tf2teEffectId !== wanted) return; // another item was selected while this loaded
  setBackground(img, sharpUrl);
}
