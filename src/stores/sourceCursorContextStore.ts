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
 *   - setContext skips no-op updates: computeSourceCursorContext() returns a
 *     fresh object every keystroke, so without a structural-equality guard the
 *     toolbar would re-render on every keypress even when nothing changed.
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
import { structuralEqual } from "@/utils/structuralEqual";

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

/** Manages Source mode cursor context — formatting state at cursor position for toolbar display. Use selectors, not destructuring. */
export const useSourceCursorContextStore = create<SourceCursorContextStore>(
  (set, get) => ({
    ...initialState,

    setContext: (context, view) => {
      const prev = get();
      if (prev.editorView === view && structuralEqual(prev.context, context)) {
        return;
      }
      set({ context, editorView: view });
    },

    clearContext: () => {
      set(initialState);
    },
  })
);
