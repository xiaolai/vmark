/**
 * Per-tab document state shape and its pure state helpers.
 *
 * Split out of `document.ts` (WI-1) so the store file stays under the
 * 300-line gate. Everything here is leaf-pure — a shape, a constructor, and
 * two reducers. No store access, no side effects.
 *
 * The type is re-exported from `document.ts`, so consumers keep importing
 * `DocumentState` from `@/stores/documentStore`.
 *
 * FIELD CONTRACT — which text domain each snapshot holds (decision D3). These
 * three are NOT interchangeable, and comparing across them is the bug class the
 * contract exists to prevent: a strict compare of `content` against
 * `lastDiskContent` never matches for a CRLF document, which is why
 * `buildPostSaveState` had to reach for `softContentEquals`, and why a tab could
 * stay dirty forever.
 *
 *   - `content`         — `canonicalEditorText`: LF-only, BOM-free. What every
 *                         editor surface reads and writes.
 *   - `savedContent`    — canonical snapshot of the last successful write, in
 *                         the SAME domain as `content`, so dirty tracking is a
 *                         same-domain strict compare.
 *   - `lastDiskContent` — `rawDiskText`: the bytes as they exist on disk, CRLF
 *                         and BOM included. Drives external-change detection and
 *                         lets a save re-emit the file's exact convention.
 *
 * @module stores/documentStore/documentState
 */

import type { CursorInfo } from "@/types/cursorSync";
import { canonicalizeLineEndings, ingestExternalText } from "@/utils/editorText";
import {
  INGEST_ORIGIN_SNAPSHOT,
  resolveIngestMetadata,
  type IngestOrigin,
  type LineMetadata,
} from "@/utils/ingestOrigin";
import type { HardBreakStyle, LineEnding } from "@/utils/linebreakDetection";
import { softContentEquals } from "@/utils/linebreaks";

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
   * Whether the source file began with a U+FEFF byte-order mark.
   *
   * The mark is STRIPPED from `content` rather than carried: a BOM living at
   * offset 0 of the editor buffer breaks offset-0 block detection and renders
   * as an invisible character. Round-trip fidelity is preserved by this flag,
   * which the save path re-emits — not by the character (decision D1).
   */
  hasBom: boolean;
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

/**
 * A fresh document for `tabId`, with `content` treated as EXTERNAL text.
 *
 * The line endings are canonicalised on the way in. Writing the argument
 * verbatim is what let a CRLF file reach the editor with literal carriage
 * returns in its text nodes — and, once WI-1.2 armed the editor-domain
 * assertion, made the first keystroke on such a file throw.
 *
 * `lastDiskContent` keeps the RAW bytes: it is the disk domain, and both
 * external-change detection and `lineEndingsOnSave: "preserve"` need what is
 * actually in the file rather than what the editor shows.
 */
export const createInitialDocument = (
  content = "",
  filePath: string | null = null
): DocumentState => ({
  content: canonicalizeLineEndings(content),
  savedContent: canonicalizeLineEndings(content),
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
  hasBom: false,
  mode: "wysiwyg",
});

/**
 * Helper to update a document by tabId. Returns unchanged state if the
 * document doesn't exist.
 */
export function updateDoc(
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
 * Fail loudly, in DEVELOPMENT ONLY, when a writer hands the store non-canonical
 * text.
 *
 * `content` is `canonicalEditorText`: LF-only, BOM-free. A literal `\r` reaching
 * it does not announce itself — it surfaces later as a stray control character
 * in word count, search, lint or CJK formatting, far from the writer that
 * introduced it. Throwing here names that writer.
 *
 * Production performs NO scan. The keystroke path runs through this on every
 * flush, and paying an O(n) scan per keypress to re-check an invariant the
 * editor already maintains would be the wrong trade.
 */
export function assertCanonicalEditorText(text: string, action: string): void {
  if (!import.meta.env.DEV) return;
  const index = text.indexOf("\r");
  if (index === -1) return;
  throw new Error(
    `${action}() was given non-canonical text: a carriage return at offset ${index}. ` +
      `Editor text is LF-only — canonicalise external text with ingestExternalText() ` +
      `from utils/editorText before it reaches the store.`,
  );
}

/**
 * Compute the state change for one EXTERNAL ingest: canonicalise the text, and
 * let the origin decide both the metadata and whether this is a new saved
 * baseline or an unsaved edit.
 *
 * The two axes are separate on purpose. Applying disk-load semantics to every
 * origin marks an AI's tool write clean the moment it lands — auto-save then
 * skips the tab and closing it prompts for nothing — while also bumping
 * `documentId`, which remounts the editor and destroys undo history on every
 * write. `lastDiskContent` would come to hold a string that was never on disk,
 * so the watcher would report the untouched file as externally changed.
 *
 * Pure so both rules are testable without a store, and so `document.ts` stays a
 * wiring file.
 */
export function buildIngestState(
  doc: DocumentState,
  rawDiskText: string,
  origin: IngestOrigin,
  persisted: Partial<LineMetadata> | undefined
): Partial<DocumentState> {
  const { canonicalEditorText, lineEnding, hardBreakStyle, hasBom } =
    ingestExternalText(rawDiskText);

  const metadata = resolveIngestMetadata({
    origin,
    derived: { lineEnding, hardBreakStyle },
    existing: { lineEnding: doc.lineEnding, hardBreakStyle: doc.hardBreakStyle },
    persisted,
  });

  if (INGEST_ORIGIN_SNAPSHOT[origin] === "edit") {
    return {
      content: canonicalEditorText,
      // Dirty against the SAVED text, in the same domain — not against disk.
      isDirty: canonicalEditorText !== doc.savedContent,
      // savedContent, lastDiskContent, documentId and hasBom all describe the
      // FILE. An edit says nothing about the file, so none of them move.
      ...metadata,
    };
  }

  return {
    content: canonicalEditorText,
    savedContent: canonicalEditorText,
    // The RAW bytes, deliberately: external-change detection compares against
    // what is actually on disk, and `preserve` needs the exact convention back.
    lastDiskContent: rawDiskText,
    isDirty: false,
    isDivergent: false,
    documentId: doc.documentId + 1,
    selectedText: "",
    hasBom,
    ...metadata,
  };
}

/**
 * Compute the state change for a disk LOAD or reload.
 *
 * Same domain split as `buildIngestState` — canonical for the editor, raw for
 * the disk snapshot — but keeps `loadContent`'s explicit `filePath` and `meta`
 * arguments, which the origin-driven ingest path does not carry.
 *
 * DELIBERATE DIVERGENCE, not drift. This path canonicalises line endings but
 * does NOT strip the BOM, while `buildIngestState` does. Converging them looks
 * obviously right and is currently WRONG: nothing re-emits a BOM on save
 * (`saveToPath` has zero `hasBom` references — decision D1 is unbuilt), so
 * stripping here would make every BOM'd file lose its mark on first save.
 * `loadContent` carries the BOM inside `content` today and round-trips it,
 * which is the behaviour worth preserving until D1 lands.
 *
 * Converge these two when D1 is built — or delete this one, since WI-1.5 routes
 * every ingress through the origin-driven path and should leave it with no
 * callers.
 */
export function buildLoadState(
  doc: DocumentState,
  content: string,
  filePath: string | null | undefined,
  meta: Partial<LineMetadata> | undefined
): Partial<DocumentState> {
  return {
    content: canonicalizeLineEndings(content),
    savedContent: canonicalizeLineEndings(content),
    lastDiskContent: content,
    filePath: filePath === undefined ? doc.filePath : filePath,
    isDirty: false,
    isDivergent: false, // Reload from disk clears divergent state
    documentId: doc.documentId + 1,
    selectedText: "",
    lineEnding: meta?.lineEnding ?? doc.lineEnding,
    hardBreakStyle: meta?.hardBreakStyle ?? doc.hardBreakStyle,
  };
}

/**
 * Compute post-save state, comparing written disk content against current
 * editor content to catch TOCTOU races (user edits during an async save).
 * `softContentEquals` because `doc.content` is LF but `diskContent` is
 * `saveToPath`'s EOL-normalized output — a strict compare never matched for a
 * CRLF doc, leaving its tab dirty forever.
 *
 * KNOWN CONTRACT VIOLATION — this function writes the RAW disk bytes into
 * `savedContent`, which the field contract at the top of this file says holds
 * canonical editor text. That is the reason the compare has to be "soft" at all,
 * and it has two live consequences: a CRLF document is re-dirtied by the next
 * `setContent` (strict compare, LF vs CRLF) and rewritten on every auto-save
 * interval; and `softContentEquals` folds one trailing newline, so an edit that
 * only adds or removes the final newline during an in-flight save is read as
 * clean and discarded. **WI-1.4 replaces this with a dual-snapshot contract**
 * (`{ editorSnapshot, diskSnapshot }`) and a same-domain strict compare. Until
 * then the contract above describes the intent and this function is the
 * exception — documented rather than silently contradicted.
 *
 * See __tests__/postSaveDirtyState.test.ts.
 */
export function buildPostSaveState(
  doc: DocumentState,
  lastDiskContent: string | undefined
) {
  const diskContent = lastDiskContent ?? doc.content;
  return {
    savedContent: diskContent,
    lastDiskContent: diskContent,
    isDirty: !softContentEquals(doc.content, diskContent),
    isDivergent: false,
  };
}
