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

// ---------------------------------------------------------------------------
// CJK
// ---------------------------------------------------------------------------

// CJK letter spacing options (0 = off)
export type CJKLetterSpacingValue = "0" | "0.02" | "0.03" | "0.05" | "0.08" | "0.10" | "0.12";

// Quote style options for smart quote conversion
// - curly: "" '' (Simplified Chinese, Western)
// - corner: 「」『』 (Traditional Chinese, Japanese)
// - guillemets: «» ‹› (French, Russian)
export type QuoteStyle = "curly" | "corner" | "guillemets";

export type AutoPairCJKStyle = "off" | "auto";

// ---------------------------------------------------------------------------
// Appearance
// ---------------------------------------------------------------------------

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
}

// ---------------------------------------------------------------------------
// Media & Content
// ---------------------------------------------------------------------------

export type MediaBorderStyle = "none" | "always" | "hover";
export type MediaAlignment = "left" | "center";
export type HeadingAlignment = "left" | "center";
export type BlockFontSize = "0.85" | "0.9" | "0.95" | "1";

export type HtmlRenderingMode = "hidden" | "sanitized" | "sanitizedWithStyles";

export type MarkdownPasteMode = "auto" | "off";

/**
 * Paste mode determines how clipboard content is processed:
 * - "smart": Convert HTML to Markdown, detect markdown syntax (default)
 * - "plain": Always paste as plain text
 * - "rich": Keep Tiptap's default HTML handling
 */
export type PasteMode = "smart" | "plain" | "rich";

export type CopyFormat = "default" | "markdown";

// ---------------------------------------------------------------------------
// Markdown Settings
// ---------------------------------------------------------------------------

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
}

// ---------------------------------------------------------------------------
// Image Settings
// ---------------------------------------------------------------------------

// Image auto-resize options (0 = off, positive = max dimension in pixels)
export type ImageAutoResizeOption = 0 | 800 | 1200 | 1920 | 2560;

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

export interface McpServerSettings {
  port: number;        // Default: 9223 (must match MCP bridge plugin port)
  autoStart: boolean;  // Start on app launch
  autoApproveEdits: boolean; // Auto-approve AI document edits without preview
}

export type TerminalPosition = "auto" | "bottom" | "right";

export interface TerminalSettings {
  fontSize: number;    // Default: 13 (range: 10–24)
  lineHeight: number;  // Default: 1.4 (range: 1.0–2.0)
  copyOnSelect: boolean; // Default: false — auto-copy selected text to clipboard
  useWebGL: boolean;   // Default: true — use WebGL renderer (disable to troubleshoot IME issues)
  position: TerminalPosition; // Default: "auto" — auto-reposition based on window aspect ratio
  panelRatio: number;  // Default: 0.4 — fraction of available space (0.1–0.8), persisted on drag end
}

// ---------------------------------------------------------------------------
// Advanced & General
// ---------------------------------------------------------------------------

export interface AdvancedSettingsState {
  mcpServer: McpServerSettings;
  customLinkProtocols: string[]; // Custom URL protocols to recognize (e.g., "obsidian", "vscode")
  keepBothEditorsAlive: boolean; // Keep both editors mounted for faster mode switching (default: false)
}

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
}

// ---------------------------------------------------------------------------
// Update Settings
// ---------------------------------------------------------------------------

export type UpdateCheckFrequency = "startup" | "daily" | "weekly" | "manual";

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
