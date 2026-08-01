/**
 * Save-on-Close Batch Helper
 *
 * Purpose: persist a batch of documents — every doc that already has a path,
 * then untitled docs via one Save-As (single) or one folder picker (several).
 * Shared by promptSaveForMultipleDocuments (closeSave.ts) and the Save-All
 * command; split out of closeSave.ts along that existing seam when the file
 * hit its size baseline.
 *
 * @coordinates-with closeSave.ts — prompts that feed this batch
 * @coordinates-with useFileSave.ts — Save All command caller
 * @module hooks/closeSaveBatch
 */

import { save, open } from "@tauri-apps/plugin-dialog";
import i18n from "@/i18n";
import { getDefaultSaveFolderWithFallback } from "@/hooks/useDefaultSaveFolder";
import { saveToPath } from "@/services/persistence/saveToPath";
import { joinPath } from "@/utils/pathUtils";
import {
  ensureFormatExtension,
  saveFiltersForFilePath,
  toSafeFilename,
  type CloseSaveContext,
  type MultiSaveOptions,
  type MultiSaveResult,
} from "@/hooks/closeSaveShared";

/**
 * Persist a batch of documents: save every doc that already has a path, then
 * handle untitled docs — a single Save-As dialog for one, or one folder picker
 * for several. Returns a cancellation result to bubble up, or `null` on success.
 */
export async function persistDocumentBatch(
  savedDocs: CloseSaveContext[],
  untitledDocs: CloseSaveContext[],
  total: number,
  onProgress: MultiSaveOptions["onProgress"],
): Promise<MultiSaveResult | null> {
  let current = 0;

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

  // Untitled docs: choose the folder once.
  if (untitledDocs.length > 0) {
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

  return null;
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

  const cancelled = await persistDocumentBatch(savedDocs, untitledDocs, contexts.length, onProgress);
  if (cancelled) return cancelled;

  return { action: "saved-all" };
}
