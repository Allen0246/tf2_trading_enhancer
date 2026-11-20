/*
@description: Shared "this link button can't link yet, and here's why"
states for the item link buttons, so a missing button never looks like a bug:

- posts.tf without a Steam Web API key: the button stays in its usual spot,
  dimmed, with an amber key icon. Hovering explains it; clicking opens the
  extension settings at the key field (background.js's
  OPEN_STEAM_API_KEY_SETTINGS opens the settings page at #steam-key).
- pricedb.io rate limited: the button shows a clock and a seconds countdown
  from pricedb.io's own Retry-After, then retries by itself.
- pricedb.io still loading: the button already sits in its spot with its
  label and a small spinning ring, so the rest of the row never waits on
  pricedb.io's lookup (fillPricedbSlot then turns it into the link, the
  countdown, or removes it).

Each site still builds its own button element (its own classes and styling);
these only put that element into a state and back. Colors: amber means "you
can fix this", grey means "just wait".
*/

import { isPostsTfUnresolved } from "./tf2StatsLinks/index.js";
import { hasSteamApiKey } from "./tf2Schema.js";

export const POSTS_TF_KEY_HINT_TITLE = "posts.tf needs a Steam Web API key. Click to add one (one-time setup).";
// For the single prompt shown when the stats/classifieds links need the key
// too; it covers posts.tf as well, so posts.tf gets no hint of its own then.
export const STATS_KEY_HINT_LABEL = "Set Steam API key for stats/classifieds";
export const STATS_KEY_HINT_TITLE = "Stats, classifieds and posts.tf links need a Steam Web API key. Click to add one (one-time setup).";

const KEY_ICON_COLOR = "#f0b429";
const WAIT_ICON_COLOR = "#8fa3b8";
// Used when pricedb.io's 429 carries no Retry-After header.
const DEFAULT_RETRY_SECONDS = 30;

const SVG_NS = "http://www.w3.org/2000/svg";

/*
@description: Builds a small inline stroke icon from [tagName, attributes]
pairs (no innerHTML, so it is safe on any host page's CSP).
*/
function buildIcon(paths, color) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "11");
  svg.setAttribute("height", "11");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", color);
  svg.setAttribute("stroke-width", "2.4");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.style.marginLeft = "4px";
  svg.style.verticalAlign = "-1px";
  for (const [tag, attrs] of paths) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
    svg.appendChild(el);
  }
  return svg;
}

function buildKeyIcon() {
  return buildIcon(
    [
      ["circle", { cx: "7.5", cy: "15.5", r: "4.5" }],
      ["path", { d: "M10.7 12.3 21 2" }],
      ["path", { d: "m16 7 3 3" }],
      ["path", { d: "m19 4 2 2" }],
    ],
    KEY_ICON_COLOR
  );
}

// A ring with a gap that turns once every 0.9s (SVG's own animateTransform,
// so no stylesheet is needed on the host page); still for a viewer who asked
// for reduced motion.
function buildSpinnerIcon() {
  const svg = buildIcon([["circle", { cx: "12", cy: "12", r: "9", "stroke-opacity": "0.3" }]], WAIT_ICON_COLOR);
  const arc = document.createElementNS(SVG_NS, "path");
  arc.setAttribute("d", "M21 12a9 9 0 0 0-9-9");
  const reduceMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  if (!reduceMotion) {
    const spin = document.createElementNS(SVG_NS, "animateTransform");
    spin.setAttribute("attributeName", "transform");
    spin.setAttribute("type", "rotate");
    spin.setAttribute("from", "0 12 12");
    spin.setAttribute("to", "360 12 12");
    spin.setAttribute("dur", "0.9s");
    spin.setAttribute("repeatCount", "indefinite");
    arc.appendChild(spin);
  }
  svg.appendChild(arc);
  return svg;
}

function buildClockIcon() {
  return buildIcon(
    [
      ["circle", { cx: "12", cy: "12", r: "9" }],
      ["path", { d: "M12 7v5l3 2" }],
    ],
    WAIT_ICON_COLOR
  );
}

/*
@description: Whether posts.tf is missing ONLY because no Steam Web API key
is saved. False for item types posts.tf doesn't cover (Kits, War Paints...)
and when a key exists but the item still didn't resolve (e.g. a brand-new
item) - adding a key wouldn't help there, so no hint is shown.
*/
export async function postsTfNeedsApiKey(classifiedsFilters, postsTfHref) {
  if (!isPostsTfUnresolved(classifiedsFilters, postsTfHref)) return false;
  return !(await hasSteamApiKey());
}

function openSteamApiKeySettings() {
  // Fire-and-forget; a rejected promise (e.g. the extension was reloaded
  // under the page) has nothing useful to recover.
  Promise.resolve(chrome.runtime.sendMessage({ type: "OPEN_STEAM_API_KEY_SETTINGS" })).catch(() => {});
}

function onKeyHintActivate(event) {
  const button = event.currentTarget;
  if (button.dataset.tf2teNeedsKey !== "1") return;
  if (event.type === "keydown" && event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  event.stopPropagation();
  openSteamApiKeySettings();
}

/*
@description: Puts a link button into the "needs a Steam Web API key" state:
label + amber key icon, explanatory title, and click/Enter/Space opens the
key settings. Safe to call repeatedly on the same element (a reused tooltip
node).
*/
export function applyApiKeyHint(button, { label, title }) {
  stopRetryCountdown(button);
  clearLoadingMarks(button);
  button.removeAttribute("href");
  button.removeAttribute("target");
  button.textContent = label;
  button.appendChild(buildKeyIcon());
  button.title = title;
  button.setAttribute("role", "button");
  button.tabIndex = 0;
  button.style.opacity = "0.7";
  button.style.cursor = "pointer";
  button.dataset.tf2teNeedsKey = "1";

  if (!button.dataset.tf2teKeyHintBound) {
    button.addEventListener("click", onKeyHintActivate);
    button.addEventListener("keydown", onKeyHintActivate);
    button.dataset.tf2teKeyHintBound = "1";
  }
}

export function applyPostsTfKeyHint(button, label = "posts.tf") {
  applyApiKeyHint(button, { label, title: POSTS_TF_KEY_HINT_TITLE });
}

/*
@description: The absolute time a rate-limited lookup may retry, for a caller
that re-renders its buttons (scrap.tf's item card) and so has to keep the
countdown's end fixed across redraws instead of restarting it each time.
*/
export function retryAtFromNow(retryAfterMs) {
  return Date.now() + (retryAfterMs ?? DEFAULT_RETRY_SECONDS * 1000);
}

/*
@description: Turns a button previously in the key-hint state back into a
plain link. The bound listener stays but does nothing once the flag is gone.
*/
export function clearPostsTfKeyHint(button, label = "posts.tf") {
  if (button.dataset.tf2teNeedsKey !== "1") return;
  delete button.dataset.tf2teNeedsKey;
  button.textContent = label;
  button.removeAttribute("title");
  button.removeAttribute("role");
  button.removeAttribute("tabindex");
  button.style.opacity = "";
  button.style.cursor = "";
}

/*
@description: Puts a link button into the "still looking it up" state: its
own label plus a spinning ring, dimmed, a progress cursor, and an explaining
title. Marked aria-busy for screen readers.
*/
export function applyLoadingState(button, label = "pricedb.io", serviceName = label) {
  stopRetryCountdown(button);
  button.removeAttribute("href");
  button.removeAttribute("target");
  button.textContent = label;
  button.appendChild(buildSpinnerIcon());
  button.title = `Looking up this item on ${serviceName}…`;
  button.setAttribute("aria-busy", "true");
  button.style.opacity = "0.6";
  button.style.cursor = "progress";
  button.dataset.tf2teLoading = "1";
}

function clearLoadingMarks(button) {
  button.removeAttribute("aria-busy");
  delete button.dataset.tf2teLoading;
}

/*
@description: Settles a loading pricedb.io slot (applyLoadingState) once the
lookup answers: replaced by the real link (buildLink(href) makes it, in the
caller's own button style), turned into the rate-limit countdown (which
loads again in place when it runs out), or removed for a genuine "no
listing". isCurrent() lets the caller drop a stale answer (a different item
is showing by now). lookup() returns searchPricedbSkuStatus's result.
*/
export async function fillPricedbSlot(slot, { lookup, buildLink, isCurrent = () => true, label = "pricedb.io" }) {
  const { sku, rateLimited, retryAfterMs } = await lookup();
  if (!isCurrent() || !slot.isConnected) return;

  if (sku) {
    slot.replaceWith(buildLink(`https://pricedb.io/item/${encodeURIComponent(sku)}`));
    return;
  }
  if (rateLimited) {
    startRetryCountdown(slot, {
      label,
      retryAfterMs,
      onRetry: (isConnected) => {
        if (!isConnected || !isCurrent()) return;
        applyLoadingState(slot, label);
        fillPricedbSlot(slot, { lookup, buildLink, isCurrent, label });
      },
    });
    return;
  }
  slot.remove();
}

const countdowns = new WeakMap();

export function stopRetryCountdown(button) {
  const timer = countdowns.get(button);
  if (timer) clearInterval(timer);
  countdowns.delete(button);
}

/*
@description: Puts a button into the "rate limited, retrying in Ns" state and
counts down once a second. At zero it calls onRetry(isConnected) - the
caller re-runs its lookup if the button is still on the page, or arranges a
retry on the next hover if it isn't (a closed tooltip).
*/
export function startRetryCountdown(button, { label, serviceName = label, retryAfterMs, onRetry }) {
  stopRetryCountdown(button);
  clearLoadingMarks(button);

  let secondsLeft = Math.max(1, Math.ceil((retryAfterMs ?? DEFAULT_RETRY_SECONDS * 1000) / 1000));

  button.removeAttribute("href");
  button.removeAttribute("target");
  button.style.opacity = "0.6";
  button.style.cursor = "default";
  button.style.fontVariantNumeric = "tabular-nums";

  const render = () => {
    button.textContent = label;
    button.appendChild(buildClockIcon());
    button.append(` ${secondsLeft}s`);
    button.title = `${serviceName} is limiting requests right now. Retrying automatically in ${secondsLeft}s.`;
  };
  render();

  const timer = setInterval(() => {
    secondsLeft -= 1;
    if (secondsLeft > 0) {
      render();
      return;
    }
    stopRetryCountdown(button);
    onRetry(Boolean(button.isConnected));
  }, 1000);
  countdowns.set(button, timer);
}

/*
@description: Undoes startRetryCountdown's styling once the button becomes a
real link again.
*/
export function clearRetryCountdown(button, label) {
  stopRetryCountdown(button);
  clearLoadingMarks(button);
  button.textContent = label;
  button.removeAttribute("title");
  button.style.opacity = "";
  button.style.cursor = "";
  button.style.fontVariantNumeric = "";
}
