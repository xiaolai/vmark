/**
 * Shortcuts engine — user-customization store, conflict detection, and
 * native-menu accelerator sync.
 *
 * Persists user customizations under `vmark-shortcuts`. The default
 * registry lives in `./shortcutDefinitions.ts` (DEFAULT_SHORTCUTS is the
 * source of truth — every binding must keep it in sync with
 * `src-tauri/src/menu/localized.rs` (Tauri accelerators) and
 * `website/guide/shortcuts.md` (docs) per
 * `.claude/rules/41-keyboard-shortcuts.md`). Pure key-format conversions
 * live in `./keyFormatting.ts`. Both are re-exported here so existing
 * imports keep working unchanged.
 *
 * Re-exported by `../settingsStore.ts` for `useShortcutsStore` consumers.
 *
 * @module stores/settingsStore/shortcuts
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { invoke } from "@tauri-apps/api/core";
import { createSafeStorage } from "@/services/persistence/safeStorage";
import { isMacPlatform } from "@/utils/shortcutMatch";
import { shortcutsWarn } from "@/utils/debug";
import { errorMessage } from "@/utils/errorMessage";
import {
  DEFAULT_SHORTCUTS,
  type ShortcutDefinition,
} from "./shortcutDefinitions";
import { prosemirrorToTauri } from "./keyFormatting";

export {
  DEFAULT_SHORTCUTS,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  type ShortcutCategory,
  type ShortcutScope,
  type ShortcutDefinition,
} from "./shortcutDefinitions";
export { prosemirrorToTauri, formatKeyForDisplay } from "./keyFormatting";

// Build lookup map for quick access
const shortcutMap = new Map(DEFAULT_SHORTCUTS.map(s => [s.id, s]));

function resolveDefaultKey(def: ShortcutDefinition): string {
  const isMac = isMacPlatform();
  /* v8 ignore start -- no DEFAULT_SHORTCUTS currently define defaultKeyMac; branch reserved for future use */
  if (isMac && def.defaultKeyMac) return def.defaultKeyMac;
  if (!isMac && def.defaultKeyOther) return def.defaultKeyOther;
  /* v8 ignore stop */
  return def.defaultKey;
}

interface ShortcutsState {
  customBindings: Record<string, string>;
  /** Version for tracking config format changes */
  version: number;
}

interface ShortcutsActions {
  /** Get effective shortcut (custom or default) */
  getShortcut: (id: string) => string;
  /** Get all effective shortcuts as a map */
  getAllShortcuts: () => Record<string, string>;
  /** Set custom shortcut */
  setShortcut: (id: string, key: string) => void;
  /** Reset single shortcut to default */
  resetShortcut: (id: string) => void;
  /** Reset all shortcuts to defaults */
  resetAllShortcuts: () => void;
  /** Check if key conflicts with any other shortcut */
  getConflict: (key: string, excludeId?: string) => ShortcutDefinition | null;
  /** Export config as JSON string */
  exportConfig: () => string;
  /** Import config from JSON string */
  importConfig: (json: string) => { success: boolean; errors?: string[] };
  /** Check if shortcut has been customized */
  isCustomized: (id: string) => boolean;
  /** Get shortcut definition by ID */
  getDefinition: (id: string) => ShortcutDefinition | undefined;
}

const initialShortcutsState: ShortcutsState = {
  customBindings: {},
  version: 1,
};

/** Manages user keyboard shortcut customizations with conflict detection and native menu sync. Use selectors, not destructuring. */
export const useShortcutsStore = create<ShortcutsState & ShortcutsActions>()(
  persist(
    (set, get) => ({
      ...initialShortcutsState,

      getShortcut: (id) => {
        const { customBindings } = get();
        if (customBindings[id]) return customBindings[id];
        const def = shortcutMap.get(id);
        return def ? resolveDefaultKey(def) : "";
      },

      getAllShortcuts: () => {
        const { customBindings } = get();
        const result: Record<string, string> = {};
        for (const def of DEFAULT_SHORTCUTS) {
          result[def.id] = customBindings[def.id] ?? resolveDefaultKey(def);
        }
        return result;
      },

      setShortcut: (id, key) => {
        set((state) => ({
          customBindings: { ...state.customBindings, [id]: key },
        }));
        syncMenuShortcuts(get().getAllShortcuts());
      },

      resetShortcut: (id) => {
        set((state) => {
          const { [id]: _, ...rest } = state.customBindings;
          return { customBindings: rest };
        });
        syncMenuShortcuts(get().getAllShortcuts());
      },

      resetAllShortcuts: () => {
        set({ customBindings: {} });
        syncMenuShortcuts(get().getAllShortcuts());
      },

      getConflict: (key, excludeId) => {
        // Empty means "unbound" — an unbound binding can never conflict.
        if (!key) return null;

        const { customBindings } = get();
        const normalizedKey = normalizeKey(key);

        for (const def of DEFAULT_SHORTCUTS) {
          if (def.id === excludeId) continue;
          const effectiveKey = customBindings[def.id] ?? resolveDefaultKey(def);
          if (!effectiveKey) continue; // unbound shortcuts don't conflict
          if (normalizeKey(effectiveKey) === normalizedKey) {
            return def;
          }
        }
        return null;
      },

      exportConfig: () => {
        const { customBindings, version } = get();
        return JSON.stringify({ version, customBindings }, null, 2);
      },

      importConfig: (json) => {
        try {
          const data = JSON.parse(json);
          if (typeof data !== "object" || !data.customBindings) {
            return { success: false, errors: ["Invalid config format"] };
          }

          const errors: string[] = [];
          const validBindings: Record<string, string> = {};

          for (const [id, key] of Object.entries(data.customBindings)) {
            if (typeof key !== "string") {
              errors.push(`Invalid key for ${id}`);
              continue;
            }
            if (!shortcutMap.has(id)) {
              errors.push(`Unknown shortcut: ${id}`);
              continue;
            }
            validBindings[id] = key;
          }

          set({ customBindings: validBindings });
          syncMenuShortcuts(get().getAllShortcuts());

          return { success: errors.length === 0, errors: errors.length > 0 ? errors : undefined };
        } catch (e) {
          /* v8 ignore start -- JSON.parse always throws Error instances; String(e) fallback is defensive */
          return { success: false, errors: [`Parse error: ${errorMessage(e)}`] };
          /* v8 ignore stop */
        }
      },

      isCustomized: (id) => {
        return id in get().customBindings;
      },

      getDefinition: (id) => shortcutMap.get(id),
    }),
    {
      name: "vmark-shortcuts",
      storage: createJSONStorage(() => createSafeStorage()),
    }
  )
);

/** Normalize key string for comparison (case-insensitive, sorted modifiers). */
function normalizeKey(key: string): string {
  const parts = key.toLowerCase().split("-");
  const modifiers = parts.slice(0, -1).sort();
  const mainKey = parts[parts.length - 1];
  return [...modifiers, mainKey].join("-");
}

/** Trailing-debounce window for shortcut edits. Batches rapid changes
 *  (e.g. Reset All, Import) into one native menu update. */
const SYNC_DEBOUNCE_MS = 100;

let syncTimer: ReturnType<typeof setTimeout> | null = null;
let pendingShortcuts: Record<string, string> | null = null;
let inFlightSync: Promise<void> = Promise.resolve();

function syncMenuShortcuts(shortcuts: Record<string, string>) {
  pendingShortcuts = shortcuts;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    const next = pendingShortcuts;
    pendingShortcuts = null;
    if (next) queueSyncMenuShortcuts(next);
  }, SYNC_DEBOUNCE_MS);
}

/** Flush any pending debounced sync immediately. Exported for tests. */
export function flushMenuShortcutsSync(): Promise<void> {
  if (syncTimer) {
    clearTimeout(syncTimer);
    syncTimer = null;
    const next = pendingShortcuts;
    pendingShortcuts = null;
    if (next) queueSyncMenuShortcuts(next);
  }
  return inFlightSync;
}

function queueSyncMenuShortcuts(shortcuts: Record<string, string>) {
  inFlightSync = inFlightSync
    .catch(() => {})
    .then(() => syncMenuShortcutsNow(shortcuts));
}

async function syncMenuShortcutsNow(shortcuts: Record<string, string>) {
  try {
    const menuShortcuts: Record<string, string> = {};
    for (const def of DEFAULT_SHORTCUTS) {
      if (def.menuId) {
        /* v8 ignore start -- shortcuts from getAllShortcuts() always has all keys; ?? fallback is defensive */
        const key = shortcuts[def.id] ?? resolveDefaultKey(def);
        /* v8 ignore stop */
        menuShortcuts[def.menuId] = prosemirrorToTauri(key);
      }
    }
    await invoke("update_menu_accelerators", { shortcuts: menuShortcuts });
  } catch (e) {
    /* v8 ignore start -- @preserve invoke failure only occurs if Tauri command is unavailable; mocked in tests */
    shortcutsWarn("Failed to sync menu shortcuts:", e);
    /* v8 ignore stop */
  }
}

// getCategoryLabel / getShortcutLabel live in `../settingsShortcutLabels.ts` (avoids a settingsStore ⇄ i18n circular import).
