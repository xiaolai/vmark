/**
 * Source Insert Actions
 *
 * Purpose: Insertion handlers for source (CodeMirror) mode toolbar actions —
 * simple insertions (footnote, code block, divider, table, list markers) and
 * selection-aware block builders (details, alerts, math, diagram fences).
 *
 * @coordinates-with sourceAdapter.ts — dispatcher routes insert actions here
 * @coordinates-with sourceInsertions.ts — pure block builders (selection-preserving)
 * @module plugins/toolbarActions/sourceInsertActions
 */

import type { EditorView } from "@codemirror/view";
import {
  buildAlertBlock,
  type AlertType,
  type InsertionResult,
} from "@/plugins/sourceContextDetection/sourceInsertions";
import { toggleBlockquote } from "@/plugins/sourceContextDetection/blockquoteActions";
import { insertText, applyInlineFormat } from "./sourceAdapterHelpers";

const TABLE_TEMPLATE = "| Header 1 | Header 2 |\n| --- | --- |\n| Cell 1 | Cell 2 |\n";

/** Alert insert action IDs handled in source mode. */
type SourceAlertAction =
  | "insertAlertNote"
  | "insertAlertTip"
  | "insertAlertImportant"
  | "insertAlertWarning"
  | "insertAlertCaution";

const ALERT_TYPE_BY_ACTION: Record<SourceAlertAction, AlertType> = {
  insertAlertNote: "NOTE",
  insertAlertTip: "TIP",
  insertAlertImportant: "IMPORTANT",
  insertAlertWarning: "WARNING",
  insertAlertCaution: "CAUTION",
};

export function insertFootnote(view: EditorView): boolean {
  return applyInlineFormat(view, "footnote");
}

export function insertCodeBlock(view: EditorView): boolean {
  insertText(view, "```\n\n```", 4);
  return true;
}

export function insertOrToggleBlockquote(view: EditorView): boolean {
  // Use toggleBlockquote for proper toggle behavior
  toggleBlockquote(view);
  return true;
}

export function insertDivider(view: EditorView): boolean {
  insertText(view, "---\n");
  return true;
}

export function insertTable(view: EditorView): boolean {
  insertText(view, TABLE_TEMPLATE, 2);
  return true;
}

export function insertListMarker(view: EditorView, marker: string): boolean {
  insertText(view, marker);
  return true;
}

/** Insert a block built from the current selection (details/math/diagram fences). */
export function handleBuildInsert(
  view: EditorView,
  build: (selection: string) => InsertionResult,
): boolean {
  const { from, to } = view.state.selection.main;
  const selection = from === to ? "" : view.state.doc.sliceString(from, to);
  const { text, cursorOffset } = build(selection);
  insertText(view, text, cursorOffset);
  return true;
}

/**
 * Insert a GitHub-style alert. A non-empty selection is quoted line-by-line
 * under the alert marker instead of being discarded.
 */
export function handleInsertAlert(view: EditorView, action: SourceAlertAction): boolean {
  const alertType = ALERT_TYPE_BY_ACTION[action];
  return handleBuildInsert(view, (selection) => buildAlertBlock(alertType, selection));
}
