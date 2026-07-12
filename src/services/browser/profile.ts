/**
 * Browser profile — data-store mode selection + stable profile id (WI-1.5 / ADR-B4).
 *
 * Purpose: the embedded browser wants a persistent, isolated `WKWebsiteDataStore`
 * (its own cookies/localStorage, kept out of the main app) keyed by a stable
 * identifier. `dataStoreForIdentifier` is only available on macOS 14+ and crashes
 * below it (SPIKE-4), so below the floor we fall back to the default store (still
 * persistent, just not isolated). This module owns the pure version gate + the
 * stable identifier the native surface (WI-1.2 config) applies.
 *
 * @coordinates-with src-tauri browser config — applies the chosen store + id
 * @module services/browser/profile
 */

/** macOS major version at/above which a per-identifier data store is usable. */
export const MIN_IDENTIFIED_STORE_MACOS = 14;

/** localStorage-shaped adapter, injected for testability. */
export interface ProfileStorage {
  get: (key: string) => string | null;
  set: (key: string, value: string) => void;
}

const PROFILE_ID_KEY = "vmark.browser.profileId";

/**
 * Which `WKWebsiteDataStore` to use for the given macOS major version:
 * `"identified"` (persistent + isolated) on 14+, else `"default"` (persistent,
 * shared) — never crash below the floor.
 */
export function selectDataStoreMode(macosMajor: number): "identified" | "default" {
  return macosMajor >= MIN_IDENTIFIED_STORE_MACOS ? "identified" : "default";
}

/** A UUID-ish id, preferring `crypto.randomUUID` and falling back deterministically-random. */
function generateId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  // Fallback: RFC-4122-ish v4 without crypto (id uniqueness, not security).
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = Math.floor(Math.random() * 16);
    const v = ch === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Read the persisted browser profile id, generating + persisting one on first use. */
export function getOrCreateProfileId(storage: ProfileStorage): string {
  const existing = storage.get(PROFILE_ID_KEY);
  if (existing) return existing;
  const id = generateId();
  storage.set(PROFILE_ID_KEY, id);
  return id;
}
