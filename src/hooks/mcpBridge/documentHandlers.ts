/**
 * MCP Bridge — Document Handlers (Read-Only)
 *
 * Purpose: Read-only document operations — get content, search text,
 *   get outline (headings), and get document metadata. Uses
 *   getCurrentWindowLabel() for per-window scoped tab lookups.
 *   Write operations are in suggestionHandlers.ts for user approval.
 *
 * @coordinates-with suggestionHandlers.ts — handles write operations
 * @module hooks/mcpBridge/documentHandlers
 */

import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { respond, getEditor, getDocumentContent } from "./utils";
import { getCurrentWindowLabel } from "@/utils/workspaceStorage";
import { requireString, booleanWithDefault } from "./validateArgs";

/**
 * Handle document.getContent request.
 */
export async function handleGetContent(id: string): Promise<void> {
  try {
    const content = getDocumentContent();
    await respond({ id, success: true, data: content });
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Handle document.search request.
 */
export async function handleDocumentSearch(
  id: string,
  args: Record<string, unknown>
): Promise<void> {
  try {
    const editor = getEditor();
    if (!editor) throw new Error("No active editor");

    const query = requireString(args, "query");
    const caseSensitive = booleanWithDefault(args, "caseSensitive", false);
    const text = editor.state.doc.textContent;
    const searchText = caseSensitive ? query : query.toLowerCase();
    const docText = caseSensitive ? text : text.toLowerCase();

    const matches: Array<{ position: number; line: number; text: string }> = [];
    let pos = 0;
    let lineNum = 1;
    let lineStart = 0;

    while (pos < docText.length) {
      const idx = docText.indexOf(searchText, pos);
      if (idx === -1) break;

      for (let i = pos; i < idx; i++) {
        if (text[i] === "\n") {
          lineNum++;
          lineStart = i + 1;
        }
      }

      let lineEnd = text.indexOf("\n", idx);
      if (lineEnd === -1) lineEnd = text.length;
      const lineText = text.slice(lineStart, lineEnd);

      matches.push({ position: idx, line: lineNum, text: lineText });
      pos = idx + 1;
    }

    await respond({ id, success: true, data: matches });
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Heading info for outline response.
 */
interface HeadingInfo {
  level: number;
  text: string;
  position: number;
}

/**
 * Handle outline.get request.
 * Extracts all headings from the document.
 */
export async function handleOutlineGet(id: string): Promise<void> {
  try {
    const editor = getEditor();
    if (!editor) throw new Error("No active editor");

    const headings: HeadingInfo[] = [];
    const doc = editor.state.doc;

    doc.descendants((node, pos) => {
      if (node.type.name === "heading") {
        headings.push({
          level: node.attrs.level as number,
          text: node.textContent,
          position: pos,
        });
      }
    });

    await respond({ id, success: true, data: headings });
  } catch (error) {
    await respond({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Handle metadata.get request.
 * Returns document metadata.
 */
export async function handleMetadataGet(id: string): Promise<void> {
  try {
    const editor = getEditor();
    if (!editor) throw new Error("No active editor");

    const tabStore = useTabStore.getState();
    const docStore = useDocumentStore.getState();
    const windowLabel = getCurrentWindowLabel();
    const activeTabId = tabStore.activeTabId[windowLabel];

    if (!activeTabId) {
      throw new Error("No active document");
    }

    const doc = docStore.getDocument(activeTabId);
    const tab = tabStore.tabs[windowLabel]?.find((t) => t.id === activeTabId);

    // Calculate word and character count
    const text = editor.state.doc.textContent;
    const charCount = text.length;
    const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;

    // Get first heading as title if available
    let title = tab?.title ?? "Untitled";
    editor.state.doc.descendants((node) => {
      /* v8 ignore start -- traversal stop (return false) only reached when a level-1 heading exists */
      if (node.type.name === "heading" && node.attrs.level === 1) {
        title = node.textContent;
        return false; // stop traversal
      }
      /* v8 ignore stop */
    });

    await respond({
      id,
      success: true,
      data: {
        filePath: doc?.filePath ?? null,
        title,
        wordCount,
        characterCount: charCount,
        isModified: doc?.isDirty ?? false,
        lastModified: null, // Not tracked currently
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
