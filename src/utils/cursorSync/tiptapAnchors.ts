/**
 * Tiptap Block Anchor Utilities
 *
 * Purpose: Extract and restore precise sub-block cursor coordinates
 * (table row/col/offset, code block line/column) from ProseMirror positions.
 *
 * Key decisions:
 *   - Table anchor walks the PM ancestor chain to find tableRow/table parents
 *   - Table offsetInCell is a character offset into the cell's text, the same
 *     unit source mode's table.ts uses, so a mode switch keeps the column
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
      // `$pos.index(depth)` is the index of the child of the node AT `depth`
      // that contains the position: the cell's index within its row is read
      // at the row's depth, the row's index within the table at the table's.
      let row = 0;
      let col = 0;
      for (let pd = d - 1; pd >= 0; pd--) {
        const parentName = $pos.node(pd).type.name;
        if (parentName === "tableRow") {
          col = $pos.index(pd);
        } else if (parentName === "table") {
          row = $pos.index(pd);
          break;
        }
      }

      // A character offset into the cell's text — the unit source mode uses —
      // not a document-position delta, which would also count the cell's
      // paragraph-open token.
      const offsetInCell = node.textBetween(0, $pos.pos - $pos.start(d)).length;

      return {
        kind: "table",
        row,
        col,
        offsetInCell,
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
 * Document position of the `offset`-th character of a cell's text, where
 * `contentStart` is the position just inside the cell. An offset past the text
 * clamps to the end of the last text; a cell with no text resolves to the
 * start of its first textblock.
 */
function cellTextPosition(cell: PMNode, contentStart: number, offset: number): number {
  let remaining = Math.max(0, offset);
  let result: number | null = null;
  let lastTextEnd: number | null = null;
  cell.descendants((node, pos) => {
    if (result !== null) return false;
    if (!node.isText) return true;
    const length = node.text?.length ?? 0;
    if (remaining <= length) {
      result = contentStart + pos + remaining;
    } else {
      remaining -= length;
      lastTextEnd = contentStart + pos + length;
    }
    return false;
  });
  return result ?? lastTextEnd ?? contentStart + 1;
}

/**
 * Restore cursor in a table using block anchor coordinates.
 * `offsetInCell` is a character offset into the cell's text.
 */
export function restoreCursorInTable(
  view: EditorView,
  sourceLine: number,
  anchor: { row: number; col: number; offsetInCell: number },
  scrollIntoView = true,
): boolean {
  const { state } = view;
  // Held on an object, not in a bare `let`: TypeScript narrows a `let`
  // from its `null` initializer and cannot see the assignment inside the
  // `descendants` callback, so the guard below narrowed the variable to
  // `never` and the later arithmetic operated on `never`. A property carries
  // its declared type through the callback, which is what makes the guard mean
  // what it reads as.
  const table = { pos: null as number | null };

  // Find table by sourceLine
  state.doc.descendants((node, pos) => {
    if (table.pos !== null) return false;
    if (node.type.name === "table" && node.attrs.sourceLine === sourceLine) {
      table.pos = pos;
      return false;
    }
    if (node.type.name === "table") {
      const sl = node.attrs.sourceLine as number | undefined;
      /* v8 ignore start -- sl is always defined for table nodes created via fromMarkdown; undefined is defensive */
      if (sl !== undefined && sl <= sourceLine) {
        table.pos = pos;
      }
      /* v8 ignore stop */
    }
    return true;
  });

  if (table.pos === null) return false;
  const tablePos = table.pos;

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
          const finalPos = cellTextPosition(cellNode, cellPos + 1, anchor.offsetInCell);
          try {
            const tr = state.tr
              .setSelection(TextSelection.near(state.doc.resolve(finalPos)))
              .setMeta("addToHistory", false); // Cursor restoration shouldn't add to history
            view.dispatch(scrollIntoView ? tr.scrollIntoView() : tr);
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
  anchor: { lineInBlock: number; columnInLine: number },
  scrollIntoView = true,
): boolean {
  const { state } = view;
  // Held on an object, not in a bare `let`: TypeScript narrows a `let`
  // from its `null` initializer and cannot see the assignment inside the
  // `descendants` callback, so the guard below narrowed the variable to
  // `never` and the later arithmetic operated on `never`. A property carries
  // its declared type through the callback, which is what makes the guard mean
  // what it reads as.
  const found = { pos: null as number | null, node: null as PMNode | null };

  // Find code block by sourceLine
  state.doc.descendants((node, pos) => {
    if (found.pos !== null) return false;
    if (node.type.name === "codeBlock") {
      const sl = node.attrs.sourceLine as number | undefined;
      /* v8 ignore start -- sl is always defined for codeBlock nodes; undefined is a defensive fallback */
      if (sl === sourceLine || (sl !== undefined && sl <= sourceLine)) {
        found.pos = pos;
        found.node = node;
      }
      /* v8 ignore stop */
    }
    return true;
  });

  if (found.pos === null || found.node === null) return false;

  const codeBlockPos = found.pos;
  const codeBlockNode = found.node;
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
    view.dispatch(scrollIntoView ? tr.scrollIntoView() : tr);
    return true;
  } catch {
    return false;
  }
}
