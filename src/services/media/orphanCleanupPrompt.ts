/**
 * Orphan Cleanup Prompt
 *
 * Purpose: The interactive half of unused-image cleanup — the manual
 * "Clean Up Unused Images" command. Previews what would be deleted and asks
 * before deleting anything.
 *
 * Key decisions:
 *   - Refuses to run on an unsaved or dirty document: scanning content that
 *     isn't on disk would report still-referenced images as orphans
 *   - Re-scans immediately before deleting and removes only files still
 *     orphaned. The dialog can sit open for minutes while another window
 *     pastes an image into this very folder; the confirmed list is a snapshot,
 *     and acting on it blindly deletes a file that is now in use
 *   - Reports deletion failures instead of folding them into a success count —
 *     a locked or vanished file must not be announced as cleaned up
 *   - Says "could not verify" rather than "all still referenced" when the scan
 *     was incomplete: `findOrphanedImages` protects every candidate in that
 *     case, so an empty orphan list does not mean the folder is clean
 *   - Split from orphanAssetCleanup.ts so the scan stays free of dialog I/O
 *     (and both files stay under the file-size limit)
 *
 * @coordinates-with orphanAssetCleanup.ts — findOrphanedImages/deleteOrphanedImages
 * @coordinates-with services/commands/miscCommands.ts — image.cleanupOrphans command
 * @coordinates-with src/locales/en/dialog.json — orphanCleanup.* keys (all locales)
 * @module services/media/orphanCleanupPrompt
 */

import { message } from "@tauri-apps/plugin-dialog";
import i18n from "@/i18n";
import { orphanCleanupError } from "@/utils/debug";
import { withoutWorkspaceReferenced } from "@/services/media/workspaceReferenceCheck";
import { collectRemoteLiveRefs } from "@/services/media/crossWindowRefs";
import { getCurrentWindowLabel } from "@/services/persistence/workspaceStorage";
import { confirmAction } from "@/services/dialogs/confirmAction";
import {
  deleteOrphanedImages,
  findOrphanedImages,
  type OrphanCleanupResult,
  type OrphanedImage,
} from "./orphanAssetCleanup";

/**
 * Supplies the live buffers of the caller's open documents, keyed by path.
 *
 * A FUNCTION, not a snapshot: the confirmation dialog can sit open for minutes,
 * and the whole point of the re-scan is to see what changed during that time.
 * A map captured before the dialog would hide exactly the sibling edit — a tab
 * pasting an image into this folder — that the re-scan exists to catch.
 */
export type LiveContentsProvider = () => ReadonlyMap<string, string>;

/**
 * Re-reads the subject document at delete time. Returns null when it can no
 * longer be vouched for — dirty, divergent, closed, or changed since the
 * preview. The confirmation dialog can stand open for minutes, and the subject
 * gaining a reference in that window used to be invisible: the re-scan reused
 * the ORIGINAL content and deleted an image the document had started using.
 */
export type SubjectContentProvider = () => string | null;

/** How many filenames the preview lists before collapsing into a count. */
const PREVIEW_LIMIT = 10;

/** Outcome of the manual cleanup run. */
export type OrphanCleanupOutcome =
  /** Document unsaved or dirty — nothing was scanned. */
  | { status: "blocked" }
  /** Scan failed outright. */
  | { status: "failed" }
  /** Scan succeeded, nothing eligible for deletion. */
  | { status: "empty" }
  /** User declined the confirmation. */
  | { status: "cancelled" }
  | { status: "completed"; deleted: number; failed: number };

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(`dialog:${key}`, opts ?? {});

function buildPreview(images: OrphanedImage[]): string {
  const listed = images
    .slice(0, PREVIEW_LIMIT)
    .map((img) => `• ${img.filename}`)
    .join("\n");
  const remaining = images.length - PREVIEW_LIMIT;
  return remaining > 0 ? `${listed}\n${t("orphanCleanup.more", { count: remaining })}` : listed;
}

/** Report what the delete pass actually managed to remove. */
async function reportDeletion(deleted: number, failed: string[]): Promise<void> {
  if (failed.length === 0) {
    await message(t("orphanCleanup.deletedMessage", { count: deleted }), {
      title: t("orphanCleanup.deletedTitle"),
      kind: "info",
    });
    return;
  }
  await message(
    t("orphanCleanup.partialMessage", { deleted, count: failed.length }) +
      `\n\n${failed.slice(0, PREVIEW_LIMIT).map((f) => `• ${f}`).join("\n")}`,
    { title: t("orphanCleanup.partialTitle"), kind: "warning" }
  );
}

/** Tell the user nothing is deletable — honestly, per scan completeness. */
async function reportNothingToDelete(result: OrphanCleanupResult): Promise<void> {
  const body = result.scanComplete
    ? t("orphanCleanup.noneMessage", { count: result.totalInFolder })
    : t("orphanCleanup.incompleteMessage", { count: result.totalInFolder });
  await message(body, {
    title: t("orphanCleanup.noneTitle"),
    kind: result.scanComplete ? "info" : "warning",
  });
}

/**
 * Re-scan at delete time and intersect with the confirmed list. The dialog can
 * stand open for minutes; the confirmed list is a snapshot, and both the
 * subject and its siblings may have gained references since. `null` means the
 * re-scan could not be trusted — the caller reports failure and deletes
 * nothing (an incomplete re-scan protects every candidate, so intersecting
 * would fake an empty "success").
 */
async function rescanStillOrphaned(
  documentPath: string,
  confirmed: OrphanedImage[],
  liveContents: LiveContentsProvider | undefined,
  freshSubject: string | null
): Promise<OrphanedImage[] | null> {
  if (freshSubject === null) return null;
  try {
    const fresh = await findOrphanedImages(documentPath, freshSubject, {
      knownContents: liveContents?.(),
      externalRefKeys: await collectRemoteLiveRefs(getCurrentWindowLabel()),
    });
    if (!fresh.scanComplete) return null;
    const live = new Set(fresh.orphanedImages.map((img) => img.fullPath));
    return confirmed.filter((img) => live.has(img.fullPath));
  } catch (error) {
    orphanCleanupError(" Re-scan before delete failed:", error);
    return null;
  }
}

/**
 * Show the orphan cleanup preview and delete on confirmation.
 *
 * @param documentPath - Path to the document file, or null if unsaved
 * @param documentContent - Document content to analyze, or null if the document has unsaved changes
 * @param autoCleanupEnabled - Whether auto-cleanup on close is enabled
 */
export async function runOrphanCleanup(
  documentPath: string | null,
  documentContent: string | null,
  autoCleanupEnabled = false,
  liveContents?: LiveContentsProvider,
  subjectContent?: SubjectContentProvider
): Promise<OrphanCleanupOutcome> {
  if (!documentPath) {
    await message(t("unsavedDocument.messageOrphanCheck"), {
      title: t("unsavedDocument.title"),
      kind: "warning",
    });
    return { status: "blocked" };
  }

  if (documentContent === null) {
    await message(t("unsavedDocument.messageOrphanCheckUnsaved"), {
      title: t("unsavedChanges.title"),
      kind: "warning",
    });
    return { status: "blocked" };
  }

  let result: OrphanCleanupResult;
  try {
    result = await findOrphanedImages(documentPath, documentContent, {
      knownContents: liveContents?.(),
      externalRefKeys: await collectRemoteLiveRefs(getCurrentWindowLabel()),
    });
  } catch (error) {
    // The menu dispatcher only logs a rejection, leaving the user staring at a
    // command that did nothing. Say so.
    orphanCleanupError(" Scan failed:", error);
    await message(t("orphanCleanup.scanFailedMessage"), {
      title: t("orphanCleanup.scanFailedTitle"),
      kind: "error",
    });
    return { status: "failed" };
  }

  if (result.orphanedImages.length === 0) {
    await reportNothingToDelete(result);
    return { status: "empty" };
  }

  const hint = autoCleanupEnabled
    ? t("orphanCleanup.hintAuto")
    : t("orphanCleanup.hintEnable");

  const confirmed = await confirmAction({
    title: t("orphanCleanup.foundTitle"),
    message:
      `${t("orphanCleanup.foundMessage", { count: result.orphanedImages.length })}\n\n` +
      `${buildPreview(result.orphanedImages)}\n\n${hint}\n\n` +
      t("orphanCleanup.confirmQuestion"),
    actionLabel: t("orphanCleanup.deleteNow"),
    kind: "warning",
    cancelLabel: t("orphanCleanup.later"),
  });

  if (!confirmed) return { status: "cancelled" };

  const stillOrphaned = await rescanStillOrphaned(
    documentPath,
    result.orphanedImages,
    liveContents,
    subjectContent ? subjectContent() : documentContent
  );
  if (stillOrphaned === null) {
    await message(t("orphanCleanup.scanFailedMessage"), {
      title: t("orphanCleanup.scanFailedTitle"),
      kind: "error",
    });
    return { status: "failed" };
  }

  // WI-11: cross-directory references live in documents the sibling scan
  // never reads — the workspace content search is the wider net.
  const clearedForDeletion = await withoutWorkspaceReferenced(stillOrphaned);
  const { deleted, failed } = await deleteOrphanedImages(clearedForDeletion);
  await reportDeletion(deleted, failed);

  return { status: "completed", deleted, failed: failed.length };
}
