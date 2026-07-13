/**
 * Settings type definitions — stable entry point.
 *
 * Extracted from settingsStore.ts to keep the store file focused on
 * state management. The interfaces and type aliases now live in domain
 * files under settingsTypes/ (appearance, cjk, content, system, workspace,
 * state); this file re-exports all of them so importers keep a single
 * stable path. The store re-exports them for backward compatibility.
 *
 * @module stores/settingsTypes
 */

export type { HtmlAllowlistLevel } from "@/utils/htmlAllowlists";

export type { ThemeId, ThemeColors, FocusModeDim, AppearanceSettings } from "./settingsTypes/appearance";

export type {
  QuoteStyle,
  AutoPairCJKStyle,
  CJKFormattingSettings,
} from "./settingsTypes/cjk";

export type {
  MediaBorderStyle,
  MediaAlignment,
  HeadingAlignment,
  BlockFontSize,
  HtmlRenderingMode,
  MarkdownPasteMode,
  PasteMode,
  CopyFormat,
  MarkdownSettings,
  ImageAutoResizeOption,
  ImageSettings,
} from "./settingsTypes/content";

export type {
  TerminalPosition,
  TerminalCursorStyle,
  TerminalBellMode,
  TerminalSettings,
} from "./settingsTypes/system";

export type {
  FormatsSettings,
  LargeFileSettings,
  BrowserSettings,
  GeneralSettings,
  UpdateCheckFrequency,
  UpdateSettings,
} from "./settingsTypes/workspace";

export type { SettingsState, SettingsActions } from "./settingsTypes/state";
