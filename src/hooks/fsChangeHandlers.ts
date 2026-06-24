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
 * @coordinates-with useExternalFileChanges.ts — sole caller; builds the context
 * @module hooks/fsChangeHandlers
 */

/**
 * Injected collaborators for the FS-change handlers. Mirrors exactly the
 * closures the hook already had — the handlers stay free of direct store /
 * Tauri imports so tests can pass fakes.
 */
export interface FsChangeContext {
  /** Read a file from disk; rejects if the file is gone/unreadable. */
  readTextFile: (path: string) => Promise<string>;
  /** Normalize a path for map lookups and comparisons. */
  normalizePath: (path: string) => string;
  /** True if a save we initiated is still in flight for this normalized path. */
  hasPendingSave: (normalizedPath: string) => boolean;
  /** True if disk content matches a save we initiated (our own echo). */
  matchesPendingSave: (path: string, diskContent: string) => boolean;
  /** Re-point a tab + its document at the renamed path and clear missing state. */
  applyRename: (tabId: string, newPath: string) => void;
  /** Apply modify-style policy (reload / prompt / no-op) for a changed file. */
  handleModifyEvent: (tabId: string, changedPath: string, diskContent: string) => Promise<void>;
  /** Mark a tab's document missing (file truly gone). */
  handleDeletion: (tabId: string) => void;
}

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
  let handled = false;
  for (let i = 0; i + 1 < paths.length; i += 2) {
    if (applyRenamePair(ctx, openPaths, paths[i], paths[i + 1])) handled = true;
  }
  if (handled) return;

  for (const changedPath of paths) {
    const normalizedPath = ctx.normalizePath(changedPath);
    const tabId = openPaths.get(normalizedPath);
    if (!tabId) continue;

    // Skip our own atomic writes (rename is part of temp→target)
    if (ctx.hasPendingSave(normalizedPath)) continue;

    // Verify file is actually gone before marking as deleted.
    // Atomic writes trigger rename events but the target still exists.
    try {
      const diskContent = await ctx.readTextFile(changedPath);
      await ctx.handleModifyEvent(tabId, changedPath, diskContent);
    } catch {
      ctx.handleDeletion(tabId);
    }
  }
}

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
): Promise<void> {
  if (ctx.hasPendingSave(normalizedPath)) return;
  try {
    const diskContent = await ctx.readTextFile(changedPath);
    // File still exists — spurious remove. Run modify-style checks
    // (filters our own save, handles real external edits).
    if (ctx.matchesPendingSave(changedPath, diskContent)) return;
    await ctx.handleModifyEvent(tabId, changedPath, diskContent);
  } catch {
    ctx.handleDeletion(tabId);
  }
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
