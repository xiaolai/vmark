/**
 * Save-on-close helper
 *
 * Shared save prompt + Save As flow for tab/window close.
 */

import { message, save } from "@tauri-apps/plugin-dialog";
import { getDefaultSaveFolderWithFallback } from "@/hooks/useDefaultSaveFolder";
import { saveToPath } from "@/utils/saveToPath";
import { joinPath } from "@/utils/pathUtils";

export interface CloseSaveContext {
  windowLabel: string;
  tabId: string;
  title: string;
  filePath: string | null;
  content: string;
}

export type CloseSaveResult =
  | { action: "saved"; path: string }
  | { action: "discarded" }
  | { action: "cancelled" };

/**
 * Prompt user to save a dirty document before closing.
 * Returns a tri-state result for callers to decide close behavior.
 */
export async function promptSaveForDirtyDocument(
  context: CloseSaveContext
): Promise<CloseSaveResult> {
  const { windowLabel, tabId, title, filePath, content } = context;

  // Use message() with 3-button dialog for proper cancel handling.
  // ask() only returns boolean, so dismiss/escape = "Don't Save" which loses work.
  // message() with yes/no/cancel buttons returns distinct values for each action.
  const result = await message(
    `Do you want to save changes to "${title}"?`,
    {
      title: "Unsaved Changes",
      kind: "warning",
      buttons: {
        yes: "Save",
        no: "Don't Save",
        cancel: "Cancel",
      },
    }
  );

  if (result === "Cancel") {
    return { action: "cancelled" };
  }

  if (result === "No") {
    return { action: "discarded" };
  }

  let path = filePath;
  if (!path) {
    // Pre-fill with title as filename (e.g., "Untitled-1.md")
    const defaultFolder = await getDefaultSaveFolderWithFallback(windowLabel);
    const filename = title.endsWith(".md") ? title : `${title}.md`;
    const defaultPath = joinPath(defaultFolder, filename);
    const newPath = await save({
      defaultPath,
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    if (!newPath) {
      return { action: "cancelled" };
    }
    path = newPath;
  }

  const saved = await saveToPath(tabId, path, content, "manual");
  if (!saved) {
    return { action: "cancelled" };
  }

  return { action: "saved", path };
}
