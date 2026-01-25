/**
 * Default save folder hook
 *
 * Gathers data from stores and Tauri APIs, then calls
 * the pure resolver in utils/defaultSaveFolder.
 *
 * @module hooks/useDefaultSaveFolder
 */
import { documentDir, homeDir } from "@tauri-apps/api/path";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { resolveDefaultSaveFolder } from "@/utils/defaultSaveFolder";

/**
 * Get the default save folder with fallback logic.
 *
 * Gathers workspace state, tab paths, and Documents directory,
 * then delegates to pure resolver.
 *
 * Precedence:
 * 1. Workspace root - if the window is in workspace mode
 * 2. Documents directory - when not in workspace mode
 * 3. Home directory - final fallback if Documents unavailable
 *
 * @param windowLabel - The window label to check for saved tabs
 * @returns The resolved default folder path
 *
 * @example
 * const folder = await getDefaultSaveFolderWithFallback("main");
 */
export async function getDefaultSaveFolderWithFallback(
  windowLabel: string
): Promise<string> {
  // Gather workspace state
  const { isWorkspaceMode, rootPath } = useWorkspaceStore.getState();

  // Gather saved file paths from tabs
  const tabs = useTabStore.getState().tabs[windowLabel] ?? [];
  const savedFilePaths: string[] = [];
  for (const tab of tabs) {
    const doc = useDocumentStore.getState().getDocument(tab.id);
    if (doc?.filePath) {
      savedFilePaths.push(doc.filePath);
    }
  }

  // Get Documents directory (preferred) with fallback to home directory
  let fallbackDirectory: string;
  try {
    fallbackDirectory = await documentDir();
  } catch {
    fallbackDirectory = await homeDir();
  }

  // Delegate to pure resolver
  return resolveDefaultSaveFolder({
    isWorkspaceMode,
    workspaceRoot: rootPath,
    savedFilePaths,
    fallbackDirectory,
  });
}
