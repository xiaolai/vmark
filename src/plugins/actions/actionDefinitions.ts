/**
 * Action Definitions
 *
 * Single source of truth for all editor action metadata — labels, categories,
 * and per-mode capability flags (wysiwyg/source).
 *
 * Extracted from actionRegistry.ts to keep files under ~300 lines.
 *
 * @coordinates-with actionRegistry.ts — registry logic and dev-time validation
 * @coordinates-with types.ts — defines ActionId, ActionDefinition
 * @module plugins/actions/actionDefinitions
 */

import type { ActionId, ActionDefinition } from "./types";

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
  nestBlockquote: {
    id: "nestBlockquote",
    label: "Nest Blockquote",
    category: "blockquote",
    supports: { wysiwyg: true, source: true },
  },
  unnestBlockquote: {
    id: "unnestBlockquote",
    label: "Unnest Blockquote",
    category: "blockquote",
    supports: { wysiwyg: true, source: true },
  },
  removeBlockquote: {
    id: "removeBlockquote",
    label: "Remove Blockquote",
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
  insertVideo: {
    id: "insertVideo",
    label: "Insert Video",
    category: "inserts",
    supports: { wysiwyg: true, source: true },
  },
  insertAudio: {
    id: "insertAudio",
    label: "Insert Audio",
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
