/**
 * Source Insert Actions
 *
 * Purpose: Insertion handlers for source (CodeMirror) mode toolbar actions —
 * simple insertions (footnote, code block, divider, table, list markers) and
 * selection-aware block builders (details, alerts, math, diagram fences).
 *
 * Key decisions:
 *   - BLOCK content never goes in at the caret. `insertBlockText` opens a line
 *     below the cursor's line, because splicing at the caret produced
 *     `The quick ---` and alerts that split a sentence in half.
 *   - The selection-consuming builders are the exception: they fold the
 *     selection into the block, so they must REPLACE it via
 *     `replaceLinesWithBlock` or the original text is left behind and
 *     duplicated inside the block.
 *   - A list marker belongs to the line, not the cursor, so it is prepended
 *     after the line's indentation.
 *
 * @coordinates-with sourceAdapter.ts — dispatcher routes insert actions here
 * @coordinates-with sourceAdapterHelpers.ts — the three placement helpers
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
import { insertBlockText, prependLineMarker, replaceLinesWithBlock, applyInlineFormat } from "./sourceAdapterHelpers";

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
  insertBlockText(view, "```\n\n```", 4);
  return true;
}

export function insertOrToggleBlockquote(view: EditorView): boolean {
  // Use toggleBlockquote for proper toggle behavior
  toggleBlockquote(view);
  return true;
}

export function insertDivider(view: EditorView): boolean {
  insertBlockText(view, "---\n");
  return true;
}

export function insertTable(view: EditorView): boolean {
  insertBlockText(view, TABLE_TEMPLATE, 2);
  return true;
}

export function insertListMarker(view: EditorView, marker: string): boolean {
  prependLineMarker(view, marker);
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
  // The builder folds the selection INTO the block, so a non-empty selection
  // must be replaced; inserting below it would leave the original behind and
  // duplicate it inside the block.
  if (from === to) insertBlockText(view, text, cursorOffset);
  else replaceLinesWithBlock(view, text, cursorOffset);
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
