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

interface TableBlock {
  start: number;
  end: number;
}

interface LineInfo {
  start: number;
  text: string;
  lineBreak: string;
}

function isInsideRegion(pos: number, regions: Array<{ start: number; end: number }>): boolean {
  return regions.some((r) => pos >= r.start && pos < r.end);
}

function splitLines(text: string): LineInfo[] {
  const chunks = text.split(/(\r?\n)/);
  const lines: LineInfo[] = [];
  let offset = 0;

  for (let i = 0; i < chunks.length; i += 2) {
    const lineText = chunks[i] ?? "";
    const lineBreak = chunks[i + 1] ?? "";
    lines.push({ start: offset, text: lineText, lineBreak });
    offset += lineText.length + lineBreak.length;
  }

  return lines;
}

function splitBlockquotePrefix(line: string): { prefix: string; content: string } {
  const match = line.match(/^(\s*(?:>\s*)*)/);
  const prefix = match?.[1] ?? "";
  return { prefix, content: line.slice(prefix.length) };
}

function isTableDelimiterRow(content: string): boolean {
  // GFM alignment row, with optional leading/trailing pipes.
  // Examples:
  // | --- | :---: | ---: |
  // --- | --- | ---
  return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(content);
}

function hasPipeOutsideCode(content: string): boolean {
  return splitTableRowCells(content).cells.length > 1;
}

function detectTableBlocks(text: string, protectedRegions: Array<{ start: number; end: number }>): TableBlock[] {
  const lines = splitLines(text);
  const blocks: TableBlock[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const { prefix, content } = splitBlockquotePrefix(line.text);

    if (isInsideRegion(line.start, protectedRegions)) {
      i += 1;
      continue;
    }

    if (!isTableDelimiterRow(content)) {
      i += 1;
      continue;
    }

    // Header row must exist on previous line with same prefix.
    if (i === 0) {
      i += 1;
      continue;
    }

    const header = lines[i - 1];
    const headerSplit = splitBlockquotePrefix(header.text);
    if (headerSplit.prefix !== prefix) {
      i += 1;
      continue;
    }

    if (isInsideRegion(header.start, protectedRegions)) {
      i += 1;
      continue;
    }

    // Require pipes (outside inline code) in header row.
    if (!hasPipeOutsideCode(headerSplit.content)) {
      i += 1;
      continue;
    }

    // Scan forward for body rows (same prefix, contains pipes, not blank).
    let endLine = i; // include delimiter row
    let j = i + 1;
    while (j < lines.length) {
      const bodyLine = lines[j];
      const bodySplit = splitBlockquotePrefix(bodyLine.text);
      if (bodySplit.prefix !== prefix) break;
      if (bodySplit.content.trim().length === 0) break;
      if (isInsideRegion(bodyLine.start, protectedRegions)) break;
      if (!hasPipeOutsideCode(bodySplit.content)) break;
      if (isTableDelimiterRow(bodySplit.content)) break;
      endLine = j;
      j += 1;
    }

    const start = header.start;
    const endLineInfo = lines[endLine];
    const end = endLineInfo.start + endLineInfo.text.length + endLineInfo.lineBreak.length;

    blocks.push({ start, end });
    i = endLine + 1;
  }

  return blocks;
}

function splitTableRowCells(content: string): { cells: string[] } {
  const cells: string[] = [];
  let cellStart = 0;
  let escaped = false;
  let inCode = false;
  let codeFenceLen = 0;

  for (let i = 0; i < content.length; i += 1) {
    const ch = content[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      escaped = true;
      continue;
    }

    if (ch === "`") {
      // Count backticks in a run.
      let runLen = 1;
      while (i + runLen < content.length && content[i + runLen] === "`") runLen += 1;

      if (!inCode) {
        inCode = true;
        codeFenceLen = runLen;
      } else if (runLen === codeFenceLen) {
        inCode = false;
        codeFenceLen = 0;
      }

      i += runLen - 1;
      continue;
    }

    if (ch === "|" && !inCode) {
      cells.push(content.slice(cellStart, i));
      cellStart = i + 1;
    }
  }

  cells.push(content.slice(cellStart));
  return { cells };
}

function formatMarkdownWithoutTables(
  text: string,
  config: CJKFormattingSettings,
  options: { preserveTwoSpaceHardBreaks?: boolean } = {}
): string {
  const protectedRegions = findProtectedRegions(text);
  const segments = extractFormattableSegments(text, protectedRegions);
  const formattedSegments: TextSegment[] = segments.map((segment) => ({
    ...segment,
    text: applyRules(segment.text, config, options),
  }));
  return reconstructText(text, formattedSegments, protectedRegions);
}

function formatTableBlock(
  tableText: string,
  config: CJKFormattingSettings,
  options: { preserveTwoSpaceHardBreaks?: boolean } = {}
): string {
  const lines = splitLines(tableText);

  // Find the delimiter row index (within the block).
  // The block is header + delimiter + body; delimiter is the first line that matches.
  let delimiterIndex = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const split = splitBlockquotePrefix(lines[i].text);
    if (isTableDelimiterRow(split.content)) {
      delimiterIndex = i;
      break;
    }
  }

  return lines
    .map((line, idx) => {
      if (idx === delimiterIndex) return line.text + line.lineBreak;

      const { prefix, content } = splitBlockquotePrefix(line.text);
      const { cells } = splitTableRowCells(content);
      if (cells.length <= 1) return line.text + line.lineBreak;

      const nextCells = cells.map((cell) => {
        const match = cell.match(/^(\s*)([\s\S]*?)(\s*)$/);
        const leading = match?.[1] ?? "";
        const core = match?.[2] ?? cell;
        const trailing = match?.[3] ?? "";

        const formatted = formatMarkdownWithoutTables(core, config, options);
        // Safety: formatting must not introduce line breaks inside a table cell.
        const safe = formatted.replace(/\r?\n/g, "");
        return `${leading}${safe}${trailing}`;
      });

      return `${prefix}${nextCells.join("|")}${line.lineBreak}`;
    })
    .join("");
}

/**
 * Format markdown text with CJK typography rules.
 * Preserves code blocks, URLs, frontmatter, and other protected regions.
 */
export function formatMarkdown(
  text: string,
  config: CJKFormattingSettings,
  options: { preserveTwoSpaceHardBreaks?: boolean } = {}
): string {
  // Detect table blocks first so we can format table cells without breaking table structure.
  // We must not treat pipes in code as delimiters, and must not rewrite the delimiter row.
  const protectedRegions = findProtectedRegions(text);
  const tableBlocks = detectTableBlocks(text, protectedRegions);
  if (tableBlocks.length === 0) {
    return formatMarkdownWithoutTables(text, config, options);
  }

  let out = "";
  let cursor = 0;

  for (const block of tableBlocks) {
    if (block.start > cursor) {
      out += formatMarkdownWithoutTables(text.slice(cursor, block.start), config, options);
    }

    out += formatTableBlock(text.slice(block.start, block.end), config, options);
    cursor = block.end;
  }

  if (cursor < text.length) {
    out += formatMarkdownWithoutTables(text.slice(cursor), config, options);
  }

  return out;
}

/**
 * Format a selection of text (assumes no markdown structure to preserve)
 */
export function formatSelection(
  text: string,
  config: CJKFormattingSettings,
  options: { preserveTwoSpaceHardBreaks?: boolean } = {}
): string {
  return applyRules(text, config, options);
}

/**
 * Format entire file content
 */
export function formatFile(
  content: string,
  config: CJKFormattingSettings,
  options: { preserveTwoSpaceHardBreaks?: boolean } = {}
): string {
  return formatMarkdown(content, config, options);
}
