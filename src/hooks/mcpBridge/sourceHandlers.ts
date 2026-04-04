/**
 * MCP Bridge — Source Mode Handlers
 *
 * Purpose: Handles MCP operations that can work in Source mode by reading
 * from the document store and CodeMirror state instead of Tiptap DOM.
 * Uses getCurrentWindowLabel() for per-window scoped tab lookups.
 * These produce the same response shapes as the WYSIWYG handlers.
 *
 * @coordinates-with sourceModeGuard.ts — routes source-capable ops here
 * @coordinates-with documentHandlers.ts — WYSIWYG equivalents
 * @module hooks/mcpBridge/sourceHandlers
 */

import { respond } from "./utils";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useActiveEditorStore } from "@/stores/activeEditorStore";
import { getCurrentWindowLabel } from "@/utils/workspaceStorage";
/**
 * Extract headings from raw markdown text.
 */
function extractHeadingsFromMarkdown(content: string): Array<{ level: number; text: string; position: number }> {
  const headings: Array<{ level: number; text: string; position: number }> = [];
  const lines = content.split("\n");
  let offset = 0;
  for (const line of lines) {
    const match = line.match(/^(#{1,6})\s+(.+)/);
    if (match) {
      headings.push({
        level: match[1].length,
        text: match[2].replace(/\s*#+\s*$/, ""), // strip trailing hashes
        position: offset,
      });
    }
    offset += line.length + 1; // +1 for newline
  }
  return headings;
}

/**
 * Handle document.getContent in Source mode.
 * Returns raw markdown from the document store.
 */
export async function handleSourceDocumentGetContent(id: string, args: Record<string, unknown>): Promise<void> {
  try {
    const windowLabel = getCurrentWindowLabel();
    const tabStore = useTabStore.getState();
    const docStore = useDocumentStore.getState();
    const activeTabId = tabStore.activeTabId[windowLabel];

    if (!activeTabId) throw new Error("No active document");

    const doc = docStore.getDocument(activeTabId);
    if (!doc) throw new Error("Document not found");

    const format = (args.format as string) ?? "markdown";
    if (format !== "markdown") {
      throw new Error("Source mode only supports markdown format");
    }

    await respond({ id, success: true, data: { content: doc.content, format: "markdown" } });
  } catch (error) {
    await respond({ id, success: false, error: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * Handle outline.get in Source mode.
 * Extracts headings from the raw markdown.
 */
export async function handleSourceOutlineGet(id: string): Promise<void> {
  try {
    const windowLabel = getCurrentWindowLabel();
    const tabStore = useTabStore.getState();
    const docStore = useDocumentStore.getState();
    const activeTabId = tabStore.activeTabId[windowLabel];

    if (!activeTabId) throw new Error("No active document");

    const doc = docStore.getDocument(activeTabId);
    if (!doc) throw new Error("Document not found");

    const headings = extractHeadingsFromMarkdown(doc.content);

    await respond({ id, success: true, data: headings });
  } catch (error) {
    await respond({ id, success: false, error: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * Handle metadata.get in Source mode.
 * Returns the same shape as the WYSIWYG handler using document store data.
 */
export async function handleSourceMetadataGet(id: string): Promise<void> {
  try {
    const windowLabel = getCurrentWindowLabel();
    const tabStore = useTabStore.getState();
    const docStore = useDocumentStore.getState();
    const activeTabId = tabStore.activeTabId[windowLabel];

    if (!activeTabId) throw new Error("No active document");

    const doc = docStore.getDocument(activeTabId);
    const tab = tabStore.tabs[windowLabel]?.find((t) => t.id === activeTabId);

    const content = doc?.content ?? "";
    const charCount = content.length;
    const text = content.replace(/^---[\s\S]*?---\n?/, ""); // strip frontmatter for word count
    const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;

    // Extract title from first H1
    let title = tab?.title ?? "Untitled";
    const h1Match = content.match(/^#\s+(.+)$/m);
    if (h1Match) title = h1Match[1];

    await respond({
      id,
      success: true,
      data: {
        filePath: doc?.filePath ?? null,
        title,
        wordCount,
        characterCount: charCount,
        isModified: doc?.isDirty ?? false,
      },
    });
  } catch (error) {
    await respond({ id, success: false, error: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * Handle editor.focus in Source mode.
 * Focuses the CodeMirror view.
 */
export async function handleSourceEditorFocus(id: string): Promise<void> {
  try {
    const sourceView = useActiveEditorStore.getState().activeSourceView;
    if (!sourceView) throw new Error("No active source editor");
    sourceView.focus();
    await respond({ id, success: true, data: null });
  } catch (error) {
    await respond({ id, success: false, error: error instanceof Error ? error.message : String(error) });
  }
}
