/**
 * section.move handler — relocate a heading-delimited section to after
 * another section (or to start of document).
 *
 * @module hooks/mcpBridge/section/moveHandler
 */

import { respond, getEditor, isAutoApproveEnabled, getActiveTabId } from "../utils";
import { useAiSuggestionStore } from "@/stores/aiSuggestionStore";
import { validateBaseRevision, getCurrentRevision } from "../revisionTracker";
import { serializeMarkdown } from "@/utils/markdownPipeline";
import {
  requireString,
  requireEnum,
  requireObject,
  optionalObject,
} from "../validateArgs";
import { OPERATION_MODES } from "../types";
import { findSection, type SectionTarget } from "./shared";

export async function handleSectionMove(
  id: string,
  args: Record<string, unknown>
): Promise<void> {
  try {
    const baseRevision = requireString(args, "baseRevision");
    const section = requireObject<SectionTarget>(args, "section");
    const after = optionalObject<SectionTarget>(args, "after");
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

    /* v8 ignore next 3 -- @preserve defensive guard: requireObject already validates section */
    if (!section) {
      throw new Error("section is required");
    }

    // Find the section to move
    const sectionRange = findSection(editor.state.doc, section);
    if (!sectionRange) {
      await respond({
        id,
        success: false,
        error: "Section to move not found",
        data: { code: "not_found" },
      });
      return;
    }

    // Determine target position
    let targetPos: number;

    if (after) {
      const afterSection = findSection(editor.state.doc, after);
      if (!afterSection) {
        await respond({
          id,
          success: false,
          error: "Target section not found",
          data: { code: "not_found" },
        });
        return;
      }
      // Guard: moving a section to right after itself is a no-op
      if (afterSection.from === sectionRange.from && afterSection.to === sectionRange.to) {
        await respond({
          id,
          success: true,
          data: {
            success: true,
            warning: "Source and target are the same section — no move needed",
            movedSection: sectionRange.headingText,
          },
        });
        return;
      }
      // Guard: target position inside the moving section would corrupt the document
      if (afterSection.to > sectionRange.from && afterSection.to < sectionRange.to) {
        await respond({
          id,
          success: false,
          error: "Target position is inside the section being moved",
          data: { code: "invalid_operation" },
        });
        return;
      }
      targetPos = afterSection.to;
    } else {
      // Move to start of document (after any leading content)
      targetPos = 0;
    }

    // Slice section content preserving all formatting (bold, tables, etc.)
    const sectionSlice = editor.state.doc.slice(sectionRange.from, sectionRange.to);
    // Markdown version for suggestion preview (preserves formatting)
    const sectionDoc = editor.state.schema.nodes.doc.create(null, sectionSlice.content);
    const sectionMarkdown = serializeMarkdown(editor.state.schema, sectionDoc);

    // For dryRun, return preview
    if (mode === "dryRun") {
      await respond({
        id,
        success: true,
        data: {
          success: true,
          preview: {
            sectionHeading: sectionRange.headingText,
            fromRange: { from: sectionRange.from, to: sectionRange.to },
            targetPosition: targetPos,
          },
          isDryRun: true,
        },
      });
      return;
    }

    // For non-auto-approve, create delete + insert suggestions for user review
    if (!isAutoApproveEnabled()) {
      // Create delete + insert suggestions
      const deleteId = useAiSuggestionStore.getState().addSuggestion({
        tabId: getActiveTabId(),
        type: "delete",
        from: sectionRange.from,
        to: sectionRange.to,
        originalContent: sectionMarkdown,
      });

      // Note: These are separate suggestions — accepting one may invalidate the
      // other's positions. Accept/reject both together for correct results.
      const insertId = useAiSuggestionStore.getState().addSuggestion({
        tabId: getActiveTabId(),
        type: "insert",
        from: targetPos,
        to: targetPos,
        newContent: sectionMarkdown,
      });

      await respond({
        id,
        success: true,
        data: {
          success: true,
          suggestionIds: [deleteId, insertId],
          warning: "Move represented as delete+insert suggestions — accept/reject both together to avoid stale positions",
        },
      });
      return;
    }

    // Apply the move atomically in a single transaction to avoid stale positions.
    // Use doc.slice() to preserve all formatting (bold, tables, links, etc.).
    const moveTr = editor.state.tr;
    if (targetPos > sectionRange.to) {
      // Moving forward: insert at target first, then delete original
      // (inserting first shifts nothing before the delete range)
      moveTr.replace(targetPos, targetPos, sectionSlice);
      moveTr.delete(sectionRange.from, sectionRange.to);
    } else {
      // Moving backward: delete original first, then insert at target
      // (target is before delete range, so target pos stays valid after delete)
      moveTr.delete(sectionRange.from, sectionRange.to);
      moveTr.replace(targetPos, targetPos, sectionSlice);
    }
    editor.view.dispatch(moveTr);

    const newRevision = getCurrentRevision();

    await respond({
      id,
      success: true,
      data: {
        success: true,
        newRevision,
        movedSection: sectionRange.headingText,
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
