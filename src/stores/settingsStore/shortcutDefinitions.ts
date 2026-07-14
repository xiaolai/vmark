/**
 * Shortcut definitions — the default shortcut registry and category
 * metadata, extracted from `shortcuts.ts` (pure data, no store logic).
 *
 * DEFAULT_SHORTCUTS is the source of truth — every binding must keep it
 * in sync with `src-tauri/src/menu/localized.rs` (Tauri accelerators)
 * and `website/guide/shortcuts.md` (docs) per
 * `.claude/rules/41-keyboard-shortcuts.md`.
 *
 * @module stores/settingsStore/shortcutDefinitions
 */

/** Shortcut category for grouping in the settings UI. */
export type ShortcutCategory =
  | "formatting"  // Bold, Italic, Code, etc.
  | "blocks"      // Headings, Lists, Quote, Table
  | "navigation"  // Select, Move, Jump
  | "editing"     // Clear format, Undo, Redo
  | "view"        // Sidebar, Outline, Focus mode
  | "file";       // New, Open, Save, etc.

/** Shortcut scope: "global" = active everywhere; "editor" (default) = only while the editor is focused. */
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
  { id: "graphvizDiagram", label: "Insert Graphviz Diagram", category: "blocks", defaultKey: "", menuId: "graphviz-diagram", description: "Insert Graphviz DOT diagram" },
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
  { id: "formatToolbar", label: "Universal Toolbar", category: "navigation", defaultKey: "Mod-Shift-b", description: "Show the universal bottom toolbar" },
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
  // toggleSidebar: no menuId (a Rust accel would clash with `paragraph` Mod-Shift-0 on Win/Linux); handled in useViewShortcuts only, never the TipTap keymap, to avoid double-toggle.
  { id: "toggleSidebar", label: "Toggle Sidebar", category: "view", defaultKey: "Ctrl-Shift-0", scope: "global" },
  { id: "toggleOutline", label: "Toggle Outline", category: "view", defaultKey: "Ctrl-Shift-1", menuId: "outline", scope: "global" },
  { id: "fileExplorer", label: "Toggle File Explorer", category: "view", defaultKey: "Ctrl-Shift-2", menuId: "file-explorer", scope: "global" },
  { id: "viewHistory", label: "Toggle History", category: "view", defaultKey: "Ctrl-Shift-3", menuId: "view-history", scope: "global" },
  { id: "knowledgeBase", label: "Toggle Knowledge Base", category: "view", defaultKey: "Ctrl-Shift-4", menuId: "knowledge-base", scope: "global", description: "Open the local knowledge-base inspector panel" },
  { id: "sourceMode", label: "Source Mode", category: "view", defaultKey: "F6", menuId: "source-mode", description: "Show source (markdown WYSIWYG⇄Source; split-pane formats Source⇄Split)" },
  { id: "markdownSplit", label: "Split View", category: "view", defaultKey: "Shift-F6", menuId: "markdown-split", scope: "global", description: "Toggle split view (markdown split; split-pane formats Preview⇄Split)" },
  { id: "splitDocuments", label: "Split Editor — Two Documents", category: "view", defaultKey: "Alt-Mod-\\", scope: "global", description: "Open two different documents side by side (#1081)" },
  { id: "toggleStatusBar", label: "Toggle Status Bar", category: "view", defaultKey: "F7", description: "Show/hide the status bar", scope: "global" },
  { id: "focusMode", label: "Focus Mode", category: "view", defaultKey: "F8", menuId: "focus-mode", scope: "global" },
  { id: "typewriterMode", label: "Typewriter Mode", category: "view", defaultKey: "F9", menuId: "typewriter-mode", scope: "global" },
  { id: "wordWrap", label: "Toggle Word Wrap", category: "view", defaultKey: "Alt-z", menuId: "word-wrap" },
  { id: "lineNumbers", label: "Toggle Line Numbers", category: "view", defaultKey: "Alt-Mod-l", menuId: "line-numbers", description: "Show/hide line numbers in code blocks" },
  { id: "toggleTerminal", label: "Toggle Terminal", category: "view", defaultKey: "Ctrl-`", menuId: "toggle-terminal", scope: "global" },
  { id: "diagramPreview", label: "Toggle Diagram Preview", category: "view", defaultKey: "Alt-Mod-p", menuId: "diagram-preview", description: "Show/hide diagram preview" },
  { id: "fitTables", label: "Fit Tables to Width", category: "view", defaultKey: "", menuId: "fit-tables", description: "Force tables to fit editor width with word wrapping" },
  { id: "readOnly", label: "Toggle Read-Only Mode", category: "view", defaultKey: "F10", menuId: "read-only", description: "Lock/unlock document from editing" },
  { id: "showInvisibles", label: "Toggle Invisibles", category: "view", defaultKey: "F3", menuId: "show-invisibles", description: "Show or hide whitespace glyphs (·, →, ↓, ⏎)" },
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
  // Frontend-only (no menuId): dispatched via CommandBus, gated by the
  // `browser.enabled` setting. Off by default; the chord is otherwise unbound.
  { id: "newBrowserTab", label: "New Browser Tab", category: "file", defaultKey: "Alt-Mod-Shift-b", scope: "global", description: "Open a new embedded browser tab (requires the browser feature enabled)" },
  { id: "nextTab", label: "Next Tab", category: "view", defaultKey: "Mod-Shift-]", description: "Switch to the next tab", scope: "global" },
  { id: "prevTab", label: "Previous Tab", category: "view", defaultKey: "Mod-Shift-[", description: "Switch to the previous tab", scope: "global" },
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

  // === Table ===
  // Note: the once-planned cycleEmphasis/cycleList/cycleHeading and
  // tableColumn*/tableAlign* entries were removed (audit 2026-07): they had
  // no consumer anywhere (no getShortcut() call, no menuId, no keymap), yet
  // their default bindings reserved keys and surfaced non-functional rows in
  // the Shortcuts settings UI. Re-add an entry only together with its
  // consumer. formatTable stays — it is live via menu:format-table
  // (src/plugins/actions/menuMapping.ts).
  { id: "formatTable", label: "Format Table", category: "blocks", defaultKey: "Alt-Mod-t", menuId: "format-table", description: "Align table columns with proper spacing" },

  // === Future: Alerts (Phase 3) ===
  { id: "insertNote", label: "Insert Note", category: "blocks", defaultKey: "Alt-Mod-n", menuId: "info-note" },
  { id: "insertTip", label: "Insert Tip", category: "blocks", defaultKey: "Mod-Alt-Shift-t", menuId: "info-tip" },
  { id: "insertWarning", label: "Insert Warning", category: "blocks", defaultKey: "Mod-Shift-w", menuId: "info-warning" },
  { id: "insertImportant", label: "Insert Important", category: "blocks", defaultKey: "Mod-Alt-Shift-i", menuId: "info-important" },
  { id: "insertCaution", label: "Insert Caution", category: "blocks", defaultKey: "Mod-Shift-u", menuId: "info-caution" },
  { id: "insertCollapsible", label: "Insert Collapsible", category: "blocks", defaultKey: "Alt-Mod-d", menuId: "collapsible-block" },
];

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
