/**
 * section.update handler — replace the content of a heading-delimited section.
 *
 * @module hooks/mcpBridge/section/updateHandler
 */

import { respond, getEditor, isAutoApproveEnabled, getActiveTabId } from "../utils";
import { useAiSuggestionStore } from "@/stores/aiSuggestionStore";
import { validateBaseRevision, getCurrentRevision } from "../revisionTracker";
import { createMarkdownPasteSlice } from "@/plugins/markdownPaste/tiptap";
import { requireString, requireEnum, requireObject } from "../validateArgs";
import { OPERATION_MODES } from "../types";
import { findSection, type SectionTarget } from "./shared";

export async function handleSectionUpdate(
  id: string,
  args: Record<string, unknown>
): Promise<void> {
  try {
    const baseRevision = requireString(args, "baseRevision");
    const target = requireObject<SectionTarget>(args, "target");
    const newContent = requireString(args, "newContent");
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

    // Find the section
    const section = findSection(editor.state.doc, target);
    if (!section) {
      await respond({
        id,
        success: false,
        error: "Section not found",
        data: { code: "not_found" },
      });
      return;
    }

    // Get position after the heading (content start)
    let contentStart = section.from;
    editor.state.doc.nodesBetween(section.from, section.to, (node, pos) => {
      if (pos === section.from && node.type.name === "heading") {
        contentStart = pos + node.nodeSize;
        return false;
      }
      return true;
    });

    // For dryRun, return preview
    if (mode === "dryRun") {
      await respond({
        id,
        success: true,
        data: {
          success: true,
          preview: {
            sectionHeading: section.headingText,
            contentRange: { from: contentStart, to: section.to },
            newContentLength: newContent.length,
          },
          isDryRun: true,
        },
      });
      return;
    }

    // For non-auto-approve, create suggestion for user review
    if (!isAutoApproveEnabled()) {
      const originalContent = editor.state.doc.textBetween(contentStart, section.to);
      const suggestionId = useAiSuggestionStore.getState().addSuggestion({
        tabId: getActiveTabId(),
        type: "replace",
        from: contentStart,
        to: section.to,
        newContent: newContent,
        originalContent,
      });

      await respond({
        id,
        success: true,
        data: {
          success: true,
          suggestionIds: [suggestionId],
        },
      });
      return;
    }

    // Apply the update — parse markdown to ProseMirror nodes first so that
    // special characters (e.g. pipe `|` in tables) are preserved correctly.
    // insertContent(string) treats the string as plain text and escapes it.
    const slice = createMarkdownPasteSlice(editor.state, newContent);
    const tr = editor.state.tr.replaceRange(contentStart, section.to, slice);
    editor.view.dispatch(tr);

    const newRevision = getCurrentRevision();

    await respond({
      id,
      success: true,
      data: {
        success: true,
        newRevision,
        sectionHeading: section.headingText,
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
