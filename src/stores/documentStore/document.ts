/**
 * Per-tab document state — content snapshots, dirty tracking, file path,
 * cursor position, line endings, hard-break style, per-doc editor mode
 * (ADR-009), and external-change detection.
 *
 * Re-exported through `../documentStore.ts` so existing consumers keep
 * `import { useDocumentStore } from "@/stores/documentStore"`.
 *
 * Two doors in — `setEditorContent` (editor domain, asserts its input is
 * already canonical; every production caller migrated, `setContent` survives
 * only as a deprecated test-facing alias gated by externalWriterGate.test) and
 * the external door: `initDocument`/`loadContent`/`ingestExternalContent`, all
 * canonicalising via `ingestExternalText`. The field contract they write
 * against lives with the shape, in `documentState.ts`.
 *
 * @coordinates-with tabStore.ts — tab ID is the key into the documents map
 * @coordinates-with useAutoSave.ts — reads isDirty to trigger auto-save
 * @coordinates-with useFileWatcher.ts — calls markMissing/markDivergent on external changes
 * @coordinates-with useTabModeSync.ts — mirrors per-doc mode → window sourceMode (ADR-009)
 * @module stores/documentStore/document
 */

import { create } from "zustand";
import type { CursorInfo } from "@/types/cursorSync";
import { canonicalizeLineEndings, ingestExternalText } from "@/utils/editorText";
import type { IngestOrigin, LineMetadata } from "@/utils/ingestOrigin";
import type { HardBreakStyle, LineEnding } from "@/utils/linebreakDetection";
import type { DocumentState, SaveSnapshots } from "./documentState";
import {
  assertCanonicalEditorText,
  buildIngestState,
  buildLoadState,
  buildPostSaveState,
  createInitialDocument,
  updateDoc,
} from "./documentState";
import { useRevisionStore } from "./revision";

// Re-export for backwards compatibility
export type { CursorInfo } from "@/types/cursorSync";
export type { DocumentState } from "./documentState";

interface DocumentStore {
  // Documents keyed by tab ID (changed from window label)
  documents: Record<string, DocumentState>;

  // Actions - now take tabId instead of windowLabel
  initDocument: (tabId: string, content?: string, filePath?: string | null, savedContent?: string) => void;
  /**
   * EDITOR-domain write: the caller guarantees canonical text (LF, no BOM).
   * Asserts that in development; performs no scan in production.
   */
  setEditorContent: (tabId: string, canonicalEditorText: string) => void;
  /**
   * EXTERNAL-domain write: canonicalises `rawDiskText` and decides the
   * document's line metadata from the `origin`'s precedence rule (WI-1.3).
   * `persisted` carries a snapshot's own metadata where the origin has one.
   */
  ingestExternalContent: (
    tabId: string,
    rawDiskText: string,
    origin: IngestOrigin,
    persisted?: Partial<LineMetadata>
  ) => void;
  /** @deprecated Use `setEditorContent` (editor domain) or `loadContent` (external). */
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

  /**
   * Record a successful write. REQUIRED dual snapshot (WI-1.4): the optional
   * single-string form let an un-migrated caller type-check clean while the
   * store fell back to assuming disk held the LF editor text.
   */
  markSaved: (tabId: string, snapshots: SaveSnapshots) => void;
  /** `markSaved` plus the auto-save timestamp — an auto-save IS a save. */
  markAutoSaved: (tabId: string, snapshots: SaveSnapshots) => void;
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
      // Both sides through the same boundary before comparing — a raw
      // `savedContent` reported every CRLF or BOM'd document dirty on open.
      const canonicalSaved = ingestExternalText(savedContent).canonicalEditorText;
      doc.savedContent = canonicalSaved;
      doc.lastDiskContent = savedContent;
      doc.isDirty = canonicalSaved !== doc.content;
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

  ingestExternalContent: (tabId, rawDiskText, origin, persisted) => {
    const previous = get().documents[tabId]?.content;
    let next: string | undefined;
    set((state) =>
      updateDoc(state, tabId, (doc) => {
        const patch = buildIngestState(doc, rawDiskText, origin, persisted);
        next = patch.content;
        return patch;
      })
    );
    // `next` stays undefined for a missing tab, so it cannot bump a revision.
    if (next !== undefined) bumpRevisionIfContentChanged(tabId, previous, next);
  },

  // Delegates INTO the guard: the alias's only caller class is tests
  // (externalWriterGate.test enforces that), and they get the assert too.
  setContent: (tabId, content) => {
    get().setEditorContent(tabId, content);
  },

  loadContent: (tabId, content, filePath, meta) => {
    const previous = get().documents[tabId]?.content;
    set((state) =>
      updateDoc(state, tabId, (doc) => buildLoadState(doc, content, filePath, meta))
    );
    bumpRevisionIfContentChanged(tabId, previous, canonicalizeLineEndings(content));
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
