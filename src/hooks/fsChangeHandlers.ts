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
 * @coordinates-with services/workspaceEvents — handleSemanticBatch consumes its SemanticWorkspaceEvent
 * @module hooks/fsChangeHandlers
 */

import type { SemanticWorkspaceEvent } from "@/services/workspaceEvents";

/**
 * Injected collaborators for the FS-change handlers. Mirrors exactly the
 * closures the hook already had — the handlers stay free of direct store /
 * Tauri imports so tests can pass fakes.
 */
export interface FsChangeContext {
  /** Read a file from disk; rejects if the file is gone/unreadable. */
  readTextFile: (path: string) => Promise<string>;
  /** Existence probe that never loads content — used for binary media tabs. */
  fileExists: (path: string) => Promise<boolean>;
  /** Normalize a path for map lookups and comparisons. */
  normalizePath: (path: string) => string;
  /** True if a save we initiated is still in flight for this normalized path. */
  hasPendingSave: (normalizedPath: string) => boolean;
  /** True if disk content matches a save we initiated (our own echo). */
  matchesPendingSave: (path: string, diskContent: string) => boolean;
  /** True if the tab is a binary media tab (png/mp4/…) — never UTF-8-read it. */
  /**
   * True when a path is binary media (image/audio/video). Extension-based and
   * association-independent — a media file must never be read as UTF-8 even if
   * its tab's formatId was routed elsewhere by a user format association.
   */
  isMedia: (path: string) => boolean;
  /** Re-point a tab + its document at the renamed path and clear missing state. */
  applyRename: (tabId: string, newPath: string) => void;
  /** Apply modify-style policy (reload / prompt / no-op) for a changed file. */
  handleModifyEvent: (tabId: string, changedPath: string, diskContent: string) => Promise<void>;
  /** Mark a tab's document missing (file truly gone). */
  handleDeletion: (tabId: string) => void;
  /** True if the tab's document is currently flagged missing. */
  isMissing: (tabId: string) => boolean;
  /** Clear a tab's missing flag (e.g. a media file reappeared on disk). */
  clearMissing: (tabId: string) => void;
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

    // Media tabs stream from asset:// and hold no text — never read the binary
    // to probe existence (it could be a multi-GB video). Existence-probe only;
    // an ambiguous probe error is treated conservatively (do NOT mark missing).
    if (ctx.isMedia(changedPath)) {
      try {
        if (!(await ctx.fileExists(changedPath))) ctx.handleDeletion(tabId);
      } catch {
        /* ambiguous probe error — leave the tab as-is, don't flag missing */
      }
      continue;
    }

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

/**
 * Route a coalesced batch of normalized workspace events onto the per-kind
 * handlers. Scope, self-write flagging, and no-op suppression already happened
 * upstream (the workspace event source), so this is pure routing.
 *
 * Rename handling: only *complete* [old, new] pairs go to {@link handleRenameEvent}
 * — mixing unpaired entries into its flat array would corrupt positional pairing;
 * unpaired renames (atomic-write targets) route as a modify. `getOpenPaths` is
 * re-read after renames because {@link FsChangeContext.applyRename} re-points tabs,
 * invalidating a pre-rename path map.
 */
export async function handleSemanticBatch(
  ctx: FsChangeContext,
  events: SemanticWorkspaceEvent[],
  getOpenPaths: () => Map<string, string>,
): Promise<void> {
  const renamed = events.filter((e) => e.kind === "renamed");
  const rest = events.filter((e) => e.kind !== "renamed");

  if (renamed.length > 0) {
    const openPaths = getOpenPaths();
    // Only *complete* pairs go to the flat-array handler — mixing unpaired
    // entries in would corrupt its positional [old, new] pairing.
    const pairs: string[] = [];
    for (const event of renamed) {
      if (event.previousPath !== undefined) pairs.push(event.previousPath, event.path);
    }
    if (pairs.length > 0) await handleRenameEvent(ctx, pairs, openPaths);
    // Unpaired renames (atomic-write targets / lone paths) each go through the
    // fallback individually — a single-element array can't be mis-paired, and
    // this preserves the probe semantics (readable → modify, gone → delete,
    // media → existence-only).
    for (const event of renamed) {
      if (event.previousPath === undefined) {
        await handleRenameEvent(ctx, [event.path], openPaths);
      }
    }
  }

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
      continue;
    }
    if (isMedia) {
      // A media `create` means a deleted file reappeared — clear missing so the
      // viewer re-streams via asset://. `modify` needs no action (the asset URL
      // already points at the fresh bytes). Never read the binary.
      if (event.kind === "created" && ctx.isMissing(tabId)) ctx.clearMissing(tabId);
      continue;
    }
    // created / modified
    await handleModifyOrCreateEvent(ctx, tabId, event.path);
  }
}
