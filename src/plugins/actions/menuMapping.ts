/**
 * Menu-to-Action Mapping
 *
 * Maps Tauri menu events (e.g., "menu:bold") to action IDs and optional params.
 * This is the canonical mapping used by the unified menu dispatcher.
 *
 * Extracted from actionRegistry.ts to keep files under ~300 lines.
 *
 * @coordinates-with actionRegistry.ts — registry logic and dev-time validation
 * @coordinates-with types.ts — defines MenuEventId, MenuActionMapping
 * @module plugins/actions/menuMapping
 */

import type { MenuEventId, MenuActionMapping } from "./types";

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
  "menu:nest-blockquote": { actionId: "nestBlockquote" },
  "menu:unnest-blockquote": { actionId: "unnestBlockquote" },

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
  "menu:video": { actionId: "insertVideo" },
  "menu:audio": { actionId: "insertAudio" },
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
