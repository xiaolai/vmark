/**
 * Shortcuts engine — keyboard shortcut definitions, user-customization
 * store, conflict detection, and native-menu accelerator sync.
 *
 * Persists user customizations under `vmark-shortcuts`. The default
 * registry (DEFAULT_SHORTCUTS) is the source of truth — every binding
 * must keep it in sync with `src-tauri/src/menu/localized.rs` (Tauri
 * accelerators) and `website/guide/shortcuts.md` (docs) per
 * `.claude/rules/41-keyboard-shortcuts.md`.
 *
 * Re-exported by `../settingsStore.ts` so existing consumers can keep
 * `import { useShortcutsStore } from "@/stores/settingsStore"`.
 *
 * @module stores/settingsStore/shortcuts
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { invoke } from "@tauri-apps/api/core";
import { createSafeStorage } from "@/utils/safeStorage";
import { isMacPlatform } from "@/utils/shortcutMatch";
import { shortcutsWarn } from "@/utils/debug";

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

/** Normalize key string for comparison (case-insensitive, sorted modifiers). */
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
let inFlightSync: Promise<void> = Promise.resolve();

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

/** Flush any pending debounced sync immediately. Exported for tests. */
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

function queueSyncMenuShortcuts(shortcuts: Record<string, string>) {
  inFlightSync = inFlightSync
    .catch(() => {})
    .then(() => syncMenuShortcutsNow(shortcuts));
}

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

  const modifierNames = new Set(["Mod", "Ctrl", "Alt", "Shift"]);
  const modifierMap: Record<string, string> = { Mod: "CmdOrCtrl" };

  const parts = key.split("-");
  const result: string[] = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];

    if (part === "" && i === parts.length - 1) {
      result.push("-");
    } else if (part === "") {
      continue;
    } else if (modifierNames.has(part) && i < parts.length - 1) {
      result.push(modifierMap[part] ?? part);
    } else {
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

// getCategoryLabel / getShortcutLabel live in `../settingsShortcutLabels.ts`
// to avoid a settingsStore ⇄ i18n circular import.
