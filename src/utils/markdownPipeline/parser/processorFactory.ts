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

import { buildProcessorForMode } from "../dialect";
import type { MarkdownPipelineOptions } from "../types";
import { analyzeContent, type ContentAnalysis } from "./remarkPlugins";

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
  // The plugin set — and every delta between modes — lives in `dialect.ts`.
  // Building here from a second hand-written chain is what let the editor and
  // lint stacks diverge silently (WI-3.1).
  return buildProcessorForMode("document", { ...analysis, preserveLineBreaks });
}

/**
 * Stable cache key combining every analysis flag with the line-break option.
 *
 * EVERY flag that changes the plugin stack must appear here. Adding
 * `hasAmbiguousListUnderline` to the stack without adding it to the key meant a
 * processor built for a document that needed setext disabled was reused for one
 * that did not, and the reverse — the flag looked ignored at random.
 */
function processorCacheKey(analysis: ContentAnalysis, preserveLineBreaks: boolean): string {
  return (
    (analysis.hasMath ? "M" : "-") +
    (analysis.hasFrontmatter ? "F" : "-") +
    (analysis.hasWikiLinks ? "W" : "-") +
    (analysis.hasDetails ? "D" : "-") +
    (analysis.hasAmbiguousListUnderline ? "S" : "-") +
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
  // `source-position` loads every plugin unconditionally: offsets must not
  // depend on what the document happens to contain.
  return buildProcessorForMode("source-position");
}
