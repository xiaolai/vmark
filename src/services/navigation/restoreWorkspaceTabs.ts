/**
 * restoreWorkspaceTabs — shared workspace tab-restoration loop.
 *
 * Opening a workspace (via the Open Workspace command, Open Recent Workspace,
 * or bootstrap) restores its previously open files into tabs. This helper is
 * the single source of truth for that loop so the three call sites can't drift
 * apart in dedup safeguards, document init, or line-metadata handling.
 *
 * Key decision — dedup guard: skips any path that already has an open tab
 * (e.g. restored by hot exit), so restoration never creates a duplicate tab
 * for an already-loaded file. The command paths previously omitted this guard.
 *
 * @module services/navigation/restoreWorkspaceTabs
 */

import { readTextFile } from "@tauri-apps/plugin-fs";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { usePaneStore } from "@/stores/paneStore";
import { loadSplitLayout } from "@/services/persistence/splitLayoutPersistence";
import { findExistingTabForPath } from "@/services/tabs/findExistingTabForPath";
import { detectLinebreaks } from "@/utils/linebreakDetection";
import { workspaceWarn } from "@/utils/debug";

/**
 * Restore the given file paths as tabs in `windowLabel`. Paths that already
 * have an open tab are skipped (dedup). Unreadable paths (moved/deleted) are
 * skipped with a warning. Returns the number of tabs newly created.
 */
export async function restoreWorkspaceTabs(
  windowLabel: string,
  paths: readonly string[] | null | undefined,
): Promise<number> {
  if (!paths || paths.length === 0) return 0;

  let created = 0;
  for (const filePath of paths) {
    // Dedup guard: skip files already open in this window (e.g. hot-exit restore).
    if (findExistingTabForPath(windowLabel, filePath)) continue;

    try {
      const content = await readTextFile(filePath);
      const tabId = useTabStore.getState().createTab(windowLabel, filePath);
      useDocumentStore.getState().initDocument(tabId, content, filePath);
      useDocumentStore.getState().setLineMetadata(tabId, detectLinebreaks(content));
      created += 1;
    } catch {
      // File may have been moved/deleted — skip it.
      workspaceWarn(`Could not restore tab: ${filePath}`);
    }
  }
  return created;
}

/**
 * Restore the persisted two-pane split layout for `rootPath` (#1081),
 * best-effort. Call AFTER restoreWorkspaceTabs so the secondary pane's document
 * is already open. If the secondary file isn't open (moved/closed since save),
 * the split is skipped. The primary pane is whatever document is active.
 */
export function restoreSplitLayout(windowLabel: string, rootPath: string): void {
  const layout = loadSplitLayout(rootPath);
  if (!layout) return;
  const tabId = findExistingTabForPath(windowLabel, layout.secondaryPath);
  if (!tabId) return;
  const pane = usePaneStore.getState();
  pane.openSplit(windowLabel, tabId);
  pane.setOrientation(windowLabel, layout.orientation);
  pane.setFraction(windowLabel, layout.fraction);
  if (layout.syncScroll) pane.toggleSyncScroll(windowLabel);
}
