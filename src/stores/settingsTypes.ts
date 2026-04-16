/**
 * Settings type definitions.
 *
 * Extracted from settingsStore.ts to keep the store file focused on
 * state management. All interfaces and type aliases for settings sections
 * live here; the store re-exports them for backward compatibility.
 *
 * @module stores/settingsTypes
 */

import type { HardBreakStyleOnSave, LineEndingOnSave } from "@/utils/linebreakDetection";

// ---------------------------------------------------------------------------
// Theme types
// ---------------------------------------------------------------------------

/** Available theme identifiers for the editor color scheme. */
export type ThemeId = "white" | "paper" | "mint" | "sepia" | "night";

/** Color palette for a single theme — background, foreground, link, and optional dark-mode overrides. */
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

// ---------------------------------------------------------------------------
// CJK
// ---------------------------------------------------------------------------

/** CJK letter spacing in em units (0 = off). */
export type CJKLetterSpacingValue = "0" | "0.02" | "0.03" | "0.05" | "0.08" | "0.10" | "0.12";

/** Target quote style: curly (""), corner (「」), or guillemets (<<>>). */
export type QuoteStyle = "curly" | "corner" | "guillemets";

/** CJK bracket auto-pairing style: "off" disables, "auto" enables smart pairing. */
export type AutoPairCJKStyle = "off" | "auto";

// ---------------------------------------------------------------------------
// Appearance
// ---------------------------------------------------------------------------

/** Visual appearance preferences — theme, fonts, spacing, and editor width. */
export interface AppearanceSettings {
  theme: ThemeId;
  latinFont: string;
  cjkFont: string;
  monoFont: string;
  fontSize: number;
  lineHeight: number;
  blockSpacing: number; // Visual gap between blocks in "lines" (1 = one line-height)
  cjkLetterSpacing: CJKLetterSpacingValue; // Letter spacing for CJK characters (em)
  editorWidth: number; // Max content width in em (0 = unlimited)
  showFilenameInTitlebar: boolean; // Show filename in window titlebar
  autoHideStatusBar: boolean; // Auto-hide status bar when not interacting
}

// ---------------------------------------------------------------------------
// CJK Formatting
// ---------------------------------------------------------------------------

/** Fine-grained CJK formatting toggles for spacing, normalization, dashes, and quotes. */
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
  smartQuoteConversion: boolean; // Convert straight quotes to smart quotes
  quoteStyle: QuoteStyle; // Target quote style for conversion
  contextualQuotes: boolean; // When true: curly for CJK context, straight for pure Latin
  quoteSpacing: boolean;
  singleQuoteSpacing: boolean;
  cjkCornerQuotes: boolean;
  cjkNestedQuotes: boolean;
  quoteToggleMode: "simple" | "full-cycle"; // Toggle behavior: simple (2-state) or full-cycle (4-state)
  // Group 5: Cleanup
  consecutivePunctuationLimit: number; // 0=off, 1=single, 2=double
  trailingSpaceRemoval: boolean;
  // Group 6: Section Handling
  skipReferenceSections: boolean; // Skip ## References and ## Further Reading (off by default)
}

// ---------------------------------------------------------------------------
// Media & Content
// ---------------------------------------------------------------------------

/** Border style for images and diagrams: none, always visible, or on hover. */
export type MediaBorderStyle = "none" | "always" | "hover";
/** Alignment for block images and tables. */
export type MediaAlignment = "left" | "center";
/** Alignment for headings. */
export type HeadingAlignment = "left" | "center";
/** Relative font size for lists, blockquotes, and tables (1 = 100%). */
export type BlockFontSize = "0.85" | "0.9" | "0.95" | "1";

/** How raw HTML blocks are rendered in WYSIWYG mode. */
export type HtmlRenderingMode = "hidden" | "sanitized" | "sanitizedWithStyles";

/** Whether pasted markdown is converted to rich text in WYSIWYG mode. */
export type MarkdownPasteMode = "auto" | "off";

/**
 * Paste mode determines how clipboard content is processed:
 * - "smart": Convert HTML to Markdown, detect markdown syntax (default)
 * - "plain": Always paste as plain text
 * - "rich": Keep Tiptap's default HTML handling
 */
export type PasteMode = "smart" | "plain" | "rich";

/** What to put in text/plain on copy: "default" (plain text) or "markdown" (markdown syntax). */
export type CopyFormat = "default" | "markdown";

// ---------------------------------------------------------------------------
// Markdown Settings
// ---------------------------------------------------------------------------

/** Markdown editing behavior — line breaks, paste handling, auto-pair, and copy format. */
export interface MarkdownSettings {
  preserveLineBreaks: boolean; // Don't collapse blank lines
  showBrTags: boolean; // Display <br> tags visibly
  enableRegexSearch: boolean; // Enable regex in Find & Replace
  pasteMarkdownInWysiwyg: MarkdownPasteMode; // Convert pasted markdown into rich text
  pasteMode: PasteMode; // How to handle clipboard content (smart/plain/rich)
  mediaBorderStyle: MediaBorderStyle; // Border style for images and diagrams
  mediaAlignment: MediaAlignment; // Alignment for block images and tables
  headingAlignment: HeadingAlignment; // Alignment for headings
  blockFontSize: BlockFontSize; // Font size for lists, blockquotes, tables, etc.
  htmlRenderingMode: HtmlRenderingMode; // Rich text display for raw HTML
  hardBreakStyleOnSave: HardBreakStyleOnSave; // Preserve or normalize hard break output
  // Auto-pair
  autoPairEnabled: boolean; // Auto-insert closing brackets/quotes
  autoPairCJKStyle: AutoPairCJKStyle; // CJK bracket pairing style
  autoPairCurlyQuotes: boolean; // Include curly quotes in CJK pairing (may conflict with IME)
  autoPairRightDoubleQuote: boolean; // Typing " also inserts "" pair (IME compat)
  copyFormat: CopyFormat; // What to put in text/plain on copy (default = plain text, markdown = markdown syntax)
  copyOnSelect: boolean; // Auto-copy selected text to clipboard
  tableFitToWidth: boolean; // Force tables to fit editor width (word-wrap cells)
  lintEnabled: boolean; // Run markdown lint checks and show diagnostics
}

// ---------------------------------------------------------------------------
// Image Settings
// ---------------------------------------------------------------------------

/** Image auto-resize max dimension in pixels (0 = disabled). */
export type ImageAutoResizeOption = 0 | 800 | 1200 | 1920 | 2560;

/** Image handling preferences — auto-resize, inline threshold, and asset management. */
export interface ImageSettings {
  // Auto-resize: max dimension in pixels (0 = disabled)
  autoResizeMax: ImageAutoResizeOption;
  // Custom max dimension (used when autoResizeMax is not in predefined options)
  autoResizeCustom: number;
  // Inline threshold: max image size relative to line height (1.0 = 100% of line height)
  // Images larger than this are inserted as block images
  inlineThreshold: number;
  // Whether to copy images to assets folder on paste/drop
  copyToAssets: boolean;
  // Auto-cleanup orphaned images when closing a document
  cleanupOrphansOnClose: boolean;
}

// ---------------------------------------------------------------------------
// MCP & Terminal
// ---------------------------------------------------------------------------

/** MCP server configuration — port, auto-start, and edit approval policy. */
export interface McpServerSettings {
  port: number;        // Default: 9223 (must match MCP bridge plugin port)
  autoStart: boolean;  // Start on app launch
  autoApproveEdits: boolean; // Auto-approve AI document edits without preview
}

/** Terminal panel placement: auto (based on window aspect ratio), bottom, or right. */
export type TerminalPosition = "auto" | "bottom" | "right";
/** Terminal cursor shape. */
export type TerminalCursorStyle = "block" | "underline" | "bar";

/** Terminal emulator preferences — shell, font, cursor, renderer, and panel layout. */
export interface TerminalSettings {
  shell: string;       // Default: "" (empty = system default via getpwuid → $SHELL → /bin/sh)
  fontSize: number;    // Default: 13 (range: 10–24)
  lineHeight: number;  // Default: 1.2 (range: 1.0–2.0)
  cursorStyle: TerminalCursorStyle; // Default: "bar"
  cursorBlink: boolean; // Default: true
  copyOnSelect: boolean; // Default: false — auto-copy selected text to clipboard
  useWebGL: boolean;   // Default: true — use WebGL renderer (disable to troubleshoot IME issues)
  macOptionIsMeta: boolean; // Default: true — treat macOS Option as Meta for Alt+Arrow word navigation; disable for dead-key accent composition (Option+E/N/U)
  position: TerminalPosition; // Default: "auto" — auto-reposition based on window aspect ratio
  panelRatio: number;  // Default: 0.4 — fraction of available space (0.1–0.8), persisted on drag end
}

// ---------------------------------------------------------------------------
// Advanced & General
// ---------------------------------------------------------------------------

/** Advanced settings — MCP server, custom protocols, and editor optimization. */
export interface AdvancedSettingsState {
  mcpServer: McpServerSettings;
  customLinkProtocols: string[]; // Custom URL protocols to recognize (e.g., "obsidian", "vscode")
  keepBothEditorsAlive: boolean; // Keep both editors mounted for faster mode switching (default: false)
  workflowEngine: boolean; // Enable YAML workflow engine (developer feature, default: false)
}

/** General settings — auto-save, document history, tab size, line endings, and quit behavior. */
export interface GeneralSettings {
  // Auto-save
  autoSaveEnabled: boolean;
  autoSaveInterval: number; // seconds
  // Document history
  historyEnabled: boolean;
  historyMaxSnapshots: number;
  historyMaxAgeDays: number;
  historyMergeWindow: number; // seconds, 0 = disabled (consecutive auto-saves within window overwrite)
  historyMaxFileSize: number; // KB, 0 = unlimited (skip snapshot for files larger than this)
  // Editor
  tabSize: number; // Number of spaces for Tab key (2 or 4)
  lineEndingsOnSave: LineEndingOnSave; // Preserve or normalize line endings
  // Quit behavior
  confirmQuit: boolean; // Require double Cmd+Q to quit (default: true)
  // i18n
  language: string; // Default: "en" — UI language (BCP 47 tag, e.g. "en", "zh-CN", "zh-TW")
}

// ---------------------------------------------------------------------------
// Update Settings
// ---------------------------------------------------------------------------

/** How often the app checks for updates. */
export type UpdateCheckFrequency = "startup" | "daily" | "weekly" | "manual";

/** Update checking and download preferences. */
export interface UpdateSettings {
  autoCheckEnabled: boolean; // Periodically check for updates
  checkFrequency: UpdateCheckFrequency; // When to check
  autoDownload: boolean; // Download updates automatically
  lastCheckTimestamp: number | null; // Unix timestamp of last check
  skipVersion: string | null; // Version to skip (user clicked "Skip")
}

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
  toggleDevSection: () => void;
  resetSettings: () => void;
}
