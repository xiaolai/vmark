/**
 * Mutation Handlers - Declarative document modifications.
 *
 * Part of AI-Oriented MCP Design implementation.
 */

import {
  respond,
  getEditor,
  isAutoApproveEnabled,
  findTextMatches,
  resolveNodeId,
  getTextRange,
  type TextMatch,
} from "./utils";
import { useAiSuggestionStore } from "@/stores/aiSuggestionStore";
import { idempotencyCache } from "./idempotencyCache";
import { validateBaseRevision, getCurrentRevision } from "./revisionTracker";

// Types
type OperationMode = "apply" | "suggest" | "dryRun";
type MatchPolicy = "first" | "all" | "nth" | "error_if_multiple";

interface BatchOperation {
  type: "update" | "insert" | "delete" | "format" | "move";
  nodeId?: string;
  after?: string;
  text?: string;
  content?: string | Record<string, unknown>;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

interface BlockQuery {
  type?: string | string[];
  level?: number;
  contains?: string;
  hasMarks?: string[];
}

interface TextAnchor {
  text: string;
  beforeContext: string;
  afterContext: string;
  maxDistance: number;
}

/**
 * Handle batch_edit request.
 */
export async function handleBatchEdit(
  id: string,
  args: Record<string, unknown>
): Promise<void> {
  try {
    const baseRevision = args.baseRevision as string;
    const requestId = args.requestId as string | undefined;
    const mode = (args.mode as OperationMode) ?? "apply";
    const operations = args.operations as BatchOperation[];

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

    // For suggest mode, create suggestions
    if (mode === "suggest" || !isAutoApproveEnabled()) {
      const suggestionIds: string[] = [];

      for (const { op, resolved } of resolvedOps) {
        if (op.type === "insert" && typeof op.content === "string" && resolved) {
          const suggestionId = useAiSuggestionStore.getState().addSuggestion({
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
            type: "replace",
            from: textRange.from,
            to: textRange.to,
            newContent: op.text,
            originalContent: editor.state.doc.textBetween(textRange.from, textRange.to),
          });
          suggestionIds.push(suggestionId);
        } else if (op.type === "delete" && resolved) {
          const suggestionId = useAiSuggestionStore.getState().addSuggestion({
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
      const posB = b.resolved?.from ?? 0;
      return posB - posA;
    });

    for (const { op, resolved } of sortedOps) {
      switch (op.type) {
        case "insert":
          if (typeof op.content === "string" && resolved) {
            editor.chain()
              .focus()
              .setTextSelection(resolved.from)
              .insertContent(op.content)
              .run();
            addedNodeIds.push(`inserted-${addedNodeIds.length}`);
          }
          break;

        case "update":
          if (op.text && resolved) {
            // Get the text content range
            const textRange = getTextRange(editor, resolved.from, resolved.to);
            editor.chain()
              .focus()
              .setTextSelection({ from: textRange.from, to: textRange.to })
              .insertContent(op.text)
              .run();
            changedNodeIds.push(op.nodeId || `updated-${changedNodeIds.length}`);
          }
          break;

        case "delete":
          if (resolved) {
            editor.chain()
              .focus()
              .setTextSelection({ from: resolved.from, to: resolved.to })
              .deleteSelection()
              .run();
            deletedNodeIds.push(op.nodeId || `deleted-${deletedNodeIds.length}`);
          }
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

/**
 * Handle apply_diff request.
 */
export async function handleApplyDiff(
  id: string,
  args: Record<string, unknown>
): Promise<void> {
  try {
    const baseRevision = args.baseRevision as string;
    // Note: scopeQuery support to be implemented in future iteration
    const _scopeQuery = args.scopeQuery as BlockQuery | undefined;
    void _scopeQuery; // Placeholder for future use
    const original = args.original as string;
    const replacement = args.replacement as string;
    const matchPolicy = args.matchPolicy as MatchPolicy;
    const nth = args.nth as number | undefined;
    const mode = (args.mode as OperationMode) ?? "apply";

    // Validate revision
    const revisionError = validateBaseRevision(baseRevision);
    if (revisionError) {
      await respond({
        id,
        success: false,
        error: revisionError.error,
        data: {
          code: "conflict",
          currentRevision: revisionError.currentRevision,
        },
      });
      return;
    }

    const editor = getEditor();
    if (!editor) {
      throw new Error("No active editor");
    }

    if (!original) {
      throw new Error("original is required");
    }

    if (replacement === undefined) {
      throw new Error("replacement is required");
    }

    // Validate nth parameter for matchPolicy="nth"
    if (matchPolicy === "nth") {
      if (nth === undefined || nth === null) {
        await respond({
          id,
          success: false,
          error: "invalid_operation",
          data: {
            code: "invalid_operation",
            message: "nth is required when matchPolicy is 'nth'",
          },
        });
        return;
      }
      if (!Number.isInteger(nth) || nth < 0) {
        await respond({
          id,
          success: false,
          error: "invalid_operation",
          data: {
            code: "invalid_operation",
            message: "nth must be a non-negative integer",
          },
        });
        return;
      }
    }

    // Find all matches using proper ProseMirror position mapping
    const doc = editor.state.doc;
    const matches: TextMatch[] = findTextMatches(doc, original, 30);

    // Handle based on match policy
    if (matches.length === 0) {
      await respond({
        id,
        success: true,
        data: {
          success: true,
          matchCount: 0,
          appliedCount: 0,
        },
      });
      return;
    }

    if (matchPolicy === "error_if_multiple" && matches.length > 1) {
      await respond({
        id,
        success: true,
        data: {
          success: false,
          matchCount: matches.length,
          appliedCount: 0,
          matches: matches.map((m) => ({
            nodeId: m.nodeId,
            pos: { from: m.from, to: m.to },
            context: m.context,
          })),
          error: "ambiguous_target",
        },
      });
      return;
    }

    // Validate nth is within bounds
    if (matchPolicy === "nth" && nth !== undefined && nth >= matches.length) {
      await respond({
        id,
        success: false,
        error: "invalid_operation",
        data: {
          code: "invalid_operation",
          message: `nth (${nth}) is out of range. Only ${matches.length} match(es) found.`,
        },
      });
      return;
    }

    // For dryRun, return preview
    if (mode === "dryRun") {
      let appliedCount = 0;
      if (matchPolicy === "first") appliedCount = 1;
      else if (matchPolicy === "all") appliedCount = matches.length;
      else if (matchPolicy === "nth" && nth !== undefined) appliedCount = 1;

      await respond({
        id,
        success: true,
        data: {
          success: true,
          matchCount: matches.length,
          appliedCount,
          matches: matches.map((m) => ({
            nodeId: m.nodeId,
            pos: { from: m.from, to: m.to },
            context: m.context,
          })),
          isDryRun: true,
        },
      });
      return;
    }

    // For suggest mode, create suggestions
    if (mode === "suggest" || !isAutoApproveEnabled()) {
      const suggestionIds: string[] = [];
      let matchesToProcess: TextMatch[] = [];

      if (matchPolicy === "first") {
        matchesToProcess = [matches[0]];
      } else if (matchPolicy === "all") {
        matchesToProcess = matches;
      } else if (matchPolicy === "nth" && nth !== undefined) {
        matchesToProcess = [matches[nth]];
      }

      for (const match of matchesToProcess) {
        const suggestionId = useAiSuggestionStore.getState().addSuggestion({
          type: "replace",
          from: match.from,
          to: match.to,
          newContent: replacement,
          originalContent: original,
        });
        suggestionIds.push(suggestionId);
      }

      await respond({
        id,
        success: true,
        data: {
          success: true,
          matchCount: matches.length,
          appliedCount: matchesToProcess.length,
          suggestionIds,
        },
      });
      return;
    }

    // Apply replacements
    let appliedCount = 0;

    if (matchPolicy === "first") {
      const match = matches[0];
      editor.chain()
        .focus()
        .setTextSelection({ from: match.from, to: match.to })
        .insertContent(replacement)
        .run();
      appliedCount = 1;
    } else if (matchPolicy === "all") {
      // Apply in reverse order to preserve positions
      const sortedMatches = [...matches].sort((a, b) => b.from - a.from);
      for (const match of sortedMatches) {
        editor.chain()
          .focus()
          .setTextSelection({ from: match.from, to: match.to })
          .insertContent(replacement)
          .run();
        appliedCount++;
      }
    } else if (matchPolicy === "nth" && nth !== undefined) {
      const match = matches[nth];
      editor.chain()
        .focus()
        .setTextSelection({ from: match.from, to: match.to })
        .insertContent(replacement)
        .run();
      appliedCount = 1;
    }

    const newRevision = getCurrentRevision();

    await respond({
      id,
      success: true,
      data: {
        success: true,
        matchCount: matches.length,
        appliedCount,
        newRevision,
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
 * Calculate similarity between two strings (0-1).
 */
function calculateSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;

  // Simple character overlap similarity
  let matches = 0;
  for (let i = 0; i < shorter.length; i++) {
    if (longer.includes(shorter[i])) {
      matches++;
    }
  }

  return matches / longer.length;
}

/**
 * Handle replace_text_anchored request.
 */
export async function handleReplaceAnchored(
  id: string,
  args: Record<string, unknown>
): Promise<void> {
  try {
    const baseRevision = args.baseRevision as string;
    const anchor = args.anchor as TextAnchor;
    const replacement = args.replacement as string;
    const mode = (args.mode as OperationMode) ?? "apply";

    // Validate revision
    const revisionError = validateBaseRevision(baseRevision);
    if (revisionError) {
      await respond({
        id,
        success: false,
        error: revisionError.error,
        data: {
          code: "conflict",
          currentRevision: revisionError.currentRevision,
        },
      });
      return;
    }

    const editor = getEditor();
    if (!editor) {
      throw new Error("No active editor");
    }

    if (!anchor || !anchor.text) {
      throw new Error("anchor.text is required");
    }

    // Find all occurrences of the target text with proper PM positions
    const doc = editor.state.doc;
    const allMatches = findTextMatches(doc, anchor.text, Math.max(anchor.beforeContext.length, anchor.afterContext.length));

    // Filter matches by context similarity
    const candidates: { match: TextMatch; similarity: number }[] = [];

    for (const match of allMatches) {
      // Calculate context similarity
      const beforeSim = calculateSimilarity(anchor.beforeContext, match.context.before);
      const afterSim = calculateSimilarity(anchor.afterContext, match.context.after);
      const avgSimilarity = (beforeSim + afterSim) / 2;

      if (avgSimilarity >= 0.8) {
        candidates.push({ match, similarity: avgSimilarity });
      }
    }

    if (candidates.length === 0) {
      await respond({
        id,
        success: true,
        data: {
          success: false,
          matchCount: 0,
          appliedCount: 0,
          error: "not_found",
          message: "No matching text found with sufficient context similarity",
        },
      });
      return;
    }

    if (candidates.length > 1) {
      await respond({
        id,
        success: true,
        data: {
          success: false,
          matchCount: candidates.length,
          appliedCount: 0,
          error: "ambiguous_target",
          message: `Found ${candidates.length} candidates with similar context`,
        },
      });
      return;
    }

    const { match, similarity } = candidates[0];

    // For dryRun, return preview
    if (mode === "dryRun") {
      await respond({
        id,
        success: true,
        data: {
          success: true,
          matchCount: 1,
          appliedCount: 1,
          pos: { from: match.from, to: match.to },
          similarity,
          isDryRun: true,
        },
      });
      return;
    }

    // For suggest mode, create suggestion
    if (mode === "suggest" || !isAutoApproveEnabled()) {
      const suggestionId = useAiSuggestionStore.getState().addSuggestion({
        type: "replace",
        from: match.from,
        to: match.to,
        newContent: replacement,
        originalContent: anchor.text,
      });

      await respond({
        id,
        success: true,
        data: {
          success: true,
          matchCount: 1,
          appliedCount: 1,
          suggestionIds: [suggestionId],
        },
      });
      return;
    }

    // Apply replacement
    editor.chain()
      .focus()
      .setTextSelection({ from: match.from, to: match.to })
      .insertContent(replacement)
      .run();

    const newRevision = getCurrentRevision();

    await respond({
      id,
      success: true,
      data: {
        success: true,
        matchCount: 1,
        appliedCount: 1,
        newRevision,
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
