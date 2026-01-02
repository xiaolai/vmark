/**
 * Image Path Security
 *
 * Validates image paths to prevent path traversal attacks.
 */

/**
 * Check if a path is relative (starts with ./ or assets/).
 */
export function isRelativePath(src: string): boolean {
  return src.startsWith("./") || src.startsWith("assets/");
}

/**
 * Check if a path is an absolute local file path.
 */
export function isAbsolutePath(src: string): boolean {
  return src.startsWith("/") || /^[A-Za-z]:/.test(src);
}

/**
 * Check if a path is an external URL (http/https/data).
 */
export function isExternalUrl(src: string): boolean {
  return src.startsWith("http://") || src.startsWith("https://") || src.startsWith("data:");
}

/**
 * Validate an image path for security.
 * Rejects paths that attempt path traversal via `..`.
 */
export function validateImagePath(src: string): boolean {
  // Reject any path containing parent directory references
  if (src.includes("..")) {
    return false;
  }

  // Reject absolute paths (could access system files)
  if (src.startsWith("/") || /^[A-Za-z]:/.test(src)) {
    return false;
  }

  // Allow relative paths that start with ./ or assets/
  return isRelativePath(src);
}

/**
 * Sanitize and validate an image path.
 * Returns null if the path is invalid or malicious.
 */
export function sanitizeImagePath(src: string): string | null {
  if (!validateImagePath(src)) {
    console.warn("[ImageView] Rejected suspicious image path:", src);
    return null;
  }
  return src;
}
