/**
 * MCP Bridge Utilities
 */

import { invoke } from "@tauri-apps/api/core";
import { useTiptapEditorStore } from "@/stores/tiptapEditorStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { serializeMarkdown } from "@/utils/markdownPipeline";
import type { McpResponse } from "./types";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { Editor } from "@tiptap/react";

/**
 * Send response back to the MCP bridge.
 */
export async function respond(response: McpResponse): Promise<void> {
  try {
    await invoke("mcp_bridge_respond", { payload: response });
  } catch (error) {
    console.error("[MCP Bridge] Failed to send response:", error);
  }
}

/**
 * Get the current editor instance.
 */
export function getEditor() {
  return useTiptapEditorStore.getState().editor;
}

/**
 * Get the current document content as markdown.
 */
export function getDocumentContent(): string {
  const editor = getEditor();
  if (!editor) {
    throw new Error("No active editor");
  }
  return serializeMarkdown(editor.state.schema, editor.state.doc);
}

/**
 * Resolve windowId parameter to actual window label.
 * Maps "focused" to the currently focused window (currently always "main").
 * Defaults undefined to "main".
 */
export function resolveWindowId(windowId: string | undefined): string {
  if (windowId === "focused") {
    // For now, VMark is single-window, so "focused" always means "main"
    // Future: look up actual focused window from window manager
    return "main";
  }
  return windowId ?? "main";
}

/**
 * Check if auto-approve edits is enabled in MCP server settings.
 */
export function isAutoApproveEnabled(): boolean {
  return useSettingsStore.getState().advanced.mcpServer.autoApproveEdits;
}

/**
 * Match info with correct ProseMirror positions.
 */
export interface TextMatch {
  from: number;
  to: number;
  nodeId: string;
  context: { before: string; after: string };
}

/**
 * Find all occurrences of a text pattern in the document.
 * Returns ProseMirror positions (not textContent offsets).
 */
export function findTextMatches(
  doc: ProseMirrorNode,
  pattern: string,
  contextLength: number = 30
): TextMatch[] {
  const matches: TextMatch[] = [];
  let matchIndex = 0;

  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;

    // Get text content of this textblock
    const nodeText = node.textContent;
    let searchIndex = 0;

    while (true) {
      const relativeIndex = nodeText.indexOf(pattern, searchIndex);
      if (relativeIndex === -1) break;

      // Convert relative text position to absolute PM position
      // pos is the position of the node, +1 to get inside the node
      const textStartPos = pos + 1;

      // Find the exact PM position by walking through the text content
      let currentOffset = 0;
      let pmFrom = textStartPos;

      node.forEach((child, offset) => {
        if (child.isText && child.text) {
          const textLength = child.text.length;
          const childStart = currentOffset;
          const childEnd = currentOffset + textLength;

          if (relativeIndex >= childStart && relativeIndex < childEnd) {
            pmFrom = textStartPos + offset + (relativeIndex - childStart);
          }
          currentOffset = childEnd;
        }
      });

      const pmTo = pmFrom + pattern.length;

      // Get context from the document's textContent for display
      const fullText = doc.textContent;
      // Find where this text block starts in the full textContent
      let textContentOffset = 0;
      let found = false;
      doc.descendants((n, p) => {
        if (found) return false;
        if (p === pos) {
          found = true;
          return false;
        }
        if (n.isTextblock) {
          textContentOffset += n.textContent.length;
        }
        return true;
      });

      const textContentIndex = textContentOffset + relativeIndex;
      const beforeStart = Math.max(0, textContentIndex - contextLength);
      const afterEnd = Math.min(fullText.length, textContentIndex + pattern.length + contextLength);

      matches.push({
        from: pmFrom,
        to: pmTo,
        nodeId: `match-${matchIndex++}`,
        context: {
          before: fullText.substring(beforeStart, textContentIndex),
          after: fullText.substring(textContentIndex + pattern.length, afterEnd),
        },
      });

      searchIndex = relativeIndex + 1;
    }

    return true;
  });

  return matches;
}

/**
 * Node resolution result with ProseMirror positions.
 */
export interface ResolvedNode {
  from: number;
  to: number;
  type: string;
  text: string;
}

/**
 * Resolve a node ID to ProseMirror positions.
 * Node IDs follow the format: {prefix}-{index} where prefix is based on node type.
 */
export function resolveNodeId(editor: Editor, nodeId: string): ResolvedNode | null {
  const match = nodeId.match(/^([a-z]+)-(\d+)$/);
  if (!match) return null;

  const [, prefix, indexStr] = match;
  const targetIndex = parseInt(indexStr, 10);

  // Map prefix back to type
  const prefixToType: Record<string, string> = {
    h: "heading",
    p: "paragraph",
    code: "codeBlock",
    quote: "blockquote",
    ul: "bulletList",
    ol: "orderedList",
    task: "taskList",
    li: "listItem",
    ti: "taskItem",
    table: "table",
    tr: "tableRow",
    th: "tableHeader",
    td: "tableCell",
    hr: "horizontalRule",
    img: "image",
    br: "hardBreak",
    txt: "text",
  };

  const targetType = prefixToType[prefix];
  if (!targetType) return null;

  let currentIndex = 0;
  let result: ResolvedNode | null = null;

  editor.state.doc.descendants((node, pos) => {
    if (result) return false;

    if (node.type.name === targetType) {
      if (currentIndex === targetIndex) {
        result = {
          from: pos,
          to: pos + node.nodeSize,
          type: node.type.name,
          text: node.textContent,
        };
        return false;
      }
      currentIndex++;
    }
    return true;
  });

  return result;
}

/**
 * Get the text content position range for a block node.
 * Returns the range that contains the actual text (excluding structural tokens).
 */
export function getTextRange(editor: Editor, from: number, to: number): { from: number; to: number } {
  const doc = editor.state.doc;
  const $from = doc.resolve(from);

  // For textblock nodes, adjust to get the text range
  const node = $from.nodeAfter;
  if (node && node.isTextblock) {
    return {
      from: from + 1,
      to: to - 1,
    };
  }

  return { from, to };
}
