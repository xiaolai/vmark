/**
 * renameFile — shared file-rename core
 *
 * Purpose: Rename a file/folder on disk and reconcile any open tabs/documents
 * that pointed at the old path. Single source of truth for rename semantics so
 * the File Explorer (tree node) and the tab context menu behave identically.
 *
 * Key decisions:
 *   - Preserves the file's ORIGINAL extension when the submitted name omits
 *     one (a rename input that prefilled the extensionless name, so
 *     "notes.txt" + "notes2" → "notes2.txt"); an explicitly typed extension
 *     wins as-is. Callers whose editor SHOWED the extension pass
 *     `preserveExtension: false` — otherwise deleting the suffix is silently
 *     undone and the rename reports success without moving anything (#1224).
 *   - Folder-ness comes from the caller's `isFolder` flag when known, else a
 *     filesystem stat — never from name heuristics (a folder named
 *     "v2.0-drafts" is not a file).
 *   - `newName` must be a bare name: empty/whitespace-only names, path
 *     separators, NUL bytes, and "."/".." are rejected with an `error`
 *     outcome BEFORE any filesystem access — a separator or ".." would
 *     silently MOVE the file instead of renaming it.
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
import { rename, exists, stat } from "@tauri-apps/plugin-fs";
import { basename, dirname, join } from "@tauri-apps/api/path";
import { useTabStore } from "@/stores/tabStore";
import { reconcilePathChange } from "@/utils/pathReconciliation";
import { applyPathReconciliation } from "./applyPathReconciliation";

/** Result of a rename attempt. Callers surface each case as they see fit. */
export type RenameOutcome =
  | { status: "renamed"; newPath: string }
  | { status: "unchanged"; path: string }
  | { status: "exists"; name: string; isFile: boolean }
  | { status: "error"; error: unknown };

/** Options for {@link renameFile}. */
export interface RenameOptions {
  /** Whether `oldPath` is a folder. Callers that know (e.g. tree nodes carry
   *  `isFolder`) should pass it; when omitted, a filesystem stat decides. */
  isFolder?: boolean;
  /**
   * Whether to re-attach the original extension when `newName` omits one.
   * Defaults to true, which is correct only when the editor HID the extension
   * and the user was therefore editing a stem. Pass false when the editor
   * showed the full name (#1224): there, deleting the suffix is a deliberate
   * rename, and re-attaching silently discards it — the file does not move and
   * the caller still sees success.
   */
  preserveExtension?: boolean;
}

/**
 * The extension of `name` including its leading dot, or "" when there is
 * none. The split is at the LAST dot; a dot at position 0 (dotfiles like
 * `.gitignore`) does not count as an extension.
 */
export function fileExtensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot) : "";
}

/**
 * Why `newName` cannot be used as a file/folder name, or null when it can.
 * Joined unvalidated, a separator or ".." would MOVE the file; "" or "."
 * would resolve to the parent itself.
 */
function invalidNameReason(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed === "") return "name is empty";
  if (/[/\\]/.test(name)) return "name contains a path separator";
  if (name.includes("\0")) return "name contains a NUL byte";
  if (trimmed === "." || trimmed === "..") return "name is a reserved path";
  return null;
}

/**
 * Rename the item at `oldPath` to `newName` (a bare name, not a path).
 * Open tabs/documents pointing at the old path are reconciled to the new path.
 */
export async function renameFile(
  oldPath: string,
  newName: string,
  options: RenameOptions = {},
): Promise<RenameOutcome> {
  const reason = invalidNameReason(newName);
  if (reason) {
    return {
      status: "error",
      error: new Error(`Invalid name ${JSON.stringify(newName)}: ${reason}`),
    };
  }
  try {
    const oldName = await basename(oldPath);
    // dirname, not string slicing: slicing yields "" for root-level paths,
    // and join("", name) produces a RELATIVE path.
    const parentPath = await dirname(oldPath);

    const isFolder = options.isFolder ?? (await stat(oldPath)).isDirectory;

    // Preserve the file's original extension when the submitted name has no
    // extension of its own AND the editor prefilled an extensionless name;
    // an explicitly typed extension wins. Folders keep the raw name.
    const preserveExtension = options.preserveExtension ?? true;
    const finalName =
      preserveExtension && !isFolder && fileExtensionOf(newName) === ""
        ? `${newName}${fileExtensionOf(oldName)}`
        : newName;

    const newPath = await join(parentPath, finalName);
    if (oldPath === newPath) return { status: "unchanged", path: oldPath };

    if (await exists(newPath)) {
      return { status: "exists", name: finalName, isFile: !isFolder };
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
