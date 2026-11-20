/*
@description: The trade offer alert sound: the bundled sounds, the storage
keys of the "Trade offer sound" settings, the checks a user's own sound file
must pass, and resolveAlertSound, which turns the stored settings into what
an alert plays. Pure logic with no top-level await or import(), shared by
background.js, offscreen/offscreen.js and settings/alertSoundSettings.js.
*/

// The "you got a new trade offer" sounds that ship with the extension, in
// the popup's dropdown order. Paths are relative to the extension root (each
// caller turns one into a URL with chrome.runtime.getURL). Authors and
// licenses: THIRD_PARTY_NOTICES.md. Played by:
//   - offscreen/offscreen.js (Chrome): a bare MV3 service worker has no
//     Audio/DOM access at all, so background.js asks Chrome to spin up a
//     hidden offscreen document, which plays it instead.
//   - background.js's own Firefox fallback: Firefox's background script is
//     a real page (not a bare service worker), so it plays it directly.
//   - the popup's preview.
export const BUNDLED_SOUNDS = [
  { id: "level-up", label: "Level Up", path: "public/sounds/level-up.ogg" },
  { id: "glockenspiel", label: "Glockenspiel", path: "public/sounds/glockenspiel.mp3" },
  { id: "ding", label: "Ding", path: "public/sounds/ding.ogg" },
  { id: "button-chime", label: "Button Chime", path: "public/sounds/button-chime.ogg" },
  { id: "hint", label: "Hint", path: "public/sounds/hint.ogg" },
];
export const DEFAULT_SOUND_ID = "level-up";
// The selection value for the user's own sound (ALERT_CUSTOM_SOUND_KEY).
export const CUSTOM_SOUND_ID = "custom";

export const NOTIFICATION_SOUND_PATH = BUNDLED_SOUNDS.find((s) => s.id === DEFAULT_SOUND_ID).path;

// chrome.storage.local keys, written by the popup's "Trade offer sound"
// settings and read by background.js when an alert plays.
export const ALERT_MUTED_KEY = "tradeOfferAlertMuted";
export const ALERT_VOLUME_KEY = "tradeOfferAlertVolume";
export const ALERT_SOUND_ID_KEY = "tradeOfferAlertSoundId";
// The user's own sound, kept while another sound is selected so switching
// back doesn't mean picking the file again.
export const ALERT_CUSTOM_SOUND_KEY = "tradeOfferAlertCustomSound";

// The volume slider's default. 22% squared is ~0.05, the quiet level the
// alert has always played at.
export const DEFAULT_VOLUME_PERCENT = 22;

/**
 * HTMLAudioElement.volume (0-1) for a slider percent. Squared because
 * loudness isn't linear: a straight mapping crams every usable level into
 * the slider's first few percent.
 */
export function volumeFromPercent(percent) {
  const p = Number(percent);
  if (!Number.isFinite(p)) return volumeFromPercent(DEFAULT_VOLUME_PERCENT);
  const clamped = Math.min(100, Math.max(0, p));
  return (clamped / 100) ** 2;
}

/** The saved slider percent, or the default when none (or garbage) is saved. */
export function storedVolumePercent(value) {
  const p = Number(value);
  return value != null && Number.isFinite(p) ? Math.min(100, Math.max(0, Math.round(p))) : DEFAULT_VOLUME_PERCENT;
}

// A custom alert is a short sound, not music: these keep it small enough for
// chrome.storage.local (stored as a data URL, a third larger than the file).
export const CUSTOM_SOUND_MAX_BYTES = 1024 * 1024;
export const CUSTOM_SOUND_MAX_SECONDS = 10;

// Formats both Firefox and Chrome play. Matched by MIME type or extension,
// since browsers report some files with an empty or vendor-specific type.
const ALLOWED_SOUND_TYPES = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/ogg",
  "audio/wav",
  "audio/wave",
  "audio/x-wav",
  "audio/vnd.wave",
]);
const ALLOWED_SOUND_EXTENSIONS = [".mp3", ".ogg", ".oga", ".wav"];
export const CUSTOM_SOUND_ACCEPT = [...ALLOWED_SOUND_EXTENSIONS, "audio/mpeg", "audio/ogg", "audio/wav"].join(",");

/**
 * Why a picked file can't be used as the alert sound, checked before reading
 * it, or null if its type and size are fine. Its length is checked
 * separately (validateSoundDuration), once it has been decoded.
 */
export function validateSoundFile({ name = "", type = "", size = 0 } = {}) {
  const lowerName = String(name).toLowerCase();
  const typeOk = ALLOWED_SOUND_TYPES.has(String(type).toLowerCase());
  const extensionOk = ALLOWED_SOUND_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
  if (!typeOk && !extensionOk) return "Use an MP3, OGG or WAV file.";
  if (!(size > 0)) return "That file is empty.";
  if (size > CUSTOM_SOUND_MAX_BYTES) {
    return `That file is ${(size / (1024 * 1024)).toFixed(1)} MB. Use one up to 1 MB.`;
  }
  return null;
}

const MIME_BY_EXTENSION = { ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".oga": "audio/ogg", ".wav": "audio/wav" };

/**
 * A FileReader data URL with an audio/* type. A file the browser reports
 * with no type comes out as "data:application/octet-stream;...", which
 * resolveAlertSound wouldn't accept, so its type is taken from the extension.
 */
export function audioDataUrl(dataUrl, fileName = "") {
  if (dataUrl.startsWith("data:audio/")) return dataUrl;
  const ext = Object.keys(MIME_BY_EXTENSION).find((e) => String(fileName).toLowerCase().endsWith(e));
  const comma = dataUrl.indexOf(",");
  if (!ext || comma === -1 || !dataUrl.slice(0, comma).endsWith(";base64")) return dataUrl;
  return `data:${MIME_BY_EXTENSION[ext]};base64${dataUrl.slice(comma)}`;
}

/** Why a decoded sound is too long (or unreadable), or null if it's fine. */
export function validateSoundDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "Couldn't read that sound's length. Try another file.";
  if (seconds > CUSTOM_SOUND_MAX_SECONDS) {
    return `That sound is ${Math.round(seconds)} seconds long. Use one up to ${CUSTOM_SOUND_MAX_SECONDS} seconds.`;
  }
  return null;
}

/** Whether a stored custom sound record is playable. */
export function isValidCustomSound(custom) {
  return typeof custom?.dataUrl === "string" && custom.dataUrl.startsWith("data:audio/");
}

/**
 * The selected sound's id: a bundled sound's id, or CUSTOM_SOUND_ID when the
 * user's own sound is selected and still there. Saved before there was a
 * choice of sounds, a custom sound with no saved id counts as selected.
 * Anything else (unset, a removed bundled sound, a missing custom sound)
 * falls back to the default.
 */
export function selectedSoundId(stored = {}) {
  const id = stored[ALERT_SOUND_ID_KEY];
  const hasCustom = isValidCustomSound(stored[ALERT_CUSTOM_SOUND_KEY]);
  if (id === CUSTOM_SOUND_ID) return hasCustom ? CUSTOM_SOUND_ID : DEFAULT_SOUND_ID;
  if (BUNDLED_SOUNDS.some((s) => s.id === id)) return id;
  return id == null && hasCustom ? CUSTOM_SOUND_ID : DEFAULT_SOUND_ID;
}

/**
 * What an alert plays, from the stored settings: { src, volume }, or null
 * when muted. `src` is the custom sound's data URL, or a bundled sound's URL
 * from `getURL` (chrome.runtime.getURL).
 */
export function resolveAlertSound(stored = {}, getURL) {
  if (stored[ALERT_MUTED_KEY]) return null;
  const id = selectedSoundId(stored);
  const src = id === CUSTOM_SOUND_ID
    ? stored[ALERT_CUSTOM_SOUND_KEY].dataUrl
    : getURL(BUNDLED_SOUNDS.find((s) => s.id === id).path);
  return { src, volume: volumeFromPercent(storedVolumePercent(stored[ALERT_VOLUME_KEY])) };
}
