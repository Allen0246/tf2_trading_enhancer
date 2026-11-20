/*
@description: Pure in-memory state for the listing queue - own module, no
DOM, so it can be unit-tested directly (see tests/listingQueueQueue.test.js).
Deliberately NOT persisted to chrome.storage - unlike the settings this
extension normally saves, a queued listing references a specific
STILL-VISIBLE tile on the current page load, and there's no reliable way to
re-find those tiles after a reload without re-scanning the whole backpack.

Event-driven (on("add"/"remove"/"update"/"clear", fn)) rather than one
generic "changed" callback, so a change never forces a full rebuild that
would lose whatever a user is mid-typing in another row. Emitting the specific thing that changed lets ./content.js patch
just the one row (add one, remove one, or update one in place) instead of a
full rebuild.
*/

export function createQueue() {
  const entries = new Map(); // assetId -> entry
  const listeners = { add: new Set(), remove: new Set(), update: new Set(), clear: new Set() };

  function emit(type, payload) {
    listeners[type].forEach((fn) => fn(payload));
  }

  return {
    /*
     * Adds an entry, keyed by its own assetId. No-ops (returns false) if
     * that asset is already queued (Ctrl+clicking a queued item again does
     * nothing).
     */
    add(entry) {
      if (!entry || !entry.assetId) return false;
      if (entries.has(entry.assetId)) return false;
      entries.set(entry.assetId, entry);
      emit("add", entry);
      return true;
    },

    remove(assetId) {
      const entry = entries.get(assetId);
      if (!entry) return false;
      entries.delete(assetId);
      emit("remove", entry);
      return true;
    },

    // Shallow-merges patch into the existing entry (e.g. { keys, metal } on
    // a price edit, { status } on a publish-state change) - returns false
    // for an assetId that isn't queued (already removed, or never was)
    // rather than silently creating one.
    update(assetId, patch) {
      const entry = entries.get(assetId);
      if (!entry) return false;
      Object.assign(entry, patch);
      emit("update", entry);
      return true;
    },

    clear() {
      if (entries.size === 0) return;
      const all = Array.from(entries.values());
      entries.clear();
      emit("clear", all);
    },

    has(assetId) {
      return entries.has(assetId);
    },
    get(assetId) {
      return entries.get(assetId) || null;
    },
    list() {
      return Array.from(entries.values());
    },
    get size() {
      return entries.size;
    },

    // Returns an unsubscribe function - not currently used anywhere (this
    // queue lives for the page's own lifetime), but cheap to support.
    on(type, fn) {
      listeners[type].add(fn);
      return () => listeners[type].delete(fn);
    },
  };
}
