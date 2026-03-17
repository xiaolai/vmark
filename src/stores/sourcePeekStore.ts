/**
 * Source Peek Store
 *
 * Purpose: State for the Source Peek popup — a mini source editor that lets
 *   users edit a single block's markdown without leaving WYSIWYG mode.
 *
 * Pipeline: User triggers Source Peek (F5) → open() with current block's
 *   markdown and position → user edits in popup → setMarkdown() tracks
 *   unsaved changes → apply/close writes back to WYSIWYG editor.
 *
 * Key decisions:
 *   - Stores originalMarkdown for ESC revert — user can always discard edits.
 *   - livePreview syncs edits to the WYSIWYG view on each keystroke when enabled.
 *   - parseError tracks markdown-to-node conversion failures for inline feedback.
 *   - close() resets to initialState — no stale state leaks between sessions.
 *
 * @coordinates-with SourcePeek component — renders the popup CodeMirror editor
 * @coordinates-with useSourcePeek hook — handles apply/revert logic
 * @module stores/sourcePeekStore
 */

import { create } from "zustand";

/** Document position range (from, to) for the block being edited. */
export interface SourcePeekRange {
  from: number;
  to: number;
}

interface SourcePeekState {
  /** Whether Source Peek is currently open */
  isOpen: boolean;

  /** Position in document where editing block starts */
  editingPos: number | null;

  /** Range of the block being edited */
  range: SourcePeekRange | null;

  /** Current markdown content in the editor */
  markdown: string;

  /** Original markdown content for checkpoint revert */
  originalMarkdown: string | null;

  /** Whether live preview is enabled (sync on each keystroke) */
  livePreview: boolean;

  /** Current parse error, if any */
  parseError: string | null;

  /** Whether there are unsaved changes */
  hasUnsavedChanges: boolean;

  /** Block type name being edited (for header display) */
  blockTypeName: string | null;
}

interface SourcePeekActions {
  /**
   * Open Source Peek for a block.
   * Creates a checkpoint with the original content for revert.
   */
  open: (payload: {
    markdown: string;
    range: SourcePeekRange;
    blockTypeName?: string;
  }) => void;

  /**
   * Close Source Peek without applying changes.
   * Call revert() first if you want to restore original content.
   */
  close: () => void;

  /**
   * Update the markdown content.
   * Sets hasUnsavedChanges if different from original.
   */
  setMarkdown: (markdown: string) => void;

  /**
   * Set parse error message (or null to clear).
   */
  setParseError: (error: string | null) => void;

  /**
   * Toggle live preview mode.
   */
  toggleLivePreview: () => void;

  /**
   * Mark changes as saved (clears hasUnsavedChanges).
   */
  markSaved: () => void;

  /**
   * Get the original markdown for revert.
   */
  getOriginalMarkdown: () => string | null;
}

const initialState: SourcePeekState = {
  isOpen: false,
  editingPos: null,
  range: null,
  markdown: "",
  originalMarkdown: null,
  livePreview: false,
  parseError: null,
  hasUnsavedChanges: false,
  blockTypeName: null,
};

/** Manages Source Peek popup state — open/close, markdown content, live preview, and parse errors. Use selectors, not destructuring. */
export const useSourcePeekStore = create<SourcePeekState & SourcePeekActions>((set, get) => ({
  ...initialState,

  open: ({ markdown, range, blockTypeName }) => set({
    isOpen: true,
    editingPos: range.from,
    range,
    markdown,
    originalMarkdown: markdown,
    parseError: null,
    hasUnsavedChanges: false,
    blockTypeName: blockTypeName ?? null,
  }),

  close: () => set({ ...initialState }),

  setMarkdown: (markdown) => {
    const { originalMarkdown } = get();
    set({
      markdown,
      hasUnsavedChanges: markdown !== originalMarkdown,
      parseError: null, // Clear error when content changes
    });
  },

  setParseError: (error) => set({ parseError: error }),

  toggleLivePreview: () => set((state) => ({ livePreview: !state.livePreview })),

  markSaved: () => set({ hasUnsavedChanges: false }),

  getOriginalMarkdown: () => get().originalMarkdown,
}));
