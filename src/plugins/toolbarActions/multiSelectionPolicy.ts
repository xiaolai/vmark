/**
 * Multi-Selection Policy
 *
 * Purpose: Defines per-action rules for what toolbar actions are allowed when
 * multiple cursors are active. "allow" = always works, "deny" = disabled,
 * "conditional" = depends on whether all cursors share the same structural context.
 *
 * @coordinates-with enableRules.ts — calls canRunActionInMultiSelection
 * @coordinates-with multiSelectionContext.ts — provides the context for conditional checks
 * @module plugins/toolbarActions/multiSelectionPolicy
 */
import type { MultiSelectionContext, MultiSelectionPolicy } from "./types";

const MULTI_SELECTION_POLICY: Record<string, MultiSelectionPolicy> = {
  bold: "allow",
  italic: "allow",
  underline: "allow",
  strikethrough: "allow",
  highlight: "allow",
  superscript: "allow",
  subscript: "allow",
  code: "allow",
  clearFormatting: "allow",
  heading: "conditional",
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
};

export function getMultiSelectionPolicyForAction(action: string): MultiSelectionPolicy {
  return MULTI_SELECTION_POLICY[action] ?? "disallow";
}

export function canRunActionInMultiSelection(
  action: string,
  multi: MultiSelectionContext | undefined
): boolean {
  if (!multi?.enabled) return true;

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
