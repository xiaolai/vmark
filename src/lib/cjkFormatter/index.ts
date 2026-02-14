/**
 * CJK Text Formatter — Barrel Export
 *
 * Purpose: Provides formatting rules for CJK (Chinese, Japanese, Korean) text in markdown.
 * Handles spacing between CJK and Latin characters, punctuation normalization,
 * quote pairing (fullwidth), and trailing whitespace cleanup.
 *
 * Architecture:
 *   formatter.ts — orchestrates the pipeline (parse → segment → rules → reconstruct)
 *   markdownParser.ts — identifies protected regions (code, URLs) to skip
 *   rules.ts — individual formatting rules (spacing, punctuation, etc.)
 *   latinSpanScanner.ts — identifies Latin spans within CJK text
 *   quotePairing.ts — matches and converts quote pairs to fullwidth
 *
 * @coordinates-with settingsStore.ts — CJKFormattingSettings controls which rules are active
 * @coordinates-with menu_events.rs — "format-cjk" menu item triggers formatFile
 * @module lib/cjkFormatter
 */

export { formatMarkdown, formatSelection, formatFile } from "./formatter";
export { containsCJK, removeTrailingSpaces, collapseNewlines } from "./rules";
export type { CJKFormattingSettings } from "@/stores/settingsStore";
