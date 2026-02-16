/**
 * MCP Bridge — Batch Operation Handlers
 *
 * Purpose: Table and list batch operations — insert/delete/modify tables,
 *   modify lists, and bulk operations on structured content.
 *
 * @module hooks/mcpBridge/batchOpHandlers
 */

import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { respond, getEditor, isAutoApproveEnabled } from "./utils";
import { validateBaseRevision, getCurrentRevision } from "./revisionTracker";
import { createMarkdownPasteSlice } from "@/plugins/markdownPaste/tiptap";

// Types
type OperationMode = "apply" | "suggest" | "dryRun";

interface TableTarget {
  /** Not yet implemented — use afterHeading or tableIndex instead. */
  tableId?: string;
  afterHeading?: string;
  tableIndex?: number;
}

type TableOperation =
  | { action: "add_row"; at: number; cells: string[] }
  | { action: "delete_row"; at: number }
  | { action: "add_column"; at: number; header: string; cells: string[] }
  | { action: "delete_column"; at: number }
  | { action: "update_cell"; row: number; col: number; content: string }
  | { action: "set_header"; row: number; isHeader: boolean };

interface ListTarget {
  /** Not yet implemented — use selector or listIndex instead. */
  listId?: string;
  selector?: string;
  listIndex?: number;
}

type ListOperation =
  | { action: "add_item"; at: number; text: string; indent?: number }
  | { action: "delete_item"; at: number }
  | { action: "update_item"; at: number; text: string }
  | { action: "toggle_check"; at: number }
  | { action: "reorder"; order: number[] }
  | { action: "set_indent"; at: number; indent: number };

/**
 * Extract text from a ProseMirror node.
 */
function extractText(node: ProseMirrorNode): string {
  let text = "";
  node.descendants((child) => {
    if (child.isText) {
      text += child.text;
    }
    return true;
  });
  return text;
}

/**
 * Find a table in the document by target specification.
 */
function findTable(
  doc: ProseMirrorNode,
  target: TableTarget
): { pos: number; node: ProseMirrorNode } | null {
  let tablePos: number | null = null;
  let tableNode: ProseMirrorNode | null = null;
  let tableIndex = 0;
  let lastHeadingText: string | null = null;

  doc.descendants((node, pos) => {
    if (node.type.name === "heading") {
      lastHeadingText = extractText(node);
    }

    if (node.type.name === "table") {
      let isMatch = false;

      if (target.tableIndex !== undefined) {
        isMatch = tableIndex === target.tableIndex;
      } else if (target.afterHeading) {
        isMatch = lastHeadingText?.toLowerCase() === target.afterHeading.toLowerCase();
      }

      if (isMatch && tablePos === null) {
        tablePos = pos;
        tableNode = node;
        return false;
      }

      tableIndex++;
    }
    return true;
  });

  if (tablePos !== null && tableNode !== null) {
    return { pos: tablePos, node: tableNode };
  }
  return null;
}

/**
 * Find a list in the document by target specification.
 */
function findList(
  doc: ProseMirrorNode,
  target: ListTarget
): { pos: number; node: ProseMirrorNode; type: string } | null {
  let listPos: number | null = null;
  let listNode: ProseMirrorNode | null = null;
  let listType: string | null = null;
  let listIndex = 0;

  const listTypes = ["bulletList", "orderedList", "taskList"];

  doc.descendants((node, pos) => {
    if (listTypes.includes(node.type.name)) {
      let isMatch = false;

      if (target.listIndex !== undefined) {
        isMatch = listIndex === target.listIndex;
      } else if (target.selector) {
        // Simple selector parsing
        const selector = target.selector.toLowerCase();
        if (selector.startsWith("ul") || selector.startsWith("bulletlist")) {
          isMatch = node.type.name === "bulletList";
        } else if (selector.startsWith("ol") || selector.startsWith("orderedlist")) {
          isMatch = node.type.name === "orderedList";
        } else if (selector.startsWith("task")) {
          isMatch = node.type.name === "taskList";
        }
      }

      if (isMatch && listPos === null) {
        listPos = pos;
        listNode = node;
        listType = node.type.name;
        return false;
      }

      listIndex++;
    }
    return true;
  });

  if (listPos !== null && listNode !== null && listType !== null) {
    return { pos: listPos, node: listNode, type: listType };
  }
  return null;
}

/**
 * Normalize an operation object — accept "action", "type", or "op" as
 * the operation key, and normalize camelCase → snake_case (e.g. "updateCell" → "update_cell").
 * Works for both table and list operations.
 */
function normalizeOp<T extends { action: string }>(
  raw: T | Record<string, unknown>,
  examples: string
): T {
  const r = raw as Record<string, unknown>;
  const action = (r.action ?? r.type ?? r.op) as string | undefined;
  if (!action) {
    throw new Error(`Operation must have an 'action' field (e.g. ${examples})`);
  }
  const normalized = action.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
  return { ...r, action: normalized } as unknown as T;
}

function normalizeTableOp(raw: TableOperation | Record<string, unknown>): TableOperation {
  return normalizeOp<TableOperation>(raw, "'update_cell', 'add_row'");
}

function normalizeListOp(raw: ListOperation | Record<string, unknown>): ListOperation {
  return normalizeOp<ListOperation>(raw, "'add_item', 'delete_item'");
}

/**
 * Find the ProseMirror position of a table cell at [row, col].
 */
function findCellPosition(
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
 * Handle table.batchModify request.
 */
export async function handleTableBatchModify(
  id: string,
  args: Record<string, unknown>
): Promise<void> {
  try {
    const baseRevision = args.baseRevision as string;
    const target = args.target as TableTarget;
    const operations = args.operations as TableOperation[];
    const mode = (args.mode as OperationMode) ?? "apply";

    // Validate revision
    const revisionError = validateBaseRevision(baseRevision);
    if (revisionError) {
      await respond({
        id,
        success: false,
        error: revisionError.error,
        data: { code: "conflict", currentRevision: revisionError.currentRevision },
      });
      return;
    }

    const editor = getEditor();
    if (!editor) {
      throw new Error("No active editor");
    }

    if (!target) {
      throw new Error("target is required");
    }

    if (!operations || operations.length === 0) {
      throw new Error("At least one operation is required");
    }

    // Find the table
    const table = findTable(editor.state.doc, target);
    if (!table) {
      await respond({
        id,
        success: false,
        error: "Table not found",
        data: { code: "not_found" },
      });
      return;
    }

    // For dryRun, return preview
    if (mode === "dryRun") {
      await respond({
        id,
        success: true,
        data: {
          success: true,
          preview: {
            tablePosition: table.pos,
            operationCount: operations.length,
            operations: operations.map((op) => op.action),
          },
          isDryRun: true,
        },
      });
      return;
    }

    // For suggest mode, table operations are complex - show warning
    if (mode === "suggest" || !isAutoApproveEnabled()) {
      await respond({
        id,
        success: true,
        data: {
          success: false,
          warning: "Table batch operations in suggest mode not yet supported. Use mode='apply' or enable auto-approve.",
          operationCount: operations.length,
        },
      });
      return;
    }

    // Apply operations
    const warnings: string[] = [];
    let appliedCount = 0;

    // Position cursor in table first
    editor.chain().focus().setTextSelection(table.pos + 1).run();

    // Separate update_cell ops from structural ops.
    // update_cell ops are batched into a single transaction to avoid stale positions.
    // Structural ops (add/delete row/column) use editor commands and are applied individually.
    const normalizedOps = operations.map((rawOp) => {
      try {
        return { op: normalizeTableOp(rawOp), rawOp, error: null };
      } catch (e) {
        return { op: null, rawOp, error: e instanceof Error ? e.message : String(e) };
      }
    });

    // Phase 1: Apply structural operations (add/delete rows/columns, set_header)
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
        const action = (rawOp as Record<string, unknown>).action ?? (rawOp as Record<string, unknown>).type ?? (rawOp as Record<string, unknown>).op ?? "unknown";
        warnings.push(`Failed: ${action} - ${opError instanceof Error ? opError.message : String(opError)}`);
      }
    }

    // Phase 2: Batch all update_cell operations into a single transaction.
    // Re-find the table after structural ops may have changed the document.
    const cellOps = normalizedOps.filter((n) => n.op?.action === "update_cell");
    if (cellOps.length > 0) {
      const updatedTable = findTable(editor.state.doc, target);
      if (!updatedTable) {
        warnings.push("Table not found after structural operations — cell updates skipped");
      } else {
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
      }
    }

    const newRevision = getCurrentRevision();

    await respond({
      id,
      success: true,
      data: {
        success: true,
        newRevision,
        appliedCount,
        warnings,
      },
    });
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Handle list.batchModify request.
 */
export async function handleListBatchModify(
  id: string,
  args: Record<string, unknown>
): Promise<void> {
  try {
    const baseRevision = args.baseRevision as string;
    const target = args.target as ListTarget;
    const operations = args.operations as ListOperation[];
    const mode = (args.mode as OperationMode) ?? "apply";

    // Validate revision
    const revisionError = validateBaseRevision(baseRevision);
    if (revisionError) {
      await respond({
        id,
        success: false,
        error: revisionError.error,
        data: { code: "conflict", currentRevision: revisionError.currentRevision },
      });
      return;
    }

    const editor = getEditor();
    if (!editor) {
      throw new Error("No active editor");
    }

    if (!target) {
      throw new Error("target is required");
    }

    if (!operations || operations.length === 0) {
      throw new Error("At least one operation is required");
    }

    // Find the list
    const list = findList(editor.state.doc, target);
    if (!list) {
      await respond({
        id,
        success: false,
        error: "List not found",
        data: { code: "not_found" },
      });
      return;
    }

    // For dryRun, return preview
    if (mode === "dryRun") {
      await respond({
        id,
        success: true,
        data: {
          success: true,
          preview: {
            listPosition: list.pos,
            listType: list.type,
            operationCount: operations.length,
            operations: operations.map((op) => op.action),
          },
          isDryRun: true,
        },
      });
      return;
    }

    // For suggest mode, list operations are complex
    if (mode === "suggest" || !isAutoApproveEnabled()) {
      await respond({
        id,
        success: true,
        data: {
          success: false,
          warning: "List batch operations in suggest mode not yet supported. Use mode='apply' or enable auto-approve.",
          operationCount: operations.length,
        },
      });
      return;
    }

    // Apply operations
    const warnings: string[] = [];
    let appliedCount = 0;

    // Position cursor in list first
    editor.chain().focus().setTextSelection(list.pos + 1).run();

    // Helper: find the ProseMirror position of the nth list item
    const findListItemPos = (listNode: ProseMirrorNode, listPos: number, index: number): number | null => {
      let itemIndex = 0;
      let result: number | null = null;
      listNode.forEach((child, offset) => {
        if (result !== null) return;
        if (child.type.name === "listItem" || child.type.name === "taskItem") {
          if (itemIndex === index) {
            result = listPos + 1 + offset;
          }
          itemIndex++;
        }
      });
      return result;
    };

    for (const rawOp of operations) {
      try {
        // Accept "action", "type", or "op" as the operation key for robustness
        const op = normalizeListOp(rawOp);

        // Position cursor at target list item if `at` is specified
        if ("at" in op && typeof op.at === "number") {
          const itemPos = findListItemPos(list.node, list.pos, op.at);
          if (itemPos !== null) {
            editor.chain().focus().setTextSelection(itemPos + 1).run();
          } else {
            warnings.push(`${op.action}: list item at index ${op.at} not found`);
            continue;
          }
        }

        switch (op.action) {
          case "add_item":
            // Split list item and add new content
            editor.commands.splitListItem("listItem");
            if (op.text) {
              const itemSlice = createMarkdownPasteSlice(editor.state, op.text);
              const itemTr = editor.state.tr.replaceSelection(itemSlice);
              editor.view.dispatch(itemTr);
            }
            appliedCount++;
            break;

          case "delete_item":
            // Delete current list item
            editor.commands.deleteNode("listItem");
            appliedCount++;
            break;

          case "update_item":
            // Select list item content and replace
            warnings.push(`update_item at ${op.at} - requires item selection`);
            break;

          case "toggle_check": {
            // Toggle the checked attribute on the task item, not the list type
            if (list.type !== "taskList") {
              warnings.push("toggle_check only works on task lists");
              break;
            }
            // Find the current task item node and toggle its checked attr
            const { $from } = editor.state.selection;
            for (let d = $from.depth; d >= 0; d--) {
              const node = $from.node(d);
              if (node.type.name === "taskItem") {
                const pos = $from.before(d);
                const tr = editor.state.tr.setNodeMarkup(pos, undefined, {
                  ...node.attrs,
                  checked: !node.attrs.checked,
                });
                editor.view.dispatch(tr);
                appliedCount++;
                break;
              }
            }
            break;
          }

          case "reorder":
            warnings.push("reorder operation requires complex node manipulation");
            break;

          case "set_indent":
            if (op.indent > 0) {
              editor.commands.sinkListItem("listItem");
            } else {
              editor.commands.liftListItem("listItem");
            }
            appliedCount++;
            break;

          default:
            warnings.push(`Unknown list operation: ${(op as { action: string }).action}`);
        }
      } catch (opError) {
        const action = (rawOp as Record<string, unknown>).action ?? (rawOp as Record<string, unknown>).type ?? (rawOp as Record<string, unknown>).op ?? "unknown";
        warnings.push(`Failed: ${action} - ${opError instanceof Error ? opError.message : String(opError)}`);
      }
    }

    const newRevision = getCurrentRevision();

    await respond({
      id,
      success: true,
      data: {
        success: true,
        newRevision,
        appliedCount,
        warnings,
      },
    });
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
