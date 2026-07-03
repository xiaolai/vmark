/**
 * replaceTabWithFile — shared "replace a clean tab with a file" flow.
 *
 * Size routing → progress indicator → read → load → workspace config →
 * ownership → recents → large-file marking. Used by `handleOpen` (Cmd+O) and
 * "Open Recent File" so the two replace paths can't drift.
 *
 * @module hooks/replaceTabWithFile
 */

import { readTextFile } from "@tauri-apps/plugin-fs";
import { useDocumentStore, useFileLoadStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { useRecentFilesStore } from "@/stores/workspaceStore";
import { openWorkspaceWithConfig } from "@/hooks/openWorkspaceWithConfig";
import { detectLinebreaks } from "@/utils/linebreakDetection";
import { getFileName } from "@/utils/pathUtils";
import { routeOpenBySize } from "@/services/navigation/largeFileRouting";
import { maybeMarkLargeMarkdownAsSource } from "@/lib/formats/markdownLargeFile";
import { applyFileOwnershipAfterOpen } from "@/services/workspaces/fileOwnership";
import { shouldShowProgressIndicator } from "@/utils/fileSizeThresholds";
import { isBinaryMediaPath, replaceTabWithMediaFile } from "./openMediaFile";

export type ReplaceTabResult =
  | { ok: true }
  | { ok: false; cancelled: true }
  | { ok: false; cancelled: false; error: unknown };

/**
 * Replace a clean tab's content with a file. On read failure the caller decides
 * how to surface the error (toast vs. remove-from-recents dialog), so this
 * helper reports the failure instead of handling it. The progress indicator is
 * always cleared on failure; on success it stays until the editor mounts.
 */
export async function replaceTabWithFile(params: {
  windowLabel: string;
  tabId: string;
  /** Resolved path written to the tab/document. */
  targetPath: string;
  /** Path read from disk and recorded in recents (usually === targetPath). */
  sourcePath: string;
  workspaceRoot?: string | null;
}): Promise<ReplaceTabResult> {
  const { windowLabel, tabId, targetPath, sourcePath, workspaceRoot } = params;

  // Binary media short-circuit (mirrors openFileInNewTabCore's tryOpenMediaFile):
  // never size-gate or readTextFile a binary. Path-only, synchronous — the media
  // surface streams the bytes via asset://. Must precede routeOpenBySize/read.
  if (isBinaryMediaPath(sourcePath)) {
    replaceTabWithMediaFile(tabId, targetPath);
    if (workspaceRoot) {
      await openWorkspaceWithConfig(workspaceRoot, { windowLabel });
    }
    return { ok: true };
  }

  const route = await routeOpenBySize(sourcePath);
  if (!route.proceed) return { ok: false, cancelled: true };

  const showIndicator =
    !route.forceSourceMode && shouldShowProgressIndicator(route.sizeBytes);
  let replaceLoadId: number | null = null;
  if (showIndicator) {
    const filename = getFileName(sourcePath) || sourcePath;
    replaceLoadId = useFileLoadStore.getState().startLoad(filename, route.sizeBytes);
  }

  try {
    const content = await readTextFile(sourcePath);

    // Close-during-open guard: the target tab can be closed while this read is
    // in flight. Mutating it now would resurrect/overwrite a tab that no longer
    // exists and leave stale recent-file / source-mode state. Re-check post-await
    // (mirrors openFileInNewTabCore's findTabById guard).
    if (!useTabStore.getState().findTabById(tabId)) {
      if (replaceLoadId !== null) {
        useFileLoadStore.getState().endLoad(replaceLoadId);
      }
      return { ok: false, cancelled: true };
    }

    useTabStore.getState().updateTabPath(tabId, targetPath);
    useDocumentStore.getState().loadContent(
      tabId,
      content,
      targetPath,
      detectLinebreaks(content),
    );
    if (workspaceRoot) {
      await openWorkspaceWithConfig(workspaceRoot, { windowLabel });
    }
    applyFileOwnershipAfterOpen(tabId, targetPath);
    useRecentFilesStore.getState().addFile(sourcePath);
    maybeMarkLargeMarkdownAsSource(tabId, sourcePath, route.forceSourceMode);
    // On success the indicator stays on until TiptapEditor's onCreate fires
    // endLoad() — that is the moment the editor is actually interactive.
    return { ok: true };
  } catch (error) {
    // Clear the indicator immediately on error so no stale spinner lingers.
    if (replaceLoadId !== null) {
      useFileLoadStore.getState().endLoad(replaceLoadId);
    }
    return { ok: false, cancelled: false, error };
  }
}
