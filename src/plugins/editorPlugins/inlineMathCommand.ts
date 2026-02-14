/**
 * Purpose: Inline math shortcut handler for WYSIWYG mode.
 *
 * Exports:
 * - handleInlineMathShortcut: Toggle inline math with smart cursor behavior
 *
 * Key decisions:
 * - Toggle behavior: if cursor is at/adjacent to math_inline node, unwrap it
 * - Word expansion: if cursor is in a word with no selection, wraps the word
 * - Edit mode is triggered by positioning cursor so nodeAfter is the math node,
 *   which causes inlineNodeEditing plugin to add .editing class
 *
 * @coordinates-with editorPlugins.tiptap.ts (keymap builder binds this)
 * @coordinates-with inlineNodeEditing plugin (triggers .editing class)
 * @coordinates-with syntaxReveal/marks.ts (findWordAtCursor)
 */

import { Selection, NodeSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { findWordAtCursor } from "@/plugins/syntaxReveal/marks";

/**
 * Insert inline math with toggle behavior for WYSIWYG mode.
 *
 * Behavior:
 * - Cursor at math_inline node -> unwrap (convert to text)
 * - Has selection -> wrap in math_inline, position cursor to enter edit mode
 * - No selection, word at cursor -> wrap word, position cursor to enter edit mode
 * - No selection, no word -> insert empty math_inline, enter edit mode
 *
 * Edit mode is triggered by positioning cursor so nodeAfter is the math node,
 * which causes inlineNodeEditing plugin to add .editing class.
 */
export function handleInlineMathShortcut(view: EditorView): boolean {
  const { state, dispatch } = view;
  const { from, to } = state.selection;
  const mathInlineType = state.schema.nodes.math_inline;
  if (!mathInlineType) return false;

  const $from = state.selection.$from;

  // Check if we're in a NodeSelection of a math node - toggle off (unwrap)
  if (state.selection instanceof NodeSelection) {
    const node = state.selection.node;
    if (node.type.name === "math_inline") {
      const content = node.attrs.content || "";
      const pos = state.selection.from;
      const tr = state.tr.replaceWith(
        pos,
        pos + node.nodeSize,
        content ? state.schema.text(content) : []
      );
      // Position cursor at end of inserted text
      tr.setSelection(Selection.near(tr.doc.resolve(pos + content.length)));
      dispatch(tr);
      view.focus();
      return true;
    }
  }

  // Check if cursor's nodeAfter is math_inline - toggle off (unwrap)
  const nodeAfter = $from.nodeAfter;
  if (nodeAfter?.type.name === "math_inline") {
    const nodeEnd = from + nodeAfter.nodeSize;
    const content = nodeAfter.attrs.content || "";
    const tr = state.tr.replaceWith(
      from,
      nodeEnd,
      content ? state.schema.text(content) : []
    );
    // Position cursor at end of inserted text
    tr.setSelection(Selection.near(tr.doc.resolve(from + content.length)));
    dispatch(tr);
    view.focus();
    return true;
  }

  // Check if cursor's nodeBefore is math_inline - toggle off (unwrap)
  const nodeBefore = $from.nodeBefore;
  if (nodeBefore?.type.name === "math_inline") {
    const nodeStart = from - nodeBefore.nodeSize;
    const content = nodeBefore.attrs.content || "";
    const tr = state.tr.replaceWith(
      nodeStart,
      from,
      content ? state.schema.text(content) : []
    );
    // Position cursor at end of inserted text
    tr.setSelection(Selection.near(tr.doc.resolve(nodeStart + content.length)));
    dispatch(tr);
    view.focus();
    return true;
  }

  // Helper to focus math input after insertion with cursor at specific offset
  const focusMathInput = (cursorOffset?: number) => {
    requestAnimationFrame(() => {
      const mathInput = view.dom.querySelector(".math-inline.editing .math-inline-input") as HTMLInputElement;
      if (mathInput) {
        mathInput.focus();
        if (cursorOffset !== undefined) {
          mathInput.setSelectionRange(cursorOffset, cursorOffset);
        }
      }
    });
  };

  // Case 1: Has selection - wrap in math_inline, enter edit mode
  if (from !== to) {
    const selectedText = state.doc.textBetween(from, to, "");
    const mathNode = mathInlineType.create({ content: selectedText });
    const tr = state.tr.replaceSelectionWith(mathNode);
    // Position cursor before the node to trigger edit mode (nodeAfter = math)
    tr.setSelection(Selection.near(tr.doc.resolve(from)));
    dispatch(tr);
    // Cursor at end of content for selection wrapping
    focusMathInput(selectedText.length);
    return true;
  }

  // Case 2: No selection - try word expansion
  const wordRange = findWordAtCursor($from);
  if (wordRange) {
    const wordText = state.doc.textBetween(wordRange.from, wordRange.to, "");
    // Calculate cursor offset within the word (restore cursor position)
    const cursorOffsetInWord = from - wordRange.from;
    const mathNode = mathInlineType.create({ content: wordText });
    const tr = state.tr.replaceWith(wordRange.from, wordRange.to, mathNode);
    // Position cursor before the node to trigger edit mode
    tr.setSelection(Selection.near(tr.doc.resolve(wordRange.from)));
    dispatch(tr);
    // Restore cursor offset within the input
    focusMathInput(cursorOffsetInWord);
    return true;
  }

  // Case 3: No selection, no word - insert empty math node, enter edit mode
  const mathNode = mathInlineType.create({ content: "" });
  const tr = state.tr.replaceSelectionWith(mathNode);
  // Position cursor before the node to trigger edit mode
  tr.setSelection(Selection.near(tr.doc.resolve(from)));
  dispatch(tr);
  focusMathInput(0);
  return true;
}
