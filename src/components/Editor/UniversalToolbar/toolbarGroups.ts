/**
 * Toolbar Groups - Button Definitions
 *
 * Centralized group definitions for the UniversalToolbar.
 * Each group renders as a single dropdown button with menu items.
 *
 * Groups appear in spec order (pinned by toolbarGroups.test.ts):
 * Block → Inline → List → Table → Blockquote → Link → Insert
 *
 * @module components/Editor/UniversalToolbar/toolbarGroups
 */
import { icons, type SafeIconSvg } from "@/utils/icons";
import type { AdapterAction } from "@/plugins/toolbarActions/adapterActions";

// Enable contexts live in the shared applicability table — toolbar items no
// longer declare their own; each item's contexts derive from its ACTION.
import { enabledInFor, type EnableContext } from "@/plugins/toolbarActions/actionApplicability";


/** Separator item (visual divider in dropdown) */
export interface ToolbarSeparator {
  id: string;
  type: "separator";
}

/** Action menu item definition */
export interface ToolbarActionItem {
  id: string;
  type?: "action";       // Optional, defaults to action
  /**
   * Branded as `SafeIconSvg` so the only legal source is the validated
   * `icons` registry from `@/utils/icons`. This is what stops untrusted
   * input from ever reaching the `dangerouslySetInnerHTML` in
   * ToolbarButton.
   */
  icon: SafeIconSvg;
  label: string;
  /** Settings shortcut-definition id — the CURRENT binding (custom or
   * default, platform-aware) is resolved at render time. A hardcoded display
   * string here drifted from the registry and ignored user rebinding. */
  shortcutId?: string;
  /** Action identifier for adapters — typed so a renamed or misspelled id
   * is a compile error here, not a silent fall-through (WI-4). */
  action: AdapterAction;
  enabledIn: EnableContext[];
}

/** Menu item can be an action or separator */
export type ToolbarMenuItem = ToolbarActionItem | ToolbarSeparator;

/** Item literal as DECLARED — enable contexts come from the applicability
 * table (one source), filled in by `buildGroup`. */
type ToolbarActionItemDef = Omit<ToolbarActionItem, "enabledIn">;
type ToolbarMenuItemDef = ToolbarActionItemDef | ToolbarSeparator;
interface ToolbarGroupDef {
  id: string;
  label: string;
  icon: SafeIconSvg;
  items: ToolbarMenuItemDef[];
}

/** Fill each action item's enable contexts from the shared table. */
function buildGroup(def: ToolbarGroupDef): ToolbarGroup {
  return {
    ...def,
    items: def.items.map((item) =>
      "type" in item && item.type === "separator"
        ? item
        : { ...item, enabledIn: [...enabledInFor(item.action)] }
    ),
  };
}

/** Type guard for separator items */
export function isSeparator(item: ToolbarMenuItem): item is ToolbarSeparator {
  return item.type === "separator";
}

/** Group definition */
export interface ToolbarGroup {
  id: string;
  label: string;
  icon: SafeIconSvg;
  items: ToolbarMenuItem[];
}

/** Toolbar button definition (one per group) */
export interface ToolbarGroupButton {
  id: string;
  type: "dropdown";
  icon: SafeIconSvg;
  label: string;
  action: string;
  enabledIn: EnableContext[];
  items: ToolbarMenuItem[];
}

// --- Block Group (Heading dropdown) ---
const BLOCK_GROUP: ToolbarGroup = buildGroup({
  id: "block",
  label: "Heading",
  icon: icons.heading,
  items: [
    // "Paragraph" here means "remove heading" - only available when in a heading
    { id: "paragraph", icon: icons.paragraph, label: "Paragraph", shortcutId: "paragraph", action: "heading:0" },
    { id: "h1", icon: icons.heading1, label: "Heading 1", shortcutId: "heading1", action: "heading:1" },
    { id: "h2", icon: icons.heading2, label: "Heading 2", shortcutId: "heading2", action: "heading:2" },
    { id: "h3", icon: icons.heading3, label: "Heading 3", shortcutId: "heading3", action: "heading:3" },
    { id: "h4", icon: icons.heading4, label: "Heading 4", shortcutId: "heading4", action: "heading:4" },
    { id: "h5", icon: icons.heading5, label: "Heading 5", shortcutId: "heading5", action: "heading:5" },
    { id: "h6", icon: icons.heading6, label: "Heading 6", shortcutId: "heading6", action: "heading:6" },
  ],
});

// --- Inline Group (Format marks) ---
const INLINE_GROUP: ToolbarGroup = buildGroup({
  id: "inline",
  label: "Inline",
  icon: icons.bold,
  items: [
    { id: "bold", icon: icons.bold, label: "Bold", shortcutId: "bold", action: "bold" },
    { id: "italic", icon: icons.italic, label: "Italic", shortcutId: "italic", action: "italic" },
    { id: "underline", icon: icons.underline, label: "Underline", shortcutId: "underline", action: "underline" },
    { id: "strikethrough", icon: icons.strikethrough, label: "Strikethrough", shortcutId: "strikethrough", action: "strikethrough" },
    { id: "highlight", icon: icons.highlight, label: "Highlight", shortcutId: "highlight", action: "highlight" },
    { id: "superscript", icon: icons.superscript, label: "Superscript", action: "superscript" },
    { id: "subscript", icon: icons.subscript, label: "Subscript", action: "subscript" },
    { id: "code", icon: icons.inlineCode, label: "Inline Code", shortcutId: "code", action: "code" },
    { id: "clear-formatting", icon: icons.clearFormatting, label: "Clear Formatting", shortcutId: "clearFormat", action: "clearFormatting" },
  ],
});

// --- List Group ---
const LIST_GROUP: ToolbarGroup = buildGroup({
  id: "list",
  label: "List",
  icon: icons.unorderedList,
  items: [
    { id: "bullet-list", icon: icons.unorderedList, label: "Bullet List", shortcutId: "bulletList", action: "bulletList" },
    { id: "ordered-list", icon: icons.orderedList, label: "Ordered List", shortcutId: "orderedList", action: "orderedList" },
    { id: "task-list", icon: icons.taskList, label: "Task List", shortcutId: "taskList", action: "taskList" },
    { id: "indent", icon: icons.indent, label: "Indent", shortcutId: "indent", action: "indent" },
    { id: "outdent", icon: icons.outdent, label: "Outdent", shortcutId: "outdent", action: "outdent" },
    { id: "remove-list", icon: icons.removeList, label: "Remove List", action: "removeList" },
  ],
});

// --- Table Group ---
const TABLE_GROUP: ToolbarGroup = buildGroup({
  id: "table",
  label: "Table",
  icon: icons.table,
  items: [
    { id: "insert-table", icon: icons.table, label: "Insert Table", shortcutId: "insertTable", action: "insertTable" },
    { id: "add-row-above", icon: icons.rowAbove, label: "Row Above", action: "addRowAbove" },
    { id: "add-row", icon: icons.rowBelow, label: "Row Below", action: "addRow" },
    { id: "add-col-left", icon: icons.colLeft, label: "Column Left", action: "addColLeft" },
    { id: "add-col", icon: icons.colRight, label: "Column Right", action: "addCol" },
    { id: "delete-row", icon: icons.deleteRow, label: "Delete Row", action: "deleteRow" },
    { id: "delete-col", icon: icons.deleteCol, label: "Delete Column", action: "deleteCol" },
    { id: "delete-table", icon: icons.deleteTable, label: "Delete Table", action: "deleteTable" },
    { id: "align-left", icon: icons.alignLeft, label: "Align Left", action: "alignLeft" },
    { id: "align-center", icon: icons.alignCenter, label: "Align Center", action: "alignCenter" },
    { id: "align-right", icon: icons.alignRight, label: "Align Right", action: "alignRight" },
    { id: "align-all-left", icon: icons.alignAllLeft, label: "Align All Left", action: "alignAllLeft" },
    { id: "align-all-center", icon: icons.alignAllCenter, label: "Align All Center", action: "alignAllCenter" },
    { id: "align-all-right", icon: icons.alignAllRight, label: "Align All Right", action: "alignAllRight" },
    { id: "format-table", icon: icons.formatTable, label: "Format Table", action: "formatTable" },
  ],
});

// --- Blockquote Group ---
const BLOCKQUOTE_GROUP: ToolbarGroup = buildGroup({
  id: "blockquote",
  label: "Blockquote",
  icon: icons.textQuote,
  items: [
    { id: "blockquote", icon: icons.blockquote, label: "Blockquote", shortcutId: "blockquote", action: "insertBlockquote" },
    { id: "nest-blockquote", icon: icons.nestBlockquote, label: "Nest Deeper", action: "nestBlockquote" },
    { id: "unnest-blockquote", icon: icons.unnestBlockquote, label: "Unnest", action: "unnestBlockquote" },
  ],
});

// --- Insert Group ---
const INSERT_GROUP: ToolbarGroup = buildGroup({
  id: "insert",
  label: "Insert",
  icon: icons.insert,
  items: [
    { id: "insert-image", icon: icons.image, label: "Image", shortcutId: "insertImage", action: "insertImage" },
    { id: "insert-video", icon: icons.video, label: "Video", action: "insertVideo" },
    { id: "insert-audio", icon: icons.audio, label: "Audio", action: "insertAudio" },
    { id: "insert-code-block", icon: icons.codeBlock, label: "Code Block", shortcutId: "codeBlock", action: "insertCodeBlock" },
    { id: "insert-diagram", icon: icons.diagram, label: "Diagram", shortcutId: "diagram", action: "insertDiagram" },
    { id: "insert-graphviz", icon: icons.diagram, label: "Graphviz", action: "insertGraphvizDiagram" },
    { id: "insert-mindmap", icon: icons.diagram, label: "Mindmap", shortcutId: "mindmap", action: "insertMarkmap" },
    { id: "insert-math", icon: icons.math, label: "Math Block", shortcutId: "mathBlock", action: "insertMath" },
    { id: "insert-details", icon: icons.expand, label: "Details", action: "insertDetails" },
    { id: "insert-alert-note", icon: icons.alertIcon, label: "Alert Note", action: "insertAlertNote" },
    { id: "insert-alert-tip", icon: icons.alertIcon, label: "Alert Tip", action: "insertAlertTip" },
    { id: "insert-alert-important", icon: icons.alertIcon, label: "Alert Important", action: "insertAlertImportant" },
    { id: "insert-alert-warning", icon: icons.alertIcon, label: "Alert Warning", action: "insertAlertWarning" },
    { id: "insert-alert-caution", icon: icons.alertIcon, label: "Alert Caution", action: "insertAlertCaution" },
    { id: "insert-divider", icon: icons.divider, label: "Divider", shortcutId: "horizontalLine", action: "insertDivider" },
  ],
});

// --- Link Group (consolidated) ---
const LINK_GROUP: ToolbarGroup = buildGroup({
  id: "link",
  label: "Link",
  icon: icons.link,
  items: [
    { id: "link", icon: icons.link, label: "Hyperlink", shortcutId: "link", action: "link" },
    { id: "bookmark", icon: icons.hash, label: "Bookmark", action: "link:bookmark" },
    { id: "wikiLink", icon: icons.fileText, label: "Wiki Link", action: "link:wiki" },
    { id: "footnote", icon: icons.footnote, label: "Footnote", action: "insertFootnote" },
  ],
});

/** All toolbar groups in spec order */
export const TOOLBAR_GROUPS: ToolbarGroup[] = [
  BLOCK_GROUP,
  INLINE_GROUP,
  LIST_GROUP,
  TABLE_GROUP,
  BLOCKQUOTE_GROUP,
  LINK_GROUP,
  INSERT_GROUP,
];

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
