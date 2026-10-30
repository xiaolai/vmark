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
 *   - Persisted-blob migrations (paragraphSpacing → blockSpacing, retired
 *     flags) run as ONE ordered pipeline from settingsStore/migrations.ts —
 *     never listed by hand here, where a forgotten call left a step inactive.
 *   - Bounded numeric settings (CLAMP_RANGES) are clamped both on every set
 *     and at the persist boundary, so corrupt/devtools values can't render
 *     the editor broken (D4).
 *   - The persisted link-protocol list is the user's own: a default protocol a
 *     newer build introduces is added once, by the versioned `migrate`
 *     (LINK_PROTOCOLS_INTRODUCED), never unioned back on every load.
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
import { createSafeStorage } from "@/services/persistence/safeStorage";
import { createSectionMergingStorage } from "./persistedSectionMerge";
import { runPersistedSettingsMigrations } from "./settingsStore/migrations";
import { initialState, type ObjectSections } from "./settingsStore/defaults";
import { clampSettingValue } from "./settingsStore/clamp";
import { reconcileSettings } from "./settingsStore/reconcile";
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
  SidebarStyle,
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

/** The persisted settings schema version this build writes. */
const SETTINGS_VERSION = 2;

/**
 * The default link protocols each settings version introduced. A blob older
 * than a version gets that version's protocols added ONCE, on upgrade; after
 * that the persisted list is the user's own, so a removed default stays
 * removed (the list is the link-scheme allowlist). Adding a default protocol
 * means bumping SETTINGS_VERSION and adding its entry here — a test holds that
 * every default protocol is introduced by some version.
 *
 * Version 2 adds the whole v1 default list: v1 builds unioned the defaults
 * into the persisted list on every load, so a v1 user always effectively had
 * every one of them.
 */
export const LINK_PROTOCOLS_INTRODUCED: Readonly<Record<number, readonly string[]>> = {
  2: ["obsidian", "vscode", "dict", "x-dictionary"],
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Add, once, the default link protocols introduced after `fromVersion`. */
function addIntroducedLinkProtocols(state: Record<string, unknown>, fromVersion: number): void {
  const advanced = state.advanced;
  // No list at all: the deep merge supplies the current defaults.
  if (!isPlainObject(advanced) || !Array.isArray(advanced.customLinkProtocols)) return;
  const introduced = Object.entries(LINK_PROTOCOLS_INTRODUCED)
    .filter(([version]) => Number(version) > fromVersion)
    .flatMap(([, protocols]) => protocols);
  const own = advanced.customLinkProtocols.filter((p): p is string => typeof p === "string");
  advanced.customLinkProtocols = [...new Set([...introduced, ...own])];
}

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
      // v2: the link-protocol list stopped being unioned with the defaults on
      // every load (see LINK_PROTOCOLS_INTRODUCED).
      version: SETTINGS_VERSION,
      migrate: (persistedState, version) => {
        // A blob from a newer build (after a downgrade) is dropped: returning
        // `undefined` tells persist to keep the in-memory default state,
        // which is preferable to producing a partially-initialized object.
        // So is a `state` that is not an object at all.
        if (typeof version !== "number" || version > SETTINGS_VERSION) return undefined;
        if (!isPlainObject(persistedState)) return undefined;
        addIntroducedLinkProtocols(persistedState, version);
        return persistedState as unknown as SettingsState;
      },
      // Guard localStorage access for SSR/non-browser environments, and wrap it
      // so a write carries only the sections THIS window changed. persist
      // serializes the whole state on every set(), so without this any write —
      // a view toggle, or the background update-check timestamp — pushes this
      // window's snapshot over sections another window changed since we last
      // read. Reproduced in the running app: a terminal font size set in the
      // Settings window was reverted by an unrelated document-window write.
      storage: createJSONStorage(() =>
        createSectionMergingStorage(createSafeStorage()),
      ),
      // Deep merge to preserve new default properties when loading old localStorage
      merge: (persistedState, currentState) => {
        // A `state` that is not an object (a string, an array) would spread
        // its indices into the store as settings named "0", "1", ...: refuse
        // it and keep the defaults. A current-version blob reaches here
        // without passing `migrate`, so the guard lives here too.
        if (!isPlainObject(persistedState)) return currentState;
        const rawPersisted = persistedState;
        // Every persisted-blob migration, in order, on the raw untrusted blob
        // BEFORE shape-sanitization (the pipeline is pinned complete by
        // migrations.test.ts).
        runPersistedSettingsMigrations(rawPersisted);
        // T4/D4: the shared trust boundary — shape-sanitize, deep-merge, clamp
        // bounded numerics, normalize browser posture. The cross-window
        // storage-event path in useSettingsSync runs this exact function, so
        // the two routes cannot drift apart again (see reconcile.ts).
        const merged = reconcileSettings(
          currentState as unknown as Record<string, unknown>,
          rawPersisted
        ) as unknown as typeof currentState;
        // The persisted link-protocol list is taken as it is: reconcile keeps
        // an array and drops its non-string entries. Defaults a newer build
        // introduces arrive once, through `migrate` — never by a union here,
        // which put every removed default back at the next launch.
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
  onMenuShortcutSyncFailure,
  formatKeyForDisplay,
  prosemirrorToTauri,
  type ShortcutCategory,
  type ShortcutDefinition,
} from "./settingsStore/shortcuts";
