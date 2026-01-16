/**
 * Toolbar Groups - Button Definitions
 *
 * Centralized group definitions for the UniversalToolbar.
 * Each group renders as a single dropdown button with menu items.
 *
 * Groups appear in spec order:
 * Block → Inline → List → Table → Blockquote → Insert → Expandables → Link
 *
 * @module components/Editor/UniversalToolbar/toolbarGroups
 */
import { icons } from "@/utils/icons";

/** Contexts where a menu item is enabled */
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

/** Separator item (visual divider in dropdown) */
export interface ToolbarSeparator {
  id: string;
  type: "separator";
}

/** Action menu item definition */
export interface ToolbarActionItem {
  id: string;
  type?: "action";       // Optional, defaults to action
  icon: string;
  label: string;
  shortcut?: string;
  action: string;        // Action identifier for adapters
  enabledIn: EnableContext[];
}

/** Menu item can be an action or separator */
export type ToolbarMenuItem = ToolbarActionItem | ToolbarSeparator;

/** Type guard for separator items */
export function isSeparator(item: ToolbarMenuItem): item is ToolbarSeparator {
  return item.type === "separator";
}

/** Group definition */
export interface ToolbarGroup {
  id: string;
  label: string;
  icon: string;
  items: ToolbarMenuItem[];
}

/** Toolbar button definition (one per group) */
export interface ToolbarGroupButton {
  id: string;
  type: "dropdown";
  icon: string;
  label: string;
  action: string;
  enabledIn: EnableContext[];
  items: ToolbarMenuItem[];
}

// --- Block Group (Heading dropdown) ---
const BLOCK_GROUP: ToolbarGroup = {
  id: "block",
  label: "Heading",
  icon: icons.heading,
  items: [
    { id: "paragraph", icon: icons.paragraph, label: "Paragraph", action: "heading:0", enabledIn: ["textblock"] },
    { id: "h1", icon: icons.heading1, label: "Heading 1", action: "heading:1", enabledIn: ["textblock"] },
    { id: "h2", icon: icons.heading2, label: "Heading 2", action: "heading:2", enabledIn: ["textblock"] },
    { id: "h3", icon: icons.heading3, label: "Heading 3", action: "heading:3", enabledIn: ["textblock"] },
    { id: "h4", icon: icons.heading4, label: "Heading 4", action: "heading:4", enabledIn: ["textblock"] },
    { id: "h5", icon: icons.heading5, label: "Heading 5", action: "heading:5", enabledIn: ["textblock"] },
    { id: "h6", icon: icons.heading6, label: "Heading 6", action: "heading:6", enabledIn: ["textblock"] },
  ],
};

// --- Inline Group (Format marks) ---
const INLINE_GROUP: ToolbarGroup = {
  id: "inline",
  label: "Inline",
  icon: icons.bold,
  items: [
    { id: "bold", icon: icons.bold, label: "Bold", shortcut: "⌘B", action: "bold", enabledIn: ["selection", "textblock"] },
    { id: "italic", icon: icons.italic, label: "Italic", shortcut: "⌘I", action: "italic", enabledIn: ["selection", "textblock"] },
    { id: "underline", icon: icons.underline, label: "Underline", shortcut: "⌘U", action: "underline", enabledIn: ["selection", "textblock"] },
    { id: "strikethrough", icon: icons.strikethrough, label: "Strikethrough", shortcut: "⌘⇧X", action: "strikethrough", enabledIn: ["selection", "textblock"] },
    { id: "highlight", icon: icons.highlight, label: "Highlight", shortcut: "⌥⌘H", action: "highlight", enabledIn: ["selection", "textblock"] },
    { id: "superscript", icon: icons.superscript, label: "Superscript", action: "superscript", enabledIn: ["selection", "textblock"] },
    { id: "subscript", icon: icons.subscript, label: "Subscript", action: "subscript", enabledIn: ["selection", "textblock"] },
    { id: "code", icon: icons.inlineCode, label: "Inline Code", shortcut: "⌘`", action: "code", enabledIn: ["selection", "textblock"] },
    { id: "clear-formatting", icon: icons.clearFormatting, label: "Clear Formatting", action: "clearFormatting", enabledIn: ["selection"] },
  ],
};

// --- List Group ---
const LIST_GROUP: ToolbarGroup = {
  id: "list",
  label: "List",
  icon: icons.unorderedList,
  items: [
    { id: "bullet-list", icon: icons.unorderedList, label: "Bullet List", action: "bulletList", enabledIn: ["textblock", "list"] },
    { id: "ordered-list", icon: icons.orderedList, label: "Ordered List", action: "orderedList", enabledIn: ["textblock", "list"] },
    { id: "task-list", icon: icons.taskList, label: "Task List", action: "taskList", enabledIn: ["textblock", "list"] },
    { id: "indent", icon: icons.indent, label: "Indent", action: "indent", enabledIn: ["list"] },
    { id: "outdent", icon: icons.outdent, label: "Outdent", action: "outdent", enabledIn: ["list"] },
    { id: "remove-list", icon: icons.removeList, label: "Remove List", action: "removeList", enabledIn: ["list"] },
  ],
};

// --- Table Group ---
const TABLE_GROUP: ToolbarGroup = {
  id: "table",
  label: "Table",
  icon: icons.table,
  items: [
    { id: "insert-table", icon: icons.table, label: "Insert Table", action: "insertTable", enabledIn: ["textblock"] },
    { id: "add-row-above", icon: icons.rowAbove, label: "Row Above", action: "addRowAbove", enabledIn: ["table"] },
    { id: "add-row", icon: icons.rowBelow, label: "Row Below", action: "addRow", enabledIn: ["table"] },
    { id: "add-col-left", icon: icons.colLeft, label: "Column Left", action: "addColLeft", enabledIn: ["table"] },
    { id: "add-col", icon: icons.colRight, label: "Column Right", action: "addCol", enabledIn: ["table"] },
    { id: "delete-row", icon: icons.deleteRow, label: "Delete Row", action: "deleteRow", enabledIn: ["table"] },
    { id: "delete-col", icon: icons.deleteCol, label: "Delete Column", action: "deleteCol", enabledIn: ["table"] },
    { id: "delete-table", icon: icons.deleteTable, label: "Delete Table", action: "deleteTable", enabledIn: ["table"] },
    { id: "align-left", icon: icons.alignLeft, label: "Align Left", action: "alignLeft", enabledIn: ["table"] },
    { id: "align-center", icon: icons.alignCenter, label: "Align Center", action: "alignCenter", enabledIn: ["table"] },
    { id: "align-right", icon: icons.alignRight, label: "Align Right", action: "alignRight", enabledIn: ["table"] },
    { id: "align-all-left", icon: icons.alignAllLeft, label: "Align All Left", action: "alignAllLeft", enabledIn: ["table"] },
    { id: "align-all-center", icon: icons.alignAllCenter, label: "Align All Center", action: "alignAllCenter", enabledIn: ["table"] },
    { id: "align-all-right", icon: icons.alignAllRight, label: "Align All Right", action: "alignAllRight", enabledIn: ["table"] },
  ],
};

// --- Blockquote Group ---
const BLOCKQUOTE_GROUP: ToolbarGroup = {
  id: "blockquote",
  label: "Blockquote",
  icon: icons.blockquote,
  items: [
    { id: "nest-quote", icon: icons.nestQuote, label: "Nest Deeper", action: "nestQuote", enabledIn: ["blockquote"] },
    { id: "unnest-quote", icon: icons.unnestQuote, label: "Unnest", action: "unnestQuote", enabledIn: ["blockquote"] },
    { id: "remove-quote", icon: icons.removeQuote, label: "Remove Blockquote", action: "removeQuote", enabledIn: ["blockquote"] },
  ],
};

// --- Insert Group ---
const INSERT_GROUP: ToolbarGroup = {
  id: "insert",
  label: "Insert",
  icon: icons.codeBlock,
  items: [
    { id: "insert-image", icon: icons.image, label: "Image", action: "insertImage", enabledIn: ["textblock"] },
    { id: "insert-code-block", icon: icons.codeBlock, label: "Code Block", action: "insertCodeBlock", enabledIn: ["textblock"] },
    { id: "insert-blockquote", icon: icons.blockquote, label: "Blockquote", action: "insertBlockquote", enabledIn: ["textblock"] },
    { id: "insert-divider", icon: icons.divider, label: "Divider", action: "insertDivider", enabledIn: ["textblock"] },
    { id: "insert-math", icon: icons.math, label: "Math Block", action: "insertMath", enabledIn: ["textblock"] },
    { id: "insert-table-block", icon: icons.table, label: "Table", action: "insertTableBlock", enabledIn: ["textblock"] },
    { id: "insert-bullet-list", icon: icons.unorderedList, label: "Bullet List", action: "insertBulletList", enabledIn: ["textblock"] },
    { id: "insert-ordered-list", icon: icons.orderedList, label: "Ordered List", action: "insertOrderedList", enabledIn: ["textblock"] },
    { id: "insert-task-list", icon: icons.taskList, label: "Task List", action: "insertTaskList", enabledIn: ["textblock"] },
  ],
};

// --- Expandables Group ---
const EXPANDABLES_GROUP: ToolbarGroup = {
  id: "expandables",
  label: "Expandables",
  icon: icons.details,
  items: [
    { id: "insert-details", icon: icons.details, label: "Details", action: "insertDetails", enabledIn: ["textblock"] },
    { id: "insert-alert-note", icon: icons.alertIcon, label: "Alert Note", action: "insertAlertNote", enabledIn: ["textblock"] },
    { id: "insert-alert-tip", icon: icons.alertIcon, label: "Alert Tip", action: "insertAlertTip", enabledIn: ["textblock"] },
    { id: "insert-alert-important", icon: icons.alertIcon, label: "Alert Important", action: "insertAlertImportant", enabledIn: ["textblock"] },
    { id: "insert-alert-warning", icon: icons.alertIcon, label: "Alert Warning", action: "insertAlertWarning", enabledIn: ["textblock"] },
    { id: "insert-alert-caution", icon: icons.alertIcon, label: "Alert Caution", action: "insertAlertCaution", enabledIn: ["textblock"] },
  ],
};

// --- Link Group (consolidated) ---
const LINK_GROUP: ToolbarGroup = {
  id: "link",
  label: "Link",
  icon: icons.link,
  items: [
    { id: "link", icon: icons.link, label: "Hyperlink", shortcut: "⌘K", action: "link", enabledIn: ["selection", "textblock"] },
    { id: "bookmark", icon: icons.hash, label: "Bookmark", action: "link:bookmark", enabledIn: ["textblock"] },
    { id: "separator1", type: "separator" },
    { id: "wikiLink", icon: icons.fileText, label: "Wiki Link", action: "link:wiki", enabledIn: ["textblock"] },
    { id: "wikiEmbed", icon: icons.fileImage, label: "Wiki Embed", action: "link:wikiEmbed", enabledIn: ["textblock"] },
    { id: "separator2", type: "separator" },
    { id: "referenceLink", icon: icons.bookmarkLink, label: "Reference Link", action: "link:reference", enabledIn: ["textblock"] },
    { id: "separator3", type: "separator" },
    { id: "footnote", icon: icons.footnote, label: "Footnote", action: "insertFootnote", enabledIn: ["textblock"] },
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
 * Get a flat list of all menu items across groups.
 */
export function getAllItems(): ToolbarMenuItem[] {
  return TOOLBAR_GROUPS.flatMap((group) => group.items);
}

/**
 * Get the toolbar buttons (one per group).
 */
export function getGroupButtons(): ToolbarGroupButton[] {
  return TOOLBAR_GROUPS.map((group) => ({
    id: group.id,
    type: "dropdown",
    icon: group.icon,
    label: group.label,
    action: group.id,
    enabledIn: ["always"],
    items: group.items,
  }));
}
