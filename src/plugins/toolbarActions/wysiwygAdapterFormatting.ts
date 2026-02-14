/**
 * WYSIWYG Adapter - Formatting Actions
 *
 * Purpose: Text formatting, heading manipulation, blockquote toggling, and
 * clear formatting for WYSIWYG mode. These are inline/block-level formatting
 * operations triggered by toolbar buttons.
 *
 * @coordinates-with wysiwygAdapter.ts — main dispatcher delegates formatting actions here
 * @coordinates-with enableRules.ts — decides which formatting actions are enabled
 * @module plugins/toolbarActions/wysiwygAdapterFormatting
 */
import type { Editor as TiptapEditor } from "@tiptap/core";
import type { EditorView } from "@tiptap/pm/view";
import type { Node as PMNode, Mark as PMMark } from "@tiptap/pm/model";
import { handleRemoveBlockquote } from "@/plugins/formatToolbar/nodeActions.tiptap";
import { MultiSelection } from "@/plugins/multiCursor";
import { toUpperCase, toLowerCase, toTitleCase, toggleCase } from "@/utils/textTransformations";
import type { WysiwygToolbarContext } from "./types";

/**
 * Clear all inline marks from the selection (or multi-selection ranges).
 */
export function clearFormattingInView(view: EditorView): boolean {
  const { state, dispatch } = view;
  const { selection } = state;
  const ranges = selection instanceof MultiSelection
    ? selection.ranges
    : [{ $from: selection.$from, $to: selection.$to }];
  let tr = state.tr;
  let applied = false;

  for (const range of ranges) {
    const from = range.$from.pos;
    const to = range.$to.pos;
    if (from === to) continue;
    applied = true;
    state.doc.nodesBetween(from, to, (node: PMNode, pos: number) => {
      if (node.isText && node.marks.length > 0) {
        node.marks.forEach((mark: PMMark) => {
          tr = tr.removeMark(
            Math.max(from, pos),
            Math.min(to, pos + node.nodeSize),
            mark.type
          );
        });
      }
    });
  }

  if (applied && tr.docChanged) {
    dispatch(tr);
    view.focus();
    return true;
  }
  return false;
}

/**
 * Get the heading level of the block containing the cursor, or null if not a heading.
 */
export function getCurrentHeadingLevel(editor: TiptapEditor): number | null {
  const { $from } = editor.state.selection;
  const parent = $from.parent;
  if (parent.type.name === "heading") {
    return parent.attrs.level as number;
  }
  return null;
}

/**
 * Increase heading level (e.g., H3 -> H2, or paragraph -> H6).
 */
export function increaseHeadingLevel(editor: TiptapEditor): boolean {
  const currentLevel = getCurrentHeadingLevel(editor);
  if (currentLevel === null) {
    editor.chain().focus().setHeading({ level: 6 }).run();
    return true;
  }
  if (currentLevel > 1) {
    editor.chain().focus().setHeading({ level: (currentLevel - 1) as 1 | 2 | 3 | 4 | 5 }).run();
    return true;
  }
  return false;
}

/**
 * Decrease heading level (e.g., H2 -> H3, or H6 -> paragraph).
 */
export function decreaseHeadingLevel(editor: TiptapEditor): boolean {
  const currentLevel = getCurrentHeadingLevel(editor);
  if (currentLevel === null) return false;
  if (currentLevel < 6) {
    editor.chain().focus().setHeading({ level: (currentLevel + 1) as 2 | 3 | 4 | 5 | 6 }).run();
    return true;
  }
  editor.chain().focus().setParagraph().run();
  return true;
}

/**
 * Toggle blockquote on the current block. Handles wrapping lists inside blockquotes.
 */
export function toggleBlockquote(editor: TiptapEditor): boolean {
  if (editor.isActive("blockquote")) {
    // Use handleRemoveBlockquote to properly unwrap the entire blockquote,
    // not just the current selection's block range
    handleRemoveBlockquote(editor.view);
    return true;
  }

  const { state, dispatch } = editor.view;
  const { $from, $to } = state.selection;
  const blockquoteType = state.schema.nodes.blockquote;
  if (!blockquoteType) return false;

  // Find if we're inside a list - if so, wrap the entire list
  let wrapDepth = -1;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type.name === "bulletList" || node.type.name === "orderedList") {
      wrapDepth = d;
      break;
    }
  }

  let range;
  if (wrapDepth > 0) {
    const listStart = $from.before(wrapDepth);
    const listEnd = $from.after(wrapDepth);
    range = state.doc.resolve(listStart).blockRange(state.doc.resolve(listEnd));
  } else {
    range = $from.blockRange($to);
  }

  if (range) {
    try {
      dispatch(state.tr.wrap(range, [{ type: blockquoteType }]));
      editor.view.focus();
      return true;
    } catch {
      return false;
    }
  }

  return false;
}

/**
 * Transform case of selected text in WYSIWYG mode.
 *
 * @edge-case Preserves inline marks when replacing text via insertText
 */
export function handleWysiwygTransformCase(
  context: WysiwygToolbarContext,
  caseType: "uppercase" | "lowercase" | "titleCase" | "toggleCase"
): boolean {
  const { view, editor } = context;
  if (!view || !editor) return false;

  const { state, dispatch } = view;
  const { from, to, empty } = state.selection;

  if (empty) return false; // No selection

  // Get selected text
  let selectedText = "";
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.isText && node.text) {
      const start = Math.max(0, from - pos);
      const end = Math.min(node.text.length, to - pos);
      if (start < end) {
        selectedText += node.text.slice(start, end);
      }
    }
  });

  if (!selectedText) return false;

  // Apply transformation
  let transformed: string;
  switch (caseType) {
    case "uppercase":
      transformed = toUpperCase(selectedText);
      break;
    case "lowercase":
      transformed = toLowerCase(selectedText);
      break;
    case "titleCase":
      transformed = toTitleCase(selectedText);
      break;
    case "toggleCase":
      transformed = toggleCase(selectedText);
      break;
  }

  if (transformed === selectedText) return true;

  // Replace text while preserving marks
  const tr = state.tr;
  tr.insertText(transformed, from, to);
  dispatch(tr);

  // Restore selection
  editor.commands.setTextSelection({ from, to: from + transformed.length });
  editor.commands.focus();
  return true;
}
