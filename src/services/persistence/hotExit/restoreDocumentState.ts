/**
 * Purpose: restore ONE tab's document state from a hot-exit snapshot —
 * content, line metadata, flags, per-doc mode, cursor, and unified history.
 *
 * Split out of `restoreHelpers.ts`, which had grown to 397 lines around two
 * unrelated responsibilities: pulling and validating the window payload, and
 * rebuilding each document from it. This half is the second.
 *
 * Key decisions:
 *   - ONE hot-exit ingest replaces the old init/load/updateLastDiskContent
 *     sequence whose write ORDER was load-bearing. The origin's
 *     prefer-persisted rule (WI-1.3) applies the snapshot's line ending where
 *     it is decided; `deriveFrom` points detection at the RAW disk bytes when
 *     present, because the saved body is canonical LF and would otherwise
 *     answer "lf" for every file.
 *   - Every persisted enum is re-validated here rather than trusted. Sessions
 *     written by older builds legitimately carry `undefined` for fields added
 *     since, and a corrupt file carries anything at all.
 *
 * @coordinates-with services/persistence/hotExit/restoreHelpers.ts — the caller
 * @coordinates-with stores/documentStore/document.ts — the hot-exit-restore ingest
 * @module services/persistence/hotExit/restoreDocumentState
 */
import { useDocumentStore, useUnifiedHistoryStore } from '@/stores/documentStore';
import { canonicalizeLineEndings } from '@/utils/editorText';
import { hotExitLog, hotExitWarn } from '@/utils/debug';
import type { LineEnding } from '@/utils/linebreakDetection';
import type { CursorInfo as StoreCursorInfo } from '@/types/cursorSync';
import type { HistoryCheckpoint as StoreHistoryCheckpoint } from '@/stores/documentStore';
import type { TabState, CursorInfo, HistoryCheckpoint, DocumentState } from './types';

/**
 * Convert hot exit line ending format back to store format
 */
function fromHotExitLineEnding(lineEnding: '\n' | '\r\n' | 'unknown'): LineEnding {
  switch (lineEnding) {
    case '\n':
      return 'lf';
    case '\r\n':
      return 'crlf';
    case 'unknown':
      return 'unknown';
  }
}

/**
 * Convert hot exit cursor info to store format with validation.
 * Returns null if input is null/undefined or has invalid data.
 */
function toStoreCursorInfo(cursorInfo: CursorInfo | null | undefined): StoreCursorInfo | null {
  if (!cursorInfo) return null;

  // Validate required numeric fields against their domains, not just
  // finiteness. source_line is 1-indexed (remark), so it must be a positive
  // integer; offset_in_word is a character offset (non-negative); and
  // percent_in_line is a fraction in [0, 1]. Corrupt persisted state outside
  // these ranges would otherwise be restored into editor cursor sync.
  if (
    !Number.isInteger(cursorInfo.source_line) ||
    cursorInfo.source_line < 1 ||
    !Number.isFinite(cursorInfo.offset_in_word) ||
    cursorInfo.offset_in_word < 0 ||
    !Number.isFinite(cursorInfo.percent_in_line) ||
    cursorInfo.percent_in_line < 0 ||
    cursorInfo.percent_in_line > 1
  ) {
    hotExitWarn('Invalid cursor info, skipping restore');
    return null;
  }

  return {
    sourceLine: cursorInfo.source_line,
    wordAtCursor: cursorInfo.word_at_cursor ?? '',
    offsetInWord: cursorInfo.offset_in_word,
    nodeType: (cursorInfo.node_type ?? 'paragraph') as StoreCursorInfo['nodeType'],
    percentInLine: cursorInfo.percent_in_line,
    contextBefore: cursorInfo.context_before ?? '',
    contextAfter: cursorInfo.context_after ?? '',
    blockAnchor: cursorInfo.block_anchor as StoreCursorInfo['blockAnchor'],
  };
}

/**
 * Convert hot exit checkpoint back to store format
 */
function fromHotExitCheckpoint(checkpoint: HistoryCheckpoint): StoreHistoryCheckpoint {
  return {
    markdown: checkpoint.markdown,
    mode: checkpoint.mode === 'source' || checkpoint.mode === 'wysiwyg'
      ? checkpoint.mode
      : 'wysiwyg', // Default to wysiwyg if invalid
    cursorInfo: toStoreCursorInfo(checkpoint.cursor_info),
    timestamp: checkpoint.timestamp,
  };
}

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------


/**
 * Restore document state for a tab
 */
export async function restoreDocumentState(
  tabId: string,
  tabState: TabState,
  documentStore: ReturnType<typeof useDocumentStore.getState>
): Promise<void> {
  const { document: docState, file_path } = tabState;

  // Convert line ending format (validate and narrow type)
  const lineEnding = (
    docState.line_ending === '\n' ||
    docState.line_ending === '\r\n' ||
    docState.line_ending === 'unknown'
  )
    ? fromHotExitLineEnding(docState.line_ending)
    : ('unknown' as LineEnding);

  // Validate persisted hardBreakStyle against the documentStore's union.
  // Pre-existing sessions write this as undefined and fall back to detection.
  const hardBreakStyle =
    docState.hard_break_style === 'backslash' ||
    docState.hard_break_style === 'twoSpaces' ||
    docState.hard_break_style === 'mixed' ||
    docState.hard_break_style === 'unknown'
      ? docState.hard_break_style
      : undefined;

  // ONE hot-exit ingest replaces the old init/load/updateLastDiskContent
  // sequence whose write ORDER was load-bearing. The origin's prefer-persisted
  // rule (WI-1.3) applies the snapshot's line ending where it is decided;
  // `deriveFrom` points detection at the RAW disk bytes when present, because
  // the saved body is canonical LF and would answer "lf" for every file.
  documentStore.ingestExternalContent(tabId, docState.saved_content, 'hot-exit-restore', {
    filePath: file_path,
    persisted: { lineEnding, ...(hardBreakStyle ? { hardBreakStyle } : {}) },
    ...(typeof docState.last_disk_content === 'string'
      ? { deriveFrom: docState.last_disk_content }
      : {}),
  });

  // If dirty, apply current content (may be legacy CRLF, so canonicalise)
  if (docState.is_dirty) {
    documentStore.setEditorContent(tabId, canonicalizeLineEndings(docState.content));
  }

  // Restore flags
  if (docState.is_missing) {
    documentStore.markMissing(tabId);
  }
  if (docState.is_divergent) {
    documentStore.markDivergent(tabId);
  }
  if (docState.is_read_only) {
    documentStore.setReadOnly(tabId, true);
  }

  // Restore per-doc mode (ADR-009). Pre-mode-persistence sessions leave
  // this undefined; the documentStore default ("wysiwyg") then applies.
  if (docState.mode === 'wysiwyg' || docState.mode === 'source') {
    documentStore.setMode(tabId, docState.mode);
  }

  // Restore cursor info (using shared validation helper)
  const cursorInfo = toStoreCursorInfo(docState.cursor_info);
  if (cursorInfo) {
    documentStore.setCursorInfo(tabId, cursorInfo);
  }

  // Restore unified history (cross-mode undo/redo checkpoints)
  restoreUnifiedHistory(tabId, docState);
}

/**
 * Restore unified history checkpoints for a tab
 */
export function restoreUnifiedHistory(
  tabId: string,
  docState: DocumentState
): void {
  const undoHistory = docState.undo_history || [];
  const redoHistory = docState.redo_history || [];

  // Skip if no history to restore
  if (undoHistory.length === 0 && redoHistory.length === 0) {
    return;
  }

  // Convert checkpoints from hot exit format to store format
  const undoStack = undoHistory.map(fromHotExitCheckpoint);
  const redoStack = redoHistory.map(fromHotExitCheckpoint);

  // Directly set the history state for this document
  useUnifiedHistoryStore.setState((state) => ({
    documents: {
      ...state.documents,
      [tabId]: {
        undoStack,
        redoStack,
      },
    },
  }));

  hotExitLog(
    `Restored unified history for tab '${tabId}': ${undoStack.length} undo, ${redoStack.length} redo checkpoints`
  );
}
