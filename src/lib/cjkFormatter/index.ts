/**
 * CJK Text Formatter
 *
 * Provides formatting rules for CJK (Chinese, Japanese, Korean) text in markdown.
 * Handles spacing, punctuation normalization, quote formatting, and more.
 */

export { formatMarkdown, formatSelection, formatFile } from "./formatter";
export { containsCJK } from "./rules";
export type { CJKFormattingSettings } from "@/stores/settingsStore";
