/**
 * MCP Bridge — Media Insert Handlers
 *
 * Purpose: Handles insert_video, insert_audio, and insert_video_embed MCP tool
 *   requests by inserting HTML tags at the cursor position. The markdown
 *   pipeline promotes these tags to block_video, block_audio, or video_embed nodes.
 *
 * @coordinates-with vmark-mcp-server/src/tools/media.ts — MCP tool definitions
 * @module hooks/mcpBridge/mediaHandlers
 */

import { respond, getEditor } from "./utils";
import { validateBaseRevision, getCurrentRevision } from "./revisionTracker";
import { sanitizeMediaHtml } from "@/utils/sanitize";

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

    if (!mediaHtml || typeof mediaHtml !== "string") {
      throw new Error("mediaHtml is required and must be a string");
    }

    // Only allow a single expected media tag — reject arbitrary or appended HTML.
    // Patterns match: opening tag … closing tag, with nothing after the close.
    const SINGLE_VIDEO = /^<video[\s>][\s\S]*<\/video>\s*$/i;
    const SINGLE_AUDIO = /^<audio[\s>][\s\S]*<\/audio>\s*$/i;
    const SINGLE_IFRAME = /^<iframe[\s>][\s\S]*<\/iframe>\s*$/i;
    // Also allow self-closing iframe (e.g. <iframe ... />)
    const SELF_CLOSING_IFRAME = /^<iframe\s[^>]*\/>\s*$/i;

    const trimmed = mediaHtml.trim();
    const isValid =
      SINGLE_VIDEO.test(trimmed) ||
      SINGLE_AUDIO.test(trimmed) ||
      SINGLE_IFRAME.test(trimmed) ||
      SELF_CLOSING_IFRAME.test(trimmed);
    if (!isValid) {
      throw new Error("mediaHtml must be a single <video>, <audio>, or <iframe> tag");
    }

    // Sanitize media HTML to enforce safe attributes and whitelisted-provider iframes
    const sanitized = sanitizeMediaHtml(trimmed);
    if (!sanitized.trim()) {
      throw new Error("mediaHtml was rejected by sanitization (e.g. non-whitelisted iframe)");
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

    // Insert the sanitized HTML content at the current cursor position
    const content = `\n\n${sanitized}\n\n`;
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
