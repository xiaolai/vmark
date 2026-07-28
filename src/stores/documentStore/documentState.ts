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
 * @module stores/documentStore/documentState
 */

import type { CursorInfo } from "@/types/cursorSync";
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
   * Per-document editor mode (ADR-009). Defaults to "wysiwyg"; the
   * window-scoped `useUIStore.sourceMode` is the public toggle and is
   * mirrored into the active document's mode on toggle. Persisting
   * per-doc mode makes "two tabs in one window, different modes" a
   * representable state; selectors layered on top of this enable
   * future per-tab mode switching without further schema changes.
   */
  mode: "wysiwyg" | "source";
}

export const createInitialDocument = (
  content = "",
  filePath: string | null = null
): DocumentState => ({
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
 * Compute post-save state, comparing written disk content against current
 * editor content to catch TOCTOU races (user edits during an async save).
 * `softContentEquals` because `doc.content` is LF but `diskContent` is
 * `saveToPath`'s EOL-normalized output — a strict compare never matched for a
 * CRLF doc, leaving its tab dirty forever. `savedContent`/`lastDiskContent`
 * keep the REAL bytes. See __tests__/postSaveDirtyState.test.ts.
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
