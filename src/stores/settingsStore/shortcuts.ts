/**
 * Shortcuts engine — user-customization store, conflict detection and
 * reassignment; native-menu accelerator sync lives in `./shortcutMenuSync.ts`.
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
import { createSafeStorage } from "@/services/persistence/safeStorage";
import { createSectionMergingStorage } from "@/stores/persistedSectionMerge";
import { isMacPlatform } from "@/utils/shortcutMatch";
import { errorMessage } from "@/utils/errorMessage";
import {
  DEFAULT_SHORTCUTS,
  type ShortcutDefinition,
} from "./shortcutDefinitions";
import { syncMenuShortcuts } from "./shortcutMenuSync";

export {
  DEFAULT_SHORTCUTS,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  type ShortcutCategory,
  type ShortcutDefinition,
} from "./shortcutDefinitions";
export { prosemirrorToTauri, formatKeyForDisplay } from "./keyFormatting";
export { flushMenuShortcutsSync, onMenuShortcutSyncFailure } from "./shortcutMenuSync";

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

/**
 * One problem in an imported shortcut file. Codes with parameters, not
 * sentences: a store cannot translate, so the settings page does.
 */
export type ShortcutImportError =
  | { code: "invalidFormat" }
  | { code: "invalidKey"; id: string }
  | { code: "unknownShortcut"; id: string }
  | { code: "parse"; detail: string };

/** All-or-nothing: on failure nothing was applied and `errors` lists every problem. */
type ShortcutImportResult =
  | { success: true; errors?: undefined }
  | { success: false; errors: ShortcutImportError[] };

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
  /**
   * Bind `key` to `id` and unassign every other shortcut whose effective
   * chord is the same — the conflict modal's confirm. Two items on one chord
   * never both work (the menu fires one, the router refuses the tie).
   */
  reassignShortcut: (id: string, key: string) => void;
  /** Reset single shortcut to default */
  resetShortcut: (id: string) => void;
  /** Reset all shortcuts to defaults */
  resetAllShortcuts: () => void;
  /** Check if key conflicts with any other shortcut */
  getConflict: (key: string, excludeId?: string) => ShortcutDefinition | null;
  /** Export config as JSON string */
  exportConfig: () => string;
  /** Import config from JSON string */
  importConfig: (json: string) => ShortcutImportResult;
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
        // Presence, not truthiness: "" is a DELIBERATE unbinding, and treating
        // it as "no custom value" handed the default back to every keymap
        // while the settings list and the menu showed it as unbound.
        // `getAllShortcuts` has always used `??`; these two must agree.
        const custom = customBindings[id];
        if (custom !== undefined) return custom;
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

      reassignShortcut: (id, key) => {
        const { customBindings } = get();
        const next = { ...customBindings, [id]: key };
        if (key) {
          const target = normalizeKey(key);
          for (const def of DEFAULT_SHORTCUTS) {
            if (def.id === id) continue;
            const effective = customBindings[def.id] ?? resolveDefaultKey(def);
            if (effective && normalizeKey(effective) === target) next[def.id] = "";
          }
        }
        set({ customBindings: next });
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
            return { success: false, errors: [{ code: "invalidFormat" }] };
          }

          const errors: ShortcutImportError[] = [];
          const bindings: Record<string, string> = {};

          // VALIDATE the whole document first, then apply — never entry by
          // entry (audit 20260907, #422). Applying as it went meant
          // `set({ customBindings })`, a whole-map REPLACE, ran before the
          // errors were returned: one unknown id in an imported file erased
          // every customization the user already had, while the message
          // mentioned only the typo. Collecting every problem first also
          // means the user sees the whole file's faults in one pass.
          for (const [id, key] of Object.entries(data.customBindings)) {
            if (typeof key !== "string") {
              errors.push({ code: "invalidKey", id });
              continue;
            }
            if (!shortcutMap.has(id)) {
              errors.push({ code: "unknownShortcut", id });
              continue;
            }
            bindings[id] = key;
          }

          // No `errors` key on a clean import — its absence is the "nothing
          // went wrong" signal, distinct from an empty problem list.
          if (errors.length > 0) return { success: false, errors };

          set({ customBindings: bindings });
          syncMenuShortcuts(get().getAllShortcuts());
          return { success: true };
        } catch (e) {
          /* v8 ignore start -- JSON.parse always throws Error instances; String(e) fallback is defensive */
          // command-error-ok: `e` here is a JSON.parse failure on imported
          // shortcut JSON, not a rejection from update_menu_accelerators.
          return { success: false, errors: [{ code: "parse", detail: errorMessage(e) }] };
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
      // Section-merged for the same reason settingsStore is: every window
      // writes this one key with its whole state, so a blind write would push a
      // stale customBindings map over another window's rebind.
      storage: createJSONStorage(() =>
        createSectionMergingStorage(createSafeStorage()),
      ),
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

// getCategoryLabel / getShortcutLabel live in `../settingsShortcutLabels.ts` (avoids a settingsStore ⇄ i18n circular import).
