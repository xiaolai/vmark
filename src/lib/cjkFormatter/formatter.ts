/**
 * Main CJK Text Formatter
 *
 * Purpose: Formats markdown text while preserving code blocks, URLs, tables,
 * and other protected regions. Orchestrates the formatting pipeline:
 * parse → segment → apply rules → reconstruct.
 *
 * Key decisions:
 *   - Tables are handled cell-by-cell (not line-by-line) to preserve alignment
 *   - Protected regions (code, URLs, inline math) are identified first and
 *     excluded from formatting to prevent corruption
 *   - File-level formatting includes trailing whitespace and newline cleanup
 *   - There is ONE entry point. A selection is a slice of the document, so it
 *     needs the same protection a file does; the separate unprotected
 *     `formatSelection` was deleted (WI-CJKF1.1) after it was found rewriting
 *     fenced code and YAML frontmatter on a plain select-all.
 *   - Post-format integrity check verifies structural patterns survived;
 *     returns original text on mismatch (defense-in-depth)
 *
 * @coordinates-with markdownParser.ts — identifies protected regions
 * @coordinates-with segments.ts — extracts formattable segments and reconstructs text
 * @coordinates-with rules.ts — contains the actual CJK formatting rules
 * @coordinates-with integrity.ts — post-format integrity verification
 * @module lib/cjkFormatter/formatter
 */

import type { CJKFormattingSettings, FormatOptions } from "./types";
import { findProtectedRegions, type ProtectedRegion } from "./markdownParser";
import {
  extractFormattableSegments,
  reconstructText,
  type TextSegment,
} from "./segments";
import { applyRules } from "./rules";
import { splitTableCells } from "@/utils/tableParser";
import { verifyIntegrity } from "./integrity";
import { cjkFmtWarn } from "@/utils/debug";

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

function detectTableBlocks(text: string, protectedRegions: Array<{ start: number; end: number }>): TableBlock[] {
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

function formatMarkdownWithoutTables(
  text: string,
  config: CJKFormattingSettings,
  options: FormatOptions = {},
  /**
   * Regions already computed for exactly this `text`, if the caller has them.
   *
   * `formatMarkdown` scans for regions to find table blocks and then called
   * this, which scanned the identical string a second time — half the
   * region work in a document with no tables, and region scanning is the
   * dominant cost on a large one. The table path cannot reuse them: it passes
   * SLICES, whose offsets do not match (WI-CJKF7.3).
   */
  precomputedRegions?: ProtectedRegion[]
): string {
  const protectedRegions =
    precomputedRegions ??
    findProtectedRegions(text, {
      skipReferenceSections: config.skipReferenceSections,
    });
  const segments = extractFormattableSegments(text, protectedRegions);
  const formattedSegments: TextSegment[] = segments.map((segment) => ({
    ...segment,
    // The segment's own line edges override the caller's: a segment boundary
    // is not a line boundary, and the line-anchored rules are wrong without
    // that distinction (WI-CJKF2.1).
    text: applyRules(segment.text, config, {
      ...options,
      startsAtLineStart: segment.startsAtLineStart,
      endsAtLineEnd: segment.endsAtLineEnd,
    }),
  }));
  return reconstructText(text, formattedSegments, protectedRegions);
}

function formatTableBlock(
  tableText: string,
  config: CJKFormattingSettings,
  options: FormatOptions = {}
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
 * What a format run did, for callers that need to tell a REFUSAL apart from
 * "nothing needed changing".
 *
 * Both return the input text, and before WI-CJKF6.2 nothing could distinguish
 * them: a failed integrity check logged to the log file and the user saw the
 * accelerator do nothing at all.
 */
export interface FormatResult {
  text: string;
  /** The integrity check failed; `text` is the ORIGINAL, deliberately. */
  refused: boolean;
}

/**
 * Format markdown text with CJK typography rules, reporting whether the
 * integrity check refused the result.
 *
 * Preserves code blocks, URLs, frontmatter, and other protected regions.
 */
export function formatMarkdownChecked(
  text: string,
  config: CJKFormattingSettings,
  options: FormatOptions = {}
): string {
  // Detect table blocks first so we can format table cells without breaking table structure.
  // We must not treat pipes in code as delimiters, and must not rewrite the delimiter row.
  const protectedRegions = findProtectedRegions(text, {
    skipReferenceSections: config.skipReferenceSections,
  });
  const tableBlocks = detectTableBlocks(text, protectedRegions);

  let out: string;

  if (tableBlocks.length === 0) {
    out = formatMarkdownWithoutTables(text, config, options, protectedRegions);
  } else {
    out = "";
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
  }

  // Final cleanup: trim trailing whitespace, then put the document's single
  // final newline back (WI-CJKF2.4). Trailing backslashes are kept — a literal
  // backslash at EOF (e.g. a Windows path) is legitimate content, and a
  // hard-break backslash at EOF is harmless.
  //
  // The trim alone was a real cost: nothing downstream restores the newline
  // (`saveToPath` writes what the buffer holds), so every "Format CJK File"
  // stripped the POSIX terminator and put `\ No newline at end of file` into
  // the user's next git diff. The terminator is echoed in the document's own
  // convention so a CRLF file does not silently acquire a lone LF, and an
  // all-whitespace document stays empty rather than being handed a newline it
  // never had.
  const trailingNewline = /(\r?\n)[\s]*$/.exec(out)?.[1] ?? "";
  out = out.trimEnd();
  if (out.length > 0) out += trailingNewline;

  // Integrity check: verify structural patterns survived formatting.
  // If any pattern count changed, the parser has a bug — return original text.
  const integrity = verifyIntegrity(text, out);
  if (!integrity.ok) {
    cjkFmtWarn("Integrity check failed, returning original text:", integrity.details);
    return { text, refused: true };
  }

  return { text: out, refused: false };
}

/**
 * Format markdown text with CJK typography rules.
 *
 * The convenience wrapper over `formatMarkdownChecked` for callers with
 * nothing to report to.
 */
export function formatMarkdown(
  text: string,
  config: CJKFormattingSettings,
  options: FormatOptions = {}
): string {
  return formatMarkdownChecked(text, config, options).text;
}

// There is deliberately no `formatSelection` here (WI-CJKF1.1).
//
// It was `applyRules` with no protected-region parsing and no integrity check,
// documented as "assumes no markdown structure to preserve". Nothing can
// establish that assumption: its only caller handed it a SLICE OF THE
// DOCUMENT, so it was routinely given code fences and frontmatter and rewrote
// them. Every caller now passes its span to `formatMarkdown`, which is built
// to take exactly that. `scripts/check-deleted-names.mjs` refuses the name so
// the unprotected variant cannot be reintroduced.
