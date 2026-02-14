/**
 * MCP Bridge — Block and List Operation Handlers
 *
 * Purpose: Block-level and list operations — set block type (heading, code block,
 *   blockquote), toggle lists (ordered, unordered, task), and indent/outdent.
 *
 * @module hooks/mcpBridge/blockListHandlers
 */

import { convertSelectionToTaskList } from "@/plugins/taskToggle/tiptapTaskListUtils";
import { respond, getEditor } from "./utils";

/**
 * Handle block.setType request.
 * Converts the current block to the specified type.
 */
export async function handleBlockSetType(
  id: string,
  args: Record<string, unknown>
): Promise<void> {
  try {
    const editor = getEditor();
    if (!editor) throw new Error("No active editor");

    const blockType = args.blockType as string;
    const level = args.level as number | undefined;
    const language = args.language as string | undefined;

    switch (blockType) {
      case "paragraph":
        editor.commands.setParagraph();
        break;
      case "heading":
        if (level === undefined || level < 1 || level > 6) {
          throw new Error("level must be between 1 and 6 for heading");
        }
        editor.commands.setHeading({ level: level as 1 | 2 | 3 | 4 | 5 | 6 });
        break;
      case "codeBlock":
        editor.commands.setCodeBlock(language ? { language } : undefined);
        break;
      case "blockquote":
        editor.commands.setBlockquote();
        break;
      default:
        throw new Error(`Unknown block type: ${blockType}`);
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
 * Handle list.toggle request.
 * Toggles between bullet, ordered, or task list.
 */
export async function handleListToggle(
  id: string,
  args: Record<string, unknown>
): Promise<void> {
  try {
    const editor = getEditor();
    if (!editor) throw new Error("No active editor");

    const listType = args.listType as string;

    switch (listType) {
      case "bullet":
        editor.commands.toggleBulletList();
        break;
      case "ordered":
        editor.commands.toggleOrderedList();
        break;
      case "task":
        convertSelectionToTaskList(editor);
        break;
      default:
        throw new Error(`Unknown list type: ${listType}`);
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
 * Handle block.insertHorizontalRule request.
 */
export async function handleInsertHorizontalRule(id: string): Promise<void> {
  try {
    const editor = getEditor();
    if (!editor) throw new Error("No active editor");

    editor.commands.setHorizontalRule();

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
 * Handle list.increaseIndent request.
 */
export async function handleListIncreaseIndent(id: string): Promise<void> {
  try {
    const editor = getEditor();
    if (!editor) throw new Error("No active editor");

    editor.commands.sinkListItem("listItem");

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
 * Handle list.decreaseIndent request.
 */
export async function handleListDecreaseIndent(id: string): Promise<void> {
  try {
    const editor = getEditor();
    if (!editor) throw new Error("No active editor");

    editor.commands.liftListItem("listItem");

    await respond({ id, success: true, data: null });
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
