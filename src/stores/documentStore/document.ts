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
import type { DocumentState } from "./documentState";
import {
  buildPostSaveState,
  createInitialDocument,
  updateDoc,
} from "./documentState";
import { useRevisionStore } from "./revision";

// Re-export for backwards compatibility
export type { CursorInfo } from "@/types/cursorSync";
export type { DocumentState } from "./documentState";

/** Options for {@link DocumentStore.setContent}. */
export interface SetContentOptions {
  /**
   * Whether this write carries a change the USER made. Default true.
   *
   * The WYSIWYG flush passes `false` when it is only re-serializing a document
   * nobody edited. That distinction is load-bearing: the serializer's canonical
   * output is not byte-identical to arbitrary on-disk markdown, so treating
   * such a flush as an edit made auto-save (which flushes BEFORE testing
   * `isDirty`) rewrite files the user had merely opened.
   */
  fromUserEdit?: boolean;
}

interface DocumentStore {
  // Documents keyed by tab ID (changed from window label)
  documents: Record<string, DocumentState>;

  // Actions - now take tabId instead of windowLabel
  initDocument: (tabId: string, content?: string, filePath?: string | null, savedContent?: string) => void;
  setContent: (tabId: string, content: string, options?: SetContentOptions) => void;
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

/**
 * WI-1: invalidate the MCP revision whenever a tab's content actually changes.
 *
 * This is the single choke point every content writer passes through. Wiring
 * the bump into the Tiptap transaction listener alone left CodeMirror source
 * mode, the split-pane source editor, the workflow side panel, external-file
 * reloads and history restore able to change content while an already-read
 * revision stayed valid — so an AI write carrying it passed the STALE check
 * and clobbered the user's edits.
 *
 * Both `setContent` and `loadContent` route through here: they replace content
 * for different reasons (edit vs. reload) but have identical revision
 * semantics, and keeping one primitive is what stops them drifting apart
 * again. Guarded on a real change so a no-op write — the RAF-debounced Tiptap
 * flush re-serializes and re-sets identical content on every update — cannot
 * manufacture a false STALE.
 */
function bumpRevisionIfContentChanged(
  tabId: string,
  previous: string | undefined,
  next: string
): void {
  if (previous !== undefined && previous !== next) {
    useRevisionStore.getState().updateRevision(tabId);
  }
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

  setContent: (tabId, content, options) => {
    const fromUserEdit = options?.fromUserEdit ?? true;
    const previous = get().documents[tabId]?.content;
    set((state) =>
      updateDoc(state, tabId, (doc) => ({
        content,
        // A serialization sync is not a change: it may neither create dirt on a
        // document nobody edited nor clear dirt on one that was edited (an
        // auto-save flush can land before the debounced edit-flush).
        isDirty: fromUserEdit ? doc.savedContent !== content : doc.isDirty,
      }))
    );
    // Same reasoning for the revision token: a re-serialization is not an edit,
    // so it must not make an MCP client's held revision look STALE.
    if (fromUserEdit) bumpRevisionIfContentChanged(tabId, previous, content);
  },

  loadContent: (tabId, content, filePath, meta) => {
    const previous = get().documents[tabId]?.content;
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
    );
    bumpRevisionIfContentChanged(tabId, previous, content);
  },

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
