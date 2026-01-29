/**
 * Save-on-close helper
 *
 * Shared save prompt + Save As flow for tab/window close.
 */

import { message, save, open } from "@tauri-apps/plugin-dialog";
import { getDefaultSaveFolderWithFallback } from "@/hooks/useDefaultSaveFolder";
import { saveToPath } from "@/utils/saveToPath";
import { joinPath, getDirectory } from "@/utils/pathUtils";

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

export interface MultiSaveOptions {
  /** Called before saving each document, 1-indexed */
  onProgress?: (current: number, total: number, title: string) => void;
}

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

const MARKDOWN_FILTERS = [{ name: "Markdown", extensions: ["md"] }];

/**
 * Sanitize a title for use as a filename.
 * Removes/replaces characters that are invalid in filenames.
 */
function toSafeFilename(title: string): string {
  // Replace characters invalid on Windows/macOS/Linux
  // Invalid: / \ : * ? " < > |
  return title
    .replace(/[/\\:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim() || "Untitled";
}

/**
 * Ensure filename ends with .md extension.
 */
function ensureMarkdownExtension(filename: string): string {
  return filename.endsWith(".md") ? filename : `${filename}.md`;
}

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

  // Explicitly handle each expected result to avoid falling through on unexpected values
  if (result === "Cancel" || result === CLOSE_SAVE_BUTTONS.cancel) {
    return { action: "cancelled" };
  }

  if (result === "No" || result === CLOSE_SAVE_BUTTONS.dontSave) {
    return { action: "discarded" };
  }

  // Only proceed with save if user explicitly chose Save
  if (result !== "Yes" && result !== CLOSE_SAVE_BUTTONS.save) {
    // Unexpected dialog result - treat as cancelled for safety
    return { action: "cancelled" };
  }

  let path = filePath;
  if (path == null) {
    // Pre-fill with sanitized title as filename
    const defaultFolder = await getDefaultSaveFolderWithFallback(windowLabel);
    const filename = ensureMarkdownExtension(toSafeFilename(title));
    const defaultPath = joinPath(defaultFolder, filename);
    const newPath = await save({
      defaultPath,
      filters: MARKDOWN_FILTERS,
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
 * Format a document entry for display in the summary dialog.
 * Shows path for saved docs, "(new)" for untitled docs.
 */
function formatDocEntry(context: CloseSaveContext): string {
  if (context.filePath) {
    // Show filename with parent directory for context
    const dir = getDirectory(context.filePath);
    const parentDir = getDirectory(dir);
    const shortPath = parentDir
      ? `…/${dir.split(/[/\\]/).pop()}/${context.title}`
      : context.filePath;
    return shortPath;
  }
  return `${context.title} (new)`;
}

/**
 * Prompt user to save multiple dirty documents before closing/quitting.
 * Shows a summary dialog with Save All / Don't Save / Cancel.
 *
 * For "Save All":
 * - Files with paths are saved directly
 * - Untitled files: batch Save As (choose folder once, auto-name files)
 *
 * Returns a tri-state result for callers to decide close behavior.
 */
export async function promptSaveForMultipleDocuments(
  contexts: CloseSaveContext[],
  options: MultiSaveOptions = {}
): Promise<MultiSaveResult> {
  if (contexts.length === 0) {
    return { action: "saved-all" };
  }

  const { onProgress } = options;

  // Separate saved docs from untitled docs
  const savedDocs = contexts.filter((c) => c.filePath);
  const untitledDocs = contexts.filter((c) => !c.filePath);

  // Build document list for display with paths and "(new)" indicators
  const docEntries = contexts.map((c) => formatDocEntry(c));
  const docList = docEntries.join("\n• ");
  const docCount = contexts.length;

  // Build message with untitled count hint
  let msg = `You have ${docCount} unsaved document${docCount > 1 ? "s" : ""}:\n\n• ${docList}`;
  if (untitledDocs.length > 0) {
    msg += `\n\n${untitledDocs.length} new document${untitledDocs.length > 1 ? "s" : ""} will need a save location.`;
  }

  const result = await message(msg, {
    title: "Unsaved Changes",
    kind: "warning",
    buttons: {
      yes: MULTI_SAVE_BUTTONS.saveAll,
      no: MULTI_SAVE_BUTTONS.dontSave,
      cancel: MULTI_SAVE_BUTTONS.cancel,
    },
  });

  if (result === "Cancel" || result === MULTI_SAVE_BUTTONS.cancel) {
    return { action: "cancelled" };
  }

  if (result === "No" || result === MULTI_SAVE_BUTTONS.dontSave) {
    return { action: "discarded-all" };
  }

  // Only proceed with save if user explicitly chose Save All
  if (result !== "Yes" && result !== MULTI_SAVE_BUTTONS.saveAll) {
    return { action: "cancelled" };
  }

  // Save All: first save docs with existing paths
  let current = 0;
  const total = contexts.length;

  for (const context of savedDocs) {
    current++;
    onProgress?.(current, total, context.title);

    const saved = await saveToPath(
      context.tabId,
      context.filePath!,
      context.content,
      "manual"
    );
    if (!saved) {
      return { action: "cancelled" };
    }
  }

  // Batch Save As for untitled docs: choose folder once
  if (untitledDocs.length > 0) {
    // Get default folder for the first untitled doc
    const defaultFolder = await getDefaultSaveFolderWithFallback(
      untitledDocs[0].windowLabel
    );

    if (untitledDocs.length === 1) {
      // Single untitled: standard Save As dialog
      const doc = untitledDocs[0];
      current++;
      onProgress?.(current, total, doc.title);

      const filename = ensureMarkdownExtension(toSafeFilename(doc.title));
      const defaultPath = joinPath(defaultFolder, filename);
      const newPath = await save({
        defaultPath,
        filters: MARKDOWN_FILTERS,
      });
      if (!newPath) {
        return { action: "cancelled" };
      }

      const saved = await saveToPath(doc.tabId, newPath, doc.content, "manual");
      if (!saved) {
        return { action: "cancelled" };
      }
    } else {
      // Multiple untitled: batch folder picker
      const folderPath = await open({
        directory: true,
        multiple: false,
        defaultPath: defaultFolder,
        title: `Choose folder for ${untitledDocs.length} new documents`,
      });

      if (!folderPath || typeof folderPath !== "string") {
        return { action: "cancelled" };
      }

      // Save each untitled doc to the chosen folder
      for (const doc of untitledDocs) {
        current++;
        onProgress?.(current, total, doc.title);

        const filename = ensureMarkdownExtension(toSafeFilename(doc.title));
        const path = joinPath(folderPath, filename);

        const saved = await saveToPath(doc.tabId, path, doc.content, "manual");
        if (!saved) {
          return { action: "cancelled" };
        }
      }
    }
  }

  return { action: "saved-all" };
}

/**
 * Save all documents without prompting.
 * Used by "Save All and Quit" to skip the confirmation dialog.
 *
 * For untitled files with multiple docs, prompts for folder once.
 */
export async function saveAllDocuments(
  contexts: CloseSaveContext[],
  options: MultiSaveOptions = {}
): Promise<MultiSaveResult> {
  if (contexts.length === 0) {
    return { action: "saved-all" };
  }

  const { onProgress } = options;

  const savedDocs = contexts.filter((c) => c.filePath);
  const untitledDocs = contexts.filter((c) => !c.filePath);

  let current = 0;
  const total = contexts.length;

  // Save docs with existing paths
  for (const context of savedDocs) {
    current++;
    onProgress?.(current, total, context.title);

    const saved = await saveToPath(
      context.tabId,
      context.filePath!,
      context.content,
      "manual"
    );
    if (!saved) {
      return { action: "cancelled" };
    }
  }

  // Handle untitled docs
  if (untitledDocs.length > 0) {
    const defaultFolder = await getDefaultSaveFolderWithFallback(
      untitledDocs[0].windowLabel
    );

    if (untitledDocs.length === 1) {
      const doc = untitledDocs[0];
      current++;
      onProgress?.(current, total, doc.title);

      const filename = ensureMarkdownExtension(toSafeFilename(doc.title));
      const defaultPath = joinPath(defaultFolder, filename);
      const newPath = await save({
        defaultPath,
        filters: MARKDOWN_FILTERS,
      });
      if (!newPath) {
        return { action: "cancelled" };
      }

      const saved = await saveToPath(doc.tabId, newPath, doc.content, "manual");
      if (!saved) {
        return { action: "cancelled" };
      }
    } else {
      const folderPath = await open({
        directory: true,
        multiple: false,
        defaultPath: defaultFolder,
        title: `Choose folder for ${untitledDocs.length} new documents`,
      });

      if (!folderPath || typeof folderPath !== "string") {
        return { action: "cancelled" };
      }

      for (const doc of untitledDocs) {
        current++;
        onProgress?.(current, total, doc.title);

        const filename = ensureMarkdownExtension(toSafeFilename(doc.title));
        const path = joinPath(folderPath, filename);

        const saved = await saveToPath(doc.tabId, path, doc.content, "manual");
        if (!saved) {
          return { action: "cancelled" };
        }
      }
    }
  }

  return { action: "saved-all" };
}
