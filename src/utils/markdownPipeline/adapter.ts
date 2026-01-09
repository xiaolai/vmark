/**
 * Markdown pipeline adapter
 *
 * Provides a unified interface for parsing and serializing markdown,
 * with the ability to switch between the old markdown-it pipeline
 * and the new remark-based pipeline via a feature flag or explicit option.
 *
 * @module utils/markdownPipeline/adapter
 *
 * @example
 * // Use default pipeline (respects global flag)
 * const doc = parseMarkdown(schema, "# Hello");
 *
 * // Explicitly use remark pipeline
 * const doc = parseMarkdown(schema, "# Hello", { useRemark: true });
 *
 * // Configure global default
 * setUseRemarkPipeline(true);
 */

import type { Schema, Node as PMNode } from "@tiptap/pm/model";
import { parseMarkdownToMdast } from "./parser";
import { mdastToProseMirror } from "./mdastToProseMirror";
import { proseMirrorToMdast } from "./proseMirrorToMdast";
import { serializeMdastToMarkdown } from "./serializer";

/**
 * Pipeline options for parsing/serializing.
 */
export interface PipelineOptions {
  /**
   * Explicitly select which pipeline to use.
   * - true: use remark pipeline
   * - false: use markdown-it pipeline
   * - undefined: use global default
   */
  useRemark?: boolean;
}

/**
 * Pipeline state container.
 * Using a frozen object prevents accidental mutation.
 */
interface PipelineState {
  readonly useRemarkPipeline: boolean;
}

// Initial state - default to markdown-it (false) for backward compatibility
let pipelineState: PipelineState = Object.freeze({ useRemarkPipeline: false });

/**
 * Set whether to use the remark pipeline or the legacy markdown-it pipeline.
 *
 * This sets the global default. Individual calls can override this via options.
 *
 * @param enabled - If true, use remark; if false, use markdown-it
 *
 * @example
 * setUseRemarkPipeline(true); // Enable remark globally
 * setUseRemarkPipeline(false); // Use legacy markdown-it globally
 */
export function setUseRemarkPipeline(enabled: boolean): void {
  // Create new frozen state to prevent race conditions on the boolean
  pipelineState = Object.freeze({ useRemarkPipeline: enabled });
}

/**
 * Get the current global pipeline setting.
 *
 * @returns true if remark pipeline is enabled globally, false for markdown-it
 */
export function getUseRemarkPipeline(): boolean {
  return pipelineState.useRemarkPipeline;
}

/**
 * Determine which pipeline to use based on options and global state.
 */
function shouldUseRemark(options?: PipelineOptions): boolean {
  if (options?.useRemark !== undefined) {
    return options.useRemark;
  }
  return pipelineState.useRemarkPipeline;
}

/**
 * Parse markdown string to ProseMirror document.
 *
 * Uses either the remark or markdown-it pipeline based on options or global flag.
 *
 * @param schema - The ProseMirror schema to use for creating nodes
 * @param markdown - The markdown string to parse
 * @param options - Optional pipeline selection
 * @returns A ProseMirror document node
 *
 * @example
 * // Use global default
 * const doc = parseMarkdown(schema, "# Hello world");
 *
 * // Explicitly use remark
 * const doc = parseMarkdown(schema, "# Hello", { useRemark: true });
 */
export function parseMarkdown(
  schema: Schema,
  markdown: string,
  options?: PipelineOptions
): PMNode {
  if (shouldUseRemark(options)) {
    return parseMarkdownWithRemark(schema, markdown);
  }
  return parseMarkdownWithMarkdownIt(schema, markdown);
}

/**
 * Serialize ProseMirror document to markdown string.
 *
 * Uses either the remark or markdown-it pipeline based on options or global flag.
 *
 * @param schema - The ProseMirror schema (used for type context)
 * @param doc - The ProseMirror document to serialize
 * @param options - Optional pipeline selection
 * @returns A markdown string
 *
 * @example
 * // Use global default
 * const md = serializeMarkdown(schema, doc);
 *
 * // Explicitly use markdown-it
 * const md = serializeMarkdown(schema, doc, { useRemark: false });
 */
export function serializeMarkdown(
  schema: Schema,
  doc: PMNode,
  options?: PipelineOptions
): string {
  if (shouldUseRemark(options)) {
    return serializeMarkdownWithRemark(schema, doc);
  }
  return serializeMarkdownWithProseMirror(doc);
}

// Internal: Parse with remark pipeline
function parseMarkdownWithRemark(schema: Schema, markdown: string): PMNode {
  const mdast = parseMarkdownToMdast(markdown);
  return mdastToProseMirror(schema, mdast);
}

// Internal: Serialize with remark pipeline
function serializeMarkdownWithRemark(schema: Schema, doc: PMNode): string {
  const mdast = proseMirrorToMdast(schema, doc);
  return serializeMdastToMarkdown(mdast);
}

// Internal: Parse with legacy markdown-it pipeline
// Import dynamically to avoid circular dependencies
function parseMarkdownWithMarkdownIt(schema: Schema, markdown: string): PMNode {
  // Lazy import to avoid bundling markdown-it when not needed
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { parseMarkdownToTiptapDoc } = require("../tiptapMarkdownParser");
  return parseMarkdownToTiptapDoc(schema, markdown);
}

// Internal: Serialize with legacy prosemirror-markdown pipeline
function serializeMarkdownWithProseMirror(doc: PMNode): string {
  // Lazy import to avoid bundling prosemirror-markdown when not needed
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { serializeTiptapDocToMarkdown } = require("../tiptapMarkdownSerializer");
  return serializeTiptapDocToMarkdown(doc);
}
