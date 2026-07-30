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
 *   - The selection-consuming builders fold in the whole top-level BLOCKS the
 *     selection spans (`shared/blockSpan`), because whole blocks are what the
 *     insertion replaces. Folding in only the selected characters silently
 *     deleted the rest of the line.
 *   - Block CONTENT comes from `shared/blockTemplates`, not from literals here.
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
import { newTableMarkdown } from "@/plugins/shared/blockTemplates";
import { applyInlineFormat } from "./sourceAdapterHelpers";
import { insertBlockText, prependLineMarker, replaceLinesWithBlock } from "./sourceBlockPlacement";
import { sourceBlockSpan } from "@/plugins/shared/blockSpan";
import { stripBlockMarkup } from "@/plugins/shared/lineContent";

/** Caret lands inside the first header cell: `| ` is two characters. */
const FIRST_CELL_OFFSET = 2;

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

  const all = Array.from({ length: doc.lines }, (_, i) => doc.line(i + 1).text);
  const span = sourceBlockSpan(all, doc.lineAt(from).number - 1, doc.lineAt(to).number - 1);
  const blockFrom = doc.line(span.start + 1).from;
  const blockTo = doc.line(span.end + 1).to;

  // A code block holds the block's TEXT, not the markup that made it a heading
  // or a list item — `### Title` becomes a fence containing `Title`, which is
  // what WYSIWYG produces because it fences the node's content. Indentation
  // survives, since with the markers gone it is all that shows the nesting.
  const parts = all.slice(span.start, span.end + 1).map(stripBlockMarkup);
  const quote = parts[0]?.quote ?? "";
  const body = parts.map((p) => `${p.indent}${p.content}`).join(`\n${quote}`);

  // The quote wrapper stays OUTSIDE the fence: a block converted inside a
  // blockquote is still inside it. Source used to replace the quote outright.
  const fenced = `${quote}\`\`\`plaintext\n${quote}${body}\n${quote}\`\`\``;

  view.dispatch({
    changes: { from: blockFrom, to: blockTo, insert: fenced },
    // Caret onto the first line of the converted content.
    selection: { anchor: blockFrom + `${quote}\`\`\`plaintext\n${quote}`.length },
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
  insertBlockText(view, newTableMarkdown(), FIRST_CELL_OFFSET);
  return true;
}

export function insertListMarker(view: EditorView, marker: string): boolean {
  return prependLineMarker(view, marker);
}

/**
 * Insert a block built from the current selection (details/math/diagram fences).
 *
 * The builder folds the selection INTO the block, so a non-empty selection has
 * to be REPLACED — inserting below would leave the original behind and duplicate
 * it inside the block.
 *
 * What gets folded in is the whole top-level BLOCKS the selection spans — see
 * `shared/blockSpan` for why that, and not lines or characters. Folding in just
 * the selected characters while replacing whole lines made the two disagree and
 * silently deleted the rest of the line: selecting `brown` in
 * `The quick brown fox` and inserting a note left `> [!NOTE]\n> brown` and
 * nothing else.
 */
export function handleBuildInsert(
  view: EditorView,
  build: (selection: string) => InsertionResult,
): boolean {
  const { doc, selection } = view.state;
  const { from, to } = selection.main;

  if (from === to) {
    const { text, cursorOffset } = build("");
    insertBlockText(view, text, cursorOffset);
    return true;
  }

  // Whole top-level blocks, not merely whole lines: wrapping one item of a list
  // shatters it into list / wrapped-item / list. `blockSpan` is the one place
  // that decides this, shared with the WYSIWYG side.
  const all = Array.from({ length: doc.lines }, (_, i) => doc.line(i + 1).text);
  const span = sourceBlockSpan(all, doc.lineAt(from).number - 1, doc.lineAt(to).number - 1);
  const spanned = doc.sliceString(doc.line(span.start + 1).from, doc.line(span.end + 1).to);

  const { text, cursorOffset } = build(spanned);
  replaceLinesWithBlock(view, text, cursorOffset, {
    from: doc.line(span.start + 1).from,
    to: doc.line(span.end + 1).to,
  });
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
