/**
 * Safe localStorage wrapper for Zustand persisted stores.
 *
 * Purpose: Catches QuotaExceededError on setItem so one store exhausting
 *   localStorage doesn't silently break all other persisted stores.
 *   Surfaces a user-visible toast on the first quota failure per store key,
 *   so users know their data isn't being saved.
 *
 * @module utils/safeStorage
 */

import type { StateStorage } from "zustand/middleware";
import { imeToast as toast } from "@/utils/imeToast";
import { safeStorageError } from "@/utils/debug";

/** Tracks which store keys have already shown a quota warning. */
const warnedKeys = new Set<string>();

/** Callback to resolve i18n message — set by the app after i18n initialises. */
let resolveMessage: ((key: string) => string) | null = null;

/** Register an i18n-aware message resolver (called once from app init). */
export function setSafeStorageMessageResolver(
  resolver: (key: string) => string,
): void {
  resolveMessage = resolver;
}

export function createSafeStorage(): StateStorage {
  return {
    getItem: (name: string) => localStorage.getItem(name),
    setItem: (name: string, value: string) => {
      try {
        localStorage.setItem(name, value);
      } catch (error) {
        if (
          error instanceof DOMException &&
          error.name === "QuotaExceededError"
        ) {
          safeStorageError(
            `QuotaExceededError for key "${name}" — localStorage is full`
          );
          if (!warnedKeys.has(name)) {
            warnedKeys.add(name);
            const msg = resolveMessage
              ? resolveMessage(name)
              : `Storage full — changes to "${name}" won't be saved until space is freed.`;
            toast.warning(msg);
          }
        } else {
          throw error;
        }
      }
    },
    removeItem: (name: string) => localStorage.removeItem(name),
  };
}
