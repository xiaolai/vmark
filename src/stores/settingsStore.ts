import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { HardBreakStyleOnSave, LineEndingOnSave } from "@/utils/linebreakDetection";

/**
 * Deep merge utility for settings migration.
 * Merges persisted state into current defaults, preserving new default properties.
 */
function deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
  const result = { ...target };
  for (const key of Object.keys(source) as Array<keyof T>) {
    const sourceValue = source[key];
    const targetValue = target[key];
    if (
      sourceValue !== null &&
      typeof sourceValue === "object" &&
      !Array.isArray(sourceValue) &&
      targetValue !== null &&
      typeof targetValue === "object" &&
      !Array.isArray(targetValue)
    ) {
      result[key] = deepMerge(
        targetValue as Record<string, unknown>,
        sourceValue as Record<string, unknown>
      ) as T[keyof T];
    } else if (sourceValue !== undefined && sourceValue !== null) {
      // Skip null values to preserve defaults (null from corrupted localStorage)
      result[key] = sourceValue as T[keyof T];
    }
  }
  return result;
}

export type ThemeId = "white" | "paper" | "mint" | "sepia" | "night";

export interface ThemeColors {
  background: string;
  foreground: string;
  link: string;
  secondary: string;
  border: string;
  // Dark mode specific (optional for light themes)
  isDark?: boolean;
  textSecondary?: string;
  codeText?: string;
  selection?: string;
  mdChar?: string;
  strong?: string;
  emphasis?: string;
}

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

export interface AppearanceSettings {
  theme: ThemeId;
  latinFont: string;
  cjkFont: string;
  monoFont: string;
  fontSize: number;
  lineHeight: number;
  paragraphSpacing: number;
  editorWidth: number; // Max content width in em (0 = unlimited)
  showFilenameInTitlebar: boolean; // Show filename in window titlebar
  autoHideStatusBar: boolean; // Auto-hide status bar when not interacting
}

export interface CJKFormattingSettings {
  // Group 1: Universal
  ellipsisNormalization: boolean;
  newlineCollapsing: boolean;
  // Group 2: Fullwidth Normalization
  fullwidthAlphanumeric: boolean;
  fullwidthPunctuation: boolean;
  fullwidthParentheses: boolean;
  fullwidthBrackets: boolean;
  // Group 3: Spacing
  cjkEnglishSpacing: boolean;
  cjkParenthesisSpacing: boolean;
  currencySpacing: boolean;
  slashSpacing: boolean;
  spaceCollapsing: boolean;
  // Group 4: Dash & Quote
  dashConversion: boolean;
  emdashSpacing: boolean;
  quoteSpacing: boolean;
  singleQuoteSpacing: boolean;
  cjkCornerQuotes: boolean;
  cjkNestedQuotes: boolean;
  // Group 5: Cleanup
  consecutivePunctuationLimit: number; // 0=off, 1=single, 2=double
  trailingSpaceRemoval: boolean;
}

export type MediaBorderStyle = "none" | "always" | "hover";

export type SpellCheckLanguage = "en" | "de" | "es" | "fr" | "ko";

export type AutoPairCJKStyle = "off" | "auto";

export type HtmlRenderingMode = "hidden" | "sanitized" | "sanitizedWithStyles";

export type MarkdownPasteMode = "auto" | "off";

export type AiCommandTrigger = ";; " | ",, " | "// ";

export interface McpServerSettings {
  port: number;        // Default: 9223 (must match MCP bridge plugin port)
  autoStart: boolean;  // Start on app launch
}

export type TerminalShell = "system" | "bash" | "zsh" | "fish" | "powershell";
export type TerminalFontSize = 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20;
export type TerminalCursorStyle = "block" | "bar" | "underline";
export type TerminalMarkdownMode = "ansi" | "overlay" | "off";
export type TerminalTheme = "auto" | "dark" | "light";
export type TerminalPosition = "bottom" | "right";

export interface TerminalSettings {
  shell: TerminalShell;           // Shell to use (system = auto-detect)
  fontSize: TerminalFontSize;     // Terminal font size
  cursorStyle: TerminalCursorStyle; // Cursor appearance
  cursorBlink: boolean;           // Animate cursor
  scrollback: number;             // Lines of scrollback (1000-10000)
  markdownMode: TerminalMarkdownMode; // Markdown rendering mode
  copyOnSelect: boolean;          // Copy text when selected
  theme: TerminalTheme;           // Terminal color theme (auto = follow app)
  position: TerminalPosition;     // Panel position (bottom or right)
}

export interface AdvancedSettingsState {
  enableCommandMenu: boolean;
  mcpServer: McpServerSettings;
  terminalEnabled: boolean; // Show/hide terminal feature entirely
}

export interface MarkdownSettings {
  preserveLineBreaks: boolean; // Don't collapse blank lines
  showBrTags: boolean; // Display <br> tags visibly
  revealInlineSyntax: boolean; // Show markdown markers when cursor in formatted text
  enableRegexSearch: boolean; // Enable regex in Find & Replace
  pasteMarkdownInWysiwyg: MarkdownPasteMode; // Convert pasted markdown into rich text
  mediaBorderStyle: MediaBorderStyle; // Border style for images and diagrams
  htmlRenderingMode: HtmlRenderingMode; // Rich text display for raw HTML
  hardBreakStyleOnSave: HardBreakStyleOnSave; // Preserve or normalize hard break output
  // Auto-pair
  autoPairEnabled: boolean; // Auto-insert closing brackets/quotes
  autoPairCJKStyle: AutoPairCJKStyle; // CJK bracket pairing style
  autoPairCurlyQuotes: boolean; // Include curly quotes in CJK pairing (may conflict with IME)
  // Spell check
  spellCheckEnabled: boolean;
  spellCheckLanguages: SpellCheckLanguage[];
}

export interface AiSettings {
  commandTrigger: AiCommandTrigger;
}

export interface GeneralSettings {
  // Auto-save
  autoSaveEnabled: boolean;
  autoSaveInterval: number; // seconds
  // Document history
  historyEnabled: boolean;
  historyMaxSnapshots: number;
  historyMaxAgeDays: number;
  // Editor
  tabSize: number; // Number of spaces for Tab key (2 or 4)
  lineEndingsOnSave: LineEndingOnSave; // Preserve or normalize line endings
}

interface SettingsState {
  general: GeneralSettings;
  appearance: AppearanceSettings;
  cjkFormatting: CJKFormattingSettings;
  markdown: MarkdownSettings;
  ai: AiSettings;
  terminal: TerminalSettings;
  advanced: AdvancedSettingsState;
  // UI state
  showDevSection: boolean;
}

interface SettingsActions {
  updateGeneralSetting: <K extends keyof GeneralSettings>(
    key: K,
    value: GeneralSettings[K]
  ) => void;
  updateAppearanceSetting: <K extends keyof AppearanceSettings>(
    key: K,
    value: AppearanceSettings[K]
  ) => void;
  updateCJKFormattingSetting: <K extends keyof CJKFormattingSettings>(
    key: K,
    value: CJKFormattingSettings[K]
  ) => void;
  updateMarkdownSetting: <K extends keyof MarkdownSettings>(
    key: K,
    value: MarkdownSettings[K]
  ) => void;
  updateAiSetting: <K extends keyof AiSettings>(
    key: K,
    value: AiSettings[K]
  ) => void;
  updateTerminalSetting: <K extends keyof TerminalSettings>(
    key: K,
    value: TerminalSettings[K]
  ) => void;
  updateAdvancedSetting: <K extends keyof AdvancedSettingsState>(
    key: K,
    value: AdvancedSettingsState[K]
  ) => void;
  toggleDevSection: () => void;
  resetSettings: () => void;
}

const initialState: SettingsState = {
  general: {
    autoSaveEnabled: true,
    autoSaveInterval: 30,
    historyEnabled: true,
    historyMaxSnapshots: 50,
    historyMaxAgeDays: 7,
    tabSize: 2,
    lineEndingsOnSave: "preserve",
  },
  appearance: {
    theme: "paper",
    latinFont: "system",
    cjkFont: "system",
    monoFont: "system",
    fontSize: 18,
    lineHeight: 1.6,
    paragraphSpacing: 1,
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
    quoteSpacing: true,
    singleQuoteSpacing: true,
    cjkCornerQuotes: false, // OFF by default
    cjkNestedQuotes: false, // OFF by default
    // Group 5: Cleanup
    consecutivePunctuationLimit: 0, // 0=off
    trailingSpaceRemoval: true,
  },
  markdown: {
    preserveLineBreaks: false,
    showBrTags: false,
    revealInlineSyntax: false,
    enableRegexSearch: true,
    pasteMarkdownInWysiwyg: "auto",
    mediaBorderStyle: "none",
    htmlRenderingMode: "hidden",
    hardBreakStyleOnSave: "preserve",
    autoPairEnabled: true,
    autoPairCJKStyle: "auto",
    autoPairCurlyQuotes: false, // OFF by default (may conflict with IME smart quotes)
    spellCheckEnabled: false,
    spellCheckLanguages: ["en"],
  },
  ai: {
    commandTrigger: "// ",
  },
  terminal: {
    shell: "system",
    fontSize: 15,
    cursorStyle: "bar",
    cursorBlink: true,
    scrollback: 5000,
    markdownMode: "ansi",
    copyOnSelect: false,
    theme: "auto",
    position: "bottom",
  },
  advanced: {
    enableCommandMenu: false,
    mcpServer: {
      port: 9223,
      autoStart: false,
    },
    terminalEnabled: true,
  },
  showDevSection: false,
};

// Object sections that can be updated with createSectionUpdater
type ObjectSections = "general" | "appearance" | "cjkFormatting" | "markdown" | "ai" | "terminal" | "advanced";

// Helper to create section updaters - reduces duplication
const createSectionUpdater = <T extends ObjectSections>(
  set: (fn: (state: SettingsState) => Partial<SettingsState>) => void,
  section: T
) => <K extends keyof SettingsState[T]>(key: K, value: SettingsState[T][K]) =>
  set((state) => ({
    [section]: { ...state[section], [key]: value },
  }));

export const useSettingsStore = create<SettingsState & SettingsActions>()(
  persist(
    (set) => ({
      ...initialState,

      updateGeneralSetting: createSectionUpdater(set, "general"),
      updateAppearanceSetting: createSectionUpdater(set, "appearance"),
      updateCJKFormattingSetting: createSectionUpdater(set, "cjkFormatting"),
      updateMarkdownSetting: createSectionUpdater(set, "markdown"),
      updateAiSetting: createSectionUpdater(set, "ai"),
      updateTerminalSetting: createSectionUpdater(set, "terminal"),
      updateAdvancedSetting: createSectionUpdater(set, "advanced"),

      toggleDevSection: () => set((state) => ({ showDevSection: !state.showDevSection })),
      resetSettings: () => set(structuredClone(initialState)),
    }),
    {
      name: "vmark-settings",
      // Guard localStorage access for SSR/non-browser environments
      storage: createJSONStorage(() =>
        typeof window !== "undefined" ? localStorage : {
          getItem: () => null,
          setItem: () => {},
          removeItem: () => {},
        }
      ),
      // Deep merge to preserve new default properties when loading old localStorage
      merge: (persistedState, currentState) =>
        deepMerge(
          currentState as unknown as Record<string, unknown>,
          (persistedState ?? {}) as Record<string, unknown>
        ) as unknown as typeof currentState,
    }
  )
);
