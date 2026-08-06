/**
 * Block Math Editing Store — which block-math node is in edit mode.
 *
 * Standalone Zustand store (T09 revert, WI-9 plan-20260803-161713): the
 * former merged-store slice re-inlined. The shim API is the contract —
 * consumers are unchanged.
 *
 * @module stores/blockMathEditingStore
 */

import { create } from "zustand";

interface BlockMathEditingData {
  editingPos: number | null;
  originalContent: string | null;
}

interface BlockMathEditingState extends BlockMathEditingData {
  startEditing: (pos: number, content: string) => void;
  exitEditing: () => void;
  isEditingAt: (pos: number) => boolean;
}

const initialState: BlockMathEditingData = {
  editingPos: null,
  originalContent: null,
};

export const useBlockMathEditingStore = create<BlockMathEditingState>((set, get) => ({
  ...initialState,
  startEditing: (pos, content) => set({ editingPos: pos, originalContent: content }),
  exitEditing: () => set(initialState),
  isEditingAt: (pos) => get().editingPos === pos,
}));
