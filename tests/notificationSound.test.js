import { test } from "node:test";
import assert from "node:assert/strict";
import { statSync } from "node:fs";
import {
  ALERT_CUSTOM_SOUND_KEY,
  ALERT_MUTED_KEY,
  ALERT_SOUND_ID_KEY,
  ALERT_VOLUME_KEY,
  BUNDLED_SOUNDS,
  CUSTOM_SOUND_ID,
  CUSTOM_SOUND_MAX_BYTES,
  DEFAULT_SOUND_ID,
  DEFAULT_VOLUME_PERCENT,
  NOTIFICATION_SOUND_PATH,
  audioDataUrl,
  isValidCustomSound,
  resolveAlertSound,
  selectedSoundId,
  storedVolumePercent,
  validateSoundDuration,
  validateSoundFile,
  volumeFromPercent,
} from "../utils/notificationSound.js";

const getURL = (path) => `ext://${path}`;

test("every bundled sound has a unique id, a label and an extension-relative path to a real, small file", () => {
  assert.equal(new Set(BUNDLED_SOUNDS.map((s) => s.id)).size, BUNDLED_SOUNDS.length);
  for (const { id, label, path } of BUNDLED_SOUNDS) {
    assert.ok(id && label && id !== CUSTOM_SOUND_ID, id);
    // Relative (no leading slash / scheme): every caller turns it into a URL
    // with chrome.runtime.getURL, which expects an extension-relative path.
    assert.match(path, /^public\/sounds\/[a-z0-9-]+\.(mp3|ogg|wav)$/, id);
    const { size } = statSync(new URL(`../${path}`, import.meta.url));
    assert.ok(size > 0 && size <= 512 * 1024, `${path} is ${size} bytes`);
  }
});

test("the default sound is a bundled one, and NOTIFICATION_SOUND_PATH is its path", () => {
  const defaultSound = BUNDLED_SOUNDS.find((s) => s.id === DEFAULT_SOUND_ID);
  assert.ok(defaultSound);
  assert.equal(NOTIFICATION_SOUND_PATH, defaultSound.path);
});

test("the ripped TF2 sound is no longer bundled", () => {
  assert.equal(BUNDLED_SOUNDS.some((s) => /tf2-trade/.test(s.path)), false);
  assert.throws(() => statSync(new URL("../public/sounds/tf2-trade.mp3", import.meta.url)));
});

test("the default slider percent keeps the chime at its old quiet level (~0.05)", () => {
  assert.equal(DEFAULT_VOLUME_PERCENT, 22);
  assert.ok(Math.abs(volumeFromPercent(DEFAULT_VOLUME_PERCENT) - 0.05) < 0.002);
});

test("volumeFromPercent squares the percent into 0-1, clamped", () => {
  assert.equal(volumeFromPercent(0), 0);
  assert.equal(volumeFromPercent(50), 0.25);
  assert.equal(volumeFromPercent(100), 1);
  assert.equal(volumeFromPercent("50"), 0.25);
  assert.equal(volumeFromPercent(150), 1);
  assert.equal(volumeFromPercent(-10), 0);
  assert.equal(volumeFromPercent("loud"), volumeFromPercent(DEFAULT_VOLUME_PERCENT));
});

test("storedVolumePercent uses the saved value, or the default when unset or garbage", () => {
  assert.equal(storedVolumePercent(undefined), DEFAULT_VOLUME_PERCENT);
  assert.equal(storedVolumePercent(null), DEFAULT_VOLUME_PERCENT);
  assert.equal(storedVolumePercent("x"), DEFAULT_VOLUME_PERCENT);
  assert.equal(storedVolumePercent(0), 0);
  assert.equal(storedVolumePercent(64), 64);
  assert.equal(storedVolumePercent(64.6), 65);
  assert.equal(storedVolumePercent(300), 100);
});

test("validateSoundFile accepts MP3, OGG and WAV by type or by extension", () => {
  assert.equal(validateSoundFile({ name: "ding.mp3", type: "audio/mpeg", size: 1000 }), null);
  assert.equal(validateSoundFile({ name: "ding.ogg", type: "audio/ogg", size: 1000 }), null);
  assert.equal(validateSoundFile({ name: "ding.wav", type: "audio/x-wav", size: 1000 }), null);
  // Some browsers report no type at all: the extension decides.
  assert.equal(validateSoundFile({ name: "Ding.WAV", type: "", size: 1000 }), null);
  assert.equal(validateSoundFile({ name: "ding", type: "audio/wav", size: 1000 }), null);
});

test("validateSoundFile refuses other formats, empty files and files over 1 MB", () => {
  assert.equal(validateSoundFile({ name: "song.flac", type: "audio/flac", size: 1000 }), "Use an MP3, OGG or WAV file.");
  assert.equal(validateSoundFile({ name: "clip.mp4", type: "video/mp4", size: 1000 }), "Use an MP3, OGG or WAV file.");
  assert.equal(validateSoundFile({ name: "ding.mp3", type: "audio/mpeg", size: 0 }), "That file is empty.");
  assert.equal(validateSoundFile({ name: "ding.mp3", type: "audio/mpeg", size: CUSTOM_SOUND_MAX_BYTES }), null);
  assert.equal(
    validateSoundFile({ name: "loop.mp3", type: "audio/mpeg", size: 5 * 1024 * 1024 }),
    "That file is 5.0 MB. Use one up to 1 MB.",
  );
  assert.equal(validateSoundFile(), "Use an MP3, OGG or WAV file.");
});

test("validateSoundDuration allows up to 10 seconds and refuses unreadable lengths", () => {
  assert.equal(validateSoundDuration(0.4), null);
  assert.equal(validateSoundDuration(10), null);
  assert.equal(validateSoundDuration(10.4), "That sound is 10 seconds long. Use one up to 10 seconds.");
  assert.equal(validateSoundDuration(169200), "That sound is 169200 seconds long. Use one up to 10 seconds.");
  // Streams report Infinity, broken files NaN.
  assert.match(validateSoundDuration(Infinity), /Couldn't read/);
  assert.match(validateSoundDuration(NaN), /Couldn't read/);
  assert.match(validateSoundDuration(0), /Couldn't read/);
});

test("audioDataUrl keeps an audio data URL and fixes an untyped one from the extension", () => {
  assert.equal(audioDataUrl("data:audio/mpeg;base64,AAAA", "a.mp3"), "data:audio/mpeg;base64,AAAA");
  assert.equal(audioDataUrl("data:application/octet-stream;base64,AAAA", "a.WAV"), "data:audio/wav;base64,AAAA");
  assert.equal(audioDataUrl("data:;base64,AAAA", "a.ogg"), "data:audio/ogg;base64,AAAA");
  // Nothing to go on: left alone (resolveAlertSound then ignores it).
  assert.equal(audioDataUrl("data:application/octet-stream;base64,AAAA", "a.bin"), "data:application/octet-stream;base64,AAAA");
});

const CUSTOM = { name: "ding.mp3", seconds: 1, bytes: 3, dataUrl: "data:audio/mpeg;base64,AAAA" };

test("isValidCustomSound only accepts a record with an audio data URL", () => {
  assert.equal(isValidCustomSound(CUSTOM), true);
  for (const custom of [undefined, null, {}, { dataUrl: 5 }, { dataUrl: "https://example.com/x.mp3" }, { dataUrl: "data:text/html,<b>" }]) {
    assert.equal(isValidCustomSound(custom), false);
  }
});

test("selectedSoundId: nothing saved is the default", () => {
  assert.equal(selectedSoundId({}), DEFAULT_SOUND_ID);
  assert.equal(selectedSoundId(), DEFAULT_SOUND_ID);
});

test("selectedSoundId: a saved bundled sound is used", () => {
  assert.equal(selectedSoundId({ [ALERT_SOUND_ID_KEY]: "ding" }), "ding");
  // Picked while a custom sound exists: the bundled one still wins.
  assert.equal(selectedSoundId({ [ALERT_SOUND_ID_KEY]: "ding", [ALERT_CUSTOM_SOUND_KEY]: CUSTOM }), "ding");
});

test("selectedSoundId: the custom sound only while it's still there", () => {
  assert.equal(selectedSoundId({ [ALERT_SOUND_ID_KEY]: CUSTOM_SOUND_ID, [ALERT_CUSTOM_SOUND_KEY]: CUSTOM }), CUSTOM_SOUND_ID);
  assert.equal(selectedSoundId({ [ALERT_SOUND_ID_KEY]: CUSTOM_SOUND_ID }), DEFAULT_SOUND_ID);
  assert.equal(selectedSoundId({ [ALERT_SOUND_ID_KEY]: CUSTOM_SOUND_ID, [ALERT_CUSTOM_SOUND_KEY]: { dataUrl: "x" } }), DEFAULT_SOUND_ID);
});

test("selectedSoundId: a custom sound saved before there was a choice stays selected", () => {
  assert.equal(selectedSoundId({ [ALERT_CUSTOM_SOUND_KEY]: CUSTOM }), CUSTOM_SOUND_ID);
});

test("selectedSoundId: an unknown id (e.g. a sound removed in an update) falls back to the default", () => {
  assert.equal(selectedSoundId({ [ALERT_SOUND_ID_KEY]: "tf2-trade" }), DEFAULT_SOUND_ID);
  assert.equal(selectedSoundId({ [ALERT_SOUND_ID_KEY]: "tf2-trade", [ALERT_CUSTOM_SOUND_KEY]: CUSTOM }), DEFAULT_SOUND_ID);
});

test("resolveAlertSound: a selected bundled sound plays from its path", () => {
  assert.equal(resolveAlertSound({ [ALERT_SOUND_ID_KEY]: "hint" }, getURL).src, "ext://public/sounds/hint.ogg");
});

test("resolveAlertSound: muted plays nothing", () => {
  assert.equal(resolveAlertSound({ [ALERT_MUTED_KEY]: true }, getURL), null);
});

test("resolveAlertSound: nothing saved plays the bundled chime at the default volume", () => {
  assert.deepEqual(resolveAlertSound({}, getURL), {
    src: `ext://${NOTIFICATION_SOUND_PATH}`,
    volume: volumeFromPercent(DEFAULT_VOLUME_PERCENT),
  });
  assert.deepEqual(resolveAlertSound(undefined, getURL).src, `ext://${NOTIFICATION_SOUND_PATH}`);
});

test("resolveAlertSound: a saved custom sound and volume are used", () => {
  const stored = {
    [ALERT_VOLUME_KEY]: 50,
    [ALERT_CUSTOM_SOUND_KEY]: { name: "ding.mp3", seconds: 1, bytes: 3, dataUrl: "data:audio/mpeg;base64,AAAA" },
  };
  assert.deepEqual(resolveAlertSound(stored, getURL), { src: "data:audio/mpeg;base64,AAAA", volume: 0.25 });
});

test("resolveAlertSound: a broken custom sound record falls back to the bundled chime", () => {
  for (const custom of [null, {}, { dataUrl: 5 }, { dataUrl: "https://example.com/x.mp3" }, { dataUrl: "data:text/html,<b>" }]) {
    assert.equal(resolveAlertSound({ [ALERT_CUSTOM_SOUND_KEY]: custom }, getURL).src, `ext://${NOTIFICATION_SOUND_PATH}`);
  }
});
