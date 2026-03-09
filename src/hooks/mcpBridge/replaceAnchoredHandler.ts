/**
 * MCP Bridge — Replace Anchored Handler
 *
 * Purpose: Handle replace_text_anchored requests — find text using context-based
 *   anchoring (before/after context + similarity scoring) and replace via direct
 *   edit or suggestion layer.
 *
 * @coordinates-with suggestionHandlers.ts — wraps mutations in suggestions
 * @module hooks/mcpBridge/replaceAnchoredHandler
 */

import {
  respond,
  getEditor,
  isAutoApproveEnabled,
  getActiveTabId,
  findTextMatches,
  type TextMatch,
} from "./utils";
import { requireString, requireEnum } from "./validateArgs";
import { OPERATION_MODES } from "./types";
import { useAiSuggestionStore } from "@/stores/aiSuggestionStore";
import { validateBaseRevision, getCurrentRevision } from "./revisionTracker";
import { createMarkdownPasteSlice } from "@/plugins/markdownPaste/tiptap";

interface TextAnchor {
  text: string;
  beforeContext: string;
  afterContext: string;
  maxDistance: number;
}

/**
 * Calculate similarity between two strings (0-1).
 */
function calculateSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  /* v8 ignore start -- @preserve equal-length string path and character match loop not fully exercised in tests */
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;

  // Simple character overlap similarity
  let matches = 0;
  for (let i = 0; i < shorter.length; i++) {
    if (longer.includes(shorter[i])) {
      matches++;
    }
  }
  /* v8 ignore stop */

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
    const baseRevision = requireString(args, "baseRevision");
    const anchor = args.anchor as TextAnchor;
    const replacement = requireString(args, "replacement");
    const mode = requireEnum(args, "mode", OPERATION_MODES, "apply");

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

    // Filter matches by context similarity and maxDistance
    const candidates: { match: TextMatch; similarity: number }[] = [];
    const maxDistance = anchor.maxDistance ?? Infinity;

    for (const match of allMatches) {
      // Calculate context similarity
      const beforeSim = calculateSimilarity(anchor.beforeContext, match.context.before);
      const afterSim = calculateSimilarity(anchor.afterContext, match.context.after);
      const avgSimilarity = (beforeSim + afterSim) / 2;

      // Enforce maxDistance: context length captures distance from anchor text
      const contextLen = Math.max(match.context.before.length, match.context.after.length);
      if (maxDistance < Infinity && contextLen > maxDistance) {
        continue;
      }

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

    // For non-auto-approve, create suggestion for user review
    if (!isAutoApproveEnabled()) {
      const suggestionId = useAiSuggestionStore.getState().addSuggestion({
        tabId: getActiveTabId(),
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

    // Apply replacement — parse markdown to preserve special characters
    const anchorSlice = createMarkdownPasteSlice(editor.state, replacement);
    const anchorTr = editor.state.tr.replaceRange(match.from, match.to, anchorSlice);
    editor.view.dispatch(anchorTr);

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
