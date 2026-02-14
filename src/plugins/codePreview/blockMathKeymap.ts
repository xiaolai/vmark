/**
 * Block Math Keymap Extension
 *
 * Purpose: Handles keyboard shortcuts and click-outside behavior for the inline
 * block math editor (the code block that appears when editing $$...$$ blocks).
 *
 * Key decisions:
 *   - ESC reverts changes (not commits) — explicit save-with-checkmark is the pattern
 *   - Click outside also reverts, matching ESC behavior for consistency
 *   - Cmd+Enter commits changes, providing a keyboard path to save
 *   - Uses a ProseMirror plugin (not Tiptap keymap) to intercept click-outside events
 *
 * @coordinates-with codePreview/tiptap.ts — the code preview node that hosts the math editor
 * @coordinates-with stores/blockMathEditingStore.ts — editing state (original content, position)
 * @module plugins/codePreview/blockMathKeymap
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { useBlockMathEditingStore } from "@/stores/blockMathEditingStore";
import { EDITING_STATE_CHANGED } from "./tiptap";

const blockMathKeymapKey = new PluginKey("blockMathKeymap");

/**
 * Check if cursor is inside the code block at the given position
 */
function isCursorInCodeBlock(view: EditorView, codeBlockPos: number): boolean {
  const { state } = view;
  const { selection } = state;
  const { $from } = selection;

  // Find the code block containing the cursor
  for (let depth = $from.depth; depth >= 0; depth--) {
    const node = $from.node(depth);
    if (node.type.name === "codeBlock" || node.type.name === "code_block") {
      const blockStart = $from.before(depth);
      return blockStart === codeBlockPos;
    }
  }

  return false;
}

/**
 * Exit editing mode and move cursor after the code block
 */
function exitEditing(view: EditorView, revert: boolean): boolean {
  const store = useBlockMathEditingStore.getState();
  const { editingPos, originalContent } = store;

  if (editingPos === null) return false;

  const { state, dispatch } = view;
  const node = state.doc.nodeAt(editingPos);

  if (!node) {
    store.exitEditing();
    return false;
  }

  let tr = state.tr;

  // If reverting, restore original content
  if (revert && originalContent !== null) {
    const currentContent = node.textContent;
    if (currentContent !== originalContent) {
      // Replace the code block's content with original
      const start = editingPos + 1; // After the opening of the code block
      const end = editingPos + node.nodeSize - 1; // Before the closing
      tr = tr.replaceWith(start, end, originalContent ? state.schema.text(originalContent) : []);
    }
  }

  // Move cursor after the code block
  const nodeEnd = editingPos + node.nodeSize;
  const $pos = state.doc.resolve(Math.min(nodeEnd, state.doc.content.size));
  tr = tr.setSelection(TextSelection.near($pos));
  tr.setMeta(EDITING_STATE_CHANGED, true);

  // Exit editing FIRST (before dispatch, so decorations see the new state)
  store.exitEditing();
  dispatch(tr);

  return true;
}

export const blockMathKeymapExtension = Extension.create({
  name: "blockMathKeymap",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: blockMathKeymapKey,

        props: {
          handleKeyDown(view, event) {
            const { editingPos } = useBlockMathEditingStore.getState();
            if (editingPos === null) return false;

            // ESC: Revert and exit (works from anywhere when editing)
            if (event.key === "Escape") {
              event.preventDefault();
              return exitEditing(view, true);
            }

            // Check if cursor is in the editing code block for other shortcuts
            if (!isCursorInCodeBlock(view, editingPos)) return false;

            // Cmd+Enter (Mac) or Ctrl+Enter (Win/Linux): Commit and exit
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              return exitEditing(view, false);
            }

            return false;
          },

          handleClick(view, _pos, event) {
            const store = useBlockMathEditingStore.getState();
            const { editingPos } = store;

            if (editingPos === null) return false;

            // Check if click is outside the editing code block
            const { state } = view;
            const node = state.doc.nodeAt(editingPos);
            if (!node) {
              store.exitEditing();
              return false;
            }

            // Get click position in document
            const clickPos = view.posAtCoords({ left: event.clientX, top: event.clientY });
            if (!clickPos) return false;

            const nodeEnd = editingPos + node.nodeSize;
            const clickedInside = clickPos.pos >= editingPos && clickPos.pos <= nodeEnd;

            if (!clickedInside) {
              // Click outside: revert and exit (user must click ✓ to save)
              exitEditing(view, true);
              // Don't prevent default - let the click set cursor position
              return false;
            }

            return false;
          },
        },
      }),
    ];
  },
});
