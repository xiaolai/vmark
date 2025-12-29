import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type ThemeId = "white" | "paper" | "mint" | "sepia";

export interface ThemeColors {
  background: string;
  foreground: string;
  link: string;
  secondary: string;
  border: string;
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

interface SettingsState {
  appearance: AppearanceSettings;
  cjkFormatting: CJKFormattingSettings;
}

interface SettingsActions {
  updateAppearanceSetting: <K extends keyof AppearanceSettings>(
    key: K,
    value: AppearanceSettings[K]
  ) => void;
  updateCJKFormattingSetting: <K extends keyof CJKFormattingSettings>(
    key: K,
    value: CJKFormattingSettings[K]
  ) => void;
  resetSettings: () => void;
}

const initialState: SettingsState = {
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
};

export const useSettingsStore = create<SettingsState & SettingsActions>()(
  persist(
    (set) => ({
      ...initialState,

      updateAppearanceSetting: (key, value) =>
        set((state) => ({
          appearance: { ...state.appearance, [key]: value },
        })),

      updateCJKFormattingSetting: (key, value) =>
        set((state) => ({
          cjkFormatting: { ...state.cjkFormatting, [key]: value },
        })),

      resetSettings: () => set(initialState),
    }),
    {
      name: "vmark-settings",
      storage: createJSONStorage(() => localStorage),
    }
  )
);
