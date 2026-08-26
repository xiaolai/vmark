/**
 * Rename handling for filesystem-change events.
 *
 * Purpose: re-point an open tab when its file is renamed, and fall back to a
 *   probe when the event is not a usable pair.
 *
 * Split from `fsChangeHandlers.ts`, which was at the 300-line limit. The seam
 * is the one the code already had: a rename is the only kind that MUTATES the
 * path map the rest of the batch reads, which is why it is dispatched first,
 * one at a time, against a freshly-built map each time.
 *
 * @coordinates-with fsChangeHandlers.ts — dispatches the batch
 * @coordinates-with services/windowClose/fsChangeContext.ts — the injected collaborator contract
 * @module services/windowClose/fsRenameHandlers
 */

import type { SemanticWorkspaceEvent } from "@/services/workspaceEvents";
import type { FsChangeContext } from "./fsChangeContext";

/**
 * Resolve a single rename pair: re-point the open tab if the OLD path matches a
 * tracked file. Returns true when a pair was applied.
 */
function applyRenamePair(
  ctx: FsChangeContext,
  openPaths: Map<string, string>,
  oldRaw: string,
  newRaw: string,
): boolean {
  const oldPath = ctx.normalizePath(oldRaw);
  const newPath = ctx.normalizePath(newRaw);
  const tabId = openPaths.get(oldPath);
  if (!tabId) return false;
  ctx.applyRename(tabId, newPath);
  return true;
}

/**
 * Read a text file and route it, or decide whether it is really gone.
 *
 * The two callers below both used to write this inline as one `try` wrapping
 * BOTH the read and the policy call, with a `catch` that marked the tab
 * missing. That conflated three different events into one verdict:
 *
 *   - the file is gone                  → missing, correct;
 *   - the read failed for another reason (EACCES, EIO, a locked file mid-write)
 *                                       → NOT evidence of deletion;
 *   - the reload POLICY threw           → says nothing about the file at all,
 *                                         and was silently converted into
 *                                         "your document was deleted".
 *
 * So the read is now the only thing inside the `try`, and a failure is
 * CONFIRMED against `fileExists` before concluding deletion — the same
 * conservatism the media branch beside it already applied, where an ambiguous
 * probe deliberately leaves the tab alone. A policy rejection propagates to the
 * caller, which logs it (`useExternalFileChanges`), instead of being disguised.
 */
export async function readAndRouteOrMarkMissing(
  ctx: FsChangeContext,
  tabId: string,
  changedPath: string,
  { filterOwnSave = false }: { filterOwnSave?: boolean } = {},
): Promise<void> {
  let diskContent: string;
  try {
    diskContent = await ctx.readTextFile(changedPath);
  } catch {
    try {
      if (!(await ctx.fileExists(changedPath))) ctx.handleDeletion(tabId);
    } catch {
      /* ambiguous probe — not evidence either way, leave the tab as-is */
    }
    return;
  }
  if (filterOwnSave && ctx.matchesPendingSave(changedPath, diskContent)) return;
  await ctx.handleModifyEvent(tabId, changedPath, diskContent);
}

/**
 * Handle a `rename` event. Filesystem rename events arrive as flattened
 * [old, new] pairs. When no pair maps to an open tab (atomic-write renames that
 * only touch the target), fall back to verifying each path: a still-readable
 * file is treated as a modify, a truly-gone file is marked missing.
 */
export async function handleRenameEvent(
  ctx: FsChangeContext,
  paths: string[],
  openPaths: Map<string, string>,
): Promise<void> {
  // Per PAIR, not per batch. `handled` used to be a single flag for the whole
  // array: one recognised rename returned early and every other path in the
  // same batch was dropped, so an atomic replacement arriving alongside a real
  // rename was silently lost (audit finding #21). Each pair is an independent
  // filesystem event and gets an independent verdict.
  const unmatched: string[] = [];
  let i = 0;
  for (; i + 1 < paths.length; i += 2) {
    if (!applyRenamePair(ctx, openPaths, paths[i], paths[i + 1])) {
      unmatched.push(paths[i], paths[i + 1]);
    }
  }
  // A trailing odd path is an unpaired rename (an atomic-write target).
  if (i < paths.length) unmatched.push(paths[i]);

  for (const changedPath of unmatched) {
    const normalizedPath = ctx.normalizePath(changedPath);
    const tabId = openPaths.get(normalizedPath);
    if (!tabId) continue;

    // Skip our own atomic writes (rename is part of temp→target)
    if (ctx.hasPendingSave(normalizedPath)) continue;

    // Media tabs stream from asset:// and hold no text — never read the binary
    // to probe existence (it could be a multi-GB video). Existence-probe only;
    // an ambiguous probe error is treated conservatively (do NOT mark missing,
    // and do NOT announce a change for a file we cannot confirm is there).
    //
    // A file that IS still present got here because a rename replaced it —
    // which is how an atomic write lands, and therefore how most tools rewrite
    // a picture. It is new bytes under an unchanged path, so it needs the same
    // announcement the modify branch makes; without it the viewer keeps
    // rendering what it decoded at open time (issue #1328, audit finding #1).
    if (ctx.isMedia(changedPath)) {
      try {
        if (await ctx.fileExists(changedPath)) ctx.markBinaryFileChanged(tabId);
        else ctx.handleDeletion(tabId);
      } catch {
        /* ambiguous probe error — leave the tab as-is, don't flag missing */
      }
      continue;
    }

    // Verify file is actually gone before marking as deleted.
    // Atomic writes trigger rename events but the target still exists.
    await readAndRouteOrMarkMissing(ctx, tabId, changedPath);
  }
}

/**
 * Route a coalesced batch of normalized workspace events onto the per-kind
 * handlers. Scope, self-write flagging, and no-op suppression already happened
 * upstream (the workspace event source), so this is pure routing.
 *
 * Rename handling: each rename is dispatched to {@link handleRenameEvent} on its
 * own, against a freshly read path map — `applyRename` re-points tabs in the
 * store, so any map read before it is stale for every rename after it. Complete
 * [old, new] pairs and unpaired renames (atomic-write targets) stay separate
 * because mixing them into one flat array would corrupt its positional pairing.
 */
/**
 * Apply every rename in the batch, one at a time.
 *
 * Each is dispatched against a FRESH path map, because applying one re-points a
 * tab in the store and invalidates any snapshot taken before it. A single
 * snapshot for the whole group broke a chained `a -> b -> c` rename arriving in
 * one batch: the second hop looked the tab up under a name the snapshot still
 * held, found nothing, and left the tab pointing at `b` while the file was at
 * `c` (audit finding #24). Re-reading is cheap — it is a map build over the
 * window's open tabs — and correctness here is not optional.
 *
 * Paired renames go first, then unpaired ones (atomic-write targets / lone
 * paths) individually: a single-element array cannot be mis-paired, and that
 * preserves the fallback's probe semantics (readable → modify, gone → delete,
 * media → existence-only).
 */
export async function dispatchRenames(
  ctx: FsChangeContext,
  renamed: SemanticWorkspaceEvent[],
  getOpenPaths: () => Map<string, string>,
): Promise<void> {
  for (const event of renamed) {
    if (event.previousPath !== undefined) {
      await handleRenameEvent(ctx, [event.previousPath, event.path], getOpenPaths());
    }
  }
  for (const event of renamed) {
    if (event.previousPath === undefined) {
      await handleRenameEvent(ctx, [event.path], getOpenPaths());
    }
  }
}
