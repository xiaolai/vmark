/**
 * Export Naming Utilities
 *
 * Utilities for determining default folder names when exporting documents.
 * Extracts titles from markdown and sanitizes for filesystem use.
 *
 * @coordinates-with utils/pathUtils.ts — the filename fallback
 * @coordinates-with utils/truncateText.ts — the character-safe length cut
 * @module utils/exportNaming
 */
import { getFileNameWithoutExtension } from "./pathUtils";
import { truncateToLength } from "./truncateText";

/**
 * Characters invalid in file/folder names across platforms.
 * - Windows: / \ : * ? " < > |
 * - macOS/Linux: / and null
 * We sanitize for all platforms to ensure portability.
 */
// eslint-disable-next-line no-control-regex -- C0 controls are invalid in file names on every platform; matching them is the purpose
const INVALID_FILENAME_CHARS = /[/\\:*?"<>|\u0000-\u001f]/g;

/**
 * Windows reserved names that cannot be used as file/folder names.
 * Case-insensitive: CON, con, Con are all reserved.
 */
const WINDOWS_RESERVED_NAMES = new Set([
  "CON", "PRN", "AUX", "NUL",
  "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
  "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
]);

/**
 * Default maximum length for sanitized file names.
 * Most filesystems support 255 bytes, but we use a conservative limit
 * to account for multi-byte characters and path length limits.
 */
const DEFAULT_MAX_LENGTH = 80;

/**
 * When truncating at word boundary, how many characters back from the
 * max length to search for a space. Prevents awkward single-word truncation.
 */
const WORD_BOUNDARY_LOOKBACK = 20;

/**
 * Extract the first H1 heading from markdown content.
 *
 * Supports two H1 syntaxes:
 * 1. ATX style: `# Heading`
 * 2. Setext style: `Heading\n======`
 *
 * @param markdown - The markdown content
 * @returns The H1 text (trimmed) or null if no H1 found
 *
 * @example
 * extractFirstH1("# My Document\n\nContent") // "My Document"
 * extractFirstH1("Title\n===\n\nContent") // "Title"
 * extractFirstH1("## Only H2") // null
 */
export function extractFirstH1(markdown: string): string | null {
  if (!markdown || typeof markdown !== "string") {
    return null;
  }

  // ATX style: # Heading (must be at start of line)
  // Allows optional closing hashes: # Heading #
  const atxMatch = markdown.match(/^#\s+(.+?)(?:\s+#+)?$/m);
  if (atxMatch) {
    const title = atxMatch[1].trim();
    return title || null;
  }

  // Setext style: Heading\n======= (at least 1 equals sign)
  // The heading text must not be empty and must be on its own line
  const setextMatch = markdown.match(/^([^\n]+)\n=+\s*$/m);
  if (setextMatch) {
    const title = setextMatch[1].trim();
    // Ensure it's not a thematic break or other syntax
    if (title && !title.match(/^[-=_*#>]/)) {
      return title;
    }
  }

  return null;
}

/**
 * Sanitize a string for use as a file or folder name.
 *
 * Operations performed:
 * 1. Remove null bytes and control characters
 * 2. Convert tabs/newlines to spaces
 * 3. Replace invalid filesystem characters with dashes
 * 4. Remove leading/trailing dots (Windows issue)
 * 5. Remove leading/trailing whitespace
 * 6. Collapse multiple spaces/dashes
 * 7. Truncate to max length (at a word boundary if possible, never mid-character)
 * 8. Handle Windows reserved names
 *
 * @param name - The raw name to sanitize
 * @param maxLength - Maximum length (default: 80)
 * @returns Sanitized name safe for filesystem use
 *
 * @example
 * sanitizeFileName("What/Why?") // "What-Why"
 * sanitizeFileName("  Spaces  ") // "Spaces"
 * sanitizeFileName("CON") // "CON_export"
 */
export function sanitizeFileName(
  name: string,
  maxLength: number = DEFAULT_MAX_LENGTH
): string {
  if (!name || typeof name !== "string") {
    return "";
  }

  let result = name
    // Remove null bytes completely (they're never valid)
    // eslint-disable-next-line no-control-regex -- NUL is matched on purpose: it is never valid in a file name
    .replace(/\u0000/g, "")
    // Convert tabs and newlines to spaces (they're whitespace, not invalid)
    .replace(/[\t\r\n]/g, " ")
    // Remove other control characters
    // eslint-disable-next-line no-control-regex -- the remaining C0 controls and DEL are matched on purpose to strip them
    .replace(/[\u0001-\u001f\u007f]/g, "")
    // Replace invalid filesystem characters with dash
    .replace(INVALID_FILENAME_CHARS, "-")
    // Remove leading dots (hidden files on Unix, problematic on Windows)
    .replace(/^\.+/, "")
    // Remove trailing dots (Windows doesn't like these)
    .replace(/\.+$/, "")
    // Collapse multiple dashes
    .replace(/-+/g, "-")
    // Collapse multiple spaces
    .replace(/\s+/g, " ")
    // Remove leading/trailing dashes
    .replace(/^-+|-+$/g, "")
    // Final trim
    .trim();

  // Truncate if too long
  if (result.length > maxLength) {
    result = truncateAtWordBoundary(result, maxLength);
  }

  // Handle Windows reserved names
  if (WINDOWS_RESERVED_NAMES.has(result.toUpperCase())) {
    result = `${result}_export`;
  }

  // Handle reserved names with extensions (e.g., "CON.txt")
  const baseName = result.split(".")[0].toUpperCase();
  if (WINDOWS_RESERVED_NAMES.has(baseName) && result.includes(".")) {
    result = `${result}_export`;
  }

  return result;
}

/**
 * Truncate a string that is longer than `maxLength`, at a word boundary where
 * one is close, and never inside a character.
 *
 * @param text - The text to truncate; the caller has checked it is too long
 * @param maxLength - Maximum length, in UTF-16 code units
 * @returns Truncated text
 */
function truncateAtWordBoundary(text: string, maxLength: number): string {
  // Try to find a space within the lookback window of the limit
  const truncated = truncateToLength(text, maxLength);
  const lastSpace = truncated.lastIndexOf(" ");

  if (lastSpace > maxLength - WORD_BOUNDARY_LOOKBACK && lastSpace > 0) {
    return truncated.slice(0, lastSpace).trim();
  }

  // No good word boundary, just truncate and trim
  return truncated.trim();
}

/**
 * Get the default export folder name for a document.
 *
 * Priority:
 * 1. First H1 heading from markdown (sanitized)
 * 2. File name without extension (if file path provided)
 * 3. `fallback`, the caller's translated untitled name (no English default:
 *    a leaf util cannot translate, and a default here reached every locale)
 *
 * @param markdown - The document's markdown content
 * @param filePath - The document's file path (optional)
 * @returns A filesystem-safe folder name
 *
 * @example
 * getExportFolderName("# My Doc", "/path/to/file.md", "Untitled") // "My Doc"
 * getExportFolderName("No heading", "/path/to/notes.md", "Untitled") // "notes"
 * getExportFolderName("No heading", null, "未命名") // "未命名"
 */
export function getExportFolderName(
  markdown: string,
  filePath: string | null | undefined,
  fallback: string
): string {
  // Try H1 first
  const h1 = extractFirstH1(markdown);
  if (h1) {
    const sanitized = sanitizeFileName(h1);
    if (sanitized) {
      return sanitized;
    }
  }

  // Fall back to file name
  if (filePath) {
    const fileName = getFileNameWithoutExtension(filePath);
    if (fileName) {
      const sanitized = sanitizeFileName(fileName);
      if (sanitized) {
        return sanitized;
      }
    }
  }

  // Final fallback
  return fallback;
}

/**
 * Strip inline markdown formatting from text.
 * Converts markdown to plain text for use in filenames.
 *
 * Handles: **bold**, *italic*, __bold__, _italic_, ~~strikethrough~~,
 * `code`, [links](url), ![images](url)
 *
 * @param text - Text potentially containing markdown formatting
 * @returns Plain text with formatting removed
 */
function stripInlineMarkdown(text: string): string {
  return text
    // Remove images first (before links) ![alt](url) or ![alt][ref]
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/!\[([^\]]*)\]\[[^\]]*\]/g, "$1")
    // Remove links [text](url) or [text][ref] - keep the text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")
    // Remove inline code `code`
    .replace(/`([^`]+)`/g, "$1")
    // Remove bold/italic (order matters: ** before *, __ before _)
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    // Remove strikethrough ~~text~~
    .replace(/~~([^~]+)~~/g, "$1")
    // Clean up any double spaces left behind
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Get the default filename for the save dialog.
 *
 * Used when saving a new/untitled file. Tries to derive a meaningful
 * filename from the document content's H1 heading.
 *
 * Priority:
 * 1. First H1 heading from content (markdown stripped, then sanitized)
 * 2. Tab title (if provided and non-empty)
 * 3. `fallback`, the caller's translated untitled name (as above)
 *
 * @param content - The document's markdown content
 * @param tabTitle - The current tab title (e.g., "Untitled-1")
 * @returns A filesystem-safe filename (without extension)
 *
 * @example
 * getSaveFileName("# My Document", "Untitled-1", "Untitled") // "My Document"
 * getSaveFileName("# **Bold** Title", "Untitled-1", "Untitled") // "Bold Title"
 * getSaveFileName("No heading", "Untitled-1", "Untitled") // "Untitled-1"
 * getSaveFileName("No heading", "", "Sans titre") // "Sans titre"
 */
export function getSaveFileName(content: string, tabTitle: string, fallback: string): string {
  // Try H1 first
  const h1 = extractFirstH1(content);
  if (h1) {
    // Strip inline markdown formatting before sanitizing for filesystem
    const plainText = stripInlineMarkdown(h1);
    const sanitized = sanitizeFileName(plainText);
    if (sanitized) {
      return sanitized;
    }
  }

  // Fall back to tab title
  if (tabTitle) {
    return tabTitle;
  }

  // Final fallback
  return fallback;
}
