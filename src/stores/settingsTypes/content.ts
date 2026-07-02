/**
 * Content settings types — media rendering, markdown editing behavior,
 * paste/copy handling, and image management.
 *
 * Extracted from settingsTypes.ts, which remains the stable entry point.
 *
 * @module stores/settingsTypes/content
 */

import type { HardBreakStyleOnSave } from "@/utils/linebreakDetection";
import type { HtmlAllowlistLevel } from "@/utils/htmlAllowlists";
import type { AutoPairCJKStyle } from "./cjk";

// ---------------------------------------------------------------------------
// Media & Content
// ---------------------------------------------------------------------------

/** Border style for images and diagrams: none, always visible, or on hover. */
export type MediaBorderStyle = "none" | "always" | "hover";
/** Alignment for block images and tables. */
export type MediaAlignment = "left" | "center";
/** Alignment for headings. */
export type HeadingAlignment = "left" | "center";
/** Relative font size for lists, blockquotes, and tables (1 = 100%). */
export type BlockFontSize = "0.85" | "0.9" | "0.95" | "1";

/** How raw HTML blocks are rendered in WYSIWYG mode. */
export type HtmlRenderingMode = "hidden" | "sanitized" | "sanitizedWithStyles";

/** Whether pasted markdown is converted to rich text in WYSIWYG mode. */
export type MarkdownPasteMode = "auto" | "off";

/**
 * Paste mode determines how clipboard content is processed:
 * - "smart": Convert HTML to Markdown, detect markdown syntax (default)
 * - "plain": Always paste as plain text
 * - "rich": Keep Tiptap's default HTML handling
 */
export type PasteMode = "smart" | "plain" | "rich";

/** What to put in text/plain on copy: "default" (plain text) or "markdown" (markdown syntax). */
export type CopyFormat = "default" | "markdown";

// ---------------------------------------------------------------------------
// Markdown Settings
// ---------------------------------------------------------------------------

/** Markdown editing behavior — line breaks, paste handling, auto-pair, and copy format. */
export interface MarkdownSettings {
  preserveLineBreaks: boolean; // Don't collapse blank lines
  showBrTags: boolean; // Display <br> tags visibly
  // Render invisible chars (spaces, tabs, breaks); Source only; off by default.
  showInvisibles: boolean;
  codeBlockLineNumbers: boolean; // WYSIWYG per-code-block gutter; independent of the source gutter / View menu (#1082)
  enableRegexSearch: boolean; // Enable regex in Find & Replace
  pasteMarkdownInWysiwyg: MarkdownPasteMode; // Convert pasted markdown into rich text
  pasteMode: PasteMode; // How to handle clipboard content (smart/plain/rich)
  mediaBorderStyle: MediaBorderStyle; // Border style for images and diagrams
  mediaAlignment: MediaAlignment; // Alignment for block images and tables
  headingAlignment: HeadingAlignment; // Alignment for headings
  blockFontSize: BlockFontSize; // Font size for lists, blockquotes, tables, etc.
  htmlRenderingMode: HtmlRenderingMode; // Rich text display for raw HTML
  htmlAllowlistLevel: HtmlAllowlistLevel; // Raw HTML tag breadth: strict (default) or extended
  htmlAllowlistCustomTags: string; // Extra allowed tags (comma/space separated, on top of the level)
  hardBreakStyleOnSave: HardBreakStyleOnSave; // Preserve or normalize hard break output
  // Auto-pair
  autoPairEnabled: boolean; // Auto-insert closing brackets/quotes
  autoPairCJKStyle: AutoPairCJKStyle; // CJK bracket pairing style
  autoPairCurlyQuotes: boolean; // Include curly quotes in CJK pairing (may conflict with IME)
  autoPairRightDoubleQuote: boolean; // Typing " also inserts "" pair (IME compat)
  copyFormat: CopyFormat; // What to put in text/plain on copy (default = plain text, markdown = markdown syntax)
  copyOnSelect: boolean; // Auto-copy selected text to clipboard
  tableFitToWidth: boolean; // Force tables to fit editor width (word-wrap cells)
  lintEnabled: boolean; // Run markdown lint checks and show diagnostics
  splitViewByDefault: boolean; // Open markdown in the source/preview split view
}

// ---------------------------------------------------------------------------
// Image Settings
// ---------------------------------------------------------------------------

/** Image auto-resize max dimension in pixels (0 = disabled). */
export type ImageAutoResizeOption = 0 | 800 | 1200 | 1920 | 2560;

/** Image handling preferences — auto-resize and asset management. */
export interface ImageSettings {
  // Auto-resize: max dimension in pixels (0 = disabled)
  autoResizeMax: ImageAutoResizeOption;
  // Whether to copy images to assets folder on paste/drop
  copyToAssets: boolean;
  // Auto-cleanup orphaned images when closing a document
  cleanupOrphansOnClose: boolean;
}
