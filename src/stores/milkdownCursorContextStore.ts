/**
 * Milkdown Cursor Context Store
 *
 * Centralized store for cursor position context in Milkdown mode (ProseMirror).
 * Updated on every selection change, consumed by format toolbar, shortcuts, etc.
 */

import { create } from "zustand";
import type { EditorView } from "@milkdown/kit/prose/view";
import {
  type CursorContext,
  createEmptyCursorContext,
} from "@/types/cursorContext";

interface MilkdownCursorContextState {
  context: CursorContext;
  editorView: EditorView | null;
}

interface MilkdownCursorContextActions {
  setContext: (context: CursorContext, view: EditorView) => void;
  clearContext: () => void;
}

type MilkdownCursorContextStore = MilkdownCursorContextState &
  MilkdownCursorContextActions;

const initialState: MilkdownCursorContextState = {
  context: createEmptyCursorContext(),
  editorView: null,
};

export const useMilkdownCursorContextStore =
  create<MilkdownCursorContextStore>((set) => ({
    ...initialState,

    setContext: (context, view) => {
      set({ context, editorView: view });
    },

    clearContext: () => {
      set(initialState);
    },
  }));
