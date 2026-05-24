/**
 * imageView operations — ADR-010 pattern.
 *
 * Shared helpers between the Tiptap imageView and CodeMirror
 * sourceImagePopup. Both controllers normalize image src strings,
 * classify them as remote/local/data, and format the markdown
 * `![alt](src)` syntax.
 *
 * @module plugins/imageView/operations
 */

export type ImageSrcKind = "remote" | "local" | "data" | "unknown";

/** Classify an image src for the open / resolve path. */
export function classifyImageSrc(src: string): ImageSrcKind {
  const s = src.trim();
  if (!s) return "unknown";
  if (s.startsWith("data:")) return "data";
  if (/^https?:\/\//i.test(s)) return "remote";
  // Anything else (relative path, absolute file path, file:// URL) is local.
  return "local";
}

/** Build a markdown `![alt](src "title")` literal. Title is optional. */
export function formatImageMarkdown(alt: string, src: string, title?: string): string {
  const safeAlt = alt.replace(/[\\\]]/g, "\\$&");
  const safeSrc = src.trim();
  if (title && title.trim()) {
    const safeTitle = title.replace(/"/g, '\\"');
    return `![${safeAlt}](${safeSrc} "${safeTitle}")`;
  }
  return `![${safeAlt}](${safeSrc})`;
}

/** Empty or whitespace-only src is not a valid image. */
export function isValidImageSrc(src: string): boolean {
  return src.trim().length > 0;
}
