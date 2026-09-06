/**
 * Post-save store updates, and the rule for when a completion may still apply
 * them.
 *
 * Split out of `saveToPath.ts` for the size gate, along the seam that already
 * existed: the write is one concern, deciding whether its result still
 * describes the live document is another (audit 20260906, F3).
 *
 * @coordinates-with saveToPath.ts — the only caller
 * @coordinates-with saveTargetClaim.ts — per-document identity ordering
 * @module services/persistence/applyPostSaveState
 */
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import {
  reassignTabOwnershipForPath,
  windowLabelForTab,
} from "@/services/workspaces/reassignTabOwnershipForPath";
import { useRecentFilesStore } from "@/stores/workspaceStore";
import { clearPendingSave, type registerPendingSave } from "@/utils/pendingSaves";
import { normalizePath } from "@/utils/paths";
import { isCurrentSaveTarget, type SaveTargetClaim } from "./saveTargetClaim";
import type { SaveType } from "./saveHistorySnapshot";
import type { NormalizedSaveContent } from "./normalizedSaveContent";

/**
 * Whether a finished write may still update its document's path, tab path and
 * saved snapshots.
 *
 * Two ways to qualify, and BOTH are needed (audit 20260906, F3):
 *
 *   - **It is the newest save submitted for this document.** This is what lets
 *     a Save As re-point the document at all, and what makes the user's most
 *     recent choice win between two Save As operations whatever order their
 *     writes finish in.
 *   - **Its path is still where the document lives.** Two ordinary saves to one
 *     file are serialized by path and both legitimately record their snapshot;
 *     the older is not "superseded" in any way that matters, and withholding it
 *     would leave the document dirty against bytes already on disk.
 *
 * What fails both is exactly the defect: an autosave to `/repo/old.md` that
 * lands after a Save As to `/repo/new.md`. It is not the newest save, and
 * `/repo/old.md` is no longer the document — so it must not reset the document
 * and tab back to the file the user just moved away from.
 *
 * An untitled document (no live path) matches nothing, so only its newest save
 * may name it.
 */
function mayRepointDocument(
  tabId: string,
  path: string,
  claim: SaveTargetClaim
): boolean {
  if (isCurrentSaveTarget(claim)) return true;
  const live = useDocumentStore.getState().getDocument(tabId)?.filePath;
  return live != null && normalizePath(live) === normalizePath(path);
}

/**
 * Update stores after a successful write: file path, line metadata, saved
 * markers, deferred pending-save clear, tab path sync, and recent files.
 *
 * `editorSnapshot` is the PRE-normalisation content the caller handed to the
 * writer — not a fresh store read, which would defeat the TOCTOU check: an
 * edit landing mid-save must compare against what was actually written, and it
 * cannot be reconstructed from `output` because `normalizeHardBreaks` is not
 * invertible.
 */
export function applyPostSaveState(
  tabId: string,
  path: string,
  editorSnapshot: string,
  normalized: NormalizedSaveContent,
  saveToken: ReturnType<typeof registerPendingSave>,
  saveType: SaveType,
  claim: SaveTargetClaim
): void {
  const { output, targetLineEnding, targetHardBreakStyle } = normalized;

  // The pending-save token belongs to THIS path's watcher bookkeeping, so it
  // is cleared whether or not this save still owns the document's identity.
  // Delayed to let late-arriving watcher events still match: the full pipeline
  // (Rust debounce 200ms → emit → JS event loop → async readTextFile →
  // comparison) can exceed 500ms under heavy I/O.
  setTimeout(() => clearPendingSave(path, saveToken), 1000);

  // Everything below RE-POINTS the document. A completion may only do that
  // while it still describes where the document lives (audit 20260906, F3).
  if (!mayRepointDocument(tabId, path, claim)) return;

  useDocumentStore.getState().setFilePath(tabId, path);
  useDocumentStore
    .getState()
    .setLineMetadata(tabId, { lineEnding: targetLineEnding, hardBreakStyle: targetHardBreakStyle });
  const snapshots = { editorSnapshot, diskSnapshot: output };
  if (saveType === "auto") {
    useDocumentStore.getState().markAutoSaved(tabId, snapshots);
  } else {
    useDocumentStore.getState().markSaved(tabId, snapshots);
  }

  // Update tab path for title sync
  useTabStore.getState().updateTabPath(tabId, path);
  // WI-13.4: Save As across a workspace boundary reassigns ownership; the
  // visible context follows when this is the active tab.
  {
    const ownerWindow = windowLabelForTab(tabId);
    if (ownerWindow) reassignTabOwnershipForPath(ownerWindow, tabId, path);
  }

  // Add to recent files (skip for auto-save to avoid noise)
  if (saveType === "manual") {
    useRecentFilesStore.getState().addFile(path);
  }
}
