/**
 * Purpose: the document store's public contract — its state shape and every
 * action's signature.
 *
 * Split out of `document.ts`, which crossed the 300-line limit when the
 * serialization-sync fix landed on top of the editor/external write split.
 * The seam is the natural one: this file is WHAT the store promises, and
 * `document.ts` is HOW it delivers it. `documentState.ts` already holds the
 * per-document value types, so the contract sits beside them rather than on
 * top of the implementation.
 *
 * @coordinates-with stores/documentStore/document.ts — the implementation
 * @coordinates-with stores/documentStore/documentState.ts — the value types
 * @module stores/documentStore/storeContract
 */

import type { CursorInfo } from "@/types/cursorSync";
import type { IngestOrigin } from "@/utils/ingestOrigin";
import type { IngestOptions } from "./ingestState";
import type { HardBreakStyle, LineEnding } from "@/utils/linebreakDetection";
import type { DocumentRestoreState, DocumentState, SaveSnapshots } from "./documentState";

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

export interface DocumentStore {
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
  setEditorContent: (
    tabId: string,
    canonicalEditorText: string,
    options?: SetContentOptions
  ) => void;
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
  setContent: (tabId: string, content: string, options?: SetContentOptions) => void;
  setFilePath: (tabId: string, path: string | null) => void;
  markMissing: (tabId: string) => void;
  clearMissing: (tabId: string) => void;
  markDivergent: (tabId: string) => void;
  /**
   * The BYTES of a binary document changed on disk (issue #1328).
   *
   * A media tab's file content never enters the store — the viewer streams it
   * from `asset://` — so `ingestExternalContent` has nothing to ingest and
   * cannot be used to announce the change. Without a signal the surface has no
   * way to know: an `<img>` whose `src` attribute did not change never
   * refetches, so a PNG rewritten on disk kept rendering the bytes it had
   * decoded at open time, through a tab close and reopen.
   *
   * This bumps `documentId` and moves NOTHING else. That counter already means
   * "this document was replaced from outside" — it is what remounts the editor
   * on an external text reload — so a binary reload is the same fact, not a
   * second mechanism.
   */
  markBinaryFileChanged: (tabId: string) => void;

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
