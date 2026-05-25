/**
 * Settings Store
 *
 * Purpose: Central persistent store for all user-configurable settings —
 *   appearance, markdown behavior, CJK formatting, image handling, terminal,
 *   MCP server, and update preferences.
 *
 * Pipeline: Settings panel UI → updateXxxSetting() → Zustand persist → localStorage
 *   → useTheme.ts / editor plugins read values reactively via selectors
 *
 * Key decisions:
 *   - Uses zustand/persist with deep-merge migration so new default fields are
 *     automatically available when users upgrade without losing existing prefs.
 *   - Settings are grouped into typed sub-objects (general, appearance, markdown,
 *     etc.) with a generic createSectionUpdater helper to reduce boilerplate.
 *   - CJK formatting settings are fine-grained (20+ toggles) to support the
 *     diverse conventions across Simplified Chinese, Traditional Chinese, and
 *     Japanese typography.
 *   - paragraphSpacing → blockSpacing migration handled in merge function.
 *
 * Known limitations:
 *   - No per-document or per-workspace setting overrides — all settings are global.
 *   - resetSettings() replaces all sections at once; no per-section reset.
 *   - localStorage size (~5KB) is well within browser limits but could grow.
 *
 * @coordinates-with useTheme.ts — reads appearance settings to compute CSS vars
 * @coordinates-with useAutoSave.ts — reads general.autoSaveEnabled/autoSaveInterval
 * @coordinates-with useTerminalPosition.ts — reads terminal.position for panel placement
 * @coordinates-with spawnPty.ts — reads terminal.shell for configured shell preference
 * @coordinates-with settingsTypes.ts — all type/interface definitions live there
 * @coordinates-with src/utils/deepMerge.ts — deep-merge utility for persist migration
 * @coordinates-with i18n.ts — reads general.language at startup to set UI locale
 * @module stores/settingsStore
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { deepMerge } from "@/utils/deepMerge";
import { createSafeStorage } from "@/utils/safeStorage";
import { resolveInitialLanguage } from "@/utils/localeDetect";
import type { ThemeId, ThemeColors, SettingsState, SettingsActions } from "./settingsTypes";

// Re-export all types for backward compatibility — consumers can keep
// importing from "@/stores/settingsStore" without changes.
export type {
  ThemeId,
  ThemeColors,
  AppearanceSettings,
  CJKFormattingSettings,
  MediaBorderStyle,
  MediaAlignment,
  HeadingAlignment,
  BlockFontSize,
  QuoteStyle,
  AutoPairCJKStyle,
  HtmlRenderingMode,
  MarkdownPasteMode,
  PasteMode,
  CopyFormat,
  TerminalPosition,
  TerminalCursorStyle,
  TerminalSettings,
  MarkdownSettings,
  ImageAutoResizeOption,
  ImageSettings,
  GeneralSettings,
  UpdateSettings,
  LargeFileSettings,
  SettingsState,
  SettingsActions,
} from "./settingsTypes";

/** Color palettes for each available theme. */
export const themes: Record<ThemeId, ThemeColors> = {
  white: {
    background: "#FFFFFF",
    foreground: "#1a1a1a",
    link: "#0066cc",
    secondary: "#f8f8f8",
    border: "#eeeeee",
    // Blue-gray for bold, dark wine for italic
    strong: "#3f5663",
    emphasis: "#5b0411",
  },
  paper: {
    background: "#EEEDED",
    foreground: "#1a1a1a",
    link: "#0066cc",
    secondary: "#e5e4e4",
    border: "#d5d4d4",
    // Blue-gray for bold, dark wine for italic
    strong: "#3f5663",
    emphasis: "#5b0411",
  },
  mint: {
    background: "#CCE6D0",
    foreground: "#2d3a35",
    link: "#1a6b4a",
    secondary: "#b8d9bd",
    border: "#a8c9ad",
    // Forest teal for bold, warm olive for italic
    strong: "#1a5c4a",
    emphasis: "#6b4423",
  },
  sepia: {
    background: "#F9F0DB",
    foreground: "#5c4b37",
    link: "#8b4513",
    secondary: "#f0e5cc",
    border: "#e0d5bc",
    // Deep brown for bold, terracotta for italic
    strong: "#4a3728",
    emphasis: "#8b3a2f",
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
    // Light blue for bold, warm orange for italic
    strong: "#6cb6ff",
    emphasis: "#d19a66",
  },
};

const initialState: SettingsState = {
  general: {
    autoSaveEnabled: true,
    autoSaveInterval: 30,
    historyEnabled: true,
    historyMaxSnapshots: 50,
    historyMaxAgeDays: 7,
    historyMergeWindow: 30,
    historyMaxFileSize: 512,
    tabSize: 2,
    lineEndingsOnSave: "preserve",
    confirmQuit: true,
    // First-run default derived from OS locale; persisted value from zustand/persist
    // overrides this via the merge hook below, so existing users are untouched.
    language: resolveInitialLanguage(),
  },
  appearance: {
    theme: "paper",
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
    smartQuoteConversion: true, // ON by default - convert " to ""
    quoteStyle: "curly", // curly quotes for Simplified Chinese
    contextualQuotes: true, // ON by default - curly for CJK, straight for pure Latin
    quoteSpacing: true,
    singleQuoteSpacing: true,
    cjkCornerQuotes: false, // OFF by default (Traditional Chinese/Japanese only)
    cjkNestedQuotes: false, // OFF by default
    quoteToggleMode: "simple", // 2-state: straight <-> preferred style
    // Group 5: Cleanup
    consecutivePunctuationLimit: 0, // 0=off
    trailingSpaceRemoval: true,
    // Group 6: Section Handling
    skipReferenceSections: false, // OFF by default — opt-in for academic documents
  },
  markdown: {
    preserveLineBreaks: false,
    showBrTags: false,
    enableRegexSearch: true,
    pasteMarkdownInWysiwyg: "auto",
    pasteMode: "smart", // Default: convert HTML to Markdown
    mediaBorderStyle: "none",
    mediaAlignment: "center",
    headingAlignment: "left",
    blockFontSize: "1",
    htmlRenderingMode: "sanitized",
    hardBreakStyleOnSave: "preserve",
    autoPairEnabled: true,
    autoPairCJKStyle: "auto",
    autoPairCurlyQuotes: true,
    autoPairRightDoubleQuote: false,
    copyFormat: "default",
    copyOnSelect: false,
    tableFitToWidth: false,
    lintEnabled: true,
  },
  image: {
    autoResizeMax: 0, // Off by default
    autoResizeCustom: 1600,
    inlineThreshold: 1.0, // 1.0× line height
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
    keepBothEditorsAlive: false,
    workflowEngine: false,
    workflowEditorPreserveYamlFormatting: true,
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
    // Multi-format rebrand opt-in defaults — markdown, txt, and yaml are
    // always registered; everything else is OFF by default so existing
    // users aren't surprised. The first-run-after-upgrade nudge surfaces
    // these in the Settings panel via a one-time toast.
    dataFormats: false,
    diagrams: false,
    htmlPreview: false,
    codeViewers: false,
    externalEditor: "",
    upgradeNudgeShown: false,
  },
  showDevSection: false,
};

// Object sections that can be updated with createSectionUpdater
type ObjectSections = "general" | "appearance" | "cjkFormatting" | "markdown" | "image" | "terminal" | "advanced" | "update" | "largeFile" | "formats";

// Helper to create section updaters - reduces duplication
const createSectionUpdater = <T extends ObjectSections>(
  set: (fn: (state: SettingsState) => Partial<SettingsState>) => void,
  section: T
) => <K extends keyof SettingsState[T]>(key: K, value: SettingsState[T][K]) =>
  set((state) => ({
    [section]: { ...state[section], [key]: value },
  }));

/** Central persistent store for all user-configurable settings with deep-merge migration. Use selectors, not destructuring. */
export const useSettingsStore = create<SettingsState & SettingsActions>()(
  persist(
    (set) => ({
      ...initialState,

      updateGeneralSetting: createSectionUpdater(set, "general"),
      updateAppearanceSetting: createSectionUpdater(set, "appearance"),
      updateCJKFormattingSetting: createSectionUpdater(set, "cjkFormatting"),
      updateMarkdownSetting: createSectionUpdater(set, "markdown"),
      updateImageSetting: createSectionUpdater(set, "image"),
      updateTerminalSetting: createSectionUpdater(set, "terminal"),
      updateAdvancedSetting: createSectionUpdater(set, "advanced"),
      updateUpdateSetting: createSectionUpdater(set, "update"),
      updateLargeFileSetting: createSectionUpdater(set, "largeFile"),
      updateFormatsSetting: createSectionUpdater(set, "formats"),

      toggleDevSection: () => set((state) => ({ showDevSection: !state.showDevSection })),
      resetSettings: () => set(structuredClone(initialState)),
    }),
    {
      name: "vmark-settings",
      // Schema version. Bump whenever the persisted shape changes in a way
      // the `merge` function below cannot recover. `migrate` returns the
      // current defaults so an incompatible blob from a future build (e.g.
      // after a downgrade) is dropped rather than deep-merged into an
      // undefined-laden state that crashes downstream consumers.
      version: 1,
      migrate: (persistedState, version) => {
        // Forward migrations have no work to do today — the only currently
        // released shape is v1. If a downgrade puts a v2+ blob here, we
        // explicitly drop it: returning `undefined` tells persist to keep
        // the in-memory default state, which is preferable to producing a
        // partially-initialized object.
        if (typeof version !== "number" || version > 1) {
          return undefined;
        }
        return persistedState as SettingsState;
      },
      // Guard localStorage access for SSR/non-browser environments
      storage: createJSONStorage(() => createSafeStorage()),
      // Deep merge to preserve new default properties when loading old localStorage
      merge: (persistedState, currentState) => {
        const persisted = (persistedState ?? {}) as Record<string, unknown>;
        // Migration: paragraphSpacing -> blockSpacing
        const appearance = persisted.appearance as Record<string, unknown> | undefined;
        if (appearance && "paragraphSpacing" in appearance && !("blockSpacing" in appearance)) {
          appearance.blockSpacing = appearance.paragraphSpacing;
          delete appearance.paragraphSpacing;
        }
        const merged = deepMerge(
          currentState as unknown as Record<string, unknown>,
          persisted
        ) as unknown as typeof currentState;
        // Union array-typed defaults so new entries (e.g., link protocols) reach existing users
        const defaultProtocols = currentState.advanced.customLinkProtocols;
        const persistedAdvanced = persisted.advanced as Record<string, unknown> | undefined;
        const persistedProtocols = persistedAdvanced?.customLinkProtocols;
        if (Array.isArray(persistedProtocols)) {
          merged.advanced.customLinkProtocols = [...new Set([...defaultProtocols, ...persistedProtocols])];
        }
        return merged;
      },
    }
  )
);

// ============================================================================
// Shortcuts (T09 consolidation — formerly shortcutsStore.ts)
// ============================================================================

import { invoke } from "@tauri-apps/api/core";
import { isMacPlatform } from "@/utils/shortcutMatch";
import { shortcutsWarn } from "@/utils/debug";
import i18n from "@/i18n";

// ============================================================================
// Types
// ============================================================================

/** Shortcut category for grouping in the settings UI. */
export type ShortcutCategory =
  | "formatting"  // Bold, Italic, Code, etc.
  | "blocks"      // Headings, Lists, Quote, Table
  | "navigation"  // Select, Move, Jump
  | "editing"     // Clear format, Undo, Redo
  | "view"        // Sidebar, Outline, Focus mode
  | "file";       // New, Open, Save, etc.

/**
 * Shortcut scope determines when a shortcut is active.
 * - global: Works everywhere in the application
 * - editor: Only works when editor is focused (default)
 */
export type ShortcutScope = "global" | "editor";

/** A single keyboard shortcut entry with ID, label, category, default key, and optional menu binding. */
export interface ShortcutDefinition {
  id: string;
  label: string;
  category: ShortcutCategory;
  defaultKey: string;
  defaultKeyMac?: string;
  defaultKeyOther?: string;
  description?: string;
  /** Menu item ID in Rust (for menu sync) */
  menuId?: string;
  /** Shortcut scope - defaults to "editor" if not specified */
  scope?: ShortcutScope;
}

// ============================================================================
// Default Shortcuts Registry
// ============================================================================

/** Complete registry of built-in keyboard shortcuts with default key bindings. */
export const DEFAULT_SHORTCUTS: ShortcutDefinition[] = [
  // === Formatting ===
  { id: "bold", label: "Bold", category: "formatting", defaultKey: "Mod-b", menuId: "bold" },
  { id: "italic", label: "Italic", category: "formatting", defaultKey: "Mod-i", menuId: "italic" },
  { id: "code", label: "Inline Code", category: "formatting", defaultKey: "Mod-Shift-`", menuId: "code" },
  { id: "strikethrough", label: "Strikethrough", category: "formatting", defaultKey: "Mod-Shift-x", menuId: "strikethrough" },
  { id: "underline", label: "Underline", category: "formatting", defaultKey: "Mod-u", menuId: "underline" },
  { id: "link", label: "Link", category: "formatting", defaultKey: "Mod-k", menuId: "link" },
  { id: "unlink", label: "Remove Link", category: "formatting", defaultKey: "Alt-Shift-k", description: "Remove link from selection, keeping text" },
  { id: "wikiLink", label: "Wiki Link", category: "formatting", defaultKey: "Alt-Mod-k", menuId: "wiki-link", description: "Insert wiki-style link [[...]]" },
  { id: "bookmarkLink", label: "Bookmark Link", category: "formatting", defaultKey: "Alt-Mod-b", menuId: "bookmark", description: "Insert link to heading in document" },
  { id: "highlight", label: "Highlight", category: "formatting", defaultKey: "Mod-Shift-m", menuId: "highlight" },
  { id: "inlineMath", label: "Inline Math", category: "formatting", defaultKey: "Alt-Mod-m", description: "Insert or edit inline math ($...$)" },
  { id: "subscript", label: "Subscript", category: "formatting", defaultKey: "Alt-Mod-=", menuId: "subscript" },
  { id: "superscript", label: "Superscript", category: "formatting", defaultKey: "Alt-Mod-Shift-=", menuId: "superscript" },
  { id: "clearFormat", label: "Clear Formatting", category: "formatting", defaultKey: "Mod-\\", menuId: "clear-format" },

  // === Blocks ===
  { id: "mathBlock", label: "Math Block", category: "blocks", defaultKey: "Alt-Mod-Shift-m", menuId: "math-block", description: "Insert display math block ($$...$$)" },
  { id: "diagram", label: "Insert Diagram", category: "blocks", defaultKey: "Alt-Mod-Shift-d", menuId: "diagram", description: "Insert Mermaid diagram" },
  { id: "mindmap", label: "Insert Mindmap", category: "blocks", defaultKey: "Alt-Mod-Shift-k", menuId: "mindmap", description: "Insert Markmap mindmap" },
  { id: "heading1", label: "Heading 1", category: "blocks", defaultKey: "Mod-1", menuId: "heading-1" },
  { id: "heading2", label: "Heading 2", category: "blocks", defaultKey: "Mod-2", menuId: "heading-2" },
  { id: "heading3", label: "Heading 3", category: "blocks", defaultKey: "Mod-3", menuId: "heading-3" },
  { id: "heading4", label: "Heading 4", category: "blocks", defaultKey: "Mod-4", menuId: "heading-4" },
  { id: "heading5", label: "Heading 5", category: "blocks", defaultKey: "Mod-5", menuId: "heading-5" },
  { id: "heading6", label: "Heading 6", category: "blocks", defaultKey: "Mod-6", menuId: "heading-6" },
  { id: "paragraph", label: "Paragraph", category: "blocks", defaultKey: "Mod-Shift-0", menuId: "paragraph" },
  { id: "increaseHeading", label: "Increase Heading", category: "blocks", defaultKey: "Mod-Alt-]", menuId: "increase-heading" },
  { id: "decreaseHeading", label: "Decrease Heading", category: "blocks", defaultKey: "Mod-Alt-[", menuId: "decrease-heading" },
  { id: "blockquote", label: "Blockquote", category: "blocks", defaultKey: "Alt-Mod-q", menuId: "quote" },
  { id: "codeBlock", label: "Code Block", category: "blocks", defaultKey: "Alt-Mod-c", menuId: "code-fences" },
  { id: "bulletList", label: "Bullet List", category: "blocks", defaultKey: "Alt-Mod-u", menuId: "unordered-list" },
  { id: "orderedList", label: "Ordered List", category: "blocks", defaultKey: "Alt-Mod-o", menuId: "ordered-list" },
  { id: "taskList", label: "Task List", category: "blocks", defaultKey: "Alt-Mod-x", menuId: "task-list" },
  { id: "insertTable", label: "Insert Table", category: "blocks", defaultKey: "Mod-Shift-t", menuId: "insert-table" },
  { id: "horizontalLine", label: "Horizontal Line", category: "blocks", defaultKey: "Alt-Mod--", menuId: "horizontal-line" },
  { id: "insertImage", label: "Insert Image", category: "blocks", defaultKey: "Shift-Mod-i", menuId: "image" },
  { id: "insertVideo", label: "Insert Video", category: "blocks", defaultKey: "", menuId: "video" },
  { id: "insertAudio", label: "Insert Audio", category: "blocks", defaultKey: "", menuId: "audio" },
  { id: "indent", label: "Indent", category: "blocks", defaultKey: "Mod-]", menuId: "indent" },
  { id: "outdent", label: "Outdent", category: "blocks", defaultKey: "Mod-[", menuId: "outdent" },

  // === Navigation ===
  { id: "selectLine", label: "Select Line", category: "navigation", defaultKey: "Mod-l", menuId: "select-line" },
  { id: "expandSelection", label: "Expand Selection", category: "navigation", defaultKey: "Ctrl-Shift-Up", menuId: "expand-selection" },
  { id: "skipOccurrence", label: "Skip Occurrence", category: "navigation", defaultKey: "Mod-Shift-d", description: "Skip current match and select next" },
  { id: "softUndoCursor", label: "Soft Undo Cursor", category: "navigation", defaultKey: "Alt-Mod-z", description: "Undo last cursor addition" },
  { id: "addCursorAbove", label: "Add Cursor Above", category: "navigation", defaultKey: "Mod-Alt-Up", description: "Add cursor one line above" },
  { id: "addCursorBelow", label: "Add Cursor Below", category: "navigation", defaultKey: "Mod-Alt-Down", description: "Add cursor one line below" },
  { id: "formatToolbar", label: "Universal Toolbar", category: "navigation", defaultKey: "Mod-Shift-p", description: "Show the universal bottom toolbar" },
  { id: "sourcePeek", label: "Source Peek", category: "navigation", defaultKey: "F5", description: "Edit selection as markdown" },
  { id: "findReplace", label: "Find & Replace", category: "navigation", defaultKey: "Mod-f", menuId: "find-replace" },
  { id: "findNext", label: "Find Next", category: "navigation", defaultKey: "Mod-g", menuId: "find-next" },
  { id: "findPrevious", label: "Find Previous", category: "navigation", defaultKey: "Mod-Shift-g", menuId: "find-prev" },
  { id: "useSelectionFind", label: "Use Selection for Find", category: "navigation", defaultKey: "Mod-e", menuId: "use-selection-find" },
  { id: "contentSearch", label: "Find in Files", category: "navigation", defaultKey: "Mod-Shift-h", menuId: "find-in-files", description: "Search workspace file contents" },

  // === Editing ===
  { id: "formatCJKSelection", label: "Format CJK Selection", category: "editing", defaultKey: "Mod-Shift-f", menuId: "format-cjk" },
  { id: "formatCJKFile", label: "Format CJK File", category: "editing", defaultKey: "Alt-Mod-Shift-f", menuId: "format-cjk-file" },
  { id: "copyAsHTML", label: "Copy as HTML", category: "editing", defaultKey: "Mod-Shift-c", menuId: "copy-html" },
  { id: "pastePlainText", label: "Paste as Plain Text", category: "editing", defaultKey: "Mod-Shift-v", description: "Paste without formatting in WYSIWYG" },
  { id: "toggleComment", label: "Toggle Comment", category: "editing", defaultKey: "Mod-/", description: "Insert HTML comment <!-- -->" },
  { id: "toggleQuoteStyle", label: "Toggle Quote Style", category: "editing", defaultKey: "Shift-Mod-'", menuId: "toggle-quote-style", description: "Toggle quote style at cursor (straight/curly/corner/guillemets)" },
  { id: "aiPrompts", label: "AI Genies", category: "editing", defaultKey: "Mod-y", menuId: "search-genies", scope: "global", description: "Open AI genie picker" },

  // === Line Operations ===
  { id: "moveLineUp", label: "Move Line Up", category: "editing", defaultKey: "Alt-Up", menuId: "move-line-up" },
  { id: "moveLineDown", label: "Move Line Down", category: "editing", defaultKey: "Alt-Down", menuId: "move-line-down" },
  { id: "duplicateLine", label: "Duplicate Line", category: "editing", defaultKey: "Shift-Alt-Down", menuId: "duplicate-line" },
  { id: "deleteLine", label: "Delete Line", category: "editing", defaultKey: "Mod-Shift-k", menuId: "delete-line" },
  { id: "joinLines", label: "Join Lines", category: "editing", defaultKey: "Mod-j", menuId: "join-lines" },
  { id: "sortLinesAsc", label: "Sort Lines Ascending", category: "editing", defaultKey: "F4", menuId: "sort-lines-asc" },
  { id: "sortLinesDesc", label: "Sort Lines Descending", category: "editing", defaultKey: "Shift-F4", menuId: "sort-lines-desc" },

  // === Text Transformations ===
  { id: "transformUppercase", label: "Transform to UPPERCASE", category: "editing", defaultKey: "Ctrl-Shift-u", defaultKeyOther: "Alt-Shift-u", menuId: "transform-uppercase" },
  { id: "transformLowercase", label: "Transform to lowercase", category: "editing", defaultKey: "Ctrl-Shift-l", defaultKeyOther: "Alt-Shift-l", menuId: "transform-lowercase" },
  { id: "transformTitleCase", label: "Transform to Title Case", category: "editing", defaultKey: "Ctrl-Shift-t", defaultKeyOther: "Alt-Shift-t", menuId: "transform-title-case" },
  { id: "transformToggleCase", label: "Toggle Case", category: "editing", defaultKey: "", menuId: "transform-toggle-case", description: "Toggle between UPPERCASE and lowercase" },
  { id: "removeBlankLines", label: "Remove Blank Lines", category: "editing", defaultKey: "", menuId: "remove-blank-lines", description: "Remove blank lines from selection" },

  // === View ===
  { id: "toggleOutline", label: "Toggle Outline", category: "view", defaultKey: "Ctrl-Shift-1", menuId: "outline", scope: "global" },
  { id: "fileExplorer", label: "Toggle File Explorer", category: "view", defaultKey: "Ctrl-Shift-2", menuId: "file-explorer", scope: "global" },
  { id: "viewHistory", label: "Toggle History", category: "view", defaultKey: "Ctrl-Shift-3", menuId: "view-history", scope: "global" },
  { id: "sourceMode", label: "Source Mode", category: "view", defaultKey: "F6", menuId: "source-mode" },
  { id: "toggleStatusBar", label: "Toggle Status Bar", category: "view", defaultKey: "F7", description: "Show/hide the status bar", scope: "global" },
  { id: "focusMode", label: "Focus Mode", category: "view", defaultKey: "F8", menuId: "focus-mode", scope: "global" },
  { id: "typewriterMode", label: "Typewriter Mode", category: "view", defaultKey: "F9", menuId: "typewriter-mode", scope: "global" },
  { id: "wordWrap", label: "Toggle Word Wrap", category: "view", defaultKey: "Alt-z", menuId: "word-wrap" },
  { id: "lineNumbers", label: "Toggle Line Numbers", category: "view", defaultKey: "Alt-Mod-l", menuId: "line-numbers", description: "Show/hide line numbers in code blocks" },
  { id: "toggleTerminal", label: "Toggle Terminal", category: "view", defaultKey: "Ctrl-`", menuId: "toggle-terminal", scope: "global" },
  { id: "diagramPreview", label: "Toggle Diagram Preview", category: "view", defaultKey: "Alt-Mod-p", menuId: "diagram-preview", description: "Show/hide diagram preview" },
  { id: "fitTables", label: "Fit Tables to Width", category: "view", defaultKey: "", menuId: "fit-tables", description: "Force tables to fit editor width with word wrapping" },
  { id: "readOnly", label: "Toggle Read-Only Mode", category: "view", defaultKey: "F10", menuId: "read-only", description: "Lock/unlock document from editing" },
  { id: "validateMarkdown", label: "Check Markdown", category: "view", defaultKey: "Alt-Mod-v", menuId: "check-markdown", description: "Run markdown lint and show diagnostics" },
  { id: "lintNext", label: "Next Issue", category: "view", defaultKey: "F2", menuId: "lint-next", description: "Navigate to next lint diagnostic" },
  { id: "lintPrev", label: "Previous Issue", category: "view", defaultKey: "Shift-F2", menuId: "lint-prev", description: "Navigate to previous lint diagnostic" },
  { id: "toggleHiddenFiles", label: "Toggle Hidden Files", category: "view", defaultKey: "Mod-Shift-.", defaultKeyOther: "Ctrl-h", description: "Show or hide hidden files in the file explorer" },
  { id: "toggleAllFiles", label: "Toggle All Files", category: "view", defaultKey: "", description: "Show or hide non-markdown files in the file explorer" },
  { id: "zoomActual", label: "Actual Size", category: "view", defaultKey: "Mod-0", menuId: "zoom-actual", scope: "global", description: "Reset font size to default" },
  { id: "zoomIn", label: "Zoom In", category: "view", defaultKey: "Mod-=", menuId: "zoom-in", scope: "global", description: "Increase font size" },
  { id: "zoomOut", label: "Zoom Out", category: "view", defaultKey: "Mod--", menuId: "zoom-out", scope: "global", description: "Decrease font size" },

  // === File ===
  { id: "newTab", label: "New Tab", category: "file", defaultKey: "Mod-t", description: "Create a new tab", scope: "global" },
  { id: "newFile", label: "New File", category: "file", defaultKey: "Mod-n", menuId: "new", scope: "global" },
  { id: "newWindow", label: "New Window", category: "file", defaultKey: "Mod-Shift-n", menuId: "new-window", scope: "global" },
  { id: "quickOpen", label: "Quick Open", category: "file", defaultKey: "Mod-o", menuId: "quick-open", scope: "global" },
  { id: "commandPalette", label: "Command Palette", category: "file", defaultKey: "Mod-Shift-p", scope: "global" },
  { id: "openFile", label: "Open File...", category: "file", defaultKey: "", menuId: "open", scope: "global" },
  { id: "openFolder", label: "Open Workspace", category: "file", defaultKey: "Mod-Shift-o", menuId: "open-folder", scope: "global" },
  { id: "save", label: "Save", category: "file", defaultKey: "Mod-s", menuId: "save", scope: "global" },
  { id: "saveAs", label: "Save As", category: "file", defaultKey: "Mod-Shift-s", menuId: "save-as", scope: "global" },
  { id: "moveTo", label: "Move to", category: "file", defaultKey: "", menuId: "move-to", scope: "global" },
  { id: "closeFile", label: "Close", category: "file", defaultKey: "Mod-w", menuId: "close", scope: "global" },
  { id: "exportHTML", label: "Export HTML", category: "file", defaultKey: "", menuId: "export-html", scope: "global" },
  { id: "print", label: "Print", category: "file", defaultKey: "Mod-p", menuId: "export-pdf", scope: "global" },
  { id: "exportPdf", label: "Export PDF", category: "file", defaultKey: "", menuId: "export-pdf-native", scope: "global" },
  { id: "preferences", label: "Settings", category: "file", defaultKey: "Mod-,", menuId: "preferences", scope: "global" },
  { id: "saveAllQuit", label: "Save All and Quit", category: "file", defaultKey: "Alt-Mod-Shift-q", menuId: "save-all-quit", scope: "global" },

  // === Future: Cycling (Phase 4) ===
  { id: "cycleEmphasis", label: "Cycle Emphasis", category: "formatting", defaultKey: "Mod-Alt-e", description: "Cycle: none → italic → bold → bold+italic" },
  { id: "cycleList", label: "Cycle List Type", category: "blocks", defaultKey: "", description: "Cycle: paragraph → bullet → ordered → task" },
  { id: "cycleHeading", label: "Cycle Heading", category: "blocks", defaultKey: "Mod-Alt-h", description: "Cycle: P → H1 → H2 → ... → H6" },

  // === Future: Table (Phase 2) ===
  { id: "tableColumnLeft", label: "Add Column Left", category: "blocks", defaultKey: "Alt-Mod-Left" },
  { id: "tableColumnRight", label: "Add Column Right", category: "blocks", defaultKey: "Alt-Mod-Right" },
  { id: "tableDeleteColumn", label: "Delete Column", category: "blocks", defaultKey: "Alt-Mod-Backspace" },
  { id: "tableAlignLeft", label: "Align Left", category: "blocks", defaultKey: "Mod-Alt-Shift-l" },
  { id: "tableAlignCenter", label: "Align Center", category: "blocks", defaultKey: "" },
  { id: "tableAlignRight", label: "Align Right", category: "blocks", defaultKey: "Mod-Shift-r" },
  { id: "formatTable", label: "Format Table", category: "blocks", defaultKey: "Alt-Mod-t", menuId: "format-table", description: "Align table columns with proper spacing" },

  // === Future: Alerts (Phase 3) ===
  { id: "insertNote", label: "Insert Note", category: "blocks", defaultKey: "Alt-Mod-n", menuId: "info-note" },
  { id: "insertTip", label: "Insert Tip", category: "blocks", defaultKey: "Mod-Alt-Shift-t", menuId: "info-tip" },
  { id: "insertWarning", label: "Insert Warning", category: "blocks", defaultKey: "Mod-Shift-w", menuId: "info-warning" },
  { id: "insertImportant", label: "Insert Important", category: "blocks", defaultKey: "Mod-Alt-Shift-i", menuId: "info-important" },
  { id: "insertCaution", label: "Insert Caution", category: "blocks", defaultKey: "Mod-Shift-u", menuId: "info-caution" },
  { id: "insertCollapsible", label: "Insert Collapsible", category: "blocks", defaultKey: "Alt-Mod-d", menuId: "collapsible-block" },
];

// Build lookup map for quick access
const shortcutMap = new Map(DEFAULT_SHORTCUTS.map(s => [s.id, s]));

function resolveDefaultKey(def: ShortcutDefinition): string {
  const isMac = isMacPlatform();
  /* v8 ignore start -- no DEFAULT_SHORTCUTS currently define defaultKeyMac; branch reserved for future use */
  if (isMac && def.defaultKeyMac) return def.defaultKeyMac;
  if (!isMac && def.defaultKeyOther) return def.defaultKeyOther;
  /* v8 ignore stop */
  return def.defaultKey;
}

// ============================================================================
// Store
// ============================================================================

interface ShortcutsState {
  customBindings: Record<string, string>;
  /** Version for tracking config format changes */
  version: number;
}

interface ShortcutsActions {
  /** Get effective shortcut (custom or default) */
  getShortcut: (id: string) => string;
  /** Get all effective shortcuts as a map */
  getAllShortcuts: () => Record<string, string>;
  /** Set custom shortcut */
  setShortcut: (id: string, key: string) => void;
  /** Reset single shortcut to default */
  resetShortcut: (id: string) => void;
  /** Reset all shortcuts to defaults */
  resetAllShortcuts: () => void;
  /** Check if key conflicts with any other shortcut */
  getConflict: (key: string, excludeId?: string) => ShortcutDefinition | null;
  /** Export config as JSON string */
  exportConfig: () => string;
  /** Import config from JSON string */
  importConfig: (json: string) => { success: boolean; errors?: string[] };
  /** Check if shortcut has been customized */
  isCustomized: (id: string) => boolean;
  /** Get shortcut definition by ID */
  getDefinition: (id: string) => ShortcutDefinition | undefined;
}

const initialShortcutsState: ShortcutsState = {
  customBindings: {},
  version: 1,
};

/** Manages user keyboard shortcut customizations with conflict detection and native menu sync. Use selectors, not destructuring. */
export const useShortcutsStore = create<ShortcutsState & ShortcutsActions>()(
  persist(
    (set, get) => ({
      ...initialShortcutsState,

      getShortcut: (id) => {
        const { customBindings } = get();
        if (customBindings[id]) return customBindings[id];
        const def = shortcutMap.get(id);
        return def ? resolveDefaultKey(def) : "";
      },

      getAllShortcuts: () => {
        const { customBindings } = get();
        const result: Record<string, string> = {};
        for (const def of DEFAULT_SHORTCUTS) {
          result[def.id] = customBindings[def.id] ?? resolveDefaultKey(def);
        }
        return result;
      },

      setShortcut: (id, key) => {
        set((state) => ({
          customBindings: { ...state.customBindings, [id]: key },
        }));
        // Sync with Tauri menu
        syncMenuShortcuts(get().getAllShortcuts());
      },

      resetShortcut: (id) => {
        set((state) => {
          const { [id]: _, ...rest } = state.customBindings;
          return { customBindings: rest };
        });
        syncMenuShortcuts(get().getAllShortcuts());
      },

      resetAllShortcuts: () => {
        set({ customBindings: {} });
        syncMenuShortcuts(get().getAllShortcuts());
      },

      getConflict: (key, excludeId) => {
        const { customBindings } = get();
        const normalizedKey = normalizeKey(key);

        for (const def of DEFAULT_SHORTCUTS) {
          if (def.id === excludeId) continue;
          const effectiveKey = customBindings[def.id] ?? resolveDefaultKey(def);
          if (normalizeKey(effectiveKey) === normalizedKey) {
            return def;
          }
        }
        return null;
      },

      exportConfig: () => {
        const { customBindings, version } = get();
        return JSON.stringify({ version, customBindings }, null, 2);
      },

      importConfig: (json) => {
        try {
          const data = JSON.parse(json);
          if (typeof data !== "object" || !data.customBindings) {
            return { success: false, errors: ["Invalid config format"] };
          }

          const errors: string[] = [];
          const validBindings: Record<string, string> = {};

          for (const [id, key] of Object.entries(data.customBindings)) {
            if (typeof key !== "string") {
              errors.push(`Invalid key for ${id}`);
              continue;
            }
            if (!shortcutMap.has(id)) {
              errors.push(`Unknown shortcut: ${id}`);
              continue;
            }
            validBindings[id] = key;
          }

          set({ customBindings: validBindings });
          syncMenuShortcuts(get().getAllShortcuts());

          return { success: errors.length === 0, errors: errors.length > 0 ? errors : undefined };
        } catch (e) {
          /* v8 ignore start -- JSON.parse always throws Error instances; String(e) fallback is defensive */
          return { success: false, errors: [`Parse error: ${e instanceof Error ? e.message : String(e)}`] };
          /* v8 ignore stop */
        }
      },

      isCustomized: (id) => {
        return id in get().customBindings;
      },

      getDefinition: (id) => shortcutMap.get(id),
    }),
    {
      name: "vmark-shortcuts",
      storage: createJSONStorage(() => createSafeStorage()),
    }
  )
);

// ============================================================================
// Helpers
// ============================================================================

/**
 * Normalize key string for comparison (case-insensitive, sorted modifiers).
 */
function normalizeKey(key: string): string {
  const parts = key.toLowerCase().split("-");
  const modifiers = parts.slice(0, -1).sort();
  const mainKey = parts[parts.length - 1];
  return [...modifiers, mainKey].join("-");
}

/** Trailing-debounce window for shortcut edits. Batches rapid changes
 *  (e.g. Reset All, Import) into one native menu update. */
const SYNC_DEBOUNCE_MS = 100;

let syncTimer: ReturnType<typeof setTimeout> | null = null;
let pendingShortcuts: Record<string, string> | null = null;
// In-flight invoke chain. New sends chain after the previous promise so older
// snapshots can't overtake newer ones if Tauri completes invokes out of order.
let inFlightSync: Promise<void> = Promise.resolve();

/**
 * Schedule a trailing-debounced sync to the native menu. Successive calls
 * replace the pending payload so the final state always wins.
 */
function syncMenuShortcuts(shortcuts: Record<string, string>) {
  pendingShortcuts = shortcuts;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    const next = pendingShortcuts;
    pendingShortcuts = null;
    if (next) queueSyncMenuShortcuts(next);
  }, SYNC_DEBOUNCE_MS);
}

/**
 * Flush any pending debounced sync immediately. Exported for tests.
 * Resolves once the native-menu invoke for the pending payload (if any) has
 * completed, so assertions see the final state.
 * @internal
 */
export function flushMenuShortcutsSync(): Promise<void> {
  if (syncTimer) {
    clearTimeout(syncTimer);
    syncTimer = null;
    const next = pendingShortcuts;
    pendingShortcuts = null;
    if (next) queueSyncMenuShortcuts(next);
  }
  return inFlightSync;
}

/**
 * Append a sync to the in-flight chain so invokes complete in FIFO order.
 * Without this, two debounced flushes whose Tauri invokes race could apply
 * snapshots out of order — the older snapshot would overwrite the newer on
 * the Rust side, silently reverting the user's most recent edit.
 */
function queueSyncMenuShortcuts(shortcuts: Record<string, string>) {
  inFlightSync = inFlightSync
    .catch(() => {})
    .then(() => syncMenuShortcutsNow(shortcuts));
}

/**
 * Invoke the differential menu-accelerator update with the current shortcut
 * set. This uses `update_menu_accelerators` (Rust diff) rather than
 * `rebuild_menu`, which avoids reconstructing the menu tree — the cost that
 * froze the Settings window on Windows (Issue #825).
 *
 * Genies, recent files, and recent workspaces are untouched by this path
 * because the menu tree is preserved, so no resync of those is required.
 */
async function syncMenuShortcutsNow(shortcuts: Record<string, string>) {
  try {
    const menuShortcuts: Record<string, string> = {};
    for (const def of DEFAULT_SHORTCUTS) {
      if (def.menuId) {
        /* v8 ignore start -- shortcuts from getAllShortcuts() always has all keys; ?? fallback is defensive */
        const key = shortcuts[def.id] ?? resolveDefaultKey(def);
        /* v8 ignore stop */
        menuShortcuts[def.menuId] = prosemirrorToTauri(key);
      }
    }
    await invoke("update_menu_accelerators", { shortcuts: menuShortcuts });
  } catch (e) {
    /* v8 ignore start -- @preserve invoke failure only occurs if Tauri command is unavailable; mocked in tests */
    shortcutsWarn("Failed to sync menu shortcuts:", e);
    /* v8 ignore stop */
  }
}

/**
 * Convert ProseMirror key format to Tauri accelerator format.
 * Mod-b -> CmdOrCtrl+B
 * Mod-Shift-` -> CmdOrCtrl+Shift+`
 */
/** @internal Exported for testing */
export function prosemirrorToTauri(key: string): string {
  if (!key) return "";

  // ProseMirror uses "-" as delimiter: "Mod-Shift-b", "Mod--" (minus key).
  // Split carefully: a trailing "--" means the key itself is "-".
  const modifierNames = new Set(["Mod", "Ctrl", "Alt", "Shift"]);
  const modifierMap: Record<string, string> = { Mod: "CmdOrCtrl" };

  const parts = key.split("-");
  const result: string[] = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];

    if (part === "" && i === parts.length - 1) {
      // Trailing empty from "Mod--" split → the key is "-"
      result.push("-");
    } else if (part === "") {
      // Skip intermediate empties
      continue;
    } else if (modifierNames.has(part) && i < parts.length - 1) {
      result.push(modifierMap[part] ?? part);
    } else {
      // Final key — uppercase single alpha chars
      const mapped = modifierMap[part] ?? part;
      if (mapped.length === 1 && /[a-z]/i.test(mapped)) {
        result.push(mapped.toUpperCase());
      } else {
        result.push(mapped);
      }
    }
  }

  return result.join("+");
}

/**
 * Format key for display (user-friendly).
 * Mod-b -> ⌘B (on macOS)
 */
export function formatKeyForDisplay(key: string): string {
  const isMac = isMacPlatform();

  return key
    .replace(/Mod/gi, isMac ? "⌘" : "Ctrl")
    .replace(/Ctrl/gi, isMac ? "⌃" : "Ctrl")
    .replace(/Alt/gi, isMac ? "⌥" : "Alt")
    .replace(/Shift/gi, isMac ? "⇧" : "Shift")
    .replace(/-/g, "")
    .toUpperCase()
    .replace(/BACKSPACE/i, "⌫")
    .replace(/LEFT/i, "←")
    .replace(/RIGHT/i, "→")
    .replace(/UP/i, "↑")
    .replace(/DOWN/i, "↓");
}

// ============================================================================
// Category Helpers
// ============================================================================

/**
 * Human-readable labels for each shortcut category.
 * These are English fallback strings — the UI should prefer getCategoryLabel().
 */
export const CATEGORY_LABELS: Record<ShortcutCategory, string> = {
  formatting: "Formatting",
  blocks: "Blocks",
  navigation: "Navigation",
  editing: "Editing",
  view: "View",
  file: "File",
};

/** Display order for shortcut categories in the settings UI. */
export const CATEGORY_ORDER: ShortcutCategory[] = [
  "formatting",
  "blocks",
  "navigation",
  "editing",
  "view",
  "file",
];

/**
 * Returns the translated label for a shortcut category.
 * Falls back to CATEGORY_LABELS[category] if the translation key is missing.
 */
export function getCategoryLabel(category: ShortcutCategory): string {
  const translated = i18n.t(`settings:shortcuts.category.${category}`);
  // i18next returns the key itself if missing — detect and fall back
  if (translated === `settings:shortcuts.category.${category}` || translated === `shortcuts.category.${category}`) {
    return CATEGORY_LABELS[category];
  }
  return translated;
}

/**
 * Returns the translated label for a shortcut by its ID.
 * Falls back to the shortcut's `label` field if the translation key is missing.
 */
export function getShortcutLabel(shortcut: ShortcutDefinition): string {
  const key = `settings:shortcuts.label.${shortcut.id}`;
  const translated = i18n.t(key);
  // i18next returns the key itself if missing — detect and fall back
  if (translated === key || translated === `shortcuts.label.${shortcut.id}`) {
    return shortcut.label;
  }
  return translated;
}
