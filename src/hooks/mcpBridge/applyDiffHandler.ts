/**
 * MCP Bridge — Apply Diff Handler
 *
 * Purpose: Handle apply_diff requests — find text matches in the document,
 *   apply match policy (first/all/nth/error_if_multiple), and replace via
 *   direct edit or suggestion layer.
 *
 * @coordinates-with suggestionHandlers.ts — wraps mutations in suggestions
 * @module hooks/mcpBridge/applyDiffHandler
 */

import {
  respond,
  getEditor,
  isAutoApproveEnabled,
  getActiveTabId,
  findTextMatches,
  type TextMatch,
} from "./utils";
import { useAiSuggestionStore } from "@/stores/aiSuggestionStore";
import { validateBaseRevision, getCurrentRevision } from "./revisionTracker";
import { createMarkdownPasteSlice } from "@/plugins/markdownPaste/tiptap";

// Types
type OperationMode = "apply" | "suggest" | "dryRun";
type MatchPolicy = "first" | "all" | "nth" | "error_if_multiple";

/**
 * Handle apply_diff request.
 */
export async function handleApplyDiff(
  id: string,
  args: Record<string, unknown>
): Promise<void> {
  try {
    const baseRevision = args.baseRevision as string;
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

    if (matchPolicy === "error_if_multiple") {
      if (matches.length > 1) {
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
      // Exactly 1 match — treat as "first" (fall through to apply)
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
      if (matchPolicy === "first" || matchPolicy === "error_if_multiple") appliedCount = 1;
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

      if (matchPolicy === "first" || matchPolicy === "error_if_multiple") {
        matchesToProcess = [matches[0]];
      } else if (matchPolicy === "all") {
        matchesToProcess = matches;
      } else if (matchPolicy === "nth" && nth !== undefined) {
        matchesToProcess = [matches[nth]];
      }

      for (const match of matchesToProcess) {
        const suggestionId = useAiSuggestionStore.getState().addSuggestion({
          tabId: getActiveTabId(),
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

    if (matchPolicy === "first" || matchPolicy === "error_if_multiple") {
      const match = matches[0];
      const diffSlice = createMarkdownPasteSlice(editor.state, replacement);
      const diffTr = editor.state.tr.replaceRange(match.from, match.to, diffSlice);
      editor.view.dispatch(diffTr);
      appliedCount = 1;
    } else if (matchPolicy === "all") {
      // Apply in reverse order to preserve positions
      const sortedMatches = [...matches].sort((a, b) => b.from - a.from);
      for (const match of sortedMatches) {
        const diffSlice = createMarkdownPasteSlice(editor.state, replacement);
        const diffTr = editor.state.tr.replaceRange(match.from, match.to, diffSlice);
        editor.view.dispatch(diffTr);
        appliedCount++;
      }
    } else if (matchPolicy === "nth" && nth !== undefined) {
      const match = matches[nth];
      const diffSlice = createMarkdownPasteSlice(editor.state, replacement);
      const diffTr = editor.state.tr.replaceRange(match.from, match.to, diffSlice);
      editor.view.dispatch(diffTr);
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
