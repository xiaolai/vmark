/**
 * WYSIWYG Adapter - Formatting Actions
 *
 * Purpose: Text formatting, blockquote toggling, case transforms and clear
 * formatting for WYSIWYG mode. These are inline/block-level formatting
 * operations triggered by toolbar buttons.
 *
 * Heading-level stepping lives in `wysiwygHeadingLevel.ts`.
 *
 * @coordinates-with wysiwygAdapter.ts — main dispatcher delegates formatting actions here
 * @coordinates-with enableRules.ts — decides which formatting actions are enabled
 * @coordinates-with wysiwygHeadingLevel.ts — the heading pair split out of here
 * @module plugins/toolbarActions/wysiwygAdapterFormatting
 */
import type { Editor as TiptapEditor } from "@tiptap/core";
import type { EditorView } from "@tiptap/pm/view";
import type { Node as PMNode, Mark as PMMark } from "@tiptap/pm/model";
import { handleRemoveBlockquote } from "@/plugins/formatToolbar/nodeActions.tiptap";
import { MultiSelection } from "@/plugins/multiCursor";
import { toUpperCase, toLowerCase, toTitleCase, toggleCase } from "@/utils/textTransformations";
import { computeQuoteToggle } from "@/lib/cjkFormatter/quoteToggle";
import { useSettingsStore } from "@/stores/settingsStore";
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
    /* v8 ignore next -- @preserve false branch fires for inline non-text nodes (images, hardBreaks) which are not present in test docs */
    if (node.isText && node.text) {
      const start = Math.max(0, from - pos);
      const end = Math.min(node.text.length, to - pos);
      /* v8 ignore next -- @preserve false branch fires only when node boundaries don't overlap with selection */
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

/**
 * Toggle the quote style of the innermost quote pair enclosing the cursor.
 *
 * Resolves cursor position to the parent text block, runs computeQuoteToggle
 * on the block text, then applies replacements via ProseMirror transaction.
 *
 * @edge-case Inline atoms (hardBreak, etc.) cause parentOffset and textContent
 *   to use different coordinate spaces — we map between them explicitly
 * @edge-case Applies replacements in reverse offset order to preserve positions
 */
export function toggleQuoteStyleAtCursor(editor: TiptapEditor): boolean {
  const { state } = editor;
  const { $from } = state.selection;
  const parent = $from.parent;

  if (!parent.isTextblock) return false;

  // Build textContent and a mapping from text offset -> doc-absolute position.
  // This handles inline atoms (hardBreak, etc.) that occupy space in parentOffset
  // but contribute nothing to textContent.
  const blockStart = $from.start();
  const textOffsetToDocPos: number[] = [];
  let blockText = "";
  parent.forEach((child, offset) => {
    /* v8 ignore next -- @preserve false branch fires for inline non-text nodes (hardBreak, image) not present in test paragraphs */
    if (child.isText && child.text) {
      for (let i = 0; i < child.text.length; i++) {
        textOffsetToDocPos.push(blockStart + offset + i);
        blockText += child.text[i];
      }
    }
  });

  if (!blockText) return false;

  // Convert parentOffset to textContent offset
  let cursorTextOffset = 0;
  let parentOff = 0;
  for (let ci = 0; ci < parent.childCount; ci++) {
    const child = parent.child(ci);
    const childEnd = parentOff + child.nodeSize;
    if ($from.parentOffset < childEnd) {
      /* v8 ignore next -- @preserve false branch fires when cursor lands inside a non-text inline node (hardBreak, image) */
      if (child.isText) {
        cursorTextOffset += $from.parentOffset - parentOff;
      }
      break;
    }
    if (child.isText && child.text) {
      cursorTextOffset += child.text.length;
    }
    parentOff = childEnd;
  }

  // Read settings
  const cjkSettings = useSettingsStore.getState().cjkFormatting;
  const mode = cjkSettings.quoteToggleMode;
  const preferredStyle = cjkSettings.quoteStyle;

  const result = computeQuoteToggle(blockText, cursorTextOffset, mode, preferredStyle);
  if (!result) return false;

  // Build transaction — apply replacements in reverse order to preserve positions
  let tr = state.tr;
  const sorted = [...result.replacements].sort((a, b) => b.offset - a.offset);
  for (const rep of sorted) {
    const docPos = textOffsetToDocPos[rep.offset];
    tr = tr.insertText(rep.newChar, docPos, docPos + rep.oldChar.length);
  }

  if (!tr.docChanged) return false;

  editor.view.dispatch(tr);
  editor.view.focus();
  return true;
}
