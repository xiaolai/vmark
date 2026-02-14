/**
 * Source Cursor Context Store
 *
 * Purpose: Cursor context for Source mode (CodeMirror) — updated on every
 *   selection change, consumed by the universal toolbar and format shortcuts
 *   to show active formatting state in source mode.
 *
 * Key decisions:
 *   - Mirrors tiptapEditorStore pattern but for CodeMirror's EditorView.
 *   - CursorContext tracks: bold, italic, heading level, list type, inside code
 *     block, etc. — parsed from markdown syntax around the cursor.
 *
 * @coordinates-with tiptapEditorStore.ts — same role for WYSIWYG mode
 * @coordinates-with UniversalToolbar — reads context to highlight active buttons
 * @module stores/sourceCursorContextStore
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
