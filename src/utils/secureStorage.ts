/**
 * App Storage Adapter for Zustand Persist (non-secret config)
 *
 * Purpose: Stores Zustand-persisted config (AI provider endpoints, model
 *   names, active selection) outside localStorage using Tauri's store plugin.
 *   Data goes to the app data directory (~/.config/app.vmark/) instead of
 *   browser localStorage, so it's not visible in DevTools.
 *
 * IMPORTANT: This is NOT OS-backed encrypted storage — tauri-plugin-store
 *   persists to a plain JSON file. As of RW-16 (L8), API keys NO LONGER flow
 *   through this adapter: they are stored in the OS keychain via
 *   `services/secrets/apiKeySecrets` + the `*_secret` Tauri commands, and the
 *   aiProvider store strips `apiKey` from its persisted blob. This adapter now
 *   carries only non-secret config; the residual security benefit is keeping
 *   that config out of DevTools-accessible localStorage.
 *
 * Migration: On first use, migrates data from localStorage to Tauri store,
 *   then clears the localStorage entry.
 *
 * @coordinates-with @tauri-apps/plugin-store — Tauri store plugin
 * @coordinates-with src/stores/aiStore/provider.ts — primary consumer
 * @coordinates-with src/services/secrets/apiKeySecrets — keychain key store (secrets)
 * @module utils/secureStorage
 */

import type { StateStorage } from "zustand/middleware";
import { safeStorageError } from "@/utils/debug";

/** In-memory cache for sync read/write. Background-synced to Tauri store. */
const cache = new Map<string, string>();

/** Whether the Tauri store has been pre-loaded into cache. */
let initialized = false;

/** Reset internal state (for testing only). */
export function _resetForTesting(): void {
  cache.clear();
  initialized = false;
  usingFallback = false;
  storePromise = null;
}

/** Whether we're using real Tauri store or falling back to localStorage. */
let usingFallback = false;

/** Tauri store instance (lazy-loaded). */
let storePromise: Promise<SecureStore> | null = null;

interface SecureStore {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string) => Promise<void>;
  save: () => Promise<void>;
  delete: (key: string) => Promise<void>;
}

/**
 * Validate that the loaded plugin instance exposes the methods we rely on
 * (T4): replaces a blind `as unknown as SecureStore` cast over a 3rd-party
 * module. A shape mismatch (plugin API drift, broken mock) throws loudly so
 * the caller falls back to localStorage rather than calling `undefined()`.
 */
function assertSecureStore(store: unknown): asserts store is SecureStore {
  const s = store as Record<string, unknown> | null;
  if (
    typeof s !== "object" ||
    s === null ||
    typeof s.get !== "function" ||
    typeof s.set !== "function" ||
    typeof s.save !== "function" ||
    typeof s.delete !== "function"
  ) {
    throw new Error("Tauri store plugin returned an unexpected shape");
  }
}

async function getStore(): Promise<SecureStore> {
  if (!storePromise) {
    storePromise = import("@tauri-apps/plugin-store").then(async (mod) => {
      const store = await mod.load(".vmark-secure.json");
      assertSecureStore(store);
      return store;
    });
  }
  return storePromise;
}

/**
 * Pre-load the Tauri store into the in-memory cache.
 * Must be called before Zustand stores hydrate.
 *
 * Also performs one-time migration from localStorage if data exists there.
 */
export async function initSecureStorage(keys: string[]): Promise<void> {
  if (initialized) return;

  try {
    const store = await getStore();

    for (const key of keys) {
      // Check if Tauri store has this key
      const value = await store.get(key);
      if (value !== null && value !== undefined) {
        cache.set(key, typeof value === "string" ? value : JSON.stringify(value));
        // Always clean up localStorage — secrets must not remain in DevTools
        localStorage.removeItem(key);
      } else {
        // Migration: check localStorage for legacy data
        const legacyValue = localStorage.getItem(key);
        if (legacyValue) {
          cache.set(key, legacyValue);
          // Write to Tauri store
          await store.set(key, legacyValue);
          await store.save();
          // Clear from localStorage (remove sensitive data from DevTools-accessible storage)
          localStorage.removeItem(key);
        }
      }
    }
  } catch (error) {
    // Tauri store not available (unit tests, CI) — fall back to localStorage
    safeStorageError("Secure storage init failed, falling back to localStorage:", error);
    usingFallback = true;
    storePromise = null; // Clear cached rejection so future calls can retry
    for (const key of keys) {
      const value = localStorage.getItem(key);
      if (value) cache.set(key, value);
    }
  }

  initialized = true;
}

/**
 * Create a synchronous StateStorage backed by the secure Tauri store.
 *
 * Reads from in-memory cache (populated by initSecureStorage).
 * Writes update cache immediately and sync to Tauri store asynchronously.
 */
export function createSecureStorage(): StateStorage {
  return {
    getItem: (name: string) => {
      return cache.get(name) ?? null;
    },

    setItem: (name: string, value: string) => {
      cache.set(name, value);

      if (usingFallback) {
        // In fallback mode, persist to localStorage (best effort)
        try { localStorage.setItem(name, value); } catch { /* quota exceeded */ }
      } else {
        // Background sync to Tauri store
        getStore()
          .then(async (store) => {
            await store.set(name, value);
          })
          .catch((error) => {
            safeStorageError("Failed to persist to secure storage:", error);
          });
      }
    },

    removeItem: (name: string) => {
      cache.delete(name);

      if (usingFallback) {
        /* v8 ignore next -- @preserve reason: fallback localStorage removeItem; fallback mode init rejects the store promise making removeItem flow untestable in same test run */
        localStorage.removeItem(name);
      } else {
        getStore()
          .then(async (store) => {
            await store.delete(name);
          })
          .catch((error) => {
            safeStorageError("Failed to remove from secure storage:", error);
          });
      }
    },
  };
}
