/**
 * Unified processor factories.
 *
 * `createProcessor` builds — and caches — a content-aware processor for the
 * editor pipeline (lazy plugin loading). `createMarkdownProcessor` builds a
 * superset processor used by the lint engine where all plugins must be loaded
 * to preserve source positions.
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
  type ContentAnalysis,
} from "./remarkPlugins";

/**
 * Build a unified processor configured for VMark markdown parsing.
 *
 * Plugins are included based on content analysis:
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
function buildProcessor(analysis: ContentAnalysis, preserveLineBreaks: boolean) {
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

  if (preserveLineBreaks) {
    processor.use(remarkBreaks);
  }

  return processor;
}

/** Stable cache key combining the four analysis flags with the line-break option. */
function processorCacheKey(analysis: ContentAnalysis, preserveLineBreaks: boolean): string {
  return (
    (analysis.hasMath ? "M" : "-") +
    (analysis.hasFrontmatter ? "F" : "-") +
    (analysis.hasWikiLinks ? "W" : "-") +
    (analysis.hasDetails ? "D" : "-") +
    (preserveLineBreaks ? "B" : "-")
  );
}

/**
 * Cache of built processors keyed by content-analysis flags. A unified
 * processor is safe to reuse across `.parse()`/`.runSync()` calls once its
 * plugin set is fixed, so caching avoids rebuilding the ~10-plugin pipeline on
 * every parse. Bounded to 2^5 = 32 entries by the flag-combination key space.
 */
const processorCache = new Map<string, ReturnType<typeof buildProcessor>>();

/**
 * Return a unified processor matching the markdown's plugin needs.
 *
 * Processors are cached by content-analysis flags: every parse that needs the
 * same plugin set reuses one processor instead of reconstructing it.
 */
export function createProcessor(markdown: string, options: MarkdownPipelineOptions = {}) {
  const analysis = analyzeContent(markdown);
  const preserveLineBreaks = options.preserveLineBreaks === true;
  const key = processorCacheKey(analysis, preserveLineBreaks);

  const cached = processorCache.get(key);
  if (cached) return cached;

  const processor = buildProcessor(analysis, preserveLineBreaks);
  processorCache.set(key, processor);
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
