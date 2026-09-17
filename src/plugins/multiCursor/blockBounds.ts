/**
 * Block bounds for occurrence selection (#1418).
 *
 * `selectAllOccurrences` has always scoped itself inside a code block:
 * `getCodeBlockBounds` returns a range, `findAllOccurrences` searches only
 * inside it, and `filterRangesToBounds` drops anything that escaped. #1418 asks
 * for that same containment in ordinary prose — matching a word in the
 * paragraph you are looking at should not silently place cursors three screens
 * away.
 *
 * So this is only the bounds half. Everything downstream is the machinery the
 * code-block path already uses, unchanged, which is why the block-scoped
 * command is a few lines rather than a parallel implementation.
 *
 * @coordinates-with codeBlockBounds.ts — the code-fence case and the shared range filter
 * @coordinates-with occurrenceCommands.ts — the command that consumes this
 * @module plugins/multiCursor/blockBounds
 */
import type { EditorState } from "@tiptap/pm/state";
import type { CodeBlockBounds } from "./codeBlockBounds";

/**
 * Content bounds of the innermost textblock containing `pos`, or null when the
 * position is not inside one (a doc-level position, or a selection resting on a
 * node rather than in text).
 *
 * INNERMOST is the meaningful choice. A paragraph inside a blockquote inside a
 * list item bounds to the paragraph — the unit a writer thinks of as "this
 * block" — rather than to the outermost container, which would scope to most of
 * the document and defeat the point.
 *
 * A code block is itself a textblock, so inside a fence this returns exactly
 * what `getCodeBlockBounds` returns. The two agree instead of competing, which
 * is what lets the block-scoped command run safely inside a fence.
 */
export function getTextblockBounds(state: EditorState, pos: number): CodeBlockBounds | null {
  const $pos = state.doc.resolve(pos);
  for (let depth = $pos.depth; depth > 0; depth--) {
    if ($pos.node(depth).isTextblock) {
      return { from: $pos.start(depth), to: $pos.end(depth) };
    }
  }
  return null;
}
