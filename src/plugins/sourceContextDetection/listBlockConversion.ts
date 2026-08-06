/**
 * Whole-list type conversion for source mode.
 *
 * Purpose: changing a list's type is a change to the LIST, not to the line the
 * cursor happens to be on. Rewriting one marker turned `- one` / `- two` /
 * `- three` into three separate lists, which is what source mode used to do
 * while WYSIWYG converted the whole thing.
 *
 * Key decisions:
 *   - The INNERMOST enclosing list is the unit. A caret in a nested item
 *     converts that sub-list and leaves its parent's other items alone; a
 *     selection reaching out to shallower items widens the unit accordingly.
 *   - Ordered numbering restarts per indent level, so a nested run counts from
 *     1 under each parent instead of continuing the outer sequence.
 *   - Converting to a task list PRESERVES an existing checkbox state — on
 *     bullet AND ordered tasks (both are valid GFM); only an item that was not
 *     already a task starts unchecked.
 *
 * @coordinates-with listBlockBounds.ts — the span this conversion rewrites
 * @coordinates-with listMarkerParsing.ts — the shared marker grammar
 * @coordinates-with shared/blockSpan.ts — the rule that a list is one block
 * @coordinates-with formatToolbar/nodeActions.tiptap.ts — the WYSIWYG counterpart
 * @module plugins/sourceContextDetection/listBlockConversion
 */
import type { EditorView } from "@codemirror/view";
import { getListBlockBounds } from "./listBlockBounds";
import { parseListMarker, type ListMarker } from "./listMarkerParsing";

/** Target type for a whole-list conversion. */
export type ListTypeTarget = "bullet" | "ordered" | "task";

/**
 * Convert EVERY item of the list at the cursor to `target`.
 *
 * The single-line converters in listMutations rewrite only the cursor's own
 * marker, which turns one list into three: `- one` / `1. two` / `- three`. A
 * list is one block (see `shared/blockSpan`), so changing its type changes all
 * of it — which is what WYSIWYG has always done.
 *
 * Ordered numbering restarts per indent level, so a nested list numbers itself
 * from 1 under each parent rather than continuing the outer sequence.
 */
export function convertListBlock(view: EditorView, target: ListTypeTarget): void {
  const bounds = getListBlockBounds(view);
  if (!bounds) return;

  const { state, dispatch } = view;
  const blockFirst = state.doc.lineAt(bounds.from).number;
  const blockLast = state.doc.lineAt(bounds.to).number;
  const { firstLine, lastLine } = innermostListRange(view, blockFirst, blockLast);

  // One counter per indent width; entering a shallower level clears the deeper
  // ones so the next nested run starts at 1 again.
  const counters = new Map<number, number>();

  const rewritten: string[] = [];
  for (let n = firstLine; n <= lastLine; n += 1) {
    const text = state.doc.line(n).text;
    const parsed = parseListMarker(text);
    // Blanks, continuation lines, and thematic breaks pass through untouched.
    if (!parsed) {
      rewritten.push(text);
      continue;
    }

    const indent = parsed.indent;
    for (const width of [...counters.keys()]) {
      if (width > indent.length) counters.delete(width);
    }

    rewritten.push(`${indent}${markerFor(target, indent.length, counters, parsed)}${parsed.content}`);
  }

  dispatch(
    state.update({
      changes: {
        from: state.doc.line(firstLine).from,
        to: state.doc.line(lastLine).to,
        insert: rewritten.join("\n"),
      },
      scrollIntoView: true,
    }),
  );
  view.focus();
}

/**
 * The INNERMOST list the selection sits in, as a line range.
 *
 * With the cursor inside a nested item, converting the whole outer list also
 * rewrites siblings the user never pointed at. The innermost enclosing list is
 * the precise reading, and the one WYSIWYG takes: the sub-list is bounded by the
 * first line shallower than the selection's own indent on either side.
 *
 * A RANGE that reaches out to shallower items widens the base accordingly, so
 * selecting the whole structure still converts the whole structure.
 */
function innermostListRange(
  view: EditorView,
  blockFirst: number,
  blockLast: number,
): { firstLine: number; lastLine: number } {
  const { doc, selection } = view.state;
  const selFirst = doc.lineAt(selection.main.from).number;
  const selLast = doc.lineAt(selection.main.to).number;

  const indentOf = (n: number): number => /^(\s*)/.exec(doc.line(n).text)?.[1].length ?? 0;

  // The base indent comes from the selected MARKER lines only: a blank line
  // in a loose selection has indent zero and would widen a nested conversion
  // out to the whole outer list.
  let base = Infinity;
  for (let n = selFirst; n <= selLast; n += 1) {
    const parsed = parseListMarker(doc.line(n).text);
    if (parsed) base = Math.min(base, parsed.indent.length);
  }
  /* v8 ignore next 2 -- @preserve reason: bounds guarantee the cursor line is a marker line */
  if (!Number.isFinite(base)) return { firstLine: blockFirst, lastLine: blockLast };

  let firstLine = Math.max(selFirst, blockFirst);
  let lastLine = Math.min(selLast, blockLast);
  while (firstLine > blockFirst && indentOf(firstLine - 1) >= base) firstLine -= 1;
  while (lastLine < blockLast && indentOf(lastLine + 1) >= base) lastLine += 1;
  return { firstLine, lastLine };
}

/** The marker a converted line should carry, advancing the ordered counter. */
function markerFor(
  target: ListTypeTarget,
  indentWidth: number,
  counters: Map<number, number>,
  parsed: ListMarker,
): string {
  if (target === "bullet") return "- ";
  if (target === "task") {
    // An item that is ALREADY a task — bullet or ordered — keeps whether it
    // was ticked; converting a plain item starts it unchecked.
    return `- [${parsed.checkboxChar ?? " "}] `;
  }
  const next = (counters.get(indentWidth) ?? 0) + 1;
  counters.set(indentWidth, next);
  return `${next}. `;
}
