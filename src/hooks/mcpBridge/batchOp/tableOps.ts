/**
 * Per-phase executors for table batch operations.
 *
 * Phase 1 runs structural ops (add/delete rows & columns, set_header) one at
 * a time via editor commands. Phase 2 batches update_cell ops into a single
 * ProseMirror transaction to keep positions stable.
 *
 * @module hooks/mcpBridge/batchOp/tableOps
 */

import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { Editor } from "@tiptap/core";
import { createMarkdownPasteSlice } from "@/plugins/markdownPaste/tiptap";
import type { TableOperation, TableTarget } from "./shared";

export interface NormalizedOp {
  op: TableOperation | null;
  rawOp: TableOperation | Record<string, unknown>;
  error: string | null;
}

/** Find the ProseMirror position of a table cell at [row, col]. */
export function findCellPosition(
  tableNode: ProseMirrorNode,
  tablePos: number,
  row: number,
  col: number
): number | null {
  let currentRow = 0;
  let result: number | null = null;

  tableNode.forEach((rowNode, rowOffset) => {
    if (result !== null) return;
    if (rowNode.type.name === "tableRow") {
      if (currentRow === row) {
        let currentCol = 0;
        rowNode.forEach((_cellNode, cellOffset) => {
          if (result !== null) return;
          if (currentCol === col) {
            // tablePos + 1 (inside table) + rowOffset + 1 (inside row) + cellOffset
            result = tablePos + 1 + rowOffset + 1 + cellOffset;
          }
          currentCol++;
        });
      }
      currentRow++;
    }
  });

  return result;
}

/**
 * Phase 1 — run structural ops (non-`update_cell`) and return how many succeeded.
 * Appends a description to `warnings` for each failure.
 */
export function applyStructuralOps(
  editor: Editor,
  table: { pos: number; node: ProseMirrorNode },
  normalizedOps: NormalizedOp[],
  warnings: string[]
): number {
  let appliedCount = 0;

  for (const { op, rawOp, error } of normalizedOps) {
    if (error) {
      warnings.push(`Failed to normalize: ${error}`);
      continue;
    }
    if (!op || op.action === "update_cell") continue;

    try {
      // Position cursor at the target row/col before structural ops so they
      // act on the correct location instead of current selection.
      if ("at" in op && typeof op.at === "number") {
        const cellPos = findCellPosition(table.node, table.pos, op.at, 0);
        if (cellPos !== null) {
          editor.chain().focus().setTextSelection(cellPos + 1).run();
        } else {
          warnings.push(`${op.action}: row ${op.at} not found, using current position`);
        }
      }

      switch (op.action) {
        case "add_row":
          editor.commands.addRowAfter();
          appliedCount++;
          break;

        case "delete_row":
          editor.commands.deleteRow();
          appliedCount++;
          break;

        case "add_column":
          editor.commands.addColumnAfter();
          appliedCount++;
          break;

        case "delete_column":
          editor.commands.deleteColumn();
          appliedCount++;
          break;

        case "set_header": {
          // Check current header state to make set_header idempotent
          const firstRow = table.node.firstChild;
          const isCurrentlyHeader = firstRow?.firstChild?.type.name === "tableHeader";
          const wantHeader = op.isHeader !== false; // Default to true
          if (isCurrentlyHeader !== wantHeader) {
            editor.commands.toggleHeaderRow();
          }
          appliedCount++;
          break;
        }

        default:
          warnings.push(`Unknown table operation: ${(op as { action: string }).action}`);
      }
    } catch (opError) {
      /* v8 ignore start -- .type/.op fallback keys not exercised in tests */
      const action = (rawOp as Record<string, unknown>).action ?? (rawOp as Record<string, unknown>).type ?? (rawOp as Record<string, unknown>).op ?? "unknown";
      /* v8 ignore stop */
      warnings.push(`Failed: ${action} - ${opError instanceof Error ? opError.message : String(opError)}`);
    }
  }

  return appliedCount;
}

/**
 * Phase 2 — batch all `update_cell` ops into a single transaction and return
 * how many succeeded. Re-finds the table because structural ops may have
 * changed document positions.
 */
export function applyCellUpdates(
  editor: Editor,
  target: TableTarget,
  findTable: (doc: ProseMirrorNode, target: TableTarget) => { pos: number; node: ProseMirrorNode } | null,
  normalizedOps: NormalizedOp[],
  warnings: string[]
): number {
  const cellOps = normalizedOps.filter((n) => n.op?.action === "update_cell");
  if (cellOps.length === 0) return 0;

  const updatedTable = findTable(editor.state.doc, target);
  if (!updatedTable) {
    warnings.push("Table not found after structural operations — cell updates skipped");
    return 0;
  }

  const cellTr = editor.state.tr;
  // Process cell updates in reverse position order to keep earlier positions valid
  const cellUpdates = cellOps
    .map(({ op }) => {
      const cellOp = op as { action: "update_cell"; row: number; col: number; content: string };
      const cellPos = findCellPosition(updatedTable.node, updatedTable.pos, cellOp.row, cellOp.col);
      return { cellOp, cellPos };
    })
    .filter(({ cellPos, cellOp }) => {
      if (cellPos === null) {
        warnings.push(`update_cell at [${cellOp.row},${cellOp.col}] - cell not found`);
        return false;
      }
      return true;
    })
    .sort((a, b) => b.cellPos! - a.cellPos!); // Reverse order for safe position updates

  let appliedCount = 0;
  for (const { cellOp, cellPos } of cellUpdates) {
    const cellNode = editor.state.doc.nodeAt(cellPos!);
    if (cellNode) {
      const contentStart = cellPos! + 1;
      const contentEnd = cellPos! + cellNode.nodeSize - 1;
      // Parse cell content as markdown to support rich formatting (bold, links, etc.)
      if (cellOp.content) {
        const cellSlice = createMarkdownPasteSlice(editor.state, cellOp.content);
        cellTr.replaceWith(contentStart, contentEnd, cellSlice.content);
      } else {
        cellTr.replaceWith(
          contentStart,
          contentEnd,
          editor.state.schema.nodes.paragraph.create(null)
        );
      }
      appliedCount++;
    } else {
      warnings.push(`update_cell at [${cellOp.row},${cellOp.col}] - could not resolve cell node`);
    }
  }

  if (cellTr.docChanged) {
    editor.view.dispatch(cellTr);
  }

  return appliedCount;
}
