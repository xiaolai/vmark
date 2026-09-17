/**
 * Markdown block bounds for Source mode (#1418).
 *
 * WYSIWYG asks ProseMirror for the enclosing textblock. Source mode has no node
 * tree — only text — so "the current block" is what the FORMAT says it is: a run
 * of contiguous non-blank lines. Blank lines separate blocks in markdown, which
 * makes them the boundary here, and a blank line is therefore not itself a
 * block.
 *
 * A code fence takes precedence, because a fence may legally contain blank
 * lines. Deciding by the blank-line rule inside a fence would split one code
 * block in half at exactly the place a programmer put an empty line. Using the
 * fence also makes this agree with the document-wide command, which already
 * scopes to the fence — the two must not disagree about what "inside a code
 * block" means.
 *
 * @coordinates-with sourceSelectOccurrence.ts — the fence detector and the document-wide command
 * @coordinates-with plugins/multiCursor/blockBounds.ts — the WYSIWYG counterpart
 * @module plugins/codemirror/sourceBlockBounds
 */
import type { EditorState } from "@codemirror/state";
import { getCodeFenceBounds } from "./sourceSelectOccurrence";
import type { FenceBounds } from "./sourceSelectOccurrence";

/** A line with nothing but whitespace separates blocks. */
function isBlank(text: string): boolean {
  return text.trim().length === 0;
}

/**
 * Bounds of the markdown block containing `pos`, or null when there is none —
 * the cursor sits on a blank line, or the document is empty.
 *
 * Returning null rather than falling back to the whole document is deliberate:
 * a silent widening is precisely the surprise the block-scoped command exists
 * to remove.
 */
export function getMarkdownBlockBounds(state: EditorState, pos: number): FenceBounds | null {
  if (state.doc.length === 0) return null;

  const fence = getCodeFenceBounds(state, pos);
  if (fence) return fence;

  const line = state.doc.lineAt(pos);
  if (isBlank(line.text)) return null;

  let first = line.number;
  while (first > 1 && !isBlank(state.doc.line(first - 1).text)) first -= 1;

  let last = line.number;
  while (last < state.doc.lines && !isBlank(state.doc.line(last + 1).text)) last += 1;

  return { from: state.doc.line(first).from, to: state.doc.line(last).to };
}
