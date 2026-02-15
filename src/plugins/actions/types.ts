/**
 * Action System Types
 *
 * Purpose: Type-safe definitions for the unified action system that bridges
 * Tauri menu events to editor operations across both WYSIWYG and Source modes.
 *
 * Key decisions:
 *   - ACTION_IDS uses `as const` array to derive the ActionId union type at compile time
 *   - Each action declares mode capability so the dispatcher can skip unsupported ops
 *
 * @coordinates-with actionRegistry.ts — consumes these types for the runtime mapping tables
 * @module plugins/actions/types
 */

/**
 * All valid action IDs used by both WYSIWYG and Source modes.
 *
 * Naming conventions:
 * - Simple actions: verb form ("bold", "italic")
 * - Parameterized actions: base name with params ("setHeading" with { level })
 * - Insert actions: "insert" prefix ("insertTable", "insertImage")
 * - Block toggles: block type name ("blockquote", "codeBlock")
 */
export const ACTION_IDS = [
  // === Edit ===
  "undo",
  "redo",

  // === Inline Formatting ===
  "bold",
  "italic",
  "code",
  "strikethrough",
  "underline",
  "highlight",
  "subscript",
  "superscript",
  "clearFormatting",

  // === Links ===
  "link",
  "wikiLink",
  "bookmark",

  // === Headings ===
  "setHeading", // params: { level: 1-6 }
  "paragraph",
  "increaseHeading",
  "decreaseHeading",

  // === Blockquote ===
  "blockquote",
  "nestBlockquote",
  "unnestBlockquote",
  "removeBlockquote",

  // === Code Block ===
  "codeBlock",

  // === Lists ===
  "bulletList",
  "orderedList",
  "taskList",
  "indent",
  "outdent",
  "removeList",

  // === Tables ===
  "insertTable",
  "addRowAbove",
  "addRowBelow",
  "addColLeft",
  "addColRight",
  "deleteRow",
  "deleteCol",
  "deleteTable",
  "alignLeft",
  "alignCenter",
  "alignRight",
  "alignAllLeft",
  "alignAllCenter",
  "alignAllRight",
  "formatTable",

  // === Inserts ===
  "insertImage",
  "insertFootnote",
  "insertMath",
  "insertDiagram",
  "insertMarkmap",
  "insertInlineMath",
  "insertDetails",
  "insertAlertNote",
  "insertAlertTip",
  "insertAlertWarning",
  "insertAlertImportant",
  "insertAlertCaution",
  "horizontalLine",

  // === Selection ===
  "selectWord",
  "selectLine",
  "selectBlock",
  "expandSelection",

  // === CJK ===
  "formatCJK",
  "formatCJKFile",
  "toggleQuoteStyle",

  // === Text Cleanup ===
  "removeTrailingSpaces",
  "collapseBlankLines",
  "lineEndingsLF",
  "lineEndingsCRLF",

  // === Line Operations ===
  "moveLineUp",
  "moveLineDown",
  "duplicateLine",
  "deleteLine",
  "joinLines",
  "sortLinesAsc",
  "sortLinesDesc",
  "removeBlankLines",

  // === Text Transformations ===
  "transformUppercase",
  "transformLowercase",
  "transformTitleCase",
  "transformToggleCase",
] as const;

export type ActionId = (typeof ACTION_IDS)[number];

/**
 * Heading level for setHeading action
 */
export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

/**
 * Parameters for parameterized actions
 */
export interface ActionParams {
  setHeading?: { level: HeadingLevel };
}

/**
 * Mode capability flags
 */
export interface ActionCapability {
  wysiwyg: boolean;
  source: boolean;
}

/**
 * Action category for grouping in UI
 */
export type ActionCategory =
  | "edit"
  | "formatting"
  | "links"
  | "headings"
  | "blockquote"
  | "codeBlock"
  | "lists"
  | "tables"
  | "inserts"
  | "selection"
  | "cjk"
  | "cleanup"
  | "lines"
  | "transform";

/**
 * Full action definition with metadata
 */
export interface ActionDefinition {
  id: ActionId;
  label: string;
  category: ActionCategory;
  supports: ActionCapability;
  /** For parameterized actions, default params */
  defaultParams?: ActionParams[keyof ActionParams];
}

/**
 * Menu event ID format (e.g., "menu:bold")
 */
export type MenuEventId = `menu:${string}`;

/**
 * Menu to action mapping entry
 */
export interface MenuActionMapping {
  actionId: ActionId;
  params?: Record<string, unknown>;
}
