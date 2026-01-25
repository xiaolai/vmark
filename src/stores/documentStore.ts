import { create } from "zustand";
import type { CursorInfo } from "@/types/cursorSync";
import type { HardBreakStyle, LineEnding } from "@/utils/linebreakDetection";

// Re-export for backwards compatibility
export type { NodeType, CursorInfo } from "@/types/cursorSync";

// Per-tab document state
export interface DocumentState {
  content: string;
  savedContent: string;
  filePath: string | null;
  isDirty: boolean;
  documentId: number;
  cursorInfo: CursorInfo | null;
  lastAutoSave: number | null;
  /** True when the file was deleted externally - show warning UI */
  isMissing: boolean;
  /** True when user chose "Keep my changes" after external modification - local differs from disk */
  isDivergent: boolean;
  lineEnding: LineEnding;
  hardBreakStyle: HardBreakStyle;
}

interface DocumentStore {
  // Documents keyed by tab ID (changed from window label)
  documents: Record<string, DocumentState>;

  // Actions - now take tabId instead of windowLabel
  initDocument: (tabId: string, content?: string, filePath?: string | null) => void;
  setContent: (tabId: string, content: string) => void;
  loadContent: (
    tabId: string,
    content: string,
    filePath?: string | null,
    meta?: { lineEnding?: LineEnding; hardBreakStyle?: HardBreakStyle }
  ) => void;
  setFilePath: (tabId: string, path: string | null) => void;
  markMissing: (tabId: string) => void;
  clearMissing: (tabId: string) => void;
  markDivergent: (tabId: string) => void;
  clearDivergent: (tabId: string) => void;
  markSaved: (tabId: string) => void;
  markAutoSaved: (tabId: string) => void;
  setCursorInfo: (tabId: string, info: CursorInfo | null) => void;
  setLineMetadata: (
    tabId: string,
    meta: { lineEnding?: LineEnding; hardBreakStyle?: HardBreakStyle }
  ) => void;
  removeDocument: (tabId: string) => void;

  // Selectors
  getDocument: (tabId: string) => DocumentState | undefined;
  getAllDirtyDocuments: () => string[]; // Returns tabIds
}

const createInitialDocument = (content = "", filePath: string | null = null): DocumentState => ({
  content,
  savedContent: content,
  filePath,
  isDirty: false,
  documentId: 0,
  cursorInfo: null,
  lastAutoSave: null,
  isMissing: false,
  isDivergent: false,
  lineEnding: "unknown",
  hardBreakStyle: "unknown",
});

/**
 * Helper to update a document by tabId.
 * Returns unchanged state if document doesn't exist.
 */
function updateDoc(
  state: { documents: Record<string, DocumentState> },
  tabId: string,
  updater: (doc: DocumentState) => Partial<DocumentState>
): { documents: Record<string, DocumentState> } {
  const doc = state.documents[tabId];
  if (!doc) return state;
  return {
    documents: {
      ...state.documents,
      [tabId]: { ...doc, ...updater(doc) },
    },
  };
}

export const useDocumentStore = create<DocumentStore>((set, get) => ({
  documents: {},

  initDocument: (tabId, content = "", filePath = null) =>
    set((state) => ({
      documents: {
        ...state.documents,
        [tabId]: createInitialDocument(content, filePath),
      },
    })),

  setContent: (tabId, content) =>
    set((state) =>
      updateDoc(state, tabId, (doc) => ({
        content,
        isDirty: doc.savedContent !== content,
      }))
    ),

  loadContent: (tabId, content, filePath, meta) =>
    set((state) =>
      updateDoc(state, tabId, (doc) => ({
        content,
        savedContent: content,
        filePath: filePath ?? null,
        isDirty: false,
        isDivergent: false, // Reload from disk clears divergent state
        documentId: doc.documentId + 1,
        lineEnding: meta?.lineEnding ?? doc.lineEnding,
        hardBreakStyle: meta?.hardBreakStyle ?? doc.hardBreakStyle,
      }))
    ),

  setFilePath: (tabId, path) =>
    set((state) => updateDoc(state, tabId, () => ({ filePath: path }))),

  markMissing: (tabId) =>
    set((state) => updateDoc(state, tabId, () => ({ isMissing: true }))),

  clearMissing: (tabId) =>
    set((state) => updateDoc(state, tabId, () => ({ isMissing: false }))),

  markDivergent: (tabId) =>
    set((state) => updateDoc(state, tabId, () => ({ isDivergent: true }))),

  clearDivergent: (tabId) =>
    set((state) => updateDoc(state, tabId, () => ({ isDivergent: false }))),

  markSaved: (tabId) =>
    set((state) =>
      updateDoc(state, tabId, (doc) => ({
        savedContent: doc.content,
        isDirty: false,
        isDivergent: false, // Manual save syncs local with disk
      }))
    ),

  markAutoSaved: (tabId) =>
    set((state) =>
      updateDoc(state, tabId, (doc) => ({
        savedContent: doc.content,
        isDirty: false,
        isDivergent: false, // Auto-save syncs local with disk
        lastAutoSave: Date.now(),
      }))
    ),

  setCursorInfo: (tabId, info) =>
    set((state) => updateDoc(state, tabId, () => ({ cursorInfo: info }))),

  setLineMetadata: (tabId, meta) =>
    set((state) =>
      updateDoc(state, tabId, (doc) => ({
        lineEnding: meta.lineEnding ?? doc.lineEnding,
        hardBreakStyle: meta.hardBreakStyle ?? doc.hardBreakStyle,
      }))
    ),

  removeDocument: (tabId) =>
    set((state) => {
      const { [tabId]: _, ...rest } = state.documents;
      return { documents: rest };
    }),

  getDocument: (tabId) => get().documents[tabId],

  getAllDirtyDocuments: () => {
    const { documents } = get();
    return Object.entries(documents)
      .filter(([_, doc]) => doc.isDirty)
      .map(([tabId]) => tabId);
  },
}));
