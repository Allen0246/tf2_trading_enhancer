import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_VOLUME_PERCENT, NOTIFICATION_SOUND_PATH, volumeFromPercent } from "../utils/notificationSound.js";

// offscreen.js is a classic (non-ESM-export) script: it builds soundUrl and
// registers its chrome.runtime.onMessage listener as top-level side effects
// the moment it's loaded - same "fake globalThis.chrome before importing,
// import once, drive the captured listener" pattern tests/background.test.js
// uses.
const messageListeners = [];
let audioInstances = [];

class FakeAudio {
  constructor(src) {
    this.src = src;
    this.volume = undefined;
    audioInstances.push(this);
  }
  play() {
    return FakeAudio.nextPlayResult();
  }
}
FakeAudio.nextPlayResult = () => Promise.resolve();

globalThis.chrome = {
  runtime: {
    getURL: (path) => `fake://${path}`,
    onMessage: { addListener: (cb) => messageListeners.push(cb) },
  },
};
globalThis.Audio = FakeAudio;

await import("../offscreen/offscreen.js");

test("offscreen.js registers exactly one onMessage listener on load", () => {
  assert.equal(messageListeners.length, 1);
});

test("ignores messages that aren't PLAY_TRADEOFFER_ALERT_SOUND", () => {
  audioInstances = [];
  messageListeners[0]({ type: "SOMETHING_ELSE" });
  assert.equal(audioInstances.length, 0);
});

test("ignores a message with no type field, and a completely missing message, without throwing", () => {
  audioInstances = [];
  messageListeners[0]({});
  messageListeners[0](undefined);
  assert.equal(audioInstances.length, 0);
});

test("plays the sound at the configured path/volume on a PLAY_TRADEOFFER_ALERT_SOUND message", () => {
  audioInstances = [];
  FakeAudio.nextPlayResult = () => Promise.resolve();

  messageListeners[0]({ type: "PLAY_TRADEOFFER_ALERT_SOUND" });

  assert.equal(audioInstances.length, 1);
  assert.equal(audioInstances[0].src, `fake://${NOTIFICATION_SOUND_PATH}`);
  assert.equal(audioInstances[0].volume, volumeFromPercent(DEFAULT_VOLUME_PERCENT));
});

test("plays the sound and volume the message carries (a custom sound from background.js)", () => {
  audioInstances = [];
  FakeAudio.nextPlayResult = () => Promise.resolve();

  messageListeners[0]({ type: "PLAY_TRADEOFFER_ALERT_SOUND", src: "data:audio/mpeg;base64,AAAA", volume: 0.25 });

  assert.equal(audioInstances[0].src, "data:audio/mpeg;base64,AAAA");
  assert.equal(audioInstances[0].volume, 0.25);
});

test("plays one of the extension's own bundled sounds when the message names it", () => {
  audioInstances = [];
  messageListeners[0]({ type: "PLAY_TRADEOFFER_ALERT_SOUND", src: "fake://public/sounds/ding.ogg" }, { url: "fake://background.js" });
  assert.equal(audioInstances[0].src, "fake://public/sounds/ding.ogg");
});

test("falls back to the bundled chime for a sound that is neither the extension's own file nor an audio data URL", () => {
  audioInstances = [];
  for (const src of ["https://evil.example/loud.mp3", "data:text/html,<script>1</script>", "//evil.example/x.ogg"]) {
    messageListeners[0]({ type: "PLAY_TRADEOFFER_ALERT_SOUND", src });
  }
  assert.equal(audioInstances.length, 3);
  assert.ok(audioInstances.every((a) => a.src === `fake://${NOTIFICATION_SOUND_PATH}`));
});

test("ignores a PLAY_TRADEOFFER_ALERT_SOUND message sent by a content script", () => {
  audioInstances = [];
  messageListeners[0]({ type: "PLAY_TRADEOFFER_ALERT_SOUND" }, { tab: { id: 1 }, url: "https://backpack.tf/classifieds" });
  assert.equal(audioInstances.length, 0);
});

test("clamps an out-of-range volume, since HTMLAudioElement.volume throws outside 0-1", () => {
  audioInstances = [];
  messageListeners[0]({ type: "PLAY_TRADEOFFER_ALERT_SOUND", volume: 4 });
  messageListeners[0]({ type: "PLAY_TRADEOFFER_ALERT_SOUND", volume: -1 });
  assert.equal(audioInstances[0].volume, 1);
  assert.equal(audioInstances[1].volume, 0);
  assert.equal(audioInstances[0].src, `fake://${NOTIFICATION_SOUND_PATH}`);
});

test("warns via console.warn when play() rejects, without throwing out of the listener", async () => {
  audioInstances = [];
  const playError = new Error("autoplay blocked");
  FakeAudio.nextPlayResult = () => Promise.reject(playError);

  const originalWarn = console.warn;
  let warnedWith = null;
  console.warn = (...args) => {
    warnedWith = args;
  };

  try {
    messageListeners[0]({ type: "PLAY_TRADEOFFER_ALERT_SOUND" });
    // audio.play().catch(...) attaches asynchronously - give the rejection
    // handler a turn to run before asserting on it.
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.ok(warnedWith);
    assert.match(warnedWith[0], /Offscreen audio playback failed/);
    assert.equal(warnedWith[1], playError);
  } finally {
    console.warn = originalWarn;
  }
});
