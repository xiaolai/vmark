/**
 * Workspace Storage Utilities
 *
 * Purpose: Handles storage key derivation and migration for window-scoped persistence.
 * Each window gets its own localStorage key so multi-window state doesn't collide.
 *
 * Key decisions:
 *   - Storage keys are derived from window label: `vmark-workspace-{label}`
 *   - Legacy migration handles the old single-key `vmark-workspace` format
 *   - getCurrentWindowLabel() is cached per session for consistent key derivation
 *
 * @coordinates-with workspaceStore.ts — uses createWindowStorage for persist middleware
 * @coordinates-with window_manager.rs — assigns window labels on creation
 * @module utils/workspaceStorage
 */
import type { StateStorage } from "zustand/middleware";

/** Base key prefix for workspace storage */
const STORAGE_KEY_PREFIX = "vmark-workspace";

/** Legacy storage key used before window-scoped persistence */
export const LEGACY_STORAGE_KEY = "vmark-workspace";

/**
 * Current window label. Set by WindowProvider on initialization.
 * Defaults to "main" for the primary window.
 */
let currentWindowLabel = "main";

/**
 * Get the storage key for a specific window's workspace state.
 *
 * @param windowLabel - The window label (e.g., "main", "doc-1")
 * @returns Storage key in format "vmark-workspace:{windowLabel}"
 *
 * @example
 * getWorkspaceStorageKey("main") // "vmark-workspace:main"
 * getWorkspaceStorageKey("doc-1") // "vmark-workspace:doc-1"
 */
export function getWorkspaceStorageKey(windowLabel: string): string {
  return `${STORAGE_KEY_PREFIX}:${windowLabel}`;
}

/**
 * Migrate legacy workspace storage to window-scoped storage.
 *
 * If the legacy "vmark-workspace" key exists and "vmark-workspace:main" doesn't,
 * copies the data to the main window's key and removes the legacy key.
 *
 * This should be called once at app startup (in the main window).
 *
 * @example
 * // Call on app initialization
 * migrateWorkspaceStorage();
 */
export function migrateWorkspaceStorage(): void {
  try {
    const mainKey = getWorkspaceStorageKey("main");
    const existingMain = localStorage.getItem(mainKey);

    // Don't migrate if main key already exists
    if (existingMain) {
      return;
    }

    const legacyData = localStorage.getItem(LEGACY_STORAGE_KEY);

    // Remove legacy key regardless if it exists (even if empty)
    if (legacyData !== null) {
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    }

    // Nothing to migrate if legacy key doesn't exist or is empty
    if (!legacyData) {
      return;
    }

    // Migrate legacy data to main window key
    localStorage.setItem(mainKey, legacyData);
  } catch (error) {
    // Log but don't throw - migration failure shouldn't crash the app
    console.warn("[WorkspaceStorage] Migration failed:", error);
  }
}

/**
 * Set the current window label for workspace storage operations.
 *
 * Must be called by WindowProvider when the window label is determined.
 * This affects which storage key the workspace store reads from/writes to.
 *
 * @param label - The window label (e.g., "main", "doc-1")
 */
export function setCurrentWindowLabel(label: string): void {
  currentWindowLabel = label;
}

/**
 * Get the current window label.
 *
 * @returns The current window label
 */
export function getCurrentWindowLabel(): string {
  return currentWindowLabel;
}

/**
 * Custom storage adapter for Zustand's persist middleware.
 *
 * Reads/writes to a window-specific key based on the current window label.
 * The storage key changes dynamically based on setCurrentWindowLabel calls.
 *
 * Note: The 'name' parameter from persist config is ignored since we
 * derive the key from the window label.
 */
export const windowScopedStorage: StateStorage = {
  getItem: (_name: string): string | null => {
    // Use window-specific key, ignoring the passed name
    const key = getWorkspaceStorageKey(currentWindowLabel);
    return localStorage.getItem(key);
  },
  setItem: (_name: string, value: string): void => {
    const key = getWorkspaceStorageKey(currentWindowLabel);
    localStorage.setItem(key, value);
  },
  removeItem: (_name: string): void => {
    const key = getWorkspaceStorageKey(currentWindowLabel);
    localStorage.removeItem(key);
  },
};
