/**
 * Content-addressed parsing cache.
 *
 * Caches parse results by content hash to avoid re-parsing
 * identical content. Useful for:
 * - Tab switching (same content)
 * - Undo/redo (previous states)
 * - File reload (unchanged)
 *
 * @module utils/markdownPipeline/parsingCache
 */

import type { Schema, Node as PMNode } from "@tiptap/pm/model";
import type { Root } from "mdast";
import { parseMarkdownToMdast } from "./parser";
import {
  parseMarkdownToMdastFast,
  canUseFastParser,
} from "./fastParser";
import { mdastToProseMirror } from "./mdastToProseMirror";
import type { MarkdownPipelineOptions } from "./types";

/**
 * Cache entry with timestamp for LRU eviction.
 */
interface CacheEntry {
  mdast: Root;
  timestamp: number;
}

/**
 * Maximum number of cached entries.
 * Each entry is ~1-5MB for large documents, so keep this conservative.
 */
const MAX_CACHE_SIZE = 20;

/**
 * Minimum content size to cache (in characters).
 * Don't cache tiny documents - parsing is fast enough.
 */
const MIN_CACHE_SIZE = 5000;

/**
 * LRU cache for parsed MDAST.
 */
const mdastCache = new Map<string, CacheEntry>();

/**
 * Simple hash function for content-addressed caching.
 * Uses FNV-1a algorithm for fast, reasonable distribution.
 */
function hashContent(content: string, options: MarkdownPipelineOptions): string {
  // Include options in hash to differentiate parse modes
  const key = `${content}:${options.preserveLineBreaks ? "1" : "0"}`;

  let hash = 2166136261; // FNV offset basis
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = (hash * 16777619) >>> 0; // FNV prime, keep as 32-bit
  }
  return hash.toString(16);
}

/**
 * Evict oldest entries if cache is full.
 */
function evictIfNeeded(): void {
  if (mdastCache.size < MAX_CACHE_SIZE) return;

  // Find oldest entry
  let oldestKey: string | null = null;
  let oldestTime = Infinity;

  for (const [key, entry] of mdastCache) {
    if (entry.timestamp < oldestTime) {
      oldestTime = entry.timestamp;
      oldestKey = key;
    }
  }

  if (oldestKey) {
    mdastCache.delete(oldestKey);
  }
}

/**
 * Parse markdown to MDAST with caching.
 * Returns cached result if available, otherwise parses and caches.
 *
 * @param markdown - The markdown string to parse
 * @param options - Pipeline options
 * @returns The MDAST root node
 */
export function parseMarkdownToMdastCached(
  markdown: string,
  options: MarkdownPipelineOptions = {}
): Root {
  // Don't cache tiny documents
  if (markdown.length < MIN_CACHE_SIZE) {
    // Use fast parser for standard markdown, remark for special syntax
    return canUseFastParser(markdown)
      ? parseMarkdownToMdastFast(markdown)
      : parseMarkdownToMdast(markdown, options);
  }

  const hash = hashContent(markdown, options);

  // Check cache
  const cached = mdastCache.get(hash);
  if (cached) {
    // Update timestamp for LRU
    cached.timestamp = Date.now();
    return cached.mdast;
  }

  // Parse and cache - use fast parser when applicable
  const mdast = canUseFastParser(markdown)
    ? parseMarkdownToMdastFast(markdown)
    : parseMarkdownToMdast(markdown, options);

  evictIfNeeded();
  mdastCache.set(hash, {
    mdast,
    timestamp: Date.now(),
  });

  return mdast;
}

/**
 * Parse markdown to ProseMirror document with caching.
 *
 * @param schema - The ProseMirror schema
 * @param markdown - The markdown string to parse
 * @param options - Pipeline options
 * @returns ProseMirror document node
 */
export function parseMarkdownCached(
  schema: Schema,
  markdown: string,
  options: MarkdownPipelineOptions = {}
): PMNode {
  const safeMarkdown = markdown ?? "";
  const mdast = parseMarkdownToMdastCached(safeMarkdown, options);
  return mdastToProseMirror(schema, mdast);
}

/**
 * Get cache statistics for debugging/monitoring.
 */
export function getCacheStats(): {
  size: number;
  maxSize: number;
  hitRate: number;
} {
  return {
    size: mdastCache.size,
    maxSize: MAX_CACHE_SIZE,
    hitRate: 0, // Would need to track hits/misses for this
  };
}

/**
 * Clear the cache.
 * Useful for testing or when memory pressure is detected.
 */
export function clearCache(): void {
  mdastCache.clear();
}

/**
 * Pre-warm the cache with content.
 * Useful when opening multiple tabs at once.
 *
 * @param contents - Array of markdown strings to pre-parse
 * @param options - Pipeline options
 */
export function prewarmCache(
  contents: string[],
  options: MarkdownPipelineOptions = {}
): void {
  for (const content of contents) {
    if (content.length >= MIN_CACHE_SIZE) {
      parseMarkdownToMdastCached(content, options);
    }
  }
}
