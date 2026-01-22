import { create } from "zustand";
import type { CursorInfo } from "@/types/cursorSync";

// Re-export for backwards compatibility
export type { NodeType, CursorInfo } from "@/types/cursorSync";

interface EditorState {
  content: string;
  savedContent: string;
  filePath: string | null;
  isDirty: boolean;
  focusModeEnabled: boolean;
  typewriterModeEnabled: boolean;
  sourceMode: boolean;
  wordWrap: boolean;
  showLineNumbers: boolean; // Show line numbers in code blocks
  documentId: number; // Increments on new document to force editor recreation
  cursorInfo: CursorInfo | null; // Cursor position for syncing between modes
  lastAutoSave: number | null; // Timestamp of last auto-save
}

interface EditorActions {
  setContent: (content: string) => void;
  loadContent: (content: string, filePath?: string | null) => void;
  setFilePath: (path: string | null) => void;
  markSaved: () => void;
  markAutoSaved: () => void;
  toggleFocusMode: () => void;
  toggleTypewriterMode: () => void;
  toggleSourceMode: () => void;
  toggleWordWrap: () => void;
  toggleLineNumbers: () => void;
  setCursorInfo: (info: CursorInfo | null) => void;
  reset: () => void;
}

const initialState: EditorState = {
  content: "",
  savedContent: "",
  filePath: null,
  isDirty: false,
  focusModeEnabled: false,
  typewriterModeEnabled: false,
  sourceMode: false,
  wordWrap: true,
  showLineNumbers: false,
  documentId: 0,
  cursorInfo: null,
  lastAutoSave: null,
};

export const useEditorStore = create<EditorState & EditorActions>((set) => ({
  ...initialState,

  setContent: (content) =>
    set((state) => ({
      content,
      isDirty: state.savedContent !== content,
    })),

  loadContent: (content, filePath) =>
    set((state) => ({
      content,
      savedContent: content,
      filePath: filePath ?? null,
      isDirty: false,
      documentId: state.documentId + 1,
    })),

  setFilePath: (filePath) => set({ filePath }),

  markSaved: () =>
    set((state) => ({
      savedContent: state.content,
      isDirty: false,
    })),

  markAutoSaved: () =>
    set((state) => ({
      savedContent: state.content,
      isDirty: false,
      lastAutoSave: Date.now(),
    })),

  toggleFocusMode: () =>
    set((state) => ({ focusModeEnabled: !state.focusModeEnabled })),

  toggleTypewriterMode: () =>
    set((state) => ({ typewriterModeEnabled: !state.typewriterModeEnabled })),

  toggleSourceMode: () =>
    set((state) => ({ sourceMode: !state.sourceMode })),

  toggleWordWrap: () =>
    set((state) => ({ wordWrap: !state.wordWrap })),

  toggleLineNumbers: () =>
    set((state) => ({ showLineNumbers: !state.showLineNumbers })),

  setCursorInfo: (cursorInfo) => set({ cursorInfo }),

  reset: () =>
    set((state) => ({
      ...initialState,
      documentId: state.documentId + 1,
    })),
}));
