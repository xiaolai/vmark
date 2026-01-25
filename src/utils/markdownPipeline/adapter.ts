/**
 * Markdown pipeline adapter
 *
 * Provides a unified interface for parsing and serializing markdown
 * using the remark-based pipeline.
 *
 * @module utils/markdownPipeline/adapter
 *
 * @example
 * const doc = parseMarkdown(schema, "# Hello");
 * const md = serializeMarkdown(schema, doc);
 */

import type { Schema, Node as PMNode } from "@tiptap/pm/model";
import { parseMarkdownToMdast } from "./parser";
import { parseMarkdownToMdastFast, canUseFastParser } from "./fastParser";
import { mdastToProseMirror } from "./mdastToProseMirror";
import { proseMirrorToMdast } from "./proseMirrorToMdast";
import { serializeMdastToMarkdown } from "./serializer";
import type { MarkdownPipelineOptions } from "./types";

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

  try {
    // Use fast parser (markdown-it, ~42x faster) for standard markdown
    // Fall back to remark for:
    // - Math, wiki links, and custom syntax (detected by canUseFastParser)
    // - Special options that only remark supports (preserveLineBreaks, etc.)
    const hasSpecialOptions = Object.keys(options).length > 0;
    const mdast =
      !hasSpecialOptions && canUseFastParser(safeMarkdown)
        ? parseMarkdownToMdastFast(safeMarkdown)
        : parseMarkdownToMdast(safeMarkdown, options);
    return mdastToProseMirror(schema, mdast);
  } catch (error) {
    const preview = safeMarkdown.slice(0, 100);
    const context = safeMarkdown.length > 100 ? `${preview}...` : preview;
    const message = `[MarkdownPipeline] Parse failed: ${error instanceof Error ? error.message : error}\nInput preview: "${context}"`;
    const wrapped = new Error(message);
    (wrapped as Error & { cause?: unknown }).cause = error;
    throw wrapped;
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
    const wrapped = new Error(message);
    (wrapped as Error & { cause?: unknown }).cause = error;
    throw wrapped;
  }
}
