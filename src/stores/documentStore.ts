/**
 * Document Store
 *
 * Purpose: Per-tab document state — content, dirty tracking, file path,
 *   cursor position, line endings, and external-change detection.
 *
 * Pipeline: Editor keystroke → setContent(tabId, text) → isDirty computed
 *   from savedContent comparison → useAutoSave reads isDirty → saveToPath()
 *   → markSaved()/markAutoSaved() → isDirty = false
 *
 * Key decisions:
 *   - State keyed by tab ID (not window label) so documents survive tab moves.
 *   - Three content snapshots per doc: `content` (current), `savedContent`
 *     (last save), `lastDiskContent` (what's on disk after normalization).
 *     This three-way tracking enables external-change detection.
 *   - isDivergent flag tracks "keep my changes" state after external file
 *     modification — local content intentionally differs from disk.
 *   - isMissing flag tracks externally-deleted files for UI warning.
 *   - Uses guarded updateDoc() helper — no-ops if tab ID doesn't exist.
 *
 * Known limitations:
 *   - No persistence — document content is only saved via explicit save
 *     actions, not via store middleware.
 *   - documentId counter is per-session — not globally unique.
 *
 * @coordinates-with tabStore.ts — tab ID is the key into documents map
 * @coordinates-with useAutoSave.ts — reads isDirty to trigger auto-save
 * @coordinates-with useFileWatcher.ts — calls markMissing/markDivergent on external changes
 * @module stores/documentStore
 */

import { create } from "zustand";
import type { CursorInfo } from "@/types/cursorSync";
import type { HardBreakStyle, LineEnding } from "@/utils/linebreakDetection";

// Re-export for backwards compatibility
export type { NodeType, CursorInfo } from "@/types/cursorSync";

// Per-tab document state
export interface DocumentState {
  content: string;
  savedContent: string;
  /** Content as written to disk (post-normalization). Used for external-change detection. */
  lastDiskContent: string;
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
  initDocument: (tabId: string, content?: string, filePath?: string | null, savedContent?: string) => void;
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
  markSaved: (tabId: string, lastDiskContent?: string) => void;
  markAutoSaved: (tabId: string, lastDiskContent?: string) => void;
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
  lastDiskContent: content,
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

  initDocument: (tabId, content = "", filePath = null, savedContent?) => {
    const doc = createInitialDocument(content, filePath);
    if (savedContent !== undefined) {
      doc.savedContent = savedContent;
      doc.isDirty = savedContent !== content;
    }
    set((state) => ({
      documents: { ...state.documents, [tabId]: doc },
    }));
  },

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
        lastDiskContent: content,
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

  markSaved: (tabId, lastDiskContent) =>
    set((state) =>
      updateDoc(state, tabId, (doc) => ({
        savedContent: doc.content,
        lastDiskContent: lastDiskContent ?? doc.content,
        isDirty: false,
        isDivergent: false, // Manual save syncs local with disk
      }))
    ),

  markAutoSaved: (tabId, lastDiskContent) =>
    set((state) =>
      updateDoc(state, tabId, (doc) => ({
        savedContent: doc.content,
        lastDiskContent: lastDiskContent ?? doc.content,
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
