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

import { buildProcessorForMode, cacheKeyForMode } from "../dialect";
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
 * Stable cache key, DERIVED from the dialect's conditional flags.
 *
 * This enumerated the flags by hand, and the comment it replaces recorded the
 * bug that follows from missing one: a processor built for a document that
 * needed setext suppressed was reused for one that did not, so the flag looked
 * ignored at random. Deriving means a descriptor that starts conditioning on a
 * new flag changes the key automatically. Adding a `conditionalFlags()` helper
 * was NOT enough on its own — production still enumerated by hand, so the
 * guarantee was false until the derived key became the key in use.
 */
function processorCacheKey(analysis: ContentAnalysis, preserveLineBreaks: boolean): string {
  return cacheKeyForMode("document", { ...analysis, preserveLineBreaks });
}

/**
 * Cache of built processors keyed by content-analysis flags. A unified
 * processor is safe to reuse across `.parse()`/`.runSync()` calls once its
 * plugin set is fixed, so caching avoids rebuilding the ~10-plugin pipeline on
 * every parse. Bounded by the conditional-flag combination space — six flags
 * today, so 2^6 = 64 entries, and it tracks the descriptors automatically.
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
  // `source-position` loads every SYNTAX-RECOGNITION plugin unconditionally, so
  // offsets never depend on what the document happens to contain. It excludes
  // the two that would change them — the setext repair and remark-breaks —
  // because its contract is the text as written (see dialectDescriptors.ts).
  return buildProcessorForMode("source-position");
}
