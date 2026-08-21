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

import type { CJKFormattingSettings, FormatOptions, ProtectedRegion } from "./types";
import { findProtectedRegions } from "./markdownParser";
import {
  extractFormattableSegments,
  reconstructText,
  type TextSegment,
} from "./segments";
import { applyRules } from "./rules";
import { verifyIntegrity } from "./integrity";
import { detectTableBlocks, formatTableBlock } from "./formatterTables";
import { cjkFmtWarn } from "@/utils/debug";

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
): FormatResult {
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

      out += formatTableBlock(
        text.slice(block.start, block.end),
        config,
        options,
        formatMarkdownWithoutTables
      );
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
