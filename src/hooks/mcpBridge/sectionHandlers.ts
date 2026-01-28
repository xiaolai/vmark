/**
 * Section Handlers - Higher-level section operations.
 *
 * Part of AI-Oriented MCP Design implementation.
 */

import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { respond, getEditor } from "./utils";
import { useAiSuggestionStore } from "@/stores/aiSuggestionStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { validateBaseRevision, getCurrentRevision } from "./revisionTracker";

// Types
type OperationMode = "apply" | "suggest" | "dryRun";

interface SectionTarget {
  heading?: string;
  byIndex?: { level: number; index: number };
  sectionId?: string;
}

interface NewHeading {
  level: number;
  text: string;
}

/**
 * Check if auto-approve edits is enabled.
 */
function isAutoApproveEnabled(): boolean {
  return useSettingsStore.getState().advanced.mcpServer.autoApproveEdits;
}

/**
 * Extract text from a ProseMirror node.
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
 * Find a section in the document by target specification.
 * Returns { from, to, level } of the section, or null if not found.
 */
function findSection(
  doc: ProseMirrorNode,
  target: SectionTarget
): { from: number; to: number; level: number; headingText: string } | null {
  let headingPos: number | null = null;
  let headingLevel: number | null = null;
  let headingText: string | null = null;
  let headingIndex = 0;

  // Find the target heading
  doc.descendants((node, pos) => {
    if (node.type.name === "heading") {
      const level = node.attrs.level as number;
      const text = extractText(node);

      let isMatch = false;

      if (target.heading) {
        isMatch = text.toLowerCase() === target.heading.toLowerCase();
      } else if (target.byIndex) {
        if (level === target.byIndex.level) {
          if (headingIndex === target.byIndex.index) {
            isMatch = true;
          }
          headingIndex++;
        }
      } else if (target.sectionId) {
        // Section IDs are generated at runtime, so we can't match them here
        // This would require tracking IDs during traversal
        // For now, fall back to index-based matching
      }

      if (isMatch && headingPos === null) {
        headingPos = pos;
        headingLevel = level;
        headingText = text;
        return false; // Stop searching
      }
    }
    return true;
  });

  if (headingPos === null || headingLevel === null) {
    return null;
  }

  // Find the end of the section (next heading of same or higher level)
  let sectionEnd = doc.content.size;

  doc.descendants((node, pos) => {
    if (pos <= headingPos!) return true;

    if (node.type.name === "heading") {
      const level = node.attrs.level as number;
      if (level <= headingLevel!) {
        sectionEnd = pos;
        return false;
      }
    }
    return true;
  });

  return {
    from: headingPos,
    to: sectionEnd,
    level: headingLevel,
    headingText: headingText!,
  };
}

/**
 * Handle section.update request.
 */
export async function handleSectionUpdate(
  id: string,
  args: Record<string, unknown>
): Promise<void> {
  try {
    const baseRevision = args.baseRevision as string;
    const target = args.target as SectionTarget;
    const newContent = args.newContent as string;
    const mode = (args.mode as OperationMode) ?? "apply";

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

    // For suggest mode or non-auto-approve, create suggestion
    if (mode === "suggest" || !isAutoApproveEnabled()) {
      const originalContent = editor.state.doc.textBetween(contentStart, section.to);
      const suggestionId = useAiSuggestionStore.getState().addSuggestion({
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

    // Apply the update
    editor.chain()
      .focus()
      .setTextSelection({ from: contentStart, to: section.to })
      .insertContent(newContent)
      .run();

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

/**
 * Handle section.insert request.
 */
export async function handleSectionInsert(
  id: string,
  args: Record<string, unknown>
): Promise<void> {
  try {
    const baseRevision = args.baseRevision as string;
    const after = args.after as SectionTarget | undefined;
    const heading = args.heading as NewHeading;
    const content = (args.content as string) ?? "";
    const mode = (args.mode as OperationMode) ?? "apply";

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

    // Build the content to insert
    const headingMarkdown = "#".repeat(heading.level) + " " + heading.text;
    const fullContent = "\n\n" + headingMarkdown + (content ? "\n\n" + content : "") + "\n";

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

    // For suggest mode or non-auto-approve, create suggestion
    if (mode === "suggest" || !isAutoApproveEnabled()) {
      const suggestionId = useAiSuggestionStore.getState().addSuggestion({
        type: "insert",
        from: insertPos,
        to: insertPos,
        newContent: fullContent,
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

    // Apply the insert
    editor.chain()
      .focus()
      .setTextSelection(insertPos)
      .insertContent(fullContent)
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

/**
 * Handle section.move request.
 */
export async function handleSectionMove(
  id: string,
  args: Record<string, unknown>
): Promise<void> {
  try {
    const baseRevision = args.baseRevision as string;
    const section = args.section as SectionTarget;
    const after = args.after as SectionTarget | undefined;
    const mode = (args.mode as OperationMode) ?? "apply";

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
      targetPos = afterSection.to;
    } else {
      // Move to start of document (after any leading content)
      targetPos = 0;
    }

    // Get section content
    const sectionContent = editor.state.doc.textBetween(sectionRange.from, sectionRange.to);

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

    // For suggest mode, we can't easily represent a move as a suggestion
    // So we fall back to showing what would happen
    if (mode === "suggest" || !isAutoApproveEnabled()) {
      // Create delete + insert suggestions
      const deleteId = useAiSuggestionStore.getState().addSuggestion({
        type: "delete",
        from: sectionRange.from,
        to: sectionRange.to,
        originalContent: sectionContent,
      });

      // Note: This is a simplification - proper move would need atomic handling
      const insertId = useAiSuggestionStore.getState().addSuggestion({
        type: "insert",
        from: targetPos,
        to: targetPos,
        newContent: sectionContent,
      });

      await respond({
        id,
        success: true,
        data: {
          success: true,
          suggestionIds: [deleteId, insertId],
          warning: "Move represented as delete+insert suggestions",
        },
      });
      return;
    }

    // Apply the move (delete then insert)
    // We need to be careful about position adjustments
    if (targetPos > sectionRange.to) {
      // Moving forward - insert first (positions will shift)
      const adjustedTarget = targetPos;
      editor.chain()
        .focus()
        .setTextSelection(adjustedTarget)
        .insertContent(sectionContent)
        .setTextSelection({ from: sectionRange.from, to: sectionRange.to })
        .deleteSelection()
        .run();
    } else {
      // Moving backward - delete first
      editor.chain()
        .focus()
        .setTextSelection({ from: sectionRange.from, to: sectionRange.to })
        .deleteSelection()
        .setTextSelection(targetPos)
        .insertContent(sectionContent)
        .run();
    }

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
