/**
 * CJK Text Formatter — Barrel Export
 *
 * Purpose: Provides formatting rules for CJK (Chinese, Japanese, Korean) text in markdown.
 * Handles spacing between CJK and Latin characters, punctuation normalization,
 * quote pairing (fullwidth), and trailing whitespace cleanup.
 *
 * Architecture:
 *   formatter.ts — orchestrates the pipeline (parse → segment → rules → reconstruct).
 *     `formatMarkdown` is the ONLY entry point: a selection is a document slice,
 *     so it gets the same protection a whole file does (WI-CJKF1.1).
 *   markdownParser.ts — identifies protected regions (code, URLs, reference sections) to skip
 *   segments.ts — extracts formattable segments and reconstructs text around protected regions
 *   rules.ts — individual formatting rules (spacing, punctuation, etc.)
 *   latinSpanScanner.ts — identifies Latin spans within CJK text
 *   quotePairing.ts — matches and converts quote pairs to fullwidth
 *   integrity.ts — post-format structural integrity verification
 *
 * @coordinates-with settingsStore.ts — CJKFormattingSettings controls which rules are active
 * @coordinates-with menu_events.rs — "format-cjk" menu item triggers formatMarkdown
 * @module lib/cjkFormatter
 */

export { formatMarkdown } from "./formatter";
export { removeTrailingSpaces, collapseNewlines } from "./rules";
