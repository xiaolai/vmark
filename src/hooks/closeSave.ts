/**
 * Save-on-Close Helper
 *
 * Purpose: Shared save prompt and Save As flow used by both tab-close
 *   and window-close handlers — ensures consistent dirty-document UX.
 *
 * Pipeline: Tab/window close request → decideOnClose() (utils) → if "prompt"
 *   → this module shows native dialog → user chooses Save/Discard/Cancel
 *   → returns CloseSaveResult for caller to act on
 *
 * Key decisions:
 *   - Single-doc prompt returns per-file result; multi-doc prompt returns aggregate
 *   - Save As for untitled docs uses getDefaultSaveFolderWithFallback()
 *   - Never calls store mutations directly — returns result for caller to handle
 *
 * @coordinates-with useWindowClose.ts — calls promptSaveForMultipleDocuments
 * @coordinates-with useTabOperations.ts — calls promptSaveForDirtyDocument
 * @module hooks/closeSave
 */

import { message, save, open } from "@tauri-apps/plugin-dialog";
import i18n from "@/i18n";
import { getDefaultSaveFolderWithFallback } from "@/hooks/useDefaultSaveFolder";
import { saveToPath } from "@/utils/saveToPath";
import { joinPath, getDirectory } from "@/utils/pathUtils";

/** Context describing a dirty document that may need saving before close. */
export interface CloseSaveContext {
  windowLabel: string;
  tabId: string;
  title: string;
  filePath: string | null;
  content: string;
}

/** Result of a single-document save prompt: saved (with path), discarded, or cancelled. */
export type CloseSaveResult =
  | { action: "saved"; path: string }
  | { action: "discarded" }
  | { action: "cancelled" };

/** Result of a multi-document save prompt: all saved, all discarded, or cancelled. */
export type MultiSaveResult =
  | { action: "saved-all" }
  | { action: "discarded-all" }
  | { action: "cancelled" };

/** Options for multi-document save operations. */
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

// WI-1B.8 — derive Save dialog filters per-tab from the format
// registry. Untitled tabs default to markdown (the canonical "Save As"
// flow); existing tabs use their format's adapter filters.
import {
  dispatchEditor,
  getFormatById,
} from "@/lib/formats/registry";

const MARKDOWN_FALLBACK_FILTERS = [
  { name: "Markdown", extensions: ["md"] },
];

function saveFiltersForFilePath(
  filePath: string | null,
): { name: string; extensions: string[] }[] {
  try {
    const cfg = filePath
      ? dispatchEditor(filePath)
      : (getFormatById("markdown") ?? dispatchEditor(null));
    return cfg.adapters.saveDialogFilters.map((f) => ({
      name: f.name,
      extensions: [...f.extensions],
    }));
  } catch {
    /* registry not bootstrapped (test edge) — preserve prior behavior */
    return MARKDOWN_FALLBACK_FILTERS.map((f) => ({
      ...f,
      extensions: [...f.extensions],
    }));
  }
}

function untitledExtensionForFilePath(filePath: string | null): string {
  try {
    const cfg = filePath
      ? dispatchEditor(filePath)
      : (getFormatById("markdown") ?? dispatchEditor(null));
    return cfg.adapters.untitledExtension;
  } catch {
    /* registry not bootstrapped — preserve prior `.md` default */
    return "md";
  }
}


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
 * Ensure filename ends with the default extension for `filePath`'s format.
 * Untitled tabs default to markdown (.md). WI-1B.8 + WI-1B.9 — was
 * hardcoded ".md".
 */
function ensureFormatExtension(
  filename: string,
  filePath: string | null,
): string {
  const ext = untitledExtensionForFilePath(filePath);
  const dotted = `.${ext}`;
  return filename.endsWith(dotted) ? filename : `${filename}${dotted}`;
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
    i18n.t("dialog:unsavedChanges.single", { title }),
    {
      title: i18n.t("dialog:unsavedChanges.title"),
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
    // Pre-fill with sanitized title as filename. Filters + default
    // extension derive from this tab's format adapter.
    const defaultFolder = await getDefaultSaveFolderWithFallback(windowLabel);
    const filename = ensureFormatExtension(toSafeFilename(title), filePath);
    const defaultPath = joinPath(defaultFolder, filename);
    const newPath = await save({
      defaultPath,
      filters: saveFiltersForFilePath(filePath),
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
  let msg = i18n.t("dialog:unsavedChanges.multiple", { count: docCount, list: docList });
  if (untitledDocs.length > 0) {
    msg += `\n\n${i18n.t("dialog:unsavedChanges.newDocsHint", { count: untitledDocs.length })}`;
  }

  const result = await message(msg, {
    title: i18n.t("dialog:unsavedChanges.title"),
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

      const filename = ensureFormatExtension(
        toSafeFilename(doc.title),
        doc.filePath ?? null,
      );
      const defaultPath = joinPath(defaultFolder, filename);
      const newPath = await save({
        defaultPath,
        filters: saveFiltersForFilePath(doc.filePath ?? null),
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
        title: i18n.t("dialog:chooseFolderForDocs", { count: untitledDocs.length }),
      });

      if (!folderPath || typeof folderPath !== "string") {
        return { action: "cancelled" };
      }

      // Save each untitled doc to the chosen folder
      for (const doc of untitledDocs) {
        current++;
        onProgress?.(current, total, doc.title);

        const filename = ensureFormatExtension(
          toSafeFilename(doc.title),
          doc.filePath ?? null,
        );
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

      const filename = ensureFormatExtension(
        toSafeFilename(doc.title),
        doc.filePath ?? null,
      );
      const defaultPath = joinPath(defaultFolder, filename);
      const newPath = await save({
        defaultPath,
        filters: saveFiltersForFilePath(doc.filePath ?? null),
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
        title: i18n.t("dialog:chooseFolderForDocs", { count: untitledDocs.length }),
      });

      if (!folderPath || typeof folderPath !== "string") {
        return { action: "cancelled" };
      }

      for (const doc of untitledDocs) {
        current++;
        onProgress?.(current, total, doc.title);

        const filename = ensureFormatExtension(
          toSafeFilename(doc.title),
          doc.filePath ?? null,
        );
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
