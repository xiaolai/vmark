/**
 * Keybinding manifest — the single source of truth for the cross-source-synced
 * subset of keyboard shortcuts (WI-1.5).
 *
 * Three files must historically stay in lockstep for every shortcut that has a
 * native menu accelerator (see `.claude/rules/41-keyboard-shortcuts.md`):
 *   1. Frontend defaults — `src/stores/settingsStore/shortcutDefinitions.ts`
 *   2. Rust menu accelerators — the REAL menu builder
 *      `src-tauri/src/menu/localized/*.rs` (`accel("<menu-id>", "<accel>")` call
 *      sites), contract-pinned in `src-tauri/src/menu/localized.test.rs`
 *      (`DEFAULT_ACCELERATORS` / `PLATFORM_ACCELERATORS`)
 *   3. Docs table — `website/guide/shortcuts.md`
 *
 * This manifest names that synced subset in one place. Every entry is derived
 * from a `DEFAULT_SHORTCUTS` entry that carries a `menuId` (i.e. it maps to a
 * native menu item). The drift gate `scripts/check-keybinding-manifest.mjs`
 * (wired into `pnpm check:all` as `lint:keybinding-manifest`) enforces, for each
 * entry, that:
 *   - `defaultKey` / `defaultKeyOther` match the `shortcutDefinitions.ts` entry,
 *   - the entry's `menuId` accelerator in BOTH the Rust contract mirror AND the
 *     real `localized/*.rs` `accel(...)` call site equals `prosemirrorToTauri(defaultKey)`
 *     (and `prosemirrorToTauri(defaultKeyOther)` for platform-conditional entries), and
 *   - the accelerator is documented in `website/guide/shortcuts.md`.
 * The gate fails on any divergence, so this file cannot silently drift from the
 * other three sources.
 *
 * Excluded on purpose: `aiPrompts` (`menuId: "search-genies"`). Its menu
 * accelerator is registered dynamically at runtime (`useGenieShortcuts`), so it
 * has no static entry in the Rust `DEFAULT_ACCELERATORS` contract table and is
 * outside this static drift gate.
 *
 * This file is behaviour-neutral: it is data derived from the current values,
 * consumed only by the drift check and its test. Editing it does not change any
 * runtime keybinding.
 *
 * @module services/keybinding/keybindingManifest
 */

/** A single cross-source-synced keybinding entry. */
export interface KeybindingManifestEntry {
  /** Shortcut id, matches `ShortcutDefinition.id` in `shortcutDefinitions.ts`. */
  id: string;
  /**
   * Default binding in ProseMirror format (`Mod-Shift-n`). For
   * platform-conditional shortcuts this is the macOS default; `defaultKeyOther`
   * holds the Windows/Linux default. Empty string = deliberately unbound.
   */
  defaultKey: string;
  /** Optional explicit macOS default (unused today; reserved for parity). */
  defaultKeyMac?: string;
  /** Optional Windows/Linux default for platform-conditional shortcuts. */
  defaultKeyOther?: string;
  /** Native menu item id in Rust (the sync key across all three sources). */
  menuId: string;
}

/**
 * The synced subset of keyboard shortcuts (every `DEFAULT_SHORTCUTS` entry that
 * has a `menuId`, minus the dynamically-bound `search-genies`). Order mirrors
 * `shortcutDefinitions.ts`.
 */
export const KEYBINDING_MANIFEST: readonly KeybindingManifestEntry[] = [
  { id: "bold", defaultKey: "Mod-b", menuId: "bold" },
  { id: "italic", defaultKey: "Mod-i", menuId: "italic" },
  { id: "code", defaultKey: "Mod-Shift-`", menuId: "code" },
  { id: "strikethrough", defaultKey: "Mod-Shift-x", menuId: "strikethrough" },
  { id: "underline", defaultKey: "Mod-u", menuId: "underline" },
  { id: "link", defaultKey: "Mod-k", menuId: "link" },
  { id: "wikiLink", defaultKey: "Alt-Mod-k", menuId: "wiki-link" },
  { id: "bookmarkLink", defaultKey: "Alt-Mod-b", menuId: "bookmark" },
  { id: "highlight", defaultKey: "Mod-Shift-m", menuId: "highlight" },
  { id: "subscript", defaultKey: "Alt-Mod-=", menuId: "subscript" },
  { id: "superscript", defaultKey: "Alt-Mod-Shift-=", menuId: "superscript" },
  { id: "clearFormat", defaultKey: "Mod-\\", menuId: "clear-format" },
  { id: "mathBlock", defaultKey: "Alt-Mod-Shift-m", menuId: "math-block" },
  { id: "diagram", defaultKey: "Alt-Mod-Shift-d", menuId: "diagram" },
  { id: "graphvizDiagram", defaultKey: "", menuId: "graphviz-diagram" },
  { id: "mindmap", defaultKey: "Alt-Mod-Shift-k", menuId: "mindmap" },
  { id: "heading1", defaultKey: "Mod-1", menuId: "heading-1" },
  { id: "heading2", defaultKey: "Mod-2", menuId: "heading-2" },
  { id: "heading3", defaultKey: "Mod-3", menuId: "heading-3" },
  { id: "heading4", defaultKey: "Mod-4", menuId: "heading-4" },
  { id: "heading5", defaultKey: "Mod-5", menuId: "heading-5" },
  { id: "heading6", defaultKey: "Mod-6", menuId: "heading-6" },
  { id: "paragraph", defaultKey: "Mod-Shift-0", menuId: "paragraph" },
  { id: "increaseHeading", defaultKey: "Mod-Alt-]", menuId: "increase-heading" },
  { id: "decreaseHeading", defaultKey: "Mod-Alt-[", menuId: "decrease-heading" },
  { id: "blockquote", defaultKey: "Alt-Mod-q", menuId: "quote" },
  { id: "codeBlock", defaultKey: "Alt-Mod-c", menuId: "code-fences" },
  { id: "bulletList", defaultKey: "Alt-Mod-u", menuId: "unordered-list" },
  { id: "orderedList", defaultKey: "Alt-Mod-o", menuId: "ordered-list" },
  { id: "taskList", defaultKey: "Alt-Mod-x", menuId: "task-list" },
  { id: "insertTable", defaultKey: "Mod-Shift-t", menuId: "insert-table" },
  { id: "horizontalLine", defaultKey: "Alt-Mod--", menuId: "horizontal-line" },
  { id: "insertImage", defaultKey: "Shift-Mod-i", menuId: "image" },
  { id: "insertVideo", defaultKey: "", menuId: "video" },
  { id: "insertAudio", defaultKey: "", menuId: "audio" },
  { id: "indent", defaultKey: "Mod-]", menuId: "indent" },
  { id: "outdent", defaultKey: "Mod-[", menuId: "outdent" },
  { id: "selectLine", defaultKey: "Mod-l", menuId: "select-line" },
  { id: "expandSelection", defaultKey: "Ctrl-Shift-Up", menuId: "expand-selection" },
  { id: "findReplace", defaultKey: "Mod-f", menuId: "find-replace" },
  { id: "findNext", defaultKey: "Mod-g", menuId: "find-next" },
  { id: "findPrevious", defaultKey: "Mod-Shift-g", menuId: "find-prev" },
  { id: "useSelectionFind", defaultKey: "Mod-e", menuId: "use-selection-find" },
  { id: "contentSearch", defaultKey: "Mod-Shift-h", menuId: "find-in-files" },
  { id: "formatCJKSelection", defaultKey: "Mod-Shift-f", menuId: "format-cjk" },
  { id: "formatCJKFile", defaultKey: "Alt-Mod-Shift-f", menuId: "format-cjk-file" },
  { id: "copyAsHTML", defaultKey: "Mod-Shift-c", menuId: "copy-html" },
  { id: "toggleQuoteStyle", defaultKey: "Shift-Mod-'", menuId: "toggle-quote-style" },
  { id: "moveLineUp", defaultKey: "Alt-Up", menuId: "move-line-up" },
  { id: "moveLineDown", defaultKey: "Alt-Down", menuId: "move-line-down" },
  { id: "duplicateLine", defaultKey: "Shift-Alt-Down", menuId: "duplicate-line" },
  { id: "deleteLine", defaultKey: "Mod-Shift-k", menuId: "delete-line" },
  { id: "joinLines", defaultKey: "Mod-j", menuId: "join-lines" },
  { id: "sortLinesAsc", defaultKey: "F4", menuId: "sort-lines-asc" },
  { id: "sortLinesDesc", defaultKey: "Shift-F4", menuId: "sort-lines-desc" },
  { id: "transformUppercase", defaultKey: "Ctrl-Shift-u", defaultKeyOther: "Alt-Shift-u", menuId: "transform-uppercase" },
  { id: "transformLowercase", defaultKey: "Ctrl-Shift-l", defaultKeyOther: "Alt-Shift-l", menuId: "transform-lowercase" },
  { id: "transformTitleCase", defaultKey: "Ctrl-Shift-t", defaultKeyOther: "Alt-Shift-t", menuId: "transform-title-case" },
  { id: "transformToggleCase", defaultKey: "", menuId: "transform-toggle-case" },
  { id: "removeBlankLines", defaultKey: "", menuId: "remove-blank-lines" },
  { id: "toggleOutline", defaultKey: "Ctrl-Shift-1", menuId: "outline" },
  { id: "fileExplorer", defaultKey: "Ctrl-Shift-2", menuId: "file-explorer" },
  { id: "viewHistory", defaultKey: "Ctrl-Shift-3", menuId: "view-history" },
  { id: "knowledgeBase", defaultKey: "Ctrl-Shift-4", menuId: "knowledge-base" },
  { id: "sourceMode", defaultKey: "F6", menuId: "source-mode" },
  { id: "markdownSplit", defaultKey: "Shift-F6", menuId: "markdown-split" },
  { id: "focusMode", defaultKey: "F8", menuId: "focus-mode" },
  { id: "typewriterMode", defaultKey: "F9", menuId: "typewriter-mode" },
  { id: "wordWrap", defaultKey: "Alt-z", menuId: "word-wrap" },
  { id: "lineNumbers", defaultKey: "Alt-Mod-l", menuId: "line-numbers" },
  { id: "toggleTerminal", defaultKey: "Ctrl-`", menuId: "toggle-terminal" },
  { id: "diagramPreview", defaultKey: "Alt-Mod-p", menuId: "diagram-preview" },
  { id: "fitTables", defaultKey: "", menuId: "fit-tables" },
  { id: "readOnly", defaultKey: "F10", menuId: "read-only" },
  { id: "showInvisibles", defaultKey: "F3", menuId: "show-invisibles" },
  { id: "validateMarkdown", defaultKey: "Alt-Mod-v", menuId: "check-markdown" },
  { id: "lintNext", defaultKey: "F2", menuId: "lint-next" },
  { id: "lintPrev", defaultKey: "Shift-F2", menuId: "lint-prev" },
  { id: "zoomActual", defaultKey: "Mod-0", menuId: "zoom-actual" },
  { id: "zoomIn", defaultKey: "Mod-=", menuId: "zoom-in" },
  { id: "zoomOut", defaultKey: "Mod--", menuId: "zoom-out" },
  { id: "newBrowserTab", defaultKey: "Alt-Mod-Shift-b", menuId: "new-browser-tab" },
  { id: "newFile", defaultKey: "Mod-n", menuId: "new" },
  { id: "newWindow", defaultKey: "Mod-Shift-n", menuId: "new-window" },
  { id: "quickOpen", defaultKey: "Mod-o", menuId: "quick-open" },
  { id: "openFile", defaultKey: "", menuId: "open" },
  { id: "openFolder", defaultKey: "Mod-Shift-o", menuId: "open-folder" },
  { id: "save", defaultKey: "Mod-s", menuId: "save" },
  { id: "saveAs", defaultKey: "Mod-Shift-s", menuId: "save-as" },
  { id: "moveTo", defaultKey: "", menuId: "move-to" },
  { id: "closeFile", defaultKey: "Mod-w", menuId: "close" },
  { id: "exportHTML", defaultKey: "", menuId: "export-html" },
  { id: "print", defaultKey: "Mod-p", menuId: "export-pdf" },
  { id: "exportPdf", defaultKey: "", menuId: "export-pdf-native" },
  { id: "preferences", defaultKey: "Mod-,", menuId: "preferences" },
  { id: "saveAllQuit", defaultKey: "Alt-Mod-Shift-q", menuId: "save-all-quit" },
  { id: "formatTable", defaultKey: "Alt-Mod-t", menuId: "format-table" },
  { id: "insertNote", defaultKey: "Alt-Mod-n", menuId: "info-note" },
  { id: "insertTip", defaultKey: "Mod-Alt-Shift-t", menuId: "info-tip" },
  { id: "insertWarning", defaultKey: "Mod-Shift-w", menuId: "info-warning" },
  { id: "insertImportant", defaultKey: "Mod-Alt-Shift-i", menuId: "info-important" },
  { id: "insertCaution", defaultKey: "Mod-Shift-u", menuId: "info-caution" },
  { id: "insertCollapsible", defaultKey: "Alt-Mod-d", menuId: "collapsible-block" },
];
