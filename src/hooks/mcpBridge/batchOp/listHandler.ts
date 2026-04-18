/**
 * MCP Bridge — List batch operation handler.
 *
 * Executes add/delete/update_item, toggle_check, reorder, and set_indent
 * operations inside a target bullet/ordered/task list.
 *
 * @module hooks/mcpBridge/batchOp/listHandler
 */

import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { respond, getEditor, isAutoApproveEnabled } from "../utils";
import { validateBaseRevision, getCurrentRevision } from "../revisionTracker";
import { createMarkdownPasteSlice } from "@/plugins/markdownPaste/tiptap";
import { requireEnum, requireObject, requireTypedArray } from "../validateArgs";
import { OPERATION_MODES } from "../types";
import {
  normalizeOp,
  type ListTarget,
  type ListOperation,
} from "./shared";

/** Find a list in the document by target specification. */
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

function normalizeListOp(raw: ListOperation | Record<string, unknown>): ListOperation {
  return normalizeOp<ListOperation>(raw, "'add_item', 'delete_item'");
}

/** Handle list.batchModify request. */
export async function handleListBatchModify(
  id: string,
  args: Record<string, unknown>
): Promise<void> {
  try {
    const baseRevision = typeof args.baseRevision === "string" ? args.baseRevision : "";
    const target = requireObject<ListTarget>(args, "target");
    const operations = requireTypedArray<ListOperation>(args, "operations", (item, index) => {
      if (typeof item !== "object" || item === null) {
        throw new Error(`invalid list operation at index ${index}: expected object`);
      }
      const obj = item as Record<string, unknown>;
      if (typeof obj.action !== "string" && typeof obj.type !== "string" && typeof obj.op !== "string") {
        throw new Error(`invalid list operation at index ${index}: missing required field 'action'`);
      }
      return obj as ListOperation;
    });
    const mode = requireEnum(args, "mode", OPERATION_MODES, "apply");

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

    /* v8 ignore next 3 -- @preserve defensive guard: requireObject already validates target */
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

    // For non-auto-approve, list operations are complex
    if (!isAutoApproveEnabled()) {
      await respond({
        id,
        success: true,
        data: {
          success: false,
          warning: "List batch operations require auto-approve to be enabled in Settings > Integrations.",
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
        // Re-find list after each structural mutation (add/delete changes positions)
        const currentList = findList(editor.state.doc, target);
        if (!currentList) {
          warnings.push("List lost after mutation");
          break;
        }

        // Accept "action", "type", or "op" as the operation key for robustness
        const op = normalizeListOp(rawOp);

        // Position cursor at target list item if `at` is specified
        if ("at" in op && typeof op.at === "number") {
          const itemPos = findListItemPos(currentList.node, currentList.pos, op.at);
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
            if (currentList.type !== "taskList") {
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
