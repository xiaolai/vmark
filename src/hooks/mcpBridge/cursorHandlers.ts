/**
 * MCP Bridge - Cursor Operation Handlers
 */

import type { ResolvedPos } from "@tiptap/pm/model";
import { respond, getEditor } from "./utils";

/**
 * Block context information for cursor position.
 */
interface BlockInfo {
  /** Block type name (paragraph, heading, codeBlock, etc.) */
  type: string;
  /** Heading level (1-6), only for headings */
  level?: number;
  /** Code language, only for code blocks */
  language?: string;
  /** List type if inside a list (bullet, ordered, task) */
  inList?: "bullet" | "ordered" | "task";
  /** True if inside a blockquote */
  inBlockquote?: boolean;
  /** True if inside a table */
  inTable?: boolean;
  /** Document position where the block starts */
  position: number;
}

/**
 * Extract block context from a resolved position.
 * Walks up the node tree to find block type and ancestor containers.
 */
function getBlockInfo($pos: ResolvedPos): BlockInfo {
  const parent = $pos.parent;
  const blockInfo: BlockInfo = {
    type: parent.type.name,
    position: $pos.before($pos.depth),
  };

  // Add type-specific attributes
  if (parent.type.name === "heading") {
    blockInfo.level = parent.attrs.level as number;
  } else if (parent.type.name === "codeBlock") {
    const lang = parent.attrs.language as string | undefined;
    if (lang) blockInfo.language = lang;
  }

  // Walk up ancestors to find containers (list, blockquote, table)
  for (let d = $pos.depth - 1; d >= 0; d--) {
    const ancestor = $pos.node(d);
    const name = ancestor.type.name;

    if (name === "bulletList" && !blockInfo.inList) {
      blockInfo.inList = "bullet";
    } else if (name === "orderedList" && !blockInfo.inList) {
      blockInfo.inList = "ordered";
    } else if (name === "taskList" && !blockInfo.inList) {
      blockInfo.inList = "task";
    } else if (name === "blockquote") {
      blockInfo.inBlockquote = true;
    } else if (name === "table") {
      blockInfo.inTable = true;
    }
  }

  return blockInfo;
}

/**
 * Handle cursor.getContext request.
 *
 * Uses ProseMirror's $pos API for block-aware traversal instead of flattening
 * the document with textContent (which loses block boundaries).
 */
export async function handleCursorGetContext(
  id: string,
  args: Record<string, unknown>
): Promise<void> {
  try {
    const editor = getEditor();
    if (!editor) throw new Error("No active editor");

    const { from } = editor.state.selection;
    const doc = editor.state.doc;

    // Use $pos API for proper block-aware navigation
    const $pos = doc.resolve(from);
    const blockNode = $pos.parent;
    const currentLine = blockNode.textContent;

    // Get context blocks
    const linesBefore = (args.linesBefore as number) ?? 5;
    const linesAfter = (args.linesAfter as number) ?? 5;

    // Collect blocks before and after the current block
    const beforeBlocks: string[] = [];
    const afterBlocks: string[] = [];

    // Find the current block's position in the document.
    // Use depth 1 to get top-level block context (paragraph, heading, list, etc.)
    // rather than inline nodes. This provides consistent "line" semantics for MCP
    // clients regardless of cursor position within nested inline content.
    const blockDepth = $pos.depth > 0 ? 1 : 0;
    const blockIndex = $pos.index(blockDepth);
    const parentNode = blockDepth > 0 ? $pos.node(blockDepth - 1) : doc;

    // Collect blocks before
    for (let i = Math.max(0, blockIndex - linesBefore); i < blockIndex; i++) {
      const node = parentNode.child(i);
      beforeBlocks.push(node.textContent);
    }

    // Collect blocks after
    for (let i = blockIndex + 1; i < Math.min(parentNode.childCount, blockIndex + 1 + linesAfter); i++) {
      const node = parentNode.child(i);
      afterBlocks.push(node.textContent);
    }

    // Extract block context info
    const block = getBlockInfo($pos);

    await respond({
      id,
      success: true,
      data: {
        before: beforeBlocks.join("\n"),
        after: afterBlocks.join("\n"),
        currentLine,
        currentParagraph: currentLine,
        block,
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
 * Handle cursor.setPosition request.
 */
export async function handleCursorSetPosition(
  id: string,
  args: Record<string, unknown>
): Promise<void> {
  try {
    const editor = getEditor();
    if (!editor) throw new Error("No active editor");

    const position = args.position as number;
    editor.commands.setTextSelection(position);

    await respond({ id, success: true, data: null });
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
