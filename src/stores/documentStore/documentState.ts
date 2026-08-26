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
 * `lastDiskContent` never matches for a CRLF document — the defect that kept a
 * saved tab dirty forever until the dual-snapshot contract (WI-1.4) put each
 * snapshot in its own domain.
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

import type { TransferLineMetadata } from "@/utils/transferLineMetadata";
import type { CursorInfo } from "@/types/cursorSync";
import { ingestExternalText } from "@/utils/editorText";
import type { HardBreakStyle, LineEnding } from "@/utils/linebreakDetection";

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
 * Canonicalised through the SAME boundary as every other door
 * (`ingestExternalText`): line endings to LF, a leading BOM stripped into
 * `hasBom`. Writing the argument verbatim is what let a CRLF file reach the
 * editor with literal carriage returns in its text nodes — and, once WI-1.2
 * armed the editor-domain assertion, made the first keystroke on such a file
 * throw. The BOM strip became safe once `saveToPath` re-emits the mark
 * (decision D1); before that, stripping here would have LOST it on save.
 *
 * `lastDiskContent` keeps the RAW bytes: it is the disk domain, and both
 * external-change detection and `lineEndingsOnSave: "preserve"` need what is
 * actually in the file rather than what the editor shows.
 */
/**
 * A transferred document's saved state plus the file convention it carries.
 *
 * `initDocument`'s fourth parameter used to be a bare `savedContent?: string`,
 * which blurred two domains — the canonical saved text and the raw disk
 * snapshot were both taken from it — and had no room for `lineEnding` or
 * `hasBom` at all. Canonical content cannot express them, so a CRLF+BOM file
 * moved between windows came back LF and BOM-less on its first save.
 */
export interface DocumentRestoreState extends TransferLineMetadata {
  savedContent: string;
}

export const createInitialDocument = (
  content = "",
  filePath: string | null = null
): DocumentState => {
  const { canonicalEditorText, hasBom, hardBreakStyle } = ingestExternalText(content);
  return {
    content: canonicalEditorText,
    savedContent: canonicalEditorText,
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
    // ASYMMETRIC, and deliberately. `lineEnding` stays unknown: this door's only
    // non-empty callers are the tab/workspace TRANSFER paths, whose payloads
    // carry canonical in-memory text, so deriving would assert "lf" for a
    // document that was CRLF — worse than unknown, which lets the save-time
    // resolver apply the user's setting. `hardBreakStyle` SURVIVES
    // canonicalisation (detectHardBreakStyle normalises EOLs before scanning),
    // so deriving it is strictly better: reporting "unknown" for a transferred
    // backslash-break document resolved to "twoSpaces" and rewrote every break.
    lineEnding: "unknown",
    hardBreakStyle,
    hasBom,
    mode: "wysiwyg",
  };
};

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
/**
 * Reject the PRE-MIGRATION shape of `initDocument`'s fourth argument.
 *
 * It was a bare `savedContent: string` before line metadata had to travel with
 * a transfer. TypeScript catches the old form, but a JS caller or an
 * `as never` cast would otherwise fail deep inside `ingestExternalText` with
 * an opaque "cannot read .includes of undefined" — main's workspace-switch
 * tests did exactly that during the merge. Name the migration at the boundary.
 */
export function assertRestoreState(restore: DocumentRestoreState): void {
  if (!import.meta.env.DEV) return;
  if (typeof restore.savedContent !== "string") {
    throw new TypeError(
      "initDocument's 4th argument is a DocumentRestoreState " +
        "({ savedContent, ...lineMetadata }), not a bare savedContent string.",
    );
  }
}

/**
 * Refuse to REBUILD a document that already exists — in development.
 *
 * `initDocument` constructs a whole fresh entry, so calling it for a tab that
 * already has one silently discards more than its content: `readOnly` (which
 * disables write protection), the per-document editor mode, and `documentId`.
 * That last one is the quiet part. `documentId` is the editor's remount key and
 * a first-open document sits at 0, so rebuilding it there leaves the counter
 * UNCHANGED and the editor may never remount onto the new content. The MCP
 * open path hit exactly this and routed around it (see
 * `services/mcpBridge/v2/workspaceOpen.ts`), but the reasoning lived in a
 * comment on the caller — where the next caller will not look.
 *
 * No production caller does this today; every one creates its tab first. This
 * exists so the day one does, it says so instead of producing a document that
 * looks right and will not re-render.
 *
 * It fires only when a rebuild would actually LOSE something — a raised
 * `documentId`, write protection, or a non-default editor mode. Re-initialising
 * a pristine entry discards nothing, and it is an ordinary way to reset a tab
 * to a known state (every store test in this directory does it in `beforeEach`).
 * An assertion that fired there would be describing test setup, not the hazard.
 *
 * `ingestExternalContent(tabId, text, "disk-open")` is the door for an existing
 * tab: it mutates in place, increments `documentId`, and bumps the MCP revision
 * when the content actually moved.
 *
 * DEV-only, like the canonical-text assertion beside it: a hard throw in
 * production would turn a recoverable mistake into a blank window.
 */
export function assertNotRebuildingDocument(
  existing: DocumentState | undefined,
  tabId: string,
): void {
  if (!import.meta.env.DEV) return;
  if (!existing) return;
  const wouldLose =
    existing.documentId !== 0 || existing.readOnly || existing.mode !== "wysiwyg";
  if (!wouldLose) return;
  throw new Error(
    `initDocument("${tabId}") was called for a tab that already has a document. ` +
      `It builds a FRESH entry, discarding readOnly, the editor mode, and ` +
      `documentId — and an unchanged documentId means the editor may never ` +
      `remount onto the new content. Use ingestExternalContent(tabId, text, ` +
      `"disk-open") to replace an existing document in place.`,
  );
}

export function assertCanonicalEditorText(text: string, action: string): void {
  if (!import.meta.env.DEV) return;
  // The contract is LF-only AND BOM-free. Checking only `\r` let a leading
  // U+FEFF into the buffer — the one character whose presence at offset 0
  // breaks offset-0 block detection, which is why it is stripped at all.
  if (text.startsWith("\u{FEFF}")) {
    throw new Error(
      `${action}() was given non-canonical text: a leading BOM (U+FEFF). ` +
        `Editor text is BOM-free — the mark is carried by the document's ` +
        `\`hasBom\` flag and re-emitted on save, not held in the buffer.`,
    );
  }
  const index = text.indexOf("\r");
  if (index === -1) return;
  throw new Error(
    `${action}() was given non-canonical text: a carriage return at offset ${index}. ` +
      `Editor text is LF-only — canonicalise external text with ingestExternalText() ` +
      `from utils/editorText before it reaches the store.`,
  );
}

/** What a successful write produced, one snapshot per text domain (WI-1.4). */
export interface SaveSnapshots {
  /** The canonical editor text handed to the writer — same domain as `content`. */
  editorSnapshot: string;
  /** The exact bytes written to disk, EOL/hard-break normalisation included. */
  diskSnapshot: string;
}

/**
 * Compute post-save state from the two snapshots, honouring the field contract
 * above: `savedContent` stays in the EDITOR domain, `lastDiskContent` in the
 * DISK domain.
 *
 * The dirty compare is STRICT and same-domain — it exists to catch the TOCTOU
 * race where the user edits during the async save. The old single-string API
 * stored the disk bytes in `savedContent` and had to compare "softly" across
 * domains, which cost twice: a CRLF document was re-dirtied by the very next
 * flush and rewritten every auto-save interval forever, and an edit that only
 * touched the final newline during an in-flight save was folded away as clean
 * and silently discarded.
 *
 * See __tests__/dualSnapshotSave.test.ts and __tests__/postSaveDirtyState.test.ts.
 */
export function buildPostSaveState(doc: DocumentState, snapshots: SaveSnapshots) {
  return {
    savedContent: snapshots.editorSnapshot,
    lastDiskContent: snapshots.diskSnapshot,
    isDirty: doc.content !== snapshots.editorSnapshot,
    isDivergent: false,
  };
}
