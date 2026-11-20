/*
@description: The settings page (manifest options_ui: the popup's cog,
about:addons → Options, or right-click the toolbar icon → Options). Built from
the same settings classes as the popup (settings/*.js), so every setting
works the same in both, and a change made in one shows up in the other
through chrome.storage. This file only adds what the page itself needs: the
version, the side menu (current section, amber dots for missing keys) and
scrolling to the section the popup asked for (openSettingsPage).
*/
import { AlertSoundSettings } from "../settings/alertSoundSettings.js";
import { ApiKeySettings } from "../settings/apiKeySettings.js";
import { GeneralSettings } from "../settings/generalSettings.js";
import { SETTINGS_FOCUS_KEY } from "../settings/settingsSection.js";

const SECTIONS = [GeneralSettings, AlertSoundSettings, ApiKeySettings];

// A focus request older than this (from a page that never opened) is ignored.
const FOCUS_MAX_AGE_MS = 30 * 1000;
// A section counts as the current one once its top is this close to the
// top of the window.
const NAV_ACTIVE_OFFSET_PX = 140;

function renderVersion() {
  const { version } = chrome.runtime.getManifest();
  const badge = document.getElementById("version-badge");
  if (badge) badge.textContent = `v${version}`;
  const about = document.getElementById("about-version");
  if (about) about.textContent = `Version ${version}`;
}

// One failing section mustn't stop the others.
async function initSections() {
  for (const Section of SECTIONS) {
    try {
      await new Section({ page: "options" }).init();
    } catch (e) {
      console.error(`[TF2 Trading Enhancer] settings: ${Section.name} failed:`, e);
    }
  }
}

/*
@description: The side menu's amber dots, the same "needs attention" signal
as the section headings': Trade offer alerts without a Steam Web API key
(nothing is checked) and API keys, both while no Steam Web API key is saved.
*/
async function initNavDots() {
  const alertsDot = document.getElementById("nav-alerts-dot");
  const apiDot = document.getElementById("nav-api-dot");
  if (!alertsDot && !apiDot) return;

  const render = async () => {
    const { steamApiKey } = await chrome.storage.local.get(["steamApiKey"]);
    if (alertsDot) alertsDot.hidden = Boolean(steamApiKey);
    if (apiDot) apiDot.hidden = Boolean(steamApiKey);
  };
  await render();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && "steamApiKey" in changes) {
      return render();
    }
  });
}

// Scrolls to a section and briefly highlights it, so it's clear where the
// popup's button led.
function focusSection(sectionId) {
  const section = document.getElementById(sectionId);
  if (!section) return;
  section.scrollIntoView?.({ block: "start", behavior: "smooth" });
  section.classList.add("section--flash");
  setTimeout(() => section.classList.remove("section--flash"), 1600);
}

/*
@description: Follows openSettingsPage's focus requests: one written just
before this page opened, and ones written while it is already open (the
browser then reuses this tab). Each is used once.
*/
async function initFocusRequests() {
  const take = async (request) => {
    if (!request?.section) return;
    if (Date.now() - request.at < FOCUS_MAX_AGE_MS) focusSection(request.section);
    await chrome.storage.local.remove(SETTINGS_FOCUS_KEY);
  };
  const stored = await chrome.storage.local.get([SETTINGS_FOCUS_KEY]);
  await take(stored[SETTINGS_FOCUS_KEY]);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[SETTINGS_FOCUS_KEY]?.newValue) return take(changes[SETTINGS_FOCUS_KEY].newValue);
  });
}

// Marks the side menu link of the section being read.
function initNavHighlight() {
  const links = [...(document.querySelectorAll?.(".side-nav__link") || [])];
  if (!links.length) return;
  const update = () => {
    const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
    let current = links[0];
    for (const link of links) {
      const section = document.getElementById(link.dataset.section);
      if (section && (atBottom || section.getBoundingClientRect().top <= NAV_ACTIVE_OFFSET_PX)) current = link;
    }
    links.forEach((link) => {
      link.classList.toggle("is-active", link === current);
      if (link === current) link.setAttribute("aria-current", "true");
      else link.removeAttribute("aria-current");
    });
  };
  window.addEventListener("scroll", update, { passive: true });
  update();
}

export async function initOptionsPage() {
  renderVersion();
  await initSections();
  await initNavDots();
  await initFocusRequests();
  initNavHighlight();
}

// A module script runs once the document is parsed.
initOptionsPage();
