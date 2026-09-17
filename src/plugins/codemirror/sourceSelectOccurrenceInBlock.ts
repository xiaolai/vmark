/**
 * Source-mode "select all occurrences in the current block" (#1418).
 *
 * The document-wide command is unchanged and keeps its chord. This is a
 * sibling, not a mode: multi-cursor editing in a long document is safer when
 * the blast radius is the block you can see, and the whole-document behaviour
 * stays one key away.
 *
 * It delegates rather than reimplementing. `selectAllOccurrencesSource` takes an
 * optional `scope`, so word detection, CJK segmentation, occurrence search,
 * primary-index selection and the single-match special case are all the code
 * that already ships — the only thing this module decides is WHERE to look.
 * A second copy of that body would be a second thing to keep correct.
 *
 * @coordinates-with sourceSelectOccurrence.ts — the shared implementation
 * @coordinates-with sourceBlockBounds.ts — what "the current block" means in text
 * @coordinates-with plugins/multiCursor/occurrenceCommands.ts — the WYSIWYG counterpart
 * @module plugins/codemirror/sourceSelectOccurrenceInBlock
 */
import type { EditorState, TransactionSpec } from "@codemirror/state";
import { selectAllOccurrencesSource } from "./sourceSelectOccurrence";
import { getMarkdownBlockBounds } from "./sourceBlockBounds";

/**
 * Select every occurrence of the current word/selection within the enclosing
 * markdown block, or null when there is no block to scope to (a blank line, an
 * empty document) — declining beats silently widening to the whole file.
 */
export function selectAllOccurrencesInBlockSource(state: EditorState): TransactionSpec | null {
  const bounds = getMarkdownBlockBounds(state, state.selection.main.from);
  if (!bounds) return null;
  return selectAllOccurrencesSource(state, bounds);
}
