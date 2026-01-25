/**
 * MCP Bridge - Editor Operation Handlers
 */

import { undoDepth, redoDepth } from "@tiptap/pm/history";
import { respond, getEditor } from "./utils";

/**
 * Handle editor.undo request.
 */
export async function handleUndo(id: string): Promise<void> {
  try {
    const editor = getEditor();
    if (!editor) throw new Error("No active editor");

    editor.commands.undo();

    await respond({ id, success: true, data: null });
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Handle editor.redo request.
 */
export async function handleRedo(id: string): Promise<void> {
  try {
    const editor = getEditor();
    if (!editor) throw new Error("No active editor");

    editor.commands.redo();

    await respond({ id, success: true, data: null });
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Handle editor.focus request.
 */
export async function handleFocus(id: string): Promise<void> {
  try {
    const editor = getEditor();
    if (!editor) throw new Error("No active editor");

    editor.commands.focus();

    await respond({ id, success: true, data: null });
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Handle editor.getUndoState request.
 * Returns current undo/redo state for MCP clients.
 */
export async function handleGetUndoState(id: string): Promise<void> {
  try {
    const editor = getEditor();
    if (!editor) throw new Error("No active editor");

    const state = editor.state;

    await respond({
      id,
      success: true,
      data: {
        canUndo: editor.can().undo(),
        canRedo: editor.can().redo(),
        undoDepth: undoDepth(state),
        redoDepth: redoDepth(state),
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
