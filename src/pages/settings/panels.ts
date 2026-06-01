/**
 * Settings panel registry.
 *
 * Single source of truth for which component renders each settings section.
 * Both the normal single-panel view and the search view (which stacks every
 * searchable panel) read from here, so the two never drift.
 *
 * @module pages/settings/panels
 */

import type { ComponentType } from "react";
import { AppearanceSettings } from "./AppearanceSettings";
import { EditorSettings } from "./EditorSettings";
import { FilesImagesSettings } from "./FilesImagesSettings";
import { FormatsSettings } from "./FormatsSettings";
import { IntegrationsSettings } from "./IntegrationsSettings";
import { LanguageSettings } from "./LanguageSettings";
import { MarkdownSettings } from "./MarkdownSettings";
import { ShortcutsSettings } from "./ShortcutsSettings";
import { AboutSettings } from "./AboutSettings";
import { TerminalSettings } from "./TerminalSettings";
import { AdvancedSettings } from "./AdvancedSettings";

export type Section =
  | "about"
  | "appearance"
  | "editor"
  | "files"
  | "formats"
  | "integrations"
  | "language"
  | "markdown"
  | "shortcuts"
  | "terminal"
  | "advanced";

/** Section id → panel component. */
export const SETTINGS_PANELS: Record<Section, ComponentType> = {
  appearance: AppearanceSettings,
  editor: EditorSettings,
  files: FilesImagesSettings,
  formats: FormatsSettings,
  integrations: IntegrationsSettings,
  language: LanguageSettings,
  markdown: MarkdownSettings,
  shortcuts: ShortcutsSettings,
  terminal: TerminalSettings,
  about: AboutSettings,
  advanced: AdvancedSettings,
};

/**
 * Panels included in global search, in display order. Shortcuts is excluded:
 * it has its own dedicated search and is keybindings, not SettingRow-based
 * settings. `advanced` is appended by the caller only when the dev section is
 * visible.
 */
export const SEARCHABLE_PANEL_IDS: Section[] = [
  "appearance",
  "editor",
  "files",
  "formats",
  "integrations",
  "language",
  "markdown",
  "terminal",
  "about",
];
