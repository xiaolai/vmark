/**
 * Main CJK Text Formatter
 * Formats markdown text while preserving code blocks, URLs, and other protected regions.
 */

import type { CJKFormattingSettings } from "@/stores/settingsStore";
import {
  findProtectedRegions,
  extractFormattableSegments,
  reconstructText,
  type TextSegment,
} from "./markdownParser";
import { applyRules } from "./rules";

/**
 * Format markdown text with CJK typography rules.
 * Preserves code blocks, URLs, frontmatter, and other protected regions.
 */
export function formatMarkdown(
  text: string,
  config: CJKFormattingSettings
): string {
  // Find all protected regions
  const protectedRegions = findProtectedRegions(text);

  // Extract formattable segments
  const segments = extractFormattableSegments(text, protectedRegions);

  // Apply rules to each segment
  const formattedSegments: TextSegment[] = segments.map((segment) => ({
    ...segment,
    text: applyRules(segment.text, config),
  }));

  // Reconstruct the document
  return reconstructText(text, formattedSegments, protectedRegions);
}

/**
 * Format a selection of text (assumes no markdown structure to preserve)
 */
export function formatSelection(
  text: string,
  config: CJKFormattingSettings
): string {
  return applyRules(text, config);
}

/**
 * Format entire file content
 */
export function formatFile(
  content: string,
  config: CJKFormattingSettings
): string {
  return formatMarkdown(content, config);
}
