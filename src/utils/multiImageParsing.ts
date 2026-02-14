/**
 * Multi-Image Path Parsing Utility
 *
 * Purpose: Parses clipboard text that may contain multiple image paths,
 * supporting both newline-separated and shell-style (space with quotes) formats.
 *
 * Key decisions:
 *   - Shell-style parsing handles both single and double quotes
 *   - Newline format takes priority over shell-style when both are present
 *   - mightContainMultiplePaths() is a fast heuristic for filtering before full parse
 *
 * @coordinates-with imageHandler/tiptap.ts — uses parseMultiplePaths for multi-image paste
 * @coordinates-with clipboardImagePath.ts — detects image paths in clipboard
 * @module utils/multiImageParsing
 */

/**
 * Result of parsing multiple paths from text.
 */
export interface ParsedPaths {
  /** Array of parsed paths */
  paths: string[];
  /** Detected format of the input */
  format: "newline" | "shell" | "single";
}

/**
 * Parse shell-style paths with quote handling.
 * Handles both double quotes and single quotes.
 *
 * @example
 * parseShellPaths('/path/one.jpg "/path with spaces/two.png" ~/three.gif')
 * // ['/path/one.jpg', '/path with spaces/two.png', '~/three.gif']
 */
function parseShellPaths(text: string): string[] {
  const paths: string[] = [];
  let current = "";
  let inQuote = false;
  let quoteChar = "";

  for (const char of text) {
    if (!inQuote && (char === '"' || char === "'")) {
      // Start of quoted section
      inQuote = true;
      quoteChar = char;
    } else if (inQuote && char === quoteChar) {
      // End of quoted section
      inQuote = false;
      quoteChar = "";
    } else if (!inQuote && char === " ") {
      // Space outside quotes - delimiter
      if (current.trim()) {
        paths.push(current.trim());
      }
      current = "";
    } else {
      // Regular character
      current += char;
    }
  }

  // Don't forget the last path
  if (current.trim()) {
    paths.push(current.trim());
  }

  return paths;
}

/**
 * Check if text contains unquoted newlines (newline-separated format).
 */
function hasUnquotedNewlines(text: string): boolean {
  let inQuote = false;
  let quoteChar = "";

  for (const char of text) {
    if (!inQuote && (char === '"' || char === "'")) {
      inQuote = true;
      quoteChar = char;
    } else if (inQuote && char === quoteChar) {
      inQuote = false;
      quoteChar = "";
    } else if (!inQuote && char === "\n") {
      return true;
    }
  }

  return false;
}

/**
 * Parse text that may contain multiple image paths.
 *
 * Supports two formats:
 * 1. Newline-separated: One path per line
 * 2. Shell-style: Space-separated with optional quotes for paths with spaces
 *
 * @param text - The clipboard text to parse
 * @returns Parsed paths and detected format
 *
 * @example
 * // Newline-separated
 * parseMultiplePaths('/path/to/image1.jpg\n/path/to/image2.png')
 * // { paths: ['/path/to/image1.jpg', '/path/to/image2.png'], format: 'newline' }
 *
 * @example
 * // Shell-style (macOS Finder)
 * parseMultiplePaths('/path/one.jpg "/path with spaces/two.png"')
 * // { paths: ['/path/one.jpg', '/path with spaces/two.png'], format: 'shell' }
 *
 * @example
 * // Single path
 * parseMultiplePaths('/path/to/image.jpg')
 * // { paths: ['/path/to/image.jpg'], format: 'single' }
 */
export function parseMultiplePaths(text: string): ParsedPaths {
  const trimmed = text.trim();

  if (!trimmed) {
    return { paths: [], format: "single" };
  }

  // Check for newline-separated format
  if (hasUnquotedNewlines(trimmed)) {
    const paths = trimmed
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    return {
      paths,
      format: paths.length > 1 ? "newline" : "single",
    };
  }

  // Try shell-style parsing
  const paths = parseShellPaths(trimmed);

  if (paths.length === 0) {
    return { paths: [], format: "single" };
  }

  if (paths.length === 1) {
    return { paths, format: "single" };
  }

  return { paths, format: "shell" };
}

/**
 * Quick check if text might contain multiple paths.
 * Useful for fast filtering before detailed parsing.
 */
export function mightContainMultiplePaths(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;

  // Contains newlines
  if (trimmed.includes("\n")) return true;

  // Contains quotes (shell-style indicator)
  if (trimmed.includes('"') || trimmed.includes("'")) return true;

  // Contains multiple spaces (potential shell-style)
  // but only if it looks like multiple paths (has path-like patterns)
  const spaceCount = (trimmed.match(/ /g) || []).length;
  if (spaceCount > 0 && (trimmed.includes("/") || trimmed.includes("\\"))) {
    return true;
  }

  return false;
}
