/**
 * MCP Bridge — Smart Insert Handlers
 *
 * Purpose: Intuitive content insertion at common document locations —
 *   end of document, start of document, after a specific paragraph
 *   (by index or content match), or after a specific section heading.
 */

import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { respond, getEditor, isAutoApproveEnabled, getActiveTabId } from "./utils";
import { useAiSuggestionStore } from "@/stores/aiSuggestionStore";
import { validateBaseRevision, getCurrentRevision } from "./revisionTracker";
import { createMarkdownPasteSlice } from "@/plugins/markdownPaste/tiptap";

// Types
type OperationMode = "apply" | "suggest";

type SmartInsertDestination =
  | "end_of_document"
  | "start_of_document"
  | { after_paragraph: number }
  | { after_paragraph_containing: string }
  | { after_section: string };

interface SmartInsertResult {
  success: boolean;
  message: string;
  suggestionId?: string;
  applied: boolean;
  newRevision?: string;
  /** Position where content was inserted (ProseMirror offset) */
  insertPosition?: number;
}

/**
 * Extract text content from a ProseMirror node.
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
 * Find insertion position based on destination.
 */
function findInsertPosition(
  doc: ProseMirrorNode,
  destination: SmartInsertDestination
): number | { error: string } {
  // End of document
  if (destination === "end_of_document") {
    return doc.content.size;
  }

  // Start of document
  if (destination === "start_of_document") {
    return 0;
  }

  // After a paragraph by index
  if (typeof destination === "object" && "after_paragraph" in destination) {
    let paragraphIndex = 0;
    let targetPos: number | null = null;

    doc.descendants((node, pos) => {
      if (node.type.name === "paragraph") {
        if (paragraphIndex === destination.after_paragraph) {
          targetPos = pos + node.nodeSize;
          return false; // Stop traversal
        }
        paragraphIndex++;
      }
      return true;
    });

    if (targetPos !== null) {
      return targetPos;
    }
    return { error: `Paragraph at index ${destination.after_paragraph} not found` };
  }

  // After a paragraph containing text
  if (typeof destination === "object" && "after_paragraph_containing" in destination) {
    const searchText = destination.after_paragraph_containing.toLowerCase();
    let targetPos: number | null = null;

    doc.descendants((node, pos) => {
      if (node.type.name === "paragraph") {
        const text = extractText(node).toLowerCase();
        if (text.includes(searchText)) {
          targetPos = pos + node.nodeSize;
          return false; // Stop traversal
        }
      }
      return true;
    });

    if (targetPos !== null) {
      return targetPos;
    }
    return { error: `No paragraph found containing "${destination.after_paragraph_containing}"` };
  }

  // After a section heading
  if (typeof destination === "object" && "after_section" in destination) {
    const searchHeading = destination.after_section.toLowerCase();
    let inTargetSection = false;
    let targetLevel = 0;
    let insertPos: number | null = null;
    let sectionEnded = false;

    // Iterate over top-level children only to avoid nested node issues.
    // doc.forEach can't break, so we use a flag to stop processing.
    doc.forEach((node, offset) => {
      if (sectionEnded) return;

      if (node.type.name === "heading") {
        const headingText = extractText(node).toLowerCase();
        const headingLevel = node.attrs.level as number;

        if (inTargetSection) {
          // Found next heading at same or higher level — section boundary
          if (headingLevel <= targetLevel) {
            sectionEnded = true;
            return;
          }
        } else if (headingText.includes(searchHeading)) {
          // Found the target heading
          inTargetSection = true;
          targetLevel = headingLevel;
        }
      }

      if (inTargetSection) {
        // Track position at end of this top-level block
        insertPos = offset + node.nodeSize;
      }
    });

    if (insertPos !== null) {
      return insertPos;
    }
    return { error: `Section with heading "${destination.after_section}" not found` };
  }

  return { error: "Invalid destination" };
}

/**
 * Handle smartInsert request.
 */
export async function handleSmartInsert(
  id: string,
  args: Record<string, unknown>
): Promise<void> {
  try {
    const baseRevision = args.baseRevision as string;
    const destination = args.destination as SmartInsertDestination;
    const content = args.content as string;
    const mode = (args.mode as OperationMode) ?? "suggest";

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

    if (!content) {
      throw new Error("content is required");
    }

    if (!destination) {
      throw new Error("destination is required");
    }

    // Find the insertion position
    const insertPosResult = findInsertPosition(editor.state.doc, destination);
    if (typeof insertPosResult === "object" && "error" in insertPosResult) {
      await respond({
        id,
        success: false,
        error: insertPosResult.error,
        data: { code: "not_found" },
      });
      return;
    }

    const insertPos = insertPosResult;

    // Create content with proper paragraph wrapping
    const contentToInsert = `\n\n${content}\n\n`;

    // For suggest mode or non-auto-approve, create suggestion
    if (mode === "suggest" || !isAutoApproveEnabled()) {
      const suggestionId = useAiSuggestionStore.getState().addSuggestion({
        tabId: getActiveTabId(),
        type: "insert",
        from: insertPos,
        to: insertPos,
        newContent: contentToInsert,
        originalContent: undefined,
      });

      const result: SmartInsertResult = {
        success: true,
        message: "Insert suggestion created",
        suggestionId,
        applied: false,
        insertPosition: insertPos,
      };

      await respond({
        id,
        success: true,
        data: result,
      });
      return;
    }

    // Apply the insert directly — parse markdown to preserve special characters
    const slice = createMarkdownPasteSlice(editor.state, contentToInsert);
    const tr = editor.state.tr.replaceRange(insertPos, insertPos, slice);
    editor.view.dispatch(tr);

    const newRevision = getCurrentRevision();

    const result: SmartInsertResult = {
      success: true,
      message: "Content inserted successfully",
      applied: true,
      newRevision,
      insertPosition: insertPos,
    };

    await respond({
      id,
      success: true,
      data: result,
    });
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
