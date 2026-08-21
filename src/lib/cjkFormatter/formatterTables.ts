/**
 * GFM table recognition and cell-wise formatting.
 *
 * Purpose: a table must be formatted CELL BY CELL, never line by line. The
 * delimiter row is structure and has to survive verbatim, a pipe inside inline
 * code is not a cell boundary, and a cell's padding is the author's alignment.
 *
 * Split out of formatter.ts, which owns the pipeline. `formatCell` is INJECTED
 * rather than imported so the two modules do not depend on each other — the
 * pipeline drives the tables, not the other way round.
 *
 * @coordinates-with formatter.ts — formatMarkdown drives these
 * @coordinates-with @/utils/tableParser — splitTableCells knows about inline code
 * @module lib/cjkFormatter/formatterTables
 */

import type { CJKFormattingSettings, FormatOptions } from "./types";
import { splitTableCells } from "@/utils/tableParser";

export interface TableBlock {
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
    // split(/(\r?\n)/) always produces defined odd-indexed chunks; ?? "" is a defensive guard
    /* v8 ignore next -- @preserve reason: split result chunks[i] is always defined at even indices */
    const lineText = chunks[i] ?? "";
    /* v8 ignore next -- @preserve reason: chunks[i+1] is undefined only when there is no trailing newline, handled as empty string */
    const lineBreak = chunks[i + 1] ?? "";
    lines.push({ start: offset, text: lineText, lineBreak });
    offset += lineText.length + lineBreak.length;
  }

  return lines;
}

function splitBlockquotePrefix(line: string): { prefix: string; content: string } {
  const match = line.match(/^(\s*(?:>\s*)*)/);
  // Regex /^(\s*(?:>\s*)*)/ always matches (anchored ^, group 1 always captures); ?? "" is unreachable
  /* v8 ignore next -- @preserve reason: regex always matches and group 1 is always defined */
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
  return splitTableCells(content).length > 1;
}

export function detectTableBlocks(text: string, protectedRegions: Array<{ start: number; end: number }>): TableBlock[] {
  const lines = splitLines(text);
  const blocks: TableBlock[] = [];

  let i = 0;
  // The last line already claimed by an emitted block. A row that is already a
  // table BODY row cannot also be the header of a new table — and when it was
  // allowed to be, the two blocks OVERLAPPED and `formatMarkdown` emitted the
  // overlap twice, silently duplicating the user's content. Reproduction:
  // header / delimiter / body / delimiter, where the trailing delimiter row
  // claimed the body row above it as its header (WI-CJKF6.1 found this).
  let claimedThroughLine = -1;
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

    // Header row must exist on previous line with same prefix, and must not
    // already belong to a block.
    if (i === 0 || i - 1 <= claimedThroughLine) {
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
    claimedThroughLine = endLine;
    i = endLine + 1;
  }

  return blocks;
}

export function formatTableBlock(
  tableText: string,
  config: CJKFormattingSettings,
  options: FormatOptions,
  /**
   * How to format a cell's contents. INJECTED rather than imported, so this
   * module and formatter.ts do not depend on each other: the pipeline drives
   * the tables, not the other way round.
   */
  formatCell: (text: string, config: CJKFormattingSettings, options: FormatOptions) => string
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
      const cells = splitTableCells(content);
      if (cells.length <= 1) return line.text + line.lineBreak;

      const nextCells = cells.map((cell) => {
        const match = cell.match(/^(\s*)([\s\S]*?)(\s*)$/);
        // Regex /^(\s*)([\s\S]*?)(\s*)$/ always matches any string; all groups are always defined
        /* v8 ignore next -- @preserve reason: regex always matches any string, leading ?? "" fallback is unreachable */
        const leading = match?.[1] ?? "";
        /* v8 ignore next -- @preserve reason: regex always matches any string, core ?? cell fallback is unreachable */
        const core = match?.[2] ?? cell;
        /* v8 ignore next -- @preserve reason: regex always matches any string, trailing ?? "" fallback is unreachable */
        const trailing = match?.[3] ?? "";

        const formatted = formatCell(core, config, options);
        // Safety: formatting must not introduce line breaks inside a table cell.
        const safe = formatted.replace(/\r?\n/g, "");
        return `${leading}${safe}${trailing}`;
      });

      return `${prefix}${nextCells.join("|")}${line.lineBreak}`;
    })
    .join("");
}
