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
 *   - `insertCodeBlock` fences the block's CONTENT, not its markup: `### Title`
 *     yields a fence containing `Title`. An enclosing blockquote stays OUTSIDE
 *     the fence, because a block converted inside a quote is still inside it.
 *   - It is a TOGGLE: inside a fence it UNFENCES. It is the only action the
 *     executor still permits in a code block, so it has to be the way out.
 *
 * `handleBuildInsert` takes a `literalContent` flag: a fence, `$$` block or
 * diagram holds LITERAL text so block markup is stripped, while an alert or
 * `<details>` is a CONTAINER whose markdown stays markdown.
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
import { selectionBlockSpan } from "@/plugins/shared/blockSpan";
import { stripBlockMarkup } from "@/plugins/shared/lineContent";
import { enclosingFence, type EnclosingFence } from "@/plugins/shared/fenceScanner";

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
/**
 * The lines of a block reduced to the CONTENT a wrapper should contain.
 *
 * A wrapping block holds the block's TEXT, not the markup that made it a
 * heading or a list item — `### Title` becomes `Title`, which is what WYSIWYG
 * produces because it wraps the node's content. Indentation survives, since
 * with the markers gone it is all that shows the nesting.
 *
 * The wrapper's quote is the COMMON enclosing depth; whatever depth a line
 * carries beyond it is that line's own content and is re-emitted in front of
 * it. Keeping only the first line's quote silently normalised every line to
 * that depth: `> outer` + `> > inner` lost the inner `>` entirely.
 *
 * Shared by the code-block path and `handleBuildInsert` (math, diagram,
 * graphviz, markmap). Only the former had it, so wrapping a heading in `$$`
 * produced `$$\n### Title\n$$` on Source and `$$\nTitle\n$$` on WYSIWYG.
 */
function blockBodyForWrapping(lines: string[]): { quote: string; body: string } {
  const parts = lines.map(stripBlockMarkup);
  const commonDepth = Math.min(...parts.map((p) => quoteDepth(p.quote)));
  const quote = "> ".repeat(commonDepth);
  const body = parts
    .map((p) => `${"> ".repeat(quoteDepth(p.quote) - commonDepth)}${p.indent}${p.content}`)
    .join(`\n${quote}`);
  return { quote, body };
}

export function insertCodeBlock(view: EditorView): boolean {
  const { all, span, blockFrom, blockTo } = resolveBlockRange(view);

  // TOGGLE, not insert: inside a fence this UNFENCES. It is the one action left
  // available in a code block, so it has to be the way out — wrapping again
  // nested a fence inside a fence and left the caret trapped.
  const enclosing = enclosingFence(all, view.state.doc.lineAt(view.state.selection.main.from).number - 1);
  if (enclosing) return unfence(view, all, enclosing);

  // A code block holds the block's TEXT, not the markup that made it a heading
  // or a list item — `### Title` becomes a fence containing `Title`, which is
  // what WYSIWYG produces because it fences the node's content. Indentation
  // survives, since with the markers gone it is all that shows the nesting.
  const { quote, body } = blockBodyForWrapping(all.slice(span.start, span.end + 1));

  // The fence must be LONGER than any backtick run it contains, or content
  // holding a ``` line closes the block early and spills the rest outside it.
  const fence = "`".repeat(Math.max(3, longestBacktickRun(body) + 1));

  // The quote wrapper stays OUTSIDE the fence: a block converted inside a
  // blockquote is still inside it. Source used to replace the quote outright.
  const opening = `${quote}${fence}plaintext\n${quote}`;
  const fenced = `${opening}${body}\n${quote}${fence}`;

  view.dispatch({
    changes: { from: blockFrom, to: blockTo, insert: fenced },
    // Caret onto the first line of the converted content.
    selection: { anchor: blockFrom + opening.length },
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

export function insertListMarker(view: EditorView, marker: string, pos?: number): boolean {
  return prependLineMarker(view, marker, pos);
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
/**
 * @param literalContent - Whether the built block holds PLAIN TEXT rather than
 *   markdown. A code fence, `$$` math block, mermaid/graphviz/markmap diagram
 *   holds literal source, so `### Title` must enter it as `Title` — the markup
 *   is not content there. An alert or `<details>` is a CONTAINER: the markdown
 *   inside it stays markdown, and stripping it would flatten a heading into a
 *   paragraph. Getting this backwards is why three green alert actions turned
 *   red when the strip was applied to every caller.
 */
export function handleBuildInsert(
  view: EditorView,
  build: (selection: string) => InsertionResult,
  literalContent = false,
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
  const { blockFrom, blockTo } = resolveBlockRange(view);
  // Strip block markup, exactly as the code-block path does. Passing the raw
  // slice put `### ` and `- ` INSIDE the math/diagram block.
  const raw = doc.sliceString(blockFrom, blockTo);
  const wrapped = literalContent
    ? blockBodyForWrapping(raw.split("\n"))
    : { quote: "", body: raw };
  const built = build(wrapped.body);
  const quote = wrapped.quote;

  // The quote wrapper stays OUTSIDE the built block — a block converted inside
  // a blockquote is still inside it, which is what the code-block path already
  // does and what WYSIWYG produces. Dropping it lifted the block out of the
  // quote entirely.
  const { text, cursorOffset } = quote
    ? {
        text: built.text
          .split("\n")
          .map((line) => `${quote}${line}`)
          .join("\n"),
        // Each line before the caret gained `quote`, and so did its own line.
        cursorOffset:
          built.cursorOffset +
          quote.length * built.text.slice(0, built.cursorOffset).split("\n").length,
      }
    : built;

  replaceLinesWithBlock(view, text, cursorOffset, { from: blockFrom, to: blockTo });
  return true;
}

/**
 * The block range a source-mode block action operates on.
 *
 * One definition, because two copies of this drifted into two copies of the same
 * off-by-one: CodeMirror's selection `to` is exclusive, so a selection ending at
 * a line start resolved to the FOLLOWING line and dragged an untouched block in.
 */
function resolveBlockRange(view: EditorView): {
  all: string[];
  span: { start: number; end: number };
  blockFrom: number;
  blockTo: number;
} {
  const { doc, selection } = view.state;
  const { from, to } = selection.main;
  const all = Array.from({ length: doc.lines }, (_, i) => doc.line(i + 1).text);
  const span = selectionBlockSpan(all, from, to, (offset) => doc.lineAt(offset).number);
  return {
    all,
    span,
    blockFrom: doc.line(span.start + 1).from,
    blockTo: doc.line(span.end + 1).to,
  };
}

/** Replace a fenced block with its literal contents. */
function unfence(view: EditorView, all: string[], fence: EnclosingFence): boolean {
  const { doc } = view.state;
  const body = all.slice(fence.open + 1, fence.closed ? fence.close : fence.close + 1);
  const from = doc.line(fence.open + 1).from;
  const to = doc.line(fence.close + 1).to;

  view.dispatch({
    changes: { from, to, insert: body.join("\n") },
    selection: { anchor: Math.min(from, doc.length) },
  });
  view.focus();
  return true;
}

/** Longest run of consecutive backticks anywhere in `text`. */
function longestBacktickRun(text: string): number {
  return (text.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length), 0);
}

/** Nesting depth of a `stripBlockMarkup` quote wrapper — one per `>` marker. */
function quoteDepth(quote: string): number {
  return (quote.match(/>/g) ?? []).length;
}

/**
 * Insert a GitHub-style alert. A non-empty selection is quoted line-by-line
 * under the alert marker instead of being discarded.
 */
export function handleInsertAlert(view: EditorView, action: SourceAlertAction): boolean {
  const alertType = ALERT_TYPE_BY_ACTION[action];
  return handleBuildInsert(view, (selection) => buildAlertBlock(alertType, selection));
}
