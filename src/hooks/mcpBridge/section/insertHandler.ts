/**
 * section.insert handler — insert a new heading (and optional content) after
 * an existing section, or at end of document.
 *
 * @module hooks/mcpBridge/section/insertHandler
 */

import { respond, getEditor, isAutoApproveEnabled, getActiveTabId } from "../utils";
import { useAiSuggestionStore } from "@/stores/aiSuggestionStore";
import { validateBaseRevision, getCurrentRevision } from "../revisionTracker";
import {
  requireString,
  requireEnum,
  stringWithDefault,
  requireObject,
  optionalObject,
} from "../validateArgs";
import { OPERATION_MODES } from "../types";
import { findSection, type SectionTarget, type NewHeading } from "./shared";

export async function handleSectionInsert(
  id: string,
  args: Record<string, unknown>
): Promise<void> {
  try {
    const baseRevision = requireString(args, "baseRevision");
    const after = optionalObject<SectionTarget>(args, "after");
    const heading = requireObject<NewHeading>(args, "heading", ["level", "text"]);
    const content = stringWithDefault(args, "content", "");
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

    /* v8 ignore next 3 -- @preserve defensive guard: requireObject with requiredKeys already validates heading */
    if (!heading || !heading.level || !heading.text) {
      throw new Error("heading with level and text is required");
    }

    // Determine insertion position
    let insertPos: number;

    if (after) {
      const afterSection = findSection(editor.state.doc, after);
      if (!afterSection) {
        await respond({
          id,
          success: false,
          error: "After section not found",
          data: { code: "not_found" },
        });
        return;
      }
      insertPos = afterSection.to;
    } else {
      // Insert at end of document
      insertPos = editor.state.doc.content.size;
    }

    // Build clean markdown for suggestion path (parsed by createMarkdownPasteSlice)
    const headingMarkdown = "#".repeat(heading.level) + " " + heading.text;
    const markdownContent = content ? headingMarkdown + "\n\n" + content : headingMarkdown;

    // Build ProseMirror JSON nodes for direct apply path
    const jsonNodes: Record<string, unknown>[] = [
      {
        type: "heading",
        attrs: { level: heading.level },
        content: [{ type: "text", text: heading.text }],
      },
    ];
    if (content) {
      jsonNodes.push({
        type: "paragraph",
        content: [{ type: "text", text: content }],
      });
    }

    // For dryRun, return preview
    if (mode === "dryRun") {
      await respond({
        id,
        success: true,
        data: {
          success: true,
          preview: {
            insertPosition: insertPos,
            headingLevel: heading.level,
            headingText: heading.text,
            contentLength: content.length,
          },
          isDryRun: true,
        },
      });
      return;
    }

    // For non-auto-approve, create suggestion for user review
    if (!isAutoApproveEnabled()) {
      const suggestionId = useAiSuggestionStore.getState().addSuggestion({
        tabId: getActiveTabId(),
        type: "insert",
        from: insertPos,
        to: insertPos,
        newContent: markdownContent,
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

    // Apply the insert using ProseMirror JSON nodes (not markdown strings)
    editor.chain()
      .focus()
      .setTextSelection(insertPos)
      .insertContent(jsonNodes)
      .run();

    const newRevision = getCurrentRevision();

    await respond({
      id,
      success: true,
      data: {
        success: true,
        newRevision,
        headingText: heading.text,
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
