/**
 * Cross-mode undo/redo checkpoint stack — keyed by tabId.
 *
 * Lets the user undo/redo across WYSIWYG ⇄ Source mode switches without
 * losing history. A checkpoint captures the markdown content, the mode it
 * was created in, and the cursor position at the moment of the mode flip
 * so the cursor can be restored to a sensible place.
 *
 * @module stores/documentStore/unifiedHistory
 */

import { create } from "zustand";
import type { CursorInfo } from "@/types/cursorSync";

/** A cross-mode undo checkpoint — captures markdown, editor mode, and cursor position at a mode switch. */
export interface HistoryCheckpoint {
  /** The markdown content at this checkpoint */
  markdown: string;
  /** Which mode was active when this checkpoint was created */
  mode: "source" | "wysiwyg";
  /** Cursor position for restoration */
  cursorInfo: CursorInfo | null;
  /** Timestamp for debugging */
  timestamp: number;
  /**
   * For a REDO entry: the content the document was left holding by the undo
   * that created this entry — the branch point this redo belongs to.
   *
   * Redoing is only meaningful while the document still sits at that point. If
   * the user typed something instead, history has branched and this entry
   * describes an abandoned future: applying it would replace what they just
   * wrote (audit 20260906, F4). Native editor history discards its redo stack
   * on a new edit; the checkpoint stack could not, because an ordinary edit
   * never reaches this store.
   *
   * Undefined on undo entries and on anything persisted before this field
   * existed, which is read as "cannot be verified" and therefore safe.
   */
  branchBase?: string;
}

interface DocumentHistory {
  undoStack: HistoryCheckpoint[];
  redoStack: HistoryCheckpoint[];
}

interface UnifiedHistoryState {
  /** History stacks per document (keyed by tabId) */
  documents: Record<string, DocumentHistory>;
  /** Maximum number of checkpoints to keep per document */
  maxCheckpoints: number;
  /** Whether we're currently restoring from a checkpoint (prevents re-checkpointing) */
  isRestoring: boolean;
}

interface UnifiedHistoryActions {
  /**
   * Create a checkpoint before switching modes.
   * Called when user toggles between Source and WYSIWYG.
   */
  createCheckpoint: (tabId: string, checkpoint: Omit<HistoryCheckpoint, "timestamp">) => void;

  /**
   * Pop the most recent checkpoint for undo.
   * Returns null if no checkpoints available.
   */
  popUndo: (tabId: string) => HistoryCheckpoint | null;

  /**
   * Pop the most recent checkpoint for redo.
   * Returns null if no checkpoints available.
   */
  popRedo: (tabId: string) => HistoryCheckpoint | null;

  /**
   * Push current state to redo stack (called when undoing to a checkpoint).
   */
  pushRedo: (tabId: string, checkpoint: Omit<HistoryCheckpoint, "timestamp">) => void;

  /**
   * Push current state to undo stack WITHOUT clearing redo stack.
   * Used by performUnifiedRedo to save current state before restoring.
   */
  pushUndo: (tabId: string, checkpoint: Omit<HistoryCheckpoint, "timestamp">) => void;

  /** Check if there's a checkpoint available for undo. */
  canUndoCheckpoint: (tabId: string) => boolean;

  /** Check if there's a checkpoint available for redo. */
  canRedoCheckpoint: (tabId: string) => boolean;

  /**
   * Whether the top redo entry still belongs to the branch `currentMarkdown`
   * is on. False once a new edit has branched history away from it.
   */
  isRedoOnCurrentBranch: (tabId: string, currentMarkdown: string) => boolean;

  /**
   * Drop the redo stack, keeping undo intact. Called when a new edit branches
   * history away from the recorded future.
   */
  clearRedo: (tabId: string) => void;

  /** Set restoring flag (prevents checkpoint creation during restore). */
  setRestoring: (value: boolean) => void;

  /** Clear history for a specific document (called on tab close). */
  clearDocument: (tabId: string) => void;

  /** Clear all history (called on app reset). */
  clearAll: () => void;
}

const MAX_CHECKPOINTS = 50;

const emptyHistory: DocumentHistory = { undoStack: [], redoStack: [] };

/** Manages cross-mode undo/redo checkpoints for seamless history across WYSIWYG and Source modes. Use selectors, not destructuring. */
export const useUnifiedHistoryStore = create<UnifiedHistoryState & UnifiedHistoryActions>(
  (set, get) => ({
    documents: {},
    maxCheckpoints: MAX_CHECKPOINTS,
    isRestoring: false,

    createCheckpoint: (tabId, checkpoint) => {
      // Don't create checkpoint while restoring
      if (get().isRestoring) return;

      // Skip if content hasn't changed since last checkpoint (deduplication)
      const docHistory = get().documents[tabId];
      if (docHistory && docHistory.undoStack.length > 0) {
        const last = docHistory.undoStack[docHistory.undoStack.length - 1];
        if (last.markdown === checkpoint.markdown) return;
      }

      const newCheckpoint: HistoryCheckpoint = {
        ...checkpoint,
        timestamp: Date.now(),
      };

      set((state) => {
        const currentHistory = state.documents[tabId] || emptyHistory;
        const newUndoStack = [...currentHistory.undoStack, newCheckpoint];
        // Trim to max size
        if (newUndoStack.length > state.maxCheckpoints) {
          newUndoStack.shift();
        }
        return {
          documents: {
            ...state.documents,
            [tabId]: {
              undoStack: newUndoStack,
              // Clear redo on new checkpoint (new branch of history)
              redoStack: [],
            },
          },
        };
      });
    },

    popUndo: (tabId) => {
      let checkpoint: HistoryCheckpoint | null = null;
      set((state) => {
        const current = state.documents[tabId] || emptyHistory;
        if (current.undoStack.length === 0) return state;
        checkpoint = current.undoStack[current.undoStack.length - 1];
        return {
          documents: {
            ...state.documents,
            [tabId]: {
              ...current,
              undoStack: current.undoStack.slice(0, -1),
            },
          },
        };
      });
      return checkpoint;
    },

    popRedo: (tabId) => {
      let checkpoint: HistoryCheckpoint | null = null;
      set((state) => {
        const current = state.documents[tabId] || emptyHistory;
        if (current.redoStack.length === 0) return state;
        checkpoint = current.redoStack[current.redoStack.length - 1];
        return {
          documents: {
            ...state.documents,
            [tabId]: {
              ...current,
              redoStack: current.redoStack.slice(0, -1),
            },
          },
        };
      });
      return checkpoint;
    },

    pushRedo: (tabId, checkpoint) => {
      const newCheckpoint: HistoryCheckpoint = {
        ...checkpoint,
        timestamp: Date.now(),
      };

      set((state) => {
        const docHistory = state.documents[tabId] || emptyHistory;
        const newRedoStack = [...docHistory.redoStack, newCheckpoint];
        if (newRedoStack.length > state.maxCheckpoints) {
          newRedoStack.shift();
        }
        return {
          documents: {
            ...state.documents,
            [tabId]: {
              ...docHistory,
              redoStack: newRedoStack,
            },
          },
        };
      });
    },

    pushUndo: (tabId, checkpoint) => {
      const newCheckpoint: HistoryCheckpoint = {
        ...checkpoint,
        timestamp: Date.now(),
      };

      set((state) => {
        const docHistory = state.documents[tabId] || emptyHistory;
        const newUndoStack = [...docHistory.undoStack, newCheckpoint];
        if (newUndoStack.length > state.maxCheckpoints) {
          newUndoStack.shift();
        }
        return {
          documents: {
            ...state.documents,
            [tabId]: {
              ...docHistory,
              undoStack: newUndoStack,
            },
          },
        };
      });
    },

    canUndoCheckpoint: (tabId) => {
      const docHistory = get().documents[tabId];
      return docHistory ? docHistory.undoStack.length > 0 : false;
    },

    canRedoCheckpoint: (tabId) => {
      const docHistory = get().documents[tabId];
      return docHistory ? docHistory.redoStack.length > 0 : false;
    },

    isRedoOnCurrentBranch: (tabId, currentMarkdown) => {
      const top = get().documents[tabId]?.redoStack.at(-1);
      if (!top) return false;
      // An entry with no recorded base predates this check (or came from a
      // path that does not set one). Allowing it keeps the previous behavior
      // for those rather than silently dropping a usable redo.
      if (top.branchBase === undefined) return true;
      return top.branchBase === currentMarkdown;
    },

    clearRedo: (tabId) => {
      set((state) => {
        const docHistory = state.documents[tabId];
        if (!docHistory || docHistory.redoStack.length === 0) return state;
        return {
          documents: {
            ...state.documents,
            [tabId]: { ...docHistory, redoStack: [] },
          },
        };
      });
    },

    setRestoring: (value) => {
      set({ isRestoring: value });
    },

    clearDocument: (tabId) => {
      set((state) => {
        const { [tabId]: _, ...rest } = state.documents;
        return { documents: rest };
      });
    },

    clearAll: () => {
      set({ documents: {}, isRestoring: false });
    },
  })
);
