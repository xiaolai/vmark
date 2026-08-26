/**
 * Filesystem-change event handlers (pure routing layer)
 *
 * Purpose: Extracts the per-kind routing logic (rename / remove / modify) out
 *   of the `fs:changed` listener in `useExternalFileChanges` so each branch can
 *   be unit-tested in isolation without rendering the hook or mocking the whole
 *   Tauri event pipeline. The hook supplies a {@link FsChangeContext} of its
 *   collaborators (store mutators, disk reads, pending-save guards) and these
 *   functions own only the control flow.
 *
 * Key decisions:
 *   - `handleSemanticBatch` dispatches, and nothing else. Renames live in
 *     `fsRenameHandlers` (fresh path map per rename, pairs before singletons)
 *     and a media create/modify goes through `handleMediaChangeEvent` (never
 *     reads the file — it could be a multi-GB video).
 *
 * @coordinates-with useExternalFileChanges.ts — sole caller; builds the context
 * @coordinates-with services/workspaceEvents — handleSemanticBatch consumes its SemanticWorkspaceEvent
 * @coordinates-with services/windowClose/fsRenameHandlers.ts — the rename branch
 * @coordinates-with services/windowClose/fsChangeContext.ts — the injected collaborator contract
 * @coordinates-with components/Editor/MediaViewer/MediaViewer.tsx — the media
 *   branch's markBinaryFileChanged is what makes that surface re-fetch (#1328)
 * @module services/windowClose/fsChangeHandlers
 */

import type { SemanticWorkspaceEvent } from "@/services/workspaceEvents";
import type { FsChangeContext } from "./fsChangeContext";
import { dispatchRenames, readAndRouteOrMarkMissing } from "./fsRenameHandlers";

export type { FsChangeContext };

/**
 * Handle a `remove` event for a single open tab. Windows atomic saves
 * (MoveFileEx) and sync daemons emit spurious `remove`s for files that still
 * exist, so skip our own pending saves and re-verify before marking missing
 * (issue 995).
 */
export async function handleRemoveEvent(
  ctx: FsChangeContext,
  tabId: string,
  changedPath: string,
  normalizedPath: string,
  isMedia = false,
): Promise<void> {
  if (ctx.hasPendingSave(normalizedPath)) return;

  // Media tabs stream from asset:// and hold no text content — never read the
  // file to probe existence (it could be a multi-GB video). A spurious remove
  // on a still-present file is a no-op; a real deletion marks the tab missing.
  // An ambiguous probe error (permission/IO) must not escape the listener and
  // must not conservatively mark missing (spurious "deleted" is worse).
  if (isMedia) {
    try {
      if (!(await ctx.fileExists(changedPath))) ctx.handleDeletion(tabId);
    } catch {
      /* ambiguous probe error — leave the tab as-is, don't flag missing */
    }
    return;
  }

  // A readable file means the remove was spurious — run modify-style checks
  // (filters our own save, handles real external edits).
  await readAndRouteOrMarkMissing(ctx, tabId, changedPath, { filterOwnSave: true });
}

/**
 * Handle a `modify`/`create` event for a single open tab. A `create` can be a
 * recreation after delete. Unreadable files (deleted/locked mid-read) are
 * skipped; our own saves are filtered out.
 */
export async function handleModifyOrCreateEvent(
  ctx: FsChangeContext,
  tabId: string,
  changedPath: string,
): Promise<void> {
  let diskContent: string;
  try {
    diskContent = await ctx.readTextFile(changedPath);
  } catch {
    return;
  }
  if (ctx.matchesPendingSave(changedPath, diskContent)) return;
  await ctx.handleModifyEvent(tabId, changedPath, diskContent);
}

/**
 * A create/modify on an open MEDIA tab. Never reads the file — it could be a
 * multi-GB video; only the change counter moves.
 */
function handleMediaChangeEvent(
  ctx: FsChangeContext,
  tabId: string,
  normalizedPath: string,
  kind: SemanticWorkspaceEvent["kind"],
): void {
  // A media `create` can mean a deleted file reappeared — clear missing so the
  // viewer leaves its "file is gone" state. Unconditional, as it has always
  // been: a file that is back is back whoever wrote it.
  if (kind === "created" && ctx.isMissing(tabId)) ctx.clearMissing(tabId);
  // Our own write echoing back needs no refresh — the viewer is already showing
  // what we just wrote. The text path filters these by comparing content, which
  // a binary has none of, so the path check is the filter.
  if (ctx.hasPendingSave(normalizedPath)) return;
  // Announce the new bytes, for BOTH kinds. This used to be skipped for
  // `modify` on the reasoning that "the asset URL already points at the fresh
  // bytes" — true of the URL, and irrelevant to the element: an <img>/<video>
  // whose `src` attribute does not change never refetches, so the surface kept
  // displaying what it decoded when the tab opened, and a tab close and reopen
  // produced the identical URL and the identical cached bytes (issue #1328).
  ctx.markBinaryFileChanged(tabId);
}

export async function handleSemanticBatch(
  ctx: FsChangeContext,
  events: SemanticWorkspaceEvent[],
  getOpenPaths: () => Map<string, string>,
): Promise<void> {
  await dispatchRenames(ctx, events.filter((e) => e.kind === "renamed"), getOpenPaths);

  const rest = events.filter((e) => e.kind !== "renamed");
  if (rest.length === 0) return;
  // Rebuild the map: a rename above may have re-pointed a tab (applyRename
  // mutates the store), so a pre-rename snapshot would misroute related events.
  const openPaths = getOpenPaths();
  for (const event of rest) {
    const normalizedPath = ctx.normalizePath(event.path);
    const tabId = openPaths.get(normalizedPath);
    if (!tabId) continue; // not an open file

    const isMedia = ctx.isMedia(event.path);
    if (event.kind === "deleted") {
      await handleRemoveEvent(ctx, tabId, event.path, normalizedPath, isMedia);
    } else if (isMedia) {
      handleMediaChangeEvent(ctx, tabId, normalizedPath, event.kind);
    } else {
      await handleModifyOrCreateEvent(ctx, tabId, event.path);
    }
  }
}
