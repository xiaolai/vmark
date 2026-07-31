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

import { message, save } from "@tauri-apps/plugin-dialog";
import i18n from "@/i18n";
import { getDefaultSaveFolderWithFallback } from "@/hooks/useDefaultSaveFolder";
import { saveToPath } from "@/services/persistence/saveToPath";
import { joinPath, getDirectory } from "@/utils/pathUtils";
import { persistDocumentBatch } from "@/hooks/closeSaveBatch";


// The shared types stay importable from here — this module is the public face
// of the close-save flow; the leaf exists only to break the batch cycle.
export type {
  CloseSaveContext,
  CloseSaveResult,
  MultiSaveResult,
  MultiSaveOptions,
} from "@/hooks/closeSaveShared";
import {
  saveFiltersForFilePath,
  toSafeFilename,
  ensureFormatExtension,
  CLOSE_SAVE_BUTTONS,
  MULTI_SAVE_BUTTONS,
  type CloseSaveContext,
  type CloseSaveResult,
  type MultiSaveResult,
  type MultiSaveOptions,
} from "@/hooks/closeSaveShared";

/**
 * Prompt user to save a dirty document before closing.
 * Returns a tri-state result for callers to decide close behavior.
 */
export async function promptSaveForDirtyDocument(
  context: CloseSaveContext
): Promise<CloseSaveResult> {
  const { windowLabel, tabId, title, filePath, content, divergent } = context;

  // Use message() with 3-button dialog for proper cancel handling.
  // ask() only returns boolean, so dismiss/escape = "Don't Save" which loses work.
  // message() with yes/no/cancel buttons returns distinct values for each action.
  const result = await message(
    i18n.t(divergent ? "dialog:divergentChanges.single" : "dialog:unsavedChanges.single", { title }),
    {
      title: i18n.t(divergent ? "dialog:divergentChanges.title" : "dialog:unsavedChanges.title"),
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

  // Save All: existing-path docs, then untitled docs.
  const cancelled = await persistDocumentBatch(savedDocs, untitledDocs, contexts.length, onProgress);
  if (cancelled) return cancelled;

  return { action: "saved-all" };
}
