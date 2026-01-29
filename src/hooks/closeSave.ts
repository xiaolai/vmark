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

export type MultiSaveResult =
  | { action: "saved-all" }
  | { action: "discarded-all" }
  | { action: "cancelled" };

const CLOSE_SAVE_BUTTONS = {
  save: "Save",
  dontSave: "Don't Save",
  cancel: "Cancel",
} as const;

const MULTI_SAVE_BUTTONS = {
  saveAll: "Save All",
  dontSave: "Don't Save",
  cancel: "Cancel",
} as const;

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
        yes: CLOSE_SAVE_BUTTONS.save,
        no: CLOSE_SAVE_BUTTONS.dontSave,
        cancel: CLOSE_SAVE_BUTTONS.cancel,
      },
    }
  );

  // With custom buttons, plugin-dialog returns the clicked button label string.
  // With default buttons, it returns 'Yes' | 'No' | 'Cancel' | 'Ok'.
  if (result === "Cancel" || result === CLOSE_SAVE_BUTTONS.cancel) {
    return { action: "cancelled" };
  }

  if (result === "No" || result === CLOSE_SAVE_BUTTONS.dontSave) {
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

/**
 * Prompt user to save multiple dirty documents before closing/quitting.
 * Shows a summary dialog with Save All / Don't Save / Cancel.
 *
 * For "Save All":
 * - Files with paths are saved directly
 * - Untitled files prompt Save As individually
 *
 * Returns a tri-state result for callers to decide close behavior.
 */
export async function promptSaveForMultipleDocuments(
  contexts: CloseSaveContext[]
): Promise<MultiSaveResult> {
  if (contexts.length === 0) {
    return { action: "saved-all" };
  }

  // Build document list for display
  const docNames = contexts.map((c) => c.title).join("\n• ");
  const docCount = contexts.length;

  const result = await message(
    `You have ${docCount} unsaved document${docCount > 1 ? "s" : ""}:\n\n• ${docNames}`,
    {
      title: "Unsaved Changes",
      kind: "warning",
      buttons: {
        yes: MULTI_SAVE_BUTTONS.saveAll,
        no: MULTI_SAVE_BUTTONS.dontSave,
        cancel: MULTI_SAVE_BUTTONS.cancel,
      },
    }
  );

  if (result === "Cancel" || result === MULTI_SAVE_BUTTONS.cancel) {
    return { action: "cancelled" };
  }

  if (result === "No" || result === MULTI_SAVE_BUTTONS.dontSave) {
    return { action: "discarded-all" };
  }

  // Save All: save each document
  for (const context of contexts) {
    const { windowLabel, tabId, title, filePath, content } = context;

    let path = filePath;
    if (!path) {
      // Untitled file: prompt Save As
      const defaultFolder = await getDefaultSaveFolderWithFallback(windowLabel);
      const filename = title.endsWith(".md") ? title : `${title}.md`;
      const defaultPath = joinPath(defaultFolder, filename);
      const newPath = await save({
        defaultPath,
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      if (!newPath) {
        // User cancelled Save As - abort entire operation
        return { action: "cancelled" };
      }
      path = newPath;
    }

    const saved = await saveToPath(tabId, path, content, "manual");
    if (!saved) {
      return { action: "cancelled" };
    }
  }

  return { action: "saved-all" };
}
