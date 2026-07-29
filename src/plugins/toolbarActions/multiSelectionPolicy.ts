/**
 * Multi-Selection Policy
 *
 * Purpose: Defines per-action rules for what toolbar actions are allowed when
 * multiple cursors are active. "disallow" = disabled outright; "allow" and
 * "conditional" both still pass through the structural vetoes in
 * `canRunActionInMultiSelection` (code block, table, link, …) — only history
 * (undo/redo) bypasses those. "conditional" additionally requires every
 * cursor to sit in a textblock with the same block parent.
 *
 * @coordinates-with enableRules.ts — calls canRunActionInMultiSelection
 * @coordinates-with multiSelectionContext.ts — provides the context for conditional checks
 * @module plugins/toolbarActions/multiSelectionPolicy
 */
import type { MultiSelectionContext, MultiSelectionPolicy } from "./types";
import { isAdapterAction, type AdapterAction } from "./adapterActions";

// TOTAL over the adapter action vocabulary (`satisfies` below): adding an
// action id without deciding its multi-selection policy is a compile error,
// not a silent "disallow" discovered in production (that drift is exactly
// how undo/redo went missing here once).
const MULTI_SELECTION_POLICY = {
  // History must stay reachable under multi-selection — an unlisted action
  // defaults to "disallow", which silently killed undo/redo here.
  undo: "allow",
  redo: "allow",
  bold: "allow",
  italic: "allow",
  underline: "allow",
  strikethrough: "allow",
  highlight: "allow",
  superscript: "allow",
  subscript: "allow",
  code: "allow",
  clearFormatting: "allow",
  // Heading policy is keyed by level — every caller passes `heading:N`
  // (adapters build the string explicitly; toolbar items carry it literally),
  // so no bare "heading" entry exists.
  "heading:0": "conditional",
  "heading:1": "conditional",
  "heading:2": "conditional",
  "heading:3": "conditional",
  "heading:4": "conditional",
  "heading:5": "conditional",
  "heading:6": "conditional",
  bulletList: "conditional",
  orderedList: "conditional",
  taskList: "conditional",
  indent: "conditional",
  outdent: "conditional",
  removeList: "conditional",
  nestBlockquote: "conditional",
  unnestBlockquote: "conditional",
  removeBlockquote: "conditional",
  link: "disallow",
  insertImage: "disallow",
  insertCodeBlock: "disallow",
  insertBlockquote: "disallow",
  insertDivider: "disallow",
  insertMath: "disallow",
  insertTableBlock: "disallow",
  insertBulletList: "disallow",
  insertOrderedList: "disallow",
  insertTaskList: "disallow",
  insertDetails: "disallow",
  insertAlertNote: "disallow",
  insertAlertTip: "disallow",
  insertAlertImportant: "disallow",
  insertAlertWarning: "disallow",
  insertAlertCaution: "disallow",
  insertFootnote: "disallow",
  insertTable: "disallow",
  addRowAbove: "disallow",
  addRow: "disallow",
  addColLeft: "disallow",
  addCol: "disallow",
  deleteRow: "disallow",
  deleteCol: "disallow",
  deleteTable: "disallow",
  alignLeft: "disallow",
  alignCenter: "disallow",
  alignRight: "disallow",
  alignAllLeft: "disallow",
  alignAllCenter: "disallow",
  alignAllRight: "disallow",
  // Line/selection utilities and per-line transforms operate on one primary
  // selection; none are multi-cursor aware yet.
  collapseBlankLines: "disallow",
  decreaseHeading: "disallow",
  deleteLine: "disallow",
  duplicateLine: "disallow",
  expandSelection: "disallow",
  formatCJK: "disallow",
  formatCJKFile: "disallow",
  formatTable: "disallow",
  increaseHeading: "disallow",
  insertAudio: "disallow",
  insertDiagram: "disallow",
  insertGraphvizDiagram: "disallow",
  insertInlineMath: "disallow",
  insertMarkmap: "disallow",
  insertVideo: "disallow",
  joinLines: "disallow",
  lineEndingsCRLF: "disallow",
  lineEndingsLF: "disallow",
  "link:bookmark": "disallow",
  "link:wiki": "disallow",
  moveLineDown: "disallow",
  moveLineUp: "disallow",
  removeBlankLines: "disallow",
  removeTrailingSpaces: "disallow",
  selectBlock: "disallow",
  selectLine: "disallow",
  selectWord: "disallow",
  sortLinesAsc: "disallow",
  sortLinesDesc: "disallow",
  toggleQuoteStyle: "conditional",
  transformLowercase: "disallow",
  transformTitleCase: "disallow",
  transformToggleCase: "disallow",
  transformUppercase: "disallow",
  unlink: "disallow",
} satisfies Record<AdapterAction, MultiSelectionPolicy>;

export function getMultiSelectionPolicyForAction(action: string): MultiSelectionPolicy {
  // Boundary-validating lookup: unknown strings are not adapter actions and
  // get the fail-safe policy.
  return isAdapterAction(action) ? MULTI_SELECTION_POLICY[action] : "disallow";
}

export function canRunActionInMultiSelection(
  action: string,
  multi: MultiSelectionContext | undefined
): boolean {
  if (!multi?.enabled) return true;

  // History must survive EVERY multi-selection context: the structural
  // vetoes below (code block, table, link, …) exist to stop content edits
  // from mangling those nodes, but undo/redo restore prior states and are
  // always safe. Without this early return they were policy-allowed yet
  // still structurally vetoed.
  if (action === "undo" || action === "redo") return true;

  const policy = getMultiSelectionPolicyForAction(action);
  if (policy === "disallow") return false;

  if (multi.inCodeBlock) return false;
  if (multi.inTable) return false;
  if (multi.inLink || multi.inImage || multi.inInlineMath || multi.inFootnote) return false;

  if (policy === "allow") return true;

  if (!multi.inTextblock) return false;
  if (!multi.sameBlockParent) return false;

  return true;
}
