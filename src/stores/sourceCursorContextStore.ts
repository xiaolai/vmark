/**
 * Source Cursor Context Store
 *
 * Centralized store for cursor position context in source mode (CodeMirror).
 * Updated on every selection change, consumed by format popup, shortcuts, etc.
 */

import { create } from "zustand";
import type { EditorView } from "@codemirror/view";
import {
  type CursorContext,
  createEmptyCursorContext,
} from "@/types/cursorContext";

interface SourceCursorContextState {
  context: CursorContext;
  editorView: EditorView | null;
}

interface SourceCursorContextActions {
  setContext: (context: CursorContext, view: EditorView) => void;
  clearContext: () => void;
}

type SourceCursorContextStore = SourceCursorContextState &
  SourceCursorContextActions;

const initialState: SourceCursorContextState = {
  context: createEmptyCursorContext(),
  editorView: null,
};

export const useSourceCursorContextStore = create<SourceCursorContextStore>(
  (set) => ({
    ...initialState,

    setContext: (context, view) => {
      set({ context, editorView: view });
    },

    clearContext: () => {
      set(initialState);
    },
  })
);
