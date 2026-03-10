/**
 * MCP Bridge — Batch Edit Handler
 *
 * Purpose: Handle batch_edit requests — validate, resolve node IDs,
 *   and apply/suggest multiple operations in a single transaction.
 *
 * @coordinates-with suggestionHandlers.ts — wraps mutations in suggestions
 * @module hooks/mcpBridge/batchEditHandler
 */

import {
  respond,
  getEditor,
  isAutoApproveEnabled,
  getActiveTabId,
  resolveNodeId,
  getTextRange,
} from "./utils";
import { requireString, optionalString, requireEnum, requireArray } from "./validateArgs";
import { OPERATION_MODES } from "./types";
import { useAiSuggestionStore } from "@/stores/aiSuggestionStore";
import { idempotencyCache } from "./idempotencyCache";
import { validateBaseRevision, getCurrentRevision } from "./revisionTracker";
import { createMarkdownPasteSlice } from "@/plugins/markdownPaste/tiptap";

interface BatchOperation {
  type: "update" | "insert" | "delete" | "format" | "move";
  nodeId?: string;
  after?: string;
  text?: string;
  content?: string | Record<string, unknown>;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

/**
 * Handle batch_edit request.
 */
export async function handleBatchEdit(
  id: string,
  args: Record<string, unknown>
): Promise<void> {
  try {
    const baseRevision = requireString(args, "baseRevision");
    const requestId = optionalString(args, "requestId");
    const mode = requireEnum(args, "mode", OPERATION_MODES, "apply");
    const operations = requireArray(args, "operations") as BatchOperation[];

    // Check idempotency cache
    if (requestId) {
      const cached = idempotencyCache.get(requestId);
      if (cached) {
        await respond(cached);
        return;
      }
    }

    // Validate revision
    const revisionError = validateBaseRevision(baseRevision);
    if (revisionError) {
      const response = {
        id,
        success: false,
        error: revisionError.error,
        data: {
          code: "conflict",
          currentRevision: revisionError.currentRevision,
        },
      };
      if (requestId) {
        idempotencyCache.set(requestId, response);
      }
      await respond(response);
      return;
    }

    const editor = getEditor();
    if (!editor) {
      throw new Error("No active editor");
    }

    if (!operations || operations.length === 0) {
      throw new Error("At least one operation is required");
    }

    if (operations.length > 100) {
      throw new Error("Maximum 100 operations per batch");
    }

    // For dryRun, just validate and return preview
    if (mode === "dryRun") {
      const response = {
        id,
        success: true,
        data: {
          success: true,
          newRevision: null,
          changedNodeIds: operations.filter((o) => o.type === "update").map((o) => o.nodeId),
          addedNodeIds: [],
          deletedNodeIds: operations.filter((o) => o.type === "delete").map((o) => o.nodeId),
          idRemap: {},
          warnings: [],
          isDryRun: true,
        },
      };
      if (requestId) {
        idempotencyCache.set(requestId, response);
      }
      await respond(response);
      return;
    }

    // Validate required fields for each operation
    const validationErrors: string[] = [];
    for (let i = 0; i < operations.length; i++) {
      const op = operations[i];
      if ((op.type === "update" || op.type === "delete" || op.type === "format" || op.type === "move") && !op.nodeId) {
        validationErrors.push(`Operation ${i}: ${op.type} requires nodeId`);
      }
      if (op.type === "insert" && !op.after && !op.nodeId) {
        // Insert can use 'after' to specify position, or nodeId as target
        // If neither is provided, it's an error (no cursor-based fallback)
        validationErrors.push(`Operation ${i}: insert requires 'after' or 'nodeId' to specify position`);
      }
    }

    if (validationErrors.length > 0) {
      const response = {
        id,
        success: false,
        error: "invalid_operation",
        data: {
          code: "invalid_operation",
          errors: validationErrors,
        },
      };
      if (requestId) {
        idempotencyCache.set(requestId, response);
      }
      await respond(response);
      return;
    }

    // Resolve all node IDs to positions first
    const resolvedOps: Array<{
      op: BatchOperation;
      resolved: { from: number; to: number } | null;
    }> = [];

    for (const op of operations) {
      if (op.nodeId) {
        const resolved = resolveNodeId(editor, op.nodeId);
        if (!resolved) {
          const response = {
            id,
            success: false,
            error: `Node not found: ${op.nodeId}`,
            data: {
              code: "node_not_found",
              nodeId: op.nodeId,
            },
          };
          if (requestId) {
            idempotencyCache.set(requestId, response);
          }
          await respond(response);
          return;
        }
        resolvedOps.push({ op, resolved: { from: resolved.from, to: resolved.to } });
      } else if (op.type === "insert" && op.after) {
        const resolved = resolveNodeId(editor, op.after);
        if (!resolved) {
          const response = {
            id,
            success: false,
            error: `Node not found for 'after': ${op.after}`,
            data: {
              code: "node_not_found",
              nodeId: op.after,
            },
          };
          if (requestId) {
            idempotencyCache.set(requestId, response);
          }
          await respond(response);
          return;
        }
        // Insert after this node
        resolvedOps.push({ op, resolved: { from: resolved.to, to: resolved.to } });
      } else {
        resolvedOps.push({ op, resolved: null });
      }
    }

    // For non-auto-approve, create suggestions for user review
    if (!isAutoApproveEnabled()) {
      const suggestionIds: string[] = [];

      for (const { op, resolved } of resolvedOps) {
        if (op.type === "insert" && typeof op.content === "string" && resolved) {
          const suggestionId = useAiSuggestionStore.getState().addSuggestion({
            tabId: getActiveTabId(),
            type: "insert",
            from: resolved.from,
            to: resolved.to,
            newContent: op.content,
          });
          suggestionIds.push(suggestionId);
        } else if (op.type === "update" && op.text && resolved) {
          // Get the text content range (inside the block, excluding structural tokens)
          const textRange = getTextRange(editor, resolved.from, resolved.to);
          const suggestionId = useAiSuggestionStore.getState().addSuggestion({
            tabId: getActiveTabId(),
            type: "replace",
            from: textRange.from,
            to: textRange.to,
            newContent: op.text,
            originalContent: editor.state.doc.textBetween(textRange.from, textRange.to),
          });
          suggestionIds.push(suggestionId);
        } else if (op.type === "delete" && resolved) {
          const suggestionId = useAiSuggestionStore.getState().addSuggestion({
            tabId: getActiveTabId(),
            type: "delete",
            from: resolved.from,
            to: resolved.to,
            originalContent: editor.state.doc.textBetween(resolved.from, resolved.to),
          });
          suggestionIds.push(suggestionId);
        }
      }

      const response = {
        id,
        success: true,
        data: {
          success: true,
          newRevision: null,
          changedNodeIds: [],
          addedNodeIds: [],
          deletedNodeIds: [],
          idRemap: {},
          warnings: [],
          suggestionIds,
        },
      };
      if (requestId) {
        idempotencyCache.set(requestId, response);
      }
      await respond(response);
      return;
    }

    // Apply mode - execute operations
    const changedNodeIds: string[] = [];
    const addedNodeIds: string[] = [];
    const deletedNodeIds: string[] = [];
    const warnings: string[] = [];

    // Sort operations by position (descending) to preserve positions during edits
    const sortedOps = [...resolvedOps].sort((a, b) => {
      const posA = a.resolved?.from ?? 0;
      /* v8 ignore next -- @preserve defensive fallback: resolved is null only for unrecognized op types with no nodeId */
      const posB = b.resolved?.from ?? 0;
      return posB - posA;
    });

    for (const { op, resolved } of sortedOps) {
      switch (op.type) {
        case "insert":
          if (typeof op.content === "string" && resolved) {
            const insertSlice = createMarkdownPasteSlice(editor.state, op.content);
            const insertTr = editor.state.tr.replaceRange(resolved.from, resolved.from, insertSlice);
            editor.view.dispatch(insertTr);
            addedNodeIds.push(`inserted-${addedNodeIds.length}`);
          }
          break;

        case "update":
          if (op.text && resolved) {
            // Get the text content range
            const textRange = getTextRange(editor, resolved.from, resolved.to);
            const updateSlice = createMarkdownPasteSlice(editor.state, op.text);
            const updateTr = editor.state.tr.replaceRange(textRange.from, textRange.to, updateSlice);
            editor.view.dispatch(updateTr);
            // Validation ensures nodeId is present for update ops
            /* v8 ignore next -- @preserve defensive fallback: validation ensures nodeId is truthy for update ops */
            changedNodeIds.push(op.nodeId || `updated-${changedNodeIds.length}`);
          }
          break;

        case "delete":
          /* v8 ignore start -- @preserve defensive guard: validation ensures delete ops always have a resolved position */
          if (resolved) {
            editor.chain()
              .focus()
              .setTextSelection({ from: resolved.from, to: resolved.to })
              .deleteSelection()
              .run();
            // Validation ensures nodeId is present for delete ops
            deletedNodeIds.push(op.nodeId || `deleted-${deletedNodeIds.length}`);
          }
          /* v8 ignore stop */
          break;

        case "format":
          if (op.marks && resolved) {
            const textRange = getTextRange(editor, resolved.from, resolved.to);
            editor.chain()
              .focus()
              .setTextSelection({ from: textRange.from, to: textRange.to })
              .run();
            for (const mark of op.marks) {
              editor.commands.toggleMark(mark.type, mark.attrs);
            }
            // Validation ensures nodeId is present for format ops
            /* v8 ignore next -- @preserve defensive fallback: validation ensures nodeId is truthy for format ops */
            changedNodeIds.push(op.nodeId || `formatted-${changedNodeIds.length}`);
          }
          break;

        default:
          warnings.push(`Unknown operation type: ${op.type}`);
      }
    }

    const newRevision = getCurrentRevision();

    const response = {
      id,
      success: true,
      data: {
        success: true,
        newRevision,
        changedNodeIds,
        addedNodeIds,
        deletedNodeIds,
        idRemap: {},
        warnings,
      },
    };
    if (requestId) {
      idempotencyCache.set(requestId, response);
    }
    await respond(response);
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
