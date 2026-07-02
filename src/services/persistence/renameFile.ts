/**
 * renameFile — shared file-rename core
 *
 * Purpose: Rename a file/folder on disk and reconcile any open tabs/documents
 * that pointed at the old path. Single source of truth for rename semantics so
 * the File Explorer (tree node) and the tab context menu behave identically.
 *
 * Key decisions:
 *   - Preserves the `.md` extension for files when the user omits it.
 *   - Refuses to overwrite an existing target (returns `exists`, no write).
 *   - Reconciles open tabs via reconcilePathChange + applyPathReconciliation,
 *     which also refreshes each affected tab's title (tabStore.updateTabPath).
 *   - Returns a discriminated outcome instead of throwing, so callers choose
 *     how to surface each case (dialog in the explorer, toast on a tab).
 *
 * @coordinates-with utils/pathReconciliation.ts — pure open-tab reconciliation
 * @coordinates-with hooks/commands/applyPathReconciliation.ts — applies results
 * @coordinates-with components/Sidebar/FileExplorer/useExplorerOperations.ts — explorer caller
 * @coordinates-with components/Tabs/TabRenameInput.tsx — tab context-menu caller
 * @module services/persistence/renameFile
 */
import { rename, exists } from "@tauri-apps/plugin-fs";
import { basename, join } from "@tauri-apps/api/path";
import { useTabStore } from "@/stores/tabStore";
import { reconcilePathChange } from "@/utils/pathReconciliation";
import { applyPathReconciliation } from "./applyPathReconciliation";

/** Result of a rename attempt. Callers surface each case as they see fit. */
export type RenameOutcome =
  | { status: "renamed"; newPath: string }
  | { status: "unchanged"; path: string }
  | { status: "exists"; name: string; isFile: boolean }
  | { status: "error"; error: unknown };

/**
 * Rename the item at `oldPath` to `newName` (a bare name, not a path).
 * Open tabs/documents pointing at the old path are reconciled to the new path.
 */
export async function renameFile(
  oldPath: string,
  newName: string,
): Promise<RenameOutcome> {
  try {
    const oldName = await basename(oldPath);
    const parentPath = oldPath.slice(0, -oldName.length - 1);

    // Preserve the .md extension for files (folders keep the raw name).
    const isFile = !oldPath.endsWith("/") && oldName.includes(".");
    const finalName = isFile && !newName.endsWith(".md") ? `${newName}.md` : newName;

    const newPath = await join(parentPath, finalName);
    if (oldPath === newPath) return { status: "unchanged", path: oldPath };

    if (await exists(newPath)) {
      return { status: "exists", name: finalName, isFile: finalName.includes(".") };
    }

    // Capture open paths before the move so reconciliation can match them.
    const openFilePaths = useTabStore.getState().getAllOpenFilePaths();
    await rename(oldPath, newPath);
    applyPathReconciliation(
      reconcilePathChange({ changeType: "rename", oldPath, newPath, openFilePaths }),
    );

    return { status: "renamed", newPath };
  } catch (error) {
    return { status: "error", error };
  }
}
