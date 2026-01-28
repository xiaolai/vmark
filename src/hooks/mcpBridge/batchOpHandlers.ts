/**
 * Batch Operation Handlers - Table and list batch operations.
 *
 * Part of AI-Oriented MCP Design implementation.
 */

import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { respond, getEditor } from "./utils";
import { useSettingsStore } from "@/stores/settingsStore";
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
 * Check if auto-approve edits is enabled.
 */
function isAutoApproveEnabled(): boolean {
  return useSettingsStore.getState().advanced.mcpServer.autoApproveEdits;
}

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

    for (const op of operations) {
      try {
        switch (op.action) {
          case "add_row":
            // Note: Tiptap table commands work relative to current selection
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

          case "update_cell":
            // Navigate to cell and update - simplified implementation
            warnings.push(`update_cell at [${op.row},${op.col}] - direct cell update requires selection positioning`);
            break;

          case "set_header":
            editor.commands.toggleHeaderRow();
            appliedCount++;
            break;

          default:
            warnings.push(`Unknown table operation: ${(op as any).action}`);
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
            warnings.push(`Unknown list operation: ${(op as any).action}`);
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
