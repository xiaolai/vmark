/**
 * Settings defaults
 *
 * Purpose: The canonical initial state for every settings section, plus the
 * `ObjectSections` union of updatable object groups. Split out of
 * settingsStore.ts to keep that file near the ~300-line guideline; the store
 * imports `initialState` and re-exports nothing user-facing from here.
 *
 * @coordinates-with settingsStore.ts — consumes initialState + ObjectSections
 * @coordinates-with settingsTypes.ts — type definitions for each section
 * @module stores/settingsStore/defaults
 */

import { resolveInitialLanguage } from "@/utils/localeDetect";
import type { SettingsState } from "../settingsTypes";
import { DEFAULT_CJK_FORMATTING } from "@/lib/cjkFormatter/types";

export const initialState: SettingsState = {
  general: {
    autoSaveEnabled: true,
    autoSaveInterval: 30,
    // Opt-in: capture rewrites the file to insert a `vmark:` identity block.
    coherenceCaptureOnSave: false,
    historyEnabled: true,
    historyMaxSnapshots: 50,
    historyMaxAgeDays: 7,
    historyMergeWindow: 30,
    historyMaxFileSize: 512,
    tabSize: 2,
    lineEndingsOnSave: "preserve",
    confirmQuit: true,
    // fix(#946) — opt-in: open existing files in a new tab (off keeps the legacy "reuse untitled tab" behavior).
    openInNewTab: false,
    workspaceRailMode: false,
    // First-run default derived from OS locale; persisted value from zustand/persist
    // overrides this via the merge hook below, so existing users are untouched.
    language: resolveInitialLanguage(),
  },
  appearance: {
    theme: "paper",
    followSystemAppearance: false, // Manual theme selection by default (#1125)
    systemLightTheme: "paper", // Paired light theme when following the system
    systemDarkTheme: "night", // Paired dark theme when following the system
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
  cjkFormatting: { ...DEFAULT_CJK_FORMATTING },
  markdown: {
    preserveLineBreaks: false,
    // ON by default: a plain Cmd+S must not collapse blank lines the file
    // already had — a fresh install never rewrites untouched content.
    preserveBlankLines: true,
    showBrTags: false,
    showInvisibles: false,
    codeBlockLineNumbers: false,
    enableRegexSearch: true,
    pasteMarkdownInWysiwyg: "auto",
    pasteMode: "smart", // Default: convert HTML to Markdown
    mediaBorderStyle: "none",
    mediaAlignment: "center",
    headingAlignment: "left",
    blockFontSize: "1",
    htmlRenderingMode: "sanitized",
    htmlAllowlistLevel: "strict",
    htmlAllowlistCustomTags: "",
    hardBreakStyleOnSave: "preserve",
    autoPairEnabled: true,
    autoPairCJKStyle: "auto",
    autoPairCurlyQuotes: true,
    autoPairRightDoubleQuote: false,
    copyFormat: "default",
    copyOnSelect: false,
    tableFitToWidth: false,
    lintEnabled: true,
    splitViewByDefault: false,
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
    osc52Clipboard: true,
    screenReaderMode: false,
    bellMode: "visual",
    notifyOnBell: true,
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
    developerMode: false,
    keepBothEditorsAlive: false,
    workflowViewer: false,
    workflowEngine: false,
    workflowEditorPreserveYamlFormatting: true,
    workflowFetchActionMetadata: true,
    workflowActionlint: true,
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
    // Multi-format rebrand opt-in defaults — markdown/txt/yaml are always
    // registered; everything else is OFF so existing users aren't surprised
    // (the first-run-after-upgrade nudge surfaces these in Settings).
    dataFormats: false,
    diagrams: false,
    htmlPreview: false,
    codeViewers: false,
    externalEditor: "",
    defaultViewMode: "split",
    upgradeNudgeShown: false,
    associations: {},
  },
  browser: {
    // Embedded browser is off by default until the surface + driver ship (WI-1.10).
    enabled: false,
    aiSession: "sandbox",
    aiAllowLoopback: false,
  },
  showDevSection: false,
};

/**
 * Settings sections that can be updated with createSectionUpdater — every
 * object-valued key of SettingsState (i.e. all of them except the `showDevSection`
 * UI flag). Derived, not hand-listed: a new section is picked up automatically
 * instead of drifting out of sync with SettingsState.
 */
export type ObjectSections = {
  [K in keyof SettingsState]: SettingsState[K] extends object ? K : never;
}[keyof SettingsState];
