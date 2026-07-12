/**
 * Composite settings state and actions — the full SettingsState shape and
 * the typed per-section updater actions.
 *
 * Extracted from settingsTypes.ts, which remains the stable entry point.
 *
 * @module stores/settingsTypes/state
 */

import type { AppearanceSettings } from "./appearance";
import type { CJKFormattingSettings } from "./cjk";
import type { ImageSettings, MarkdownSettings } from "./content";
import type { AdvancedSettingsState, TerminalSettings } from "./system";
import type {
  BrowserSettings,
  FormatsSettings,
  GeneralSettings,
  LargeFileSettings,
  UpdateSettings,
} from "./workspace";

// ---------------------------------------------------------------------------
// Composite State
// ---------------------------------------------------------------------------

/** Composite settings state — all setting sections plus UI flags. */
export interface SettingsState {
  general: GeneralSettings;
  appearance: AppearanceSettings;
  cjkFormatting: CJKFormattingSettings;
  markdown: MarkdownSettings;
  image: ImageSettings;
  terminal: TerminalSettings;
  advanced: AdvancedSettingsState;
  update: UpdateSettings;
  largeFile: LargeFileSettings;
  formats: FormatsSettings;
  browser: BrowserSettings;
  // UI state
  showDevSection: boolean;
}

/** Typed updater actions for each settings section, plus reset and dev toggle. */
export interface SettingsActions {
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
  updateImageSetting: <K extends keyof ImageSettings>(
    key: K,
    value: ImageSettings[K]
  ) => void;
  updateTerminalSetting: <K extends keyof TerminalSettings>(
    key: K,
    value: TerminalSettings[K]
  ) => void;
  updateAdvancedSetting: <K extends keyof AdvancedSettingsState>(
    key: K,
    value: AdvancedSettingsState[K]
  ) => void;
  updateUpdateSetting: <K extends keyof UpdateSettings>(
    key: K,
    value: UpdateSettings[K]
  ) => void;
  updateLargeFileSetting: <K extends keyof LargeFileSettings>(
    key: K,
    value: LargeFileSettings[K]
  ) => void;
  updateFormatsSetting: <K extends keyof FormatsSettings>(
    key: K,
    value: FormatsSettings[K]
  ) => void;
  updateBrowserSetting: <K extends keyof BrowserSettings>(
    key: K,
    value: BrowserSettings[K]
  ) => void;
  toggleDevSection: () => void;
  resetSettings: () => void;
}
