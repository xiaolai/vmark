/**
 * Text action definitions — selection, CJK, cleanup, line operations, transformations.
 *
 * Category slice of ACTION_DEFINITIONS — merged back together in
 * `actionDefinitions.ts` (the single source of truth consumers import).
 *
 * @coordinates-with actionDefinitions.ts — merges this slice into ACTION_DEFINITIONS
 * @coordinates-with types.ts — defines ActionDefinition
 * @module plugins/actions/actionDefinitionsText
 */

import type { ActionDefinition } from "./types";

export const TEXT_ACTIONS = {
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
} satisfies Record<string, ActionDefinition>;
