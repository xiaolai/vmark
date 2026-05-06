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
 * fail open ("treat as markdown") so test edges and pre-bootstrap races
 * preserve prior behavior.
 */
export function maybeMarkLargeMarkdownAsSource(
  tabId: string,
  filePath: string,
  shouldForce: boolean,
): void {
  if (!shouldForce) return;
  let formatId = "markdown";
  try {
    formatId = dispatchEditor(filePath).id;
  } catch {
    /* registry not bootstrapped — fall through to markdown default */
  }
  if (formatId !== "markdown") return;
  useLargeFileSessionStore.getState().markForcedSource(tabId);
}
