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
 * import { parseMarkdown, serializeMarkdown } from './markdownPipeline';
 *
 * const doc = parseMarkdown(schema, "# Hello");
 * const md = serializeMarkdown(schema, doc);
 *
 * @example
 * // Direct MDAST usage
 * const mdast = parseMarkdownToMdast("# Hello");
 * const md = serializeMdastToMarkdown(mdast);
 */

// Adapter - unified interface
export { parseMarkdown, serializeMarkdown } from "./adapter";

// Async parsing (Web Worker)
export {
  parseMarkdownAsync,
  parseMarkdownToMdastAsync,
  shouldUseAsyncParsing,
  terminateWorker,
} from "./workerAdapter";

// Cached parsing
export {
  parseMarkdownCached,
  parseMarkdownToMdastCached,
  getCacheStats,
  clearCache,
  prewarmCache,
} from "./parsingCache";

// Core parsing/serialization
export { parseMarkdownToMdast } from "./parser";
export { serializeMdastToMarkdown } from "./serializer";

// Fast parser (markdown-it based, ~42x faster for standard markdown)
export {
  parseMarkdownToMdastFast,
  canUseFastParser,
} from "./fastParser";

// MDAST ↔ ProseMirror conversion
export { mdastToProseMirror } from "./mdastToProseMirror";
export { proseMirrorToMdast } from "./proseMirrorToMdast";

// Types
export * from "./types";
