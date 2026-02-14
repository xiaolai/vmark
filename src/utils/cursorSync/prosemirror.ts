/**
 * ProseMirror Cursor Sync
 *
 * Purpose: Extract and restore cursor position in ProseMirror editor views.
 * This is the lower-level ProseMirror variant — Tiptap uses tiptap.ts instead,
 * which adds block anchor support for tables and code blocks.
 *
 * Key decisions:
 *   - sourceLine attribute on PM nodes is the primary anchor
 *   - Falls back to findClosestSourceLine when exact match fails
 *   - Uses addToHistory:false meta so restoration doesn't pollute undo stack
 *
 * @coordinates-with cursorSync/tiptap.ts — extended version with block anchors
 * @coordinates-with cursorSync/pmHelpers.ts — shared sourceLine lookup utilities
 * @module utils/cursorSync/prosemirror
 */

import type { EditorView } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Selection, TextSelection } from "@tiptap/pm/state";
import type { CursorInfo, NodeType } from "@/types/cursorSync";
import { extractCursorContext } from "./matching";
import {
  getSourceLineFromPos,
  estimateSourceLine,
  findClosestSourceLine,
  findColumnInLine,
  END_OF_LINE_THRESHOLD,
} from "./pmHelpers";

/**
 * Get node type from ProseMirror node
 */
function getNodeTypeFromPM(node: PMNode): NodeType {
  const typeName = node.type.name;
  switch (typeName) {
    case "heading":
      return "heading";
    case "listItem":
    case "bulletList":
    case "orderedList":
      return "list_item";
    case "codeBlock":
      return "code_block";
    case "tableCell":
    case "tableHeader":
      return "table_cell";
    case "blockquote":
      return "blockquote";
    default:
      return "paragraph";
  }
}

/**
 * Extract cursor info from ProseMirror editor.
 * Uses sourceLine attribute from nodes.
 */
export function getCursorInfoFromProseMirror(view: EditorView): CursorInfo {
  const { state } = view;
  const { from } = state.selection;
  const $pos = state.doc.resolve(from);

  // Get sourceLine from nearest ancestor
  let sourceLine = getSourceLineFromPos($pos);
  if (sourceLine === null) {
    sourceLine = estimateSourceLine(state.doc, from);
  }

  // Get node type
  const parent = $pos.parent;
  const nodeType = getNodeTypeFromPM(parent);

  // Get column within the parent textblock
  const column = from - $pos.start();
  const lineText = parent.textContent;

  // Extract context
  const context = extractCursorContext(lineText, column);
  const percentInLine = lineText.length > 0 ? column / lineText.length : 0;

  return {
    sourceLine,
    wordAtCursor: context.word,
    offsetInWord: context.offsetInWord,
    nodeType,
    percentInLine,
    contextBefore: context.contextBefore,
    contextAfter: context.contextAfter,
  };
}

/**
 * Restore cursor position in ProseMirror from cursor info.
 * Finds the node with matching sourceLine attribute.
 */
export function restoreCursorInProseMirror(view: EditorView, cursorInfo: CursorInfo): void {
  const { state } = view;
  const { sourceLine } = cursorInfo;

  // Find the first node with matching sourceLine
  let targetPos: number | null = null;
  let targetNode: PMNode | null = null;
  let found = false;

  state.doc.descendants((node, pos) => {
    if (found) return false; // Skip remaining nodes after finding first match
    if (node.attrs.sourceLine === sourceLine && node.isTextblock) {
      targetPos = pos + 1; // +1 for node opening
      targetNode = node;
      found = true;
      return false;
    }
    return true;
  });

  // Fallback: find closest sourceLine
  if (targetPos === null) {
    const result = findClosestSourceLine(state.doc, sourceLine);
    targetPos = result.pos;
    targetNode = result.node;
  }

  if (targetPos === null || targetNode === null) {
    try {
      const tr = state.tr.setSelection(Selection.atStart(state.doc));
      view.dispatch(tr.scrollIntoView());
    } catch {
      // Ignore
    }
    return;
  }

  // Find column within the node using word/context matching
  const lineText = targetNode.textContent;
  const column = findColumnInLine(lineText, cursorInfo);

  // Clamp column to line length to prevent landing in next node
  const clampedColumn = Math.min(column, lineText.length);
  let pos = targetPos + clampedColumn;

  // Handle end of line (threshold: cursor near/at line end)
  if (cursorInfo.percentInLine >= END_OF_LINE_THRESHOLD) {
    pos = targetPos + lineText.length;
  }

  const clampedPos = Math.max(0, Math.min(pos, state.doc.content.size));

  try {
    const tr = state.tr.setSelection(TextSelection.near(state.doc.resolve(clampedPos)));
    view.dispatch(tr.scrollIntoView());
  } catch {
    const tr = state.tr.setSelection(Selection.atStart(state.doc));
    view.dispatch(tr.scrollIntoView());
  }
}
