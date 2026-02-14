/**
 * Block Math Editing Store
 *
 * Purpose: Tracks which math/mermaid code block is being edited in WYSIWYG mode,
 *   storing original content for ESC-revert.
 *
 * Key decisions:
 *   - Only one block can be edited at a time (single editingPos).
 *   - originalContent enables ESC to revert without undo stack pollution.
 *
 * @coordinates-with inlineMathEditingStore.ts — same pattern for inline math ($...$)
 * @coordinates-with codePreview plugin — renders preview while not editing
 * @module stores/blockMathEditingStore
 */

import { create } from "zustand";

interface BlockMathEditingState {
  /** Position of code block currently being edited, or null if not editing */
  editingPos: number | null;
  /** Original content for ESC revert */
  originalContent: string | null;
}

interface BlockMathEditingActions {
  /** Enter editing mode for a code block */
  startEditing: (pos: number, content: string) => void;
  /** Exit editing mode (called after commit or revert) */
  exitEditing: () => void;
  /** Check if a specific position is being edited */
  isEditingAt: (pos: number) => boolean;
}

type BlockMathEditingStore = BlockMathEditingState & BlockMathEditingActions;

const initialState: BlockMathEditingState = {
  editingPos: null,
  originalContent: null,
};

export const useBlockMathEditingStore = create<BlockMathEditingStore>((set, get) => ({
  ...initialState,

  startEditing: (pos, content) =>
    set({
      editingPos: pos,
      originalContent: content,
    }),

  exitEditing: () => set(initialState),

  isEditingAt: (pos) => get().editingPos === pos,
}));
