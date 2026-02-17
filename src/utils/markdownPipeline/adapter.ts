/**
 * Markdown Pipeline Adapter
 *
 * Purpose: Provides the unified public interface for markdown ↔ ProseMirror conversion.
 * This is the entry point most callers should use rather than importing pipeline internals.
 *
 * Pipeline: markdown string → MDAST (remark) → ProseMirror doc (and reverse)
 *
 * Key decisions:
 *   - Wraps errors with input context for debuggability — the original
 *     remark/PM errors don't include what markdown caused the failure
 *   - Guards null/undefined input from IPC/clipboard edge cases
 *   - Performance instrumented via perfLog for parse bottleneck diagnosis
 *
 * @coordinates-with parsingCache.ts — cached version wraps these functions
 * @coordinates-with parser.ts — markdown → MDAST step
 * @coordinates-with mdastToProseMirror.ts — MDAST → ProseMirror step
 * @coordinates-with proseMirrorToMdast.ts — ProseMirror → MDAST step
 * @coordinates-with serializer.ts — MDAST → markdown step
 * @module utils/markdownPipeline/adapter
 */

import type { Schema, Node as PMNode } from "@tiptap/pm/model";
import { parseMarkdownToMdast } from "./parser";
import { mdastToProseMirror } from "./mdastToProseMirror";
import { proseMirrorToMdast } from "./proseMirrorToMdast";
import { serializeMdastToMarkdown } from "./serializer";
import type { MarkdownPipelineOptions } from "./types";
import { perfStart, perfEnd, perfMark } from "@/utils/perfLog";

/**
 * Parse markdown string to ProseMirror document.
 *
 * Uses the remark pipeline: markdown → MDAST → ProseMirror.
 *
 * @param schema - The ProseMirror schema to use for creating nodes
 * @param markdown - The markdown string to parse (null/undefined treated as empty)
 * @returns A ProseMirror document node
 *
 * @example
 * const doc = parseMarkdown(schema, "# Hello world");
 */
export function parseMarkdown(
  schema: Schema,
  markdown: string,
  options: MarkdownPipelineOptions = {}
): PMNode {
  // Guard against null/undefined from IPC, clipboard, or other sources
  const safeMarkdown = markdown ?? "";

  perfMark("parseMarkdown:start", { size: safeMarkdown.length });

  try {
    perfStart("parseMarkdownToMdast");
    const mdast = parseMarkdownToMdast(safeMarkdown, options);
    perfEnd("parseMarkdownToMdast", { nodeCount: mdast.children?.length ?? 0 });

    perfStart("mdastToProseMirror");
    const doc = mdastToProseMirror(schema, mdast);
    perfEnd("mdastToProseMirror", { docSize: doc.content.size });

    perfMark("parseMarkdown:complete");
    return doc;
  } catch (error) {
    const preview = safeMarkdown.slice(0, 100);
    const context = safeMarkdown.length > 100 ? `${preview}...` : preview;
    const message = `[MarkdownPipeline] Parse failed: ${error instanceof Error ? error.message : error}\nInput preview: "${context}"`;
    throw new Error(message, { cause: error });
  }
}

/**
 * Serialize ProseMirror document to markdown string.
 *
 * Uses the remark pipeline: ProseMirror → MDAST → markdown.
 *
 * @param schema - The ProseMirror schema (used for type context)
 * @param doc - The ProseMirror document to serialize
 * @returns A markdown string
 *
 * @example
 * const md = serializeMarkdown(schema, doc);
 */
export function serializeMarkdown(
  schema: Schema,
  doc: PMNode,
  options: MarkdownPipelineOptions = {}
): string {
  try {
    const mdast = proseMirrorToMdast(schema, doc);
    return serializeMdastToMarkdown(mdast, options);
  } catch (error) {
    const nodeCount = doc.content.childCount;
    const docSize = doc.content.size;
    const message = `[MarkdownPipeline] Serialize failed: ${error instanceof Error ? error.message : error}\nDoc info: ${nodeCount} nodes, size ${docSize}`;
    throw new Error(message, { cause: error });
  }
}
