/**
 * Action Registry
 *
 * Purpose: Single source of truth for mapping Tauri menu events to editor actions,
 * with metadata (label, category, mode capability) for each action.
 *
 * Pipeline: Tauri menu event → MENU_TO_ACTION lookup → action dispatch → mode-specific adapter
 *
 * Key decisions:
 *   - Menu IDs are validated against shared/menu-ids.json at dev time to catch Rust/TS drift
 *   - Actions declare per-mode capability (wysiwyg/source) so dispatchers can skip unsupported ops
 *
 * @coordinates-with types.ts — defines ActionId, ActionDefinition, and related types
 * @coordinates-with shared/menu-ids.json — Rust-extracted menu IDs used for dev-time validation
 * @module plugins/actions/actionRegistry
 */

import type {
  ActionId,
  ActionDefinition,
  MenuEventId,
  MenuActionMapping,
  HeadingLevel,
} from "./types";
import menuIdsData from "@shared/menu-ids.json";

// Type assertion for JSON import
const menuIds = menuIdsData as { menuIds: string[]; allMenuIds: string[] };

/**
 * Menu event to action mapping.
 *
 * Maps Tauri menu events (e.g., "menu:bold") to action IDs and optional params.
 * This is the canonical mapping used by the unified menu dispatcher.
 */
export const MENU_TO_ACTION: Record<MenuEventId, MenuActionMapping> = {
  // === Edit ===
  "menu:undo": { actionId: "undo" },
  "menu:redo": { actionId: "redo" },

  // === Inline Formatting ===
  "menu:bold": { actionId: "bold" },
  "menu:italic": { actionId: "italic" },
  "menu:underline": { actionId: "underline" },
  "menu:strikethrough": { actionId: "strikethrough" },
  "menu:code": { actionId: "code" },
  "menu:subscript": { actionId: "subscript" },
  "menu:superscript": { actionId: "superscript" },
  "menu:highlight": { actionId: "highlight" },
  "menu:clear-format": { actionId: "clearFormatting" },

  // === Links ===
  "menu:link": { actionId: "link" },
  "menu:wiki-link": { actionId: "wikiLink" },
  "menu:bookmark": { actionId: "bookmark" },

  // === Headings ===
  "menu:heading-1": { actionId: "setHeading", params: { level: 1 } },
  "menu:heading-2": { actionId: "setHeading", params: { level: 2 } },
  "menu:heading-3": { actionId: "setHeading", params: { level: 3 } },
  "menu:heading-4": { actionId: "setHeading", params: { level: 4 } },
  "menu:heading-5": { actionId: "setHeading", params: { level: 5 } },
  "menu:heading-6": { actionId: "setHeading", params: { level: 6 } },
  "menu:paragraph": { actionId: "paragraph" },
  "menu:increase-heading": { actionId: "increaseHeading" },
  "menu:decrease-heading": { actionId: "decreaseHeading" },

  // === Blockquote ===
  "menu:quote": { actionId: "blockquote" },
  "menu:nest-quote": { actionId: "nestQuote" },
  "menu:unnest-quote": { actionId: "unnestQuote" },

  // === Code Block ===
  "menu:code-fences": { actionId: "codeBlock" },

  // === Lists ===
  "menu:unordered-list": { actionId: "bulletList" },
  "menu:ordered-list": { actionId: "orderedList" },
  "menu:task-list": { actionId: "taskList" },
  "menu:indent": { actionId: "indent" },
  "menu:outdent": { actionId: "outdent" },
  "menu:remove-list": { actionId: "removeList" },

  // === Tables ===
  "menu:insert-table": { actionId: "insertTable" },
  "menu:add-row-before": { actionId: "addRowAbove" },
  "menu:add-row-after": { actionId: "addRowBelow" },
  "menu:add-col-before": { actionId: "addColLeft" },
  "menu:add-col-after": { actionId: "addColRight" },
  "menu:delete-row": { actionId: "deleteRow" },
  "menu:delete-col": { actionId: "deleteCol" },
  "menu:delete-table": { actionId: "deleteTable" },
  "menu:align-left": { actionId: "alignLeft" },
  "menu:align-center": { actionId: "alignCenter" },
  "menu:align-right": { actionId: "alignRight" },
  "menu:align-all-left": { actionId: "alignAllLeft" },
  "menu:align-all-center": { actionId: "alignAllCenter" },
  "menu:align-all-right": { actionId: "alignAllRight" },
  "menu:format-table": { actionId: "formatTable" },

  // === Inserts ===
  "menu:image": { actionId: "insertImage" },
  "menu:footnote": { actionId: "insertFootnote" },
  "menu:math-block": { actionId: "insertMath" },
  "menu:diagram": { actionId: "insertDiagram" },
  "menu:mindmap": { actionId: "insertMarkmap" },
  "menu:horizontal-line": { actionId: "horizontalLine" },
  "menu:collapsible-block": { actionId: "insertDetails" },
  "menu:info-note": { actionId: "insertAlertNote" },
  "menu:info-tip": { actionId: "insertAlertTip" },
  "menu:info-important": { actionId: "insertAlertImportant" },
  "menu:info-warning": { actionId: "insertAlertWarning" },
  "menu:info-caution": { actionId: "insertAlertCaution" },

  // === Selection ===
  "menu:select-word": { actionId: "selectWord" },
  "menu:select-line": { actionId: "selectLine" },
  "menu:select-block": { actionId: "selectBlock" },
  "menu:expand-selection": { actionId: "expandSelection" },

  // === CJK ===
  "menu:format-cjk": { actionId: "formatCJK" },
  "menu:format-cjk-file": { actionId: "formatCJKFile" },
  "menu:toggle-quote-style": { actionId: "toggleQuoteStyle" },

  // === Text Cleanup ===
  "menu:remove-trailing-spaces": { actionId: "removeTrailingSpaces" },
  "menu:collapse-blank-lines": { actionId: "collapseBlankLines" },
  "menu:line-endings-lf": { actionId: "lineEndingsLF" },
  "menu:line-endings-crlf": { actionId: "lineEndingsCRLF" },

  // === Line Operations ===
  "menu:move-line-up": { actionId: "moveLineUp" },
  "menu:move-line-down": { actionId: "moveLineDown" },
  "menu:duplicate-line": { actionId: "duplicateLine" },
  "menu:delete-line": { actionId: "deleteLine" },
  "menu:join-lines": { actionId: "joinLines" },
  "menu:sort-lines-asc": { actionId: "sortLinesAsc" },
  "menu:sort-lines-desc": { actionId: "sortLinesDesc" },
  "menu:remove-blank-lines": { actionId: "removeBlankLines" },

  // === Text Transformations ===
  "menu:transform-uppercase": { actionId: "transformUppercase" },
  "menu:transform-lowercase": { actionId: "transformLowercase" },
  "menu:transform-title-case": { actionId: "transformTitleCase" },
  "menu:transform-toggle-case": { actionId: "transformToggleCase" },
};

/**
 * Action definitions with capability metadata.
 *
 * Each action specifies whether it's supported in WYSIWYG and/or Source mode.
 */
export const ACTION_DEFINITIONS: Record<ActionId, ActionDefinition> = {
  // === Edit ===
  undo: {
    id: "undo",
    label: "Undo",
    category: "edit",
    supports: { wysiwyg: true, source: true },
  },
  redo: {
    id: "redo",
    label: "Redo",
    category: "edit",
    supports: { wysiwyg: true, source: true },
  },

  // === Inline Formatting ===
  bold: {
    id: "bold",
    label: "Bold",
    category: "formatting",
    supports: { wysiwyg: true, source: true },
  },
  italic: {
    id: "italic",
    label: "Italic",
    category: "formatting",
    supports: { wysiwyg: true, source: true },
  },
  code: {
    id: "code",
    label: "Inline Code",
    category: "formatting",
    supports: { wysiwyg: true, source: true },
  },
  strikethrough: {
    id: "strikethrough",
    label: "Strikethrough",
    category: "formatting",
    supports: { wysiwyg: true, source: true },
  },
  underline: {
    id: "underline",
    label: "Underline",
    category: "formatting",
    supports: { wysiwyg: true, source: true },
  },
  highlight: {
    id: "highlight",
    label: "Highlight",
    category: "formatting",
    supports: { wysiwyg: true, source: true },
  },
  subscript: {
    id: "subscript",
    label: "Subscript",
    category: "formatting",
    supports: { wysiwyg: true, source: true },
  },
  superscript: {
    id: "superscript",
    label: "Superscript",
    category: "formatting",
    supports: { wysiwyg: true, source: true },
  },
  clearFormatting: {
    id: "clearFormatting",
    label: "Clear Formatting",
    category: "formatting",
    supports: { wysiwyg: true, source: true },
  },

  // === Links ===
  link: {
    id: "link",
    label: "Link",
    category: "links",
    supports: { wysiwyg: true, source: true },
  },
  wikiLink: {
    id: "wikiLink",
    label: "Wiki Link",
    category: "links",
    supports: { wysiwyg: true, source: true },
  },
  bookmark: {
    id: "bookmark",
    label: "Bookmark",
    category: "links",
    supports: { wysiwyg: true, source: true },
  },

  // === Headings ===
  setHeading: {
    id: "setHeading",
    label: "Set Heading",
    category: "headings",
    supports: { wysiwyg: true, source: true },
    defaultParams: { level: 1 },
  },
  paragraph: {
    id: "paragraph",
    label: "Paragraph",
    category: "headings",
    supports: { wysiwyg: true, source: true },
  },
  increaseHeading: {
    id: "increaseHeading",
    label: "Increase Heading Level",
    category: "headings",
    supports: { wysiwyg: true, source: true },
  },
  decreaseHeading: {
    id: "decreaseHeading",
    label: "Decrease Heading Level",
    category: "headings",
    supports: { wysiwyg: true, source: true },
  },

  // === Blockquote ===
  blockquote: {
    id: "blockquote",
    label: "Blockquote",
    category: "blockquote",
    supports: { wysiwyg: true, source: true },
  },
  nestQuote: {
    id: "nestQuote",
    label: "Nest Quote",
    category: "blockquote",
    supports: { wysiwyg: true, source: true },
  },
  unnestQuote: {
    id: "unnestQuote",
    label: "Unnest Quote",
    category: "blockquote",
    supports: { wysiwyg: true, source: true },
  },
  removeQuote: {
    id: "removeQuote",
    label: "Remove Quote",
    category: "blockquote",
    supports: { wysiwyg: true, source: true },
  },

  // === Code Block ===
  codeBlock: {
    id: "codeBlock",
    label: "Code Block",
    category: "codeBlock",
    supports: { wysiwyg: true, source: true },
  },

  // === Lists ===
  bulletList: {
    id: "bulletList",
    label: "Bullet List",
    category: "lists",
    supports: { wysiwyg: true, source: true },
  },
  orderedList: {
    id: "orderedList",
    label: "Ordered List",
    category: "lists",
    supports: { wysiwyg: true, source: true },
  },
  taskList: {
    id: "taskList",
    label: "Task List",
    category: "lists",
    supports: { wysiwyg: true, source: true },
  },
  indent: {
    id: "indent",
    label: "Indent",
    category: "lists",
    supports: { wysiwyg: true, source: true },
  },
  outdent: {
    id: "outdent",
    label: "Outdent",
    category: "lists",
    supports: { wysiwyg: true, source: true },
  },
  removeList: {
    id: "removeList",
    label: "Remove List",
    category: "lists",
    supports: { wysiwyg: true, source: true },
  },

  // === Tables ===
  insertTable: {
    id: "insertTable",
    label: "Insert Table",
    category: "tables",
    supports: { wysiwyg: true, source: true },
  },
  addRowAbove: {
    id: "addRowAbove",
    label: "Add Row Above",
    category: "tables",
    supports: { wysiwyg: true, source: true },
  },
  addRowBelow: {
    id: "addRowBelow",
    label: "Add Row Below",
    category: "tables",
    supports: { wysiwyg: true, source: true },
  },
  addColLeft: {
    id: "addColLeft",
    label: "Add Column Left",
    category: "tables",
    supports: { wysiwyg: true, source: true },
  },
  addColRight: {
    id: "addColRight",
    label: "Add Column Right",
    category: "tables",
    supports: { wysiwyg: true, source: true },
  },
  deleteRow: {
    id: "deleteRow",
    label: "Delete Row",
    category: "tables",
    supports: { wysiwyg: true, source: true },
  },
  deleteCol: {
    id: "deleteCol",
    label: "Delete Column",
    category: "tables",
    supports: { wysiwyg: true, source: true },
  },
  deleteTable: {
    id: "deleteTable",
    label: "Delete Table",
    category: "tables",
    supports: { wysiwyg: true, source: true },
  },
  alignLeft: {
    id: "alignLeft",
    label: "Align Left",
    category: "tables",
    supports: { wysiwyg: true, source: true },
  },
  alignCenter: {
    id: "alignCenter",
    label: "Align Center",
    category: "tables",
    supports: { wysiwyg: true, source: true },
  },
  alignRight: {
    id: "alignRight",
    label: "Align Right",
    category: "tables",
    supports: { wysiwyg: true, source: true },
  },
  alignAllLeft: {
    id: "alignAllLeft",
    label: "Align All Left",
    category: "tables",
    supports: { wysiwyg: true, source: true },
  },
  alignAllCenter: {
    id: "alignAllCenter",
    label: "Align All Center",
    category: "tables",
    supports: { wysiwyg: true, source: true },
  },
  alignAllRight: {
    id: "alignAllRight",
    label: "Align All Right",
    category: "tables",
    supports: { wysiwyg: true, source: true },
  },
  formatTable: {
    id: "formatTable",
    label: "Format Table",
    category: "tables",
    supports: { wysiwyg: true, source: true },
  },

  // === Inserts ===
  insertImage: {
    id: "insertImage",
    label: "Insert Image",
    category: "inserts",
    supports: { wysiwyg: true, source: true },
  },
  insertFootnote: {
    id: "insertFootnote",
    label: "Insert Footnote",
    category: "inserts",
    supports: { wysiwyg: true, source: true },
  },
  insertMath: {
    id: "insertMath",
    label: "Insert Math Block",
    category: "inserts",
    supports: { wysiwyg: true, source: true },
  },
  insertDiagram: {
    id: "insertDiagram",
    label: "Insert Diagram",
    category: "inserts",
    supports: { wysiwyg: true, source: true },
  },
  insertMarkmap: {
    id: "insertMarkmap",
    label: "Insert Mindmap",
    category: "inserts",
    supports: { wysiwyg: true, source: true },
  },
  insertInlineMath: {
    id: "insertInlineMath",
    label: "Insert Inline Math",
    category: "inserts",
    supports: { wysiwyg: true, source: true },
  },
  insertDetails: {
    id: "insertDetails",
    label: "Insert Collapsible Block",
    category: "inserts",
    supports: { wysiwyg: true, source: true },
  },
  insertAlertNote: {
    id: "insertAlertNote",
    label: "Insert Note",
    category: "inserts",
    supports: { wysiwyg: true, source: true },
  },
  insertAlertTip: {
    id: "insertAlertTip",
    label: "Insert Tip",
    category: "inserts",
    supports: { wysiwyg: true, source: true },
  },
  insertAlertWarning: {
    id: "insertAlertWarning",
    label: "Insert Warning",
    category: "inserts",
    supports: { wysiwyg: true, source: true },
  },
  insertAlertImportant: {
    id: "insertAlertImportant",
    label: "Insert Important",
    category: "inserts",
    supports: { wysiwyg: true, source: true },
  },
  insertAlertCaution: {
    id: "insertAlertCaution",
    label: "Insert Caution",
    category: "inserts",
    supports: { wysiwyg: true, source: true },
  },
  horizontalLine: {
    id: "horizontalLine",
    label: "Horizontal Line",
    category: "inserts",
    supports: { wysiwyg: true, source: true },
  },

  // === Selection ===
  selectWord: {
    id: "selectWord",
    label: "Select Word",
    category: "selection",
    supports: { wysiwyg: true, source: true },
  },
  selectLine: {
    id: "selectLine",
    label: "Select Line",
    category: "selection",
    supports: { wysiwyg: true, source: true },
  },
  selectBlock: {
    id: "selectBlock",
    label: "Select Block",
    category: "selection",
    supports: { wysiwyg: true, source: true },
  },
  expandSelection: {
    id: "expandSelection",
    label: "Expand Selection",
    category: "selection",
    supports: { wysiwyg: true, source: true },
  },

  // === CJK ===
  formatCJK: {
    id: "formatCJK",
    label: "Format CJK Selection",
    category: "cjk",
    supports: { wysiwyg: true, source: true },
  },
  formatCJKFile: {
    id: "formatCJKFile",
    label: "Format CJK File",
    category: "cjk",
    supports: { wysiwyg: true, source: true },
  },
  toggleQuoteStyle: {
    id: "toggleQuoteStyle",
    label: "Toggle Quote Style",
    category: "cjk",
    supports: { wysiwyg: true, source: false },
  },

  // === Text Cleanup ===
  removeTrailingSpaces: {
    id: "removeTrailingSpaces",
    label: "Remove Trailing Spaces",
    category: "cleanup",
    supports: { wysiwyg: true, source: true },
  },
  collapseBlankLines: {
    id: "collapseBlankLines",
    label: "Collapse Blank Lines",
    category: "cleanup",
    supports: { wysiwyg: true, source: true },
  },
  lineEndingsLF: {
    id: "lineEndingsLF",
    label: "Convert to LF",
    category: "cleanup",
    supports: { wysiwyg: true, source: true },
  },
  lineEndingsCRLF: {
    id: "lineEndingsCRLF",
    label: "Convert to CRLF",
    category: "cleanup",
    supports: { wysiwyg: true, source: true },
  },

  // === Line Operations ===
  moveLineUp: {
    id: "moveLineUp",
    label: "Move Line Up",
    category: "lines",
    supports: { wysiwyg: true, source: true },
  },
  moveLineDown: {
    id: "moveLineDown",
    label: "Move Line Down",
    category: "lines",
    supports: { wysiwyg: true, source: true },
  },
  duplicateLine: {
    id: "duplicateLine",
    label: "Duplicate Line",
    category: "lines",
    supports: { wysiwyg: true, source: true },
  },
  deleteLine: {
    id: "deleteLine",
    label: "Delete Line",
    category: "lines",
    supports: { wysiwyg: true, source: true },
  },
  joinLines: {
    id: "joinLines",
    label: "Join Lines",
    category: "lines",
    supports: { wysiwyg: true, source: true },
  },
  sortLinesAsc: {
    id: "sortLinesAsc",
    label: "Sort Lines Ascending",
    category: "lines",
    supports: { wysiwyg: false, source: true },
  },
  sortLinesDesc: {
    id: "sortLinesDesc",
    label: "Sort Lines Descending",
    category: "lines",
    supports: { wysiwyg: false, source: true },
  },
  removeBlankLines: {
    id: "removeBlankLines",
    label: "Remove Blank Lines",
    category: "lines",
    supports: { wysiwyg: true, source: true },
  },

  // === Text Transformations ===
  transformUppercase: {
    id: "transformUppercase",
    label: "Transform to UPPERCASE",
    category: "transform",
    supports: { wysiwyg: true, source: true },
  },
  transformLowercase: {
    id: "transformLowercase",
    label: "Transform to lowercase",
    category: "transform",
    supports: { wysiwyg: true, source: true },
  },
  transformTitleCase: {
    id: "transformTitleCase",
    label: "Transform to Title Case",
    category: "transform",
    supports: { wysiwyg: true, source: true },
  },
  transformToggleCase: {
    id: "transformToggleCase",
    label: "Toggle Case",
    category: "transform",
    supports: { wysiwyg: true, source: true },
  },
};

/**
 * Get action definition by ID.
 */
export function getActionDefinition(actionId: ActionId): ActionDefinition | undefined {
  return ACTION_DEFINITIONS[actionId];
}

/**
 * Get action mapping from menu event ID.
 */
export function getActionFromMenu(menuEvent: MenuEventId): MenuActionMapping | undefined {
  return MENU_TO_ACTION[menuEvent];
}

/**
 * Check if an action supports a specific mode.
 */
export function actionSupportsMode(actionId: ActionId, mode: "wysiwyg" | "source"): boolean {
  const def = ACTION_DEFINITIONS[actionId];
  if (!def) return false;
  return def.supports[mode];
}

/**
 * Extract heading level from params.
 */
export function getHeadingLevelFromParams(params?: Record<string, unknown>): HeadingLevel {
  const level = params?.level;
  if (typeof level === "number" && level >= 1 && level <= 6) {
    return level as HeadingLevel;
  }
  return 1;
}

/**
 * Get all menu event IDs that are mapped.
 */
export function getMappedMenuEvents(): MenuEventId[] {
  return Object.keys(MENU_TO_ACTION) as MenuEventId[];
}

// === Dev-time validation ===

if (import.meta.env.DEV) {
  const mappedMenuIds = new Set(
    Object.keys(MENU_TO_ACTION).map((k) => k.replace("menu:", ""))
  );
  const missingInRegistry = menuIds.menuIds.filter((id) => !mappedMenuIds.has(id));
  const extraInRegistry = [...mappedMenuIds].filter(
    (id) => !menuIds.menuIds.includes(id)
  );

  if (missingInRegistry.length > 0) {
    console.warn(
      "[ActionRegistry] Menu IDs from Rust missing from MENU_TO_ACTION:",
      missingInRegistry
    );
  }
  if (extraInRegistry.length > 0) {
    console.info(
      "[ActionRegistry] Extra menu IDs in MENU_TO_ACTION (not extracted from Rust):",
      extraInRegistry
    );
  }
}
