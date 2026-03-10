/**
 * MCP Bridge — AST Handlers
 *
 * Purpose: AST-related document structure queries — get_document_ast and
 *   get_document_digest. Also exports shared types and utility functions
 *   used by blockHandlers.ts.
 *
 * @module hooks/mcpBridge/astHandlers
 */

import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { respond, getEditor } from "./utils";
import { useRevisionStore } from "@/stores/revisionStore";
import { numberWithDefault, optionalString, optionalArray, optionalObject } from "./validateArgs";

// ── Shared Types ──────────────────────────────────────────────────────

export interface AstNode {
  id: string;
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  children?: AstNode[];
}

export interface BlockQuery {
  type?: string | string[];
  level?: number;
  contains?: string;
  hasMarks?: string[];
}

export interface BlockInfo {
  id: string;
  type: string;
  text: string;
  preview: string;
  pos: { from: number; to: number };
  context?: { before: string; after: string };
}

interface OutlineEntry {
  id: string;
  level: number;
  text: string;
  children?: OutlineEntry[];
}

interface SectionSummary {
  headingId: string;
  headingText: string;
  level: number;
  wordCount: number;
  blockCount: number;
}

// ── Node ID Generation ────────────────────────────────────────────────

// Node ID counters by type
const nodeIdCounters: Record<string, number> = {};

/**
 * Generate a node ID based on type.
 */
export function generateNodeId(type: string): string {
  const prefix = getTypePrefix(type);
  if (!nodeIdCounters[prefix]) {
    nodeIdCounters[prefix] = 0;
  }
  return `${prefix}-${nodeIdCounters[prefix]++}`;
}

/**
 * Get prefix for node type.
 */
function getTypePrefix(type: string): string {
  const prefixMap: Record<string, string> = {
    heading: "h",
    paragraph: "p",
    codeBlock: "code",
    blockquote: "quote",
    bulletList: "ul",
    orderedList: "ol",
    taskList: "task",
    listItem: "li",
    taskItem: "ti",
    table: "table",
    tableRow: "tr",
    tableHeader: "th",
    tableCell: "td",
    horizontalRule: "hr",
    image: "img",
    hardBreak: "br",
    text: "txt",
  };
  return prefixMap[type] || type.substring(0, 4);
}

/**
 * Reset node ID counters (call on document load).
 */
export function resetNodeIdCounters(): void {
  Object.keys(nodeIdCounters).forEach((key) => {
    nodeIdCounters[key] = 0;
  });
}

// ── Shared Helpers ────────────────────────────────────────────────────

/**
 * Extract text from a ProseMirror node.
 */
export function extractText(node: ProseMirrorNode): string {
  let text = "";
  node.descendants((child) => {
    if (child.isText) {
      text += child.text;
    }
    return true;
  });
  return text;
}

/**
 * Count words in text.
 */
export function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
}

/**
 * Convert ProseMirror node to AstNode.
 */
export function toAstNode(
  node: ProseMirrorNode,
  projection?: string[]
): AstNode {
  const id = generateNodeId(node.type.name);
  const result: AstNode = { id, type: node.type.name };

  const shouldInclude = (field: string) => !projection || projection.includes(field);

  if (shouldInclude("text") && node.isTextblock) {
    result.text = extractText(node);
  }

  if (shouldInclude("attrs") && Object.keys(node.attrs).length > 0) {
    result.attrs = { ...node.attrs };
  }

  if (shouldInclude("marks") && node.isText && node.marks.length > 0) {
    result.marks = node.marks.map((m) => ({
      type: m.type.name,
      ...(Object.keys(m.attrs).length > 0 && { attrs: { ...m.attrs } }),
    }));
  }

  if (shouldInclude("children") && node.childCount > 0 && !node.isTextblock) {
    result.children = [];
    node.forEach((child) => {
      result.children!.push(toAstNode(child, projection));
    });
  }

  return result;
}

/**
 * Check if a node matches a query.
 */
export function matchesQuery(node: ProseMirrorNode, query: BlockQuery): boolean {
  if (query.type) {
    const types = Array.isArray(query.type) ? query.type : [query.type];
    if (!types.includes(node.type.name)) {
      return false;
    }
  }

  if (query.level !== undefined && node.type.name === "heading") {
    if (node.attrs.level !== query.level) {
      return false;
    }
  }

  if (query.contains) {
    const text = extractText(node).toLowerCase();
    if (!text.includes(query.contains.toLowerCase())) {
      return false;
    }
  }

  if (query.hasMarks && query.hasMarks.length > 0) {
    let hasRequiredMark = false;
    node.descendants((child) => {
      if (child.isText && child.marks.length > 0) {
        const markTypes = child.marks.map((m) => m.type.name);
        if (query.hasMarks!.some((m) => markTypes.includes(m))) {
          hasRequiredMark = true;
          return false; // Stop descending
        }
      }
      return true;
    });
    if (!hasRequiredMark) {
      return false;
    }
  }

  return true;
}

// ── Handler: get_document_ast ─────────────────────────────────────────

/**
 * Handle get_document_ast request.
 */
export async function handleGetAst(
  id: string,
  args: Record<string, unknown>
): Promise<void> {
  try {
    const editor = getEditor();
    if (!editor) {
      throw new Error("No active editor");
    }

    const projection = optionalArray(args, "projection") as string[] | undefined;
    const filter = optionalObject<BlockQuery>(args, "filter");
    const limit = numberWithDefault(args, "limit", 100);
    const offset = numberWithDefault(args, "offset", 0);
    const afterCursor = optionalString(args, "afterCursor");

    resetNodeIdCounters();

    const nodes: AstNode[] = [];
    let skipped = 0;
    let foundCursor = !afterCursor;

    editor.state.doc.descendants((node, _pos) => {
      // Only process block-level nodes
      if (!node.isBlock) return true;

      const astNode = toAstNode(node, projection);

      // Handle cursor-based pagination
      if (afterCursor && !foundCursor) {
        if (astNode.id === afterCursor) {
          foundCursor = true;
        }
        return true;
      }

      // Apply filter
      if (filter && !matchesQuery(node, filter)) {
        return true;
      }

      // Handle offset
      if (skipped < offset) {
        skipped++;
        return true;
      }

      // Check limit
      if (nodes.length >= limit) {
        return false;
      }

      nodes.push(astNode);
      return true;
    });

    const revision = useRevisionStore.getState().getRevision();
    const hasMore = nodes.length === limit;

    await respond({
      id,
      success: true,
      data: {
        revision,
        nodes,
        hasMore,
        ...(hasMore && nodes.length > 0 && { nextCursor: nodes[nodes.length - 1].id }),
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

// ── Handler: get_document_digest ──────────────────────────────────────

/**
 * Handle get_document_digest request.
 */
export async function handleGetDigest(id: string): Promise<void> {
  try {
    const editor = getEditor();
    if (!editor) {
      throw new Error("No active editor");
    }

    resetNodeIdCounters();

    const doc = editor.state.doc;
    const fullText = extractText(doc);
    const wordCount = countWords(fullText);
    const charCount = fullText.length;

    // Build outline and collect stats
    const outline: OutlineEntry[] = [];
    const outlineStack: OutlineEntry[][] = [outline];
    const sections: SectionSummary[] = [];
    const blockCounts: Record<string, number> = {};
    let hasImages = false;
    let hasTables = false;
    let hasCodeBlocks = false;
    const languages: string[] = [];

    interface SectionTracker {
      id: string;
      text: string;
      level: number;
      wordCount: number;
      blockCount: number;
    }
    let currentSection: SectionTracker | null = null;

    doc.descendants((node) => {
      const type = node.type.name;

      // Count blocks
      if (node.isBlock) {
        blockCounts[type] = (blockCounts[type] || 0) + 1;
      }

      // Detect special content
      if (type === "image") hasImages = true;
      if (type === "table") hasTables = true;
      if (type === "codeBlock") {
        hasCodeBlocks = true;
        const lang = node.attrs.language as string;
        if (lang && !languages.includes(lang)) {
          languages.push(lang);
        }
      }

      // Build outline from headings
      if (type === "heading") {
        const level = node.attrs.level as number;
        const text = extractText(node);
        const nodeId = generateNodeId("heading");

        // Save current section if exists
        if (currentSection) {
          sections.push({
            headingId: currentSection.id,
            headingText: currentSection.text,
            level: currentSection.level,
            wordCount: currentSection.wordCount,
            blockCount: currentSection.blockCount,
          });
        }

        // Start new section
        currentSection = { id: nodeId, text, level, wordCount: 0, blockCount: 0 };

        const entry: OutlineEntry = { id: nodeId, level, text };

        // Find correct parent level
        while (outlineStack.length > level) {
          outlineStack.pop();
        }
        while (outlineStack.length < level) {
          const parent = outlineStack[outlineStack.length - 1];
          if (parent.length === 0) {
            parent.push({ id: "", level: outlineStack.length, text: "", children: [] });
          }
          const lastEntry = parent[parent.length - 1];
          if (!lastEntry.children) {
            lastEntry.children = [];
          }
          outlineStack.push(lastEntry.children);
        }

        outlineStack[outlineStack.length - 1].push(entry);
      } else if (currentSection && node.isBlock) {
        currentSection.blockCount++;
        if (node.isTextblock) {
          currentSection.wordCount += countWords(extractText(node));
        }
      }

      return true;
    });

    // Save last section
    if (currentSection !== null) {
      const section = currentSection as SectionTracker;
      sections.push({
        headingId: section.id,
        headingText: section.text,
        level: section.level,
        wordCount: section.wordCount,
        blockCount: section.blockCount,
      });
    }

    // Get title (first H1 or "Untitled")
    let title = "Untitled";
    doc.descendants((node) => {
      if (node.type.name === "heading" && node.attrs.level === 1) {
        title = extractText(node);
        return false;
      }
      return true;
    });

    const revision = useRevisionStore.getState().getRevision();

    await respond({
      id,
      success: true,
      data: {
        revision,
        title,
        wordCount,
        charCount,
        outline,
        sections,
        blockCounts,
        hasImages,
        hasTables,
        hasCodeBlocks,
        languages,
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
