/**
 * Save-on-Close Batch Helper
 *
 * Purpose: persist a batch of documents — every doc that already has a path,
 * then untitled docs via one Save-As (single) or one folder picker (several).
 * Shared by promptSaveForMultipleDocuments (closeSave.ts) and the Save-All
 * command; split out of closeSave.ts along that existing seam when the file
 * hit its size baseline.
 *
 * Key decisions:
 *   - A context is a capture, and the dialogs here stay open for as long as
 *     the user takes. With a `revalidate` hook every write uses the document
 *     as it is at that moment, and a document that no longer needs saving is
 *     skipped. Without one the captured context is written — the close flow
 *     revalidates after the batch instead.
 *   - A destination reserved for a document that is then skipped is removed
 *     again: a reservation is an empty file, and nothing would ever fill it.
 *
 * @coordinates-with closeSave.ts — prompts that feed this batch
 * @coordinates-with services/files/saveAllQuit.ts — Save All and Quit caller
 * @module services/windowClose/closeSaveBatch
 */

import { save, open } from "@tauri-apps/plugin-dialog";
import { remove } from "@tauri-apps/plugin-fs";
import i18n from "@/i18n";
import { getDefaultSaveFolderWithFallback } from "@/services/files/defaultSaveFolder";
import { saveToPathForClose } from "@/services/persistence/saveToPath";
import { joinPath } from "@/utils/pathUtils";
import { reserveBatchDestinations } from "./reserveBatchDestinations";
import {
  ensureFormatExtension,
  saveFiltersForFilePath,
  toSafeFilename,
  type CloseSaveContext,
  type MultiSaveOptions,
  type MultiSaveResult,
} from "./closeSaveShared";

type Revalidate = NonNullable<MultiSaveOptions["revalidate"]>;

/** No hook supplied: the captured context is what gets written. */
const asCaptured: Revalidate = (context) => context;

const CANCELLED: MultiSaveResult = { action: "cancelled" };

/** The filename an untitled document is offered or reserved under. */
function untitledFilename(doc: CloseSaveContext): string {
  return ensureFormatExtension(toSafeFilename(doc.title), doc.filePath ?? null);
}

/**
 * Persist a batch of documents: save every doc that already has a path, then
 * handle untitled docs — a single Save-As dialog for one, or one folder picker
 * for several. Returns a cancellation result to bubble up, or `null` on success.
 *
 * `revalidate` is consulted immediately before every write and after every
 * dialog; see {@link MultiSaveOptions.revalidate}.
 */
export async function persistDocumentBatch(
  savedDocs: CloseSaveContext[],
  untitledDocs: CloseSaveContext[],
  total: number,
  onProgress: MultiSaveOptions["onProgress"],
  revalidate: Revalidate = asCaptured,
): Promise<MultiSaveResult | null> {
  let current = 0;

  for (const context of savedDocs) {
    current++;
    const live = revalidate(context);
    if (!live) continue;
    onProgress?.(current, total, live.title);

    const saved = await saveToPathForClose(
      live.tabId,
      live.filePath ?? context.filePath!,
      live.content,
    );
    if (!saved) return CANCELLED;
  }

  // Untitled docs that still need a file once the pathed ones are written.
  const pending = untitledDocs.filter((doc) => revalidate(doc) !== null);
  if (pending.length === 0) return null;

  // Choose the folder once.
  const defaultFolder = await getDefaultSaveFolderWithFallback(pending[0].windowLabel);

  if (pending.length === 1) {
    // Single untitled: standard Save As dialog
    const doc = pending[0];
    current++;
    onProgress?.(current, total, doc.title);

    const newPath = await save({
      defaultPath: joinPath(defaultFolder, untitledFilename(doc)),
      filters: saveFiltersForFilePath(doc.filePath ?? null),
    });
    if (!newPath) return CANCELLED;

    const live = revalidate(doc);
    if (!live) return null;
    const saved = await saveToPathForClose(live.tabId, newPath, live.content);
    return saved ? null : CANCELLED;
  }

  // Multiple untitled: batch folder picker
  const folderPath = await open({
    directory: true,
    multiple: false,
    defaultPath: defaultFolder,
    title: i18n.t("dialog:chooseFolderForDocs", { count: pending.length }),
  });
  if (!folderPath || typeof folderPath !== "string") return CANCELLED;

  // Reserve every destination BEFORE writing any of them. Building
  // `folder/title.md` and handing it to the overwrite writer replaced
  // whatever already sat at that name — a closed document the user never
  // opened — and gave two same-titled tabs the same path.
  // Reservation is one `O_EXCL` create per name, so it settles both
  // collisions and cannot race a concurrent creator. Only documents that
  // still need a file once the picker has closed get one reserved.
  const reserving = pending.filter((doc) => revalidate(doc) !== null);
  const destinations = await reserveBatchDestinations(folderPath, reserving.map(untitledFilename));

  for (const [index, doc] of reserving.entries()) {
    current++;
    onProgress?.(current, total, doc.title);

    const live = revalidate(doc);
    if (!live) {
      await remove(destinations[index]);
      continue;
    }
    const saved = await saveToPathForClose(live.tabId, destinations[index], live.content);
    if (!saved) return CANCELLED;
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

  const { onProgress, revalidate } = options;

  const savedDocs = contexts.filter((c) => c.filePath);
  const untitledDocs = contexts.filter((c) => !c.filePath);

  const cancelled = await persistDocumentBatch(
    savedDocs,
    untitledDocs,
    contexts.length,
    onProgress,
    revalidate,
  );
  if (cancelled) return cancelled;

  return { action: "saved-all" };
}
