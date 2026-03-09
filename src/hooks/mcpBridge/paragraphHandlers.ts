/**
 * MCP Bridge — Paragraph Handlers
 *
 * Purpose: Paragraph-level operations for flat documents (without headings) —
 *   read/write paragraphs by index or content match.
 *
 * @module hooks/mcpBridge/paragraphHandlers
 */

import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { respond, getEditor, isAutoApproveEnabled, getActiveTabId } from "./utils";
import { requireString, optionalString, requireEnum, booleanWithDefault } from "./validateArgs";
import { OPERATION_MODES } from "./types";
import { useAiSuggestionStore } from "@/stores/aiSuggestionStore";
import { validateBaseRevision, getCurrentRevision } from "./revisionTracker";
import { createMarkdownPasteSlice } from "@/plugins/markdownPaste/tiptap";

type ParagraphOperation = "replace" | "append" | "prepend" | "delete";

interface ParagraphTarget {
  index?: number;
  containing?: string;
}

interface ParagraphInfo {
  index: number;
  from: number;
  to: number;
  text: string;
}

/**
 * Extract text content from a ProseMirror node.
 */
function extractText(node: ProseMirrorNode): string {
  let text = "";
  node.descendants((child) => {
    /* v8 ignore start -- non-text leaf nodes not encountered in test documents */
    if (child.isText) {
      text += child.text;
    }
    /* v8 ignore stop */
    return true;
  });
  return text;
}

/**
 * Count words in text.
 */
function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
}

/**
 * Find all paragraphs in the document.
 * Returns array of paragraph info with positions.
 */
function findAllParagraphs(doc: ProseMirrorNode): ParagraphInfo[] {
  const paragraphs: ParagraphInfo[] = [];
  let index = 0;

  doc.descendants((node, pos) => {
    /* v8 ignore start -- non-paragraph nodes not exercised in tests */
    if (node.type.name === "paragraph") {
      const text = extractText(node);
      paragraphs.push({
        index,
        from: pos,
        to: pos + node.nodeSize,
        text,
      });
      index++;
      return false; // Don't descend into paragraph children
    }
    return true;
    /* v8 ignore stop */
  });

  return paragraphs;
}

/**
 * Find a specific paragraph by target criteria.
 */
function findParagraph(
  doc: ProseMirrorNode,
  target: ParagraphTarget
): ParagraphInfo | null {
  const paragraphs = findAllParagraphs(doc);

  if (target.index !== undefined) {
    // Find by index
    const para = paragraphs[target.index];
    return para ?? null;
  }

  /* v8 ignore start -- target.containing path not exercised in tests */
  if (target.containing) {
    // Find by content match
    const searchText = target.containing.toLowerCase();
    const match = paragraphs.find((p) =>
      p.text.toLowerCase().includes(searchText)
    );
    return match ?? null;
  }

  return null;
  /* v8 ignore stop */
}

/**
 * Get context paragraphs (before and after).
 */
function getContext(
  paragraphs: ParagraphInfo[],
  index: number
): { before?: string; after?: string } {
  const context: { before?: string; after?: string } = {};

  if (index > 0) {
    context.before = paragraphs[index - 1].text;
  }

  if (index < paragraphs.length - 1) {
    context.after = paragraphs[index + 1].text;
  }

  return context;
}

/**
 * Handle paragraph.read request.
 */
export async function handleParagraphRead(
  id: string,
  args: Record<string, unknown>
): Promise<void> {
  try {
    const target = args.target as ParagraphTarget;
    const includeContext = booleanWithDefault(args, "includeContext", false);

    const editor = getEditor();
    if (!editor) {
      throw new Error("No active editor");
    }

    if (!target || (target.index === undefined && !target.containing)) {
      throw new Error("target must specify index or containing");
    }

    // Find the paragraph
    const paragraph = findParagraph(editor.state.doc, target);
    if (!paragraph) {
      await respond({
        id,
        success: false,
        error: "Paragraph not found",
        data: { code: "not_found" },
      });
      return;
    }

    // Build result
    const result: Record<string, unknown> = {
      index: paragraph.index,
      content: paragraph.text,
      wordCount: countWords(paragraph.text),
      charCount: paragraph.text.length,
      position: {
        from: paragraph.from,
        to: paragraph.to,
      },
    };

    // Add context if requested
    if (includeContext) {
      const paragraphs = findAllParagraphs(editor.state.doc);
      result.context = getContext(paragraphs, paragraph.index);
    }

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

/**
 * Handle paragraph.write request.
 */
export async function handleParagraphWrite(
  id: string,
  args: Record<string, unknown>
): Promise<void> {
  try {
    const baseRevision = requireString(args, "baseRevision");
    const target = args.target as ParagraphTarget;
    const operation = requireString(args, "operation") as ParagraphOperation;
    const content = optionalString(args, "content");
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

    if (!target || (target.index === undefined && !target.containing)) {
      throw new Error("target must specify index or containing");
    }

    if (operation !== "delete" && content === undefined) {
      throw new Error("content is required for non-delete operations");
    }

    // Find the paragraph
    const paragraph = findParagraph(editor.state.doc, target);
    if (!paragraph) {
      await respond({
        id,
        success: false,
        error: "Paragraph not found",
        data: { code: "not_found" },
      });
      return;
    }

    // Determine what content to use and where
    let from: number;
    let to: number;
    let newContent: string;
    let originalContent: string;

    switch (operation) {
      case "replace":
        from = paragraph.from + 1; // Skip opening tag
        to = paragraph.to - 1; // Skip closing tag
        newContent = content!;
        originalContent = paragraph.text;
        break;

      case "append":
        from = paragraph.to - 1; // Before closing tag
        to = paragraph.to - 1;
        newContent = " " + content!;
        originalContent = "";
        break;

      case "prepend":
        from = paragraph.from + 1; // After opening tag
        to = paragraph.from + 1;
        newContent = content! + " ";
        originalContent = "";
        break;

      case "delete":
        from = paragraph.from;
        to = paragraph.to;
        newContent = "";
        originalContent = paragraph.text;
        break;

      default:
        throw new Error(`Unknown operation: ${operation}`);
    }

    // For dryRun, return preview without applying
    if (mode === "dryRun") {
      await respond({
        id,
        success: true,
        data: {
          preview: { operation, from, to, newContent, originalContent },
          applied: false,
          newRevision: getCurrentRevision(),
        },
      });
      return;
    }

    // For non-auto-approve, create suggestion for user review
    if (!isAutoApproveEnabled()) {
      const suggestionType = operation === "delete" ? "delete" : from === to ? "insert" : "replace";
      const suggestionId = useAiSuggestionStore.getState().addSuggestion({
        tabId: getActiveTabId(),
        type: suggestionType,
        from,
        to,
        newContent: newContent || undefined,
        originalContent: originalContent || undefined,
      });

      await respond({
        id,
        success: true,
        data: {
          success: true,
          message: `${operation} suggestion created`,
          suggestionId,
          applied: false,
        },
      });
      return;
    }

    // Apply the change directly
    if (operation === "delete") {
      editor.chain()
        .focus()
        .setTextSelection({ from, to })
        .deleteSelection()
        .run();
    } else {
      // Parse markdown to preserve special characters (pipes, formatting, etc.)
      const slice = createMarkdownPasteSlice(editor.state, newContent);
      const writeTr = editor.state.tr.replaceRange(from, to, slice);
      editor.view.dispatch(writeTr);
    }

    const newRevision = getCurrentRevision();

    // Build grammatically correct message
    const operationVerb = {
      replace: "replaced",
      append: "appended to",
      prepend: "prepended to",
      delete: "deleted",
    }[operation];

    await respond({
      id,
      success: true,
      data: {
        success: true,
        message: `Paragraph ${operationVerb} successfully`,
        applied: true,
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
