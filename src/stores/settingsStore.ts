/**
 * Settings Store
 *
 * Purpose: Central persistent store for all user-configurable settings —
 *   appearance, markdown behavior, CJK formatting, image handling, terminal,
 *   MCP server, and update preferences.
 *
 * Pipeline: Settings panel UI → updateXxxSetting() → Zustand persist → localStorage
 *   → useTheme.ts / editor plugins read values reactively via selectors
 *
 * Key decisions:
 *   - Uses zustand/persist with deep-merge migration so new default fields are
 *     automatically available when users upgrade without losing existing prefs.
 *   - Settings are grouped into typed sub-objects (general, appearance, markdown,
 *     etc.) with a generic createSectionUpdater helper to reduce boilerplate.
 *   - CJK formatting settings are fine-grained (20+ toggles) to support the
 *     diverse conventions across Simplified Chinese, Traditional Chinese, and
 *     Japanese typography.
 *   - paragraphSpacing → blockSpacing migration handled in merge function.
 *   - Bounded numeric settings (CLAMP_RANGES) are clamped both on every set
 *     and at the persist boundary, so corrupt/devtools values can't render
 *     the editor broken (D4).
 *
 * Known limitations:
 *   - No per-document or per-workspace setting overrides — all settings are global.
 *   - resetSettings() replaces all sections at once; no per-section reset.
 *   - localStorage size (~5KB) is well within browser limits but could grow.
 *
 * @coordinates-with useTheme.ts — reads appearance settings to compute CSS vars
 * @coordinates-with useAutoSave.ts — reads general.autoSaveEnabled/autoSaveInterval
 * @coordinates-with useTerminalPosition.ts — reads terminal.position for panel placement
 * @coordinates-with spawnPty.ts — reads terminal.shell for configured shell preference
 * @coordinates-with settingsTypes.ts — all type/interface definitions live there
 * @coordinates-with src/utils/deepMerge.ts — deep-merge utility for persist migration
 * @coordinates-with i18n.ts — reads general.language at startup to set UI locale
 * @coordinates-with settingsStore/shortcuts.ts — useShortcutsStore + DEFAULT_SHORTCUTS engine, re-exported via this barrel
 * @coordinates-with settingsShortcutLabels.ts — i18n-bound label helpers (extracted to avoid an i18n cycle)
 * @module stores/settingsStore
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { deepMerge } from "@/utils/deepMerge";
import { createSafeStorage } from "@/services/persistence/safeStorage";
import { migrateWorkspaceRailModeToGeneral } from "./settingsStore/migrations";
import { initialState, type ObjectSections } from "./settingsStore/defaults";
import { clampMergedSettings, clampSettingValue } from "./settingsStore/clamp";
import {
  isPlainObject,
  normalizeBrowserSettings,
  sanitizePersistedSettings,
} from "./settingsStore/persistGuards";
import type { SettingsState, SettingsActions } from "./settingsTypes";

// Re-exported for tests + existing callers that import from "@/stores/settingsStore".
export { CLAMP_RANGES, clampMergedSettings } from "./settingsStore/clamp";
export { sanitizePersistedSettings } from "./settingsStore/persistGuards";

// Re-export all types for backward compatibility (import from "@/stores/settingsStore").
export type {
  ThemeId,
  ThemeColors,
  AppearanceSettings,
  FocusModeDim,
  CJKFormattingSettings,
  MediaBorderStyle,
  MediaAlignment,
  HeadingAlignment,
  BlockFontSize,
  QuoteStyle,
  AutoPairCJKStyle,
  HtmlRenderingMode,
  HtmlAllowlistLevel,
  MarkdownPasteMode,
  PasteMode,
  CopyFormat,
  TerminalPosition,
  TerminalCursorStyle,
  TerminalBellMode,
  TerminalSettings,
  MarkdownSettings,
  ImageAutoResizeOption,
  ImageSettings,
  GeneralSettings,
  UpdateSettings,
  LargeFileSettings,
  BrowserSettings,
  SettingsState,
  SettingsActions,
} from "./settingsTypes";

/**
 * Color palettes for each available theme — derived from the typed
 * ThemeTokens in src/theme/themes/ per theme-unification-2026-05.
 * To retint a theme, edit src/theme/themes/<id>.ts, not this file.
 */
export { themesAsColors as themes } from "@/theme";

// Helper to create section updaters - reduces duplication
const createSectionUpdater = <T extends ObjectSections>(
  set: (fn: (state: SettingsState) => Partial<SettingsState>) => void,
  section: T
) => <K extends keyof SettingsState[T]>(key: K, value: SettingsState[T][K]) =>
  set((state) => ({
    [section]: { ...state[section], [key]: clampSettingValue(section, key, value) },
  }));

/** Central persistent store for all user-configurable settings with deep-merge migration. Use selectors, not destructuring. */
export const useSettingsStore = create<SettingsState & SettingsActions>()(
  persist(
    (set) => ({
      // Deep clone: a shallow spread would have live state share every nested
      // section object (and array) with the canonical defaults, so one in-place
      // mutation anywhere would corrupt `initialState` — and with it every
      // future resetSettings().
      ...structuredClone(initialState),
      updateGeneralSetting: createSectionUpdater(set, "general"),
      updateAppearanceSetting: createSectionUpdater(set, "appearance"),
      updateCJKFormattingSetting: createSectionUpdater(set, "cjkFormatting"),
      updateMarkdownSetting: createSectionUpdater(set, "markdown"),
      updateImageSetting: createSectionUpdater(set, "image"),
      updateTerminalSetting: createSectionUpdater(set, "terminal"),
      updateAdvancedSetting: createSectionUpdater(set, "advanced"),
      updateUpdateSetting: createSectionUpdater(set, "update"),
      updateLargeFileSetting: createSectionUpdater(set, "largeFile"),
      updateFormatsSetting: createSectionUpdater(set, "formats"),
      updateBrowserSetting: createSectionUpdater(set, "browser"),
      toggleDevSection: () => set((state) => ({ showDevSection: !state.showDevSection })),
      resetSettings: () => set(structuredClone(initialState)),
    }),
    {
      name: "vmark-settings",
      // Schema version. Bump whenever the persisted shape changes in a way the
      // `merge` function below cannot recover. `migrate` returns the current
      // defaults so an incompatible blob from a future build (e.g. after a
      // downgrade) is dropped rather than deep-merged into a crashy state.
      version: 1,
      migrate: (persistedState, version) => {
        // Forward migrations have no work to do today — the only currently
        // released shape is v1. If a downgrade puts a v2+ blob here, we
        // explicitly drop it: returning `undefined` tells persist to keep
        // the in-memory default state, which is preferable to producing a
        // partially-initialized object.
        if (typeof version !== "number" || version > 1) {
          return undefined;
        }
        return persistedState as SettingsState;
      },
      // Guard localStorage access for SSR/non-browser environments
      storage: createJSONStorage(() => createSafeStorage()),
      // Deep merge to preserve new default properties when loading old localStorage
      merge: (persistedState, currentState) => {
        const rawPersisted = (persistedState ?? {}) as Record<string, unknown>;
        // Migration: paragraphSpacing -> blockSpacing. Runs on the raw blob,
        // BEFORE shape-sanitization — so `appearance` is still untrusted here.
        // `in` throws a TypeError on a primitive (`appearance: "evil"`), which
        // would abort hydration and silently drop every persisted setting;
        // isPlainObject is the same guard the sibling migration already uses.
        const appearance = rawPersisted.appearance;
        if (
          isPlainObject(appearance) &&
          "paragraphSpacing" in appearance &&
          !("blockSpacing" in appearance)
        ) {
          appearance.blockSpacing = appearance.paragraphSpacing;
          delete appearance.paragraphSpacing;
        }
        migrateWorkspaceRailModeToGeneral(rawPersisted);
        // T4: validate the persisted shape before deep-merging into live state
        // (zero-trust at the persist boundary). deepMerge overwrites — rather
        // than recurses — when a persisted group is a non-object, so a corrupt
        // localStorage blob (`appearance: "evil"`) would otherwise replace a
        // settings-group object with a primitive and crash consumers.
        const persisted = sanitizePersistedSettings(
          rawPersisted,
          currentState as unknown as Record<string, unknown>
        );
        const merged = deepMerge(
          currentState as unknown as Record<string, unknown>,
          persisted
        ) as unknown as typeof currentState;
        // Union array-typed defaults so new entries (e.g., link protocols) reach
        // existing users. The persist guards validate that the value IS an array,
        // not what is in it — drop non-string entries here, or they reach the
        // link-scheme allowlist and the settings UI as `42` / `null` / `{}`.
        const defaultProtocols = currentState.advanced.customLinkProtocols;
        const persistedAdvanced = persisted.advanced as Record<string, unknown> | undefined;
        const persistedProtocols = persistedAdvanced?.customLinkProtocols;
        if (Array.isArray(persistedProtocols)) {
          const strings = persistedProtocols.filter((p): p is string => typeof p === "string");
          merged.advanced.customLinkProtocols = [...new Set([...defaultProtocols, ...strings])];
        }
        // D4: clamp bounded numeric fields so a corrupt persisted value
        // (e.g. `appearance.fontSize: 999`) can't render the editor broken.
        clampMergedSettings(merged as unknown as Record<string, unknown>);
        normalizeBrowserSettings(merged.browser as unknown as Record<string, unknown>);
        return merged;
      },
    }
  )
);

// ============================================================================
// Shortcuts — extracted to ./settingsStore/shortcuts.ts
// ============================================================================
//
// Re-exported here so existing imports keep working unchanged:
//   import { useShortcutsStore, DEFAULT_SHORTCUTS } from "@/stores/settingsStore";
// The split keeps each file closer to the ~300 LOC project guideline
// without changing the public API or persisted storage keys.

export {
  useShortcutsStore,
  DEFAULT_SHORTCUTS,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  flushMenuShortcutsSync,
  formatKeyForDisplay,
  prosemirrorToTauri,
  type ShortcutCategory,
  type ShortcutScope,
  type ShortcutDefinition,
} from "./settingsStore/shortcuts";
