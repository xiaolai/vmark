/**
 * The unified undo/redo operations.
 *
 * Split from `unifiedHistory.ts` for the size gate, along the seam that was
 * already there: that file owns checkpoint CREATION and the native-history
 * primitives, this one owns the two commands that combine them.
 *
 * @coordinates-with unifiedHistory.ts — checkpoints and native undo/redo
 * @coordinates-with stores/documentStore/unifiedHistory.ts — the checkpoint stacks
 * @module services/history/unifiedUndoRedo
 */
import { useDocumentStore, useUnifiedHistoryStore } from "@/stores/documentStore";
import { useUIStore } from "@/stores/uiStore";
import { selectSourceEditing } from "@/stores/selectSourceEditing";
import { canonicalizeLineEndings } from "@/utils/editorText";
import { useTabStore } from "@/stores/tabStore";
import { doNativeRedo, doNativeUndo, restoreFromCheckpoint } from "./unifiedHistory";

/**
 * Perform unified undo (can be called from any context).
 * 1. Try native undo first
 * 2. If native history exhausted, restore from checkpoint
 * 3. May trigger mode switch if checkpoint is from different mode
 *
 * Returns true if any undo action was performed.
 */
export function performUnifiedUndo(windowLabel: string): boolean {
  const historyStore = useUnifiedHistoryStore.getState();
  const tabStore = useTabStore.getState();
  const tabId = tabStore.activeTabId[windowLabel];
  const activeTab = tabId ? tabStore.findTabById(tabId) : null;
  if (!tabId || activeTab?.kind !== "document") return false; // no live document
  if (doNativeUndo()) {
    return true;
  }

  // Native undo exhausted, check for checkpoint
  if (!historyStore.canUndoCheckpoint(tabId)) {
    return false;
  }

  const documentStore = useDocumentStore.getState();
  const doc = documentStore.getDocument(tabId);
  if (!doc) return false;

  const currentMode = selectSourceEditing(useUIStore.getState()) ? "source" : "wysiwyg";

  // Peeked before pushing: the redo entry has to record WHERE this undo is
  // about to leave the document, which is the checkpoint's own content. That
  // is the branch point the redo belongs to (audit 20260906, F4).
  const checkpoint = historyStore.popUndo(tabId);
  if (!checkpoint) return false;

  // Save current state to redo stack before restoring
  historyStore.pushRedo(tabId, {
    markdown: doc.content,
    mode: currentMode,
    cursorInfo: doc.cursorInfo ?? null,
    branchBase: canonicalizeLineEndings(checkpoint.markdown),
  });

  restoreFromCheckpoint(tabId, checkpoint);
  return true;
}

/**
 * Perform unified redo (can be called from any context).
 * 1. Try native redo first
 * 2. If native history exhausted, restore from checkpoint
 *
 * Returns true if any redo action was performed.
 */
export function performUnifiedRedo(windowLabel: string): boolean {
  const historyStore = useUnifiedHistoryStore.getState();
  const tabStore = useTabStore.getState();
  const tabId = tabStore.activeTabId[windowLabel];
  const activeTab = tabId ? tabStore.findTabById(tabId) : null;
  if (!tabId || activeTab?.kind !== "document") return false; // no live document
  if (doNativeRedo()) {
    return true;
  }

  // Native redo exhausted, check for checkpoint
  if (!historyStore.canRedoCheckpoint(tabId)) {
    return false;
  }

  const documentStore = useDocumentStore.getState();
  const doc = documentStore.getDocument(tabId);
  if (!doc) return false;

  // A new edit since the undo means history has BRANCHED, and this redo entry
  // describes the future the user abandoned by typing. Native editor history
  // drops its redo stack on any new edit; the checkpoint stack cannot see one,
  // because an ordinary keystroke never reaches the history store — so the
  // staleness is detected here instead, by asking whether the document is
  // still sitting where the undo left it.
  //
  // Without this, Redo replaced freshly typed content with the pre-undo text
  // while the native editor correctly reported no redo at all (audit 20260906,
  // F4). Discard rather than merely refuse: the branch is gone for good, and
  // leaving the entry would let a later coincidence resurrect it.
  if (!historyStore.isRedoOnCurrentBranch(tabId, doc.content)) {
    historyStore.clearRedo(tabId);
    return false;
  }

  const currentMode = selectSourceEditing(useUIStore.getState()) ? "source" : "wysiwyg";

  // Pop redo checkpoint first (before pushing to undo, which doesn't clear redo)
  const checkpoint = historyStore.popRedo(tabId);
  if (!checkpoint) return false;

  // Save current state to undo stack (preserving remaining redo stack)
  historyStore.pushUndo(tabId, {
    markdown: doc.content,
    mode: currentMode,
    cursorInfo: doc.cursorInfo ?? null,
  });

  restoreFromCheckpoint(tabId, checkpoint);
  return true;
}
