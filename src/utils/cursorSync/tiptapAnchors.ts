/**
 * Tiptap Block Anchor Utilities
 *
 * Purpose: Extract and restore precise sub-block cursor coordinates
 * (table row/col/offset, code block line/column) from ProseMirror positions.
 *
 * Key decisions:
 *   - Table anchor walks the PM ancestor chain to find tableRow/table parents
 *   - Code block anchor counts newlines before cursor to derive line/column
 *   - All restoration functions use addToHistory:false to avoid undo pollution
 *
 * @coordinates-with cursorSync/table.ts — the source mode table anchor equivalent
 * @module utils/cursorSync/tiptapAnchors
 */

import type { EditorView } from "@tiptap/pm/view";
import type { Node as PMNode, ResolvedPos } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import type { BlockAnchor } from "@/types/cursorSync";

/**
 * Extract block-specific anchor from resolved position.
 * Returns table coordinates or code block line/column when applicable.
 */
export function getBlockAnchor($pos: ResolvedPos): BlockAnchor | undefined {
  // Walk up the ancestor chain to find table or code block
  for (let d = $pos.depth; d >= 0; d--) {
    const node = $pos.node(d);
    const name = node.type.name;

    // Table cell: extract row and column indices
    if (name === "tableCell" || name === "tableHeader") {
      let row = 0;
      let col = 0;
      for (let pd = d - 1; pd >= 0; pd--) {
        const parentName = $pos.node(pd).type.name;
        if (parentName === "tableRow") {
          col = $pos.index(pd + 1);
        } else if (parentName === "table") {
          row = $pos.index(pd + 1);
          break;
        }
      }

      const offsetInCell = $pos.pos - $pos.start(d);

      return {
        kind: "table",
        row,
        col,
        offsetInCell: Math.max(0, offsetInCell),
      };
    }

    // Code block: extract line and column within the code
    if (name === "codeBlock") {
      const codeText = node.textContent;
      const offset = $pos.pos - $pos.start(d);
      const beforeCursor = codeText.slice(0, offset);
      const lineInBlock = (beforeCursor.match(/\n/g) || []).length;
      const lastNewline = beforeCursor.lastIndexOf("\n");
      const columnInLine = lastNewline === -1 ? offset : offset - lastNewline - 1;

      return {
        kind: "code",
        lineInBlock,
        columnInLine,
      };
    }
  }

  return undefined;
}

/**
 * Restore cursor in a table using block anchor coordinates.
 */
export function restoreCursorInTable(
  view: EditorView,
  sourceLine: number,
  anchor: { row: number; col: number; offsetInCell: number }
): boolean {
  const { state } = view;
  let tablePos: number | null = null;

  // Find table by sourceLine
  state.doc.descendants((node, pos) => {
    if (tablePos !== null) return false;
    if (node.type.name === "table" && node.attrs.sourceLine === sourceLine) {
      tablePos = pos;
      return false;
    }
    if (node.type.name === "table") {
      const sl = node.attrs.sourceLine as number | undefined;
      if (sl !== undefined && sl <= sourceLine) {
        tablePos = pos;
      }
    }
    return true;
  });

  if (tablePos === null) return false;

  const tableNode = state.doc.nodeAt(tablePos);
  if (!tableNode || tableNode.type.name !== "table") return false;

  // Navigate to row -> cell -> offset
  let currentPos = tablePos + 1; // Inside table

  // Find the target row
  let rowIndex = 0;
  for (let i = 0; i < tableNode.childCount; i++) {
    const rowNode = tableNode.child(i);
    if (rowIndex === anchor.row) {
      // Found the row, now find the column
      let cellPos = currentPos + 1; // Inside row
      for (let j = 0; j < rowNode.childCount; j++) {
        const cellNode = rowNode.child(j);
        if (j === anchor.col) {
          const offset = Math.min(anchor.offsetInCell, cellNode.content.size);
          const finalPos = cellPos + offset;
          try {
            const tr = state.tr
              .setSelection(TextSelection.near(state.doc.resolve(finalPos)))
              .setMeta("addToHistory", false); // Cursor restoration shouldn't add to history
            view.dispatch(tr.scrollIntoView());
            return true;
          } catch {
            return false;
          }
        }
        cellPos += cellNode.nodeSize;
      }
      break;
    }
    currentPos += rowNode.nodeSize;
    rowIndex++;
  }

  return false;
}

/**
 * Restore cursor in a code block using block anchor coordinates.
 */
export function restoreCursorInCodeBlock(
  view: EditorView,
  sourceLine: number,
  anchor: { lineInBlock: number; columnInLine: number }
): boolean {
  const { state } = view;
  let codeBlockPos: number | null = null;
  let foundNode: PMNode | null = null;

  // Find code block by sourceLine
  state.doc.descendants((node, pos) => {
    if (codeBlockPos !== null) return false;
    if (node.type.name === "codeBlock") {
      const sl = node.attrs.sourceLine as number | undefined;
      if (sl === sourceLine || (sl !== undefined && sl <= sourceLine)) {
        codeBlockPos = pos;
        foundNode = node;
      }
    }
    return true;
  });

  if (codeBlockPos === null || foundNode === null) return false;

  const codeBlockNode = foundNode as PMNode;
  const codeText = codeBlockNode.textContent;
  const lines = codeText.split("\n");

  // Calculate offset from line and column
  let offset = 0;
  for (let i = 0; i < anchor.lineInBlock && i < lines.length; i++) {
    offset += lines[i].length + 1; // +1 for newline
  }

  // Add column offset (clamped to line length)
  const targetLineLength = lines[anchor.lineInBlock]?.length ?? 0;
  offset += Math.min(anchor.columnInLine, targetLineLength);

  // Clamp to code block content size
  offset = Math.min(offset, codeBlockNode.content.size);

  const finalPos = codeBlockPos + 1 + offset; // +1 for node opening

  try {
    const tr = state.tr
      .setSelection(TextSelection.near(state.doc.resolve(finalPos)))
      .setMeta("addToHistory", false); // Cursor restoration shouldn't add to history
    view.dispatch(tr.scrollIntoView());
    return true;
  } catch {
    return false;
  }
}
