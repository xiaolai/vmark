/**
 * Drag-and-drop file path filtering utilities
 *
 * Filters dropped file paths to only include markdown-compatible files.
 *
 * @module utils/dropPaths
 */

/** Supported markdown file extensions (lowercase) */
export const MARKDOWN_EXTENSIONS = [".md", ".markdown", ".txt"] as const;

/**
 * Check if a filename matches markdown extensions (case-insensitive).
 */
export function isMarkdownFileName(name: string): boolean {
  const lowerName = name.toLowerCase();
  return MARKDOWN_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
}

/**
 * Strip known markdown extensions from a filename (case-insensitive).
 */
export function stripMarkdownExtension(name: string): string {
  const lowerName = name.toLowerCase();
  for (const ext of MARKDOWN_EXTENSIONS) {
    if (lowerName.endsWith(ext)) {
      return name.slice(0, -ext.length);
    }
  }
  return name;
}

/**
 * Filter an array of file paths to only include markdown-compatible files.
 *
 * Checks file extensions against MARKDOWN_EXTENSIONS (case-insensitive).
 * Non-matching files are silently ignored.
 *
 * @param paths - Array of file paths from drag-drop event
 * @returns Array of paths with markdown-compatible extensions
 *
 * @example
 * filterMarkdownPaths(["/docs/readme.md", "/docs/image.png"])
 * // Returns: ["/docs/readme.md"]
 *
 * @example
 * filterMarkdownPaths(["/notes/TODO.TXT", "/notes/data.json"])
 * // Returns: ["/notes/TODO.TXT"] (case-insensitive matching)
 */
export function filterMarkdownPaths(paths: string[] | null | undefined): string[] {
  if (!paths || !Array.isArray(paths)) {
    return [];
  }

  return paths.filter((path) => {
    const lowerPath = path.toLowerCase();
    return MARKDOWN_EXTENSIONS.some((ext) => lowerPath.endsWith(ext));
  });
}
