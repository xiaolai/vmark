/**
 * MCP Bridge — Block Handlers
 *
 * Purpose: Block-level document structure queries — list_blocks,
 *   resolve_targets, and get_section. Uses shared AST utilities from
 *   astHandlers.ts.
 *
 * @coordinates-with astHandlers.ts — shared types and utility functions
 * @module hooks/mcpBridge/blockHandlers
 */

import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { respond, getEditor } from "./utils";
import { useRevisionStore } from "@/stores/revisionStore";
import {
  type AstNode,
  type BlockQuery,
  type BlockInfo,
  generateNodeId,
  resetNodeIdCounters,
  extractText,
  toAstNode,
  matchesQuery,
} from "./astHandlers";

// ── Handler: list_blocks ──────────────────────────────────────────────

/**
 * Handle list_blocks request.
 */
export async function handleListBlocks(
  id: string,
  args: Record<string, unknown>
): Promise<void> {
  try {
    const editor = getEditor();
    if (!editor) {
      throw new Error("No active editor");
    }

    const query = args.query as BlockQuery | undefined;
    const limit = (args.limit as number) ?? 50;
    const afterCursor = args.afterCursor as string | undefined;

    resetNodeIdCounters();

    const blocks: BlockInfo[] = [];
    let foundCursor = !afterCursor;

    editor.state.doc.descendants((node: ProseMirrorNode, pos: number) => {
      if (!node.isBlock || node.isTextblock === false) return true;

      const nodeId = generateNodeId(node.type.name);

      // Handle cursor-based pagination
      if (afterCursor && !foundCursor) {
        if (nodeId === afterCursor) {
          foundCursor = true;
        }
        return true;
      }

      // Apply filter
      if (query && !matchesQuery(node, query)) {
        return true;
      }

      // Check limit
      if (blocks.length >= limit) {
        return false;
      }

      const text = extractText(node);
      const preview = text.length > 100 ? text.substring(0, 100) + "..." : text;

      blocks.push({
        id: nodeId,
        type: node.type.name,
        text,
        preview,
        pos: { from: pos, to: pos + node.nodeSize },
      });

      return true;
    });

    const revision = useRevisionStore.getState().getRevision();
    const hasMore = blocks.length === limit;

    await respond({
      id,
      success: true,
      data: {
        revision,
        blocks,
        hasMore,
        ...(hasMore && blocks.length > 0 && { nextCursor: blocks[blocks.length - 1].id }),
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

// ── Handler: resolve_targets ──────────────────────────────────────────

/**
 * Handle resolve_targets request.
 */
export async function handleResolveTargets(
  id: string,
  args: Record<string, unknown>
): Promise<void> {
  try {
    const editor = getEditor();
    if (!editor) {
      throw new Error("No active editor");
    }

    const query = args.query as BlockQuery;
    const maxResults = (args.maxResults as number) ?? 10;

    if (!query) {
      throw new Error("query is required");
    }

    resetNodeIdCounters();

    interface Candidate {
      nodeId: string;
      score: number;
      reason: string;
      preview: string;
      pos: { from: number; to: number };
    }

    const candidates: Candidate[] = [];

    editor.state.doc.descendants((node: ProseMirrorNode, pos: number) => {
      if (!node.isBlock) return true;

      const nodeId = generateNodeId(node.type.name);

      // Check if matches query
      if (!matchesQuery(node, query)) {
        return true;
      }

      const text = extractText(node);
      const preview = text.length > 100 ? text.substring(0, 100) + "..." : text;

      // Calculate match score
      let score = 1.0;
      const reasons: string[] = [];

      if (query.type) {
        reasons.push(`type matches "${node.type.name}"`);
      }
      if (query.contains) {
        const lowerText = text.toLowerCase();
        const lowerQuery = query.contains.toLowerCase();
        if (lowerText === lowerQuery) {
          score = 1.0;
          reasons.push("exact text match");
        } else if (lowerText.startsWith(lowerQuery)) {
          score = 0.9;
          reasons.push("text starts with query");
        } else {
          score = 0.7;
          reasons.push("text contains query");
        }
      }
      if (query.level !== undefined) {
        reasons.push(`level=${query.level}`);
      }

      candidates.push({
        nodeId,
        score,
        reason: reasons.join(", "),
        preview,
        pos: { from: pos, to: pos + node.nodeSize },
      });

      return true;
    });

    // Sort by score descending and limit results
    candidates.sort((a, b) => b.score - a.score);
    const limited = candidates.slice(0, maxResults);

    // Check for ambiguity (multiple high-score matches)
    const highScoreCount = limited.filter((c) => c.score >= 0.9).length;
    const isAmbiguous = highScoreCount > 1;

    const revision = useRevisionStore.getState().getRevision();

    await respond({
      id,
      success: true,
      data: {
        candidates: limited,
        isAmbiguous,
        revision,
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

// ── Handler: get_section ──────────────────────────────────────────────

/**
 * Handle get_section request.
 */
export async function handleGetSection(
  id: string,
  args: Record<string, unknown>
): Promise<void> {
  try {
    const editor = getEditor();
    if (!editor) {
      throw new Error("No active editor");
    }

    const heading = args.heading as string | { level: number; index: number };
    const includeNested = args.includeNested as boolean | undefined;

    if (!heading) {
      throw new Error("heading is required");
    }

    resetNodeIdCounters();

    const doc = editor.state.doc;
    let targetPos: number | null = null;
    let targetLevel: number | null = null;
    let targetId: string | null = null;
    let targetText: string | null = null;

    // Find the target heading
    if (typeof heading === "string") {
      doc.descendants((node: ProseMirrorNode, pos: number) => {
        if (node.type.name === "heading") {
          const text = extractText(node);
          if (text.toLowerCase() === heading.toLowerCase()) {
            targetPos = pos;
            targetLevel = node.attrs.level as number;
            targetId = generateNodeId("heading");
            targetText = text;
            return false;
          }
        }
        return true;
      });
    } else {
      let headingIndex = 0;
      doc.descendants((node: ProseMirrorNode, pos: number) => {
        if (node.type.name === "heading" && node.attrs.level === heading.level) {
          if (headingIndex === heading.index) {
            targetPos = pos;
            targetLevel = heading.level;
            targetId = generateNodeId("heading");
            targetText = extractText(node);
            return false;
          }
          headingIndex++;
        }
        return true;
      });
    }

    if (targetPos === null || targetLevel === null) {
      throw new Error("Section not found");
    }

    // Collect section content
    const content: AstNode[] = [];
    let sectionEnd = doc.content.size;
    let inSection = false;

    doc.descendants((node: ProseMirrorNode, pos: number) => {
      if (pos < targetPos!) return true;

      if (pos === targetPos) {
        inSection = true;
        return true;
      }

      if (inSection) {
        // Check if we hit the end of section
        if (node.type.name === "heading") {
          const level = node.attrs.level as number;
          if (!includeNested && level <= targetLevel!) {
            sectionEnd = pos;
            return false;
          }
        }

        if (node.isBlock) {
          content.push(toAstNode(node));
        }
      }

      return true;
    });

    const revision = useRevisionStore.getState().getRevision();

    await respond({
      id,
      success: true,
      data: {
        revision,
        sectionId: targetId,
        heading: { id: targetId, text: targetText, level: targetLevel },
        content,
        range: { from: targetPos, to: sectionEnd },
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
