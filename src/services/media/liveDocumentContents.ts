/**
 * Live Document Contents
 *
 * Purpose: Snapshot the in-memory buffer of every open document — keyed by
 * file path, or by a synthetic `untitled:<tabId>` key for never-saved ones —
 * for orphan-image cleanup to consult instead of reading those files off
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
 * @coordinates-with services/tabs/tabOperations.ts — close-time cleanup
 * @coordinates-with services/commands/miscCommands.ts — manual cleanup command
 * @module services/media/liveDocumentContents
 */

import { useDocumentStore } from "@/stores/documentStore";
import { flushAllWysiwygNow } from "@/utils/wysiwygFlush";
import { canonicalPathKey } from "@/utils/paths/pathComparison";

/**
 * In-memory content of every open document except those in `excludedTabIds`,
 * keyed by absolute path — or by a synthetic `untitled:<tabId>` key for
 * never-saved documents, whose buffers exist nowhere on disk yet can hold
 * absolute-path references. Synthetic keys cannot collide with real paths
 * (those are absolute) and never match a directory filter, so they act purely
 * as extra reference evidence.
 *
 * When two tabs hold the same path, the dirty buffer wins: it is the one
 * carrying references its clean twin does not.
 */
export function liveContentsExcluding(
  excludedTabIds: ReadonlySet<string> = new Set()
): Map<string, string> {
  // WI-10: the WYSIWYG editor syncs into the store on a debounce. Right after
  // a paste — exactly when a brand-new image has a single reference — that
  // reference exists in NEITHER the store nor the file. Flush every mounted
  // editor first, or cleanup deletes the image out of the settling window.
  flushAllWysiwygNow();
  const live = new Map<string, string>();
  const { documents } = useDocumentStore.getState();
  for (const [tabId, doc] of Object.entries(documents)) {
    if (excludedTabIds.has(tabId)) continue;
    if (!doc.filePath) {
      live.set(`untitled:${tabId}`, doc.content);
      continue;
    }
    // WI-8c: two spellings of one path must land on ONE key, or a lookup
    // misses the buffer and the scan falls back to a stale file.
    const key = canonicalPathKey(doc.filePath);
    if (live.has(key) && !doc.isDirty) continue;
    live.set(key, doc.content);
  }
  return live;
}
