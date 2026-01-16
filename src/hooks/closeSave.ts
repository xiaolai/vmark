/**
 * Save-on-close helper
 *
 * Shared save prompt + Save As flow for tab/window close.
 */

import { ask, save } from "@tauri-apps/plugin-dialog";
import { getDefaultSaveFolderWithFallback } from "@/hooks/useDefaultSaveFolder";
import { saveToPath } from "@/utils/saveToPath";

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

  const shouldSave = await ask(
    `Do you want to save changes to "${title}"?`,
    {
      title: "Unsaved Changes",
      kind: "warning",
      okLabel: "Save",
      cancelLabel: "Don't Save",
    }
  );

  if (shouldSave === null) {
    return { action: "cancelled" };
  }

  if (!shouldSave) {
    return { action: "discarded" };
  }

  let path = filePath;
  if (!path) {
    const defaultFolder = await getDefaultSaveFolderWithFallback(windowLabel);
    const newPath = await save({
      defaultPath: defaultFolder,
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
