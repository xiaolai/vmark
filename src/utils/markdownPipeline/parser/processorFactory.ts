/**
 * Unified processor factories.
 *
 * `createProcessor` builds a content-aware processor for the editor pipeline
 * (lazy plugin loading). `createMarkdownProcessor` builds a superset processor
 * used by the lint engine where all plugins must be loaded to preserve
 * source positions.
 *
 * @module utils/markdownPipeline/parser/processorFactory
 */

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkFrontmatter from "remark-frontmatter";
import remarkBreaks from "remark-breaks";
import {
  remarkCustomInline,
  remarkDetailsBlock,
  remarkResolveReferences,
  remarkTocBlock,
  remarkWikiLinks,
} from "../plugins";
import type { MarkdownPipelineOptions } from "../types";
import {
  analyzeContent,
  remarkDisableSetextHeadings,
  remarkValidateMath,
} from "./remarkPlugins";

/**
 * Unified processor configured for VMark markdown parsing.
 *
 * Plugins are loaded lazily based on content analysis:
 * - remark-parse: Always (base CommonMark parser)
 * - remark-gfm: Always (tables, task lists, strikethrough, autolinks)
 * - remark-math: Only if document contains `$`
 * - remark-frontmatter: Only if document starts with `---`
 * - remarkWikiLinks: Only if document contains `[[`
 * - remarkDetailsBlock: Only if document contains `<details`
 *
 * Custom inline syntax (==highlight==, ~sub~, ^sup^, ++underline++)
 * is handled via remarkCustomInline plugin (always loaded, lightweight).
 */
export function createProcessor(markdown: string, options: MarkdownPipelineOptions = {}) {
  const analysis = analyzeContent(markdown);

  const processor = unified()
    .use(remarkParse)
    .use(remarkDisableSetextHeadings)
    .use(remarkGfm, {
      // Disable single tilde strikethrough to avoid conflict with subscript
      // GFM strikethrough uses ~~double tilde~~
      singleTilde: false,
    });

  // Conditionally add math support
  if (analysis.hasMath) {
    processor.use(remarkMath);
    processor.use(remarkValidateMath);
  }

  // Conditionally add frontmatter support
  if (analysis.hasFrontmatter) {
    processor.use(remarkFrontmatter, ["yaml"]);
  }

  // Conditionally add wiki links support
  if (analysis.hasWikiLinks) {
    processor.use(remarkWikiLinks);
  }

  // Conditionally add details block support
  if (analysis.hasDetails) {
    processor.use(remarkDetailsBlock);
  }

  // Always load TOC block detection (lightweight, checks single-text paragraphs)
  processor.use(remarkTocBlock);

  // Always load custom inline (lightweight, common syntax)
  processor.use(remarkCustomInline);

  // Always load reference resolver (needed for GFM references)
  processor.use(remarkResolveReferences);

  if (options.preserveLineBreaks) {
    processor.use(remarkBreaks);
  }

  return processor;
}

/**
 * Create a markdown processor for lint use.
 *
 * Same plugin stack as the editor pipeline but:
 * - Always loads ALL plugins (math, frontmatter, wiki-links, details)
 * - Skips normalizeBareListMarkers (preserves original positions)
 * - Skips preprocessEscapedMarkers (lint checks raw source)
 *
 * Returns a unified Processor — call `.parse(source)` for MDAST with
 * accurate position data, then `.runSync(tree)` for transforms.
 */
export function createMarkdownProcessor() {
  const processor = unified()
    .use(remarkParse)
    .use(remarkDisableSetextHeadings)
    .use(remarkGfm, { singleTilde: false })
    .use(remarkMath)
    .use(remarkValidateMath)
    .use(remarkFrontmatter, ["yaml"])
    .use(remarkWikiLinks)
    .use(remarkDetailsBlock)
    .use(remarkTocBlock)
    .use(remarkCustomInline)
    .use(remarkResolveReferences);

  return processor;
}
