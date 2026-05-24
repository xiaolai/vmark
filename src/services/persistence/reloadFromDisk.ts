/**
 * Shared helper for reloading a tab's document from disk.
 *
 * Used by:
 * - useExternalFileChanges (auto-reload, user-confirmed reload)
 * - MCP bridge workspaceHandlers (workspace.reloadDocument)
 */

import { readTextFile } from "@tauri-apps/plugin-fs";
import { useDocumentStore } from "@/stores/documentStore";
import { detectLinebreaks } from "@/utils/linebreakDetection";

/**
 * Reload a tab's document content from disk.
 *
 * Reads the file, detects linebreak style, updates the document store,
 * and clears any "missing" flag.
 *
 * @throws If readTextFile fails (e.g. file deleted)
 */
export async function reloadTabFromDisk(tabId: string, filePath: string): Promise<void> {
  const content = await readTextFile(filePath);
  const docStore = useDocumentStore.getState();
  docStore.loadContent(tabId, content, filePath, detectLinebreaks(content));
  docStore.clearMissing(tabId);
}
