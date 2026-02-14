/**
 * MCP Bridge — Selection Operation Handlers
 *
 * Purpose: Selection operations — get current selection text and range,
 *   set selection to a specific from/to range, and replace selection content.
 *
 * @module hooks/mcpBridge/selectionHandlers
 */

import { respond, getEditor } from "./utils";

/**
 * Handle selection.get request.
 */
export async function handleSelectionGet(id: string): Promise<void> {
  try {
    const editor = getEditor();
    if (!editor) throw new Error("No active editor");

    const { from, to } = editor.state.selection;
    const text = editor.state.doc.textBetween(from, to, "\n");

    await respond({
      id,
      success: true,
      data: {
        text,
        range: { from, to },
        isEmpty: from === to,
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
 * Handle selection.set request.
 */
export async function handleSelectionSet(
  id: string,
  args: Record<string, unknown>
): Promise<void> {
  try {
    const editor = getEditor();
    if (!editor) throw new Error("No active editor");

    const from = args.from as number;
    const to = args.to as number;

    editor.commands.setTextSelection({ from, to });

    await respond({ id, success: true, data: null });
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

