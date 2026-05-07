// WI-1A.6 — markdown-adapter-internal large-file helper.
//
// Co-located with the registry rather than inside markdown.tsx so the
// adapter's heavy React / store imports don't create cycles when entry-
// point hooks (useFileOpen, useDragDropOpen, useFinderFileOpen,
// WindowContext) import this helper.
//
// Logically belongs to the markdown adapter — see § WI-1A.6 of the
// multi-format plan. Other formats don't have a WYSIWYG path, so
// "force source mode for large files" is a markdown-only concept.

import { useLargeFileSessionStore } from "@/stores/largeFileSessionStore";
import { dispatchEditor } from "./registry";

// Mirror of MarkdownEditorSurface's accepted extensions. Used as the
// failure-open allow-list when the registry isn't bootstrapped — a
// non-markdown extension (e.g. .txt, .json) must NEVER be marked
// forced-source on the markdown adapter, even if dispatchEditor fails.
const MARKDOWN_EXTENSIONS = new Set(["md", "markdown", "mdown", "mkd", "mdx"]);

function extractExtension(filePath: string): string | null {
  const slash = Math.max(
    filePath.lastIndexOf("/"),
    filePath.lastIndexOf("\\"),
  );
  const base = slash >= 0 ? filePath.slice(slash + 1) : filePath;
  const stripped = base.replace(/[?#].*$/, "");
  const dot = stripped.lastIndexOf(".");
  if (dot <= 0 || dot === stripped.length - 1) return null;
  return stripped.slice(dot + 1).toLowerCase();
}

/**
 * Mark a tab as forced-source if (and only if) it's markdown and the
 * caller decided the file warrants source-mode treatment (size threshold).
 *
 * - shouldForce=false → no-op
 * - dispatchEditor(filePath).id !== "markdown" → no-op (other formats
 *   don't have a WYSIWYG path)
 * - else → useLargeFileSessionStore.markForcedSource(tabId)
 *
 * Defensive: dispatchEditor throws on an unbootstrapped registry. We
 * fall back to a static markdown-extension allow-list so a `.txt` (or
 * any non-markdown) never gets marked forced-source through this path.
 */
export function maybeMarkLargeMarkdownAsSource(
  tabId: string,
  filePath: string,
  shouldForce: boolean,
): void {
  if (!shouldForce) return;
  let formatId: string;
  try {
    formatId = dispatchEditor(filePath).id;
  } catch {
    // Registry not bootstrapped — derive eligibility from the extension
    // directly. Anything outside the static markdown set is rejected.
    const ext = extractExtension(filePath);
    if (!ext || !MARKDOWN_EXTENSIONS.has(ext)) return;
    formatId = "markdown";
  }
  if (formatId !== "markdown") return;
  useLargeFileSessionStore.getState().markForcedSource(tabId);
}
