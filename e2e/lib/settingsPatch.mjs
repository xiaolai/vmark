/**
 * Shared persisted-settings reader/patcher (audit 20260831 #45): rail.mjs and
 * browser.mjs had grown byte-similar copies of the same localStorage +
 * StorageEvent writer. This is the app's OWN cross-window settings mechanism
 * (`useSettingsSync.ts` listens for exactly this event), so the running store
 * rehydrates through a supported path rather than needing a reload.
 *
 * @coordinates-with src/hooks/useSettingsSync.ts — the storage-event listener
 * @coordinates-with rail.mjs, browser.mjs — the section-specific wrappers
 */

import { evalJs } from "./bridge.mjs";

const SETTINGS_KEY = "vmark-settings";

/** Read one persisted settings section (e.g. "general", "browser"), or null. */
export async function readPersistedSettingsSection(client, section) {
  const raw = await evalJs(
    client,
    `(() => { try { return JSON.stringify(JSON.parse(localStorage.getItem(${JSON.stringify(SETTINGS_KEY)}) || "{}")?.state?.[${JSON.stringify(section)}] ?? null); } catch { return "null"; } })()`,
  );
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Patch one settings section and notify the running app via StorageEvent.
 *
 * `options.deleteKeys` removes keys from the section entirely (R2-16) — a
 * restore path needs "the key was absent before" to mean absent AFTER, not
 * an explicit default value that shadows future default changes.
 */
export async function patchPersistedSettings(client, section, patch, options = {}) {
  const deleteKeys = options.deleteKeys ?? [];
  const ok = await evalJs(
    client,
    `(() => {
       try {
         const key = ${JSON.stringify(SETTINGS_KEY)};
         const section = ${JSON.stringify(section)};
         const oldValue = localStorage.getItem(key);
         const parsed = JSON.parse(oldValue || "{}");
         parsed.state = parsed.state || {};
         parsed.state[section] = { ...(parsed.state[section] || {}), ...${JSON.stringify(patch)} };
         for (const k of ${JSON.stringify(deleteKeys)}) delete parsed.state[section][k];
         const newValue = JSON.stringify(parsed);
         localStorage.setItem(key, newValue);
         // The app's own cross-window sync path (useSettingsSync.ts).
         window.dispatchEvent(new StorageEvent("storage", { key, oldValue, newValue, storageArea: localStorage }));
         return true;
       } catch (e) { return "ERR " + (e && e.message); }
     })()`,
  );
  if (ok !== true) {
    throw new Error(`failed to patch settings section ${section}: ${ok}`);
  }
}
