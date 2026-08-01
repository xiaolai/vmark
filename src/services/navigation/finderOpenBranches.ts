/**
 * Purpose: EXECUTE a resolved Finder-open branch — activate, replace, create,
 * or new window — including the size gate, the progress indicator lifecycle,
 * and the media short-circuit.
 *
 * Extracted from `useFinderFileOpen`, which had reimplemented the replace and
 * create flows inside a `useEffect` closure. The copies had already drifted
 * from the navigation services they were copied from, and the drift was the
 * bug: no media short-circuit, no close-during-read guard, no dedup check.
 * None of it was testable without mounting the hook.
 *
 * Key decisions:
 *   - MEDIA IS CHECKED FIRST, before the size gate and before any read. A
 *     Finder-opened `.png` used to go straight to `readTextFile`, which fails
 *     on binary — so double-clicking an image in Finder errored instead of
 *     opening MediaViewer, while the identical file opened via Cmd+O worked.
 *     Media tabs are path-only, so they also skip the size route entirely:
 *     a 4 GB video is not "a large file to confirm", it is never read.
 *   - `createTab` DEDUPLICATES by path. When it hands back a tab that already
 *     existed — because a concurrent open created it — loading into it would
 *     overwrite that tab's content, which may be dirty. The create branch
 *     pre-checks with `findTabByPath`, which applies createTab's own rule, and
 *     activates instead of loading. The error path matters just as much:
 *     detaching on failure would have detached a tab this call never created.
 *   - `cancelled` is re-checked after every await. The hook can unmount
 *     mid-flow.
 *
 * @coordinates-with hooks/useFinderFileOpen.ts — the only caller
 * @coordinates-with services/navigation/openMediaFile.ts — the media branch
 * @module services/navigation/finderOpenBranches
 */
import { useTabStore } from "@/stores/tabStore";
import { useFileLoadStore } from "@/stores/documentStore";
import { openWorkspaceWithConfig } from "@/services/workspaces/openWorkspaceWithConfig";
import {
  isBinaryMediaPath,
  openMediaFileInNewTab,
  replaceTabWithMediaFile,
} from "@/services/navigation/openMediaFile";
import { applyFileOwnershipAfterOpen } from "@/services/workspaces/fileOwnership";
import { routeOpenBySize } from "@/services/navigation/largeFileRouting";
import { maybeMarkLargeMarkdownAsSource } from "@/lib/formats/markdownLargeFile";
import { shouldShowProgressIndicator } from "@/utils/fileSizeThresholds";
import { getFileName } from "@/utils/pathUtils";
import { finderFileOpenError } from "@/utils/debug";
import type { ReplaceableTabInfo } from "@/utils/openPolicy";

/** Collaborators the hook owns; passed in so this module stays testable. */
export interface FinderBranchContext {
  windowLabel: string;
  /** True once the hook has unmounted — re-checked after every await. */
  isCancelled: () => boolean;
  /** Show the localized "failed to open" toast. */
  onOpenFailure: (error: unknown) => void;
  /** Read the file into the tab. Throws on read failure. */
  loadFileIntoTab: (tabId: string, path: string) => Promise<void>;
}

/** Branch 1 — the file already has a tab. */
export function activateExistingTab(ctx: FinderBranchContext, tabId: string): void {
  useTabStore.getState().setActiveTab(ctx.windowLabel, tabId);
}

/**
 * Branch 2 — a single clean untitled tab exists; load into it. On read failure
 * the tab is left untouched, so the user gets their blank tab back.
 *
 * Returns the tab id that received content, or null if nothing landed.
 */
export async function replaceTabWithFile(
  ctx: FinderBranchContext,
  tab: ReplaceableTabInfo,
  path: string,
  workspaceRoot: string | null
): Promise<string | null> {
  if (workspaceRoot) {
    await openWorkspaceWithConfig(workspaceRoot, { windowLabel: ctx.windowLabel });
  }
  if (ctx.isCancelled()) return null;

  // Media never reaches readTextFile — it is a path-only viewer tab.
  if (isBinaryMediaPath(path)) {
    replaceTabWithMediaFile(tab.tabId, path);
    useTabStore.getState().setActiveTab(ctx.windowLabel, tab.tabId);
    return tab.tabId;
  }

  try {
    await ctx.loadFileIntoTab(tab.tabId, path);
    if (ctx.isCancelled()) return null;
    useTabStore.getState().updateTabPath(tab.tabId, path);
    applyFileOwnershipAfterOpen(tab.tabId, path);
  } catch (error) {
    finderFileOpenError("Failed to load file:", path, error);
    ctx.onOpenFailure(error);
    return null;
  }
  if (ctx.isCancelled()) return null;

  // Explicitly activate — the replaceable tab is likely already active (it is
  // the only one), but a concurrent crash-recovery tab could have stolen focus
  // during the await above.
  useTabStore.getState().setActiveTab(ctx.windowLabel, tab.tabId);
  return tab.tabId;
}

/**
 * Branch 3 — open as a new tab in this window.
 *
 * Returns the tab id that received content, or null when nothing landed
 * (read failure, cancellation, or a dedup that activated an existing tab).
 */
export async function createNewTabForFile(
  ctx: FinderBranchContext,
  path: string,
  workspaceRoot: string | null,
  adoptWorkspace: boolean
): Promise<string | null> {
  if (adoptWorkspace && workspaceRoot) {
    await openWorkspaceWithConfig(workspaceRoot, { windowLabel: ctx.windowLabel });
  }
  if (ctx.isCancelled()) return null;

  if (isBinaryMediaPath(path)) {
    // openMediaFileInNewTab does its own dedup handling and never reads bytes.
    openMediaFileInNewTab(ctx.windowLabel, path);
    return null; // path-only: no content landed, so no source-mode marking
  }

  // Would `createTab` deduplicate? `findTabByPath` applies the SAME rule
  // createTab applies internally — tab.filePath, normalized. The branch
  // resolver's `findExistingTabForPath` cannot answer this: it matches on the
  // DOCUMENT's path, which a concurrently-created tab does not have yet while
  // its own read is still in flight. That is exactly the racing case.
  const alreadyOpen = useTabStore.getState().findTabByPath(ctx.windowLabel, path);
  if (alreadyOpen) {
    // Loading into it would overwrite content that may be dirty, and the
    // failure path would detach a tab this call never created.
    useTabStore.getState().setActiveTab(ctx.windowLabel, alreadyOpen.id);
    return null;
  }

  const tabId = useTabStore.getState().createTab(ctx.windowLabel, path);

  try {
    await ctx.loadFileIntoTab(tabId, path);
    applyFileOwnershipAfterOpen(tabId, path);
  } catch (error) {
    finderFileOpenError("Failed to load file:", path, error);
    // detachTab, not closeTab: the "reopen closed tab" history stays reserved
    // for tabs the user actually closed.
    useTabStore.getState().detachTab(ctx.windowLabel, tabId);
    ctx.onOpenFailure(error);
    return null;
  }
  if (ctx.isCancelled()) return null;

  useTabStore.getState().setActiveTab(ctx.windowLabel, tabId);
  return tabId;
}

/**
 * Run a content branch through the shared indicator lifecycle, and decide the
 * size route.
 *
 * Media skips the size gate entirely: the file is never read, so there is
 * nothing to refuse or confirm and no progress to show.
 */
export async function withSizeGateAndIndicator(
  ctx: FinderBranchContext,
  path: string,
  run: () => Promise<string | null>
): Promise<void> {
  if (isBinaryMediaPath(path)) {
    await run();
    return;
  }

  const route = await routeOpenBySize(path);
  if (!route.proceed || ctx.isCancelled()) return;

  const showIndicator =
    !route.forceSourceMode && shouldShowProgressIndicator(route.sizeBytes);
  const indicatorId = showIndicator
    ? useFileLoadStore.getState().startLoad(getFileName(path) || path, route.sizeBytes)
    : null;

  const loadedTabId = await run();
  if (loadedTabId) {
    maybeMarkLargeMarkdownAsSource(loadedTabId, path, route.forceSourceMode);
  } else if (indicatorId !== null) {
    // Nothing landed (read failure, detached orphan, dedup) — clear the
    // indicator so no spinner is left stuck on screen.
    useFileLoadStore.getState().endLoad(indicatorId);
  }
}

