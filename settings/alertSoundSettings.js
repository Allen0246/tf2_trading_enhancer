/*
@description: The trade offer sound: a dropdown of the bundled sounds plus the
user's own (MP3/OGG/WAV, up to 10 seconds and 1 MB, the limits in
utils/notificationSound.js, stored as a data URL), a volume slider and a
Play/Stop preview. background.js plays whatever is saved here. Without a
Steam Web API key nothing is checked, so both pages say so in a warning box
(#alert-sound-key-warning) until one is saved. The settings page's links to
its key section; the popup's has a button (#alert-sound-key-add) that opens
the Steam Web API settings further down and puts the cursor in the key field.

Firefox closes the toolbar popup as soon as a file picker opens, and the
picked file is lost with it, so in the popup "Add your own…" opens the
settings page at this section, where the file is picked.
*/
import * as sound from "../utils/notificationSound.js";
import { SettingsSection, openSettingsPage } from "./settingsSection.js";

// A file that never loads (or never errors) mustn't leave "Checking…" up forever.
const SOUND_METADATA_TIMEOUT_MS = 5000;

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Couldn't read that file."));
    reader.readAsDataURL(file);
  });
}

// The sound's real length, by letting the browser decode it. Rejects for a
// file that isn't a sound this browser can play, whatever its name says.
function readSoundDuration(src) {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    const timer = setTimeout(() => reject(new Error("Couldn't read that sound. Try another file.")), SOUND_METADATA_TIMEOUT_MS);
    audio.addEventListener("loadedmetadata", () => {
      clearTimeout(timer);
      resolve(audio.duration);
    });
    audio.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("That file isn't a sound this browser can play."));
    });
    audio.preload = "metadata";
    audio.src = src;
  });
}

export class AlertSoundSettings extends SettingsSection {
  async init() {
    this.playBtn = this.el("alert-sound-play");
    this.volumeInput = this.el("alert-sound-volume");
    this.selectEl = this.el("alert-sound-select");
    if (!this.playBtn || !this.volumeInput || !this.selectEl) return;
    this.volumeValue = this.el("alert-sound-volume-value");
    this.removeBtn = this.el("alert-sound-remove");
    this.chooseBtn = this.el("alert-sound-choose");
    this.fileInput = this.el("alert-sound-file");
    this.statusEl = this.el("alert-sound-status");
    this.preview = null;

    const stored = await chrome.storage.local.get([
      sound.ALERT_VOLUME_KEY, sound.ALERT_SOUND_ID_KEY, sound.ALERT_CUSTOM_SOUND_KEY, "steamApiKey",
    ]);
    this.applyStored(stored);
    this.volumeInput.value = String(sound.storedVolumePercent(stored[sound.ALERT_VOLUME_KEY]));
    this.renderVolume();
    this.renderSounds();
    this.renderPlaying(false);
    this.renderKeyWarning(Boolean(stored.steamApiKey));
    if (this.fileInput) this.fileInput.accept = sound.CUSTOM_SOUND_ACCEPT;

    this.bindEvents();

    // Changes made on the other page (or by Reset there).
    this.watchStorage([sound.ALERT_SOUND_ID_KEY, sound.ALERT_CUSTOM_SOUND_KEY], async () => {
      this.applyStored(await chrome.storage.local.get([sound.ALERT_SOUND_ID_KEY, sound.ALERT_CUSTOM_SOUND_KEY]));
      this.renderSounds();
    });
    this.watchStorage([sound.ALERT_VOLUME_KEY], (changes) => {
      if (this.draggingVolume) return;
      this.volumeInput.value = String(sound.storedVolumePercent(changes[sound.ALERT_VOLUME_KEY].newValue));
      this.renderVolume();
    });
    this.watchStorage(["steamApiKey"], (changes) => this.renderKeyWarning(Boolean(changes.steamApiKey.newValue)));
  }

  applyStored(stored) {
    const custom = stored[sound.ALERT_CUSTOM_SOUND_KEY];
    this.customSound = sound.isValidCustomSound(custom) ? custom : null;
    this.selectedId = sound.selectedSoundId(stored);
  }

  setStatus(text, status = "") {
    if (!this.statusEl) return;
    this.statusEl.textContent = text;
    this.statusEl.dataset.status = status;
  }

  renderVolume() {
    if (this.volumeValue) this.volumeValue.textContent = `${this.volumeInput.value}%`;
  }

  renderKeyWarning(hasKey) {
    const warning = this.el("alert-sound-key-warning");
    if (warning) warning.hidden = hasKey;
  }

  // The sound in use carries a ✓: an open native list only highlights the
  // option under the pointer, so the label is what says which one plays.
  optionLabel(id) {
    const bundled = sound.BUNDLED_SOUNDS.find((s) => s.id === id);
    let label = id === sound.CUSTOM_SOUND_ID ? `Custom: ${this.customSound.name}` : bundled.label;
    if (id === sound.DEFAULT_SOUND_ID) label += " (default)";
    return id === this.selectedId ? `✓ ${label}` : label;
  }

  // The bundled sounds, then the user's own when there is one. Options are
  // only rebuilt when that list changes; a plain selection change just
  // relabels them, so the dropdown keeps its focus and keyboard position.
  // In the popup, the remove button sits next to the dropdown and only shows
  // while the user's own sound is selected: it removes what you see. The
  // settings page has a row of its own for the file, so there it shows
  // whenever there is one, next to the file's name.
  renderSounds() {
    const ids = [...sound.BUNDLED_SOUNDS.map((s) => s.id), ...(this.customSound ? [sound.CUSTOM_SOUND_ID] : [])];
    const options = [...this.selectEl.children];
    if (options.length !== ids.length || options.some((option, i) => option.value !== ids[i])) {
      this.selectEl.innerHTML = "";
      for (const id of ids) {
        const option = document.createElement("option");
        option.value = id;
        this.selectEl.appendChild(option);
      }
    }
    for (const option of this.selectEl.children) {
      option.textContent = this.optionLabel(option.value);
      option.dataset.current = String(option.value === this.selectedId);
    }
    this.selectEl.value = this.selectedId;
    if (this.removeBtn) {
      this.removeBtn.hidden = this.page === "options" ? !this.customSound : this.selectedId !== sound.CUSTOM_SOUND_ID;
    }
    const customName = this.el("alert-sound-custom-name");
    if (customName) {
      customName.hidden = !this.customSound;
      customName.textContent = this.customSound
        ? `Your file: ${this.customSound.name} (${Number(this.customSound.seconds).toFixed(1)} s)`
        : "";
    }
  }

  renderPlaying(playing) {
    this.playBtn.dataset.playing = String(playing);
    this.playBtn.setAttribute("aria-label", playing ? "Stop" : "Play");
    this.playBtn.title = playing ? "Stop" : "Play";
  }

  stopPreview() {
    this.preview?.pause();
    this.preview = null;
    this.renderPlaying(false);
  }

  // Plays the selected sound from the start, cutting off one still playing.
  // Ignores "Mute": it's for hearing the sound on purpose.
  async playPreview() {
    this.stopPreview();
    const { src } = sound.resolveAlertSound(
      { [sound.ALERT_SOUND_ID_KEY]: this.selectedId, [sound.ALERT_CUSTOM_SOUND_KEY]: this.customSound },
      chrome.runtime.getURL,
    );
    const audio = new Audio(src);
    audio.volume = sound.volumeFromPercent(this.volumeInput.value);
    audio.addEventListener("ended", () => {
      if (this.preview === audio) this.stopPreview();
    });
    this.preview = audio;
    this.renderPlaying(true);
    try {
      await audio.play();
    } catch {
      if (this.preview === audio) this.stopPreview();
      this.setStatus("Couldn't play the sound.", "error");
    }
  }

  selectSound(id) {
    this.selectedId = id;
    this.renderSounds();
    return chrome.storage.local.set({ [sound.ALERT_SOUND_ID_KEY]: id });
  }

  bindEvents() {
    // Picking a sound plays it, so stepping through the list with the arrow
    // keys auditions each one.
    this.selectEl.addEventListener("change", async () => {
      this.setStatus("");
      await this.selectSound(this.selectEl.value);
      await this.playPreview();
    });

    // "input" while dragging (label and a playing preview follow along),
    // "change" once released (saved).
    this.volumeInput.addEventListener("input", () => {
      this.draggingVolume = true;
      this.renderVolume();
      if (this.preview) this.preview.volume = sound.volumeFromPercent(this.volumeInput.value);
    });
    this.volumeInput.addEventListener("change", () => {
      this.draggingVolume = false;
      chrome.storage.local.set({ [sound.ALERT_VOLUME_KEY]: Number(this.volumeInput.value) });
    });

    this.playBtn.addEventListener("click", () => (this.preview ? this.stopPreview() : this.playPreview()));

    // Popup only (see the file header).
    this.el("alert-sound-key-add")?.addEventListener("click", () => {
      const steamDetails = this.el("steam-settings-details");
      if (steamDetails) steamDetails.open = true;
      const keyInput = this.el("steam-api-key");
      keyInput?.scrollIntoView?.({ block: "center" });
      keyInput?.focus?.({ preventScroll: true });
    });

    this.chooseBtn?.addEventListener("click", async () => {
      if (this.page === "options") {
        this.fileInput?.click();
        return;
      }
      await openSettingsPage("alerts");
      globalThis.close?.();
    });

    this.fileInput?.addEventListener("change", () => this.addOwnSound());

    // Removing the file while a bundled sound is selected keeps that sound.
    this.removeBtn?.addEventListener("click", async () => {
      this.stopPreview();
      const wasSelected = this.selectedId === sound.CUSTOM_SOUND_ID;
      this.customSound = null;
      await chrome.storage.local.remove(sound.ALERT_CUSTOM_SOUND_KEY);
      await this.selectSound(wasSelected ? sound.DEFAULT_SOUND_ID : this.selectedId);
      this.setStatus(wasSelected ? "Removed your sound. Back to the default." : "Removed your sound.", "ok");
    });
  }

  async addOwnSound() {
    const file = this.fileInput.files?.[0];
    if (!file) return;
    this.stopPreview();
    const fileError = sound.validateSoundFile(file);
    if (fileError) {
      this.fileInput.value = "";
      this.setStatus(fileError, "error");
      return;
    }
    this.setStatus("Checking the sound…", "off");
    try {
      const dataUrl = sound.audioDataUrl(await readFileAsDataUrl(file), file.name);
      const seconds = await readSoundDuration(dataUrl);
      const durationError = sound.validateSoundDuration(seconds);
      if (durationError) {
        this.setStatus(durationError, "error");
        return;
      }
      this.customSound = { name: file.name, seconds, bytes: file.size, dataUrl };
      await chrome.storage.local.set({ [sound.ALERT_CUSTOM_SOUND_KEY]: this.customSound });
      await this.selectSound(sound.CUSTOM_SOUND_ID);
      this.setStatus("Saved and selected.", "ok");
    } catch (e) {
      this.setStatus(e.message || "Couldn't read that file.", "error");
    } finally {
      this.fileInput.value = "";
    }
  }
}
