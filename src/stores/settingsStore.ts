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
import { createSafeStorage } from "@/utils/safeStorage";
import { resolveInitialLanguage } from "@/utils/localeDetect";
import type { SettingsState, SettingsActions } from "./settingsTypes";

// Re-export all types for backward compatibility — consumers can keep
// importing from "@/stores/settingsStore" without changes.
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
  SettingsState,
  SettingsActions,
} from "./settingsTypes";

/**
 * Color palettes for each available theme — derived from the typed
 * ThemeTokens in src/theme/themes/ per theme-unification-2026-05.
 * To retint a theme, edit src/theme/themes/<id>.ts, not this file.
 */
export { themesAsColors as themes } from "@/theme";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Drop persisted branches whose shape doesn't match the live defaults (T4,
 * persist-boundary zero-trust). Wherever the default is a plain object, the
 * persisted value must also be a plain object — otherwise deepMerge (which only
 * recurses when both sides are objects) would overwrite that object with a
 * primitive/array and crash consumers. Mismatches are skipped so the live
 * default survives.
 *
 * Recurses into nested object branches, so corruption at any depth is caught
 * (e.g. `advanced.mcpServer: "evil"` or `formats.diagrams: 1`), not just at the
 * top level. Keys absent from the defaults pass through unchanged (forward
 * compatibility); non-object default branches (primitives, arrays) are trusted
 * as-is since there is no sub-shape to validate.
 *
 * Exported for testing.
 */
export function sanitizePersistedSettings(
  persisted: Record<string, unknown>,
  defaults: Record<string, unknown>
): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(persisted)) {
    const def = defaults[key];
    if (isPlainObject(def)) {
      if (!isPlainObject(value)) continue; // shape mismatch — preserve the default
      clean[key] = sanitizePersistedSettings(value, def); // recurse into nested branch
    } else {
      clean[key] = value;
    }
  }
  return clean;
}

const initialState: SettingsState = {
  general: {
    autoSaveEnabled: true,
    autoSaveInterval: 30,
    historyEnabled: true,
    historyMaxSnapshots: 50,
    historyMaxAgeDays: 7,
    historyMergeWindow: 30,
    historyMaxFileSize: 512,
    tabSize: 2,
    lineEndingsOnSave: "preserve",
    confirmQuit: true,
    // First-run default derived from OS locale; persisted value from zustand/persist
    // overrides this via the merge hook below, so existing users are untouched.
    language: resolveInitialLanguage(),
  },
  appearance: {
    theme: "paper",
    latinFont: "system",
    cjkFont: "system",
    monoFont: "system",
    fontSize: 18,
    lineHeight: 1.8,
    blockSpacing: 1, // 1 = one line-height of visual gap between blocks
    cjkLetterSpacing: "0", // Off by default
    editorWidth: 50, // em units, 0 = unlimited (50em ≈ 900px at 18px font)
    showFilenameInTitlebar: false,
    autoHideStatusBar: false,
    focusModeDim: "standard", // color-only dimming by default (current behavior)
  },
  cjkFormatting: {
    // Group 1: Universal
    ellipsisNormalization: true,
    newlineCollapsing: true,
    // Group 2: Fullwidth Normalization
    fullwidthAlphanumeric: true,
    fullwidthPunctuation: true,
    fullwidthParentheses: true,
    fullwidthBrackets: false, // OFF by default
    // Group 3: Spacing
    cjkEnglishSpacing: true,
    cjkParenthesisSpacing: true,
    currencySpacing: true,
    slashSpacing: true,
    spaceCollapsing: true,
    // Group 4: Dash & Quote
    dashConversion: true,
    emdashSpacing: true,
    smartQuoteConversion: true, // ON by default - convert " to ""
    quoteStyle: "curly", // curly quotes for Simplified Chinese
    contextualQuotes: true, // ON by default - curly for CJK, straight for pure Latin
    quoteSpacing: true,
    singleQuoteSpacing: true,
    cjkCornerQuotes: false, // OFF by default (Traditional Chinese/Japanese only)
    cjkNestedQuotes: false, // OFF by default
    quoteToggleMode: "simple", // 2-state: straight <-> preferred style
    // Group 5: Cleanup
    consecutivePunctuationLimit: 0, // 0=off
    trailingSpaceRemoval: true,
    // Group 6: Section Handling
    skipReferenceSections: false, // OFF by default — opt-in for academic documents
  },
  markdown: {
    preserveLineBreaks: false,
    showBrTags: false,
    showInvisibles: false,
    enableRegexSearch: true,
    pasteMarkdownInWysiwyg: "auto",
    pasteMode: "smart", // Default: convert HTML to Markdown
    mediaBorderStyle: "none",
    mediaAlignment: "center",
    headingAlignment: "left",
    blockFontSize: "1",
    htmlRenderingMode: "sanitized",
    hardBreakStyleOnSave: "preserve",
    autoPairEnabled: true,
    autoPairCJKStyle: "auto",
    autoPairCurlyQuotes: true,
    autoPairRightDoubleQuote: false,
    copyFormat: "default",
    copyOnSelect: false,
    tableFitToWidth: false,
    lintEnabled: true,
  },
  image: {
    autoResizeMax: 0, // Off by default
    copyToAssets: true,
    cleanupOrphansOnClose: false, // Off by default - user must opt in
  },
  terminal: {
    shell: "",
    fontSize: 13,
    lineHeight: 1.2,
    cursorStyle: "bar",
    cursorBlink: true,
    copyOnSelect: false,
    useWebGL: true,
    macOptionIsMeta: true,
    shellIntegration: true,
    screenReaderMode: false,
    bellMode: "visual",
    minimumContrastRatio: 4.5,
    scrollback: 5000,
    position: "auto",
    panelRatio: 0.4,
  },
  advanced: {
    mcpServer: {
      port: 9223,
      autoStart: true,
      autoApproveEdits: false, // Require approval by default (safer)
    },
    customLinkProtocols: ["obsidian", "vscode", "dict", "x-dictionary"],
    keepBothEditorsAlive: false,
    workflowEngine: false,
    workflowEditorPreserveYamlFormatting: true,
    clearMacQuarantineOnOpen: true,
  },
  update: {
    autoCheckEnabled: true,
    checkFrequency: "startup",
    autoDownload: false,
    lastCheckTimestamp: null,
    skipVersion: null,
  },
  largeFile: {
    autoSourceMode: true,
    warnAbove5MB: true,
  },
  formats: {
    // Multi-format rebrand opt-in defaults — markdown, txt, and yaml are
    // always registered; everything else is OFF by default so existing
    // users aren't surprised. The first-run-after-upgrade nudge surfaces
    // these in the Settings panel via a one-time toast.
    dataFormats: false,
    diagrams: false,
    htmlPreview: false,
    codeViewers: false,
    externalEditor: "",
    upgradeNudgeShown: false,
    associations: {},
  },
  showDevSection: false,
};

// Object sections that can be updated with createSectionUpdater
type ObjectSections = "general" | "appearance" | "cjkFormatting" | "markdown" | "image" | "terminal" | "advanced" | "update" | "largeFile" | "formats";

/**
 * Inclusive [min, max] bounds for numeric settings that render visibly broken
 * when out of range (D4). The UI only offers bounded presets, so these never
 * fire for normal use — they exist to defend against corrupt persisted state
 * or devtools/localStorage edits (e.g. `appearance.fontSize: 999`). Applied
 * both on every programmatic set (createSectionUpdater) and at the persist
 * boundary (clampMergedSettings in `merge`). Fields not listed are unbounded
 * or non-numeric. Exported for testing.
 */
export const CLAMP_RANGES: Partial<Record<ObjectSections, Record<string, [number, number]>>> = {
  appearance: {
    fontSize: [8, 48],
    lineHeight: [1, 3],
    blockSpacing: [0, 3],
    editorWidth: [0, 200],
  },
  terminal: {
    fontSize: [8, 32],
    lineHeight: [1, 2.5],
    scrollback: [100, 200_000],
    panelRatio: [0.1, 0.8],
    minimumContrastRatio: [1, 21],
  },
  general: {
    autoSaveInterval: [5, 3600],
    historyMaxSnapshots: [1, 1000],
    historyMaxAgeDays: [0, 3650],
    historyMergeWindow: [0, 3600],
    historyMaxFileSize: [0, 1_048_576],
    tabSize: [1, 8],
  },
};

/** Clamp a single value if its (section, key) has a known numeric range. */
function clampSettingValue<V>(section: ObjectSections, key: PropertyKey, value: V): V {
  if (typeof value !== "number" || !Number.isFinite(value)) return value;
  const range = CLAMP_RANGES[section]?.[key as string];
  if (!range) return value;
  return Math.min(Math.max(value, range[0]), range[1]) as V;
}

/** Clamp every bounded numeric field on a merged settings object in place.
 *  Exported for testing. */
export function clampMergedSettings(merged: Record<string, unknown>): void {
  for (const [section, ranges] of Object.entries(CLAMP_RANGES)) {
    const group = merged[section];
    if (!isPlainObject(group)) continue;
    for (const [key, [min, max]] of Object.entries(ranges)) {
      const v = group[key];
      if (typeof v === "number" && Number.isFinite(v)) {
        group[key] = Math.min(Math.max(v, min), max);
      }
    }
  }
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
      ...initialState,

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

      toggleDevSection: () => set((state) => ({ showDevSection: !state.showDevSection })),
      resetSettings: () => set(structuredClone(initialState)),
    }),
    {
      name: "vmark-settings",
      // Schema version. Bump whenever the persisted shape changes in a way
      // the `merge` function below cannot recover. `migrate` returns the
      // current defaults so an incompatible blob from a future build (e.g.
      // after a downgrade) is dropped rather than deep-merged into an
      // undefined-laden state that crashes downstream consumers.
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
        // Migration: paragraphSpacing -> blockSpacing. Runs on the raw blob
        // before shape-sanitization, while `appearance` is still trusted as an
        // object here (sanitization would drop it if it weren't).
        const appearance = rawPersisted.appearance as Record<string, unknown> | undefined;
        if (appearance && "paragraphSpacing" in appearance && !("blockSpacing" in appearance)) {
          appearance.blockSpacing = appearance.paragraphSpacing;
          delete appearance.paragraphSpacing;
        }
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
        // Union array-typed defaults so new entries (e.g., link protocols) reach existing users
        const defaultProtocols = currentState.advanced.customLinkProtocols;
        const persistedAdvanced = persisted.advanced as Record<string, unknown> | undefined;
        const persistedProtocols = persistedAdvanced?.customLinkProtocols;
        if (Array.isArray(persistedProtocols)) {
          merged.advanced.customLinkProtocols = [...new Set([...defaultProtocols, ...persistedProtocols])];
        }
        // D4: clamp bounded numeric fields so a corrupt persisted value
        // (e.g. `appearance.fontSize: 999`) can't render the editor broken.
        clampMergedSettings(merged as unknown as Record<string, unknown>);
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
