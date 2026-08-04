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
import { z } from "zod";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { usePaneStore } from "@/stores/paneStore";
import { loadSplitLayout } from "@/services/persistence/splitLayoutPersistence";
import { findExistingTabForPath } from "@/services/tabs/findExistingTabForPath";
import { workspaceWarn } from "@/utils/debug";

/** WI-3: a restorable path is a non-empty string — everything else is skipped. */
const restorablePathSchema = z.string().min(1);

/**
 * Restore the given file paths as tabs in `windowLabel`. Paths that already
 * have an open tab are skipped (dedup). Unreadable paths (moved/deleted) are
 * skipped with a warning. The list comes from a persisted workspace config, so
 * it is untrusted (WI-3): wrong-typed entries are skipped, siblings restored.
 * Returns the number of tabs newly created.
 */
export async function restoreWorkspaceTabs(
  windowLabel: string,
  paths: readonly unknown[] | null | undefined,
): Promise<number> {
  if (!Array.isArray(paths) || paths.length === 0) return 0;

  let created = 0;
  for (const rawPath of paths) {
    const parsed = restorablePathSchema.safeParse(rawPath);
    if (!parsed.success) {
      workspaceWarn("Skipping non-restorable session tab path:", rawPath);
      continue;
    }
    const filePath = parsed.data;
    // Dedup guard: skip files already open in this window (e.g. hot-exit restore).
    if (findExistingTabForPath(windowLabel, filePath)) continue;

    try {
      const content = await readTextFile(filePath);
      const tabId = useTabStore.getState().createTab(windowLabel, filePath);
      // The disk-open door canonicalises AND derives line metadata.
      useDocumentStore.getState().ingestExternalContent(tabId, content, "disk-open", { filePath });
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
 * best-effort. Call AFTER restoreWorkspaceTabs so both panes' documents are
 * already open. Both pane paths are persisted, so restore is deterministic: the
 * primary is made active first, then the split opens with the secondary. If
 * either file isn't open (moved/closed since save) or they resolve to the same
 * tab, the split is skipped.
 */
export function restoreSplitLayout(windowLabel: string, rootPath: string): void {
  const layout = loadSplitLayout(rootPath);
  if (!layout) return;
  const primaryTabId = findExistingTabForPath(windowLabel, layout.primaryPath);
  const secondaryTabId = findExistingTabForPath(windowLabel, layout.secondaryPath);
  if (!primaryTabId || !secondaryTabId || primaryTabId === secondaryTabId) return;

  const pane = usePaneStore.getState();
  // openSplit captures the current active tab as the primary pane, so pin the
  // primary before opening rather than relying on restore order.
  useTabStore.getState().setActiveTab(windowLabel, primaryTabId);
  pane.openSplit(windowLabel, secondaryTabId);
  pane.setOrientation(windowLabel, layout.orientation);
  pane.setFraction(windowLabel, layout.fraction);
  if (layout.syncScroll) pane.toggleSyncScroll(windowLabel);
}
