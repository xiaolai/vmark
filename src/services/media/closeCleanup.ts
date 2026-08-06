/**
 * Close-time Orphan Cleanup
 *
 * Purpose: run orphan-image cleanup for a set of tabs that are about to close
 * together — the shared engine behind both the per-tab close (Cmd+W) and the
 * whole-window close (traffic light / Cmd+Q).
 *
 * Lives in services/ (not hooks/): both a hook (useTabOperations) and the
 * window-close flow need it, it has no React surface, and keeping it here
 * breaks the hooks↔services import cycle it used to create.
 *
 * Key decisions:
 *   - Scans the content that will BE on disk after the close: the in-memory
 *     buffer for a clean or just-saved document, the file itself when the
 *     buffer is not what survives (discarded edits, or a divergent document).
 *     If the file cannot be re-read, the scan is skipped rather than run
 *     against content we are not sure about.
 *   - Scans ONCE per assets directory, not once per tab — the assets folder is
 *     shared by the whole directory.
 *   - Every open document's live buffer travels with the scan, so closing one
 *     tab cannot delete an image a sibling tab references but has not saved.
 *   - Deletion is decided by TWO scans and their intersection (WI-8b): the
 *     first scan does file IO, and an edit landing during it must not be
 *     judged by a stale snapshot. Files go to the system trash, not unlink.
 *   - Never rejects: a cleanup failure must not strand a window the user asked
 *     to close.
 *
 * @coordinates-with orphanAssetCleanup.ts — findOrphanedImages/deleteOrphanedImages
 * @coordinates-with liveDocumentContents.ts — sibling buffers
 * @coordinates-with services/tabs/tabOperations.ts — per-tab close caller
 * @coordinates-with services/windowClose/windowCloseFlow.ts — window close caller
 * @module services/media/closeCleanup
 */

import { readTextFile } from "@tauri-apps/plugin-fs";
import { dirname } from "@tauri-apps/api/path";
import { fileOpsError } from "@/utils/debug";
import { useDocumentStore } from "@/stores/documentStore";
import { useSettingsStore } from "@/stores/settingsStore";
import {
  findOrphanedImages,
  deleteOrphanedImages,
} from "@/services/media/orphanAssetCleanup";
import { liveContentsExcluding } from "@/services/media/liveDocumentContents";
import { canonicalPathKey } from "@/utils/paths/pathComparison";
import { withoutWorkspaceReferenced } from "@/services/media/workspaceReferenceCheck";
import { collectRemoteLiveRefs } from "@/services/media/crossWindowRefs";
import { getCurrentWindowLabel } from "@/services/persistence/workspaceStorage";

/** A closing document and the content it will leave behind on disk. */
interface ClosingDocument {
  filePath: string;
  content: string;
}

/**
 * The content this document will leave on disk once the tab closes: the
 * in-memory buffer only when we know it matches disk, otherwise the file
 * itself. `null` means "unknowable"; the caller then skips cleanup entirely.
 */
async function contentAfterClose(
  filePath: string,
  content: string,
  bufferMatchesDisk: boolean
): Promise<string | null> {
  if (bufferMatchesDisk) return content;
  try {
    return await readTextFile(filePath);
  } catch (error) {
    fileOpsError("OrphanCleanup could not re-read closing document:", error);
    return null;
  }
}

/**
 * Run orphan-image cleanup for a set of tabs closing together.
 *
 * Window close (traffic light / Cmd+Q) tears every tab down at once without
 * going through closeTabWithDirtyCheck, so the auto-cleanup setting did nothing
 * on the path most users actually take to leave the app (#1179).
 */
export async function cleanupOrphansForClosingTabs(tabIds: string[]): Promise<void> {
  if (!useSettingsStore.getState().image.cleanupOrphansOnClose) return;

  const closing = new Set(tabIds);
  const knownContents = liveContentsExcluding(closing);
  const subjects: ClosingDocument[] = [];

  for (const tabId of tabIds) {
    const doc = useDocumentStore.getState().getDocument(tabId);
    if (!doc?.filePath) continue;
    try {
      const content = await contentAfterClose(
        doc.filePath,
        doc.content,
        !doc.isDirty && !doc.isDivergent
      );
      if (content === null) continue;
      subjects.push({ filePath: doc.filePath, content });
      knownContents.set(canonicalPathKey(doc.filePath), content);
    } catch (error) {
      fileOpsError("OrphanCleanup could not resolve closing content:", error);
    }
  }

  // WI-9: another window's unsaved buffer can be the sole reference to an
  // image in these folders. Incomplete evidence protects everything.
  const externalRefKeys = await collectRemoteLiveRefs(getCurrentWindowLabel());

  const scannedDirs = new Set<string>();
  for (const subject of subjects) {
    try {
      const dir = await dirname(subject.filePath);
      if (scannedDirs.has(dir)) continue;
      scannedDirs.add(dir);

      const first = await findOrphanedImages(subject.filePath, subject.content, {
        knownContents,
        externalRefKeys,
      });
      if (first.orphanedImages.length === 0) continue;

      // WI-8b: re-snapshot the world and scan again, then remove only the
      // INTERSECTION. The first scan does file IO; an edit landing during it
      // (a paste into a sibling tab) must not be judged by the stale snapshot.
      // The manual prompt already re-scans before deleting — the automatic
      // path was the inconsistent one.
      const fresh = liveContentsExcluding(closing);
      for (const s of subjects) fresh.set(canonicalPathKey(s.filePath), s.content);
      const second = await findOrphanedImages(subject.filePath, subject.content, {
        knownContents: fresh,
        externalRefKeys: await collectRemoteLiveRefs(getCurrentWindowLabel()),
      });
      const stillOrphaned = new Set(second.orphanedImages.map((img) => img.fullPath));
      const confirmed = first.orphanedImages.filter((img) => stillOrphaned.has(img.fullPath));
      // WI-11: a document ANYWHERE in the workspace can reference this asset
      // by absolute or ../ path — documents the directory scan never reads.
      const cleared = await withoutWorkspaceReferenced(confirmed);
      if (cleared.length > 0) {
        await deleteOrphanedImages(cleared);
      }
    } catch (error) {
      // Silent failure — don't block close for cleanup errors.
      fileOpsError("OrphanCleanup error during close cleanup:", error);
    }
  }
}
