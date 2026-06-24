/**
 * Default Save Folder Hook
 *
 * Purpose: Gathers workspace state and Tauri path APIs, then calls the
 *   pure resolver to determine the default save folder — workspace root,
 *   sibling tab folder, or Documents/home directory fallback.
 *
 * @coordinates-with defaultSaveFolder.ts — pure resolution logic
 * @module hooks/useDefaultSaveFolder
 */
import { documentDir, homeDir } from "@tauri-apps/api/path";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { getActiveWorkspaceScope } from "@/services/workspaces/activeWorkspaceScope";
import { resolveDefaultSaveFolder } from "@/utils/defaultSaveFolder";

/**
 * Get the default save folder with fallback logic.
 *
 * Gathers workspace state, tab paths, and Documents directory,
 * then delegates to pure resolver.
 *
 * Precedence:
 * 1. Workspace root - if the window is in workspace mode
 * 2. Sibling tab folder - first saved file's directory
 * 3. Documents/Home directory - fallback (empty string if both path APIs reject)
 *
 * @param windowLabel - The window label to check for saved tabs
 * @returns The resolved default folder path (never rejects)
 *
 * @example
 * const folder = await getDefaultSaveFolderWithFallback("main");
 */
export async function getDefaultSaveFolderWithFallback(
  windowLabel: string
): Promise<string> {
  const workspaceScope = getActiveWorkspaceScope(windowLabel);

  // Gather saved file paths from tabs
  const tabs = useTabStore.getState().tabs[windowLabel] ?? [];
  const savedFilePaths: string[] = [];
  for (const tab of tabs) {
    const doc = useDocumentStore.getState().getDocument(tab.id);
    if (doc?.filePath) {
      savedFilePaths.push(doc.filePath);
    }
  }

  // Get Documents directory (preferred) with fallback to home directory.
  // If BOTH path APIs reject (sandbox/permission denial, headless env), fall
  // back to an empty string so the Save As flow still resolves and can open a
  // native dialog at the OS default location — never reject the whole save.
  let fallbackDirectory: string;
  try {
    fallbackDirectory = await documentDir();
  } catch {
    try {
      fallbackDirectory = await homeDir();
    } catch {
      fallbackDirectory = "";
    }
  }

  // Delegate to pure resolver
  return resolveDefaultSaveFolder({
    isWorkspaceMode: workspaceScope.isWorkspaceMode,
    workspaceRoot: workspaceScope.rootPath,
    savedFilePaths,
    fallbackDirectory,
  });
}
