/**
 * Per-tab document state — content snapshots, dirty tracking, file path,
 * cursor position, line endings, hard-break style, per-doc editor mode
 * (ADR-009), and external-change detection.
 *
 * Re-exported through `../documentStore.ts` so existing consumers keep
 * `import { useDocumentStore } from "@/stores/documentStore"`.
 *
 * Two doors in — `setEditorContent` (editor domain, asserts canonical input;
 * `setContent` survives only as a deprecated test alias, gated by
 * externalWriterGate.test) and the external door
 * (`initDocument`/`ingestExternalContent`), both canonicalising via
 * `ingestExternalText`. `loadContent` is GONE: it duplicated the ingest
 * baseline branch and had drifted from it (see ingestState.ts). The field contract lives in `documentState.ts`.
 *
 * @coordinates-with tabStore.ts — tab ID is the key into the documents map
 * @coordinates-with useAutoSave.ts — reads isDirty to trigger auto-save
 * @coordinates-with useFileWatcher.ts — calls markMissing/markDivergent on external changes
 * @coordinates-with useTabModeSync.ts — mirrors per-doc mode → window sourceMode (ADR-009)
 * @module stores/documentStore/document
 */

import { create } from "zustand";
import type { CursorInfo } from "@/types/cursorSync";
import { ingestExternalText } from "@/utils/editorText";
import { INGEST_ORIGIN_SNAPSHOT, type IngestOrigin } from "@/utils/ingestOrigin";
import type { HardBreakStyle, LineEnding } from "@/utils/linebreakDetection";
import { applyTransferLineMetadata } from "@/utils/transferLineMetadata";
import type { DocumentRestoreState, DocumentState, SaveSnapshots } from "./documentState";
import {
  assertCanonicalEditorText,
  assertRestoreState,
  buildPostSaveState,
  createInitialDocument,
  updateDoc,
} from "./documentState";
import {
  adoptDiskConvention,
  buildIngestState,
  type IngestOptions,
} from "./ingestState";
import { useRevisionStore } from "./revision";

// Re-export for backwards compatibility
export type { CursorInfo } from "@/types/cursorSync";
export type { DocumentRestoreState, DocumentState } from "./documentState";

interface DocumentStore {
  // Documents keyed by tab ID (changed from window label)
  documents: Record<string, DocumentState>;

  // Actions - now take tabId instead of windowLabel
  /** Create (or reset) a document; `restore` carries a TRANSFER's state. */
  initDocument: (
    tabId: string,
    content?: string,
    filePath?: string | null,
    restore?: DocumentRestoreState
  ) => void;
  /**
   * EDITOR-domain write: the caller guarantees canonical text (LF, no BOM).
   * Asserts that in development; performs no scan in production.
   */
  setEditorContent: (tabId: string, canonicalEditorText: string) => void;
  /**
   * EXTERNAL-domain write: canonicalises and applies the `origin`'s precedence
   * rule (WI-1.3). A BASELINE origin creates the document when the tab has
   * none; an EDIT origin on a missing tab is a no-op.
   */
  ingestExternalContent: (
    tabId: string,
    rawDiskText: string,
    origin: IngestOrigin,
    opts?: IngestOptions
  ) => void;
  /**
   * @deprecated Use `setEditorContent` (editor domain) or `ingestExternalContent`
   * (external). This pointed at `loadContent`, which the header of this same
   * file records as GONE — a deleted API recommended twelve lines below the
   * note recording its deletion.
   */
  setContent: (tabId: string, content: string) => void;
  setFilePath: (tabId: string, path: string | null) => void;
  markMissing: (tabId: string) => void;
  clearMissing: (tabId: string) => void;
  markDivergent: (tabId: string) => void;

  setReadOnly: (tabId: string, readOnly: boolean) => void;
  toggleReadOnly: (tabId: string) => void;
  isReadOnly: (tabId: string) => boolean;

  /**
   * Record a successful write. REQUIRED dual snapshot (WI-1.4): an optional
   * single string let un-migrated callers type-check clean while the store
   * assumed disk held the LF editor text.
   */
  markSaved: (tabId: string, snapshots: SaveSnapshots) => void;
  /** `markSaved` plus the auto-save timestamp — an auto-save IS a save. */
  markAutoSaved: (tabId: string, snapshots: SaveSnapshots) => void;
  /**
   * Adopt a benign external rewrite: refresh the disk snapshot AND re-derive
   * the file's convention from it, touching nothing else (WI-1.6). Refreshing
   * only the snapshot left the convention stale, so the next `preserve` save
   * wrote the OLD one back and the sync engine kept flipping the file.
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
 * documentStore stays decoupled from tabStore: the app wires a predicate at the
 * composition root (`main.tsx`) rather than importing tabStore here. The
 * default is permissive (`null`), so pure store tests behave as before. When
 * wired, `initDocument` no-ops for a tab closed mid-read (the
 * orphan-resurrection race), behind the caller-side re-check in `useFileOpen`.
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
 * The single choke point every content writer passes through — wiring the bump
 * into the Tiptap listener alone left source mode, split panes, workflows,
 * external reloads and history restore able to change content while an
 * already-read revision stayed valid, so an AI write passed the STALE check
 * and clobbered the user's edits. Guarded on a real change so the RAF-debounced
 * flush re-setting identical content cannot manufacture a false STALE.
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

  initDocument: (tabId, content = "", filePath = null, restore?) => {
    // Defense-in-depth (C1): don't resurrect an orphan entry for a tab closed
    // mid-read. No-op when the guard reports it gone; permissive when unwired.
    if (tabExistsGuard && !tabExistsGuard(tabId)) {
      return;
    }
    const doc = createInitialDocument(content, filePath);
    if (restore) {
      assertRestoreState(restore);
      // Both sides through the same boundary before comparing — a raw
      // `savedContent` reported every CRLF or BOM'd document dirty on open.
      const canonicalSaved = ingestExternalText(restore.savedContent).canonicalEditorText;
      doc.savedContent = canonicalSaved;
      // The DISK snapshot, when the sender has one. Falling back to the
      // canonical text is the old behaviour and the best available guess.
      doc.lastDiskContent = restore.lastDiskContent ?? restore.savedContent;
      doc.isDirty = canonicalSaved !== doc.content;
      // The file's convention, which canonical text erased. `createInitialDocument`
      // derives hardBreakStyle (it survives canonicalisation) but cannot know
      // lineEnding or hasBom — only the sender does.
      Object.assign(doc, applyTransferLineMetadata(restore));
    }
    set((state) => ({
      documents: { ...state.documents, [tabId]: doc },
    }));
  },

  setEditorContent: (tabId, canonicalEditorText) => {
    assertCanonicalEditorText(canonicalEditorText, "setEditorContent");
    const previous = get().documents[tabId]?.content;
    set((state) =>
      updateDoc(state, tabId, (doc) => ({
        content: canonicalEditorText,
        isDirty: doc.savedContent !== canonicalEditorText,
      }))
    );
    bumpRevisionIfContentChanged(tabId, previous, canonicalEditorText);
  },

  ingestExternalContent: (tabId, rawDiskText, origin, opts) => {
    // A baseline origin IS the document — create it if the tab has none
    // (initDocument keeps the tab-existence guard); edits have nothing to edit.
    if (!get().documents[tabId] && INGEST_ORIGIN_SNAPSHOT[origin] === "baseline") {
      get().initDocument(tabId, "", opts?.filePath ?? null);
    }
    const previous = get().documents[tabId]?.content;
    let next: string | undefined;
    set((state) =>
      updateDoc(state, tabId, (doc) => {
        const patch = buildIngestState(doc, rawDiskText, origin, opts);
        next = patch.content;
        return patch;
      })
    );
    // `next` stays undefined for a missing tab, so it cannot bump a revision.
    if (next !== undefined) bumpRevisionIfContentChanged(tabId, previous, next);
  },

  // Delegates INTO the guard; only tests may call it (externalWriterGate.test).
  setContent: (tabId, content) => {
    get().setEditorContent(tabId, content);
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

  markSaved: (tabId, snapshots) =>
    set((state) =>
      updateDoc(state, tabId, (doc) => buildPostSaveState(doc, snapshots))
    ),

  markAutoSaved: (tabId, snapshots) =>
    set((state) =>
      updateDoc(state, tabId, (doc) => ({
        ...buildPostSaveState(doc, snapshots),
        lastAutoSave: Date.now(),
      }))
    ),

  updateLastDiskContent: (tabId, diskContent) =>
    set((state) => updateDoc(state, tabId, () => adoptDiskConvention(diskContent))),

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
