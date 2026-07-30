/**
 * Source Insert Actions
 *
 * Purpose: Insertion handlers for source (CodeMirror) mode toolbar actions —
 * simple insertions (footnote, code block, divider, table, list markers) and
 * selection-aware block builders (details, alerts, math, diagram fences).
 *
 * Key decisions:
 *   - WHERE a block lands is `sourceBlockPlacement`'s concern, not this file's.
 *   - `insertCodeBlock` CONVERTS the current block rather than inserting an
 *     empty fence: the public action is the `codeBlock` toggle and the guide
 *     promises "Convert to code". Only the name here says insert.
 *
 * @coordinates-with sourceAdapter.ts — dispatcher routes insert actions here
 * @coordinates-with sourceBlockPlacement.ts — the placement helpers
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
import { applyInlineFormat } from "./sourceAdapterHelpers";
import { insertBlockText, prependLineMarker, replaceLinesWithBlock } from "./sourceBlockPlacement";

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

/**
 * Convert the current block — or the selected lines — into one code block.
 *
 * This action is a block TOGGLE, not an insertion: the public id is `codeBlock`,
 * the command registry maps it here, and the user guide promises "Convert to
 * code". Only this adapter's internal name says "insert". Source used to open an
 * empty fence and leave the paragraph alone, contradicting all three, while
 * WYSIWYG converted.
 *
 * A caret expands to the surrounding block (the contiguous run of non-blank
 * lines), matching what `setCodeBlock` converts in WYSIWYG. An empty paragraph
 * naturally yields an empty fence, which is what the old behavior produced and
 * why that case is unchanged.
 *
 * The `plaintext` language is deliberate, not noise: the WYSIWYG code-block
 * extension is configured with `defaultLanguage: "plaintext"` to stop
 * `lowlight.highlightAuto()` mis-detecting, so omitting it here would leave the
 * two surfaces producing different documents for the same action.
 */
export function insertCodeBlock(view: EditorView): boolean {
  const { doc, selection } = view.state;
  const { from, to } = selection.main;

  let firstLine = doc.lineAt(from).number;
  let lastLine = doc.lineAt(to).number;
  if (from === to) {
    while (firstLine > 1 && doc.line(firstLine - 1).text.trim() !== "") firstLine -= 1;
    while (lastLine < doc.lines && doc.line(lastLine + 1).text.trim() !== "") lastLine += 1;
  }

  const blockFrom = doc.line(firstLine).from;
  const blockTo = doc.line(lastLine).to;
  const fenced = `\`\`\`plaintext\n${doc.sliceString(blockFrom, blockTo)}\n\`\`\``;

  view.dispatch({
    changes: { from: blockFrom, to: blockTo, insert: fenced },
    // Caret onto the first line of the converted content.
    selection: { anchor: blockFrom + "```plaintext\n".length },
  });
  view.focus();
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
  return prependLineMarker(view, marker);
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
