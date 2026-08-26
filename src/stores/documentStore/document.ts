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
import { ingestExternalText } from "@/utils/editorText";
import { INGEST_ORIGIN_SNAPSHOT } from "@/utils/ingestOrigin";
import { applyTransferLineMetadata } from "@/utils/transferLineMetadata";
import {
  assertCanonicalEditorText,
  assertNotRebuildingDocument,
  assertRestoreState,
  buildPostSaveState,
  createInitialDocument,
  updateDoc,
} from "./documentState";
import { adoptDiskConvention, buildIngestState } from "./ingestState";
import { useRevisionStore } from "./revision";
import type { DocumentStore } from "./storeContract";

// Re-export for backwards compatibility
export type { CursorInfo } from "@/types/cursorSync";
export type { DocumentState } from "./documentState";
export type { SetContentOptions } from "./storeContract";

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
    // Rebuilding an existing entry loses readOnly, mode and documentId — see
    // the assertion for why the last one is the dangerous part. Dev-only.
    assertNotRebuildingDocument(get().documents[tabId], tabId);
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

  setEditorContent: (tabId, canonicalEditorText, options) => {
    assertCanonicalEditorText(canonicalEditorText, "setEditorContent");
    const fromUserEdit = options?.fromUserEdit ?? true;
    const previous = get().documents[tabId]?.content;
    set((state) =>
      updateDoc(state, tabId, (doc) => ({
        content: canonicalEditorText,
        // A serialization sync is not a change: it may neither create dirt on a
        // document nobody edited nor clear dirt on one that was edited (an
        // auto-save flush can land before the debounced edit-flush).
        isDirty: fromUserEdit ? doc.savedContent !== canonicalEditorText : doc.isDirty,
      }))
    );
    // Same reasoning for the revision token: a re-serialization is not an edit,
    // so it must not make an MCP client's held revision look STALE.
    if (fromUserEdit) bumpRevisionIfContentChanged(tabId, previous, canonicalEditorText);
  },

  ingestExternalContent: (tabId, rawDiskText, origin, opts) => {
    // A baseline origin IS the document — create it if the tab has none; edits
    // have nothing to edit.
    //
    // Created INSIDE the same `set()` as the patch. Calling `initDocument`
    // first published an empty document to every subscriber before the real
    // content landed one write later, and `documentId` is the editor's remount
    // key — so a surface could mount on a document that did not exist yet.
    const creating =
      !get().documents[tabId] && INGEST_ORIGIN_SNAPSHOT[origin] === "baseline";
    // The tab-existence guard `initDocument` applies still has to hold: do not
    // resurrect an orphan entry for a tab that was closed mid-read (C1).
    if (creating && tabExistsGuard && !tabExistsGuard(tabId)) return;
    const previous = get().documents[tabId]?.content;
    let next: string | undefined;
    set((state) => {
      const base = creating
        ? createInitialDocument("", opts?.filePath ?? null)
        : state.documents[tabId];
      if (!base) return state;
      const patch = buildIngestState(base, rawDiskText, origin, opts);
      next = patch.content;
      return { documents: { ...state.documents, [tabId]: { ...base, ...patch } } };
    });
    // `next` stays undefined for a missing tab, so it cannot bump a revision.
    if (next !== undefined) bumpRevisionIfContentChanged(tabId, previous, next);
  },

  setFilePath: (tabId, path) =>
    set((state) => updateDoc(state, tabId, () => ({ filePath: path }))),

  markMissing: (tabId) =>
    set((state) => updateDoc(state, tabId, () => ({ isMissing: true }))),

  clearMissing: (tabId) =>
    set((state) => updateDoc(state, tabId, () => ({ isMissing: false }))),

  markDivergent: (tabId) =>
    set((state) => updateDoc(state, tabId, () => ({ isDivergent: true }))),

  // Binary reload: the counter moves, no text field does. See the contract for
  // why this is `documentId` rather than a second per-document flag.
  markBinaryFileChanged: (tabId) =>
    set((state) =>
      updateDoc(state, tabId, (doc) => ({ documentId: doc.documentId + 1 }))
    ),

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
