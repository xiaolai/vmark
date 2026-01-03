import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

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
  },
  paper: {
    background: "#EEEDED",
    foreground: "#1a1a1a",
    link: "#0066cc",
    secondary: "#e5e4e4",
    border: "#d5d4d4",
  },
  mint: {
    background: "#CCE6D0",
    foreground: "#2d3a35",
    link: "#1a6b4a",
    secondary: "#b8d9bd",
    border: "#a8c9ad",
  },
  sepia: {
    background: "#F9F0DB",
    foreground: "#5c4b37",
    link: "#8b4513",
    secondary: "#f0e5cc",
    border: "#e0d5bc",
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
    strong: "#6cb6ff",
    emphasis: "#d19a66",
  },
};

interface AppearanceSettings {
  theme: ThemeId;
  latinFont: string;
  cjkFont: string;
  monoFont: string;
  fontSize: number;
  lineHeight: number;
  paragraphSpacing: number;
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

export interface MarkdownSettings {
  preserveLineBreaks: boolean; // Don't collapse blank lines
  showBrTags: boolean; // Display <br> tags visibly
  revealInlineSyntax: boolean; // Show markdown markers when cursor in formatted text
  enableRegexSearch: boolean; // Enable regex in Find & Replace
  mediaBorderStyle: MediaBorderStyle; // Border style for images and diagrams
  // Spell check
  spellCheckEnabled: boolean;
  spellCheckLanguages: SpellCheckLanguage[];
}

export interface GeneralSettings {
  // Auto-save
  autoSaveEnabled: boolean;
  autoSaveInterval: number; // seconds
  // Document history
  historyEnabled: boolean;
  historyMaxSnapshots: number;
  historyMaxAgeDays: number;
}

interface SettingsState {
  general: GeneralSettings;
  appearance: AppearanceSettings;
  cjkFormatting: CJKFormattingSettings;
  markdown: MarkdownSettings;
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
  },
  appearance: {
    theme: "paper",
    latinFont: "system",
    cjkFont: "system",
    monoFont: "system",
    fontSize: 18,
    lineHeight: 1.6,
    paragraphSpacing: 1,
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
    mediaBorderStyle: "none",
    spellCheckEnabled: false,
    spellCheckLanguages: ["en"],
  },
  showDevSection: false,
};

// Object sections that can be updated with createSectionUpdater
type ObjectSections = "general" | "appearance" | "cjkFormatting" | "markdown";

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
    }
  )
);
