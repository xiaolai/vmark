/**
 * Markdown Lint Engine — Orchestrator
 *
 * Purpose: Parses markdown via remark (lint-safe mode) and runs all
 * registered rules over the MDAST + raw source text. Returns sorted diagnostics.
 */

import { createMarkdownProcessor } from "@/utils/markdownPipeline/parser";
import type { Root } from "mdast";
import type { LintDiagnostic, LintLineIndex } from "./types";
import { allRules } from "./rules";

const processor = createMarkdownProcessor();

/** Build the per-pass line index: split once, precompute line-start offsets. */
function buildLineIndex(source: string): LintLineIndex {
  const lines = source.split("\n");
  const lineOffsets = new Array<number>(lines.length);
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    lineOffsets[i] = offset;
    offset += lines[i].length + 1; // +1 for the consumed "\n"
  }
  return { lines, lineOffsets };
}

/**
 * Run all lint rules against a markdown source string.
 * Returns diagnostics sorted by position (line, then column).
 */
export function lintMarkdown(source: string): LintDiagnostic[] {
  if (!source.trim()) return [];

  const tree = processor.parse(source) as Root;
  // Run transforms so reference resolution etc. are applied
  const mdast = processor.runSync(tree) as Root;

  // Split source + compute line offsets once, shared by every line-oriented
  // rule (O6 / WI-2.5) instead of each rule re-splitting and recomputing.
  const index = buildLineIndex(source);

  const diagnostics: LintDiagnostic[] = [];

  for (const rule of allRules) {
    diagnostics.push(...rule(source, mdast, index));
  }

  diagnostics.sort((a, b) => a.line - b.line || a.column - b.column);

  return diagnostics;
}
