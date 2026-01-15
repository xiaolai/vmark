/**
 * Toolbar Groups - Button Definitions
 *
 * Centralized button group definitions for the UniversalToolbar.
 * These definitions are framework-agnostic (no React/Zustand deps).
 *
 * Groups appear in spec order:
 * Block → Inline → List → Table → Blockquote → Insert → Expandables → Link
 *
 * @module components/Editor/UniversalToolbar/toolbarGroups
 */
import { icons } from "@/utils/icons";

/** Contexts where a button is enabled */
export type EnableContext =
  | "always"       // Always enabled
  | "selection"    // When there's a text selection
  | "textblock"    // In any text block (paragraph, heading, etc.)
  | "heading"      // Inside a heading
  | "list"         // Inside a list item
  | "table"        // Inside a table cell
  | "blockquote"   // Inside a blockquote
  | "codeblock"    // Inside a code block
  | "never";       // Always disabled (not yet implemented)

/** Button types */
export type ButtonType = "button" | "dropdown" | "separator";

/** Single toolbar button definition */
export interface ToolbarButton {
  id: string;
  type: ButtonType;
  icon: string;
  label: string;
  shortcut?: string;
  action: string;        // Action identifier for adapters
  enabledIn: EnableContext[];
}

/** Button group definition */
export interface ToolbarGroup {
  id: string;
  label: string;
  buttons: ToolbarButton[];
}

// --- Block Group (Heading dropdown) ---
const BLOCK_GROUP: ToolbarGroup = {
  id: "block",
  label: "Block",
  buttons: [
    {
      id: "heading",
      type: "dropdown",
      icon: icons.heading,
      label: "Heading",
      action: "heading",
      enabledIn: ["textblock"],
    },
  ],
};

// --- Inline Group (Format marks) ---
const INLINE_GROUP: ToolbarGroup = {
  id: "inline",
  label: "Inline",
  buttons: [
    { id: "bold", type: "button", icon: icons.bold, label: "Bold", shortcut: "⌘B", action: "bold", enabledIn: ["selection", "textblock"] },
    { id: "italic", type: "button", icon: icons.italic, label: "Italic", shortcut: "⌘I", action: "italic", enabledIn: ["selection", "textblock"] },
    { id: "underline", type: "button", icon: icons.underline, label: "Underline", shortcut: "⌘U", action: "underline", enabledIn: ["selection", "textblock"] },
    { id: "strikethrough", type: "button", icon: icons.strikethrough, label: "Strikethrough", shortcut: "⌘⇧X", action: "strikethrough", enabledIn: ["selection", "textblock"] },
    { id: "highlight", type: "button", icon: icons.highlight, label: "Highlight", shortcut: "⌥⌘H", action: "highlight", enabledIn: ["selection", "textblock"] },
    { id: "superscript", type: "button", icon: icons.superscript, label: "Superscript", action: "superscript", enabledIn: ["selection", "textblock"] },
    { id: "subscript", type: "button", icon: icons.subscript, label: "Subscript", action: "subscript", enabledIn: ["selection", "textblock"] },
    { id: "code", type: "button", icon: icons.inlineCode, label: "Inline Code", shortcut: "⌘`", action: "code", enabledIn: ["selection", "textblock"] },
    { id: "clear-formatting", type: "button", icon: icons.clearFormatting, label: "Clear Formatting", action: "clearFormatting", enabledIn: ["selection"] },
  ],
};

// --- List Group ---
const LIST_GROUP: ToolbarGroup = {
  id: "list",
  label: "List",
  buttons: [
    { id: "bullet-list", type: "button", icon: icons.unorderedList, label: "Bullet List", action: "bulletList", enabledIn: ["textblock", "list"] },
    { id: "ordered-list", type: "button", icon: icons.orderedList, label: "Ordered List", action: "orderedList", enabledIn: ["textblock", "list"] },
    { id: "task-list", type: "button", icon: icons.taskList, label: "Task List", action: "taskList", enabledIn: ["textblock", "list"] },
    { id: "indent", type: "button", icon: icons.indent, label: "Indent", action: "indent", enabledIn: ["list"] },
    { id: "outdent", type: "button", icon: icons.outdent, label: "Outdent", action: "outdent", enabledIn: ["list"] },
    { id: "remove-list", type: "button", icon: icons.removeList, label: "Remove List", action: "removeList", enabledIn: ["list"] },
  ],
};

// --- Table Group ---
const TABLE_GROUP: ToolbarGroup = {
  id: "table",
  label: "Table",
  buttons: [
    { id: "insert-table", type: "button", icon: icons.table, label: "Insert Table", action: "insertTable", enabledIn: ["textblock"] },
    { id: "add-row", type: "button", icon: icons.rowBelow, label: "Add Row", action: "addRow", enabledIn: ["table"] },
    { id: "delete-row", type: "button", icon: icons.deleteRow, label: "Delete Row", action: "deleteRow", enabledIn: ["table"] },
    { id: "add-col", type: "button", icon: icons.colRight, label: "Add Column", action: "addCol", enabledIn: ["table"] },
    { id: "delete-col", type: "button", icon: icons.deleteCol, label: "Delete Column", action: "deleteCol", enabledIn: ["table"] },
    { id: "delete-table", type: "button", icon: icons.deleteTable, label: "Delete Table", action: "deleteTable", enabledIn: ["table"] },
    { id: "align-left", type: "button", icon: icons.alignLeft, label: "Align Left", action: "alignLeft", enabledIn: ["table"] },
    { id: "align-center", type: "button", icon: icons.alignCenter, label: "Align Center", action: "alignCenter", enabledIn: ["table"] },
    { id: "align-right", type: "button", icon: icons.alignRight, label: "Align Right", action: "alignRight", enabledIn: ["table"] },
  ],
};

// --- Blockquote Group ---
const BLOCKQUOTE_GROUP: ToolbarGroup = {
  id: "blockquote",
  label: "Blockquote",
  buttons: [
    { id: "nest-quote", type: "button", icon: icons.nestQuote, label: "Nest Deeper", action: "nestQuote", enabledIn: ["blockquote"] },
    { id: "unnest-quote", type: "button", icon: icons.unnestQuote, label: "Unnest", action: "unnestQuote", enabledIn: ["blockquote"] },
    { id: "remove-quote", type: "button", icon: icons.removeQuote, label: "Remove Blockquote", action: "removeQuote", enabledIn: ["blockquote"] },
  ],
};

// --- Insert Group ---
const INSERT_GROUP: ToolbarGroup = {
  id: "insert",
  label: "Insert",
  buttons: [
    { id: "insert-image", type: "button", icon: icons.image, label: "Image", action: "insertImage", enabledIn: ["textblock"] },
    { id: "insert-code-block", type: "button", icon: icons.codeBlock, label: "Code Block", action: "insertCodeBlock", enabledIn: ["textblock"] },
    { id: "insert-blockquote", type: "button", icon: icons.blockquote, label: "Blockquote", action: "insertBlockquote", enabledIn: ["textblock"] },
    { id: "insert-divider", type: "button", icon: icons.divider, label: "Divider", action: "insertDivider", enabledIn: ["textblock"] },
    { id: "insert-math", type: "button", icon: icons.math, label: "Math Block", action: "insertMath", enabledIn: ["textblock"] },
  ],
};

// --- Expandables Group ---
const EXPANDABLES_GROUP: ToolbarGroup = {
  id: "expandables",
  label: "Expandables",
  buttons: [
    { id: "insert-details", type: "button", icon: icons.details, label: "Details", action: "insertDetails", enabledIn: ["never"] },
    { id: "insert-alert", type: "button", icon: icons.alertIcon, label: "Alert", action: "insertAlert", enabledIn: ["never"] },
    { id: "insert-footnote", type: "button", icon: icons.footnote, label: "Footnote", action: "insertFootnote", enabledIn: ["textblock"] },
  ],
};

// --- Link Group ---
const LINK_GROUP: ToolbarGroup = {
  id: "link",
  label: "Link",
  buttons: [
    { id: "link", type: "button", icon: icons.link, label: "Link", shortcut: "⌘K", action: "link", enabledIn: ["selection", "textblock"] },
  ],
};

/** All toolbar groups in spec order */
export const TOOLBAR_GROUPS: ToolbarGroup[] = [
  BLOCK_GROUP,
  INLINE_GROUP,
  LIST_GROUP,
  TABLE_GROUP,
  BLOCKQUOTE_GROUP,
  INSERT_GROUP,
  EXPANDABLES_GROUP,
  LINK_GROUP,
];

/**
 * Get a flat list of all buttons across all groups.
 */
export function getAllButtons(): ToolbarButton[] {
  return TOOLBAR_GROUPS.flatMap((g) => g.buttons);
}

/**
 * Find a button by ID.
 */
export function getButtonById(id: string): ToolbarButton | undefined {
  return getAllButtons().find((b) => b.id === id);
}
