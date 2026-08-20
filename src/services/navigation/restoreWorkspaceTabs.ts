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
import { useTabStore, tabFilePath } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { usePaneStore } from "@/stores/paneStore";
import { loadSplitLayout } from "@/services/persistence/splitLayoutPersistence";
import { findExistingTabForPath } from "@/services/tabs/findExistingTabForPath";
import { getReplaceableTab } from "@/services/tabs/replaceableTab";
import { workspaceWarn } from "@/utils/debug";

/**
 * Is `tabId` STILL the clean untitled tab it was when we probed for it?
 *
 * The probe happens before the file reads and the close happens after, so the
 * verdict in between is stale by construction: `await readTextFile` yields, and
 * in that window the user can type into the tab, save it, or close it. Acting
 * on the old verdict would discard their work — the one outcome this cleanup
 * must never produce. So the decision to close is re-derived from live state at
 * the moment of closing, and a tab that has changed in any way is left alone.
 */
function stillReplaceable(windowLabel: string, tabId: string): boolean {
  const tab = (useTabStore.getState().tabs[windowLabel] ?? []).find((t) => t.id === tabId);
  if (!tab || tab.kind !== "document" || tabFilePath(tab) !== null) return false;
  return !(useDocumentStore.getState().documents[tabId]?.isDirty ?? false);
}

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

  // #1313 — probe for the startup blank tab BEFORE creating anything, because
  // "replaceable" means "the ONLY tab", and the first restored file destroys
  // that property. Closing happens after, and only if something was restored.
  const replaceable = getReplaceableTab(windowLabel);

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

    let content: string;
    try {
      content = await readTextFile(filePath);
    } catch {
      // Read failure only: the file was moved or deleted. Nothing was created,
      // so there is nothing to roll back. Kept separate from the block below so
      // a post-create failure cannot be mislabelled as an unreadable file.
      workspaceWarn(`Could not restore tab: ${filePath}`);
      continue;
    }

    // Re-check dedup AFTER the read, not just before it. The verdict above was
    // taken before an await, and in that window another opener (hot-exit
    // restore, a Finder open, the user) can create a tab for this same path.
    // `createTab` would then dedup and hand back THEIR tab, and the ingest
    // below would overwrite its contents — the read is what makes the earlier
    // check stale, so the check has to happen on this side of it.
    if (findExistingTabForPath(windowLabel, filePath)) continue;

    const tabId = useTabStore.getState().createTab(windowLabel, filePath);
    try {
      // The disk-open door canonicalises AND derives line metadata.
      useDocumentStore.getState().ingestExternalContent(tabId, content, "disk-open", { filePath });
      created += 1;
    } catch (error) {
      // The file read fine — this is a real failure after the tab exists. Roll
      // the tab back rather than leaving an orphan with no document, and
      // surface the actual error instead of hiding it as "file moved".
      useTabStore.getState().closeTab(windowLabel, tabId);
      workspaceWarn(`Failed to initialise restored tab: ${filePath}`, error);
    }
  }

  // #1313 — the blank Untitled tab the window launched with is orphaned beside
  // the workspace's files: the dedup guard above matches on PATH, and this
  // tab's path is null, so it can never be matched.
  //
  // `getReplaceableTab` is the EXISTING policy for this — the only tab,
  // untitled, and clean — and every file-open path already honours it
  // (`fileOpen`, Finder open, drag-drop, recent files). This loop was the one
  // seam that bypassed it, so applying it here fixes all three workspace call
  // sites at once rather than patching `openWorkspaceByPath` alone.
  //
  // Guarded on `created`: a workspace whose files have all been moved restores
  // nothing, and closing the user's tab to show them an empty window would be
  // a worse outcome than the orphan.
  if (created > 0 && replaceable && stillReplaceable(windowLabel, replaceable.tabId)) {
    useTabStore.getState().closeTab(windowLabel, replaceable.tabId);
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
  // Toggle, not assign: `openSplit` preserves the previous pane state, so a
  // persisted `true` INVERTS an already-true state to false, and a persisted
  // `false` leaves a stale `true` standing. Read the live value and only toggle
  // when it disagrees, so restore lands on the persisted value either way.
  // `getSplit` reads live state — `usePaneStore.getState()` was captured into
  // `pane` before openSplit/setOrientation/setFraction ran, so re-read it.
  if (usePaneStore.getState().getSplit(windowLabel).syncScroll !== Boolean(layout.syncScroll)) {
    pane.toggleSyncScroll(windowLabel);
  }
}
