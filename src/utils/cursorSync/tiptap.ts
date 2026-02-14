/**
 * Tiptap Cursor Sync
 *
 * Purpose: Extract and restore cursor position in Tiptap (WYSIWYG) mode
 * during mode switches. Extends the ProseMirror version with block anchor
 * support for tables and code blocks.
 *
 * Pipeline: Mode switch -> getCursorInfoFromTiptap() -> CursorInfo struct
 *   -> restoreCursorInCodeMirror() (or vice versa).
 *
 * Key decisions:
 *   - Prefers block anchors for tables/code blocks over text-based heuristics
 *   - Container nodes (alertBlock, detailsBlock) resolve to their first textblock child
 *   - setMeta("addToHistory", false) prevents cursor jumps from polluting undo stack
 *
 * @coordinates-with cursorSync/codemirror.ts — the source mode counterpart
 * @coordinates-with cursorSync/tiptapAnchors.ts — block anchor extraction/restoration
 * @module utils/cursorSync/tiptap
 */

import type { EditorView } from "@tiptap/pm/view";
import type { Node as PMNode, ResolvedPos } from "@tiptap/pm/model";
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
import { getBlockAnchor, restoreCursorInCodeBlock, restoreCursorInTable } from "./tiptapAnchors";

/**
 * Get node type from ancestor chain.
 * Handles standard block nodes plus special container nodes.
 */
function getNodeTypeFromAncestors($pos: ResolvedPos): NodeType {
  for (let d = $pos.depth; d >= 0; d--) {
    const name = $pos.node(d).type.name;
    if (name === "heading") return "heading";
    if (name === "codeBlock") return "code_block";
    if (name === "blockquote") return "blockquote";
    if (name === "tableCell" || name === "tableHeader") return "table_cell";
    if (name === "alertBlock") return "alert_block";
    if (name === "detailsBlock" || name === "detailsSummary") return "details_block";
    if (name === "wikiLink") return "wiki_link";
    if (
      name === "listItem" ||
      name === "bulletList" ||
      name === "orderedList" ||
      name === "taskItem" ||
      name === "taskList"
    ) {
      return "list_item";
    }
  }
  return "paragraph";
}


/**
 * Extract cursor info from Tiptap editor.
 * Uses sourceLine attribute from ProseMirror nodes.
 */
export function getCursorInfoFromTiptap(view: EditorView): CursorInfo {
  const { state } = view;
  const { from } = state.selection;
  const $pos = state.doc.resolve(from);

  // Get sourceLine from nearest ancestor
  let sourceLine = getSourceLineFromPos($pos);
  if (sourceLine === null) {
    sourceLine = estimateSourceLine(state.doc, from);
  }

  // Get node type
  const nodeType = getNodeTypeFromAncestors($pos);

  // Get block-specific anchor for tables and code blocks
  const blockAnchor = getBlockAnchor($pos);

  // Get column within the parent textblock
  const parent = $pos.parent;
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
    blockAnchor,
  };
}

/**
 * Restore cursor position in Tiptap from cursor info.
 * Finds the node with matching sourceLine attribute.
 * Uses block anchors for precise positioning in tables and code blocks.
 */
export function restoreCursorInTiptap(view: EditorView, cursorInfo: CursorInfo): void {
  const { state } = view;
  const { sourceLine, blockAnchor } = cursorInfo;

  // Try block-specific restoration first for tables and code blocks
  if (blockAnchor) {
    if (blockAnchor.kind === "table") {
      if (restoreCursorInTable(view, sourceLine, blockAnchor)) {
        return;
      }
    } else if (blockAnchor.kind === "code") {
      if (restoreCursorInCodeBlock(view, sourceLine, blockAnchor)) {
        return;
      }
    }
  }

  // Fall back to generic sourceLine-based restoration
  let targetPos: number | null = null;
  let targetNode: PMNode | null = null;
  let found = false;

  // Container node types that have sourceLine but aren't textblocks
  const containerTypes = new Set(["alertBlock", "detailsBlock"]);

  state.doc.descendants((node, pos) => {
    if (found) return false; // Skip remaining nodes after finding first match
    if (node.attrs.sourceLine === sourceLine) {
      // Accept textblocks directly
      if (node.isTextblock) {
        targetPos = pos + 1; // +1 for node opening
        targetNode = node;
        found = true;
        return false;
      }
      // For container nodes, find their first textblock child
      if (containerTypes.has(node.type.name)) {
        let firstTextblockPos: number | null = null;
        let firstTextblockNode: PMNode | null = null;
        node.descendants((child, childPos) => {
          if (firstTextblockPos !== null) return false;
          if (child.isTextblock) {
            firstTextblockPos = pos + 1 + childPos + 1;
            firstTextblockNode = child;
            return false;
          }
          return true;
        });
        if (firstTextblockPos !== null && firstTextblockNode !== null) {
          targetPos = firstTextblockPos;
          targetNode = firstTextblockNode;
          found = true;
          return false;
        }
      }
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
    // Last resort: go to start
    try {
      const tr = state.tr
        .setSelection(Selection.atStart(state.doc))
        .setMeta("addToHistory", false); // Cursor restoration shouldn't add to history
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
    const tr = state.tr
      .setSelection(TextSelection.near(state.doc.resolve(clampedPos)))
      .setMeta("addToHistory", false); // Cursor restoration shouldn't add to history
    view.dispatch(tr.scrollIntoView());
  } catch {
    const tr = state.tr
      .setSelection(Selection.atStart(state.doc))
      .setMeta("addToHistory", false);
    view.dispatch(tr.scrollIntoView());
  }
}
