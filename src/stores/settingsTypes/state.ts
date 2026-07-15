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

/** Sets one key of a settings section to a value of that key's declared type. */
type SettingUpdater<T> = <K extends keyof T>(key: K, value: T[K]) => void;

/** Typed updater actions for each settings section, plus reset and dev toggle. */
export interface SettingsActions {
  updateGeneralSetting: SettingUpdater<GeneralSettings>;
  updateAppearanceSetting: SettingUpdater<AppearanceSettings>;
  updateCJKFormattingSetting: SettingUpdater<CJKFormattingSettings>;
  updateMarkdownSetting: SettingUpdater<MarkdownSettings>;
  updateImageSetting: SettingUpdater<ImageSettings>;
  updateTerminalSetting: SettingUpdater<TerminalSettings>;
  updateAdvancedSetting: SettingUpdater<AdvancedSettingsState>;
  updateUpdateSetting: SettingUpdater<UpdateSettings>;
  updateLargeFileSetting: SettingUpdater<LargeFileSettings>;
  updateFormatsSetting: SettingUpdater<FormatsSettings>;
  updateBrowserSetting: SettingUpdater<BrowserSettings>;
  toggleDevSection: () => void;
  resetSettings: () => void;
}
