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

// Types
type OperationMode = "apply" | "suggest" | "dryRun";

interface TableTarget {
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
 * Normalize a table operation object — accept "action", "type", or "op" as
 * the operation key, and normalize action names (e.g. "updateCell" → "update_cell").
 */
function normalizeTableOp(raw: TableOperation | Record<string, unknown>): TableOperation {
  const r = raw as Record<string, unknown>;
  const action = (r.action ?? r.type ?? r.op) as string | undefined;
  if (!action) {
    throw new Error("Operation must have an 'action' field (e.g. 'update_cell', 'add_row')");
  }
  // Normalize camelCase → snake_case (e.g. "updateCell" → "update_cell")
  const normalized = action.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
  return { ...r, action: normalized } as unknown as TableOperation;
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

    for (const rawOp of operations) {
      try {
        // Accept "action", "type", or "op" as the operation key for robustness
        const op = normalizeTableOp(rawOp);

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

          case "update_cell": {
            // Navigate to the target cell and replace its content
            const cellPos = findCellPosition(table.node, table.pos, op.row, op.col);
            if (cellPos === null) {
              warnings.push(`update_cell at [${op.row},${op.col}] - cell not found`);
              break;
            }
            // Select cell content and replace
            const cellNode = editor.state.doc.nodeAt(cellPos);
            if (cellNode) {
              const contentStart = cellPos + 1; // inside the cell
              const contentEnd = cellPos + cellNode.nodeSize - 1;
              const tr = editor.state.tr;
              // Replace cell text content (first paragraph inside cell)
              tr.replaceWith(
                contentStart,
                contentEnd,
                editor.state.schema.nodes.paragraph.create(
                  null,
                  op.content ? editor.state.schema.text(op.content) : null
                )
              );
              editor.view.dispatch(tr);
              appliedCount++;
            } else {
              warnings.push(`update_cell at [${op.row},${op.col}] - could not resolve cell node`);
            }
            break;
          }

          case "set_header":
            editor.commands.toggleHeaderRow();
            appliedCount++;
            break;

          default:
            warnings.push(`Unknown table operation: ${(op as { action: string }).action}`);
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

    for (const op of operations) {
      try {
        switch (op.action) {
          case "add_item":
            // Split list item and add new content
            editor.commands.splitListItem("listItem");
            if (op.text) {
              editor.commands.insertContent(op.text);
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

          case "toggle_check":
            // For task lists, toggle the checkbox
            if (list.type === "taskList") {
              editor.commands.toggleTaskList();
              appliedCount++;
            } else {
              warnings.push("toggle_check only works on task lists");
            }
            break;

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
        warnings.push(`Failed: ${op.action} - ${opError instanceof Error ? opError.message : String(opError)}`);
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
