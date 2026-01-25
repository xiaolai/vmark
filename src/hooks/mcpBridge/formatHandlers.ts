/**
 * MCP Bridge - Format Operation Handlers
 */

import { respond, getEditor } from "./utils";

/**
 * Handle format.toggle request.
 */
export async function handleFormatToggle(
  id: string,
  args: Record<string, unknown>
): Promise<void> {
  try {
    const editor = getEditor();
    if (!editor) throw new Error("No active editor");

    const format = (args.format ?? args.mark) as string;

    // Direct commands for MCP (programmatic, no focus side effects needed).
    // For marks without dedicated toggle commands, use the generic toggleMark.
    switch (format) {
      case "bold":
        editor.commands.toggleBold();
        break;
      case "italic":
        editor.commands.toggleItalic();
        break;
      case "code":
        editor.commands.toggleCode();
        break;
      case "strike":
        editor.commands.toggleStrike();
        break;
      case "underline":
        editor.commands.toggleMark("underline");
        break;
      case "highlight":
        editor.commands.toggleMark("highlight");
        break;
      default:
        throw new Error(`Unknown format: ${format}`);
    }

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
 * Handle format.setLink request.
 */
export async function handleFormatSetLink(
  id: string,
  args: Record<string, unknown>
): Promise<void> {
  try {
    const editor = getEditor();
    if (!editor) throw new Error("No active editor");

    const href = args.href as string;

    if (typeof href !== "string") {
      throw new Error("href must be a string");
    }

    editor.commands.setLink({ href });

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
 * Handle format.removeLink request.
 */
export async function handleFormatRemoveLink(id: string): Promise<void> {
  try {
    const editor = getEditor();
    if (!editor) throw new Error("No active editor");

    editor.commands.unsetLink();

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
 * Handle format.clear request.
 */
export async function handleFormatClear(id: string): Promise<void> {
  try {
    const editor = getEditor();
    if (!editor) throw new Error("No active editor");

    editor.commands.unsetAllMarks();

    await respond({ id, success: true, data: null });
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
