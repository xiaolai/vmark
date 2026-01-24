/**
 * Shortcuts Store
 *
 * Centralized keyboard shortcut management with user customization.
 * Supports conflict detection, presets, and import/export.
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { invoke } from "@tauri-apps/api/core";
import { isMacPlatform } from "@/utils/shortcutMatch";

// ============================================================================
// Types
// ============================================================================

export type ShortcutCategory =
  | "formatting"  // Bold, Italic, Code, etc.
  | "blocks"      // Headings, Lists, Quote, Table
  | "navigation"  // Select, Move, Jump
  | "editing"     // Clear format, Undo, Redo
  | "view"        // Sidebar, Outline, Focus mode
  | "file";       // New, Open, Save, etc.

/**
 * Shortcut scope determines when a shortcut is active.
 * - global: Works everywhere (editor, terminal, etc.)
 * - editor: Only works when editor is focused (default)
 */
export type ShortcutScope = "global" | "editor";

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

export const DEFAULT_SHORTCUTS: ShortcutDefinition[] = [
  // === Formatting ===
  { id: "bold", label: "Bold", category: "formatting", defaultKey: "Mod-b", menuId: "bold" },
  { id: "italic", label: "Italic", category: "formatting", defaultKey: "Mod-i", menuId: "italic" },
  { id: "code", label: "Inline Code", category: "formatting", defaultKey: "Mod-Shift-`", menuId: "code" },
  { id: "strikethrough", label: "Strikethrough", category: "formatting", defaultKey: "Mod-Shift-x", menuId: "strikethrough" },
  { id: "underline", label: "Underline", category: "formatting", defaultKey: "Mod-u", menuId: "underline" },
  { id: "link", label: "Link", category: "formatting", defaultKey: "Mod-k", menuId: "link" },
  { id: "highlight", label: "Highlight", category: "formatting", defaultKey: "Mod-Shift-m", menuId: "highlight" },
  { id: "inlineMath", label: "Inline Math", category: "formatting", defaultKey: "Alt-Mod-m", menuId: "inline-math", description: "Insert or edit inline math ($...$)" },
  { id: "subscript", label: "Subscript", category: "formatting", defaultKey: "Alt-Mod-=", menuId: "subscript" },
  { id: "superscript", label: "Superscript", category: "formatting", defaultKey: "Alt-Mod-Shift-=", menuId: "superscript" },
  { id: "clearFormat", label: "Clear Formatting", category: "formatting", defaultKey: "Mod-\\", menuId: "clear-format" },

  // === Blocks ===
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
  { id: "indent", label: "Indent", category: "blocks", defaultKey: "Mod-]", menuId: "indent" },
  { id: "outdent", label: "Outdent", category: "blocks", defaultKey: "Mod-[", menuId: "outdent" },

  // === Navigation ===
  { id: "selectLine", label: "Select Line", category: "navigation", defaultKey: "Mod-l", menuId: "select-line" },
  { id: "expandSelection", label: "Expand Selection", category: "navigation", defaultKey: "Ctrl-Shift-Up", menuId: "expand-selection" },
  { id: "formatToolbar", label: "Universal Toolbar", category: "navigation", defaultKey: "Mod-Shift-p", description: "Show the universal bottom toolbar" },
  { id: "sourcePeek", label: "Source Peek", category: "navigation", defaultKey: "Mod-Alt-/", description: "Edit selection as markdown" },
  { id: "findReplace", label: "Find & Replace", category: "navigation", defaultKey: "Mod-f", menuId: "find-replace" },
  { id: "findNext", label: "Find Next", category: "navigation", defaultKey: "Mod-g", menuId: "find-next" },
  { id: "findPrevious", label: "Find Previous", category: "navigation", defaultKey: "Mod-Shift-g", menuId: "find-prev" },

  // === Editing ===
  { id: "formatCJKSelection", label: "Format CJK Selection", category: "editing", defaultKey: "Mod-Shift-f", menuId: "format-cjk" },
  { id: "formatCJKFile", label: "Format CJK File", category: "editing", defaultKey: "Alt-Mod-Shift-f", menuId: "format-cjk-file" },
  { id: "copyAsHTML", label: "Copy as HTML", category: "editing", defaultKey: "Mod-Shift-c", menuId: "copy-html" },
  { id: "pastePlainText", label: "Paste as Plain Text", category: "editing", defaultKey: "Mod-Shift-v", description: "Paste without formatting in WYSIWYG" },
  { id: "toggleComment", label: "Toggle Comment", category: "editing", defaultKey: "Mod-Shift-/", description: "Insert HTML comment <!-- -->" },

  // === Line Operations ===
  { id: "moveLineUp", label: "Move Line Up", category: "editing", defaultKey: "Alt-Up", menuId: "move-line-up" },
  { id: "moveLineDown", label: "Move Line Down", category: "editing", defaultKey: "Alt-Down", menuId: "move-line-down" },
  { id: "duplicateLine", label: "Duplicate Line", category: "editing", defaultKey: "Shift-Alt-Down", menuId: "duplicate-line" },
  { id: "deleteLine", label: "Delete Line", category: "editing", defaultKey: "Mod-Shift-k", menuId: "delete-line" },
  { id: "joinLines", label: "Join Lines", category: "editing", defaultKey: "Mod-j", menuId: "join-lines" },
  { id: "sortLinesAsc", label: "Sort Lines Ascending", category: "editing", defaultKey: "F5", menuId: "sort-lines-asc" },
  { id: "sortLinesDesc", label: "Sort Lines Descending", category: "editing", defaultKey: "Shift-F5", menuId: "sort-lines-desc" },

  // === Text Transformations ===
  { id: "transformUppercase", label: "Transform to UPPERCASE", category: "editing", defaultKey: "Ctrl-Shift-u", menuId: "transform-uppercase" },
  { id: "transformLowercase", label: "Transform to lowercase", category: "editing", defaultKey: "Ctrl-Shift-l", menuId: "transform-lowercase" },
  { id: "transformTitleCase", label: "Transform to Title Case", category: "editing", defaultKey: "Ctrl-Shift-t", menuId: "transform-title-case" },
  { id: "transformToggleCase", label: "Toggle Case", category: "editing", defaultKey: "", menuId: "transform-toggle-case", description: "Toggle between UPPERCASE and lowercase" },
  { id: "removeBlankLines", label: "Remove Blank Lines", category: "editing", defaultKey: "", menuId: "remove-blank-lines", description: "Remove blank lines from selection" },

  // === View ===
  { id: "toggleSidebar", label: "Toggle Sidebar", category: "view", defaultKey: "Mod-Shift-b", menuId: "sidebar", scope: "global" },
  { id: "toggleOutline", label: "Toggle Outline", category: "view", defaultKey: "Mod-Alt-1", menuId: "outline" },
  { id: "sourceMode", label: "Source Mode", category: "view", defaultKey: "Mod-/", menuId: "source-mode" },
  { id: "toggleStatusBar", label: "Toggle Status Bar", category: "view", defaultKey: "F7", description: "Show/hide the status bar", scope: "global" },
  { id: "focusMode", label: "Focus Mode", category: "view", defaultKey: "F8", menuId: "focus-mode", scope: "global" },
  { id: "typewriterMode", label: "Typewriter Mode", category: "view", defaultKey: "F9", menuId: "typewriter-mode", scope: "global" },
  { id: "wordWrap", label: "Toggle Word Wrap", category: "view", defaultKey: "Alt-z", menuId: "word-wrap" },
  { id: "lineNumbers", label: "Toggle Line Numbers", category: "view", defaultKey: "Mod-Shift-n", menuId: "line-numbers", description: "Show/hide line numbers in code blocks" },
  { id: "viewHistory", label: "View History", category: "view", defaultKey: "Mod-Shift-h", menuId: "view-history" },
  { id: "toggleHiddenFiles", label: "Toggle Hidden Files", category: "view", defaultKey: "Mod-Shift-.", defaultKeyOther: "Ctrl-h", description: "Show or hide hidden files in the file explorer" },
  { id: "toggleTerminal", label: "Toggle Terminal", category: "view", defaultKey: "Ctrl-`", menuId: "terminal", description: "Show or hide the integrated terminal", scope: "global" },

  // === File ===
  { id: "newFile", label: "New File", category: "file", defaultKey: "Mod-n", menuId: "new", scope: "global" },
  { id: "openFile", label: "Open File", category: "file", defaultKey: "Mod-o", menuId: "open", scope: "global" },
  { id: "openFolder", label: "Open Folder", category: "file", defaultKey: "Mod-Shift-o", menuId: "open-folder", scope: "global" },
  { id: "save", label: "Save", category: "file", defaultKey: "Mod-s", menuId: "save", scope: "global" },
  { id: "saveAs", label: "Save As", category: "file", defaultKey: "Mod-Shift-s", menuId: "save-as", scope: "global" },
  { id: "closeFile", label: "Close", category: "file", defaultKey: "Mod-w", menuId: "close", scope: "global" },
  { id: "exportHTML", label: "Export HTML", category: "file", defaultKey: "Mod-Shift-e", menuId: "export-html", scope: "global" },
  { id: "print", label: "Print", category: "file", defaultKey: "Mod-p", menuId: "export-pdf", scope: "global" },
  { id: "preferences", label: "Settings", category: "file", defaultKey: "Mod-,", menuId: "preferences", scope: "global" },

  // === Future: Cycling (Phase 4) ===
  { id: "cycleEmphasis", label: "Cycle Emphasis", category: "formatting", defaultKey: "Mod-Alt-e", description: "Cycle: none → italic → bold → bold+italic" },
  { id: "cycleList", label: "Cycle List Type", category: "blocks", defaultKey: "Mod-Alt-l", description: "Cycle: paragraph → bullet → ordered → task" },
  { id: "cycleHeading", label: "Cycle Heading", category: "blocks", defaultKey: "Mod-Alt-h", description: "Cycle: P → H1 → H2 → ... → H6" },

  // === Future: Table (Phase 2) ===
  { id: "tableColumnLeft", label: "Add Column Left", category: "blocks", defaultKey: "Alt-Mod-Left" },
  { id: "tableColumnRight", label: "Add Column Right", category: "blocks", defaultKey: "Alt-Mod-Right" },
  { id: "tableDeleteColumn", label: "Delete Column", category: "blocks", defaultKey: "Alt-Mod-Backspace" },
  { id: "tableAlignLeft", label: "Align Left", category: "blocks", defaultKey: "Mod-Alt-Shift-l" },
  { id: "tableAlignCenter", label: "Align Center", category: "blocks", defaultKey: "Mod-Alt-c" },
  { id: "tableAlignRight", label: "Align Right", category: "blocks", defaultKey: "Mod-Shift-r" },

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
  if (isMac && def.defaultKeyMac) return def.defaultKeyMac;
  if (!isMac && def.defaultKeyOther) return def.defaultKeyOther;
  return def.defaultKey;
}

// ============================================================================
// Presets
// ============================================================================

export const SHORTCUT_PRESETS: Record<string, { name: string; bindings: Record<string, string> }> = {
  default: {
    name: "Optimized (Recommended)",
    bindings: {},
  },
  vscode: {
    name: "VS Code",
    bindings: {
      // VS Code-style shortcuts
      toggleSidebar: "Mod-b",
      formatToolbar: "Mod-Shift-p",
    },
  },
};

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
  /** Apply a preset */
  applyPreset: (presetId: string) => void;
  /** Export config as JSON string */
  exportConfig: () => string;
  /** Import config from JSON string */
  importConfig: (json: string) => { success: boolean; errors?: string[] };
  /** Check if shortcut has been customized */
  isCustomized: (id: string) => boolean;
  /** Get shortcut definition by ID */
  getDefinition: (id: string) => ShortcutDefinition | undefined;
}

const initialState: ShortcutsState = {
  customBindings: {},
  version: 1,
};

export const useShortcutsStore = create<ShortcutsState & ShortcutsActions>()(
  persist(
    (set, get) => ({
      ...initialState,

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

      applyPreset: (presetId) => {
        const preset = SHORTCUT_PRESETS[presetId];
        if (!preset) return;
        set({ customBindings: { ...preset.bindings } });
        syncMenuShortcuts(get().getAllShortcuts());
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
          return { success: false, errors: [`Parse error: ${e}`] };
        }
      },

      isCustomized: (id) => {
        return id in get().customBindings;
      },

      getDefinition: (id) => shortcutMap.get(id),
    }),
    {
      name: "vmark-shortcuts",
      storage: createJSONStorage(() =>
        typeof window !== "undefined" ? localStorage : {
          getItem: () => null,
          setItem: () => {},
          removeItem: () => {},
        }
      ),
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

/**
 * Sync shortcuts with Tauri menu.
 */
async function syncMenuShortcuts(shortcuts: Record<string, string>) {
  try {
    // Build menu ID -> shortcut mapping
    const menuShortcuts: Record<string, string> = {};
    for (const def of DEFAULT_SHORTCUTS) {
      if (def.menuId) {
        const key = shortcuts[def.id] ?? resolveDefaultKey(def);
        // Convert from ProseMirror format to Tauri format
        menuShortcuts[def.menuId] = prosemirrorToTauri(key);
      }
    }
    await invoke("rebuild_menu", { shortcuts: menuShortcuts });
  } catch (e) {
    // Menu rebuild may fail if command not yet implemented
    console.warn("Failed to sync menu shortcuts:", e);
  }
}

/**
 * Convert ProseMirror key format to Tauri accelerator format.
 * Mod-b -> CmdOrCtrl+B
 * Mod-Shift-` -> CmdOrCtrl+Shift+`
 */
function prosemirrorToTauri(key: string): string {
  return key
    .replace(/Mod/g, "CmdOrCtrl")
    .replace(/Ctrl/g, "Ctrl")
    .replace(/Alt/g, "Alt")
    .replace(/Shift/g, "Shift")
    .replace(/-/g, "+")
    .replace(/\+(\w)$/, (_, char) => `+${char.toUpperCase()}`);
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

export function getShortcutsByCategory(category: ShortcutCategory): ShortcutDefinition[] {
  return DEFAULT_SHORTCUTS.filter((s) => s.category === category);
}

export const CATEGORY_LABELS: Record<ShortcutCategory, string> = {
  formatting: "Formatting",
  blocks: "Blocks",
  navigation: "Navigation",
  editing: "Editing",
  view: "View",
  file: "File",
};

export const CATEGORY_ORDER: ShortcutCategory[] = [
  "formatting",
  "blocks",
  "navigation",
  "editing",
  "view",
  "file",
];
