/**
 * MCP Bridge — Media Insert Handlers
 *
 * Purpose: Handles insert_video, insert_audio, and insert_youtube MCP tool
 *   requests by inserting HTML tags at the cursor position. The markdown
 *   pipeline promotes these tags to block_video, block_audio, or youtube_embed nodes.
 *
 * @coordinates-with vmark-mcp-server/src/tools/media.ts — MCP tool definitions
 * @module hooks/mcpBridge/mediaHandlers
 */

import { respond, getEditor } from "./utils";
import { validateBaseRevision, getCurrentRevision } from "./revisionTracker";

/**
 * Handle insertMedia request — inserts media HTML at cursor or end of document.
 */
export async function handleInsertMedia(
  id: string,
  args: Record<string, unknown>
): Promise<void> {
  try {
    const baseRevision = args.baseRevision as string;
    const mediaHtml = args.mediaHtml as string;

    if (!mediaHtml) {
      throw new Error("mediaHtml is required");
    }

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

    // Insert the HTML content at the current cursor position
    const content = `\n\n${mediaHtml}\n\n`;
    editor.chain().focus().insertContent(content).run();

    const newRevision = getCurrentRevision();

    await respond({
      id,
      success: true,
      data: {
        inserted: true,
        mediaHtml,
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
