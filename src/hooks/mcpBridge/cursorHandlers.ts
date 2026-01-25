/**
 * MCP Bridge - Cursor Operation Handlers
 */

import { respond, getEditor } from "./utils";

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

    await respond({
      id,
      success: true,
      data: {
        before: beforeBlocks.join("\n"),
        after: afterBlocks.join("\n"),
        currentLine,
        currentParagraph: currentLine,
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
