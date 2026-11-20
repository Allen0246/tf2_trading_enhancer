/*
@description: The whole reason this document exists - see background.js's
own note on why. A bare MV3 service worker has no Audio/DOM access at all, so
background.js asks chrome.offscreen to spin up this hidden page instead,
which plays the notification sound on its behalf whenever a
PLAY_TRADEOFFER_ALERT_SOUND message arrives. Chrome only ever allows one
offscreen document at a time, and background.js keeps this one open for the
extension's lifetime once created (rather than closing/recreating it per
alert) - reused for every future alert instead.

The message carries the sound (`src`, the bundled chime's URL or a custom
sound's data URL) and its `volume`, because an offscreen document can't read
chrome.storage. Without them it falls back to the bundled chime at the
default volume.

A runtime message reaches every extension page, this one included, whoever
sent it. So one from a content script is ignored, and only the two kinds of
sound background.js ever sends are played: a file of the extension's own, or
an audio data URL (the custom sound).
*/
import { isExtensionPageSender } from "../utils/messageSender.js";
import { DEFAULT_VOLUME_PERCENT, NOTIFICATION_SOUND_PATH, volumeFromPercent } from "../utils/notificationSound.js";

const defaultSoundUrl = chrome.runtime.getURL(NOTIFICATION_SOUND_PATH);

function isPlayableSoundUrl(src) {
  return typeof src === "string" && (src.startsWith("data:audio/") || src.startsWith(chrome.runtime.getURL("")));
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== "PLAY_TRADEOFFER_ALERT_SOUND") return;
  if (!isExtensionPageSender(sender)) return;

  const audio = new Audio(isPlayableSoundUrl(message.src) ? message.src : defaultSoundUrl);
  // Clamped: HTMLAudioElement.volume throws outside 0-1.
  audio.volume = Number.isFinite(message.volume)
    ? Math.min(1, Math.max(0, message.volume))
    : volumeFromPercent(DEFAULT_VOLUME_PERCENT);
  audio.play().catch((e) => {
    console.warn("[TF2 Trading Enhancer] Offscreen audio playback failed:", e);
  });
});
