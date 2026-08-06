/**
 * Source Peek Store — inline source-peek editing session state.
 *
 * Standalone Zustand store (T09 revert, WI-9 plan-20260803-161713): the
 * former merged-store slice re-inlined. The shim API is the contract —
 * consumers are unchanged.
 *
 * @module stores/sourcePeekStore
 */

import { create } from "zustand";

export interface SourcePeekRange {
  from: number;
  to: number;
}

interface SourcePeekData {
  isOpen: boolean;
  editingPos: number | null;
  range: SourcePeekRange | null;
  markdown: string;
  /** The true original content captured at open — the revert target. */
  originalMarkdown: string | null;
  /**
   * The last-saved content — the dirty-check baseline. Distinct from
   * `originalMarkdown` so `markSaved` can rebaseline the unsaved-changes
   * comparison without moving the revert target.
   */
  savedMarkdown: string | null;
  livePreview: boolean;
  parseError: string | null;
  hasUnsavedChanges: boolean;
  blockTypeName: string | null;
}

interface SourcePeekState extends SourcePeekData {
  open: (payload: {
    markdown: string;
    range: SourcePeekRange;
    blockTypeName?: string;
  }) => void;
  close: () => void;
  setMarkdown: (markdown: string) => void;
  setParseError: (error: string | null) => void;
  toggleLivePreview: () => void;
  markSaved: () => void;
  getOriginalMarkdown: () => string | null;
}

const initialState: SourcePeekData = {
  isOpen: false,
  editingPos: null,
  range: null,
  markdown: "",
  originalMarkdown: null,
  savedMarkdown: null,
  livePreview: false,
  parseError: null,
  hasUnsavedChanges: false,
  blockTypeName: null,
};

export const useSourcePeekStore = create<SourcePeekState>((set, get) => ({
  ...initialState,
  open: ({ markdown, range, blockTypeName }) =>
    set({
      ...initialState,
      isOpen: true,
      editingPos: range.from,
      range,
      markdown,
      originalMarkdown: markdown,
      savedMarkdown: markdown,
      blockTypeName: blockTypeName ?? null,
    }),
  close: () => set(initialState),
  setMarkdown: (markdown) => {
    const { savedMarkdown } = get();
    set({
      markdown,
      hasUnsavedChanges: markdown !== savedMarkdown,
      parseError: null,
    });
  },
  setParseError: (error) => set({ parseError: error }),
  toggleLivePreview: () => set((s) => ({ livePreview: !s.livePreview })),
  markSaved: () =>
    set((s) => ({
      // Rebaseline the dirty check to the just-saved content; the revert
      // target (`originalMarkdown`) is intentionally left untouched.
      savedMarkdown: s.markdown,
      hasUnsavedChanges: false,
    })),
  getOriginalMarkdown: () => get().originalMarkdown,
}));
