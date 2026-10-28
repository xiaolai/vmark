/**
 * Post-save store updates, and the rule for when a completion may still apply
 * them.
 *
 * Split out of `saveToPath.ts` for the size gate, along the seam that already
 * existed: the write is one concern, deciding whether its result still
 * describes the live document is another.
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
import { clearPendingSaveAfterGrace, type registerPendingSave } from "@/utils/pendingSaves";
import { isSameFile } from "@/utils/paths/fileIdentity";
import { getRuntimePlatform } from "@/utils/platform";
import { isCurrentSaveTarget, isSameDocument, type SaveTargetClaim } from "./saveTargetClaim";
import type { SaveType } from "./saveHistorySnapshot";
import type { NormalizedSaveContent } from "./normalizedSaveContent";

/**
 * The path a finished write may still record as its document's (path, tab
 * path and saved snapshots), or `null` when it may not.
 *
 * Two ways to qualify, and BOTH are needed:
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
 * "Still where the document lives" is file identity (`fileIdentity.ts`), not
 * spelling: `/repo/./a.md` is `/repo/a.md`. Such a save records the spelling
 * the document already has, never the alias it was written through.
 *
 * An untitled document (no live path) matches nothing, so only its newest save
 * may name it. A save of a document closed since it was submitted names
 * nothing, even when the same tab id was opened again on the same file.
 */
function repointPath(
  tabId: string,
  path: string,
  claim: SaveTargetClaim
): string | null {
  if (!isSameDocument(claim)) return null;
  if (isCurrentSaveTarget(claim)) return path;
  const live = useDocumentStore.getState().getDocument(tabId)?.filePath;
  return live != null && isSameFile(live, path, getRuntimePlatform()) ? live : null;
}

/**
 * Update stores after a successful write: file path, line metadata, saved
 * markers, deferred pending-save clear, tab path sync, workspace ownership and
 * recent files. An autosave records `lastAutoSave`; a manual save joins the
 * recent files; an MCP save does neither and never switches the visible
 * workspace.
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
  // After the grace window, so a late-arriving watcher event still matches.
  clearPendingSaveAfterGrace(path, saveToken);

  // Everything below RE-POINTS the document. A completion may only do that
  // while it still describes where the document lives.
  const recorded = repointPath(tabId, path, claim);
  if (recorded === null) return;

  useDocumentStore.getState().setFilePath(tabId, recorded);
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
  useTabStore.getState().updateTabPath(tabId, recorded);
  // Save As across a workspace boundary reassigns ownership; the
  // visible context follows when this is the active tab — unless an AI client
  // asked for the save, which reclassifies ownership but must never yank the
  // human's visible workspace.
  {
    const ownerWindow = windowLabelForTab(tabId);
    if (ownerWindow) {
      reassignTabOwnershipForPath(ownerWindow, tabId, recorded, {
        allowVisibleSwitch: saveType !== "mcp",
      });
    }
  }

  // Add to recent files. Only for a save the user asked for: an autosave is
  // noise, and an AI client's file activity is not the human's history.
  if (saveType === "manual") {
    useRecentFilesStore.getState().addFile(recorded);
  }
}
