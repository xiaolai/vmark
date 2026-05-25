/**
 * Editor Store — T09 consolidation.
 *
 * Merges three legacy stores into a single Zustand store with three
 * namespaced slices:
 *
 * - activeEditorStore       → state.active + active* actions
 * - tiptapEditorStore       → state.tiptap + setTiptapEditor / setTiptapContext / clearTiptap
 * - sourceCursorContextStore → state.source + setSourceContext / clearSourceContext
 *
 * Slice names disambiguate the colliding `context`, `editorView`, and
 * `setContext` fields.
 *
 * @module stores/editorStore
 */

import { create } from "zustand";
import type { Editor as TiptapEditor } from "@tiptap/core";
import type { EditorView as TiptapEditorView } from "@tiptap/pm/view";
import type { EditorView as CodeMirrorView } from "@codemirror/view";
import {
  type CursorContext as SourceCursorContext,
  createEmptyCursorContext,
} from "@/types/cursorContext";
import type { CursorContext as TiptapCursorContext } from "@/plugins/toolbarContext/types";
import { structuralEqual } from "@/utils/structuralEqual";

/* ────────────────────────────── slices ────────────────────────────────── */

interface ActiveSlice {
  activeWysiwygEditor: TiptapEditor | null;
  activeWysiwygTabId: string | null;
  activeSourceView: CodeMirrorView | null;
  activeSourceTabId: string | null;
}

interface TiptapSlice {
  editor: TiptapEditor | null;
  editorView: TiptapEditorView | null;
  context: TiptapCursorContext | null;
}

interface SourceSlice {
  context: SourceCursorContext;
  editorView: CodeMirrorView | null;
}

interface EditorStoreState {
  active: ActiveSlice;
  tiptap: TiptapSlice;
  source: SourceSlice;
}

const initialActive: ActiveSlice = {
  activeWysiwygEditor: null,
  activeWysiwygTabId: null,
  activeSourceView: null,
  activeSourceTabId: null,
};

const initialTiptap: TiptapSlice = {
  editor: null,
  editorView: null,
  context: null,
};

const initialSource: SourceSlice = {
  context: createEmptyCursorContext(),
  editorView: null,
};

/* ───────────────────────── actions ────────────────────────────────────── */

interface EditorStoreActions {
  /* active slice */
  setActiveWysiwygEditor: (
    editor: TiptapEditor | null,
    tabId?: string | null,
  ) => void;
  setActiveSourceView: (
    view: CodeMirrorView | null,
    tabId?: string | null,
  ) => void;
  clearWysiwygEditorIfMatch: (editor: TiptapEditor) => void;
  clearSourceViewIfMatch: (view: CodeMirrorView) => void;
  clearActiveEditors: () => void;

  /* tiptap slice */
  setTiptapEditor: (editor: TiptapEditor | null) => void;
  setTiptapContext: (
    context: TiptapCursorContext,
    view: TiptapEditorView,
  ) => void;
  clearTiptap: () => void;

  /* source slice */
  setSourceContext: (
    context: SourceCursorContext,
    view: CodeMirrorView,
  ) => void;
  clearSourceContext: () => void;
}

export type EditorStore = EditorStoreState & EditorStoreActions;

/* ───────────────────────── dev helper ─────────────────────────────────── */

type VMarkDebug = { editorView: TiptapEditorView | null };

function publishDebugEditorView(view: TiptapEditorView | null): void {
  if (!import.meta.env.DEV || typeof window === "undefined") return;
  (window as unknown as { __VMARK_DEBUG__?: VMarkDebug }).__VMARK_DEBUG__ = {
    editorView: view,
  };
}

/* ───────────────────────── factory ────────────────────────────────────── */

export const useEditorStore = create<EditorStore>((set, get) => ({
  active: initialActive,
  tiptap: initialTiptap,
  source: initialSource,

  /* active slice */
  setActiveWysiwygEditor: (editor, tabId) =>
    set((s) => ({
      active: {
        ...s.active,
        activeWysiwygEditor: editor,
        activeWysiwygTabId: editor ? tabId ?? null : null,
      },
    })),
  setActiveSourceView: (view, tabId) =>
    set((s) => ({
      active: {
        ...s.active,
        activeSourceView: view,
        activeSourceTabId: view ? tabId ?? null : null,
      },
    })),
  clearWysiwygEditorIfMatch: (editor) => {
    if (get().active.activeWysiwygEditor === editor) {
      set((s) => ({
        active: {
          ...s.active,
          activeWysiwygEditor: null,
          activeWysiwygTabId: null,
        },
      }));
    }
  },
  clearSourceViewIfMatch: (view) => {
    if (get().active.activeSourceView === view) {
      set((s) => ({
        active: {
          ...s.active,
          activeSourceView: null,
          activeSourceTabId: null,
        },
      }));
    }
  },
  clearActiveEditors: () => set({ active: initialActive }),

  /* tiptap slice */
  setTiptapEditor: (editor) => {
    /* v8 ignore next -- @preserve null path for editor cleared on unmount */
    set((s) => ({
      tiptap: {
        ...s.tiptap,
        editor,
        editorView: editor ? editor.view : null,
      },
    }));
    publishDebugEditorView(editor ? editor.view : null);
  },
  setTiptapContext: (context, view) => {
    const prev = get().tiptap;
    if (
      prev.editorView === view &&
      prev.context !== null &&
      structuralEqual(prev.context, context)
    ) {
      return;
    }
    set((s) => ({
      tiptap: { ...s.tiptap, context, editorView: view },
    }));
  },
  clearTiptap: () => {
    set({ tiptap: initialTiptap });
    publishDebugEditorView(null);
  },

  /* source slice */
  setSourceContext: (context, view) => {
    const prev = get().source;
    if (prev.editorView === view && structuralEqual(prev.context, context)) {
      return;
    }
    set((s) => ({
      source: { ...s.source, context, editorView: view },
    }));
  },
  clearSourceContext: () => set({ source: initialSource }),
}));
