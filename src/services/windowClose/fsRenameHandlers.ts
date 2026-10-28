/**
 * Rename handling for filesystem-change events.
 *
 * Purpose: re-point an open tab when its file — or a directory above it — is
 *   renamed, and fall back to a probe when the event is not a usable pair. The probe (`probeOpenFile`) is
 *   also what a watcher `rescan` runs for every open file under its root.
 *
 * Split from `fsChangeHandlers.ts`, which was at the 300-line limit. The seam
 * is the one the code already had: a rename is the only kind that MUTATES the
 * path map the rest of the batch reads, which is why it is dispatched first,
 * one at a time, against a freshly-built map each time.
 *
 * @coordinates-with fsChangeHandlers.ts — dispatches the batch, and probes on a rescan
 * @coordinates-with services/windowClose/fsChangeContext.ts — the injected collaborator contract
 * @module services/windowClose/fsRenameHandlers
 */

import type { SemanticWorkspaceEvent } from "@/services/workspaceEvents";
import type { FsChangeContext } from "./fsChangeContext";

/**
 * Resolve a single rename pair: re-point the open tab if the OLD path matches a
 * tracked file, or — when the OLD path is a directory — every open tab under
 * it. Returns true when a pair was applied.
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
  if (tabId) {
    ctx.applyRename(tabId, newPath);
    return true;
  }
  return rebaseDescendants(ctx, openPaths, oldPath, newPath);
}

/**
 * A renamed directory: re-point each open tab whose path lies under `oldDir`
 * to the same place under `newDir`. Matching is on path-component boundaries
 * (`/a/b` never claims `/a/bc/x`); both paths are already normalized to
 * forward slashes, so a Windows event spelled with `\` matches too. The tab
 * keeps its id and its buffer — nothing is re-read.
 */
function rebaseDescendants(
  ctx: FsChangeContext,
  openPaths: Map<string, string>,
  oldDir: string,
  newDir: string,
): boolean {
  // @edge-case an empty old path would make every absolute path its descendant
  if (!oldDir || !newDir) return false;
  const prefix = oldDir.endsWith("/") ? oldDir : `${oldDir}/`;
  const target = newDir.endsWith("/") ? newDir : `${newDir}/`;
  let rebased = false;
  for (const [path, tabId] of openPaths) {
    if (!path.startsWith(prefix)) continue;
    ctx.applyRename(tabId, `${target}${path.slice(prefix.length)}`);
    rebased = true;
  }
  return rebased;
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
  for (const changedPath of applyRenames(ctx, paths, openPaths)) {
    const normalizedPath = ctx.normalizePath(changedPath);
    const tabId = openPaths.get(normalizedPath);
    if (!tabId) continue;
    await probeOpenFile(ctx, tabId, changedPath, normalizedPath);
  }
}

/**
 * Apply every [old, new] pair in `paths` and return the paths no pair
 * accounted for — the ones that need a probe.
 */
function applyRenames(
  ctx: FsChangeContext,
  paths: string[],
  openPaths: Map<string, string>,
): string[] {
  // Per PAIR, not per batch. `handled` used to be a single flag for the whole
  // array: one recognised rename returned early and every other path in the
  // same batch was dropped, so an atomic replacement arriving alongside a real
  // rename was silently lost. Each pair is an independent
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
  return unmatched;
}

/**
 * Find out what happened to an open file when the event did not say: an
 * unpaired rename, or a watcher that lost track of the tree (`rescan`).
 * Readable → the modify policy; gone → missing; media → existence only.
 */
export async function probeOpenFile(
  ctx: FsChangeContext,
  tabId: string,
  changedPath: string,
  normalizedPath: string,
): Promise<void> {
  // Skip our own atomic writes (rename is part of temp→target)
  if (ctx.hasPendingSave(normalizedPath)) return;

  // Media tabs stream from asset:// and hold no text — never read the binary
  // to probe existence (it could be a multi-GB video). Existence-probe only;
  // an ambiguous probe error is treated conservatively (do NOT mark missing,
  // and do NOT announce a change for a file we cannot confirm is there).
  //
  // A file that IS still present got here because a rename replaced it —
  // which is how an atomic write lands, and therefore how most tools rewrite
  // a picture. It is new bytes under an unchanged path, so it needs the same
  // announcement the modify branch makes; without it the viewer keeps
  // rendering what it decoded at open time (issue #1328).
  if (ctx.isMedia(changedPath)) {
    try {
      if (await ctx.fileExists(changedPath)) {
        // A file that is back is back, whichever event reported it.
        if (ctx.isMissing(tabId)) ctx.clearMissing(tabId);
        ctx.markBinaryFileChanged(tabId);
      } else {
        ctx.handleDeletion(tabId);
      }
    } catch {
      /* ambiguous probe error — leave the tab as-is, don't flag missing */
    }
    return;
  }

  // Verify file is actually gone before marking as deleted.
  // Atomic writes trigger rename events but the target still exists.
  await readAndRouteOrMarkMissing(ctx, tabId, changedPath);
}

/**
 * Apply every rename in the batch IN EVENT ORDER, then probe what they left
 * unexplained.
 *
 * Each rename is applied against a FRESH path map, because applying one
 * re-points a tab in the store and invalidates any snapshot taken before it. A
 * single snapshot for the whole group broke a chained `a -> b -> c` rename
 * arriving in one batch: the second hop looked the tab up under a name the
 * snapshot still held, found nothing, and left the tab pointing at `b` while
 * the file was at `c`. Re-reading is cheap — a map build over the window's open
 * tabs — and correctness here is not optional.
 *
 * Probes are DEFERRED, by tab, to the end of the batch, and run at the tab's
 * FINAL path. The batch is handled after the fact, so the disk already holds
 * its end state: probing a replaced `a` in place, when a later event moved
 * `a -> b`, would find `a` gone and report a deletion. Applying the pairs first
 * and the unpaired renames second (as this once did) lost the replacement
 * instead — the tab had moved before the probe looked for it. Each tab is
 * probed once, however many events asked.
 *
 * A self-write (`selfWrite`, fixed when the event was normalized) is VMark's
 * own atomic save landing; it is never probed, even when its pending save has
 * expired by the time a queued batch runs. Its pair still re-points a tab: a
 * move is a fact whoever made it.
 */
export async function dispatchRenames(
  ctx: FsChangeContext,
  renamed: SemanticWorkspaceEvent[],
  getOpenPaths: () => Map<string, string>,
): Promise<void> {
  const toProbe = new Set<string>();
  for (const event of renamed) {
    const paths =
      event.previousPath !== undefined ? [event.previousPath, event.path] : [event.path];
    const openPaths = getOpenPaths();
    // Unmatched paths applied nothing, so `openPaths` is still current for them.
    const unmatched = applyRenames(ctx, paths, openPaths);
    if (event.selfWrite) continue;
    for (const path of unmatched) {
      const tabId = openPaths.get(ctx.normalizePath(path));
      if (tabId) toProbe.add(tabId);
    }
  }
  if (toProbe.size === 0) return;
  const finalPathOf = new Map([...getOpenPaths()].map(([path, tabId]) => [tabId, path]));
  for (const tabId of toProbe) {
    const path = finalPathOf.get(tabId);
    if (path !== undefined) await probeOpenFile(ctx, tabId, path, path);
  }
}
