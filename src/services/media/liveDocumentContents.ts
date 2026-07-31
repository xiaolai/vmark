/**
 * Live Document Contents
 *
 * Purpose: Snapshot the in-memory buffer of every open document, keyed by file
 * path, for orphan-image cleanup to consult instead of reading those files off
 * disk.
 *
 * Why it exists: `assets/images` is shared by every document in a directory, so
 * cleanup must ask the neighbours before deleting. Asking DISK gets a stale
 * answer — a tab that just pasted an image references it only in its unsaved
 * buffer, and cleanup triggered by another tab would delete that image out from
 * under a document still on screen.
 *
 * Lives in services/ (not hooks/) because both a hook (close cleanup) and a
 * service (the manual command) need it, and services must not import hooks.
 *
 * @coordinates-with orphanAssetCleanup.ts — consumed as OrphanScanOptions.knownContents
 * @coordinates-with hooks/useTabOperations.ts — close-time cleanup
 * @coordinates-with services/commands/miscCommands.ts — manual cleanup command
 * @module services/media/liveDocumentContents
 */

import { useDocumentStore } from "@/stores/documentStore";

/**
 * In-memory content of every open document except those in `excludedTabIds`,
 * keyed by absolute path.
 *
 * When two tabs hold the same path, the dirty buffer wins: it is the one
 * carrying references its clean twin does not.
 */
export function liveContentsExcluding(
  excludedTabIds: ReadonlySet<string> = new Set()
): Map<string, string> {
  const live = new Map<string, string>();
  const { documents } = useDocumentStore.getState();
  for (const [tabId, doc] of Object.entries(documents)) {
    if (excludedTabIds.has(tabId) || !doc.filePath) continue;
    if (live.has(doc.filePath) && !doc.isDirty) continue;
    live.set(doc.filePath, doc.content);
  }
  return live;
}
