/**
 * Purpose: Turn one system file-open request into the branch it should take,
 * then run that branch. The policy half is the pure `resolveFinderOpenBranch`;
 * this module owns only the async size-gate, the indicator lifecycle, and the
 * branch EXECUTION.
 *
 * Split out of `useFinderFileOpen`, which was carrying the event plumbing
 * (listen, queue-until-restore, serialize, drain the cold-start queue) AND this
 * dispatch in one `useEffect` closure. Two responsibilities, and the dispatch
 * half is the one with rules worth testing on its own.
 *
 * Key decisions:
 *   - The branch's `adoptWorkspace` verdict is passed down, never re-derived.
 *     Recomputing `!rootPath` at the call site re-adopts in rail mode, which
 *     the resolver deliberately refuses (#1330).
 *   - The replaceable tab is re-read AFTER the size route: it can be claimed
 *     while that await is in flight, and loading into a tab that is no longer
 *     the clean untitled one would overwrite a real document.
 *
 * @coordinates-with hooks/useFinderFileOpen.ts — the caller (event plumbing)
 * @coordinates-with services/navigation/finderOpenBranch.ts — branch selection
 * @coordinates-with services/navigation/finderOpenBranches.ts — branch execution
 * @module services/navigation/finderOpenDispatch
 */
import { invoke } from "@tauri-apps/api/core";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { getReplaceableTab, findExistingTabForPath } from "@/services/tabs/replaceableTab";
import { resolveFinderOpenBranch } from "@/services/navigation/finderOpenBranch";
import {
  activateExistingTab,
  createNewTabForFile,
  replaceTabWithFile,
  withSizeGateAndIndicator,
  type FinderBranchContext,
} from "@/services/navigation/finderOpenBranches";
import { routeOpenBySize } from "@/services/navigation/largeFileRouting";
import { finderFileOpenError } from "@/utils/debug";

/**
 * Branch 4 — different workspace, so open in a new window. The Rust command
 * validates the path and extends the fs scope for the spawned window.
 */
async function openFileInNewWindow(
  ctx: FinderBranchContext,
  path: string,
  workspaceRoot: string | null,
): Promise<void> {
  try {
    if (workspaceRoot) {
      await invoke("open_workspace_in_new_window", { workspaceRoot, filePath: path });
    } else {
      await invoke("open_file_in_new_window", { path });
    }
  } catch (error) {
    finderFileOpenError("Failed to open in new window:", path, error);
    ctx.onOpenFailure(error);
  }
}

/**
 * Dispatch one file-open to its branch and execute it.
 *
 * `finishDrainedBatch` marks a batch the Rust queue has already destructively
 * drained: it must land even if the hook unmounted mid-flight, because no
 * replacement mount can fetch it again.
 */
export async function dispatchFinderOpen(
  ctx: FinderBranchContext,
  path: string,
  workspaceRoot: string | null,
  finishDrainedBatch = false,
): Promise<void> {
  const runCtx = finishDrainedBatch ? { ...ctx, isCancelled: () => false } : ctx;
  const { windowLabel } = ctx;

  // Pre-read size check: applies to every non-activate branch below.
  // Refused files never create a tab or open a window; huge files confirm.
  // (Existing-tab activation skips the read, so resolve the branch first.)
  const branch = resolveFinderOpenBranch({
    filePath: path,
    existingTabId: findExistingTabForPath(windowLabel, path),
    replaceableTabId: getReplaceableTab(windowLabel)?.tabId ?? null,
    workspaceRailMode: useSettingsStore.getState().general.workspaceRailMode,
    currentRoot: useWorkspaceStore.getState().rootPath,
    incomingWorkspace: workspaceRoot,
  });

  switch (branch.kind) {
    case "activate":
      activateExistingTab(runCtx, branch.tabId);
      return;

    case "replace":
      await withSizeGateAndIndicator(runCtx, path, async () => {
        // Re-check: the replaceable tab could have been claimed during the
        // awaited size route. Fall back to a new tab if it is gone.
        const tab = getReplaceableTab(windowLabel);
        return tab
          ? replaceTabWithFile(runCtx, tab, path, workspaceRoot, branch.adoptWorkspace)
          : createNewTabForFile(runCtx, path, workspaceRoot, branch.adoptWorkspace);
      });
      return;

    case "create":
      await withSizeGateAndIndicator(runCtx, path, () =>
        createNewTabForFile(runCtx, path, workspaceRoot, branch.adoptWorkspace),
      );
      return;

    case "newWindow": {
      // The remote window runs its own size route when its cold-start queue
      // drains, so no tab is marked here — none exists in this window.
      const route = await routeOpenBySize(path);
      if (!route.proceed || runCtx.isCancelled()) return;
      await openFileInNewWindow(runCtx, path, workspaceRoot);
      return;
    }
  }
}
