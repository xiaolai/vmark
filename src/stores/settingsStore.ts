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
 * @module stores/settingsStore
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { deepMerge } from "@/utils/deepMerge";
import { createSafeStorage } from "@/utils/safeStorage";
import type { ThemeId, ThemeColors, SettingsState, SettingsActions } from "./settingsTypes";

// Re-export all types for backward compatibility — consumers can keep
// importing from "@/stores/settingsStore" without changes.
export type {
  ThemeId,
  ThemeColors,
  AppearanceSettings,
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
  TerminalSettings,
  MarkdownSettings,
  ImageAutoResizeOption,
  ImageSettings,
  GeneralSettings,
  UpdateSettings,
  SettingsState,
  SettingsActions,
} from "./settingsTypes";

/** Color palettes for each available theme. */
export const themes: Record<ThemeId, ThemeColors> = {
  white: {
    background: "#FFFFFF",
    foreground: "#1a1a1a",
    link: "#0066cc",
    secondary: "#f8f8f8",
    border: "#eeeeee",
    // Blue-gray for bold, dark wine for italic
    strong: "#3f5663",
    emphasis: "#5b0411",
  },
  paper: {
    background: "#EEEDED",
    foreground: "#1a1a1a",
    link: "#0066cc",
    secondary: "#e5e4e4",
    border: "#d5d4d4",
    // Blue-gray for bold, dark wine for italic
    strong: "#3f5663",
    emphasis: "#5b0411",
  },
  mint: {
    background: "#CCE6D0",
    foreground: "#2d3a35",
    link: "#1a6b4a",
    secondary: "#b8d9bd",
    border: "#a8c9ad",
    // Forest teal for bold, warm olive for italic
    strong: "#1a5c4a",
    emphasis: "#6b4423",
  },
  sepia: {
    background: "#F9F0DB",
    foreground: "#5c4b37",
    link: "#8b4513",
    secondary: "#f0e5cc",
    border: "#e0d5bc",
    // Deep brown for bold, terracotta for italic
    strong: "#4a3728",
    emphasis: "#8b3a2f",
  },
  night: {
    background: "#23262b",
    foreground: "#d6d9de",
    link: "#5aa8ff",
    secondary: "#2a2e34",
    border: "#3a3f46",
    isDark: true,
    textSecondary: "#9aa0a6",
    codeText: "#d1d5db",
    selection: "rgba(90, 168, 255, 0.22)",
    mdChar: "#7aa874",
    // Light blue for bold, warm orange for italic
    strong: "#6cb6ff",
    emphasis: "#d19a66",
  },
};

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
    language: "en",
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
  },
  markdown: {
    preserveLineBreaks: false,
    showBrTags: false,
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
    autoResizeCustom: 1600,
    inlineThreshold: 1.0, // 1.0× line height
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
  },
  update: {
    autoCheckEnabled: true,
    checkFrequency: "startup",
    autoDownload: false,
    lastCheckTimestamp: null,
    skipVersion: null,
  },
  showDevSection: false,
};

// Object sections that can be updated with createSectionUpdater
type ObjectSections = "general" | "appearance" | "cjkFormatting" | "markdown" | "image" | "terminal" | "advanced" | "update";

// Helper to create section updaters - reduces duplication
const createSectionUpdater = <T extends ObjectSections>(
  set: (fn: (state: SettingsState) => Partial<SettingsState>) => void,
  section: T
) => <K extends keyof SettingsState[T]>(key: K, value: SettingsState[T][K]) =>
  set((state) => ({
    [section]: { ...state[section], [key]: value },
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

      toggleDevSection: () => set((state) => ({ showDevSection: !state.showDevSection })),
      resetSettings: () => set(structuredClone(initialState)),
    }),
    {
      name: "vmark-settings",
      // Guard localStorage access for SSR/non-browser environments
      storage: createJSONStorage(() => createSafeStorage()),
      // Deep merge to preserve new default properties when loading old localStorage
      merge: (persistedState, currentState) => {
        const persisted = (persistedState ?? {}) as Record<string, unknown>;
        // Migration: paragraphSpacing -> blockSpacing
        const appearance = persisted.appearance as Record<string, unknown> | undefined;
        if (appearance && "paragraphSpacing" in appearance && !("blockSpacing" in appearance)) {
          appearance.blockSpacing = appearance.paragraphSpacing;
          delete appearance.paragraphSpacing;
        }
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
        return merged;
      },
    }
  )
);
