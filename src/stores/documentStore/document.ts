/**
 * Per-tab document state — content snapshots, dirty tracking, file path,
 * cursor position, line endings, hard-break style, per-doc editor mode
 * (ADR-009), and external-change detection.
 *
 * Re-exported through `../documentStore.ts` so existing consumers keep
 * `import { useDocumentStore } from "@/stores/documentStore"`.
 *
 * @coordinates-with tabStore.ts — tab ID is the key into the documents map
 * @coordinates-with useAutoSave.ts — reads isDirty to trigger auto-save
 * @coordinates-with useFileWatcher.ts — calls markMissing/markDivergent on external changes
 * @coordinates-with useTabModeSync.ts — mirrors per-doc mode → window sourceMode (ADR-009)
 * @module stores/documentStore/document
 */

import { create } from "zustand";
import type { CursorInfo } from "@/types/cursorSync";
import type { HardBreakStyle, LineEnding } from "@/utils/linebreakDetection";

// Re-export for backwards compatibility
export type { CursorInfo } from "@/types/cursorSync";

/** Per-tab document state — content snapshots, dirty tracking, file path, and external-change flags. */
export interface DocumentState {
  content: string;
  savedContent: string;
  /** Content as written to disk (post-normalization). Used for external-change detection. */
  lastDiskContent: string;
  filePath: string | null;
  isDirty: boolean;
  documentId: number;
  cursorInfo: CursorInfo | null;
  /** Currently selected text in the active editor; empty when no selection. */
  selectedText: string;
  lastAutoSave: number | null;
  /** True when the file was deleted externally - show warning UI */
  isMissing: boolean;
  /** True when user chose "Keep my changes" after external modification - local differs from disk */
  isDivergent: boolean;
  /** True when document is in read-only mode — blocks new edits but allows save */
  readOnly: boolean;
  lineEnding: LineEnding;
  hardBreakStyle: HardBreakStyle;
  /**
   * Per-document editor mode (ADR-009). Defaults to "wysiwyg"; the
   * window-scoped `useUIStore.sourceMode` is the public toggle and is
   * mirrored into the active document's mode on toggle. Persisting
   * per-doc mode makes "two tabs in one window, different modes" a
   * representable state; selectors layered on top of this enable
   * future per-tab mode switching without further schema changes.
   */
  mode: "wysiwyg" | "source";
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

  setReadOnly: (tabId: string, readOnly: boolean) => void;
  toggleReadOnly: (tabId: string) => void;
  isReadOnly: (tabId: string) => boolean;

  markSaved: (tabId: string, lastDiskContent?: string) => void;
  markAutoSaved: (tabId: string, lastDiskContent?: string) => void;
  /**
   * Silently refresh the stored disk snapshot without touching content, dirty
   * state, or any UI flags. Used when a cloud sync engine rewrote the file with
   * a benign change (line endings/BOM/trailing newline) so that subsequent
   * byte-for-byte comparisons match.
   */
  updateLastDiskContent: (tabId: string, diskContent: string) => void;
  setCursorInfo: (tabId: string, info: CursorInfo | null) => void;
  /** Per-doc editor mode (ADR-009). */
  setMode: (tabId: string, mode: "wysiwyg" | "source") => void;
  setSelectedText: (tabId: string, text: string) => void;
  setLineMetadata: (
    tabId: string,
    meta: { lineEnding?: LineEnding; hardBreakStyle?: HardBreakStyle }
  ) => void;
  removeDocument: (tabId: string) => void;

  // Selectors
  getDocument: (tabId: string) => DocumentState | undefined;
  getAllDirtyDocuments: () => string[]; // Returns tabIds
}

/**
 * Tab-existence guard for `initDocument` (C1, defense-in-depth).
 *
 * documentStore stays decoupled from tabStore: the app wires a predicate at
 * the composition root (`main.tsx`) via `setTabExistenceGuard`, rather than
 * documentStore importing tabStore. The default is permissive (`null`), so
 * pure store unit tests — and any context without tab tracking — behave
 * exactly as before.
 *
 * When wired, `initDocument` no-ops if the tab was closed while its file read
 * was in flight (the orphan-resurrection race), mirroring the `updateDoc`
 * missing-key guard the sibling mutators already use. This is defense in depth
 * behind the primary caller-side re-check in `useFileOpen`.
 */
let tabExistsGuard: ((tabId: string) => boolean) | null = null;

/** Wire (or clear with `null`) the tab-existence predicate consulted by
 *  `initDocument`. Called once at app startup; reset to `null` in tests. */
export function setTabExistenceGuard(fn: ((tabId: string) => boolean) | null): void {
  tabExistsGuard = fn;
}

const createInitialDocument = (content = "", filePath: string | null = null): DocumentState => ({
  content,
  savedContent: content,
  lastDiskContent: content,
  filePath,
  isDirty: false,
  documentId: 0,
  cursorInfo: null,
  selectedText: "",
  lastAutoSave: null,
  isMissing: false,
  isDivergent: false,
  readOnly: false,
  lineEnding: "unknown",
  hardBreakStyle: "unknown",
  mode: "wysiwyg",
});

/**
 * Helper to update a document by tabId. Returns unchanged state if the
 * document doesn't exist.
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

/**
 * Compute post-save state. Compares written disk content against current editor
 * content to handle TOCTOU races (user edits during async save).
 */
function buildPostSaveState(doc: DocumentState, lastDiskContent: string | undefined) {
  const diskContent = lastDiskContent ?? doc.content;
  return {
    savedContent: diskContent,
    lastDiskContent: diskContent,
    isDirty: doc.content !== diskContent,
    isDivergent: false,
  };
}

/** Manages per-tab document content, dirty tracking, and external-change detection. Use selectors, not destructuring. */
export const useDocumentStore = create<DocumentStore>((set, get) => ({
  documents: {},

  initDocument: (tabId, content = "", filePath = null, savedContent?) => {
    // Defense-in-depth (C1): if the tab was closed while its file read was in
    // flight, don't resurrect an orphan document entry. No-op when the guard
    // is wired and reports the tab gone; permissive (proceed) when unwired.
    if (tabExistsGuard && !tabExistsGuard(tabId)) {
      return;
    }
    const doc = createInitialDocument(content, filePath);
    if (savedContent !== undefined) {
      doc.savedContent = savedContent;
      doc.lastDiskContent = savedContent;
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
        filePath: filePath === undefined ? doc.filePath : filePath,
        isDirty: false,
        isDivergent: false, // Reload from disk clears divergent state
        documentId: doc.documentId + 1,
        selectedText: "",
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

  setReadOnly: (tabId, readOnly) =>
    set((state) => updateDoc(state, tabId, () => ({ readOnly }))),

  toggleReadOnly: (tabId) =>
    set((state) => updateDoc(state, tabId, (doc) => ({ readOnly: !doc.readOnly }))),

  isReadOnly: (tabId) => {
    const doc = get().documents[tabId];
    return doc?.readOnly ?? false;
  },

  markSaved: (tabId, lastDiskContent) =>
    set((state) =>
      updateDoc(state, tabId, (doc) => buildPostSaveState(doc, lastDiskContent))
    ),

  markAutoSaved: (tabId, lastDiskContent) =>
    set((state) =>
      updateDoc(state, tabId, (doc) => ({
        ...buildPostSaveState(doc, lastDiskContent),
        lastAutoSave: Date.now(),
      }))
    ),

  updateLastDiskContent: (tabId, diskContent) =>
    set((state) => updateDoc(state, tabId, () => ({ lastDiskContent: diskContent }))),

  setCursorInfo: (tabId, info) =>
    set((state) => updateDoc(state, tabId, () => ({ cursorInfo: info }))),

  setMode: (tabId, mode) =>
    set((state) => updateDoc(state, tabId, () => ({ mode }))),

  setSelectedText: (tabId, text) =>
    set((state) => {
      const doc = state.documents[tabId];
      if (!doc || doc.selectedText === text) return state;
      return updateDoc(state, tabId, () => ({ selectedText: text }));
    }),

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
