/**
 * Inline Code Boundary Plugin
 *
 * Fixes cursor behavior at the left boundary of inline code marks.
 *
 * Problem: ProseMirror resolves marks at a cursor position from the text
 * BEFORE the position. At the left boundary of inline code (mid-paragraph),
 * this means the code mark is NOT included, so typing inserts text outside
 * the code node instead of inside.
 *
 * Solution: An appendTransaction that detects when the cursor is at the
 * left boundary of a code-marked text node and explicitly sets storedMarks
 * to include the code mark.
 */

import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { Transaction, EditorState } from "@tiptap/pm/state";

const inlineCodeBoundaryKey = new PluginKey("inlineCodeBoundary");

/**
 * Create the inline code boundary plugin.
 * Returns a ProseMirror plugin (not a Tiptap extension) for testability.
 */
export function createInlineCodeBoundaryPlugin(): Plugin {
  return new Plugin({
    key: inlineCodeBoundaryKey,

    appendTransaction(
      transactions: readonly Transaction[],
      _oldState: EditorState,
      newState: EditorState
    ) {
      // Only act when selection or doc changed
      const changed = transactions.some((tr) => tr.selectionSet || tr.docChanged);
      if (!changed) return null;

      const { selection } = newState;
      const { from, to, $from } = selection;

      // Only handle cursor, not selection
      if (from !== to) return null;

      // Must be at a text node boundary (not in the middle of a node)
      if ($from.textOffset !== 0) return null;

      // Check if the node after cursor has the code mark
      const nodeAfter = $from.nodeAfter;
      if (!nodeAfter) return null;

      const codeMarkType = newState.schema.marks.code;
      if (!codeMarkType) return null;

      const hasCodeAfter = nodeAfter.marks.some((m) => m.type === codeMarkType);
      if (!hasCodeAfter) return null;

      // Set storedMarks to include the code mark so typing goes inside code
      const codeMark = codeMarkType.create();
      return newState.tr.setStoredMarks([codeMark]);
    },
  });
}
