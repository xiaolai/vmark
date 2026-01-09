/**
 * Markdown Pipeline
 *
 * Remark-based markdown parsing and serialization for VMark.
 * Provides MDAST as the intermediate representation between
 * markdown text and ProseMirror documents.
 *
 * @module utils/markdownPipeline
 *
 * @example
 * // Use the adapter with feature flag
 * import { parseMarkdown, serializeMarkdown, setUseRemarkPipeline } from './markdownPipeline';
 *
 * setUseRemarkPipeline(true); // Enable remark pipeline
 * const doc = parseMarkdown(schema, "# Hello");
 * const md = serializeMarkdown(schema, doc);
 *
 * @example
 * // Direct MDAST usage
 * const mdast = parseMarkdownToMdast("# Hello");
 * const md = serializeMdastToMarkdown(mdast);
 */

// Adapter - unified interface with feature flag
export {
  parseMarkdown,
  serializeMarkdown,
  setUseRemarkPipeline,
  getUseRemarkPipeline,
  type PipelineOptions,
} from "./adapter";

// Core parsing/serialization
export { parseMarkdownToMdast } from "./parser";
export { serializeMdastToMarkdown } from "./serializer";

// MDAST ↔ ProseMirror conversion
export { mdastToProseMirror } from "./mdastToProseMirror";
export { proseMirrorToMdast } from "./proseMirrorToMdast";

// Types
export * from "./types";
