import { create } from "zustand";

// Node types for cursor sync
export type NodeType =
  | "paragraph"
  | "heading"
  | "list_item"
  | "code_block"
  | "table_cell"
  | "blockquote";

// Cursor position info for syncing between editors
export interface CursorInfo {
  contentLineIndex: number; // Line index excluding blank lines (0-based)
  wordAtCursor: string; // Word at or near cursor for fine positioning
  offsetInWord: number; // Character offset within the word
  nodeType: NodeType; // Type of block the cursor is in
  percentInLine: number; // Cursor position as percentage (0-1) for fallback
  contextBefore: string; // Few chars before cursor for disambiguation
  contextAfter: string; // Few chars after cursor for disambiguation
}

interface EditorState {
  content: string;
  savedContent: string;
  filePath: string | null;
  isDirty: boolean;
  focusModeEnabled: boolean;
  typewriterModeEnabled: boolean;
  sourceMode: boolean;
  wordWrap: boolean;
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

  setCursorInfo: (cursorInfo) => set({ cursorInfo }),

  reset: () =>
    set((state) => ({
      ...initialState,
      documentId: state.documentId + 1,
    })),
}));
