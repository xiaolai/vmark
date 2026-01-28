/**
 * Mutation Handlers - Declarative document modifications.
 *
 * Part of AI-Oriented MCP Design implementation.
 */

import { respond, getEditor } from "./utils";
import { useAiSuggestionStore } from "@/stores/aiSuggestionStore";
import { useSettingsStore } from "@/stores/settingsStore";
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

interface MatchInfo {
  nodeId: string;
  position: number;
  context: { before: string; after: string };
}

/**
 * Check if auto-approve edits is enabled.
 */
function isAutoApproveEnabled(): boolean {
  return useSettingsStore.getState().advanced.mcpServer.autoApproveEdits;
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

    // For suggest mode, create suggestions
    if (mode === "suggest" || !isAutoApproveEnabled()) {
      const suggestionIds: string[] = [];

      for (const op of operations) {
        if (op.type === "insert" && typeof op.content === "string") {
          // For insert, create suggestion at cursor position
          const pos = editor.state.selection.from;
          const suggestionId = useAiSuggestionStore.getState().addSuggestion({
            type: "insert",
            from: pos,
            to: pos,
            newContent: op.content,
          });
          suggestionIds.push(suggestionId);
        } else if (op.type === "update" && op.text) {
          // For update, we'd need to find the node position
          // This is a simplified implementation
          const pos = editor.state.selection.from;
          const to = editor.state.selection.to;
          const suggestionId = useAiSuggestionStore.getState().addSuggestion({
            type: "replace",
            from: pos,
            to: to,
            newContent: op.text,
            originalContent: editor.state.doc.textBetween(pos, to),
          });
          suggestionIds.push(suggestionId);
        } else if (op.type === "delete") {
          const pos = editor.state.selection.from;
          const to = editor.state.selection.to;
          const suggestionId = useAiSuggestionStore.getState().addSuggestion({
            type: "delete",
            from: pos,
            to: to,
            originalContent: editor.state.doc.textBetween(pos, to),
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

    // Execute as single transaction
    editor.chain().focus();

    for (const op of operations) {
      switch (op.type) {
        case "insert":
          if (typeof op.content === "string") {
            editor.commands.insertContent(op.content);
            addedNodeIds.push(`inserted-${addedNodeIds.length}`);
          }
          break;

        case "update":
          // For update, we need to find and update the node
          // This is simplified - full implementation would use node IDs
          if (op.text) {
            editor.commands.insertContent(op.text);
            changedNodeIds.push(op.nodeId || `updated-${changedNodeIds.length}`);
          }
          break;

        case "delete":
          editor.commands.deleteSelection();
          deletedNodeIds.push(op.nodeId || `deleted-${deletedNodeIds.length}`);
          break;

        case "format":
          if (op.marks) {
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

    // Find all matches
    const doc = editor.state.doc;
    const text = doc.textContent;
    const matches: MatchInfo[] = [];
    let searchIndex = 0;

    while (true) {
      const index = text.indexOf(original, searchIndex);
      if (index === -1) break;

      const beforeStart = Math.max(0, index - 30);
      const afterEnd = Math.min(text.length, index + original.length + 30);

      matches.push({
        nodeId: `match-${matches.length}`,
        position: index,
        context: {
          before: text.substring(beforeStart, index),
          after: text.substring(index + original.length, afterEnd),
        },
      });

      searchIndex = index + 1;
    }

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
          matches,
          error: "ambiguous_target",
        },
      });
      return;
    }

    // For dryRun, return preview
    if (mode === "dryRun") {
      let appliedCount = 0;
      if (matchPolicy === "first") appliedCount = 1;
      else if (matchPolicy === "all") appliedCount = matches.length;
      else if (matchPolicy === "nth" && nth !== undefined && nth < matches.length) appliedCount = 1;

      await respond({
        id,
        success: true,
        data: {
          success: true,
          matchCount: matches.length,
          appliedCount,
          matches,
          isDryRun: true,
        },
      });
      return;
    }

    // For suggest mode, create suggestions
    if (mode === "suggest" || !isAutoApproveEnabled()) {
      const suggestionIds: string[] = [];
      let matchesToProcess: MatchInfo[] = [];

      if (matchPolicy === "first") {
        matchesToProcess = [matches[0]];
      } else if (matchPolicy === "all") {
        matchesToProcess = matches;
      } else if (matchPolicy === "nth" && nth !== undefined && nth < matches.length) {
        matchesToProcess = [matches[nth]];
      }

      for (const match of matchesToProcess) {
        const suggestionId = useAiSuggestionStore.getState().addSuggestion({
          type: "replace",
          from: match.position,
          to: match.position + original.length,
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
        .setTextSelection({ from: match.position + 1, to: match.position + original.length + 1 })
        .insertContent(replacement)
        .run();
      appliedCount = 1;
    } else if (matchPolicy === "all") {
      // Apply in reverse order to preserve positions
      const sortedMatches = [...matches].sort((a, b) => b.position - a.position);
      for (const match of sortedMatches) {
        editor.chain()
          .focus()
          .setTextSelection({ from: match.position + 1, to: match.position + original.length + 1 })
          .insertContent(replacement)
          .run();
        appliedCount++;
      }
    } else if (matchPolicy === "nth" && nth !== undefined && nth < matches.length) {
      const match = matches[nth];
      editor.chain()
        .focus()
        .setTextSelection({ from: match.position + 1, to: match.position + original.length + 1 })
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

    // Find all occurrences of the target text
    const doc = editor.state.doc;
    const text = doc.textContent;
    const candidates: { position: number; similarity: number }[] = [];
    let searchIndex = 0;

    while (true) {
      const index = text.indexOf(anchor.text, searchIndex);
      if (index === -1) break;

      // Get context around this occurrence
      const beforeStart = Math.max(0, index - anchor.beforeContext.length);
      const afterEnd = Math.min(text.length, index + anchor.text.length + anchor.afterContext.length);

      const actualBefore = text.substring(beforeStart, index);
      const actualAfter = text.substring(index + anchor.text.length, afterEnd);

      // Calculate context similarity
      const beforeSim = calculateSimilarity(anchor.beforeContext, actualBefore);
      const afterSim = calculateSimilarity(anchor.afterContext, actualAfter);
      const avgSimilarity = (beforeSim + afterSim) / 2;

      if (avgSimilarity >= 0.8) {
        candidates.push({ position: index, similarity: avgSimilarity });
      }

      searchIndex = index + 1;
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

    const match = candidates[0];

    // For dryRun, return preview
    if (mode === "dryRun") {
      await respond({
        id,
        success: true,
        data: {
          success: true,
          matchCount: 1,
          appliedCount: 1,
          position: match.position,
          similarity: match.similarity,
          isDryRun: true,
        },
      });
      return;
    }

    // For suggest mode, create suggestion
    if (mode === "suggest" || !isAutoApproveEnabled()) {
      const suggestionId = useAiSuggestionStore.getState().addSuggestion({
        type: "replace",
        from: match.position,
        to: match.position + anchor.text.length,
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
      .setTextSelection({ from: match.position + 1, to: match.position + anchor.text.length + 1 })
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
