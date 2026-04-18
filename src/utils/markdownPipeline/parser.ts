/**
 * Markdown Parser (remark-based) — entry point.
 *
 * Purpose: Parses markdown text into MDAST (Markdown Abstract Syntax Tree)
 * with support for GFM, math, frontmatter, wiki links, and custom inline syntax.
 *
 * Pipeline: markdown string → normalizeBareListMarkers → preprocessEscapedMarkers
 *   → unified/remark → restoreEscapedMarkers → fixNormalizationSpread? → MDAST
 *
 * Key decisions:
 *   - Lazy plugin loading based on content analysis (analyzeContent) — avoids
 *     loading remark-math/frontmatter/etc. when content doesn't use them
 *   - remarkTocBlock converts `[TOC]` paragraphs to toc MDAST nodes (always loaded)
 *   - Custom escape preprocessing using Unicode Private Use Area placeholders
 *     because remark processes backslash escapes before our plugins run
 *   - remarkValidateMath rejects `$100 and $200` (leading/trailing whitespace)
 *     to prevent false positives from dollar signs in prose
 *   - singleTilde disabled in remark-gfm to avoid conflict with subscript syntax
 *
 * @coordinates-with serializer.ts — reverse direction (MDAST → markdown string)
 * @coordinates-with adapter.ts — wraps this with error handling and perf logging
 * @coordinates-with parsingCache.ts — caches results of parseMarkdownToMdast
 * @module utils/markdownPipeline/parser
 */

import type { Root } from "mdast";
import type { MarkdownPipelineOptions } from "./types";
import { perfStart, perfEnd } from "@/utils/perfLog";
import {
  preprocessEscapedMarkers,
  restoreEscapedMarkers,
} from "./parser/escapeMarkers";
import {
  normalizeBareListMarkers,
  fixNormalizationSpread,
} from "./parser/listNormalization";
import { createProcessor } from "./parser/processorFactory";

// Re-exports for backward compatibility with callers that import directly
// from this file.
export { normalizeBareListMarkers } from "./parser/listNormalization";
export { createMarkdownProcessor } from "./parser/processorFactory";

/**
 * Parse markdown text into MDAST.
 *
 * @param markdown - The markdown text to parse
 * @returns The root MDAST node
 *
 * @example
 * const mdast = parseMarkdownToMdast("# Hello\n\nWorld");
 * // mdast.type === "root"
 * // mdast.children[0].type === "heading"
 * // mdast.children[1].type === "paragraph"
 */
export function parseMarkdownToMdast(
  markdown: string,
  options: MarkdownPipelineOptions = {}
): Root {
  // Normalize bare list markers (e.g., "  -\n") to ensure trailing space
  const { text: normalized, modified: wasNormalized } = normalizeBareListMarkers(markdown);
  // Pre-process escaped custom markers before remark parsing
  const preprocessed = preprocessEscapedMarkers(normalized);

  perfStart("createProcessor");
  const processor = createProcessor(preprocessed, options);
  perfEnd("createProcessor");

  perfStart("remarkParse");
  const result = processor.parse(preprocessed);
  perfEnd("remarkParse");

  // Run transforms (plugins that modify the tree)
  perfStart("remarkRunSync");
  const transformed = processor.runSync(result);
  perfEnd("remarkRunSync");

  // Restore escaped markers back to literal characters
  restoreEscapedMarkers(transformed as Root);

  // Fix spread artifacts only when normalization inserted blank lines
  if (wasNormalized) {
    fixNormalizationSpread(transformed as Root);
  }

  return transformed as Root;
}
