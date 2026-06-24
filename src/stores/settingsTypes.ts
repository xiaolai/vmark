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
import type { ThemeId } from "@/theme/themes";
import type { HtmlAllowlistLevel } from "@/utils/htmlAllowlists";
export type { HtmlAllowlistLevel };

// ---------------------------------------------------------------------------
// Theme types
// ---------------------------------------------------------------------------

// audit-fix — single-source ThemeId
/** Available theme identifiers for the editor color scheme. Re-exported here
 *  for backward compatibility; the canonical union lives in the theme module
 *  (`@/theme/themes`, derived from the `themes` catalog). Imported (not
 *  re-exported) so `ThemeId` is also bound locally for `AppearanceSettings`. */
export type { ThemeId };

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
  // Per-theme dark-mode legacy `--*` overrides (projected from
  // ThemeTokens.color.legacy). Let a second dark theme render its own
  // values instead of falling back to night's. See themeColorsAdapter.ts.
  bgTertiary?: string;
  textTertiary?: string;
  blurText?: string;
  accentBg?: string;
  sourceModeBg?: string;
  errorColor?: string;
  errorColorHover?: string;
  errorBg?: string;
  successColor?: string;
  successColorHover?: string;
  alertNote?: string;
  alertTip?: string;
  alertImportant?: string;
  alertWarning?: string;
  alertCaution?: string;
  highlightBg?: string;
  highlightText?: string;
  blockBgSubtle?: string;
  blockBgSubtleHover?: string;
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

/** How strongly Focus Mode dims non-focused content (on top of the color
 *  shift): "standard" keeps the color-only look, "strong"/"stronger" add
 *  progressively lower opacity. */
export type FocusModeDim = "standard" | "strong" | "stronger";

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
  focusModeDim: FocusModeDim; // How strongly Focus Mode dims non-focused content
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
  // Render invisible chars: spaces ·, tabs → and soft breaks ↓ (Source only),
  // hard breaks ⏎. Off by default; --md-char-color, hidden in print + fenced code.
  showInvisibles: boolean;
  enableRegexSearch: boolean; // Enable regex in Find & Replace
  pasteMarkdownInWysiwyg: MarkdownPasteMode; // Convert pasted markdown into rich text
  pasteMode: PasteMode; // How to handle clipboard content (smart/plain/rich)
  mediaBorderStyle: MediaBorderStyle; // Border style for images and diagrams
  mediaAlignment: MediaAlignment; // Alignment for block images and tables
  headingAlignment: HeadingAlignment; // Alignment for headings
  blockFontSize: BlockFontSize; // Font size for lists, blockquotes, tables, etc.
  htmlRenderingMode: HtmlRenderingMode; // Rich text display for raw HTML
  htmlAllowlistLevel: HtmlAllowlistLevel; // Raw HTML tag breadth: strict (default) or extended
  htmlAllowlistCustomTags: string; // Extra allowed tags (comma/space separated, on top of the level)
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

/** Image handling preferences — auto-resize and asset management. */
export interface ImageSettings {
  // Auto-resize: max dimension in pixels (0 = disabled)
  autoResizeMax: ImageAutoResizeOption;
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
  port: number;        // Default: 9223 (VMark app MCP server; not Tauri automation)
  autoStart: boolean;  // Start on app launch
  autoApproveEdits: boolean; // Auto-approve AI document edits without preview
}

/** Terminal placement: auto (axis by aspect ratio), auto-flipped (auto, opposite end), or an explicit side. See useTerminalPosition. */
export type TerminalPosition = "auto" | "auto-flipped" | "top" | "bottom" | "left" | "right";
/** Terminal cursor shape. */
export type TerminalCursorStyle = "block" | "underline" | "bar";
/** How a terminal bell (BEL) is signalled: off, a visual background-activity
 *  indicator, or an audible beep. */
export type TerminalBellMode = "off" | "visual" | "audible";

/** Terminal emulator preferences — shell, font, cursor, renderer, and panel layout. */
export interface TerminalSettings {
  shell: string;       // Default: "" (empty = system default via getpwuid → $SHELL → /bin/sh)
  fontSize: number;    // Default: 13 (clamp range: 8–32, see CLAMP_RANGES.terminal)
  lineHeight: number;  // Default: 1.2 (clamp range: 1–2.5, see CLAMP_RANGES.terminal)
  cursorStyle: TerminalCursorStyle; // Default: "bar"
  cursorBlink: boolean; // Default: true
  copyOnSelect: boolean; // Default: false — auto-copy selected text to clipboard
  useWebGL: boolean;   // Default: true — use WebGL renderer (disable to troubleshoot IME issues)
  macOptionIsMeta: boolean; // Default: true — treat macOS Option as Meta for Alt+Arrow word navigation; disable for dead-key accent composition (Option+E/N/U)
  shellIntegration: boolean; // Default: true — inject OSC 133 command marks + OSC 7 cwd (zsh) for prompt nav, exit-status decorations, cwd tracking
  screenReaderMode: boolean; // Default: false — expose terminal output to assistive tech (VoiceOver); off by default for performance (G3/WI-3.1)
  bellMode: TerminalBellMode; // Default: "visual" — how the terminal bell is signalled (off/visual indicator/audible beep)
  notifyOnBell: boolean; // Default: true — OS notification when an unfocused window's terminal rings the bell
  minimumContrastRatio: number; // Default: 4.5 (WCAG AA) — xterm foreground-lift floor (1 = off … 21 = max)
  scrollback: number; // Default: 5000 — number of scrollback lines retained per session (G7/WI-4.2)
  position: TerminalPosition; // Default: "auto" — auto-reposition based on window aspect ratio
  panelRatio: number;  // Default: 0.4 — fraction of available space (0.1–0.8), persisted on drag end
}

// ---------------------------------------------------------------------------
// Advanced & General
// ---------------------------------------------------------------------------

/** Advanced settings — MCP server, custom protocols, and developer-facing toggles. */
export interface AdvancedSettingsState {
  mcpServer: McpServerSettings;
  customLinkProtocols: string[]; // Custom URL protocols to recognize (e.g., "obsidian", "vscode")
  keepBothEditorsAlive: boolean; // Keep both editors mounted for faster mode switching (default: false)
  workflowEngine: boolean; // Enable YAML workflow engine (developer feature, default: false)
  /**
   * When the structured workflow editor saves changes, preserve comments,
   * anchors, and existing formatting where possible (CST round-trip).
   * Disable to reformat through `yaml.stringify` on every save.
   * Default: true.
   */
  workflowEditorPreserveYamlFormatting: boolean;
  /**
   * Fetch `action.yml` from referenced GitHub Actions over the network to
   * populate the structured editor's `with:` form. Disable for a purely
   * offline workflow viewer (audit 20260612 H28 — the privacy off-switch
   * the website documents). Default: true.
   */
  workflowFetchActionMetadata: boolean;
  /** Run optional `actionlint` for richer workflow diagnostics. Default: true. */
  workflowActionlint: boolean;
  // macOS only: clear `com.apple.quarantine` on the workspace root and its
  // direct .md children when opening a workspace. Without this, files marked
  // by apps like Mixin Messenger fail to open in a running VMark via Finder
  // double-click (Launch Services routes them through CSUI which silently
  // drops the openURLs delivery). Default: true.
  clearMacQuarantineOnOpen: boolean;
}

// ---------------------------------------------------------------------------
// Format support (multi-format rebrand opt-in)
// ---------------------------------------------------------------------------

/**
 * Format support settings — opt-in toggles for non-default format adapters.
 *
 * Markdown, plain text, and YAML/YML are always registered (markdown is the
 * core product; YAML shipped on by default in the previous release with the
 * GHA workflow viewer — reverting it would break the contract). Every other
 * adapter is grouped here behind a category toggle so the existing user base
 * isn't surprised by VMark suddenly opening `.html` / `.toml` / `.ts` files
 * with rich previews. Defaults are all OFF on first install AND on upgrade.
 *
 * `externalEditor` is the explicit override for the "Open in external editor"
 * button on read-only code tabs (WI-4.4). Empty string = fall back to the
 * env-var chain (`$VMARK_EXTERNAL_EDITOR` → `$VISUAL` → `$EDITOR` → platform
 * default). The GUI setting wins over env vars when both are set — explicit
 * beats implicit.
 */
export interface FormatsSettings {
  /** Register `.json` / `.jsonl` / `.toml` adapters (split-pane source + tree). */
  dataFormats: boolean;
  /** Register `.mmd` (Mermaid) and `.svg` adapters (source + sanitized render). */
  diagrams: boolean;
  /** Register `.html` / `.htm` adapter (sandboxed iframe + DOMPurify + CSP). */
  htmlPreview: boolean;
  /** Register `.ts` / `.tsx` / `.js` / `.jsx` / `.py` / `.rs` / `.go` /
   *  `.css` / `.sh` / `.bash` / `.rb` / `.lua` viewers (read-only by default). */
  codeViewers: boolean;
  /** Explicit external-editor command for the read-only code-tab escape hatch.
   *  Empty = env-var fallback chain. Browse button populates. */
  externalEditor: string;
  /** Internal: set true once the upgrade nudge toast has been shown so it
   *  never repeats. Not user-toggled — only updated by the nudge handler. */
  upgradeNudgeShown: boolean;
  /** User format associations: lookup-key → formatId. The manual override
   *  behind "Set File Type…". Keys are produced by `formatLookupKeys`
   *  (full filename, dotfile stem, or bare extension — e.g. `txt`, `.env`,
   *  `dockerfile`). Empty by default. Wins over the built-in extension map
   *  so a user can render a `.txt` as markdown or force any file to plain
   *  text. */
  associations: Record<string, string>;
}

/** General settings — auto-save, document history, tab size, line endings, and quit behavior. */
// ---------------------------------------------------------------------------
// Large file open behavior
// ---------------------------------------------------------------------------

/** User-togglable behavior for opening large files.
 *
 * @see `src/utils/fileSizeThresholds.ts` for the threshold byte values.
 */
export interface LargeFileSettings {
  /** When true, files ≥ 1 MB open in Source mode by default (sub-second open). */
  autoSourceMode: boolean;
  /** When true, a pre-open confirmation dialog appears for files ≥ 5 MB. */
  warnAbove5MB: boolean;
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
  // Tab behavior
  // fix(#946) — when true, opening an existing file uses a new tab instead of
  // replacing the current clean untitled tab. Default false preserves the
  // legacy "reuse the empty tab" behavior so existing users are unaffected.
  openInNewTab: boolean;
  // Workspace rail/window model; default false preserves the classic model.
  workspaceRailMode: boolean;
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
  largeFile: LargeFileSettings;
  formats: FormatsSettings;
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
  toggleDevSection: () => void;
  resetSettings: () => void;
}
